import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../services/coordinator/store.js';
import {ChairCoordinator} from '../services/coordinator/chair.js';
import {DebateCoordinator} from '../services/coordinator/debate.js';
import {ParticipantDispatcher} from '../services/coordinator/participant-dispatcher.js';

async function fixture(options={}){
 const file=join(mkdtempSync(join(tmpdir(),'reactive-')),'room.sqlite'),store=new Store(file),room=store.createRoom('reactive fixture');
 const people=['one','two','three'].map(nativeId=>{const session=store.registerSession({provider:'codex',host:'test',nativeId,cwd:'C:/fixture',profile:'default',mode:'live_attach',verified:true,handle:nativeId,incarnation:'inc',capabilities:{followup:true,automaticInput:true}}).session,member=store.join(room.id,session.id,false);return {session,member,reg:{room_id:room.id,session_id:session.id,membership_id:member.id}};});
 let calls=0,clock=Date.now();const runner={initialize:async({nativeId})=>({nativeId,started:true,output:{speech:'ready'}}),resume:async({nativeId,onStarted=()=>{},body=''})=>{calls++;onStarted();const currentInput=JSON.parse(body.split('\n').at(-1)).currentInput,answers=store.room(room.id).messages.filter(m=>m.kind==='post'&&people.some(p=>p.session.id===m.sender_session_id));return {nativeId,started:true,output:{speech:'chair',questions:currentInput.includes('stage plan')?[{targetMembershipIds:[people[0].member.id],body:'research'}]:[],proposal:currentInput.includes('stage plan')?null:{body:'candidate',sourceIds:answers.map(m=>m.id)}}};}};
 const chairs=new ChairCoordinator(store,{runner}),debates=new DebateCoordinator(store,{chairs});await chairs.create(room.id);
 const agenda=debates.create(room.id,{title:'policy',body:'compare source retention',discussionMode:'reactive',requestBudget:18,relevanceBudget:4,chairBudget:12,targetMembershipIds:people.map(p=>p.member.id),...options});debates.reactive.clock=()=>clock;
 await chairs.tick(room.id);
 const first=store.room(room.id).deliveries.find(d=>d.membership_id===people[0].member.id&&d.state==='queued');
 const answer=store.reply(people[0].reg,first.request_id,'source argument').message;
 return {file,store,room,people,chairs,debates,agenda,answer,advance:ms=>clock+=ms,calls:()=>calls,current:()=>debates.get(room.id,agenda.id)};
}
const intents=f=>f.current().reactive.intents;
function offer(f,intent){const p=f.people.find(p=>p.member.id===intent.membershipId),d=f.store.db.prepare('SELECT * FROM deliveries WHERE message_id=? AND membership_id=?').get(intent.message_id,p.member.id);f.store.inbox(p.reg,d.request_id);return {p,d};}
function abstain(f,intent){const {p,d}=offer(f,intent);return f.debates.reactive.decide(p.reg,{agendaId:f.agenda.id,intentId:intent.id,decision:'abstain',reason:'no new evidence',sourceIds:intent.sourceIds});}

