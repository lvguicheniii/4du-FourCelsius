import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { getPosts } from '@/api/client';
import { PostCard } from '@/components/post-card';
import { ScreenHeader } from '@/components/screen-header';
import { useCommunityConfig } from '@/contexts/community-config';
import { useTheme } from '@/lib/theme';

export default function BoardFeedScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { colors } = useTheme();
  const { boards } = useCommunityConfig();
  const board = boards.find(item => item.id === id);
  const [posts, setPosts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchPosts = useCallback(async () => {
    try {
      const data = await getPosts(1, 500, id);
      setPosts(data.posts || []);
    } catch {
      // Keep the current list when a refresh fails.
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(useCallback(() => { void fetchPosts(); }, [fetchPosts]));

  if (!board) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
        <Text style={{ color: colors.textMuted }}>冰格不存在</Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScreenHeader title={board.name} floating />
      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={colors.accent} />
      ) : (
        <FlatList
          data={posts}
          keyExtractor={item => item.id}
          renderItem={({ item }) => <PostCard post={item} onRefresh={fetchPosts} feedContext={`board:${id}`} />}
          contentContainerStyle={{ padding: 12, paddingBottom: 30, flexGrow: 1 }}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={<Text style={{ color: colors.textMuted, textAlign: 'center', paddingTop: 60 }}>暂无切片</Text>}
        />
      )}
    </View>
  );
}
