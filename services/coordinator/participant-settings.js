import {randomUUID} from 'node:crypto';
const now=()=>new Date().toISOString();
export class ParticipantSettings {
 constructor(store,{adapter}={}){this.store=store;this.adapter=adapter;}
 completedPrompts(member){
  const db=this.store.db;
  if(!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='participant_dispatches'").get())return [];
  return db.prepare(`SELECT p.prompt FROM participant_dispatches p
   JOIN deliveries d ON d.id=p.delivery_id JOIN memberships m ON m.id=d.membership_id
   JOIN bindings b ON b.id=d.binding_id
   WHERE m.session_id=? AND b.incarnation=? AND b.handle=? AND d.state='completed'
   ORDER BY p.created_at DESC LIMIT 8`).all(member.session_id,member.incarnation,member.handle).map(row=>row.prompt);
 }
 member(roomId,sessionId){
  const room=this.store.room(roomId),m=room.members.find(x=>x.session_id===sessionId&&!x.left_at);
  if(!m||m.read_only||room.archived_at)throw Error('활성 토론장의 쓰기 가능한 참여자만 설정할 수 있어.');
  if(m.role==='chair'||room.chair?.session_id===sessionId)throw Error('좌장은 좌장 설정을 사용해줘.');
  if(JSON.parse(m.capabilities||'{}').transport==='orca-native-chat')throw Error('직접 연결한 Chat은 기존 Orca 세션의 모델과 권한 설정을 유지해.');
  if(m.mode!=='live_attach'||!m.verified_at||!m.handle||!m.incarnation||!['codex','claude'].includes(m.provider))throw Error('확인된 Codex·Claude의 원래 세션 연결이 필요해.');
  return m;
 }
 async observe(sessionId){
  const row=this.store.db.prepare(`SELECT s.id session_id,s.provider,s.host,s.native_id,s.cwd,s.profile,b.id,b.handle,b.incarnation,b.capabilities,b.mode,b.verified_at
   FROM sessions s JOIN bindings b ON b.session_id=s.id AND b.active=1 WHERE s.id=?`).get(sessionId);
  if(!row||!row.verified_at||JSON.parse(row.capabilities||'{}').transport!=='orca-native-chat')return {saved:false,reasonCode:'native_metadata_unavailable'};
  const binding={id:row.id,provider:row.provider,host:row.host,nativeId:row.native_id,cwd:row.cwd,profile:row.profile,handle:row.handle,incarnation:row.incarnation,capabilities:row.capabilities};
  const result=await this.adapter.readMetadata(binding,binding);
  if(!result?.ok)return {saved:false,reasonCode:result?.reasonCode||'metadata_read_failed'};
  return this.store.recordParticipantMetadata(sessionId,binding,result);
 }
 async run(roomId,sessionId,action,input={}){
  if(!['inspect','apply','reconcile'].includes(action))throw Error('invalid settings action');
  const s=this.store,operationId=randomUUID();let m,started=false,recoverMenu=false,hadUnknown=false;
  s.tx(()=>{m=this.member(roomId,sessionId);if(input.provider&&input.provider!==m.provider)throw Error('Provider는 변경할 수 없어.');
   if(action==='apply'&&(typeof input.model!=='string'||!input.model||!['low','medium','high','xhigh','max','ultra'].includes(input.effort)))throw Error('모델과 지원하는 effort를 선택해줘.');
   const prior=s.db.prepare('SELECT * FROM session_controls WHERE session_id=?').get(sessionId);
   hadUnknown=prior?.status==='unknown';recoverMenu=action==='reconcile'&&hadUnknown&&prior.incarnation===m.incarnation;
   if(prior&&(prior.status!=='unknown'||action!=='reconcile')){const e=Error(prior.status==='unknown'?'이전 설정 결과가 미확인이야. 연결 확인으로 먼저 복구해줘.':'다른 토론장에서 같은 세션 설정을 확인 중이야.');if(prior.status==='unknown')e.code='SETTINGS_UNKNOWN';throw e;}
   if(s.db.prepare('SELECT unresolved_delivery_id FROM writers WHERE session_id=?').get(sessionId)?.unresolved_delivery_id)throw Error('이 세션의 이전 요청이 진행 중이거나 결과 미확인이야. 응답을 먼저 확인해줘.');
   s.db.prepare('INSERT OR REPLACE INTO session_controls VALUES(?,?,?,?,?,?)').run(sessionId,operationId,m.incarnation,'active',null,now());
  });
  try{
   const evidence={completedPrompts:this.completedPrompts(m)};
   if(!recoverMenu){const preflight=await this.adapter.preflight(m,m,evidence);if(!preflight.ok)throw Error(preflight.reason);}
   const current=this.member(roomId,sessionId);if(current.incarnation!==m.incarnation||current.handle!==m.handle)throw Error('설정 확인 중 세션 연결이 바뀌었어.');
   started=true;
   const assertCurrent=()=>{const current=this.member(roomId,sessionId),control=s.db.prepare('SELECT operation_id FROM session_controls WHERE session_id=?').get(sessionId);if(current.incarnation!==m.incarnation||current.handle!==m.handle||control?.operation_id!==operationId)throw Error('설정 작업 중 세션 연결이 바뀌었어.');};
   const adapter=this.adapter.withGuard?.(assertCurrent,evidence)||this.adapter;
   const result=await adapter[action==='reconcile'&&!recoverMenu?'inspect':action](m,m,input);
   return s.tx(()=>{const current=this.member(roomId,sessionId);if(current.incarnation!==m.incarnation||current.handle!==m.handle)throw Error('세션 연결이 바뀌어 결과를 확정하지 않았어.');
    const verified={...result,observedAt:now(),source:'native model picker',provider:m.provider};
    s.db.prepare('INSERT OR REPLACE INTO session_model_settings VALUES(?,?,?,?)').run(sessionId,m.incarnation,JSON.stringify(verified),verified.observedAt);
    s.db.prepare('DELETE FROM session_controls WHERE session_id=? AND operation_id=?').run(sessionId,operationId);
    for(const r of s.db.prepare('SELECT room_id FROM memberships WHERE session_id=? AND left_at IS NULL').all(sessionId))s.event(r.room_id,'session.model-settings',{sessionId,model:verified.model,effort:verified.effort,action});
    return verified;
   });
  }catch(e){if(started||hadUnknown)s.db.prepare("UPDATE session_controls SET status='unknown',error=?,updated_at=? WHERE session_id=? AND operation_id=?").run(e.message,now(),sessionId,operationId);else s.db.prepare('DELETE FROM session_controls WHERE session_id=? AND operation_id=?').run(sessionId,operationId);if(started||hadUnknown)e.code='SETTINGS_UNKNOWN';throw e;}
 }
}
