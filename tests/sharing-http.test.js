import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';

test('authenticated participant shares bytes and reactions while anonymous and read-only writes fail',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'sharing-http-')),reserve=createServer();
 await new Promise(resolve=>reserve.listen(0,'127.0.0.1',resolve));const port=reserve.address().port;await new Promise(resolve=>reserve.close(resolve));
 const child=spawn(process.execPath,['services/coordinator/server.js'],{env:{...process.env,PORT:String(port),ROOMS_DB:join(dir,'state.sqlite'),ROOMS_KNOWLEDGE_ROOT:join(dir,'knowledge')},windowsHide:true,stdio:['ignore','pipe','pipe']});
 try{
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('server startup timeout')),10000);child.once('error',reject);child.stdout.on('data',b=>{if(String(b).includes('listening')){clearTimeout(timer);resolve();}});});
  const base=`http://127.0.0.1:${port}`,boot=await fetch(base+'/api/bootstrap'),cookie=boot.headers.get('set-cookie').split(';')[0],{csrf}=await boot.json();
  const api=async(path,input)=>fetch(base+path,{method:'POST',headers:{cookie,'x-csrf-token':csrf,'Content-Type':'application/json'},body:JSON.stringify(input)});
  const room=await (await api('/api/rooms',{name:'share'})).json();
  const make=async(nativeId,readOnly=false,targetRoom=room)=>{const session=(await (await api('/api/sessions',{provider:'codex',host:'test',nativeId,cwd:dir,profile:'test',mode:'live_attach',verified:true,capabilities:{followup:true}})).json()).session;await api(`/api/rooms/${targetRoom.id}/join`,{sessionId:session.id,readOnly});const provision=await (await api(`/api/rooms/${targetRoom.id}/provision`,{sessionId:session.id})).json();return {token:provision.token,session};};
  const a=await make('a'),b=await make('b'),readOnly=await make('ro',true);
  const mcp=async(token,action,input)=>fetch(base+`/mcp/${action}`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(input)});
  const upload=await (await mcp(a.token,'room_upload_attachment',{filename:'proof.txt',base64:Buffer.from('same bytes').toString('base64'),requestKey:'proof'})).json();
  assert.equal((await mcp(b.token,'room_read_attachment',{attachmentId:upload.id})).status,400);
  const post=await (await mcp(a.token,'room_post',{body:'share proof',attachmentIds:[upload.id]})).json();
  const read=await (await mcp(b.token,'room_read_attachment',{attachmentId:upload.id})).json();
  assert.equal(Buffer.from(read.base64,'base64').toString(),'same bytes');assert.equal(read.sha256,upload.sha256);
  assert.equal((await mcp(b.token,'room_react',{messageId:post.message.id,emoji:'💡',active:true})).status,200);
  const context=await (await mcp(a.token,'room_context',{})).json();
  assert.ok(context.reactionFeedback.some(x=>x.reactionActorSessionId===b.session.id&&x.messageId===post.message.id));
  assert.equal((await mcp(readOnly.token,'room_read_attachment',{attachmentId:upload.id})).status,200);
  const other=await (await api('/api/rooms',{name:'other'})).json(),otherParticipant=await make('other',false,other),foreign=await (await mcp(otherParticipant.token,'room_upload_attachment',{filename:'foreign.txt',base64:Buffer.from('foreign').toString('base64'),requestKey:'foreign'})).json();
  assert.equal((await mcp(b.token,'room_read_attachment',{attachmentId:foreign.id})).status,400);
  assert.equal((await mcp('', 'room_post',{body:'no'})).status,401);
  assert.equal((await mcp(readOnly.token,'room_post',{body:'no'})).status,403);
  assert.equal((await mcp(readOnly.token,'room_context',{})).status,200);
  await api(`/api/rooms/${room.id}/leave`,{sessionId:b.session.id});
  assert.equal((await mcp(b.token,'room_context',{})).status,401);
 }finally{child.kill();}
});
