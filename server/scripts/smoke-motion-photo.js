const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const sharp = require('sharp');
const { getMediaRuntime } = require('../src/lib/media-runtime');
const { findEmbeddedMp4Ranges } = require('../src/lib/motion-photo');
const { createTranscodeArgs } = require('../src/lib/video-policy');

const { ffmpegPath, ffprobePath } = getMediaRuntime();
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'sidu-motion-smoke-'));
const stillPath = path.join(directory, 'still.jpg');
const motionPath = path.join(directory, 'motion.mp4');
const combinedPath = path.join(directory, 'motion-photo.jpg');
const extractedPath = path.join(directory, 'extracted.mp4');
const outputPath = path.join(directory, 'output.mp4');
const posterPath = path.join(directory, 'poster.jpg');

function run(binary, args) {
  const result = spawnSync(binary, args, { encoding: 'utf8', timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || `${path.basename(binary)} exited with ${result.status || result.signal}`);
  return result.stdout;
}

(async () => {
  try {
    await sharp({ create: { width: 320, height: 240, channels: 3, background: '#5CCBFF' } }).jpeg().toFile(stillPath);
    run(ffmpegPath, ['-y', '-f', 'lavfi', '-i', 'color=c=blue:s=320x240:d=0.25', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', motionPath]);
    const still = fs.readFileSync(stillPath);
    const motion = fs.readFileSync(motionPath);
    fs.writeFileSync(combinedPath, Buffer.concat([still, motion, Buffer.from('SiduVendorTrailer')]));

    const combined = fs.readFileSync(combinedPath);
    const ranges = findEmbeddedMp4Ranges(combined);
    if (!ranges.length) throw new Error('Embedded MP4 was not detected');
    fs.writeFileSync(extractedPath, combined.subarray(ranges[0].start, ranges[0].end));
    run(ffmpegPath, createTranscodeArgs(extractedPath, outputPath, { livePhoto: true }));
    run(ffprobePath, ['-v', 'error', '-show_entries', 'format=duration:stream=width,height', '-of', 'json', outputPath]);
    await sharp(combinedPath).rotate().resize(1600, 1600, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 76 }).toFile(posterPath);
    if (!fs.statSync(outputPath).size || !fs.statSync(posterPath).size) throw new Error('Motion Photo smoke output is empty');
    console.log(JSON.stringify({ ok: true, motionBytes: fs.statSync(outputPath).size, posterBytes: fs.statSync(posterPath).size }));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
})().catch((error) => {
  console.error(error?.stack || error);
  process.exitCode = 1;
});
