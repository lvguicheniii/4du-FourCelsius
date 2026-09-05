import { useCallback, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { Pressable } from '@/components/pressable';
import { ScreenHeader } from '@/components/screen-header';
import { Alert } from '@/components/app-alert';
import { createSliceBox, getSliceBoxes, type SliceBox } from '@/api/client';
import { useAuth } from '@/contexts/auth';
import { useTheme } from '@/lib/theme';

export default function SliceBoxesScreen() {
  const router = useRouter();
  const { mode } = useLocalSearchParams<{ mode?: string }>();
  const selecting = mode === 'select';
  const { token } = useAuth();
  const { colors } = useTheme();
  const [boxes, setBoxes] = useState<SliceBox[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');

  const load = useCallback(async () => {
    if (!token) {
      setLoading(false);
      router.replace('/login');
      return;
    }
    try {
      const result = await getSliceBoxes();
      setBoxes(result.boxes || []);
    } catch (error: any) {
      Alert.alert('加载失败', error?.message || '切片盒暂时无法打开');
    } finally {
      setLoading(false);
    }
  }, [router, token]);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const submit = async () => {
    const nextName = name.trim();
    if (!nextName) return;
    setCreating(true);
    try {
      const box = await createSliceBox(nextName);
      setBoxes(current => [box, ...current]);
      setName('');
      setCreateOpen(false);
    } catch (error: any) {
      Alert.alert('新建失败', error?.message || '请稍后重试');
    } finally {
      setCreating(false);
    }
  };

  const openBox = (box: SliceBox) => {
    if (selecting) {
      router.dismissTo({
        pathname: '/publish',
        params: {
          selectedSliceBoxId: box.id,
          selectedSliceBoxName: box.name,
          sliceBoxSelection: Date.now().toString(),
        },
      });
      return;
    }
    router.push({ pathname: '/slice-box/[id]' as any, params: { id: box.id, name: box.name } });
  };

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <ScreenHeader floating floatingSpacer={68}
        title={selecting ? '选择切片盒' : '切片盒'}
        rightWidth={58}
        right={(
          <Pressable accessibilityLabel="新建切片盒" style={styles.newButton} onPress={() => setCreateOpen(true)}>
            <Text style={[styles.newText, { color: colors.accent }]} numberOfLines={1}>新建</Text>
          </Pressable>
        )}
      />
      {loading ? (
        <ActivityIndicator size="large" color={colors.accent} style={styles.loading} />
      ) : (
        <FlatList
          data={boxes}
          numColumns={2}
          keyExtractor={item => item.id}
          contentContainerStyle={[styles.list, boxes.length === 0 && styles.emptyList]}
          columnWrapperStyle={boxes.length ? styles.row : undefined}
          renderItem={({ item }) => (
            <Pressable
              accessibilityRole="button"
              style={[styles.boxCard, { backgroundColor: colors.card, borderColor: colors.divider }]}
              onPress={() => openBox(item)}
            >
              <View style={[styles.boxIcon, { backgroundColor: colors.accent + '18' }]}>
                <Text style={[styles.boxIconText, { color: colors.accent }]}>{Array.from(item.name)[0] || '盒'}</Text>
              </View>
              <View style={styles.boxInfo}>
                <Text style={[styles.boxName, { color: colors.text }]} numberOfLines={1}>{item.name}</Text>
                <Text style={[styles.boxCount, { color: colors.textMuted }]}>{item.postCount} 份切片</Text>
              </View>
            </Pressable>
          )}
          ListEmptyComponent={(
            <View style={styles.empty}>
              <Ionicons name="file-tray-stacked-outline" size={42} color={colors.textMuted} />
              <Text style={[styles.emptyTitle, { color: colors.text }]}>还没有切片盒</Text>
              <Text style={[styles.emptyText, { color: colors.textMuted }]}>点击右上角新建一个</Text>
            </View>
          )}
        />
      )}

      <Modal visible={createOpen} transparent animationType="fade" onRequestClose={() => !creating && setCreateOpen(false)}>
        <Pressable style={styles.overlay} onPress={() => !creating && setCreateOpen(false)}>
          <Pressable style={[styles.dialog, { backgroundColor: colors.card }]} onPress={() => {}}>
            <View style={styles.dialogHeading}>
              <View style={[styles.dialogIcon, { backgroundColor: colors.accent + '18' }]}>
                <Ionicons name="file-tray-stacked-outline" size={22} color={colors.accent} />
              </View>
              <Text style={[styles.dialogTitle, { color: colors.text }]}>新建切片盒</Text>
            </View>
            <TextInput
              autoFocus
              value={name}
              onChangeText={setName}
              maxLength={8}
              placeholder="输入名称，最多 8 个字"
              placeholderTextColor={colors.textMuted}
              style={[styles.input, { color: colors.text, backgroundColor: colors.input, borderColor: colors.divider }]}
              returnKeyType="done"
              onSubmitEditing={submit}
            />
            <Text style={[styles.counter, { color: colors.textMuted }]}>{Array.from(name).length}/8</Text>
            <View style={styles.dialogActions}>
              <Pressable style={styles.dialogButton} disabled={creating} onPress={() => setCreateOpen(false)}>
                <Text style={[styles.cancelText, { color: colors.textMuted }]}>取消</Text>
              </Pressable>
              <Pressable style={[styles.dialogButton, styles.confirmButton, { backgroundColor: colors.accent }, !name.trim() && styles.disabled]} disabled={creating || !name.trim()} onPress={submit}>
                {creating ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Text style={styles.confirmText}>新建</Text>}
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  newButton: { minWidth: 44, height: 36, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
  newText: { minWidth: 30, fontSize: 13, lineHeight: 18, fontWeight: '600', textAlign: 'center' },
  loading: { marginTop: 80 },
  list: { padding: 12, paddingBottom: 32 },
  emptyList: { flexGrow: 1 },
  row: { justifyContent: 'space-between', marginBottom: 9 },
  boxCard: { width: '48.6%', height: 78, flexDirection: 'row', alignItems: 'center', borderWidth: StyleSheet.hairlineWidth, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 9 },
  boxIcon: { width: 38, height: 38, flexShrink: 0, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginRight: 9 },
  boxIconText: { fontSize: 17, lineHeight: 22, fontWeight: '700' },
  boxInfo: { flex: 1, minWidth: 0, justifyContent: 'center' },
  boxName: { fontSize: 14, lineHeight: 20, fontWeight: '600' },
  boxCount: { fontSize: 10, lineHeight: 15, marginTop: 1 },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 60 },
  emptyTitle: { fontSize: 15, fontWeight: '600', marginTop: 12 },
  emptyText: { fontSize: 12, marginTop: 5 },
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.42)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  dialog: { width: '100%', maxWidth: 360, borderRadius: 8, padding: 18 },
  dialogHeading: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 },
  dialogIcon: { width: 38, height: 38, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  dialogTitle: { fontSize: 16, fontWeight: '600' },
  input: { height: 46, borderWidth: 1, borderRadius: 8, paddingHorizontal: 12, fontSize: 15 },
  counter: { alignSelf: 'flex-end', fontSize: 10, marginTop: 5 },
  dialogActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 14 },
  dialogButton: { minWidth: 72, height: 38, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  confirmButton: { paddingHorizontal: 18 },
  cancelText: { fontSize: 13, fontWeight: '600' },
  confirmText: { color: '#FFFFFF', fontSize: 13, fontWeight: '600' },
  disabled: { opacity: 0.45 },
});
