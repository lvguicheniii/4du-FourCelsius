import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { reportPost, setBlocked, deleteUserPost, setPostPrivate, isPostPrivate } from '@/data/store';
import { appModeratePost, deletePost as apiDeletePost, reportPost as apiReportPost, setPostVisibility, setUserBlocked, getSliceBoxes, updatePostSliceBox, type SliceBox } from '@/api/client';
import { useAuth } from '@/contexts/auth';
import { useTheme } from '@/lib/theme';
import type { ThemeColors } from '@/lib/theme';
import { RefrigerantIcon } from '@/components/refrigerant-icon';

const REASONS = ['垃圾广告', '色情低俗', '人身攻击', '不实信息', '违法违规', '其他'];
const ADMIN_REASONS = ['色情、淫秽或低俗内容', '谩骂、人身攻击或网络暴力', '违法违规或涉政内容', '广告、营销或恶意引流', '恶意引战或不实信息', '其他'];

type Props = {
  visible: boolean;
  onClose: () => void;
  onDeleted?: () => void;
  postId: string;
  author: string;
  authorId?: string;
  onBlocked?: () => void;
  isOwn?: boolean;
  isPrivate?: boolean;
  onUseRefrigerant?: () => void;
  onMoveToSliceBox?: () => void;
};

const themed = (c: ThemeColors) => ({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center' as const, alignItems: 'center' as const, paddingHorizontal: 30 },
  sheet: { backgroundColor: c.card, borderRadius: 18, paddingVertical: 4, paddingBottom: 12, width: '100%' as const, maxWidth: 340 },
  sheetTitle: { fontSize: 13, color: c.textMuted, textAlign: 'center' as const, paddingVertical: 12 },
  row: { flexDirection: 'row' as const, alignItems: 'center' as const, paddingVertical: 13, paddingHorizontal: 20, borderBottomWidth: 1, borderBottomColor: c.divider },
  rowText: { fontSize: 15, color: c.text, marginLeft: 10 },
  cancelText: { fontSize: 15, color: c.textMuted },
  doneWrap: { alignItems: 'center' as const, paddingVertical: 20, paddingHorizontal: 30 },
  doneTitle: { fontSize: 17, fontWeight: '600' as const, color: c.text, marginTop: 12 },
  doneDesc: { fontSize: 13, color: c.textMuted, marginTop: 8, textAlign: 'center' as const, lineHeight: 19 },
  doneBtn: { backgroundColor: '#33A9DC', borderRadius: 20, paddingHorizontal: 40, paddingVertical: 10, marginTop: 20 },
  doneBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' as const },
  blockBtnRow: { flexDirection: 'row' as const, gap: 10, marginTop: 20, alignSelf: 'stretch' as const },
  halfBtn: { flex: 1, borderRadius: 12, paddingVertical: 11, alignItems: 'center' as const },
  cancelHalf: { backgroundColor: c.input },
  cancelHalfText: { fontSize: 14, color: c.textMuted, fontWeight: '500' as const },
  dangerHalf: { backgroundColor: '#E24B4A' },
  dangerHalfText: { fontSize: 14, color: '#FFFFFF', fontWeight: '600' as const },
  reportReasons: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 8, paddingHorizontal: 16 },
  reportReason: { width: '48%' as const, minHeight: 40, borderRadius: 10, borderWidth: 1, alignItems: 'center' as const, justifyContent: 'center' as const },
  specialReasons: { flexDirection: 'row' as const, flexWrap: 'wrap' as const, gap: 10, paddingHorizontal: 18 },
  specialReason: { width: '48%' as const, minHeight: 54, borderRadius: 13, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 9, alignItems: 'center' as const, justifyContent: 'center' as const },
  specialReasonText: { fontSize: 13, lineHeight: 18, textAlign: 'center' as const },
  reportInput: { minHeight: 78, borderRadius: 11, borderWidth: 1, marginHorizontal: 16, marginTop: 12, padding: 11, textAlignVertical: 'top' as const },
  reportSubmit: { minHeight: 44, borderRadius: 12, marginHorizontal: 16, marginTop: 12, alignItems: 'center' as const, justifyContent: 'center' as const },
  reportSubmitText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' as const },
});

