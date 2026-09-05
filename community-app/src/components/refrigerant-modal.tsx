import { Ionicons } from '@expo/vector-icons';
import { useEffect } from 'react';
import { Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Pressable } from '@/components/pressable';
import { RefrigerantIcon } from '@/components/refrigerant-icon';
import { useTheme } from '@/lib/theme';

type Props = {
  visible: boolean;
  onClose: () => void;
};

export function RefrigerantModal({ visible, onClose }: Props) {
  const { colors, isDark } = useTheme();

  useEffect(() => {
    if (!visible) return;
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={[styles.overlay, { backgroundColor: isDark ? 'rgba(0,0,0,0.68)' : 'rgba(18,20,26,0.40)' }]}>
        <Pressable accessibilityLabel="关闭制冷剂规则" style={styles.backdrop} onPress={onClose} />
        <View style={[styles.panel, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
          <View style={styles.topRow}>
            <View style={[styles.iconBox, { backgroundColor: colors.accent + '16', borderColor: colors.accent + '45' }]}>
              <RefrigerantIcon size={28} color={colors.accent} />
            </View>
            <Text style={[styles.heading, { color: colors.text }]}>制冷剂</Text>
            <Pressable accessibilityLabel="关闭制冷剂规则" hitSlop={8} style={styles.closeButton} onPress={onClose}>
              <Ionicons name="close" size={22} color={colors.textMuted} />
            </Pressable>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
            <View style={styles.rulesList}>
              {[
                '每天首次登录获得 1 瓶制冷剂，最多储存 4 瓶。',
                '制冷剂无法转赠，可对自己或他人的切片使用，增加推荐权重，同时降低 1°C。',
              ].map((rule, index) => (
                <View key={rule} style={[styles.ruleCard, index > 0 && styles.ruleCardSpacing, { backgroundColor: colors.input, borderColor: colors.cardBorder }]}>
                  <View style={[styles.ruleIndex, { backgroundColor: colors.accent + '17' }]}>
                    <Text style={[styles.ruleIndexText, { color: colors.accent }]}>{index + 1}</Text>
                  </View>
                  <Text style={[styles.rule, { color: colors.textSecondary }]}>{rule}</Text>
                </View>
              ))}
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 22 },
  backdrop: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  panel: {
    width: '100%',
    maxWidth: 420,
    borderRadius: 22,
    borderWidth: 1,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.22,
    shadowRadius: 28,
    elevation: 18,
  },
  topRow: { minHeight: 76, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center' },
  iconBox: { width: 46, height: 46, borderRadius: 15, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  heading: { flex: 1, marginLeft: 12, fontSize: 24, fontWeight: '800' },
  closeButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: 18, paddingBottom: 26, paddingTop: 4 },
  rulesList: { width: '100%' },
  ruleCard: { alignSelf: 'stretch', minHeight: 42, paddingHorizontal: 9, paddingVertical: 8, borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, flexDirection: 'row', alignItems: 'flex-start', gap: 7 },
  ruleCardSpacing: { marginTop: 8 },
  ruleIndex: { width: 20, height: 20, flexShrink: 0, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  ruleIndexText: { fontSize: 10, fontWeight: '800' },
  rule: { flex: 1, minWidth: 0, flexShrink: 1, fontSize: 12, lineHeight: 18, includeFontPadding: false },
});
