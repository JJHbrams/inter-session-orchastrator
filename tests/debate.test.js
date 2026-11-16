import {RoomHistory} from '../services/coordinator/history.js';
import {KnowledgeStore} from '../services/coordinator/knowledge.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../services/coordinator/store.js';
import {ChairCoordinator} from '../services/coordinator/chair.js';
import {DebateCoordinator} from '../services/coordinator/debate.js';

const participant=(s,r,nativeId)=>{const session=s.registerSession({provider:'codex',host:'test',nativeId,cwd:'C:/test',profile:'default',mode:'live_attach',ownership:'borrowed',verified:true,capabilities:{followup:true}}).session;return {session,membership:s.join(r.id,session.id,false)};};
const reg=(room,p)=>({room_id:room.id,session_id:p.session.id,membership_id:p.membership.id});

test('three long evidence replies can be synthesized and refined without exceeding the message cap',async()=>{
 const s=new Store(),room=s.createRoom('long meeting'),peers=['a','b','c'].map(id=>participant(s,room,id));let calls=0,answers=[];
 const proposal='긴 결론 '.repeat(700);
 const c=new ChairCoordinator(s,{runner:{initialize:async({nativeId})=>({nativeId,started:true,output:{speech:'ready'}}),resume:async({nativeId,onStarted})=>{onStarted();calls++;return {nativeId,started:true,output:calls===1?{speech:'research',questions:[{targetMembershipIds:peers.map(p=>p.membership.id),body:'research'}],proposal:null}:{speech:'proposal',questions:[],proposal:{body:proposal+(calls===3?' revised':''),sourceIds:answers.map(a=>a.id)}}};}}}),d=new DebateCoordinator(s,{chairs:c});
 await c.create(room.id);const agenda=d.create(room.id,{title:'long',body:'long meeting',roundBudget:6,requestBudget:18,targetMembershipIds:peers.map(p=>p.membership.id)});await c.tick(room.id);
 for(const p of peers){const delivery=s.room(room.id).deliveries.find(x=>x.membership_id===p.membership.id&&x.state==='queued');answers.push(s.reply(reg(room,p),delivery.request_id,p.session.native_id+' evidence '.repeat(500)).message);}
 await d.tick(room.id);await c.tick(room.id);
 for(const revision of [1,2]){
  const state=d.get(room.id,agenda.id);assert.equal(state.phase,'reviewing');assert.equal(state.revision,revision);const round=state.rounds.at(-1);
  const deliveries=s.room(room.id).deliveries.filter(x=>peers.some(p=>p.membership.id===x.membership_id)&&x.state==='queued');assert.equal(deliveries.length,3);
  const message=s.room(room.id).messages.find(m=>m.id===deliveries[0].message_id),wire=JSON.parse(message.body);assert.ok(message.body.length<=8000);assert.equal(wire.referencesOnly,true);assert.deepEqual(wire.arguments.map(x=>x.id),answers.map(x=>x.id));assert.equal(state.arguments[0].body,answers[0].body);assert.equal(state.current_conclusion,proposal+(revision===2?' revised':''));
  if(revision===1){for(const p of peers){const delivery=deliveries.find(x=>x.membership_id===p.membership.id);d.recordReview(room.id,reg(room,p),{agendaId:agenda.id,roundId:round.id,conclusionRevision:1,stance:'disagree',sourceIds:[answers[0].id],body:'revise',requestId:delivery.request_id});}await d.tick(room.id);await c.tick(room.id);}
 }
});

