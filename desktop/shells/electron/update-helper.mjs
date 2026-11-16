import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const jobPath = process.argv[2];
if (!jobPath) process.exit(2);
const resultPath = join(dirname(jobPath), 'result.json');
let activeJob, installerExitCode = null;
async function persist(status, message, installerExitCode = null) { if (!activeJob) return; const target = join(activeJob.profile, 'updates', 'last-install-result.json'), temporary = `${target}.${process.pid}.tmp`; await mkdir(dirname(target), { recursive: true }); await writeFile(temporary, JSON.stringify({ id: activeJob.token, version: activeJob.version, status, message, at: new Date().toISOString(), installerExitCode })); await rename(temporary, target); }
const fail = async (code, message) => { await writeFile(resultPath, JSON.stringify({ ok: false, code, message })); await persist('failed', message, installerExitCode); if (activeJob?.appExe) spawn(activeJob.appExe, ['--profile', activeJob.profile, '--knowledge-root', activeJob.knowledgeRoot], { shell: false, detached: true, windowsHide: true, stdio: 'ignore' }).unref(); process.exitCode = 1; };
const exists = pid => { try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; } };
const within = (root, path) => { const value = relative(resolve(root), resolve(path)); return value && !value.startsWith('..') && !isAbsolute(value); };
try {
  const job = activeJob = JSON.parse(await readFile(jobPath, 'utf8'));
  const expected = join(resolve(job.profile), 'updates', 'downloads', job.version, `SessionRooms-${job.version}-x64-setup.exe`);
  if (!/^\d+\.\d+\.\d+$/.test(job.version) || !/^[a-f0-9]{64}$/.test(job.sha256) || resolve(job.installerPath).toLowerCase() !== resolve(expected).toLowerCase() || !within(join(job.profile, 'updates', 'downloads', job.version), job.installerPath) || basename(job.installerPath) !== basename(expected)) throw Error('UPDATE_HELPER_JOB_INVALID');
  const link = await lstat(job.installerPath), info = await stat(job.installerPath); if (!link.isFile() || link.isSymbolicLink() || info.size !== job.size || createHash('sha256').update(await readFile(job.installerPath)).digest('hex') !== job.sha256) throw Error('UPDATE_INSTALLER_HASH_INVALID');
  process.send?.({ type: 'ready', token: job.token });
  let committed = false, aborted = false; process.on('message', message => { if (message?.token !== job.token) return; if (message.type === 'commit') committed = true; if (message.type === 'abort') aborted = true; });
  await new Promise((resolveWait, rejectWait) => { const timer = setInterval(() => { if (aborted) { clearInterval(timer); rejectWait(Error('UPDATE_HANDOFF_ABORTED')); } if (committed && !process.connected && !exists(job.parentPid)) { clearInterval(timer); resolveWait(); } }, 100); });
  const verify = createHash('sha256').update(await readFile(job.installerPath)).digest('hex'); if (verify !== job.sha256) throw Error('UPDATE_INSTALLER_HASH_INVALID');
  const args = ['/VERYSILENT', '/NORESTART', '/SP-', `/DIR=${job.installDir}`];
  const installer = spawn(job.installerPath, args, { shell: false, detached: false, windowsHide: true, stdio: 'ignore' });
  const exitCode = await new Promise((resolveExit, reject) => { const timeout = setTimeout(() => { try { installer.kill(); } catch {} reject(Error('UPDATE_INSTALLER_TIMEOUT')); }, 120000); installer.once('error', error => { clearTimeout(timeout); reject(error); }); installer.once('exit', code => { clearTimeout(timeout); resolveExit(code); }); });
  installerExitCode = exitCode; if (exitCode !== 0) throw Error('UPDATE_INSTALLER_FAILED');
  const versionFile = join(job.installDir, 'resources', 'runtime', 'app', 'VERSION'); if ((await readFile(versionFile, 'utf8')).trim() !== job.version) throw Error('UPDATE_INSTALL_VERSION_INVALID');
  await writeFile(resultPath, JSON.stringify({ ok: true, version: job.version })); await persist('completed', 'Update installed.', exitCode);
  spawn(job.appExe, ['--profile', job.profile, '--knowledge-root', job.knowledgeRoot], { shell: false, detached: true, windowsHide: true, stdio: 'ignore' }).unref();
} catch (error) { await fail(String(error.message || 'UPDATE_HELPER_FAILED'), String(error.message || error)); }
