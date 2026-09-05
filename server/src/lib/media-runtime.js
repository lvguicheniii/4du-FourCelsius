const fs = require('node:fs');
const { spawnSync } = require('node:child_process');

let cachedRuntime = null;

function binaryCandidates(environmentName, packagedPath, systemName, preferSystem = false) {
  const systemPaths = [process.platform === 'win32' ? systemName : `/usr/bin/${systemName}`, systemName];
  return [process.env[environmentName], ...(preferSystem ? systemPaths : [packagedPath, ...systemPaths]), ...(preferSystem ? [packagedPath] : [])].filter(Boolean);
}

function inspectBinary(binaryPath, args = ['-hide_banner', '-version']) {
  const result = spawnSync(binaryPath, args, {
    encoding: 'utf8',
    timeout: 10_000,
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
  return {
    ok: !result.error && result.status === 0,
    status: result.status,
    signal: result.signal,
    error: result.error?.message || null,
  };
}

function selectBinary(label, candidates, inspectionArgs) {
  const attempted = [];
  for (const candidate of [...new Set(candidates)]) {
    const inspection = inspectBinary(candidate, inspectionArgs);
    if (inspection.ok) return candidate;
    attempted.push({ path: candidate, ...inspection });
  }
  const error = new Error(`${label} is unavailable: ${attempted.map(item => `${item.path} (${item.signal || item.status || item.error || 'unknown error'})`).join(', ')}`);
  error.code = 'MEDIA_RUNTIME_UNAVAILABLE';
  throw error;
}

function packagedFfmpegPath() {
  try { return require('ffmpeg-static'); } catch { return null; }
}

function packagedFfprobePath() {
  try { return require('ffprobe-static').path; } catch { return null; }
}

function getMediaRuntime() {
  if (cachedRuntime) return cachedRuntime;
  const ffmpegInspectionArgs = [
    '-hide_banner', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=black:s=16x16:d=0.04',
    '-frames:v', '1', '-c:v', 'libx264', '-f', 'null', '-',
  ];
  // Linux distribution FFmpeg receives host security updates and is tested
  // against the running kernel. Packaged static builds remain a fallback for
  // development hosts where no system binary exists.
  const ffmpegPath = selectBinary('FFmpeg', binaryCandidates('FFMPEG_PATH', packagedFfmpegPath(), 'ffmpeg', true), ffmpegInspectionArgs);
  const ffprobePath = selectBinary('FFprobe', binaryCandidates('FFPROBE_PATH', packagedFfprobePath(), 'ffprobe'));
  cachedRuntime = Object.freeze({ ffmpegPath, ffprobePath });
  return cachedRuntime;
}

function mediaRuntimeCheck() {
  const runtime = getMediaRuntime();
  return {
    ok: fs.existsSync(runtime.ffmpegPath) || runtime.ffmpegPath === 'ffmpeg',
    ffmpegPath: runtime.ffmpegPath,
    ffprobePath: runtime.ffprobePath,
  };
}

function resetMediaRuntimeForTests() {
  cachedRuntime = null;
}

module.exports = { getMediaRuntime, inspectBinary, mediaRuntimeCheck, resetMediaRuntimeForTests };
