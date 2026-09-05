import { Stack } from 'expo-router';
import { Platform } from 'react-native';
import * as SplashScreen from 'expo-splash-screen';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { ThemeProvider, useTheme } from '@/lib/theme';
import { AuthProvider } from '@/contexts/auth';
import { WsProvider } from '@/contexts/ws';
import { IncomingChatSnowflake } from '@/components/incoming-chat-snowflake';
import { BannedAccountGate } from '@/components/banned-account-gate';
import { CommunityConfigProvider } from '@/contexts/community-config';
import { useCallback, useEffect, useMemo, useState } from 'react';
import * as SystemUI from 'expo-system-ui';
import { PushRegistration } from '@/components/push-registration';
import { AchievementToast } from '@/components/achievement-toast';
import { AppAlertHost } from '@/components/app-alert';
import { AppErrorScreen } from '@/components/app-error-screen';
import { LaunchScreen } from '@/components/launch-screen';
import { PostUpdateModal } from '@/components/post-update-modal';
import { getUnseenRunningUpdateLog, markRunningUpdateLogShown, type RunningUpdateLog } from '@/lib/update-history';
import { ColdStartUpdateGate } from '@/components/cold-start-update-gate';

export { AppErrorScreen as ErrorBoundary };

void SplashScreen.preventAutoHideAsync().catch(() => {});

const LIGHT_HEADER = '#FFFFFF';
const DARK_HEADER = '#1A1C24';
const LIGHT_TEXT = '#1A1D26';
const DARK_TEXT = '#E8E9ED';
const LIGHT_BG = '#F5F6FA';
const DARK_BG = '#12141A';
const LIGHT_ACCENT = '#33A9DC';
const DARK_ACCENT = '#7FD8F5';

type LaunchSessionGlobal = typeof globalThis & {
  __siduLaunchScreenClaimed?: boolean;
};

/**
 * Expo Router may recreate the root layout while the native process is still
 * alive (for example after startup state hydration). The launch screen belongs
 * to the app process, not to a particular React tree, so claim it once before
 * the first layout is mounted.
 */
function claimLaunchScreenForCurrentSession() {
  const launchSession = globalThis as LaunchSessionGlobal;
  if (launchSession.__siduLaunchScreenClaimed) return false;
  launchSession.__siduLaunchScreenClaimed = true;
  return true;
}

