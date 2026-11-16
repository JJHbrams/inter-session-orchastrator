import { spawn } from 'node:child_process';
import { resolve } from 'node:path';

const profile = process.argv[process.argv.indexOf('--profile') + 1];
const shouldSpawnGrandchild = process.env.GUARDIAN_FIXTURE_GRANDCHILD === '1';
const grandchild = shouldSpawnGrandchild
  ? spawn(process.execPath, [resolve(import.meta.dirname, 'guardian-grandchild.mjs')], { stdio: 'ignore' })
  : null;

process.stdout.write(`${JSON.stringify({ type: 'ready', protocol: 'session-rooms-desktop/v1', pid: process.pid, grandchildPid: grandchild?.pid, instanceId: 'fixture', baseUrl: 'http://127.0.0.1:0', dataDir: profile, dbPath: 'fixture.db' })}\n`);
process.stdin.once('data', () => process.exit(0));
process.stdin.once('end', () => process.exit(0));
