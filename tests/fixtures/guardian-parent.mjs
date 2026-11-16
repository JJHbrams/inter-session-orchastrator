import { spawn } from 'node:child_process';

const [guardian, node, entry, profile] = process.argv.slice(2);
const child = spawn(guardian, [
  '--node', node,
  '--entry', entry,
  '--profile', profile,
  '--parent-pid', String(process.pid),
], {
  env: { ...process.env, GUARDIAN_FIXTURE_GRANDCHILD: '1' },
  stdio: ['pipe', 'pipe', 'pipe'],
});

process.stdout.write(`${JSON.stringify({ type: 'guardian-started', guardianPid: child.pid, parentPid: process.pid })}\n`);
child.stdout.pipe(process.stdout);
child.stderr.pipe(process.stderr);
child.once('close', code => process.exit(code ?? 1));
process.stdin.once('data', () => child.kill('SIGTERM'));
