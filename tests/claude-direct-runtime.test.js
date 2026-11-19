import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {createCoordinator} from '../services/coordinator/server.js';

const identity={provider:'claude',host:'orca/local',nativeId:'original-claude',cwd:'C:/project',profile:'default'};
const directBinding={...identity,mode:'resume',ownership:'borrowed',handle:identity.nativeId,incarnation:'claude-direct:stable',verified:true,capabilities:{transport:'claude-direct',automaticInput:true,followup:true,steer:false,rawInspect:false,mcpPull:false}};

async function fixture(t){
 const directory=await mkdtemp(join(tmpdir(),'claude-direct-runtime-')),calls=[];
 const direct={async verify(input){calls.push(['verify',input]);return {...directBinding};},async preflight(){calls.push(['preflight']);return {ok:true};},async send(_binding,_session,prompt,requestId,{observeOnly=false,receipt,onPrepared}={}){calls.push([observeOnly?'observe':'send',prompt]);const saved=receipt||{transport:'claude-direct',requestId,operationId:'operation-1',nativeId:identity.nativeId,cwd:identity.cwd,payloadFingerprint:createHash('sha256').update(prompt).digest('hex'),leaseToken:'lease-1'};if(observeOnly)return {ok:true,receipt:saved,reply:{body:'Recovered direct response',turnId:'operation-1',itemIds:['result-1']}};await onPrepared(saved);return {ok:true,receipt:saved,reply:{body:'Direct original-session response',turnId:'operation-1',itemIds:['result-1']}};}};
 const native={discover:async()=>{calls.push(['orca-discover']);return {sessions:[],errors:[]};},preflight(){throw Error('Orca must not receive direct Claude');},send(){throw Error('Orca must not receive direct Claude');}};
 const runtime=createCoordinator({port:0,dbPath:join(directory,'rooms.sqlite'),knowledgeRoot:join(directory,'knowledge'),scheduler:false,directAdapter:direct,nativeChatAdapter:native,participantAdapter:{preflight(){throw Error('terminal must not receive direct Claude');},send(){throw Error('terminal must not receive direct Claude');}},log:{error(){}}});
 t.after(async()=>{await runtime.close();await rm(directory,{recursive:true,force:true});});
 const {baseUrl}=await runtime.start(),boot=await fetch(baseUrl+'api/bootstrap'),bootstrap=await boot.json(),cookie=boot.headers.get('set-cookie').split(';')[0],headers={cookie,'x-csrf-token':bootstrap.csrf,'content-type':'application/json'};
 return {runtime,calls,baseUrl,headers,post:(path,value)=>fetch(baseUrl+path,{method:'POST',headers,body:JSON.stringify(value)})};
}

