const MP4_MARKER = Buffer.from('ftyp');
const MAX_XMP_SCAN_BYTES = 4 * 1024 * 1024;
const MAX_BOX_COUNT = 20_000;

function readBox(buffer, offset) {
  if (offset < 0 || offset + 8 > buffer.length) return null;
  const size32 = buffer.readUInt32BE(offset);
  const type = buffer.toString('ascii', offset + 4, offset + 8);
  let headerSize = 8;
  let size = size32;
  if (size32 === 1) {
    if (offset + 16 > buffer.length) return null;
    const largeSize = buffer.readBigUInt64BE(offset + 8);
    if (largeSize > BigInt(Number.MAX_SAFE_INTEGER)) return null;
    size = Number(largeSize);
    headerSize = 16;
  } else if (size32 === 0) {
    size = buffer.length - offset;
  }
  if (size < headerSize || offset + size > buffer.length) return null;
  return { type, size, end: offset + size, extendsToEnd: size32 === 0 };
}

function inspectMp4Range(buffer, start) {
  const first = readBox(buffer, start);
  if (!first || first.type !== 'ftyp') return null;
  const majorBrand = buffer.toString('ascii', start + 8, Math.min(first.end, start + 12));
  if (!/^[\x20-\x7E]{4}$/.test(majorBrand)) return null;

  let cursor = start;
  let lastEnd = start;
  let sawMovieMetadata = false;
  let sawMediaData = false;
  for (let count = 0; count < MAX_BOX_COUNT; count += 1) {
    const box = readBox(buffer, cursor);
    if (!box) break;
    if (box.type === 'moov' || box.type === 'moof') sawMovieMetadata = true;
    if (box.type === 'mdat') sawMediaData = true;
    lastEnd = box.end;
    cursor = box.end;
    if (box.extendsToEnd || cursor === buffer.length) break;
  }
  if (!sawMovieMetadata || !sawMediaData) return null;
  return { start, end: lastEnd };
}

function xmpOffsets(buffer) {
  const header = buffer.subarray(0, Math.min(buffer.length, MAX_XMP_SCAN_BYTES)).toString('latin1');
  const offsets = [];
  for (const match of header.matchAll(/(?:GCamera:MicroVideoOffset|Camera:MicroVideoOffset)\s*=\s*["'](\d+)["']/gi)) {
    const bytesFromEnd = Number(match[1]);
    if (Number.isSafeInteger(bytesFromEnd) && bytesFromEnd > 0 && bytesFromEnd < buffer.length) {
      offsets.push(buffer.length - bytesFromEnd);
    }
  }
  for (const match of header.matchAll(/<[^>]+(?:Item:Mime|GContainerItem:Mime)\s*=\s*["']video\/mp4["'][^>]*>/gi)) {
    const length = match[0].match(/(?:Item:Length|GContainerItem:Length)\s*=\s*["'](\d+)["']/i);
    const bytes = Number(length?.[1]);
    if (Number.isSafeInteger(bytes) && bytes > 0 && bytes < buffer.length) offsets.push(buffer.length - bytes);
  }
  return offsets;
}

function findEmbeddedMp4Ranges(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 16) return [];
  const starts = [...xmpOffsets(buffer)];
  let markerIndex = buffer.indexOf(MP4_MARKER);
  while (markerIndex >= 4) {
    starts.push(markerIndex - 4);
    markerIndex = buffer.indexOf(MP4_MARKER, markerIndex + MP4_MARKER.length);
  }

  const seen = new Set();
  const ranges = [];
  for (const start of starts) {
    if (seen.has(start)) continue;
    seen.add(start);
    const range = inspectMp4Range(buffer, start);
    if (range) ranges.push(range);
  }
  return ranges;
}

module.exports = { findEmbeddedMp4Ranges, inspectMp4Range };
