import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../services/coordinator/store.js';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

function registered(s, mode='live_attach') { return s.registerSession({provider:'codex',host:'test',nativeId:'native-1',cwd:'C:/work',profile:'default',mode,verified:mode!=='read_only',capabilities:{followup:true}}); }
test('channel and archived room rename trim Unicode text and survive reopen without changing history',()=>{
 const dir=mkdtempSync(join(tmpdir(),'rooms-rename-')),path=join(dir,'test.sqlite'),s=new Store(path);let reopened;
 try{
  const channel=s.createChannel(' before '),room=s.createRoom(' before room ',channel.id),{session}=registered(s),member=s.join(room.id,session.id,false);
  const message=s.post({roomId:room.id,body:'history',kind:'followup',targets:[member.id]}).message;
  const proposal=s.result({membership_id:member.id,session_id:session.id},'keep source',[message.id]);
  const snapshot=s.room(room.id);
  s.renameChannel(channel.id,' 한글 채널 ');s.renameRoom(room.id,' 방 이름 ');s.archiveRoom(room.id);s.renameRoom(room.id,' 보관 이름 ');
  reopened=new Store(path);const after=reopened.room(room.id);
  assert.equal(reopened.channels()[0].name,'한글 채널');assert.equal(after.name,'보관 이름');assert.equal(after.id,room.id);assert.equal(after.channel_id,channel.id);
  for(const key of ['members','messages','deliveries','decisions'])assert.deepEqual(after[key],snapshot[key]);
  assert.equal(after.decisions[0].id,proposal.id);
  for(const name of ['', '   ',null,123,'x'.repeat(121)])assert.throws(()=>s.renameRoom(room.id,name),/name/);
  assert.throws(()=>s.renameChannel(channel.id,'x'.repeat(81)),/name/);assert.throws(()=>s.renameChannel('missing','x'),/not found/);assert.throws(()=>s.renameRoom('missing','x'),/not found/);
  const duplicate=s.createChannel('한글 채널');assert.equal(s.renameChannel(duplicate.id,'한글 채널').name,'한글 채널');
 }finally{reopened?.db.close();s.db.close();rmSync(dir,{recursive:true,force:true});}
});
test('same payload idempotency returns the frozen recipient snapshot',()=>{const s=new Store();const r=s.createRoom('r');const {session}=registered(s);const m=s.join(r.id,session.id,false);const first=s.post({roomId:r.id,body:'hello',kind:'followup',requestKey:'k',targets:[m.id]});const same=s.post({roomId:r.id,body:'hello',kind:'followup',requestKey:'k',targets:[m.id]});assert.equal(first.message.id,same.message.id);assert.equal(first.deliveries.length,1);assert.throws(()=>s.post({roomId:r.id,body:'different',kind:'followup',requestKey:'k',targets:[m.id]}),/idempotency conflict/);});
test('unresolved session writer blocks another room before external submission',()=>{const s=new Store();const a=s.createRoom('a'),b=s.createRoom('b');const {session}=registered(s);const ma=s.join(a.id,session.id,false),mb=s.join(b.id,session.id,false);const da=s.post({roomId:a.id,body:'a',kind:'followup',targets:[ma.id]}).deliveries[0];const db=s.post({roomId:b.id,body:'b',kind:'followup',targets:[mb.id]}).deliveries[0];const claim=s.claim(da.id);s.fence(da.id,claim.fence);assert.throws(()=>s.claim(db.id),/unresolved submission/);});
test('restart changes in-flight deliveries to unknown without resending',()=>{const s=new Store();const r=s.createRoom('r');const {session}=registered(s);const m=s.join(r.id,session.id,false);const d=s.post({roomId:r.id,body:'x',kind:'followup',targets:[m.id]}).deliveries[0];const c=s.claim(d.id);s.fence(d.id,c.fence);s.recover();assert.equal(s.db.prepare('SELECT state FROM deliveries WHERE id=?').get(d.id).state,'unknown');});
test('registration scope rejects cross room reply and revokes on leave',()=>{const s=new Store();const a=s.createRoom('a'),b=s.createRoom('b');const {session}=registered(s);s.join(a.id,session.id,false);s.join(b.id,session.id,false);s.provision(a.id,session.id,'h');const reg=s.registration('h');assert.equal(reg.room_id,a.id);assert.throws(()=>s.reply(reg,'not-in-room','x'),/not addressed/);s.leave(a.id,session.id);assert.equal(s.registration('h'),undefined);});
test('cooperative inbox offers one request and exact reply is atomic and idempotent',()=>{const s=new Store();const r=s.createRoom('r');const {session}=registered(s);const m=s.join(r.id,session.id,false);s.provision(r.id,session.id,'token');const reg=s.registration('token');const d=s.post({roomId:r.id,body:'question',kind:'followup',targets:[m.id]}).deliveries[0];const offer=s.inbox(reg);assert.equal(offer.inbox[0].request_id,d.request_id);assert.equal(s.inbox(reg).inbox.length,0);const reply=s.reply(reg,d.request_id,'answer');assert.equal(s.db.prepare('SELECT state FROM deliveries WHERE id=?').get(d.id).state,'completed');assert.equal(s.reply(reg,d.request_id,'answer').message.id,reply.message.id);assert.throws(()=>s.reply(reg,d.request_id,'changed'),/conflict/);});
test('paused room stops queued cooperative offers without deleting them',()=>{const s=new Store();const r=s.createRoom('r');const {session}=registered(s);const m=s.join(r.id,session.id,false);s.provision(r.id,session.id,'t');s.post({roomId:r.id,body:'x',kind:'followup',targets:[m.id]});s.pause(r.id,true);assert.equal(s.inbox(s.registration('t')).inbox.length,0);});

