import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { id } from '../../packages/contracts/index.js';

const now = () => new Date().toISOString();
const helperPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../packages/mcp/participant.js');
const hash = token => createHash('sha256').update(token).digest('hex');

export class ParticipantDispatcher {
  constructor(store, { adapter, privateDir = '.local/participant-dispatch', baseUrl = 'http://127.0.0.1:4317' } = {}) {
    if (!adapter) throw new Error('participant adapter is required');
    this.store = store; this.adapter = adapter; this.privateDir = resolve(privateDir); this.baseUrl = baseUrl;
    this.inflight = new Set(); this.ticking = null;
    this.store.db.exec(`CREATE TABLE IF NOT EXISTS participant_dispatches(
      delivery_id TEXT PRIMARY KEY,attempt_id TEXT NOT NULL,host_request_id TEXT NOT NULL,prompt TEXT NOT NULL,
      config_path TEXT NOT NULL,status TEXT NOT NULL,receipt_json TEXT,error TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
    )`);
    this.store.db.exec(`CREATE TABLE IF NOT EXISTS participant_recoveries(
      delivery_id TEXT PRIMARY KEY,host_request_id TEXT NOT NULL,prompt TEXT NOT NULL,status TEXT NOT NULL,receipt_json TEXT,error TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
    )`);
  }

