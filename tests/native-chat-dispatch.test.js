import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../services/coordinator/store.js';
import {ParticipantDispatcher} from '../services/coordinator/participant-dispatcher.js';
import {ParticipantSettings} from '../services/coordinator/participant-settings.js';

function setup() {
  const store=new Store(),room=store.createRoom('Native participants');
  const identity={provider:'claude',host:'orca/local',nativeId:'original-claude',cwd:'C:/project',profile:'default',mode:'live_attach',ownership:'borrowed',handle:'actor-1',incarnation:'runtime-1:2',verified:true,capabilities:{transport:'orca-native-chat',followup:true,automaticInput:true}};
  const {session,binding}=store.registerSession(identity),member=store.join(room.id,session.id,false);
  const delivery=store.post({roomId:room.id,body:'Compare the findings; analysis only.',kind:'followup',targets:[member.id]}).deliveries[0];
  return {store,room,identity,session,binding,member,delivery};
}
function adapterFor(env,{unknown=false}={}) {
  const {store,delivery}=env,calls=[];
  const receipt={sessionId:'actor-1',nativeId:'original-claude',runtimeId:'runtime-1',fence:2,requestId:delivery.request_id,clientOperationId:'1793860000000-'+delivery.request_id.replaceAll('-',''),payloadFingerprint:'typed-fingerprint'};
  let completed=false;
  return {calls,receipt,complete(){completed=true;},async preflight(){return {ok:true};},async send(_binding,_session,prompt,requestId,options={}) {
    calls.push({prompt,requestId,observe:!!options.observeOnly});
    assert.equal(requestId,delivery.request_id);
    if(!options.observeOnly){
      assert.equal(store.db.prepare('SELECT status FROM participant_dispatches WHERE delivery_id=?').get(delivery.id).status,'prepared');
      assert.ok(store.db.prepare('SELECT 1 FROM attempts WHERE delivery_id=?').get(delivery.id));
      await options.onPrepared(receipt);
      assert.equal(JSON.parse(store.db.prepare('SELECT receipt_json FROM participant_dispatches WHERE delivery_id=?').get(delivery.id).receipt_json).payloadFingerprint,'typed-fingerprint');
      if(unknown)throw Object.assign(Error('transport lost after submit'),{receipt});
    }else assert.equal(options.receipt.payloadFingerprint,'typed-fingerprint');
    return {ok:true,stage:completed?'reply':'turn_started',receipt,...(completed?{reply:{body:'Correlated participant answer',turnId:'turn-1',itemIds:['assistant-1']}}:{})};
  }};
}

test('native delivery has durable operation and no helper config/token; tick collects one reply',async()=>{
  const e=setup(),adapter=adapterFor(e),dispatcher=new ParticipantDispatcher(e.store,{adapter});
  dispatcher.config=()=>{throw Error('must not create native helper config');};
  try {
    assert.equal((await dispatcher.tick())[0].state,'running');
    assert.equal(e.store.db.prepare('SELECT count(*) n FROM registrations').get().n,0);
    const record=e.store.db.prepare('SELECT * FROM participant_dispatches').get();
    assert.equal(record.config_path,'');assert.match(record.prompt,/Compare the findings/);assert.doesNotMatch(record.prompt,/participant\.js|--config|room_reply --/);
    adapter.complete();assert.equal((await dispatcher.tick())[0].state,'completed');
    assert.equal((await dispatcher.tick()).length,0);
    const reply=e.store.db.prepare('SELECT * FROM messages WHERE reply_request_id=?').get(e.delivery.request_id);
    assert.equal(reply.body,'Correlated participant answer');assert.equal(reply.provenance,'native_session');
    assert.equal(e.store.db.prepare('SELECT unresolved_delivery_id FROM writers WHERE session_id=?').get(e.session.id).unresolved_delivery_id,null);
    assert.equal(adapter.calls.filter(c=>!c.observe).length,1);
  }finally{e.store.db.close();}
});

