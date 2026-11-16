import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import test from 'node:test';

const root = resolve(import.meta.dirname, '..');
const guardian = resolve(root, 'desktop', 'guardian', 'target', 'release', 'guardian.exe');
const fixture = resolve(root, 'tests', 'fixtures', 'guardian-child.mjs');
const parentFixture = resolve(root, 'tests', 'fixtures', 'guardian-parent.mjs');
const sentinelFixture = resolve(root, 'tests', 'fixtures', 'guardian-grandchild.mjs');

const delay = milliseconds => new Promise(resolveDelay => setTimeout(resolveDelay, milliseconds));
const exitOf = child => new Promise(resolveExit => child.once('exit', (code, signal) => resolveExit({ code, signal })));

async function lineEvents(child, count) {
  const events = [];
  let buffer = '';
  return new Promise((resolveEvents, reject) => {
    child.stdout.on('data', chunk => {
      buffer += chunk;
      for (;;) {
        const newline = buffer.indexOf('\n');
        if (newline < 0) break;
        events.push(JSON.parse(buffer.slice(0, newline)));
        buffer = buffer.slice(newline + 1);
        if (events.length === count) resolveEvents(events);
      }
    });
    child.once('error', reject);
    child.once('exit', code => reject(new Error(`fixture exited before readiness: ${code}`)));
  });
}

function fingerprint(pid) {
  const script = `$process = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if ($null -ne $process) { $process.StartTime.ToUniversalTime().Ticks }; exit 0`;
  const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const value = result.stdout.trim();
  return value === '' ? null : value;
}

async function waitForGone(pid, originalFingerprint) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (fingerprint(pid) !== originalFingerprint) return;
    await delay(50);
  }
  assert.fail(`owned process ${pid} remained alive after the grace period`);
}

function killOwned(child) {
  if (!child.killed) child.kill('SIGTERM');
}

test('guardian rejects malformed invocation without starting a child', { skip: process.platform !== 'win32' }, () => {
  const result = spawnSync(guardian, ['--profile', 'relative'], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /INVALID_ARGUMENT/);
});

test('guardian rejects a claimed parent that is not its OS parent before creating Node', { skip: process.platform !== 'win32' }, () => {
  const profile = mkdtempSync(resolve(tmpdir(), 'guardian wrong parent '));
  const result = spawnSync(guardian, ['--node', process.execPath, '--entry', fixture, '--profile', profile, '--parent-pid', '4'], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /PARENT_PID_MISMATCH/);
});

test('guardian rejects a filesystem-root profile before acquiring a lock', { skip: process.platform !== 'win32' }, () => {
  const rootProfile = resolve(tmpdir()).slice(0, 3);
  const result = spawnSync(guardian, ['--node', process.execPath, '--entry', fixture, '--profile', rootProfile, '--parent-pid', String(process.pid)], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stdout, /profile must not be a filesystem root/);
});

test('guardian owns an exclusive profile and releases it after child shutdown', { skip: process.platform !== 'win32' }, async () => {
  assert.ok(existsSync(guardian), 'run desktop/scripts/build-guardian.mjs first');
  const profile = mkdtempSync(resolve(tmpdir(), 'guardian profile 한글 '));
  const command = () => spawn(guardian, ['--node', process.execPath, '--entry', fixture, '--profile', profile, '--parent-pid', String(process.pid)], { stdio: ['pipe', 'pipe', 'pipe'] });
  const first = command();
  const ready = await new Promise((resolveReady, reject) => { let out = ''; first.stdout.on('data', chunk => { out += chunk; if (out.includes('\n')) resolveReady(out); }); first.once('error', reject); });
  assert.match(ready, /session-rooms-desktop\/v1/);
  const second = await new Promise(resolveExit => { const p = command(); let out = ''; p.stdout.on('data', c => out += c); p.on('close', code => resolveExit({ code, out })); });
  assert.notEqual(second.code, 0);
  assert.match(second.out, /PROFILE_IN_USE/);
  const firstClosed = new Promise(resolveExit => first.once('close', resolveExit));
  first.stdin.end(JSON.stringify({ type: 'shutdown' }) + '\n');
  await firstClosed;
  const third = command();
  const thirdReady = await new Promise(resolveReady => { let out = ''; third.stdout.on('data', c => { out += c; if (out.includes('\n')) resolveReady(out); }); });
  assert.match(thirdReady, /ready/);
  const thirdClosed = new Promise(resolveExit => third.once('close', resolveExit));
  third.stdin.end();
  await thirdClosed;
});

for (const [name, endGuardian] of [
  ['intermediary parent ends', parent => killOwned(parent)],
  ['guardian ends abruptly', parent => parent.stdin.end('terminate guardian\n')],
]) {
  test(`guardian job kills only owned descendants when ${name}`, { skip: process.platform !== 'win32', concurrency: false }, async () => {
    assert.ok(existsSync(guardian), 'run desktop/scripts/build-guardian.mjs first');
    const profile = mkdtempSync(resolve(tmpdir(), 'guardian abnormal death '));
    const parent = spawn(process.execPath, [parentFixture, guardian, process.execPath, fixture, profile], { stdio: ['pipe', 'pipe', 'pipe'] });
    const sentinel = spawn(process.execPath, [sentinelFixture], { stdio: 'ignore' });
    const parentExit = exitOf(parent);
    const sentinelExit = exitOf(sentinel);
    const sentinelFingerprint = fingerprint(sentinel.pid);
    try {
      const [started, ready] = await lineEvents(parent, 2);
      assert.equal(started.type, 'guardian-started');
      assert.equal(ready.type, 'ready');
      assert.equal(ready.pid > 0, true);
      assert.equal(ready.grandchildPid > 0, true);
      const childFingerprint = fingerprint(ready.pid);
      const grandchildFingerprint = fingerprint(ready.grandchildPid);
      assert.ok(childFingerprint, 'child must be running before termination');
      assert.ok(grandchildFingerprint, 'grandchild must be running before termination');
      assert.ok(sentinelFingerprint, 'unrelated sentinel must be running before termination');
      endGuardian(parent);
      await parentExit;
      await Promise.all([
        waitForGone(ready.pid, childFingerprint),
        waitForGone(ready.grandchildPid, grandchildFingerprint),
      ]);
      assert.equal(fingerprint(sentinel.pid), sentinelFingerprint, 'unrelated sentinel must remain alive');
      const reacquired = spawn(guardian, ['--node', process.execPath, '--entry', fixture, '--profile', profile, '--parent-pid', String(process.pid)], { stdio: ['pipe', 'pipe', 'pipe'] });
      const [reacquiredReady] = await lineEvents(reacquired, 1);
      assert.equal(reacquiredReady.type, 'ready');
      const reacquiredExit = exitOf(reacquired);
      reacquired.stdin.end();
      await reacquiredExit;
    } finally {
      killOwned(parent);
      killOwned(sentinel);
      await Promise.allSettled([parentExit, sentinelExit]);
    }
  });
}
