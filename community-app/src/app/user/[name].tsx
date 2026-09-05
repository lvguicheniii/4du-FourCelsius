import { useState, useEffect, useCallback, useRef } from 'react';
import { Dimensions, FlatList, Image, Pressable, StyleSheet, Text, View, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Image as ExpoImage } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getPosts, getUserProfile, followUser } from '@/api/client';
import { useTheme } from '@/lib/theme';
import { useAuth } from '@/contexts/auth';
import { PostCard } from '@/components/post-card';
import { restrictionRemaining } from '@/lib/account-restrictions';
import { GenderBadge } from '@/components/gender-badge';
import { PinnedProfileCard } from '@/components/pinned-profile-card';
import { cachedImageSource } from '@/lib/media-cache';
import { isNativeLiquidGlassEnabled, NativeLiquidGlassView } from '@/components/liquid-glass';

const coverH = Math.floor(Dimensions.get('window').height / 3);

export default function UserProfileScreen() {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const router = useRouter();
  const { name, userId: paramUserId } = useLocalSearchParams<{ name: string; userId?: string }>();
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [followed, setFollowed] = useState(false);
  const [posts, setPosts] = useState<any[]>([]);
  const followPendingRef = useRef(false);
  const userRequestRef = useRef(0);
  const activeProfileIdRef = useRef<string>('');
  const [, setRestrictionTick] = useState(0);
  activeProfileIdRef.current = String(profile?.id || '');
  const isOwnProfile = user?.id && profile?.id && user.id === profile.id;

  const loadUser = useCallback(async () => {
    const requestId = ++userRequestRef.current;
    setLoading(true);
    try {
      const data = await getUserProfile(paramUserId || name || '');
      if (requestId !== userRequestRef.current) return;
      setProfile(data);
      setFollowed(!!data.following);
      setPosts([]);
      try {
        const pd = await getPosts(1, 50, undefined, data.id);
        if (requestId !== userRequestRef.current) return;
        setPosts(pd.posts || []);
      } catch {}
    } catch {} finally {
      if (requestId === userRequestRef.current) setLoading(false);
    }
  }, [name, paramUserId]);

  useEffect(() => {
    void loadUser();
    return () => { userRequestRef.current += 1; };
  }, [loadUser]);

  useEffect(() => {
    if (!profile?.muted_until) return;
    const timer = setInterval(() => setRestrictionTick((value) => value + 1), 30_000);
    return () => clearInterval(timer);
  }, [profile?.muted_until]);

  const handleFollow = async () => {
    if (!profile || followPendingRef.current) return;
    const targetProfileId = String(profile.id);
    followPendingRef.current = true;
    const previous = followed;
    setFollowed(!previous);
    try {
      const result = await followUser(profile.id, !previous);
      if (activeProfileIdRef.current !== targetProfileId) return;
      const next = !!result.following;
      setFollowed(next);
      setProfile((current: any) => current ? {
        ...current,
        following: next,
        followedBy: !!result.followedBy,
        mutuallyFollowing: !!result.mutuallyFollowing,
        stats: {
          ...current.stats,
          followers: Math.max(0, (Number(current.stats?.followers) || 0) + (next === previous ? 0 : next ? 1 : -1)),
        },
      } : current);
    } catch {
      if (activeProfileIdRef.current === targetProfileId) setFollowed(previous);
    } finally {
      followPendingRef.current = false;
    }
  };

  const profileMatchesRequest = !!profile && (paramUserId
    ? String(profile.id) === String(paramUserId)
    : profile.username === name || profile.nickname === name);
  if (loading || !profileMatchesRequest) {
    return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}><ActivityIndicator size="large" color={colors.accent} /></View>;
  }

  const isDeleted = profile.deleted === true;
  const avatarColor = isDeleted ? '#B0B5C1' : '#33A9DC';
  const displayName = isDeleted ? '已注销' : (profile.nickname || profile.username || '');
  const userGender = isDeleted ? null : profile.gender;
  const userAge = isDeleted ? null : profile.age;
  const gender = !isDeleted && (userGender === 'male' || userGender === 'female') ? userGender : null;
  const uid = isDeleted ? '' : (profile.id || '');
  const isMuted = !isDeleted && !!profile.muted_until && Date.parse(profile.muted_until) > Date.now();
  const coverUri = profile.cover_image || '';
  const openChat = () => router.push({
    pathname: '/chat/[name]',
    params: {
      name: displayName,
      peerUserId: profile.id || '',
      peerAvatar: profile.avatar || '',
      peerGender: gender || '',
      peerAge: userAge == null ? '' : String(userAge),
      peerProfileReady: '1',
    },
  });

  return (<View style={{ flex: 1, backgroundColor: colors.bg }}>
    <FlatList
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingBottom: !isDeleted && !isOwnProfile ? 84 + insets.bottom : 30 }}
      data={posts}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => (
        <View style={{ paddingHorizontal: 12 }}>
          <PostCard post={item} />
        </View>
      )}
      showsVerticalScrollIndicator={false}
      ListHeaderComponent={() => (
        <View>
          <View style={{ position: 'relative' }}>
            {coverUri ? (
              <Image source={{ uri: coverUri }} resizeMode="cover" style={{ width: '100%', height: coverH }} />
            ) : (
              <View style={{ width: '100%', height: coverH, backgroundColor: colors.accent + '30' }} />
            )}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="返回"
              hitSlop={10}
              onPress={() => router.back()}
              style={{
                position: 'absolute',
                left: 12,
                top: insets.top + 8,
                width: 38,
                height: 38,
                borderRadius: 12,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: 'rgba(0,0,0,0.34)',
              }}
            >
              <Ionicons name="chevron-back" size={24} color="#FFFFFF" />
            </Pressable>
          </View>
          <View style={[styles.profileInfoSection, { backgroundColor: colors.card, borderTopColor: colors.divider }]}>
            <View style={styles.profileIdentityRow}>
              <View style={styles.avatarColumn}>
                <View style={{ width: 72, height: 72, borderRadius: 36, backgroundColor: avatarColor, borderWidth: 3, borderColor: colors.card, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                  {profile.avatar ? <ExpoImage source={cachedImageSource(profile.avatar)} style={{ width: 72, height: 72 }} cachePolicy="memory-disk" transition={0} /> : <Text style={{ color: '#FFF', fontSize: 28, fontWeight: '700' }}>{displayName[0]}</Text>}
                </View>
              </View>
              <View style={styles.identityContent}>
                <View style={styles.identityText}>
                  <Text style={{ fontSize: 18, lineHeight: 22, fontWeight: '600', color: colors.text }}>{displayName}</Text>
                  {!isDeleted && <Text style={[styles.identityMeta, { color: colors.textMuted }]}>UID: {uid}</Text>}
                  {!isDeleted && <Text style={[styles.identityMeta, { color: colors.textMuted }]}>IP属地：{profile.ipRegion || '未知'}</Text>}
                  {isMuted && (
                    <Text style={{ fontSize: 11, lineHeight: 16, color: '#E17055', marginTop: 2 }}>
                      您已被禁言，剩余禁言时长：{restrictionRemaining(profile.muted_until)}
                    </Text>
                  )}
                  {!isDeleted && profile.entropy?.damaged && (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3 }}>
                      <Ionicons name="warning-outline" size={13} color="#E17055" />
                      <Text style={{ fontSize: 11, fontWeight: '600', color: '#E17055' }}>探测仪已损坏</Text>
                    </View>
                  )}
                  {isDeleted && <Text style={{ fontSize: 13, color: colors.textMuted, marginTop: 4 }}>该用户已注销账号</Text>}
                </View>
                {!isDeleted && isOwnProfile && (
                  <Pressable style={[styles.editButton, { backgroundColor: colors.card, borderColor: colors.divider }]} onPress={() => router.push('/edit-profile')}>
                    <Text style={{ color: colors.text, fontWeight: '600', fontSize: 12 }}>编辑</Text>
                  </Pressable>
                )}
              </View>
            </View>
            {!isDeleted && (gender || Number.isInteger(userAge) || profile.tags?.length > 0) && (
              <View style={styles.profileTagRow}>
                {gender && <GenderBadge gender={gender} />}
                {Number.isInteger(userAge) && (
                  <View style={[styles.profileTag, { borderColor: '#8B7CF655', backgroundColor: '#8B7CF616' }]}>
                    <Text style={[styles.profileTagText, { fontWeight: '700', color: '#8B7CF6' }]}>{userAge}岁</Text>
                  </View>
                )}
                {(profile.tags || []).map((tag: string) => (
                  <View key={tag} style={[styles.profileTag, { borderColor: isDark ? '#7FD8F580' : '#8ACFE8', backgroundColor: isDark ? '#7FD8F51A' : '#E6F5FB' }]}>
                    <Text style={[styles.profileTagText, { color: isDark ? '#7FD8F5' : '#24627A' }]}>{tag}</Text>
                  </View>
                ))}
              </View>
            )}
            {!isDeleted && (
              <View style={{ flexDirection: 'row', gap: 22, marginTop: 14 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}><Ionicons name="albums-outline" size={16} color={colors.accent} /><Text style={{ color: colors.text, fontWeight: '600' }}>{profile.stats?.posts || 0}</Text><Text style={{ color: colors.textMuted, fontSize: 12 }}>切片</Text></View>
                <Pressable accessibilityRole="button" accessibilityLabel="查看关注列表" onPress={() => router.push({ pathname: '/user-list', params: { title: '关注', userId: String(profile.id) } })} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}><Ionicons name="person-add-outline" size={16} color={colors.accent} /><Text style={{ color: colors.text, fontWeight: '600' }}>{profile.stats?.following || 0}</Text><Text style={{ color: colors.textMuted, fontSize: 12 }}>关注</Text></Pressable>
                <Pressable accessibilityRole="button" accessibilityLabel="查看粉丝列表" onPress={() => router.push({ pathname: '/user-list', params: { title: '粉丝', userId: String(profile.id) } })} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}><Ionicons name="people-outline" size={16} color={colors.accent} /><Text style={{ color: colors.text, fontWeight: '600' }}>{profile.stats?.followers || 0}</Text><Text style={{ color: colors.textMuted, fontSize: 12 }}>粉丝</Text></Pressable>
              </View>
            )}
          </View>
          {!isDeleted && (isOwnProfile || String(profile.bio || '').trim().length > 0) && <PinnedProfileCard content={profile.bio} />}
        </View>
      )}
      ListEmptyComponent={<Text style={{ textAlign: 'center', color: colors.textMuted, marginTop: 20 }}>暂无切片</Text>}
    />
    {!isDeleted && !isOwnProfile && (
      <View pointerEvents="box-none" style={[styles.floatingActionsWrap, { bottom: insets.bottom + 12 }]}>
        {isNativeLiquidGlassEnabled ? <NativeLiquidGlassView glassEffectStyle="regular" colorScheme={isDark ? 'dark' : 'light'} isInteractive style={styles.floatingGlassButton}>
          <Pressable style={styles.floatingGlassPressable} onPress={openChat}>
            <Ionicons name="chatbubble-outline" size={17} color={colors.text} />
            <Text style={[styles.floatingButtonText, { color: colors.text }]}>私信</Text>
          </Pressable>
        </NativeLiquidGlassView> : <Pressable style={[styles.floatingButton, { borderWidth: 1, borderColor: colors.divider, backgroundColor: colors.card }]} onPress={openChat}>
            <Ionicons name="chatbubble-outline" size={17} color={colors.text} /><Text style={[styles.floatingButtonText, { color: colors.text }]}>私信</Text>
          </Pressable>}
        {isNativeLiquidGlassEnabled ? <NativeLiquidGlassView glassEffectStyle="regular" colorScheme={isDark ? 'dark' : 'light'} tintColor={followed ? undefined : colors.accent} isInteractive style={styles.floatingGlassButton}>
          <Pressable style={styles.floatingGlassPressable} onPress={handleFollow}>
            <Ionicons name={followed ? 'checkmark' : 'add'} size={18} color={followed ? colors.text : colors.accent} />
            <Text style={[styles.floatingButtonText, { color: followed ? colors.text : colors.accent }]}>{followed ? '已关注' : '关注'}</Text>
          </Pressable>
        </NativeLiquidGlassView> : <Pressable style={[styles.floatingButton, { backgroundColor: followed ? colors.textMuted : colors.accent }]} onPress={handleFollow}>
            <Ionicons name={followed ? 'checkmark' : 'add'} size={18} color="#FFFFFF" /><Text style={[styles.floatingButtonText, { color: '#FFFFFF' }]}>{followed ? '已关注' : '关注'}</Text>
          </Pressable>}
      </View>
    )}
  </View>
  );
}

