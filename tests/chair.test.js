import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../services/coordinator/store.js';
import {ChairCoordinator} from '../services/coordinator/chair.js';
const runner={initialize:async({nativeId})=>({nativeId,started:true,output:{speech:'ready',questions:[],proposal:null}}),resume:async({nativeId,onStarted})=>{onStarted();return {nativeId,started:true,output:{speech:'chair says hi',questions:[],proposal:null}};}};
test('dedicated chair owns a distinct session and processes its queued delivery once',async()=>{const s=new Store(),r=s.createRoom('r');const participant=s.registerSession({provider:'codex',host:'local',nativeId:'participant',cwd:'C:/p',profile:'default',mode:'live_attach',ownership:'borrowed',verified:true,capabilities:{followup:true}}).session;const p=s.join(r.id,participant.id,false),c=new ChairCoordinator(s,{runner,cwdForRoom:id=>`C:/chairs/${id}`});const chair=await c.create(r.id);assert.equal(chair.status,'ready');assert.throws(()=>s.role(r.id,chair.session_id,'member'),/dedicated chair/);assert.notEqual(chair.session_id,participant.id);const m=s.room(r.id).members.find(x=>x.session_id===chair.session_id);s.post({roomId:r.id,body:'coordinate',kind:'followup',targets:[m.id],requestKey:'one'});await c.tick(r.id);assert.equal(s.room(r.id).messages.at(-1).body,'chair says hi');assert.equal(s.room(r.id).chair_runs[0].status,'completed');assert.equal(s.room(r.id).deliveries.find(x=>x.membership_id===m.id).state,'completed');assert.equal(p.read_only,0);});
test('chair restart recovery leaves fenced work unknown without replay',async()=>{const s=new Store(),r=s.createRoom('r'),c=new ChairCoordinator(s,{runner,cwdForRoom:id=>`C:/chairs/${id}`});const chair=await c.create(r.id),m=s.room(r.id).members.find(x=>x.session_id===chair.session_id),d=s.post({roomId:r.id,body:'x',kind:'followup',targets:[m.id]}).deliveries[0],claim=s.claim(d.id);s.fence(d.id,claim.fence);s.recover();assert.equal(s.db.prepare('SELECT state FROM deliveries WHERE id=?').get(d.id).state,'unknown');assert.equal(await c.tick(r.id),null);});

function participant(s,room,label='peer'){const session=s.registerSession({provider:'codex',host:'test',nativeId:label,cwd:'C:/test',profile:'default',mode:'live_attach',ownership:'borrowed',verified:true,capabilities:{followup:true}}).session;return {...s.join(room.id,session.id,false),session};}
const readyRunner={initialize:runner.initialize,resume:runner.resume};