test('GET/list remain pure and a two-source batch creates one notification per nonself peer',async()=>{
 const f=await fixture();try{
  f.store.post({roomId:f.room.id,senderSessionId:f.people[0].session.id,body:'second reason',replyTo:f.answer.id});await f.debates.tick(f.room.id);
  const counts=()=>JSON.stringify(['messages','deliveries','reactive_events','reactive_intents','agenda_calls'].map(table=>f.store.db.prepare('SELECT count(*) n FROM '+table).get().n)),before=counts();for(let i=0;i<5;i++){f.debates.get(f.room.id,f.agenda.id);f.debates.list(f.room.id);}assert.equal(counts(),before);
  f.advance(1999);await f.debates.tick(f.room.id);assert.equal(intents(f).length,0);f.advance(1);await f.debates.tick(f.room.id);assert.equal(intents(f).length,2);assert.ok(intents(f).every(intent=>intent.sourceIds.length===2&&intent.membershipId!==f.people[0].member.id));
  await f.debates.tick(f.room.id);assert.equal(intents(f).length,2);assert.equal(f.current().phase,'collecting');
 }finally{f.store.db.close();}
});
test('private abstain completes only the offered request without publishing or double release',async()=>{
 const f=await fixture();try{await f.debates.tick(f.room.id);f.advance(2000);await f.debates.tick(f.room.id);const intent=intents(f)[0],{p,d}=offer(f,intent),messages=f.store.room(f.room.id).messages.length;
  const input={agendaId:f.agenda.id,intentId:intent.id,decision:'abstain',sourceIds:intent.sourceIds};f.debates.reactive.decide(p.reg,input);assert.equal(f.store.room(f.room.id).messages.length,messages);assert.equal(f.store.db.prepare('SELECT state FROM deliveries WHERE id=?').get(d.id).state,'completed');assert.equal(f.store.db.prepare('SELECT unresolved_delivery_id FROM writers WHERE session_id=?').get(p.session.id).unresolved_delivery_id,null);assert.equal(f.debates.reactive.decide(p.reg,input).status,'abstained');assert.throws(()=>f.debates.reactive.decide(p.reg,{...input,decision:'speak'}),/conflict/);
 }finally{f.store.db.close();}
});
test('speak can precede or follow the exact authenticated public answer',async()=>{
 for(const first of ['decision','reply']){const f=await fixture();try{await f.debates.tick(f.room.id);f.advance(2000);await f.debates.tick(f.room.id);const intent=intents(f)[0],{p,d}=offer(f,intent),input={agendaId:f.agenda.id,intentId:intent.id,decision:'speak',sourceIds:intent.sourceIds};
  if(first==='decision')f.debates.reactive.decide(p.reg,input);f.store.reply(p.reg,d.request_id,'relevant reason');const result=f.debates.reactive.decide(p.reg,input);f.debates.reactive.reconcile(f.current());assert.equal(intents(f).find(i=>i.id===intent.id).status,'completed');assert.equal(f.store.db.prepare('SELECT unresolved_delivery_id FROM writers WHERE session_id=?').get(p.session.id).unresolved_delivery_id,null);assert.ok(result);
 }finally{f.store.db.close();}}
});
test('cooldown defers events instead of dropping them, and expiry preserves an unrelated writer',async()=>{
 const f=await fixture({relevanceBudget:12});try{
  await f.debates.tick(f.room.id);f.advance(2000);await f.debates.tick(f.room.id);for(const intent of intents(f))abstain(f,intent);
  f.store.post({roomId:f.room.id,senderSessionId:f.people[0].session.id,body:'new reason during cooldown',replyTo:f.answer.id});await f.debates.tick(f.room.id);f.advance(2000);await f.debates.tick(f.room.id);assert.equal(intents(f).length,2);assert.ok(f.store.db.prepare("SELECT count(*) n FROM reactive_event_targets WHERE status='pending'").get().n);
  f.advance(8000);await f.debates.tick(f.room.id);assert.equal(intents(f).length,4);
  for(const intent of intents(f).filter(i=>i.status==='queued'))abstain(f,intent);
  const p=f.people[1],other=f.store.createRoom('other'),m=f.store.join(other.id,p.session.id,false),d=f.store.post({roomId:other.id,body:'unrelated work',kind:'followup',targets:[m.id]}).deliveries[0],claim=f.store.claim(d.id);f.store.fence(d.id,claim.fence);
  f.store.post({roomId:f.room.id,senderSessionId:f.people[0].session.id,body:'last new reason',replyTo:f.answer.id});await f.debates.tick(f.room.id);f.advance(121000);await f.debates.tick(f.room.id);assert.equal(f.store.db.prepare('SELECT unresolved_delivery_id FROM writers WHERE session_id=?').get(p.session.id).unresolved_delivery_id,d.id);assert.ok(f.store.db.prepare("SELECT count(*) n FROM reactive_event_targets WHERE status='expired'").get().n);
 }finally{f.store.db.close();}
});
test('restart retains unknown native fence and never creates a duplicate notification',async()=>{
 const f=await fixture();await f.debates.tick(f.room.id);f.advance(2000);await f.debates.tick(f.room.id);const intent=intents(f)[0],{p,d}=offer(f,intent);f.store.db.close();
 const reopened=new Store(f.file),debates=new DebateCoordinator(reopened);try{await debates.tick(f.room.id);assert.equal(debates.get(f.room.id,f.agenda.id).reactive.intents.length,2);assert.equal(reopened.db.prepare('SELECT unresolved_delivery_id FROM writers WHERE session_id=?').get(p.session.id).unresolved_delivery_id,d.id);assert.equal(debates.get(f.room.id,f.agenda.id).reactive.intents.find(i=>i.id===intent.id).status,'unknown');}finally{reopened.db.close();}
});
test('peer questions enforce agenda scope, stable idempotency, review reserve and recipient completion',async()=>{
 const f=await fixture();try{
  await f.debates.tick(f.room.id);const [a,b]=f.people,input={agendaId:f.agenda.id,body:'compare this constraint?',targets:[b.member.id],sourceIds:[f.answer.id],requestId:'question-1',replyTo:f.answer.id};
  assert.throws(()=>f.debates.reactive.beforeLegacyRequest(a.reg),/agendaId/);
  const first=f.debates.reactive.request(a.reg,input),again=f.debates.reactive.request(a.reg,input);assert.equal(first.id,again.id);assert.throws(()=>f.debates.reactive.request(a.reg,{...input,body:'changed'}),/conflict/);
  const unrelated=f.store.post({roomId:f.room.id,body:'unrelated'}).message;assert.throws(()=>f.debates.reactive.request(a.reg,{...input,requestId:'bad',sourceIds:[unrelated.id]}),/outside/);assert.throws(()=>f.debates.reactive.request({...a.reg,session_id:'forged'},input),/active/);
  const delivery=f.store.room(f.room.id).deliveries.find(d=>d.message_id===first.message_id);f.store.reply(b.reg,delivery.request_id,'recipient answer');f.debates.reactive.reconcile(f.current());assert.equal(intents(f).find(i=>i.id===first.id).status,'completed');
  f.store.db.prepare('UPDATE agendas SET requests_used=request_budget-? WHERE id=?').run(3,f.agenda.id);assert.throws(()=>f.debates.reactive.request(a.reg,{...input,requestId:'over'}),/reserved/);
  f.debates.reactive.yield(f.current(),{targetMembershipIds:[a.member.id],reason:'finish current response'});assert.throws(()=>f.debates.reactive.request(a.reg,{...input,requestId:'after-yield'}),/마무리 요청/);
 }finally{f.store.db.close();}
});
test('reactions notify only the author for substantive feedback and respect the same finite budget',async()=>{
 const f=await fixture({relevanceBudget:0});try{await f.debates.tick(f.room.id);const actor=f.people[1];f.store.react(actor.reg,f.answer.id,'👍',true);f.store.react(actor.reg,f.answer.id,'❓',true);await f.debates.tick(f.room.id);f.advance(2000);await f.debates.tick(f.room.id);assert.equal(intents(f).length,0);const events=f.store.db.prepare("SELECT * FROM reactive_events WHERE source_id LIKE 'reaction:%'").all();assert.equal(events.length,2);assert.equal(f.store.db.prepare("SELECT count(*) n FROM reactive_event_targets WHERE status='pending'").get().n,0);assert.equal(f.current().reactive.budgets.relevance,0);
 }finally{f.store.db.close();}
});
test('direct exchange and abstain reach synthesis, all original reviewers, and exact final consensus',async()=>{
 const f=await fixture();try{
  await f.debates.tick(f.room.id);f.advance(2000);await f.debates.tick(f.room.id);const first=intents(f)[0],{p,d}=offer(f,first);f.debates.reactive.decide(p.reg,{agendaId:f.agenda.id,intentId:first.id,decision:'speak',sourceIds:first.sourceIds});const contribution=f.store.reply(p.reg,d.request_id,'a distinct concern').message;abstain(f,intents(f)[1]);await f.debates.tick(f.room.id);
  const other=f.people.find(person=>person.member.id===intents(f)[1].membershipId),question=f.debates.reactive.request(p.reg,{agendaId:f.agenda.id,body:'please compare?',targets:[other.member.id],sourceIds:[contribution.id],replyTo:contribution.id,requestId:'direct'}),qd=f.store.room(f.room.id).deliveries.find(d=>d.message_id===question.message_id);f.store.reply(other.reg,qd.request_id,'comparison complete');
  for(let i=0;i<5;i++){f.advance(12000);await f.debates.tick(f.room.id);for(const intent of intents(f).filter(i=>i.kind==='relevance'&&i.status==='queued'))abstain(f,intent);}
  await f.debates.tick(f.room.id);await f.chairs.tick(f.room.id);const current=f.current(),round=current.rounds.at(-1);assert.equal(current.phase,'reviewing',JSON.stringify({intents:current.reactive.intents.map(i=>({kind:i.kind,status:i.status,member:i.membershipId})),pending:f.store.room(f.room.id).deliveries.filter(d=>!['completed','cancelled'].includes(d.state)),runs:f.store.room(f.room.id).chair_runs.map(r=>({status:r.status,error:r.error})),events:f.store.db.prepare('SELECT * FROM reactive_event_targets').all()}));assert.deepEqual(round.targetSnapshot.sort(),f.people.map(p=>p.member.id).sort());
  for(const p of f.people){const delivery=f.store.room(f.room.id).deliveries.find(d=>d.membership_id===p.member.id&&d.state==='queued');f.debates.recordReview(f.room.id,p.reg,{agendaId:current.id,roundId:round.id,conclusionRevision:current.revision,stance:'agree',sourceIds:[f.answer.id],body:'agree after reading',requestId:delivery.request_id});}
  assert.throws(()=>f.debates.reactive.request(f.people[0].reg,{agendaId:current.id,body:'late peer question',targets:[f.people[1].member.id],sourceIds:[f.answer.id]}),/최종 검토/);
  const chairMember=f.store.room(f.room.id).members.find(m=>m.role==='chair');
  const mediation=f.debates.reactive.request(f.people[0].reg,{agendaId:current.id,body:'confirm the remaining condition',targets:[chairMember.id],sourceIds:[f.answer.id]});
  await f.debates.tick(f.room.id);assert.equal(f.store.db.prepare("SELECT count(*) n FROM agenda_messages WHERE agenda_id=? AND kind='chair:final'").get(current.id).n,0);
  await f.chairs.tick(f.room.id);f.debates.reactive.reconcile(f.current());assert.equal(f.current().reactive.interventions.find(i=>i.id===mediation.id).status,'completed');
  await f.debates.tick(f.room.id);await f.chairs.tick(f.room.id);assert.equal(f.current().outcome,'consensus');assert.equal(f.current().current_conclusion,'candidate');assert.equal(f.current().reviews.length,3);assert.ok(f.current().chair_calls>=3);assert.doesNotThrow(()=>f.debates.reactive.beforeLegacyRequest(f.people[0].reg));
 }finally{f.store.db.close();}
});
test('model resume budget counts context continuations before invocation and respects pause',async()=>{
 const f=await fixture({chairBudget:2});try{const message=f.store.db.prepare("SELECT message_id FROM agenda_messages WHERE agenda_id=? AND kind='chair:plan'").get(f.agenda.id),delivery={message_id:message.message_id},run={id:'context-test'},args={nativeId:f.store.chair(f.room.id).native_id,body:JSON.stringify({currentInput:'context continuation'})};
  await f.chairs.resumeNative(f.room.id,delivery,run,args,'context');assert.equal(f.current().chair_calls,2);assert.equal(f.calls(),2);await assert.rejects(f.chairs.resumeNative(f.room.id,delivery,run,args,'context'),{code:'AGENDA_CALL_BUDGET'});assert.equal(f.calls(),2);assert.equal(f.current().reactive.callsLedger.length,2);
  f.debates.action(f.room.id,f.agenda.id,'pause');await assert.rejects(f.chairs.resumeNative(f.room.id,delivery,run,args),{code:'AGENDA_INACTIVE'});assert.equal(f.calls(),2);
 }finally{f.store.db.close();}
});
test('an agenda waiting for peer input cannot starve another agenda in the same room',async()=>{
 const f=await fixture();try{await f.debates.tick(f.room.id);const other=f.debates.create(f.room.id,{title:'legacy',body:'separate topic',discussionMode:'chair',targetMembershipIds:f.people.map(p=>p.member.id)});await f.chairs.tick(f.room.id);const request=f.store.room(f.room.id).deliveries.find(d=>d.membership_id===f.people[0].member.id&&d.state==='queued');f.store.reply(f.people[0].reg,request.request_id,'other response');await f.debates.tick(f.room.id);assert.ok(f.store.db.prepare("SELECT 1 FROM agenda_messages WHERE agenda_id=? AND kind='chair:synthesize'").get(other.id));assert.equal(f.current().phase,'collecting');}finally{f.store.db.close();}
});
test('substantive feedback wakes its author, while agreement, receipt and reviewing reactions do not',async()=>{
 const f=await fixture({relevanceBudget:6});try{
  await f.debates.tick(f.room.id);f.advance(2000);await f.debates.tick(f.room.id);for(const intent of intents(f))abstain(f,intent);
  for(const emoji of ['👍','✅','👀'])f.store.react(f.people[1].reg,f.answer.id,emoji,true);
  await f.debates.tick(f.room.id);f.advance(2000);await f.debates.tick(f.room.id);assert.equal(intents(f).length,2);
  assert.equal(f.store.reactionFeedback(f.room.id,f.people[0].session.id).find(r=>r.emoji==='👀').label,'검토 중');
  f.store.react(f.people[1].reg,f.answer.id,'👀',false);assert.equal(f.store.room(f.room.id).reactions.some(r=>r.emoji==='👀'),false);
  f.store.react(f.people[1].reg,f.answer.id,'❓',true);await f.debates.tick(f.room.id);f.advance(2000);await f.debates.tick(f.room.id);const all=intents(f);assert.equal(all.length,3);assert.equal(all.at(-1).membershipId,f.people[0].member.id);assert.deepEqual(all.at(-1).sourceIds,[f.answer.id]);
 }finally{f.store.db.close();}
});
test('a single authenticated call reacts to the exact source and completes the notification',async()=>{
 const f=await fixture();try{
  await f.debates.tick(f.room.id);f.advance(2000);await f.debates.tick(f.room.id);const intent=intents(f)[0],{p,d}=offer(f,intent);
  const input={agendaId:f.agenda.id,intentId:intent.id,decision:'abstain',sourceIds:intent.sourceIds,reaction:{messageId:intent.sourceIds[0],emoji:'✅',active:true}};
  const result=f.debates.reactive.decide(p.reg,input);
  assert.equal(result.status,'abstained');
  assert.ok(f.store.room(f.room.id).reactions.some(r=>r.message_id===intent.sourceIds[0]&&r.emoji==='✅'&&r.session_id===p.session.id));
  assert.equal(f.store.db.prepare('SELECT state FROM deliveries WHERE id=?').get(d.id).state,'completed');
  assert.throws(()=>f.debates.reactive.decide(p.reg,{...input,decision:'speak'}),/conflict/);
 }finally{f.store.db.close();}
});
test('a reaction targeting a message outside the notification sources is rejected',async()=>{
 const f=await fixture();try{
  await f.debates.tick(f.room.id);f.advance(2000);await f.debates.tick(f.room.id);const intent=intents(f)[0],{p}=offer(f,intent),outside=f.store.post({roomId:f.room.id,body:'unrelated'}).message;
  assert.throws(()=>f.debates.reactive.decide(p.reg,{agendaId:f.agenda.id,intentId:intent.id,decision:'abstain',sourceIds:intent.sourceIds,reaction:{messageId:outside.id,emoji:'✅',active:true}}),/exact source/);
 }finally{f.store.db.close();}
});
test('caller-supplied sourceIds cannot widen a reaction beyond the persisted notification sources',async()=>{
 const f=await fixture();try{
  await f.debates.tick(f.room.id);f.advance(2000);await f.debates.tick(f.room.id);const intent=intents(f)[0],{p}=offer(f,intent),outside=f.store.post({roomId:f.room.id,body:'unrelated but cited'}).message;
  assert.throws(()=>f.debates.reactive.decide(p.reg,{agendaId:f.agenda.id,intentId:intent.id,decision:'abstain',sourceIds:[...intent.sourceIds,outside.id],reaction:{messageId:outside.id,emoji:'✅',active:true}}),/exact source/);
  assert.equal(f.store.room(f.room.id).reactions.some(r=>r.message_id===outside.id),false);
 }finally{f.store.db.close();}
});
test('a changed repeated decide payload conflicts without applying a second reaction',async()=>{
 const f=await fixture();try{
  await f.debates.tick(f.room.id);f.advance(2000);await f.debates.tick(f.room.id);const intent=intents(f)[0],{p,d}=offer(f,intent);
  const input={agendaId:f.agenda.id,intentId:intent.id,decision:'abstain',sourceIds:intent.sourceIds,reaction:{messageId:intent.sourceIds[0],emoji:'✅',active:true}};
  f.debates.reactive.decide(p.reg,input);
  assert.throws(()=>f.debates.reactive.decide(p.reg,{...input,reaction:{messageId:intent.sourceIds[0],emoji:'👍',active:true}}),/conflict/);
  const reactions=f.store.room(f.room.id).reactions.filter(r=>r.message_id===intent.sourceIds[0]);
  assert.equal(reactions.length,1);assert.equal(reactions[0].emoji,'✅');
 }finally{f.store.db.close();}
});
test('cooperative yield retains a running writer and paused completion stays private',async()=>{
 const f=await fixture();try{await f.debates.tick(f.room.id);f.advance(2000);await f.debates.tick(f.room.id);const intent=intents(f)[0],{p,d}=offer(f,intent);f.debates.reactive.yield(f.current(),{targetMembershipIds:[p.member.id],reason:'wrap up this point'});assert.equal(f.store.db.prepare('SELECT unresolved_delivery_id FROM writers WHERE session_id=?').get(p.session.id).unresolved_delivery_id,d.id);assert.equal(f.current().reactive.intents.find(i=>i.id===intent.id).status,'yield_requested');f.debates.action(f.room.id,f.agenda.id,'pause');const count=f.store.room(f.room.id).messages.length;f.debates.reactive.decide(p.reg,{agendaId:f.agenda.id,intentId:intent.id,decision:'abstain',sourceIds:intent.sourceIds});assert.equal(f.store.room(f.room.id).messages.length,count);assert.equal(f.store.db.prepare('SELECT unresolved_delivery_id FROM writers WHERE session_id=?').get(p.session.id).unresolved_delivery_id,null);assert.equal(f.current().phase,'paused');assert.throws(()=>f.debates.reactive.beforeLegacyRequest(p.reg),/agendaId/);}finally{f.store.db.close();}
});

