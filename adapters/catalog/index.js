import { DatabaseSync } from 'node:sqlite';
import { open, readdir, stat } from 'node:fs/promises';
import { join, basename, dirname } from 'node:path';

const DEFAULT_LIMIT = 80;
const MAX_LIMIT = 200;
const MAX_SUMMARY = 180;
const MAX_INDEX_BYTES = 2_000_000;
const MAX_JSONL_BYTES = 64_000;
const MAX_CLAUDE_JSONL_FILES = 160;
const MAX_CLAUDE_JSONL_PER_PROJECT = 8;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
  const handle = await open(file, 'r');
  try {
    const buffer = Buffer.alloc(bytes);
    const { bytesRead } = await handle.read(buffer, 0, bytes, 0);
    return { content: buffer.subarray(0, bytesRead).toString('utf8'), truncated: info.size > bytes };
  } finally { await handle.close(); }
};
const canonical = provider => ({ codex: 'codex', claude: 'claude' }[String(provider || '').toLowerCase()] || null);
const catalogSession = ({ provider, sessionId, cwd = null, project = null, title = '', summary = '', updatedAt = null, source, truncated = false }) => ({
  provider,
  sessionId,
  nativeId: sessionId,
  cwd: text(cwd).replace(/^\\\\\?\\([a-z]:\\)/i,'$1').replace(/^\\\\\?\\UNC\\/i,'\\\\') || null,
  project: text(project) || null,
  title: short(title) || 'Untitled session',
  summary: short(summary) || null,
  updatedAt: time(updatedAt),
  source,
  truncated: Boolean(truncated),
  live: false,
  identity: 'historical_metadata',
});

