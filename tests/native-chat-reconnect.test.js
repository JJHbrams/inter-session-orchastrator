import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../services/coordinator/store.js';
import {ParticipantDispatcher} from '../services/coordinator/participant-dispatcher.js';

function setup(){
 const s=new Store(),room=s.createRoom('Restart recovery');
 const identity={provider:'claude',host:'orca/local',nativeId:'original',cwd:'C:/project',profile:'default',mode:'live_attach',ownership:'borrowed',verified:true,handle:'old-actor',incarnation:'old-runtime:2',policyRevision:'existing-policy',capabilities:{transport:'orca-native-chat',automaticInput:true,followup:true,steer:false,rawInspect:false,nativeChat:{runtimeId:'old-runtime',fence:2,providerSessionId:'original'}}};
 const {session,binding}=s.registerSession(identity),member=s.join(room.id,session.id,false),delivery=s.post({roomId:room.id,body:'Continue the original task',kind:'followup',targets:[member.id]}).deliveries[0];
 const fresh={...identity,handle:'restored-actor',incarnation:'new-runtime:5',policyRevision:'must-not-change-policy',capabilities:{...identity.capabilities,automaticInput:true,rawInspect:true,nativeChat:{runtimeId:'new-runtime',fence:5,providerSessionId:'original'}}};
 const calls=[];
 const adapter={async preflight(row){return row.incarnation==='new-runtime:5'?{ok:true}:{ok:false,reasonCode:'identity_changed',reason:'identity_changed'};},async reconnect(){calls.push('reconnect');return fresh;},async send(row,_session,_prompt,requestId,options){calls.push('send');assert.equal(requestId,delivery.request_id);assert.equal(row.handle,'restored-actor');const receipt={sessionId:row.handle,nativeId:row.native_id,runtimeId:'new-runtime',fence:5,requestId,clientOperationId:'1793860000000-'+requestId.replaceAll('-',''),payloadFingerprint:'official'};await options.onPrepared(receipt);return {ok:true,receipt,reply:{body:'Recovered original conversation',turnId:'restored-turn',itemIds:['assistant']}};}};
 const d=new ParticipantDispatcher(s,{adapter});return {s,room,session,binding,member,delivery,identity,fresh,adapter,d,calls};
}

test('queued restart recovery preserves session, permissions and original request while sending once',async()=>{
 const e=setup();try{
  const other=e.s.createRoom('Another room'),member=e.s.join(other.id,e.session.id,false),second=e.s.post({roomId:other.id,body:'Another unsent request',kind:'followup',targets:[member.id]}).deliveries[0];
  const result=await e.d.dispatch(e.d.eligible().find(r=>r.id===e.delivery.id));assert.equal(result.state,'completed');
  assert.deepEqual(e.calls,['reconnect','send']);
  const active=e.s.db.prepare('SELECT * FROM bindings WHERE session_id=? AND active=1').get(e.session.id),caps=JSON.parse(active.capabilities);
  assert.notEqual(active.id,e.binding.id);assert.equal(active.incarnation,'new-runtime:5');assert.equal(active.policy_revision,'existing-policy');assert.equal(caps.rawInspect,false);assert.equal(caps.automaticInput,true);
  assert.equal(e.s.db.prepare('SELECT request_id FROM deliveries WHERE id=?').get(e.delivery.id).request_id,e.delivery.request_id);
  const next=e.s.db.prepare('SELECT * FROM deliveries WHERE id=?').get(second.id);assert.equal(next.binding_id,active.id);assert.equal(next.request_id,second.request_id);assert.equal(next.state,'queued');
  assert.equal(e.s.db.prepare('SELECT count(*) n FROM sessions').get().n,1);
  assert.equal(e.s.db.prepare("SELECT count(*) n FROM events WHERE event='session.reconnected'").get().n,2);
  assert.equal(e.s.db.prepare('SELECT count(*) n FROM registrations').get().n,0);
 }finally{e.s.db.close();}
});

test('reconnect refuses changed identity, stale CAS and any uncertain or previously attempted submission',async()=>{
 for(const fault of ['identity','binding','writer','unknown','attempt','record']){
  const e=setup();try{
   let candidate=e.fresh,previous=e.binding.id;
   if(fault==='identity')candidate={...candidate,nativeId:'another-conversation'};
   if(fault==='binding')previous='stale-binding';
   if(fault==='writer')e.s.db.prepare('INSERT INTO writers(session_id,fence,unresolved_delivery_id) VALUES(?,?,?)').run(e.session.id,1,e.delivery.id);
   if(fault==='unknown')e.s.db.prepare("UPDATE deliveries SET state='unknown' WHERE id=?").run(e.delivery.id);
   if(fault==='attempt'||fault==='record'){
    const claim=e.s.claim(e.delivery.id),attempt=e.s.fence(e.delivery.id,claim.fence);
    e.s.db.prepare('UPDATE writers SET unresolved_delivery_id=NULL WHERE session_id=?').run(e.session.id);
    e.s.db.prepare("UPDATE deliveries SET state='queued' WHERE id=?").run(e.delivery.id);
    if(fault==='record'){e.d.persist(e.d.eligible()[0],attempt,e.delivery.request_id,'original prompt','');e.s.db.prepare('DELETE FROM attempts WHERE id=?').run(attempt.id);}
   }
   assert.throws(()=>e.s.reconnectNativeSession(e.session.id,previous,candidate),/identity|reconciliation/);
   assert.equal(e.s.db.prepare('SELECT id FROM bindings WHERE session_id=? AND active=1').get(e.session.id).id,e.binding.id);
   assert.equal(e.s.db.prepare('SELECT binding_id FROM deliveries WHERE id=?').get(e.delivery.id).binding_id,e.binding.id);
   assert.equal(e.calls.includes('send'),false);
  }finally{e.s.db.close();}
 }
});

test('reconnect preserves disabled automation and failed re-verification never sends',async()=>{
 const e=setup();try{
  e.s.setAutomation(e.room.id,e.session.id,false);
  const restored=e.s.reconnectNativeSession(e.session.id,e.binding.id,e.fresh);
  assert.equal(JSON.parse(restored.binding.capabilities).automaticInput,false);assert.deepEqual(await e.d.tick(),[]);assert.deepEqual(e.calls,[]);
 }finally{e.s.db.close();}
 const missing=setup();try{
  missing.adapter.reconnect=async()=>({verified:false,reason:'identity_changed'});
  assert.equal((await missing.d.tick())[0].state,'skipped');assert.deepEqual(missing.calls,[]);
  assert.equal(missing.s.db.prepare('SELECT binding_id FROM deliveries WHERE id=?').get(missing.delivery.id).binding_id,missing.binding.id);
 }finally{missing.s.db.close();}
});
