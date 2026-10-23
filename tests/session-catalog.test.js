import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listSessions } from '../adapters/catalog/index.js';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'session-catalog-'));
  const dbPath = join(root, 'state.sqlite');
  const db = new DatabaseSync(dbPath);
  db.exec('CREATE TABLE threads (id TEXT, cwd TEXT, title TEXT, preview TEXT, first_user_message TEXT, updated_at_ms INTEGER, updated_at INTEGER)');
  db.prepare('INSERT INTO threads VALUES(?,?,?,?,?,?,?)').run('codex-good', '\\\\?\\C:\\work\\a', 'State title', 'First prompt from Codex', 'fallback', 1_700_000_000_000, 1);
  db.prepare('INSERT INTO threads VALUES(?,?,?,?,?,?,?)').run('codex-other', 'C:/work/b', 'Other', '', 'first user fallback', 1_600_000_000_000, 1);
  db.close();
  const indexPath = join(root, 'session_index.jsonl');
  writeFileSync(indexPath, '{"id":"codex-good","thread_name":"Indexed title","updated_at":"2025-01-02T03:04:05Z"}\nnot json\n');
  const claudeProjectsPath = join(root, 'claude-projects');
  const project = join(claudeProjectsPath, 'sample'); mkdirSync(project, { recursive: true });
  writeFileSync(join(project, 'sessions-index.json'), JSON.stringify({ sessions: [{ sessionId: 'claude-good', cwd: 'C:/work/claude', projectPath: 'C:/work/claude', title: 'Claude indexed', summary: 'Claude first prompt', updatedAt: '2025-01-03T00:00:00Z' }, { broken: true }] }));
  const unindexed = join(claudeProjectsPath, 'unindexed'); mkdirSync(unindexed, { recursive: true });
  writeFileSync(join(unindexed, '1f1f1f1f-1111-4111-8111-111111111111.jsonl'), '{"type":"user","sessionId":"claude-unindexed","cwd":"C:/work/unindexed","message":{"role":"user","content":"Unindexed prompt"}}\n');
  return { root, paths: { codexDbPath: dbPath, codexIndexPath: indexPath, claudeProjectsPath } };
}
test('catalog uses native metadata IDs, cwd, titles, provider filtering, and search', async () => {
  const { root, paths } = fixture();
  try {
    const all = await listSessions({ paths });
    assert.equal(all.sessions.length, 4);
    const codex = all.sessions.find(item => item.sessionId === 'codex-good');
    assert.deepEqual({ provider: codex.provider, sessionId: codex.sessionId, nativeId: codex.nativeId, cwd: codex.cwd, title: codex.title, source: codex.source, live: codex.live }, { provider: 'codex', sessionId: 'codex-good', nativeId: 'codex-good', cwd: 'C:\\work\\a', title: 'Indexed title', source: 'codex-state+index', live: false });
    assert.equal(codex.summary, 'First prompt from Codex');
    const claude = all.sessions.find(item => item.sessionId === 'claude-good');
    assert.equal(claude.cwd, 'C:/work/claude'); assert.equal(claude.provider, 'claude');
    assert.equal(all.sessions.find(item => item.sessionId === 'claude-unindexed').source, 'claude-jsonl-metadata');
    assert.deepEqual((await listSessions({ provider: 'CODEX', query: 'indexed', paths })).sessions.map(item => item.sessionId), ['codex-good']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('malformed records and unavailable stores produce bounded partial results and errors', async () => {
  const root = mkdtempSync(join(tmpdir(), 'session-catalog-missing-'));
  try {
    const result = await listSessions({ paths: { codexDbPath: join(root, 'none.sqlite'), codexIndexPath: join(root, 'missing-index'), claudeProjectsPath: join(root, 'missing-claude') }, limit: 999 });
    assert.deepEqual(result.sessions, []); assert.ok(result.errors.some(item => item.provider === 'codex'));
    assert.equal((await listSessions({ provider: 'unknown', paths: {} })).errors[0].source, 'request');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('Claude falls back to bounded JSONL metadata when no index exists', async () => {
  const root = mkdtempSync(join(tmpdir(), 'session-catalog-jsonl-'));
  try {
    const projects = join(root, 'projects', 'project'); mkdirSync(projects, { recursive: true });
    writeFileSync(join(projects, 'native-session.jsonl'), '{"type":"user","sessionId":"native-session","cwd":"C:/real","timestamp":"2025-02-01T00:00:00Z","message":{"role":"user","content":"A useful first prompt"}}\n');
    const result = await listSessions({ provider: 'claude', paths: { claudeProjectsPath: join(root, 'projects') } });
    assert.equal(result.sessions.length, 1); assert.equal(result.sessions[0].sessionId, 'native-session'); assert.equal(result.sessions[0].cwd, 'C:/real'); assert.equal(result.sessions[0].source, 'claude-jsonl-metadata');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('Codex queries older native IDs before applying the result cap', async () => {
  const { root, paths } = fixture();
  try {
    const db = new DatabaseSync(paths.codexDbPath);
    for (let i = 0; i < 220; i++) db.prepare('INSERT INTO threads VALUES(?,?,?,?,?,?,?)').run(`recent-${i}`, `C:/recent/${i}`, `Recent ${i}`, '', '', 1_800_000_000_000 + i, 1);
    db.prepare('INSERT INTO threads VALUES(?,?,?,?,?,?,?)').run('older-needle-id', 'C:/needle/cwd', 'Needle title', '', '', 1_000_000_000_000, 1);
    db.close();
    assert.deepEqual((await listSessions({ provider: 'codex', query: 'older-needle-id', paths })).sessions.map(item => item.sessionId), ['older-needle-id']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('bounded JSONL reads retain only metadata from a huge history file', async () => {
  const root = mkdtempSync(join(tmpdir(), 'session-catalog-bounded-'));
  try {
    const projects = join(root, 'projects', 'project'); mkdirSync(projects, { recursive: true });
    const id = '2f2f2f2f-2222-4222-8222-222222222222';
    writeFileSync(join(projects, `${id}.jsonl`), `{"type":"user","sessionId":"${id}","cwd":"C:/bounded","message":{"role":"user","content":"small metadata"}}\n${'x'.repeat(300_000)}`);
    const result = await listSessions({ provider: 'claude', paths: { claudeProjectsPath: join(root, 'projects') } });
    assert.equal(result.sessions[0].sessionId, id); assert.equal(result.sessions[0].truncated, true); assert.equal(result.sessions[0].summary, 'small metadata');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('Claude metadata can start with non-conversation events and acquire native ID and cwd later', async () => {
  const root = mkdtempSync(join(tmpdir(), 'session-catalog-later-metadata-'));
  try {
    const projects = join(root, 'projects', 'project'); mkdirSync(projects, { recursive: true });
    const id = '3f3f3f3f-3333-4333-8333-333333333333';
    writeFileSync(join(projects, `${id}.jsonl`), `{"type":"file-history-snapshot","id":"event-id-not-session"}\n{"type":"attachment","sessionId":"${id}","cwd":"C:/later-cwd","timestamp":"2025-03-01T00:00:00Z"}\n`);
    const result = await listSessions({ provider: 'claude', query: id, paths: { claudeProjectsPath: join(root, 'projects') } });
    assert.equal(result.sessions.length, 1); assert.equal(result.sessions[0].nativeId, id); assert.equal(result.sessions[0].cwd, 'C:/later-cwd'); assert.equal(result.sessions[0].project, 'C:/later-cwd');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('catalog hides native provider children by default without hiding ordinary SAO discussions', async () => {
  const root = mkdtempSync(join(tmpdir(), 'session-catalog-internal-'));
  const dbPath = join(root, 'state.sqlite');
  const db = new DatabaseSync(dbPath);
  db.exec('CREATE TABLE threads (id TEXT, cwd TEXT, title TEXT, updated_at_ms INTEGER, source TEXT, thread_source TEXT, agent_role TEXT, agent_nickname TEXT)');
  const insert = db.prepare('INSERT INTO threads VALUES(?,?,?,?,?,?,?,?)');
  insert.run('human-sao-discussion', 'C:/work', 'Should we use SAO for this?', 30, 'vscode', 'user', null, null);
  insert.run('codex-native-child', 'C:/work', 'Child work', 40, '{"subagent":{"thread_spawn":{}}}', 'subagent', 'coder', 'Ada');
  insert.run('sao-worker-wrapper', 'C:/work', 'worker output', 50, 'exec', 'subagent', 'worker', 'Turing');
  db.close();
  try {
    const paths = { codexDbPath: dbPath, codexIndexPath: join(root, 'missing-index'), claudeProjectsPath: join(root, 'missing-claude') };
    const defaultResult = await listSessions({ provider: 'codex', paths, limit: 1 });
    assert.deepEqual(defaultResult.sessions.map(item => item.sessionId), ['human-sao-discussion']);
    const includeInternal = await listSessions({ provider: 'codex', paths, includeInternal: true });
    assert.deepEqual(includeInternal.sessions.map(item => item.sessionId), ['sao-worker-wrapper', 'codex-native-child', 'human-sao-discussion']);
    assert.equal(includeInternal.sessions[0].internal, true);
    assert.equal(includeInternal.sessions[0].internalReason, 'thread_source:subagent');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('explicit registered IDs can retain an internal selection without mutating caller IDs', async () => {
  const root = mkdtempSync(join(tmpdir(), 'session-catalog-explicit-'));
  const dbPath = join(root, 'state.sqlite');
  const db = new DatabaseSync(dbPath);
  db.exec('CREATE TABLE threads (id TEXT, title TEXT, updated_at_ms INTEGER, source TEXT, thread_source TEXT, agent_role TEXT, agent_nickname TEXT)');
  db.prepare('INSERT INTO threads VALUES(?,?,?,?,?,?,?)').run('child-target', 'background child', 10, '{"subagent":{"other":"guardian"}}', 'guardian_review', 'reviewer', 'Grace');
  db.close();
  const registeredSessionIds = Object.freeze(['child-target']);
  try {
    const paths = { codexDbPath: dbPath, codexIndexPath: join(root, 'missing-index'), claudeProjectsPath: join(root, 'missing-claude') };
    const result = await listSessions({ provider: 'codex', query: 'child-target', registeredSessionIds, paths });
    assert.deepEqual(result.sessions.map(item => item.sessionId), ['child-target']);
    assert.deepEqual(registeredSessionIds, ['child-target']);
    assert.equal(result.sessions[0].internalReason, 'thread_source:guardian_review');
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('SAO worker preamble is filtered before the limit but an exact UUID query retains it', async () => {
  const root = mkdtempSync(join(tmpdir(), 'session-catalog-sao-worker-'));
  const dbPath = join(root, 'state.sqlite');
  const db = new DatabaseSync(dbPath);
  db.exec('CREATE TABLE threads (id TEXT, title TEXT, first_user_message TEXT, updated_at_ms INTEGER, source TEXT)');
  const insert = db.prepare('INSERT INTO threads VALUES(?,?,?,?,?)');
  const workerId = '4f4f4f4f-4444-4444-8444-444444444444';
  insert.run('human-discussion', 'SAO worker design discussion', 'Can we discuss the SAO worker envelope?', 20, 'cli');
  insert.run(workerId, 'worker task', '[worker 지시 — 최우선] 이 프로세스에는 MCP 도구가 없다. 아래 brief를 수행한다.', 30, 'cli');
  db.close();
  try {
    const paths = { codexDbPath: dbPath, codexIndexPath: join(root, 'missing-index'), claudeProjectsPath: join(root, 'missing-claude') };
    assert.deepEqual((await listSessions({ provider: 'codex', limit: 1, paths })).sessions.map(item => item.sessionId), ['human-discussion']);
    const exact = await listSessions({ provider: 'codex', query: workerId, paths });
    assert.deepEqual(exact.sessions.map(item => item.sessionId), [workerId]);
    assert.equal(exact.sessions[0].internalReason, 'sao_worker_preamble');
    assert.equal((await listSessions({ provider: 'codex', includeInternal: true, paths })).sessions[0].sessionId, workerId);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
test('Claude native sidechains are hidden by default and can be requested explicitly', async () => {
  const root = mkdtempSync(join(tmpdir(), 'session-catalog-claude-internal-'));
  try {
    const project = join(root, 'projects', 'project'); mkdirSync(project, { recursive: true });
    writeFileSync(join(project, 'sessions-index.json'), JSON.stringify({ sessions: [
      { sessionId: 'claude-primary', title: 'Discussing SAO plans', updatedAt: '2025-01-01T00:00:00Z' },
      { sessionId: 'claude-child', title: 'child task', isSubagent: true, updatedAt: '2025-01-02T00:00:00Z' },
    ] }));
    const paths = { claudeProjectsPath: join(root, 'projects') };
    assert.deepEqual((await listSessions({ provider: 'claude', paths })).sessions.map(item => item.sessionId), ['claude-primary']);
    const internal = await listSessions({ provider: 'claude', includeInternal: true, paths });
    assert.equal(internal.sessions[0].internalReason, 'isSubagent');
    assert.deepEqual((await listSessions({ provider: 'claude', registeredSessionIds: ['claude-child'], paths })).sessions.map(item => item.sessionId), ['claude-child', 'claude-primary']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
