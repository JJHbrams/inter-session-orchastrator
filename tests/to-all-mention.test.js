import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../services/coordinator/store.js';
import {parseAliases,resolveMentionTargets} from '../packages/contracts/mentions.js';

function fixture(){
 const store=new Store(),room=store.createRoom('group mentions');
 const add=(name,readOnly=false,roomId=room.id)=>{const {session}=store.registerSession({provider:'codex',host:'test',nativeId:name,cwd:'C:/test/'+name,profile:'test',mode:readOnly?'read_only':'live_attach',verified:!readOnly,capabilities:{followup:true}});return {...store.join(roomId,session.id,readOnly),...session,session_id:session.id};};
 const first=add('first'),second=add('second'),readOnly=add('readonly',true),departed=add('departed');store.leave(room.id,departed.session_id);
 const foreign=add('foreign',false,store.createRoom('other').id);
 store.beginChair(room.id,'group-chair');const chair=store.readyChair(room.id,{nativeId:'group-chair',cwd:'C:/group-chair'});
 const members=store.room(room.id).members;
 return {store,room,first,second,readOnly,departed,foreign,chair,members,chairMember:members.find(m=>m.session_id===chair.session_id)};
}

test('@to_all expands only to current writable non-chair members, deduplicates and freezes retries',()=>{
 const f=fixture(),{store,room,first,second,chair,members}=f;
 try{
  const expected=members.filter(m=>[first.session_id,second.session_id].includes(m.session_id)).map(m=>m.id).sort();
  const input={roomId:room.id,body:`@to_all @${first.alias} @to_all 검토해줘`,kind:'followup',routingMode:'auto',requestKey:'group-once'};
  const sent=store.post(input);assert.deepEqual(sent.deliveries.map(d=>d.membership_id).sort(),expected);assert.ok(sent.deliveries.every(d=>d.state==='queued'));
  store.leave(room.id,second.session_id);
  const extra=store.registerSession({provider:'claude',host:'test',nativeId:'later',cwd:'C:/later',profile:'test',mode:'live_attach',verified:true,capabilities:{followup:true}}).session;const extraMember=store.join(room.id,extra.id,false);
  const replay=store.post(input);assert.deepEqual(replay.message,sent.message);
  assert.deepEqual(replay.deliveries.map(d=>d.id),sent.deliveries.map(d=>d.id));
  assert.deepEqual(replay.deliveries.map(d=>d.membership_id).sort(),expected);
  store.db.prepare("UPDATE chairs SET status='unknown' WHERE room_id=?").run(room.id);
  const next=store.post({...input,requestKey:'group-new'});assert.deepEqual(next.deliveries.map(d=>d.membership_id).sort(),[expected.find(id=>id!==members.find(m=>m.session_id===second.session_id).id),extraMember.id].sort());
  assert.ok(next.deliveries.every(d=>d.membership_id!==f.chairMember.id));
  assert.equal(store.post({roomId:room.id,body:'@to_all 공유',kind:'post',routingMode:'auto'}).deliveries.length,0);
 }finally{store.db.close();}
});

test('explicit chair plus @to_all is a union; invalid explicit aliases reject the entire request',()=>{
 const {store,room,chairMember,readOnly,members}=fixture();
 try{
  const sent=store.post({roomId:room.id,body:`@to_all @${chairMember.alias}`,kind:'followup',routingMode:'auto'});
  assert.deepEqual(sent.deliveries.map(d=>d.membership_id).sort(),members.filter(m=>!m.left_at&&!m.read_only).map(m=>m.id).sort());
  const before=store.room(room.id).messages.length;
  for(const [body,pattern] of [['@to_all @typo',/unknown/],[`@to_all @${readOnly.alias}`,/read-only/],['@to_all @ ',/incomplete/]])assert.throws(()=>store.post({roomId:room.id,body,kind:'followup',routingMode:'auto'}),pattern);
  assert.equal(store.room(room.id).messages.length,before);
 }finally{store.db.close();}
});

test('empty @to_all never falls back to chair, and group delivery works without a chair',()=>{
 const store=new Store(),room=store.createRoom('empty');
 try{
  store.beginChair(room.id,'only-chair');const chair=store.readyChair(room.id,{nativeId:'only-chair',cwd:'C:/only-chair'});
  assert.throws(()=>store.post({roomId:room.id,body:'@to_all 확인',kind:'followup',routingMode:'auto'}),/recipients/);
  assert.equal(store.room(room.id).messages.length,0);
  const noChair=store.createRoom('no chair'),{session}=store.registerSession({provider:'codex',host:'test',nativeId:'alone',cwd:'C:/alone',profile:'test',mode:'live_attach',verified:true,capabilities:{followup:true}}),member=store.join(noChair.id,session.id,false);
  for(const routingMode of ['auto','mentions'])assert.deepEqual(store.post({roomId:noChair.id,body:'@to_all 확인',kind:'followup',routingMode}).deliveries.map(d=>d.membership_id),[member.id]);
 }finally{store.db.close();}
});

test('group token obeys existing parser boundaries and shared preview resolver',()=>{
 const members=[{id:'a',session_id:'a',alias:'민수',role:'member'},{id:'c',session_id:'c',alias:'좌장',role:'chair'},{id:'r',alias:'읽기',read_only:1},{id:'l',alias:'이탈',left_at:'past'}];
 assert.deepEqual(parseAliases('x@to_all \\@to_all `@to_all` ~~~\n@to_all\n~~~'),[]);
 assert.deepEqual(parseAliases('@to_all @to_all @to_all_extra'),['to_all','to_all_extra']);
 assert.deepEqual(resolveMentionTargets(['to_all','민수'],members,'c').map(m=>m.id),['a']);
 assert.deepEqual(resolveMentionTargets(['to_all'],[{id:'only',alias:'한명',role:'member'}]).map(m=>m.id),['only']);
 assert.deepEqual(resolveMentionTargets(['to_all','좌장'],members,'c').map(m=>m.id),['a','c']);
 assert.throws(()=>resolveMentionTargets(['to_all_extra'],members),/unknown/);
});
