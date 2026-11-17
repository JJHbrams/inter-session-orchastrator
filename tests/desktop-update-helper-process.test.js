import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { access, cp, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, test } from 'node:test';

const root = await mkdtemp(join(tmpdir(), 'session-rooms-update-helper-e2e-'));
const helperSource = new URL('../desktop/shells/electron/update-helper.mjs', import.meta.url);
const pinnedNode = process.execPath;
const token = 'abcdefghijklmnop', version = '1.2.3';
let installerBinary, appBinary;

const installerProgram = String.raw`
use std::{env, fs, path::PathBuf, process::exit, thread, time::Duration};
fn main() {
    let args: Vec<String> = env::args().skip(1).collect();
    let target = args.iter().find_map(|arg| arg.strip_prefix("/DIR=")).expect("DIR");
    let install = PathBuf::from(target);
    let profile = PathBuf::from(env::var("ROOMS_TEST_PROFILE").unwrap());
    let marker = PathBuf::from(env::var("ROOMS_TEST_PARENT_EXITED").unwrap());
    fs::create_dir_all(install.join("resources/runtime/app")).unwrap();
    fs::write(install.join("resources/runtime/app/VERSION"), env::var("ROOMS_TEST_INSTALL_VERSION").unwrap()).unwrap();
    fs::write(profile.join("installer-observed.txt"), format!("parent_exited={}\nargs={:?}", marker.exists(), args)).unwrap();
    if let Ok(path) = env::var("ROOMS_TEST_RELEASE_FILE") { while !PathBuf::from(&path).exists() { thread::sleep(Duration::from_millis(20)); } }
    thread::sleep(Duration::from_millis(env::var("ROOMS_TEST_INSTALL_DELAY_MS").unwrap().parse().unwrap()));
    exit(env::var("ROOMS_TEST_INSTALL_EXIT").unwrap().parse().unwrap());
}`;
const appProgram = String.raw`
use std::{env, fs, path::PathBuf};
fn main() {
    let args: Vec<String> = env::args().skip(1).collect();
    let profile = PathBuf::from(args.windows(2).find(|pair| pair[0] == "--profile").unwrap()[1].clone());
    let result = fs::read_to_string(profile.join("updates/last-install-result.json")).unwrap_or_else(|_| "MISSING".to_string());
    fs::write(profile.join("restart-observed.txt"), format!("profile={}\nargs={:?}\nresult={}", profile.display(), args, result)).unwrap();
}`;
const hostProgram = String.raw`
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
const [node, helper, jobFile, mode, parentExited] = process.argv.slice(2);
const job = JSON.parse(await readFile(jobFile, 'utf8'));
job.parentPid = process.pid;
await writeFile(jobFile, JSON.stringify(job));
const child = spawn(node, [helper, jobFile], { detached: true, shell: false, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
child.once('error', error => { console.error(error.stack); process.exit(2); });
child.once('exit', async code => { console.error('helper exited before handoff: ' + code + ' ' + await readFile(new URL('result.json', new URL('file:///' + jobFile.replaceAll('\\\\', '/'))), 'utf8').catch(() => 'no result')); process.exit(3); });
child.on('message', async message => {
  if (message?.type !== 'ready' || message.token !== job.token) return;
  if (mode === 'commit') child.send({ type: 'commit', token: job.token });
  if (mode === 'abort') child.send({ type: 'abort', token: job.token });
  child.disconnect();
  await writeFile(parentExited, 'host exited');
  process.exit(0);
});
`;

function command(file, args, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(file, args, { shell: false, windowsHide: true, ...options });
    let stderr = '';
    child.stderr?.on('data', chunk => { stderr += chunk; });
    child.once('error', rejectRun);
    child.once('exit', code => code === 0 ? resolveRun() : rejectRun(Error(`${file} exited ${code}: ${stderr}`)));
  });
}
async function eventually(path, timeout = 10000) {
  const until = Date.now() + timeout;
  for (;;) {
    try { await access(path); return; } catch {}
    if (Date.now() >= until) throw Error(`Timed out waiting for ${path}`);
    await new Promise(resolveWait => setTimeout(resolveWait, 40));
  }
}
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

