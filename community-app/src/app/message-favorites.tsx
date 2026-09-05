import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { getFavoriteConversations, getFavoriteReefRooms, setConversationPreference, setReefPreference } from '@/api/client';
import { Pressable } from '@/components/pressable';
import { ReefShareCard } from '@/components/reef-share-card';
import { ScreenHeader } from '@/components/screen-header';
import { ShortcutActionsModal } from '@/components/shortcut-actions-modal';
import { useTheme } from '@/lib/theme';
import { useWs } from '@/contexts/ws';
import { useAuth } from '@/contexts/auth';
import { formatRelativeTime } from '@/lib/time';
import { cachedImageSource } from '@/lib/media-cache';

type FavoriteItem = { key: string; kind: 'chat' | 'reef'; data: any; importantAt?: string | null; activityTime?: string };

export default function MessageFavoritesScreen() {
  const router = useRouter();
  const { colors } = useTheme();
  const { lastChatMsg, reefEvents } = useWs();
  const { token } = useAuth();
  const loadGenerationRef = useRef(0);
  const [chats, setChats] = useState<any[]>([]);
  const [reefs, setReefs] = useState<any[]>([]);
  const [actionItem, setActionItem] = useState<FavoriteItem | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const generation = ++loadGenerationRef.current;
    if (!token) {
      setChats([]);
      setReefs([]);
      setLoading(false);
      return;
    }
    try {
      const [chatData, reefData] = await Promise.all([getFavoriteConversations(), getFavoriteReefRooms()]);
      if (generation !== loadGenerationRef.current) return;
      setChats(chatData || []);
      setReefs(reefData?.rooms || []);
    } catch {}
    if (generation === loadGenerationRef.current) setLoading(false);
  }, [token]);

  useEffect(() => () => { loadGenerationRef.current += 1; }, []);

  useFocusEffect(useCallback(() => { void load(); }, [load]));
  useEffect(() => { if (lastChatMsg?.type === 'chat') void load(); }, [lastChatMsg, load]);
  useEffect(() => {
    const latest = reefEvents[reefEvents.length - 1];
    if (latest?.type === 'reef_message' || latest?.type === 'reef_room_updated') void load();
  }, [load, reefEvents]);

  const items = useMemo<FavoriteItem[]>(() => [
    ...chats.map(data => ({ key: `chat-${data.userId}`, kind: 'chat' as const, data, importantAt: data.importantAt, activityTime: data.time })),
    ...reefs.map(data => ({ key: `reef-${data.id}`, kind: 'reef' as const, data, importantAt: data.importantAt, activityTime: data.latestMessage?.time || '' })),
  ].sort((a, b) => {
    const aTime = a.importantAt && a.importantAt > (a.activityTime || '') ? a.importantAt : a.activityTime || '';
    const bTime = b.importantAt && b.importantAt > (b.activityTime || '') ? b.importantAt : b.activityTime || '';
    return String(bTime).localeCompare(String(aTime));
  }), [chats, reefs]);

  const removeImportant = async () => {
    if (!actionItem) return;
    try {
      if (actionItem.kind === 'chat') await setConversationPreference(actionItem.data.userId, { important: false });
      else await setReefPreference(actionItem.data.id, { important: false });
      setActionItem(null);
      await load();
    } catch {}
  };

  const hideShortcut = async () => {
    if (!actionItem) return;
    try {
      if (actionItem.kind === 'chat') await setConversationPreference(actionItem.data.userId, { hidden: true });
      else await setReefPreference(actionItem.data.id, { hidden: true });
      setActionItem(null);
      await load();
    } catch {}
  };

  return (
    <View style={[s.page, { backgroundColor: colors.bg }]}>
      <ScreenHeader title="收藏" floating />
      <FlatList
        data={items}
        keyExtractor={item => item.key}
        contentContainerStyle={s.list}
        renderItem={({ item }) => item.kind === 'reef' ? (
          <ReefShareCard roomId={item.data.id} initialRoom={item.data} onLongPress={() => setActionItem(item)} />
        ) : (
          <Pressable
            style={[s.card, { backgroundColor: colors.card }]}
            onPress={() => router.push({
              pathname: '/chat/[name]',
              params: {
                name: item.data.name,
                peerUserId: item.data.userId || '',
                peerAvatar: item.data.avatar || '',
                peerGender: item.data.gender || '',
                peerAge: item.data.age == null ? '' : String(item.data.age),
                peerProfileReady: '1',
              },
            })}
            onLongPress={() => setActionItem(item)}
          >
            <View style={[s.avatar, { backgroundColor: item.data.avatarColor || colors.accent }]}>
              {item.data.avatar ? <ExpoImage source={cachedImageSource(item.data.avatar)} style={s.avatarImage} cachePolicy="memory-disk" transition={0} /> : <Text style={s.avatarText}>{item.data.name?.[0] || '?'}</Text>}
            </View>
            <View style={s.body}>
              <Text style={[s.name, { color: colors.text }]} numberOfLines={1}>{item.data.name}</Text>
              <Text style={[s.preview, { color: colors.textMuted }]} numberOfLines={1}>{item.data.lastMessage}</Text>
            </View>
            <Ionicons name="bookmark" size={14} color={colors.accent} style={s.bookmark} />
            <View pointerEvents="none" style={s.timeSlot}>
              <Text style={[s.time, { color: colors.textMuted }]} numberOfLines={1}>{formatRelativeTime(item.data.time)}</Text>
            </View>
          </Pressable>
        )}
        ListEmptyComponent={loading ? <ActivityIndicator size="large" color={colors.accent} style={s.loading} /> : <View style={s.empty}><Ionicons name="bookmark-outline" size={38} color={colors.textMuted} /><Text style={[s.emptyText, { color: colors.textMuted }]}>暂无重要对话或礁石</Text></View>}
      />
      <ShortcutActionsModal
        visible={!!actionItem}
        kind={actionItem?.kind || 'chat'}
        important
        onClose={() => setActionItem(null)}
        onHide={() => void hideShortcut()}
        onToggleImportant={() => void removeImportant()}
      />
    </View>
  );
}

const s = StyleSheet.create({
  page: { flex: 1 },
  list: { padding: 12, paddingBottom: 30, flexGrow: 1 },
  card: { minHeight: 68, borderRadius: 14, padding: 10, flexDirection: 'row', alignItems: 'center', marginTop: 10, position: 'relative' },
  avatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  avatarImage: { width: '100%', height: '100%' },
  avatarText: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' },
  body: { flex: 1, minWidth: 0, marginLeft: 10, marginRight: 74 },
  name: { fontSize: 14, fontWeight: '700' },
  preview: { fontSize: 12, marginTop: 4 },
  bookmark: { position: 'absolute', top: 8, right: 10 },
  timeSlot: { position: 'absolute', right: 10, top: 0, bottom: 0, width: 66, alignItems: 'flex-end', justifyContent: 'center' },
  time: { width: 66, fontSize: 10, lineHeight: 14, textAlign: 'right', textAlignVertical: 'center', includeFontPadding: false },
  empty: { alignItems: 'center', marginTop: 100 },
  emptyText: { fontSize: 13, marginTop: 10 },
  loading: { marginTop: 80 },
});