  eligible() {
    const roomCwd = this.store.db.prepare('PRAGMA table_info(rooms)').all().some(column => column.name === 'cwd') ? ',r.cwd AS room_cwd' : '';
    return this.store.db.prepare(`SELECT d.*,m.room_id,m.body,mb.session_id,s.provider,s.cwd,b.handle,b.incarnation,b.capabilities,b.mode,b.verified_at${roomCwd},
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
      if (!existsSync(path)) {
        const replacementToken = randomBytes(32).toString('base64url');
        const replacement = this.store.provision(row.room_id, row.session_id, hash(replacementToken));
        const replacementPath = resolve(this.privateDir, `${replacement.id}.json`);
        mkdirSync(dirname(replacementPath), { recursive: true });
        writeFileSync(replacementPath, JSON.stringify({ url: this.baseUrl, token: replacementToken, registrationId: replacement.id }), { mode: 0o600 });
        return replacementPath;
      }
      return path;
    }
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ url: this.baseUrl, token, registrationId: registration.id }), { mode: 0o600 });
    return path;
  }

  prompt(row, configPath, hostRequestId) {
    const q = value => `'${String(value).replaceAll("'", "''")}'`;
    return `You are a room participant. Run exactly in PowerShell: & ${q(process.execPath)} ${q(helperPath)} --config ${q(configPath)} inbox --request-id ${q(hostRequestId)}. Then use the helper context action for room context, materials, and reactions. Reply only through authenticated room_reply: & ${q(process.execPath)} ${q(helperPath)} --config ${q(configPath)} reply ${q(hostRequestId)} --body-file <answer-file>. Room working directory: ${row.room_cwd || row.cwd}.`;
  }

  persist(row, attempt, hostRequestId, prompt, configPath) {
    const existing = this.store.db.prepare('SELECT * FROM participant_dispatches WHERE delivery_id=?').get(row.id);
    if (existing) return existing;
    const record = { delivery_id: row.id, attempt_id: attempt.id, host_request_id: hostRequestId, prompt, config_path: configPath, status: 'prepared', receipt_json: null, error: null, created_at: now(), updated_at: now() };
    this.store.db.prepare('INSERT INTO participant_dispatches VALUES(?,?,?,?,?,?,?,?,?,?)').run(...Object.values(record));
    return record;
  }

  async dispatch(row) {
    if (this.inflight.has(row.id)) return { deliveryId: row.id, state: 'inflight', message: 'delivery is already being evaluated' };
    this.inflight.add(row.id);
    try {
    const prior = this.store.db.prepare('SELECT * FROM participant_dispatches WHERE delivery_id=?').get(row.id);
    if (prior) return this.observe(row, prior);
    const readiness = await this.adapter.preflight(row, row);
    if (!readiness.ok) return { deliveryId: row.id, state: 'skipped', message: readiness.reason };
    let configPath;
    try { configPath = this.config(row); } catch (error) { return { deliveryId: row.id, state: 'skipped', message: error.message }; }
    let claim, attempt;
    try { claim = this.store.claim(row.id); attempt = this.store.fence(row.id, claim.fence); } catch (error) { return { deliveryId: row.id, state: 'skipped', message: error.message }; }
    this.store.db.prepare("UPDATE attempts SET state='automatic' WHERE id=?").run(attempt.id);
    // The delivery request UUID is also the helper's reply correlation key and
    // Orca retry key.  One durable identifier covers submission and reply.
    const hostRequestId = row.request_id;
    const prompt = this.prompt(row, configPath, hostRequestId);
    const record = this.persist(row, attempt, hostRequestId, prompt, configPath);
    return this.send(row, record);
    } finally { this.inflight.delete(row.id); }
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
    if (status === 'unknown') this.store.db.prepare("UPDATE deliveries SET state='unknown',blocked_reason=? WHERE id=? AND state NOT IN ('completed','cancelled')").run(error || 'host receipt requires reconciliation', record.delivery_id);
    return { deliveryId: row.id, state: status, message: error || (status === 'accepted' ? 'input accepted; awaiting authenticated reply' : status) };
  }

  async tick() { if (this.ticking) return this.ticking; this.ticking = (async () => { const results = []; for (const row of this.eligible()) results.push(await this.dispatch(row)); return results; })(); try { return await this.ticking; } finally { this.ticking = null; } }
  async retry(roomId, deliveryId) {
    const roomCwd = this.store.db.prepare('PRAGMA table_info(rooms)').all().some(column => column.name === 'cwd') ? ',r.cwd AS room_cwd' : '';
    const row = this.store.db.prepare(`SELECT d.*,m.room_id,m.body,mb.session_id,s.provider,s.cwd,b.handle,b.incarnation,b.capabilities,b.mode,b.verified_at${roomCwd}
      FROM deliveries d JOIN messages m ON m.id=d.message_id JOIN memberships mb ON mb.id=d.membership_id JOIN sessions s ON s.id=mb.session_id JOIN bindings b ON b.id=d.binding_id JOIN rooms r ON r.id=m.room_id WHERE d.id=? AND m.room_id=?`).get(deliveryId, roomId);
    if (!row) throw new Error('delivery not found in room');
    const record = this.store.db.prepare('SELECT * FROM participant_dispatches WHERE delivery_id=?').get(deliveryId);
    if (!record) {
      if (row.state !== 'queued') return { deliveryId, state: row.state, message: 'no durable host request to retry' };
      const eligible = this.eligible().find(candidate => candidate.id === deliveryId);
      return eligible ? this.dispatch(eligible) : { deliveryId, state: 'queued', message: 'delivery is not currently eligible for automatic input' };
    }
    if (row.state === 'completed') return { deliveryId, state: 'completed', message: 'authenticated reply already received; no duplicate send' };
    const observed = await this.observe(row, record);
    if (!['accepted', 'running'].includes(observed.state)) return observed;
    const prior = this.store.db.prepare('SELECT * FROM participant_recoveries WHERE delivery_id=?').get(deliveryId);
    if (prior) return this.recover(row, record, prior);
    const ready = await this.adapter.preflight(row, row);
    if (!ready.ok) return { ...observed, message: `original receipt observed; recovery nudge not sent: ${ready.reason}` };
    const recovery = { delivery_id: deliveryId, host_request_id: id(), prompt: `Recover the prior room request ${row.request_id}. Do not redo file edits or tool side effects. Find any prior answer and submit room_reply for the original request; if no prior result exists, say it is missing and ask the user instead of rerunning work.`, status: 'prepared', receipt_json: null, error: null, created_at: now(), updated_at: now() };
    this.store.db.prepare('INSERT INTO participant_recoveries VALUES(?,?,?,?,?,?,?,?)').run(...Object.values(recovery));
    return this.recover(row, record, recovery);
  }
  async recover(row, record, recovery) {
    try {
      const result = await this.adapter.send(row, row, recovery.prompt, recovery.host_request_id, { observeOnly: recovery.status !== 'prepared' });
      if (!result.ok) return this.recoveryRecord(row, recovery, 'unknown', result.reason, result.receipt);
      const kind = result.stage === 'turn_started' ? 'turn_started' : 'host_receipt';
      this.store.evidence(record.attempt_id, kind, 'orca-recovery', recovery.host_request_id);
      return this.recoveryRecord(row, recovery, kind === 'turn_started' ? 'running' : 'accepted', null, result.receipt);
    } catch (error) { return this.recoveryRecord(row, recovery, 'unknown', error.message, error.receipt); }
  }
  recoveryRecord(row, recovery, status, error = null, receipt = null) {
    this.store.db.prepare('UPDATE participant_recoveries SET status=?,receipt_json=?,error=?,updated_at=? WHERE delivery_id=?').run(status, receipt ? JSON.stringify(receipt) : null, error, now(), recovery.delivery_id);
    if (status === 'unknown') this.store.db.prepare("UPDATE deliveries SET state='unknown',blocked_reason=? WHERE id=? AND state NOT IN ('completed','cancelled')").run(error || 'recovery receipt requires reconciliation', row.id);
    return { deliveryId: row.id, state: status, message: error || 'recovery nudge submitted; awaiting authenticated reply' };
  }
}
