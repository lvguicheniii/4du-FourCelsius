import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';
import * as Application from 'expo-application';
import * as FileSystem from 'expo-file-system/legacy';
import * as Linking from 'expo-linking';
import * as Updates from 'expo-updates';
import { resolveApiUrl } from '@/api/client';
import { APP_ERROR_CODES, PublicAppError } from '@/lib/app-error-codes';
import { createIncidentId, reportClientError } from '@/lib/client-error-report';

export type AndroidRelease = {
  versionCode: number;
  versionName: string;
  runtimeVersion: string;
  apkUrl: string;
  fileSize: number;
  md5: string;
  sha256: string;
  releaseNotes: string;
  mandatory: boolean;
  publishedAt: string | null;
};

export type AppStoreRelease = {
  platform: 'ios';
  versionName: string;
  releaseNotes: string;
  storeName: 'App Store';
  storeUrl: string;
};

export type AppUpdate =
  | { kind: 'native'; release: AndroidRelease }
  | { kind: 'store'; release: AppStoreRelease }
  | { kind: 'ota' }
  | { kind: 'none'; versionName: string };

type AndroidUpdateCheck = {
  nativeRelease: AndroidRelease | null;
  otaAvailable: boolean | null;
};

const ANDROID_EMBEDDED_OTA_MINIMUM_BUILD: Readonly<Record<string, number>> = {
  '00000000-0000-4000-8000-000000000013': 13,
};

export function isAndroidOtaIncludedInNativeBuild(versionCode: number, updateId: string) {
  const minimumBuild = ANDROID_EMBEDDED_OTA_MINIMUM_BUILD[String(updateId || '').trim().toLowerCase()];
  return Number.isSafeInteger(minimumBuild) && versionCode >= minimumBuild;
}

type ExpoIntentLauncherModule = {
  startActivity: (
    activityAction: string,
    params?: {
      data?: string;
      flags?: number;
      type?: string;
    },
  ) => Promise<unknown>;
};

const MAX_APK_FILE_SIZE = 1024 * 1024 * 1024;

function rawErrorText(error: unknown) {
  if (error instanceof Error) return `${error.name} ${(error as Error & { code?: string }).code || ''} ${error.message}`;
  return String(error || 'Unknown error');
}

async function recentUpdateLogText() {
  try {
    const entries = await Updates.readLogEntriesAsync(10 * 60 * 1000);
    return entries
      .filter(entry => entry.level === 'error' || entry.level === 'fatal' || entry.level === 'warn')
      .slice(-8)
      .map(entry => `${entry.code}:${entry.message}`)
      .join('\n');
  } catch {
    return '';
  }
}

async function classifyOtaFailure(error: unknown, stage: 'check' | 'fetch' | 'reload') {
  const nativeLogs = await recentUpdateLogText();
  const details = `${rawErrorText(error)}\n${nativeLogs}`.toLowerCase();
  const diagnostic = new Error(`[${stage}] ${rawErrorText(error)}${nativeLogs ? `\n${nativeLogs}` : ''}`);
  reportClientError(diagnostic, createIncidentId()).catch(() => {});
  console.warn('App update failed', diagnostic);

  if (details.includes('signature') || details.includes('code signing')) {
    return new PublicAppError(APP_ERROR_CODES.UPDATE_SIGNATURE, error);
  }
  if (details.includes('asset') || details.includes('failed to download new update')) {
    return new PublicAppError(APP_ERROR_CODES.UPDATE_FETCH_ASSET, error);
  }
  if (stage === 'reload') return new PublicAppError(APP_ERROR_CODES.UPDATE_RELOAD, error);
  if (stage === 'check') {
    return new PublicAppError(
      details.includes('network') || details.includes('timeout') || details.includes('unreachable')
        ? APP_ERROR_CODES.UPDATE_CHECK_NETWORK
        : APP_ERROR_CODES.UPDATE_CHECK_SERVICE,
      error,
    );
  }
  return new PublicAppError(APP_ERROR_CODES.UPDATE_FETCH_NETWORK, error);
}

function assertAndroidReleaseIntegrity(release: AndroidRelease) {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(String(release.apkUrl || ''));
  } catch {
    throw new PublicAppError(APP_ERROR_CODES.UPDATE_PACKAGE_METADATA);
  }
  if (parsedUrl.protocol !== 'https:' || parsedUrl.username || parsedUrl.password) {
    throw new PublicAppError(APP_ERROR_CODES.UPDATE_PACKAGE_METADATA);
  }
  if (!Number.isSafeInteger(release.fileSize)
    || release.fileSize <= 0
    || release.fileSize > MAX_APK_FILE_SIZE) {
    throw new PublicAppError(APP_ERROR_CODES.UPDATE_PACKAGE_METADATA);
  }
  if (!/^[a-f0-9]{32}$/i.test(String(release.md5 || ''))
    || !/^[a-f0-9]{64}$/i.test(String(release.sha256 || ''))) {
    throw new PublicAppError(APP_ERROR_CODES.UPDATE_PACKAGE_METADATA);
  }
}

