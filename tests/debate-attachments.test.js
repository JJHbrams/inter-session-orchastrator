import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../services/coordinator/store.js';
import {ChairCoordinator} from '../services/coordinator/chair.js';
import {DebateCoordinator} from '../services/coordinator/debate.js';

const participant=(store,room,nativeId)=>{const session=store.registerSession({provider:'codex',host:'test',nativeId,cwd:'C:/test',profile:'test',mode:'live_attach',ownership:'borrowed',verified:true,capabilities:{followup:true}}).session;return {session,membership:store.join(room.id,session.id,false)};};
const registration=(room,p)=>({room_id:room.id,session_id:p.session.id,membership_id:p.membership.id});
const chairRunner={initialize:async({nativeId})=>({nativeId,started:true,output:{speech:'ready'}})};

test('agenda evidence and review preserve attachment metadata and review idempotency',async()=>{
 const store=new Store(),room=store.createRoom('attachments'),p=participant(store,room,'participant');
 const chairs=new ChairCoordinator(store,{runner:chairRunner}),debates=new DebateCoordinator(store,{chairs});
 await chairs.create(room.id);
 const files=[0,1,2,3,4,5].map(n=>store.uploadAttachment(room.id,{filename:`evidence-${n}.txt`,base64:Buffer.from(`bytes-${n}`).toString('base64'),requestKey:`upload-${n}`},p.session.id));
 const agenda=debates.create(room.id,{title:'files',body:'inspect files',targetMembershipIds:[p.membership.id],requestKey:'files'});
 const evidence=debates._round(agenda,'evidence',[p.membership.id]);
 const request=debates._post(agenda,evidence,'evidence:0','inspect attached evidence',[p.membership.id],[files[0].id]);
 const evidenceDelivery=request.deliveries[0];
 const answer=store.reply(registration(room,p),evidenceDelivery.request_id,'argument with file',[files[1].id]).message;
 const answerMeta=debates._answers(agenda,evidence)[0];
 assert.deepEqual(answerMeta.attachments.map(x=>x.id),[files[1].id]);
 assert.equal(answerMeta.attachments[0].sha256,files[1].sha256);
 store.db.prepare("UPDATE agendas SET phase='reviewing' WHERE id=?").run(agenda.id);
 const review=debates._round({...agenda,revision:1},'review',[p.membership.id]);
 const reviewRequest=debates._post(agenda,review,'review',JSON.stringify({attachmentRefs:files}),[p.membership.id],files.slice(0,5).map(x=>x.id));
 const reviewDelivery=reviewRequest.deliveries[0];
 const input={agendaId:agenda.id,roundId:review.id,conclusionRevision:1,stance:'qualified',sourceIds:[answer.id],attachmentIds:[files[2].id],body:'review with cited file',requestId:reviewDelivery.request_id};
 const saved=debates.recordReview(room.id,registration(room,p),input);
 assert.deepEqual(saved.attachments.map(x=>x.id),[files[2].id]);
 assert.deepEqual(debates.recordReview(room.id,registration(room,p),input).attachmentIds,[files[2].id]);
 assert.throws(()=>debates.recordReview(room.id,registration(room,p),{...input,attachmentIds:[files[3].id]}),/idempotency conflict/);
 const prompt=JSON.parse(store.room(room.id).messages.find(m=>m.id===reviewRequest.message.id).body);
 assert.equal(prompt.attachmentRefs.length,6);
});
