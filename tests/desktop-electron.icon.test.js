import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { assertEmbeddedIcon, readIcoFrameHashes } from '../desktop/shells/electron/scripts/windows-icon.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function ico(...frames) {
  const header = Buffer.alloc(6 + frames.length * 16); header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(frames.length, 4);
  let offset = header.length;
  for (let i = 0; i < frames.length; i += 1) { const entry = 6 + i * 16; header[entry] = 16; header[entry + 1] = 16; header.writeUInt16LE(1, entry + 4); header.writeUInt16LE(32, entry + 6); header.writeUInt32LE(frames[i].length, entry + 8); header.writeUInt32LE(offset, entry + 12); offset += frames[i].length; }
  return Buffer.concat([header, ...frames]);
}
test('ICO frame hashes require a matching native RT_GROUP_ICON resource', () => {
  const frames = [Buffer.from('first PNG frame'), Buffer.from('second PNG frame')], expected = [hash(frames[0]), hash(frames[1])].sort();
  assert.deepEqual(readIcoFrameHashes(ico(...frames)), expected);
  assert.deepEqual(assertEmbeddedIcon(expected, [{ id: 32512, frames: [...expected].reverse() }]), { groupId: 32512, frameCount: 2, frameHashes: expected });
  assert.throws(() => assertEmbeddedIcon(expected, [{ id: 1, frames: [expected[0]] }]), /do not match/);
  assert.throws(() => assertEmbeddedIcon(expected, [{ id: 1, frames: [expected[0]] }, { id: 2, frames: expected }]), /primary/);
  assert.throws(() => readIcoFrameHashes(Buffer.from('not an icon')), /ICO/);
});
