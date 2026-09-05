import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useNavigation, useRouter } from 'expo-router';
import {
  getConversations,
  getNotifications,
  getParticipatingReefRooms,
  getUnreadNotificationCount,
  setConversationPreference,
  setReefPreference,
} from '@/api/client';
import { Pressable } from '@/components/pressable';
import { ReefShareCard } from '@/components/reef-share-card';
import { ShortcutActionsModal } from '@/components/shortcut-actions-modal';
import { useTheme } from '@/lib/theme';
import { useWs } from '@/contexts/ws';
import { useAuth } from '@/contexts/auth';
import { isBlocked } from '@/data/store';
import { formatRelativeTime } from '@/lib/time';
import { cachedImageSource } from '@/lib/media-cache';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { isNativeLiquidGlassEnabled, NativeLiquidGlassView } from '@/components/liquid-glass';
import { AppRefreshControl, refreshIndicatorBelow } from '@/components/app-refresh-control';

const AVATAR_COLORS = ['#33A9DC', '#6C5CE7', '#00B894', '#E17055', '#E84393', '#F7B731', '#0984E3', '#8854D0'];

type ListItem =
  | { key: string; kind: 'chat'; data: any; important: boolean; importantAt?: string | null; activityTime?: string }
  | { key: string; kind: 'reef'; data: any; important: boolean; importantAt?: string | null; activityTime?: string }
  | { key: string; kind: 'notification'; data: any; important: false; activityTime?: string };

function ConversationRow({ item, onLongPress }: { item: any; onLongPress: () => void }) {
  const router = useRouter();
  const { colors } = useTheme();
  return (
    <Pressable
      style={[styles.card, { backgroundColor: colors.card }]}
      onPress={() => router.push({
        pathname: '/chat/[name]',
        params: {
          name: item.name,
          peerUserId: item.userId || '',
          peerAvatar: item.avatar || '',
          peerGender: item.gender || '',
          peerAge: item.age == null ? '' : String(item.age),
          peerProfileReady: '1',
        },
      })}
      onLongPress={onLongPress}
    >
      <View style={[styles.avatar, { backgroundColor: item.avatarColor || AVATAR_COLORS[0] }]}>
        {item.avatar ? <ExpoImage source={cachedImageSource(item.avatar)} style={styles.avatarImg} cachePolicy="memory-disk" transition={0} /> : <Text style={styles.avatarText}>{item.name?.[0] || '?'}</Text>}
      </View>
      <View style={styles.conversationRowBody}>
        <View style={styles.topLine}>
          <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>{item.name}</Text>
        </View>
        <View style={styles.previewRow}>
          <Text style={[styles.conversationPreview, { color: item.unread > 0 ? colors.text : colors.textMuted }]} numberOfLines={1}>{item.lastMessage}</Text>
          {item.unread > 0 && <View style={styles.blueDot} />}
        </View>
      </View>
      {item.important && <Ionicons name="bookmark" size={14} color={colors.accent} style={styles.bookmark} />}
      <View pointerEvents="none" style={styles.timeSlot}>
        <Text style={[styles.time, { color: colors.textMuted }]} numberOfLines={1}>
          {formatRelativeTime(item.time, { absoluteAfterDays: 30 }) || item.time}
        </Text>
      </View>
    </Pressable>
  );
}

function NotificationRow({ item }: { item: any }) {
  const router = useRouter();
  const { colors } = useTheme();
  return (
    <Pressable style={[styles.card, { backgroundColor: colors.card }]} onPress={() => router.push({ pathname: '/notifications', params: { category: item.category } })}>
      <View style={[styles.avatar, { backgroundColor: item.iconColor + '18' }]}>
        <Ionicons name={item.icon} size={24} color={item.iconColor} />
        {item.unread > 0 && <View style={styles.badge}><Text style={styles.badgeText}>{item.unread > 99 ? '99+' : item.unread}</Text></View>}
      </View>
      <View style={styles.rowBody}>
        <Text style={[styles.name, { color: colors.text }]}>{item.label}</Text>
        <Text style={[styles.preview, { color: colors.textMuted }]} numberOfLines={1}>{item.preview}</Text>
      </View>
    </Pressable>
  );
}

