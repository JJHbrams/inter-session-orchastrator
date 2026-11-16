import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
const root = resolve(import.meta.dirname, '../..');
const child = spawn(process.execPath, ['services/coordinator/server.js'], { cwd: root, stdio: 'inherit', windowsHide: true });
child.once('exit', code => process.exitCode = code ?? 1);