export function PostActionsSheet({ visible, onClose, onDeleted, postId, author, authorId, onBlocked, isOwn, isPrivate, onUseRefrigerant, onMoveToSliceBox }: Props) {
  const { colors } = useTheme();
  const { user } = useAuth();
  const st = useMemo(() => themed(colors), [colors]);
  const [step, setStep] = useState<'menu' | 'report' | 'done' | 'block' | 'delete' | 'special' | 'special_form'>('menu');
  const [reportResult, setReportResult] = useState({ ok: true, title: '举报已提交', description: '我们会尽快核实处理，该切片将不再向你展示' });
  const [privateNow, setPrivateNow] = useState(isPrivate ?? isPostPrivate(postId));
  const [reportReason, setReportReason] = useState('');
  const [reportDetail, setReportDetail] = useState('');
  const [reporting, setReporting] = useState(false);
  const [specialAction, setSpecialAction] = useState<'delete' | 'mute' | 'ban'>('delete');
  const [specialReason, setSpecialReason] = useState('');
  const [specialDetail, setSpecialDetail] = useState('');
  const [specialDuration, setSpecialDuration] = useState('12');
  const [specialLoading, setSpecialLoading] = useState(false);

  useEffect(() => {
    if (visible) {
      setPrivateNow(isPrivate ?? isPostPrivate(postId));
      setReportReason('');
      setReportDetail('');
      setReporting(false);
      setSpecialReason(''); setSpecialDetail(''); setSpecialLoading(false);
    }
  }, [isPrivate, postId, visible]);

  const close = () => { onClose(); setTimeout(() => setStep('menu'), 200); };
  const confirmBlock = async () => {
    if (authorId) {
      try { await setUserBlocked(authorId, true); } catch { return; }
    }
    setBlocked(author, true);
    close();
    onBlocked?.();
  };
  const handleReport = async () => {
    if (!reportReason || (reportReason === '其他' && !reportDetail.trim()) || reporting) return;
    setReporting(true);
    try {
      await apiReportPost(postId, reportReason, reportDetail.trim());
      reportPost(postId, reportReason);
      setReportResult({ ok: true, title: '举报已提交', description: '我们会尽快核实处理，该切片将不再向你展示' });
    } catch (error: any) {
      setReportResult({
        ok: false,
        title: error?.status === 429 ? '探测仪已损坏' : '举报未提交',
        description: error?.message || '请稍后重试',
      });
    }
    setReporting(false);
    setStep('done');
  };
  const handleDelete = async () => {
    try { await apiDeletePost(postId); } catch {}
    deleteUserPost(postId);
    close();
    onDeleted?.();
  };
  const handleTogglePrivate = async () => {
    const next = !privateNow;
    try {
      await setPostVisibility(postId, next ? 'private' : 'public');
    } catch { return; }
    setPostPrivate(postId, next);
    setPrivateNow(next);
    close();
  };
  const openSpecialForm = (action: 'delete' | 'mute' | 'ban') => { setSpecialAction(action); setSpecialDuration(action === 'ban' ? '1' : '12'); setSpecialReason(''); setSpecialDetail(''); setStep('special_form'); };
  const submitSpecial = async () => {
    if (!specialReason || (specialReason === '其他' && !specialDetail.trim()) || specialLoading) return;
    setSpecialLoading(true);
    const reason = specialReason + (specialDetail.trim() ? `：${specialDetail.trim()}` : '');
    try {
      await appModeratePost(postId, { action: specialAction, reason, ...(specialAction === 'mute' ? { hours: Number(specialDuration) || 12 } : {}), ...(specialAction === 'ban' ? { days: Number(specialDuration) || 1 } : {}) });
      setReportResult({ ok: true, title: '处置完成', description: specialAction === 'delete' ? '该切片已删除' : specialAction === 'mute' ? `已禁言 ${author}` : `已封禁 ${author}` });
      if (specialAction === 'delete') onDeleted?.();
      setStep('done');
    } catch (error: any) { setReportResult({ ok: false, title: '处置失败', description: error?.message || '请稍后重试' }); setStep('done'); }
    finally { setSpecialLoading(false); }
  };

  const renderMenu = () => {
    if (isOwn) return (
      <>
        <Text style={st.sheetTitle}>切片管理</Text>
        {onUseRefrigerant && (
          <Pressable style={st.row} onPress={() => { close(); setTimeout(onUseRefrigerant, 220); }}>
            <RefrigerantIcon size={20} color={colors.accent} />
            <Text style={st.rowText}>使用制冷剂推荐加权</Text>
          </Pressable>
        )}
        {onMoveToSliceBox && (
          <Pressable style={st.row} onPress={() => { close(); setTimeout(onMoveToSliceBox, 220); }}>
            <Ionicons name="file-tray-stacked-outline" size={20} color={colors.accent} />
            <Text style={st.rowText}>切片盒</Text>
          </Pressable>
        )}
        <Pressable style={st.row} onPress={() => setStep('delete')}>
          <Ionicons name="trash-outline" size={20} color="#E24B4A" />
          <Text style={[st.rowText, { color: '#E24B4A' }]}>删除切片</Text>
        </Pressable>
        <Pressable style={st.row} onPress={handleTogglePrivate}>
          <Ionicons name="eye-off-outline" size={20} color={privateNow ? '#33A9DC' : colors.text} />
          <Text style={st.rowText}>{privateNow ? '取消仅自己可见' : '仅自己可见'}</Text>
        </Pressable>
        <Pressable style={[st.row, { borderBottomWidth: 0, justifyContent: 'center' }]} onPress={close}>
          <Text style={st.cancelText}>取消</Text>
        </Pressable>
      </>
    );
    return (
      <>
        {onUseRefrigerant && (
          <Pressable style={st.row} onPress={() => { close(); setTimeout(onUseRefrigerant, 220); }}>
            <RefrigerantIcon size={20} color={colors.accent} />
            <Text style={st.rowText}>使用制冷剂推荐加权</Text>
          </Pressable>
        )}
        <Pressable style={st.row} onPress={() => setStep('report')}>
          <Ionicons name="flag-outline" size={20} color="#BA7517" />
          <Text style={st.rowText}>举报切片</Text>
        </Pressable>
        <Pressable style={st.row} onPress={() => setStep('block')}>
          <Ionicons name="ban-outline" size={20} color="#E24B4A" />
          <Text style={[st.rowText, { color: '#E24B4A' }]}>拉黑 {author}</Text>
        </Pressable>
        {user?.role === 'app_admin' && authorId && <Pressable style={st.row} onPress={() => setStep('special')}>
          <Ionicons name="shield-checkmark-outline" size={20} color={colors.accent} />
          <Text style={[st.rowText, { color: colors.accent }]}>特殊选项</Text>
        </Pressable>}
        <Pressable style={[st.row, { borderBottomWidth: 0, justifyContent: 'center' }]} onPress={close}>
          <Text style={st.cancelText}>取消</Text>
        </Pressable>
      </>
    );
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={close}>
      <Pressable style={[st.overlay, step === 'special_form' && { paddingHorizontal: 18 }]} onPress={close}>
        <View style={[st.sheet, step === 'special_form' && { maxWidth: 390 }]}>
          {step === 'menu' && renderMenu()}

          {step === 'report' && (
            <>
              <Text style={st.sheetTitle}>请选择举报理由</Text>
              <View style={st.reportReasons}>{REASONS.map((r) => (
                <Pressable key={r} style={[st.reportReason, { backgroundColor: colors.input, borderColor: reportReason === r ? colors.accent : 'transparent' }]} onPress={() => setReportReason(r)}>
                  <Text style={{ color: reportReason === r ? colors.accent : colors.text }}>{r}</Text>
                </Pressable>
              ))}</View>
              <TextInput
                value={reportDetail}
                onChangeText={setReportDetail}
                multiline
                maxLength={500}
                placeholder={reportReason === '其他' ? '请填写举报理由（必填）' : '补充说明（选填）'}
                placeholderTextColor={colors.textMuted}
                style={[st.reportInput, { color: colors.text, backgroundColor: colors.input, borderColor: colors.divider }]}
              />
              <Pressable
                style={[st.reportSubmit, { backgroundColor: reportReason && (reportReason !== '其他' || reportDetail.trim()) ? colors.accent : colors.divider }]}
                disabled={!reportReason || (reportReason === '其他' && !reportDetail.trim()) || reporting}
                onPress={handleReport}
              >
                {reporting ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Text style={st.reportSubmitText}>提交举报</Text>}
              </Pressable>
              <Pressable style={[st.row, { borderBottomWidth: 0, justifyContent: 'center', marginTop: 4 }]} onPress={close}>
                <Text style={st.cancelText}>取消</Text>
              </Pressable>
            </>
          )}

          {step === 'done' && (
            <View style={st.doneWrap}>
              <Ionicons name={reportResult.ok ? 'checkmark-circle' : 'warning'} size={44} color={reportResult.ok ? '#1D9E75' : colors.danger} />
              <Text style={st.doneTitle}>{reportResult.title}</Text>
              <Text style={st.doneDesc}>{reportResult.description}</Text>
              <Pressable style={st.doneBtn} onPress={close}>
                <Text style={st.doneBtnText}>完成</Text>
              </Pressable>
            </View>
          )}

          {step === 'block' && (
            <View style={st.doneWrap}>
              <Ionicons name="ban" size={40} color="#E24B4A" />
              <Text style={st.doneTitle}>拉黑 {author}？</Text>
              <Text style={st.doneDesc}>拉黑后将双向关闭互动通道，且双方都无法看到对方的动态，可在「我的 - 黑名单管理」中解除</Text>
              <View style={st.blockBtnRow}>
                <Pressable style={[st.halfBtn, st.cancelHalf]} onPress={() => setStep('menu')}>
                  <Text style={st.cancelHalfText}>取消</Text>
                </Pressable>
                <Pressable style={[st.halfBtn, st.dangerHalf]} onPress={confirmBlock}>
                  <Text style={st.dangerHalfText}>确认拉黑</Text>
                </Pressable>
              </View>
            </View>
          )}

          {step === 'delete' && (
            <View style={st.doneWrap}>
              <Ionicons name="trash-outline" size={40} color={colors.danger} />
              <Text style={st.doneTitle}>删除切片？</Text>
              <Text style={st.doneDesc}>删除后无法恢复，请确认是否继续。</Text>
              <View style={st.blockBtnRow}>
                <Pressable style={[st.halfBtn, st.cancelHalf]} onPress={() => setStep('menu')}>
                  <Text style={st.cancelHalfText}>继续保留</Text>
                </Pressable>
                <Pressable style={[st.halfBtn, { backgroundColor: colors.danger }]} onPress={handleDelete}>
                  <Text style={st.dangerHalfText}>确认删除</Text>
                </Pressable>
              </View>
            </View>
          )}

          {step === 'special' && <>
            <Text style={st.sheetTitle}>APP 管理员特殊选项</Text>
            <Pressable style={st.row} onPress={() => openSpecialForm('delete')}><Ionicons name="trash-outline" size={20} color={colors.danger} /><Text style={[st.rowText, { color: colors.danger }]}>删除切片</Text></Pressable>
            <Pressable style={st.row} onPress={() => openSpecialForm('mute')}><Ionicons name="volume-mute-outline" size={20} color="#D98A22" /><Text style={st.rowText}>禁言用户</Text></Pressable>
            <Pressable style={st.row} onPress={() => openSpecialForm('ban')}><Ionicons name="ban-outline" size={20} color={colors.danger} /><Text style={[st.rowText, { color: colors.danger }]}>封禁用户</Text></Pressable>
            <Pressable style={[st.row, { borderBottomWidth: 0, justifyContent: 'center' }]} onPress={() => setStep('menu')}><Text style={st.cancelText}>返回</Text></Pressable>
          </>}

          {step === 'special_form' && <>
            <Text style={st.sheetTitle}>{specialAction === 'delete' ? '删除切片' : specialAction === 'mute' ? '禁言用户' : '封禁用户'}</Text>
            <View style={st.specialReasons}>{ADMIN_REASONS.map(reason => <Pressable key={reason} style={[st.specialReason, { backgroundColor: colors.input, borderColor: specialReason === reason ? colors.accent : 'transparent' }]} onPress={() => setSpecialReason(reason)}><Text style={[st.specialReasonText, { color: specialReason === reason ? colors.accent : colors.text }]}>{reason}</Text></Pressable>)}</View>
            <TextInput value={specialDetail} onChangeText={setSpecialDetail} multiline maxLength={500} placeholder={specialReason === '其他' ? '请填写具体原因（必填）' : '补充说明（选填）'} placeholderTextColor={colors.textMuted} style={[st.reportInput, { color: colors.text, backgroundColor: colors.input, borderColor: colors.divider }]} />
            {specialAction !== 'delete' && <View style={{ marginHorizontal: 16, marginTop: 12 }}><View style={{ flexDirection: 'row', gap: 6, marginBottom: 8 }}>{(specialAction === 'mute' ? ['12','24','48','168'] : ['1','7','30','365']).map(value => <Pressable key={value} onPress={() => setSpecialDuration(value)} style={{ flex: 1, minHeight: 34, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: specialDuration === value ? colors.accent + '22' : colors.input, borderWidth: 1, borderColor: specialDuration === value ? colors.accent : colors.divider }}><Text style={{ color: specialDuration === value ? colors.accent : colors.text, fontSize: 12 }}>{value}{specialAction === 'mute' ? 'h' : '天'}</Text></Pressable>)}</View><View style={{ flexDirection: 'row', alignItems: 'center' }}><TextInput value={specialDuration} onChangeText={setSpecialDuration} keyboardType="number-pad" style={[st.reportInput, { flex: 1, minHeight: 42, marginHorizontal: 0, marginTop: 0, color: colors.text, backgroundColor: colors.input, borderColor: colors.divider }]} /><Text style={{ color: colors.text, marginLeft: 8 }}>{specialAction === 'mute' ? '小时' : '天'}</Text></View></View>}
            <Pressable style={[st.reportSubmit, { backgroundColor: specialReason && (specialReason !== '其他' || specialDetail.trim()) ? colors.accent : colors.divider }]} disabled={!specialReason || (specialReason === '其他' && !specialDetail.trim()) || specialLoading} onPress={submitSpecial}>{specialLoading ? <ActivityIndicator color="#fff" /> : <Text style={st.reportSubmitText}>确认处置</Text>}</Pressable>
            <Pressable style={[st.row, { borderBottomWidth: 0, justifyContent: 'center' }]} onPress={() => setStep('special')}><Text style={st.cancelText}>返回</Text></Pressable>
          </>}
        </View>
      </Pressable>
    </Modal>
  );
}

