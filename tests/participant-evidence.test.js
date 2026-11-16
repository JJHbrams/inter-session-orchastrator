import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { Store } from '../services/coordinator/store.js';
import { collaborationSchemas } from '../packages/mcp/collaboration-tools.js';
import { ChairCoordinator } from '../services/coordinator/chair.js';
import { DebateCoordinator } from '../services/coordinator/debate.js';

const participant=(store,room,name,readOnly=false)=>{
 const session=store.registerSession({provider:'codex',host:'test',nativeId:name,cwd:'C:/test',profile:'default',mode:'live_attach',ownership:'borrowed',verified:true,capabilities:{followup:true}}).session;
 return {session,membership:store.join(room.id,session.id,readOnly)};
};

test('participant evidence is lossless, shared, idempotent, and bounded with existing attachments',()=>{
 const store=new Store(),room=store.createRoom('evidence'),author=participant(store,room,'author'),other=participant(store,room,'other'),foreignRoom=store.createRoom('foreign'),foreign=participant(store,foreignRoom,'foreign');
 const evidence={title:'원문 근거',body:'한글 evidence\n'.repeat(2000)},post={roomId:room.id,senderSessionId:author.session.id,body:'짧은 결론',kind:'post',targets:[],requestKey:'evidence-post',evidence};
 const first=store.postWithEvidence(post),attachment=first.message.attachments[0],read=store.readAttachment(room.id,attachment.id,other.session.id);
 assert.equal(Buffer.from(read.base64,'base64').toString('utf8'),evidence.body);assert.equal(read.sha256,createHash('sha256').update(evidence.body).digest('hex'));assert.match(read.filename,/원문 근거-[0-9a-f]{8}\.md$/);
 assert.equal(store.postWithEvidence(post).message.id,first.message.id);
 assert.throws(()=>store.postWithEvidence({...post,evidence:{...evidence,body:'changed'}}),/conflict/);
 const foreignFile=store.uploadAttachment(foreignRoom.id,{filename:'foreign.md',base64:Buffer.from('x').toString('base64'),requestKey:'foreign'},foreign.session.id),before=store.db.prepare('SELECT count(*) n FROM attachments WHERE room_id=?').get(room.id).n;
 assert.throws(()=>store.postWithEvidence({...post,requestKey:'bad-source',attachmentIds:[foreignFile.id]}),/outside/);assert.equal(store.db.prepare('SELECT count(*) n FROM attachments WHERE room_id=?').get(room.id).n,before);
 const files=Array.from({length:5},(_,i)=>store.uploadAttachment(room.id,{filename:`${i}.txt`,base64:Buffer.from(String(i)).toString('base64'),requestKey:`file-${i}`},author.session.id));
 assert.throws(()=>store.postWithEvidence({...post,requestKey:'over-limit',attachmentIds:files.map(x=>x.id)}),/invalid attachment/);
 const ro=participant(store,room,'readonly',true);assert.throws(()=>store.postWithEvidence({...post,senderSessionId:ro.session.id,requestKey:'readonly'}),/active writable/);
 assert.throws(()=>store.postWithEvidence({...post,requestKey:'too-long',evidence:{title:'x',body:'x'.repeat(32001)}}),/invalid evidence body/);
 const boundary={title:'제'.repeat(120),body:'한'.repeat(32000)},accepted=store.postWithEvidence({...post,requestKey:'exact-boundary',evidence:boundary});
 assert.equal(Buffer.from(store.readAttachment(room.id,accepted.message.attachments[0].id,other.session.id).base64,'base64').toString('utf8'),boundary.body);
 const implicit=store.postWithEvidence({...post,requestKey:null,body:'content-keyed'});assert.equal(store.postWithEvidence({...post,requestKey:null,body:'content-keyed'}).message.id,implicit.message.id);
 store.db.close();
});

test('reply evidence replays exactly and rejects changed source without an orphan',()=>{
 const store=new Store(),room=store.createRoom('reply'),author=participant(store,room,'author'),peer=participant(store,room,'peer');
 const request=store.post({roomId:room.id,senderSessionId:author.session.id,body:'review',kind:'followup',targets:[peer.membership.id],requestKey:'request'}),requestId=request.deliveries[0].request_id,reg={room_id:room.id,session_id:peer.session.id,membership_id:peer.membership.id},evidence={title:'상세 검토',body:'원문'.repeat(1000)};
 const first=store.reply(reg,requestId,'반대: 근거가 부족해.',[],evidence),attachment=first.message.attachments[0];
 assert.equal(store.reply(reg,requestId,'반대: 근거가 부족해.',[],evidence).message.id,first.message.id);
 const before=store.db.prepare('SELECT count(*) n FROM attachments WHERE room_id=?').get(room.id).n;
 assert.throws(()=>store.reply(reg,requestId,'반대: 근거가 부족해.',[],{...evidence,body:'changed'}),/conflict/);assert.equal(store.db.prepare('SELECT count(*) n FROM attachments WHERE room_id=?').get(room.id).n,before);
 assert.equal(store.readAttachment(room.id,attachment.id,author.session.id).text,evidence.body);store.db.close();
});

test('review evidence has the same idempotency and rollback contract',async()=>{
 const store=new Store(),room=store.createRoom('review'),peer=participant(store,room,'peer');let calls=0,answer;
 const chairs=new ChairCoordinator(store,{runner:{initialize:async({nativeId})=>({nativeId,started:true,output:{speech:'ready'}}),resume:async({nativeId,onStarted})=>{onStarted();calls++;return {nativeId,started:true,output:calls===1?{speech:'ask',questions:[{targetMembershipIds:[peer.membership.id],body:'evidence'}],proposal:null}:{speech:'candidate',questions:[],proposal:{body:'candidate',sourceIds:[answer.id]}}};}}}),debates=new DebateCoordinator(store,{chairs});
 await chairs.create(room.id);const agenda=debates.create(room.id,{title:'review',body:'topic',targetMembershipIds:[peer.membership.id],requestKey:'review'});await chairs.tick(room.id);
 const requested=store.room(room.id).deliveries.find(x=>x.membership_id===peer.membership.id&&x.state==='queued'),reg={room_id:room.id,session_id:peer.session.id,membership_id:peer.membership.id};answer=store.reply(reg,requested.request_id,'evidence').message;
 await debates.tick(room.id);await chairs.tick(room.id);const state=debates.get(room.id,agenda.id),round=state.rounds.at(-1),delivery=store.room(room.id).deliveries.find(x=>x.membership_id===peer.membership.id&&x.state==='queued'),input={agendaId:agenda.id,roundId:round.id,conclusionRevision:1,stance:'qualified',sourceIds:[answer.id],body:'조건부 동의',requestId:delivery.request_id,evidence:{title:'검토 원문',body:'상세 반론'}};
 const first=debates.recordReview(room.id,reg,input),before=store.db.prepare('SELECT count(*) n FROM attachments WHERE room_id=?').get(room.id).n;
 assert.equal(debates.recordReview(room.id,reg,input).id,first.id);assert.throws(()=>debates.recordReview(room.id,reg,{...input,evidence:{...input.evidence,body:'changed'}}),/conflict/);assert.equal(store.db.prepare('SELECT count(*) n FROM attachments WHERE room_id=?').get(room.id).n,before);store.db.close();
});

test('MCP schemas expose optional bounded evidence for participant post, reply, and review',()=>{
 const evidence=collaborationSchemas.room_review.properties.evidence;
 assert.equal(evidence.properties.title.maxLength,120);assert.equal(evidence.properties.body.maxLength,32000);
});
