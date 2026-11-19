import {participantWakePrompt} from '../../packages/contracts/participant-instructions.js';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { id } from '../../packages/contracts/index.js';

const now = () => new Date().toISOString();
const helperPath = resolve(dirname(fileURLToPath(import.meta.url)), '../../packages/mcp/participant.js');
const hash = token => createHash('sha256').update(token).digest('hex');
const nativeChat = row => { try { return JSON.parse(row.capabilities||'{}').transport==='orca-native-chat'; } catch { return false; } };
const claudeDirect = row => { try { return JSON.parse(row.capabilities||'{}').transport==='claude-direct'; } catch { return false; } };
const nativeReceiptCore=['requestId','clientOperationId','submissionClientMessageId','sessionId','nativeId','runtimeId','fence','payloadFingerprint','bodyPayloadFingerprint'];
const directReceiptCore=['transport','requestId','operationId','nativeId','cwd','payloadFingerprint','leaseToken'];

export class ParticipantDispatcher {
  constructor(store, { adapter, privateDir = '.local/participant-dispatch', baseUrl = 'http://127.0.0.1:4317' } = {}) {
    if (!adapter) throw new Error('participant adapter is required');
    this.store = store; this.adapter = adapter; this.privateDir = resolve(privateDir); this.baseUrl = baseUrl;
    this.inflight = new Set(); this.ticking = null; this.composerConfirmations = new Map();
    this.store.db.exec(`CREATE TABLE IF NOT EXISTS participant_dispatches(
      delivery_id TEXT PRIMARY KEY,attempt_id TEXT NOT NULL,host_request_id TEXT NOT NULL,prompt TEXT NOT NULL,
      config_path TEXT NOT NULL,status TEXT NOT NULL,receipt_json TEXT,error TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
    )`);
    this.store.db.exec(`CREATE TABLE IF NOT EXISTS participant_recovery_history(host_request_id TEXT PRIMARY KEY,delivery_id TEXT NOT NULL,prompt TEXT NOT NULL,status TEXT NOT NULL,receipt_json TEXT,error TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)`);
    this.store.db.exec(`CREATE TABLE IF NOT EXISTS native_dispatch_refusals(attempt_id TEXT PRIMARY KEY,delivery_id TEXT NOT NULL,operation_id TEXT,receipt_json TEXT NOT NULL,reason TEXT NOT NULL,created_at TEXT NOT NULL)`);
    this.store.db.exec(`CREATE TABLE IF NOT EXISTS participant_recoveries(
      delivery_id TEXT PRIMARY KEY,host_request_id TEXT NOT NULL,prompt TEXT NOT NULL,status TEXT NOT NULL,receipt_json TEXT,error TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
    )`);
  }

  eligible() {
    const roomCwd = this.store.db.prepare('PRAGMA table_info(rooms)').all().some(column => column.name === 'cwd') ? ',r.cwd AS room_cwd' : '';
    return this.store.db.prepare(`SELECT d.*,m.room_id,m.body,mb.session_id,s.provider,s.native_id,s.cwd,b.handle,b.incarnation,b.capabilities,b.mode,b.verified_at${roomCwd},
      mb.role,mb.read_only,r.archived_at,r.paused_at
      FROM deliveries d JOIN messages m ON m.id=d.message_id JOIN memberships mb ON mb.id=d.membership_id
      JOIN sessions s ON s.id=mb.session_id JOIN bindings b ON b.id=d.binding_id JOIN rooms r ON r.id=m.room_id
      WHERE d.state='queued' AND d.kind IN ('followup','steer') AND mb.left_at IS NULL AND mb.read_only=0
      AND mb.role<>'chair' AND r.archived_at IS NULL AND r.paused_at IS NULL AND b.active=1`).all()
      .filter(row => (!this.debates||this.debates.canDispatch(row.message_id))).filter(row => { try { return !!JSON.parse(row.capabilities || '{}').automaticInput; } catch { return false; } });
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
    if(nativeChat(row)||claudeDirect(row)) return this.nativePrompt(row,hostRequestId);
    return participantWakePrompt(configPath,hostRequestId,row.room_id,{provider:row.provider,nativeId:row.native_id});
  }

