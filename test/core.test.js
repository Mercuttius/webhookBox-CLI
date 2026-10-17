import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import http from 'node:http';
import { Store, exportEvent } from '../src/store.js';
import { createReceiver, listen, closeServer } from '../src/server.js';
import { replay } from '../src/replay.js';
import { safe, integer, dateFilter } from '../src/config.js';
import { startTunnel } from '../src/tunnel.js';

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'webhookbox-test-'));
  const store = new Store(dir);
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  return { store, dir };
}

test('capture preserves bytes, duplicate headers, method, query; survives reopening', async t => {
  const { store, dir } = fixture(t);
  const box = store.createBox('payments');
  const server = createReceiver(store);
  const port = await listen(server, 0);
  t.after(() => closeServer(server));
  const body = Buffer.from([0, 255, 27, 13, 10, 128, 65]);
  const id = await new Promise((resolve, reject) => {
    const req = http.request(`http://127.0.0.1:${port}/hooks/${box.id}/extra?x=1&x=2`, { method: 'PATCH', headers: { 'x-repeat': ['one', 'two'], 'content-type': 'application/octet-stream' } }, res => {
      assert.equal(res.statusCode, 202);
      let data = ''; res.on('data', c => data += c); res.on('end', () => resolve(JSON.parse(data).id));
    }); req.on('error', reject); req.end(body);
  });
  const event = store.event(id);
  assert.deepEqual(event.body, body);
  assert.equal(event.method, 'PATCH');
  assert.equal(event.url, `/hooks/${box.id}/extra?x=1&x=2`);
  assert.equal(event.headers.filter(x => x === 'x-repeat').length, 2);
  const reopened = new Store(dir);
  assert.deepEqual(reopened.event(id).body, body); reopened.close();
  assert.deepEqual(Buffer.from(exportEvent(event).body, 'base64'), body);
  const second = store.createBox('another');
  assert.equal(store.list({ box: second.name }).length, 0);
  assert.equal(store.list({ box: box.name, method: 'PATCH' }).length, 1);
});

test('receiver exposes no management API, rejects oversized bodies and rate limits', async t => {
  const { store } = fixture(t);
  const box = store.createBox('test');
  const server = createReceiver(store, { maxBody: 3, rateLimit: 3 });
  const port = await listen(server, 0);
  t.after(() => closeServer(server));
  const origin = `http://127.0.0.1:${port}`;
  assert.equal((await fetch(`${origin}/events`)).status, 404);
  assert.equal((await fetch(`${origin}/hooks/${box.name}`)).status, 404);
  assert.equal((await fetch(`${origin}/hooks/${box.id}`, { method: 'POST', body: '1234' })).status, 413);
  assert.equal((await fetch(`${origin}/hooks/${box.id}`, { method: 'POST', body: '12' })).status, 429);
  assert.equal(store.list().length, 0);
});

test('replay preserves payload and duplicates, rewrites transport headers, supports overrides', async t => {
  const { store } = fixture(t);
  const box = store.createBox('test');
  const body = Buffer.from([0, 255, 1, 2]);
  const id = store.save(box.id, 'PUT', '/old', ['Host', 'old.invalid', 'Content-Length', '900', 'Connection', 'x-private', 'x-private', 'hidden', 'X-Repeat', 'a', 'X-Repeat', 'b', 'Authorization', 'old'], body);
  let received;
  const destination = http.createServer((req, res) => {
    const parts = [];
    req.on('data', c => parts.push(c));
    req.on('end', () => { received = { headers: req.headers, raw: req.rawHeaders, body: Buffer.concat(parts), method: req.method, url: req.url }; res.writeHead(201); res.end('ok'); });
  });
  const port = await listen(destination, 0);
  t.after(() => closeServer(destination));
  const result = await replay(store.event(id), `http://127.0.0.1:${port}/new?ok=1`, { removeHeaders: ['authorization'], headers: ['X-New:yes'] });
  assert.equal(result.status, 201);
  assert.deepEqual(received.body, body);
  assert.equal(received.headers['content-length'], '4');
  assert.equal(received.headers['x-private'], undefined);
  assert.equal(received.headers.authorization, undefined);
  assert.equal(received.headers['x-new'], 'yes');
  assert.equal(received.raw.filter(x => x === 'x-repeat').length, 2);
  assert.equal(received.method, 'PUT');
  assert.equal(received.url, '/new?ok=1');
});

test('replay times out, does not follow redirects and bounds response size', async t => {
  const event = { method: 'POST', headers: [], body: Buffer.from('x') };
  const server = http.createServer((req, res) => {
    req.resume();
    if (req.url === '/slow') return;
    if (req.url === '/redirect') { res.writeHead(302, { location: '/large' }); res.end(); return; }
    res.end('1234567890');
  });
  const port = await listen(server, 0);
  t.after(() => closeServer(server));
  const origin = `http://127.0.0.1:${port}`;
  await assert.rejects(replay(event, `${origin}/slow`, { timeout: 30 }), /Tempo limite/);
  assert.equal((await replay(event, `${origin}/redirect`)).status, 302);
  const result = await replay(event, `${origin}/large`, { maxResponse: 3 });
  assert.equal(result.body, '123'); assert.equal(result.truncated, true);
  assert.throws(() => replay(event, 'file:///tmp/test'), /HTTP/);
});

test('storage retention, pagination, cursor and deletion keep boxes isolated', t => {
  const { store } = fixture(t);
  const a = store.createBox('a'), b = store.createBox('b');
  for (let i = 0; i < 4; i++) store.save(a.id, 'POST', '/', [], Buffer.from('x'), 3);
  assert.equal(store.list().length, 3);
  assert.equal(store.list({ offset: 2 }).length, 1);
  const cursor = store.latestSeq();
  const id = store.save(b.id, 'GET', '/', [], Buffer.alloc(0));
  assert.equal(store.list({ after: cursor, ascending: true })[0].id, id);
  assert.equal(store.clear('a'), 3);
  assert.equal(store.list().length, 1);
  store.db.prepare('UPDATE events SET received_at=?').run('2000-01-01T00:00:00.000Z');
  assert.equal(store.prune(7), 1);
  store.save(b.id, 'GET', '/', [], Buffer.alloc(0));
  store.removeBox('b');
  assert.equal(store.list().length, 0);
  assert.throws(() => store.createBox('bad/name'));
  assert.throws(() => store.createBox('a'), /existe/);
});

test('terminal escaping and option validation', () => {
  assert.equal(safe('\x1b]52;c;evil\x07'), '\\u001b]52;c;evil\\u0007');
  assert.throws(() => integer('1e3', 'test', 0));
  assert.throws(() => integer('-1', 'test', 0));
  assert.throws(() => dateFilter('yesterday'));
  assert.equal(dateFilter('2026-10-17T00:00:00Z'), '2026-10-17T00:00:00.000Z');
});

test('missing public tunnel dependency produces actionable error and shuts down', async () => {
  const tunnel = startTunnel(3000, { executable: 'webhookbox-test-nonexistent-cloudflared' });
  await assert.rejects(tunnel.ready, /não encontrado/);
  await tunnel.stop();
});
