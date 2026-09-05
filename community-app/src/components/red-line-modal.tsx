import { Ionicons } from '@expo/vector-icons';
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Pressable } from '@/components/pressable';
import { useTheme } from '@/lib/theme';

const RULES = [
  '严禁发布反动、涉政、暴恐及一切违背现实法律的内容。',
  '严禁发布任何色情、淫秽、低俗及擦边内容。',
  '严禁谩骂、人身攻击、恶意引战与网络暴力。',
  '严禁发布广告、营销、黑产及恶意引流信息。',
];

export function RedLineLink({ onPress, size = 13 }: { onPress: () => void; size?: number }) {
  return <Text accessibilityRole="link" accessibilityLabel="查看肆度红线" onPress={onPress} style={{ color: '#E05260', fontSize: size, lineHeight: size + 6, fontWeight: '700' }}>【肆度红线】</Text>;
}

export function RedLineModal({ visible, onClose, embedded = false }: { visible: boolean; onClose: () => void; embedded?: boolean }) {
  const { colors } = useTheme();
  const content = <Pressable
    style={[s.backdrop, embedded && s.embeddedBackdrop]}
    onPress={event => {
      if (embedded) event.stopPropagation();
      onClose();
    }}
  >
    <Pressable style={[s.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]} onPress={event => event.stopPropagation()}>
      <View style={s.header}>
        <View style={s.titleRow}><Ionicons name="warning" size={20} color="#E05260" /><Text style={[s.title, { color: colors.text }]}>肆度红线</Text></View>
        <Pressable accessibilityLabel="关闭肆度红线" style={[s.close, { backgroundColor: colors.input }]} onPress={onClose}><Ionicons name="close" size={20} color={colors.textMuted} /></Pressable>
      </View>
      <ScrollView showsVerticalScrollIndicator={false}>
        <Text style={[s.warning, { color: colors.text }]}>“违反以下规则会触发最严厉的惩罚！”</Text>
        <View style={s.rules}>
          {RULES.map((rule, index) => <View key={rule} style={[s.rule, { borderColor: colors.divider, backgroundColor: colors.input }]}><Text style={s.number}>{index + 1}</Text><Text style={[s.ruleText, { color: colors.textSecondary }]}>{rule}</Text></View>)}
        </View>
      </ScrollView>
    </Pressable>
  </Pressable>;
  if (embedded) return visible ? content : null;
  return <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>{content}</Modal>;
}

const s = StyleSheet.create({
  backdrop: { flex: 1, paddingHorizontal: 22, backgroundColor: 'rgba(5,12,20,0.58)', alignItems: 'center', justifyContent: 'center' },
  embeddedBackdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 20, elevation: 20 },
  card: { width: '100%', maxWidth: 390, maxHeight: '78%', borderRadius: 18, borderWidth: StyleSheet.hairlineWidth, padding: 18 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 13 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  title: { fontSize: 18, fontWeight: '800' },
  close: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  warning: { fontSize: 14, lineHeight: 22, fontStyle: 'italic', fontWeight: '700', marginBottom: 14 },
  rules: { gap: 9 },
  rule: { flexDirection: 'row', alignItems: 'flex-start', borderWidth: StyleSheet.hairlineWidth, borderRadius: 12, padding: 11 },
  number: { width: 23, height: 23, borderRadius: 12, backgroundColor: '#E05260', color: '#FFFFFF', textAlign: 'center', lineHeight: 23, fontSize: 12, fontWeight: '800', marginRight: 9 },
  ruleText: { flex: 1, fontSize: 13, lineHeight: 21 },
});
