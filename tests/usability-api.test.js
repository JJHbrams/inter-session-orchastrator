import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve,sep} from 'node:path';
import {createCoordinator} from '../services/coordinator/server.js';
async function fixture(t,{delay=0}={}){
 const root=await mkdtemp(join(tmpdir(),'rooms-feedback-api-'));let reads=0,launches=0,model='qa-model',effort='high';
 const binding=(nativeId='provider-id',handle='actor')=>({provider:'claude',host:'orca/local',nativeId,cwd:root,profile:'default',mode:'live_attach',ownership:'borrowed',handle,incarnation:'qa-runtime:1',verified:true,capabilities:{transport:'orca-native-chat',followup:true,automaticInput:true,nativeChat:{runtimeId:'qa-runtime',fence:1,providerSessionId:nativeId,workspace:'qa::'+root,epoch:1}}});
 const native={async verify(){return binding()},async discover(){return {sessions:[binding()]}},async readMetadata(expected){reads++;return {ok:true,binding:expected,metadata:{model,effort,source:'qa-options'}}}};
 const launcher={createOperationId:()=> '1700000000000-0123456789abcdef0123456789abcdef',async launch(){launches++;if(delay)await new Promise(done=>setTimeout(done,delay));const b=binding('fresh-provider','fresh-actor');return {status:'ready',nativeId:b.nativeId,handle:b.handle,binding:b}}};
 const runtime=createCoordinator({port:0,dbPath:join(root,'rooms.sqlite'),knowledgeRoot:join(root,'knowledge'),workspaceRoot:root,scheduler:false,nativeChatAdapter:native,sessionLauncher:launcher,sessionCatalog:async()=>({sessions:[],errors:[]}),settingsAdapter:{inspect(){throw Error('Manual picker must never run automatically')}},log:{error(){}}});const info=await runtime.start();
 t.after(async()=>{await runtime.close();assert.ok(resolve(root).startsWith(resolve(tmpdir())+sep));await rm(root,{recursive:true,force:true})});
 const boot=await fetch(info.baseUrl+'api/bootstrap'),token=await boot.json(),headers={cookie:boot.headers.get('set-cookie').split(';')[0],'x-csrf-token':token.csrf,'content-type':'application/json'};
 const call=async(path,payload)=>{const response=await fetch(info.baseUrl+path,{headers,...(payload===undefined?{}:{method:'POST',body:JSON.stringify(payload)})});return {status:response.status,body:await response.json()}};
 const room=runtime.store.createRoom('qa room',null,root);return {root,runtime,room,call,binding,get reads(){return reads},get launches(){return launches},changeModel:(m,e)=>{model=m;effort=e}};
}
async function until(read,condition){for(let n=0;n<50;n++){const value=await read();if(condition(value))return value;await new Promise(done=>setTimeout(done,20))}throw Error('condition not observed')}
test('native invite obtains model/effort without a picker, and completed response refreshes it',async t=>{
 const f=await fixture(t);const registered=(await f.call('api/sessions/native-chat',{provider:'claude',nativeId:'provider-id',cwd:f.root,handle:'actor',automaticInput:true})).body;assert.ok(registered.session?.id);await f.call('api/rooms/'+f.room.id+'/join',{sessionId:registered.session.id,readOnly:false});
 const read=()=>f.call('api/rooms/'+f.room.id);let state=await until(read,x=>x.body.members[0]?.modelSettings?.observed?.model==='qa-model');assert.equal(state.body.members[0].modelSettings.observed.effort,'high');assert.ok(f.reads>0);
 const sessionId=registered.session.id,old={...state.body.members[0].modelSettings.observed,observedAt:'2000-01-01T00:00:00.000Z'};f.runtime.store.db.prepare('UPDATE session_model_settings SET observed_json=? WHERE session_id=?').run(JSON.stringify(old),sessionId);
 const message=f.runtime.store.post({roomId:f.room.id,senderSessionId:sessionId,body:'completed response',kind:'post'}).message;f.runtime.store.db.prepare('UPDATE messages SET reply_request_id=? WHERE id=?').run('qa-response',message.id);f.changeModel('qa-next-model',null);
 state=await until(read,x=>x.body.members[0]?.modelSettings?.observed?.model==='qa-next-model');assert.equal(state.body.members[0].modelSettings.observed.effort,null);
});
test('creation endpoint returns pending quickly, joins a verified native binding once, and reconciles ready idempotently',async t=>{
 const f=await fixture(t,{delay:80}),path='api/rooms/'+f.room.id+'/sessions/create',payload={provider:'claude',cwd:f.root,requestKey:'one'};const first=await f.call(path,payload);assert.equal(first.status,202);assert.equal(first.body.status,'pending');const second=await f.call(path,payload);assert.equal(second.body.id,first.body.id);
 const state=await until(()=>f.call('api/rooms/'+f.room.id),x=>x.body.sessionCreations[0]?.status==='ready');assert.equal(f.launches,1);assert.equal(state.body.members.length,1);const member=state.body.members[0];assert.equal(member.native_id,'fresh-provider');assert.equal(member.incarnation,'qa-runtime:1');assert.equal(JSON.parse(member.capabilities).transport,'orca-native-chat');
 const again=await f.call('api/rooms/'+f.room.id+'/session-creations/'+first.body.id+'/reconcile',{});assert.equal(again.status,202);assert.equal(again.body.status,'ready');assert.equal(f.launches,1);
});