test('malformed moderation and exhausted mediation create no intervention or delivery',async()=>{
 const f=await fixture({chairBudget:1});try{
  const count=()=>f.store.room(f.room.id).deliveries.length,before=count();
  for(const moderation of [{action:'yield',targetMembershipIds:[f.people[0].member.id]},{action:'mediate',reason:' '},{action:'bogus',reason:'reason'}])assert.throws(()=>f.debates.reactive.applyModeration(f.current(),moderation),/valid action and reason/);
  assert.throws(()=>f.debates.reactive.yield(f.current(),{reason:'mediate now'}),/좌장 호출 한도/);
  assert.equal(count(),before);assert.equal(f.current().reactive.interventions.length,0);
 }finally{f.store.db.close();}
});

test('replayed peer-to-chair mediation is durable and payload conflicts never queue twice',async()=>{
 const f=await fixture();try{
  const chair=f.store.room(f.room.id).members.find(m=>m.role==='chair'),input={agendaId:f.agenda.id,body:'resolve the evidence boundary',targets:[chair.id],sourceIds:[f.answer.id],requestId:'mediation-1'},before=f.store.room(f.room.id).deliveries.length;
  const first=f.debates.reactive.request(f.people[0].reg,input),again=f.debates.reactive.request(f.people[0].reg,input);assert.equal(again.id,first.id);assert.equal(f.store.room(f.room.id).deliveries.length,before+1);
  assert.throws(()=>f.debates.reactive.request(f.people[0].reg,{...input,body:'changed request'}),/idempotency conflict/);
  assert.throws(()=>f.debates.reactive.request(f.people[0].reg,{...input,targets:[f.people[1].member.id]}),/idempotency conflict/);
  assert.equal(f.current().reactive.interventions.length,1);
 }finally{f.store.db.close();}
});

