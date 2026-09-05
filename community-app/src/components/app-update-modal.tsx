import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Modal, StyleSheet, Text, View } from 'react-native';
import { Pressable } from '@/components/pressable';
import { useTheme } from '@/lib/theme';

export type UpdatePhase = 'checking' | 'current' | 'available' | 'downloading' | 'error';

type Props = {
  visible: boolean;
  phase: UpdatePhase;
  title: string;
  message: string;
  progress: number;
  progressLabel?: string;
  primaryText?: string;
  onPrimary: () => void;
  onClose: () => void;
};

export function AppUpdateModal({ visible, phase, title, message, progress, progressLabel, primaryText, onPrimary, onClose }: Props) {
  const { colors, isDark } = useTheme();
  const busy = phase === 'checking' || phase === 'downloading';
  const normalizedProgress = Math.max(0, Math.min(1, progress || 0));
  const icon = phase === 'current' ? 'checkmark-circle-outline' : phase === 'error' ? 'alert-circle-outline' : 'cloud-download-outline';

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={busy ? () => {} : onClose}>
      <View style={[styles.overlay, { backgroundColor: isDark ? 'rgba(0,0,0,0.68)' : 'rgba(18,20,26,0.42)' }]}>
        <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
          <View style={[styles.iconWrap, { backgroundColor: colors.accent + '17' }]}>
            {phase === 'checking'
              ? <ActivityIndicator size="large" color={colors.accent} />
              : <Ionicons name={icon} size={29} color={phase === 'error' ? colors.danger : colors.accent} />}
          </View>
          <Text style={[styles.title, { color: colors.text }]}>{title}</Text>
          <Text style={[styles.message, { color: colors.textMuted }]}>{message}</Text>

          {phase === 'downloading' && (
            <View style={styles.progressSection}>
              <View style={[styles.progressTrack, { backgroundColor: colors.divider, borderColor: colors.cardBorder }]}>
                <View style={[styles.progressFill, { width: `${normalizedProgress * 100}%`, backgroundColor: colors.accent }]} />
              </View>
              <Text style={[styles.progressText, { color: colors.accent }]}>{progressLabel || `${Math.round(normalizedProgress * 100)}%`}</Text>
            </View>
          )}

          {!busy && (
            <View style={styles.actions}>
              {phase === 'available' && (
                <Pressable style={[styles.button, { backgroundColor: colors.input, borderColor: colors.cardBorder }]} onPress={onClose}>
                  <Text style={[styles.secondaryText, { color: colors.textSecondary }]}>稍后</Text>
                </Pressable>
              )}
              <Pressable style={[styles.button, { backgroundColor: colors.accent + '1F', borderColor: colors.accent + '58' }]} onPress={onPrimary}>
                <Text style={[styles.primaryText, { color: colors.accent }]}>{primaryText || (phase === 'error' ? '重新检测' : '知道了')}</Text>
              </Pressable>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 34 },
  card: { width: '100%', maxWidth: 326, borderRadius: 22, borderWidth: 1, paddingHorizontal: 20, paddingTop: 24, paddingBottom: 20, shadowColor: '#000', shadowOffset: { width: 0, height: 10 }, shadowOpacity: 0.18, shadowRadius: 24, elevation: 14 },
  iconWrap: { width: 58, height: 58, borderRadius: 18, alignSelf: 'center', alignItems: 'center', justifyContent: 'center' },
  title: { marginTop: 15, fontSize: 18, lineHeight: 24, fontWeight: '700', textAlign: 'center' },
  message: { marginTop: 8, fontSize: 13, lineHeight: 20, textAlign: 'center' },
  progressSection: { marginTop: 22 },
  progressTrack: { height: 10, borderRadius: 5, borderWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  progressFill: { height: '100%', borderRadius: 5 },
  progressText: { marginTop: 8, fontSize: 13, fontWeight: '800', textAlign: 'center', fontVariant: ['tabular-nums'] },
  actions: { flexDirection: 'row', gap: 10, marginTop: 22 },
  button: { flex: 1, minHeight: 44, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { fontSize: 15, fontWeight: '600' },
  primaryText: { fontSize: 15, fontWeight: '700' },
});