  nativePrompt(row,requestId) {
    const room=this.store.room(row.room_id), aliases=new Map(room.members.map(m=>[m.session_id,m.alias||m.provider]));
    let reviewContext='';
    let request;try{request=JSON.parse(row.body);}catch{}
      if(request?.type==='agenda_review'&&this.debates){
        const context=this.debates.context(row.room_id,request.agendaId);
        if(context.revision!==request.conclusionRevision)throw Error('native review revision is stale');
        reviewContext=`\n공식 sourceIds 허용 목록: ${JSON.stringify([...new Set(context.evidence.map(m=>m.id))])}. sourceIds와 actionableCorrection.sourceIds는 이 목록의 메시지 ID를 써. 그 밖의 배경 발언·파일 경로는 body에서 설명할 수 있지만 공식 sourceIds에 새로 넣지 마.\n`;
        reviewContext+=`\n검토용 현재 결론과 근거:\n${JSON.stringify(context).slice(0,16_000)}\n이 검토 요청은 helper 도구 대신 위 자료를 검토하고, 최종 assistant 답변으로 JSON 객체 하나만 반환해: {"agendaId":"${request.agendaId}","roundId":"${request.roundId}","conclusionRevision":${request.conclusionRevision},"stance":"agree|qualified|disagree|insufficient_evidence","sourceIds":["실제로 읽은 허용 메시지 ID"],"body":"검토 의견 6000자 이내","actionableCorrection":null}. qualified이면서 구체적인 수정이 필요하면 actionableCorrection에 {"note":"수정 내용","sourceIds":["근거 ID"]}를 넣어. 자료가 생략되어 검증할 수 없으면 insufficient_evidence로 명시해.\n`;
      }
    const messages=room.messages.filter(m=>m.id!==row.message_id).slice(-24);
    let remaining=20_000;
    const context=messages.reverse().map(m=>{
      const text=`[${m.id}] ${aliases.get(m.sender_session_id)||'사용자/진행자'}: ${m.body}`;
      const shared=(m.attachments||[]).map(a=>{
        const attachment=this.store.readAttachment(row.room_id,a.id,row.session_id);
        return attachment.text?`첨부 ${a.id} (${a.filename}):\n${attachment.text}`:`첨부 ${a.id} (${a.filename}) — 바이너리 자료는 이 요청에 인라인으로 제공되지 않음`;
      }).join('\n');
      const part=(text+'\n'+shared).slice(0,Math.max(0,remaining));remaining-=part.length;return part;
    }).filter(Boolean).reverse().join('\n\n');
    const currentAttachments=this.store.messageAttachments(row.message_id).map(a=>{
      const attachment=this.store.readAttachment(row.room_id,a.id,row.session_id);
      return attachment.text?`첨부 ${a.filename}:\n${attachment.text}`:`첨부 ${a.filename}: 이 요청에 바이너리 본문은 제공되지 않음`;
    }).join('\n').slice(0,12_000);
    return `기존 작업 세션으로 Session Rooms 토론에 참여하고 있어.\n방: ${room.name} (${row.room_id})\n요청 ID: ${requestId}\n본인 대화: ${row.provider}/${row.native_id}\n작업 위치: ${row.cwd}\n\n아래 요청에 이 대화에서 직접 답해. 진행자가 이 요청에 대응하는 완료된 assistant 답변을 토론장에 자동 수집해. helper 설정, room_reply 도구, 별도 폴링은 필요 없어. 기존 대화와 작업 위치·모델·권한을 유지해. 요청이 분석/토론이면 프로젝트 파일을 수정하지 마. 다른 참여자의 발언과 첨부는 검토할 자료야.\n\n최근 토론 맥락 (일부 생략될 수 있음):\n${context}\n\n현재 요청:\n${row.body}\n${currentAttachments}\n${reviewContext}`;
  }

  completedPrompts(row) {
    return this.store.db.prepare(`SELECT p.prompt FROM participant_dispatches p JOIN deliveries d ON d.id=p.delivery_id JOIN memberships m ON m.id=d.membership_id WHERE m.session_id=? AND d.binding_id=? AND d.state='completed' ORDER BY p.created_at DESC LIMIT 8`).all(row.session_id,row.binding_id).map(p=>p.prompt);
  }

