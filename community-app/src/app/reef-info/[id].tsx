import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { Alert } from '@/components/app-alert';
import { Image as ExpoImage } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { getReefOverview, reportReef } from '@/api/client';
import { Pressable } from '@/components/pressable';
import { ScreenHeader } from '@/components/screen-header';
import { useWs } from '@/contexts/ws';
import { useTheme } from '@/lib/theme';
import { MessageActionModal } from '@/components/message-action-modal';

function parseBeijingTime(value?: string | null) {
  if (!value) return null;
  return new Date(value.includes('T') ? value : `${value.replace(' ', 'T')}+08:00`);
}

function formatCountdown(expiresAt?: string | null, nowMs = Date.now()) {
  const end = parseBeijingTime(expiresAt);
  if (!end) return '长期开放';
  const seconds = Math.max(0, Math.floor((end.getTime() - nowMs) / 1000));
  if (!seconds) return '存续时间已结束';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  return days > 0 ? `${days}天 ${hours}小时 ${minutes}分 ${secs}秒` : `${hours}小时 ${minutes}分 ${secs}秒`;
}

export default function ReefInfoScreen() {
  const { id, name, color } = useLocalSearchParams<{ id: string; name?: string; color?: string }>();
  const router = useRouter();
  const { colors } = useTheme();
  const { reefEvents } = useWs();
  const [overview, setOverview] = useState<any>(null);
  const [nowMs, setNowMs] = useState(Date.now());
  const [reportOpen, setReportOpen] = useState(false);
  const [reportLoading, setReportLoading] = useState(false);
  const expiryRefreshRef = useRef(false);
  const accent = color || colors.accent;

  const load = useCallback(async () => {
    try { setOverview(await getReefOverview(id)); } catch {}
  }, [id]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const latest = reefEvents[reefEvents.length - 1];
    if (latest?.roomId === id) void load();
  }, [id, load, reefEvents]);
  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    const end = parseBeijingTime(overview?.expiresAt);
    if (end && end.getTime() <= nowMs && !expiryRefreshRef.current) {
      expiryRefreshRef.current = true;
      void load();
    }
  }, [load, nowMs, overview?.expiresAt]);

  const speakers = useMemo(() => overview?.speakers || [], [overview]);
  return (
    <View style={[s.page, { backgroundColor: colors.bg }]}>
      <ScreenHeader title="礁石概览" floating right={<Pressable accessibilityLabel="举报礁石" hitSlop={8} style={s.reportButton} onPress={() => setReportOpen(true)}><Ionicons name="flag-outline" size={20} color={colors.danger} /></Pressable>} />
      <View style={[s.summary, { backgroundColor: colors.card }]}>
        <View style={[s.reefIcon, { backgroundColor: accent + '1D' }]}><Ionicons name="layers-outline" size={26} color={accent} /></View>
        <Text style={[s.reefName, { color: colors.text }]}>{overview?.name || name || '礁石'}</Text>
        <Text style={[s.count, { color: colors.textMuted }]}>{overview?.currentCount || 0}人正在礁间交谈</Text>
        <View style={[s.countdown, { backgroundColor: accent + '12', borderColor: accent + '35' }]}>
          <Ionicons name="hourglass-outline" size={15} color={accent} />
          <Text style={[s.countdownText, { color: accent }]}>存续倒计时 · {formatCountdown(overview?.expiresAt, nowMs)}</Text>
        </View>
      </View>
      <Text style={[s.sectionTitle, { color: colors.text }]}>发言成员 · {speakers.length}</Text>
      <FlatList
        data={speakers}
        keyExtractor={(item) => item.id}
        contentContainerStyle={s.list}
        ListEmptyComponent={<Text style={[s.empty, { color: colors.textMuted }]}>还没有人留下声音</Text>}
        renderItem={({ item }) => (
          <Pressable
            style={[s.member, { backgroundColor: colors.card }]}
            onPress={() => router.push({ pathname: '/user/[name]', params: { name: item.nickname, userId: item.id } })}
          >
            <View style={[s.avatar, { backgroundColor: accent + '22' }]}>
              {item.avatar ? <ExpoImage source={{ uri: item.avatar }} style={s.avatarImage} cachePolicy="memory-disk" /> : <Text style={[s.avatarText, { color: accent }]}>{item.nickname?.[0] || '?'}</Text>}
            </View>
            <View style={s.memberText}>
              <Text style={[s.memberName, { color: colors.text }]} numberOfLines={1}>{item.nickname}</Text>
              <Text style={[s.memberMeta, { color: colors.textMuted }]}>发言 {item.messageCount || 0} 条</Text>
            </View>
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
          </Pressable>
        )}
      />
      <MessageActionModal visible={reportOpen} mode="other" reportOnly accent={accent} loading={reportLoading} onClose={() => setReportOpen(false)} onReport={async (reason, detail) => { setReportLoading(true); try { await reportReef(id, reason, detail); setReportOpen(false); } catch (error) { Alert.alert('举报失败', error instanceof Error ? error.message : '请稍后重试'); } finally { setReportLoading(false); } }} />
    </View>
  );
}

const s = StyleSheet.create({
  page: { flex: 1 },
  summary: { margin: 12, marginBottom: 4, borderRadius: 14, padding: 18, alignItems: 'center' },
  reefIcon: { width: 52, height: 52, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  reefName: { fontSize: 20, fontWeight: '800', marginTop: 10 },
  count: { fontSize: 12, marginTop: 4 },
  countdown: { minHeight: 38, flexDirection: 'row', alignItems: 'center', borderRadius: 10, borderWidth: 1, paddingHorizontal: 12, marginTop: 14, gap: 6 },
  countdownText: { fontSize: 13, fontWeight: '600' },
  sectionTitle: { fontSize: 15, fontWeight: '700', marginHorizontal: 16, marginTop: 15, marginBottom: 8 },
  list: { paddingHorizontal: 12, paddingBottom: 28 },
  member: { minHeight: 62, flexDirection: 'row', alignItems: 'center', borderRadius: 12, paddingHorizontal: 11, marginBottom: 6 },
  avatar: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarImage: { width: '100%', height: '100%' },
  avatarText: { fontSize: 16, fontWeight: '700' },
  memberText: { flex: 1, minWidth: 0, marginLeft: 10 },
  memberName: { fontSize: 14, fontWeight: '700' },
  memberMeta: { fontSize: 11, marginTop: 3 },
  empty: { textAlign: 'center', marginTop: 52 },
  reportButton: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center' },
});
