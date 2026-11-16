import { access, copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import https from 'node:https';

const root = resolve(import.meta.dirname, '../..');
const metadata = JSON.parse(await readFile(resolve(root, 'desktop/toolchains.json'), 'utf8'));
export async function sha256(path) { return createHash('sha256').update(await readFile(path)).digest('hex'); }
async function exists(path) { try { await access(path, constants.R_OK); return true; } catch { return false; } }
async function download(url, destination) {
  await mkdir(dirname(destination), { recursive: true });
  const temporary = `${destination}.partial`;
  await new Promise((resolveDownload, reject) => https.get(url, response => {
    if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) { response.resume(); return download(new URL(response.headers.location, url).href, destination).then(resolveDownload, reject); }
    if (response.statusCode !== 200) return reject(new Error(`download failed (${response.statusCode}): ${url}`));
    const chunks = []; response.on('data', chunk => chunks.push(chunk)); response.once('error', reject); response.once('end', async () => { try { await writeFile(temporary, Buffer.concat(chunks), { flag: 'wx' }); await rename(temporary, destination); resolveDownload(); } catch (error) { reject(error); } });
  }).once('error', reject));
}
export async function ensureVerifiedFile({ url, sha256: expected }, destination) {
  if (await exists(destination) && await sha256(destination) === expected) return { path: destination, source: 'cache' };
  if (await exists(destination)) throw new Error(`Refusing to replace unverified cached tool: ${destination}`);
  await download(url, destination);
  if (await sha256(destination) !== expected) throw new Error(`SHA-256 mismatch for ${destination}`);
  return { path: destination, source: 'download' };
}
export async function prepareToolchains({ destination = resolve(root, '.local/toolchains') } = {}) {
  const nodeDir = resolve(destination, `node-${metadata.node.version}`);
  const binary = await ensureVerifiedFile(metadata.node, resolve(nodeDir, metadata.node.binary));
  const license = await ensureVerifiedFile(metadata.node.license, resolve(nodeDir, metadata.node.license.file));
  return { node: binary, license, metadata };
}
if (import.meta.main) console.log(JSON.stringify(await prepareToolchains()));