  persist(row, attempt, hostRequestId, prompt, configPath) {
    const existing = this.store.db.prepare('SELECT * FROM participant_dispatches WHERE delivery_id=?').get(row.id);
    if (existing) return existing;
    const record = { delivery_id: row.id, attempt_id: attempt.id, host_request_id: hostRequestId, prompt, config_path: configPath, status: 'prepared', receipt_json: null, error: null, created_at: now(), updated_at: now() };
    this.store.db.prepare('INSERT INTO participant_dispatches VALUES(?,?,?,?,?,?,?,?,?,?)').run(...Object.values(record));
    return record;
  }

  async dispatch(row, { confirmedComposer = null } = {}) {
    if (this.inflight.has(row.id)) return { deliveryId: row.id, state: 'inflight', message: 'delivery is already being evaluated' };
    this.inflight.add(row.id);
    try {
    const prior = this.store.db.prepare('SELECT * FROM participant_dispatches WHERE delivery_id=?').get(row.id);
    if (prior) return this.observe(row, prior);
    let readiness = await this.adapter.preflight(row, row, { confirmedComposer, completedPrompts:this.completedPrompts(row) });
    if(nativeChat(row)&&readiness.reasonCode==='identity_changed'&&this.adapter.reconnect){
      const verified=await this.adapter.reconnect(row,row);
      if(verified?.verified){
        this.store.reconnectNativeSession(row.session_id,row.binding_id,verified);
        const refreshed=this.eligible().find(candidate=>candidate.id===row.id);
        if(!refreshed)return {deliveryId:row.id,state:'skipped',message:'reconnected request is no longer eligible'};
        row=refreshed;
        readiness=await this.adapter.preflight(row,row);
      }
    }
    if (!readiness.ok){this.store.db.prepare("UPDATE deliveries SET blocked_reason=? WHERE id=? AND state='queued'").run(readiness.reason,row.id);return { deliveryId: row.id, state: 'skipped', message: readiness.reason };}
    if(this.debates?.reactive&&!this.debates.reactive.canStartParticipant(row.message_id))return {deliveryId:row.id,state:'skipped',message:'안건의 동시 응답 한도를 기다리고 있어.'};
    let configPath;
    try { configPath = nativeChat(row) ? '' : this.config(row); } catch (error) { return { deliveryId: row.id, state: 'skipped', message: error.message }; }
    const hostRequestId = row.request_id;
    const prompt = this.prompt(row, configPath, hostRequestId);
    let claim, attempt;
    try { claim = this.store.claim(row.id); attempt = this.store.fence(row.id, claim.fence); } catch (error) { return { deliveryId: row.id, state: 'skipped', message: error.message }; }
    this.store.db.prepare("UPDATE attempts SET state='automatic' WHERE id=?").run(attempt.id);
    // Terminal helper replies use the room UUID. Native Chat persists its own
    // timestamped operation ID and the mapping to this room request before RPC.
    const record = this.persist(row, attempt, hostRequestId, prompt, configPath);
    return this.send(row, record, { confirmedComposer });
    } finally { this.inflight.delete(row.id); }
  }

  async send(row, record, { confirmedComposer = null } = {}) {
    try{this.debates?.reactive?.beforeParticipantDelivery(row,record.host_request_id);}
    catch(error){return this.notSent(row,record,error.message);}
    try {
      const result = await this.adapter.send(row, row, record.prompt, record.host_request_id, { confirmedComposer, completedPrompts:this.completedPrompts(row), receipt:JSON.parse(record.receipt_json||'null'), onPrepared:receipt=>{this.store.dispatchEligibility(row.id);this.persistReceipt(record,receipt);} });
      if(nativeChat(row)||claudeDirect(row)) return this.nativeResult(row,record,{...result,initialSend:true});
      if (!result.ok){if(!result.receipt)return this.notSent(row,record,result.reason);return this.record(row,record,'unknown',result.reason,result.receipt);}
      const kind = result.stage === 'turn_started' ? 'turn_started' : 'host_receipt';
      this.store.evidence(record.attempt_id, kind, 'orca', record.host_request_id);
      return this.record(row, record, kind === 'turn_started' ? 'running' : 'accepted', null, result.receipt);
    } catch (error) {
      if(nativeChat(row)){let saved;try{saved=JSON.parse(this.store.db.prepare('SELECT receipt_json FROM participant_dispatches WHERE delivery_id=?').get(row.id)?.receipt_json||'null');}catch{}if(!saved?.clientOperationId||!saved?.payloadFingerprint)return this.notSent(row,record,error.message);}
      return this.record(row, record, 'unknown', error.message, error.receipt);
    }
  }

