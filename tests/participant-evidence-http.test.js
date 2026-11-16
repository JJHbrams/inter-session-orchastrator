import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:net';
import {createHash} from 'node:crypto';
import {Store} from '../services/coordinator/store.js';
import {ChairCoordinator} from '../services/coordinator/chair.js';
import {DebateCoordinator} from '../services/coordinator/debate.js';
import {SESSION_ADDRESSING} from '../packages/contracts/session-language.js';

const hash=value=>createHash('sha256').update(value).digest('hex');
const seededReview=async dbPath=>{
 const store=new Store(dbPath),room=store.createRoom('seeded review'),session=store.registerSession({provider:'codex',host:'test',nativeId:'reviewer',cwd:'C:/test',profile:'test',mode:'live_attach',ownership:'borrowed',verified:true,capabilities:{followup:true}}).session,membership=store.join(room.id,session.id,false),reg={room_id:room.id,session_id:session.id,membership_id:membership.id};let calls=0,answer;
 const chairs=new ChairCoordinator(store,{runner:{initialize:async({nativeId})=>({nativeId,started:true,output:{speech:'ready'}}),resume:async({nativeId,onStarted})=>{onStarted();calls++;return {nativeId,started:true,output:calls===1?{speech:'ask',questions:[{targetMembershipIds:[membership.id],body:'evidence'}],proposal:null}:{speech:'candidate',questions:[],proposal:{body:'candidate',sourceIds:[answer.id]}}};}}}),debates=new DebateCoordinator(store,{chairs});
 await chairs.create(room.id);const agenda=debates.create(room.id,{title:'review',body:'topic',targetMembershipIds:[membership.id],requestKey:'seed'});await chairs.tick(room.id);const evidenceDelivery=store.room(room.id).deliveries.find(x=>x.membership_id===membership.id&&x.state==='queued');answer=store.reply(reg,evidenceDelivery.request_id,'evidence').message;await debates.tick(room.id);await chairs.tick(room.id);const state=debates.get(room.id,agenda.id),round=state.rounds.at(-1),reviewDelivery=store.room(room.id).deliveries.find(x=>x.membership_id===membership.id&&x.state==='queued'),token='seeded-review-token';store.provision(room.id,session.id,hash(token));debates.action(room.id,agenda.id,'pause');store.db.close();return {room,token,review:{agendaId:agenda.id,roundId:round.id,conclusionRevision:1,stance:'qualified',sourceIds:[answer.id],body:'조건부 동의',requestId:reviewDelivery.request_id}};
};

