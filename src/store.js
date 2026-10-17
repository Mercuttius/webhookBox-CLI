import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';

export class Store {
  constructor(directory) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(join(directory, 'webhookbox.db'), { timeout: 5000 });
    if (process.platform !== 'win32') chmodSync(join(directory, 'webhookbox.db'), 0o600);
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS boxes (id TEXT PRIMARY KEY, name TEXT UNIQUE NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS events (
        seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL,
        box_id TEXT NOT NULL REFERENCES boxes(id) ON DELETE CASCADE,
        received_at TEXT NOT NULL, method TEXT NOT NULL, url TEXT NOT NULL,
        headers TEXT NOT NULL, body BLOB NOT NULL, size INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS events_box_seq ON events(box_id, seq);
      CREATE INDEX IF NOT EXISTS events_time ON events(received_at);
      PRAGMA user_version=1;
    `);
  }
  close() { this.db.close(); }
  createBox(name) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(name || '')) throw new Error('Nome: use 1 a 64 letras, números, hífen ou sublinhado.');
    if (this.db.prepare('SELECT id FROM boxes WHERE name=?').get(name)) throw new Error('Já existe uma caixa com esse nome.');
    const box = { id: randomBytes(18).toString('hex'), name, created_at: new Date().toISOString() };
    this.db.prepare('INSERT INTO boxes VALUES (?, ?, ?)').run(box.id, box.name, box.created_at);
    return box;
  }
  boxes() { return this.db.prepare('SELECT * FROM boxes ORDER BY created_at, name').all(); }
  box(name) {
    const box = this.db.prepare('SELECT * FROM boxes WHERE name=? OR id=?').get(name, name);
    if (!box) throw new Error('Caixa não encontrada. Use: webhookbox box list');
    return box;
  }
  boxById(id) { return this.db.prepare('SELECT * FROM boxes WHERE id=?').get(id); }
  removeBox(name) { return this.db.prepare('DELETE FROM boxes WHERE id=?').run(this.box(name).id).changes; }
  save(boxId, method, url, headers, body, maxEvents = 10000) {
    const id = randomUUID();
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('INSERT INTO events(id,box_id,received_at,method,url,headers,body,size) VALUES(?,?,?,?,?,?,?,?)')
        .run(id, boxId, new Date().toISOString(), method, url, JSON.stringify(headers), body, body.length);
      this.db.prepare('DELETE FROM events WHERE seq <= (SELECT seq FROM events ORDER BY seq DESC LIMIT 1 OFFSET ?)').run(maxEvents);
      this.db.exec('COMMIT');
    } catch (error) { this.db.exec('ROLLBACK'); throw error; }
    return id;
  }
  list({ box, limit = 50, offset = 0, method, since, after, ascending = false } = {}) {
    const conditions = [], values = [];
    if (box) { conditions.push('box_id=?'); values.push(this.box(box).id); }
    if (method) { conditions.push('method=?'); values.push(method.toUpperCase()); }
    if (since) { conditions.push('received_at>=?'); values.push(since); }
    if (after !== undefined) { conditions.push('seq>?'); values.push(after); }
    return this.db.prepare(`SELECT seq,id,box_id,received_at,method,url,size FROM events
      ${conditions.length ? `WHERE ${conditions.join(' AND ')}` : ''} ORDER BY seq ${ascending ? 'ASC' : 'DESC'} LIMIT ? OFFSET ?`)
      .all(...values, limit, offset);
  }
  latestSeq() { return this.db.prepare('SELECT seq FROM sqlite_sequence WHERE name=\'events\'').get()?.seq || 0; }
  event(id) {
    const row = this.db.prepare('SELECT * FROM events WHERE id=?').get(id);
    if (!row) throw new Error('Evento não encontrado. Use o ID completo de events list.');
    return { ...row, headers: JSON.parse(row.headers), body: Buffer.from(row.body) };
  }
  deleteEvent(id) { this.event(id); return this.db.prepare('DELETE FROM events WHERE id=?').run(id).changes; }
  clear(box) { return this.db.prepare('DELETE FROM events WHERE box_id=?').run(this.box(box).id).changes; }
  prune(days) { return this.db.prepare('DELETE FROM events WHERE received_at < ?').run(new Date(Date.now() - days * 86400000).toISOString()).changes; }
}

export function exportEvent(event) {
  const { body, ...rest } = event;
  return { ...rest, body_encoding: 'base64', body: body.toString('base64') };
}
