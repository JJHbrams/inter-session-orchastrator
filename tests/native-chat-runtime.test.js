import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCoordinator} from '../services/coordinator/server.js';
import {createOrcaNativeChatAdapter} from '../adapters/orca/native-chat.js';

test('merged runtime verifies native invitations, confirms unsent binding and routes a direct reply over authenticated HTTP',async t=>{
  const directory=await mkdtemp(join(tmpdir(),'native-runtime-'));
  const identity={provider:'claude',host:'orca/local',nativeId:'original-conversation',cwd:'C:/original-project',profile:'default'};
  const calls=[];
  const native={async verify(input){calls.push('verify');if(input.nativeId!==identity.nativeId||input.cwd!==identity.cwd||input.handle&&input.handle!=='actor')return {ok:false,reason:'identity mismatch'};return {...identity,handle:'actor',incarnation:'runtime:3',verified:true,mode:'live_attach',ownership:'borrowed',capabilities:{transport:'orca-native-chat',automaticInput:true,followup:true}};},async preflight(){return {ok:true};},async send(row,_session,_prompt,requestId,options){calls.push('send');const receipt={sessionId:'actor',nativeId:identity.nativeId,runtimeId:'runtime',fence:3,requestId,clientOperationId:'1793860000000-'+requestId.replaceAll('-',''),payloadFingerprint:'official-operation'};await options.onPrepared(receipt);return {ok:true,receipt,reply:{body:'Direct original-session answer',turnId:'turn',itemIds:['assistant']}};}};
  const runtime=createCoordinator({port:0,dbPath:join(directory,'rooms.sqlite'),knowledgeRoot:join(directory,'knowledge'),scheduler:false,nativeChatAdapter:native,participantAdapter:{preflight(){throw Error('native actor reached terminal transport');}},log:{error(){}}});
  t.after(async()=>{await runtime.close();await rm(directory,{recursive:true,force:true});});
  const {baseUrl}=await runtime.start(),boot=await fetch(baseUrl+'api/bootstrap'),bootstrap=await boot.json(),cookie=boot.headers.get('set-cookie').split(';')[0];
  const headers={cookie,'x-csrf-token':bootstrap.csrf,'content-type':'application/json'};
  const post=(path,value)=>fetch(baseUrl+path,{method:'POST',headers,body:JSON.stringify(value)});
  const room=runtime.store.createRoom('Native HTTP'),old=runtime.store.registerSession({...identity,mode:'live_attach',verified:true,capabilities:{followup:true}}),member=runtime.store.join(room.id,old.session.id,false);
  const delivery=runtime.store.post({roomId:room.id,body:'Continue the existing discussion',kind:'followup',targets:[member.id]}).deliveries[0];
  assert.equal((await fetch(baseUrl+'api/sessions/native-chat',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(identity)})).status,401);
  assert.equal((await post('api/sessions',{...identity,verified:true,capabilities:{transport:'orca-native-chat'}})).status,400);
  assert.equal((await post('api/sessions/native-chat',{...identity,handle:'wrong-actor'})).status,400);
  const response=await post('api/sessions/native-chat',{...identity,handle:'actor',automaticInput:false,verified:false,capabilities:{rawInspect:true}});
  assert.equal(response.status,201);const verified=await response.json();assert.equal(verified.session.id,old.session.id);
  const caps=JSON.parse(verified.binding.capabilities);assert.equal(caps.automaticInput,false);assert.equal(caps.rawInspect,undefined);
  assert.equal((await post(`api/rooms/${room.id}/deliveries/${delivery.id}/rebind`,{bindingId:'wrong'})).status,400);
  const rebound=await post(`api/rooms/${room.id}/deliveries/${delivery.id}/rebind`,{bindingId:verified.binding.id});assert.equal(rebound.status,200);assert.equal((await rebound.json()).request_id,delivery.request_id);
  assert.deepEqual(await runtime.participants.tick(),[]);
  assert.equal((await post(`api/rooms/${room.id}/sessions/${old.session.id}/automation`,{enabled:true})).status,200);
  assert.equal((await runtime.participants.tick())[0].state,'completed');assert.equal(calls.filter(x=>x==='send').length,1);
  assert.equal(runtime.store.db.prepare('SELECT count(*) n FROM registrations').get().n,0);
  const result=await (await fetch(baseUrl+`api/rooms/${room.id}`,{headers})).json();
  assert.equal(result.messages.find(m=>m.reply_request_id===delivery.request_id).body,'Direct original-session answer');
  assert.equal((await post(`api/rooms/${room.id}/deliveries/${delivery.id}/rebind`,{bindingId:verified.binding.id})).status,400);
});

