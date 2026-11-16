import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../services/coordinator/store.js';
import {ChairCoordinator} from '../services/coordinator/chair.js';
import {DebateCoordinator} from '../services/coordinator/debate.js';
import {KnowledgeStore} from '../services/coordinator/knowledge.js';
async function fixture(options={}) {
 const store=new Store(),room=store.createRoom('fixture');
 const people=['one','two'].map(nativeId=>{const session=store.registerSession({provider:'codex',host:'test',nativeId,cwd:'C:/fixture',profile:'default',mode:'live_attach',verified:true,capabilities:{followup:true}}).session;const member=store.join(room.id,session.id,false);return {session,member,reg:{room_id:room.id,session_id:session.id,membership_id:member.id}}});
 let step=0;const runner={initialize:async({nativeId})=>({nativeId,started:true,output:{speech:'ready'}}),resume:async({nativeId,onStarted})=>{onStarted();step++;const answers=store.room(room.id).messages.filter(m=>people.some(p=>p.session.id===m.sender_session_id)&&m.reply_request_id&&m.body.endsWith(' argument'));return {nativeId,started:true,output:{speech:'chair '+step,questions:step===1?[{targetMembershipIds:people.map(p=>p.member.id),body:'research'}]:[],proposal:step===1?null:{body:step===2?'candidate':'final supported result',sourceIds:answers.map(m=>m.id)}}}}};
 const knowledge=new KnowledgeStore(store),chairs=new ChairCoordinator(store,{runner}),debates=new DebateCoordinator(store,{chairs,knowledge});await chairs.create(room.id);
 const agenda=debates.create(room.id,{title:'choice',body:'compare evidence',roundBudget:3,requestBudget:8,...options});
 return {store,room,people,knowledge,chairs,debates,agenda,close:()=>store.db.close()};
}
async function collect(f){await f.chairs.tick(f.room.id);for(const p of f.people){const d=f.store.room(f.room.id).deliveries.find(d=>d.membership_id===p.member.id&&d.state==='queued');f.store.reply(p.reg,d.request_id,p.session.native_id+' argument')}await f.debates.tick(f.room.id);await f.chairs.tick(f.room.id);}
function review(f,stance='agree'){const a=f.debates.get(f.room.id,f.agenda.id),round=a.rounds.at(-1),args=f.debates.context(f.room.id,a.id).evidence.filter(m=>f.people.some(p=>p.session.id===m.sender_session_id));return f.people.map(p=>{const d=f.store.room(f.room.id).deliveries.find(d=>d.membership_id===p.member.id&&d.state==='queued');const payload={agendaId:a.id,roundId:round.id,conclusionRevision:a.revision,stance,sourceIds:[args[0].id],body:'review '+stance,requestId:d.request_id};return {p,payload,result:f.debates.recordReview(f.room.id,p.reg,payload)}})}
test('exact participant request/round budgets still allow final synthesis and versioned knowledge',async()=>{const f=await fixture({roundBudget:2,requestBudget:4});try{await collect(f);const records=review(f);await f.debates.tick(f.room.id);await f.chairs.tick(f.room.id);const final=f.debates.get(f.room.id,f.agenda.id);assert.equal(final.outcome,'consensus');assert.equal(final.current_conclusion,'final supported result');assert.equal(f.knowledge.list(f.room.id,{kind:'argument'}).items.length,4);assert.equal(f.knowledge.list(f.room.id,{kind:'consensus'}).items.length,1);assert.equal(f.debates.recordReview(f.room.id,records[0].p.reg,records[0].payload).id,records[0].result.id);assert.throws(()=>f.debates.recordReview(f.room.id,records[0].p.reg,{...records[0].payload,body:'different'}),/conflict/);}finally{f.close()}});
test('conditional review produces qualified result and preserves review conditions',async()=>{const f=await fixture();try{await collect(f);review(f,'qualified');await f.debates.tick(f.room.id);await f.chairs.tick(f.room.id);assert.equal(f.debates.get(f.room.id,f.agenda.id).outcome,'qualified')}finally{f.close()}});

