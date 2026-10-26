import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../services/coordinator/store.js';
import {DebateCoordinator} from '../services/coordinator/debate.js';

const participant=(store,room,nativeId)=>{const session=store.registerSession({provider:'codex',host:'test',nativeId,cwd:'C:/test',profile:'default',mode:'live_attach',ownership:'borrowed',verified:true,capabilities:{followup:true}}).session;return {session,membership:store.join(room.id,session.id,false)};};
const registration=(room,p)=>({room_id:room.id,session_id:p.session.id,membership_id:p.membership.id});
const delivery=(store,room,membershipId)=>store.room(room.id).deliveries.filter(d=>d.membership_id===membershipId&&d.state==='queued').at(-1);

test('agenda requires evidence then explicit peer review before consensus',async()=>{
 const s=new Store(),room=s.createRoom('debate'),a=participant(s,room,'a'),b=participant(s,room,'b'),d=new DebateCoordinator(s);
 const agenda=d.create(room.id,{title:'decision',body:'compare options',targetMembershipIds:[a.membership.id,b.membership.id],requestKey:'decision'});
 await d.tick(room.id);for(const p of [a,b]){const q=delivery(s,room,p.membership.id);s.reply(registration(room,p),q.request_id,`${p.session.native_id} evidence`);}
 await d.tick(room.id);const reviewing=d.get(room.id,agenda.id);assert.equal(reviewing.phase,'reviewing');const round=reviewing.rounds.at(-1);for(const p of [a,b]){const q=delivery(s,room,p.membership.id);d.recordReview(room.id,registration(room,p),{agendaId:agenda.id,roundId:round.id,conclusionRevision:1,stance:'agree',sourceIds:[agenda.root_message_id],body:'reviewed evidence',requestId:q.request_id});}
 await d.tick(room.id);assert.equal(d.get(room.id,agenda.id).outcome,'consensus');
});

test('dissent forces revision and an old revision cannot become consensus',async()=>{
 const s=new Store(),room=s.createRoom('revision'),a=participant(s,room,'a'),b=participant(s,room,'b'),d=new DebateCoordinator(s),agenda=d.create(room.id,{title:'x',body:'x',targetMembershipIds:[a.membership.id,b.membership.id],requestKey:'x'});
 await d.tick(room.id);for(const p of [a,b]){const q=delivery(s,room,p.membership.id);s.reply(registration(room,p),q.request_id,'evidence');}await d.tick(room.id);const review=d.get(room.id,agenda.id).rounds.at(-1);for(const [p,stance] of [[a,'agree'],[b,'disagree']]){const q=delivery(s,room,p.membership.id);d.recordReview(room.id,registration(room,p),{agendaId:agenda.id,roundId:review.id,conclusionRevision:1,stance,sourceIds:[agenda.root_message_id],body:stance,requestId:q.request_id});}await d.tick(room.id);assert.equal(d.get(room.id,agenda.id).phase,'refining');assert.equal(d.get(room.id,agenda.id).revision,2);assert.throws(()=>d.handleChairOutput(room.id,{debate:{agendaId:agenda.id,phase:'final',conclusionRevision:1,sourceIds:[],unresolved:[],outcome:'consensus'}}),/stale/);
});

test('budget ends as partial and pause/restart does not duplicate delivery',async()=>{
 const s=new Store(),room=s.createRoom('budget'),p=participant(s,room,'p'),d=new DebateCoordinator(s),agenda=d.create(room.id,{title:'x',body:'x',targetMembershipIds:[p.membership.id],requestBudget:1,roundBudget:1,requestKey:'budget'});d.action(room.id,agenda.id,'pause');await d.tick(room.id);assert.equal(s.room(room.id).deliveries.length,0);d.action(room.id,agenda.id,'resume');await d.tick(room.id);await d.tick(room.id);assert.equal(s.room(room.id).deliveries.length,1);s.db.close();
});

test('approval fanout is idempotent and acknowledgement does not create work',async()=>{
 const s=new Store(),room=s.createRoom('approval'),p=participant(s,room,'p'),d=new DebateCoordinator(s),agenda=d.create(room.id,{title:'x',body:'x',targetMembershipIds:[p.membership.id],requestKey:'approval'});s.db.prepare("UPDATE agendas SET phase='completed',outcome='qualified' WHERE id=?").run(agenda.id);d.approve(room.id,agenda.id,{revision:1});d.approve(room.id,agenda.id,{revision:1});const notice=d.get(room.id,agenda.id).notices[0],before=s.room(room.id).messages.length;d.ack(room.id,registration(room,p),notice.id,1);assert.equal(d.get(room.id,agenda.id).notices[0].status,'acknowledged');assert.equal(s.room(room.id).messages.length,before);
});
