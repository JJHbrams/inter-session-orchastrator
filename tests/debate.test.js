import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../services/coordinator/store.js';
import {ChairCoordinator} from '../services/coordinator/chair.js';
import {DebateCoordinator} from '../services/coordinator/debate.js';

const participant=(s,r,nativeId)=>{const session=s.registerSession({provider:'codex',host:'test',nativeId,cwd:'C:/test',profile:'default',mode:'live_attach',ownership:'borrowed',verified:true,capabilities:{followup:true}}).session;return {session,membership:s.join(r.id,session.id,false)};};
const reg=(room,p)=>({room_id:room.id,session_id:p.session.id,membership_id:p.membership.id});

test('dedicated chair completes plan, evidence, synthesis, review, and final through queued deliveries',async()=>{
 const s=new Store(),room=s.createRoom('agenda'),a=participant(s,room,'a'),b=participant(s,room,'b');let calls=0;
 const runner={initialize:async({nativeId})=>({nativeId,started:true,output:{speech:'ready'}}),resume:async({nativeId,onStarted})=>{onStarted();calls++;if(calls===1)return {nativeId,started:true,output:{speech:'ask evidence',questions:[{targetMembershipIds:[a.membership.id,b.membership.id],body:'give evidence'}],proposal:null}};if(calls===2)return {nativeId,started:true,output:{speech:'candidate',questions:[],proposal:{body:'choose A',sourceIds:answers.map(x=>x.id)}}};return {nativeId,started:true,output:{speech:'final',questions:[],proposal:{body:'choose A',sourceIds:answers.map(x=>x.id)}}};}};
 const c=new ChairCoordinator(s,{runner}),d=new DebateCoordinator(s,{chairs:c}),chair=await c.create(room.id),agenda=d.create(room.id,{title:'choice',body:'choose',targetMembershipIds:[a.membership.id,b.membership.id],requestKey:'vertical'});
 await c.tick(room.id);let state=d.get(room.id,agenda.id);assert.equal(state.phase,'collecting');const evidence=state.rounds.at(-1);for(const p of [a,b]){const delivery=s.room(room.id).deliveries.find(x=>x.membership_id===p.membership.id&&x.message_id!==undefined&&x.state==='queued');s.reply(reg(room,p),delivery.request_id,`${p.session.native_id} argument`);}
 const answers=s.room(room.id).messages.filter(x=>x.reply_request_id&&x.sender_session_id!==chair.session_id);await d.tick(room.id);await c.tick(room.id);state=d.get(room.id,agenda.id);assert.equal(state.phase,'reviewing');const review=state.rounds.at(-1);const reviewDeliveries=s.room(room.id).deliveries.filter(x=>x.membership_id===a.membership.id||x.membership_id===b.membership.id).filter(x=>x.request_id&&x.state==='queued');for(const p of [a,b]){const delivery=reviewDeliveries.find(x=>x.membership_id===p.membership.id);d.recordReview(room.id,reg(room,p),{agendaId:agenda.id,roundId:review.id,conclusionRevision:1,stance:'agree',sourceIds:[answers[0].id],body:'agree',requestId:delivery.request_id});}
 assert.ok(s.room(room.id).messages.some(x=>x.body.includes('a argument')&&x.body.includes('b argument')));await d.tick(room.id);await c.tick(room.id);assert.equal(calls,3);assert.equal(d.get(room.id,agenda.id).outcome,'consensus');
});