test('synthesis permits agenda root plus current answers but rejects root-only and unrelated references',async()=>{
 for(const condition of ['valid','root-only','unrelated','foreign']){const f=await fixture();try{
  await f.chairs.tick(f.room.id);for(const p of f.people){const d=f.store.room(f.room.id).deliveries.find(d=>d.membership_id===p.member.id&&d.state==='queued');f.store.reply(p.reg,d.request_id,p.session.native_id+' argument');}await f.debates.tick(f.room.id);
  const a=f.debates.get(f.room.id,f.agenda.id),answers=a.arguments.map(m=>m.id),other=f.store.post({roomId:condition==='foreign'?f.store.createRoom('private').id:f.room.id,body:'unrelated private source'}).message,sourceIds=condition==='valid'?[a.root_message_id,...answers]:condition==='root-only'?[a.root_message_id]:[...answers,other.id];
  f.chairs.runner.resume=async({nativeId,onStarted})=>{onStarted();return {nativeId,started:true,output:{speech:'candidate with scoped sources',questions:[],proposal:{body:'evidence and user requirements',sourceIds}}};};
  const run=await f.chairs.tick(f.room.id);assert.equal(run.status,condition==='valid'?'completed':'unknown',condition);assert.equal(f.debates.get(f.room.id,a.id).phase,condition==='valid'?'reviewing':'collecting',condition);assert.equal(f.store.room(f.room.id).messages.some(m=>m.body==='candidate with scoped sources'),condition==='valid',condition);
 }finally{f.close();}}
});
test('review rejects unrelated same-room messages and invalid budgets',async()=>{const f=await fixture();try{assert.throws(()=>f.debates.create(f.room.id,{title:'bad',body:'bad',roundBudget:0}),/budget/);await collect(f);const a=f.debates.get(f.room.id,f.agenda.id),p=f.people[0],d=f.store.room(f.room.id).deliveries.find(x=>x.membership_id===p.member.id&&x.state==='queued');const unrelated=f.store.post({roomId:f.room.id,body:'unrelated'}).message;assert.throws(()=>f.debates.recordReview(f.room.id,p.reg,{agendaId:a.id,roundId:a.rounds.at(-1).id,conclusionRevision:1,stance:'agree',body:'fake',sourceIds:[unrelated.id],requestId:d.request_id}),/outside this agenda/)}finally{f.close()}});
test('pause blocks pending chair delivery; resume applies saved work and cancel remains terminal',async()=>{const f=await fixture();try{f.debates.action(f.room.id,f.agenda.id,'pause');await f.chairs.tick(f.room.id);assert.equal(f.store.room(f.room.id).messages.filter(m=>m.sender_session_id===f.store.chair(f.room.id).session_id).length,1);f.debates.action(f.room.id,f.agenda.id,'resume');await f.chairs.tick(f.room.id);assert.equal(f.debates.get(f.room.id,f.agenda.id).phase,'collecting');f.debates.action(f.room.id,f.agenda.id,'cancel');assert.throws(()=>f.debates.action(f.room.id,f.agenda.id,'resume'),/complete/);assert.equal(f.debates.canDispatch(f.store.room(f.room.id).messages.at(-1).id),false)}finally{f.close()}});
test('timeout is partial rather than consensus and cannot be approved',async()=>{const f=await fixture({timeoutSeconds:1});try{f.store.db.prepare('UPDATE agendas SET updated_at=? WHERE id=?').run('2000-01-01T00:00:00Z',f.agenda.id);await f.debates.tick(f.room.id);assert.equal(f.debates.get(f.room.id,f.agenda.id).outcome,'limit_reached');assert.throws(()=>f.debates.approve(f.room.id,f.agenda.id,{revision:1}),/stale/)}finally{f.close()}});
test('knowledge deltas track provision separately from actual version reads',async()=>{const f=await fixture();try{const p=f.people[0],item=f.knowledge.add(f.room.id,{kind:'source',title:'fixture',body:'v1'});const first=f.knowledge.sync(f.room.id,p.reg);assert.equal(first.changes.length,1);assert.equal(first.lastReadRevision,0);assert.equal(f.knowledge.sync(f.room.id,p.reg).changes.length,0);f.knowledge.read(f.room.id,item.id,1,p.reg);assert.equal(f.knowledge.sync(f.room.id,p.reg).lastReadRevision,item.changeRevision);f.knowledge.update(f.room.id,item.id,{body:'v2'});assert.equal(f.knowledge.sync(f.room.id,p.reg).changes[0].revision,2)}finally{f.close()}});



test('new emoji reaches chair and revised proposal needs new explicit peer reviews',async()=>{const f=await fixture();try{await collect(f);const argument=f.debates.get(f.room.id,f.agenda.id).arguments[0];f.store.setReaction(f.room.id,argument.id,'❓',true);await f.debates.tick(f.room.id);assert.equal(f.store.room(f.room.id).messages.some(m=>m.request_key?.includes(':chair:discussion:')),false,'pending peer reviews keep their revision stable');review(f);await f.debates.tick(f.room.id);assert.ok(f.store.room(f.room.id).messages.some(m=>m.request_key?.includes(':chair:discussion:')));assert.ok(f.debates.context(f.room.id,f.agenda.id).reactions.length);await f.chairs.tick(f.room.id);const state=f.debates.get(f.room.id,f.agenda.id);assert.equal(state.revision,2);assert.equal(state.phase,'reviewing');assert.equal(state.reviews.filter(r=>r.conclusion_revision===2).length,0);assert.equal(state.outcome,null)}finally{f.close()}});
test('explicit objections revise the conclusion and never reuse prior votes',async()=>{const f=await fixture();try{await collect(f);review(f,'disagree');await f.debates.tick(f.room.id);await f.chairs.tick(f.room.id);assert.equal(f.debates.get(f.room.id,f.agenda.id).revision,2);assert.equal(f.debates.get(f.room.id,f.agenda.id).outcome,null);review(f,'agree');await f.debates.tick(f.room.id);await f.chairs.tick(f.room.id);assert.equal(f.debates.get(f.room.id,f.agenda.id).outcome,'consensus')}finally{f.close()}});