export default function MessagesScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const navigation = useNavigation();
  const { colors, isDark } = useTheme();
  const { lastChatMsg, lastNotification, connectionVersion, reefEvents } = useWs();
  const { token } = useAuth();
  const loadGenerationRef = useRef(0);
  const [conversations, setConversations] = useState<any[]>([]);
  const [reefRooms, setReefRooms] = useState<any[]>([]);
  const [notificationRows, setNotificationRows] = useState<any[]>([]);
  const [actionItem, setActionItem] = useState<ListItem | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loading, setLoading] = useState(true);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerShown: !isNativeLiquidGlassEnabled,
      headerRight: () => (
        <Pressable accessibilityLabel="查看收藏" hitSlop={10} style={styles.headerButton} onPress={() => router.push('/message-favorites' as any)}>
          <Ionicons name="bookmark" size={22} color={colors.accent} />
        </Pressable>
      ),
    });
  }, [colors.accent, navigation, router]);

  const loadData = useCallback(async () => {
    const generation = ++loadGenerationRef.current;
    if (!token) {
      setConversations([]);
      setReefRooms([]);
      setNotificationRows([]);
      setLoading(false);
      return;
    }
    try {
      const [conversationData, reefData, interactions, systems, unread] = await Promise.all([
        getConversations(),
        getParticipatingReefRooms(),
        getNotifications('interaction'),
        getNotifications('system'),
        getUnreadNotificationCount(),
      ]);
      if (generation !== loadGenerationRef.current) return;
      setConversations((conversationData || []).filter((item: any) => !isBlocked(item.name)));
      setReefRooms(reefData?.rooms || []);
      setNotificationRows([
        {
          category: 'interaction', label: '互动通知', icon: 'notifications-outline', iconColor: '#33A9DC',
          unread: unread?.interaction || 0,
          preview: interactions?.[0]?.content || interactions?.[0]?.title || '暂无新通知',
          time: interactions?.[0]?.createdAt || '',
        },
        {
          category: 'system', label: '系统通知', icon: 'megaphone-outline', iconColor: '#F7B731',
          unread: unread?.system || 0,
          preview: systems?.[0]?.title || systems?.[0]?.content || '暂无新通知',
          time: systems?.[0]?.createdAt || '',
        },
      ]);
    } catch {}
    if (generation === loadGenerationRef.current) setLoading(false);
  }, [token]);

  useEffect(() => () => { loadGenerationRef.current += 1; }, []);

  useFocusEffect(useCallback(() => { void loadData(); }, [loadData]));
  useEffect(() => { if (connectionVersion > 0) void loadData(); }, [connectionVersion, loadData]);
  useEffect(() => {
    if (lastChatMsg?.type === 'chat' || lastChatMsg?.type === 'chat_message_recalled') void loadData();
  }, [lastChatMsg, loadData]);
  useEffect(() => { if (lastNotification) void loadData(); }, [lastNotification, loadData]);
  useEffect(() => {
    const latest = reefEvents[reefEvents.length - 1];
    if (latest?.type === 'reef_message' || latest?.type === 'reef_room_updated' || latest?.type === 'reef_block_changed') void loadData();
  }, [reefEvents, loadData]);

  const items = useMemo<ListItem[]>(() => {
    const all: ListItem[] = [
      ...conversations.map(data => ({ key: `chat-${data.userId || data.id}`, kind: 'chat' as const, data, important: !!data.important, importantAt: data.importantAt, activityTime: data.time })),
      ...reefRooms.map(data => ({ key: `reef-${data.id}`, kind: 'reef' as const, data, important: !!data.important, importantAt: data.importantAt, activityTime: data.latestMessage?.time || data.createdAt || data.importantAt || '' })),
      ...notificationRows.map(data => ({ key: `notification-${data.category}`, kind: 'notification' as const, data, important: false as const, activityTime: data.time })),
    ];
    return all.sort((a, b) => {
      if (a.important !== b.important) return a.important ? -1 : 1;
      const aTime = a.important && a.importantAt && a.importantAt > (a.activityTime || '') ? a.importantAt : a.activityTime || '';
      const bTime = b.important && b.importantAt && b.importantAt > (b.activityTime || '') ? b.importantAt : b.activityTime || '';
      return String(bTime).localeCompare(String(aTime));
    });
  }, [conversations, notificationRows, reefRooms]);

  const hideShortcut = async () => {
    if (!actionItem || actionItem.kind === 'notification') return;
    try {
      if (actionItem.kind === 'chat') await setConversationPreference(actionItem.data.userId, { hidden: true });
      else await setReefPreference(actionItem.data.id, { hidden: true });
      setActionItem(null);
      await loadData();
    } catch {}
  };

  const toggleImportant = async () => {
    if (!actionItem || actionItem.kind === 'notification') return;
    try {
      if (actionItem.kind === 'chat') await setConversationPreference(actionItem.data.userId, { important: !actionItem.important });
      else await setReefPreference(actionItem.data.id, { important: !actionItem.important });
      setActionItem(null);
      await loadData();
    } catch {}
  };

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await loadData();
    setRefreshing(false);
  }, [loadData]);

  return (
    <>
      {isNativeLiquidGlassEnabled ? (
        <View pointerEvents="box-none" style={[styles.glassHeaderOverlay, { top: insets.top + 7 }]}>
          <NativeLiquidGlassView
            glassEffectStyle="regular"
            colorScheme={isDark ? 'dark' : 'light'}
            isInteractive
            style={styles.glassMessageTitle}
          >
            <Text style={[styles.glassMessageTitleText, { color: colors.text }]}>消息</Text>
          </NativeLiquidGlassView>
          <NativeLiquidGlassView
            glassEffectStyle="regular"
            colorScheme={isDark ? 'dark' : 'light'}
            isInteractive
            style={styles.glassFavoritesButton}
          >
            <Pressable accessibilityLabel="查看收藏" hitSlop={8} style={styles.glassFavoritesPressable} onPress={() => router.push('/message-favorites' as any)}>
              <Ionicons name="bookmark" size={21} color={colors.accent} />
            </Pressable>
          </NativeLiquidGlassView>
        </View>
      ) : null}
      <FlatList
        data={items}
        keyExtractor={item => item.key}
        renderItem={({ item }) => {
          if (item.kind === 'chat') return <ConversationRow item={item.data} onLongPress={() => setActionItem(item)} />;
          if (item.kind === 'reef') return <ReefShareCard roomId={item.data.id} initialRoom={item.data} refreshOnEvents={false} onLongPress={() => setActionItem(item)} style={styles.listCard} />;
          return <NotificationRow item={item.data} />;
        }}
        showsVerticalScrollIndicator={false}
        refreshControl={<AppRefreshControl refreshing={refreshing} onRefresh={onRefresh} progressViewOffset={refreshIndicatorBelow(isNativeLiquidGlassEnabled ? insets.top + 49 : 0)} colors={[colors.accent]} tintColor={colors.accent} progressBackgroundColor={colors.card} />}
        contentContainerStyle={[styles.list, { paddingTop: isNativeLiquidGlassEnabled ? insets.top + 58 : 12, paddingBottom: Math.max(insets.bottom + 104, 112) }]}
        ItemSeparatorComponent={() => <View style={styles.itemSeparator} />}
        initialNumToRender={12}
        maxToRenderPerBatch={8}
        windowSize={7}
        removeClippedSubviews
        ListEmptyComponent={loading ? <ActivityIndicator size="large" color={colors.accent} style={{ marginTop: 60 }} /> : <Text style={[styles.empty, { color: colors.textMuted }]}>暂无消息</Text>}
      />
      <ShortcutActionsModal
        visible={!!actionItem && actionItem.kind !== 'notification'}
        kind={actionItem?.kind === 'reef' ? 'reef' : 'chat'}
        important={!!actionItem?.important}
        onClose={() => setActionItem(null)}
        onHide={() => void hideShortcut()}
        onToggleImportant={() => void toggleImportant()}
      />
    </>
  );
}

