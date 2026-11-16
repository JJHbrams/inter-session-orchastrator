import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { stageRuntime } from '../desktop/scripts/stage-runtime.mjs';

async function file(path, contents = 'fixture') { await mkdir(dirname(path), { recursive: true }); await writeFile(path, contents); }
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'rooms-runtime-source-'));
  await Promise.all([
    file(join(root, 'services', 'server.mjs')), file(join(root, 'adapters', 'bridge.mjs')), file(join(root, 'packages', 'core', 'index.mjs')),
    file(join(root, 'apps', 'desktop', 'index.html')), file(join(root, 'desktop', 'runtime', 'entry.mjs')), file(join(root, 'package.json'), '{"type":"module"}'), file(join(root, 'VERSION'), '1.2.3\n'),
    file(join(root, 'node_modules', 'marked', 'marked.js')), file(join(root, 'node_modules', 'dompurify', 'purify.js')),
    file(join(root, 'services', '.local', 'state.json')), file(join(root, 'services', '.env')), file(join(root, 'services', 'private', 'secret.txt')),
    file(join(root, 'services', 'config', 'settings.json')), file(join(root, 'services', 'cache.sqlite')),
    file(join(root, 'node.exe'), 'node-fixture'), file(join(root, 'LICENSE'), 'node-license'), file(join(root, 'guardian.exe'), 'guardian-fixture'),
  ]);
  return root;
}
test('stages only runtime allowlist with checksummed assets and licenses', async t => {
  const sourceRoot = await fixture(), destination = await mkdtemp(join(tmpdir(), 'rooms-stage-')), nodeBinary = join(sourceRoot, 'node.exe');
  t.after(async () => Promise.all([rm(sourceRoot, { recursive: true, force: true }), rm(destination, { recursive: true, force: true })]));
  const manifest = await stageRuntime(destination, { sourceRoot, nodeBinary, guardianBinary: join(sourceRoot, 'guardian.exe'), requireGuardian: true });
  assert.equal(manifest.guardian, 'included'); assert.equal(manifest.licenses.node, 'included');
  for (const path of ['runtime/app/VERSION', 'runtime/guardian.exe', 'runtime/NODE_LICENSE', 'runtime/app/desktop/runtime/entry.mjs', 'runtime/app/node_modules/marked/marked.js', 'runtime/app/node_modules/dompurify/purify.js']) assert.ok(existsSync(join(destination, path)), path);
  for (const path of ['runtime/app/services/.local/state.json', 'runtime/app/services/.env', 'runtime/app/services/private/secret.txt', 'runtime/app/services/config/settings.json', 'runtime/app/services/cache.sqlite']) assert.ok(!existsSync(join(destination, path)), path);
  assert.equal((await readFile(join(destination, 'runtime/app/VERSION'), 'utf8')).trim(), '1.2.3');
  assert.ok(!manifest.files.some(entry => entry.path === 'runtime-manifest.json'));
  for (const entry of manifest.files) assert.equal(createHash('sha256').update(await readFile(join(destination, entry.path))).digest('hex'), entry.sha256, entry.path);
});
test('rejects symlinked selected source content and source/destination overlap', async t => {
  const sourceRoot = await fixture(), destination = await mkdtemp(join(tmpdir(), 'rooms-stage-'));
  t.after(async () => Promise.all([rm(sourceRoot, { recursive: true, force: true }), rm(destination, { recursive: true, force: true })]));
  await symlink(join(sourceRoot, 'adapters'), join(sourceRoot, 'services', 'linked'), 'junction');
  await assert.rejects(() => stageRuntime(destination, { sourceRoot, nodeBinary: join(sourceRoot, 'node.exe') }), /symbolic links or junctions/);
  await assert.rejects(() => stageRuntime(join(sourceRoot, 'output'), { sourceRoot, nodeBinary: join(sourceRoot, 'node.exe') }), /must not overlap sourceRoot/);
});
test('refuses nonempty destinations and production staging without guardian', async t => {
  const sourceRoot = await fixture(), destination = await mkdtemp(join(tmpdir(), 'rooms-stage-'));
  t.after(async () => Promise.all([rm(sourceRoot, { recursive: true, force: true }), rm(destination, { recursive: true, force: true })]));
  await file(join(destination, 'stale.txt'));
  await assert.rejects(() => stageRuntime(destination, { sourceRoot, nodeBinary: join(sourceRoot, 'node.exe') }), /destination must be empty/);
  const emptyDestination = await mkdtemp(join(tmpdir(), 'rooms-stage-empty-')); t.after(() => rm(emptyDestination, { recursive: true, force: true }));
  await assert.rejects(() => stageRuntime(emptyDestination, { sourceRoot, nodeBinary: join(sourceRoot, 'node.exe'), requireGuardian: true }), /guardianBinary is required/);
});
