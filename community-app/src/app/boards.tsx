import { useState, useEffect, useCallback } from 'react';
import { FlatList, ActivityIndicator, Text, View, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getPosts } from '@/api/client';
import { PostCard } from '@/components/post-card';
import { Pressable } from '@/components/pressable';
import { useTheme } from '@/lib/theme';
import { useRouter } from 'expo-router';
import { AppRefreshControl } from '@/components/app-refresh-control';

export default function DeepFreezeScreen() {
  const { colors } = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const [posts, setPosts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadPosts = useCallback(async (isRefresh: boolean) => {
    try {
      const data = await getPosts(1, 1000);
      setPosts(data.posts
        .filter((p: any) => p.likes >= 5)
        .sort((a: any, b: any) => b.likes - a.likes)
      );
    } catch {} finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { loadPosts(true); }, [loadPosts]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    loadPosts(true);
  }, [loadPosts]);

  return (
    <View style={[styles.container, { backgroundColor: colors.bg }]}>
      {/* 固定顶部居中标题 —— 与浮霜带 tab 文字同高度 */}
      <View style={[styles.header, { paddingTop: insets.top + 8 }]}>
        <Pressable style={styles.backBtn} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={24} color={colors.accent} />
        </Pressable>
        <Text style={[styles.title, { color: colors.text }]}>永冻层</Text>
        <View style={styles.backBtn} />
      </View>

      <FlatList
        style={{ flex: 1 }}
        contentContainerStyle={[styles.listContent, posts.length === 0 && !loading ? styles.emptyList : undefined]}
        data={posts}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <PostCard post={item} />}
        showsVerticalScrollIndicator={false}
        refreshControl={<AppRefreshControl refreshing={refreshing} onRefresh={onRefresh} progressViewOffset={12} colors={[colors.accent]} tintColor={colors.accent} progressBackgroundColor={colors.card} />}
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator size="large" color={colors.accent} style={{ marginTop: 60 }} />
          ) : (
            <View style={styles.emptyWrap}>
              <Ionicons name="snow-outline" size={48} color={colors.textMuted} />
              <Text style={[styles.emptyTitle, { color: colors.textMuted }]}>永冻层暂空</Text>
              <Text style={[styles.emptySub, { color: colors.textMuted }]}>去浮霜带给喜欢的切片降温吧</Text>
            </View>
          )
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingBottom: 12,
  },
  backBtn: { width: 34, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 17, fontWeight: '600', textAlign: 'center', flex: 1 },
  listContent: { paddingHorizontal: 12, paddingBottom: 30 },
  emptyList: { flexGrow: 1, justifyContent: 'center' },
  emptyWrap: { alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { fontSize: 14, marginTop: 12 },
  emptySub: { fontSize: 12, marginTop: 6 },
});
