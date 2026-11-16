import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer, request } from 'node:http';
import { spawn } from 'node:child_process';
import { createCoordinator } from '../services/coordinator/server.js';

async function fixture(t,overrides={}){
 const profile=await mkdtemp(join(tmpdir(),'rooms desktop-'));
 const runtime=createCoordinator({port:0,dbPath:join(profile,'rooms.sqlite'),knowledgeRoot:join(profile,'knowledge'),scheduler:false,log:{error(){}},...overrides});
 t.after(async()=>{await runtime.close();await rm(profile,{recursive:true,force:true})});
 return {profile,runtime};
}
async function operator(baseUrl){
 const response=await fetch(baseUrl+'api/bootstrap');assert.equal(response.status,200);
 const body=await response.json(),cookie=response.headers.get('set-cookie').split(';')[0];
 return {headers:{cookie,'x-csrf-token':body.csrf,'content-type':'application/json',origin:new URL(baseUrl).origin},cookie};
}
function raw(baseUrl,path,headers){return new Promise((ok,fail)=>{
 const req=request(new URL(path,baseUrl),{headers},res=>{res.resume();res.on('end',()=>ok(res.statusCode))});req.on('error',fail);req.end();
})}

test('import performs no database or knowledge initialization',async t=>{
 const profile=await mkdtemp(join(tmpdir(),'rooms-import-'));t.after(()=>rm(profile,{recursive:true,force:true}));
 const database=join(profile,'never-created.sqlite');
 const child=spawn(process.execPath,['--input-type=module','-e',"await import('./services/coordinator/server.js');console.log('imported')"],{cwd:resolve(import.meta.dirname,'..'),env:{...process.env,ROOMS_DB:database,ROOMS_KNOWLEDGE_ROOT:join(profile,'knowledge')},windowsHide:true});
 let output='',errors='';child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>errors+=x);
 const code=await new Promise((ok,fail)=>{child.on('error',fail);child.on('exit',ok)});
 assert.equal(code,0,errors);assert.equal(output.trim(),'imported');await assert.rejects(access(database));await assert.rejects(access(join(profile,'knowledge')));
});

test('ephemeral endpoint keeps Host, Origin, cookie and CSRF boundaries',async t=>{
 const {runtime}=await fixture(t);const info=await runtime.start(),auth=await operator(info.baseUrl);
 assert.ok(info.port>0);assert.equal(info.host,'127.0.0.1');
 assert.equal(await raw(info.baseUrl,'api/bootstrap',{host:'attacker.invalid'}),403);
 assert.equal((await fetch(info.baseUrl+'api/bootstrap',{headers:{origin:'https://attacker.invalid'}})).status,403);
 assert.equal((await fetch(info.baseUrl+'api/channels')).status,401);
 assert.equal(await raw(info.baseUrl,'api/channels',{cookie:`rooms_session_${info.port}=${'é'.repeat(43)}`}),401);
 assert.equal((await fetch(info.baseUrl+'api/channels',{method:'POST',headers:{cookie:auth.cookie,'content-type':'application/json'},body:JSON.stringify({name:'missing CSRF'})})).status,403);
 assert.equal((await fetch(info.baseUrl+'api/channels',{method:'POST',headers:{...auth.headers,origin:'https://attacker.invalid'},body:JSON.stringify({name:'foreign origin'})})).status,403);
 assert.equal((await fetch(info.baseUrl+'api/channels',{headers:auth.headers})).status,200);
});

test('simultaneous instances isolate authentication, routes and databases',async t=>{
 const a=await fixture(t),b=await fixture(t);const [ai,bi]=await Promise.all([a.runtime.start(),b.runtime.start()]);
 const [aa,ba]=await Promise.all([operator(ai.baseUrl),operator(bi.baseUrl)]);
 assert.notEqual(ai.port,bi.port);
 assert.equal((await fetch(ai.baseUrl+'api/channels',{method:'POST',headers:aa.headers,body:JSON.stringify({name:'only A'})})).status,201);
 assert.equal((await (await fetch(ai.baseUrl+'api/channels',{headers:aa.headers})).json()).channels.length,1);
 assert.equal((await (await fetch(bi.baseUrl+'api/channels',{headers:ba.headers})).json()).channels.length,0);
 assert.equal((await fetch(bi.baseUrl+'api/channels',{headers:aa.headers})).status,401);
 await a.runtime.close();assert.equal((await fetch(bi.baseUrl+'api/channels',{headers:ba.headers})).status,200);
});

