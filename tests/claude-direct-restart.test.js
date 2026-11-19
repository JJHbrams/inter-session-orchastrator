import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm,writeFile,mkdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {createCoordinator} from '../services/coordinator/server.js';
import {createClaudeSessionAdapter} from '../adapters/claude/direct-session.js';

const cwd='C:/direct-restart-project',nativeId='11111111-1111-4111-8111-111111111111';
const digest=value=>createHash('sha256').update(value).digest('hex');

async function setup(t){
 const root=await mkdtemp(join(tmpdir(),'claude-direct-restart-')),dbPath=join(root,'rooms.sqlite'),configDirectory=join(root,'claude'),journalRoot=join(configDirectory,'session-rooms-journal');let spawns=0,nativeCalls=0;
 const adapter=()=>createClaudeSessionAdapter({configDirectory,journalRoot,catalog:async input=>input.nativeId===nativeId&&input.cwd===cwd,ownershipGuard:{check:async()=>({ok:true}),ownRegistration:async()=>null},processInspector:{async self(){return {pid:91,start:'91'};},async inspect(){return null;}},spawnProcess(){spawns++;throw Error('model execution must never start in restart proof');}});
 const runtime=()=>createCoordinator({port:0,dbPath,knowledgeRoot:join(root,'knowledge'),scheduler:false,directAdapter:adapter(),nativeChatAdapter:{async discover(){nativeCalls++;throw Error('Orca must not be queried');}},participantAdapter:{preflight(){throw Error('terminal must not be reached');},send(){throw Error('terminal must not be reached');},},log:{error(){}}});
 t.after(()=>rm(root,{recursive:true,force:true}));return {root,dbPath,configDirectory,journalRoot,adapter,runtime,counts:()=>({spawns,nativeCalls})};
}

async function prepared(t,{withReceipt=false,completed=false}={}){
 const f=await setup(t),first=f.runtime();await first.start();const verified=await f.adapter().verify({provider:'claude',nativeId,cwd,host:'claude/local',profile:'default'}),registered=first.store.registerSession(verified),room=first.store.createRoom('Restart proof'),member=first.store.join(room.id,registered.session.id,false),delivery=first.store.post({roomId:room.id,body:'Preserve this exact request',kind:'followup',targets:[member.id]}).deliveries[0];
 const row=first.participants.eligible().find(x=>x.id===delivery.id),claim=first.store.claim(delivery.id),attempt=first.store.fence(delivery.id,claim.fence);first.store.db.prepare("UPDATE attempts SET state='automatic' WHERE id=?").run(attempt.id);const prompt=first.participants.prompt(row,'',delivery.request_id),record=first.participants.persist(row,attempt,delivery.request_id,prompt,'');
 const operationId=randomUUID(),receipt={transport:'claude-direct',requestId:delivery.request_id,operationId,nativeId,cwd,payloadFingerprint:digest(prompt),leaseToken:'restart-lease'};await mkdir(f.journalRoot,{recursive:true});await writeFile(join(f.journalRoot,operationId+'.json'),JSON.stringify(completed?{version:1,status:'completed',receipt,closeCode:0,confirmedSessionId:nativeId,reply:{body:'Durable reply after coordinator restart',turnId:operationId,itemIds:[randomUUID()]}}:{version:1,status:'prepared',receipt}));
 if(withReceipt)first.participants.persistReceipt(record,receipt);
 await first.close();return {f,registered,room,delivery,attempt,record,receipt,prompt};
}

test('restart keeps SQL-receipt-null prepared direct work unknown and never respawns',async t=>{
 const x=await prepared(t),second=x.f.runtime();await second.start();await second.tick();
 const d=second.store.db.prepare('SELECT state,request_id FROM deliveries WHERE id=?').get(x.delivery.id),p=second.store.db.prepare('SELECT receipt_json,status FROM participant_dispatches WHERE delivery_id=?').get(x.delivery.id),w=second.store.db.prepare('SELECT unresolved_delivery_id FROM writers WHERE session_id=?').get(x.registered.session.id);
 assert.equal(d.state,'unknown');assert.equal(d.request_id,x.delivery.request_id);assert.equal(p.receipt_json,null);assert.equal(w.unresolved_delivery_id,x.delivery.id);assert.equal(x.f.counts().spawns,0);assert.equal(x.f.counts().nativeCalls,0);await second.close();
});

test('restart collects an exact durable direct journal reply once without spawning',async t=>{
 const x=await prepared(t,{withReceipt:true,completed:true}),second=x.f.runtime();await second.start();await second.tick();
 const reply=second.store.db.prepare('SELECT * FROM messages WHERE reply_request_id=?').get(x.delivery.request_id),binding=second.store.db.prepare('SELECT * FROM bindings WHERE id=?').get(x.registered.binding.id),writer=second.store.db.prepare('SELECT unresolved_delivery_id FROM writers WHERE session_id=?').get(x.registered.session.id);
 assert.equal(reply.body,'Durable reply after coordinator restart');assert.equal(reply.provenance,'native_session');assert.equal(binding.incarnation,x.registered.binding.incarnation);assert.equal(writer.unresolved_delivery_id,null);assert.equal(second.store.db.prepare("SELECT count(*) n FROM evidence WHERE attempt_id=? AND source='claude-direct' AND kind='reply'").get(x.attempt.id).n,1);
 await second.tick();await second.participants.retry(x.room.id,x.delivery.id);assert.equal(second.store.db.prepare('SELECT count(*) n FROM messages WHERE reply_request_id=?').get(x.delivery.request_id).n,1);assert.equal(x.f.counts().spawns,0);assert.equal(x.f.counts().nativeCalls,0);await second.close();
});
