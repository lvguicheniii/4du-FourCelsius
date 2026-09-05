import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ScreenHeader } from '@/components/screen-header';
import { UserAvatar } from '@/components/user-avatar';
import { getFollowers, getFollowing } from '@/api/client';
import { useTheme } from '@/lib/theme';
import { useAuth } from '@/contexts/auth';

type ListUser = {
  id: string;
  username?: string;
  nickname?: string;
  avatar?: string | null;
};

export default function UserListScreen() {
  const { colors } = useTheme();
  const { user } = useAuth();
  const router = useRouter();
  const { title = '关注', userId = '' } = useLocalSearchParams<{
    title?: string;
    userId?: string;
  }>();
  const effectiveUserId = userId || user?.id || '';
  const [users, setUsers] = useState<ListUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    if (!effectiveUserId) {
      setError('登录状态尚未恢复，请稍后重试');
      setLoading(false);
      return () => { cancelled = true; };
    }
    const load = title === '粉丝' ? getFollowers(effectiveUserId) : getFollowing(effectiveUserId);
    load
      .then((data) => {
        if (!cancelled) setUsers(Array.isArray(data) ? data : []);
      })
      .catch((reason) => {
        if (!cancelled) setError(reason?.message || '列表加载失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [title, effectiveUserId]);

  const openProfile = (item: ListUser) => {
    router.push({
      pathname: '/user/[name]',
      params: {
        name: item.nickname || item.username || item.id,
        userId: item.id,
      },
    });
  };

  return (
    <View style={[styles.page, { backgroundColor: colors.bg }]}>
      <ScreenHeader title={title} floating />
      <FlatList
        contentContainerStyle={styles.content}
        data={users}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => {
          const name = item.nickname || item.username || '未命名用户';
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`查看${name}的主页`}
              onPress={() => openProfile(item)}
              style={({ pressed }) => [
                styles.card,
                {
                  backgroundColor: colors.card,
                  borderColor: colors.divider,
                  opacity: pressed ? 0.72 : 1,
                },
              ]}
            >
              <UserAvatar uri={item.avatar} name={name} size={50} />
              <View style={styles.identity}>
                <Text numberOfLines={1} style={[styles.name, { color: colors.text }]}>
                  {name}
                </Text>
                <Text numberOfLines={1} style={[styles.uid, { color: colors.textMuted }]}>
                  UID: {item.id}
                </Text>
              </View>
              <View style={[styles.arrow, { backgroundColor: colors.accent + '12' }]}>
                <Ionicons name="chevron-forward" size={18} color={colors.accent} />
              </View>
            </Pressable>
          );
        }}
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator color={colors.accent} size="large" style={styles.empty} />
          ) : (
            <View style={styles.emptyState}>
              <Ionicons
                color={colors.textMuted}
                name={error ? 'cloud-offline-outline' : 'people-outline'}
                size={42}
              />
              <Text style={[styles.emptyTitle, { color: colors.textMuted }]}>
                {error || `暂无${title}`}
              </Text>
            </View>
          )
        }
        showsVerticalScrollIndicator={false}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  content: { paddingHorizontal: 12, paddingTop: 10, paddingBottom: 28, flexGrow: 1 },
  card: {
    minHeight: 76,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 10,
  },
  identity: { flex: 1, marginLeft: 12, marginRight: 10 },
  name: { fontSize: 16, fontWeight: '600' },
  uid: { fontSize: 11, marginTop: 4 },
  arrow: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: { marginTop: 60 },
  emptyState: { alignItems: 'center', paddingTop: 72 },
  emptyTitle: { fontSize: 14, marginTop: 12, textAlign: 'center' },
});
