const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createTranscodeArgs } = require('../src/lib/video-policy');
const { getMediaRuntime } = require('../src/lib/media-runtime');

const { ffmpegPath, ffprobePath } = getMediaRuntime();

const stem = `sidu-video-policy-${process.pid}`;
const sourcePath = path.join(os.tmpdir(), `${stem}-source.mp4`);
const outputPath = path.join(os.tmpdir(), `${stem}-output.mp4`);

function run(args) {
  const result = spawnSync(ffmpegPath, args, { encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || `ffmpeg exited with ${result.status ?? result.signal}`);
}

try {
  run(['-y', '-f', 'lavfi', '-i', 'color=c=blue:s=640x360:d=0.2', '-c:v', 'libx264', sourcePath]);
  run(createTranscodeArgs(sourcePath, outputPath));
  const bytes = fs.statSync(outputPath).size;
  if (!bytes) throw new Error('Transcoded output is empty');
  const probe = spawnSync(ffprobePath, ['-v', 'error', '-show_entries', 'format=duration:stream=width,height', '-of', 'json', outputPath], { encoding: 'utf8' });
  if (probe.error) throw probe.error;
  if (probe.status !== 0) throw new Error(probe.stderr || `ffprobe exited with ${probe.status}`);
  const metadata = JSON.parse(probe.stdout);
  if (!metadata.streams?.some(stream => stream.width > 0 && stream.height > 0) || Number(metadata.format?.duration) <= 0) {
    throw new Error('Transcoded output metadata is invalid');
  }
  console.log(JSON.stringify({ ok: true, outputBytes: bytes, ffmpegPath, ffprobePath }));
} finally {
  fs.rmSync(sourcePath, { force: true });
  fs.rmSync(outputPath, { force: true });
}
