import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const helper = new URL('../desktop/shells/electron/update-helper.mjs', import.meta.url);
const token = 'abcdefghijklmnop', version = '1.2.3';
async function fixture(t) { const profile = await mkdtemp(join(tmpdir(), 'rooms-update-helper-')); t.after(() => rm(profile, { recursive: true, force: true })); const downloads = join(profile, 'updates', 'downloads', version), helpers = join(profile, 'updates', 'helpers', token), install = join(profile, 'installed'); await mkdir(downloads, { recursive: true }); await mkdir(helpers, { recursive: true }); await mkdir(install, { recursive: true }); await mkdir(join(profile, 'knowledge')); const installer = join(downloads, `SessionRooms-${version}-x64-setup.exe`), bytes = Buffer.from('not an installer'); await writeFile(installer, bytes); return { profile, helpers, install, installer, sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length }; }
async function run(job, helpers, environment = {}) { const path = join(helpers, 'job.json'); await writeFile(path, JSON.stringify(job)); return await new Promise(resolve => { const child = spawn(process.execPath, [helper, path], { env: { ...process.env, ...environment }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'], windowsHide: true }); let ready = false, stderr = ''; child.stderr.on('data', value => stderr += value); child.on('message', message => { if (message?.type === 'ready') ready = true; }); child.once('exit', code => resolve({ code, ready, stderr })); }); }

test('invalid helper preflight writes no profile result and never launches the supplied app', async t => {
  const value = await fixture(t), sentinel = join(value.profile, 'restart-sentinel'); const job = { token, version, installerPath: value.installer, sha256: value.sha256, size: value.size, releaseUrl: 'https://example.test', profile: value.profile, installDir: value.install, appExe: sentinel, knowledgeRoot: join(value.profile, 'knowledge'), parentPid: process.pid };
  const result = await run(job, value.helpers); assert.equal(result.ready, false); assert.equal(result.code, 1); await assert.rejects(() => readFile(sentinel)); await assert.rejects(() => readFile(join(value.profile, 'updates', 'last-install-result.json')));
});

test('helper retains a bounded no-commit handoff deadline', async () => {
  const source = await readFile(helper, 'utf8'); assert.match(source, /HANDOFF_TIMEOUT_MS/); assert.match(source, /UPDATE_HANDOFF_TIMEOUT/);
});
