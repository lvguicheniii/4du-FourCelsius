import { StyleSheet, Text, View } from 'react-native';
import { Pressable } from '@/components/pressable';
import { useTheme } from '@/lib/theme';

export function PinnedProfileCard({ content, onPress }: { content?: string | null; onPress?: () => void }) {
  const { colors } = useTheme();
  const text = String(content || '').trim();

  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={onPress ? '编辑置顶卡片' : undefined}
      disabled={!onPress}
      onPress={onPress}
      style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
      <View style={styles.header}>
        <View style={[styles.topBadge, { backgroundColor: colors.accent + '10', borderColor: colors.accent + '38' }]}>
          <Text style={[styles.topText, { color: colors.accent }]}>TOP</Text>
        </View>
      </View>
      <Text style={[styles.content, { color: text ? colors.text : colors.textMuted }]}>
        {text || '点击编辑置顶卡片'}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: 12,
    marginBottom: 12,
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingTop: 13,
    paddingBottom: 15,
    minHeight: 72,
  },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start', marginBottom: 9 },
  topBadge: { height: 22, minWidth: 38, paddingHorizontal: 8, borderRadius: 7, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  topText: { fontSize: 9, fontWeight: '800', letterSpacing: 0 },
  content: { fontSize: 14, lineHeight: 22 },
});