  notSent(row,record,reason,{confirmedNotRecorded=false}={}){
    this.store.tx(()=>{
      this.store.db.prepare("UPDATE attempts SET state='not_sent' WHERE id=?").run(record.attempt_id);
      const attempt=this.store.db.prepare('SELECT fence FROM attempts WHERE id=?').get(record.attempt_id);
      this.store.db.prepare("UPDATE deliveries SET state='queued',blocked_reason=? WHERE id=? AND (state='submitting' OR (?=1 AND state='unknown'))").run(reason,row.id,confirmedNotRecorded?1:0);
      this.store.db.prepare('UPDATE writers SET unresolved_delivery_id=NULL WHERE session_id=? AND fence=? AND unresolved_delivery_id=?').run(row.session_id,attempt.fence,row.id);
      this.store.db.prepare('DELETE FROM participant_dispatches WHERE delivery_id=?').run(row.id);
      this.debates?.reactive?.finishParticipantDelivery(record.host_request_id,'not_sent');
    });
    return {deliveryId:row.id,state:'queued',message:reason};
  }

  async observe(row, record) {
    try {
      const result = await this.adapter.send(row, row, record.prompt, record.host_request_id, { observeOnly: true, receipt:JSON.parse(record.receipt_json||'null') });
      if(nativeChat(row)||claudeDirect(row)) return this.nativeResult(row,record,result);
      if (!result.ok) return this.record(row, record, 'unknown', result.reason, result.receipt);
      const kind = result.stage === 'turn_started' ? 'turn_started' : 'host_receipt';
      this.store.evidence(record.attempt_id, kind, 'orca', record.host_request_id);
      return this.record(row, record, kind === 'turn_started' ? 'running' : 'accepted', null, result.receipt);
    } catch (error) { return this.record(row, record, 'unknown', error.message, error.receipt); }
  }

  persistReceipt(record,receipt) {
    if(!receipt||typeof receipt!=='object')throw Error('native receipt is invalid');
    const row=this.store.db.prepare('SELECT receipt_json FROM participant_dispatches WHERE delivery_id=? AND attempt_id=?').get(record.delivery_id,record.attempt_id);
    const saved=JSON.parse(row?.receipt_json||'null');
    const keys=receipt.transport==='claude-direct'||saved?.transport==='claude-direct'?directReceiptCore:nativeReceiptCore;
    if(saved){for(const key of keys){if(saved[key]!=null&&receipt[key]!==saved[key])throw Error(`native receipt identity changed: ${key}`);}}
    // The host client-message ID arrives only after admission. Older rows can
    // lack other fields too, so only fill gaps while retaining recorded values.
    const merged={...(saved||{}),...receipt};
    for(const key of keys)if(saved?.[key]!=null)merged[key]=saved[key];
    this.store.db.prepare('UPDATE participant_dispatches SET receipt_json=?,updated_at=? WHERE delivery_id=? AND attempt_id=?').run(JSON.stringify(merged),now(),record.delivery_id,record.attempt_id);
    return merged;
  }

