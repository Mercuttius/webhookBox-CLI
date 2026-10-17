import http from 'node:http';
import https from 'node:https';

export function replay(event, destination, { timeout = 10000, headers = [], removeHeaders = [], maxResponse = 65536 } = {}) {
  const url = new URL(destination);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Destino deve ser HTTP(S), sem credenciais na URL.');
  const excluded = new Set(['host', 'content-length', 'connection', 'transfer-encoding', 'keep-alive', 'upgrade', 'trailer', 'te', 'proxy-authorization', 'proxy-authenticate', 'expect', ...removeHeaders.map(x => x.toLowerCase())]);
  for (let i = 0; i < event.headers.length; i += 2) {
    if (event.headers[i].toLowerCase() === 'connection') event.headers[i + 1].split(',').forEach(x => excluded.add(x.trim().toLowerCase()));
  }
  const outgoing = {};
  for (let i = 0; i < event.headers.length; i += 2) {
    const name = event.headers[i].toLowerCase();
    if (!excluded.has(name)) (outgoing[name] ??= []).push(event.headers[i + 1]);
  }
  for (const header of headers) {
    const colon = header.indexOf(':');
    if (colon < 1) throw new Error('Header deve usar o formato Nome:valor.');
    const name = header.slice(0, colon).trim().toLowerCase();
    if (['host', 'content-length', 'transfer-encoding', 'connection', 'expect', 'upgrade'].includes(name)) throw new Error(`Header gerenciado automaticamente: ${name}`);
    outgoing[name] = header.slice(colon + 1).trim();
  }
  outgoing['content-length'] = String(event.body.length);
  const start = performance.now();
  return new Promise((resolve, reject) => {
    const request = (url.protocol === 'https:' ? https : http).request(url, { method: event.method, headers: outgoing }, response => {
      let size = 0, truncated = false, settled = false;
      const chunks = [];
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ status: response.statusCode, duration_ms: Math.round(performance.now() - start), headers: response.headers, body: Buffer.concat(chunks).toString('utf8'), truncated });
      };
      response.on('data', chunk => {
        const remaining = maxResponse - size;
        chunks.push(chunk.subarray(0, Math.max(0, remaining)));
        size += chunk.length;
        if (size > maxResponse) { truncated = true; finish(); response.destroy(); }
      });
      response.on('end', finish);
      response.on('error', reject);
    });
    const timer = setTimeout(() => request.destroy(new Error(`Tempo limite de ${timeout} ms excedido.`)), timeout);
    request.on('error', error => { clearTimeout(timer); reject(error); });
    request.on('close', () => clearTimeout(timer));
    request.end(event.body);
  });
}
