import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInstallUpdateHandler, updateInstallRequest, validatePreparedUpdate } from '../desktop/shells/electron/updater.mjs';

test('update IPC accepts only a version-only DTO before preparation', async () => {
  assert.deepEqual(updateInstallRequest({ version: '1.2.3' }), { version: '1.2.3' });
  for (const value of [undefined, {}, { version: 2 }, { version: '1.2' }, { version: '1.2.3', installerPath: 'C:\\bad.exe' }]) assert.throws(() => updateInstallRequest(value), /UPDATE_INSTALL_INVALID_REQUEST/);
  let calls = 0; const contents = { mainFrame: { url: 'http://127.0.0.1:4318/' }, getURL: () => 'http://127.0.0.1:4318/' }; const handler = createInstallUpdateHandler({ getActiveWindow: () => ({ webContents: contents }), getTrustedOrigin: () => 'http://127.0.0.1:4318', prepare: async () => { calls += 1; }, handoff: async () => ({ ok: true, state: 'installing' }) });
  await assert.rejects(() => handler({ sender: contents, senderFrame: contents.mainFrame }, { version: 'bad' }), /UPDATE_INSTALL_INVALID_REQUEST/); assert.equal(calls, 0);
  assert.deepEqual(await handler({ sender: contents, senderFrame: contents.mainFrame }, { version: '1.2.3' }), { ok: true, state: 'installing' }); assert.equal(calls, 1);
});

test('prepared jobs are bounded to the profile download path and rehashed', async t => {
  const profile = await mkdtemp(join(tmpdir(), 'rooms-update-')); t.after(() => rm(profile, { recursive: true, force: true })); const version = '1.2.3', directory = join(profile, 'updates', 'downloads', version), installer = join(directory, `SessionRooms-${version}-x64-setup.exe`), bytes = Buffer.from('benign installer'); await mkdir(directory, { recursive: true }); await writeFile(installer, bytes);
  const job = { token: 'abcdefghijklmnop', version, installerPath: installer, sha256: createHash('sha256').update(bytes).digest('hex'), size: bytes.length, releaseUrl: 'https://github.com/JJHbrams/inter-session-orchastrator/releases/tag/v1.2.3' };
  assert.equal((await validatePreparedUpdate(job, profile)).installerPath, installer); await writeFile(installer, 'tampered'); await assert.rejects(() => validatePreparedUpdate(job, profile), /UPDATE_INSTALLER_SIZE_INVALID|UPDATE_INSTALLER_HASH_INVALID/);
});
