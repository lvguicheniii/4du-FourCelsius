import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Dimensions, Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Pressable } from '@/components/pressable';
import { FrostShellIcon } from '@/components/frost-shell-icon';
import { useTheme } from '@/lib/theme';

type Props = {
  visible: boolean;
  fragileCount: number;
  eternalCount: number;
  onClose: () => void;
};

export function FrostShellModal({ visible, fragileCount, eternalCount, onClose }: Props) {
  const { colors, isDark } = useTheme();
  const [showRules, setShowRules] = useState(false);

  const handleClose = () => {
    setShowRules(false);
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={handleClose}>
      <View style={[styles.overlay, { backgroundColor: isDark ? 'rgba(0,0,0,0.68)' : 'rgba(18,20,26,0.42)' }]}>
        <Pressable accessibilityLabel="关闭贝壳" style={styles.backdrop} onPress={handleClose} />
        <View style={[styles.panel, showRules && styles.panelExpanded, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
          <View style={styles.topRow}>
            <View style={[styles.iconBox, { backgroundColor: colors.accent + '16', borderColor: colors.accent + '45' }]}>
              <FrostShellIcon size={30} color={colors.accent} />
            </View>
            <View style={styles.headingWrap}>
              <Text style={[styles.heading, { color: colors.text }]}>贝壳</Text>
              <Pressable
                accessibilityLabel="查看贝壳规则"
                accessibilityRole="button"
                hitSlop={8}
                style={[styles.helpButton, { backgroundColor: colors.accent + '14', borderColor: colors.accent + '48' }]}
                onPress={() => setShowRules((value) => !value)}
              >
                <Ionicons name="help" size={15} color={colors.accent} />
              </Pressable>
            </View>
            <Pressable accessibilityLabel="关闭贝壳" hitSlop={8} style={styles.closeButton} onPress={handleClose}>
              <Ionicons name="close" size={22} color={colors.textMuted} />
            </Pressable>
          </View>

          <ScrollView style={styles.scrollContent} showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
            <View style={styles.inventoryStack}>
              <View style={[styles.inventoryRow, { backgroundColor: colors.input, borderColor: colors.cardBorder }]}>
                <View style={[styles.shellIconWell, { backgroundColor: colors.accent + '12' }]}>
                  <FrostShellIcon size={28} color={colors.accent} cracked />
                </View>
                <View style={styles.inventoryCopy}>
                  <Text style={[styles.inventoryLabel, { color: colors.text }]}>脆弱浮霜贝</Text>
                  <Text style={[styles.inventoryHint, { color: colors.textMuted }]}>可赠予 · 每日在线获得</Text>
                </View>
                <Text style={[styles.inventoryValue, { color: colors.accent }]}>{Math.max(0, fragileCount)} 枚</Text>
              </View>
              <View style={[styles.inventoryRow, { backgroundColor: colors.accent + (isDark ? '0D' : '09'), borderColor: colors.accent + '35' }]}>
                <View style={[styles.shellIconWell, { backgroundColor: colors.accent + '16' }]}>
                  <FrostShellIcon size={28} color={colors.accent} />
                </View>
                <View style={styles.inventoryCopy}>
                  <Text style={[styles.inventoryLabel, { color: colors.text }]}>永恒浮霜贝</Text>
                  <Text style={[styles.inventoryHint, { color: colors.textMuted }]}>永久保存 · 无限积累</Text>
                </View>
                <Text style={[styles.inventoryValue, { color: colors.accent }]}>{Math.max(0, eternalCount)} 枚</Text>
              </View>
            </View>

            {showRules && (
              <View style={[styles.rulesPanel, { borderTopColor: colors.divider }]}>
                <View style={styles.rulesHeader}>
                  <Text style={[styles.rulesTitle, { color: colors.text }]}>贝壳规则</Text>
                  <Pressable accessibilityLabel="收起贝壳规则" hitSlop={8} style={styles.rulesCloseButton} onPress={() => setShowRules(false)}>
                    <Ionicons name="close" size={18} color={colors.textMuted} />
                  </Pressable>
                </View>
                <View style={styles.rulesList}>
                  {[
                    '每天在线4分钟可获得1枚【脆弱浮霜贝】，日上限1枚，存储上限4枚。',
                    '【脆弱浮霜贝】可赠予他人，同时转化为【永恒浮霜贝】，象征友好、善意、认可。',
                    '面对同一用户，每天仅可赠送其1枚【脆弱浮霜贝】。',
                    '【永恒浮霜贝】无法转赠，无法使用，永久保存，无限积累。',
                  ].map((rule, index) => (
                    <View
                      key={rule}
                      style={[
                        styles.ruleCard,
                        index > 0 && styles.ruleCardSpacing,
                        { backgroundColor: colors.input, borderColor: colors.cardBorder },
                      ]}
                    >
                      <View style={[styles.ruleIndex, { backgroundColor: colors.accent + '17' }]}>
                        <Text style={[styles.ruleIndexText, { color: colors.accent }]}>{index + 1}</Text>
                      </View>
                      <Text style={[styles.ruleText, { color: colors.textSecondary }]}>{rule}</Text>
                    </View>
                  ))}
                </View>
              </View>
            )}
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
    maxHeight: Math.round(Dimensions.get('window').height * 0.72),
    borderRadius: 22,
    borderWidth: 1,
    overflow: 'hidden',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.22,
    shadowRadius: 28,
    elevation: 18,
  },
  panelExpanded: { maxHeight: Math.round(Dimensions.get('window').height * 0.9) },
  topRow: { minHeight: 76, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center' },
  iconBox: { width: 46, height: 46, borderRadius: 15, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  headingWrap: { flex: 1, marginLeft: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  heading: { fontSize: 24, fontWeight: '800' },
  helpButton: { width: 24, height: 24, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  closeButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  scrollContent: { flexGrow: 0, flexShrink: 1 },
  content: { paddingHorizontal: 18, paddingBottom: 28 },
  inventoryStack: { marginTop: 5, gap: 10 },
  inventoryRow: { minHeight: 70, paddingHorizontal: 12, borderWidth: 1, borderRadius: 15, flexDirection: 'row', alignItems: 'center', gap: 11 },
  shellIconWell: { width: 44, height: 44, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  inventoryCopy: { flex: 1, minWidth: 0 },
  inventoryLabel: { fontSize: 15, fontWeight: '700' },
  inventoryHint: { fontSize: 11, lineHeight: 16, marginTop: 2 },
  inventoryValue: { fontSize: 15, fontWeight: '800', fontVariant: ['tabular-nums'] },
  rulesPanel: { marginTop: 20, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 16 },
  rulesHeader: { minHeight: 30, flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 },
  rulesTitle: { fontSize: 17, lineHeight: 24, fontWeight: '800' },
  rulesCloseButton: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center', marginTop: -2, marginRight: -5 },
  rulesList: { width: '100%' },
  ruleCard: { alignSelf: 'stretch', minHeight: 42, paddingHorizontal: 9, paddingVertical: 8, borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, flexDirection: 'row', alignItems: 'flex-start', gap: 7 },
  ruleCardSpacing: { marginTop: 8 },
  ruleIndex: { width: 20, height: 20, flexShrink: 0, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  ruleIndexText: { fontSize: 10, fontWeight: '800' },
  ruleText: { flex: 1, minWidth: 0, flexShrink: 1, fontSize: 12, lineHeight: 18, includeFontPadding: false },
});
