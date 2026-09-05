import { useCallback, useState, useEffect, useRef } from 'react';
import {
  Dimensions,
  FlatList,
  Image,
  ScrollView,
  StyleSheet,
  Text,
  View,
  ActivityIndicator,
  KeyboardAvoidingView,
  Modal,
  Platform,
  TextInput,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AppRefreshControl } from '@/components/app-refresh-control';
import { Alert } from '@/components/app-alert';
import { Pressable } from '@/components/pressable';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { launchImageLibrarySafely } from '@/lib/image-picker';
import { getMe, getPosts, getSliceBoxes, uploadFile, updateProfile } from '@/api/client';
import { useAuth } from '@/contexts/auth';
import { PostCard } from '@/components/post-card';
import { useThemedStyle } from '@/lib/use-themed-style';
import type { ThemeColors } from '@/lib/theme';
import { restrictionRemaining } from '@/lib/account-restrictions';
import { RefrigerantIcon } from '@/components/refrigerant-icon';
import { FrostShellIcon } from '@/components/frost-shell-icon';
import { GenderBadge } from '@/components/gender-badge';
import { EntropyModal } from '@/components/entropy-modal';
import { RefrigerantModal } from '@/components/refrigerant-modal';
import { FrostShellModal } from '@/components/frost-shell-modal';
import { PinnedProfileCard } from '@/components/pinned-profile-card';