function StackContent() {
  const { isDark } = useTheme();

  useEffect(() => {
    const bg = isDark ? DARK_BG : LIGHT_BG;
    // 原生端：把窗口底色设为主题背景色，页面切换动画期间露出的窗口底色与主题同色
    SystemUI.setBackgroundColorAsync(bg);
    // web 端：浏览器 body 默认是白色，路由切换重绘的瞬间会露出来（深色主题下就是闪白），
    // 这里把 html/body 一并刷成主题背景色
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      document.documentElement.style.backgroundColor = bg;
      document.body.style.backgroundColor = bg;
    }
  }, [isDark]);

  const screenOptions = useMemo(() => ({
    headerTitleAlign: 'center' as const,
    headerShadowVisible: false,
    headerStyle: { backgroundColor: isDark ? DARK_HEADER : LIGHT_HEADER },
    headerTitleStyle: { fontSize: 17, fontWeight: '600' as const, color: isDark ? DARK_TEXT : LIGHT_TEXT },
    headerTintColor: isDark ? DARK_ACCENT : LIGHT_ACCENT,
    headerBackTitleVisible: false,
    contentStyle: { backgroundColor: isDark ? DARK_BG : LIGHT_BG },
    statusBarStyle: (isDark ? 'light' : 'dark') as 'light' | 'dark',
    ...(Platform.OS === 'web'
      ? { animation: 'none' as const }
      : { animation: 'fade' as const, animationDuration: 150, gestureEnabled: true }),
    freezeOnBlur: false,
  }), [isDark]);

  return (
    <>
      <Stack screenOptions={screenOptions}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="login" options={{ headerShown: false }} />
        <Stack.Screen name="post/[id]" options={{ title: '切片详情', headerShown: false }} />
        <Stack.Screen name="user/[name]" options={{ title: '个人主页', headerShown: false }} />
        <Stack.Screen name="chat/[name]" options={{ title: '私信', headerShown: false }} />
        <Stack.Screen name="blacklist" options={{ title: '黑名单管理', headerShown: false }} />
        <Stack.Screen name="liked-posts" options={{ headerShown: false }} />
        <Stack.Screen name="user-list" options={{ title: '用户列表', headerShown: false }} />
        <Stack.Screen name="edit-profile" options={{ title: '编辑资料', headerShown: false }} />
        <Stack.Screen name="settings" options={{ title: '设置', headerShown: false }} />
        <Stack.Screen name="feedback" options={{ headerShown: false }} />
        <Stack.Screen name="feedback-history" options={{ headerShown: false }} />
        <Stack.Screen name="legal/[document]" options={{ headerShown: false }} />
        <Stack.Screen name="off-the-land" options={{ title: '离地而居', headerShown: false }} />
        <Stack.Screen name="boards" options={{ title: '永冻层', headerShown: false, gestureEnabled: true, animation: 'slide_from_right' }} />
        <Stack.Screen name="account" options={{ title: '账户与安全', headerShown: false }} />
        <Stack.Screen name="publish" options={{ headerShown: false, presentation: 'modal' }} />
        <Stack.Screen name="select-board" options={{ headerShown: false }} />
        <Stack.Screen name="select-topic" options={{ headerShown: false }} />
        <Stack.Screen name="board/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="topic/[name]" options={{ headerShown: false }} />
        <Stack.Screen name="notifications" options={{ headerShown: false }} />
        <Stack.Screen name="appeal" options={{ headerShown: false }} />
        <Stack.Screen
          name="undercurrent"
          options={{
            headerShown: false,
            animation: 'none',
            presentation: 'transparentModal',
            contentStyle: { backgroundColor: 'transparent' },
          }}
        />
        <Stack.Screen name="reef/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="reef-info/[id]" options={{ headerShown: false }} />
        <Stack.Screen name="message-favorites" options={{ headerShown: false }} />
        <Stack.Screen name="achievements" options={{ headerShown: false }} />
        <Stack.Screen name="slice-boxes" options={{ headerShown: false }} />
        <Stack.Screen name="slice-box/[id]" options={{ headerShown: false }} />
      </Stack>
      <AchievementToast />
      <AppAlertHost />
      <IncomingChatSnowflake />
      <PushRegistration />
      <BannedAccountGate />
    </>
  );
}

function UpdateLogGate({ enabled }: { enabled: boolean }) {
  const [entry, setEntry] = useState<{ updateId: string; log: RunningUpdateLog } | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      getUnseenRunningUpdateLog().then(result => {
        if (!cancelled && result) setEntry(result);
      }).catch(() => {});
    }, 450);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [enabled]);
  return (
    <PostUpdateModal
      visible={!!entry}
      log={entry?.log || null}
      onClose={() => {
        if (entry) void markRunningUpdateLogShown(entry.updateId);
        setEntry(null);
      }}
    />
  );
}

export default function RootLayout() {
  const [showLaunchScreen, setShowLaunchScreen] = useState(claimLaunchScreenForCurrentSession);
  const [coldStartUpdateSettled, setColdStartUpdateSettled] = useState(false);
  const finishLaunchScreen = useCallback(() => setShowLaunchScreen(false), []);
  const finishColdStartUpdateCheck = useCallback(() => setColdStartUpdateSettled(true), []);

  useEffect(() => {
    // A recreated root layout does not render LaunchScreen again, but it must
    // never leave a newly attached native splash waiting for an onLayout event.
    if (!showLaunchScreen) void SplashScreen.hideAsync().catch(() => {});
  }, [showLaunchScreen]);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <ThemeProvider>
        <AuthProvider>
          <CommunityConfigProvider>
            <WsProvider>
              <StackContent />
              {showLaunchScreen && <LaunchScreen onFinish={finishLaunchScreen} />}
              <ColdStartUpdateGate enabled={!showLaunchScreen} onSettled={finishColdStartUpdateCheck} />
              <UpdateLogGate enabled={!showLaunchScreen && coldStartUpdateSettled} />
            </WsProvider>
          </CommunityConfigProvider>
        </AuthProvider>
      </ThemeProvider>
    </GestureHandlerRootView>
  );
}
