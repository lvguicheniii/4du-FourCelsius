const test = require('node:test');
const assert = require('node:assert/strict');

const { VIDEO_LIMITS, createTranscodeArgs, validateVideoMetadata } = require('../src/lib/video-policy');

test('accepts video within upload duration and resolution limits', () => {
  assert.doesNotThrow(() => validateVideoMetadata({ durationMs: 60_000, width: 2160, height: 3840 }));
  assert.doesNotThrow(() => validateVideoMetadata({ durationMs: 15_000, width: 1920, height: 1080 }, { livePhoto: true }));
});

test('rejects videos that exceed duration or 4K input limits', () => {
  assert.throws(() => validateVideoMetadata({ durationMs: 60_001, width: 1920, height: 1080 }), /60秒/);
  assert.throws(() => validateVideoMetadata({ durationMs: 15_001, width: 1920, height: 1080 }, { livePhoto: true }), /15秒/);
  assert.throws(() => validateVideoMetadata({ durationMs: 1_000, width: 4097, height: 1080 }), /4096/);
});

test('normalizes video to 1080p-class bitrate and a 1920-pixel long edge', () => {
  const args = createTranscodeArgs('source.mov', 'playback.mp4');
  assert.ok(args.includes(`scale=${VIDEO_LIMITS.maxOutputLongEdge}:${VIDEO_LIMITS.maxOutputLongEdge}:force_original_aspect_ratio=decrease:force_divisible_by=2`));
  assert.equal(args[args.indexOf('-maxrate') + 1], '3000k');
  assert.equal(args[args.indexOf('-b:a') + 1], '96k');

  const liveArgs = createTranscodeArgs('source.mov', 'playback.mp4', { livePhoto: true });
  assert.equal(liveArgs[liveArgs.indexOf('-maxrate') + 1], '2000k');
});
