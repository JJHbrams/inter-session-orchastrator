import { access, copyFile, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { buildElectronRelease } from './release-electron.mjs';

const root = resolve(import.meta.dirname, '../..');
const hashFile = async path => createHash('sha256').update(await readFile(path)).digest('hex');
const installerName = appVersion => `SessionRooms-${appVersion}-x64-setup.exe`;
const quotePowerShell = value => value.replaceAll("'", "''");

function parseArguments(args) {
  let publishDir = root;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== '--publish-dir' || !args[index + 1]) throw new Error('Usage: release-installer.mjs [--publish-dir <directory>]');
    publishDir = resolve(args[index + 1]); index += 1;
  }
  return { publishDir };
}
async function readable(path) { try { await access(path); return true; } catch { return false; } }
async function findCompiler() {
  const candidates = [
    process.env.INNO_SETUP_COMPILER,
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Programs', 'Inno Setup 6', 'ISCC.exe'),
    process.env.ProgramFiles && join(process.env.ProgramFiles, 'Inno Setup 6', 'ISCC.exe'),
    process.env['ProgramFiles(x86)'] && join(process.env['ProgramFiles(x86)'], 'Inno Setup 6', 'ISCC.exe'),
  ].filter(Boolean).map(candidate => resolve(candidate));
  for (const candidate of candidates) if (await readable(candidate)) return candidate;
  throw new Error(`Inno Setup 6 compiler not found; checked ${candidates.join(', ')}`);
}
function run(command, args, { cwd = root, logFile, allowFailure = false } = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); let output = '';
    for (const stream of [child.stdout, child.stderr]) stream.on('data', value => { output += value; process.stdout.write(value); });
    child.once('error', reject); child.once('close', async code => { try {
      if (logFile) await writeFile(logFile, output);
      if (code === 0 || allowFailure) resolveRun(output); else reject(new Error(`${command} failed (${code})${output ? `: ${output.slice(-16000)}` : ''}`));
    } catch (error) { reject(error); }
    });
  });
}
async function compilerMetadata(compiler) {
  const fileVersionCommand = `$ErrorActionPreference='Stop'; [System.Diagnostics.FileVersionInfo]::GetVersionInfo('${quotePowerShell(compiler)}').FileVersion`;
  return { path: compiler, sha256: await hashFile(compiler), fileVersion: (await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', fileVersionCommand])).trim(), banner: (await run(compiler, ['/?'], { allowFailure: true })).trim() };
}
async function copyIdempotently(source, destination) {
  try {
    await copyFile(source, destination, constants.COPYFILE_EXCL); return hashFile(destination);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const [sourceHash, destinationHash] = await Promise.all([hashFile(source), hashFile(destination)]);
    if (sourceHash !== destinationHash) throw new Error(`Refusing to overwrite a different existing installer: ${destination}`);
    return destinationHash;
  }
}
export async function buildInstallerRelease({ sourceRoot = root, publishDir } = {}) {
  sourceRoot = resolve(sourceRoot); publishDir = resolve(publishDir || sourceRoot);
  const appVersion = (await readFile(join(sourceRoot, 'VERSION'), 'utf8')).trim();
  if (!/^\d+\.\d+\.\d+$/.test(appVersion)) throw new Error(`VERSION must be major.minor.patch: ${appVersion}`);
  const compiler = await findCompiler(), compilerInfo = await compilerMetadata(compiler);
  const portable = await buildElectronRelease({ sourceRoot });
  if (portable.version?.app !== appVersion || portable.version?.windows !== `${appVersion}.0`) throw new Error('portable release version does not match VERSION');
  const output = dirname(portable.package.folder), snapshot = join(output, 'source'), payload = portable.package.folder, installerDir = join(output, 'installer');
  await mkdir(installerDir, { recursive: true });
  const iss = join(snapshot, 'desktop', 'installer', 'session-rooms.iss'), packageRecord = join(payload, 'package-record.json'), releaseProvenance = join(output, 'release-provenance.json');
  await Promise.all([access(iss), access(packageRecord), access(releaseProvenance), access(join(payload, 'SessionRooms-Electron.exe'))]);
  const name = installerName(appVersion), stagedInstaller = join(installerDir, name), compilerLog = join(installerDir, 'inno-setup.log');
  await run(compiler, [`/DPayloadDir=${payload}`, `/DOutputDir=${installerDir}`, `/DAppVersion=${appVersion}`, `/DWindowsVersion=${appVersion}.0`, `/DSetupFilename=${name.slice(0, -4)}`, iss], { cwd: snapshot, logFile: compilerLog });
  await access(stagedInstaller);
  const installerHash = await hashFile(stagedInstaller), publishedInstaller = join(publishDir, name); await mkdir(publishDir, { recursive: true });
  const publishedHash = await copyIdempotently(stagedInstaller, publishedInstaller);
  if (publishedHash !== installerHash) throw new Error('published installer hash does not match staged installer');
  const provenance = { format: 'session-rooms-installer-release/v1', version: { app: appVersion, windows: `${appVersion}.0` }, source: portable.source, compiler: compilerInfo, iss: { path: 'source/desktop/installer/session-rooms.iss', sha256: await hashFile(iss) }, payload: { folder: portable.package.folder, zip: portable.package.zip, zipSha256: portable.package.zipSha256, packageRecord: 'SessionRooms-Electron-win32-x64/package-record.json', packageRecordSha256: await hashFile(packageRecord), releaseProvenance: 'release-provenance.json', releaseProvenanceSha256: await hashFile(releaseProvenance) }, setup: { staged: stagedInstaller, size: (await stat(stagedInstaller)).size, sha256: installerHash, published: publishedInstaller, publishedSha256: publishedHash }, compilerLog: 'installer/inno-setup.log' };
  await writeFile(join(output, 'installer-provenance.json'), JSON.stringify(provenance, null, 2));
  return provenance;
}
if (import.meta.main) console.log(JSON.stringify(await buildInstallerRelease(parseArguments(process.argv.slice(2)))));