test('chair invalid targets roll back every output and never auto replay',async()=>{
 const s=new Store(),r=s.createRoom('invalid');let calls=0;const c=new ChairCoordinator(s,{runner:{...readyRunner,resume:async({nativeId,onStarted})=>{calls++;onStarted();return {nativeId,started:true,output:{speech:'must rollback',questions:[{targetMembershipIds:['foreign'],body:'bad'}],proposal:null}};}}});
 await c.create(r.id);const input=s.post({roomId:r.id,body:'ask',kind:'followup',routingMode:'chair',requestKey:'bad'});await c.tick(r.id);await c.tick(r.id);
 assert.equal(calls,1);assert.equal(s.room(r.id).messages.some(m=>m.body==='must rollback'),false);assert.equal(s.snapshot(input.message.id).deliveries[0].state,'unknown');
});
test('chair invalid reaction rolls back speech, questions, and reactions without replay',async()=>{
 const s=new Store(),r=s.createRoom('invalid reaction'),peer=participant(s,r),c=new ChairCoordinator(s,{runner:readyRunner}),chair=await c.create(r.id),chairMember=s.room(r.id).members.find(m=>m.session_id===chair.session_id);
 const input=s.post({roomId:r.id,body:'ask',kind:'followup',targets:[chairMember.id],requestKey:'invalid-reaction'}),run=s.chairRun(r.id,input.deliveries[0].request_id);
 assert.throws(()=>c.applyOutput(r.id,chair,{message_id:input.message.id,request_id:run.request_key,body:'ask'},run,{id:'none'},{speech:'must rollback',questions:[{targetMembershipIds:[peer.id],body:'question'}],reactions:[{messageId:'foreign',emoji:'💡',active:true}],proposal:null}),/반응/);
 assert.equal(s.room(r.id).messages.some(m=>m.body==='must rollback'||m.body==='question'),false);assert.equal(s.room(r.id).reactions.length,0);
});
test('chair output cannot re-send a current explicit recipient and remains atomic',async()=>{
 const s=new Store(),r=s.createRoom('dedup'),peer=participant(s,r),c=new ChairCoordinator(s,{runner:readyRunner});const chair=await c.create(r.id);
 const chairMember=s.room(r.id).members.find(m=>m.session_id===chair.session_id);
 const input=s.post({roomId:r.id,body:'mixed',kind:'followup',targets:[chairMember.id,peer.id],requestKey:'mixed'});
 const run=s.chairRun(r.id,input.deliveries.find(d=>d.membership_id===chairMember.id).request_id);
 assert.throws(()=>c.applyOutput(r.id,chair,{message_id:input.message.id,request_id:run.request_key,body:'mixed'},run,{id:'none'}, {speech:'will fail',questions:[{targetMembershipIds:[peer.id],body:'mixed'}],proposal:null}),/중복 전달/);
 assert.equal(s.room(r.id).messages.some(m=>m.body==='will fail'),false);
 assert.doesNotThrow(()=>c.validate(r.id,chair,{speech:'clarify',questions:[{targetMembershipIds:[peer.id],body:'Which constraint matters most?'}],proposal:null},{currentTargets:[peer.id],currentInput:'mixed'}));
 const prompt=c.context(r.id,chair,{message_id:input.message.id,body:'mixed',request_id:'context'},null),context=JSON.parse(prompt.slice(prompt.indexOf('\n')+1));
 assert.equal(context.chairIdentity.alias,chairMember.alias);assert.equal(context.chairIdentity.role,'chair');assert.equal(context.chairIdentity.membershipId,chairMember.id);assert.ok(context.currentTargets.includes(peer.id));const peerContext=context.participants.find(p=>p.membershipId===peer.id);assert.equal(peerContext.displayName,peer.session.display_name);assert.equal(peerContext.sessionId,peer.session.id);assert.equal(context.messages.find(m=>m.id===input.message.id).senderMembershipId,null);
 s.db.close();
});

test('reply consolidation is correlated, system authored and not repeated',async()=>{
 const s=new Store(),r=s.createRoom('summary'),peer=participant(s,r);let calls=0;
 const c=new ChairCoordinator(s,{runner:{...readyRunner,resume:async({nativeId,onStarted,body})=>{calls++;onStarted();assert.ok(body.includes(peer.id));return {nativeId,started:true,output:calls===1?{speech:'asking',questions:[{targetMembershipIds:[peer.id],body:'your view?'}],proposal:null}:{speech:'summarized',questions:[],proposal:{body:'proposed conclusion',sourceIds:[s.room(r.id).messages.find(m=>m.body==='peer answer').id]}}};}}});
 const chair=await c.create(r.id);s.post({roomId:r.id,body:'discuss',kind:'followup',routingMode:'chair',requestKey:'discuss'});await c.tick(r.id);
 const q=s.room(r.id).messages.find(m=>m.body==='your view?'),delivery=s.snapshot(q.id).deliveries[0];
 s.reply({room_id:r.id,session_id:peer.session.id,membership_id:peer.id},delivery.request_id,'peer answer');await c.tick(r.id);await c.tick(r.id);
 assert.equal(calls,2);const room=s.room(r.id);assert.equal(room.messages.filter(m=>m.provenance==='coordinator').length,1);assert.equal(room.messages.find(m=>m.body==='proposed conclusion').sender_role,'chair');assert.equal(room.messages.find(m=>m.body==='proposed conclusion').decision_id,room.decisions[0].id);assert.equal(room.decisions[0].status,'proposed');assert.equal(room.chair.native_id,chair.native_id);
});