test('profile is default room workspace and knowledge settings survive restart',async t=>{
 const {runtime,profile}=await fixture(t);const info=await runtime.start(),auth=await operator(info.baseUrl);
 const response=await fetch(info.baseUrl+'api/rooms',{method:'POST',headers:auth.headers,body:JSON.stringify({name:'profile room'})});
 assert.equal(response.status,201);const room=await response.json();assert.equal(resolve(room.cwd),resolve(profile));
 assert.equal(resolve(runtime.knowledge.getSettings().storageRoot),resolve(profile,'knowledge'));
 const changed=join(profile,'selected knowledge');
 const settings=await fetch(info.baseUrl+'api/settings',{method:'POST',headers:auth.headers,body:JSON.stringify({storageRoot:changed})});
 assert.equal(settings.status,200);assert.equal(resolve(runtime.info().knowledgeRoot),resolve(changed));
 await runtime.close();assert.equal(resolve(runtime.info().knowledgeRoot),resolve(changed));
 const reopened=await runtime.start(),auth2=await operator(reopened.baseUrl);
 assert.equal((await (await fetch(reopened.baseUrl+'api/rooms',{headers:auth2.headers})).json()).rooms.length,1);
 assert.equal(resolve(runtime.info().knowledgeRoot),resolve(changed));
});

test('concurrent start opens one listener and shutdown is idempotent',async t=>{
 const {runtime}=await fixture(t);const [a,b]=await Promise.all([runtime.start(),runtime.start()]);assert.equal(a.port,b.port);
 const db=runtime.store.db;await Promise.all([runtime.close(),runtime.close()]);
 assert.throws(()=>db.prepare('SELECT 1'));await runtime.close();
});

test('listen failure releases database and allows retry after port is free',async t=>{
 const occupied=createServer();await new Promise(ok=>occupied.listen(0,'127.0.0.1',ok));t.after(()=>{if(occupied.listening)occupied.close()});
 const {runtime}=await fixture(t,{port:occupied.address().port});await assert.rejects(runtime.start(),{code:'EADDRINUSE'});
 assert.throws(()=>runtime.store.db.prepare('SELECT 1'));
 await new Promise(ok=>occupied.close(ok));const info=await runtime.start();assert.ok(info.port>0);
});

test('shutdown drains an already accepted chair initialization before closing its database',async t=>{
 let release,entered;const barrier=new Promise(ok=>release=ok),initializing=new Promise(ok=>entered=ok);
 const runner={initialize:async({nativeId})=>{entered();await barrier;return {nativeId,started:true,output:{speech:'initialized before shutdown',questions:[],proposal:null}}}};
 const {runtime}=await fixture(t,{chairRunner:runner});const info=await runtime.start(),auth=await operator(info.baseUrl);
 const room=await (await fetch(info.baseUrl+'api/rooms',{method:'POST',headers:auth.headers,body:JSON.stringify({name:'drain chair'})})).json();
 const accepted=await fetch(info.baseUrl+`api/rooms/${room.id}/chair`,{method:'POST',headers:auth.headers,body:'{}'});assert.equal(accepted.status,202);await initializing;
 const closing=runtime.close({timeoutMs:2000});await new Promise(ok=>setTimeout(ok,25));
 assert.doesNotThrow(()=>runtime.store.db.prepare('SELECT 1').get());release();await closing;
 await runtime.start();assert.equal(runtime.store.chair(room.id).status,'ready');
});

test('drain timeout cannot report a closed listener as ready; finish close before restarting',async t=>{
 let release,entered;const barrier=new Promise(ok=>release=ok),initializing=new Promise(ok=>entered=ok);
 const runner={initialize:async({nativeId})=>{entered();await barrier;return {nativeId,started:true,output:{speech:'drained after timeout',questions:[],proposal:null}}}};
 const {runtime}=await fixture(t,{chairRunner:runner});const info=await runtime.start(),auth=await operator(info.baseUrl);
 const room=await (await fetch(info.baseUrl+'api/rooms',{method:'POST',headers:auth.headers,body:JSON.stringify({name:'drain timeout'})})).json();
 const accepted=await fetch(info.baseUrl+`api/rooms/${room.id}/chair`,{method:'POST',headers:auth.headers,body:'{}'});assert.equal(accepted.status,202);await initializing;
 try{
  await assert.rejects(runtime.close({timeoutMs:1}),{code:'BUSY'});
  await assert.rejects(runtime.start(),{code:'CLOSING'});
  await assert.rejects(fetch(info.baseUrl+'api/bootstrap',{signal:AbortSignal.timeout(1000)}));
  assert.doesNotThrow(()=>runtime.store.db.prepare('SELECT 1').get());
 }finally{release();await runtime.close()}
 const restarted=await runtime.start();assert.equal((await fetch(restarted.baseUrl+'api/bootstrap')).status,200);
 assert.equal(runtime.store.chair(room.id).status,'ready');
});
