import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Store } from '../src/store.js';

const cli = fileURLToPath(new URL('../bin/webhookbox.js', import.meta.url));
test('CLI workflows, JSON output, export protection and destructive confirmation', t => {
  const dir = mkdtempSync(join(tmpdir(), 'webhookbox-cli-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const run = (...args) => spawnSync(process.execPath, [cli, ...args, '--data-dir', dir], { encoding: 'utf8' });
  const created = run('box', 'create', 'demo', '--json');
  assert.equal(created.status, 0, created.stderr);
  const box = JSON.parse(created.stdout);
  assert.match(box.url, /localhost:3000\/hooks\//);
  assert.equal(run('box', 'create', 'demo').status, 1);
  assert.equal(run('box', 'create', 'another', '--base-url', 'bad').status, 1);
  assert.equal(JSON.parse(run('box', 'list', '--json').stdout).length, 1);
  assert.equal(run('events', 'clear', 'demo').status, 1);
  assert.equal(run('start', '--port', 'abc').status, 1);
  assert.equal(run('events', 'list', '--public').status, 1);
  const store = new Store(dir);
  const id = store.save(box.id, 'POST', '/x', ['X-Test', 'ok'], Buffer.from('{"hello":"world"}'));
  store.close();
  const shown = run('events', 'show', id, '--json');
  assert.equal(shown.status, 0, shown.stderr);
  assert.equal(Buffer.from(JSON.parse(shown.stdout).body, 'base64').toString(), '{"hello":"world"}');
  const path = join(dir, 'export.json');
  assert.equal(run('events', 'export', id, '--output', path).status, 0);
  assert.equal(JSON.parse(readFileSync(path)).id, id);
  assert.equal(run('events', 'export', id, '--output', path).status, 1);
  assert.equal(run('events', 'delete', id, '--yes').status, 0);
  assert.equal(JSON.parse(run('events', 'list', '--json').stdout).length, 0);
  assert.equal(run('box', 'remove', 'demo', '--yes').status, 0);
});

test('watch streams new events from another database connection', { timeout: 10000 }, async t => {
  const dir = mkdtempSync(join(tmpdir(), 'webhookbox-watch-'));
  const store = new Store(dir);
  const box = store.createBox('demo');
  const child = spawn(process.execPath, [cli, 'events', 'watch', 'demo', '--interval', '100', '--data-dir', dir]);
  t.after(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
  try {
    await new Promise((resolve, reject) => {
      let written = false, output = '';
      child.stdout.on('data', chunk => {
        output += chunk.toString();
        if (!written && output.includes('Aguardando')) { written = true; store.save(box.id, 'POST', '/x', [], Buffer.from('hello')); }
        if (output.includes('5 bytes')) resolve();
      });
      child.on('error', reject);
      child.on('exit', code => reject(new Error(`Watch exited: ${code}`)));
    });
  } finally {
    const closed = new Promise(resolve => child.once('close', resolve));
    child.kill(); await closed;
  }
});
