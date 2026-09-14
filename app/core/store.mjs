import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync } from 'node:fs';
import { dirname } from 'node:path';

/** Single writer lives in the utility process. SQLite WAL + transactions preserve prior facts. */
export class Store {
  constructor(path = ':memory:') {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    if (this.db.prepare('PRAGMA user_version').get().user_version > 1) { this.db.close(); throw new Error('数据库由较新版本创建，请勿使用旧版打开'); }
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=3000;
      CREATE TABLE IF NOT EXISTS entities(kind TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(kind,id));
      CREATE TABLE IF NOT EXISTS snapshots(id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS assignments(net TEXT NOT NULL, ip TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(net,ip));
      CREATE TABLE IF NOT EXISTS observations(net TEXT NOT NULL, ip TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(net,ip));
      CREATE TABLE IF NOT EXISTS events(id INTEGER PRIMARY KEY, at TEXT NOT NULL, type TEXT NOT NULL, detail TEXT NOT NULL);
      PRAGMA user_version=1;`);
    if (path !== ':memory:') { try { chmodSync(path, 0o600); } catch {} }
    for (const job of this.all('job').filter(j => j.status === 'running')) this.put('job', { ...job, status: 'interrupted', message: '上次程序退出，任务已中断', ended: new Date().toISOString() });
  }
  all(kind) { return this.db.prepare('SELECT data FROM entities WHERE kind=? ORDER BY rowid').all(kind).map(r => JSON.parse(r.data)); }
  get(kind, id) { const row = this.db.prepare('SELECT data FROM entities WHERE kind=? AND id=?').get(kind, id); return row ? JSON.parse(row.data) : null; }
  put(kind, obj) { this.db.prepare('INSERT INTO entities VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET data=excluded.data').run(kind, obj.id, JSON.stringify(obj)); return obj; }
  remove(kind, id) { this.db.prepare('DELETE FROM entities WHERE kind=? AND id=?').run(kind, id); }
  snapshot(id, data) {
    if (data !== undefined) this.db.prepare('INSERT INTO snapshots VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data').run(id, JSON.stringify(data));
    const row = this.db.prepare('SELECT data FROM snapshots WHERE id=?').get(id); return row ? JSON.parse(row.data) : null;
  }
  addresses(table, net) {
    if (!['assignments', 'observations'].includes(table)) throw new Error('Invalid table');
    return this.db.prepare(`SELECT ip,data FROM ${table} WHERE net=?`).all(net).map(r => ({ ip: r.ip, ...JSON.parse(r.data) }));
  }
  address(table, net, ip, data) {
    if (!['assignments', 'observations'].includes(table)) throw new Error('Invalid table');
    this.db.prepare(`INSERT INTO ${table} VALUES(?,?,?) ON CONFLICT(net,ip) DO UPDATE SET data=excluded.data`).run(net, ip, JSON.stringify(data));
  }
  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try { const result = fn(); this.db.exec('COMMIT'); return result; } catch (e) { this.db.exec('ROLLBACK'); throw e; }
  }
  event(type, detail) {
    this.db.prepare('INSERT INTO events(at,type,detail) VALUES(?,?,?)').run(new Date().toISOString(), type, detail);
    this.db.exec('DELETE FROM events WHERE id NOT IN (SELECT id FROM events ORDER BY id DESC LIMIT 10000)');
  }
  history() { return this.db.prepare('SELECT * FROM events ORDER BY id DESC LIMIT 300').all(); }
  deleteDevice(id) { this.remove('device', id); this.db.prepare('DELETE FROM snapshots WHERE id=?').run(id); }
  deleteSubnet(id) { this.remove('subnet', id); for (const t of ['assignments', 'observations']) this.db.prepare(`DELETE FROM ${t} WHERE net=?`).run(id); }
  close() { this.db.close(); }
}
