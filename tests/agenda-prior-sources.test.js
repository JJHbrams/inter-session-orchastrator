import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../services/coordinator/store.js';
import {ChairCoordinator} from '../services/coordinator/chair.js';
import {DebateCoordinator} from '../services/coordinator/debate.js';

test('operator can pin prior room analysis before reviews without widening foreign, future or frozen sources',async()=>{
 const s=new Store(),room=s.createRoom('Issue analysis'),other=s.createRoom('Unrelated');
 const first=s.post({roomId:room.id,body:'Prior project analysis'}).message,second=s.post({roomId:room.id,body:'Another prior analysis'}).message;
 const foreign=s.post({roomId:other.id,body:'Foreign source'}).message;
 const peer=s.registerSession({provider:'claude',host:'test',nativeId:'native',cwd:'C:/test',profile:'default',mode:'live_attach',verified:true,capabilities:{followup:true}}).session,member=s.join(room.id,peer.id,false);
 let calls=0,answer;
 const chairs=new ChairCoordinator(s,{runner:{initialize:async({nativeId})=>({nativeId,started:true,output:{speech:'ready'}}),resume:async({nativeId,onStarted})=>{onStarted();calls++;return {nativeId,started:true,output:calls===1?{speech:'ask',questions:[{body:'Evidence',targetMembershipIds:[member.id]}],proposal:null}:{speech:'candidate',questions:[],proposal:{body:'Proposed conclusion',sourceIds:[answer.id]}}};}}});
 const d=new DebateCoordinator(s,{chairs});
 try{
  await chairs.create(room.id);const a=d.create(room.id,{title:'Issue',body:'Review the existing project analyses',targetMembershipIds:[member.id]});
  assert.throws(()=>d._validateSources(d.get(room.id,a.id),[first.id]),/outside this agenda/);
  assert.throws(()=>d.action(room.id,a.id,'prior-sources',{messageIds:[first.id,foreign.id]}),/belong to this room/);
  assert.throws(()=>d._validateSources(d.get(room.id,a.id),[first.id]),/outside this agenda/);
  d.action(room.id,a.id,'prior-sources',{messageIds:[first.id]});d._validateSources(d.get(room.id,a.id),[first.id]);
  const future=s.post({roomId:room.id,body:'Later message'}).message;s.db.prepare("UPDATE messages SET created_at='9999-01-01T00:00:00.000Z' WHERE id=?").run(future.id);
  assert.throws(()=>d.action(room.id,a.id,'prior-sources',{messageIds:[future.id]}),/predate this agenda/);
  await chairs.tick(room.id);let delivery=s.room(room.id).deliveries.find(x=>x.membership_id===member.id&&x.state==='queued');
  const reg={room_id:room.id,session_id:peer.id,membership_id:member.id};answer=s.reply(reg,delivery.request_id,'Current evidence').message;
  await d.tick(room.id);await chairs.tick(room.id);const reviewing=d.get(room.id,a.id),round=reviewing.rounds.at(-1);delivery=s.room(room.id).deliveries.find(x=>x.membership_id===member.id&&x.state==='queued');
  d.recordReview(room.id,reg,{agendaId:a.id,roundId:round.id,conclusionRevision:1,stance:'agree',sourceIds:[first.id,answer.id],body:'Agree after reading pinned analysis',requestId:delivery.request_id});
  assert.throws(()=>d.action(room.id,a.id,'prior-sources',{messageIds:[second.id]}),/already frozen/);
  assert.doesNotThrow(()=>d.action(room.id,a.id,'prior-sources',{messageIds:[first.id]}));
  assert.equal(s.db.prepare("SELECT count(*) n FROM events WHERE event='agenda.sources-linked'").get().n,1);
 }finally{s.db.close();}
});
