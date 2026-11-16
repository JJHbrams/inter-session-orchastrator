import { mkdir, readdir, readFile, lstat, writeFile, copyFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const RUNTIME_SOURCES = ['services', 'adapters', 'packages', 'apps/desktop', 'desktop/runtime'];
const EXCLUDED_NAMES = new Set(['.git', '.local', '.env', '.idea', '.vscode', 'config', 'configs', 'coverage', 'dev', 'development', 'docs', 'examples', 'private', 'test', 'tests', '__tests__']);
const EXCLUDED_EXTENSIONS = new Set(['.db', '.mdb', '.sqlite', '.sqlite3']);
function isExcluded(name) { const normalized = name.toLowerCase(); return EXCLUDED_NAMES.has(normalized) || normalized.startsWith('.env.') || EXCLUDED_EXTENSIONS.has(normalized.slice(normalized.lastIndexOf('.'))); }
async function checkedStat(path, label = path) { const info = await lstat(path); if (info.isSymbolicLink()) throw new Error(`runtime staging rejects symbolic links or junctions: ${label}`); return info; }
async function copyTree(source, destination) { const info = await checkedStat(source); if (info.isDirectory()) { await mkdir(destination, { recursive: true }); for (const entry of await readdir(source)) if (!isExcluded(entry)) await copyTree(join(source, entry), join(destination, entry)); return; } if (!info.isFile()) throw new Error(`runtime staging only accepts regular files: ${source}`); await mkdir(dirname(destination), { recursive: true }); await copyFile(source, destination); }
async function hashes(directory) { const output = []; async function walk(path) { for (const name of await readdir(path)) { const full = join(path, name); const info = await checkedStat(full, relative(directory, full)); if (info.isDirectory()) await walk(full); else if (info.isFile()) output.push({ path: relative(directory, full).replaceAll('\\', '/'), sha256: createHash('sha256').update(await readFile(full)).digest('hex') }); else throw new Error(`runtime staging only manifests regular files: ${full}`); } } await walk(directory); return output.sort((a, b) => a.path.localeCompare(b.path)); }
async function assertEmptyDestination(out) { if (!existsSync(out)) return; const info = await checkedStat(out, out); if (!info.isDirectory()) throw new Error(`runtime destination must be a directory: ${out}`); if ((await readdir(out)).length) throw new Error(`runtime destination must be empty: ${out}`); }
function assertNoOverlap(out, sourceRoot) {
  const contains = (parent, child) => { const part = relative(parent, child); return part === '' || (part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part)); };
  if (contains(sourceRoot, out) || contains(out, sourceRoot)) throw new Error('runtime destination must not overlap sourceRoot');
}
async function rejectLinkedAncestors(path) {
  for (let current = resolve(path); ; current = dirname(current)) {
    if (existsSync(current)) await checkedStat(current, current);
    if (dirname(current) === current) break;
  }
}
async function copyRequiredFile(source, destination, label) { const info = await checkedStat(source, label); if (!info.isFile()) throw new Error(`runtime staging requires a regular file: ${label}`); await mkdir(dirname(destination), { recursive: true }); await copyFile(source, destination); }
export async function stageRuntime(destination, { sourceRoot = resolve(import.meta.dirname, '../..'), nodeBinary = process.execPath, guardianBinary, requireGuardian = false } = {}) {
  if (!destination) throw new Error('runtime destination is required');
  const out = resolve(destination), source = resolve(sourceRoot);
  assertNoOverlap(out, source); await rejectLinkedAncestors(source); await rejectLinkedAncestors(out); await checkedStat(source, 'sourceRoot'); await assertEmptyDestination(out);
  if (requireGuardian && !guardianBinary) throw new Error('guardianBinary is required for production runtime staging');
  if (guardianBinary && !existsSync(guardianBinary)) throw new Error(`guardian binary does not exist: ${guardianBinary}`);
  const runtime = join(out, 'runtime'), app = join(runtime, 'app'); await mkdir(app, { recursive: true });
  await copyRequiredFile(nodeBinary, join(runtime, process.platform === 'win32' ? 'node.exe' : basename(nodeBinary)), 'node binary');
  if (guardianBinary) await copyRequiredFile(guardianBinary, join(runtime, 'guardian.exe'), 'guardian binary');
  for (const part of RUNTIME_SOURCES) await copyTree(join(source, part), join(app, part));
  await copyRequiredFile(join(source, 'package.json'), join(app, 'package.json'), 'package.json');
  await copyRequiredFile(join(source, 'VERSION'), join(app, 'VERSION'), 'VERSION');
  for (const dependency of ['marked', 'dompurify']) await copyTree(join(source, 'node_modules', dependency), join(app, 'node_modules', dependency));
  const nodeLicense = join(dirname(nodeBinary), 'LICENSE'), hasNodeLicense = existsSync(nodeLicense);
  if (hasNodeLicense) await copyRequiredFile(nodeLicense, join(runtime, 'NODE_LICENSE'), 'Node.js LICENSE');
  const manifest = { format: 'session-rooms-desktop-runtime/v1', files: await hashes(out), guardian: guardianBinary ? 'included' : 'not-provided', licenses: { node: hasNodeLicense ? 'included' : 'missing' } };
  await writeFile(join(out, 'runtime-manifest.json'), JSON.stringify(manifest, null, 2)); return manifest;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) { const [destination, flag, guardianBinary] = process.argv.slice(2); if (!destination || flag !== '--guardian' || !guardianBinary) throw new Error('usage: stage-runtime.mjs <destination> --guardian <guardian.exe>'); await stageRuntime(destination, { guardianBinary, requireGuardian: true }); }