test('dedicated chair completes plan, evidence, synthesis, review, and final through queued deliveries',async()=>{
 const s=new Store(),room=s.createRoom('agenda'),a=participant(s,room,'a'),b=participant(s,room,'b');let calls=0;
 const runner={initialize:async({nativeId})=>({nativeId,started:true,output:{speech:'ready'}}),resume:async({nativeId,onStarted,body})=>{onStarted();calls++;const overview=JSON.parse(body.slice(body.lastIndexOf('\n')+1));assert.equal(overview.agenda.title,'choice');assert.equal(overview.agenda.conclusionRevision,1);if(calls===2){assert.equal(overview.agenda.arguments.length,2);assert.equal(overview.agenda.arguments[0].senderSessionId,a.session.id);assert.equal(overview.agenda.rounds.at(-1).stage,'evidence');}if(calls===1)return {nativeId,started:true,output:{speech:'ask evidence',questions:[{targetMembershipIds:[a.membership.id,b.membership.id],body:'give evidence'}],proposal:null}};if(calls===2)return {nativeId,started:true,output:{speech:'candidate',questions:[],proposal:{body:'choose A',sourceIds:answers.map(x=>x.id)}}};return {nativeId,started:true,output:{speech:'final',questions:[],proposal:{body:'choose A',sourceIds:answers.map(x=>x.id)}}};}};
 const c=new ChairCoordinator(s,{runner,history:new RoomHistory(s,new KnowledgeStore(s))}),d=new DebateCoordinator(s,{chairs:c}),chair=await c.create(room.id),agenda=d.create(room.id,{title:'choice',body:'choose',targetMembershipIds:[a.membership.id,b.membership.id],requestKey:'vertical'});
 await c.tick(room.id);let state=d.get(room.id,agenda.id);assert.equal(state.phase,'collecting');const evidence=state.rounds.at(-1);for(const p of [a,b]){const delivery=s.room(room.id).deliveries.find(x=>x.membership_id===p.membership.id&&x.message_id!==undefined&&x.state==='queued');s.reply(reg(room,p),delivery.request_id,`${p.session.native_id} argument`);}
 const answers=s.room(room.id).messages.filter(x=>x.reply_request_id&&x.sender_session_id!==chair.session_id);await d.tick(room.id);await c.tick(room.id);state=d.get(room.id,agenda.id);assert.equal(state.phase,'reviewing');const review=state.rounds.at(-1);const reviewDeliveries=s.room(room.id).deliveries.filter(x=>x.membership_id===a.membership.id||x.membership_id===b.membership.id).filter(x=>x.request_id&&x.state==='queued');for(const p of [a,b]){const delivery=reviewDeliveries.find(x=>x.membership_id===p.membership.id);d.recordReview(room.id,reg(room,p),{agendaId:agenda.id,roundId:review.id,conclusionRevision:1,stance:'agree',sourceIds:[answers[0].id],body:'agree',requestId:delivery.request_id});}
 assert.ok(s.room(room.id).messages.some(x=>x.body.includes('referencesOnly')&&x.body.includes('room_history_read')));assert.ok(s.room(room.id).messages.some(x=>x.body==='a argument'));assert.ok(s.room(room.id).messages.some(x=>x.body==='b argument'));await d.tick(room.id);await c.tick(room.id);assert.equal(calls,3);assert.equal(d.get(room.id,agenda.id).outcome,'consensus');
});

test('approval notice carries the result and ACK replies to its exact delivery',async()=>{
 const s=new Store(),room=s.createRoom('approval'),p=participant(s,room,'p');
 const c=new ChairCoordinator(s,{runner:{initialize:async({nativeId})=>({nativeId,started:true,output:{speech:'ready'}}),resume:async()=>{throw Error('not used')}}});const d=new DebateCoordinator(s,{chairs:c});await c.create(room.id);
 const agenda=d.create(room.id,{title:'decision',body:'body',targetMembershipIds:[p.membership.id],requestKey:'approval'});
 s.db.prepare("UPDATE agendas SET phase='completed',outcome='consensus',current_conclusion=? WHERE id=?").run('actual final conclusion',agenda.id);
 const approved=d.approve(room.id,agenda.id,{revision:1}),notice=approved.notices[0],message=s.room(room.id).messages.find(x=>x.id===notice.message_id),content=JSON.parse(message.body);
 assert.equal(content.currentConclusion,'actual final conclusion');assert.equal(content.noticeId,notice.id);assert.equal(content.revision,1);assert.ok(Array.isArray(content.evidenceMessageIds));
 assert.throws(()=>d.ack(room.id,reg(room,p),notice.id,1),/unavailable/);s.inbox(reg(room,p),notice.request_id);const ack=d.ack(room.id,reg(room,p),notice.id,1);assert.equal(ack.status,'acknowledged');const delivery=s.room(room.id).deliveries.find(x=>x.request_id===notice.request_id);assert.equal(delivery.state,'completed');assert.equal(s.room(room.id).messages.find(x=>x.reply_request_id===notice.request_id).body,JSON.stringify({noticeId:notice.id,revision:1,acknowledged:true}));assert.deepEqual(d.ack(room.id,reg(room,p),notice.id,1),ack);
});

