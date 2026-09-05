import { Image } from 'expo-image';
import * as FileSystem from 'expo-file-system/legacy';
import { clearVideoCacheAsync, getCurrentVideoCacheSize } from 'expo-video';

async function directorySize(uri: string): Promise<number> {
  let names: string[];
  try { names = await FileSystem.readDirectoryAsync(uri); } catch { return 0; }
  const sizes = await Promise.all(names.map(async name => {
    const child = `${uri}${uri.endsWith('/') ? '' : '/'}${name}`;
    try {
      const info = await FileSystem.getInfoAsync(child);
      if (!info.exists) return 0;
      if (info.isDirectory) return directorySize(child);
      return Number(info.size || 0);
    } catch { return 0; }
  }));
  return sizes.reduce((sum, value) => sum + value, 0);
}

export async function getAppCacheSize(): Promise<number> {
  const fileBytes = FileSystem.cacheDirectory ? await directorySize(FileSystem.cacheDirectory) : 0;
  let videoBytes = 0;
  try { videoBytes = Number(getCurrentVideoCacheSize()) || 0; } catch {}
  return Math.max(0, fileBytes + videoBytes);
}

export function formatCacheSize(bytes: number) {
  return `${(Math.max(0, bytes) / 1024 / 1024).toFixed(1)} MB`;
}

export async function clearAppCache() {
  await Image.clearMemoryCache().catch(() => false);
  await Image.clearDiskCache().catch(() => false);
  await clearVideoCacheAsync().catch(() => {});
  if (FileSystem.cacheDirectory) {
    const children = await FileSystem.readDirectoryAsync(FileSystem.cacheDirectory).catch(() => [] as string[]);
    await Promise.allSettled(children.map(name => FileSystem.deleteAsync(`${FileSystem.cacheDirectory}${name}`, { idempotent: true })));
  }
}
