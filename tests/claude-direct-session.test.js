import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {mkdtemp,mkdir,writeFile,readFile,utimes} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {ClaudeSessionLease} from '../adapters/claude/session-lease.js';
import {createClaudeSessionAdapter,createClaudeOwnershipGuard} from '../adapters/claude/direct-session.js';

const tick=()=>new Promise(r=>setTimeout(r,10));
const root=()=>mkdtemp(join(tmpdir(),'claude-direct-'));
async function until(check){for(let i=0;i<500;i++){const value=await check();if(value)return value;await tick();}throw Error('condition not observed');}
function harness(configDirectory,overrides={}){
 const id=randomUUID(), requestId=randomUUID(), processes=new Map([[process.pid,{pid:process.pid,start:'parent-start'}]]);
 const inspector={async self(){return processes.get(process.pid);},async inspect(pid){return processes.get(pid)||null;}};
 const calls=[],children=[];let nextPid=40001;
 const guard={async check(){return {ok:true};},async ownRegistration(pid){return {pid,sessionId:id,cwd:configDirectory,procStart:'child-'+pid};}};
 const spawnProcess=(command,args,options)=>{
  const child=new EventEmitter();child.pid=nextPid++;child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();
  child.kill=()=>assert.fail('should not kill a session');
  processes.set(child.pid,{pid:child.pid,start:'child-'+child.pid});
  child.input='';child.stdin.on('data',value=>{child.input+=value;});
  child.finish=(result={type:'result',subtype:'success',session_id:id,result:'same conversation answer'})=>{
   if(result)child.stdout.write(JSON.stringify(result)+'\n');processes.delete(child.pid);child.emit('close',0);
  };
  calls.push({command,args,options});children.push(child);return child;
 };
 const options={configDirectory,catalog:async()=>true,processInspector:inspector,ownershipGuard:guard,spawnProcess,pollIntervalMs:1,startupTimeoutMs:500,...overrides};
 const adapter=createClaudeSessionAdapter(options), input={provider:'claude',nativeId:id,cwd:configDirectory};
 return {id,requestId,processes,inspector,guard,options,adapter,input,calls,children};
}
test('default verification requires the exact existing transcript and cwd; retains legacy host',async()=>{
 const config=await root(),cwd=await root(),nativeId=randomUUID(),dir=join(config,'projects','project');
 await mkdir(dir,{recursive:true});await writeFile(join(dir,nativeId+'.jsonl'),JSON.stringify({sessionId:nativeId,cwd,type:'user',message:{role:'user',content:'existing'}})+'\n');
 const adapter=createClaudeSessionAdapter({configDirectory:config});
 const verified=await adapter.verify({provider:'claude',nativeId,cwd,host:'orca/local',profile:'default'});
 assert.equal(verified.verified,true);assert.equal(verified.mode,'resume');assert.equal(verified.host,'orca/local');assert.equal(verified.handle,nativeId);
 assert.equal((await adapter.verify({provider:'claude',nativeId:randomUUID(),cwd})).verified,undefined);
 assert.equal((await adapter.verify({provider:'claude',nativeId,cwd:config})).verified,undefined);
 assert.equal((await adapter.verify({provider:'claude',nativeId:'../escape',cwd})).verified,undefined);
});
test('native registry holds idle owners and fails closed for live malformed metadata',async()=>{
 const config=await root(),directory=join(config,'sessions');await mkdir(directory);
 const id=randomUUID(),processes=new Map([[10,{pid:10,start:'start-10'}]]);
 const guard=createClaudeOwnershipGuard({configDirectory:config,processInspector:{async inspect(pid){return processes.get(pid)||null;}}});
 const file=join(directory,'10.json');
 await writeFile(file,JSON.stringify({pid:10,sessionId:id,cwd:config,procStart:'start-10',status:'idle'}));
 assert.equal((await guard.check({nativeId:id,cwd:config})).reasonCode,'native_session_busy');
 assert.equal((await guard.check({nativeId:id,cwd:config},{pid:10,start:'start-10'})).ok,true);
 await writeFile(file,JSON.stringify({pid:10,sessionId:id,cwd:config,procStart:'old-process'}));
 assert.equal((await guard.check({nativeId:id,cwd:config})).ok,true);
 await writeFile(file,'');
 assert.equal((await guard.check({nativeId:id,cwd:config})).reasonCode,'native_owner_unverified');
 if(process.platform==='win32') {
  const now=Date.now();processes.set(10,{pid:10,start:String(BigInt(now)*10000n+116444736000000000n)});
  await utimes(file,new Date(now-86400000),new Date(now-86400000));
  assert.equal((await guard.check({nativeId:id,cwd:config})).ok,true,'an old malformed record cannot own a PID started a day later');
 }
 processes.clear();assert.equal((await guard.check({nativeId:id,cwd:config})).ok,true);
 const missing=createClaudeOwnershipGuard({configDirectory:join(config,'missing'),processInspector:{async inspect(){return null;}}});
 assert.equal((await missing.check({nativeId:id,cwd:config})).reasonCode,'native_owner_unverified');
});
test('direct resume sends only stdin after preparation, returns promptly and recovers a durable answer',async()=>{
 const config=await root(),h=harness(config),binding=await h.adapter.verify(h.input);let prepared;
 const result=await h.adapter.send(binding,h.input,'original request body',h.requestId,{onPrepared:async receipt=>{
  assert.equal(h.children.length,0);const journal=JSON.parse(await readFile(join(config,'session-rooms-journal',receipt.operationId+'.json'),'utf8'));assert.equal(journal.status,'prepared');prepared=receipt;
 }});
 assert.equal(result.stage,'input_accepted',JSON.stringify(result));assert.equal(h.children.length,1);
 assert.deepEqual(h.calls[0].args.slice(0,3),['--resume',h.id,'--print']);
 assert.equal(h.calls[0].args.includes('original request body'),false);assert.equal(h.calls[0].args.includes('--fork-session'),false);
 assert.equal(h.calls[0].options.shell,false);
 const input=JSON.parse(h.children[0].input);assert.equal(input.session_id,h.id);assert.equal(input.uuid,h.requestId);assert.equal(input.message.content[0].text,'original request body');
 h.children[0].finish();
 const observed=await until(async()=>{const row=await h.adapter.send(binding,h.input,'original request body',h.requestId,{observeOnly:true,receipt:prepared});return row.reply&&row;});
 assert.equal(observed.reply.body,'same conversation answer');assert.equal(observed.reply.body.includes('"type"'),false);
 const restarted=createClaudeSessionAdapter(h.options);
 const recovered=await restarted.send(binding,h.input,'original request body',h.requestId,{receipt:prepared,observeOnly:true});
 assert.deepEqual(recovered.reply,observed.reply);assert.equal(h.calls.length,1);
 assert.equal((await restarted.send(binding,h.input,'tampered',h.requestId,{receipt:prepared,observeOnly:true})).ok,false);
 assert.equal((await restarted.send(binding,h.input,'original request body',h.requestId,{receipt:{...prepared,leaseToken:'forged'},observeOnly:true})).ok,false);
});
test('a second adapter cannot spawn for a live or unknown same-session operation',async()=>{
 const config=await root(),h=harness(config),binding=await h.adapter.verify(h.input);
 const first=await h.adapter.send(binding,h.input,'one',h.requestId);
 const second=createClaudeSessionAdapter(h.options);
 assert.equal((await second.send(binding,h.input,'two',randomUUID())).reasonCode,'session_lease_held');
 const child=h.children[0];h.processes.delete(child.pid);child.emit('close',1);
 await until(async()=>JSON.parse(await readFile(join(config,'session-rooms-journal',first.receipt.operationId+'.json'),'utf8')).status==='unknown');
 assert.equal((await second.send(binding,h.input,'two',randomUUID())).reasonCode,'session_lease_held');
 assert.equal((await second.send(binding,h.input,'one',h.requestId,{observeOnly:true,receipt:first.receipt})).ok,false);assert.equal(h.calls.length,1);
});
test('wrong startup identity or a new external owner refuses before the task is written',async()=>{
 const config=await root(),h=harness(config);
 h.guard.ownRegistration=async pid=>({pid,sessionId:randomUUID(),cwd:config,procStart:'child-'+pid});
 const binding=await h.adapter.verify(h.input),result=await h.adapter.send(binding,h.input,'must not send',h.requestId);
 assert.equal(result.notRecorded,true);assert.equal(h.children[0].input,'');h.children[0].finish(null);await tick();
 const next=await root(),x=harness(next);let checks=0;
 x.guard.check=async()=>++checks===3?{ok:false,reasonCode:'native_session_busy',reason:'busy'}:{ok:true};
 const b=await x.adapter.verify(x.input),r=await x.adapter.send(b,x.input,'must not send',x.requestId);
 assert.equal(r.notRecorded,true);assert.equal(x.children[0].input,'');x.children[0].finish(null);
});
test('spawn and preparation failures before input are not sent; wrong output identity remains unknown',async()=>{
 const config=await root(),h=harness(config,{spawnProcess(){const error=Error('missing');error.code='ENOENT';throw error;}});
 const binding=await h.adapter.verify(h.input),result=await h.adapter.send(binding,h.input,'no input',h.requestId);
 assert.equal(result.notRecorded,true);
 const config2=await root(),x=harness(config2),b=await x.adapter.verify(x.input);
 const refused=await x.adapter.send(b,x.input,'no input',x.requestId,{onPrepared(){throw Error('stale binding');}});
 assert.equal(refused.notRecorded,true);assert.equal(x.calls.length,0);
 const sent=await x.adapter.send(b,x.input,'one',randomUUID());
 x.children[0].finish({type:'result',subtype:'success',session_id:randomUUID(),result:'wrong conversation'});
 await until(async()=>JSON.parse(await readFile(join(config2,'session-rooms-journal',sent.receipt.operationId+'.json'),'utf8')).status==='unknown');
 assert.equal((await x.adapter.send(b,x.input,'one',sent.receipt.requestId,{observeOnly:true,receipt:sent.receipt})).ok,false);
});
test('completed journal recovery releases only the exact dead operation lease so the conversation can continue',async()=>{
 const config=await root(),h=harness(config),alive=new Map([[811,{pid:811,start:'old-owner'}],[812,{pid:812,start:'old-child'}]]);
 const inspector={async self(){return {pid:811,start:'old-owner'};},async inspect(pid){return alive.get(pid)||null;}};
 const leases=new ClaudeSessionLease({configDirectory:config,processInspector:inspector});
 const held=await leases.acquire(h.id),operationId=randomUUID(),child={pid:812,start:'old-child'};
 await leases.update(held,{phase:'running',operationId,childPid:child.pid,childStart:child.start});
 const prompt='already completed',receipt={transport:'claude-direct',requestId:h.requestId,operationId,nativeId:h.id,cwd:config,payloadFingerprint:createHash('sha256').update(prompt).digest('hex'),leaseToken:held.token};
 const directory=join(config,'session-rooms-journal');await mkdir(directory,{recursive:true});
 await writeFile(join(directory,operationId+'.json'),JSON.stringify({status:'completed',receipt,child,closeCode:0,confirmedSessionId:h.id,reply:{body:'finished once',turnId:operationId,itemIds:[operationId]}}));
 alive.clear();
 const adapter=createClaudeSessionAdapter({...h.options,lease:leases,processInspector:inspector}),binding=await adapter.verify(h.input);
 const reply=await adapter.send(binding,h.input,prompt,h.requestId,{observeOnly:true,receipt});
 assert.equal(reply.reply.body,'finished once');assert.equal(h.calls.length,0);
 const next=await leases.acquire(h.id);assert.notEqual(next.ok,false);assert.notEqual(next.token,held.token);
});
