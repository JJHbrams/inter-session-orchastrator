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
test('Claude only adds model and effort when they are explicit',async()=>{
 const cwd=await mkdtemp(join(tmpdir(),'chair-model-'));let args;
 const run=createClaudeChairRunner({spawnProcess:(_command,next)=>{args=next;const p=child();queueMicrotask(()=>{p.stdout.write(JSON.stringify({type:'system',session_id:'native'})+'\n');p.stdout.write(JSON.stringify({type:'stream_event',session_id:'native',event:{type:'message_start'}})+'\n');p.stdout.write(JSON.stringify({type:'result',session_id:'native',subtype:'success',structured_output:{speech:'ok',questions:[],proposal:null}})+'\n');p.emit('close',0);});return p;}});
 await run.resume({nativeId:'native',cwd,body:'x',model:null,effort:null});assert.equal(args.includes('--model'),false);assert.equal(args.includes('--effort'),false);
 await run.resume({nativeId:'native',cwd,body:'x',model:'claude-test',effort:'high'});assert.equal(args[args.indexOf('--model')+1],'claude-test');assert.equal(args[args.indexOf('--effort')+1],'high');
});
test('Claude chair executable follows the current home and preserves overrides without a shell',async()=>{
 const cwd=await mkdtemp(join(tmpdir(),'chair-portable-'));
 const capture=async options=>{let call;const run=createClaudeChairRunner({...options,spawnProcess:(command,args,spawnOptions)=>{call={command,args,spawnOptions};const p=child();queueMicrotask(()=>{p.stdout.write(JSON.stringify({type:'system',session_id:'native'})+'\n');p.stdout.write(JSON.stringify({type:'stream_event',session_id:'native',event:{type:'message_start'}})+'\n');p.stdout.write(JSON.stringify({type:'result',session_id:'native',subtype:'success',structured_output:{speech:'ok',questions:[],proposal:null}})+'\n');p.emit('close',0);});return p;}});await run.resume({nativeId:'native',cwd,body:'x'});return call;};
 const home=await capture({environment:{},homeDirectory:'D:\\Profiles\\other-user'});assert.equal(home.command,'D:\\Profiles\\other-user\\.local\\bin\\claude.exe');assert.equal(home.spawnOptions.shell,false);
 const configured=await capture({environment:{CLAUDE_CHAIR_COMMAND:'E:\\Tools\\claude.exe'},homeDirectory:'D:\\Profiles\\other-user'});assert.equal(configured.command,'E:\\Tools\\claude.exe');assert.equal(configured.spawnOptions.shell,false);
 const explicit=await capture({command:'F:\\Portable\\claude.exe',environment:{CLAUDE_CHAIR_COMMAND:'E:\\Tools\\claude.exe'},homeDirectory:'D:\\Profiles\\other-user'});assert.equal(explicit.command,'F:\\Portable\\claude.exe');assert.equal(explicit.spawnOptions.shell,false);
});
