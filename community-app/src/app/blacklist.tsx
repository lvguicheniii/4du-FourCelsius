import { useState } from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { Pressable } from '@/components/pressable';
import { ScreenHeader } from '@/components/screen-header';
import { Ionicons } from '@expo/vector-icons';
import { setBlocked } from '@/data/store';
import { useThemedStyle } from '@/lib/use-themed-style';
import type { ThemeColors } from '@/lib/theme';
import { useTheme } from '@/lib/theme';
import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { getBlockedUsers, setUserBlocked } from '@/api/client';

type BlockedUser = { id: string; nickname?: string; username?: string; avatar?: string | null };

export default function BlacklistScreen() {
  const { colors } = useTheme();
  const [users, setUsers] = useState<BlockedUser[]>([]);

  useFocusEffect(useCallback(() => {
    getBlockedUsers().then((data) => {
      const next = data.users || [];
      setUsers(next);
      next.forEach((item: BlockedUser) => setBlocked(item.nickname || item.username || '', true));
    }).catch(() => {});
  }, []));

  const handleUnblock = async (item: BlockedUser) => {
    await setUserBlocked(item.id, false);
    const name = item.nickname || item.username || '';
    setBlocked(name, false);
    setUsers((current) => current.filter((user) => user.id !== item.id));
  };

  const S = useThemedStyle((c) => StyleSheet.create({
    container: { padding: 12, backgroundColor: c.bg, flexGrow: 1 },
    row: {
      flexDirection: 'row' as const,
      alignItems: 'center' as const,
      backgroundColor: c.card,
      borderRadius: 14,
      padding: 14,
      marginBottom: 10,
    },
    name: { flex: 1, fontSize: 15, fontWeight: '600' as const, color: c.text, marginLeft: 12 },
  }));

  return (
    <>
      <ScreenHeader title="黑名单管理" />
    <FlatList
      data={users}
      extraData={users.length}
      keyExtractor={(item) => item.id}
      contentContainerStyle={S.container}
      showsVerticalScrollIndicator={false}
      ListEmptyComponent={
        <View style={styles.emptyWrap}>
          <Ionicons name="shield-checkmark-outline" size={44} color={colors.textMuted} />
          <Text style={[styles.emptyText, { color: colors.textMuted }]}>黑名单是空的</Text>
        </View>
      }
      renderItem={({ item }) => {
        const name = item.nickname || item.username || '';
        return (
        <View style={S.row}>
          <View style={[styles.avatar, { backgroundColor: '#888780' }]}>
            <Text style={styles.avatarText}>{name[0]}</Text>
          </View>
          <Text style={S.name}>{name}</Text>
          <Pressable style={styles.unblockBtn} onPress={() => handleUnblock(item)}>
            <Text style={styles.unblockText}>解除拉黑</Text>
          </Pressable>
        </View>
      );}}
    />
    </>
  );
}

const styles = StyleSheet.create({
  avatar: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  avatarText: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
  unblockBtn: { borderWidth: 1, borderColor: '#33A9DC', borderRadius: 16, paddingHorizontal: 14, paddingVertical: 6 },
  unblockText: { fontSize: 13, color: '#33A9DC', fontWeight: '500' },
  emptyWrap: { alignItems: 'center', marginTop: 80 },
  emptyText: { fontSize: 13, marginTop: 10 },
});