before(async () => {
  assert.equal(process.versions.node, '24.14.1', 'Run helper-process verification with the pinned Node toolchain');
  await access(pinnedNode);
  const installerSource = join(root, 'fake-installer.rs'), appSource = join(root, 'fake-app.rs');
  installerBinary = join(root, 'fake-installer.exe'); appBinary = join(root, 'fake-app.exe');
  await writeFile(installerSource, installerProgram); await writeFile(appSource, appProgram);
  await command('rustc', [installerSource, '-O', '-o', installerBinary]);
  await command('rustc', [appSource, '-O', '-o', appBinary]);
});
after(async () => { await rm(root, { recursive: true, force: true }); });

async function fixture(t, { installedVersion = version, installerExit = 0, installerDelay = 0 } = {}) {
  const profile = await mkdtemp(join(root, 'profile-'));
  const helpers = join(profile, 'updates', 'helpers', token), downloads = join(profile, 'updates', 'downloads', version);
  const installDir = join(profile, 'installed'), appExe = join(installDir, 'SessionRooms-Electron.exe');
  await mkdir(helpers, { recursive: true }); await mkdir(downloads, { recursive: true }); await mkdir(installDir, { recursive: true }); await mkdir(join(profile, 'knowledge'), { recursive: true });
  await cp(pinnedNode, join(helpers, 'node.exe')); await cp(helperSource, join(helpers, 'update-helper.mjs')); await cp(appBinary, appExe);
  const installerPath = join(downloads, `SessionRooms-${version}-x64-setup.exe`); await cp(installerBinary, installerPath);
  const bytes = await readFile(installerPath), parentExited = join(profile, 'host-exited');
  const job = { token, version, installerPath, sha256: digest(bytes), size: bytes.length, releaseUrl: 'https://example.test/releases/1.2.3', profile, installDir, appExe, knowledgeRoot: join(profile, 'knowledge'), parentPid: process.pid };
  const jobFile = join(helpers, 'job.json'), hostFile = join(helpers, 'fixture-host.mjs');
  await writeFile(jobFile, JSON.stringify(job)); await writeFile(hostFile, hostProgram);
  const env = { ...process.env, ROOMS_TEST_PROFILE: profile, ROOMS_TEST_PARENT_EXITED: parentExited, ROOMS_TEST_INSTALL_VERSION: installedVersion, ROOMS_TEST_INSTALL_EXIT: String(installerExit), ROOMS_TEST_INSTALL_DELAY_MS: String(installerDelay), ROOMS_UPDATE_HELPER_HANDOFF_TIMEOUT_MS: '400' };
  return { profile, helpers, installDir, appExe, installerPath, job, jobFile, hostFile, parentExited, env };
}
async function host(value, mode) {
  await command(pinnedNode, [value.hostFile, join(value.helpers, 'node.exe'), join(value.helpers, 'update-helper.mjs'), value.jobFile, mode, value.parentExited], { env: value.env });
}
async function result(value) { await eventually(join(value.helpers,'result.json'));return JSON.parse(await readFile(join(value.helpers, 'result.json'), 'utf8')); }
async function finalResult(value){const until=Date.now()+10000;for(;;){const r=await result(value);if(r.ok===true)return r;if(Date.now()>until)throw Error('Final installation result missing');await new Promise(done=>setTimeout(done,20));}}

