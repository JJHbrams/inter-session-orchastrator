import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {mkdtemp,readdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createCodexChairRunner} from '../adapters/codex/chair.js';
const child=()=>{const p=new EventEmitter();p.stdin=new PassThrough();p.stdout=new PassThrough();p.stderr=new PassThrough();p.kill=()=>{p.killed=true;};return p;};
const output={speech:'ok',attachmentIds:null,questions:[],proposal:null,reactions:null};
test('Codex initialization stores the provider-issued thread identity and isolates CLI settings',async()=>{
 const cwd=await mkdtemp(join(tmpdir(),'chair-codex-'));let call,id;
 const run=createCodexChairRunner({tempRoot:cwd,spawnProcess:(command,args,options)=>{call={command,args,options};const p=child();queueMicrotask(()=>{p.stdout.write(JSON.stringify({type:'thread.started',thread_id:'actual-id'})+'\n');p.stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify(output)}})+'\n');p.emit('close',0);});return p;}});
 const result=await run.initialize({cwd,model:'gpt-chair',effort:'high',onNativeId:value=>id=value});assert.equal(id,'actual-id');assert.equal(result.nativeId,'actual-id');assert.equal(call.args.includes('resume'),false);assert.ok(call.args.includes('--ignore-user-config'));assert.ok(call.args.includes('--ignore-rules'));assert.ok(call.args.includes('--skip-git-repo-check'));assert.equal(call.args[call.args.indexOf('--sandbox')+1],'read-only');assert.equal(call.args[call.args.indexOf('--model')+1],'gpt-chair');assert.ok(call.args.includes('features.shell_tool=false'));assert.ok(call.args.includes('web_search="disabled"'));assert.equal(call.options.cwd,cwd);
});
test('Codex resume keeps exact ID, omits null model settings, and rejects a foreign session',async()=>{
 const cwd=await mkdtemp(join(tmpdir(),'chair-codex-resume-'));let call;
 const run=createCodexChairRunner({tempRoot:cwd,spawnProcess:(_command,args)=>{call=args;const p=child();queueMicrotask(()=>{p.stdout.write(JSON.stringify({type:'thread.started',thread_id:'native-id'})+'\n');p.stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:JSON.stringify(output)}})+'\n');p.emit('close',0);});return p;}});
 let started=0;const result=await run.resume({nativeId:'native-id',cwd,body:'go',model:null,effort:null,onStarted:()=>started++});assert.equal(result.nativeId,'native-id');assert.equal(started,1);assert.deepEqual(call.slice(0,4),['exec','resume','native-id','-']);assert.equal(call.includes('--model'),false);assert.equal(call.some(x=>String(x).startsWith('model_reasoning_effort=')),false);assert.ok(call.includes("sandbox_mode='read-only'"));
 const wrong=createCodexChairRunner({tempRoot:cwd,spawnProcess:()=>{const p=child();queueMicrotask(()=>p.stdout.write(JSON.stringify({type:'thread.started',thread_id:'wrong'})+'\n'));return p;}});await assert.rejects(wrong.resume({nativeId:'native-id',cwd,body:'go'}),/ID/);
});
test('Codex runner bounds output, validates final JSON, and removes image files',async()=>{
 const cwd=await mkdtemp(join(tmpdir(),'chair-codex-cleanup-'));let p;
 const run=createCodexChairRunner({tempRoot:cwd,maxBytes:20,spawnProcess:()=>{p=child();queueMicrotask(()=>p.stdout.write('x'.repeat(21)));return p;}});await assert.rejects(run.initialize({cwd}),/크기/);assert.equal(p.killed,true);assert.deepEqual(await readdir(cwd),[]);
 const invalid=createCodexChairRunner({tempRoot:cwd,spawnProcess:()=>{const q=child();queueMicrotask(()=>{q.stdout.write(JSON.stringify({type:'thread.started',thread_id:'id'})+'\n');q.stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'{}'}})+'\n');});return q;}});await assert.rejects(invalid.initialize({cwd}),/구조화/);
});
