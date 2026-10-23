import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import { Store } from '../services/coordinator/store.js';

test('channels archive only after every child is archived, preserve history, and restore at the intended scope',()=>{
  const s=new Store();
  try{
    const mixed=s.createChannel('mixed'),first=s.createRoom('first',mixed.id),second=s.createRoom('second',mixed.id);
    const session=s.registerSession({provider:'codex',host:'test',nativeId:'native',cwd:'C:/work',profile:'default',mode:'live_attach',verified:true,capabilities:{followup:true}}).session;
    const member=s.join(first.id,session.id,false),message=s.post({roomId:first.id,body:'keep history',kind:'followup',targets:[member.id]}).message;
    assert.throws(()=>s.archiveChannel(mixed.id),e=>e.code==='ACTIVE_CHILD_ROOMS'&&e.activeChildCount===2);
    s.archiveRoom(first.id);
    assert.throws(()=>s.archiveChannel(mixed.id),e=>e.code==='ACTIVE_CHILD_ROOMS'&&e.activeChildCount===1);
    s.archiveRoom(second.id);
    const archived=s.archiveChannel(mixed.id);
    assert.ok(archived.archived_at);
    assert.equal(s.archiveChannel(mixed.id).archived_at,archived.archived_at);
    assert.throws(()=>s.createRoom('blocked',mixed.id),/channel is archived/);
    const restored=s.restoreRoom(first.id);
    assert.equal(restored.archived_at,null);
    assert.equal(s.channels().find(c=>c.id===mixed.id).archived_at,null);
    assert.ok(s.room(second.id).archived_at);
    assert.equal(s.room(first.id).messages[0].id,message.id);
    s.archiveRoom(first.id);
    s.archiveChannel(mixed.id);
    s.restoreChannel(mixed.id);
    assert.equal(s.channels().find(c=>c.id===mixed.id).archived_at,null);
    assert.ok(s.room(first.id).archived_at);
    assert.ok(s.room(second.id).archived_at);
    const empty=s.createChannel('empty');
    assert.ok(s.archiveChannel(empty.id).archived_at);
  }finally{s.db.close();}
});

test('channel archive migration persists and restoreRoom rolls its parent restoration back atomically',()=>{
  const dir=mkdtempSync(join(tmpdir(),'channel-archive-')),path=join(dir,'rooms.sqlite');let reopened;
  try{
    const s=new Store(path),channel=s.createChannel('persisted'),room=s.createRoom('child',channel.id);
    s.archiveRoom(room.id);s.archiveChannel(channel.id);s.db.close();
    reopened=new Store(path);
    assert.ok(reopened.channels().find(c=>c.id===channel.id).archived_at);
    reopened.db.exec(`CREATE TRIGGER fail_room_restore BEFORE UPDATE OF archived_at ON rooms WHEN NEW.archived_at IS NULL BEGIN SELECT RAISE(ABORT, 'room restore failed'); END`);
    assert.throws(()=>reopened.restoreRoom(room.id),/room restore failed/);
    assert.ok(reopened.channels().find(c=>c.id===channel.id).archived_at);
    assert.ok(reopened.room(room.id).archived_at);
  }finally{reopened?.db.close();rmSync(dir,{recursive:true,force:true});}
});

test('archive and restore APIs expose the child-count guard and restore a room with its parent channel',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'channel-archive-http-')),db=join(dir,'rooms.sqlite');
  const reserve=createServer();await new Promise(resolve=>reserve.listen(0,'127.0.0.1',resolve));const port=reserve.address().port;await new Promise(resolve=>reserve.close(resolve));
  const child=spawn(process.execPath,['services/coordinator/server.js'],{env:{...process.env,PORT:String(port),ROOMS_DB:db},windowsHide:true,stdio:['ignore','pipe','pipe']});
  try{
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('startup timeout')),5000);child.stdout.on('data',data=>{if(data.toString().includes('listening')){clearTimeout(timer);resolve();}});child.once('error',reject);child.once('exit',()=>{clearTimeout(timer);reject(Error('server exited'));});});
    const base=`http://127.0.0.1:${port}`,boot=await fetch(base+'/api/bootstrap'),cookie=boot.headers.get('set-cookie').split(';')[0],{csrf}=await boot.json();
    const call=async(path,data={})=>{const response=await fetch(base+path,{method:'POST',headers:{cookie,'x-csrf-token':csrf,'Content-Type':'application/json'},body:JSON.stringify(data)});return {status:response.status,data:await response.json()};};
    const channel=(await call('/api/channels',{name:'api'})).data,room=(await call('/api/rooms',{name:'child',channelId:channel.id})).data;
    const blocked=await call(`/api/channels/${channel.id}/archive`);assert.equal(blocked.status,409);assert.equal(blocked.data.activeChildCount,1);
    await call(`/api/rooms/${room.id}/archive`);assert.ok((await call(`/api/channels/${channel.id}/archive`)).data.archived_at);
    const restored=await call(`/api/rooms/${room.id}/restore`);assert.equal(restored.data.archived_at,null);const listed=await fetch(base+'/api/channels',{headers:{cookie}});assert.equal((await listed.json()).channels.find(c=>c.id===channel.id).archived_at,null);
  }finally{child.kill();rmSync(dir,{recursive:true,force:true});}
});
