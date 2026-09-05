import type { ImagePickerAsset } from 'expo-image-picker';
import { setVideoCacheSizeAsync, type VideoSource } from 'expo-video';
import { Platform } from 'react-native';

const MEBIBYTE = 1024 * 1024;

export const VIDEO_LIMITS = {
  maxDurationMs: 60_000,
  maxInputBytes: 50 * MEBIBYTE,
  maxInputLongEdge: 4096,
  maxOutputLongEdge: 1920,
  maxOutputVideoBitrate: 3_000_000,
  livePhotoMaxDurationMs: 15_000,
  livePhotoMaxInputBytes: 30 * MEBIBYTE,
} as const;

export function cachedVideoSource(uri: string): VideoSource {
  return {
    uri,
    contentType: 'progressive',
    useCaching: /^https?:\/\//i.test(uri),
  };
}

let cacheInitialization: Promise<void> | null = null;

export function initializeVideoCache() {
  if (Platform.OS === 'web') return Promise.resolve();
  if (!cacheInitialization) {
    // 512 MB is large enough for repeated feed/chat playback without allowing
    // video cache growth to compete indefinitely with the rest of the app.
    cacheInitialization = setVideoCacheSizeAsync(512 * MEBIBYTE).catch(() => {});
  }
  return cacheInitialization;
}

async function pickedFileSize(asset: ImagePickerAsset) {
  if (Number.isFinite(asset.fileSize) && Number(asset.fileSize) > 0) return Number(asset.fileSize);
  try {
    const FileSystem = require('expo-file-system/legacy');
    const info = await FileSystem.getInfoAsync(asset.uri, { size: true });
    return info.exists && Number.isFinite(info.size) ? Number(info.size) : 0;
  } catch {
    return 0;
  }
}

export async function validatePickedVideo(
  asset: ImagePickerAsset,
  options: { livePhoto?: boolean } = {},
): Promise<string | null> {
  const livePhoto = options.livePhoto === true;
  const maxDurationMs = livePhoto ? VIDEO_LIMITS.livePhotoMaxDurationMs : VIDEO_LIMITS.maxDurationMs;
  const maxBytes = livePhoto ? VIDEO_LIMITS.livePhotoMaxInputBytes : VIDEO_LIMITS.maxInputBytes;
  const durationMs = Number(asset.duration) || 0;
  if (durationMs > maxDurationMs) {
    return livePhoto ? '实况视频时长不能超过15秒' : '视频时长不能超过60秒';
  }

  const longEdge = Math.max(Number(asset.width) || 0, Number(asset.height) || 0);
  if (longEdge > VIDEO_LIMITS.maxInputLongEdge) return '视频分辨率不能超过4K（最长边4096像素）';

  const size = await pickedFileSize(asset);
  if (size > maxBytes) {
    return livePhoto ? '实况照片不能超过30MB' : '视频文件不能超过50MB';
  }
  return null;
}
