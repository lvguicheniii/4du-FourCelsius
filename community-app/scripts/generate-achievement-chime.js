/* global Buffer, __dirname */
const fs = require('fs');
const path = require('path');

const sampleRate = 44100;
const durationSeconds = 0.95;
const frameCount = Math.floor(sampleRate * durationSeconds);
const notes = [
  // Three short notes make a compact, light achievement cue.
  { start: 0.00, duration: 0.24, frequency: 523.25, gain: 0.66 },
  { start: 0.17, duration: 0.26, frequency: 659.25, gain: 0.62 },
  { start: 0.35, duration: 0.34, frequency: 783.99, gain: 0.58 },
];

const samples = new Float64Array(frameCount);
for (const note of notes) {
  const startFrame = Math.floor(note.start * sampleRate);
  const noteFrames = Math.floor(note.duration * sampleRate);
  for (let frame = 0; frame < noteFrames && startFrame + frame < frameCount; frame += 1) {
    const time = frame / sampleRate;
    const attack = Math.min(1, time / 0.022);
    const decay = Math.exp(-2.0 * time / note.duration);
    const release = Math.min(1, (note.duration - time) / 0.11);
    const envelope = attack * decay * Math.max(0, release);
    const phase = 2 * Math.PI * note.frequency * time;
    const softTone = Math.sin(phase)
      + 0.13 * Math.sin(phase * 2)
      + 0.035 * Math.sin(phase * 3);
    samples[startFrame + frame] += note.gain * envelope * softTone;
  }
}

let peak = 0;
for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
const pcmBytes = frameCount * 2;
const wav = Buffer.alloc(44 + pcmBytes);
wav.write('RIFF', 0);
wav.writeUInt32LE(36 + pcmBytes, 4);
wav.write('WAVE', 8);
wav.write('fmt ', 12);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(sampleRate, 24);
wav.writeUInt32LE(sampleRate * 2, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write('data', 36);
wav.writeUInt32LE(pcmBytes, 40);
for (let frame = 0; frame < frameCount; frame += 1) {
  const normalized = peak ? samples[frame] / peak : 0;
  wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, normalized * 0.82)) * 32767), 44 + frame * 2);
}

const outputDir = path.join(__dirname, '..', 'assets', 'sounds');
const outputPath = path.join(outputDir, 'achievement-chime.wav');
fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(outputPath, wav);
console.log(`Generated ${outputPath} (${durationSeconds}s, ${sampleRate}Hz mono)`);
