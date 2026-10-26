import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, parse, resolve, win32 } from 'node:path';

const DEFAULT_ROOT = 'D:\\inter_session_debate';
const now = () => new Date().toISOString();
const json = value => JSON.stringify(value || []);
const parseJson = value => Array.isArray(value) ? value : value ? JSON.parse(value) : [];
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const cleanText = (value, name, max = 16000) => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw Error(`${name} is required`);
  return value.trim();
};
const safePart = value => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/.test(value) || value === '.' || value === '..') throw Error('unsafe export identifier');
  return value;
};
const safeFile = value => String(value || 'item').replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80) || 'item';

export class KnowledgeStore {
  constructor(store, { defaultRoot = process.env.ROOMS_KNOWLEDGE_ROOT || DEFAULT_ROOT } = {}) {
    if (!store?.db || typeof store.tx !== 'function' || typeof store.room !== 'function') throw Error('Store is required');
    this.store = store;
    this.db = store.db;
    this.defaultRoot = defaultRoot;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS knowledge_settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS knowledge_items(
        id TEXT PRIMARY KEY,room_id TEXT NOT NULL REFERENCES rooms(id),channel_id TEXT,
        kind TEXT NOT NULL,title TEXT NOT NULL,body TEXT NOT NULL,status TEXT NOT NULL,
        scope TEXT NOT NULL,links TEXT NOT NULL,citations TEXT NOT NULL,provenance TEXT NOT NULL,
        payload_hash TEXT NOT NULL,client_key TEXT,revision INTEGER NOT NULL,change_revision INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
        UNIQUE(room_id,client_key)
      );
      CREATE TABLE IF NOT EXISTS knowledge_revisions(
        item_id TEXT NOT NULL REFERENCES knowledge_items(id),revision INTEGER NOT NULL,
        kind TEXT NOT NULL,title TEXT NOT NULL,body TEXT NOT NULL,status TEXT NOT NULL,scope TEXT NOT NULL,
        links TEXT NOT NULL,citations TEXT NOT NULL,provenance TEXT NOT NULL,payload_hash TEXT NOT NULL,created_at TEXT NOT NULL,
        PRIMARY KEY(item_id,revision)
      );
      CREATE TABLE IF NOT EXISTS knowledge_clock(id INTEGER PRIMARY KEY CHECK(id=1),revision INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS knowledge_items_room_revision ON knowledge_items(room_id,revision);
      CREATE INDEX IF NOT EXISTS knowledge_items_channel_status ON knowledge_items(channel_id,status);
    `);
    try { this.db.exec('ALTER TABLE knowledge_items ADD COLUMN change_revision INTEGER NOT NULL DEFAULT 0'); } catch {}
    this.db.prepare('INSERT INTO knowledge_clock(id,revision) VALUES(1,0) ON CONFLICT(id) DO NOTHING').run();
    if (!this.db.prepare("SELECT 1 FROM knowledge_settings WHERE key='storageRoot'").get()) {
      this.db.prepare("INSERT INTO knowledge_settings(key,value) VALUES('storageRoot',?)").run(defaultRoot);
    }
  }

  getSettings() { return { storageRoot: this.db.prepare("SELECT value FROM knowledge_settings WHERE key='storageRoot'").get()?.value || this.defaultRoot }; }
  setSettings({ storageRoot }) {
    const root = this.validateRoot(storageRoot, true);
    return this.store.tx(() => {
      this.db.prepare("INSERT INTO knowledge_settings(key,value) VALUES('storageRoot',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(root);
      this.exportAll(root);
      return { storageRoot: root };
    });
  }

  validateRoot(value, create = false) {
    if (typeof value !== 'string' || !value.trim()) throw Error('storageRoot is required');
    const root = value.trim();
    if (!(isAbsolute(root) || win32.isAbsolute(root))) throw Error('storageRoot must be absolute');
    const parsed = (win32.isAbsolute(root) ? win32 : { parse, resolve }).parse(root);
    if (parsed.root === root || parsed.root === `${root}\\`) throw Error('storageRoot must not be a filesystem root');
    if (existsSync(root)) {
      const stat = lstatSync(root);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw Error('storageRoot must be a real directory');
    } else if (create) mkdirSync(root, { recursive: true });
    return root;
  }

  roomInfo(roomId) {
    const room = this.db.prepare('SELECT id,channel_id FROM rooms WHERE id=?').get(roomId);
    if (!room) throw Error('room not found');
    return room;
  }
  registrationFor(roomId, registration, write = false) {
    const room = this.roomInfo(roomId);
    if (!registration) return room;
    if (registration.room_id !== roomId) throw Error('registration is outside this room');
    if (write && registration.read_only) throw Error('read-only membership is view-only');
    const member = this.db.prepare('SELECT 1 FROM memberships WHERE id=? AND room_id=? AND session_id=? AND left_at IS NULL').get(registration.membership_id, roomId, registration.session_id);
    if (!member) throw Error('active room membership required');
    return room;
  }
  visibleWhere(room) {
    return { sql: `(room_id=? OR (channel_id IS NOT NULL AND channel_id=? AND status='published'))`, args: [room.id, room.channel_id] };
  }
  nextChangeRevision() {
    this.db.prepare('UPDATE knowledge_clock SET revision=revision+1 WHERE id=1').run();
    return this.db.prepare('SELECT revision FROM knowledge_clock WHERE id=1').get().revision;
  }
  normalize(row) {
    if (!row) return null;
    return { id: row.id, kind: row.kind, title: row.title, body: row.body, status: row.status, scope: row.scope, revision: row.revision, changeRevision: row.change_revision, sourceRoomId: row.room_id, channelId: row.channel_id, links: parseJson(row.links), citations: parseJson(row.citations), provenance: parseJson(row.provenance), hash: row.payload_hash, createdAt: row.created_at, updatedAt: row.updated_at };
  }
  payload(input, room) {
    const kind = cleanText(input.kind || 'note', 'kind', 80);
    const title = cleanText(input.title, 'title', 240);
    const body = cleanText(input.body, 'body');
    const scope = input.scope || 'room';
    if (!['room', 'channel'].includes(scope)) throw Error('invalid knowledge scope');
    if (scope === 'channel' && !room.channel_id) throw Error('unassigned room has no channel knowledge scope');
    const status = input.status || 'draft';
    if (!['draft', 'published', 'archived'].includes(status)) throw Error('invalid knowledge status');
    for (const [name, value] of [['links', input.links], ['citations', input.citations], ['provenance', input.provenance]]) if (value !== undefined && !Array.isArray(value)) throw Error(`${name} must be an array`);
    const links = input.links || input.sourceIds || [];
    if (links.some(value => typeof value !== 'string' || !value)) throw Error('invalid source IDs');
    const citations = input.citations || [];
    const provenance = input.provenance || [];
    return { kind, title, body, scope, status, links, citations, provenance, payload_hash: digest({ kind, title, body, scope, status, links, citations, provenance }) };
  }
  assertReferences(room, references) {
    const ids = [...new Set(references)];
    if (ids.length > 100) throw Error('too many source IDs');
    const where = this.visibleWhere(room);
    for (const itemId of ids) {
      const row = this.db.prepare(`SELECT id FROM knowledge_items WHERE id=? AND ${where.sql}`).get(itemId, ...where.args);
      if (!row) throw Error('source is outside visible knowledge');
    }
  }
  list(roomId, { scope = 'all', query = '', kind = '', since = 0 } = {}, registration = null) {
    const room = this.registrationFor(roomId, registration);
    if (!['all', 'room', 'channel'].includes(scope)) throw Error('invalid knowledge scope');
    if (typeof query !== 'string' || typeof kind !== 'string' || !Number.isInteger(Number(since)) || Number(since) < 0) throw Error('invalid knowledge filter');
    const where = this.visibleWhere(room);
    const clauses = [where.sql]; const args = [...where.args];
    if (scope === 'room') { clauses.push('room_id=?'); args.push(room.id); }
    if (scope === 'channel') { clauses.push("channel_id=? AND status='published'"); args.push(room.channel_id || '__none__'); }
    if (kind) { clauses.push('kind=?'); args.push(kind); }
    if (query.trim()) { clauses.push('(title LIKE ? OR body LIKE ?)'); const q = `%${query.trim()}%`; args.push(q, q); }
    if (Number(since)) { clauses.push('change_revision>?'); args.push(Number(since)); }
    const rows = this.db.prepare(`SELECT * FROM knowledge_items WHERE ${clauses.join(' AND ')} ORDER BY updated_at DESC,rowid DESC`).all(...args);
    const revision = this.db.prepare('SELECT revision n FROM knowledge_clock WHERE id=1').get().n;
    return { items: rows.map(row => this.normalize(row)), revision };
  }
  read(roomId, itemId, revision = null, registration = null) {
    const room = this.registrationFor(roomId, registration);
    if (typeof itemId !== 'string' || !itemId) throw Error('item ID is required');
    const where = this.visibleWhere(room);
    const item = this.db.prepare(`SELECT * FROM knowledge_items WHERE id=? AND ${where.sql}`).get(itemId, ...where.args);
    if (!item) throw Error('knowledge item is outside visible scope');
    if (revision === null || revision === undefined) return this.normalize(item);
    if (!Number.isInteger(revision) || revision < 1) throw Error('invalid knowledge revision');
    const old = this.db.prepare('SELECT * FROM knowledge_revisions WHERE item_id=? AND revision=?').get(itemId, revision);
    if (!old) throw Error('knowledge revision not found');
    return this.normalize({ ...item, ...old, id: item.id, room_id: item.room_id, channel_id: item.channel_id, revision: old.revision, updated_at: old.created_at });
  }
  add(roomId, input, registration = null) {
    const room = this.registrationFor(roomId, registration, true);
    if (!input || typeof input !== 'object') throw Error('knowledge input is required');
    if (input.clientKey !== undefined && (typeof input.clientKey !== 'string' || !input.clientKey || input.clientKey.length > 160)) throw Error('invalid clientKey');
    const p = this.payload(input, room); this.assertReferences(room, p.links);
    return this.store.tx(() => {
      if (input.clientKey) {
        const old = this.db.prepare('SELECT * FROM knowledge_items WHERE room_id=? AND client_key=?').get(roomId, input.clientKey);
        if (old) { if (old.payload_hash !== p.payload_hash) { const e = Error('knowledge idempotency conflict'); e.code = 'CONFLICT'; throw e; } return this.normalize(old); }
      }
      const row = { id: randomUUID(), room_id: roomId, channel_id: room.channel_id, ...p, client_key: input.clientKey || null, revision: 1, change_revision: this.nextChangeRevision(), created_at: now(), updated_at: now() };
      this.db.prepare('INSERT INTO knowledge_items(id,room_id,channel_id,kind,title,body,status,scope,links,citations,provenance,payload_hash,client_key,revision,change_revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').run(row.id,row.room_id,row.channel_id,row.kind,row.title,row.body,row.status,row.scope,json(row.links),json(row.citations),json(row.provenance),row.payload_hash,row.client_key,row.revision,row.change_revision,row.created_at,row.updated_at);
      this.db.prepare('INSERT INTO knowledge_revisions VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(row.id,1,row.kind,row.title,row.body,row.status,row.scope,json(row.links),json(row.citations),json(row.provenance),row.payload_hash,row.created_at);
      return this.normalize(row);
    });
  }
  update(roomId, itemId, input, registration = null) {
    const room = this.registrationFor(roomId, registration, true);
    const current = this.read(roomId, itemId, null, registration);
    if (current.sourceRoomId !== roomId) throw Error('only the source room may update knowledge');
    const p = this.payload({ ...current, ...input, links: input?.links ?? input?.sourceIds ?? current.links, citations: input?.citations ?? current.citations, provenance: input?.provenance ?? current.provenance }, room);
    this.assertReferences(room, p.links);
    return this.store.tx(() => {
      const revision = current.revision + 1, changeRevision = this.nextChangeRevision(), updatedAt = now();
      this.db.prepare('UPDATE knowledge_items SET kind=?,title=?,body=?,status=?,scope=?,links=?,citations=?,provenance=?,payload_hash=?,revision=?,change_revision=?,updated_at=? WHERE id=?').run(p.kind,p.title,p.body,p.status,p.scope,json(p.links),json(p.citations),json(p.provenance),p.payload_hash,revision,changeRevision,updatedAt,itemId);
      this.db.prepare('INSERT INTO knowledge_revisions VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(itemId,revision,p.kind,p.title,p.body,p.status,p.scope,json(p.links),json(p.citations),json(p.provenance),p.payload_hash,updatedAt);
      return this.read(roomId,itemId,null,registration);
    });
  }
  publish(roomId, itemId, registration = null) { return this.update(roomId, itemId, { status: 'published' }, registration); }
  export(roomId) {
    this.roomInfo(roomId);
    const root = this.validateRoot(this.getSettings().storageRoot, true);
    return this.exportRoom(root, roomId);
  }
  exportAll(root) { for (const room of this.db.prepare('SELECT id FROM rooms').all()) this.exportRoom(root, room.id); }
  exportRoom(root, roomId) {
    const room = this.roomInfo(roomId), items = this.list(roomId).items.filter(item => item.sourceRoomId === roomId);
    const base = room.channel_id ? join(root, 'channels', safePart(room.channel_id), 'rooms', safePart(roomId)) : join(root, 'rooms', safePart(roomId));
    mkdirSync(join(base, 'materials'), { recursive: true });
    const materialFiles = [];
    for (const item of items) {
      const name = `${safeFile(item.id)}-${safeFile(item.title)}.md`, file = join(base, 'materials', name);
      const text = `# ${item.title}\n\n- id: ${item.id}\n- kind: ${item.kind}\n- status: ${item.status}\n- scope: ${item.scope}\n- revision: ${item.revision}\n- hash: ${item.hash}\n\n${item.body}\n\n## Links\n${item.links.map(x => `- ${x}`).join('\n') || '- none'}\n`;
      writeFileSync(file, text, 'utf8'); materialFiles.push({ id: item.id, revision: item.revision, hash: item.hash, file: `materials/${name}` });
    }
    const index = `# Knowledge: ${roomId}\n\n${items.map(item => `- [${item.title}](materials/${safeFile(item.id)}-${safeFile(item.title)}.md) (${item.kind}, r${item.revision}, ${item.status})`).join('\n') || '_No knowledge items._'}\n`;
    writeFileSync(join(base, 'index.md'), index, 'utf8');
    writeFileSync(join(base, 'manifest.json'), JSON.stringify({ roomId, channelId: room.channel_id, generatedAt: now(), materials: materialFiles }, null, 2) + '\n', 'utf8');
    if (room.channel_id) {
      const channelBase = join(root, 'channels', safePart(room.channel_id));
      mkdirSync(channelBase, { recursive: true });
      const rooms = this.db.prepare('SELECT id FROM rooms WHERE channel_id=? ORDER BY created_at').all(room.channel_id);
      writeFileSync(join(channelBase, 'index.md'), `# Channel knowledge: ${room.channel_id}\n\n${rooms.map(value => `- [${value.id}](rooms/${value.id}/index.md)`).join('\n') || '_No rooms._'}\n`, 'utf8');
    }
    return { root, roomId, directory: base, files: ['index.md', 'manifest.json', ...materialFiles.map(x => x.file)] };
  }
}
