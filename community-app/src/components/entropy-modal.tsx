import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Dimensions, Modal, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Pressable } from '@/components/pressable';
import { useTheme } from '@/lib/theme';

export type EntropyState = {
  value: number;
  level: number;
  title: string;
  english: string;
  description: string;
  currentThreshold: number;
  nextThreshold: number | null;
  nextTitle: string | null;
  progress: number;
  invalidReportCount: number;
  damaged: boolean;
  reportCooldownUntil: string | null;
  reportCooldownActive: boolean;
  permanentLv4: boolean;
};

type Props = {
  visible: boolean;
  entropy?: EntropyState | null;
  onClose: () => void;
};

export function EntropyModal({ visible, entropy, onClose }: Props) {
  const { colors, isDark } = useTheme();
  const [showRules, setShowRules] = useState(false);

  useEffect(() => {
    if (!visible) setShowRules(false);
  }, [visible]);

  const state = entropy || {
    value: 0,
    level: 0,
    title: '浅海漂流客',
    english: 'Shallow Sea Drifter',
    description: '您当前处于自由漂流状态。享受 26°C 的微风吧。',
    currentThreshold: 0,
    nextThreshold: 100,
    nextTitle: '浮霜清道夫',
    progress: 0,
    invalidReportCount: 0,
    damaged: false,
    reportCooldownUntil: null,
    reportCooldownActive: false,
    permanentLv4: false,
  };
  const progress = Math.max(0, Math.min(1, Number(state.progress) || 0));
  const progressLabel = state.nextThreshold === null
    ? String(state.value)
    : `${state.value} / ${state.nextThreshold}`;
  const descriptionLines = (state.description.match(/[^。！？!?]+[。！？!?]?/g) || [state.description])
    .map(line => line.trim())
    .filter(Boolean);

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={[styles.overlay, { backgroundColor: isDark ? 'rgba(0,0,0,0.70)' : 'rgba(18,20,26,0.44)' }]}>
        <Pressable
          accessibilityLabel="关闭熵减弹窗"
          accessibilityRole="button"
          style={styles.backdrop}
          onPress={onClose}
        />
        <View
          style={[
            styles.panel,
            showRules && styles.panelExpanded,
            { backgroundColor: colors.card, borderColor: colors.cardBorder },
          ]}
        >
          <View style={styles.topRow}>
            <View style={[styles.systemIcon, { backgroundColor: colors.accent + '18', borderColor: colors.accent + '48' }]}>
              <Ionicons name="analytics-outline" size={25} color={colors.accent} />
            </View>
            <View style={styles.headingWrap}>
              <Text style={[styles.heading, { color: colors.text }]}>熵减</Text>
              <Pressable
                accessibilityLabel="查看熵减系统规则"
                accessibilityRole="button"
                hitSlop={8}
                style={[styles.helpButton, { backgroundColor: colors.accent + '14', borderColor: colors.accent + '48' }]}
                onPress={() => setShowRules(value => !value)}
              >
                <Ionicons name="help" size={15} color={colors.accent} />
              </Pressable>
            </View>
            <Pressable accessibilityLabel="关闭熵减系统" hitSlop={8} style={styles.closeButton} onPress={onClose}>
              <Ionicons name="close" size={22} color={colors.textMuted} />
            </Pressable>
          </View>

          <ScrollView style={styles.scrollContent} showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
            {state.damaged && (
              <View style={[styles.damageBanner, { backgroundColor: colors.danger + '14', borderColor: colors.danger + '4D' }]}>
                <Ionicons name="warning-outline" size={18} color={colors.danger} />
                <View style={{ flex: 1 }}>
                  <Text style={[styles.damageTitle, { color: colors.danger }]}>探测仪已损坏</Text>
                  <Text style={[styles.damageText, { color: colors.textMuted }]}>设备修复期间暂时无法发射举报信号。</Text>
                </View>
              </View>
            )}

            <View style={styles.rankBlock}>
              <View style={styles.rankRow}>
                <Text style={[styles.rank, { color: colors.text }]}>【{state.title}】</Text>
                <Text style={[styles.level, { color: colors.accent }]}>LV.{state.level}</Text>
              </View>
            </View>

            <View style={[styles.calibrationCard, { backgroundColor: colors.input, borderColor: colors.cardBorder }]}>
              <View style={styles.progressHeader}>
                <Text style={[styles.progressTitle, { color: colors.text }]}>熵减值</Text>
                <Text style={[styles.progressValue, { color: state.value < 0 ? colors.danger : colors.accent }]}>{progressLabel}</Text>
              </View>
              <View style={[styles.track, { backgroundColor: colors.divider }]}>
                <View style={[styles.fill, { width: `${progress * 100}%`, backgroundColor: colors.accent }]} />
              </View>
            </View>

            <View style={[styles.description, { borderTopColor: colors.divider }]}>
              {descriptionLines.map((line, index) => (
                <Text key={`${line}-${index}`} style={[styles.descriptionText, { color: colors.textSecondary }]}>
                  “{line}”
                </Text>
              ))}
            </View>

            {showRules && (
              <View style={[styles.rulesPanel, { borderTopColor: colors.divider }]}>
                <View style={styles.rulesHeader}>
                  <Text style={[styles.rulesTitle, { color: colors.text }]}>熵减系统规则</Text>
                  <Pressable
                    accessibilityLabel="收起熵减系统规则"
                    accessibilityRole="button"
                    hitSlop={8}
                    style={styles.rulesCloseButton}
                    onPress={() => setShowRules(false)}
                  >
                    <Ionicons name="close" size={18} color={colors.textMuted} />
                  </Pressable>
                </View>
                <Text style={[styles.ruleText, { color: colors.textSecondary }]}>1、用户可对评论、切片、私信提交举报，举报成功后 +5 熵减值。</Text>
                <Text style={[styles.ruleText, { color: colors.textSecondary }]}>2、对同一违规内容，如果你是前三个提交举报的用户，举报成功后，获得额外 5 熵减值。</Text>
                <Text style={[styles.ruleText, { color: colors.textSecondary }]}>3、为防止滥用举报，每累计五次无效举报，系统确认为滥用后，会扣除 25 熵减值。</Text>
                <Text style={[styles.ruleText, { color: colors.textSecondary }]}>4、熵减系统共分为五个等级：</Text>
                <View style={styles.levelList}>
                  <Text style={[styles.levelItem, { color: colors.textSecondary }]}>Lv.0  浅海漂流客</Text>
                  <Text style={[styles.levelItem, { color: colors.textSecondary }]}>Lv.1  浮霜清道夫</Text>
                  <Text style={[styles.levelItem, { color: colors.textSecondary }]}>Lv.2  隐礁巡航卫</Text>
                  <Text style={[styles.levelItem, { color: colors.textSecondary }]}>Lv.3  潜流探测员</Text>
                  <Text style={[styles.levelItem, { color: colors.textSecondary }]}>Lv.4  肆度守望者</Text>
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
    maxHeight: Math.round(Dimensions.get('window').height * 0.78),
    borderRadius: 20,
    borderWidth: 1,
    overflow: 'hidden',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.2,
    shadowRadius: 28,
    elevation: 16,
  },
  panelExpanded: {
    maxHeight: Math.round(Dimensions.get('window').height * 0.92),
  },
  topRow: { minHeight: 76, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center' },
  systemIcon: { width: 44, height: 44, borderRadius: 14, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  headingWrap: { flex: 1, marginLeft: 12, flexDirection: 'row', alignItems: 'center', gap: 8 },
  heading: { fontSize: 24, fontWeight: '700' },
  helpButton: { width: 24, height: 24, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  closeButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  scrollContent: { flexGrow: 0, flexShrink: 1 },
  content: { paddingHorizontal: 18, paddingBottom: 38 },
  damageBanner: { flexDirection: 'row', gap: 9, alignItems: 'center', borderWidth: 1, borderRadius: 12, padding: 11, marginBottom: 16 },
  damageTitle: { fontSize: 13, fontWeight: '700' },
  damageText: { fontSize: 11, lineHeight: 16, marginTop: 1 },
  rankBlock: { alignItems: 'center', paddingTop: 8, paddingBottom: 20 },
  rankRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9 },
  level: { fontSize: 15, fontWeight: '700' },
  rank: { fontSize: 22, fontWeight: '700' },
  calibrationCard: { borderWidth: 1, borderRadius: 14, padding: 14 },
  progressHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  progressTitle: { fontSize: 13, fontWeight: '600' },
  progressValue: { fontSize: 13, fontWeight: '700' },
  track: { height: 10, borderRadius: 5, overflow: 'hidden', marginTop: 12, borderWidth: 1, borderColor: '#000000' },
  fill: { height: '100%', borderRadius: 4 },
  description: { marginTop: 22, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 18 },
  descriptionText: { fontSize: 14, lineHeight: 24, fontStyle: 'italic', textAlign: 'center', marginBottom: 6 },
  rulesPanel: { marginTop: 22, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 16 },
  rulesHeader: { minHeight: 30, flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 8 },
  rulesTitle: { fontSize: 17, lineHeight: 24, fontWeight: '700' },
  rulesCloseButton: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center', marginTop: -2, marginRight: -5 },
  ruleText: { fontSize: 13, lineHeight: 20, marginBottom: 8 },
  levelList: { gap: 5, paddingLeft: 19, paddingTop: 1 },
  levelItem: { fontSize: 13, lineHeight: 18, fontWeight: '600' },
});
