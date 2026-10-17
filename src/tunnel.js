import { spawn } from 'node:child_process';

export function startTunnel(port, { executable = 'cloudflared', timeout = 30000, onExit = () => {} } = {}) {
  const child = spawn(executable, ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${port}`], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let stopping = false;
  const stop = async () => {
    stopping = true;
    if (child.exitCode !== null || child.signalCode !== null) return;
    await new Promise(resolve => {
      const force = setTimeout(() => child.kill('SIGKILL'), 2000);
      child.once('close', () => { clearTimeout(force); resolve(); });
      child.kill();
    });
  };
  const ready = new Promise((resolve, reject) => {
    let log = '', settled = false;
    const timer = setTimeout(() => { reject(new Error('O túnel não forneceu uma URL em 30 segundos. Confira a conexão e a configuração do cloudflared.')); void stop(); }, timeout);
    const read = chunk => {
      log = (log + chunk.toString()).slice(-8192);
      const match = /https:\/\/[a-z0-9-]+\.trycloudflare\.com\b/.exec(log);
      if (match && !settled) { settled = true; clearTimeout(timer); resolve(match[0]); }
    };
    child.stdout.on('data', read);
    child.stderr.on('data', read);
    child.once('error', error => { clearTimeout(timer); reject(new Error(error.code === 'ENOENT' ? 'cloudflared não encontrado. Instale-o para usar --public; consulte o README.' : error.message)); });
    child.once('close', code => {
      clearTimeout(timer);
      if (!settled) reject(new Error(`O túnel encerrou antes de abrir (código ${code}). Confira cloudflared e possíveis arquivos config.yaml/config.yml.`));
      else if (!stopping) onExit(code);
    });
  });
  return { ready, stop };
}