test('four direct exchanges between the same peers queue one chair mediation',async()=>{
 const f=await fixture();try{
  for(let index=0;index<4;index++){
   const actor=f.people[index%2],target=f.people[(index+1)%2],question=f.debates.reactive.request(actor.reg,{agendaId:f.agenda.id,body:'clarify constraint '+index,targets:[target.member.id],sourceIds:[f.answer.id],requestId:'exchange-'+index}),d=f.store.room(f.room.id).deliveries.find(d=>d.message_id===question.message_id);
   f.store.reply(target.reg,d.request_id,'answer '+index);f.debates.reactive.reconcile(f.current());
  }
  assert.equal(f.current().reactive.interventions.length,1);assert.equal(f.current().reactive.interventions[0].action,'mediate');assert.equal(f.store.db.prepare("SELECT count(*) n FROM agenda_messages WHERE agenda_id=? AND kind='chair:discussion'").get(f.agenda.id).n,1);
 }finally{f.store.db.close();}
});

test('chair budget refusal before a continuation closes its fence without an unknown writer',async()=>{
 const f=await fixture({chairBudget:1,relevanceBudget:0});try{
  await f.debates.tick(f.room.id);f.advance(2000);await f.debates.tick(f.room.id);await f.chairs.tick(f.room.id);
  assert.equal(f.calls(),1);assert.equal(f.current().outcome,'limit_reached');
  const chair=f.store.chair(f.room.id);assert.equal(f.store.db.prepare('SELECT unresolved_delivery_id FROM writers WHERE session_id=?').get(chair.session_id).unresolved_delivery_id,null);
  assert.equal(f.store.room(f.room.id).chair_runs.at(-1).status,'cancelled');
 }finally{f.store.db.close();}
});

