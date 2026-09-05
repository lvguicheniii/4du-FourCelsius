import { useState, useCallback } from 'react';
import { FlatList, StyleSheet, Text, View, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import { ScreenHeader } from '@/components/screen-header';
import { PostCard } from '@/components/post-card';
import { getCooledPosts } from '@/api/client';
import { useTheme } from '@/lib/theme';

export default function LikedPostsScreen() {
  const { colors } = useTheme();
  const [posts, setPosts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useFocusEffect(useCallback(() => {
    setLoading(true);
    getCooledPosts()
      .then(data => setPosts(data.posts || []))
      .catch(() => setPosts([]))
      .finally(() => setLoading(false));
  }, []));

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScreenHeader title="霜迹" />
      {loading ? (
        <ActivityIndicator style={{ marginTop: 40 }} color={colors.accent} />
      ) : (
        <FlatList
          style={{ flex: 1 }}
          contentContainerStyle={{ padding: 12, paddingBottom: 30, flexGrow: 1 }}
          data={posts}
          keyExtractor={(item) => item.id}
          showsVerticalScrollIndicator={false}
          renderItem={({ item }) => (
            <PostCard post={item} />
          )}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Ionicons name="snow-outline" size={40} color={colors.textMuted} />
              <Text style={[styles.emptyText, { color: colors.textMuted }]}>
                还没有降过温{'\n'}去首页给喜欢的内容降个温吧
              </Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 100 },
  emptyText: { fontSize: 13, lineHeight: 22, textAlign: 'center', marginTop: 12 },
});
