import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

export function dataDirectory(override) {
  if (override || process.env.WEBHOOKBOX_DATA_DIR) return resolve(override || process.env.WEBHOOKBOX_DATA_DIR);
  if (process.platform === 'win32') return join(process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local'), 'WebhookBox');
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support', 'WebhookBox');
  return join(process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share'), 'webhookbox');
}

export function integer(value, name, fallback, min = 1, max = Number.MAX_SAFE_INTEGER) {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(String(value)) || !Number.isSafeInteger(Number(value)) || Number(value) < min || Number(value) > max) {
    throw new Error(`${name} deve ser um inteiro entre ${min} e ${max}.`);
  }
  return Number(value);
}

// Never render terminal control sequences received from untrusted HTTP input.
export function safe(value) {
  return String(value).replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

export function dateFilter(value) {
  if (!value) return undefined;
  if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) || Number.isNaN(Date.parse(value))) {
    throw new Error('Use uma data ISO com fuso, por exemplo 2026-10-17T00:00:00Z.');
  }
  return new Date(value).toISOString();
}
