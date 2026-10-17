import { parseArgs } from 'node:util';
import { writeFileSync, readFileSync } from 'node:fs';
import { dataDirectory, integer, safe, dateFilter } from './config.js';
import { Store, exportEvent } from './store.js';
import { createReceiver, listen, closeServer } from './server.js';
import { replay } from './replay.js';
import { startTunnel } from './tunnel.js';

const help = `WebhookBox — receba, inspecione e reenvie webhooks pelo terminal.

  webhookbox start [--port 3000] [--public]
  webhookbox box create <nome>
  webhookbox box list [--base-url URL]
  webhookbox box remove <nome> --yes
  webhookbox events list [caixa] [--limit 50] [--offset 0]
  webhookbox events show <id>
  webhookbox events watch [caixa] [--interval 1000]
  webhookbox events replay <id> --to URL [--header 'Nome:valor']
  webhookbox events export <id> [--output arquivo.json]
  webhookbox events delete <id> --yes
  webhookbox events clear <caixa> --yes
  webhookbox config

Geral: --data-dir CAMINHO, --json, --help, --version
Listar: --method POST, --since 2026-10-17T00:00:00Z
Servidor: --max-body 1048576, --rate-limit 120 (por minuto),
          --max-events 10000, --retention-days 7, --cloudflared CAMINHO
Reenvio: --timeout 10000, --remove-header Nome (repetível)

Sem login. Dados locais. O modo público exige cloudflared instalado.
URLs públicas são temporárias. Ctrl+C encerra o servidor e o túnel.
`;

const strings = ['data-dir', 'port', 'base-url', 'limit', 'offset', 'method', 'since', 'interval', 'to', 'output', 'timeout', 'max-body', 'rate-limit', 'max-events', 'retention-days', 'cloudflared'];
const options = Object.fromEntries(strings.map(key => [key, { type: 'string' }]));
for (const key of ['json', 'help', 'version', 'public', 'yes']) options[key] = { type: 'boolean' };
for (const key of ['header', 'remove-header']) options[key] = { type: 'string', multiple: true };

function output(value, json = false) {
  if (json || typeof value !== 'string') console.log(safe(JSON.stringify(value, null, json ? 0 : 2)));
  else console.log(safe(value));
}

function baseUrl(value = 'http://localhost:3000') {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('--base-url deve ser uma origem HTTP(S), por exemplo http://localhost:4000.');
  return url.origin;
}

function confirmation(values) {
  if (!values.yes) throw new Error('Esta operação apaga dados. Execute novamente com --yes para confirmar.');
}

async function runServer(store, values) {
  const port = integer(values.port, '--port', 3000, 1, 65535);
  const retention = integer(values['retention-days'], '--retention-days', 7, 1, 36500);
  const settings = {
    maxBody: integer(values['max-body'], '--max-body', 1048576, 1, 104857600),
    rateLimit: integer(values['rate-limit'], '--rate-limit', 120),
    maxEvents: integer(values['max-events'], '--max-events', 10000, 1, 1000000),
    onEvent: event => output(values.json ? { type: 'received', ...event } : `${new Date().toISOString()}  ${event.method}  ${event.id}  ${event.size} bytes`, values.json),
    onError: error => console.error(safe(`Falha ao salvar evento: ${error.message}`)),
  };
  if (!store.boxes().length) store.createBox('default');
  store.prune(retention);
  const server = createReceiver(store, settings);
  try { await listen(server, port); }
  catch (error) { throw new Error(error.code === 'EADDRINUSE' ? `Porta ${port} ocupada. Use --port com outra porta.` : error.message); }
  let finish;
  const done = new Promise(resolve => { finish = resolve; });
  const interrupt = () => finish();
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  const prune = setInterval(() => {
    try { store.prune(retention); } catch (error) { settings.onError(error); }
  }, 60000);
  let tunnel;
  const addresses = origin => store.boxes().map(box => ({ name: box.name, url: `${origin}/hooks/${box.id}` }));
  try {
    output(values.json ? { type: 'listening', boxes: addresses(`http://localhost:${port}`) } : `WebhookBox ativo (Ctrl+C para encerrar)\n${addresses(`http://localhost:${port}`).map(b => `${b.name}: ${b.url}`).join('\n')}`, values.json);
    if (values.public) {
      tunnel = startTunnel(port, { executable: values.cloudflared, onExit: code => {
        console.error(`O túnel encerrou (código ${code}). O servidor será encerrado; execute start --public novamente.`);
        process.exitCode = 1;
        finish();
      } });
      const url = await Promise.race([tunnel.ready, done]);
      if (url) output(values.json ? { type: 'public', url, boxes: addresses(url) } : `URL pública temporária — tráfego via Cloudflare:\n${addresses(url).map(b => `${b.name}: ${b.url}`).join('\n')}`, values.json);
    }
    await done;
  } finally {
    clearInterval(prune);
    if (tunnel) await tunnel.stop();
    await closeServer(server);
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
  }
}

async function watch(store, box, values) {
  if (box) store.box(box);
  const interval = integer(values.interval, '--interval', 1000, 100, 60000);
  let cursor = store.latestSeq();
  if (!values.json) output('Aguardando novos eventos. Ctrl+C para encerrar.');
  await new Promise((resolve, reject) => {
    const cleanup = () => { clearInterval(timer); process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop); };
    const stop = () => { cleanup(); resolve(); };
    const timer = setInterval(() => {
      try {
        const rows = store.list({ box, after: cursor, ascending: true, limit: 500 });
        for (const row of rows) { output(values.json ? row : `${row.received_at}  ${row.method}  ${row.id}  ${row.size} bytes`, values.json); cursor = row.seq; }
      } catch (error) { cleanup(); reject(error); }
    }, interval);
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
  });
}