test('chair serializes concurrent ticks and keeps actual start evidence distinct',async()=>{
 const s=new Store(),r=s.createRoom('serial');let finish,calls=0;const c=new ChairCoordinator(s,{runner:{...readyRunner,resume:({nativeId,onStarted})=>{calls++;return new Promise(resolve=>{finish=()=>{onStarted();resolve({nativeId,started:true,output:{speech:'done',questions:[],proposal:null}});};});}}});
 await c.create(r.id);const first=s.post({roomId:r.id,body:'one',kind:'followup',routingMode:'chair'});s.post({roomId:r.id,body:'two',kind:'followup',routingMode:'chair'});const work=c.tick(r.id);assert.equal(s.snapshot(first.message.id).deliveries[0].state,'submitting');assert.equal(await c.tick(r.id),null);assert.equal(calls,1);finish();await work;assert.equal(s.snapshot(first.message.id).deliveries[0].state,'completed');
});

test('chair pause stops invocation and a budget failure leaves no partial questions',async()=>{
 const s=new Store(),r=s.createRoom('budget'),p=participant(s,r);let calls=0;const c=new ChairCoordinator(s,{runner:{...readyRunner,resume:async({nativeId,onStarted})=>{calls++;onStarted();return {nativeId,started:true,output:{speech:'partial speech',questions:[{targetMembershipIds:[p.id],body:'q1'},{targetMembershipIds:[p.id],body:'q2'}],proposal:null}};}}});await c.create(r.id);s.limits(r.id,2,3);s.post({roomId:r.id,body:'ask',kind:'followup',routingMode:'chair'});s.pause(r.id);assert.equal(await c.tick(r.id),null);assert.equal(calls,0);s.pause(r.id,false);await c.tick(r.id);assert.equal(calls,1);assert.equal(s.room(r.id).messages.some(m=>m.body==='partial speech'||m.body==='q1'),false);assert.equal(s.room(r.id).chair_runs[0].status,'unknown');
});

test('decision publication is canonical and idempotent across migration',()=>{
 const s=new Store(),r=s.createRoom('legacy'),p=participant(s,r);s.role(r.id,p.session.id,'chair');const d=s.result({membership_id:p.id,session_id:p.session.id},'decision',[]);const before=s.room(r.id).messages;s.publishLegacyDecisions();assert.equal(s.room(r.id).messages.length,before.length);assert.equal(before[0].decision_id,d.id);
});

test('stored result can be applied after raising limit without a second provider turn',async()=>{
 const s=new Store(),r=s.createRoom('cached'),p=participant(s,r);let calls=0;const c=new ChairCoordinator(s,{runner:{...readyRunner,resume:async({nativeId,onStarted})=>{calls++;onStarted();return {nativeId,started:true,output:{speech:'stored speech',questions:[{targetMembershipIds:[p.id],body:'first'},{targetMembershipIds:[p.id],body:'second'}],proposal:null}};}}});
 await c.create(r.id);s.limits(r.id,2,3);s.post({roomId:r.id,body:'ask',kind:'followup',routingMode:'chair'});const run=await c.tick(r.id);assert.equal(run.status,'unknown');assert.ok(run.output_json);s.limits(r.id,10,3);c.reconcile(r.id,run.id);c.reconcile(r.id,run.id);assert.equal(calls,1);assert.equal(s.room(r.id).messages.filter(m=>m.body==='stored speech').length,1);assert.equal(s.room(r.id).chair_runs[0].status,'completed');
});

test('legacy decision publication survives a departed owner and archived room',()=>{
 const s=new Store(),r=s.createRoom('archived legacy'),p=participant(s,r);s.role(r.id,p.session.id,'chair');s.db.prepare('INSERT INTO decisions VALUES(?,?,?,?,?,?)').run('legacy',r.id,'original decision','proposed',p.session.id,'2020-01-01T00:00:00.000Z');s.leave(r.id,p.session.id);s.archiveRoom(r.id);s.publishLegacyDecisions();s.publishLegacyDecisions();const room=s.room(r.id);assert.equal(room.messages.length,1);assert.equal(room.messages[0].sender_session_id,p.session.id);assert.equal(room.messages[0].body,'original decision');
});
