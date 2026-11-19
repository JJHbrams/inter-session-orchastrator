import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {fork} from 'node:child_process';
import {ClaudeSessionLease,createProcessInspector} from '../adapters/claude/session-lease.js';

const fixture=async state=>{const root=await mkdtemp(join(tmpdir(),'claude-lease-')),inspector={async self(){return {pid:1,start:'self'};},async inspect(pid){return state.get(pid);}};return {root,inspector,lease:new ClaudeSessionLease({root,processInspector:inspector})};};
test('default inspector returns a stable self identity and definitive dead PID',async()=>{const inspector=createProcessInspector(),self=await inspector.self(),same=await inspector.inspect(process.pid);assert.equal(same.pid,self.pid);assert.equal(same.start,self.start);assert.equal(await inspector.inspect(2147483647),null);await assert.rejects(()=>inspector.inspect(0));});
test('a live acquired owner blocks a second lease',async()=>{const state=new Map([[1,{pid:1,start:'self'}]]),f=await fixture(state),first=await f.lease.acquire('same'),second=await f.lease.acquire('same');assert.ok(first.token);assert.equal(second.reasonCode,'session_lease_held');});
test('empty and malformed lock directories fail closed',async()=>{for(const value of ['', '{bad']){const state=new Map(),f=await fixture(state),path=f.lease.path('same');await mkdir(path);if(value)await writeFile(join(path,'lease.json'),value);const result=await f.lease.acquire('same');assert.equal(result.reasonCode,'session_lease_held');}});
test('a PID-reused acquired owner is safely reclaimed while launching remains held',async()=>{const state=new Map([[9,{pid:9,start:'new'}]]),f=await fixture(state),path=f.lease.path('same');await mkdir(path);await writeFile(join(path,'lease.json'),JSON.stringify({sessionId:'same',token:'old',phase:'acquired',owner:{pid:9,start:'old'}}));const fresh=await f.lease.acquire('same');assert.ok(fresh.token);await f.lease.update(fresh,{phase:'launching'});state.delete(1);const held=await f.lease.acquire('same');assert.equal(held.reasonCode,'session_lease_held');});
test('stale token cannot update or release another lease',async()=>{const state=new Map([[1,{pid:1,start:'self'}]]),f=await fixture(state),lease=await f.lease.acquire('same');await assert.rejects(()=>f.lease.update({...lease,token:'wrong'},{}));assert.equal(await f.lease.release({...lease,token:'wrong',phase:'closed'}),false);});
test('separate Node contenders have exactly one winner for live and stale-reclaim races',async()=>{
 for(const stale of [false,true]){
  const root=await mkdtemp(join(tmpdir(),'claude-lease-race-')),session='same';
  const fixtureLease=new ClaudeSessionLease({root,processInspector:{async self(){return {pid:999,start:'old'};},async inspect(){return null;}}});
  if(stale){const path=fixtureLease.path(session);await mkdir(path);await writeFile(join(path,'lease.json'),JSON.stringify({sessionId:session,token:'old',phase:'acquired',owner:{pid:999,start:'old'}}));}
  const worker=fileURLToPath(new URL('./helpers/claude-lease-worker.mjs',import.meta.url));
  const children=[0,1].map(()=>fork(worker,[],{env:{...process.env,LEASE_ROOT:root,LEASE_SESSION:session},stdio:['ignore','ignore','ignore','ipc']}));
  const exits=children.map(child=>new Promise((resolve,reject)=>{child.once('exit',code=>code===0?resolve():reject(Error('lease fixture exit '+code)));child.once('error',reject);}));
  const message=child=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('lease fixture message timeout')),10000);child.once('message',value=>{clearTimeout(timer);resolve(value);});child.once('error',error=>{clearTimeout(timer);reject(error);});});
  await Promise.all(children.map(message));
  const results=children.map(message);children.forEach(child=>child.send('go'));
  const all=await Promise.all(results);
  assert.equal(all.filter(x=>x.ok).length,1);assert.equal(all.filter(x=>x.reason==='session_lease_held').length,1);
  await Promise.all(exits);
 }
});
test('completed proof reclaims only exact dead owner and child lease',async()=>{const state=new Map([[1,{pid:1,start:'self'}],[2,{pid:2,start:'child'}]]),f=await fixture(state),lease=await f.lease.acquire('same'),running=await f.lease.update(lease,{phase:'running',operationId:'op',childPid:2,childStart:'child'});state.clear();assert.equal(await f.lease.reconcileCompleted('same',{token:running.token,operationId:'op',child:{pid:2,start:'child'}}),true);assert.ok((await f.lease.acquire('same')).token);});
test('completed reconciliation keeps live, unknown, or forged lease evidence held',async()=>{for(const mode of ['owner','child','forged','missing']){const state=new Map([[1,{pid:1,start:'self'}],[2,{pid:2,start:'child'}]]),f=await fixture(state),lease=await f.lease.acquire('same'),running=await f.lease.update(lease,{phase:'unknown',operationId:'op',childPid:2,childStart:'child'});if(mode==='child')state.delete(1);if(mode==='forged'||mode==='missing')state.clear();const args=mode==='forged'?{token:'bad',operationId:'op',child:{pid:2,start:'child'}}:mode==='missing'?{token:running.token,operationId:'op',child:null}:{token:running.token,operationId:'op',child:{pid:2,start:'child'}};assert.equal(await f.lease.reconcileCompleted('same',args),false);assert.equal((await f.lease.acquire('same')).reasonCode,'session_lease_held');}});
test('a dead closed owner and child can be reclaimed by acquire',async()=>{const state=new Map(),f=await fixture(state),path=f.lease.path('same');await mkdir(path);await writeFile(join(path,'lease.json'),JSON.stringify({sessionId:'same',token:'old',phase:'closed',owner:{pid:8,start:'old'},childPid:9,childStart:'child'}));assert.ok((await f.lease.acquire('same')).token);});
