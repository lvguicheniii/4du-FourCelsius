import { useTheme } from "@/lib/theme";
import { useState, useEffect } from 'react';
import { Image, ScrollView, StyleSheet, Text, TextInput, View, ActivityIndicator } from 'react-native';
import { Alert } from '@/components/app-alert';
import { Pressable } from '@/components/pressable';
import { ScreenHeader } from '@/components/screen-header';
import { Ionicons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import { launchImageLibrarySafely } from '@/lib/image-picker';
import { tagCategories } from '@/data/mock';
import { updateProfile, uploadFile, getMe } from '@/api/client';
import { updateNickname } from '@/data/store';
import { useAuth } from '@/contexts/auth';
import { AgeWheelPicker } from '@/components/age-wheel-picker';
import { isNativeLiquidGlassEnabled } from '@/components/liquid-glass';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function EditProfileScreen() {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { user: authUser, refreshUser } = useAuth();
  const [loading, setLoading] = useState(true);
  const [tags, setTags] = useState<string[]>([]);
  const [avatar, setAvatar] = useState<string | null>(null);
  const [nickname, setNickname] = useState('');
  const [age, setAge] = useState(18);
  const [ageWheelActive, setAgeWheelActive] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getMe().then(data => {
      setNickname(data.nickname || data.username || '');
      setAvatar(data.avatar);
      setTags(data.tags || []);
      const loadedAge = Number.isInteger(data.age) ? data.age : 18;
      setAge(loadedAge);
    }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const pickAvatar = async () => {
    const result = await launchImageLibrarySafely({ mediaTypes: ['images'], allowsEditing: true, aspect: [1, 1], quality: 0.8 });
    if (!result.canceled && result.assets?.[0]) {
      setSaving(true);
      try {
        const upload = await uploadFile(result.assets[0].uri, 'a');
        setAvatar(upload.url);
      } catch (error: any) {
        Alert.alert('头像上传失败', error?.message || '请检查网络后重试');
      }
      setSaving(false);
    }
  };

  const toggleTag = (catIndex: number, tag: string) => {
    setTags(prev => {
      const category = tagCategories[catIndex];
      if ('single' in category && category.single) {
        const categoryTags = category.tags as readonly string[];
        const withoutCategory = prev.filter(item => !categoryTags.includes(item));
        return prev.includes(tag) ? withoutCategory : [...withoutCategory, tag];
      }
      return prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag];
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload: any = { tags, nickname: nickname.trim(), age };
      if (avatar) payload.avatar = avatar;
      await updateProfile(payload);
      updateNickname(nickname.trim());
      await refreshUser();
      router.back();
    } catch { Alert.alert('保存失败', '请检查网络后重试'); }
    setSaving(false);
  };

  if (loading) {
    return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}><ActivityIndicator size="large" color={colors.accent} /></View>;
  }

  const showInitial = !avatar;
  const firstName = nickname || authUser?.nickname || authUser?.username || 'A';

  return (
    <View style={[styles.page, { backgroundColor: colors.bg }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScreenHeader title="编辑资料" floating floatingSpacer={68} rightWidth={72} right={
        <Pressable onPress={handleSave} disabled={saving}>
          <Text
            style={[styles.saveText, { color: saving ? colors.textMuted : colors.accent }]}
            numberOfLines={1}
          >
            {saving ? '保存中...' : '保存'}
          </Text>
        </Pressable>
      } />
      <ScrollView
        style={[styles.scroll, isNativeLiquidGlassEnabled && styles.scrollFloating]}
        contentContainerStyle={[styles.scrollContent, isNativeLiquidGlassEnabled && { paddingTop: insets.top + 68 }]}
        showsVerticalScrollIndicator={false}
        scrollEnabled={!ageWheelActive}
      >
      <View style={[styles.section, { backgroundColor: colors.card }]}>
        <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>头像</Text>
        <Pressable style={styles.avatarRow} onPress={pickAvatar}>
          {avatar ? <Image source={{ uri: avatar }} style={styles.avatar} /> :
            <View style={[styles.avatar, styles.avatarPH, { backgroundColor: colors.accent }]}>
              <Text style={styles.avatarInit}>{firstName[0]}</Text>
            </View>}
          <View style={styles.avatarHint}>
            <Ionicons name="camera-outline" size={16} color={colors.textMuted} />
            <Text style={[styles.avatarHintText, { color: colors.textMuted }]}>更换头像</Text>
          </View>
        </Pressable>
      </View>
      <View style={[styles.section, { backgroundColor: colors.card }]}>
        <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>昵称</Text>
        <TextInput style={[styles.nameInput, { color: colors.text, backgroundColor: colors.input, borderColor: colors.divider }]} placeholder={firstName} placeholderTextColor={colors.textMuted} value={nickname} onChangeText={setNickname} maxLength={8} />
        <Text style={[styles.counter, { color: colors.textMuted }]}>{nickname.length}/8</Text>
      </View>
      <View style={[styles.section, { backgroundColor: colors.card }]}>
        <AgeWheelPicker
          value={age}
          onChange={setAge}
          onInteractionChange={setAgeWheelActive}
          palette={colors}
        />
      </View>
      {tagCategories.map((cat, ci) => (
        <View key={cat.title} style={[styles.section, { backgroundColor: colors.card }]}>
          <Text style={[styles.sectionTitle, { color: colors.textMuted }]}>{cat.title}
            {'single' in cat && cat.single
              ? <Text style={[styles.singleHint, { color: '#E24B4A' }]}>  单选</Text>
              : <Text style={{ fontSize: 11, color: colors.textMuted, fontWeight: '400' }}>  多选</Text>}
          </Text>
          <View style={styles.chipWrap}>
            {cat.tags.map(tag => {
              const active = tags.includes(tag);
              const chipColors = active
                ? {
                    background: colors.accent,
                    border: colors.accent,
                    text: isDark ? '#12303C' : '#FFFFFF',
                  }
                : {
                    background: isDark ? '#252A33' : '#F5FAFC',
                    border: isDark ? '#4B5963' : '#B7CCD5',
                    text: isDark ? '#D1D8DE' : '#365563',
                  };
              return <Pressable
                key={tag}
                style={[
                  styles.chip,
                  {
                    backgroundColor: chipColors.background,
                    borderColor: chipColors.border,
                  },
                ]}
                onPress={() => toggleTag(ci, tag)}
              >
                {active && <Ionicons name="checkmark" size={14} color={chipColors.text} style={{ marginRight: 3 }} />}
                <Text style={[styles.chipText, { color: chipColors.text, fontWeight: active ? '600' : '500' }]}>{tag}</Text>
              </Pressable>;
            })}
          </View>
        </View>
      ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  scroll: { flex: 1 },
  scrollFloating: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  scrollContent: { paddingBottom: 40 },
  saveText: { fontSize: 15, fontWeight: '600' },
  section: { borderRadius: 14, padding: 16, marginHorizontal: 12, marginTop: 12 },
  sectionTitle: { fontSize: 14, fontWeight: '600', marginBottom: 12 },
  singleHint: { fontSize: 11, fontWeight: '400' },
  avatarRow: { flexDirection: 'row', alignItems: 'center' },
  avatar: { width: 64, height: 64, borderRadius: 32 },
  avatarPH: { alignItems: 'center', justifyContent: 'center' },
  avatarInit: { color: '#FFFFFF', fontSize: 24, fontWeight: '600' },
  avatarHint: { flexDirection: 'row', alignItems: 'center', marginLeft: 16 },
  avatarHintText: { fontSize: 14, marginLeft: 6 },
  nameInput: { fontSize: 15, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, borderWidth: 1 },
  counter: { fontSize: 12, textAlign: 'right', marginTop: 6 },
  chipWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingBottom: 3 },
  chip: { minHeight: 36, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 14, paddingVertical: 0, borderRadius: 18, borderWidth: 1 },
  chipText: { fontSize: 13, lineHeight: 18, includeFontPadding: false, textAlignVertical: 'center' },
});
