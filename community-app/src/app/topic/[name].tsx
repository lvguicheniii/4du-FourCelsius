import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { getTopicPosts } from '@/api/client';
import { PostCard } from '@/components/post-card';
import { ScreenHeader } from '@/components/screen-header';
import { useTheme } from '@/lib/theme';
import { AppRefreshControl } from '@/components/app-refresh-control';

export default function TopicFeedScreen() {
  const { name } = useLocalSearchParams<{ name: string }>();
  const { colors } = useTheme();
  const topic = `#${String(name || '').replace(/^#/, '')}`;
  const [posts, setPosts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const pageRef = useRef(1);
  const hasMoreRef = useRef(false);
  const loadingMoreRef = useRef(false);
  const requestGenerationRef = useRef(0);

  const load = useCallback(async (refresh = true) => {
    if (!refresh && (!hasMoreRef.current || loadingMoreRef.current)) return;
    const generation = refresh ? ++requestGenerationRef.current : requestGenerationRef.current;
    const targetPage = refresh ? 1 : pageRef.current + 1;
    if (refresh) {
      setRefreshing(true);
    } else {
      loadingMoreRef.current = true;
      setLoadingMore(true);
    }
    try {
      const data = await getTopicPosts(topic, targetPage, 20);
      if (generation !== requestGenerationRef.current) return;
      const next = data.posts || [];
      setPosts(current => refresh ? next : [...current, ...next.filter((p: any) => !current.some(item => item.id === p.id))]);
      pageRef.current = targetPage;
      hasMoreRef.current = !!data.hasMore;
    } catch {
      if (refresh && generation === requestGenerationRef.current) setPosts([]);
    } finally {
      if (generation === requestGenerationRef.current) {
        loadingMoreRef.current = false;
        setLoading(false);
        setRefreshing(false);
        setLoadingMore(false);
      }
    }
  }, [topic]);
  const refreshTopic = useCallback(() => load(true), [load]);

  useFocusEffect(useCallback(() => {
    void load(true);
    return () => { requestGenerationRef.current += 1; };
  }, [load]));

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScreenHeader title={topic} floating />
      {loading ? (
        <ActivityIndicator size="large" color={colors.accent} style={{ marginTop: 60 }} />
      ) : (
        <FlatList
          data={posts}
          keyExtractor={item => item.id}
          renderItem={({ item }) => <PostCard post={item} onRefresh={() => load(true)} />}
          contentContainerStyle={{ padding: 12, paddingBottom: 32, flexGrow: 1 }}
          refreshControl={<AppRefreshControl refreshing={refreshing} onRefresh={refreshTopic} progressViewOffset={12} colors={[colors.accent]} tintColor={colors.accent} progressBackgroundColor={colors.card} />}
          onEndReached={() => load(false)}
          onEndReachedThreshold={0.4}
          ListFooterComponent={loadingMore ? <ActivityIndicator color={colors.accent} style={{ padding: 16 }} /> : null}
          ListEmptyComponent={<Text style={{ color: colors.textMuted, textAlign: 'center', marginTop: 80 }}>这个话题下还没有切片</Text>}
        />
      )}
    </View>
  );
}
