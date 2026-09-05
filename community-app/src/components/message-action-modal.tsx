import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, StyleSheet, Text, TextInput, View } from 'react-native';
import { Pressable } from '@/components/pressable';
import { useTheme } from '@/lib/theme';

const REASONS = ['垃圾广告', '色情低俗', '人身攻击', '不实信息', '违法违规', '其他'];

type Props = {
  visible: boolean;
  mode: 'other' | 'self';
  accent?: string;
  loading?: boolean;
  onClose: () => void;
  onReport?: (reason: string, detail: string) => void;
  onBlock?: () => void;
  onDelete?: () => void;
  onRecall?: () => void;
  recallError?: string;
  reportOnly?: boolean;
};

export function MessageActionModal({ visible, mode, accent, loading, onClose, onReport, onBlock, onDelete, onRecall, recallError, reportOnly = false }: Props) {
  const { colors } = useTheme();
  const tint = accent || colors.accent;
  const [step, setStep] = useState<'menu' | 'report'>('menu');
  const [reason, setReason] = useState('');
  const [detail, setDetail] = useState('');
  useEffect(() => { if (visible) { setStep(reportOnly ? 'report' : 'menu'); setReason(''); setDetail(''); } }, [visible, reportOnly]);
  return <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
    <Pressable style={s.overlay} onPress={onClose}>
      <Pressable style={[s.card, { backgroundColor: colors.card }]} onPress={event => event.stopPropagation()}>
        {step === 'menu' ? <>
          <Text style={[s.title, { color: colors.text }]}>消息操作</Text>
          {mode === 'other' ? <>
            <Action icon="flag-outline" label="举报消息" color={colors.danger} border={colors.divider} onPress={() => setStep('report')} />
            <Action icon="ban-outline" label="拉黑用户" color={colors.danger} border={colors.divider} onPress={onBlock} />
            {!!onDelete && <Action icon="trash-outline" label="删除消息" color={colors.danger} border={colors.divider} onPress={onDelete} />}
          </> : <>
            <Action icon="trash-outline" label="删除消息" color={colors.danger} border={colors.divider} onPress={onDelete} />
            <Action icon="arrow-undo-outline" label="撤回消息" color={tint} border={colors.divider} onPress={onRecall} />
            {!!recallError && <Text style={[s.recallError, { color: colors.danger }]}>{recallError}</Text>}
          </>}
        </> : <>
          <Text style={[s.title, { color: colors.text }]}>选择举报原因</Text>
          <View style={s.reasons}>{REASONS.map(item => <Pressable key={item} style={[s.reason, { backgroundColor: colors.input, borderColor: reason === item ? tint : 'transparent' }]} onPress={() => setReason(item)}><Text style={{ color: reason === item ? tint : colors.text }}>{item}</Text></Pressable>)}</View>
          <TextInput value={detail} onChangeText={setDetail} maxLength={500} multiline placeholder={reason === '其他' ? '请填写举报理由（必填）' : '补充说明（选填）'} placeholderTextColor={colors.textMuted} style={[s.input, { color: colors.text, backgroundColor: colors.input, borderColor: colors.divider }]} />
          <Pressable style={[s.submit, { backgroundColor: reason && (reason !== '其他' || detail.trim()) ? tint : colors.divider }]} disabled={!reason || (reason === '其他' && !detail.trim()) || loading} onPress={() => onReport?.(reason, detail.trim())}>{loading ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Text style={s.submitText}>提交举报</Text>}</Pressable>
        </>}
      </Pressable>
    </Pressable>
  </Modal>;
}

function Action({ icon, label, color, border, onPress }: { icon: any; label: string; color: string; border: string; onPress?: () => void }) {
  return <Pressable style={[s.row, { borderColor: border }]} onPress={onPress}><Ionicons name={icon} size={20} color={color} /><Text style={[s.rowText, { color }]}>{label}</Text></Pressable>;
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.44)', alignItems: 'center', justifyContent: 'center', padding: 28 },
  card: { width: '100%', maxWidth: 340, borderRadius: 22, padding: 18, paddingBottom: 24 },
  title: { fontSize: 17, fontWeight: '700', textAlign: 'center', marginBottom: 15 },
  row: { minHeight: 52, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8 },
  rowText: { fontSize: 15, fontWeight: '600', marginLeft: 12 },
  reasons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  reason: { width: '48%', minHeight: 42, borderWidth: 1, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  input: { minHeight: 84, borderWidth: 1, borderRadius: 12, padding: 11, marginTop: 12, textAlignVertical: 'top' },
  submit: { minHeight: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginTop: 13 },
  submitText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  recallError: { fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 8 },
});