test('synthesis preserves a candidate body expressing genuine unresolved uncertainty instead of rejecting it',async()=>{
 const s=new Store(),room=s.createRoom('uncertain status'),a=participant(s,room,'a'),b=participant(s,room,'b');let calls=0;
 const runner={initialize:async({nativeId})=>({nativeId,started:true,output:{speech:'ready'}}),resume:async({nativeId,onStarted})=>{onStarted();calls++;if(calls===1)return {nativeId,started:true,output:{speech:'ask evidence',questions:[{targetMembershipIds:[a.membership.id,b.membership.id],body:'give evidence'}],proposal:null}};return {nativeId,started:true,output:{speech:'candidate',questions:[],proposal:{body:'결론입니다. 사용자 선호는 아직 미확인 상태입니다.',sourceIds:answers.map(x=>x.id)}}};}};
 const c=new ChairCoordinator(s,{runner}),d=new DebateCoordinator(s,{chairs:c});await c.create(room.id);
 const agenda=d.create(room.id,{title:'uncertain',body:'uncertain',targetMembershipIds:[a.membership.id,b.membership.id],requestKey:'uncertain'});
 await c.tick(room.id);
 for(const p of [a,b]){const delivery=s.room(room.id).deliveries.find(x=>x.membership_id===p.membership.id&&x.state==='queued');s.reply(reg(room,p),delivery.request_id,`${p.session.native_id} argument`);}
 const answers=s.room(room.id).messages.filter(x=>x.reply_request_id&&x.sender_session_id!==s.chair(room.id).session_id);
 await d.tick(room.id);await c.tick(room.id);
 const state=d.get(room.id,agenda.id);assert.equal(state.phase,'reviewing');assert.equal(state.current_conclusion,'결론입니다. 사용자 선호는 아직 미확인 상태입니다.');
 const run=s.room(room.id).chair_runs.at(-1);assert.equal(run.status,'completed');
});

