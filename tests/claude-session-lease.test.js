import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,mkdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ClaudeSessionLease} from '../adapters/claude/session-lease.js';

const fixture=async state=>{const root=await mkdtemp(join(tmpdir(),'claude-lease-')),inspector={async self(){return {pid:1,start:'self'};},async inspect(pid){return state.get(pid);}};return {root,inspector,lease:new ClaudeSessionLease({root,processInspector:inspector})};};
test('a live acquired owner blocks a second lease',async()=>{const state=new Map([[1,{pid:1,start:'self'}]]),f=await fixture(state),first=await f.lease.acquire('same'),second=await f.lease.acquire('same');assert.ok(first.token);assert.equal(second.reasonCode,'session_lease_held');});
test('empty and malformed lock directories fail closed',async()=>{for(const value of ['', '{bad']){const state=new Map(),f=await fixture(state),path=f.lease.path('same');await mkdir(path);if(value)await writeFile(join(path,'lease.json'),value);const result=await f.lease.acquire('same');assert.equal(result.reasonCode,'session_lease_held');}});
test('a PID-reused acquired owner is safely reclaimed while launching remains held',async()=>{const state=new Map([[9,{pid:9,start:'new'}]]),f=await fixture(state),path=f.lease.path('same');await mkdir(path);await writeFile(join(path,'lease.json'),JSON.stringify({sessionId:'same',token:'old',phase:'acquired',owner:{pid:9,start:'old'}}));const fresh=await f.lease.acquire('same');assert.ok(fresh.token);await f.lease.update(fresh,{phase:'launching'});state.delete(1);const held=await f.lease.acquire('same');assert.equal(held.reasonCode,'session_lease_held');});
test('stale token cannot update or release another lease',async()=>{const state=new Map([[1,{pid:1,start:'self'}]]),f=await fixture(state),lease=await f.lease.acquire('same');await assert.rejects(()=>f.lease.update({...lease,token:'wrong'},{}));assert.equal(await f.lease.release({...lease,token:'wrong',phase:'closed'}),false);});