test('persisted native participant reconnects after host and coordinator restart over the normal runtime route',async t=>{
 const directory=await mkdtemp(join(tmpdir(),'native-restart-')),cwd='C:/original-project',nativeId='original-conversation';
 let hostRuntime='host-before',actor='actor-before',submitted=null,sends=0;
 const capabilities=['agent-session.structured.v1','agent-session.accepted-send.v1','agent-session.pending-send-result.v1','agent-session.queued-messages.v2'];
 const native=createOrcaNativeChatAdapter({operationIdFactory:()=> '1793860000000-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',mutation:input=>({envelope:{sessionId:input.sessionId,clientOperationId:input.clientOperationId,expectedRuntimeFence:input.expectedRuntimeFence,payloadFingerprint:'official-body'},body:input.body}),call:async(method,params)=>{
  if(method==='status.get')return {runtimeId:hostRuntime,capabilities};
  if(method==='session.tabs.listAll')return {snapshots:[{worktree:`workspace::${cwd}`,publicationEpoch:hostRuntime,tabs:[{type:'agent-session',sessionId:actor,agent:'claude'}]}]};
  if(method==='agentSession.send'){sends++;assert.equal(params.envelope.sessionId,'actor-after');submitted=params.envelope.clientOperationId;return {ok:true,value:{clientMessageId:submitted}};}
  if(method==='agentSession.history')return {ok:true,providerSession:{id:nativeId},page:{sessionId:actor,fence:5,epoch:hostRuntime,working:false,queuedMessages:[],actionablePromptIds:[],hasOlder:false,submissions:submitted?[{clientMessageId:submitted,providerItemId:'user',fence:5,payloadFingerprint:'official-body'}]:[],items:submitted?[{itemId:'user',body:{kind:'message',role:'user'}},{itemId:'turn',body:{kind:'turn',userItemId:'user',state:'completed',outcome:'success'}},{itemId:'answer',body:{kind:'message',role:'assistant',blocks:[{type:'text',text:'Same original conversation after restart'}]},turnScope:{kind:'turn',turnItemId:'turn'}}]:[]}};
  throw Error('unexpected RPC '+method);
 }});
 const runtime=createCoordinator({port:0,dbPath:join(directory,'rooms.sqlite'),knowledgeRoot:join(directory,'knowledge'),scheduler:false,nativeChatAdapter:native,participantAdapter:{preflight(){throw Error('must not route native chat to terminal');}},log:{error(){}}});
 t.after(async()=>{await runtime.close();await rm(directory,{recursive:true,force:true});});
 await runtime.start();const registered=runtime.store.registerSession(await native.verify('claude',nativeId,cwd)),room=runtime.store.createRoom('Original room'),member=runtime.store.join(room.id,registered.session.id,false);
 const original=runtime.store.post({roomId:room.id,body:'Continue after restarting the app',kind:'followup',targets:[member.id]}).deliveries[0];
 await runtime.close();hostRuntime='host-after';actor='actor-after';const {baseUrl}=await runtime.start();
 assert.equal((await runtime.participants.tick())[0].state,'completed');assert.equal(sends,1);
 const boot=await fetch(baseUrl+'api/bootstrap'),cookie=boot.headers.get('set-cookie').split(';')[0];
 const projection=await (await fetch(baseUrl+`api/rooms/${room.id}`,{headers:{cookie}})).json();
 assert.equal(projection.members.find(m=>m.id===member.id).session_id,registered.session.id);
 assert.equal(projection.members.find(m=>m.id===member.id).incarnation,'host-after:5');
 assert.equal(projection.messages.find(m=>m.reply_request_id===original.request_id).body,'Same original conversation after restart');
 assert.equal(projection.deliveries.find(d=>d.id===original.id).request_id,original.request_id);
 assert.equal(runtime.store.db.prepare('SELECT count(*) n FROM sessions').get().n,1);
});