export default function ProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user: authUser, token, refreshUser } = useAuth();

  // 游客重定向到登录
  useEffect(() => {
    if (!token) router.replace('/');
  }, [token]);

  const [profile, setProfile] = useState<any>(null);
  const [myPosts, setMyPosts] = useState<any[]>([]);
  const [sliceBoxCount, setSliceBoxCount] = useState(0);
  const [stats, setStats] = useState({ posts: 0, following: 0, followers: 0, refrigerant: 0 });
  const [cover, setCover] = useState('');
  const [bio, setBio] = useState('');
  const [avatar, setAvatar] = useState<string | null>(null);
  const [nickname, setNickname] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [shellOpen, setShellOpen] = useState(false);
  const [refrigerantOpen, setRefrigerantOpen] = useState(false);
  const [entropyOpen, setEntropyOpen] = useState(false);
  const [avatarSaving, setAvatarSaving] = useState(false);
  const [pinnedEditorOpen, setPinnedEditorOpen] = useState(false);
  const [pinnedDraft, setPinnedDraft] = useState('');
  const [pinnedSaving, setPinnedSaving] = useState(false);
  const [, setRestrictionTick] = useState(0);
  const coverRef = useRef('');
  const coverVersionRef = useRef(0);
  const coverUploadPendingRef = useRef(false);
  const coverFallbackRef = useRef('');
  const profileRequestRef = useRef(0);
  const coverH = Math.floor(Dimensions.get('window').height / 3);

  const loadProfile = useCallback(async () => {
    const requestId = ++profileRequestRef.current;
    if (!token) { setLoading(false); return; }
    const requestCoverVersion = coverVersionRef.current;
    try {
      const data = await getMe();
      if (requestId !== profileRequestRef.current) return;
      setProfile(data);
      setBio(data.bio || '');
      setNickname(data.nickname || data.username);
      // Registration uploads the avatar in the background. Keep the local
      // preview until the server-side profile has the uploaded URL.
      setAvatar(data.avatar || authUser?.avatar || null);
      setTags(data.tags || []);
      if (requestCoverVersion === coverVersionRef.current && !coverUploadPendingRef.current) {
        if (data.cover_image) coverRef.current = data.cover_image;
        setCover(data.cover_image || coverRef.current || '');
      }
      setStats(data.stats || { posts: 0, following: 0, followers: 0, refrigerant: data.refrigerant_count || 0 });
      const [postsResult, sliceBoxesResult] = await Promise.allSettled([
        getPosts(1, 50, undefined, data.id),
        getSliceBoxes(),
      ]);
      if (requestId !== profileRequestRef.current) return;
      if (postsResult.status === 'fulfilled') setMyPosts(postsResult.value.posts || []);
      if (sliceBoxesResult.status === 'fulfilled') setSliceBoxCount(sliceBoxesResult.value.boxes?.length || 0);
    } catch {} finally {
      if (requestId === profileRequestRef.current) setLoading(false);
    }
  }, [token, authUser]);
  const refreshProfile = useCallback(async () => {
    setRefreshing(true);
    await loadProfile();
    setRefreshing(false);
  }, [loadProfile]);

  useFocusEffect(useCallback(() => {
    void loadProfile();
    return () => { profileRequestRef.current += 1; };
  }, [loadProfile]));

  const mutedUntil = profile?.muted_until ?? authUser?.muted_until;
  useEffect(() => {
    if (!mutedUntil) return;
    const timer = setInterval(() => setRestrictionTick((value) => value + 1), 30_000);
    return () => clearInterval(timer);
  }, [mutedUntil]);

  const uid = profile?.id || authUser?.id || '';
  const isMuted = !!mutedUntil && Date.parse(mutedUntil) > Date.now();
  const name = nickname || authUser?.nickname || authUser?.username || '';
  const userGender = profile?.gender ?? authUser?.gender;
  const userAge = profile?.age ?? authUser?.age;
  const gender = userGender === 'male' || userGender === 'female' ? userGender : null;
  const avatarColor = '#33A9DC';
  const displayedAvatar = avatar || authUser?.avatar || null;
  const defaultTags = tags;

  const openPinnedEditor = () => {
    setPinnedDraft(bio);
    setPinnedEditorOpen(true);
  };

  const savePinnedCard = async () => {
    if (pinnedSaving) return;
    setPinnedSaving(true);
    try {
      const nextBio = pinnedDraft.trim();
      await updateProfile({ bio: nextBio });
      setBio(nextBio);
      setProfile((current: any) => ({ ...current, bio: nextBio }));
      await refreshUser();
      setPinnedEditorOpen(false);
    } catch (error: any) {
      Alert.alert('保存失败', error?.message || '请检查网络后重试');
    } finally {
      setPinnedSaving(false);
    }
  };

  const pickCover = async () => {
    const result = await launchImageLibrarySafely({
      mediaTypes: ['images'],
      allowsEditing: true,
      quality: 0.85,
    });
    if (!result.canceled && result.assets[0]) {
      const uri = result.assets[0].uri;
      // Show the selected image immediately while the upload runs.
      coverVersionRef.current += 1;
      coverUploadPendingRef.current = true;
      coverFallbackRef.current = uri;
      coverRef.current = uri;
      setCover(uri);
      try {
        const upload = await uploadFile(uri, 'c');
        await updateProfile({ cover_image: upload.url });
        coverUploadPendingRef.current = false;
        coverRef.current = upload.url;
        // COS/object storage can take a moment to become readable. Keep the
        // local preview until the remote image is actually available.
        const remoteReady = await Image.prefetch(upload.url).catch(() => false);
        setCover(remoteReady ? upload.url : uri);
      } catch (error: any) {
        // Keep the local preview visible if the network upload temporarily
        // fails; do not flash back to the empty grey cover.
        coverRef.current = uri;
        setCover(uri);
        Alert.alert('主页背景上传失败', error?.message || '请检查网络后重试');
      }
    }
  };

  const pickAvatar = async () => {
    if (avatarSaving) return;
    const result = await launchImageLibrarySafely({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.85,
    });
    if (result.canceled || !result.assets?.[0]) return;
    setAvatarSaving(true);
    try {
      const upload = await uploadFile(result.assets[0].uri, 'a');
      await updateProfile({ avatar: upload.url });
      setAvatar(upload.url);
      setProfile((current: any) => ({ ...current, avatar: upload.url }));
      await refreshUser();
    } catch (error: any) {
      Alert.alert('头像上传失败', error?.message || '请检查网络后重试');
    } finally {
      setAvatarSaving(false);
    }
  };

  const S = useThemedStyle(themed);

  return (
    <ScrollView style={S.scroll} showsVerticalScrollIndicator={false}
      refreshControl={
        <AppRefreshControl
          refreshing={refreshing}
          onRefresh={refreshProfile}
          progressViewOffset={insets.top + 12}
          colors={["#33A9DC"]}
          tintColor="#33A9DC"
          progressBackgroundColor={S.infoCard.backgroundColor}
        />
      }
    >
      <Pressable onPress={pickCover}>
        {cover ? (
          <Image
            source={{ uri: cover }}
            resizeMode="cover"
            style={[styles.cover, { height: coverH }]}
            onError={() => {
              const fallback = coverFallbackRef.current;
              if (fallback && cover !== fallback) setCover(fallback);
            }}
          />
        ) : (
          <View style={[styles.cover, { height: coverH, backgroundColor: '#D5D8E2' }]} />
        )}
      </Pressable>

      <Pressable style={styles.settingsBtn} onPress={() => router.push('/settings')}>
        <Ionicons name="settings-outline" size={22} color="#FFFFFF" />
      </Pressable>

      <View style={S.infoCard}>
        <View style={styles.userRow}>
          <View style={styles.avatarColumn}>
            <Pressable accessibilityLabel="更换头像" onPress={pickAvatar} disabled={avatarSaving} style={[styles.avatar, { backgroundColor: avatarColor, borderColor: S.infoCard.backgroundColor }]}>
              {displayedAvatar ? (
                <Image source={{ uri: displayedAvatar }} style={{ width: '100%', height: '100%', borderRadius: 38 }} />
              ) : (
                <Text style={styles.avatarText}>{nickname[0] || name[0]}</Text>
              )}
              {avatarSaving ? <View style={styles.avatarLoading}><ActivityIndicator color="#FFFFFF" /></View> : null}
            </Pressable>
          </View>
          <View style={styles.nameRow}>
            <View style={styles.identityText}>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text
                  style={S.name}
                >
                  {nickname || name}
                </Text>
              </View>
              <Text style={[S.uid, { marginTop: 1 }]}>UID: {uid}</Text>
              <Text style={[S.uid, { marginTop: 2 }]}>IP属地：{profile?.ipRegion || '未知'}</Text>
              {isMuted && (
                <Text style={{ fontSize: 11, lineHeight: 16, color: '#E17055', marginTop: 2 }}>
                  您已被禁言，剩余禁言时长：{restrictionRemaining(mutedUntil)}
                </Text>
              )}
              {profile?.entropy?.damaged && (
                <View style={styles.damagedRow}>
                  <Ionicons name="warning-outline" size={13} color="#E17055" />
                  <Text style={styles.damagedText}>探测仪已损坏</Text>
                </View>
              )}
            </View>
            <Pressable style={styles.editBtn} onPress={() => router.push('/edit-profile')}>
              <Text style={styles.editBtnText}>编辑</Text>
            </Pressable>
          </View>
        </View>
        {(gender || Number.isInteger(userAge) || tags.length > 0) && (
          <View style={styles.tagRow}>
            {gender && <GenderBadge gender={gender} />}
            {Number.isInteger(userAge) && (
              <View style={[styles.tag, styles.ageTag]}>
                <Text style={[styles.tagText, styles.ageTagText]}>{userAge}岁</Text>
              </View>
            )}
            {tags.map((t) => (
              <View key={t} style={styles.tag}>
                <Text style={[styles.tagText, { color: S.tagText.color }]}>{t}</Text>
              </View>
            ))}
          </View>
        )}

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.statsRow}
          style={{ borderTopColor: S.infoCard.borderTopColor ?? '#F2F3F7', borderTopWidth: StyleSheet.hairlineWidth }}
        >
          {[
            { label: '切片', value: myPosts.length, icon: 'albums-outline' as const },
            { label: '切片盒', value: sliceBoxCount, boxes: true, icon: 'file-tray-stacked-outline' as const },
            { label: '关注', value: stats.following, to: '关注', icon: 'person-add-outline' as const },
            { label: '粉丝', value: stats.followers, to: '粉丝', icon: 'people-outline' as const },
            { label: '贝壳', shell: true },
            { label: '制冷剂', value: Number(profile?.refrigerant_count ?? stats.refrigerant) || 0, refrigerant: true },
            { label: '熵减值', value: profile?.entropy?.value ?? 0, entropy: true, icon: 'analytics-outline' as const },
          ].map((s) => {
            const isShell = 'shell' in s && !!s.shell;
            const isRefrigerant = 'refrigerant' in s && !!s.refrigerant;
            const capsuleStyle = [
              styles.statItem,
              isShell && styles.shellStatItem,
              isRefrigerant && styles.refrigerantStatItem,
            ];
            const content = (
              <>
                {isShell
                  ? <FrostShellIcon size={18} color="#56C9EE" />
                  : isRefrigerant
                  ? <RefrigerantIcon size={18} color="#249ED1" />
                  : <Ionicons name={s.icon!} size={16} color="#33A9DC" />}
                <Text style={S.statLabel}>{s.label}</Text>
                {s.value !== undefined && <Text style={S.statValue}>{s.value}</Text>}
              </>
            );
            if ('to' in s && s.to) {
              return (
                <Pressable
                  key={s.label}
                  style={styles.statItem}
                  onPress={() => router.push({ pathname: '/user-list', params: { title: s.to, userId: profile?.id || authUser?.id } })}
                >
                  {content}
                </Pressable>
              );
            }
            if ('boxes' in s && s.boxes) {
              return (
                <Pressable key={s.label} accessibilityRole="button" style={styles.statItem} onPress={() => router.push('/slice-boxes')}>
                  {content}
                </Pressable>
              );
            }
            if ('shell' in s && s.shell) {
              return (
                <Pressable
                  key={s.label}
                  accessibilityRole="button"
                  accessibilityLabel="查看贝壳"
                  style={capsuleStyle}
                  onPress={() => setShellOpen(true)}
                >
                  {content}
                </Pressable>
              );
            }
            if ('refrigerant' in s && s.refrigerant) {
              return (
                <Pressable
                  key={s.label}
                  accessibilityRole="button"
                  accessibilityLabel="查看制冷剂规则"
                  style={capsuleStyle}
                  onPress={() => setRefrigerantOpen(true)}
                >
                  {content}
                </Pressable>
              );
            }
            if ('entropy' in s && s.entropy) {
              return (
                <Pressable key={s.label} accessibilityRole="button" style={styles.statItem} onPress={() => setEntropyOpen(true)}>
                  {content}
                </Pressable>
              );
            }
            return (
              <View key={s.label} style={styles.statItem}>
                {content}
              </View>
            );
          })}
        </ScrollView>
      </View>

      <PinnedProfileCard content={bio} onPress={openPinnedEditor} />

      {myPosts.map((post) => (
        <View key={post.id} style={{ paddingHorizontal: 12 }}>
          <PostCard
            post={post}
            onRefresh={() => setMyPosts(current => current.filter(item => item.id !== post.id))}
          />
        </View>
      ))}

      <FrostShellModal
        visible={shellOpen}
        fragileCount={Number(profile?.fragile_frost_shell_count ?? 0) || 0}
        eternalCount={Number(profile?.eternal_frost_shell_count ?? profile?.gifted_refrigerant_count) || 0}
        onClose={() => setShellOpen(false)}
      />
      <RefrigerantModal
        visible={refrigerantOpen}
        onClose={() => setRefrigerantOpen(false)}
      />
      <EntropyModal visible={entropyOpen} entropy={profile?.entropy} onClose={() => setEntropyOpen(false)} />
      <Modal visible={pinnedEditorOpen} transparent animationType="fade" onRequestClose={() => !pinnedSaving && setPinnedEditorOpen(false)}>
        <Pressable style={styles.pinnedBackdrop} onPress={() => !pinnedSaving && setPinnedEditorOpen(false)}>
          <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.pinnedKeyboard}>
            <Pressable
              style={[styles.pinnedEditor, { backgroundColor: S.infoCard.backgroundColor, borderColor: S.infoCard.borderTopColor }]}
              onPress={event => event.stopPropagation()}>
              <View style={styles.pinnedEditorHeader}>
                <View>
                  <Text style={[styles.pinnedEditorTitle, { color: S.name.color }]}>编辑置顶卡片</Text>
                  <Text style={[styles.pinnedEditorHint, { color: S.uid.color }]}>这段文字会始终显示在你的个人主页</Text>
                </View>
                <Pressable accessibilityLabel="关闭置顶卡片编辑" disabled={pinnedSaving} onPress={() => setPinnedEditorOpen(false)} style={styles.pinnedClose}>
                  <Ionicons name="close" size={19} color={S.uid.color} />
                </Pressable>
              </View>
              <TextInput
                autoFocus
                multiline
                maxLength={500}
                value={pinnedDraft}
                onChangeText={setPinnedDraft}
                placeholder="写下想置顶展示的文字"
                placeholderTextColor={S.uid.color}
                textAlignVertical="top"
                style={[styles.pinnedInput, { color: S.name.color, borderColor: S.infoCard.borderTopColor, backgroundColor: S.scroll.backgroundColor }]}
              />
              <Text style={[styles.pinnedCount, { color: S.uid.color }]}>{pinnedDraft.length}/500</Text>
              <Pressable disabled={pinnedSaving} onPress={savePinnedCard} style={[styles.pinnedSave, { backgroundColor: pinnedSaving ? '#8FA8B3' : '#33A9DC' }]}>
                {pinnedSaving ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Text style={styles.pinnedSaveText}>保存</Text>}
              </Pressable>
            </Pressable>
          </KeyboardAvoidingView>
        </Pressable>
      </Modal>

      <View style={{ height: Math.max(insets.bottom + 104, 112) }} />
    </ScrollView>
  );
}