test('Claude direct endpoint verifies official bindings, migrates only unattempted queued work, and routes without Orca',async t=>{
 const f=await fixture(t),old=f.runtime.store.registerSession({...identity,mode:'live_attach',ownership:'borrowed',handle:'orca-handle',incarnation:'orca:1',verified:true,policyRevision:'kept-policy',capabilities:{transport:'orca-native-chat',automaticInput:false,followup:true}}),room=f.runtime.store.createRoom('Direct Claude'),member=f.runtime.store.join(room.id,old.session.id,false),delivery=f.runtime.store.post({roomId:room.id,body:'Continue original work',kind:'followup',targets:[member.id]}).deliveries[0];
 assert.equal((await fetch(f.baseUrl+'api/sessions/catalog?provider=claude',{headers:f.headers})).status,200);assert.equal(f.calls.some(x=>x[0]==='orca-discover'),false);
 assert.equal((await f.post('api/sessions',{...identity,mode:'resume',verified:true,capabilities:{transport:'claude-direct'}})).status,400);
 assert.equal((await f.post('api/sessions/claude-direct',{...identity,provider:'codex'})).status,400);
 const response=await f.post('api/sessions/claude-direct',{...identity,automaticInput:false}),registered=await response.json();
 assert.equal(response.status,201);assert.equal(registered.session.id,old.session.id);assert.equal(registered.session.alias,old.session.alias);assert.equal(registered.session.native_id,identity.nativeId);assert.equal(registered.binding.mode,'resume');assert.equal(registered.binding.policy_revision,'kept-policy');assert.equal(JSON.parse(registered.binding.capabilities).automaticInput,false);
 assert.equal(f.runtime.store.db.prepare('SELECT binding_id FROM deliveries WHERE id=?').get(delivery.id).binding_id,registered.binding.id);
 assert.equal((await f.runtime.participants.tick()).length,0);await f.post(`api/rooms/${room.id}/sessions/${old.session.id}/automation`,{enabled:true});const results=await f.runtime.participants.tick();assert.equal(results[0].state,'completed');assert.equal(f.calls.filter(x=>x[0]==='send').length,1);assert.equal(f.calls.some(x=>x[0]==='orca-discover'),false);
 const duplicate=f.runtime.store.db.prepare('SELECT * FROM participant_dispatches WHERE delivery_id=?').get(delivery.id);assert.throws(()=>f.runtime.store.replyFromAdapter(delivery.id,duplicate.attempt_id,{bindingId:registered.binding.id,incarnation:registered.binding.incarnation,receipt:{...JSON.parse(duplicate.receipt_json),operationId:'forged'},reply:{body:'forged',turnId:'operation-1',itemIds:['result-1']}}),/uncorrelated/);
 assert.throws(()=>f.runtime.store.replyFromAdapter(delivery.id,duplicate.attempt_id,{bindingId:registered.binding.id,incarnation:registered.binding.incarnation,receipt:{...JSON.parse(duplicate.receipt_json),payloadFingerprint:'0'.repeat(64)},reply:{body:'forged',turnId:'operation-1',itemIds:['result-1']}}),/uncorrelated/);
 assert.equal((await f.runtime.participants.retry(room.id,delivery.id)).state,'completed');assert.equal(f.runtime.store.db.prepare('SELECT count(*) n FROM messages WHERE reply_request_id=?').get(delivery.request_id).n,1);
});

test('direct migration leaves active and unknown legacy delivery receipts untouched',async t=>{
 const f=await fixture(t),old=f.runtime.store.registerSession({...identity,mode:'live_attach',ownership:'borrowed',handle:'orca-handle',incarnation:'orca:1',verified:true,capabilities:{transport:'orca-native-chat',automaticInput:false,followup:true}}),room=f.runtime.store.createRoom('Blocked migration'),member=f.runtime.store.join(room.id,old.session.id,false),delivery=f.runtime.store.post({roomId:room.id,body:'Do not replace active work',kind:'followup',targets:[member.id]}).deliveries[0];
 const claim=f.runtime.store.claim(delivery.id);f.runtime.store.fence(delivery.id,claim.fence);
 const response=await f.post('api/sessions/claude-direct',{...identity,automaticInput:true});assert.equal(response.status,400);assert.equal(f.runtime.store.db.prepare('SELECT binding_id,state FROM deliveries WHERE id=?').get(delivery.id).binding_id,old.binding.id);assert.equal(f.runtime.store.db.prepare('SELECT state FROM deliveries WHERE id=?').get(delivery.id).state,'submitting');
});

test('runtime tick automatically migrates only an idle borrowed Claude participant and preserves disabled automation',async t=>{
 const f=await fixture(t),old=f.runtime.store.registerSession({...identity,mode:'live_attach',ownership:'borrowed',handle:'legacy-handle',incarnation:'legacy:1',verified:true,policyRevision:'kept-policy',capabilities:{transport:'orca-native-chat',automaticInput:false,followup:true}}),room=f.runtime.store.createRoom('Automatic migration'),member=f.runtime.store.join(room.id,old.session.id,false),delivery=f.runtime.store.post({roomId:room.id,body:'Queued before migration',kind:'followup',targets:[member.id]}).deliveries[0];
 await f.runtime.tick();const active=f.runtime.store.db.prepare('SELECT * FROM bindings WHERE session_id=? AND active=1').get(old.session.id);
 assert.equal(active.mode,'resume');assert.equal(JSON.parse(active.capabilities).automaticInput,false);assert.equal(f.runtime.store.db.prepare('SELECT binding_id,request_id FROM deliveries WHERE id=?').get(delivery.id).binding_id,active.id);assert.equal(f.runtime.store.db.prepare('SELECT request_id FROM deliveries WHERE id=?').get(delivery.id).request_id,delivery.request_id);
});
