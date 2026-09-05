import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Image, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Application from 'expo-application';
import * as Device from 'expo-device';
import { useRouter } from 'expo-router';
import { Alert } from '@/components/app-alert';
import { Pressable } from '@/components/pressable';
import { ScreenHeader } from '@/components/screen-header';
import { getFeedbackHistory, submitFeedback, uploadFile } from '@/api/client';
import { launchImageLibrarySafely } from '@/lib/image-picker';
import { useTheme } from '@/lib/theme';

export default function FeedbackScreen() {
  const router = useRouter();
  const { colors, isDark } = useTheme();
  const [content, setContent] = useState('');
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [canSubmitToday, setCanSubmitToday] = useState(true);
  const [includeDeviceInfo, setIncludeDeviceInfo] = useState(true);
  const submitDisabled = sending || !canSubmitToday || !content.trim();

  useEffect(() => {
    getFeedbackHistory().then(result => setCanSubmitToday(result.canSubmitToday !== false)).catch(() => {});
  }, []);

  const chooseImage = useCallback(async () => {
    const result = await launchImageLibrarySafely({ mediaTypes: ['images'], allowsMultipleSelection: false, quality: 0.85 });
    if (!result.canceled && result.assets?.[0]?.uri) setImageUri(result.assets[0].uri);
  }, []);

  const submit = useCallback(async () => {
    const text = content.trim();
    if (!canSubmitToday) return Alert.alert('今日已提交', '每个用户每天只能提交一次反馈，请明天再来。');
    if (!text) return Alert.alert('提示', '请先填写反馈内容');
    setSending(true);
    try {
      const imageUrl = imageUri ? (await uploadFile(imageUri, 'f')).url : null;
      const deviceInfo = includeDeviceInfo ? {
        deviceModel: [Device.manufacturer, Device.modelName].filter(Boolean).join(' ') || '未知机型',
        osVersion: [Device.osName || Platform.OS, Device.osVersion].filter(Boolean).join(' '),
        appVersion: [Application.nativeApplicationVersion, Application.nativeBuildVersion && `(${Application.nativeBuildVersion})`].filter(Boolean).join(' '),
      } : null;
      await submitFeedback(text, imageUrl, deviceInfo);
      setCanSubmitToday(false); setContent(''); setImageUri(null);
      Alert.alert('提交成功', '感谢你的反馈，管理团队会认真阅读。');
    } catch (error: any) {
      Alert.alert('提交失败', error?.message || '请稍后重试');
    } finally { setSending(false); }
  }, [canSubmitToday, content, imageUri, includeDeviceInfo]);

  return (
    <KeyboardAvoidingView style={[styles.page, { backgroundColor: colors.bg }]} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScreenHeader title="我要反馈" rightWidth={84} right={
        <Pressable onPress={() => router.push('/feedback-history' as any)} style={styles.historyButton}>
          <Text style={[styles.historyText, { color: colors.accent }]}>历史反馈</Text>
        </Pressable>
      } />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={[styles.editor, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
          <TextInput
            value={content}
            onChangeText={setContent}
            editable={!sending && canSubmitToday}
            multiline
            maxLength={2000}
            textAlignVertical="top"
            placeholder={canSubmitToday ? '请告诉我们你的想法或遇到的问题' : '今天已经提交过反馈了'}
            placeholderTextColor={colors.textMuted}
            style={[styles.input, { color: colors.text }]}
          />
          <Text style={[styles.count, { color: colors.textMuted }]}>{content.length}/2000</Text>
        </View>

        {imageUri ? (
          <View style={styles.previewWrap}>
            <Image source={{ uri: imageUri }} style={[styles.preview, { backgroundColor: colors.input }]} />
            <Pressable accessibilityLabel="移除反馈图片" onPress={() => setImageUri(null)} style={styles.removeImage}>
              <Ionicons name="close" size={18} color="#FFFFFF" />
            </Pressable>
          </View>
        ) : (
          <Pressable disabled={!canSubmitToday || sending} onPress={chooseImage} style={[styles.imageButton, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
            <Ionicons name="image-outline" size={23} color={canSubmitToday ? colors.accent : colors.textMuted} />
            <Text style={[styles.imageText, { color: canSubmitToday ? colors.text : colors.textMuted }]}>添加一张图片</Text>
          </Pressable>
        )}

        <Text style={[styles.limitHint, { color: colors.textMuted }]}>每个账号每天可提交一次反馈</Text>
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: includeDeviceInfo }}
          disabled={sending}
          onPress={() => setIncludeDeviceInfo(value => !value)}
          style={styles.deviceOption}>
          <View style={[styles.optionCircle, { borderColor: includeDeviceInfo ? colors.accent : colors.textMuted }]}>
            {includeDeviceInfo ? <View style={[styles.optionDot, { backgroundColor: colors.accent }]} /> : null}
          </View>
          <Text style={[styles.deviceOptionText, { color: colors.textSecondary }]}>一并提交机型和版本</Text>
        </Pressable>
        <Pressable disabled={submitDisabled} onPress={submit}
          style={[
            styles.submit,
            submitDisabled
              ? { backgroundColor: colors.input, borderColor: colors.cardBorder }
              : { backgroundColor: isDark ? '#68CFF0' : '#33A9DC', borderColor: isDark ? '#A8E8FA' : '#1689BA' },
          ]}>
          {sending
            ? <ActivityIndicator color={colors.accent} />
            : <Text style={[styles.submitText, { color: submitDisabled ? colors.textSecondary : '#FFFFFF' }]}>提交反馈</Text>}
        </Pressable>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  historyButton: { minHeight: 40, justifyContent: 'center', alignItems: 'flex-end' },
  historyText: { fontSize: 14, fontWeight: '600' },
  content: { padding: 16, paddingBottom: 40 },
  editor: { minHeight: 270, borderWidth: 1, borderRadius: 8, padding: 14 },
  input: { flex: 1, minHeight: 220, fontSize: 15, lineHeight: 24, padding: 0 },
  count: { alignSelf: 'flex-end', fontSize: 11, marginTop: 8 },
  imageButton: { height: 58, marginTop: 14, borderWidth: 1, borderRadius: 8, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center' },
  imageText: { marginLeft: 10, fontSize: 14 },
  previewWrap: { width: 112, height: 112, marginTop: 14 },
  preview: { width: 112, height: 112, borderRadius: 8 },
  removeImage: { position: 'absolute', top: 5, right: 5, width: 26, height: 26, borderRadius: 13, backgroundColor: '#151820B8', alignItems: 'center', justifyContent: 'center' },
  limitHint: { marginTop: 14, fontSize: 12, textAlign: 'center' },
  deviceOption: { minHeight: 38, marginTop: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  optionCircle: { width: 18, height: 18, borderRadius: 9, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  optionDot: { width: 10, height: 10, borderRadius: 5 },
  deviceOptionText: { marginLeft: 8, fontSize: 13 },
  submit: { height: 48, marginTop: 4, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  submitText: { fontSize: 15, fontWeight: '700' },
});
