import { readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { Resvg } from '@resvg/resvg-js';

const directory = resolve(import.meta.dirname, '../../apps/desktop/assets/brand');
const source = (await readFile(join(directory, 'session-rooms.svg'), 'utf8')).replaceAll('\r\n', '\n');
const sizes = [16, 24, 32, 48, 64, 128, 180, 192, 256, 512];
const frames = [];
const files = [];
for (const size of sizes) {
  const png = new Resvg(source, { fitTo: { mode: 'width', value: size }, font: { loadSystemFonts: false } }).render().asPng();
  const filename = `session-rooms-${size}.png`;
  await writeFile(join(directory, filename), png);
  files.push({ path: filename, size, sha256: createHash('sha256').update(png).digest('hex') });
  if ([16, 24, 32, 48, 64, 128, 256].includes(size)) frames.push({ size, png });
}
// PNG-compressed ICO frames retain alpha at each Windows shell scaling level.
const header = Buffer.alloc(6 + frames.length * 16);
header.writeUInt16LE(1, 2);
header.writeUInt16LE(frames.length, 4);
let offset = header.length;
frames.forEach(({ size, png }, index) => {
  const entry = 6 + index * 16;
  header[entry] = size === 256 ? 0 : size;
  header[entry + 1] = size === 256 ? 0 : size;
  header.writeUInt16LE(1, entry + 4);
  header.writeUInt16LE(32, entry + 6);
  header.writeUInt32LE(png.length, entry + 8);
  header.writeUInt32LE(offset, entry + 12);
  offset += png.length;
});
const ico = Buffer.concat([header, ...frames.map(frame => frame.png)]);
await writeFile(join(directory, 'session-rooms.ico'), ico);
files.push({ path: 'session-rooms.ico', sizes: frames.map(frame => frame.size), sha256: createHash('sha256').update(ico).digest('hex') });
await writeFile(join(directory, 'manifest.json'), JSON.stringify({ source: 'session-rooms.svg', sourceNormalization: 'LF', sourceSha256: createHash('sha256').update(source).digest('hex'), renderer: '@resvg/resvg-js@2.6.2', files }, null, 2) + '\n');
console.log(JSON.stringify({ type: 'icons', source: 'session-rooms.svg', pngSizes: sizes, icoSizes: frames.map(frame => frame.size) }));
