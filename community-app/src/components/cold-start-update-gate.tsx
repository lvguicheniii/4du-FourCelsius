import { Platform } from 'react-native';
import * as Updates from 'expo-updates';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppUpdateModal, type UpdatePhase } from '@/components/app-update-modal';
import {
  checkForAppUpdate,
  downloadAndInstallAndroidRelease,
  downloadOtaUpdate,
  openStoreRelease,
  reloadOtaUpdate,
  type AppUpdate,
} from '@/lib/app-updater';
import { APP_ERROR_CODES, publicErrorMessage } from '@/lib/app-error-codes';
import { useTheme } from '@/lib/theme';

type LaunchGlobal = typeof globalThis & {
  __siduColdStartUpdateCheckClaimed?: boolean;
};

function claimColdStartUpdateCheck() {
  const launch = globalThis as LaunchGlobal;
  if (launch.__siduColdStartUpdateCheckClaimed) return false;
  launch.__siduColdStartUpdateCheckClaimed = true;
  return true;
}

export function ColdStartUpdateGate({ enabled, onSettled }: { enabled: boolean; onSettled: () => void }) {
  const { colors } = useTheme();
  const [visible, setVisible] = useState(false);
  const [phase, setPhase] = useState<UpdatePhase>('available');
  const [message, setMessage] = useState('');
  const [pendingUpdate, setPendingUpdate] = useState<AppUpdate | null>(null);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const reloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const otaState = Updates.useUpdates();

  useEffect(() => () => {
    if (reloadTimerRef.current) clearTimeout(reloadTimerRef.current);
  }, []);

  useEffect(() => {
    if (!enabled) return;
    if (!claimColdStartUpdateCheck()) {
      onSettled();
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      checkForAppUpdate().then(update => {
        if (cancelled) return;
        if (update.kind === 'none') {
          onSettled();
          return;
        }
        setPendingUpdate(update);
        setMessage(update.kind === 'native' || update.kind === 'store'
          ? (update.release.releaseNotes || '包含功能改进与问题修复')
          : '发现在线更新，点击后将自动下载并重新启动 App。');
        setPhase('available');
        setVisible(true);
      }).catch(() => {
        if (!cancelled) onSettled();
      });
    }, 500);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [enabled, onSettled]);

  const close = useCallback(() => {
    if (phase === 'downloading') return;
    setVisible(false);
    setPendingUpdate(null);
    onSettled();
  }, [onSettled, phase]);

  const install = useCallback(async () => {
    if (!pendingUpdate || pendingUpdate.kind === 'none') return;
    if (pendingUpdate.kind === 'store') {
      try {
        await openStoreRelease(pendingUpdate.release);
        close();
      } catch (error: any) {
        setMessage(publicErrorMessage(error, APP_ERROR_CODES.UPDATE_PACKAGE_METADATA));
        setPhase('error');
      }
      return;
    }

    setPhase('downloading');
    setMessage(pendingUpdate.kind === 'native'
      ? '正在下载安装包，请保持网络连接。'
      : '正在下载在线更新，请保持网络连接。');
    setDownloadProgress(0);

    if (pendingUpdate.kind === 'native') {
      try {
        await downloadAndInstallAndroidRelease(pendingUpdate.release, setDownloadProgress);
        setVisible(false);
        setPendingUpdate(null);
        onSettled();
      } catch (error: any) {
        setMessage(publicErrorMessage(error, APP_ERROR_CODES.UPDATE_PACKAGE_DOWNLOAD));
        setPhase('error');
      }
      return;
    }

    try {
      await downloadOtaUpdate();
      setVisible(false);
      setPendingUpdate(null);
      reloadTimerRef.current = setTimeout(() => {
        reloadTimerRef.current = null;
        void reloadOtaUpdate({
          backgroundColor: colors.bg,
          spinnerColor: colors.accent,
        }).catch((error: any) => {
          setMessage(publicErrorMessage(error, APP_ERROR_CODES.UPDATE_RELOAD));
          setPhase('error');
          setVisible(true);
        });
      }, Platform.OS === 'android' ? 420 : 180);
    } catch (error: any) {
      setMessage(publicErrorMessage(error, APP_ERROR_CODES.UPDATE_FETCH_NETWORK));
      setPhase('error');
    }
  }, [close, colors.accent, colors.bg, onSettled, pendingUpdate]);

  const progress = phase === 'downloading'
    && pendingUpdate?.kind === 'ota'
    && Number.isFinite(Number(otaState.downloadProgress))
    ? Math.max(0, Math.min(1, Number(otaState.downloadProgress)))
    : downloadProgress;
  const preparingOta = phase === 'downloading'
    && pendingUpdate?.kind === 'ota'
    && progress >= 0.985;

  return (
    <AppUpdateModal
      visible={visible}
      phase={phase}
      title={phase === 'downloading'
        ? preparingOta ? '正在校验更新' : '正在下载更新'
        : phase === 'error'
          ? '更新失败'
          : pendingUpdate?.kind === 'ota'
            ? '发现在线更新'
            : `发现新版本 ${pendingUpdate && pendingUpdate.kind !== 'none' ? pendingUpdate.release.versionName : ''}`}
      message={preparingOta ? '资源已下载，正在校验完整性并准备重启，请稍候。' : message}
      progress={progress}
      progressLabel={preparingOta ? '正在校验…' : undefined}
      primaryText={phase === 'error'
        ? '关闭'
        : pendingUpdate?.kind === 'store'
          ? `前往${pendingUpdate.release.storeName}更新`
          : pendingUpdate?.kind === 'native'
            ? '下载并安装'
            : '立即更新'}
      onPrimary={phase === 'error' ? close : () => { void install(); }}
      onClose={close}
    />
  );
}