test('participant call ledger distinguishes receipt, start, not-sent and uncertain submission',async()=>{
 for(const state of ['accepted','running','not_sent','unknown']){
  const f=await fixture();try{
   f.debates.reactive.request(f.people[0].reg,{agendaId:f.agenda.id,body:'peer question',targets:[f.people[1].member.id],sourceIds:[f.answer.id]});
   const adapter={preflight:async()=>({ok:true}),send:async()=>state==='not_sent'?{ok:false,reason:'refused before input'}:state==='unknown'?{ok:false,reason:'receipt uncertain',receipt:{id:'receipt'}}:{ok:true,stage:state==='running'?'turn_started':'host_receipt',receipt:{id:'receipt'}}};
   const dispatcher=new ParticipantDispatcher(f.store,{adapter,privateDir:mkdtempSync(join(tmpdir(),'ledger-'))});dispatcher.debates=f.debates;
   const row=dispatcher.eligible()[0];await dispatcher.dispatch(row);
   const calls=f.current().reactive.callsLedger.filter(c=>c.delivery_id===row.id);assert.equal(calls.length,1);assert.equal(calls[0].status,state);
   if(state==='not_sent'){assert.equal(f.store.db.prepare('SELECT state FROM deliveries WHERE id=?').get(row.id).state,'queued');assert.equal(f.store.db.prepare('SELECT unresolved_delivery_id FROM writers WHERE session_id=?').get(row.session_id).unresolved_delivery_id,null);}
   if(state==='accepted'||state==='running'){
    const count=f.current().requests_used,record=f.store.db.prepare('SELECT * FROM participant_dispatches WHERE delivery_id=?').get(row.id);await dispatcher.observe(row,record);assert.equal(f.current().requests_used,count);
    f.store.reply(f.people[1].reg,row.request_id,'answer');f.debates.reactive.reconcile(f.current());assert.equal(f.current().reactive.callsLedger.find(c=>c.delivery_id===row.id).status,'completed');await dispatcher.observe(row,record);assert.equal(f.current().reactive.callsLedger.find(c=>c.delivery_id===row.id).status,'completed');
   }
  }finally{f.store.db.close();}
 }
});

