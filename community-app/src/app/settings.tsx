import { ActivityIndicator, Image, Platform, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { Pressable } from '@/components/pressable';
import { Ionicons } from '@expo/vector-icons';
import { AwardIcon } from '@/components/award-icon';
import { useRouter } from 'expo-router';
import { ScreenHeader } from '@/components/screen-header';
import * as Application from 'expo-application';
import * as Updates from 'expo-updates';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useTheme } from '@/lib/theme';
import { useAuth } from '@/contexts/auth';
import { ConfirmModal } from '@/components/confirm-modal';
import { AppUpdateModal, type UpdatePhase } from '@/components/app-update-modal';
import {
  checkForAppUpdate,
  downloadOtaUpdate,
  downloadAndInstallAndroidRelease,
  openStoreRelease,
  reloadOtaUpdate,
  type AppUpdate,
} from '@/lib/app-updater';
import { clearAppCache, formatCacheSize, getAppCacheSize } from '@/lib/app-cache';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { APP_ERROR_CODES, publicErrorMessage } from '@/lib/app-error-codes';

export default function SettingsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, isDark, followsSystem, setDarkMode, setFollowSystem } = useTheme();
  const { token, isLoading, logout } = useAuth();
  const [logoutConfirm, setLogoutConfirm] = useState(false);
  const [updateDialogOpen, setUpdateDialogOpen] = useState(false);
  const [updatePhase, setUpdatePhase] = useState<UpdatePhase>('checking');
  const [updateMessage, setUpdateMessage] = useState('正在连接更新服务…');
  const [updating, setUpdating] = useState(false);
  const [pendingUpdate, setPendingUpdate] = useState<AppUpdate | null>(null);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [pressedRow, setPressedRow] = useState<string | null>(null);
  const [cacheBytes, setCacheBytes] = useState(0);
  const [cacheConfirm, setCacheConfirm] = useState(false);
  const [clearingCache, setClearingCache] = useState(false);
  const [nightSwitchValue, setNightSwitchValue] = useState(isDark);
  const nightThemeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const otaReloadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const otaState = Updates.useUpdates();

  const activateRow = useCallback((id: string, action: () => void) => {
    setPressedRow(id);
    setTimeout(() => {
      setPressedRow(current => current === id ? null : current);
      action();
    }, 100);
  }, []);

  useEffect(() => {
    if (!isLoading && !token) router.replace('/login');
  }, [isLoading, router, token]);

  useEffect(() => {
    getAppCacheSize().then(setCacheBytes).catch(() => {});
  }, []);

  useEffect(() => {
    setNightSwitchValue(isDark);
  }, [isDark]);

  useEffect(() => () => {
    if (nightThemeTimerRef.current) clearTimeout(nightThemeTimerRef.current);
    if (otaReloadTimerRef.current) clearTimeout(otaReloadTimerRef.current);
  }, []);

  const changeNightMode = useCallback((nextDark: boolean) => {
    setNightSwitchValue(nextDark);
    if (nightThemeTimerRef.current) clearTimeout(nightThemeTimerRef.current);
    if (Platform.OS !== 'ios') {
      setDarkMode(nextDark);
      return;
    }
    // 先让 iOS 原生 Switch 完成滑块动画，再切换整棵应用主题，避免重渲染打断手势反馈。
    nightThemeTimerRef.current = setTimeout(() => {
      nightThemeTimerRef.current = null;
      setDarkMode(nextDark);
    }, 220);
  }, [setDarkMode]);

  const clearCache = useCallback(async () => {
    if (clearingCache) return;
    setClearingCache(true);
    try {
      await clearAppCache();
      setCacheBytes(await getAppCacheSize());
      setCacheConfirm(false);
    } finally {
      setClearingCache(false);
    }
  }, [clearingCache]);

  const checkForUpdates = useCallback(async () => {
    setPendingUpdate(null);
    setDownloadProgress(0);
    setUpdateMessage('正在连接更新服务…');
    setUpdatePhase('checking');
    setUpdateDialogOpen(true);
    try {
      const update = await checkForAppUpdate();
      if (update.kind === 'none') {
        setUpdateMessage(`当前版本 ${update.versionName}`);
        setUpdatePhase('current');
        return;
      }
      setPendingUpdate(update);
      setUpdateMessage(update.kind === 'native'
        ? (update.release.releaseNotes || '包含功能改进与问题修复')
        : update.kind === 'store'
          ? (update.release.releaseNotes || '包含功能改进与问题修复')
        : '在线更新已准备好，下载完成后 App 将自动重新启动。');
      setUpdatePhase('available');
    } catch (error: any) {
      console.warn('Update check failed', error);
      setUpdateMessage(publicErrorMessage(error, APP_ERROR_CODES.UPDATE_CHECK_SERVICE));
      setUpdatePhase('error');
    }
  }, []);

  const visibleDownloadProgress = updatePhase === 'downloading'
    && pendingUpdate?.kind === 'ota'
    && Number.isFinite(Number(otaState.downloadProgress))
    ? Math.max(0, Math.min(1, Number(otaState.downloadProgress)))
    : downloadProgress;
  const preparingOta = updatePhase === 'downloading'
    && pendingUpdate?.kind === 'ota'
    && visibleDownloadProgress >= 0.985;

  const installUpdate = useCallback(async () => {
    if (!pendingUpdate || pendingUpdate.kind === 'none') return;

    if (pendingUpdate.kind === 'store') {
      setUpdating(true);
      try {
        await openStoreRelease(pendingUpdate.release);
        setUpdateDialogOpen(false);
      } catch (error: any) {
        setUpdateMessage(publicErrorMessage(error, APP_ERROR_CODES.UPDATE_PACKAGE_METADATA));
        setUpdatePhase('error');
      } finally {
        setUpdating(false);
      }
      return;
    }

    setUpdating(true);
    setDownloadProgress(0);
    setUpdateMessage(pendingUpdate.kind === 'native' ? '正在下载安装包，请保持网络连接。' : '正在下载在线更新，请保持网络连接。');
    setUpdatePhase('downloading');

    if (pendingUpdate.kind === 'ota') {
      try {
        await downloadOtaUpdate();
      } catch (error: any) {
        console.warn('OTA download failed', error);
        setUpdateMessage(publicErrorMessage(error, APP_ERROR_CODES.UPDATE_FETCH_NETWORK));
        setUpdatePhase('error');
        setUpdating(false);
        return;
      }

      setUpdateDialogOpen(false);
      setPendingUpdate(null);
      otaReloadTimerRef.current = setTimeout(() => {
        otaReloadTimerRef.current = null;
        void reloadOtaUpdate({
          backgroundColor: colors.bg,
          spinnerColor: colors.accent,
        }).catch((error: any) => {
          console.warn('OTA reload failed', error);
          setUpdating(false);
          setUpdateMessage(publicErrorMessage(error, APP_ERROR_CODES.UPDATE_RELOAD));
          setUpdatePhase('error');
          setUpdateDialogOpen(true);
        });
      }, Platform.OS === 'android' ? 420 : 180);
      return;
    }

    try {
      await downloadAndInstallAndroidRelease(pendingUpdate.release, setDownloadProgress);
      setUpdateDialogOpen(false);
    } catch (error: any) {
      console.warn('Update installation failed', error);
      setUpdateMessage(publicErrorMessage(
        error,
        APP_ERROR_CODES.UPDATE_PACKAGE_DOWNLOAD,
      ));
      setUpdatePhase('error');
    } finally {
      setUpdating(false);
    }
  }, [colors.accent, colors.bg, pendingUpdate]);

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScreenHeader
        title="设置"
        backFallback="/(tabs)/profile"
        rightWidth={48}
        right={(
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="进入离地而居"
            hitSlop={10}
            onPress={() => activateRow('coffee', () => router.push('/off-the-land' as any))}
            style={styles.coffeeButton}
          >
            <Image source={require('../../assets/images/Coffee.png')} style={styles.coffeeIcon} resizeMode="contain" fadeDuration={0} />
          </Pressable>
        )}
      />
      <ScrollView
        style={{ flex: 1, backgroundColor: colors.bg }}
        contentContainerStyle={{ paddingBottom: Math.max(32, insets.bottom + 24) }}
        showsVerticalScrollIndicator={false}
      >
      <View style={[styles.section, { backgroundColor: colors.card }]}>
        <Pressable
          style={[styles.row, styles.border, { borderBottomColor: colors.divider }, pressedRow === 'account' && { backgroundColor: colors.accentBg }]}
          onPress={() => activateRow('account', () => router.push('/account'))}
        >
          <Ionicons name="shield-checkmark-outline" size={20} color={colors.accent} />
          <Text style={[styles.label, { color: colors.text }]}>账户与安全</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
        </Pressable>

        <Pressable
          style={[styles.row, styles.border, { borderBottomColor: colors.divider }, pressedRow === 'blacklist' && { backgroundColor: colors.accentBg }]}
          onPress={() => activateRow('blacklist', () => router.push('/blacklist'))}
        >
          <Ionicons name="ban-outline" size={20} color={colors.accent} />
          <Text style={[styles.label, { color: colors.text }]}>黑名单管理</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
        </Pressable>

        <Pressable
          style={[styles.row, styles.border, { borderBottomColor: colors.divider }, pressedRow === 'liked' && { backgroundColor: colors.accentBg }]}
          onPress={() => activateRow('liked', () => router.push('/liked-posts'))}
        >
          <Ionicons name="snow-outline" size={20} color={colors.accent} />
          <Text style={[styles.label, { color: colors.text }]}>霜迹</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
        </Pressable>

        <Pressable
          style={[styles.row, styles.border, { borderBottomColor: colors.divider }, pressedRow === 'achievements' && { backgroundColor: colors.accentBg }]}
          onPress={() => activateRow('achievements', () => router.push('/achievements' as any))}
        >
          <AwardIcon size={20} color={colors.accent} />
          <Text style={[styles.label, { color: colors.text }]}>航行日志</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
        </Pressable>

        <View style={[styles.row, styles.border, { borderBottomColor: colors.divider }]}>
          <Ionicons name="phone-portrait-outline" size={20} color={colors.accent} />
          <Text style={[styles.label, { color: colors.text }]}>跟随系统外观</Text>
          <Switch
            value={followsSystem}
            onValueChange={setFollowSystem}
            trackColor={{ false: '#D5D8E2', true: colors.accent }}
            thumbColor={Platform.OS === 'android' ? '#FFFFFF' : undefined}
          />
        </View>

        <View style={styles.row}>
          <Ionicons name="moon-outline" size={20} color={followsSystem ? colors.textMuted : colors.accent} />
          <Text style={[styles.label, { color: followsSystem ? colors.textMuted : colors.text }]}>夜间模式</Text>
          <View pointerEvents={followsSystem ? 'none' : 'auto'}>
            <Switch
              value={nightSwitchValue}
              onValueChange={changeNightMode}
              accessibilityState={{ disabled: followsSystem }}
              trackColor={{ false: '#D5D8E2', true: colors.accent }}
              thumbColor={Platform.OS === 'android' ? '#FFFFFF' : undefined}
            />
          </View>
        </View>
      </View>

      <View style={[styles.section, { backgroundColor: colors.card }]}>
        <Pressable
          style={[styles.row, styles.border, { borderBottomColor: colors.divider }, pressedRow === 'updates' && { backgroundColor: colors.accentBg }]}
          onPress={() => {
            if (updatePhase === 'checking' && updateDialogOpen) return;
            setPressedRow('updates');
            void checkForUpdates();
            setTimeout(() => setPressedRow(current => current === 'updates' ? null : current), 100);
          }}
        >
          <Ionicons name="cloud-download-outline" size={20} color={colors.accent} />
          <Text style={[styles.label, { color: colors.text }]}>检查更新</Text>
          <Text style={[styles.valueText, { color: colors.textMuted }]}>v{Application.nativeApplicationVersion || '1.0.0'}</Text>
        </Pressable>
        <Pressable
          style={[styles.row, styles.border, { borderBottomColor: colors.divider }, pressedRow === 'cache' && { backgroundColor: colors.accentBg }]}
          onPress={() => activateRow('cache', () => setCacheConfirm(true))}
        >
          <Ionicons name="layers-outline" size={20} color={colors.accent} />
          <Text style={[styles.label, { color: colors.text }]}>清除缓存</Text>
          {clearingCache
            ? <ActivityIndicator size="small" color={colors.accent} />
            : <Text style={[styles.valueText, { color: colors.textMuted }]}>{formatCacheSize(cacheBytes)}</Text>}
        </Pressable>
        <Pressable style={[styles.row, pressedRow === 'feedback' && { backgroundColor: colors.accentBg }]} onPress={() => activateRow('feedback', () => router.push('/feedback' as any))}>
          <Ionicons name="chatbox-ellipses-outline" size={20} color={colors.accent} />
          <Text style={[styles.label, { color: colors.text }]}>我要反馈</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
        </Pressable>
      </View>

      <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>协议与隐私</Text>
      <View style={[styles.section, styles.legalSection, { backgroundColor: colors.card }]}>
        {[
          ['用户协议', 'user-agreement'],
          ['隐私政策', 'privacy-policy'],
          ['个人信息收集清单', 'personal-info-list'],
          ['第三方信息共享清单', 'third-party-sharing'],
          ['儿童个人信息保护规则及监护人须知', 'children-privacy'],
        ].map(([label, document], index, items) => (
          <Pressable
            key={document}
            style={[styles.row, index < items.length - 1 && styles.border, { borderBottomColor: colors.divider }, pressedRow === document && { backgroundColor: colors.accentBg }]}
            onPress={() => activateRow(document, () => router.push({ pathname: '/legal/[document]' as any, params: { document } }))}
          >
            <Ionicons name="document-text-outline" size={20} color={colors.accent} />
            <Text style={[styles.label, { color: colors.text }]}>{label}</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
          </Pressable>
        ))}
      </View>

      {!!token && (
        <View style={[styles.section, { backgroundColor: colors.card, marginTop: 18 }]}>
          <Pressable style={[styles.row, pressedRow === 'logout' && { backgroundColor: colors.accentBg }]} onPress={() => activateRow('logout', () => setLogoutConfirm(true))}>
            <Ionicons name="log-out-outline" size={20} color={colors.danger} />
            <Text style={[styles.label, { color: colors.danger }]}>退出登录</Text>
          </Pressable>
        </View>
      )}

      <AppUpdateModal
        visible={updateDialogOpen}
        phase={updatePhase}
        title={updatePhase === 'checking'
          ? '正在检查更新'
          : updatePhase === 'current'
            ? '已是最新版本'
            : updatePhase === 'error'
              ? (pendingUpdate ? '更新失败' : '更新检查失败')
              : updatePhase === 'downloading'
              ? preparingOta ? '正在校验更新' : '正在下载更新'
                : pendingUpdate?.kind === 'native' || pendingUpdate?.kind === 'store'
                  ? `发现新版本 ${pendingUpdate.release.versionName}`
                  : '发现在线更新'}
        message={preparingOta ? '资源已下载，正在校验完整性并准备重启，请稍候。' : updateMessage}
        progress={visibleDownloadProgress}
        progressLabel={preparingOta ? '正在校验…' : undefined}
        primaryText={updatePhase === 'available'
          ? (pendingUpdate?.kind === 'native'
              ? '下载并安装'
              : pendingUpdate?.kind === 'store'
                ? `前往${pendingUpdate.release.storeName}更新`
                : '立即更新')
          : updatePhase === 'error'
            ? '重新检测'
            : '知道了'}
        onClose={() => {
          if (updating) return;
          setUpdateDialogOpen(false);
          setPendingUpdate(null);
        }}
        onPrimary={() => {
          if (updatePhase === 'available') void installUpdate();
          else if (updatePhase === 'error') void checkForUpdates();
          else setUpdateDialogOpen(false);
        }}
      />

      <ConfirmModal
        visible={cacheConfirm}
        title="清除本地缓存"
        message={`将清除 ${formatCacheSize(cacheBytes)} 的头像、图片、表情包和临时文件。账号、聊天记录、设置和已安装更新不会受到影响。`}
        confirmText={clearingCache ? '正在清理' : '确认清理'}
        tone="accent"
        icon="layers-outline"
        loading={clearingCache}
        onCancel={() => { if (!clearingCache) setCacheConfirm(false); }}
        onConfirm={() => void clearCache()}
      />

      <ConfirmModal
        visible={logoutConfirm}
        title="退出登录"
        message="确定要退出当前账号吗？"
        confirmText="退出"
        tone="danger"
        icon="log-out-outline"
        onCancel={() => setLogoutConfirm(false)}
        onConfirm={async () => {
          setLogoutConfirm(false);
          await logout();
          // 先清空当前根栈，再用登录页替换根页面，返回键不会回到旧账号页面。
          router.dismissAll();
          router.replace('/login');
        }}
      />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    borderRadius: 14,
    overflow: 'hidden',
    marginHorizontal: 12,
    marginTop: 12,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    overflow: 'hidden',
  },
  border: {
    borderBottomWidth: 1,
  },
  label: { flex: 1, fontSize: 15, marginLeft: 12 },
  valueText: { fontSize: 12, fontWeight: '600', fontVariant: ['tabular-nums'] },
  sectionTitle: { marginTop: 22, marginHorizontal: 18, marginBottom: -4, fontSize: 12, fontWeight: '600' },
  legalSection: { marginBottom: 8 },
  coffeeButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  coffeeIcon: { width: 28, height: 28 },
});