export async function main(args = process.argv.slice(2)) {
  const { values, positionals } = parseArgs({ args, options, allowPositionals: true, strict: true });
  if (values.help || !positionals.length && !values.version) { output(help); return; }
  if (values.version) { output(JSON.parse(readFileSync(new URL('../package.json', import.meta.url))).version); return; }
  const [group, action, target] = positionals;
  const key = ['start', 'config'].includes(group) ? group : `${group} ${action}`;
  const commands = {
    start: [1, 1, ['port', 'public', 'max-body', 'rate-limit', 'max-events', 'retention-days', 'cloudflared']],
    config: [1, 1, []],
    'box create': [3, 3, ['base-url']], 'box list': [2, 2, ['base-url']], 'box remove': [3, 3, ['yes']],
    'events list': [2, 3, ['limit', 'offset', 'method', 'since']],
    'events show': [3, 3, []], 'events watch': [2, 3, ['interval']],
    'events replay': [3, 3, ['to', 'header', 'remove-header', 'timeout']],
    'events export': [3, 3, ['output']], 'events delete': [3, 3, ['yes']], 'events clear': [3, 3, ['yes']],
  };
  const command = commands[key];
  if (!command || positionals.length < command[0] || positionals.length > command[1]) throw new Error('Comando ou argumentos inválidos. Consulte webhookbox --help.');
  for (const option of Object.keys(values)) if (!['data-dir', 'json', ...command[2]].includes(option)) throw new Error(`--${option} não se aplica a ${key}.`);
  const directory = dataDirectory(values['data-dir']);
  if (key === 'config') { output({ data_dir: directory, node: process.version, platform: process.platform, default_port: 3000 }, values.json); return; }
  const store = new Store(directory);
  try {
    switch (key) {
      case 'start': await runServer(store, values); break;
      case 'box create': {
        const origin = baseUrl(values['base-url']);
        const box = store.createBox(target);
        output({ ...box, url: `${origin}/hooks/${box.id}` }, values.json); break;
      }
      case 'box list': {
        const origin = baseUrl(values['base-url']);
        output(store.boxes().map(box => ({ ...box, url: `${origin}/hooks/${box.id}` })), values.json); break;
      }
      case 'box remove': confirmation(values); output({ deleted: store.removeBox(target) }, values.json); break;
      case 'events list': {
        const rows = store.list({ box: target, limit: integer(values.limit, '--limit', 50, 1, 1000), offset: integer(values.offset, '--offset', 0, 0), method: values.method, since: dateFilter(values.since) });
        if (values.json) output(rows, true);
        else output(rows.length ? rows.map(row => `${row.received_at}  ${row.method.padEnd(7)} ${row.id}  ${row.size} bytes\n  ${row.url}`).join('\n') : 'Nenhum evento encontrado.');
        break;
      }
      case 'events show': {
        const event = store.event(target);
        if (values.json) output(exportEvent(event), true);
        else {
          let body;
          try { body = new TextDecoder('utf-8', { fatal: true }).decode(event.body); }
          catch { body = `[Binário em base64]\n${event.body.toString('base64')}`; }
          try { body = JSON.stringify(JSON.parse(body), null, 2); } catch { /* Non-JSON bodies are valid. */ }
          output(`${event.id}\n${event.received_at} — ${event.method} ${event.url}\n${event.size} bytes\n\nHeaders (pares nome/valor):\n${JSON.stringify(event.headers, null, 2)}\n\nBody:\n${body}`);
        }
        break;
      }
      case 'events watch': await watch(store, target, values); break;
      case 'events replay': {
        if (!values.to) throw new Error('Informe o destino com --to URL.');
        const result = await replay(store.event(target), values.to, { timeout: integer(values.timeout, '--timeout', 10000, 1, 300000), headers: values.header, removeHeaders: values['remove-header'] });
        output(result, values.json);
        if (result.status >= 400) process.exitCode = 1;
        break;
      }
      case 'events export': {
        const event = exportEvent(store.event(target));
        if (values.output) { writeFileSync(values.output, JSON.stringify(event, null, 2) + '\n', { flag: 'wx', mode: 0o600 }); output({ saved: values.output }, values.json); }
        else output(event, true);
        break;
      }
      case 'events delete': confirmation(values); output({ deleted: store.deleteEvent(target) }, values.json); break;
      case 'events clear': confirmation(values); output({ deleted: store.clear(target) }, values.json); break;
    }
  } finally { store.close(); }
}