test('authenticated HTTP post and reply share optional evidence atomically',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'participant-evidence-http-')),reserve=createServer();await new Promise(resolve=>reserve.listen(0,'127.0.0.1',resolve));const port=reserve.address().port;await new Promise(resolve=>reserve.close(resolve));
 const child=spawn(process.execPath,['services/coordinator/server.js'],{env:{...process.env,PORT:String(port),ROOMS_DB:join(dir,'state.sqlite'),ROOMS_KNOWLEDGE_ROOT:join(dir,'knowledge')},windowsHide:true,stdio:['ignore','pipe','pipe']});
 try{
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('server startup timeout')),10000);child.stdout.on('data',x=>{if(String(x).includes('listening')){clearTimeout(timer);resolve();}});child.once('error',reject);});
  const base=`http://127.0.0.1:${port}`,boot=await fetch(base+'/api/bootstrap'),cookie=boot.headers.get('set-cookie').split(';')[0],{csrf}=await boot.json(),api=(path,input)=>fetch(base+path,{method:'POST',headers:{cookie,'x-csrf-token':csrf,'Content-Type':'application/json'},body:JSON.stringify(input)});
  const room=await (await api('/api/rooms',{name:'evidence'})).json(),make=async name=>{const session=(await (await api('/api/sessions',{provider:'codex',host:'test',nativeId:name,cwd:dir,profile:'test',mode:'live_attach',verified:true,capabilities:{followup:true}})).json()).session,membership=await (await api(`/api/rooms/${room.id}/join`,{sessionId:session.id,readOnly:false})).json(),provision=await (await api(`/api/rooms/${room.id}/provision`,{sessionId:session.id})).json();return {session,membership,token:provision.token};},a=await make('a'),b=await make('b'),mcp=(token,action,input)=>fetch(base+`/mcp/${action}`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(input)});
  const evidence={title:'HTTP 원문',body:'상세 원문 '.repeat(1000)},post=await (await mcp(a.token,'room_post',{body:'짧은 결론',requestKey:'post',evidence})).json();assert.equal(post.message.attachments.length,1);const shared=await (await mcp(b.token,'room_read_attachment',{attachmentId:post.message.attachments[0].id})).json();assert.equal(shared.text,evidence.body);
  const request=await (await api(`/api/rooms/${room.id}/messages`,{body:'reply please',kind:'followup',targets:[b.membership.id],requestKey:'request'})).json();
  const offered=await (await mcp(b.token,'room_inbox',{requestId:request.deliveries[0].request_id})).json();
  assert.equal(offered.roomId,room.id);assert.equal(offered.inbox[0].request_id,request.deliveries[0].request_id);assert.match(offered.participantInstructions,/room_review/);assert.ok(offered.participantInstructions.includes(room.id));assert.ok(!offered.participantInstructions.includes(b.token));
  assert.ok(offered.participantInstructions.includes(SESSION_ADDRESSING));
  assert.equal(offered.ownIdentity.sessionId,b.session.id);assert.equal(offered.ownIdentity.membershipId,b.membership.id);assert.equal(offered.ownIdentity.roomId,room.id);
  const otherRoom=await (await api('/api/rooms',{name:'second room, same invited session'})).json(),otherMembership=await (await api(`/api/rooms/${otherRoom.id}/join`,{sessionId:b.session.id,readOnly:false})).json(),otherProvision=await (await api(`/api/rooms/${otherRoom.id}/provision`,{sessionId:b.session.id})).json();
  const otherInbox=await (await mcp(otherProvision.token,'room_inbox',{})).json();
  const correction={body:'원래 발언을 정정합니다.',replyTo:post.message.id,requestKey:'threaded-correction'},threaded=await (await mcp(b.token,'room_post',correction)).json();assert.equal(threaded.message.reply_to,post.message.id);assert.equal(threaded.message.sender_session_id,b.session.id);assert.equal((await (await mcp(b.token,'room_post',correction)).json()).message.id,threaded.message.id);
  const foreign=await (await api(`/api/rooms/${otherRoom.id}/messages`,{body:'private other-room original',kind:'post'})).json();assert.equal((await mcp(a.token,'room_post',{body:'must fail',replyTo:foreign.message.id,requestKey:'foreign-link'})).status,400);
  assert.equal(otherInbox.roomId,otherRoom.id);assert.equal(otherInbox.ownIdentity.sessionId,b.session.id);assert.equal(otherInbox.ownIdentity.alias,offered.ownIdentity.alias);assert.notEqual(otherInbox.ownIdentity.membershipId,offered.ownIdentity.membershipId);
  const replyEvidence={title:'회신 원문',body:'회신 근거'};const reply=await (await mcp(b.token,'room_reply',{requestId:request.deliveries[0].request_id,body:'반대',evidence:replyEvidence})).json();assert.equal(reply.message.attachments.length,1);assert.equal((await (await mcp(a.token,'room_read_attachment',{attachmentId:reply.message.attachments[0].id})).json()).text,replyEvidence.body);
  assert.equal((await mcp(a.token,'room_post',{body:'invalid evidence',evidence:false})).status,400);
  const configPath=join(dir,'private.json'),evidencePath=join(dir,'source.md'),helperBody='helper 원문\n\n한글과 🐬 범위를 보존한다.';
  await writeFile(configPath,JSON.stringify({url:base,token:a.token}));await writeFile(evidencePath,helperBody);
  const helper=spawn(process.execPath,['packages/mcp/participant.js','--config',configPath,'--evidence-file',evidencePath,'--evidence-title','helper 근거','post','helper 핵심 의견'],{windowsHide:true,stdio:['ignore','pipe','pipe']});
  const submitted=await new Promise((resolve,reject)=>{let out='';helper.on('error',reject);helper.stdout.on('data',x=>out+=x);helper.on('close',code=>{if(code!==0)return reject(Error('evidence helper failed'));resolve(JSON.parse(out));});});
  assert.equal(submitted.message.body,'helper 핵심 의견');assert.equal(submitted.message.attachments.length,1);
  assert.equal((await (await mcp(b.token,'room_read_attachment',{attachmentId:submitted.message.attachments[0].id})).json()).text,helperBody);
  const imageBytes=await readFile('apps/desktop/assets/providers/codex.png'),image=await (await mcp(a.token,'room_upload_attachment',{filename:'shared-image.png',mime:'image/png',base64:imageBytes.toString('base64'),requestKey:'image'})).json();
  assert.equal(image.mime,'image/png');assert.equal((await mcp(b.token,'room_read_attachment',{attachmentId:image.id})).status,400);
  await mcp(a.token,'room_post',{body:'이미지 공유',attachmentIds:[image.id],requestKey:'share-image'});
  const received=await (await mcp(b.token,'room_read_attachment',{attachmentId:image.id})).json();assert.equal(received.mime,'image/png');assert.deepEqual(Buffer.from(received.base64,'base64'),imageBytes);
  const reshared=await (await mcp(b.token,'room_post',{body:'이미지 재공유',attachmentIds:[image.id],requestKey:'reshare-image'})).json();assert.equal(reshared.message.attachments[0].id,image.id);
  assert.deepEqual(Buffer.from((await (await mcp(a.token,'room_read_attachment',{attachmentId:image.id})).json()).base64,'base64'),imageBytes);

 }finally{child.kill();}
});

