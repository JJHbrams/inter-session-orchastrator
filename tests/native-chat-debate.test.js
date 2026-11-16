import test from 'node:test';
import assert from 'node:assert/strict';
import {Store} from '../services/coordinator/store.js';
import {ParticipantDispatcher} from '../services/coordinator/participant-dispatcher.js';
import {ChairCoordinator} from '../services/coordinator/chair.js';
import {DebateCoordinator} from '../services/coordinator/debate.js';

test('direct native participants complete evidence and explicit revision review without helper registration',async()=>{
  const s=new Store(),room=s.createRoom('Native debate');
  const peer=s.registerSession({provider:'claude',host:'orca/local',nativeId:'original',cwd:'C:/project',profile:'default',mode:'live_attach',ownership:'borrowed',handle:'actor',incarnation:'runtime:2',verified:true,capabilities:{transport:'orca-native-chat',followup:true,automaticInput:true}});
  const member=s.join(room.id,peer.session.id,false);let stages=0,agenda;
  const chairs=new ChairCoordinator(s,{runner:{initialize:async({nativeId})=>({nativeId,started:true,output:{speech:'ready'}}),resume:async({nativeId,onStarted})=>{
    onStarted();stages++;
    const source=s.db.prepare("SELECT id FROM messages WHERE sender_session_id=? AND reply_request_id IS NOT NULL ORDER BY rowid LIMIT 1").get(peer.session.id);
    return {nativeId,started:true,output:stages===1?{speech:'ask',questions:[{targetMembershipIds:[member.id],body:'Provide evidence'}],proposal:null}:{speech:'proposal',questions:[],proposal:{body:'Grounded conclusion',sourceIds:[source.id]}}};
  }}});
  const debates=new DebateCoordinator(s,{chairs});
  const calls=[],adapter={async preflight(){return {ok:true};},async send(row,_session,prompt,requestId,options){
    calls.push(prompt);const receipt={sessionId:row.handle,nativeId:row.native_id,runtimeId:'runtime',fence:2,requestId,clientOperationId:'1793860000000-'+requestId.replaceAll('-',''),payloadFingerprint:'fingerprint:'+requestId};await options.onPrepared(receipt);
    let request;try{request=JSON.parse(row.body);}catch{}
    const body=request?.type==='agenda_review'?JSON.stringify({agendaId:request.agendaId,roundId:request.roundId,conclusionRevision:request.conclusionRevision,stance:'agree',sourceIds:[s.db.prepare("SELECT id FROM messages WHERE sender_session_id=? AND reply_request_id IS NOT NULL ORDER BY rowid LIMIT 1").get(peer.session.id).id],body:'I explicitly agree with this revision.'}):'Native evidence from the original conversation';
    return {ok:true,stage:'reply',receipt,reply:{body,turnId:'turn:'+requestId,itemIds:['assistant:'+requestId]}};
  }};
  const participants=new ParticipantDispatcher(s,{adapter});participants.debates=debates;
  try{
    await chairs.create(room.id);agenda=debates.create(room.id,{title:'Choice',body:'Analyze',targetMembershipIds:[member.id]});
    await chairs.tick(room.id);await participants.tick();await debates.tick(room.id);await chairs.tick(room.id);
    assert.equal(debates.get(room.id,agenda.id).phase,'reviewing');await participants.tick();
    const state=debates.get(room.id,agenda.id);assert.equal(state.reviews.length,1);assert.equal(state.reviews[0].stance,'agree');
    assert.match(calls.at(-1),/검토용 현재 결론/);assert.match(calls.at(-1),/Grounded conclusion/);
    assert.equal(s.db.prepare('SELECT count(*) n FROM registrations').get().n,0);
    assert.equal(s.db.prepare("SELECT count(*) n FROM evidence WHERE source='orca-native-chat' AND kind='reply'").get().n,2);
    await debates.tick(room.id);await chairs.tick(room.id);assert.equal(debates.get(room.id,agenda.id).outcome,'consensus');
  }finally{s.db.close();}
});
