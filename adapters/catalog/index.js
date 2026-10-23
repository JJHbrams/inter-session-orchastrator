import { DatabaseSync } from 'node:sqlite';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, basename, dirname } from 'node:path';

const DEFAULT_LIMIT = 80;
const MAX_LIMIT = 200;
const MAX_SUMMARY = 180;
const MAX_INDEX_BYTES = 2_000_000;
const MAX_JSONL_BYTES = 64_000;
const MAX_CLAUDE_JSONL_FILES = 160;

const text = value => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
const short = value => {
  const valueText = text(value);
  return valueText.length > MAX_SUMMARY ? `${valueText.slice(0, MAX_SUMMARY - 1)}…` : valueText;
};
const time = value => {
  if (typeof value === 'number' && Number.isFinite(value)) return value > 1e12 ? new Date(value).toISOString() : new Date(value * 1000).toISOString();
  if (typeof value === 'string' && !Number.isNaN(Date.parse(value))) return new Date(value).toISOString();
  return null;
};
const pathFrom = (paths, key, fallback) => paths?.[key] || fallback;
const error = (errors, provider, source, cause) => errors.push({ provider, source, message: cause instanceof Error ? cause.message : String(cause) });
const readBounded = async (file, bytes) => {
  const info = await stat(file);
  const content = await readFile(file, 'utf8');
  return { content: content.slice(0, bytes), truncated: info.size > bytes };
};
const canonical = provider => ({ codex: 'codex', claude: 'claude' }[String(provider || '').toLowerCase()] || null);
const catalogSession = ({ provider, sessionId, cwd = null, project = null, title = '', summary = '', updatedAt = null, source, truncated = false }) => ({
  provider,
  sessionId,
  cwd: text(cwd) || null,
  project: text(project) || null,
  title: short(title) || 'Untitled session',
  summary: short(summary) || null,
  updatedAt: time(updatedAt),
  source,
  truncated: Boolean(truncated),
  live: false,
  identity: 'historical_metadata',
});

async function codexSessions(paths, errors) {
  const dbPath = pathFrom(paths, 'codexDbPath', join(process.env.USERPROFILE || '', '.codex', 'state_5.sqlite'));
  const indexPath = pathFrom(paths, 'codexIndexPath', join(process.env.USERPROFILE || '', '.codex', 'session_index.jsonl'));
  const index = new Map();
  try {
    const { content } = await readBounded(indexPath, MAX_INDEX_BYTES);
    for (const line of content.split(/\r?\n/)) {
      if (!line.trim()) continue;
      try {
        const row = JSON.parse(line);
        if (text(row.id)) index.set(row.id, row);
      } catch (cause) { error(errors, 'codex', 'session_index.jsonl', `ignored malformed record: ${cause.message}`); }
    }
  } catch (cause) {
    if (cause?.code !== 'ENOENT') error(errors, 'codex', 'session_index.jsonl', cause);
  }
  let db;
  try {
    db = new DatabaseSync(dbPath, { readOnly: true });
    const columns = new Set(db.prepare('PRAGMA table_info(threads)').all().map(row => row.name));
    if (!columns.has('id')) throw Error('threads table has no id column');
    const field = name => columns.has(name) ? name : 'NULL';
    const rows = db.prepare(`SELECT id, ${field('cwd')} AS cwd, ${field('title')} AS title, ${field('preview')} AS preview, ${field('first_user_message')} AS first_user_message, ${field('updated_at_ms')} AS updated_at_ms, ${field('updated_at')} AS updated_at FROM threads ORDER BY COALESCE(${field('updated_at_ms')}, ${field('updated_at')}, 0) DESC LIMIT ?`).all(MAX_LIMIT);
    return rows.filter(row => text(row.id)).map(row => {
      const indexed = index.get(row.id) || {};
      return catalogSession({ provider: 'codex', sessionId: row.id, cwd: row.cwd, title: indexed.thread_name || row.title, summary: row.preview || row.first_user_message, updatedAt: indexed.updated_at || row.updated_at_ms || row.updated_at, source: 'codex-state+index' });
    });
  } catch (cause) {
    error(errors, 'codex', 'state_5.sqlite', cause);
    return [...index.values()].filter(row => text(row.id)).map(row => catalogSession({ provider: 'codex', sessionId: row.id, title: row.thread_name, updatedAt: row.updated_at, source: 'codex-session-index' }));
  } finally { db?.close(); }
}

