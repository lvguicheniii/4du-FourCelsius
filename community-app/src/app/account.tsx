import { useState, useEffect } from 'react';
import { ScrollView, StyleSheet, Text, TextInput, View, Modal, ActivityIndicator } from 'react-native';
import { Alert } from '@/components/app-alert';
import { Pressable } from '@/components/pressable';
import { ScreenHeader } from '@/components/screen-header';

import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '@/lib/theme';
import { changePassword, changePhone, getMe, sendCode } from '@/api/client';
import { useAuth } from '@/contexts/auth';

export default function AccountScreen() {
  const { colors } = useTheme();
  const { replaceToken } = useAuth();
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(true);

  // 修改密码
  const [pwModal, setPwModal] = useState(false);
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [pwCode, setPwCode] = useState('');
  const [pwCodeSending, setPwCodeSending] = useState(false);
  const [pwSaving, setPwSaving] = useState(false);

  // 修改手机号
  const [phoneModal, setPhoneModal] = useState(false);
  const [newPhone, setNewPhone] = useState('');
  const [phoneCurrentPw, setPhoneCurrentPw] = useState('');
  const [phoneSaving, setPhoneSaving] = useState(false);

  useEffect(() => {
    getMe().then(data => {
      setPhone(data.phone || '');
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const handleSendPasswordCode = async () => {
    if (!phone) return Alert.alert('提示', '当前账号未绑定手机号');
    setPwCodeSending(true);
    try {
      const result = await sendCode(phone, 'password_change');
      const fixedCode = String(result.fixedCode || '252616');
      setPwCode(fixedCode);
      Alert.alert('修改密码验证码', `当前固定验证码为 ${fixedCode}，已自动填入。`);
    } catch (error: any) {
      if (error?.message !== '已取消安全验证') Alert.alert('发送失败', error?.message || '请稍后重试');
    } finally {
      setPwCodeSending(false);
    }
  };

  const handleChangePw = async () => {
    if (newPw.length < 10) return Alert.alert('提示', '密码至少10位');
    if (!currentPw) return Alert.alert('提示', '请输入当前密码');
    if (!/^\d{6}$/.test(pwCode)) return Alert.alert('提示', '请输入固定验证码 252616');
    setPwSaving(true);
    try {
      const result = await changePassword({
        password: newPw,
        current_password: currentPw,
        verify_code: pwCode,
      });
      if (result.token) await replaceToken(result.token);
      Alert.alert('成功', '密码已修改');
      setPwModal(false);
      setCurrentPw(''); setNewPw(''); setPwCode('');
    } catch (e: any) {
      Alert.alert('失败', e.message || '修改失败');
    }
    setPwSaving(false);
  };

  const handleChangePhone = async () => {
    if (!/^1[3-9]\d{9}$/.test(newPhone)) return Alert.alert('提示', '手机号格式错误');
    if (!phoneCurrentPw) return Alert.alert('提示', '请输入当前密码');
    setPhoneSaving(true);
    try {
      const result = await changePhone({
        phone: newPhone,
        current_password: phoneCurrentPw,
      });
      if (result.token) await replaceToken(result.token);
      setPhone(newPhone);
      Alert.alert('成功', '手机号已修改');
      setPhoneModal(false);
      setNewPhone(''); setPhoneCurrentPw('');
    } catch (e: any) {
      Alert.alert('失败', e.message || '修改失败');
    }
    setPhoneSaving(false);
  };

  if (loading) {
    return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}><ActivityIndicator size="large" color={colors.accent} /></View>;
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScreenHeader title="账户与安全" />
      <ScrollView style={{ flex: 1, backgroundColor: colors.bg }} showsVerticalScrollIndicator={false}>

      <View style={[styles.section, { backgroundColor: colors.card }]}>
        <View style={[styles.row, { borderBottomColor: colors.divider, borderBottomWidth: 1 }]}>
          <Text style={[styles.label, { color: colors.textMuted }]}>当前手机号</Text>
          <Text style={{ fontSize: 15, color: colors.text }}>{phone || '未绑定'}</Text>
        </View>
        <Pressable style={styles.row} onPress={() => setPhoneModal(true)}>
          <Ionicons name="phone-portrait-outline" size={20} color={colors.accent} />
          <Text style={[styles.label, { color: colors.text }]}>修改手机号</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
        </Pressable>
      </View>

      <View style={[styles.section, { backgroundColor: colors.card }]}>
        <Pressable style={styles.row} onPress={() => setPwModal(true)}>
          <Ionicons name="lock-closed-outline" size={20} color={colors.accent} />
          <Text style={[styles.label, { color: colors.text }]}>修改密码</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
        </Pressable>
      </View>

      {/* 修改密码弹窗 */}
      <Modal visible={pwModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalBox, { backgroundColor: colors.card }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>修改密码</Text>
            <Text style={{ fontSize: 13, color: colors.textMuted, marginBottom: 8 }}>当前固定验证码为 252616</Text>
            <TextInput style={[styles.modalInput, { color: colors.text, backgroundColor: colors.input }]} placeholder="当前密码" placeholderTextColor={colors.textMuted} secureTextEntry value={currentPw} onChangeText={setCurrentPw} />
            <TextInput style={[styles.modalInput, { color: colors.text, backgroundColor: colors.input }]} placeholder="新密码（至少10位）" placeholderTextColor={colors.textMuted} secureTextEntry value={newPw} onChangeText={setNewPw} />
            <View style={[styles.codeRow, { backgroundColor: colors.input }]}>
              <TextInput style={[styles.codeInput, { color: colors.text }]} placeholder="固定验证码 252616" placeholderTextColor={colors.textMuted} keyboardType="number-pad" maxLength={6} value={pwCode} onChangeText={value => setPwCode(value.replace(/\D/g, ''))} />
              <Pressable disabled={pwCodeSending} onPress={handleSendPasswordCode}>
                <Text style={{ color: pwCodeSending ? colors.textMuted : colors.accent, fontSize: 13 }}>
                  {pwCodeSending ? '处理中...' : '填入验证码'}
                </Text>
              </Pressable>
            </View>

            <View style={styles.modalBtns}>
              <Pressable style={[styles.modalBtn, { backgroundColor: colors.input }]} onPress={() => setPwModal(false)}>
                <Text style={{ color: colors.text }}>取消</Text>
              </Pressable>
              <Pressable style={[styles.modalBtn, { backgroundColor: colors.accent }]} onPress={handleChangePw} disabled={pwSaving}>
                <Text style={{ color: '#FFF' }}>{pwSaving ? '保存中...' : '确认修改'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* 修改手机号弹窗 */}
      <Modal visible={phoneModal} animationType="slide" transparent>
        <View style={styles.modalOverlay}>
          <View style={[styles.modalBox, { backgroundColor: colors.card }]}>
            <Text style={[styles.modalTitle, { color: colors.text }]}>修改手机号</Text>
            <Text style={{ fontSize: 13, color: colors.textMuted, marginBottom: 8 }}>当前：{phone}</Text>
            <TextInput style={[styles.modalInput, { color: colors.text, backgroundColor: colors.input }]} placeholder="新手机号" placeholderTextColor={colors.textMuted} keyboardType="number-pad" maxLength={11} value={newPhone} onChangeText={setNewPhone} />
            <TextInput style={[styles.modalInput, { color: colors.text, backgroundColor: colors.input }]} placeholder="当前密码" placeholderTextColor={colors.textMuted} secureTextEntry value={phoneCurrentPw} onChangeText={setPhoneCurrentPw} />

            <View style={styles.modalBtns}>
              <Pressable style={[styles.modalBtn, { backgroundColor: colors.input }]} onPress={() => setPhoneModal(false)}>
                <Text style={{ color: colors.text }}>取消</Text>
              </Pressable>
              <Pressable style={[styles.modalBtn, { backgroundColor: colors.accent }]} onPress={handleChangePhone} disabled={phoneSaving}>
                <Text style={{ color: '#FFF' }}>{phoneSaving ? '保存中...' : '确认修改'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  section: { borderRadius: 14, marginHorizontal: 12, marginTop: 14, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 15, gap: 10 },
  label: { flex: 1, fontSize: 15 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', paddingHorizontal: 24 },
  modalBox: { borderRadius: 16, padding: 20 },
  modalTitle: { fontSize: 18, fontWeight: '600', marginBottom: 16 },
  modalInput: { borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, marginBottom: 10 },
  codeRow: { minHeight: 46, borderRadius: 10, paddingHorizontal: 14, marginBottom: 10, flexDirection: 'row', alignItems: 'center', gap: 10 },
  codeInput: { flex: 1, fontSize: 15, paddingVertical: 10 },
  modalBtns: { flexDirection: 'row', gap: 10, marginTop: 6 },
  modalBtn: { flex: 1, borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
});
