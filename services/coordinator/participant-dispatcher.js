import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const now = () => new Date().toISOString();
const helperPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../packages/mcp/participant.js');
const hash = token => createHash('sha256').update(token).digest('hex');

export class ParticipantDispatcher {
  constructor(store, { adapter, privateDir = '.local/participant-dispatch', baseUrl = 'http://127.0.0.1:4317' } = {}) {
    if (!adapter) throw new Error('participant adapter is required');
    this.store = store; this.adapter = adapter; this.privateDir = resolve(privateDir); this.baseUrl = baseUrl;
    this.store.db.exec(`CREATE TABLE IF NOT EXISTS participant_dispatches(
      delivery_id TEXT PRIMARY KEY,attempt_id TEXT NOT NULL,host_request_id TEXT NOT NULL,prompt TEXT NOT NULL,
      config_path TEXT NOT NULL,status TEXT NOT NULL,receipt_json TEXT,error TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
    )`);
  }

  eligible() {
    return this.store.db.prepare(`SELECT d.*,m.room_id,m.body,mb.session_id,s.provider,s.cwd,b.handle,b.incarnation,b.capabilities,b.mode,b.verified_at,
      mb.role,mb.read_only,r.archived_at,r.paused_at
      FROM deliveries d JOIN messages m ON m.id=d.message_id JOIN memberships mb ON mb.id=d.membership_id
      JOIN sessions s ON s.id=mb.session_id JOIN bindings b ON b.id=d.binding_id JOIN rooms r ON r.id=m.room_id
      WHERE d.state='queued' AND d.kind IN ('followup','steer') AND mb.left_at IS NULL AND mb.read_only=0
      AND mb.role<>'chair' AND r.archived_at IS NULL AND r.paused_at IS NULL AND b.active=1`).all()
      .filter(row => { try { return !!JSON.parse(row.capabilities || '{}').automaticInput; } catch { return false; } });
  }

  config(row) {
    const existing = this.store.db.prepare('SELECT * FROM registrations WHERE room_id=? AND session_id=? AND revoked_at IS NULL ORDER BY created_at DESC LIMIT 1').get(row.room_id, row.session_id);
    const token = existing ? null : randomBytes(32).toString('base64url');
    const registration = existing || this.store.provision(row.room_id, row.session_id, hash(token));
    const path = resolve(this.privateDir, `${registration.id}.json`);
    if (existing) {
      if (!existsSync(path)) throw new Error('registration token config is unavailable; re-provision explicitly');
      return path;
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ baseUrl: this.baseUrl, token, registrationId: registration.id }), { mode: 0o600 });
    return path;
  }

  prompt(row, configPath, hostRequestId) {
    return `You are a room participant. Run exactly: ${JSON.stringify(process.execPath)} ${JSON.stringify(helperPath)} --config ${JSON.stringify(configPath)} inbox --request-id ${JSON.stringify(hostRequestId)}. Read the addressed room context, materials, and reactions; reply only through authenticated room_reply using request ID ${hostRequestId}. Room working directory: ${row.cwd}.`;
  }

  persist(row, attempt, hostRequestId, prompt, configPath) {
    const existing = this.store.db.prepare('SELECT * FROM participant_dispatches WHERE delivery_id=?').get(row.id);
    if (existing) return existing;
    const record = { delivery_id: row.id, attempt_id: attempt.id, host_request_id: hostRequestId, prompt, config_path: configPath, status: 'prepared', receipt_json: null, error: null, created_at: now(), updated_at: now() };
    this.store.db.prepare('INSERT INTO participant_dispatches VALUES(?,?,?,?,?,?,?,?,?,?)').run(...Object.values(record));
    return record;
  }

  async dispatch(row) {
    const prior = this.store.db.prepare('SELECT * FROM participant_dispatches WHERE delivery_id=?').get(row.id);
    if (prior) return this.observe(row, prior);
    const readiness = await this.adapter.preflight(row, row);
    if (!readiness.ok) return { deliveryId: row.id, state: 'skipped', message: readiness.reason };
    let claim, attempt;
    try { claim = this.store.claim(row.id); attempt = this.store.fence(row.id, claim.fence); } catch (error) { return { deliveryId: row.id, state: 'skipped', message: error.message }; }
    this.store.db.prepare("UPDATE attempts SET state='automatic' WHERE id=?").run(attempt.id);
    // The delivery request UUID is also the helper's reply correlation key and
    // Orca retry key.  One durable identifier covers submission and reply.
    const hostRequestId = row.request_id;
    const configPath = this.config(row);
    const prompt = this.prompt(row, configPath, hostRequestId);
    const record = this.persist(row, attempt, hostRequestId, prompt, configPath);
    return this.send(row, record);
  }

  async send(row, record) {
    try {
      const result = await this.adapter.send(row, row, record.prompt, record.host_request_id);
      if (!result.ok) return this.record(row, record, 'blocked', result.reason, result.receipt);
      const kind = result.stage === 'turn_started' ? 'turn_started' : 'host_receipt';
      this.store.evidence(record.attempt_id, kind, 'orca', record.host_request_id);
      return this.record(row, record, kind === 'turn_started' ? 'running' : 'accepted', null, result.receipt);
    } catch (error) { return this.record(row, record, 'unknown', error.message, error.receipt); }
  }

  async observe(row, record) {
    try {
      const result = await this.adapter.send(row, row, record.prompt, record.host_request_id, { observeOnly: true });
      if (!result.ok) return this.record(row, record, 'unknown', result.reason, result.receipt);
      const kind = result.stage === 'turn_started' ? 'turn_started' : 'host_receipt';
      this.store.evidence(record.attempt_id, kind, 'orca', record.host_request_id);
      return this.record(row, record, kind === 'turn_started' ? 'running' : 'accepted', null, result.receipt);
    } catch (error) { return this.record(row, record, 'unknown', error.message, error.receipt); }
  }

  record(row, record, status, error = null, receipt = null) {
    this.store.db.prepare('UPDATE participant_dispatches SET status=?,receipt_json=?,error=?,updated_at=? WHERE delivery_id=?').run(status, receipt ? JSON.stringify(receipt) : null, error, now(), record.delivery_id);
    return { deliveryId: row.id, state: status, message: error || (status === 'accepted' ? 'input accepted; awaiting authenticated reply' : status) };
  }

  async tick() { const results = []; for (const row of this.eligible()) results.push(await this.dispatch(row)); return results; }
  async retry(roomId, deliveryId) {
    const row = this.store.db.prepare(`SELECT d.*,m.room_id,m.body,mb.session_id,s.provider,s.cwd,b.handle,b.incarnation,b.capabilities,b.mode,b.verified_at
      FROM deliveries d JOIN messages m ON m.id=d.message_id JOIN memberships mb ON mb.id=d.membership_id JOIN sessions s ON s.id=mb.session_id JOIN bindings b ON b.id=d.binding_id WHERE d.id=? AND m.room_id=?`).get(deliveryId, roomId);
    if (!row) throw new Error('delivery not found in room');
    const record = this.store.db.prepare('SELECT * FROM participant_dispatches WHERE delivery_id=?').get(deliveryId);
    if (!record) return row.state === 'queued' ? { deliveryId, state: 'queued', message: 'queued for automatic delivery' } : { deliveryId, state: row.state, message: 'no durable host request to retry' };
    if (row.state === 'completed') return { deliveryId, state: 'completed', message: 'authenticated reply already received; no duplicate send' };
    return this.observe(row, record);
  }
}
