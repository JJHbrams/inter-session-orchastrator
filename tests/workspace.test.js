import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,symlinkSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../services/coordinator/store.js';
import {validateWorkspace,workspaceInfo,exportWorkspace} from '../services/coordinator/workspace.js';

test('room workspace persists and exports only its own consensus, source messages and material bytes',()=>{
 const cwd=mkdtempSync(join(tmpdir(),'rooms-workspace-')),db=join(cwd,'room.sqlite');let s=new Store(db);const r=s.createRoom('설계',null,validateWorkspace(cwd));
 const a=s.uploadAttachment(r.id,{filename:'자료.txt',base64:Buffer.from('공유 자료').toString('base64'),requestKey:'file'});
 const msg=s.post({roomId:r.id,body:'합의 근거',attachmentIds:[a.id]});
 const p=s.registerSession({provider:'claude',host:'test',nativeId:'chair',cwd,profile:'test',mode:'new',ownership:'owned',verified:true,capabilities:{followup:true}});s.join(r.id,p.session.id,false);s.role(r.id,p.session.id,'chair');
 const decision=s.resultForChair(r.id,p.session.id,'결정',[msg.message.id]);s.confirmDecision(r.id,decision.id);
 const first=exportWorkspace(s,r.id);assert.equal(first.cwd,cwd);assert.match(readFileSync(join(first.artifactDir,'consensus.md'),'utf8'),/사용자 확정/);assert.match(readFileSync(join(first.artifactDir,'transcript.md'),'utf8'),/합의 근거/);
 const manifest=JSON.parse(readFileSync(join(first.artifactDir,'manifest.json'),'utf8'));assert.equal(readFileSync(join(first.artifactDir,manifest.materials[0].file),'utf8'),'공유 자료');assert.deepEqual(manifest.decisions[0].sourceIds,[msg.message.id]);
 writeFileSync(join(cwd,'unrelated.txt'),'preserved');s.db.close();s=new Store(db);assert.equal(s.room(r.id).cwd,cwd);exportWorkspace(s,r.id);assert.equal(readFileSync(join(cwd,'unrelated.txt'),'utf8'),'preserved');assert.equal(workspaceInfo(s,r.id).files.length,4);s.db.close();
});
test('workspace rejects relative paths and refuses preexisting unowned export directories',()=>{
 assert.throws(()=>validateWorkspace('relative'),/절대 경로/);const cwd=mkdtempSync(join(tmpdir(),'rooms-workspace-')),s=new Store(),r=s.createRoom('protected',null,cwd);mkdirSync(join(cwd,'.session-rooms'));mkdirSync(join(cwd,'.session-rooms',r.id));writeFileSync(join(cwd,'.session-rooms',r.id,'consensus.md'),'do not overwrite');assert.throws(()=>exportWorkspace(s,r.id),/기존 파일/);assert.equal(readFileSync(join(cwd,'.session-rooms',r.id,'consensus.md'),'utf8'),'do not overwrite');s.db.close();
});
test('request-specific inbox reoffers only its exact automatic fence, not another room or generic consumer',()=>{
 const s=new Store(),r=s.createRoom('automatic'),other=s.createRoom('other'),p=s.registerSession({provider:'codex',host:'orca',nativeId:'native',cwd:'C:/work',profile:'default',mode:'live_attach',verified:true,handle:'term',incarnation:'inc',capabilities:{followup:true,automaticInput:true}}),m=s.join(r.id,p.session.id,false);s.join(other.id,p.session.id,false);s.provision(r.id,p.session.id,'private');const reg=s.registration('private');
 const post=s.post({roomId:r.id,body:'work',kind:'followup',targets:[m.id]}),d=post.deliveries[0],claimed=s.claim(d.id),attempt=s.fence(d.id,claimed.fence);s.db.prepare("UPDATE attempts SET state='automatic' WHERE id=?").run(attempt.id);
 assert.equal(s.inbox(reg).inbox.length,0);assert.equal(s.inbox(reg,'wrong').inbox.length,0);assert.equal(s.inbox(reg,d.request_id).inbox[0].attempt_id,attempt.id);assert.equal(s.inbox(reg,d.request_id).inbox[0].request_id,d.request_id);
 s.reply(reg,d.request_id,'answer');assert.equal(s.room(r.id).deliveries[0].state,'completed');assert.equal(s.inbox(reg,d.request_id).inbox.length,0);s.db.close();
});

test('inviting a registered session read-only in another room preserves its existing automatic binding',()=>{
 const s=new Store(),identity={provider:'codex',host:'orca/local',nativeId:'same-id',cwd:'C:/work',profile:'default'},a=s.registerSession({...identity,mode:'live_attach',verified:true,handle:'exact',incarnation:'inc',capabilities:{followup:true,automaticInput:true}}),first=s.createRoom('first'),second=s.createRoom('second');s.join(first.id,a.session.id,false);
 const b=s.registerSession({...identity,mode:'read_only',verified:false,capabilities:{}});s.join(second.id,b.session.id,true);assert.equal(b.session.id,a.session.id);assert.equal(b.binding.id,a.binding.id);assert.equal(JSON.parse(s.room(first.id).members[0].capabilities).automaticInput,true);assert.equal(s.room(second.id).members[0].read_only,1);s.db.close();
});
