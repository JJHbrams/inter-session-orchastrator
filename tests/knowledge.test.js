import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, existsSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Store } from '../services/coordinator/store.js';
import { KnowledgeStore } from '../services/coordinator/knowledge.js';

const participant = (store, room, readOnly = false) => {
  const { session } = store.registerSession({ provider: 'codex', host: 'local', nativeId: `${room.id}-${Math.random()}`, cwd: 'C:/knowledge', profile: 'default', mode: readOnly ? 'read_only' : 'live_attach', ownership: 'borrowed', verified: !readOnly, capabilities: {} });
  const membership = store.join(room.id, session.id, readOnly); return { room_id: room.id, session_id: session.id, membership_id: membership.id, read_only: readOnly ? 1 : 0 };
};
test('knowledge settings default does not create D drive and custom root survives reopen', () => {
  const db = join(mkdtempSync(join(tmpdir(), 'knowledge-db-')), 'state.sqlite'); const root = mkdtempSync(join(tmpdir(), 'knowledge-root-'));
  let store = new Store(db), knowledge = new KnowledgeStore(store); assert.equal(knowledge.getSettings().storageRoot, 'D:\\inter_session_debate');
  knowledge.setSettings({ storageRoot: root }); store.db.close(); store = new Store(db); knowledge = new KnowledgeStore(store); assert.equal(knowledge.getSettings().storageRoot, root); store.db.close();
});
test('versions, search, source boundary, and same-channel publication visibility', () => {
  const store = new Store(); const channel = store.createChannel('c'), one = store.createRoom('one', channel.id), two = store.createRoom('two', channel.id), foreign = store.createRoom('foreign');
  const knowledge = new KnowledgeStore(store, { defaultRoot: mkdtempSync(join(tmpdir(), 'knowledge-root-')) }); const a = participant(store, one), b = participant(store, two);
  const source = knowledge.add(one.id, { kind: 'source', title: 'alpha', body: 'original evidence', clientKey: 'source' }, a);
  assert.throws(() => knowledge.read(two.id, source.id, null, b), /outside visible/);
  const published = knowledge.publish(one.id, source.id); assert.equal(knowledge.read(two.id, source.id, null, b).revision, published.revision);
  assert.throws(() => knowledge.read(two.id, source.id, 1, b), /historical private/);
  const revised = knowledge.update(one.id, source.id, { body: 'revised evidence' }); assert.equal(knowledge.read(one.id, source.id, 1).body, 'original evidence');
  assert.equal(knowledge.list(two.id, { query: 'revised' }, b).items[0].id, source.id);
  assert.throws(() => knowledge.add(foreign.id, { kind: 'argument', title: 'bad', body: 'bad', links: [source.id] }), /outside visible/);
  store.db.close();
});
test('stable content hashes, idempotency, exports, and old roots are retained', () => {
  const store = new Store(), room = store.createRoom('r'), rootOne = mkdtempSync(join(tmpdir(), 'knowledge-one-')), rootTwo = mkdtempSync(join(tmpdir(), 'knowledge-two-'));
  const knowledge = new KnowledgeStore(store, { defaultRoot: rootOne }); const added = knowledge.add(room.id, { kind: 'consensus', title: 'Decision', body: 'bytes remain', clientKey: 'once' });
  assert.equal(knowledge.add(room.id, { kind: 'consensus', title: 'Decision', body: 'bytes remain', clientKey: 'once' }).hash, added.hash);
  const first = knowledge.export(room.id); const material = first.files.find(x => x.startsWith('materials/')); const bytes = readFileSync(join(first.directory, material));
  knowledge.setSettings({ storageRoot: rootTwo }); assert.ok(existsSync(join(first.directory, material))); assert.deepEqual(readFileSync(join(first.directory, material)), bytes);
  assert.throws(() => knowledge.setSettings({ storageRoot: '/' }), /filesystem root/); store.db.close();
});
test('registered sessions cannot forge consensus or publication, while local published URL sources are shared', () => {
  const store = new Store(), channel = store.createChannel('c'), one = store.createRoom('one', channel.id), two = store.createRoom('two', channel.id);
  const knowledge = new KnowledgeStore(store, { defaultRoot: mkdtempSync(join(tmpdir(), 'knowledge-root-')) }), agent = participant(store, one), viewer = participant(store, two), readOnly = participant(store, one, true);
  assert.throws(() => knowledge.add(one.id, { kind: 'consensus', title: 'forged', body: 'no' }, agent), /only add/);
  const draft = knowledge.add(one.id, { kind: 'source', title: 'allowed', body: 'draft' }, agent);
  assert.throws(() => knowledge.publish(one.id, draft.id, agent), /may not publish/);
  assert.throws(() => knowledge.add(one.id, { kind: 'source', title: 'readonly', body: 'no' }, readOnly), /read-only/);
  const shared = knowledge.add(one.id, { kind: 'source', title: 'URL', body: 'source', url: 'https://example.test/evidence', published: true, requestKey: 'url-one' });
  assert.deepEqual(shared.citations, [{ url: 'https://example.test/evidence' }]);
  assert.equal(knowledge.read(two.id, shared.id, null, viewer).scope, 'channel'); store.db.close();
});
test('export preserves original attachment bytes and rejects unowned or unsafe paths without changing settings', () => {
  const store = new Store(), room = store.createRoom('r'), root = mkdtempSync(join(tmpdir(), 'knowledge-export-'));
  const knowledge = new KnowledgeStore(store, { defaultRoot: root }), bytes = Buffer.from([0, 255, 2, 3]);
  const attachment = store.uploadAttachment(room.id, { filename: 'original.bin', mime: 'application/octet-stream', base64: bytes.toString('base64'), requestKey: 'attachment' });
  store.post({ roomId: room.id, body: 'attached', attachmentIds: [attachment.id] });
  const out = knowledge.export(room.id), attachmentFile = out.files.find(file => file.startsWith('attachments/'));
  assert.deepEqual(readFileSync(join(out.directory, attachmentFile)), bytes);
  const badRoot = mkdtempSync(join(tmpdir(), 'knowledge-unowned-')), roomDir = join(badRoot, 'rooms', room.id); mkdirSync(roomDir, { recursive: true }); writeFileSync(join(roomDir, 'index.md'), 'do not overwrite');
  assert.throws(() => knowledge.setSettings({ storageRoot: badRoot }), /not owned/); assert.equal(knowledge.getSettings().storageRoot, root);
  const linkRoot = mkdtempSync(join(tmpdir(), 'knowledge-link-')); try { symlinkSync(root, join(linkRoot, 'rooms'), 'junction'); assert.throws(() => knowledge.setSettings({ storageRoot: linkRoot }), /unsafe/); } catch (error) { if (!/unsafe/.test(error.message)) assert.match(error.code || '', /EPERM|EACCES/); }
  store.db.close();
});