const themed = (c: ThemeColors) => StyleSheet.create({
  scroll: { flex: 1, backgroundColor: c.bg },
  infoCard: {
    backgroundColor: c.card,
    marginHorizontal: 0,
    marginTop: 0,
    borderRadius: 0,
    padding: 16,
    marginBottom: 12,
    borderTopColor: c.divider,
  },
  name: { fontSize: 17, fontWeight: '600' as const, color: c.text, lineHeight: 20 },
  uid: { fontSize: 10, color: c.textMuted, lineHeight: 12 },
  statValue: { fontSize: 12, fontWeight: '700' as const, color: c.text },
  statLabel: { fontSize: 11, color: c.textMuted },
  sectionCard: {
    backgroundColor: c.card,
    borderRadius: 14,
    padding: 16,
    marginHorizontal: 12,
    marginBottom: 12,
  },
  sectionTitle: { fontSize: 15, fontWeight: '600' as const, color: c.textMuted },
  sectionCount: { fontSize: 13, color: c.textMuted },
  menuRow: { flexDirection: 'row' as const, alignItems: 'center' as const, paddingVertical: 14 },
  menuDivider: { borderBottomWidth: 1, borderBottomColor: c.divider },
  menuLabel: { flex: 1, fontSize: 15, color: c.text, marginLeft: 12 },
  postContent: { fontSize: 14, lineHeight: 21, color: c.text },
  postMeta: { fontSize: 12, color: c.textMuted, marginTop: 8 },
  tagText: { color: c.accent === '#33A9DC' ? '#24627A' : c.accent },
});