test('native unknown and restart reconciliation never sends a recovery nudge',async()=>{
  const e=setup(),adapter=adapterFor(e,{unknown:true}),first=new ParticipantDispatcher(e.store,{adapter});
  try {
    assert.equal((await first.tick())[0].state,'unknown');e.store.recover();
    const second=new ParticipantDispatcher(e.store,{adapter});
    assert.equal((await second.retry(e.room.id,e.delivery.id)).state,'running');
    assert.equal(e.store.db.prepare('SELECT count(*) n FROM participant_recoveries').get().n,0);
    adapter.complete();assert.equal((await second.tick())[0].state,'completed');
    assert.equal(adapter.calls.filter(c=>!c.observe).length,1);
  }finally{e.store.db.close();}
});

test('native writer remains exclusive across rooms until correlated completion',async()=>{
  const e=setup(),adapter=adapterFor(e),dispatcher=new ParticipantDispatcher(e.store,{adapter});
  try {
    await dispatcher.tick();const other=e.store.createRoom('Other room'),member=e.store.join(other.id,e.session.id,false);
    const next=e.store.post({roomId:other.id,body:'Competing request',kind:'followup',targets:[member.id]}).deliveries[0];
    await dispatcher.tick();assert.equal(adapter.calls.filter(c=>!c.observe).length,1);
    assert.equal(e.store.db.prepare('SELECT state FROM deliveries WHERE id=?').get(next.id).state,'queued');
  }finally{e.store.db.close();}
});

test('trusted native reply rejects wrong operation, stale binding and wrong writer fence',async()=>{
  for(const fault of ['operation','binding','fence','fingerprint']){
    const e=setup(),adapter=adapterFor(e),dispatcher=new ParticipantDispatcher(e.store,{adapter});
    try {
      await dispatcher.tick();const record=e.store.db.prepare('SELECT * FROM participant_dispatches').get();
      const receipt={...adapter.receipt};
      if(fault==='operation')receipt.clientOperationId='other';
      if(fault==='fingerprint')receipt.payloadFingerprint='other';
      if(fault==='binding')e.store.registerSession({...e.identity,incarnation:'new-runtime:3'});
      if(fault==='fence')e.store.db.prepare('UPDATE writers SET fence=fence+1 WHERE session_id=?').run(e.session.id);
      assert.throws(()=>e.store.replyFromAdapter(e.delivery.id,record.attempt_id,{bindingId:e.binding.id,incarnation:e.binding.incarnation,receipt,reply:{body:'must reject',turnId:'turn',itemIds:['assistant']}}),/stale|uncorrelated/);
      assert.equal(e.store.db.prepare('SELECT count(*) n FROM messages WHERE reply_request_id=?').get(e.delivery.request_id).n,0);
    }finally{e.store.db.close();}
  }
});

test('same native reply is idempotent and a conflicting body is rejected',async()=>{
  const e=setup(),adapter=adapterFor(e),dispatcher=new ParticipantDispatcher(e.store,{adapter});
  try {
    await dispatcher.tick();adapter.complete();await dispatcher.tick();
    const record=e.store.db.prepare('SELECT * FROM participant_dispatches').get();
    const input={bindingId:e.binding.id,incarnation:e.binding.incarnation,receipt:adapter.receipt,reply:{body:'Correlated participant answer',turnId:'turn-1',itemIds:['assistant-1']}};
    e.store.replyFromAdapter(e.delivery.id,record.attempt_id,input);
    assert.throws(()=>e.store.replyFromAdapter(e.delivery.id,record.attempt_id,{...input,reply:{...input.reply,body:'conflict'}}),/idempotency conflict/);
    assert.equal(e.store.db.prepare('SELECT count(*) n FROM messages WHERE reply_request_id=?').get(e.delivery.request_id).n,1);
  }finally{e.store.db.close();}
});