test('pause between reservation and submission prevents the external side-effect fence',()=>{
  const s=new Store(),r=s.createRoom('r'),{session}=registered(s),m=s.join(r.id,session.id,false);
  const d=s.post({roomId:r.id,body:'x',kind:'followup',targets:[m.id]}).deliveries[0],c=s.claim(d.id);
  s.pause(r.id);assert.throws(()=>s.fence(d.id,c.fence),/eligible/);
  assert.equal(s.db.prepare('SELECT count(*) n FROM attempts').get().n,0);
});
test('new runtime binding invalidates a queued request before it is offered',()=>{
  const s=new Store(),r=s.createRoom('r'),{session}=registered(s),m=s.join(r.id,session.id,false);
  const d=s.post({roomId:r.id,body:'x',kind:'followup',targets:[m.id]}).deliveries[0];registered(s);
  assert.throws(()=>s.claim(d.id),/binding or policy changed/);
});
test('a cooperative offer blocks other rooms and stays fenced across restart recovery',()=>{
  const s=new Store(),a=s.createRoom('a'),b=s.createRoom('b'),{session}=registered(s);
  const ma=s.join(a.id,session.id,false),mb=s.join(b.id,session.id,false);s.provision(a.id,session.id,'a');s.provision(b.id,session.id,'b');
  s.post({roomId:a.id,body:'a',kind:'followup',targets:[ma.id]});s.post({roomId:b.id,body:'b',kind:'followup',targets:[mb.id]});
  const offer=s.inbox(s.registration('a')).inbox[0];assert.equal(s.inbox(s.registration('b')).inbox.length,0);
  s.recover();assert.equal(s.inbox(s.registration('a')).inbox.length,0);assert.equal(s.inbox(s.registration('b')).inbox.length,0);
  s.reply(s.registration('a'),offer.request_id,'late exact reply');assert.equal(s.inbox(s.registration('b')).inbox.length,1);
});
test('stale execution evidence cannot advance delivery or clear another writer',()=>{
  const s=new Store(),r=s.createRoom('r'),{session}=registered(s),m=s.join(r.id,session.id,false);
  const d=s.post({roomId:r.id,body:'x',kind:'followup',targets:[m.id]}).deliveries[0],c=s.claim(d.id),a=s.fence(d.id,c.fence);
  s.db.prepare('UPDATE writers SET fence=fence+1 WHERE session_id=?').run(session.id);
  assert.throws(()=>s.evidence(a.id,'reply','isolated-test','proof'),/stale attempt/);
  assert.equal(s.db.prepare('SELECT state FROM deliveries WHERE id=?').get(d.id).state,'submitting');
});
test('automatic rounds are bounded per user request; parallel questions share a round and replay is frozen',()=>{
  const s=new Store(),r=s.createRoom('r'),{session}=registered(s),m=s.join(r.id,session.id,false);s.role(r.id,session.id,'chair');s.limits(r.id,20,1);
  const root=s.post({roomId:r.id,body:'user request',kind:'post'}).message;
  const args={roomId:r.id,senderSessionId:session.id,body:'ask',kind:'followup',requestKey:'round-one',targets:[m.id],replyTo:root.id};
  const first=s.post(args);assert.equal(s.post(args).message.id,first.message.id);
  assert.doesNotThrow(()=>s.post({...args,requestKey:'parallel'}));
  assert.throws(()=>s.post({...args,requestKey:'round-two',replyTo:first.message.id}),/round budget/);
  const next=s.post({roomId:r.id,body:'new user request',kind:'post',replyTo:first.message.id});
  assert.equal(s.dialogueLoop(next.message.id).rootId,next.message.id);
  assert.doesNotThrow(()=>s.post({...args,requestKey:'new-loop',replyTo:next.message.id}));
  assert.throws(()=>s.post({...args,targets:[],requestKey:'empty'}),/recipients/);
});
test('leaving before submission cancels reservations and permits an explicit rejoin',()=>{
  const s=new Store(),r=s.createRoom('r'),{session}=registered(s),m=s.join(r.id,session.id,false);
  const d=s.post({roomId:r.id,body:'x',kind:'followup',targets:[m.id]}).deliveries[0];s.claim(d.id);s.leave(r.id,session.id);
  assert.equal(s.db.prepare('SELECT state FROM deliveries WHERE id=?').get(d.id).state,'cancelled');
  assert.equal(s.db.prepare('SELECT unresolved_delivery_id FROM writers WHERE session_id=?').get(session.id).unresolved_delivery_id,null);
  assert.equal(s.join(r.id,session.id,false).id,m.id);
});
test('archiving stops new requests while preserving a late correlated reply',()=>{
  const s=new Store(),r=s.createRoom('r'),{session}=registered(s),m=s.join(r.id,session.id,false);s.provision(r.id,session.id,'token');
  s.post({roomId:r.id,body:'question',kind:'followup',targets:[m.id]});const offered=s.inbox(s.registration('token')).inbox[0];s.archiveRoom(r.id);
  assert.throws(()=>s.post({roomId:r.id,body:'new',kind:'followup',targets:[m.id]}),/archived/);
  assert.ok(s.reply(s.registration('token'),offered.request_id,'finished before archive was observed').message.reply_to);
});
test('Windows path separators and case do not create a second session identity',()=>{
  const s=new Store(),first=registered(s);
  const same=s.registerSession({provider:'CODEX',host:'TEST',nativeId:'native-1',cwd:'c:\\WORK\\',profile:'default',mode:'read_only'});
  assert.equal(first.session.id,same.session.id);
  assert.equal(s.db.prepare('SELECT count(*) n FROM sessions').get().n,1);
});
test('personas survive reopen, identity registration, and room changes',()=>{
  const dir=mkdtempSync(join(tmpdir(),'rooms-persona-')),path=join(dir,'test.sqlite');let s=new Store(path);
  try{
    const first=registered(s).session,persona={alias:first.alias,avatar:first.avatar};
    const same=registered(s).session;assert.equal(same.id,first.id);assert.deepEqual({alias:same.alias,avatar:same.avatar},persona);
    const other=s.registerSession({provider:'claude',host:'test',nativeId:'native-1',cwd:'C:/work',profile:'default',mode:'read_only'}).session;
    assert.notEqual(other.id,first.id);assert.notEqual(other.alias,persona.alias);
    const rooms=[s.createRoom('first room',s.createChannel('first channel').id),s.createRoom('second room',s.createChannel('second channel').id)];
    const memberships=rooms.map(room=>s.join(room.id,first.id,false));assert.notEqual(memberships[0].id,memberships[1].id);
    s.join(rooms[1].id,other.id,true);s.db.close();s=new Store(path);
    const reopened=registered(s).session;assert.equal(reopened.id,first.id);
    for(const room of rooms){const member=s.room(room.id).members.find(m=>m.session_id===first.id);assert.deepEqual({alias:member.alias,avatar:member.avatar},persona);}
    assert.equal(s.db.prepare('SELECT count(*) n FROM sessions WHERE id=?').get(first.id).n,1);
  }finally{s.db.close();rmSync(dir,{recursive:true,force:true});}
});
test('mention routing is exact, deduped, frozen, and never falls back to all',()=>{
  const s=new Store(),r=s.createRoom('r'),a=registered(s).session,b=s.registerSession({provider:'claude',host:'test',nativeId:'b',cwd:'C:/b',profile:'default',mode:'live_attach',verified:true,capabilities:{followup:true}}).session;
  const ma=s.join(r.id,a.id,false),mb=s.join(r.id,b.id,false);const one=s.post({roomId:r.id,body:`@${a.alias} @${a.alias} hi`,kind:'followup',routingMode:'mentions',requestKey:'mention'});
  assert.deepEqual(one.deliveries.map(d=>d.membership_id),[ma.id]);s.leave(r.id,a.id);
  assert.equal(s.post({roomId:r.id,body:`@${a.alias} @${a.alias} hi`,kind:'followup',routingMode:'mentions',requestKey:'mention'}).message.id,one.message.id);
  assert.throws(()=>s.post({roomId:r.id,body:'@missing hi',kind:'followup',routingMode:'mentions'}),/unknown/);
  assert.equal(s.post({roomId:r.id,body:'plain',kind:'followup',routingMode:'mentions'}).deliveries[0].membership_id,mb.id);
});
test('reactions are room scoped, idempotent, and create no deliveries',()=>{
  const s=new Store(),a=s.createRoom('a'),b=s.createRoom('b');const message=s.post({roomId:a.id,body:'hello'}).message;
  s.setReaction(a.id,message.id,'👍',true);s.setReaction(a.id,message.id,'👍',true);assert.equal(s.room(a.id).reactions.length,1);
  assert.throws(()=>s.setReaction(b.id,message.id,'👍',true),/outside/);assert.throws(()=>s.setReaction(a.id,message.id,'🔥',true),/unsupported/);
  s.setReaction(a.id,message.id,'👍',false);assert.equal(s.room(a.id).reactions.length,0);assert.equal(s.room(a.id).deliveries.length,0);
});
test('registered reactions have server-owned actors and feedback is bounded to prior authorship',()=>{
  const s=new Store(),r=s.createRoom('r'),author=registered(s).session,reactor=s.registerSession({provider:'claude',host:'test',nativeId:'reactor',cwd:'C:/reactor',profile:'default',mode:'live_attach',verified:true,capabilities:{followup:true}}).session;
  const ma=s.join(r.id,author.id,false),mr=s.join(r.id,reactor.id,false);s.provision(r.id,reactor.id,'reactor-token');
  const mine=s.post({roomId:r.id,senderSessionId:author.id,body:'my message'}).message,other=s.post({roomId:r.id,senderSessionId:reactor.id,body:'other message'}).message;
  s.react(s.registration('reactor-token'),mine.id,'💡',true);assert.equal(s.room(r.id).reactions[0].actor,`session:${reactor.id}`);assert.equal(s.room(r.id).reactions[0].alias,reactor.alias);
  assert.throws(()=>s.react({...s.registration('reactor-token'),read_only:1},mine.id,'👍',true),/read-only/);
  assert.throws(()=>s.react(s.registration('reactor-token'),other.id,'🔥',true),/unsupported/);
  const feedback=s.reactionFeedback(r.id,author.id);assert.equal(feedback.length,1);assert.equal(feedback[0].messageId,mine.id);assert.equal(feedback[0].label,'아이디어 있음');assert.equal(feedback[0].membershipId,mr.id);assert.equal(feedback[0].reactionActorAlias,reactor.alias);assert.equal(s.reactionFeedback(r.id,reactor.id).length,0);assert.equal(s.inbox({membership_id:ma.id,session_id:author.id,room_id:r.id,read_only:0}).reactionFeedback.length,1);
});
