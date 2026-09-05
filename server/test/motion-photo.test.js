const test = require('node:test');
const assert = require('node:assert/strict');
const { findEmbeddedMp4Ranges } = require('../src/lib/motion-photo');

function box(type, payload = Buffer.alloc(0)) {
  const result = Buffer.alloc(8 + payload.length);
  result.writeUInt32BE(result.length, 0);
  result.write(type, 4, 4, 'ascii');
  payload.copy(result, 8);
  return result;
}

function fakeMp4() {
  return Buffer.concat([
    box('ftyp', Buffer.from('isom0000', 'ascii')),
    box('moov', Buffer.alloc(12, 1)),
    box('mdat', Buffer.alloc(24, 2)),
  ]);
}

test('finds a complete embedded MP4 and excludes trailing vendor metadata', () => {
  const jpeg = Buffer.from('\xff\xd8MotionPhoto header\xff\xd9', 'latin1');
  const mp4 = fakeMp4();
  const trailer = Buffer.from('Samsung SEF trailer');
  const input = Buffer.concat([jpeg, mp4, trailer]);
  const ranges = findEmbeddedMp4Ranges(input);
  assert.deepEqual(ranges[0], { start: jpeg.length, end: jpeg.length + mp4.length });
});

test('uses Google MicroVideoOffset metadata without accepting false ftyp text', () => {
  const mp4 = fakeMp4();
  const xmp = Buffer.from(`<x:xmpmeta GCamera:MicroVideoOffset="${mp4.length}">false ftyp marker</x:xmpmeta>`, 'ascii');
  const input = Buffer.concat([Buffer.from('\xff\xd8', 'latin1'), xmp, Buffer.from('\xff\xd9', 'latin1'), mp4]);
  const ranges = findEmbeddedMp4Ranges(input);
  assert.equal(ranges.length, 1);
  assert.equal(ranges[0].end, input.length);
});

test('rejects an ordinary image containing an ftyp string', () => {
  const input = Buffer.from('\xff\xd8metadata 1234ftypisom but no movie boxes\xff\xd9', 'latin1');
  assert.deepEqual(findEmbeddedMp4Ranges(input), []);
});
