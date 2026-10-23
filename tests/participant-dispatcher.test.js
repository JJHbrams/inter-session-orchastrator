import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../services/coordinator/store.js';
import { ParticipantDispatcher } from '../services/coordinator/participant-dispatcher.js';
import { createOrcaParticipantAdapter } from '../adapters/orca/index.js';

function setup({ automaticInput = true, readOnly = false } = {}) {
  const store = new Store(), room = store.createRoom('room');
  const registered = store.registerSession({ provider: 'codex', host: 'test', nativeId: 'native', cwd: 'C:/room', profile: 'default', mode: 'live_attach', verified: true, handle: 'terminal-1', incarnation: 'inc-1', capabilities: { followup: true, automaticInput } });
  const member = store.join(room.id, registered.session.id, readOnly);
  const delivery = store.post({ roomId: room.id, body: 'question', kind: 'followup', targets: [member.id] }).deliveries[0];
  return { store, room, member, delivery };
}
function fakeAdapter({ ready = true, stage = 'input_accepted' } = {}) {
  const calls = [];
  return { calls,
    async preflight() { return ready ? { ok: true } : { ok: false, reason: 'composer has a draft' }; },
    async send(binding, session, prompt, requestId, options = {}) { calls.push({ prompt, requestId, options }); return { ok: true, stage, receipt: { provider: session.provider, processIncarnation: binding.incarnation, stage } }; }
  };
}
function dispatcher(store, adapter) { const dir = mkdtempSync(join(tmpdir(), 'participant-dispatch-')); return { dir, value: new ParticipantDispatcher(store, { adapter, privateDir: dir, baseUrl: 'http://test' }) }; }