test('a qualified review with an actionable source-backed correction forces a revision reviewed by all original reviewers',async()=>{
 const s=new Store(),room=s.createRoom('actionable'),a=participant(s,room,'a'),b=participant(s,room,'b');
 const runner={initialize:async({nativeId})=>({nativeId,started:true,output:{speech:'ready'}}),resume:async({nativeId,onStarted,body})=>{onStarted();
  if(body.includes('stage refine'))return {nativeId,started:true,output:{speech:'revised',questions:[],proposal:{body:'choose A, adjusted per b',sourceIds:answers.map(x=>x.id)}}};
  if(body.includes('stage synthesize'))return {nativeId,started:true,output:{speech:'candidate',questions:[],proposal:{body:'choose A',sourceIds:answers.map(x=>x.id)}}};
  if(body.includes('stage plan'))return {nativeId,started:true,output:{speech:'ask evidence',questions:[{targetMembershipIds:[a.membership.id,b.membership.id],body:'give evidence'}],proposal:null}};
  throw Error('unexpected chair stage');}};
 const c=new ChairCoordinator(s,{runner}),d=new DebateCoordinator(s,{chairs:c}),chair=await c.create(room.id),agenda=d.create(room.id,{title:'choice',body:'choose',targetMembershipIds:[a.membership.id,b.membership.id],requestKey:'actionable'});
 await c.tick(room.id);
 for(const p of [a,b]){const delivery=s.room(room.id).deliveries.find(x=>x.membership_id===p.membership.id&&x.state==='queued');s.reply(reg(room,p),delivery.request_id,`${p.session.native_id} argument`);}
 const answers=s.room(room.id).messages.filter(x=>x.reply_request_id&&x.sender_session_id!==chair.session_id);
 await d.tick(room.id);await c.tick(room.id);
 let state=d.get(room.id,agenda.id);assert.equal(state.phase,'reviewing');const review=state.rounds.at(-1);
 const reviewDeliveries=s.room(room.id).deliveries.filter(x=>(x.membership_id===a.membership.id||x.membership_id===b.membership.id)&&x.request_id&&x.state==='queued');
 const da=reviewDeliveries.find(x=>x.membership_id===a.membership.id),db_=reviewDeliveries.find(x=>x.membership_id===b.membership.id);
 d.recordReview(room.id,reg(room,a),{agendaId:agenda.id,roundId:review.id,conclusionRevision:1,stance:'agree',sourceIds:[answers[0].id],body:'agree',requestId:da.request_id});
 d.recordReview(room.id,reg(room,b),{agendaId:agenda.id,roundId:review.id,conclusionRevision:1,stance:'qualified',sourceIds:[answers[1].id],body:'mostly fine but needs a fix',requestId:db_.request_id,actionableCorrection:{sourceIds:[answers[1].id],note:"use b's exact figure"}});
 await d.tick(room.id);await c.tick(room.id);
 state=d.get(room.id,agenda.id);assert.equal(state.phase,'reviewing');assert.equal(state.revision,2);assert.equal(state.current_conclusion,'choose A, adjusted per b');
 const revisedRound=state.rounds.at(-1);assert.deepEqual(revisedRound.targetSnapshot.sort(),[a.membership.id,b.membership.id].sort());
 const revisedDeliveries=s.room(room.id).deliveries.filter(x=>(x.membership_id===a.membership.id||x.membership_id===b.membership.id)&&x.request_id&&x.state==='queued');
 assert.equal(revisedDeliveries.length,2);
 const candidate=s.room(room.id).messages.find(m=>m.sender_session_id===chair.session_id&&m.body==='revised');
 assert.ok(d.context(room.id,agenda.id).evidence.some(m=>m.id===candidate.id));
 // Simulate the legacy omission; restart may restore only a completed, exact current proposal.
 const run=s.room(room.id).chair_runs.find(r=>r.delivery_id&&s.room(room.id).deliveries.find(x=>x.id===r.delivery_id)?.request_id===candidate.reply_request_id);
 s.db.prepare('DELETE FROM agenda_messages WHERE agenda_id=? AND message_id=?').run(agenda.id,candidate.id);
 s.db.prepare("UPDATE chair_runs SET status='unknown' WHERE id=?").run(run.id);
 const rejected=new DebateCoordinator(s,{chairs:c});
 assert.throws(()=>rejected._validateSources(rejected.get(room.id,agenda.id),[candidate.id]),/outside this agenda/);
 s.db.prepare("UPDATE chair_runs SET status='completed',output_json=? WHERE id=?").run(JSON.stringify({proposal:{body:'different proposal'}}),run.id);
 new DebateCoordinator(s,{chairs:c});
 assert.throws(()=>rejected._validateSources(rejected.get(room.id,agenda.id),[candidate.id]),/outside this agenda/);
 s.db.prepare('UPDATE chair_runs SET output_json=? WHERE id=?').run(run.output_json,run.id);
 const recovered=new DebateCoordinator(s,{chairs:c});
 assert.ok(recovered.context(room.id,agenda.id).evidence.some(m=>m.id===candidate.id));
 new DebateCoordinator(s,{chairs:c});
 assert.equal(s.db.prepare("SELECT count(*) n FROM events WHERE event='agenda.candidate-source-recovered'").get().n,1);
 for(const p of [a,b]){
  const delivery=revisedDeliveries.find(x=>x.membership_id===p.membership.id);
  recovered.recordReview(room.id,reg(room,p),{agendaId:agenda.id,roundId:revisedRound.id,conclusionRevision:2,stance:'agree',sourceIds:[candidate.id],body:'agree with this revised proposal',requestId:delivery.request_id});
 }
 assert.equal(recovered.get(room.id,agenda.id).reviews.filter(r=>r.conclusion_revision===2).length,2);
});
test('a qualified review for a genuinely unavailable user preference does not force a revision',async()=>{
 const s=new Store(),room=s.createRoom('preference'),a=participant(s,room,'a'),b=participant(s,room,'b');
 const runner={initialize:async({nativeId})=>({nativeId,started:true,output:{speech:'ready'}}),resume:async({nativeId,onStarted,body})=>{onStarted();
  if(body.includes('stage final'))return {nativeId,started:true,output:{speech:'final',questions:[],proposal:{body:'choose A',sourceIds:answers.map(x=>x.id)}}};
  if(body.includes('stage synthesize'))return {nativeId,started:true,output:{speech:'candidate',questions:[],proposal:{body:'choose A',sourceIds:answers.map(x=>x.id)}}};
  if(body.includes('stage plan'))return {nativeId,started:true,output:{speech:'ask evidence',questions:[{targetMembershipIds:[a.membership.id,b.membership.id],body:'give evidence'}],proposal:null}};
  throw Error('unexpected chair stage');}};
 const c=new ChairCoordinator(s,{runner}),d=new DebateCoordinator(s,{chairs:c}),chair=await c.create(room.id),agenda=d.create(room.id,{title:'choice',body:'choose',targetMembershipIds:[a.membership.id,b.membership.id],requestKey:'preference'});
 await c.tick(room.id);
 for(const p of [a,b]){const delivery=s.room(room.id).deliveries.find(x=>x.membership_id===p.membership.id&&x.state==='queued');s.reply(reg(room,p),delivery.request_id,`${p.session.native_id} argument`);}
 const answers=s.room(room.id).messages.filter(x=>x.reply_request_id&&x.sender_session_id!==chair.session_id);
 await d.tick(room.id);await c.tick(room.id);
 let state=d.get(room.id,agenda.id);const review=state.rounds.at(-1);
 const reviewDeliveries=s.room(room.id).deliveries.filter(x=>(x.membership_id===a.membership.id||x.membership_id===b.membership.id)&&x.request_id&&x.state==='queued');
 const da=reviewDeliveries.find(x=>x.membership_id===a.membership.id),db_=reviewDeliveries.find(x=>x.membership_id===b.membership.id);
 d.recordReview(room.id,reg(room,a),{agendaId:agenda.id,roundId:review.id,conclusionRevision:1,stance:'agree',sourceIds:[answers[0].id],body:'agree',requestId:da.request_id});
 d.recordReview(room.id,reg(room,b),{agendaId:agenda.id,roundId:review.id,conclusionRevision:1,stance:'qualified',sourceIds:[answers[1].id],body:'fine, but the exact user preference here is unknown to me',requestId:db_.request_id});
 await d.tick(room.id);await c.tick(room.id);
 state=d.get(room.id,agenda.id);assert.equal(state.phase,'completed');assert.equal(state.outcome,'qualified');assert.equal(state.revision,1);
});
test('revoked approval notice rejects acknowledgement',async()=>{
 const s=new Store(),room=s.createRoom('revoked'),p=participant(s,room,'p');
 const c=new ChairCoordinator(s,{runner:{initialize:async({nativeId})=>({nativeId,started:true,output:{speech:'ready'}})}});const d=new DebateCoordinator(s,{chairs:c});await c.create(room.id);const agenda=d.create(room.id,{title:'x',body:'x',targetMembershipIds:[p.membership.id],requestKey:'revoked'});s.db.prepare("UPDATE agendas SET phase='completed',outcome='consensus',current_conclusion='x' WHERE id=?").run(agenda.id);const notice=d.approve(room.id,agenda.id,{revision:1}).notices[0];s.db.prepare("UPDATE approval_notices SET status='revoked',revoked_at=? WHERE id=?").run(new Date().toISOString(),notice.id);assert.throws(()=>d.ack(room.id,reg(room,p),notice.id,1),/revoked/);
});
