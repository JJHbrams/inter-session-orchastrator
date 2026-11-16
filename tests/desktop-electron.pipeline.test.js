import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ensureVerifiedFile } from '../desktop/scripts/prepare-toolchains.mjs';
import { validateSmokeOutput } from '../desktop/scripts/release-electron.mjs';

test('tool preparation accepts a matching existing file without network access', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'rooms-toolchain-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const destination = join(directory, 'node.exe'), bytes = Buffer.from('verified fixture'); await writeFile(destination, bytes);
  const result = await ensureVerifiedFile({ url: 'https://invalid.example/node.exe', sha256: createHash('sha256').update(bytes).digest('hex') }, destination);
  assert.equal(result.source, 'cache'); assert.deepEqual(await readFile(destination), bytes);
});

test('release rejects missing, duplicate, unauthenticated or abnormal smoke results', () => {
  const record = { type: 'electron-smoke', passed: true, childPid: 123, origin: 'http://127.0.0.1:45678', renderer: { officePixiReady: true, officeIdleAnimated: true, officePixiFrames: true, officeChairCrowned: true, officeChairFacingParticipants: true, officeSeatedParticipants: true, officeSceneTransitions: true, officeEntryAnimated: true, officeExitAnimated: true, officeWorkSeated: true, officeIdleRegistrationStable: true, officeWorkHeadScaleStable: true, officeSpritesLoaded: true, officeAvailable: true, officeArtworkLoaded: true, documentReady: true, appPresent: true, bootstrap: true, authenticatedRead: true, folderPickerAvailable: true, folderPickerGuarded: true, updateInstallerAvailable: true, updateInstallerGuarded: true }, shutdown: { normal: true, forced: false, exitCode: 0, signalCode: null } };
  const output = value => JSON.stringify(value) + '\n';
  assert.equal(validateSmokeOutput(output(record)).childPid, 123);
  assert.throws(() => validateSmokeOutput(''));
  assert.throws(() => validateSmokeOutput(output(record) + output(record)));
  assert.throws(() => validateSmokeOutput(output({ ...record, shutdown: { ...record.shutdown, exitCode: 1 } })));
  assert.throws(() => validateSmokeOutput(output({ ...record, renderer: { ...record.renderer, authenticatedRead: false } })));
  assert.throws(() => validateSmokeOutput(output({ ...record, renderer: { ...record.renderer, folderPickerAvailable: false } })));
  assert.throws(() => validateSmokeOutput(output({ ...record, renderer: { ...record.renderer, folderPickerGuarded: false } })));
  assert.throws(() => validateSmokeOutput(output({ ...record, renderer: { ...record.renderer, updateInstallerAvailable: false } })));
  assert.throws(() => validateSmokeOutput(output({ ...record, renderer: { ...record.renderer, updateInstallerGuarded: false } })));
  assert.throws(() => validateSmokeOutput(output({ ...record, renderer: { ...record.renderer, officeArtworkLoaded: false } })));
  for (const key of ['officePixiReady','officeIdleAnimated','officePixiFrames','officeChairCrowned','officeChairFacingParticipants','officeSeatedParticipants','officeSceneTransitions','officeEntryAnimated','officeExitAnimated','officeWorkSeated','officeIdleRegistrationStable','officeWorkHeadScaleStable']) assert.throws(() => validateSmokeOutput(output({...record,renderer:{...record.renderer,[key]:false}})));
  assert.throws(() => validateSmokeOutput(output({ ...record, origin: 'http://example.com' })));
});