test('cooperative inbox also honors agenda pause and cancellation',async()=>{const f=await fixture();try{await f.chairs.tick(f.room.id);f.debates.action(f.room.id,f.agenda.id,'pause');assert.equal(f.store.inbox(f.people[0].reg).inbox.length,0);f.debates.action(f.room.id,f.agenda.id,'resume');assert.equal(f.store.inbox(f.people[0].reg).inbox.length,1);f.debates.action(f.room.id,f.agenda.id,'cancel');assert.equal(f.store.inbox(f.people[1].reg).inbox.length,0)}finally{f.close()}});


test('addressed old review completes its writer without becoming current consent',async()=>{
 const f=await fixture();try{
  await collect(f);const a=f.debates.get(f.room.id,f.agenda.id),p=f.people[0],round=a.rounds.at(-1),offer=f.store.inbox(p.reg).inbox[0];
  const payload={agendaId:a.id,roundId:round.id,conclusionRevision:a.revision,stance:'qualified',sourceIds:[a.arguments[0].id],body:'Prior version only, not approval of revision 2',requestId:offer.request_id};
  f.debates.action(f.room.id,a.id,'supplement',{body:'New information changes the candidate'});
  const result=f.debates.recordReview(f.room.id,p.reg,payload),fresh=f.debates.get(f.room.id,a.id);
  assert.equal(result.superseded,true);assert.equal(fresh.revision,2);assert.equal(fresh.outcome,null);assert.equal(fresh.reviews[0].conclusion_revision,1);
  assert.equal(f.store.db.prepare('SELECT unresolved_delivery_id FROM writers WHERE session_id=?').get(p.session.id).unresolved_delivery_id,null);
  assert.equal(f.store.room(f.room.id).deliveries.find(d=>d.request_id===offer.request_id).state,'completed');
  assert.equal(f.debates.recordReview(f.room.id,p.reg,payload).id,result.id);
  assert.throws(()=>f.debates.recordReview(f.room.id,p.reg,{...payload,roundId:'wrong-round'}),/not addressed/);
 }finally{f.close()}
});

test('stale saved chair output is retained privately and regenerated once with current metadata',async()=>{
 const f=await fixture();try{
  await collect(f);review(f);await f.debates.tick(f.room.id);const a=f.debates.get(f.room.id,f.agenda.id);let calls=0;
  f.chairs.runner.resume=async({nativeId,onStarted})=>{onStarted();calls++;return {nativeId,started:true,output:{speech:calls===1?'DO NOT PUBLISH STALE SPEECH':'Current final speech',questions:[],proposal:{body:'Current final conclusion',sourceIds:a.arguments.map(x=>x.id)},debate:{agendaId:a.id,conclusionRevision:calls===1?0:a.revision}}};};
  await f.chairs.tick(f.room.id);const run=f.store.db.prepare("SELECT * FROM chair_runs WHERE status='unknown'").get();assert.ok(run);assert.equal(run.error,'chair agenda revision is stale');
  assert.equal(f.store.room(f.room.id).messages.some(m=>m.body==='DO NOT PUBLISH STALE SPEECH'),false);
  f.chairs.reconcile(f.room.id,run.id);f.chairs.reconcile(f.room.id,run.id);
  assert.equal(f.store.db.prepare('SELECT output_json FROM chair_runs WHERE id=?').get(run.id).output_json,run.output_json);
  assert.equal(f.store.db.prepare('SELECT state FROM deliveries WHERE id=?').get(run.delivery_id).state,'cancelled');
  assert.equal(f.store.room(f.room.id).messages.filter(m=>m.request_key?.includes(':revision-retry:')).length,1);
  await f.chairs.tick(f.room.id);assert.equal(calls,2);assert.equal(f.debates.get(f.room.id,a.id).outcome,'consensus');
  assert.equal(f.store.room(f.room.id).messages.filter(m=>m.body==='Current final speech').length,1);
 }finally{f.close()}
});