function claudeIndexRows(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.sessions)) return value.sessions;
  if (Array.isArray(value?.entries)) return value.entries;
  return [];
}
function claudeFromIndex(row, projectDir) {
  const sessionId = text(row.sessionId || row.session_id || row.id || row.uuid);
  if (!sessionId) return null;
  return catalogSession({ provider: 'claude', sessionId, cwd: row.cwd || row.projectPath || row.project_path || null, project: row.project || row.projectName || basename(dirname(projectDir)), title: row.title || row.displayName || row.name, summary: row.summary || row.firstPrompt || row.first_prompt, updatedAt: row.updatedAt || row.updated_at || row.modifiedAt || row.timestamp, source: 'claude-sessions-index' });
}
async function findIndexFiles(root, max = MAX_CLAUDE_JSONL_FILES) {
  const found = [];
  const visit = async directory => {
    if (found.length >= max) return;
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (found.length >= max) return;
      const full = join(directory, entry.name);
      if (entry.isDirectory()) await visit(full);
      else if (entry.name === 'sessions-index.json') found.push(full);
    }
  };
  await visit(root);
  return found;
}
async function findJsonlFiles(root, max = MAX_CLAUDE_JSONL_FILES) {
  const found = [];
  const visit = async directory => {
    if (found.length >= max) return;
    let entries;
    try { entries = await readdir(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (found.length >= max) return;
      const full = join(directory, entry.name);
      if (entry.isDirectory()) await visit(full);
      else if (entry.isFile() && entry.name.endsWith('.jsonl')) found.push(full);
    }
  };
  await visit(root);
  const stamped = await Promise.all(found.map(async file => ({ file, mtime: (await stat(file)).mtimeMs })));
  return stamped.sort((a, b) => b.mtime - a.mtime).map(item => item.file);
}
function jsonlMetadata(content, file) {
  let firstUser = '', row = null;
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      row ||= parsed;
      if (!firstUser && (parsed.type === 'user' || parsed.message?.role === 'user')) {
        const body = parsed.message?.content ?? parsed.content ?? parsed.text;
        firstUser = typeof body === 'string' ? body : Array.isArray(body) ? body.find(part => typeof part?.text === 'string')?.text : '';
      }
    } catch { /* malformed history entries are deliberately ignored */ }
  }
  if (!row) return null;
  const sessionId = text(row.sessionId || row.session_id || row.id) || basename(file, '.jsonl');
  return catalogSession({ provider: 'claude', sessionId, cwd: row.cwd || row.projectPath || null, project: null, title: row.title || row.summary || firstUser, summary: firstUser, updatedAt: row.timestamp || row.updatedAt, source: 'claude-jsonl-metadata' });
}
async function claudeSessions(paths, errors) {
  const root = pathFrom(paths, 'claudeProjectsPath', join(process.env.USERPROFILE || '', '.claude', 'projects'));
  const indices = await findIndexFiles(root);
  if (indices.length) {
    const results = [];
    for (const file of indices) try {
      const { content } = await readBounded(file, MAX_INDEX_BYTES);
      const data = JSON.parse(content);
      for (const row of claudeIndexRows(data)) {
        const session = claudeFromIndex(row, file);
        if (session) results.push(session);
      }
    } catch (cause) { error(errors, 'claude', 'sessions-index.json', cause); }
    return results;
  }
  const files = await findJsonlFiles(root);
  const results = [];
  for (const file of files) try {
    const { content, truncated } = await readBounded(file, MAX_JSONL_BYTES);
    const session = jsonlMetadata(content, file);
    if (session) results.push({ ...session, truncated });
  } catch (cause) { error(errors, 'claude', 'jsonl-metadata', cause); }
  return results;
}

export async function listSessions({ query = '', provider = '', limit = DEFAULT_LIMIT, paths = {} } = {}) {
  const errors = [];
  const selected = canonical(provider);
  if (provider && !selected) return { sessions: [], errors: [{ provider: String(provider), source: 'request', message: 'unknown provider' }] };
  const sources = await Promise.all([
    !selected || selected === 'codex' ? codexSessions(paths, errors) : [],
    !selected || selected === 'claude' ? claudeSessions(paths, errors) : [],
  ]);
  const needle = text(query).toLocaleLowerCase();
  const sessions = sources.flat().filter(session => !needle || [session.provider, session.sessionId, session.cwd, session.project, session.title, session.summary].some(value => text(value).toLocaleLowerCase().includes(needle))).sort((a, b) => (Date.parse(b.updatedAt || 0) || 0) - (Date.parse(a.updatedAt || 0) || 0)).slice(0, Math.min(MAX_LIMIT, Math.max(1, Number(limit) || DEFAULT_LIMIT)));
  return { sessions, errors };
}