test('prepared recovery is charged once while receipt observation is free and budget refusal never submits',async()=>{
 const f=await fixture();try{
  f.debates.reactive.request(f.people[0].reg,{agendaId:f.agenda.id,body:'peer question',targets:[f.people[1].member.id],sourceIds:[f.answer.id]});let sends=0;
  const adapter={preflight:async()=>({ok:true}),send:async(_b,_s,_p,_id,options)=>{if(!options.observeOnly)sends++;return {ok:true,stage:'turn_started',receipt:{id:'receipt'}};}},dispatcher=new ParticipantDispatcher(f.store,{adapter,privateDir:mkdtempSync(join(tmpdir(),'ledger-'))});dispatcher.debates=f.debates;
  const row=dispatcher.eligible()[0];await dispatcher.dispatch(row);const before=f.current().requests_used;await dispatcher.retry(f.room.id,row.id);assert.equal(f.current().requests_used,before+1);assert.equal(sends,2);assert.equal(f.current().reactive.callsLedger.filter(c=>c.delivery_id===row.id).length,2);
  await dispatcher.retry(f.room.id,row.id);assert.equal(sends,2);assert.equal(f.current().requests_used,before+1);
  const other=f.debates.reactive.request(f.people[0].reg,{agendaId:f.agenda.id,body:'second question',targets:[f.people[2].member.id],sourceIds:[f.answer.id]}),second=dispatcher.eligible().find(r=>r.message_id===other.message_id);
  f.debates.action(f.room.id,f.agenda.id,'pause');const refused=await dispatcher.dispatch(second);assert.equal(refused.state,'queued');assert.equal(sends,2);assert.equal(f.store.db.prepare('SELECT state FROM deliveries WHERE id=?').get(second.id).state,'queued');
 }finally{f.store.db.close();}
});
