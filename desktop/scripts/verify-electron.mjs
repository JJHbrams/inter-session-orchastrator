import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '../..');
const tests = ['desktop-runtime.test.js', 'desktop-runtime-stage.test.js', 'desktop-guardian.test.js', 'desktop-electron.core.test.js', 'desktop-electron-folder-picker.test.js', 'desktop-electron-updater.test.js', 'desktop-electron-update-helper.test.js', 'desktop-update-helper-process.test.js', 'desktop-electron.pipeline.test.js', 'desktop-electron.icon.test.js'];
const run = args => new Promise((resolveRun, reject) => { const child = spawn(process.execPath, args, { cwd: root, stdio: 'inherit', windowsHide: true }); child.once('error', reject); child.once('exit', code => code === 0 ? resolveRun() : reject(new Error(`verification command failed (${code})`))); });
await run(['desktop/scripts/build-guardian.mjs']);
await run(['--test', '--test-concurrency=1', ...tests.map(test => `tests/${test}`)]);