const styles = StyleSheet.create({
  list: { padding: 12, flexGrow: 1, paddingBottom: 112 },
  glassHeaderOverlay: { position: 'absolute', left: 0, right: 0, height: 42, zIndex: 320, elevation: 320, alignItems: 'center', justifyContent: 'center' },
  glassMessageTitle: { width: 108, height: 36, borderRadius: 18, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  glassMessageTitleText: { width: '100%', fontSize: 17, lineHeight: 22, fontWeight: '600', textAlign: 'center', textAlignVertical: 'center', includeFontPadding: false },
  glassFavoritesButton: { position: 'absolute', right: 11, top: 1, width: 40, height: 40, borderRadius: 20, overflow: 'hidden' },
  glassFavoritesPressable: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerButton: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  card: { minHeight: 72, flexDirection: 'row', alignItems: 'center', borderRadius: 8, padding: 12, position: 'relative' },
  listCard: { marginTop: 0 },
  itemSeparator: { height: 8 },
  avatar: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  avatarImg: { width: 48, height: 48, borderRadius: 24 },
  avatarText: { color: '#FFFFFF', fontSize: 18, fontWeight: '600' },
  rowBody: { flex: 1, minWidth: 0, marginLeft: 12 },
  conversationRowBody: { flex: 1, minWidth: 0, marginLeft: 12, marginRight: 74 },
  badge: { position: 'absolute', top: -2, right: -2, minWidth: 20, height: 20, borderRadius: 10, backgroundColor: '#E84393', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  badgeText: { color: '#FFFFFF', fontSize: 10, fontWeight: '700' },
  topLine: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  name: { flex: 1, minWidth: 0, fontSize: 15, fontWeight: '600' },
  timeSlot: { position: 'absolute', right: 12, top: 0, bottom: 0, width: 66, alignItems: 'flex-end', justifyContent: 'center' },
  time: { width: 66, fontSize: 11, lineHeight: 14, textAlign: 'right', textAlignVertical: 'center', includeFontPadding: false },
  previewRow: { alignSelf: 'stretch', minWidth: 0, flexDirection: 'row', alignItems: 'center', marginTop: 3 },
  conversationPreview: { flexShrink: 1, minWidth: 0, fontSize: 13 },
  preview: { flex: 1, minWidth: 0, fontSize: 13, marginTop: 3 },
  bookmark: { position: 'absolute', right: 12, top: 9 },
  blueDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: '#33A9DC', marginLeft: 6 },
  empty: { textAlign: 'center', marginTop: 60 },
});
