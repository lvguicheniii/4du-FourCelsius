import { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { Alert } from '@/components/app-alert';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Pressable } from '@/components/pressable';
import { ScreenHeader } from '@/components/screen-header';
import { submitAppeal } from '@/api/client';
import { useTheme } from '@/lib/theme';

export default function AppealScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { notificationId, title, content } = useLocalSearchParams<{
    notificationId: string;
    title?: string;
    content?: string;
  }>();
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    const trimmed = reason.trim();
    if (trimmed.length < 10) {
      Alert.alert('请补充申诉理由', '申诉理由至少需要 10 个字。');
      return;
    }
    setSubmitting(true);
    try {
      await submitAppeal(notificationId, trimmed);
      Alert.alert('申诉已提交', '管理员会在后台查看处罚内容与申诉理由。', [
        { text: '完成', onPress: () => router.back() },
      ]);
    } catch (error) {
      Alert.alert('提交失败', error instanceof Error ? error.message : '请稍后重试');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: colors.bg }}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScreenHeader title="提交申诉" floating />
      <View style={styles.container}>
        <View style={[styles.noticeCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
          <View style={[styles.icon, { backgroundColor: colors.accentBg }]}>
            <Ionicons name="document-text-outline" size={22} color={colors.accent} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.noticeTitle, { color: colors.text }]}>{title || '处罚通知'}</Text>
            <Text style={[styles.noticeContent, { color: colors.textMuted }]}>{content || '请说明你认为处罚需要复核的原因。'}</Text>
          </View>
        </View>

        <Text style={[styles.label, { color: colors.text }]}>申诉理由</Text>
        <TextInput
          value={reason}
          onChangeText={setReason}
          multiline
          maxLength={1000}
          textAlignVertical="top"
          placeholder="请清楚说明事情经过、你认为处罚不合理的原因，以及希望管理员复核的内容……"
          placeholderTextColor={colors.textMuted}
          style={[styles.input, { backgroundColor: colors.card, borderColor: colors.cardBorder, color: colors.text }]}
        />
        <Text style={[styles.count, { color: colors.textMuted }]}>{reason.length}/1000</Text>
        <Text style={[styles.tip, { color: colors.textMuted }]}>
          请如实填写。重复提交、辱骂或无关内容不会加快处理速度。
        </Text>

        <Pressable
          disabled={submitting}
          style={[styles.submit, { backgroundColor: colors.accent, opacity: submitting ? 0.6 : 1 }]}
          onPress={submit}
        >
          <Text style={styles.submitText}>{submitting ? '正在提交…' : '提交申诉'}</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, padding: 16 },
  noticeCard: { flexDirection: 'row', gap: 12, borderWidth: 1, borderRadius: 16, padding: 15 },
  icon: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  noticeTitle: { fontSize: 15, fontWeight: '600' },
  noticeContent: { fontSize: 12, lineHeight: 19, marginTop: 5 },
  label: { fontSize: 15, fontWeight: '600', marginTop: 22, marginBottom: 9 },
  input: { minHeight: 190, borderWidth: 1, borderRadius: 16, padding: 15, fontSize: 14, lineHeight: 22 },
  count: { fontSize: 11, textAlign: 'right', marginTop: 6 },
  tip: { fontSize: 12, lineHeight: 19, marginTop: 10 },
  submit: { height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginTop: 24 },
  submitText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
});
