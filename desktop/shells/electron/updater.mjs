import { createHash, randomUUID } from 'node:crypto';
import { cp, lstat, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve } from 'node:path';
import { spawn as nodeSpawn } from 'node:child_process';

export const UPDATE_INSTALL_CHANNEL = 'session-rooms:install-update';
const VERSION = /^\d+\.\d+\.\d+$/;
const HASH = /^[a-f0-9]{64}$/;

export function updateInstallRequest(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || Object.keys(payload).length !== 1 || Object.keys(payload)[0] !== 'version' || typeof payload.version !== 'string' || !VERSION.test(payload.version)) throw Object.assign(new Error('UPDATE_INSTALL_INVALID_REQUEST'), { code: 'UPDATE_INSTALL_INVALID_REQUEST' });
  return { version: payload.version };
}

export function trustedUpdateSender(event, activeWindow, origin) {
  const sender = event?.sender, frame = event?.senderFrame;
  if (!activeWindow || sender !== activeWindow.webContents || frame !== sender.mainFrame) return false;
  try { return new URL(frame.url).origin === origin && new URL(sender.getURL()).origin === origin; } catch { return false; }
}

export function createInstallUpdateHandler({ getActiveWindow, getTrustedOrigin, prepare, handoff }) {
  let installing = false;
  return async (event, payload) => {
    if (!trustedUpdateSender(event, getActiveWindow(), getTrustedOrigin())) throw Object.assign(new Error('UPDATE_INSTALL_UNTRUSTED_SENDER'), { code: 'UPDATE_INSTALL_UNTRUSTED_SENDER' });
    const request = updateInstallRequest(payload);
    if (installing) return { ok: false, code: 'UPDATE_INSTALL_BUSY', message: 'An update installation is already being prepared.' };
    installing = true;
    try { await prepare(request.version); return await handoff(); }
    catch (error) { return { ok: false, code: knownCode(error), message: String(error?.message || 'Update installation could not be started.') }; }
    finally { installing = false; }
  };
}

function knownCode(error) { return typeof error?.code === 'string' && /^UPDATE_[A-Z_]+$/.test(error.code) ? error.code : 'UPDATE_INSTALL_FAILED'; }

export async function createUpdateClient(origin, fetchImpl = fetch) {
  const bootstrap = await fetchImpl(new URL('/api/bootstrap', origin), { headers: { Origin: origin }, cache: 'no-store' });
  if (!bootstrap.ok) throw Object.assign(new Error('UPDATE_BOOTSTRAP_FAILED'), { code: 'UPDATE_BOOTSTRAP_FAILED' });
  const cookie = bootstrap.headers.get('set-cookie'); const body = await bootstrap.json();
  if (!cookie || typeof body?.csrf !== 'string') throw Object.assign(new Error('UPDATE_BOOTSTRAP_FAILED'), { code: 'UPDATE_BOOTSTRAP_FAILED' });
  const call = async (path, value) => {
    const response = await fetchImpl(new URL(path, origin), { method: 'POST', headers: { Cookie: cookie.split(';')[0], 'x-csrf-token': body.csrf, 'content-type': 'application/json', Origin: origin }, body: JSON.stringify(value), cache: 'no-store' });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw Object.assign(new Error(result?.message || result?.error || 'UPDATE_API_FAILED'), { code: result?.code || 'UPDATE_API_FAILED' });
    return result;
  };
  return { prepare: version => call('/api/updates/prepare', { version }), cancel: token => call('/api/updates/cancel', { token }) };
}

function within(root, candidate) { const part = relative(resolve(root), resolve(candidate)); return part && !part.startsWith('..') && !isAbsolute(part); }
export async function validatePreparedUpdate(job, profile, fs = { stat, lstat, readFile }) {
  if (!job || typeof job !== 'object' || Object.keys(job).some(key => !['token', 'version', 'installerPath', 'sha256', 'size', 'releaseUrl'].includes(key)) || typeof job.token !== 'string' || !/^[a-zA-Z0-9_-]{16,128}$/.test(job.token) || typeof job.version !== 'string' || !VERSION.test(job.version) || typeof job.installerPath !== 'string' || !isAbsolute(job.installerPath) || typeof job.sha256 !== 'string' || !HASH.test(job.sha256) || !Number.isSafeInteger(job.size) || job.size < 1 || typeof job.releaseUrl !== 'string') throw Object.assign(new Error('UPDATE_PREPARE_INVALID'), { code: 'UPDATE_PREPARE_INVALID' });
  const expected = join(resolve(profile), 'updates', 'downloads', job.version, `SessionRooms-${job.version}-x64-setup.exe`);
  if (resolve(job.installerPath).toLowerCase() !== resolve(expected).toLowerCase() || basename(job.installerPath) !== basename(expected) || !within(join(profile, 'updates', 'downloads', job.version), job.installerPath)) throw Object.assign(new Error('UPDATE_INSTALLER_PATH_INVALID'), { code: 'UPDATE_INSTALLER_PATH_INVALID' });
  const link = await fs.lstat(job.installerPath); if (!link.isFile() || link.isSymbolicLink()) throw Object.assign(new Error('UPDATE_INSTALLER_PATH_INVALID'), { code: 'UPDATE_INSTALLER_PATH_INVALID' });
  const info = await fs.stat(job.installerPath); if (info.size !== job.size) throw Object.assign(new Error('UPDATE_INSTALLER_SIZE_INVALID'), { code: 'UPDATE_INSTALLER_SIZE_INVALID' });
  const digest = createHash('sha256').update(await fs.readFile(job.installerPath)).digest('hex'); if (digest !== job.sha256) throw Object.assign(new Error('UPDATE_INSTALLER_HASH_INVALID'), { code: 'UPDATE_INSTALLER_HASH_INVALID' });
  return { ...job, installerPath: expected };
}

export async function startUpdateHelper(job, { profile, runtime, installDir, appExe, knowledgeRoot, spawn = nodeSpawn, timeoutMs = 15000 } = {}) {
  const checked = await validatePreparedUpdate(job, profile);
  const directory = join(profile, 'updates', 'helpers', checked.token);
  await mkdir(directory, { recursive: true });
  const node = join(directory, 'node.exe'), helper = join(directory, 'update-helper.mjs'), jobFile = join(directory, 'job.json');
  await cp(join(runtime, 'node.exe'), node, { force: true }); await cp(new URL('./update-helper.mjs', import.meta.url), helper, { force: true });
  await writeFile(jobFile, JSON.stringify({ ...checked, profile, installDir, appExe, knowledgeRoot, parentPid: process.pid }, null, 2), { mode: 0o600 });
  const child = spawn(node, [helper, jobFile], { shell: false, detached: false, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  await new Promise((resolveReady, reject) => { const timer = setTimeout(() => reject(Object.assign(new Error('UPDATE_HELPER_TIMEOUT'), { code: 'UPDATE_HELPER_TIMEOUT' })), timeoutMs); child.once('error', error => { clearTimeout(timer); reject(error); }); child.once('exit', () => { clearTimeout(timer); reject(Object.assign(new Error('UPDATE_HELPER_EXITED'), { code: 'UPDATE_HELPER_EXITED' })); }); child.on('message', message => { if (message?.type === 'ready' && message.token === checked.token) { clearTimeout(timer); resolveReady(); } }); });
  return { child, job: checked, commit: () => child.connected && child.send({ type: 'commit', token: checked.token }), abort: () => child.connected && child.send({ type: 'abort', token: checked.token }) };
}