test('long native answers preserve full text as an idempotent attachment',async()=>{
  const e=setup(),adapter=adapterFor(e),dispatcher=new ParticipantDispatcher(e.store,{adapter});
  try{
    await dispatcher.tick();const record=e.store.db.prepare('SELECT * FROM participant_dispatches').get(),body='분석 근거 '.repeat(2000);
    const input={bindingId:e.binding.id,incarnation:e.binding.incarnation,receipt:adapter.receipt,reply:{body,turnId:'long-turn',itemIds:['long-assistant']}};
    const result=e.store.replyFromAdapter(e.delivery.id,record.attempt_id,input);
    assert.ok(result.message.body.length<8000);assert.equal(result.message.attachments.length,1);
    assert.equal(Buffer.from(e.store.readAttachment(e.room.id,result.message.attachments[0].id).base64,'base64').toString(),body.trim());
    e.store.replyFromAdapter(e.delivery.id,record.attempt_id,input);
    assert.throws(()=>e.store.replyFromAdapter(e.delivery.id,record.attempt_id,{...input,reply:{...input.reply,body:body+'conflicting tail'}}),/idempotency conflict/);
  }finally{e.store.db.close();}
});

test('native Chat model settings never reach the terminal model picker',async()=>{
  const e=setup();let calls=0;
  try{
    const settings=new ParticipantSettings(e.store,{adapter:{preflight(){calls++;throw Error('must not use terminal transport');}}});
    await assert.rejects(()=>settings.run(e.room.id,e.session.id,'inspect'),/기존 Orca 세션/);
    assert.equal(calls,0);assert.equal(e.store.db.prepare('SELECT count(*) n FROM session_controls').get().n,0);
  }finally{e.store.db.close();}
});

test('explicit reconnection preserves only a proven unsent request and refuses any prior attempt',()=>{
  const e=setup();
  try{
    const replacement=e.store.registerSession({...e.identity,incarnation:'replacement:3'});
    assert.throws(()=>e.store.dispatchEligibility(e.delivery.id),/binding or policy changed/);
    const rebound=e.store.rebindQueuedDelivery(e.room.id,e.delivery.id,replacement.binding.id);
    assert.equal(rebound.request_id,e.delivery.request_id);assert.equal(rebound.binding_id,replacement.binding.id);
    assert.equal(e.store.rebindQueuedDelivery(e.room.id,e.delivery.id,replacement.binding.id).request_id,e.delivery.request_id);
    assert.throws(()=>e.store.rebindQueuedDelivery('wrong-room',e.delivery.id,replacement.binding.id),/unsent request/);
    const claim=e.store.claim(e.delivery.id);e.store.fence(e.delivery.id,claim.fence);
    assert.throws(()=>e.store.rebindQueuedDelivery(e.room.id,e.delivery.id,replacement.binding.id),/unsent request|prior submission/);
    e.store.db.prepare("UPDATE deliveries SET state='queued' WHERE id=?").run(e.delivery.id);
    assert.throws(()=>e.store.rebindQueuedDelivery(e.room.id,e.delivery.id,replacement.binding.id),/prior submission/);
  }finally{e.store.db.close();}
});

test('known legacy pre-admission refusal is archived and the original room request proceeds exactly once',async()=>{
 const e=setup();let validSends=0;
 const valid={sessionId:'actor-1',nativeId:'original-claude',runtimeId:'runtime-1',fence:2,requestId:e.delivery.request_id,clientOperationId:'1793860000000-'+e.delivery.request_id.replaceAll('-',''),payloadFingerprint:'new-fingerprint'};
 const legacy={...valid,clientOperationId:e.delivery.request_id};delete legacy.requestId;
 const adapter={async preflight(){return {ok:true};},async send(_row,_session,_prompt,_requestId,options){if(options.observeOnly)return {ok:false,notRecorded:true,legacyInvalidId:true,reason:'operationIdInvalid',receipt:legacy};validSends++;await options.onPrepared(valid);return {ok:true,receipt:valid,reply:{body:'Original requested answer',turnId:'turn',itemIds:['assistant']}};}};
 const dispatcher=new ParticipantDispatcher(e.store,{adapter});
 try{
  const row=dispatcher.eligible()[0],claim=e.store.claim(row.id),attempt=e.store.fence(row.id,claim.fence),record=dispatcher.persist(row,attempt,row.request_id,'original prompt','');dispatcher.persistReceipt(record,legacy);dispatcher.record(row,record,'unknown','legacy send refused',legacy);
  await dispatcher.tick();assert.equal(validSends,1);assert.equal(e.store.db.prepare('SELECT state FROM deliveries WHERE id=?').get(row.id).state,'completed');
  assert.equal(e.store.db.prepare('SELECT operation_id FROM native_dispatch_refusals').get().operation_id,e.delivery.request_id);
  assert.equal(e.store.db.prepare('SELECT state FROM attempts WHERE id=?').get(attempt.id).state,'not_sent');
  assert.equal(e.store.db.prepare('SELECT count(*) n FROM registrations').get().n,0);
 }finally{e.store.db.close();}
});

