import { useEffect } from 'react';
import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo';
import { router } from 'expo-router';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import * as SecureStore from 'expo-secure-store';
import { registerPushToken } from '@/api/client';
import { useAuth } from '@/contexts/auth';
import { useCommunityConfig } from '@/contexts/community-config';

type NotificationsModule = typeof import('expo-notifications');
let notificationHandlerReady = false;

// 旧开发版尚未包含通知原生模块时保持 App 可用；重新构建后会自动启用推送。
function loadNotifications(): NotificationsModule | null {
  // Expo Go 自 SDK 53 起不再提供 Android 远程推送；在加载模块前拦截，
  // 避免 expo-notifications 的模块初始化代码直接抛出全局错误。
  if (
    (Constants as any).appOwnership === 'expo' ||
    (Constants as any).executionEnvironment === 'storeClient' ||
    !requireOptionalNativeModule('ExpoPushTokenManager') ||
    !requireOptionalNativeModule('ExpoNotificationsEmitter')
  ) return null;
  try {
    return require('expo-notifications') as NotificationsModule;
  } catch {
    return null;
  }
}

export function PushRegistration() {
  const { token } = useAuth();
  const { features } = useCommunityConfig();

  useEffect(() => {
    if (!token || features.offline_push === false || Platform.OS === 'web' || !Device.isDevice) return;
    const Notifications = loadNotifications();
    if (!Notifications) return;
    if (!notificationHandlerReady) {
      Notifications.setNotificationHandler({
        handleNotification: async () => ({
          shouldShowBanner: true,
          shouldShowList: true,
          shouldPlaySound: true,
          shouldSetBadge: true,
        }),
      });
      notificationHandlerReady = true;
    }
    let cancelled = false;
    (async () => {
      if (Platform.OS === 'android') {
        await Notifications.setNotificationChannelAsync('sidu-social', {
          name: '肆度消息',
          importance: Notifications.AndroidImportance.HIGH,
          vibrationPattern: [0, 180, 90, 180],
          lightColor: '#33A9DC',
        });
      }
      const current = await Notifications.getPermissionsAsync();
      const permission = current.status === 'granted'
        ? current
        : await Notifications.requestPermissionsAsync();
      if (permission.status !== 'granted' || cancelled) return;
      const projectId = Constants.expoConfig?.extra?.eas?.projectId || Constants.easConfig?.projectId;
      if (!projectId) return;
      const result = await Notifications.getExpoPushTokenAsync({ projectId });
      if (cancelled) return;
      await SecureStore.setItemAsync('expo_push_token', result.data);
      await registerPushToken(result.data, Platform.OS as 'android' | 'ios');
    })().catch(() => {});
    return () => { cancelled = true; };
  }, [features.offline_push, token]);

  useEffect(() => {
    const Notifications = loadNotifications();
    if (!Notifications) return;
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as Record<string, any>;
      if (data?.chatName) {
        router.push({
          pathname: '/chat/[name]',
          params: { name: String(data.chatName), peerUserId: String(data.fromUserId || '') },
        });
      } else if (data?.postId) {
        router.push({ pathname: '/post/[id]', params: { id: String(data.postId) } });
      } else {
        router.push('/notifications');
      }
    });
    return () => subscription.remove();
  }, []);

  return null;
}
