import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {Store} from '../services/coordinator/store.js';
import {identityKey} from '../packages/contracts/index.js';
import {parseAliases,mentionAt} from '../packages/contracts/mentions.js';

test('shared mention parser ignores email, escaped symbols and closed or open code',()=>{
  assert.deepEqual(parseAliases('contact 이름@example.com @지수, @Alex @지수 \\@민수 `@코드` ```js\n@코드2\n```'),['지수','Alex']);
  assert.deepEqual(parseAliases('@지수 ```js\n@코드'),['지수']);
  assert.deepEqual(parseAliases('@지수 ~~~\n@코드\n~~~ @민수'),['지수','민수']);
  assert.deepEqual(parseAliases('@지수 `@코드'),['지수']);
  assert.deepEqual(mentionAt('앞 @지',4),{alias:'지',start:2,end:4});
  assert.equal(mentionAt('`@지',3),null);
});

test('legacy session schema backfills persona once and keeps original identity on reopen',()=>{
  const path=join(mkdtempSync(join(tmpdir(),'iso-persona-')),'legacy.sqlite');
  const input={provider:'codex',host:'test',nativeId:'legacy',cwd:'C:/legacy',profile:'default'};
  const old=new DatabaseSync(path);
  old.exec('CREATE TABLE sessions(id TEXT PRIMARY KEY,identity_key TEXT UNIQUE NOT NULL,provider TEXT NOT NULL,host TEXT NOT NULL,native_id TEXT NOT NULL,cwd TEXT NOT NULL,profile TEXT NOT NULL,display_name TEXT,created_at TEXT NOT NULL)');
  old.prepare('INSERT INTO sessions VALUES(?,?,?,?,?,?,?,?,?)').run('legacy-id',identityKey(input),'codex','test','legacy','C:/legacy','default','original-name','2026-10-22');old.close();
  const store=new Store(path),first=store.db.prepare('SELECT * FROM sessions WHERE id=?').get('legacy-id');
  assert.ok(first.alias);assert.match(first.avatar,/^#[a-f0-9]{6}$/i);assert.equal(first.display_name,'original-name');store.db.close();
  const reopened=new Store(path);assert.deepEqual(reopened.db.prepare('SELECT * FROM sessions WHERE id=?').get('legacy-id'),first);
  assert.equal(reopened.registerSession({...input,mode:'read_only'}).session.id,'legacy-id');
  const added=reopened.registerSession({...input,nativeId:'new-after-migration',mode:'read_only'}).session;
  const saved=reopened.db.prepare('SELECT * FROM sessions WHERE id=?').get(added.id);
  assert.equal(saved.alias,added.alias);assert.match(saved.avatar,/^#[a-f0-9]{6}$/i);
  assert.match(saved.created_at,/^\d{4}-\d{2}-\d{2}T/);reopened.db.close();
});

test('canonical request hash remains compatible and incomplete or read-only mentions do not broadcast',()=>{
  const store=new Store(),room=store.createRoom('r');
  const session=store.registerSession({provider:'codex',host:'test',nativeId:'s',cwd:'C:/test',profile:'default',mode:'live_attach',verified:true,capabilities:{followup:true}}).session;
  const member=store.join(room.id,session.id,false);
  const payload={body:'legacy body',kind:'followup',replyTo:null,targets:[member.id],expectedTurnId:null};
  const original=store.post({roomId:room.id,...payload,requestKey:'legacy-key'});
  assert.equal(original.message.payload_hash,createHash('sha256').update(JSON.stringify(payload)).digest('hex'));
  assert.equal(store.post({roomId:room.id,...payload,requestKey:'legacy-key'}).message.id,original.message.id);
  assert.throws(()=>store.post({roomId:room.id,body:'@ ',kind:'followup',routingMode:'mentions'}),/incomplete/);
  const readOnly=store.registerSession({provider:'claude',host:'test',nativeId:'readonly',cwd:'C:/read',profile:'default',mode:'read_only'}).session;
  store.join(room.id,readOnly.id,true);
  assert.throws(()=>store.post({roomId:room.id,body:`@${session.alias} @${readOnly.alias}`,kind:'followup',routingMode:'mentions'}),/read-only/);
  assert.equal(store.room(room.id).deliveries.length,1);store.db.close();
});

test('chair routing targets only the current writable chair and replays its original snapshot',()=>{
  const store=new Store(),room=store.createRoom('r');
  const make=(native,readOnly=false)=>store.registerSession({provider:'codex',host:'test',nativeId:native,cwd:'C:/'+native,profile:'default',mode:readOnly?'read_only':'live_attach',verified:!readOnly,capabilities:{followup:true}}).session;
  const chair=make('chair'),other=make('other'),readonly=make('readonly',true);
  const chairMember=store.join(room.id,chair.id,false),otherMember=store.join(room.id,other.id,false);store.join(room.id,readonly.id,true);store.role(room.id,chair.id,'chair');
  const first=store.post({roomId:room.id,body:`@${other.alias} context only`,kind:'followup',routingMode:'chair',requestKey:'chair-once'});
  assert.deepEqual(first.deliveries.map(d=>d.membership_id),[chairMember.id]);store.role(room.id,other.id,'chair');
  assert.equal(store.post({roomId:room.id,body:`@${other.alias} context only`,kind:'followup',routingMode:'chair',requestKey:'chair-once'}).message.id,first.message.id);
  const next=store.post({roomId:room.id,body:'next',kind:'followup',routingMode:'chair'});assert.deepEqual(next.deliveries.map(d=>d.membership_id),[otherMember.id]);
  store.role(room.id,readonly.id,'chair');assert.throws(()=>store.post({roomId:room.id,body:'blocked',kind:'followup',routingMode:'chair'}),/read-only/);
  store.db.prepare("UPDATE memberships SET role='member' WHERE room_id=?").run(room.id);assert.throws(()=>store.post({roomId:room.id,body:'missing',kind:'followup',routingMode:'chair'}),/exactly one/);
  store.db.prepare("UPDATE memberships SET role='chair' WHERE id IN (?,?)").run(chairMember.id,otherMember.id);
  assert.throws(()=>store.post({roomId:room.id,body:'ambiguous',kind:'followup',routingMode:'chair'}),/exactly one/);
  const post=store.post({roomId:room.id,body:'record',kind:'post',routingMode:'chair'});assert.equal(post.deliveries.length,0);store.db.close();
});

test('auto routing sends plain execution only to the ready dedicated chair and freezes explicit aliases',()=>{
  const store=new Store(),room=store.createRoom('auto');
  const member=store.registerSession({provider:'codex',host:'test',nativeId:'member',cwd:'C:/member',profile:'default',mode:'live_attach',verified:true,capabilities:{followup:true}}).session;
  const memberMembership=store.join(room.id,member.id,false);
  store.beginChair(room.id,'chair-native');const chair=store.readyChair(room.id,{nativeId:'chair-native',cwd:'C:/chair'});
  const chairMembership=store.room(room.id).members.find(m=>m.session_id===chair.session_id);
  const implicit=store.post({roomId:room.id,body:'please coordinate',kind:'followup',routingMode:'auto',requestKey:'implicit'});
  assert.deepEqual(implicit.deliveries.map(d=>d.membership_id),[chairMembership.id]);
  const explicit=store.post({roomId:room.id,body:`@${member.alias} @${chairMembership.alias} decide`,kind:'followup',routingMode:'auto',requestKey:'mixed'});
  assert.deepEqual(explicit.deliveries.map(d=>d.membership_id).sort(),[chairMembership.id,memberMembership.id].sort());
  store.leave(room.id,member.id);
  assert.equal(store.post({roomId:room.id,body:`@${member.alias} @${chairMembership.alias} decide`,kind:'followup',routingMode:'auto',requestKey:'mixed'}).message.id,explicit.message.id);
  assert.throws(()=>store.post({roomId:room.id,body:'@missing',kind:'followup',routingMode:'auto'}),/unknown/);
  assert.throws(()=>store.post({roomId:room.id,body:'@ ',kind:'followup',routingMode:'auto'}),/incomplete/);
  assert.equal(store.post({roomId:room.id,body:'notice @missing',kind:'notify',routingMode:'auto'}).deliveries.length,0);
  store.db.close();
});

test('auto routing permits an ordinary member without a chair but rejects an unavailable mentioned chair',()=>{
  const store=new Store(),room=store.createRoom('explicit');
  const member=store.registerSession({provider:'codex',host:'test',nativeId:'ordinary',cwd:'C:/ordinary',profile:'default',mode:'live_attach',verified:true,capabilities:{followup:true}}).session;
  store.join(room.id,member.id,false);
  assert.equal(store.post({roomId:room.id,body:`@${member.alias} direct`,kind:'followup',routingMode:'auto'}).deliveries.length,1);
  store.beginChair(room.id,'chair-native');const chair=store.readyChair(room.id,{nativeId:'chair-native',cwd:'C:/chair'});
  const chairMember=store.room(room.id).members.find(m=>m.session_id===chair.session_id);
  store.db.prepare("UPDATE chairs SET status='initializing' WHERE room_id=?").run(room.id);
  assert.throws(()=>store.post({roomId:room.id,body:`@${chairMember.alias} direct`,kind:'followup',routingMode:'auto'}),/ready writable dedicated chair/);
  store.db.close();
});

test('auto routing fails closed without one ready writable dedicated chair',()=>{
  const store=new Store(),room=store.createRoom('blocked');
  assert.throws(()=>store.post({roomId:room.id,body:'plain',kind:'followup',routingMode:'auto'}),/ready writable dedicated chair/);
  store.beginChair(room.id,'pending');
  assert.throws(()=>store.post({roomId:room.id,body:'plain',kind:'followup',routingMode:'auto'}),/ready writable dedicated chair/);
  store.db.close();
});
