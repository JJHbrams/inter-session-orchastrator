import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../services/coordinator/store.js';
import {ParticipantInterrupts} from '../services/coordinator/participant-interrupt.js';

function fixture(){
 const store=new Store(),room=store.createRoom('interrupt fixture'),otherRoom=store.createRoom('other room'),session=store.registerSession({provider:'codex',nativeId:'native',host:'test',cwd:'C:/fixture',profile:'default',mode:'live_attach',ownership:'borrowed',verified:true,handle:'terminal',incarnation:'inc',capabilities:{followup:true}}).session;
 const member=store.join(room.id,session.id,false),otherMember=store.join(otherRoom.id,session.id,false);
 store.db.exec('CREATE TABLE agendas(id TEXT PRIMARY KEY,room_id TEXT,phase TEXT);CREATE TABLE agenda_messages(agenda_id TEXT,message_id TEXT,kind TEXT)');store.db.prepare('INSERT INTO agendas VALUES(?,?,?)').run('agenda',room.id,'collecting');
 const delivery=store.post({roomId:room.id,body:'owned request',kind:'followup',targets:[member.id]}).deliveries[0],claim=store.claim(delivery.id);store.fence(delivery.id,claim.fence);store.db.prepare("UPDATE deliveries SET state='running' WHERE id=?").run(delivery.id);store.db.prepare('INSERT INTO agenda_messages VALUES(?,?,?)').run('agenda',delivery.message_id,'reactive:peer');
 const row=store.db.prepare('SELECT * FROM bindings WHERE session_id=?').get(session.id),proof={nativeTaskId:'task',deliveryId:delivery.id,requestId:delivery.request_id,nativeId:session.native_id,bindingId:row.id,incarnation:'inc',fence:claim.fence,running:true};
 const input={membershipId:member.id,deliveryId:delivery.id,fence:claim.fence,reason:'test scoped cancellation'},writer=()=>store.db.prepare('SELECT * FROM writers WHERE session_id=?').get(session.id);
 return {store,room,otherRoom,member,otherMember,session,delivery,proof,input,writer};
}
test('unsupported native cancellation never sends a key or releases the active writer',async()=>{
 const f=fixture();let calls=0;const interrupts=new ParticipantInterrupts(f.store,{adapter:{capabilities:{hardInterrupt:false},interruptExact:async()=>{calls++}}});const result=await interrupts.request(f.room.id,'agenda',f.input);assert.equal(result.status,'unsupported');assert.equal(calls,0);assert.equal(f.writer().unresolved_delivery_id,f.delivery.id);f.store.db.close();
});
test('wrong task proof and wrong scope reject before interruption',async()=>{
 for(const changed of [{nativeId:'other'},{bindingId:'other'},{incarnation:'other'},{fence:99},{deliveryId:'other'},{requestId:'other'}]){
  const f=fixture();let calls=0;const interrupts=new ParticipantInterrupts(f.store,{adapter:{capabilities:{hardInterrupt:true},inspectTask:async()=>({...f.proof,...changed}),interruptExact:async()=>{calls++}}});const result=await interrupts.request(f.room.id,'agenda',f.input);assert.equal(result.status,'rejected');assert.equal(calls,0);assert.equal(f.writer().unresolved_delivery_id,f.delivery.id);await assert.rejects(interrupts.request(f.otherRoom.id,'agenda',f.input),/inactive|outside/);f.store.db.close();
 }
});
test('an accepted interrupt receipt or timeout is unknown, never confirmed stop',async()=>{
 for(const mode of ['receipt','timeout']){const f=fixture(),interrupts=new ParticipantInterrupts(f.store,{timeoutMs:5,adapter:{capabilities:{hardInterrupt:true},inspectTask:async()=>f.proof,interruptExact:async()=>mode==='receipt'?{...f.proof,accepted:true}:new Promise(()=>{})}});const result=await interrupts.request(f.room.id,'agenda',f.input);assert.equal(result.status,'unknown');assert.equal(f.writer().unresolved_delivery_id,f.delivery.id);assert.equal(f.store.db.prepare('SELECT state FROM deliveries WHERE id=?').get(f.delivery.id).state,'running');f.store.db.close();}
});
test('exact termination proof stops only the matching active fence and retains message bytes',async()=>{
 const f=fixture(),interrupts=new ParticipantInterrupts(f.store,{adapter:{capabilities:{hardInterrupt:true},inspectTask:async()=>f.proof,interruptExact:async()=>({...f.proof,closed:true,terminated:true})}});const result=await interrupts.request(f.room.id,'agenda',f.input);assert.equal(result.status,'stopped');assert.equal(f.writer().unresolved_delivery_id,null);assert.equal(f.store.db.prepare('SELECT body FROM messages WHERE id=?').get(f.delivery.message_id).body,'owned request');assert.equal(f.store.db.prepare('SELECT outcome FROM deliveries WHERE id=?').get(f.delivery.id).outcome,'interrupted');f.store.db.close();
});
test('late termination proof cannot release a newer writer or a replacement binding',async()=>{
 for(const change of ['fence','binding']){const f=fixture(),interrupts=new ParticipantInterrupts(f.store,{adapter:{capabilities:{hardInterrupt:true},inspectTask:async()=>f.proof,interruptExact:async()=>{if(change==='fence')f.store.db.prepare('UPDATE writers SET fence=fence+1 WHERE session_id=?').run(f.session.id);else f.store.db.prepare("UPDATE bindings SET incarnation='replacement' WHERE session_id=?").run(f.session.id);return {...f.proof,closed:true,terminated:true};}}});const result=await interrupts.request(f.room.id,'agenda',f.input);assert.equal(result.status,'unknown');assert.equal(f.writer().unresolved_delivery_id,f.delivery.id);assert.equal(f.store.db.prepare('SELECT state FROM deliveries WHERE id=?').get(f.delivery.id).state,'running');f.store.db.close();}
});
test('confirmed termination leaves a queued request in another room intact and claimable',async()=>{
 const f=fixture(),other=f.store.post({roomId:f.otherRoom.id,body:'unrelated pending work',kind:'followup',targets:[f.otherMember.id]}).deliveries[0],interrupts=new ParticipantInterrupts(f.store,{adapter:{capabilities:{hardInterrupt:true},inspectTask:async()=>f.proof,interruptExact:async()=>({...f.proof,closed:true,terminated:true})}});
 await interrupts.request(f.room.id,'agenda',f.input);assert.equal(f.store.db.prepare('SELECT state FROM deliveries WHERE id=?').get(other.id).state,'queued');assert.ok(f.store.claim(other.id));assert.equal(f.writer().unresolved_delivery_id,other.id);f.store.db.close();
});
test('concurrent and completed duplicate stop requests share one native interruption',async()=>{
 const f=fixture();let finish,calls=0;const proof=new Promise(resolve=>{finish=resolve}),interrupts=new ParticipantInterrupts(f.store,{adapter:{capabilities:{hardInterrupt:true},inspectTask:async()=>f.proof,interruptExact:async()=>{calls++;return proof}}});
 const pending=interrupts.request(f.room.id,'agenda',f.input),duplicate=await interrupts.request(f.room.id,'agenda',f.input);assert.equal(duplicate.status,'interrupt_requested');assert.equal(f.writer().unresolved_delivery_id,f.delivery.id);finish({...f.proof,closed:true,terminated:true});const result=await pending;assert.equal(result.id,duplicate.id);assert.equal(calls,1);assert.equal((await interrupts.request(f.room.id,'agenda',f.input)).status,'stopped');f.store.db.close();
});
test('a proof arriving after timeout cannot later clear the writer',async()=>{
 const f=fixture();let finish;const proof=new Promise(resolve=>{finish=resolve}),interrupts=new ParticipantInterrupts(f.store,{timeoutMs:5,adapter:{capabilities:{hardInterrupt:true},inspectTask:async()=>f.proof,interruptExact:async()=>proof}});const result=await interrupts.request(f.room.id,'agenda',f.input);assert.equal(result.status,'unknown');finish({...f.proof,closed:true,terminated:true});await new Promise(r=>setImmediate(r));assert.equal(interrupts.row(result.id).status,'unknown');assert.equal(f.writer().unresolved_delivery_id,f.delivery.id);f.store.db.close();
});
