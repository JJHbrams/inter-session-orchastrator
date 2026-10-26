import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../services/coordinator/store.js';
import {ChairCoordinator} from '../services/coordinator/chair.js';
import {DebateCoordinator} from '../services/coordinator/debate.js';
import {KnowledgeStore} from '../services/coordinator/knowledge.js';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const participant=(store,room,nativeId)=>{const session=store.registerSession({provider:'codex',host:'test',nativeId,cwd:'C:/test',profile:'test',mode:'live_attach',ownership:'borrowed',verified:true,capabilities:{followup:true}}).session;return {session,membership:store.join(room.id,session.id,false)};};
const registration=(room,p)=>({room_id:room.id,session_id:p.session.id,membership_id:p.membership.id});
const chairRunner={initialize:async({nativeId})=>({nativeId,started:true,output:{speech:'ready'}})};

test('legacy review schema appends attachment IDs without changing existing column order',()=>{
 const store=new Store();
 store.db.exec('CREATE TABLE debate_reviews(id TEXT PRIMARY KEY,agenda_id TEXT NOT NULL,round_id TEXT NOT NULL,membership_id TEXT NOT NULL,conclusion_revision INTEGER NOT NULL,stance TEXT NOT NULL,source_ids TEXT NOT NULL,body TEXT NOT NULL,reply_message_id TEXT,request_id TEXT,created_at TEXT NOT NULL,UNIQUE(round_id,membership_id,conclusion_revision));');
 new DebateCoordinator(store);
 const columns=store.db.prepare('PRAGMA table_info(debate_reviews)').all().map(x=>x.name);
 assert.deepEqual(columns,['id','agenda_id','round_id','membership_id','conclusion_revision','stance','source_ids','body','reply_message_id','request_id','created_at','attachment_ids']);
});

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

