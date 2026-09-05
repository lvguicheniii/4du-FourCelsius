import { useState, useEffect, useCallback } from 'react';
import { FlatList, ActivityIndicator, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getPosts } from '@/api/client';
import { PostCard } from '@/components/post-card';
import { useTheme } from '@/lib/theme';
import { AppRefreshControl } from '@/components/app-refresh-control';

export default function DeepFreezeContent() {
  const { colors } = useTheme();
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
    <FlatList
      style={{ flex: 1, backgroundColor: colors.bg }}
      contentContainerStyle={{ padding: 12, paddingBottom: 30 }}
      data={posts}
      keyExtractor={(item) => item.id}
      renderItem={({ item }) => <PostCard post={item} />}
      showsVerticalScrollIndicator={false}
      refreshControl={<AppRefreshControl refreshing={refreshing} onRefresh={onRefresh} progressViewOffset={12} colors={[colors.accent]} tintColor={colors.accent} progressBackgroundColor={colors.card} />}
      ListEmptyComponent={
        loading ? (
          <ActivityIndicator size="large" color={colors.accent} style={{ marginTop: 60 }} />
        ) : (
          <View style={{ alignItems: 'center', justifyContent: 'center', paddingTop: 80 }}>
            <Ionicons name="snow-outline" size={48} color={colors.textMuted} />
            <Text style={{ color: colors.textMuted, fontSize: 14, marginTop: 12 }}>永冻层暂空</Text>
            <Text style={{ color: colors.textMuted, fontSize: 12, marginTop: 6 }}>去浮霜带给喜欢的切片降温吧</Text>
          </View>
        )
      }
    />
  );
}
