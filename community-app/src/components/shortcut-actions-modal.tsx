import { Modal, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Pressable } from '@/components/pressable';
import { useTheme } from '@/lib/theme';

export function ShortcutActionsModal({ visible, kind, important, onClose, onHide, onToggleImportant }: {
  visible: boolean;
  kind: 'chat' | 'reef';
  important: boolean;
  onClose: () => void;
  onHide: () => void;
  onToggleImportant: () => void;
}) {
  const { colors, isDark } = useTheme();
  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <Pressable style={[s.overlay, { backgroundColor: isDark ? 'rgba(0,0,0,0.68)' : 'rgba(18,20,26,0.42)' }]} onPress={onClose}>
        <Pressable style={[s.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]} onPress={(event) => event.stopPropagation()}>
          <View style={[s.handle, { backgroundColor: colors.divider }]} />
          <Text style={[s.title, { color: colors.text }]}>{kind === 'chat' ? '私信操作' : '礁石操作'}</Text>
          <Pressable style={[s.action, { backgroundColor: colors.input }]} onPress={onToggleImportant}>
            <Ionicons name={important ? 'bookmark' : 'bookmark-outline'} size={21} color={colors.accent} />
            <Text style={[s.actionText, { color: colors.text }]}>{important ? '取消重要' : kind === 'chat' ? '设为重要对话' : '设为重要礁石'}</Text>
          </Pressable>
          <Pressable style={[s.action, { backgroundColor: colors.danger + '12' }]} onPress={onHide}>
            <Ionicons name="trash-outline" size={21} color={colors.danger} />
            <Text style={[s.actionText, { color: colors.danger }]}>{kind === 'chat' ? '删除对话' : '删除礁石'}</Text>
          </Pressable>
          <Pressable style={s.cancel} onPress={onClose}><Text style={[s.cancelText, { color: colors.textMuted }]}>取消</Text></Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 36 },
  card: { width: '100%', maxWidth: 330, borderWidth: 1, borderRadius: 20, padding: 14 },
  handle: { width: 34, height: 4, borderRadius: 2, alignSelf: 'center', marginBottom: 13 },
  title: { fontSize: 17, fontWeight: '800', textAlign: 'center', marginBottom: 14 },
  action: { minHeight: 48, borderRadius: 13, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 15, marginBottom: 8 },
  actionText: { fontSize: 15, fontWeight: '700', marginLeft: 10 },
  cancel: { height: 42, alignItems: 'center', justifyContent: 'center' },
  cancelText: { fontSize: 14, fontWeight: '600' },
});
