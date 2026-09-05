import { useCallback, useEffect, useState } from 'react';
import { StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { getReefCard, getReefRooms } from '@/api/client';
import { Pressable } from '@/components/pressable';
import { useWs } from '@/contexts/ws';
import { useTheme } from '@/lib/theme';

export type ReefRoomSummary = {
  id: string;
  name: string;
  color?: string;
  number?: number | null;
  currentCount?: number;
  latestMessage?: { sender?: string; content?: string; time?: string } | null;
  unread?: number;
  important?: boolean;
  importantAt?: string | null;
  status?: 'active' | 'destroyed';
};

export function ReefShareCard({ roomId, initialRoom, onPress, onLongPress, refreshOnEvents = true, style }: {
  roomId: string;
  initialRoom?: ReefRoomSummary | null;
  onPress?: (room: ReefRoomSummary) => void;
  onLongPress?: (room: ReefRoomSummary) => void;
  refreshOnEvents?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const router = useRouter();
  const { colors } = useTheme();
  const { reefEvents } = useWs();
  const [room, setRoom] = useState<ReefRoomSummary | null>(initialRoom || null);

  const loadRoom = useCallback(async () => {
    try {
      const data = await getReefRooms();
      let next = (data.rooms || []).find((item: ReefRoomSummary) => item.id === roomId);
      if (!next) next = (await getReefCard(roomId))?.room;
      if (next) setRoom(current => ({
        ...(current || {}),
        ...next,
        important: typeof next.important === 'boolean' ? next.important : current?.important,
        importantAt: next.importantAt ?? current?.importantAt ?? null,
      } as ReefRoomSummary));
    } catch {}
  }, [roomId]);

  useEffect(() => {
    if (!initialRoom) void loadRoom();
  }, [initialRoom, loadRoom]);
  useEffect(() => {
    if (!initialRoom) return;
    setRoom(current => ({ ...(current || {}), ...initialRoom } as ReefRoomSummary));
  }, [initialRoom]);
  useEffect(() => {
    const latest = reefEvents[reefEvents.length - 1];
    if (!refreshOnEvents) return;
    if (latest?.roomId === roomId || latest?.type === 'reef_block_changed') void loadRoom();
  }, [loadRoom, reefEvents, refreshOnEvents, roomId]);

  if (!room) return null;
  const destroyed = room.status === 'destroyed';
  const accent = room.color || colors.accent;
  const open = () => {
    if (onPress) onPress(room);
    else router.push({ pathname: '/reef/[id]', params: { id: room.id, name: room.name, color: accent, number: room.number ? String(room.number) : '', status: room.status || 'active' } });
  };

  return (
    <Pressable
      style={[s.card, { backgroundColor: accent + '10', borderColor: accent + '45' }, style]}
      onPress={(event) => { event.stopPropagation(); open(); }}
      onLongPress={(event) => { event.stopPropagation(); onLongPress?.(room); }}
    >
      <View style={[s.icon, { backgroundColor: accent + '20' }]}>
        <Text style={[s.iconText, { color: accent }]}>{destroyed ? '礁' : room.name?.trim()?.[0] || '礁'}</Text>
      </View>
      <View style={s.body}>
        <View style={s.titleRow}>
          <Text style={[s.name, { color: destroyed ? colors.textMuted : colors.text }]} numberOfLines={1}>
            {destroyed ? '该礁石已被摧毁' : room.number ? `#${room.number} ${room.name}` : room.name}
          </Text>
        </View>
        {!destroyed && <View style={s.previewRow}>
          <Text style={[s.preview, { color: colors.textMuted }]} numberOfLines={1}>
            {room.latestMessage ? `${room.latestMessage.sender || ''}：${room.latestMessage.content || ''}` : '这里还很安静，来聊聊吧'}
          </Text>
          {(room.unread || 0) > 0 && <View style={[s.unreadDot, { backgroundColor: accent }]} />}
        </View>}
      </View>
      {room.important && <Ionicons name="bookmark" size={14} color={accent} style={s.bookmark} />}
      {!destroyed && <View style={s.trailing}>
        <View style={s.countRow}>
          <Ionicons name="people-outline" size={13} color={accent} />
          <Text style={[s.count, { color: accent }]}>{room.currentCount || 0}</Text>
        </View>
      </View>}
    </Pressable>
  );
}

const s = StyleSheet.create({
  card: { minHeight: 72, borderWidth: 1, borderRadius: 8, padding: 12, flexDirection: 'row', alignItems: 'center', marginTop: 10, position: 'relative' },
  icon: { width: 48, height: 48, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  iconText: { fontSize: 17, fontWeight: '800' },
  body: { flex: 1, minWidth: 0, marginLeft: 12 },
  titleRow: { flexDirection: 'row', alignItems: 'center' },
  name: { flex: 1, minWidth: 0, fontSize: 14, fontWeight: '700' },
  countRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  count: { fontSize: 12, fontWeight: '700' },
  previewRow: { alignSelf: 'stretch', minWidth: 0, flexDirection: 'row', alignItems: 'center', marginTop: 4 },
  preview: { flexShrink: 1, minWidth: 0, fontSize: 12, lineHeight: 17 },
  unreadDot: { width: 7, height: 7, borderRadius: 4, marginLeft: 6 },
  trailing: { flexDirection: 'row', alignItems: 'center', gap: 8, marginLeft: 8 },
  bookmark: { position: 'absolute', top: 8, right: 10 },
});
