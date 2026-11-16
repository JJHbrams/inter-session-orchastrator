import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('helper preserves agenda, target, source and reply correlation from request JSON and flag overrides',async()=>{
 const received=[],server=createServer(async(req,res)=>{let raw='';for await(const part of req)raw+=part;received.push({path:req.url,body:JSON.parse(raw)});res.setHeader('content-type','application/json');res.end('{}');});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const config=join(await mkdtemp(join(tmpdir(),'reactive-helper-')),'private.json');await writeFile(config,JSON.stringify({url:`http://127.0.0.1:${server.address().port}`,token:'fixture-token'}));
  const data={agendaId:'agenda-a',body:'a sourced question',targets:['peer-b'],sourceIds:['source-a'],replyTo:'source-a',requestKey:'question-a'};
  for(const flags of [[],['--agenda-id','agenda-b','--source-ids','source-b,source-c']]){
   const child=spawn(process.execPath,['packages/mcp/participant.js','--config',config,...flags,'request',JSON.stringify(data)],{windowsHide:true,stdio:'ignore'});
   await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>code===0?resolve():reject(Error('helper failed')));});
  }
  assert.equal(received.length,2);assert.ok(received.every(r=>r.path==='/mcp/room_request'&&r.body.replyTo==='source-a'&&r.body.targets[0]==='peer-b'&&r.body.requestKey==='question-a'));
  assert.equal(received[0].body.agendaId,'agenda-a');assert.deepEqual(received[0].body.sourceIds,['source-a']);assert.equal(received[1].body.agendaId,'agenda-b');assert.deepEqual(received[1].body.sourceIds,['source-b','source-c']);
 }finally{await new Promise(resolve=>server.close(resolve));}
});

test('helper posts carry their original reply link without leaking the CLI option into Unicode text',async()=>{
 let seen;const server=createServer(async(req,res)=>{let raw='';for await(const part of req)raw+=part;seen={path:req.url,body:JSON.parse(raw)};res.setHeader('content-type','application/json');res.end('{}');});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  const directory=await mkdtemp(join(tmpdir(),'post-helper-')),config=join(directory,'private.json'),answer=join(directory,'answer.txt');
  await writeFile(config,JSON.stringify({url:`http://127.0.0.1:${server.address().port}`,token:'fixture-token'}));await writeFile(answer,'앞선 발언을 정정합니다.','utf8');
  const child=spawn(process.execPath,['packages/mcp/participant.js','--config',config,'post','--body-file',answer,'--reply-to','original-message','--request-key','correction'],{windowsHide:true,stdio:'ignore'});
  await new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',code=>code===0?resolve():reject(Error('helper failed')));});
  assert.deepEqual(seen,{path:'/mcp/room_post',body:{body:'앞선 발언을 정정합니다.',replyTo:'original-message',attachmentIds:[],requestKey:'correction'}});
 }finally{await new Promise(resolve=>server.close(resolve));}
});
