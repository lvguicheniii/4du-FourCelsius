import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View, Modal, TextInput } from 'react-native';
import { Pressable } from '@/components/pressable';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams } from 'expo-router';
import { getSliceBox, getSliceBoxPosts, renameSliceBox, type SliceBox } from '@/api/client';
import { Alert } from '@/components/app-alert';
import { PostCard } from '@/components/post-card';
import { ScreenHeader } from '@/components/screen-header';
import { useTheme } from '@/lib/theme';
import { useAuth } from '@/contexts/auth';

export default function SliceBoxDetailScreen() {
  const { id, name } = useLocalSearchParams<{ id: string; name?: string }>();
  const { colors } = useTheme();
  const { user } = useAuth();
  const [box, setBox] = useState<SliceBox | null>(name ? { id, name, postCount: 0 } : null);
  const [posts, setPosts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [renaming, setRenaming] = useState(false);

  const load = useCallback(async () => {
    try {
      const [boxResult, postsResult] = await Promise.all([getSliceBox(id), getSliceBoxPosts(id)]);
      setBox(boxResult);
      setPosts(postsResult.posts || []);
    } catch (error: any) {
      Alert.alert('加载失败', error?.message || '切片盒暂时无法打开');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <ScreenHeader title={box?.name || '切片盒'} floating floatingSpacer={68} right={box?.ownerId === user?.id ? (
        <Pressable accessibilityRole="button" accessibilityLabel="重命名切片盒" onPress={() => { setRenameValue(box?.name || ''); setRenameOpen(true); }} style={styles.renameButton}>
          <Ionicons name="pencil-outline" size={19} color={colors.accent} />
        </Pressable>
      ) : undefined} />
      {loading ? (
        <ActivityIndicator size="large" color={colors.accent} style={styles.loading} />
      ) : (
        <FlatList
          data={posts}
          keyExtractor={item => item.id}
          contentContainerStyle={[styles.list, posts.length === 0 && styles.emptyList]}
          renderItem={({ item }) => <PostCard post={item} onRefresh={load} feedContext={`slice-box:${id}`} />}
          ListHeaderComponent={(
            <View style={styles.summaryRow}>
              <Text style={[styles.count, { color: colors.textMuted }]}>{box?.postCount ?? posts.length} 份切片</Text>
              {!!box?.ownerId && box.ownerId !== user?.id && (
                <Text style={[styles.owner, { color: colors.textMuted }]} numberOfLines={1}>切片盒所有者：{box.ownerName || '未知用户'}</Text>
              )}
            </View>
          )}
          ListEmptyComponent={(
            <View style={styles.empty}>
              <Ionicons name="albums-outline" size={42} color={colors.textMuted} />
              <Text style={[styles.emptyTitle, { color: colors.text }]}>这个切片盒还是空的</Text>
              <Text style={[styles.emptyText, { color: colors.textMuted }]}>制备切片时可以把它放进这里</Text>
            </View>
          )}
        />
      )}
      <Modal visible={renameOpen} transparent animationType="fade" onRequestClose={() => setRenameOpen(false)}>
        <View style={styles.modalOverlay}>
          <View style={[styles.renameCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]}>
            <Text style={[styles.renameTitle, { color: colors.text }]}>重命名切片盒</Text>
            <TextInput value={renameValue} onChangeText={setRenameValue} maxLength={8} autoFocus placeholder="请输入名称" placeholderTextColor={colors.textMuted} style={[styles.renameInput, { color: colors.text, backgroundColor: colors.input, borderColor: colors.divider }]} />
            <View style={styles.renameActions}>
              <Pressable style={[styles.renameAction, { backgroundColor: colors.input }]} onPress={() => setRenameOpen(false)}><Text style={{ color: colors.textMuted }}>取消</Text></Pressable>
              <Pressable style={[styles.renameAction, { backgroundColor: colors.accent }]} disabled={renaming || !renameValue.trim()} onPress={async () => { setRenaming(true); try { const result = await renameSliceBox(id, renameValue.trim()); setBox(current => current ? { ...current, name: result.name } : current); setRenameOpen(false); } catch (error: any) { Alert.alert('重命名失败', error?.message || '请稍后重试'); } finally { setRenaming(false); } }}><Text style={{ color: '#FFFFFF', fontWeight: '600' }}>{renaming ? '保存中...' : '保存'}</Text></Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  loading: { marginTop: 80 },
  list: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 32 },
  emptyList: { flexGrow: 1 },
  summaryRow: { minHeight: 26, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 8, paddingHorizontal: 2 },
  count: { flexShrink: 0, fontSize: 11, lineHeight: 18 },
  owner: { flex: 1, fontSize: 11, lineHeight: 18, textAlign: 'right' },
  renameButton: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.42)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 34 },
  renameCard: { width: '100%', maxWidth: 330, borderRadius: 14, borderWidth: 1, padding: 20 },
  renameTitle: { fontSize: 17, fontWeight: '700', textAlign: 'center', marginBottom: 14 },
  renameInput: { borderWidth: 1, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 11, fontSize: 15 },
  renameActions: { flexDirection: 'row', gap: 10, marginTop: 16 },
  renameAction: { flex: 1, minHeight: 42, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 60 },
  emptyTitle: { fontSize: 15, fontWeight: '600', marginTop: 12 },
  emptyText: { fontSize: 12, marginTop: 5 },
});