test('real copied helper waits for the host exit, persists completion, then restarts the old app with exact profile', async t => {
  const value = await fixture(t); await host(value, 'commit');
  await eventually(join(value.profile, 'restart-observed.txt'));
  const install = await readFile(join(value.profile, 'installer-observed.txt'), 'utf8');
  const restarted = await readFile(join(value.profile, 'restart-observed.txt'), 'utf8');
  const persisted = JSON.parse(await readFile(join(value.profile, 'updates', 'last-install-result.json'), 'utf8'));
  assert.match(install, /parent_exited=true/); assert.match(install, /\/SILENT/); assert.match(install, /\/NORESTART/); assert.match(install, /\/SP-/); assert.ok(install.includes(`/DIR=${value.installDir.replaceAll('\\', '\\\\')}`));
  assert.equal(persisted.status, 'completed'); assert.equal(persisted.version, version); assert.match(restarted, /--profile/); assert.match(restarted, new RegExp(value.profile.replace(/[\\]/g, '\\\\'))); assert.match(restarted, /"status":"completed"/);
  assert.deepEqual(await result(value), { ok: true, version });
});

test('pre-handoff hash tampering executes neither installer nor restart', async t => {
  const value = await fixture(t); await writeFile(value.installerPath, 'tampered'); const child = spawn(join(value.helpers, 'node.exe'), [join(value.helpers, 'update-helper.mjs'), value.jobFile], { shell: false, windowsHide: true, env: value.env, stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });
  await new Promise(resolveExit => child.once('exit', resolveExit));
  assert.equal((await result(value)).code, 'UPDATE_INSTALLER_HASH_INVALID');
  await assert.rejects(() => readFile(join(value.profile, 'installer-observed.txt'))); await assert.rejects(() => readFile(join(value.profile, 'restart-observed.txt'))); await assert.rejects(() => readFile(join(value.profile, 'updates', 'last-install-result.json')));
});

test('wrong installed VERSION is persisted as failure and recovers the validated old app', async t => {
  const value = await fixture(t, { installedVersion: '9.9.9' }); await host(value, 'commit'); await eventually(join(value.profile, 'restart-observed.txt'));
  assert.equal((await result(value)).code, 'UPDATE_INSTALL_VERSION_INVALID'); const persisted = JSON.parse(await readFile(join(value.profile, 'updates', 'last-install-result.json'), 'utf8')); assert.equal(persisted.status, 'failed'); assert.match(await readFile(join(value.profile, 'restart-observed.txt'), 'utf8'), /"status":"failed"/);
});

test('nonzero installer exit is persisted as failure and recovers the validated old app', async t => {
  const value = await fixture(t, { installerExit: 23 }); await host(value, 'commit'); await eventually(join(value.profile, 'restart-observed.txt'));
  assert.equal((await result(value)).code, 'UPDATE_INSTALLER_FAILED'); const persisted = JSON.parse(await readFile(join(value.profile, 'updates', 'last-install-result.json'), 'utf8')); assert.equal(persisted.status, 'failed'); assert.equal(persisted.installerExitCode, 23);
});

test('installer still-running notice does not kill it and eventual success replaces the notice before restart', async t => {
  const value = await fixture(t);value.env.ROOMS_TEST_RELEASE_FILE=join(value.profile,'continue-installer'); value.env.ROOMS_UPDATE_HELPER_INSTALLER_NOTICE_MS = '25'; await host(value, 'commit');
  await eventually(join(value.helpers, 'result.json')); const notice = await result(value); assert.equal(notice.code, 'UPDATE_INSTALLER_STILL_RUNNING');await writeFile(value.env.ROOMS_TEST_RELEASE_FILE,'continue');
  await eventually(join(value.profile, 'restart-observed.txt')); assert.deepEqual(await finalResult(value), { ok: true, version });
  const persisted = JSON.parse(await readFile(join(value.profile, 'updates', 'last-install-result.json'), 'utf8')); assert.equal(persisted.status, 'completed');
});

test('abort before handoff leaves no installer, restart, result, or orphaned helper work', async t => {
  const value = await fixture(t); await host(value, 'abort'); await new Promise(resolveWait => setTimeout(resolveWait, 550));
  await assert.rejects(() => readFile(join(value.profile, 'installer-observed.txt'))); await assert.rejects(() => readFile(join(value.profile, 'restart-observed.txt'))); await assert.rejects(() => readFile(join(value.helpers, 'result.json'))); await assert.rejects(() => readFile(join(value.profile, 'updates', 'last-install-result.json')));
});
