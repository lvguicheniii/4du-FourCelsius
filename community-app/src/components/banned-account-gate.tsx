import { useEffect, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useGlobalSearchParams, usePathname, useRouter } from 'expo-router';
import { Pressable } from '@/components/pressable';
import { useAuth } from '@/contexts/auth';
import { useTheme } from '@/lib/theme';
import { restrictionRemaining } from '@/lib/account-restrictions';

export function BannedAccountGate() {
  const router = useRouter();
  const pathname = usePathname();
  const routeParams = useGlobalSearchParams<{ category?: string; restricted?: string }>();
  const { colors } = useTheme();
  const { user, logout } = useAuth();
  const [showSettings, setShowSettings] = useState(false);
  const [, tick] = useState(0);
  const banned = user?.status === 'banned' &&
    (!user.ban_until || Date.parse(user.ban_until) > Date.now());

  useEffect(() => {
    if (!banned) return;
    const timer = setInterval(() => tick((value) => value + 1), 30_000);
    return () => clearInterval(timer);
  }, [banned]);

  const isAppealRoute =
    pathname === '/appeal' ||
    (pathname === '/notifications' && routeParams.category === 'system' && routeParams.restricted === '1');
  if (!banned || isAppealRoute) return null;

  const handleLogout = async () => {
    await logout();
    router.dismissAll();
    router.replace('/login');
  };

  return (
    <View style={[styles.gate, { backgroundColor: colors.bg }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="设置"
        style={[styles.settingsButton, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}
        onPress={() => setShowSettings((value) => !value)}
      >
        <Ionicons name="settings-outline" size={23} color={colors.text} />
      </Pressable>

      <View style={[styles.panel, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
        <View style={[styles.iconCircle, { backgroundColor: colors.accentBg }]}>
          <Ionicons name="snow-outline" size={38} color={colors.accent} />
        </View>
        <Text style={[styles.title, { color: colors.text }]}>您已被封禁</Text>
        <Text style={[styles.remaining, { color: colors.accent }]}>
          剩余封禁时长：{restrictionRemaining(user?.ban_until)}
        </Text>
        {!!user?.ban_reason && (
          <Text style={[styles.reason, { color: colors.textMuted }]}>原因：{user.ban_reason}</Text>
        )}
        <Text style={[styles.explanation, { color: colors.textMuted }]}>
          封禁期间无法查看浮霜带、潜流域、消息和个人主页。退出后再次登录，限制仍会保留。
        </Text>
        <Pressable
          style={[styles.appealButton, { borderColor: colors.accent }]}
          onPress={() => router.push({ pathname: '/notifications', params: { category: 'system', restricted: '1' } })}
        >
          <Ionicons name="mail-outline" size={17} color={colors.accent} />
          <Text style={{ color: colors.accent, fontWeight: '600' }}>查看系统通知与申诉</Text>
        </Pressable>
      </View>

      {showSettings && (
        <View style={[styles.settingsPanel, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
          <View style={styles.settingsTitle}>
            <Ionicons name="settings-outline" size={18} color={colors.text} />
            <Text style={{ color: colors.text, fontWeight: '600' }}>设置</Text>
          </View>
          <Pressable style={[styles.logoutButton, { borderColor: colors.danger }]} onPress={() => void handleLogout()}>
            <Ionicons name="log-out-outline" size={18} color={colors.danger} />
            <Text style={{ color: colors.danger, fontWeight: '600' }}>退出登录</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  gate: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 20_000,
    elevation: 20_000,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  settingsButton: {
    position: 'absolute',
    top: 54,
    right: 20,
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  panel: {
    width: '100%',
    maxWidth: 420,
    paddingHorizontal: 28,
    paddingVertical: 32,
    borderWidth: 1,
    borderRadius: 22,
    alignItems: 'center',
  },
  iconCircle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  title: { fontSize: 23, fontWeight: '700' },
  remaining: { fontSize: 15, fontWeight: '600', marginTop: 10 },
  reason: { fontSize: 13, lineHeight: 20, textAlign: 'center', marginTop: 8 },
  explanation: { fontSize: 12, lineHeight: 20, textAlign: 'center', marginTop: 18 },
  appealButton: {
    minHeight: 42,
    marginTop: 20,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderRadius: 12,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
  settingsPanel: {
    position: 'absolute',
    top: 106,
    right: 20,
    width: 190,
    borderWidth: 1,
    borderRadius: 14,
    padding: 14,
  },
  settingsTitle: { flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 13 },
  logoutButton: {
    minHeight: 42,
    borderWidth: 1,
    borderRadius: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 7,
  },
});
