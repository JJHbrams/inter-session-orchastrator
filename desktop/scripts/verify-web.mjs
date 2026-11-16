import { readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '../..');
const all = process.argv.includes('--all');
const extra = process.argv.slice(2).filter(argument => argument !== '--all');
const tests = (await readdir(resolve(root, 'tests'))).filter(name => name.endsWith('.test.js') && (all || !name.startsWith('desktop-'))).sort();
const child = spawn(process.execPath, ['--test', '--test-concurrency=1', ...extra, ...tests.map(test => `tests/${test}`)], { cwd: root, stdio: 'inherit', windowsHide: true });
child.once('exit', code => process.exitCode = code ?? 1);