async function codexSessions(paths, errors, query) {
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
    const searchable = ['id', 'cwd', 'title'].filter(name => columns.has(name));
    const indexedIds = query ? [...index.values()].filter(row => [row.id, row.thread_name].some(value => text(value).toLocaleLowerCase().includes(query.toLocaleLowerCase()))).map(row => row.id).filter(Boolean) : [];
    const clauses = [], values = [];
    if (query && searchable.length) { clauses.push(`(${searchable.map(name => `LOWER(CAST(${name} AS TEXT)) LIKE LOWER(?)`).join(' OR ')})`); values.push(...searchable.map(() => `%${query}%`)); }
    if (indexedIds.length) { clauses.push(`id IN (${indexedIds.map(() => '?').join(',')})`); values.push(...indexedIds); }
    const where = clauses.length ? `WHERE ${clauses.join(' OR ')}` : '';
    const rows = db.prepare(`SELECT id, ${field('cwd')} AS cwd, ${field('title')} AS title, ${field('preview')} AS preview, ${field('first_user_message')} AS first_user_message, ${field('updated_at_ms')} AS updated_at_ms, ${field('updated_at')} AS updated_at FROM threads ${where} ORDER BY COALESCE(${field('updated_at_ms')}, ${field('updated_at')}, 0) DESC LIMIT ?`).all(...values, MAX_LIMIT);
    return rows.filter(row => text(row.id)).map(row => {
      const indexed = index.get(row.id) || {};
      return catalogSession({ provider: 'codex', sessionId: row.id, cwd: row.cwd, title: indexed.thread_name || row.title, summary: row.preview || row.first_user_message, updatedAt: indexed.updated_at || row.updated_at_ms || row.updated_at, source: 'codex-state+index' });
    });
  } catch (cause) {
    error(errors, 'codex', 'state_5.sqlite', cause);
    return [...index.values()].filter(row => text(row.id) && (!query || [row.id, row.thread_name].some(value => text(value).toLocaleLowerCase().includes(query.toLocaleLowerCase())))).slice(0, MAX_LIMIT).map(row => catalogSession({ provider: 'codex', sessionId: row.id, title: row.thread_name, updatedAt: row.updated_at, source: 'codex-session-index' }));
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
async function claudeProjects(root, query = '') {
  let entries;
  try { entries = await readdir(root, { withFileTypes: true }); } catch { return []; }
  const projects = [];
  for (const entry of entries.filter(item => item.isDirectory())) {
    const directory = join(root, entry.name);
    let files;
    try { files = await readdir(directory, { withFileTypes: true }); } catch { continue; }
    const jsonl = await Promise.all(files.filter(item => item.isFile() && item.name.endsWith('.jsonl')).map(async item => {
      const file = join(directory, item.name);
      return { file, mtime: (await stat(file)).mtimeMs };
    }));
    projects.push({ directory, index: files.some(item => item.isFile() && item.name === 'sessions-index.json') ? join(directory, 'sessions-index.json') : null, jsonl: jsonl.sort((a, b) => b.mtime - a.mtime).slice(0, MAX_CLAUDE_JSONL_PER_PROJECT) });
  }
  const needle = text(query).toLocaleLowerCase();
  if (!needle) return projects;
  return projects.map(project => ({ ...project, jsonl: project.jsonl.sort((a, b) => Number(basename(b.file).toLocaleLowerCase().includes(needle)) - Number(basename(a.file).toLocaleLowerCase().includes(needle)) || b.mtime - a.mtime) }));
}
function jsonlMetadata(content, file, mtime) {
  let firstUser = '', sessionId = '', cwd = '', project = '', title = '', updatedAt = null, sidechain = false;
  for (const line of content.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const parsed = JSON.parse(line);
      sessionId ||= text(parsed.sessionId || parsed.session_id);
      cwd ||= text(parsed.cwd || parsed.projectPath);
      project ||= text(parsed.project || parsed.projectPath);
      title ||= text(parsed.title || parsed.summary);
      updatedAt = parsed.timestamp || parsed.updatedAt || updatedAt;
      sidechain ||= parsed.isSidechain === true || parsed.isSubagent === true;
      if (!firstUser && (parsed.type === 'user' || parsed.message?.role === 'user')) {
        const body = parsed.message?.content ?? parsed.content ?? parsed.text;
        firstUser = typeof body === 'string' ? body : Array.isArray(body) ? body.find(part => typeof part?.text === 'string')?.text : '';
      }
    } catch { /* malformed history entries are deliberately ignored */ }
  }
  if (sidechain || /^(agent-|subagent-)/i.test(basename(file))) return null;
  const nativeId = sessionId || (UUID.test(basename(file, '.jsonl')) ? basename(file, '.jsonl') : '');
  if (!nativeId) return null;
  return catalogSession({ provider: 'claude', sessionId: nativeId, cwd, project: project || cwd, title: title || firstUser, summary: firstUser, updatedAt: updatedAt || mtime, source: 'claude-jsonl-metadata' });
}
async function claudeSessions(paths, errors, query) {
  const root = pathFrom(paths, 'claudeProjectsPath', join(process.env.USERPROFILE || '', '.claude', 'projects'));
  const projects = await claudeProjects(root, query);
  const results = [], known = new Set();
  for (const project of projects) if (project.index) try {
      const { content } = await readBounded(project.index, MAX_INDEX_BYTES);
      const data = JSON.parse(content);
      for (const row of claudeIndexRows(data)) {
        const session = claudeFromIndex(row, project.index);
        if (session) { results.push(session); known.add(session.sessionId); }
      }
    } catch (cause) { error(errors, 'claude', 'sessions-index.json', cause); }
  const needle = text(query).toLocaleLowerCase();
  const candidates = projects.flatMap(project => project.jsonl).sort((a, b) => Number(basename(b.file).toLocaleLowerCase().includes(needle)) - Number(basename(a.file).toLocaleLowerCase().includes(needle)) || b.mtime - a.mtime).slice(0, MAX_CLAUDE_JSONL_FILES);
  for (const candidate of candidates) try {
    const { content, truncated } = await readBounded(candidate.file, MAX_JSONL_BYTES);
    const session = jsonlMetadata(content, candidate.file, candidate.mtime);
    if (session && !known.has(session.sessionId)) { results.push({ ...session, truncated }); known.add(session.sessionId); }
  } catch (cause) { error(errors, 'claude', 'jsonl-metadata', cause); }
  return results;
}

export async function listSessions({ query = '', provider = '', limit = DEFAULT_LIMIT, paths = {} } = {}) {
  const errors = [];
  const selected = canonical(provider);
  if (provider && !selected) return { sessions: [], errors: [{ provider: String(provider), source: 'request', message: 'unknown provider' }] };
  const sources = await Promise.all([
    !selected || selected === 'codex' ? codexSessions(paths, errors, text(query)) : [],
    !selected || selected === 'claude' ? claudeSessions(paths, errors, text(query)) : [],
  ]);
  const needle = text(query).toLocaleLowerCase();
  const sessions = sources.flat().filter(session => !needle || [session.provider, session.sessionId, session.cwd, session.project, session.title, session.summary].some(value => text(value).toLocaleLowerCase().includes(needle))).sort((a, b) => (Date.parse(b.updatedAt || 0) || 0) - (Date.parse(a.updatedAt || 0) || 0)).slice(0, Math.min(MAX_LIMIT, Math.max(1, Number(limit) || DEFAULT_LIMIT)));
  return { sessions, errors };
}
