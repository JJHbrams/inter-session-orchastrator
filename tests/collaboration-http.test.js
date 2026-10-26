import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';

test('knowledge settings and authenticated MCP keep publication, revisions and channel scope distinct',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'agenda-http-')),reserve=createServer();
 await new Promise(r=>reserve.listen(0,'127.0.0.1',r));const port=reserve.address().port;await new Promise(r=>reserve.close(r));
 const child=spawn(process.execPath,['services/coordinator/server.js'],{env:{...process.env,PORT:String(port),ROOMS_DB:join(dir,'state.sqlite'),ROOMS_KNOWLEDGE_ROOT:join(dir,'original')},windowsHide:true,stdio:['ignore','pipe','pipe']});
 try{
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('server startup timeout')),10000);child.once('error',reject);child.once('exit',()=>reject(Error('server exited')));child.stdout.on('data',b=>{if(String(b).includes('listening')){clearTimeout(timer);resolve();}});});
  const base=`http://127.0.0.1:${port}`,boot=await fetch(base+'/api/bootstrap'),cookie=boot.headers.get('set-cookie').split(';')[0],{csrf}=await boot.json();
  const call=async(path,input,headers={})=>{const res=await fetch(base+path,{method:input===undefined?'GET':'POST',headers:{cookie,'x-csrf-token':csrf,'Content-Type':'application/json',...headers},body:input===undefined?undefined:JSON.stringify(input)});return {status:res.status,data:await res.json()};};
  assert.equal((await fetch(base+'/api/settings')).status,401);
  assert.equal((await call('/api/settings',{storageRoot:join(dir,'bad')},{'x-csrf-token':'wrong'})).status,403);
  const custom=join(dir,'materials');assert.equal((await call('/api/settings',{storageRoot:custom})).data.storageRoot,custom);
  assert.equal((await call('/api/settings')).data.storageRoot,custom);
  assert.equal((await call('/api/settings',{storageRoot:'relative'})).status,400);
  const channel=(await call('/api/channels',{name:'shared'})).data;
  const one=(await call('/api/rooms',{name:'one',channelId:channel.id})).data,two=(await call('/api/rooms',{name:'two',channelId:channel.id})).data;
  const item=(await call(`/api/rooms/${one.id}/knowledge`,{kind:'source',title:'Source',body:'Draft evidence',url:'https://example.org/evidence',requestKey:'source-once'})).data;
  assert.ok(item.id);assert.equal((await call(`/api/rooms/${two.id}/knowledge`)).data.items.length,0);
  const published=await call(`/api/rooms/${one.id}/knowledge/${item.id}/publish`,{});assert.equal(published.status,200);
  const common=(await call(`/api/rooms/${two.id}/knowledge?scope=channel&query=evidence`)).data;assert.equal(common.items[0].id,item.id);
  assert.equal((await call(`/api/rooms/${two.id}/knowledge/${item.id}?revision=1`)).status,400);
  const session=(await call('/api/sessions',{provider:'codex',host:'test',nativeId:'knowledge-wire',cwd:dir,profile:'test',mode:'live_attach',verified:true,capabilities:{followup:true}})).data.session;
  await call(`/api/rooms/${two.id}/join`,{sessionId:session.id,readOnly:false});
  const provision=(await call(`/api/rooms/${two.id}/provision`,{sessionId:session.id})).data,headers={Authorization:`Bearer ${provision.token}`};
  assert.equal((await call('/mcp/room_knowledge_read',{itemId:item.id},headers)).status,200);
  assert.equal((await call('/mcp/room_knowledge_add',{kind:'consensus',title:'Forged',body:'Not human approved',status:'published'},headers)).status,400);
  assert.equal((await call('/mcp/room_knowledge_add',{kind:'argument',title:'Argument',body:'A scoped argument',requestKey:'argument-once'},headers)).status,200);
  const list=(await call('/mcp/room_knowledge_list',{scope:'room'},headers)).data;assert.equal(list.items.length,1);
  const context=(await call('/mcp/room_context',{},headers)).data;assert.ok(Array.isArray(context.agendas));assert.ok(context.knowledge.items);
  assert.equal((await call('/mcp/room_acknowledge_approval',{noticeId:'foreign',revision:1},headers)).status,400);
  const manifest=JSON.parse(await readFile(join(custom,'channels',channel.id,'rooms',one.id,'manifest.json'),'utf8'));assert.equal(manifest.roomId,one.id);
 }finally{child.kill();}
});
