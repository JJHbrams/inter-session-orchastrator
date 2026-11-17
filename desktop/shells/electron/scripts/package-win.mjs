import { access, cp, mkdir, rename, rm, readdir, readFile, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { embedWindowsIcon, stampWindowsVersion, verifyEmbeddedWindowsIcon, verifyWindowsVersionResources } from './windows-icon.mjs';
const run = promisify(execFile);
const APP_FILES = ['main.mjs','office-smoke.mjs','core.mjs','directory-picker.mjs','lifecycle.mjs','updater.mjs','update-helper.mjs','package.json','preload.cjs','utility-probe.cjs'];
const root = resolve(import.meta.dirname, '..');
const WINDOWS_ARCHIVE_MODULE = "$ErrorActionPreference='Stop'; Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Archive/Microsoft.PowerShell.Archive.psd1') -Force;";
async function absent(path) { try { await access(path); return false; } catch (error) { if (error.code === 'ENOENT') return true; throw error; } }
async function fileHash(path) { return createHash('sha256').update(await readFile(path)).digest('hex'); }
async function readReleaseVersion(appSource) {
  const [versionSource, packageSource] = await Promise.all([readFile(join(appSource, '..', '..', '..', 'VERSION'), 'utf8'), readFile(join(appSource, 'package.json'), 'utf8')]);
  const appVersion = versionSource.trim(), packageVersion = JSON.parse(packageSource).version;
  if (!/^\d+\.\d+\.\d+$/.test(appVersion)) throw new Error(`VERSION must be major.minor.patch: ${appVersion}`);
  if (packageVersion !== appVersion) throw new Error(`Electron package version ${packageVersion} does not match VERSION ${appVersion}`);
  return appVersion;
}
export async function packageWindows({ runtime, electronSource = join(root, 'node_modules', 'electron', 'dist'), appSource = root, destination, outputName = 'SessionRooms-Electron-win32-x64' } = {}) {
  if (!runtime || !destination) throw new Error('runtime and destination are required');
  runtime = resolve(runtime); electronSource = resolve(electronSource); appSource = resolve(appSource); destination = resolve(destination);
  for (const file of ['guardian.exe','node.exe','app/desktop/runtime/entry.mjs']) await access(join(runtime,file),constants.R_OK);
  const runtimeManifest = join(dirname(runtime), 'runtime-manifest.json');
  const iconDirectory = join(runtime, 'app', 'apps', 'desktop', 'assets', 'brand');
  const icon = join(iconDirectory, 'session-rooms.ico');
  await access(runtimeManifest, constants.R_OK);
  await access(icon, constants.R_OK);
  await access(join(iconDirectory, 'session-rooms-256.png'), constants.R_OK);
  for (const file of APP_FILES) await access(join(appSource,file),constants.R_OK);
  await access(join(electronSource,'electron.exe'),constants.R_OK);
  if (!await absent(destination)) throw new Error(`Refusing to overwrite existing output: ${destination}`);
  const zip = `${destination}.zip`; if (!await absent(zip)) throw new Error(`Refusing to overwrite existing archive: ${zip}`);
  await mkdir(join(destination,'resources','app'),{recursive:true});
  await cp(electronSource,destination,{recursive:true});
  await rm(join(destination,'resources','default_app.asar'),{force:true});
  const executable = join(destination,'SessionRooms-Electron.exe'); await rename(join(destination,'electron.exe'),executable);
  const appVersion = await readReleaseVersion(appSource), windowsVersion = await stampWindowsVersion(executable, appVersion);
  await embedWindowsIcon(executable, icon);
  const [embeddedIcon, versionResources] = await Promise.all([verifyEmbeddedWindowsIcon(executable, icon), verifyWindowsVersionResources(executable, appVersion)]);
  for (const file of APP_FILES) await cp(join(appSource,file),join(destination,'resources','app',file));
  await cp(runtime,join(destination,'resources','runtime'),{recursive:true});
  await cp(runtimeManifest,join(destination,'resources','runtime-manifest.json'));
  const licenseDirectory = join(destination, 'licenses', 'electron'); await mkdir(licenseDirectory, { recursive: true });
  for (const file of await readdir(electronSource)) if (/^LICENSE/i.test(file)) await cp(join(electronSource,file),join(licenseDirectory,file));
  const appDirectory = join(destination,'resources','app');
  const checksums = Object.fromEntries(await Promise.all(APP_FILES.map(async file => [file, await fileHash(join(appDirectory,file))])));
  const exeSha256 = await fileHash(executable), iconSourceSha256 = await fileHash(icon);
  const version = { app: appVersion, windows: windowsVersion, resources: versionResources };
  await writeFile(join(destination,'package-record.json'),JSON.stringify({format:'session-rooms-electron-package/v2',outputName,version,shellVersion:appVersion,appChecksums:checksums,runtimeManifest:'resources/runtime-manifest.json',icon:{source:'resources/runtime/app/apps/desktop/assets/brand/session-rooms.ico',sourceSha256:iconSourceSha256,windowPng:'resources/runtime/app/apps/desktop/assets/brand/session-rooms-256.png',embedded:embeddedIcon,exeSha256},licenses:{node:'resources/runtime/NODE_LICENSE',electron:'licenses/electron'}},null,2));
  const quote = path => path.replace(/'/g,"''");
  await run('powershell.exe',['-NoProfile','-NonInteractive','-Command',`${WINDOWS_ARCHIVE_MODULE} Compress-Archive -LiteralPath '${quote(destination)}' -DestinationPath '${quote(zip)}' -ErrorAction Stop`], { windowsHide: true });
  return {type:'package',folder:destination,exe:join(destination,'SessionRooms-Electron.exe'),zip,version,icon:{sourceSha256:iconSourceSha256,exeSha256,embedded:embeddedIcon}};
}
if (import.meta.main) {
  const [runtime, outputName] = process.argv.slice(2);
  if (!runtime) throw new Error('Usage: package-win.mjs <absolute-staged-runtime-dir> [output-name]');
  console.log(JSON.stringify(await packageWindows({runtime,outputName,destination:join(root,'dist',outputName || 'SessionRooms-Electron-win32-x64')})));
}