test('HTTP JSON-review fallback merges top-level and body evidence without orphaning failed retries',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'participant-evidence-review-http-')),dbPath=join(dir,'state.sqlite'),seed=await seededReview(dbPath),reserve=createServer();await new Promise(resolve=>reserve.listen(0,'127.0.0.1',resolve));const port=reserve.address().port;await new Promise(resolve=>reserve.close(resolve));
 const child=spawn(process.execPath,['services/coordinator/server.js'],{env:{...process.env,PORT:String(port),ROOMS_DB:dbPath,ROOMS_KNOWLEDGE_ROOT:join(dir,'knowledge')},windowsHide:true,stdio:['ignore','pipe','pipe']});let attachments;
 try{
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('server startup timeout')),10000);child.stdout.on('data',x=>{if(String(x).includes('listening')){clearTimeout(timer);resolve();}});child.once('error',reject);});
  const base=`http://127.0.0.1:${port}`,mcp=(action,input)=>fetch(base+`/mcp/${action}`,{method:'POST',headers:{Authorization:`Bearer ${seed.token}`,'Content-Type':'application/json'},body:JSON.stringify(input)}),evidence={title:'fallback evidence',body:'full review evidence'};
  const first=await mcp('room_reply',{requestId:seed.review.requestId,body:JSON.stringify(seed.review),evidence});assert.equal(first.status,201);const saved=await first.json();assert.equal(saved.attachments.length,1);
  const fromBody=await mcp('room_reply',{requestId:seed.review.requestId,body:JSON.stringify({...seed.review,evidence})});assert.equal(fromBody.status,201);assert.equal((await fromBody.json()).id,saved.id);
  const equal=await mcp('room_reply',{requestId:seed.review.requestId,body:JSON.stringify({...seed.review,evidence}),evidence});assert.equal(equal.status,201);
  const conflict=await mcp('room_reply',{requestId:seed.review.requestId,body:JSON.stringify({...seed.review,evidence}),evidence:{...evidence,body:'different'}});assert.equal(conflict.status,400);
  const invalid=await mcp('room_reply',{requestId:seed.review.requestId,body:JSON.stringify({...seed.review,evidence:{title:'x'.repeat(121),body:'invalid'}})});assert.equal(invalid.status,400);
 }finally{child.kill();await new Promise(resolve=>child.once('close',resolve));const audit=new Store(dbPath);attachments=audit.db.prepare('SELECT count(*) n FROM attachments').get().n;audit.db.close();}
 assert.equal(attachments,1);
});