  nativeResult(row,record,result) {
    if(result.receipt) result={...result,receipt:this.persistReceipt(record,result.receipt)};
    if(result.notRecorded){
      this.store.db.prepare('INSERT OR IGNORE INTO native_dispatch_refusals VALUES(?,?,?,?,?,?)').run(record.attempt_id,row.id,result.receipt?.clientOperationId||null,JSON.stringify(result.receipt||{}),result.reason||'native operation was not recorded',now());
      const cleared=this.notSent(row,record,result.reason||'native operation was refused before recording',{confirmedNotRecorded:true});
      if(result.legacyInvalidId)return cleared;
      this.store.db.prepare("UPDATE deliveries SET state='blocked' WHERE id=? AND state='queued'").run(row.id);
      return {...cleared,state:'blocked'};
    }
    if(!result.ok) {
      const saved=this.store.db.prepare('SELECT receipt_json FROM participant_dispatches WHERE delivery_id=?').get(row.id);
      if(result.initialSend&&!result.receipt&&!saved?.receipt_json&&record.status==='prepared')return this.notSent(row,record,result.reason||'native preflight refused');
      return this.record(row,record,'unknown',result.reason||result.receipt?.correlation||result.reasonCode||'native result requires reconciliation',result.receipt);
    }
    if(result.reply) {
      let request;try{request=JSON.parse(row.body);}catch{}
      if(request?.type==='agenda_review'&&this.debates){
        const review=JSON.parse((result.reply.finalBody||result.reply.body).trim().replace(/^```(?:json)?\s*([\s\S]*?)\s*```$/,'$1'));
        if(review.agendaId!==request.agendaId||review.roundId!==request.roundId||review.conclusionRevision!==request.conclusionRevision||typeof review.body!=='string'||review.body.length>8000)throw Error('native review does not match the requested revision');
        this.store.tx(()=>{
          this.store.replyFromAdapter(row.id,record.attempt_id,{bindingId:row.binding_id,incarnation:row.incarnation,receipt:result.receipt,reply:{...result.reply,body:review.body}});
          this.debates.recordReview(row.room_id,{room_id:row.room_id,session_id:row.session_id,membership_id:row.membership_id},{...review,attachmentIds:[],evidence:null,requestId:row.request_id});
        });
      }else this.store.replyFromAdapter(row.id,record.attempt_id,{bindingId:row.binding_id,incarnation:row.incarnation,receipt:result.receipt,reply:result.reply});
      return this.record(row,record,'completed',null,result.receipt);
    }
    if(result.stage==='input_accepted'&&this.store.db.prepare('SELECT state FROM deliveries WHERE id=?').get(row.id)?.state==='unknown')return this.record(row,record,'unknown',result.receipt?.correlation||'awaiting_turn_reconciliation',result.receipt);
    const kind=result.stage==='turn_started'?'turn_started':'host_receipt';
    this.store.evidence(record.attempt_id,kind,claudeDirect(row)?'claude-direct':'orca-native-chat',record.host_request_id);
    return this.record(row,record,kind==='turn_started'?'running':'accepted',null,result.receipt);
  }

  pendingNative() {
    return this.store.db.prepare(`SELECT d.*,m.room_id,m.body,mb.session_id,s.provider,s.native_id,s.cwd,
      b.handle,b.incarnation,b.capabilities,b.mode,b.verified_at
      FROM deliveries d JOIN messages m ON m.id=d.message_id JOIN memberships mb ON mb.id=d.membership_id
      JOIN sessions s ON s.id=mb.session_id JOIN bindings b ON b.id=d.binding_id
      JOIN participant_dispatches p ON p.delivery_id=d.id
      WHERE d.state IN ('submitting','accepted','running','unknown') AND b.active=1 AND mb.left_at IS NULL AND mb.read_only=0`).all().filter(row=>nativeChat(row)||claudeDirect(row));
  }

  record(row, record, status, error = null, receipt = null) {
    this.debates?.reactive?.finishParticipantDelivery(record.host_request_id,status);
    this.store.db.prepare('UPDATE participant_dispatches SET status=?,receipt_json=COALESCE(?,receipt_json),error=?,updated_at=? WHERE delivery_id=?').run(status, receipt ? JSON.stringify(receipt) : null, error, now(), record.delivery_id);
    if (error) this.store.db.prepare("UPDATE deliveries SET blocked_reason=? WHERE id=? AND state NOT IN ('completed','cancelled')").run(error,record.delivery_id);
    if (status === 'unknown') this.store.db.prepare("UPDATE deliveries SET state='unknown',blocked_reason=? WHERE id=? AND state NOT IN ('completed','cancelled')").run(error || 'host receipt requires reconciliation', record.delivery_id);
    if(this.debates&&['accepted','running'].includes(status))this.store.db.prepare("UPDATE approval_notices SET status='delivered',delivered_at=COALESCE(delivered_at,?) WHERE request_id=? AND status='queued'").run(now(),row.request_id);
    return { deliveryId: row.id, state: status, message: error || (status === 'accepted' ? nativeChat(row) ? 'native request accepted; awaiting correlated assistant reply' : 'input accepted; awaiting authenticated reply' : status) };
  }