function currentVersionCode() {
  const value = Number.parseInt(Application.nativeBuildVersion || '0', 10);
  return Number.isSafeInteger(value) && value > 0 ? value : 0;
}

function currentVersionName() {
  return Application.nativeApplicationVersion || '1.0.0';
}

function versionParts(value: string) {
  return String(value || '').split('.').map(part => {
    const numeric = Number.parseInt(part.replace(/\D.*$/, ''), 10);
    return Number.isSafeInteger(numeric) && numeric >= 0 ? numeric : 0;
  });
}

export function isNewerVersion(candidate: string, current: string) {
  const next = versionParts(candidate);
  const installed = versionParts(current);
  const length = Math.max(next.length, installed.length);
  for (let index = 0; index < length; index += 1) {
    const nextPart = next[index] || 0;
    const installedPart = installed[index] || 0;
    if (nextPart !== installedPart) return nextPart > installedPart;
  }
  return false;
}

function wait(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

async function retryOtaOperation<T>(operation: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (attempt < attempts) await wait(attempt * 700);
    }
  }
  throw lastError;
}

async function withTimeout<T>(operation: Promise<T>, milliseconds: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error('UPDATE_CHECK_TIMEOUT')), milliseconds);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function checkAndroidUpdates(): Promise<AndroidUpdateCheck> {
  if (Platform.OS !== 'android') return { nativeRelease: null, otaAvailable: null };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const query = new URLSearchParams({
      versionCode: String(currentVersionCode()),
      runtimeVersion: Updates.runtimeVersion || '',
      updateId: Updates.updateId || '',
    });
    const url = resolveApiUrl(`/api/app-updates/android/latest?${query.toString()}`);
    const response = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`版本服务暂时不可用（${response.status}）`);
    const payload = await response.json();
    const latestOtaUpdateId = String(payload?.ota?.latestUpdateId || '').trim();
    const otaAvailable = typeof payload?.ota?.available === 'boolean'
      ? payload.ota.available
        && !isAndroidOtaIncludedInNativeBuild(currentVersionCode(), latestOtaUpdateId)
      : null;
    if (!payload?.available || !payload?.release) {
      return { nativeRelease: null, otaAvailable };
    }
    const release = payload.release as AndroidRelease;
    if (!Number.isSafeInteger(release.versionCode) || release.versionCode <= currentVersionCode()) {
      return { nativeRelease: null, otaAvailable };
    }
    assertAndroidReleaseIntegrity(release);
    return { nativeRelease: release, otaAvailable };
  } finally {
    clearTimeout(timeout);
  }
}

