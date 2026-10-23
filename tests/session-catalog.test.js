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
  db.prepare('INSERT INTO threads VALUES(?,?,?,?,?,?,?)').run('codex-good', 'C:/work/a', 'State title', 'First prompt from Codex', 'fallback', 1_700_000_000_000, 1);
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
    assert.deepEqual({ provider: codex.provider, sessionId: codex.sessionId, nativeId: codex.nativeId, cwd: codex.cwd, title: codex.title, source: codex.source, live: codex.live }, { provider: 'codex', sessionId: 'codex-good', nativeId: 'codex-good', cwd: 'C:/work/a', title: 'Indexed title', source: 'codex-state+index', live: false });
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