test('fake-chair lifecycle carries six evidence files into generated review and final output',async()=>{
 const store=new Store(),room=store.createRoom('lifecycle'),a=participant(store,room,'a'),b=participant(store,room,'b');
 const files=[0,1,2,3,4,5].map(n=>store.uploadAttachment(room.id,{filename:`evidence-${n}.txt`,base64:Buffer.from(`bytes-${n}`).toString('base64'),requestKey:`lifecycle-upload-${n}`},n<3?a.session.id:b.session.id));
 const planFile=store.uploadAttachment(room.id,{filename:'plan.txt',base64:Buffer.from('plan bytes').toString('base64'),requestKey:'plan-file'},a.session.id);
 store.post({roomId:room.id,senderSessionId:a.session.id,body:'shared before agenda',attachmentIds:[planFile.id]});
 const reviewFile=store.uploadAttachment(room.id,{filename:'review.txt',base64:Buffer.from('review bytes').toString('base64'),requestKey:'review-file'},b.session.id);
 let calls=0,answerIds=[],contexts=[];
 const runner={initialize:async({nativeId})=>({nativeId,started:true,output:{speech:'ready'}}),resume:async({nativeId,onStarted,body})=>{contexts.push(body);onStarted();calls++;if(calls===1)return {nativeId,started:true,output:{speech:'plan',questions:[{targetMembershipIds:[a.membership.id],body:'A evidence',attachmentIds:[planFile.id]},{targetMembershipIds:[b.membership.id],body:'B evidence'}],proposal:null}};if(calls===2)return {nativeId,started:true,output:{speech:'candidate',attachmentIds:[files[5].id],questions:[],proposal:{body:'candidate',sourceIds:answerIds,attachmentIds:files.slice(0,5).map(x=>x.id)}}};return {nativeId,started:true,output:{speech:'final',attachmentIds:[files[5].id],questions:[],proposal:{body:'final',sourceIds:answerIds,attachmentIds:files.slice(0,5).map(x=>x.id)}}};}};
 const knowledge=new KnowledgeStore(store,{defaultRoot:await mkdtemp(join(tmpdir(),'agenda-knowledge-'))}),chairs=new ChairCoordinator(store,{runner}),debates=new DebateCoordinator(store,{chairs,knowledge}),chair=await chairs.create(room.id);
 const agenda=debates.create(room.id,{title:'files',body:'inspect all files',targetMembershipIds:[a.membership.id,b.membership.id],requestKey:'lifecycle'});
 await chairs.tick(room.id);
 assert.deepEqual(store.room(room.id).deliveries.find(d=>d.membership_id===a.membership.id&&d.state==='queued').attachments.map(x=>x.id),[planFile.id]);
 for(const [p,ids] of [[a,files.slice(0,3)],[b,files.slice(3)]]){const delivery=store.room(room.id).deliveries.find(d=>d.membership_id===p.membership.id&&d.state==='queued');const reply=store.reply(registration(room,p),delivery.request_id,`${p.session.native_id} argument`,ids.map(x=>x.id));answerIds.push(reply.message.id);}
 await debates.tick(room.id);await chairs.tick(room.id);
 let state=debates.get(room.id,agenda.id),reviewRound=state.rounds.at(-1),reviewMessage=store.room(room.id).messages.find(m=>m.request_key===`agenda:${agenda.id}:round:${reviewRound.id}:review`),reviewPrompt=JSON.parse(reviewMessage.body);
 assert.equal(reviewPrompt.attachmentRefs.length,6);assert.deepEqual(reviewMessage.attachments.map(x=>x.id),files.slice(0,5).map(x=>x.id));assert.equal(reviewPrompt.arguments.flatMap(x=>x.attachments).length,6);
 const reviewDeliveries=store.room(room.id).deliveries.filter(d=>d.message_id===reviewMessage.id&&d.state==='queued');
 for(const p of [a,b]){const delivery=reviewDeliveries.find(d=>d.membership_id===p.membership.id);debates.recordReview(room.id,registration(room,p),{agendaId:agenda.id,roundId:reviewRound.id,conclusionRevision:1,stance:'agree',sourceIds:[answerIds[0]],attachmentIds:p===b?[reviewFile.id]:[],body:`${p.session.native_id} review`,requestId:delivery.request_id});}
 await debates.tick(room.id);
 const candidate=store.room(room.id).messages.find(m=>m.sender_session_id===chair.session_id&&m.body.startsWith('candidate'));store.react(registration(room,b),candidate.id,'💡',true);
 await chairs.tick(room.id);
 state=debates.get(room.id,agenda.id);assert.equal(state.outcome,'consensus');
 const final=store.room(room.id).messages.find(m=>m.sender_session_id===chair.session_id&&m.body.startsWith('final'));
 assert.deepEqual(final.attachments.map(x=>x.id),files.slice(0,5).map(x=>x.id));assert.match(final.body,/추가 공유 자료/);assert.match(final.body,new RegExp(files[5].sha256));assert.match(final.body,new RegExp(`/api/rooms/${room.id}/attachments/${files[5].id}`));
 assert.deepEqual(state.reviews.find(x=>x.membership_id===b.membership.id).attachments.map(x=>x.id),[reviewFile.id]);
 assert.match(contexts.at(-1),new RegExp(b.session.id));assert.match(contexts.at(-1),new RegExp(candidate.id));
 assert.ok(knowledge.list(room.id,{kind:'argument'}).items.some(item=>item.provenance.some(p=>p.attachments?.some(x=>x.sha256===files[0].sha256))));
 const privateOverflow=store.uploadAttachment(room.id,{filename:'private.txt',base64:Buffer.from('private').toString('base64'),requestKey:'private-overflow'},b.session.id);
 assert.throws(()=>chairs.validate(room.id,chair,{speech:'must not disclose',attachmentIds:[privateOverflow.id],questions:[],proposal:{body:'candidate',sourceIds:[answerIds[0]],attachmentIds:files.slice(0,5).map(x=>x.id)}}),/not shared|outside this room/);
});
