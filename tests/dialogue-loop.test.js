import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../services/coordinator/store.js';
import {ChairCoordinator} from '../services/coordinator/chair.js';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

async function setup({requests=20,rounds=1,parallel=2,database=':memory:'}={}){
 const s=new Store(database),room=s.createRoom('loops'),peers=[];let calls=0;const contexts=[];
 for(let i=0;i<parallel;i++){const {session}=s.registerSession({provider:'codex',host:'test',nativeId:'peer-'+i,cwd:'C:/loop',profile:'test',mode:'live_attach',verified:true,capabilities:{followup:true}});peers.push({...s.join(room.id,session.id,false),session});}
 const c=new ChairCoordinator(s,{runner:{initialize:async({nativeId})=>({nativeId,started:true,output:{speech:'ready'}}),resume:async({nativeId,onStarted,body})=>{onStarted();calls++;contexts.push(JSON.parse(body.slice(body.indexOf('\n')+1)));return {nativeId,started:true,output:{speech:'response-'+calls,questions:peers.map(p=>({targetMembershipIds:[p.id],body:'question-'+calls+'-'+p.id})),proposal:null}};}}});
 const chair=await c.create(room.id);s.limits(room.id,requests,rounds);
 const send=body=>s.post({roomId:room.id,body,kind:'followup',routingMode:'auto'});
 return {s,room,peers,c,chair,send,contexts,calls:()=>calls};
}

test('interleaved user loops count parallel questions once and conclude independently at the round limit',async()=>{
 const {s,room,peers,c,send,contexts,calls}=await setup();
 try{
  const first=send('first');await c.tick(room.id);
  const firstQuestions=s.room(room.id).messages.filter(m=>m.kind==='followup'&&m.sender_session_id);
  assert.equal(firstQuestions.length,2);assert.ok(firstQuestions.every(m=>s.dialogueLoop(m.id).round===1));
  const second=send('second');await c.tick(room.id);
  for(const q of firstQuestions){const d=s.snapshot(q.id).deliveries[0],peer=peers.find(p=>p.id===d.membership_id);s.reply({room_id:room.id,session_id:peer.session.id,membership_id:peer.id},d.request_id,'answer for first');}
  await c.tick(room.id);
  assert.equal(calls(),3);assert.equal(contexts[2].dialogueLoop.rootId,first.message.id);assert.equal(contexts[2].roundsRemaining,0);
  assert.equal(s.room(room.id).messages.filter(m=>m.kind==='followup'&&m.sender_session_id&&s.dialogueLoop(m.id).rootId===first.message.id).length,2);
  assert.ok(s.room(room.id).messages.some(m=>m.body.includes('[자동 대화 한도]')&&s.dialogueLoop(m.id).rootId===first.message.id));
  assert.ok(s.room(room.id).chair_runs.every(r=>r.status==='completed'));
  assert.equal(s.loopBudget(room.id,second.message.id).round,0);
  const third=send('third');await c.tick(room.id);assert.equal(calls(),4);assert.equal(contexts[3].dialogueLoop.rootId,third.message.id);assert.equal(contexts[3].roundsRemaining,1);
  await c.tick(room.id);assert.equal(calls(),4); // No repeat summary while another loop is still waiting.
 }finally{s.db.close();}
});

test('request exhaustion ends only its loop without an extra model call or blocking a new user request',async()=>{
 const {s,room,peers,c,send,calls}=await setup({requests:2,parallel:1});
 try{
  const first=send('first');await c.tick(room.id);
  const q=s.room(room.id).messages.find(m=>m.kind==='followup'&&m.sender_session_id),d=s.snapshot(q.id).deliveries[0],peer=peers[0];
  s.reply({room_id:room.id,session_id:peer.session.id,membership_id:peer.id},d.request_id,'answered');
  await c.tick(room.id);await c.tick(room.id);assert.equal(calls(),1);
  assert.equal(s.loopBudget(room.id,first.message.id).requestsRemaining,0);
  assert.ok(s.room(room.id).messages.some(m=>m.provenance==='coordinator'&&m.kind==='post'&&m.body.includes('자동 전달 한도')));
  const next=send('new input');await c.tick(room.id);assert.equal(calls(),2);assert.equal(s.snapshot(next.message.id).deliveries[0].state,'completed');
 }finally{s.db.close();}
});

test('a participant request inherits its offered input loop; ambiguous provider work stays fenced',async()=>{
 const {s,room,peers,c,send,chair}=await setup({rounds:1,parallel:1});
 try{
  const root=send('first');await c.tick(room.id);const peer=peers[0];s.provision(room.id,peer.session.id,'peer-token');
  const offer=s.inbox(s.registration('peer-token')).inbox[0];
  assert.throws(()=>s.post({roomId:room.id,senderSessionId:peer.session.id,body:'recursive request',kind:'followup',targets:[peer.id]}),/round budget/);
  assert.equal(s.dialogueLoop(offer.message_id).rootId,root.message.id);
  const next=send('transport failure'),d=next.deliveries[0],claim=s.claim(d.id);s.fence(d.id,claim.fence);
  const run=s.chairRun(room.id,d.request_id);s.updateChairRun(run.id,'unknown','provider timeout',d.id);s.db.prepare("UPDATE deliveries SET state='unknown' WHERE id=?").run(d.id);
  c.recoverSavedBudgetFailures(room.id);
  assert.equal(s.snapshot(next.message.id).deliveries[0].state,'unknown');
  assert.equal(s.db.prepare('SELECT unresolved_delivery_id FROM writers WHERE session_id=?').get(chair.session_id).unresolved_delivery_id,d.id);
 }finally{s.db.close();}
});

test('loop ancestry, per-request usage and original hashes survive reopening a file database',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'dialogue-loop-')),path=join(dir,'rooms.sqlite');let reopened;
 const {s,room,peers,c,send}=await setup({database:path,parallel:1});
 try{
  const root=send('persisted request');await c.tick(room.id);
  const q=s.room(room.id).messages.find(m=>m.kind==='followup'&&m.sender_session_id),d=s.snapshot(q.id).deliveries[0],p=peers[0];
  const reply=s.reply({room_id:room.id,session_id:p.session.id,membership_id:p.id},d.request_id,'answer').message;
  const before=s.loopBudget(room.id,reply.id);s.db.close();reopened=new Store(path);
  assert.deepEqual(reopened.loopBudget(room.id,reply.id),before);assert.equal(before.rootId,root.message.id);assert.equal(before.roundsRemaining,0);
  assert.equal(reopened.snapshot(root.message.id).message.payload_hash,root.message.payload_hash);
  const next=reopened.post({roomId:room.id,body:'new user reply starts fresh',replyTo:reply.id,kind:'followup',routingMode:'auto'});
  assert.equal(reopened.loopBudget(room.id,next.message.id).rootId,next.message.id);assert.equal(reopened.loopBudget(room.id,next.message.id).roundsRemaining,1);
 }finally{reopened?.db.close();if(!reopened)s.db.close();rmSync(dir,{recursive:true,force:true});}
});
