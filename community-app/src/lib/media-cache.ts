import { Image, type ImageSource } from 'expo-image';

export function stableMediaCacheKey(uri: string) {
  const value = String(uri || '').trim();
  if (!/^https?:\/\//i.test(value)) return value;
  try {
    const parsed = new URL(value);
    return `sidu-media:${parsed.host}${parsed.pathname}`;
  } catch {
    return value.split(/[?#]/, 1)[0];
  }
}

export function cachedImageSource(uri: string): ImageSource {
  const value = String(uri || '').trim();
  return /^https?:\/\//i.test(value)
    ? { uri: value, cacheKey: stableMediaCacheKey(value) }
    : { uri: value };
}

/**
 * Seed expo-image's cache with the exact file selected by the user. Passing the
 * local URI (instead of a decoded ImageRef) keeps animated GIF frames intact
 * and lets a newly-added sticker render immediately while the remote URL is
 * being propagated by the CDN.
 */
export async function primeUploadedImageCache(localUri: string, remoteUri: string) {
  const cacheKey = stableMediaCacheKey(remoteUri);
  try {
    await Image.writeToCacheAsync(localUri, cacheKey);
  } catch {
    await Image.prefetch(remoteUri, { cachePolicy: 'memory-disk' }).catch(() => false);
  }
}
