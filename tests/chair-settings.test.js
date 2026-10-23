import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../services/coordinator/store.js';
import { getChairOptions } from '../adapters/chair/options.js';

test('legacy-compatible chair defaults to Claude and snapshots settings on claim',()=>{
 const store=new Store(),room=store.createRoom('settings');
 const chair=store.beginChair(room.id,'native-id');
 assert.equal(chair.provider,'claude');assert.equal(chair.model,null);assert.equal(chair.effort,null);
 const updated=store.updateChairSettings(room.id,{model:'sonnet',effort:'high'},getChairOptions());
 assert.equal(updated.settings_revision,2);
 const run=store.chairRun(room.id,'request');
 const snapshot=store.claimChairRun(run.id,null);
 assert.deepEqual({provider:snapshot.provider,model:snapshot.model,effort:snapshot.effort,revision:snapshot.settings_revision},{provider:'claude',model:'sonnet',effort:'high',revision:2});
 const next=store.updateChairSettings(room.id,{model:'opus',effort:'max'},getChairOptions());
 assert.equal(next.settings_revision,3);assert.equal(store.db.prepare('SELECT model,effort,settings_revision FROM chair_runs WHERE id=?').get(run.id).model,'sonnet');
 store.db.close();
});

test('provider is immutable after chair creation',()=>{
 const store=new Store(),room=store.createRoom('immutable');store.beginChair(room.id,'native-id');
 assert.throws(()=>store.updateChairSettings(room.id,{provider:'codex'},getChairOptions()),error=>error.code==='PROVIDER_IMMUTABLE');
 store.db.close();
});

test('creation accepts Codex as the selected provider',()=>{
 const store=new Store(),room=store.createRoom('codex');
 const chair=store.beginChair(room.id,'native-id',{provider:'codex'});
 assert.equal(chair.provider,'codex');store.db.close();
});
