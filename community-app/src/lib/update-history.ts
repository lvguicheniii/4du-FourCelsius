import * as Application from 'expo-application';
import * as SecureStore from 'expo-secure-store';
import * as Updates from 'expo-updates';
import { Platform } from 'react-native';
import { resolveApiUrl } from '@/api/client';

const LAST_SHOWN_UPDATE_KEY = 'sidu_last_shown_update_log_id';

export type RunningUpdateLog = {
  versionName: string;
  title: string;
  releaseNotes: string;
  releaseDate: string;
  stage: 'development' | 'production';
  platform: 'android' | 'ios' | 'all';
  runtimeVersion: string;
};

export async function getUnseenRunningUpdateLog(): Promise<{ updateId: string; log: RunningUpdateLog } | null> {
  if (__DEV__) return null;

  const otaUpdateId = Updates.isEnabled && !Updates.isEmbeddedLaunch ? Updates.updateId : null;
  const nativePlatform = Platform.OS === 'android' || Platform.OS === 'ios' ? Platform.OS : null;
  const nativeVersion = String(Application.nativeApplicationVersion || '').trim();
  const nativeBuild = String(Application.nativeBuildVersion || '').trim();
  const updateId = otaUpdateId
    ? `ota:${otaUpdateId}`
    : nativePlatform && nativeVersion
      ? `native:${nativePlatform}:${nativeVersion}:${nativeBuild || 'unknown'}`
      : '';
  if (!updateId) return null;

  const shown = await SecureStore.getItemAsync(LAST_SHOWN_UPDATE_KEY);
  if (shown === updateId) return null;

  const endpoint = otaUpdateId
    ? `/api/app-updates/running/${encodeURIComponent(otaUpdateId)}`
    : `/api/app-updates/native/${nativePlatform}/${encodeURIComponent(nativeVersion)}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(resolveApiUrl(endpoint), {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const payload = await response.json();
    return payload?.log ? { updateId, log: payload.log as RunningUpdateLog } : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function markRunningUpdateLogShown(updateId: string) {
  await SecureStore.setItemAsync(LAST_SHOWN_UPDATE_KEY, updateId);
}