async function checkIosAppStoreUpdate(): Promise<AppStoreRelease | null> {
  if (Platform.OS !== 'ios' || !Application.applicationId) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const query = new URLSearchParams({
      bundleId: Application.applicationId,
      country: 'cn',
    });
    const response = await fetch(`https://itunes.apple.com/lookup?${query.toString()}`, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const payload = await response.json();
    const result = Array.isArray(payload?.results) ? payload.results[0] : null;
    const versionName = String(result?.version || '').trim();
    const storeUrl = String(result?.trackViewUrl || '').trim();
    if (!versionName || !isNewerVersion(versionName, currentVersionName())) return null;
    let parsedUrl: URL;
    try {
      parsedUrl = new URL(storeUrl);
    } catch {
      return null;
    }
    if (parsedUrl.protocol !== 'https:' || !/(^|\.)apple\.com$/i.test(parsedUrl.hostname)) return null;
    return {
      platform: 'ios',
      versionName,
      releaseNotes: String(result?.releaseNotes || '包含功能改进与问题修复').trim(),
      storeName: 'App Store',
      storeUrl,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function checkForAppUpdate(): Promise<AppUpdate> {
  if (Platform.OS === 'ios') {
    const storeRelease = await checkIosAppStoreUpdate();
    return storeRelease
      ? { kind: 'store', release: storeRelease }
      : { kind: 'none', versionName: currentVersionName() };
  }

  let updateCheck: AndroidUpdateCheck = { nativeRelease: null, otaAvailable: null };
  try {
    updateCheck = await checkAndroidUpdates();
  } catch (error) {
    console.warn('First-party update preflight failed', error);
  }
  if (updateCheck.nativeRelease) return { kind: 'native', release: updateCheck.nativeRelease };

  if (Updates.isEnabled) {
    if (updateCheck.otaAvailable === false) {
      return { kind: 'none', versionName: currentVersionName() };
    }
    try {
      const update = await withTimeout(Updates.checkForUpdateAsync(), 7_000);
      if (update.isAvailable) return { kind: 'ota' };
    } catch (error) {
      console.warn('OTA update check failed', error);
      throw await classifyOtaFailure(error, 'check');
    }
  }

  return { kind: 'none', versionName: currentVersionName() };
}

export async function openStoreRelease(release: AppStoreRelease) {
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(release.storeUrl);
  } catch {
    throw new PublicAppError(APP_ERROR_CODES.UPDATE_PACKAGE_METADATA);
  }
  if (parsedUrl.protocol !== 'https:' || !/(^|\.)apple\.com$/i.test(parsedUrl.hostname)) {
    throw new PublicAppError(APP_ERROR_CODES.UPDATE_PACKAGE_METADATA);
  }
  await Linking.openURL(release.storeUrl);
}

async function openAndroidInstaller(uri: string) {
  const intentLauncher = requireOptionalNativeModule<ExpoIntentLauncherModule>('ExpoIntentLauncher');
  if (!intentLauncher?.startActivity) {
    throw new PublicAppError(APP_ERROR_CODES.UPDATE_INSTALL_PERMISSION);
  }

  const contentUri = await FileSystem.getContentUriAsync(uri);
  try {
    await intentLauncher.startActivity('android.intent.action.VIEW', {
      data: contentUri,
      flags: 1,
      type: 'application/vnd.android.package-archive',
    });
  } catch {
    if (Application.applicationId) {
      await intentLauncher.startActivity('android.settings.MANAGE_UNKNOWN_APP_SOURCES', {
        data: `package:${Application.applicationId}`,
      }).catch(() => {});
    }
    throw new PublicAppError(APP_ERROR_CODES.UPDATE_INSTALL_PERMISSION);
  }
}

export async function downloadAndInstallAndroidRelease(
  release: AndroidRelease,
  onProgress?: (progress: number) => void,
) {
  if (Platform.OS !== 'android') throw new PublicAppError(APP_ERROR_CODES.UPDATE_PACKAGE_METADATA);
  if (!FileSystem.cacheDirectory) throw new PublicAppError(APP_ERROR_CODES.UPDATE_PACKAGE_DOWNLOAD);
  assertAndroidReleaseIntegrity(release);

  const updateDirectory = `${FileSystem.cacheDirectory}app-updates/`;
  const targetUri = `${updateDirectory}sidu-${release.versionCode}.apk`;
  await FileSystem.makeDirectoryAsync(updateDirectory, { intermediates: true });
  await FileSystem.deleteAsync(targetUri, { idempotent: true });

  const task = FileSystem.createDownloadResumable(
    release.apkUrl,
    targetUri,
    { md5: true },
    ({ totalBytesWritten, totalBytesExpectedToWrite }) => {
      if (totalBytesExpectedToWrite <= 0) return;
      onProgress?.(Math.min(1, totalBytesWritten / totalBytesExpectedToWrite));
    },
  );
  let result: Awaited<ReturnType<typeof task.downloadAsync>>;
  try {
    result = await task.downloadAsync();
  } catch (error) {
    throw new PublicAppError(APP_ERROR_CODES.UPDATE_PACKAGE_DOWNLOAD, error);
  }
  if (!result?.uri) throw new PublicAppError(APP_ERROR_CODES.UPDATE_PACKAGE_DOWNLOAD);

  const info = await FileSystem.getInfoAsync(result.uri, { md5: true });
  if (!info.exists || info.isDirectory) throw new PublicAppError(APP_ERROR_CODES.UPDATE_PACKAGE_DOWNLOAD);
  if (release.fileSize > 0 && info.size !== release.fileSize) {
    await FileSystem.deleteAsync(result.uri, { idempotent: true });
    throw new PublicAppError(APP_ERROR_CODES.UPDATE_PACKAGE_INTEGRITY);
  }
  if (release.md5 && String(info.md5 || '').toLowerCase() !== release.md5.toLowerCase()) {
    await FileSystem.deleteAsync(result.uri, { idempotent: true });
    throw new PublicAppError(APP_ERROR_CODES.UPDATE_PACKAGE_INTEGRITY);
  }

  onProgress?.(1);
  await openAndroidInstaller(result.uri);
}

export async function downloadOtaUpdate() {
  try {
    await retryOtaOperation(() => Updates.fetchUpdateAsync());
  } catch (error) {
    throw await classifyOtaFailure(error, 'fetch');
  }
}

export async function reloadOtaUpdate(appearance: {
  backgroundColor: string;
  spinnerColor: string;
}) {
  try {
    await Updates.reloadAsync({
      reloadScreenOptions: {
        backgroundColor: appearance.backgroundColor,
        fade: true,
        spinner: {
          enabled: true,
          color: appearance.spinnerColor,
          size: 'large',
        },
      },
    });
  } catch (error) {
    throw await classifyOtaFailure(error, 'reload');
  }
}