test('stale chair recovery cannot release a newer writer fence',async()=>{
 const f=await fixture();try{
  await collect(f);review(f);await f.debates.tick(f.room.id);const a=f.debates.get(f.room.id,f.agenda.id);
  f.chairs.runner.resume=async({nativeId,onStarted})=>{onStarted();return {nativeId,started:true,output:{speech:'stale',questions:[],proposal:null,debate:{agendaId:a.id,conclusionRevision:0}}};};
  await f.chairs.tick(f.room.id);const run=f.store.db.prepare("SELECT * FROM chair_runs WHERE status='unknown'").get(),chair=f.store.chair(f.room.id);
  f.store.db.prepare('UPDATE writers SET fence=fence+1 WHERE session_id=?').run(chair.session_id);
  assert.throws(()=>f.chairs.reconcile(f.room.id,run.id),/recovery fence/);
  assert.equal(f.store.db.prepare('SELECT state FROM deliveries WHERE id=?').get(run.delivery_id).state,'unknown');
  assert.equal(f.store.room(f.room.id).messages.some(m=>m.request_key?.includes(':revision-retry:')),false);
 }finally{f.close()}
});


test('already queued discussion also waits for the current participant round',async()=>{
 const f=await fixture();try{
  await collect(f);const a=f.debates.get(f.room.id,f.agenda.id);f.debates._queue(a,'discussion','legacy-pending');
  const queued=f.store.room(f.room.id).messages.find(m=>m.request_key?.endsWith(':legacy-pending'));
  assert.equal(f.debates.canDispatch(queued.id),false);review(f);assert.equal(f.debates.canDispatch(queued.id),true);
 }finally{f.close()}
});


test('agenda chair context uses the agenda budget consistently instead of the room loop budget',async()=>{
 const f=await fixture({roundBudget:6,requestBudget:18});try{
  await collect(f);f.store.db.prepare('UPDATE rooms SET request_budget=3,round_budget=1 WHERE id=?').run(f.room.id);
  const a=f.debates.get(f.room.id,f.agenda.id),m=f.store.room(f.room.id).messages.find(m=>m.request_key?.includes(':chair:synthesize:')),delivery=f.store.room(f.room.id).deliveries.find(d=>d.message_id===m.id);
  const context=JSON.parse(f.chairs.context(f.room.id,f.store.chair(f.room.id),{...delivery,body:m.body}).split('\n').at(-1));
  assert.equal(context.requestsRemaining,18-a.requests_used);assert.equal(context.dialogueLoop.requestsRemaining,context.requestsRemaining);assert.equal(context.dialogueLoop.roundsRemaining,context.roundsRemaining);assert.equal(context.dialogueLoop.scope,'agenda');assert.equal(context.dialogueLoop.roundBudget,6);
  assert.notEqual(f.store.loopBudget(f.room.id,m.id).requestsRemaining,context.requestsRemaining);
 }finally{f.close()}
});

test('final may cite latest source-backed peer reviews after a corrected candidate without obsolete arguments',async()=>{
 for(const mode of ['latest','old-review','root-only','foreign']){const f=await fixture({roundBudget:5,requestBudget:12});try{
  await collect(f);const oldReviews=review(f,'disagree');await f.debates.tick(f.room.id);await f.chairs.tick(f.room.id);
  const revised=f.debates.get(f.room.id,f.agenda.id);assert.equal(revised.revision,2);assert.equal(revised.outcome,null);
  const source=f.knowledge.add(f.room.id,{kind:'source',title:'verified correction',body:'current source supersedes prior premise'});
  const currentReviews=review(f,'agree');
  const chosen=mode==='old-review'?oldReviews:currentReviews;
  const sourceIds=mode==='root-only'?[revised.root_message_id]:chosen.map(record=>record.result.reply_message_id);
  assert.ok(sourceIds.every(Boolean));sourceIds.push(source.id);
  if(mode==='foreign')sourceIds.push(f.knowledge.add(f.store.createRoom('private').id,{kind:'source',title:'private',body:'outside current room'}).id);
  f.chairs.runner.resume=async({nativeId,onStarted})=>{onStarted();return {nativeId,started:true,output:{speech:'latest reviews support the corrected result',questions:[],proposal:{body:revised.current_conclusion,sourceIds}}};};
  await f.debates.tick(f.room.id);const run=await f.chairs.tick(f.room.id),final=f.debates.get(f.room.id,f.agenda.id);
  assert.equal(run.status,mode==='latest'?'completed':'unknown',mode);
  assert.equal(final.outcome,mode==='latest'?'consensus':null,mode);
  if(mode==='old-review'||mode==='root-only')assert.match(run.error,/latest review references/);
  if(mode==='foreign')assert.match(run.error,/outside this agenda|visible knowledge|유효한 원문 근거/);
 }finally{f.close()}}
});