const styles = StyleSheet.create({
  profileInfoSection: { padding: 16, marginBottom: 12, borderTopWidth: StyleSheet.hairlineWidth },
  profileIdentityRow: { flexDirection: 'row', alignItems: 'flex-start' },
  avatarColumn: { width: 76, alignItems: 'center', marginTop: -40 },
  identityContent: { flex: 1, minWidth: 0, marginLeft: 10, marginTop: -9, flexDirection: 'row', alignItems: 'flex-start' },
  identityText: { flex: 1, minWidth: 0 },
  identityMeta: { marginTop: 2, fontSize: 10, lineHeight: 12 },
  editButton: { marginLeft: 6, borderWidth: 1, borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  profileTagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 10, marginBottom: 2, paddingBottom: 3, overflow: 'visible' },
  profileTag: { minHeight: 25, paddingHorizontal: 10, paddingVertical: 0, borderRadius: 10, borderWidth: 1, borderColor: '#7FD8F580', backgroundColor: '#7FD8F51A', alignItems: 'center', justifyContent: 'center' },
  profileTagText: { fontSize: 11, lineHeight: 15, color: '#7FD8F5', fontWeight: '500', includeFontPadding: false, textAlignVertical: 'center' },
  floatingActionsWrap: { position: 'absolute', left: 32, right: 32, flexDirection: 'row', justifyContent: 'space-between' },
  floatingButton: { width: 112, minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 13, shadowColor: '#07141C', shadowOpacity: 0.16, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 8 },
  floatingGlassButton: { width: 112, height: 44, borderRadius: 13, overflow: 'hidden' },
  floatingGlassPressable: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7 },
  floatingButtonText: { fontSize: 14, fontWeight: '700' },
});
