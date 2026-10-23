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
    { status: 0, stdout: JSON.stringify({ provider: 'codex', processIncarnation: 'inc' }) },
    { status: 0, stdout: JSON.stringify({ screen: '› Ask Codex to do anything' }) },
    { status: 0, stdout: JSON.stringify({ provider: 'codex', processIncarnation: 'inc' }) },
    { status: 0, stdout: JSON.stringify({ screen: '› Ask Codex to do anything' }) },
    { status: 0, stdout: JSON.stringify({ provider: 'codex', processIncarnation: 'inc', stage: 'input_accepted' }) }
  ];
  const adapter = createOrcaParticipantAdapter({ run: () => responses.shift() });
  const result = await adapter.send({ handle: 't', incarnation: 'inc' }, { provider: 'codex' }, 'prompt', 'request');
  assert.equal(result.ok, true);
  const busy = createOrcaParticipantAdapter({ run: () => ({ status: 0, stdout: JSON.stringify({ screen: '› Ask Codex to do anything\nhello' }) }) });
  assert.equal((await busy.preflight({ handle: 't', incarnation: 'inc' }, { provider: 'codex' })).ok, false);
});
