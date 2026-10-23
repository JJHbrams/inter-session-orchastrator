import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../services/coordinator/store.js';
import {decodeBase64,MAX_ATTACHMENT_BYTES} from '../packages/contracts/attachments.js';

test('attachment ownership, immutable message links, reply/result sharing and restart bytes',()=>{
 const dir=mkdtempSync(join(tmpdir(),'rooms-attachments-')),path=join(dir,'db.sqlite');let s=new Store(path);
 try{
  const r=s.createRoom('r'),foreign=s.createRoom('foreign');
  const register=n=>{const {session}=s.registerSession({provider:'codex',host:'test',nativeId:n,cwd:'C:/qa',profile:'test',mode:'live_attach',verified:true,capabilities:{followup:true}});const m=s.join(r.id,session.id,false);return {session_id:session.id,membership_id:m.id,room_id:r.id};};
  const a=register('a'),b=register('b'),bytes=Buffer.from('shared UTF-8 한글');
  const upload=(key,sender=null)=>s.uploadAttachment(r.id,{filename:'../note.txt',mime:'image/png',base64:bytes.toString('base64'),requestKey:key},sender);
  const file=upload('a',a.session_id);assert.equal(file.filename,'note.txt');assert.equal(file.mime,'application/octet-stream');
  assert.equal(upload('a',a.session_id).id,file.id);
  assert.throws(()=>s.uploadAttachment(r.id,{filename:'changed.txt',base64:bytes.toString('base64'),requestKey:'a'},a.session_id),/conflict/);
  assert.throws(()=>s.readAttachment(r.id,file.id,b.session_id),/not shared/);
  assert.throws(()=>s.readAttachment(foreign.id,file.id),/outside|not found/);
  const post=s.post({roomId:r.id,senderSessionId:a.session_id,body:'share',kind:'followup',targets:[b.membership_id],requestKey:'post',attachmentIds:[file.id]});
  assert.deepEqual(Buffer.from(s.readAttachment(r.id,file.id,b.session_id).base64,'base64'),bytes);
  assert.equal(s.post({roomId:r.id,senderSessionId:a.session_id,body:'share',kind:'followup',targets:[b.membership_id],requestKey:'post',attachmentIds:[file.id]}).message.id,post.message.id);
  assert.throws(()=>s.post({roomId:r.id,senderSessionId:a.session_id,body:'share',kind:'followup',targets:[b.membership_id],requestKey:'post'}),/conflict/);
  const reply=s.reply(b,post.deliveries[0].request_id,'',[file.id]);assert.equal(reply.message.attachments[0].id,file.id);assert.equal(s.reply(b,post.deliveries[0].request_id,'',[file.id]).message.id,reply.message.id);
  const result=s.result(b,'shared result',[post.message.id],[file.id]);assert.equal(result.attachments[0].id,file.id);assert.equal(s.room(r.id).decisions[0].attachments[0].id,file.id);
  assert.equal(s.discardAttachment(r.id,file.id,a.session_id).retained,true);
  const staged=upload('draft');assert.equal(s.discardAttachment(r.id,staged.id).discarded,true);assert.throws(()=>s.readAttachment(r.id,staged.id));
  assert.throws(()=>s.post({roomId:r.id,body:'bad',attachmentIds:[file.id,file.id]}),/invalid attachment/);
  assert.throws(()=>s.post({roomId:foreign.id,body:'bad',attachmentIds:[file.id]}),/outside/);
  s.leave(r.id,b.session_id);assert.throws(()=>s.readAttachment(r.id,file.id,b.session_id),/membership/);
  s.db.close();s=new Store(path);assert.deepEqual(Buffer.from(s.readAttachment(r.id,file.id).base64,'base64'),bytes);assert.equal(s.room(r.id).messages.find(m=>m.id===post.message.id).attachments[0].id,file.id);
 }finally{s.db.close();rmSync(dir,{recursive:true,force:true});}
});

test('strict base64 and byte limit reject invalid or oversized uploads before persistence',()=>{
 for(const value of ['a','a===','AB==','Y Q==','!!!!'])assert.throws(()=>decodeBase64(value),/base64/);
 assert.equal(decodeBase64('').length,0);assert.equal(decodeBase64(Buffer.alloc(MAX_ATTACHMENT_BYTES).toString('base64')).length,MAX_ATTACHMENT_BYTES);
 assert.throws(()=>decodeBase64(Buffer.alloc(MAX_ATTACHMENT_BYTES+1).toString('base64')),/10 MiB/);
 const s=new Store(),r=s.createRoom('limits');try{for(let i=0;i<50;i++)s.uploadAttachment(r.id,{filename:'x',base64:'',requestKey:String(i)});assert.throws(()=>s.uploadAttachment(r.id,{filename:'x',base64:'',requestKey:'overflow'}),/staged/);}finally{s.db.close();}
});