test('automatic tick claims once and durable request prevents duplicate send', async () => {
  const { store, delivery } = setup(), adapter = fakeAdapter(), { dir, value } = dispatcher(store, adapter);
  try {
    assert.equal((await value.tick())[0].state, 'accepted');
    assert.equal((await value.tick()).length, 0);
    assert.equal(adapter.calls.length, 1);
    const row = store.db.prepare('SELECT * FROM participant_dispatches WHERE delivery_id=?').get(delivery.id);
    assert.equal(row.status, 'accepted'); assert.ok(row.host_request_id); assert.match(row.prompt, /--request-id/);
    assert.equal(store.db.prepare('SELECT state FROM attempts WHERE id=?').get(row.attempt_id).state, 'automatic');
  } finally { store.db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('draft or busy terminal is rejected before an attempt exists', async () => {
  const { store } = setup(), { dir, value } = dispatcher(store, fakeAdapter({ ready: false }));
  try { assert.equal((await value.tick())[0].state, 'skipped'); assert.equal(store.db.prepare('SELECT count(*) n FROM attempts').get().n, 0); }
  finally { store.db.close(); rmSync(dir, { recursive: true, force: true }); }
});

test('a blocked preflight sends nothing, remains queued, and succeeds on a later tick',async()=>{
 const {store,delivery}=setup();let ready=false;const calls=[];
 const adapter={async preflight(){return ready?{ok:true}:{ok:false,reasonCode:'draft_exists',reason:'Orca가 입력란의 문구를 감지해 전달을 보류했어요. 현재 연동은 실제 초안과 추천 문구를 구분하지 못해요.'};},async send(){calls.push('send');return {ok:true,stage:'turn_started',receipt:{}};}};
 const {dir,value}=dispatcher(store,adapter);
 try{assert.equal((await value.tick())[0].state,'skipped');assert.equal(calls.length,0);assert.equal(store.db.prepare('SELECT state,blocked_reason FROM deliveries WHERE id=?').get(delivery.id).state,'queued');assert.match(store.db.prepare('SELECT blocked_reason FROM deliveries WHERE id=?').get(delivery.id).blocked_reason,/초안/);ready=true;assert.equal((await value.tick())[0].state,'running');assert.equal(calls.length,1);}
 finally{store.db.close();rmSync(dir,{recursive:true,force:true});}
});

test('confirmed empty composer retries the original request once and binds the exact snapshot',async()=>{
 const {store,room,delivery}=setup(),calls=[];let fingerprint='one';
 const adapter={async preflight(_binding,_session,{confirmedComposer}={}){if(confirmedComposer?.fingerprint===fingerprint)return {ok:true};return {ok:false,reasonCode:'draft_exists',reason:'draft',confirmedComposer:{fingerprint,phrasePreview:'suggestion'}};},async send(_binding,_session,_prompt,requestId,options){calls.push({requestId,options});return {ok:true,stage:'turn_started',receipt:{}};}};
 const {dir,value}=dispatcher(store,adapter);
 try{
   const challenge=await value.retry(room.id,delivery.id);assert.equal(challenge.composerConfirmation.phrasePreview,'suggestion');assert.equal(calls.length,0);
   const sent=await value.retry(room.id,delivery.id,{composerConfirmation:challenge.composerConfirmation.nonce});assert.equal(sent.state,'running');assert.equal(calls.length,1);assert.equal(calls[0].requestId,delivery.request_id);assert.equal(calls[0].options.confirmedComposer.fingerprint,'one');
 }finally{store.db.close();rmSync(dir,{recursive:true,force:true});}
});

test('confirmed retry waits for an automatic tick to release its in-flight delivery',async()=>{
 const {store,room,delivery}=setup(),calls=[];let normal=0,release,entered;const gate=new Promise(resolve=>release=resolve),started=new Promise(resolve=>entered=resolve);
 const adapter={async preflight(_binding,_session,{confirmedComposer}={}){if(confirmedComposer?.fingerprint==='one')return {ok:true};normal++;if(normal===2){entered();await gate;}return {ok:false,reasonCode:'draft_exists',reason:'draft',confirmedComposer:{fingerprint:'one',phrasePreview:'draft'}};},async send(){calls.push('send');return {ok:true,stage:'turn_started',receipt:{}};}};
 const {dir,value}=dispatcher(store,adapter);
 try{
   const challenge=await value.retry(room.id,delivery.id),tick=value.tick();await started;
   const confirmed=value.retry(room.id,delivery.id,{composerConfirmation:challenge.composerConfirmation.nonce});let settled=false;confirmed.then(()=>settled=true);await Promise.resolve();assert.equal(settled,false);assert.equal(calls.length,0);
   release();await tick;const result=await confirmed;assert.equal(result.state,'running');assert.equal(calls.length,1);
 }finally{store.db.close();rmSync(dir,{recursive:true,force:true});}
});

test('composer confirmation expires, cannot be reused or moved, and automatic ticks never consume it',async()=>{
 const {store,room,delivery}=setup(),calls=[];
 const adapter={async preflight(_binding,_session,{confirmedComposer}={}){return confirmedComposer?.fingerprint==='one'?{ok:true}:{ok:false,reasonCode:'draft_exists',reason:'draft',confirmedComposer:{fingerprint:'one',phrasePreview:'draft'}};},async send(){calls.push('send');return {ok:true,stage:'turn_started',receipt:{}};}};
 const {dir,value}=dispatcher(store,adapter);
 try{
   const first=await value.retry(room.id,delivery.id);assert.equal((await value.tick())[0].state,'skipped');assert.equal(calls.length,0);
   await assert.rejects(()=>value.retry(room.id,'wrong',{composerConfirmation:first.composerConfirmation.nonce}),/delivery not found/);assert.equal(calls.length,0);
   const second=await value.retry(room.id,delivery.id);value.composerConfirmations.get(second.composerConfirmation.nonce).expiresAt=Date.now()-1;
   await assert.rejects(()=>value.retry(room.id,delivery.id,{composerConfirmation:second.composerConfirmation.nonce}),/만료/);assert.equal(calls.length,0);
   const third=await value.retry(room.id,delivery.id);await value.retry(room.id,delivery.id,{composerConfirmation:third.composerConfirmation.nonce});await assert.rejects(()=>value.retry(room.id,delivery.id,{composerConfirmation:third.composerConfirmation.nonce}),/만료/);assert.equal(calls.length,1);
 }finally{store.db.close();rmSync(dir,{recursive:true,force:true});}
});

test('changed draft snapshot blocks confirmed composer before it can send',async()=>{
 const {store,room,delivery}=setup(),calls=[];let fingerprint='first';
 const adapter={async preflight(_binding,_session,{confirmedComposer}={}){return confirmedComposer?.fingerprint===fingerprint?{ok:true}:{ok:false,reasonCode:'draft_exists',reason:'draft',confirmedComposer:{fingerprint,phrasePreview:'draft'}};},async send(){calls.push('send');return {ok:true,stage:'turn_started',receipt:{}};}};
 const {dir,value}=dispatcher(store,adapter);
 try{const first=await value.retry(room.id,delivery.id);fingerprint='changed';const result=await value.retry(room.id,delivery.id,{composerConfirmation:first.composerConfirmation.nonce});assert.equal(result.state,'skipped');assert.equal(calls.length,0);}
 finally{store.db.close();rmSync(dir,{recursive:true,force:true});}
});

test('restart recovery observes the persisted request and accepts a later authenticated reply', async () => {
  const { store, room, delivery } = setup(), first = fakeAdapter(), one = dispatcher(store, first);
  try {
    await one.value.tick(); store.recover();
    const second = fakeAdapter({ stage: 'turn_started' }), two = new ParticipantDispatcher(store, { adapter: second, privateDir: one.dir, baseUrl: 'http://test' });
    const retried = await two.retry(room.id, delivery.id);
    assert.equal(retried.state, 'running'); assert.equal(second.calls[0].options.observeOnly, true);
    const tokenHash = store.db.prepare('SELECT token_hash FROM registrations WHERE room_id=?').get(room.id).token_hash;
    const registration = store.registration(tokenHash);
    store.reply(registration, delivery.request_id, 'answer');
    assert.equal((await two.retry(room.id, delivery.id)).state, 'completed');
  } finally { store.db.close(); rmSync(one.dir, { recursive: true, force: true }); }
});

test('accepted idle delivery gets one durable recovery nudge and repeated retry observes it', async () => {
  const { store, room, delivery } = setup(), adapter = fakeAdapter(), one = dispatcher(store, adapter);
  try {
    await one.value.tick();
    const first = await one.value.retry(room.id, delivery.id);
    assert.equal(first.state, 'accepted');
    const recovery = store.db.prepare('SELECT * FROM participant_recoveries WHERE delivery_id=?').get(delivery.id);
    assert.ok(recovery); assert.equal(adapter.calls.filter(call => !call.options.observeOnly).length, 2);
    await one.value.retry(room.id, delivery.id);
    assert.equal(store.db.prepare('SELECT count(*) n FROM participant_recoveries WHERE delivery_id=?').get(delivery.id).n, 1);
    assert.equal(adapter.calls.filter(call => call.requestId === recovery.host_request_id && !call.options.observeOnly).length, 1);
  } finally { store.db.close(); rmSync(one.dir, { recursive: true, force: true }); }
});

test('paused, archived, readonly, and opted-out members never create automatic attempts', async () => {
  for (const state of ['paused', 'archived', 'readonly', 'opted-out']) {
    const options = state === 'readonly' ? { readOnly: true } : state === 'opted-out' ? { automaticInput: false } : {};
    const { store, room } = setup(options), { dir, value } = dispatcher(store, fakeAdapter());
    try {
      if (state === 'paused') store.pause(room.id); if (state === 'archived') store.archiveRoom(room.id);
      assert.equal((await value.tick()).length, 0, state);
      assert.equal(store.db.prepare('SELECT count(*) n FROM attempts').get().n, 0, state);
    } finally { store.db.close(); rmSync(dir, { recursive: true, force: true }); }
  }
});

test('Orca adapter accepts only exact empty composer and correlated receipt', async () => {
  const responses = [
    { ok: true, result: { terminal: { handle: 't', incarnationId: 'inc', agentIdentity: 'codex', connected: true, writable: true, orphaned: false } } },
    { ok: true, result: {wait:{satisfied:true}} }, { ok: true, result: { terminal: { source: 'screen', tail: ['history', '› Ask Codex to do anything'] } } },
    { ok: true, result: { terminal: { handle: 't', incarnationId: 'inc', agentIdentity: 'codex', connected: true, writable: true, orphaned: false } } },
    { ok: true, result: {wait:{satisfied:true}} }, { ok: true, result: { terminal: { source: 'screen', tail: ['› Ask Codex to do anything'] } } },
    { ok: true, result: { send: { handle: 't', accepted: true, prompt: { requestId: 'request', provider: 'codex', processIncarnation: 'inc', stages: ['input_accepted'] } } } }
  ];
  const seen = [], adapter = createOrcaParticipantAdapter({ bin: 'orca-test', run: async (_bin, args) => { seen.push(args); return { status: 0, stdout: JSON.stringify(responses.shift()) }; } });
  const result = await adapter.send({ handle: 't', incarnation: 'inc' }, { provider: 'codex' }, 'prompt', 'request');
  assert.equal(result.ok, true);
  assert.deepEqual(seen.at(-1).slice(0, 3), ['terminal', 'send', '--terminal']);
  const busy = createOrcaParticipantAdapter({ bin: 'orca-test', run: async () => ({ status: 0, stdout: JSON.stringify({ ok: true, result: { terminal: { handle: 't', incarnationId: 'inc', agentIdentity: 'codex', connected: true, writable: true, orphaned: false } } }) }) });
  assert.equal((await busy.preflight({ handle: 't', incarnation: 'inc' }, { provider: 'codex' })).ok, false);
  const failed = createOrcaParticipantAdapter({ bin: 'orca-test', run: async () => ({ status: 1, stdout: JSON.stringify({ error: { code: 'denied', message: 'structured failure' } }) }) });
  await assert.rejects(() => failed.preflight({ handle: 't', incarnation: 'inc' }, { provider: 'codex' }), /structured failure/);
});

test('real provider footers are accepted while an active turn or hidden draft is never sent to',async()=>{
 for(const provider of ['codex','claude']){
  const tail=provider==='codex'?['history','› Ask Codex to do anything','GPT-6.1-Sol medium · C:/work','? for shortcuts']:['history','──────── 토론장 ─','❯','────────────────','⏵⏵ bypass permissions on (shift+tab to cycle)'];
  for(const condition of ['empty','draft','working','idle-unknown']){
   const run=async(bin,args)=>({status:0,stdout:JSON.stringify({ok:true,result:args[1]==='show'?{terminal:{handle:'t',incarnationId:'inc',agentIdentity:provider,connected:true,writable:true}}:args[1]==='wait'?{wait:{satisfied:condition!=='idle-unknown'}}:{terminal:{source:'screen',tail:condition==='working'?['• Working (18s • esc to interrupt)',...tail.slice(1)]:tail,...condition==='draft'?{draft:'작성 중인 원문'}:{}}}})});
   const result=await createOrcaParticipantAdapter({bin:'fixture',run}).preflight({handle:'t',incarnation:'inc'},{provider});assert.equal(result.ok,condition==='empty',provider+':'+condition);
   if(condition==='draft')assert.equal(result.reasonCode,'draft_exists');
   if(condition==='idle-unknown')assert.equal(result.reasonCode,'busy_idle_unverified');
  }
 }
});

test('preflight distinguishes identity, screen, and unknown composer without submitting',async()=>{
 const cases=[
  ['identity_changed',args=>args[1]==='show'?{terminal:{handle:'other',incarnationId:'inc',agentIdentity:'claude',connected:true,writable:true}}:null],
  ['screen_unavailable',args=>args[1]==='show'?{terminal:{handle:'t',incarnationId:'inc',agentIdentity:'claude',connected:true,writable:true}}:args[1]==='wait'?{wait:{satisfied:true}}:{terminal:{source:'api',tail:[]}}],
  ['composer_unverified',args=>args[1]==='show'?{terminal:{handle:'t',incarnationId:'inc',agentIdentity:'claude',connected:true,writable:true}}:args[1]==='wait'?{wait:{satisfied:true}}:{terminal:{source:'screen',tail:['history','❯ unknown footer']}}]
 ];
 for(const [code,fixture] of cases){const seen=[];const run=async(_bin,args)=>{seen.push(args);return {status:0,stdout:JSON.stringify({ok:true,result:fixture(args)})}};const adapter=createOrcaParticipantAdapter({bin:'fixture',run}),result=await adapter.send({handle:'t',incarnation:'inc'},{provider:'claude'},'must not send','req');assert.equal(result.reasonCode,code);assert.equal(seen.some(args=>args[1]==='send'),false);}
});

test('a draft appearing after reservation releases only the unsent fence and may be delivered later',async()=>{
 const {store,delivery}=setup(),adapter=fakeAdapter(),{dir,value}=dispatcher(store,adapter);let blocked=true;
 adapter.send=async()=>blocked?{ok:false,reason:'new draft before submit'}:{ok:true,stage:'turn_started',receipt:{}};
 try{assert.equal((await value.tick())[0].state,'queued');assert.equal(store.db.prepare('SELECT unresolved_delivery_id FROM writers').get().unresolved_delivery_id,null);assert.equal(store.db.prepare('SELECT state FROM attempts').get().state,'not_sent');blocked=false;assert.equal((await value.tick())[0].state,'running');assert.equal(store.db.prepare('SELECT count(*) n FROM attempts WHERE delivery_id=?').get(delivery.id).n,2);}
 finally{store.db.close();rmSync(dir,{recursive:true,force:true});}
});

test('reobserving the same durable receipt reconciles restart state without duplicating evidence',async()=>{
 const {store,delivery}=setup(),adapter=fakeAdapter({stage:'turn_started'}),{dir,value}=dispatcher(store,adapter);
 try{await value.tick();const row=store.db.prepare('SELECT * FROM participant_dispatches WHERE delivery_id=?').get(delivery.id);store.recover();assert.equal(store.db.prepare('SELECT state FROM deliveries WHERE id=?').get(delivery.id).state,'unknown');store.evidence(row.attempt_id,'turn_started','orca',row.host_request_id);assert.equal(store.db.prepare('SELECT state FROM deliveries WHERE id=?').get(delivery.id).state,'running');assert.equal(store.db.prepare('SELECT blocked_reason FROM deliveries WHERE id=?').get(delivery.id).blocked_reason,null);assert.equal(store.db.prepare('SELECT count(*) n FROM evidence').get().n,1);}
 finally{store.db.close();rmSync(dir,{recursive:true,force:true});}
});
