import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {spawn} from 'node:child_process';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {createServer} from 'node:http';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {stopTimedOutChair} from '../adapters/chair/timeout.js';
import {createClaudeChairRunner} from '../adapters/claude/chair.js';
import {participantInstructions,participantWakePrompt} from '../packages/contracts/participant-instructions.js';
import {reviewPrompt} from '../services/coordinator/review-prompt.js';
import {Store} from '../services/coordinator/store.js';
import {ChairCoordinator} from '../services/coordinator/chair.js';

test('wake prompt is short and single-line while the authenticated helper retains the protocol',()=>{
 const path="C:/some project's/.local/participants/private.json",prompt=participantWakePrompt(path,'request','exact-room');
 assert.ok(prompt.length<900);assert.doesNotMatch(prompt,/[\r\n]/);assert.match(prompt,/wake --request-id 'request'/);assert.match(prompt,/project''s/);assert.match(prompt,/room_history_index confirms this exact room/);assert.match(prompt,/exact-room/);
 const guide=participantInstructions({room_id:'room',room_cwd:'C:/work'},path,'request');
 for(const phrase of ['room_history_index','agenda_review','conclusionRevision','room_review','no minimum or target length','room_react','never formal consensus','Do not print','--config','ownIdentity','not a different identity','not a message ID'])assert.ok(guide.includes(phrase),phrase);
});

test('participant guidance keeps exact scenario counts and bounded answers ahead of extrapolation',()=>{
 const guide=participantInstructions({room_id:'room',room_cwd:'C:/work'},"C:/cfg.json",'request');
 for(const phrase of ['do not reinterpret it as an average','Answer that bounded question first','do not turn an unstated future or out-of-scope operation into a blocking condition'])assert.ok(guide.includes(phrase),phrase);
 assert.ok(reviewPrompt({type:'agenda_review',agendaId:'a',roundId:'r',conclusionRevision:1,arguments:[]}).includes('must point to genuinely unknown evidence within the stated scope'));
});

test('wake helper obtains the exact authenticated inbox before returning instructions',async()=>{
 const config=join(await mkdtemp(join(tmpdir(),'participant-wake-')),'private.json');let seen;
 const server=createServer(async(req,res)=>{let body='';for await(const chunk of req)body+=chunk;seen={path:req.url,authorization:req.headers.authorization,body:JSON.parse(body)};res.setHeader('Content-Type','application/json');res.end(JSON.stringify({roomId:'exact-room',cwd:'C:/room',inbox:[{request_id:'exact-request',body:'only this task'}],knowledgeChanges:{providedRevision:4,changes:[]}}));});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{await writeFile(config,JSON.stringify({url:'http://127.0.0.1:'+server.address().port,token:'test-token'}));
  const {stdout}=await promisify(execFile)(process.execPath,['packages/mcp/participant.js','--config',config,'wake','--request-id','exact-request'],{windowsHide:true});const result=JSON.parse(stdout);
  assert.equal(seen.path,'/mcp/room_inbox');assert.equal(seen.authorization,'Bearer test-token');assert.deepEqual(seen.body,{requestId:'exact-request'});assert.equal(result.inbox[0].body,'only this task');assert.match(result.participantInstructions,/exact-room/);assert.match(result.participantInstructions,/exact-request/);assert.match(result.participantInstructions,/providedRevision/);assert.ok(!stdout.includes('test-token'));
 }finally{await new Promise(resolve=>server.close(resolve));}
});

test('timeout kill request without child closure cannot authorize an automatic retry',async()=>{
 const child=new EventEmitter();child.pid=321;child.kill=()=>true;
 const error=await new Promise(resolve=>stopTimedOutChair(child,'native',resolve,{graceMs:10}));
 assert.equal(error.code,'CHAIR_TIMEOUT');assert.equal(error.execution,undefined);
});

test('Claude synthetic auth failures are actionable and never count as model start or retry',async()=>{
 const cwd=await mkdtemp(join(tmpdir(),'chair-auth-'));let starts=0,calls=0;
 for(const event of [{type:'assistant',is_api_error_message:true,error:'authentication_failed'},{type:'result',is_error:true,subtype:'success',result:'Failed to authenticate: OAuth session expired and could not be refreshed'}]){
  const runner=createClaudeChairRunner({spawnProcess:()=>{calls++;const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>true;queueMicrotask(()=>child.stdout.write(JSON.stringify({...event,session_id:'native'})+'\n'));return child;}});
  await assert.rejects(runner.resume({nativeId:'native',cwd,body:'test',onStarted:()=>starts++}),error=>error.code==='CLAUDE_AUTH_REQUIRED'&&/로그인 만료/.test(error.message));
 }assert.equal(starts,0);assert.equal(calls,2);
});

test('real owned child timeout reports its exact PID only after close',async()=>{
 const cwd=await mkdtemp(join(tmpdir(),'chair-timeout-proof-'));let owned,closed=false;
 const runner=createClaudeChairRunner({timeoutMs:100,stopGraceMs:2000,spawnProcess:()=>{owned=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:['pipe','pipe','pipe'],windowsHide:true});owned.once('close',()=>closed=true);return owned;}});
 await assert.rejects(runner.resume({nativeId:'exact-native',cwd,body:'test'}),error=>{
  assert.equal(error.code,'CHAIR_TIMEOUT');assert.equal(closed,true);assert.equal(error.execution.closed,true);assert.equal(error.execution.pid,owned.pid);assert.equal(error.execution.nativeId,'exact-native');return true;
 });
});

test('only one proven closed chair timeout retries; ambiguity and changed fences stay unresolved',async()=>{
 for(const mode of ['closed','unproven','foreign','fence','twice','paused']){
  const store=new Store(),room=store.createRoom('test');let calls=0;
  const runner={initialize:async({nativeId})=>({nativeId,started:true,output:{speech:'ready',questions:[],proposal:null}}),resume:async({nativeId,onStarted})=>{
   calls++;onStarted();if(calls===1||mode==='twice'){
    if(mode==='fence')store.db.prepare('UPDATE writers SET fence=fence+1').run();
    if(mode==='paused')store.pause(room.id);
    const error=Error('timeout');error.code='CHAIR_TIMEOUT';if(mode!=='unproven')error.execution={closed:true,pid:123,nativeId:mode==='foreign'?'other':nativeId};throw error;
   }return {nativeId,started:true,output:{speech:'automatic reply',questions:[],proposal:null}};
  }};
  const chairs=new ChairCoordinator(store,{runner});await chairs.create(room.id);
  try{await chairs.submit(room.id,{body:'question'});assert.equal(calls,['closed','twice'].includes(mode)?2:1,mode);
   const run=store.db.prepare('SELECT * FROM chair_runs ORDER BY created_at DESC').get();assert.equal(run.status,mode==='closed'?'completed':'unknown',mode);
   assert.equal(store.room(room.id).messages.filter(m=>m.body==='automatic reply').length,mode==='closed'?1:0);
  }finally{store.db.close();}
 }
});
