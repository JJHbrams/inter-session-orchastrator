import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { prepareToolchains } from './prepare-toolchains.mjs';

const root = resolve(import.meta.dirname, '../..');
const node = process.env.SESSION_ROOMS_NODE ?? (await prepareToolchains()).node.path;
const [script, ...args] = process.argv.slice(2);
if (!script) throw new Error('usage: run-with-node.mjs <script> [...args]');
if (!existsSync(node)) throw new Error(`Pinned Node 24.14.1 is missing: ${node}. Run npm run prepare:tools first.`);
const child = spawn(node, [resolve(root, script), ...args], { cwd: root, stdio: 'inherit', windowsHide: true, env: { ...process.env, SESSION_ROOMS_NODE: node } });
child.once('exit', (code, signal) => process.exitCode = code ?? (signal ? 1 : 0));