test('a later candidate cannot replace the prepared native receipt fence',async()=>{
  const e=setup(),adapter=adapterFor(e),dispatcher=new ParticipantDispatcher(e.store,{adapter});
  try{
    await dispatcher.tick();const record=e.store.db.prepare('SELECT * FROM participant_dispatches').get();
    const receipt={...adapter.receipt,fence:3};
    assert.throws(()=>dispatcher.persistReceipt(record,receipt),/native receipt identity changed: fence/);
    assert.equal(JSON.parse(e.store.db.prepare('SELECT receipt_json FROM participant_dispatches WHERE delivery_id=?').get(e.delivery.id).receipt_json).fence,2);
  }finally{e.store.db.close();}
});

test('a forged native result cannot replace the durable receipt or complete its writer',async()=>{
 const e=setup(),good={sessionId:'actor-1',nativeId:'original-claude',runtimeId:'runtime-1',fence:2,requestId:e.delivery.request_id,clientOperationId:'1793860000000-'+e.delivery.request_id.replaceAll('-',''),payloadFingerprint:'good'};
 const forged={...good,clientOperationId:'1793860000000-ffffffffffffffffffffffffffffffff',payloadFingerprint:'forged'};
 const adapter={async preflight(){return {ok:true};},async send(_a,_b,_p,_r,options){await options.onPrepared(good);return {ok:true,stage:'reply',receipt:forged,reply:{body:'must not publish',turnId:'t',itemIds:['a']}};}};
 const dispatcher=new ParticipantDispatcher(e.store,{adapter});try{await dispatcher.tick();const saved=JSON.parse(e.store.db.prepare('SELECT receipt_json FROM participant_dispatches WHERE delivery_id=?').get(e.delivery.id).receipt_json);assert.equal(saved.clientOperationId,good.clientOperationId);assert.equal(e.store.db.prepare('SELECT state FROM deliveries WHERE id=?').get(e.delivery.id).state,'unknown');assert.equal(e.store.db.prepare('SELECT count(*) n FROM messages WHERE reply_request_id=?').get(e.delivery.request_id).n,0);assert.equal(e.store.db.prepare('SELECT unresolved_delivery_id FROM writers WHERE session_id=?').get(e.session.id).unresolved_delivery_id,e.delivery.id);}finally{e.store.db.close();}
});

test('an unknown native request stays unknown when observation reports admission only',async()=>{
 const e=setup();let calls=0;const receipt={sessionId:'actor-1',nativeId:'original-claude',runtimeId:'runtime-1',fence:2,requestId:e.delivery.request_id,clientOperationId:'1793860000000-'+e.delivery.request_id.replaceAll('-',''),payloadFingerprint:'good'};
 const adapter={async preflight(){return {ok:true};},async send(_a,_b,_p,_r,options){calls++;if(!options.observeOnly){await options.onPrepared(receipt);return {ok:false,receipt,reason:'history_cursor_cycle'};}return {ok:true,stage:'input_accepted',receipt:{...receipt,correlation:'awaiting_turn'}};}};
 const dispatcher=new ParticipantDispatcher(e.store,{adapter});try{await dispatcher.tick();await dispatcher.retry(e.room.id,e.delivery.id);const d=e.store.db.prepare('SELECT state,blocked_reason FROM deliveries WHERE id=?').get(e.delivery.id);assert.equal(d.state,'unknown');assert.equal(d.blocked_reason,'awaiting_turn');assert.equal(calls,2);}finally{e.store.db.close();}
});
