import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../services/coordinator/store.js';
import {DEFAULT_REACTION_EMOJIS} from '../packages/contracts/index.js';

function member(store,room,name,readOnly=false){
 const {session}=store.registerSession({provider:'codex',host:'reaction-test',nativeId:name,cwd:'C:/test',profile:'default',mode:readOnly?'read_only':'live_attach',verified:!readOnly,capabilities:{followup:true,mcpPull:true}});
 const membership=store.join(room.id,session.id,readOnly);store.provision(room.id,session.id,name);
 return {session,membership,reg:store.registration(name)};
}

test('next offered input carries latest authored-message feedback without changing its body or scheduling work',()=>{
 const s=new Store(),room=s.createRoom('feedback'),author=member(s,room,'author'),peer=member(s,room,'peer');
 try{
  assert.deepEqual(DEFAULT_REACTION_EMOJIS,['👍','👎','❓','✅','💡']);
  const original='원문'.repeat(200),message=s.post({roomId:room.id,senderSessionId:author.session.id,body:original,kind:'post'}).message;
  s.react(peer.reg,message.id,'💡',true);s.setReaction(room.id,message.id,'✅',true);s.react(author.reg,message.id,'👍',true);
  const feedback=s.reactionFeedback(room.id,author.session.id);assert.equal(feedback.length,2);assert.equal(feedback.find(r=>r.emoji==='💡').membershipId,peer.membership.id);assert.equal(feedback[0].bodyExcerpt.length,240);
  assert.equal(s.reactionFeedback(room.id,peer.session.id).length,0);assert.equal(s.room(room.id).deliveries.length,0);
  s.react(peer.reg,message.id,'💡',false);
  const request=s.post({roomId:room.id,body:'다음 입력 @'+author.session.alias,kind:'followup',targets:[author.membership.id],requestKey:'next'});
  const offered=s.inbox(author.reg).inbox[0];assert.equal(offered.body,request.message.body);assert.deepEqual(offered.reactionFeedback.map(r=>r.emoji),['✅']);
  assert.match(request.message.payload_hash,/^[a-f0-9]{64}$/);assert.equal(s.db.prepare('SELECT payload_hash FROM messages WHERE id=?').get(request.message.id).payload_hash,request.message.payload_hash);
  const saved=s.room(room.id).messages.find(m=>m.id===message.id);assert.equal(saved.body,original);assert.equal(saved.payload_hash,message.payload_hash);
  s.setReaction(room.id,message.id,'✅',false);assert.equal(s.inbox(author.reg).reactionFeedback.length,0);
 }finally{s.db.close();}
});

test('reaction identity is room scoped, revoked on departure, and historical legacy reactors stay readable',()=>{
 const s=new Store(),a=s.createRoom('a'),b=s.createRoom('b'),peer=member(s,a,'peer'),readonly=member(s,a,'readonly',true);
 try{
  const message=s.post({roomId:a.id,body:'a',kind:'post'}).message,foreign=s.post({roomId:b.id,body:'b',kind:'post'}).message;
  for(const [target,emoji,active,pattern] of [[foreign.id,'👍',true,/outside/],[message.id,'🔥',true,/unsupported/],[message.id,'❓','true',/boolean/]])assert.throws(()=>s.react(peer.reg,target,emoji,active),pattern);
  assert.throws(()=>s.react(readonly.reg,message.id,'👍',true),/read-only/);
  s.react(peer.reg,message.id,'❓',true);s.react(peer.reg,message.id,'❓',true);s.setReaction(a.id,message.id,'❤️',true);s.setReaction(a.id,message.id,'👀',true);
  assert.equal(s.room(a.id).reactions.length,3);s.leave(a.id,peer.session.id);
  assert.throws(()=>s.react(peer.reg,message.id,'❓',false),/active writable/);
  const saved=s.room(a.id).reactions;assert.ok(saved.find(r=>r.actor==='session:'+peer.session.id).left_at);assert.equal(saved.find(r=>r.actor==='local-human'&&r.emoji==='❤️').alias,'사용자');assert.equal(s.room(a.id).deliveries.length,0);
 }finally{s.db.close();}
});
