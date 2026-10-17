import http from 'node:http';

export function createReceiver(store, { maxBody = 1048576, rateLimit = 120, maxEvents = 10000, onEvent = () => {}, onError = () => {} } = {}) {
  // A global limit bounds memory and works independently of proxy headers.
  let windowStart = Date.now(), count = 0;
  const server = http.createServer({ maxHeaderSize: 16384, requestTimeout: 30000, headersTimeout: 10000 }, (req, res) => {
    const reply = (status, data) => {
      res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', 'connection': 'close' });
      res.end(JSON.stringify(data));
    };
    if (Date.now() - windowStart >= 60000) { windowStart = Date.now(); count = 0; }
    if (++count > rateLimit) { reply(429, { error: 'Rate limit exceeded' }); req.resume(); return; }
    const match = /^\/hooks\/([a-f0-9]{36})(?:\/[^?]*)?(?:\?.*)?$/.exec(req.url);
    if (!match || !store.boxById(match[1])) { reply(404, { error: 'Inbox not found' }); req.resume(); return; }
    let size = 0, rejected = false;
    const chunks = [];
    req.setTimeout(15000, () => req.destroy());
    req.on('error', () => {});
    req.on('data', chunk => {
      if (rejected) return;
      size += chunk.length;
      if (size > maxBody) { rejected = true; chunks.length = 0; reply(413, { error: 'Payload too large' }); return; }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (rejected) return;
      try {
        const id = store.save(match[1], req.method, req.url, req.rawHeaders, Buffer.concat(chunks), maxEvents);
        reply(202, { id, received: true });
        onEvent({ id, method: req.method, size, box_id: match[1] });
      } catch (error) { onError(error); if (!res.headersSent) reply(500, { error: 'Could not save event' }); }
    });
  });
  return server;
}

export async function listen(server, port, host = '127.0.0.1') {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => { server.off('error', reject); resolve(); });
  });
  return server.address().port;
}

export async function closeServer(server) {
  await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
}
