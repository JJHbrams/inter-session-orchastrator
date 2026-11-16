import {randomUUID,createHash} from 'node:crypto';
import {RELEVANCE_CONVERSATION} from '../../packages/contracts/dialogue-language.js';

const parse=value=>{try{return JSON.parse(value||'[]')}catch{return[]}},iso=value=>new Date(value).toISOString();
const terminal=new Set(['completed','abstained','expired','yielded','failed','cancelled','stopped']);
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

export class ReactiveParticipation {
 constructor(debates,{clock=Date.now,batchMs=2000,cooldownMs=10000,ttlMs=120000,concurrency=2}={}){
  Object.assign(this,{debates,store:debates.store,clock,batchMs,cooldownMs,ttlMs,concurrency});
  this.store.db.exec(`CREATE TABLE IF NOT EXISTS reactive_events(id TEXT PRIMARY KEY,agenda_id TEXT NOT NULL,source_id TEXT NOT NULL,seen_at TEXT NOT NULL,ready_at TEXT NOT NULL,expires_at TEXT NOT NULL,status TEXT NOT NULL,UNIQUE(agenda_id,source_id));
   CREATE TABLE IF NOT EXISTS reactive_cursors(agenda_id TEXT NOT NULL,membership_id TEXT NOT NULL,next_at TEXT NOT NULL,PRIMARY KEY(agenda_id,membership_id));
   CREATE TABLE IF NOT EXISTS reactive_event_targets(event_id TEXT NOT NULL,membership_id TEXT NOT NULL,status TEXT NOT NULL,intent_id TEXT,PRIMARY KEY(event_id,membership_id));
   CREATE TABLE IF NOT EXISTS reactive_yields(agenda_id TEXT NOT NULL,membership_id TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(agenda_id,membership_id));
   CREATE TABLE IF NOT EXISTS agenda_calls(id TEXT PRIMARY KEY,agenda_id TEXT NOT NULL,kind TEXT NOT NULL,run_id TEXT,message_id TEXT,delivery_id TEXT,dispatch_key TEXT UNIQUE,status TEXT NOT NULL,created_at TEXT NOT NULL);`);
  for(const [table,column,type] of [['reactive_events','payload','TEXT'],['reactive_intents','kind',"TEXT NOT NULL DEFAULT 'relevance'"],['reactive_intents','payload_hash','TEXT'],['reactive_intents','expires_at','TEXT'],['reactive_intents','reply_message_id','TEXT'],['reactive_interventions','request_key','TEXT'],['reactive_interventions','payload_hash','TEXT']]){
   if(!this.store.db.prepare(`PRAGMA table_info(${table})`).all().some(item=>item.name===column))this.store.db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
  }
  this.store.db.exec('CREATE UNIQUE INDEX IF NOT EXISTS reactive_intervention_request ON reactive_interventions(agenda_id,request_key) WHERE request_key IS NOT NULL');
  this.store.db.prepare("UPDATE reactive_intents SET kind='peer_request' WHERE target_membership_ids<>'[]'").run();
 }
 active(a){return a.discussion_mode==='reactive'&&!['paused','cancelled','completed'].includes(a.phase);}
 member(reg,a){
  const member=this.store.db.prepare('SELECT * FROM memberships WHERE id=? AND room_id=? AND session_id=? AND left_at IS NULL AND read_only=0').get(reg?.membership_id,reg?.room_id,reg?.session_id);
  if(!member||reg.read_only||reg.revoked_at||!a.targetMembershipIds.includes(member.id))throw Error('reactive participant must be an active writable agenda member');
  return member;
 }
 intentShape(row){
  return {...row,reason:row.kind==='peer_request'?null:row.reason,membershipId:row.membership_id,targetMembershipIds:parse(row.target_membership_ids),sourceIds:parse(row.source_ids),requestId:row.request_id,replyTo:row.reply_to,replyMessageId:row.reply_message_id,createdAt:row.created_at,updatedAt:row.updated_at};
 }
 shape(a){
  const db=this.store.db;
  const interruptions=db.prepare('SELECT * FROM participant_interrupt_requests WHERE agenda_id=? ORDER BY created_at').all(a.id).map(item=>({id:item.id,action:'interrupt',membershipId:item.membership_id,targetMembershipIds:[item.membership_id],deliveryId:item.delivery_id,fence:item.fence,status:item.status,reason:item.reason,proof:item.status==='stopped'?JSON.parse(item.proof_json||'null'):null}));
  return {calls:{public:a.requests_used,relevance:a.relevance_calls||0,chair:a.chair_calls||0},budgets:{public:a.request_budget,relevance:a.relevance_budget??36,chair:a.chair_budget??12},intents:db.prepare('SELECT * FROM reactive_intents WHERE agenda_id=? ORDER BY created_at,rowid').all(a.id).map(row=>this.intentShape(row)),interventions:[...db.prepare('SELECT * FROM reactive_interventions WHERE agenda_id=? ORDER BY created_at').all(a.id).map(row=>({...row,targetMembershipIds:parse(row.target_membership_ids)})),...interruptions],interruptCapability:{...this.debates.interrupts.capability(),provider:'orca'},callsLedger:db.prepare('SELECT id,kind,status,message_id,delivery_id,created_at FROM agenda_calls WHERE agenda_id=? ORDER BY rowid').all(a.id)};
 }
 _insertIntent(row){
  const keys=Object.keys(row);this.store.db.prepare(`INSERT INTO reactive_intents(${keys.join(',')}) VALUES(${keys.map(()=>'?').join(',')})`).run(...Object.values(row));
 }
 _eligible(a,room){return room.members.filter(member=>a.targetMembershipIds.includes(member.id)&&!member.left_at&&!member.read_only&&member.role!=='chair');}
 _event(a,key,payload,targets,at){
  const old=this.store.db.prepare('SELECT id FROM reactive_events WHERE agenda_id=? AND source_id=?').get(a.id,key);if(old)return;
  const id=randomUUID();this.store.db.prepare('INSERT INTO reactive_events(id,agenda_id,source_id,seen_at,ready_at,expires_at,status,payload) VALUES(?,?,?,?,?,?,?,?)').run(id,a.id,key,iso(at),iso(at+this.batchMs),iso(at+this.ttlMs),targets.length?'queued':'settled',JSON.stringify(payload));
  for(const membershipId of targets)this.store.db.prepare('INSERT OR IGNORE INTO reactive_event_targets VALUES(?,?,?,NULL)').run(id,membershipId,'pending');
 }
 intake(a,room,at){
  const db=this.store.db,eligible=this._eligible(a,room),linked=new Set(db.prepare('SELECT message_id FROM agenda_messages WHERE agenda_id=?').all(a.id).map(row=>row.message_id));
  for(const message of room.messages){
   const actor=eligible.find(member=>member.session_id===message.sender_session_id);
   if(!actor||message.provenance==='coordinator'||!linked.has(message.reply_to))continue;
   linked.add(message.id);db.prepare('INSERT OR IGNORE INTO agenda_messages VALUES(?,?,?)').run(a.id,message.id,'reactive:conversation');
   const addressed=new Set(room.deliveries.filter(delivery=>delivery.message_id===message.id).map(delivery=>delivery.membership_id));
   this._event(a,message.id,{kind:'message',messageId:message.id,actorMembershipId:actor.id},eligible.filter(member=>member.id!==actor.id&&!addressed.has(member.id)).map(member=>member.id),at);
  }
  for(const reaction of room.reactions||[]){
   if(!linked.has(reaction.message_id))continue;
   const message=room.messages.find(item=>item.id===reaction.message_id),author=eligible.find(member=>member.session_id===message?.sender_session_id),actor=eligible.find(member=>reaction.actor===`session:${member.session_id}`);
   const key='reaction:'+hash([reaction.message_id,reaction.actor,reaction.emoji,reaction.created_at]);
   // Positive receipt never recursively wakes all peers. Substantive feedback alerts the author once.
   const targets=['👎','❓','💡'].includes(reaction.emoji)&&author&&author.id!==actor?.id?[author.id]:[];
   this._event(a,key,{kind:'reaction',messageId:reaction.message_id,actorMembershipId:actor?.id||null,emoji:reaction.emoji},targets,at);
  }
 }
 reconcile(a){
  const db=this.store.db,at=iso(this.clock());
  db.prepare(`UPDATE agenda_calls SET status=(SELECT CASE WHEN d.outcome='abstained' THEN 'abstained' ELSE d.state END FROM deliveries d WHERE d.id=agenda_calls.delivery_id)
   WHERE agenda_id=? AND delivery_id IS NOT NULL AND status NOT IN ('not_sent','completed','abstained','cancelled','failed')
   AND delivery_id IN (SELECT id FROM deliveries WHERE state IN ('completed','cancelled','failed','unknown'))`).run(a.id);
  for(const intent of db.prepare('SELECT * FROM reactive_intents WHERE agenda_id=?').all(a.id)){
   if(terminal.has(intent.status))continue;
   const deliveries=db.prepare('SELECT * FROM deliveries WHERE message_id=?').all(intent.message_id);
   if(!deliveries.length)continue;
   const responses=deliveries.flatMap(delivery=>db.prepare('SELECT id FROM messages WHERE reply_request_id=?').all(delivery.request_id));
   let status=intent.status,decision=intent.decision;
   if(deliveries.every(delivery=>delivery.state==='completed')){status=deliveries.every(delivery=>delivery.outcome==='abstained')?'abstained':'completed';if(!decision)decision=responses.length?'speak':null;}
   else if(deliveries.some(delivery=>delivery.state==='unknown'))status='unknown';
   else if(deliveries.every(delivery=>['cancelled','failed','blocked'].includes(delivery.state)))status='yielded';
   else if(deliveries.some(delivery=>['accepted','running','submitting'].includes(delivery.state))&&status!=='yield_requested')status=intent.kind==='peer_request'?'speaking':decision==='speak'?'speaking':'evaluating';
   if(status!==intent.status||decision!==intent.decision||(responses[0]?.id||null)!==intent.reply_message_id)db.prepare('UPDATE reactive_intents SET status=?,decision=?,reply_message_id=?,updated_at=? WHERE id=?').run(status,decision,responses[0]?.id||null,at,intent.id);
   for(const reply of responses)db.prepare('INSERT OR IGNORE INTO agenda_messages VALUES(?,?,?)').run(a.id,reply.id,'reactive:conversation');
   if(intent.expires_at&&intent.expires_at<=at&&deliveries.every(delivery=>delivery.state==='queued')){
    db.prepare("UPDATE deliveries SET state='cancelled',blocked_reason='reactive notification expired' WHERE message_id=? AND state='queued'").run(intent.message_id);db.prepare("UPDATE reactive_intents SET status='expired',updated_at=? WHERE id=?").run(at,intent.id);
   }
  }
  for(const intervention of db.prepare("SELECT * FROM reactive_interventions WHERE agenda_id=? AND action='yield' AND status='yield_requested'").all(a.id)){
   const targets=parse(intervention.target_membership_ids),pending=db.prepare("SELECT * FROM reactive_intents WHERE agenda_id=? AND status NOT IN ('completed','abstained','expired','yielded','failed','cancelled')").all(a.id).some(intent=>targets.includes(intent.membership_id)||parse(intent.target_membership_ids).some(id=>targets.includes(id)));
   if(!pending)db.prepare("UPDATE reactive_interventions SET status='completed' WHERE id=?").run(intervention.id);
  }
  for(const intervention of db.prepare("SELECT * FROM reactive_interventions WHERE agenda_id=? AND action='mediate' AND status='queued'").all(a.id)){
   const d=db.prepare("SELECT d.state FROM agenda_messages am JOIN messages m ON m.id=am.message_id JOIN deliveries d ON d.message_id=m.id WHERE am.agenda_id=? AND am.kind='chair:discussion' AND m.request_key LIKE ?").get(a.id,'%:'+intervention.id);
   if(d&&['completed','cancelled','failed'].includes(d.state))db.prepare('UPDATE reactive_interventions SET status=? WHERE id=?').run(d.state,intervention.id);
  }
 }
 tick(a){
  if(!this.active(a))return {pending:false};
  return this.store.tx(()=>{
   const db=this.store.db,at=this.clock(),room=this.store.room(a.room_id);this.reconcile(a);
   if(room.archived_at||room.paused_at||a.phase!=='collecting')return {pending:false};
   this.intake(a,room,at);
   db.prepare("UPDATE reactive_event_targets SET status='expired' WHERE status='pending' AND event_id IN (SELECT id FROM reactive_events WHERE agenda_id=? AND expires_at<=?)").run(a.id,iso(at));
   const peers=this._eligible(a,room);
   let outstanding=db.prepare("SELECT count(*) n FROM deliveries d JOIN agenda_messages am ON am.message_id=d.message_id WHERE am.agenda_id=? AND d.state IN ('queued','claimed','submitting','accepted','running','unknown')").get(a.id).n;
   let used=db.prepare('SELECT relevance_calls FROM agendas WHERE id=?').get(a.id).relevance_calls;
   for(const peer of peers){
    const events=db.prepare("SELECT e.* FROM reactive_events e JOIN reactive_event_targets t ON t.event_id=e.id WHERE e.agenda_id=? AND t.membership_id=? AND t.status='pending' AND e.ready_at<=? AND e.expires_at>? ORDER BY e.seen_at,e.rowid").all(a.id,peer.id,iso(at),iso(at));
    if(!events.length)continue;
    if(db.prepare('SELECT 1 FROM reactive_yields WHERE agenda_id=? AND membership_id=?').get(a.id,peer.id)||used>=a.relevance_budget){for(const event of events)db.prepare("UPDATE reactive_event_targets SET status='skipped' WHERE event_id=? AND membership_id=?").run(event.id,peer.id);continue;}
    const cursor=db.prepare('SELECT next_at FROM reactive_cursors WHERE agenda_id=? AND membership_id=?').get(a.id,peer.id),writer=db.prepare('SELECT unresolved_delivery_id FROM writers WHERE session_id=?').get(peer.session_id);
    if(cursor?.next_at>iso(at)||writer?.unresolved_delivery_id||outstanding>=this.concurrency)continue;
    const intentId=randomUUID(),sources=events.map(event=>parse(event.payload)),sourceIds=[...new Set(sources.map(source=>source.messageId))],key='reactive-notice:'+a.id+':'+peer.id+':'+hash(events.map(event=>event.id));
    const post=this.store.post({roomId:a.room_id,body:JSON.stringify({type:'agenda_relevance',agendaId:a.id,intentId,conclusionRevision:a.revision,sources,sourceIds,instruction:'Read relevant sources using exact IDs. Independently choose speak or private abstain with room_participate (helper participate). If speaking, decide speak then room_reply to this exact inbox request; you may directly ask a chosen peer using agenda-bound room_request. Do not repeat an answered point. Abstain does not need a public reply or mean formal agreement. '+RELEVANCE_CONVERSATION}),kind:'followup',targets:[peer.id],requestKey:key,replyTo:sourceIds[0],coordinator:true});
    const row={id:intentId,agenda_id:a.id,membership_id:peer.id,target_membership_ids:'[]',decision:null,status:'queued',reason:null,source_ids:JSON.stringify(sourceIds),request_id:post.deliveries[0].request_id,reply_to:sourceIds[0],message_id:post.message.id,created_at:iso(at),updated_at:iso(at),kind:'relevance',expires_at:iso(Math.max(...events.map(event=>Date.parse(event.expires_at))))};
    this._insertIntent(row);db.prepare('INSERT OR IGNORE INTO agenda_messages VALUES(?,?,?)').run(a.id,post.message.id,'reactive:notice');
    for(const event of events)db.prepare("UPDATE reactive_event_targets SET status='scheduled',intent_id=? WHERE event_id=? AND membership_id=?").run(intentId,event.id,peer.id);
    db.prepare('INSERT OR REPLACE INTO reactive_cursors VALUES(?,?,?)').run(a.id,peer.id,iso(at+this.cooldownMs));used++;outstanding++;
   }
   db.prepare('UPDATE agendas SET relevance_calls=? WHERE id=?').run(used,a.id);
   db.prepare("UPDATE reactive_events SET status='settled' WHERE agenda_id=? AND NOT EXISTS(SELECT 1 FROM reactive_event_targets t WHERE t.event_id=reactive_events.id AND t.status='pending')").run(a.id);
   const pending=!!db.prepare("SELECT 1 FROM reactive_event_targets t JOIN reactive_events e ON e.id=t.event_id WHERE e.agenda_id=? AND t.status='pending' UNION SELECT 1 FROM reactive_intents WHERE agenda_id=? AND status IN ('queued','evaluating','speaking','yield_requested','unknown') LIMIT 1").get(a.id,a.id);
   return {pending};
  });
 }
 _reserve(a,count){const reserve=['planning','collecting'].includes(a.phase)?a.targetMembershipIds.length:0;if(a.requests_used+count+reserve>a.request_budget)throw Error('reactive public request budget reserved for formal review');}
 beforeLegacyRequest(reg){
  const agendas=this.store.db.prepare("SELECT target_membership_ids FROM agendas WHERE room_id=? AND discussion_mode='reactive' AND phase NOT IN ('completed','cancelled')").all(reg.room_id);
  if(agendas.some(a=>parse(a.target_membership_ids).includes(reg.membership_id)))throw Error('자율 토론 중 동료 질문에는 agendaId와 sourceIds가 필요해. 현재 방의 helper request를 사용해줘.');
 }
 request(reg,{agendaId,body,targets,sourceIds=[],requestId=null,replyTo=null,attachmentIds=[],evidence=null}){
  return this.store.tx(()=>{
   const a=this.debates.get(reg.room_id,agendaId);if(!this.active(a))throw Error('reactive participation is unavailable');this.member(reg,a);
   if(!Array.isArray(targets)||!Array.isArray(sourceIds)||!sourceIds.length)throw Error('peer question requires targets and actual agenda source IDs');
   this.debates._validateSources(a,sourceIds);if(replyTo&&!this.store.db.prepare('SELECT 1 FROM agenda_messages WHERE agenda_id=? AND message_id=?').get(a.id,replyTo))throw Error('reactive reply target is outside this agenda');
   const list=[...new Set(targets)],chair=this.store.room(reg.room_id).members.find(member=>member.session_id===this.store.chair(reg.room_id)?.session_id);
   const key=reg.membership_id+':'+(requestId||randomUUID()),digest=hash({body,list,sourceIds,replyTo,attachmentIds,evidence}),old=this.store.db.prepare('SELECT * FROM reactive_intents WHERE agenda_id=? AND membership_id=? AND request_id=?').get(a.id,reg.membership_id,key),mediation=this.store.db.prepare('SELECT * FROM reactive_interventions WHERE agenda_id=? AND request_key=?').get(a.id,key);
   if(old||mediation){if((old||mediation).payload_hash!==digest)throw Error('reactive request idempotency conflict');return old?this.intentShape(old):{...mediation,targetMembershipIds:parse(mediation.target_membership_ids)};}
   if(list.length===1&&list[0]===chair?.id)return this.yield(a,{targetMembershipIds:[],reason:body,requestKey:key,payloadHash:digest});
   if(this.store.db.prepare('SELECT 1 FROM reactive_yields WHERE agenda_id=? AND membership_id=?').get(a.id,reg.membership_id))throw Error('마무리 요청을 받은 참여자는 새 동료 질문을 시작할 수 없어. 현재 응답을 마치거나 좌장에게 중재를 요청해줘.');
   if(a.phase==='reviewing')throw Error('최종 검토 중 새 동료 질문은 보낼 수 없어. 검토 의견에 이견을 남기거나 좌장에게 중재를 요청해줘.');
   if(!list.length||list.includes(reg.membership_id)||list.some(id=>!a.targetMembershipIds.includes(id)))throw Error('reactive targets must be other agenda participants');
   if(list.some(id=>this.store.db.prepare('SELECT 1 FROM reactive_yields WHERE agenda_id=? AND membership_id=?').get(a.id,id)))throw Error('target is finishing this agenda; ask the chair instead');
   this._reserve(a,list.length);
   const post=this.store.postWithEvidence({roomId:reg.room_id,senderSessionId:reg.session_id,body,attachmentIds,evidence,kind:'followup',targets:list,requestKey:`reactive:${a.id}:${reg.membership_id}:${key}`,replyTo:replyTo||sourceIds[0]});
   const row={id:randomUUID(),agenda_id:a.id,membership_id:reg.membership_id,target_membership_ids:JSON.stringify(list),decision:'speak',status:'queued',reason:null,source_ids:JSON.stringify(sourceIds),request_id:key,message_id:post.message.id,reply_to:replyTo||sourceIds[0],created_at:iso(this.clock()),updated_at:iso(this.clock()),kind:'peer_request',payload_hash:digest};this._insertIntent(row);
   this.store.db.prepare('INSERT OR IGNORE INTO agenda_messages VALUES(?,?,?)').run(a.id,post.message.id,'reactive:peer');this.store.db.prepare('UPDATE agendas SET requests_used=requests_used+?,updated_at=? WHERE id=?').run(list.length,iso(this.clock()),a.id);
   const pair=this.store.db.prepare("SELECT count(*) n FROM reactive_intents WHERE agenda_id=? AND kind='peer_request' AND ((membership_id=? AND target_membership_ids=?) OR (membership_id=? AND target_membership_ids=?))").get(a.id,reg.membership_id,JSON.stringify(list),list[0],JSON.stringify([reg.membership_id])).n;
   if(list.length===1&&pair%4===0)this.yield(a,{targetMembershipIds:[],reason:'같은 참여자 사이의 질문이 반복되고 있어. 남은 이견을 나눠 중재해줘.'});
   return this.intentShape(row);
  });
 }
 decide(reg,{agendaId,intentId,decision,reason='',sourceIds=[],reaction=null}){
  return this.store.tx(()=>{
   const a=this.debates.get(reg.room_id,agendaId);if(a.discussion_mode!=='reactive')throw Error('reactive participation is unavailable');this.member(reg,a);this.reconcile(a);
   let row=this.store.db.prepare('SELECT * FROM reactive_intents WHERE id=? AND agenda_id=? AND membership_id=? AND kind=\'relevance\'').get(intentId,a.id,reg.membership_id);
   if(!row)throw Error('reactive intent is not addressed to this registration');
   if(!['speak','abstain'].includes(decision)||!Array.isArray(sourceIds)||typeof reason!=='string'||reason.length>800)throw Error('invalid reactive participation decision');
   // Caller-supplied sourceIds may broaden the agenda citation, but a reaction only ever targets this
   // notification's own persisted sources -- it must never widen the authenticated reaction target.
   // This check runs before the general agenda-source validation so an attempt to widen a reaction
   // target via sourceIds is always reported as an exact-source violation, not a generic source error.
   const persistedSources=parse(row.source_ids);
   if(reaction!==null){
    if(typeof reaction!=='object'||typeof reaction.messageId!=='string'||typeof reaction.emoji!=='string'||(reaction.active!==true&&reaction.active!==false))throw Error('invalid reactive reaction');
    if(!persistedSources.includes(reaction.messageId))throw Error('reaction must target an exact source of this notification');
   }
   this.debates._validateSources(a,sourceIds);
   const digest=hash({decision,reason,sourceIds,reaction});
   // Decided intents are idempotent only for the exact same payload; a changed repeated payload
   // must conflict before any reaction or event is applied, not after.
   if(row.decision){
    if(row.decision!==decision||(row.payload_hash&&row.payload_hash!==digest))throw Error('reactive decision idempotency conflict');
    return this.intentShape(row);
   }
   const d=this.store.db.prepare('SELECT * FROM deliveries WHERE message_id=? AND membership_id=?').get(row.message_id,reg.membership_id),reply=d&&this.store.db.prepare('SELECT id FROM messages WHERE reply_request_id=? AND sender_session_id=?').get(d.request_id,reg.session_id);
   if(!d||['cancelled','failed','blocked'].includes(d.state))throw Error('reactive delivery is no longer actionable');
   if(reply&&decision==='abstain')throw Error('a published answer cannot become private abstention');
   const writer=d.state!=='completed'?this.store.db.prepare('SELECT * FROM writers WHERE session_id=?').get(reg.session_id):null;
   if(d.state!=='completed'&&writer?.unresolved_delivery_id!==d.id)throw Error('reactive delivery has not been offered to this session');
   if(reaction!==null)this.store.react(reg,reaction.messageId,reaction.emoji,reaction.active);
   if(d.state!=='completed'&&decision==='abstain'){
    this.store.db.prepare("UPDATE deliveries SET state='completed',outcome='abstained' WHERE id=?").run(d.id);this.store.db.prepare("UPDATE attempts SET state='completed' WHERE delivery_id=? AND fence=?").run(d.id,writer.fence);this.store.db.prepare('UPDATE writers SET unresolved_delivery_id=NULL WHERE session_id=? AND fence=? AND unresolved_delivery_id=?').run(reg.session_id,writer.fence,d.id);
   }
   this.store.db.prepare('UPDATE reactive_intents SET decision=?,status=?,reason=?,source_ids=?,reply_message_id=?,payload_hash=?,updated_at=? WHERE id=?').run(decision,decision==='abstain'?'abstained':reply?'completed':'speaking',reason,JSON.stringify(sourceIds.length?sourceIds:persistedSources),reply?.id||null,digest,iso(this.clock()),row.id);
   this.reconcile(a);
   this.store.event(reg.room_id,'participant.participation',{agendaId,intentId,decision});return this.intentShape(this.store.db.prepare('SELECT * FROM reactive_intents WHERE id=?').get(row.id));
  });
 }
 yield(a,{targetMembershipIds=[],reason='',requestKey=null,payloadHash=null}){
  return this.store.tx(()=>{
   if(!this.active(a)||typeof reason!=='string'||!reason.trim()||reason.length>800)throw Error('active agenda and intervention reason required');
   if(!Array.isArray(targetMembershipIds))throw Error('intervention targets must be an array');
   const targets=[...new Set(targetMembershipIds)];if(targets.some(id=>!a.targetMembershipIds.includes(id)))throw Error('intervention target outside agenda');
   const current=this.store.db.prepare('SELECT chair_calls,chair_budget FROM agendas WHERE id=?').get(a.id);
   if(!targets.length&&current.chair_calls>=current.chair_budget)throw Error('좌장 호출 한도에 도달해 중재 요청을 추가할 수 없어.');
   const id=randomUUID(),row={id,agenda_id:a.id,action:targets.length?'yield':'mediate',target_membership_ids:JSON.stringify(targets),reason,status:targets.length?'yield_requested':'queued',created_at:iso(this.clock())};
   this.store.db.prepare('INSERT INTO reactive_interventions(id,agenda_id,action,target_membership_ids,reason,status,created_at,request_key,payload_hash) VALUES(?,?,?,?,?,?,?,?,?)').run(...Object.values(row),requestKey,payloadHash);
   if(!targets.length)this.debates._queue(a,'discussion',id,reason);
   for(const target of targets){
    this.store.db.prepare('INSERT OR IGNORE INTO reactive_yields VALUES(?,?,?)').run(a.id,target,iso(this.clock()));
    for(const intent of this.store.db.prepare('SELECT * FROM reactive_intents WHERE agenda_id=?').all(a.id)){
     if(terminal.has(intent.status)||!(intent.membership_id===target||parse(intent.target_membership_ids).includes(target)))continue;
     this.store.db.prepare("UPDATE deliveries SET state='cancelled',blocked_reason='cooperative finish requested before dispatch' WHERE message_id=? AND membership_id=? AND state='queued'").run(intent.message_id,target);
     this.store.db.prepare("UPDATE reactive_intents SET status='yield_requested',updated_at=? WHERE id=?").run(iso(this.clock()),intent.id);
    }
   }
   this.reconcile(a);return {...row,targetMembershipIds:targets};
  });
 }
 applyModeration(a,action){
  if(!action)return;
  if(!['yield','interrupt','mediate'].includes(action.action)||typeof action.reason!=='string'||!action.reason.trim()||action.reason.length>800)throw Error('moderation requires a valid action and reason');
  if(action.action!=='mediate'&&(!Array.isArray(action.targetMembershipIds)||!action.targetMembershipIds.length))throw Error('moderation requires exact agenda targets');
  return this.yield(a,{targetMembershipIds:action.action==='mediate'?[]:action.targetMembershipIds,reason:(action.action==='interrupt'?'정확한 native 작업 중단이 지원되지 않아 마무리 요청으로 처리: '+action.reason.trim():action.reason.trim()).slice(0,800)});
 }
 canStartParticipant(messageId){
  const a=this.store.db.prepare('SELECT a.* FROM agendas a JOIN agenda_messages am ON am.agenda_id=a.id WHERE am.message_id=?').get(messageId);
  if(!a||a.discussion_mode!=='reactive')return true;
  return this.store.db.prepare("SELECT count(*) n FROM deliveries d JOIN agenda_messages am ON am.message_id=d.message_id WHERE am.agenda_id=? AND d.state IN ('claimed','submitting','accepted','running','unknown')").get(a.id).n<this.concurrency;
 }
 beforeParticipantDelivery(row,dispatchKey){
  const db=this.store.db,a=db.prepare('SELECT a.* FROM agendas a JOIN agenda_messages am ON am.agenda_id=a.id WHERE am.message_id=?').get(row.message_id);
  if(!a||a.discussion_mode!=='reactive')return null;
  if(['paused','completed','cancelled'].includes(a.phase))throw Error('안건이 중지 또는 완료되어 새 참여자 실행을 멈췄어.');
  const key='participant:'+dispatchKey,old=db.prepare('SELECT id FROM agenda_calls WHERE dispatch_key=?').get(key);if(old)return old.id;
  const relevance=db.prepare("SELECT 1 FROM reactive_intents WHERE message_id=? AND kind='relevance'").get(row.message_id),extra=db.prepare('SELECT 1 FROM agenda_calls WHERE delivery_id=?').get(row.id);
  if(extra){
   if(relevance){if(a.relevance_calls>=a.relevance_budget)throw Error('relevance call budget exhausted');db.prepare('UPDATE agendas SET relevance_calls=relevance_calls+1 WHERE id=?').run(a.id);}
   else{this._reserve({...a,targetMembershipIds:parse(a.target_membership_ids)},1);db.prepare('UPDATE agendas SET requests_used=requests_used+1 WHERE id=?').run(a.id);}
  }
  const id=randomUUID();db.prepare('INSERT INTO agenda_calls VALUES(?,?,?,?,?,?,?,?,?)').run(id,a.id,relevance?'relevance':'peer',null,row.message_id,row.id,key,'submitting',iso(this.clock()));return id;
 }
 finishParticipantDelivery(dispatchKey,status){
  if(!['not_sent','accepted','running','unknown','completed','abstained'].includes(status))throw Error('invalid participant call status');
  this.store.db.prepare("UPDATE agenda_calls SET status=? WHERE dispatch_key=? AND status NOT IN ('completed','abstained','cancelled','failed')").run(status,'participant:'+dispatchKey);
 }
 beforeNativeResume(roomId,messageId,{kind='chair',runId}={}){
  const a=this.store.db.prepare('SELECT a.* FROM agendas a JOIN agenda_messages am ON am.agenda_id=a.id WHERE a.room_id=? AND am.message_id=?').get(roomId,messageId);
  if(!a||a.discussion_mode!=='reactive')return {allowed:true,callId:null};
  if(['paused','completed','cancelled'].includes(a.phase)){const error=Error('안건이 중지 또는 완료되어 새 좌장 실행을 멈췄어.');error.code='AGENDA_INACTIVE';throw error;}
  if(a.chair_calls>=a.chair_budget){const error=Error('안건의 좌장 호출 한도에 도달했어. 추가 모델 실행을 멈췄어.');error.code='AGENDA_CALL_BUDGET';throw error;}
  const callId=randomUUID();this.store.tx(()=>{this.store.db.prepare('UPDATE agendas SET chair_calls=chair_calls+1 WHERE id=?').run(a.id);this.store.db.prepare('INSERT INTO agenda_calls VALUES(?,?,?,?,?,?,?,?,?)').run(callId,a.id,kind,runId||null,messageId,null,null,'started',iso(this.clock()));});return {allowed:true,agendaId:a.id,callId};
 }
 finishNativeResume(callId,{status='completed'}={}){if(callId)this.store.db.prepare('UPDATE agenda_calls SET status=? WHERE id=?').run(status,callId);}
}
