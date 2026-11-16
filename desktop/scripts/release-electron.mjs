import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync, appendFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import net from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { prepareToolchains, ensureVerifiedFile, sha256 } from './prepare-toolchains.mjs';
import { stageRuntime } from './stage-runtime.mjs';
import { packageWindows } from '../shells/electron/scripts/package-win.mjs';

const root = resolve(import.meta.dirname, '../..');
const metadata = JSON.parse(await readFile(join(root, 'desktop/toolchains.json'), 'utf8'));
const WINDOWS_ARCHIVE_MODULE = "$ErrorActionPreference='Stop'; Import-Module (Join-Path $PSHOME 'Modules/Microsoft.PowerShell.Archive/Microsoft.PowerShell.Archive.psd1') -Force;";
let validationLog;
const run = (command, args, { cwd = root, capture = false } = {}) => new Promise((resolveRun, reject) => {
  if (validationLog) appendFileSync(validationLog, `\n> ${command} ${args.join(' ')}\n`);
  const child = spawn(command, args, { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, npm_config_cache: join(root, '.local', 'npm-cache') } });
  let stdout = '', stderr = '';
  for (const [stream, target] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) stream.on('data', value => {
    if (validationLog) appendFileSync(validationLog, value);
    if (!capture) target.write(value);
    if (stream === child.stdout) stdout += value; else stderr += value;
  });
  child.once('error', reject); child.once('close', (code, signal) => code === 0 ? resolveRun({ stdout, stderr }) : reject(new Error(`${command} ${args.join(' ')} failed (${code ?? signal})${stderr ? `: ${stderr.slice(-16000)}` : ''}`)));
});
const quotedPowerShell = path => path.replace(/'/g, "''");
function buildId(sha) { return `${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${sha.slice(0, 12)}`; }
async function mustNotExist(path) { if (existsSync(path)) throw new Error(`Refusing to overwrite existing release path: ${path}`); }
export function validateSmokeOutput(stdout) {
  const records = stdout.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
  const record = records[0];
  if (records.length !== 1 || record?.type !== 'electron-smoke') throw new Error('packaged smoke test must emit exactly one electron-smoke JSON record');
  if (record.passed !== true || record.renderer?.officePixiReady !== true || record.renderer?.officeIdleAnimated !== true || record.renderer?.officePixiFrames !== true || record.renderer?.officeChairCrowned !== true || record.renderer?.officeChairFacingParticipants !== true || record.renderer?.officeSeatedParticipants !== true || record.renderer?.officeSceneTransitions !== true || record.renderer?.officeEntryAnimated !== true || record.renderer?.officeExitAnimated !== true || record.renderer?.officeWorkSeated !== true || record.renderer?.officeIdleRegistrationStable !== true || record.renderer?.officeWorkHeadScaleStable !== true || record.renderer?.officeSpritesLoaded !== true || record.renderer?.officeAvailable !== true || record.renderer?.officeArtworkLoaded !== true || record.renderer?.documentReady !== true || record.renderer?.appPresent !== true || record.renderer?.bootstrap !== true || record.renderer?.authenticatedRead !== true || record.renderer?.folderPickerAvailable !== true || record.renderer?.folderPickerGuarded !== true || record.renderer?.updateInstallerAvailable !== true || record.renderer?.updateInstallerGuarded !== true || record.shutdown?.normal !== true || record.shutdown?.forced !== false || record.shutdown?.exitCode !== 0 || record.shutdown?.signalCode !== null) throw new Error('packaged smoke record does not prove a normal renderer and shutdown');
  if (!Number.isInteger(record.childPid) || record.childPid < 1) throw new Error('packaged smoke runtime PID is invalid');
  const url = new URL(record.origin);
  if (url.hostname !== '127.0.0.1' || url.protocol !== 'http:' || !url.port || url.username || url.password || url.search || url.hash || url.origin !== record.origin) throw new Error('packaged smoke origin is invalid');
  return record;
}
async function smoke(executable, profile) {
  return new Promise((resolveSmoke, reject) => {
    const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
    const child = spawn(executable, ['--smoke-test', '--profile', profile], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], env }); let stdout = '', stderr = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('packaged smoke test timed out after 45 seconds')); }, 45000);
    child.stdout.on('data', value => stdout += value); child.stderr.on('data', value => stderr += value);
    child.once('error', error => { clearTimeout(timer); reject(error); }); child.once('close', async (code, signal) => { clearTimeout(timer); try {
      if (code !== 0 || signal) throw new Error(`packaged smoke test failed (${code ?? signal}): ${stderr}`);
      const record = validateSmokeOutput(stdout);
      if (await processAlive(record.childPid)) throw new Error('packaged smoke child process remains alive after host exit');
      if (!await originUnavailable(record.origin)) throw new Error('packaged smoke origin remains reachable after host exit');
      resolveSmoke(record);
    } catch (error) { reject(error); } });
  });
}
async function processAlive(pid) { try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; } }
async function originUnavailable(origin) {
  let url; try { url = new URL(origin); } catch { return false; }
  return await new Promise(resolveProbe => { const socket = net.connect({ host: url.hostname, port: Number(url.port || 80) }); const done = value => { socket.destroy(); resolveProbe(value); }; socket.once('connect', () => done(false)); socket.once('error', () => done(true)); setTimeout(() => done(false), 1000).unref(); });
}
export async function buildElectronRelease({ sourceRoot = root } = {}) {
  sourceRoot = resolve(sourceRoot);
  const dirty = await run('git', ['status', '--porcelain'], { cwd: sourceRoot, capture: true }); if (dirty.stdout.trim()) throw new Error('Release source must be clean; refusing to archive dirty worktree');
  const sha = (await run('git', ['rev-parse', 'HEAD'], { cwd: sourceRoot, capture: true })).stdout.trim(); const id = buildId(sha);
  const output = join(sourceRoot, 'dist', id), snapshotZip = join(output, 'source.zip'), snapshot = join(output, 'source'); await mustNotExist(output); await mkdir(output, { recursive: true });
  validationLog = join(output, 'validation.log');
  try {
    await run('git', ['-c', 'core.autocrlf=false', 'archive', '--format=zip', `--output=${snapshotZip}`, sha], { cwd: sourceRoot });
    await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `${WINDOWS_ARCHIVE_MODULE} Expand-Archive -LiteralPath '${quotedPowerShell(snapshotZip)}' -DestinationPath '${quotedPowerShell(snapshot)}' -ErrorAction Stop`]);
    const tools = await prepareToolchains({ destination: join(sourceRoot, '.local', 'toolchains') });
    const node = tools.node.path;
    const npmCli = [process.env.npm_execpath, join(dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js')].find(path => path && existsSync(path));
    if (!npmCli) throw new Error('npm CLI not found; invoke this build via npm run build:electron');
    await run(node, [npmCli, 'ci', '--ignore-scripts', '--no-audit', '--no-fund', '--cache', join(sourceRoot, '.local', 'npm-cache')], { cwd: snapshot });
    const cargoVersion = (await run('cargo', ['--version'], { cwd: snapshot, capture: true })).stdout.trim();
    const rustcVersion = (await run('rustc', ['--version'], { cwd: snapshot, capture: true })).stdout.trim();
    await run(node, ['desktop/scripts/build-pixi.mjs','--check'], { cwd: snapshot });
    await run(node, ['desktop/scripts/verify-web.mjs'], { cwd: snapshot });
    await run(node, ['desktop/scripts/verify-electron.mjs'], { cwd: snapshot });
    const stageDirectory = join(output, 'runtime-stage'); await mkdir(stageDirectory, { recursive: true });
    const guardian = join(snapshot, 'desktop', 'guardian', 'target', 'release', 'guardian.exe');
    const runtime = await stageRuntime(stageDirectory, { sourceRoot: snapshot, nodeBinary: node, guardianBinary: guardian, requireGuardian: true });
    const electronArchive = await ensureVerifiedFile(metadata.electron, join(sourceRoot, '.local', 'toolchains', metadata.electron.archive));
    const electronSource = join(output, 'electron'); await mustNotExist(electronSource);
    await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `${WINDOWS_ARCHIVE_MODULE} Expand-Archive -LiteralPath '${quotedPowerShell(electronArchive.path)}' -DestinationPath '${quotedPowerShell(electronSource)}' -ErrorAction Stop`]);
    const appSource = join(snapshot, 'desktop', 'shells', 'electron'); const packageOutput = join(output, 'SessionRooms-Electron-win32-x64');
    const packaged = await packageWindows({ runtime: join(stageDirectory, 'runtime'), electronSource, appSource, destination: packageOutput });
    const smokeRecord = await smoke(packaged.exe, join(output, 'smoke-profile')); const provenance = { format: 'session-rooms-electron-release/v1', buildId: id, source: { commit: sha, archive: 'source.zip', sha256: await sha256(snapshotZip) }, version: packaged.version, tools: { node: { version: metadata.node.version, sha256: await sha256(node) }, electron: { version: metadata.electron.version, archiveSha256: await sha256(electronArchive.path) }, cargo: cargoVersion, rustc: rustcVersion }, tests: { web: 'passed', electron: 'passed', packagedSmoke: 'passed' }, validationLog: 'validation.log', runtimeManifest: runtime, package: { ...packaged, zipSha256: await sha256(packaged.zip) }, smoke: smokeRecord };
    await writeFile(join(output, 'release-provenance.json'), JSON.stringify(provenance, null, 2)); return provenance;
  } catch (error) { throw error; }
}
if (import.meta.main) console.log(JSON.stringify(await buildElectronRelease()));
