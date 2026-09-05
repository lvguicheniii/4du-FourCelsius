import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { Pressable } from '@/components/pressable';
import { ScreenHeader } from '@/components/screen-header';
import { AwardIcon } from '@/components/award-icon';
import { AchievementItem, getAchievements } from '@/api/client';
import { useTheme } from '@/lib/theme';
import { formatFullDateTime } from '@/lib/time';
import { AppRefreshControl } from '@/components/app-refresh-control';

export default function AchievementsScreen() {
  const { colors } = useTheme();
  const [items, setItems] = useState<AchievementItem[]>([]);
  const [selected, setSelected] = useState<AchievementItem | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (refresh = false) => {
    if (refresh) setRefreshing(true);
    else setLoading(true);
    try {
      const result = await getAchievements();
      setItems(result.achievements || []);
    } finally {
      if (refresh) setRefreshing(false);
      else setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));

  return (
    <View style={[styles.page, { backgroundColor: colors.bg }]}>
      <ScreenHeader title="航行日志" />
      {loading ? (
        <View style={styles.loading}><ActivityIndicator color={colors.accent} /></View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={item => item.key}
          contentContainerStyle={styles.list}
          refreshControl={<AppRefreshControl refreshing={refreshing} onRefresh={() => load(true)} progressViewOffset={12} colors={[colors.accent]} tintColor={colors.accent} progressBackgroundColor={colors.card} />}
          renderItem={({ item }) => (
            <Pressable
              disabled={!item.unlocked}
              onPress={() => item.unlocked && setSelected(item)}
              style={[
                styles.card,
                {
                  backgroundColor: item.unlocked ? colors.card : (colors.textMuted + '12'),
                  borderColor: item.unlocked ? colors.cardBorder : (colors.textMuted + '28'),
                },
              ]}
            >
              <AwardIcon size={20} color={item.unlocked ? colors.accent : colors.textMuted} />
              <Text style={[
                styles.cardName,
                { color: item.unlocked ? colors.text : colors.textMuted },
              ]}>{item.name}</Text>
              {item.unlocked && <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />}
            </Pressable>
          )}
        />
      )}

      <Modal visible={!!selected} transparent animationType="fade" onRequestClose={() => setSelected(null)}>
        <Pressable style={styles.backdrop} onPress={() => setSelected(null)}>
          <Pressable
            style={[styles.modal, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}
            onPress={event => event.stopPropagation()}
          >
            <View style={[styles.modalStar, { backgroundColor: colors.accentBg }]}>
              <AwardIcon size={28} color={colors.accent} />
            </View>
            <Text style={[styles.modalName, { color: colors.text }]}>{selected?.name}</Text>
            <Text style={[styles.modalHint, { color: colors.textSecondary }]}>“{selected?.hint}”</Text>
            <View style={[styles.condition, { backgroundColor: colors.bg, borderColor: colors.cardBorder }]}>
              <Text style={[styles.conditionText, { color: colors.textSecondary }]}>达成条件：{selected?.conditionText}</Text>
            </View>
            {!!selected?.unlockedAt && (
              <View style={styles.unlockTimeRow}>
                <Ionicons name="time-outline" size={14} color={colors.textMuted} />
                <Text style={[styles.unlockTime, { color: colors.textMuted }]}>解锁时间：{formatFullDateTime(selected.unlockedAt)}</Text>
              </View>
            )}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { padding: 12, paddingBottom: 36, gap: 9 },
  card: {
    minHeight: 58,
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 8,
    paddingHorizontal: 15,
    flexDirection: 'row',
    alignItems: 'center',
  },
  cardName: { flex: 1, marginLeft: 11, fontSize: 15, fontWeight: '700' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.38)', alignItems: 'center', justifyContent: 'center', padding: 28 },
  modal: { width: '100%', maxWidth: 390, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, padding: 22, alignItems: 'center' },
  modalStar: { width: 54, height: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center' },
  modalName: { marginTop: 13, fontSize: 20, lineHeight: 27, fontWeight: '800', textAlign: 'center' },
  modalHint: { marginTop: 9, fontSize: 14, lineHeight: 22, fontStyle: 'italic', textAlign: 'center' },
  condition: { alignSelf: 'stretch', marginTop: 18, padding: 13, borderWidth: StyleSheet.hairlineWidth, borderRadius: 6 },
  conditionText: { fontSize: 13, lineHeight: 21 },
  unlockTimeRow: { alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, marginTop: 13 },
  unlockTime: { fontSize: 11, lineHeight: 17 },
});