const styles = StyleSheet.create({
  cover: {
    width: '100%',
    backgroundColor: '#D5D8E2',
  },
  settingsBtn: {
    position: 'absolute',
    top: 48,
    right: 12,
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  userRow: { flexDirection: 'row', alignItems: 'flex-start' },
  avatarColumn: { width: 76, alignItems: 'center' },
  avatar: {
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -34,
    borderWidth: 4,
    borderColor: '#FFFFFF',
  },
  avatarText: { color: '#FFFFFF', fontSize: 28, fontWeight: '600' },
  avatarLoading: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, borderRadius: 38, backgroundColor: 'rgba(7,18,28,0.42)', alignItems: 'center', justifyContent: 'center' },
  nameRow: { flex: 1, marginLeft: 10, flexDirection: 'row', alignItems: 'flex-start' },
  identityText: { flex: 1, transform: [{ translateY: -9 }] },
  editBtn: {
    marginLeft: 4,
    borderWidth: 1,
    borderColor: '#D5D8E2',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  editBtnText: { fontSize: 12, color: '#6B7185' },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4, marginBottom: 2, paddingLeft: 12, paddingBottom: 3, overflow: 'visible' },
  tag: {
    minHeight: 25,
    backgroundColor: '#7FD8F51A',
    borderWidth: 1,
    borderColor: '#7FD8F580',
    paddingHorizontal: 10,
    paddingVertical: 0,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tagText: { fontSize: 11, lineHeight: 15, color: '#7FD8F5', fontWeight: '500', includeFontPadding: false, textAlignVertical: 'center' },
  ageTag: { borderWidth: 1, borderColor: '#8B7CF655', backgroundColor: '#8B7CF616' },
  ageTagText: { color: '#8B7CF6', fontWeight: '700' },
  statsRow: {
    flexDirection: 'row',
    marginTop: 0,
    paddingTop: 11,
    paddingRight: 4,
    gap: 6,
  },
  statItem: {
    height: 32,
    paddingHorizontal: 9,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#33A9DC38',
    backgroundColor: '#33A9DC10',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    flexShrink: 0,
  },
  shellStatItem: {
    borderColor: '#7FD8F566',
    backgroundColor: '#7FD8F517',
    paddingLeft: 8,
  },
  refrigerantStatItem: {
    borderColor: '#249ED150',
    backgroundColor: '#249ED114',
    paddingLeft: 8,
  },
  damagedRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 },
  damagedText: { fontSize: 11, fontWeight: '600', color: '#E17055' },
  pinnedBackdrop: { flex: 1, backgroundColor: 'rgba(8,15,24,0.48)', justifyContent: 'center', paddingHorizontal: 24 },
  pinnedKeyboard: { width: '100%', justifyContent: 'center' },
  pinnedEditor: { borderRadius: 8, borderWidth: 1, padding: 18 },
  pinnedEditorHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  pinnedEditorTitle: { fontSize: 17, fontWeight: '700' },
  pinnedEditorHint: { marginTop: 4, fontSize: 12 },
  pinnedClose: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  pinnedInput: { minHeight: 132, marginTop: 16, borderWidth: 1, borderRadius: 8, paddingHorizontal: 13, paddingVertical: 11, fontSize: 15, lineHeight: 22 },
  pinnedCount: { marginTop: 6, fontSize: 11, textAlign: 'right' },
  pinnedSave: { height: 44, marginTop: 12, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  pinnedSaveText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  postCard: {
    flexDirection: 'row',
    paddingVertical: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  postThumb: { width: 56, height: 56, borderRadius: 8, marginLeft: 10, backgroundColor: '#EDEEF3' },
  menuRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14 },
});
