import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createClaudeChairRunner} from '../adapters/claude/chair.js';
const child=()=>{const p=new EventEmitter();p.stdin=new PassThrough();p.stdout=new PassThrough();p.stderr=new PassThrough();p.kill=()=>{p.killed=true;};return p;};
test('CLI runner confirms exact native identity, safe arguments and actual model start',async()=>{
 const cwd=await mkdtemp(join(tmpdir(),'chair-runner-'));let call,started=0;
 const run=createClaudeChairRunner({spawnProcess:(command,args,options)=>{call={command,args,options};const p=child();queueMicrotask(()=>{p.stdout.write(JSON.stringify({type:'system',subtype:'init',session_id:'native'})+'\n');assert.equal(started,0);p.stdout.write(JSON.stringify({type:'stream_event',session_id:'native',event:{type:'message_start'}})+'\n');p.stdout.write(JSON.stringify({type:'result',session_id:'native',subtype:'success',structured_output:{speech:'ok',questions:[],proposal:null}})+'\n');p.emit('close',0);});return p;}});
 const result=await run.resume({nativeId:'native',cwd,body:'test only',onStarted:()=>started++});assert.equal(started,1);assert.equal(result.nativeId,'native');assert.equal(call.options.cwd,cwd);assert.equal(call.options.windowsHide,true);assert.equal(call.args[0],'--resume');assert.equal(call.args[1],'native');assert.ok(call.args.includes('--safe-mode'));assert.ok(call.args.includes('--strict-mcp-config'));assert.equal(call.args[call.args.indexOf('--tools')+1],'');assert.equal(call.args.some(a=>a.includes('bypass')),false);assert.equal(call.args[call.args.indexOf('--input-format')+1],'stream-json');
});
test('CLI runner rejects wrong ID and bounds timeout without retrying',async()=>{
 const cwd=await mkdtemp(join(tmpdir(),'chair-invalid-'));let invocations=0,p;
 const run=createClaudeChairRunner({timeoutMs:25,spawnProcess:()=>{invocations++;p=child();queueMicrotask(()=>{p.stdout.write(JSON.stringify({type:'system',session_id:'foreign'})+'\n');});return p;}});
 await assert.rejects(run.resume({nativeId:'expected',cwd,body:'test'}),/ID/);assert.equal(invocations,1);assert.equal(p.killed,true);
 const silent=createClaudeChairRunner({timeoutMs:25,spawnProcess:()=>{p=child();return p;}});await assert.rejects(silent.resume({nativeId:'expected',cwd,body:'test'}),/제한시간/);assert.equal(p.killed,true);
});