type SliceBoxPickerProps = {
  visible: boolean;
  postId: string;
  currentBox?: { id: string; name: string } | null;
  onClose: () => void;
  onSaved?: (box: { id: string; name: string } | null) => void;
};

export function SliceBoxPickerModal({ visible, postId, currentBox, onClose, onSaved }: SliceBoxPickerProps) {
  const { colors } = useTheme();
  const [boxes, setBoxes] = useState<SliceBox[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!visible) return;
    setLoading(true); setError('');
    getSliceBoxes().then((result) => setBoxes(result.boxes || [])).catch((e: any) => setError(e?.message || '加载切片盒失败')).finally(() => setLoading(false));
  }, [visible]);
  const save = async (boxId: string | null) => {
    if (saving) return;
    setSaving(true); setError('');
    try {
      const result = await updatePostSliceBox(postId, boxId);
      onSaved?.(result.sliceBox);
      onClose();
    } catch (e: any) { setError(e?.message || '保存失败，请稍后重试'); }
    finally { setSaving(false); }
  };
  return <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
    <Pressable style={themed(colors).overlay} onPress={onClose}>
      <View style={[themed(colors).sheet, { paddingBottom: 8 }]}>
        <Text style={themed(colors).sheetTitle}>选择切片盒</Text>
        {loading ? <ActivityIndicator color={colors.accent} style={{ paddingVertical: 22 }} /> : <>
          {currentBox ? <Pressable style={themed(colors).row} disabled={saving} onPress={() => save(null)}>
            <Ionicons name="remove-circle-outline" size={20} color={colors.textMuted} /><Text style={themed(colors).rowText}>移出当前切片盒</Text>
          </Pressable> : null}
          {boxes.map((box) => <Pressable key={box.id} style={themed(colors).row} disabled={saving || currentBox?.id === box.id} onPress={() => save(box.id)}>
            <Ionicons name={currentBox?.id === box.id ? 'checkmark-circle' : 'file-tray-stacked-outline'} size={20} color={currentBox?.id === box.id ? colors.accent : colors.text} />
            <Text style={[themed(colors).rowText, currentBox?.id === box.id && { color: colors.accent }]}>{box.name}</Text>
          </Pressable>)}
          {!boxes.length && <Text style={{ textAlign: 'center', color: colors.textMuted, paddingVertical: 18 }}>还没有创建切片盒</Text>}
        </>}
        {error ? <Text style={{ color: colors.danger, textAlign: 'center', paddingHorizontal: 16, paddingVertical: 8 }}>{error}</Text> : null}
        <Pressable style={[themed(colors).row, { borderBottomWidth: 0, justifyContent: 'center' }]} onPress={onClose}><Text style={themed(colors).cancelText}>取消</Text></Pressable>
      </View>
    </Pressable>
  </Modal>;
}

