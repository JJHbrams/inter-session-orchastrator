import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {createServer} from 'node:net';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import readline from 'node:readline';

test('browser uploads are available as real MCP image blocks and helper bytes in the same room',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'rooms-media-flow-')),reserve=createServer();
 await new Promise(resolve=>reserve.listen(0,'127.0.0.1',resolve));const port=reserve.address().port;await new Promise(resolve=>reserve.close(resolve));
 const server=spawn(process.execPath,['services/coordinator/server.js'],{env:{...process.env,PORT:String(port),ROOMS_DB:join(dir,'db.sqlite')},windowsHide:true,stdio:['ignore','pipe','pipe']});
 let mcp;
 try{
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('server startup timeout')),10000);server.stdout.on('data',data=>{if(data.toString().includes('listening')){clearTimeout(timer);resolve();}});server.on('error',reject);});
  const base='http://127.0.0.1:'+port,bootstrap=await fetch(base+'/api/bootstrap'),cookie=bootstrap.headers.get('set-cookie').split(';')[0],{csrf}=await bootstrap.json();
  const browser=async(path,payload)=>{const r=await fetch(base+path,{method:payload?'POST':'GET',headers:{cookie,'X-CSRF-Token':csrf,'Content-Type':'application/json'},body:payload?JSON.stringify(payload):undefined});const body=await r.json();assert.ok(r.ok,body.error);return body;};
  const room=await browser('/api/rooms',{name:'media integration'}),other=await browser('/api/rooms',{name:'unrelated'});
  const registration=await browser('/api/sessions',{provider:'codex',host:'test',nativeId:'media-peer',cwd:'C:/qa',profile:'test',mode:'live_attach',verified:true,capabilities:{followup:true,mcpPull:true}});
  const member=await browser('/api/rooms/'+room.id+'/join',{sessionId:registration.session.id,readOnly:false});
  const provision=await browser('/api/rooms/'+room.id+'/provision',{sessionId:registration.session.id});
  const source=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV7sAAAAASUVORK5CYII=','base64');
  const uploaded=await browser('/api/rooms/'+room.id+'/attachments',{filename:'from-browser.png',mime:'image/png',base64:source.toString('base64'),requestKey:'stable-upload'});
  const peer=async(name,args)=>fetch(base+'/mcp/'+name,{method:'POST',headers:{Authorization:'Bearer '+provision.token,'Content-Type':'application/json'},body:JSON.stringify(args)});
  assert.equal((await peer('room_read_attachment',{attachmentId:uploaded.id})).status,400,'browser staged draft must not leak before posting');
  const post=await browser('/api/rooms/'+room.id+'/messages',{body:'Please inspect this image',kind:'followup',targets:[member.id],attachmentIds:[uploaded.id],requestKey:'stable-message'});
  const inbox=await (await peer('room_inbox',{})).json();assert.equal(inbox.inbox[0].attachments[0].id,uploaded.id);
  assert.equal((await fetch(base+'/api/rooms/'+other.id+'/attachments/'+uploaded.id,{headers:{cookie}})).status,400);
  const raw=await fetch(base+'/api/rooms/'+room.id+'/attachments/'+uploaded.id,{headers:{cookie}});assert.equal(raw.headers.get('x-content-type-options'),'nosniff');assert.deepEqual(Buffer.from(await raw.arrayBuffer()),source);
  const pending=new Map();let next=1;
  mcp=spawn(process.execPath,['packages/mcp/server.js'],{env:{...process.env,ROOMS_URL:base,ROOMS_TOKEN:provision.token},windowsHide:true,stdio:['pipe','pipe','pipe']});
  readline.createInterface({input:mcp.stdout}).on('line',line=>{const item=JSON.parse(line);pending.get(item.id)?.(item);pending.delete(item.id);});
  const rpc=(method,params)=>new Promise((resolve,reject)=>{const id=next++,timer=setTimeout(()=>reject(Error('MCP timeout')),8000);pending.set(id,result=>{clearTimeout(timer);resolve(result);});mcp.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n');});
  await rpc('initialize',{protocolVersion:'2024-11-05',capabilities:{},clientInfo:{name:'media-test',version:'1'}});
  const tool=await rpc('tools/call',{name:'room_read_attachment',arguments:{attachmentId:uploaded.id}});
  assert.equal(tool.result.isError,undefined);const image=tool.result.content.find(item=>item.type==='image');assert.equal(image.mimeType,'image/png');assert.deepEqual(Buffer.from(image.data,'base64'),source);
  const config=join(dir,'private.json'),out=join(dir,'download.png');await writeFile(config,JSON.stringify({url:base,token:provision.token}));
  const helper=spawn(process.execPath,['packages/mcp/participant.js','--config',config,'read',uploaded.id,'--output',out],{windowsHide:true,stdio:['ignore','pipe','pipe']});
  let helperError='';helper.stderr.on('data',b=>helperError+=b.toString());await new Promise((resolve,reject)=>{helper.on('error',reject);helper.on('close',code=>code===0?resolve():reject(Error(helperError||'helper failed')));});
  assert.deepEqual(await readFile(out),source);
  const same=await browser('/api/rooms/'+room.id+'/messages',{body:'Please inspect this image',kind:'followup',targets:[member.id],attachmentIds:[uploaded.id],requestKey:'stable-message'});assert.equal(same.message.id,post.message.id);
 }finally{mcp?.kill();server.kill();await new Promise(resolve=>server.exitCode!==null?resolve():server.once('close',resolve));await rm(dir,{recursive:true,force:true});}
});
