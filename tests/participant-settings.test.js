import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Store} from '../services/coordinator/store.js';
import {ParticipantSettings} from '../services/coordinator/participant-settings.js';
const register=s=>s.registerSession({provider:'codex',host:'test',nativeId:'native',cwd:'C:/test',profile:'default',mode:'live_attach',ownership:'borrowed',verified:true,handle:'terminal',incarnation:'inc1',capabilities:{followup:true}}).session;
const fake=()=>({preflight:async()=>({ok:true}),inspect:async()=>({model:'test',modelLabel:'Test',effort:'medium',models:[{id:'test',label:'Test'}],efforts:['medium','high']}),apply:async(b,s,input)=>({...input,models:[],efforts:[]}),reconcile:async()=>({model:'test',effort:'high'})});
test('observed participant settings are session-wide and stale bindings never inherit confirmation',async()=>{
 const s=new Store(),a=s.createRoom('a'),b=s.createRoom('b'),p=register(s);s.join(a.id,p.id,false);s.join(b.id,p.id,false);const settings=new ParticipantSettings(s,{adapter:fake()});await settings.run(a.id,p.id,'inspect');assert.equal(s.room(b.id).members[0].modelSettings.observed.model,'test');
 await settings.run(b.id,p.id,'apply',{model:'test',effort:'high'});assert.equal(s.room(a.id).members[0].modelSettings.observed.effort,'high');s.db.prepare("UPDATE bindings SET incarnation='inc2' WHERE session_id=?").run(p.id);assert.equal(s.room(a.id).members[0].modelSettings.observed,null);
});
test('native setting work and delivery claims exclude one another across rooms',async()=>{
 const s=new Store(),a=s.createRoom('a'),b=s.createRoom('b'),p=register(s),m=s.join(a.id,p.id,false),other=s.join(b.id,p.id,false);let finish,entered;
 const ready=new Promise(r=>entered=r),adapter=fake();adapter.inspect=async()=>{entered();return new Promise(r=>finish=r)};const settings=new ParticipantSettings(s,{adapter});const pending=settings.run(a.id,p.id,'inspect');await ready;
 const d=s.post({roomId:b.id,body:'work',kind:'followup',targets:[other.id]}).deliveries[0];assert.throws(()=>s.claim(d.id),/모델 설정/);await assert.rejects(settings.run(b.id,p.id,'inspect'),/설정/);finish({model:'test',effort:'medium'});await pending;const claim=s.claim(d.id);assert.ok(claim);await assert.rejects(settings.run(a.id,p.id,'inspect'),/이전 요청/);
});
test('draft, read-only, immutable provider and chair checks run before native input',async()=>{
 const s=new Store(),r=s.createRoom('r'),p=register(s);s.join(r.id,p.id,true);let calls=0;const adapter=fake();adapter.inspect=async()=>{calls++;};const settings=new ParticipantSettings(s,{adapter});await assert.rejects(settings.run(r.id,p.id,'inspect'),/쓰기 가능한/);s.db.prepare('UPDATE memberships SET read_only=0').run();await assert.rejects(settings.run(r.id,p.id,'apply',{provider:'claude',model:'x',effort:'high'}),/Provider/);
 adapter.preflight=async()=>({ok:false,reason:'draft exists'});await assert.rejects(settings.run(r.id,p.id,'inspect'),/draft/);assert.equal(s.db.prepare('SELECT count(*) n FROM session_controls').get().n,0);assert.equal(calls,0);s.db.prepare("UPDATE memberships SET role='chair'").run();await assert.rejects(settings.run(r.id,p.id,'inspect'),/좌장/);
});
test('ambiguous settings survive restart, block dispatch and require explicit reconciliation',async()=>{
 const path=join(mkdtempSync(join(tmpdir(),'model-setting-')),'test.sqlite');let s=new Store(path),r=s.createRoom('r'),p=register(s),m=s.join(r.id,p.id,false);const adapter=fake();adapter.inspect=async()=>{throw Error('transport timeout')};let settings=new ParticipantSettings(s,{adapter});await assert.rejects(settings.run(r.id,p.id,'inspect'),{code:'SETTINGS_UNKNOWN'});s.db.close();s=new Store(path);settings=new ParticipantSettings(s,{adapter:fake()});
 assert.equal(s.room(r.id).members[0].modelSettings.control.status,'unknown');await assert.rejects(settings.run(r.id,p.id,'inspect'),/미확인/);const d=s.post({roomId:r.id,body:'work',kind:'followup',targets:[m.id]}).deliveries[0];assert.throws(()=>s.claim(d.id),/모델 설정/);await settings.run(r.id,p.id,'reconcile');assert.ok(s.claim(d.id));s.db.close();
});
test('binding replacement during inspection cannot save a confirmed result',async()=>{
 const s=new Store(),r=s.createRoom('r'),p=register(s);s.join(r.id,p.id,false);const adapter=fake();adapter.inspect=async()=>{s.db.prepare("UPDATE bindings SET incarnation='replacement' WHERE session_id=?").run(p.id);return {model:'test',effort:'medium'};};const settings=new ParticipantSettings(s,{adapter});await assert.rejects(settings.run(r.id,p.id,'inspect'),/연결이 바뀌어/);assert.equal(s.room(r.id).members[0].modelSettings.observed,null);
});
test('recovery after a new incarnation does not close a new user picker or draft',async()=>{
 const s=new Store(),r=s.createRoom('r'),p=register(s);s.join(r.id,p.id,false);const adapter=fake();adapter.inspect=async()=>{throw Error('ambiguous')};const settings=new ParticipantSettings(s,{adapter});await assert.rejects(settings.run(r.id,p.id,'inspect'));s.db.prepare("UPDATE bindings SET incarnation='new-incarnation'").run();let closed=false;adapter.reconcile=async()=>{closed=true;};adapter.preflight=async()=>({ok:false,reason:'new draft'});await assert.rejects(settings.run(r.id,p.id,'reconcile'),/new draft/);assert.equal(closed,false);
});
test('paused discussion still permits idle participant model inspection',async()=>{
 const s=new Store(),r=s.createRoom('r'),p=register(s);s.join(r.id,p.id,false);s.pause(r.id,true);const settings=new ParticipantSettings(s,{adapter:fake()});const result=await settings.run(r.id,p.id,'inspect');assert.equal(result.effort,'medium');assert.ok(s.room(r.id).paused_at);
});
test('settings preflight and native guard receive only completed prompts for the current binding',async()=>{
 const s=new Store(),r=s.createRoom('r'),p=register(s),m=s.join(r.id,p.id,false);
 s.db.exec('CREATE TABLE participant_dispatches(delivery_id TEXT, prompt TEXT, created_at TEXT)');
 const a=s.post({roomId:r.id,body:'a',kind:'followup',targets:[m.id]}).deliveries[0],b=s.post({roomId:r.id,body:'b',kind:'followup',targets:[m.id]}).deliveries[0];
 const binding=s.db.prepare('SELECT id FROM bindings WHERE session_id=?').get(p.id).id;
 s.db.prepare("UPDATE deliveries SET state='completed',binding_id=? WHERE id=?").run(binding,a.id);
 s.db.prepare('INSERT INTO participant_dispatches VALUES(?,?,?)').run(a.id,'completed wake','2026-10-27');s.db.prepare('INSERT INTO participant_dispatches VALUES(?,?,?)').run(b.id,'uncompleted wake','2026-10-27');
 const adapter=fake(),seen=[];adapter.preflight=async(b,m,evidence)=>{seen.push(evidence);return {ok:true}};adapter.withGuard=(guard,evidence)=>{guard();seen.push(evidence);return adapter};
 const settings=new ParticipantSettings(s,{adapter});await settings.run(r.id,p.id,'inspect');assert.deepEqual(seen,[{completedPrompts:['completed wake']},{completedPrompts:['completed wake']}]);
 s.db.prepare("UPDATE bindings SET incarnation='new'").run();assert.deepEqual(settings.completedPrompts({...s.room(r.id).members[0],incarnation:'other'}),[]);
});