  async tick() { if (this.ticking) return this.ticking; this.ticking = (async () => { const results = []; for (const row of this.pendingNative()){if(this.inflight.has(row.id))continue;this.inflight.add(row.id);try{const record=this.store.db.prepare('SELECT * FROM participant_dispatches WHERE delivery_id=?').get(row.id);results.push(await this.observe(row,record));}finally{this.inflight.delete(row.id);}} for (const row of this.eligible()){try{results.push(await this.dispatch(row));}catch(error){this.store.db.prepare("UPDATE deliveries SET blocked_reason=? WHERE id=? AND state='queued'").run(error.message,row.id);results.push({deliveryId:row.id,state:'skipped',message:error.message});}} return results; })(); try { return await this.ticking; } finally { this.ticking = null; } }
  confirmation(row, snapshot) {
    const nowMs = Date.now();
    for (const [nonce, value] of this.composerConfirmations) if (value.expiresAt <= nowMs) this.composerConfirmations.delete(nonce);
    while (this.composerConfirmations.size >= 64) this.composerConfirmations.delete(this.composerConfirmations.keys().next().value);
    const nonce = randomBytes(24).toString('base64url'), expiresAt = nowMs + 60_000;
    this.composerConfirmations.set(nonce, { deliveryId: row.id, sessionId: row.session_id, provider: row.provider, handle: row.handle, incarnation: row.incarnation, snapshot, expiresAt });
    return { nonce, phrasePreview: snapshot.phrasePreview, expiresAt: new Date(expiresAt).toISOString() };
  }
  consumeConfirmation(nonce, row) {
    const value = this.composerConfirmations.get(nonce); this.composerConfirmations.delete(nonce);
    if (!value || value.expiresAt <= Date.now()) throw Error('입력란 확인이 만료되었거나 이미 사용되었어. 다시 확인해줘.');
    if (value.deliveryId !== row.id || value.sessionId !== row.session_id || value.provider !== row.provider || value.handle !== row.handle || value.incarnation !== row.incarnation) throw Error('입력란 확인 대상이 바뀌었어. 다시 확인해줘.');
    return value.snapshot;
  }
  async retry(roomId, deliveryId, { composerConfirmation = null } = {}) {
    const roomCwd = this.store.db.prepare('PRAGMA table_info(rooms)').all().some(column => column.name === 'cwd') ? ',r.cwd AS room_cwd' : '';
    const find = () => this.store.db.prepare(`SELECT d.*,m.room_id,m.body,mb.session_id,s.provider,s.native_id,s.cwd,b.handle,b.incarnation,b.capabilities,b.mode,b.verified_at${roomCwd}
      FROM deliveries d JOIN messages m ON m.id=d.message_id JOIN memberships mb ON mb.id=d.membership_id JOIN sessions s ON s.id=mb.session_id JOIN bindings b ON b.id=d.binding_id JOIN rooms r ON r.id=m.room_id WHERE d.id=? AND m.room_id=?`).get(deliveryId, roomId);
    if (composerConfirmation && this.ticking) await this.ticking;
    const row = find();
    if (!row) throw new Error('delivery not found in room');
    const record = this.store.db.prepare('SELECT * FROM participant_dispatches WHERE delivery_id=?').get(deliveryId);
    const confirmedComposer = composerConfirmation ? this.consumeConfirmation(composerConfirmation, row) : null;
    if (composerConfirmation && (row.state !== 'queued' || record)) throw Error('입력란 확인은 아직 전송하지 않은 대기 요청에만 사용할 수 있어.');
    if (!record) {
      if (row.state !== 'queued') return { deliveryId, state: row.state, message: 'no durable host request to retry' };
      const eligible = this.eligible().find(candidate => candidate.id === deliveryId);
      if (!eligible) return { deliveryId, state: 'queued', message: 'delivery is not currently eligible for automatic input' };
      if (composerConfirmation) return this.dispatch(eligible, { confirmedComposer });
      if (nativeChat(eligible)) return this.dispatch(eligible);
      const readiness = await this.adapter.preflight(eligible, eligible);
      if (readiness.reasonCode === 'draft_exists' && readiness.confirmedComposer) return { deliveryId, state: 'queued', message: readiness.reason, composerConfirmation: this.confirmation(eligible, readiness.confirmedComposer) };
      return readiness.ok ? this.dispatch(eligible) : { deliveryId, state: 'queued', message: readiness.reason };
    }
    if (row.state === 'completed') return { deliveryId, state: 'completed', message: 'authenticated reply already received; no duplicate send' };
    this.store.dispatchEligibility(deliveryId);if(!JSON.parse(row.capabilities||'{}').automaticInput)throw Error('자동 전달 연결이 꺼져 있어.');
    const observed = await this.observe(row, record);
    if(nativeChat(row)||claudeDirect(row))return observed;
    if (!['accepted', 'running'].includes(observed.state)) return observed;
    const prior = this.store.db.prepare('SELECT * FROM participant_recoveries WHERE delivery_id=?').get(deliveryId);
    if (prior&&(!['accepted','running'].includes(prior.status)||Date.now()-Date.parse(prior.created_at)<30000))return this.recover(row,record,prior);
    if(prior){const ready=await this.adapter.preflight(row,row);if(!ready.ok)return {...observed,message:'이전 재호출 이후 아직 작업 중이거나 작성 중인 입력이 있어. '+ready.reason};this.store.db.prepare('INSERT OR IGNORE INTO participant_recovery_history VALUES(?,?,?,?,?,?,?,?)').run(prior.host_request_id,prior.delivery_id,prior.prompt,prior.status,prior.receipt_json,prior.error,prior.created_at,prior.updated_at);this.store.db.prepare('DELETE FROM participant_recoveries WHERE delivery_id=?').run(deliveryId);}
    const ready = await this.adapter.preflight(row, row);
    if (!ready.ok) return { ...observed, message: `original receipt observed; recovery nudge not sent: ${ready.reason}` };
    const recovery = { delivery_id: deliveryId, host_request_id: id(), prompt: this.prompt(row,record.config_path,row.request_id)+` Recover the prior room request ${row.request_id}. Do not redo file edits or tool side effects. Find any prior answer and submit room_reply for the original request; if no prior result exists, say it is missing and ask the user instead of rerunning work.`, status: 'prepared', receipt_json: null, error: null, created_at: now(), updated_at: now() };
    this.store.db.prepare('INSERT INTO participant_recoveries VALUES(?,?,?,?,?,?,?,?)').run(...Object.values(recovery));
    return this.recover(row, record, recovery);
  }
  async recover(row, record, recovery) {
    if(recovery.status==='prepared'){
      try{this.debates?.reactive?.beforeParticipantDelivery(row,recovery.host_request_id);}
      catch(error){return this.recoveryRecord(row,recovery,'not_sent',error.message);}
    }
    try {
      const result = await this.adapter.send(row, row, recovery.prompt, recovery.host_request_id, { observeOnly: recovery.status !== 'prepared' });
      if (!result.ok) return this.recoveryRecord(row, recovery, !result.receipt&&recovery.status==='prepared'?'not_sent':'unknown', result.reason, result.receipt);
      const kind = result.stage === 'turn_started' ? 'turn_started' : 'host_receipt';
      this.store.evidence(record.attempt_id, kind, 'orca-recovery', recovery.host_request_id);
      return this.recoveryRecord(row, recovery, kind === 'turn_started' ? 'running' : 'accepted', null, result.receipt);
    } catch (error) { return this.recoveryRecord(row, recovery, 'unknown', error.message, error.receipt); }
  }
  recoveryRecord(row, recovery, status, error = null, receipt = null) {
    this.debates?.reactive?.finishParticipantDelivery(recovery.host_request_id,status);
    this.store.db.prepare('UPDATE participant_recoveries SET status=?,receipt_json=?,error=?,updated_at=? WHERE delivery_id=?').run(status, receipt ? JSON.stringify(receipt) : null, error, now(), recovery.delivery_id);
    if (status === 'unknown') this.store.db.prepare("UPDATE deliveries SET state='unknown',blocked_reason=? WHERE id=? AND state NOT IN ('completed','cancelled')").run(error || 'recovery receipt requires reconciliation', row.id);
    return { deliveryId: row.id, state: status, message: error || 'recovery nudge submitted; awaiting authenticated reply' };
  }
}
