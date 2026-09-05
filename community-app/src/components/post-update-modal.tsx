import { Ionicons } from '@expo/vector-icons';
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Pressable } from '@/components/pressable';
import { useTheme } from '@/lib/theme';
import type { RunningUpdateLog } from '@/lib/update-history';

export function PostUpdateModal({ visible, log, onClose }: { visible: boolean; log: RunningUpdateLog | null; onClose: () => void }) {
  const { colors, isDark } = useTheme();
  const notes = String(log?.releaseNotes || '').split(/\r?\n/).map(item => item.trim()).filter(Boolean);
  return (
    <Modal visible={visible && !!log} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={[styles.overlay, { backgroundColor: isDark ? 'rgba(0,0,0,.72)' : 'rgba(17,29,38,.42)' }]}>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.accent + '42' }]}>
          <View style={[styles.icon, { backgroundColor: colors.accent + '18' }]}>
            <Ionicons name="sparkles" size={28} color={colors.accent} />
          </View>
          <Text style={[styles.eyebrow, { color: colors.accent }]}>航行系统已更新</Text>
          <Text style={[styles.version, { color: colors.text }]}>{log?.versionName}</Text>
          <Text style={[styles.title, { color: colors.text }]}>{log?.title}</Text>
          <ScrollView style={styles.notesScroll} contentContainerStyle={styles.notes} showsVerticalScrollIndicator={false}>
            {notes.map((note, index) => (
              <View key={`${index}-${note}`} style={styles.noteRow}>
                <View style={[styles.dot, { backgroundColor: colors.accent }]} />
                <Text style={[styles.noteText, { color: colors.textSecondary }]}>{note.replace(/^[-•·]\s*/, '')}</Text>
              </View>
            ))}
          </ScrollView>
          <View style={[styles.divider, { backgroundColor: colors.divider }]} />
          <Text style={[styles.date, { color: colors.textMuted }]}>{log?.releaseDate} · {log?.stage === 'development' ? '开发测试版' : '正式版'}</Text>
          <Pressable style={[styles.button, { backgroundColor: colors.accent }]} onPress={onClose}>
            <Text style={styles.buttonText}>开始航行</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 30 },
  card: { width: '100%', maxWidth: 342, maxHeight: '72%', borderRadius: 24, borderWidth: 1, paddingHorizontal: 22, paddingTop: 23, paddingBottom: 20, shadowColor: '#062638', shadowOffset: { width: 0, height: 14 }, shadowOpacity: 0.24, shadowRadius: 30, elevation: 16 },
  icon: { width: 56, height: 56, alignSelf: 'center', borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  eyebrow: { marginTop: 13, textAlign: 'center', fontSize: 12, fontWeight: '700', letterSpacing: 1.1 },
  version: { marginTop: 4, textAlign: 'center', fontSize: 24, lineHeight: 31, fontWeight: '800', fontVariant: ['tabular-nums'] },
  title: { marginTop: 5, textAlign: 'center', fontSize: 15, lineHeight: 22, fontWeight: '600' },
  notesScroll: { marginTop: 17, flexGrow: 0 },
  notes: { gap: 11, paddingVertical: 2 },
  noteRow: { flexDirection: 'row', alignItems: 'flex-start', paddingRight: 4 },
  dot: { width: 6, height: 6, borderRadius: 3, marginTop: 7, marginRight: 10, flexShrink: 0 },
  noteText: { flex: 1, fontSize: 13, lineHeight: 20 },
  divider: { height: StyleSheet.hairlineWidth, marginTop: 17 },
  date: { marginTop: 10, textAlign: 'center', fontSize: 11 },
  button: { minHeight: 46, marginTop: 16, borderRadius: 15, alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
});
