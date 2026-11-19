import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {EventEmitter} from 'node:events';
import {createClaudeSessionAdapter} from '../adapters/claude/direct-session.js';

const input={provider:'claude',nativeId:'session-1',cwd:'C:/project'};
test('verifies a direct Claude binding without Orca',async()=>{const a=createClaudeSessionAdapter({catalog:async()=>true,registryPath:join(tmpdir(),'missing-registry')});const b=await a.verify(input);assert.equal(b.handle,'session-1');assert.equal(b.capabilities.transport,'claude-direct');assert.equal(b.mode,'resume');});
test('spawn failure before input is definitely not recorded',async()=>{const root=await mkdtemp(join(tmpdir(),'claude-direct-'));const a=createClaudeSessionAdapter({journalRoot:root,lease:{async acquire(){return {token:'t',path:root};},async update(x){return x;},async release(){return true;}},catalog:async()=>true,registryPath:join(root,'none'),spawnProcess(){throw Error('no cli');}});const r=await a.send(input,input,'secret prompt','r1',{onPrepared:async()=>{}});assert.equal(r.notRecorded,true);assert.equal(r.receipt.transport,'claude-direct');});
test('observe only reads a completed durable journal',async()=>{const root=await mkdtemp(join(tmpdir(),'claude-direct-'));const a=createClaudeSessionAdapter({journalRoot:root,catalog:async()=>true});const r=await a.observe(input,input,'ignored','r1',{receipt:{operationId:'missing'}});assert.equal(r.ok,false);});
