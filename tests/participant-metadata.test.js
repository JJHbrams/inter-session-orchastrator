import assert from 'node:assert/strict';
import test from 'node:test';
import {Store} from '../services/coordinator/store.js';
import {ParticipantSettings} from '../services/coordinator/participant-settings.js';

const native=s=>s.registerSession({provider:'codex',host:'orca/local',nativeId:'native',cwd:'C:/work',profile:'default',mode:'live_attach',ownership:'borrowed',verified:true,handle:'actor',incarnation:'runtime:3',capabilities:{transport:'orca-native-chat',nativeChat:{runtimeId:'runtime'}}});
test('native metadata observation keeps partial unknown values and never writes stale identity',async()=>{
 const s=new Store(),registered=native(s),room=s.createRoom('r');s.join(room.id,registered.session.id,true);
 let calls=0;const settings=new ParticipantSettings(s,{adapter:{async readMetadata(binding){calls++;return {ok:true,binding,metadata:{model:'gpt-5.6-terra',effort:null,reasonCode:'effort_not_reported',source:'official'}};}}});
 const saved=await settings.observe(registered.session.id);assert.equal(saved.saved,true);assert.equal(calls,1);
 const observed=s.room(room.id).members[0].modelSettings.observed;assert.equal(observed.model,'gpt-5.6-terra');assert.equal(observed.effort,null);assert.equal(observed.reasonCode,'effort_not_reported');
 s.db.prepare("UPDATE bindings SET incarnation='runtime:4' WHERE id=?").run(registered.binding.id);
 assert.equal(s.recordParticipantMetadata(registered.session.id,registered.binding,{model:'wrong',effort:'high'}).saved,false);
 assert.equal(s.room(room.id).members[0].modelSettings.observed,null);
});
