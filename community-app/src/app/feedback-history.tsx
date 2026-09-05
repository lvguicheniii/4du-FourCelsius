import { useCallback, useState } from 'react';
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { ScreenHeader } from '@/components/screen-header';
import { getFeedbackHistory } from '@/api/client';
import { useTheme } from '@/lib/theme';
import { AppRefreshControl } from '@/components/app-refresh-control';

type FeedbackItem = {
  id: string; content: string; imageUrl?: string | null; status: string;
  reviewedAt?: string | null; replyContent?: string; repliedAt?: string | null; createdAt: string;
};

function formatTime(value: string) {
  const date = new Date(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? value.replace(' ', 'T') + '+08:00' : value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
}

export default function FeedbackHistoryScreen() {
  const { colors } = useTheme();
  const [items, setItems] = useState<FeedbackItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (refresh = false) => {
    refresh ? setRefreshing(true) : setLoading(true);
    try { setItems((await getFeedbackHistory()).feedback || []); }
    catch { setItems([]); }
    finally { refresh ? setRefreshing(false) : setLoading(false); }
  }, []);
  useFocusEffect(useCallback(() => { void load(); }, [load]));

  return <View style={[styles.page, { backgroundColor: colors.bg }]}>
    <ScreenHeader title="历史反馈" />
    {loading ? <ActivityIndicator color={colors.accent} style={{ marginTop: 70 }} /> : (
      <ScrollView contentContainerStyle={styles.content} refreshControl={<AppRefreshControl refreshing={refreshing} onRefresh={() => load(true)} progressViewOffset={12} colors={[colors.accent]} tintColor={colors.accent} progressBackgroundColor={colors.card} />}>
        {!items.length ? <Text style={[styles.empty, { color: colors.textMuted }]}>还没有提交过反馈</Text> : items.map(item => (
          <View key={item.id} style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
            <View style={styles.metaRow}>
              <Text style={[styles.time, { color: colors.textMuted }]}>{formatTime(item.createdAt)}</Text>
              <View style={styles.badges}>
                {item.reviewedAt ? <Text style={[styles.badge, { color: colors.accent, backgroundColor: colors.accent + '18' }]}>已查看</Text> : <Text style={[styles.badge, { color: colors.textMuted, backgroundColor: colors.input }]}>待查看</Text>}
                {item.replyContent ? <Text style={[styles.badge, { color: '#28A071', backgroundColor: '#28A07118' }]}>已回复</Text> : null}
              </View>
            </View>
            <Text style={[styles.body, { color: colors.text }]}>{item.content}</Text>
            {item.imageUrl ? <Image source={{ uri: item.imageUrl }} style={[styles.image, { backgroundColor: colors.input }]} resizeMode="cover" /> : null}
            {item.replyContent ? <View style={[styles.reply, { backgroundColor: colors.input, borderLeftColor: colors.accent }]}><Text style={[styles.replyLabel, { color: colors.accent }]}>肆度官方回复</Text><Text style={[styles.replyText, { color: colors.text }]}>{item.replyContent}</Text></View> : null}
          </View>
        ))}
      </ScrollView>
    )}
  </View>;
}

const styles = StyleSheet.create({
  page: { flex: 1 }, content: { padding: 14, paddingBottom: 36, gap: 12 },
  empty: { marginTop: 80, textAlign: 'center', fontSize: 14 },
  card: { borderWidth: 1, borderRadius: 8, padding: 15 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  time: { flex: 1, fontSize: 11 }, badges: { flexDirection: 'row', gap: 6 },
  badge: { overflow: 'hidden', borderRadius: 4, paddingHorizontal: 7, paddingVertical: 3, fontSize: 10, fontWeight: '600' },
  body: { marginTop: 12, fontSize: 14, lineHeight: 23 },
  image: { width: 118, height: 118, borderRadius: 7, marginTop: 12 },
  reply: { marginTop: 14, padding: 12, borderLeftWidth: 3, borderRadius: 5 },
  replyLabel: { fontSize: 11, fontWeight: '700', marginBottom: 6 },
  replyText: { fontSize: 13, lineHeight: 21 },
});
