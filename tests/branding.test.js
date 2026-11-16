import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { JSDOM } from 'jsdom';
import { createCoordinator } from '../services/coordinator/server.js';

const brand = resolve(import.meta.dirname, '../apps/desktop/assets/brand');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

test('generated icon family agrees with the vector source and contains Windows scaling frames', async () => {
  const manifest = JSON.parse(await readFile(join(brand, 'manifest.json'), 'utf8'));
  const source = (await readFile(join(brand, manifest.source), 'utf8')).replaceAll('\r\n', '\n');
  assert.equal(hash(source), manifest.sourceSha256);
  for (const file of manifest.files) assert.equal(hash(await readFile(join(brand, file.path))), file.sha256, file.path);
  const ico = await readFile(join(brand, 'session-rooms.ico'));
  assert.equal(ico.readUInt16LE(0), 0);
  assert.equal(ico.readUInt16LE(2), 1);
  const dimensions = [];
  for (let index = 0; index < ico.readUInt16LE(4); index++) {
    const offset = 6 + index * 16, size = ico[offset] || 256;
    const imageOffset = ico.readUInt32LE(offset + 12), bytes = ico.readUInt32LE(offset + 8);
    assert.ok(imageOffset + bytes <= ico.length);
    assert.equal(ico.subarray(imageOffset, imageOffset + 8).toString('hex'), '89504e470d0a1a0a');
    assert.equal(ico.readUInt32BE(imageOffset + 16), size);
    assert.equal(ico.readUInt32BE(imageOffset + 20), size);
    dimensions.push(size);
  }
  assert.deepEqual(dimensions, [16, 24, 32, 48, 64, 128, 256]);
});

test('web identity assets load with image MIME types without granting API access', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'rooms-brand-'));
  const runtime = createCoordinator({ port: 0, dbPath: join(directory, 'rooms.sqlite'), knowledgeRoot: join(directory, 'knowledge'), scheduler: false, log: { error() {} } });
  t.after(async () => { await runtime.close(); await rm(directory, { recursive: true, force: true }); });
  const { baseUrl } = await runtime.start();
  const document = new JSDOM(await (await fetch(baseUrl)).text()).window.document;
  assert.equal(document.querySelector('.brand img').getAttribute('src'), '/assets/brand/session-rooms.svg');
  const links = [...document.querySelectorAll('link[rel=icon],link[rel=apple-touch-icon]')];
  assert.equal(links.length, 3);
  for (const link of links) {
    const response = await fetch(new URL(link.getAttribute('href'), baseUrl));
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^image\/(png|svg\+xml)$/);
    const name = link.getAttribute('href').split('/').pop();
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), await readFile(join(brand, name)));
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  }
  const favicon = await fetch(new URL('favicon.ico', baseUrl));
  assert.equal(favicon.status, 200);
  assert.equal(favicon.headers.get('content-type'), 'image/x-icon');
  assert.deepEqual(Buffer.from(await favicon.arrayBuffer()), await readFile(join(brand, 'session-rooms.ico')));
  assert.equal((await fetch(new URL('api/channels', baseUrl))).status, 401);
  assert.equal((await fetch(new URL('assets/brand/manifest.json', baseUrl))).status, 404);
  assert.equal((await fetch(new URL('assets/brand/not-an-icon.svg', baseUrl))).status, 404);
});
