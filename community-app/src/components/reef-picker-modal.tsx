import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Modal, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { createReefRoom, getMyReefRooms } from '@/api/client';
import { Pressable } from '@/components/pressable';
import { ReefRoomSummary, ReefShareCard } from '@/components/reef-share-card';
import { useTheme } from '@/lib/theme';
import { ReefCreationFields, normalizeReefNumber } from '@/components/reef-creation-fields';

export function ReefPickerModal({ visible, onClose, onSelect }: {
  visible: boolean;
  onClose: () => void;
  onSelect: (room: ReefRoomSummary) => void;
}) {
  const { colors } = useTheme();
  const [rooms, setRooms] = useState<ReefRoomSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState('');
  const [capacity, setCapacity] = useState('30');
  const [duration, setDuration] = useState('24');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getMyReefRooms();
      setRooms(data?.rooms || []);
    } catch { setError('礁石列表加载失败，请稍后重试'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    if (!visible) return;
    setError('');
    void load();
  }, [load, visible]);

  const create = async () => {
    const cleanName = name.trim();
    if (cleanName.length < 2 || saving) {
      setError('礁石名称至少需要两个字');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const room = await createReefRoom(
        cleanName,
        normalizeReefNumber(capacity, 2, 30),
        normalizeReefNumber(duration, 1, 24),
      );
      setRooms(current => [room, ...current.filter(item => item.id !== room.id)]);
      setCreating(false);
      setName('');
      setCapacity('30');
      setDuration('24');
      onSelect(room);
      onClose();
    } catch (cause: any) {
      setError(cause?.message || '创建失败，请稍后重试');
    } finally { setSaving(false); }
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose}>
        <Pressable style={[s.sheet, { backgroundColor: colors.card }]} onPress={(event) => event.stopPropagation()}>
          <View style={s.header}>
            <Pressable style={s.headerButton} onPress={creating ? () => { setCreating(false); setError(''); } : onClose}>
              <Ionicons name={creating ? 'chevron-back' : 'close'} size={23} color={colors.text} />
            </Pressable>
            <Text style={[s.title, { color: colors.text }]}>{creating ? '创建领海礁石' : '选择礁石'}</Text>
            <Pressable style={s.headerButton} onPress={() => { setCreating(true); setError(''); }} disabled={creating}>
              {!creating && <Ionicons name="add-circle-outline" size={24} color={colors.accent} />}
            </Pressable>
          </View>

          {creating ? (
            <View style={s.form}>
              <View style={[s.formIntro, { borderBottomColor: colors.divider }]}>
                <View style={[s.formIcon, { backgroundColor: colors.accent + '18' }]}>
                  <Ionicons name="shield-half-outline" size={22} color={colors.accent} />
                </View>
                <View style={s.formIntroText}>
                  <Text style={[s.formTitle, { color: colors.text }]}>设置礁石参数</Text>
                  <Text style={[s.formHint, { color: colors.textMuted }]}>创建后会随切片一起发布</Text>
                </View>
              </View>
              <ReefCreationFields
                name={name}
                capacity={capacity}
                duration={duration}
                onNameChange={setName}
                onCapacityChange={setCapacity}
                onDurationChange={setDuration}
              />
              {!!error && <Text style={s.error}>{error}</Text>}
              <Pressable style={[s.createButton, { backgroundColor: colors.accent }]} onPress={create} disabled={saving}>
                {saving ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Text style={s.createText}>创建并插入切片</Text>}
              </Pressable>
            </View>
          ) : loading ? (
            <ActivityIndicator size="large" color={colors.accent} style={s.loading} />
          ) : (
            <FlatList
              data={rooms}
              keyExtractor={item => item.id}
              contentContainerStyle={s.list}
              ListEmptyComponent={<View style={s.empty}><Ionicons name="layers-outline" size={36} color={colors.textMuted} /><Text style={[s.emptyText, { color: colors.textMuted }]}>暂无参与过的礁石</Text></View>}
              renderItem={({ item }) => <ReefShareCard roomId={item.id} initialRoom={item} onPress={(room) => { onSelect(room); onClose(); }} />}
            />
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const s = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center', padding: 18 },
  sheet: { width: '100%', maxWidth: 520, height: '72%', borderRadius: 8, overflow: 'hidden' },
  header: { height: 54, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6 },
  headerButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, textAlign: 'center', fontSize: 17, fontWeight: '800' },
  list: { paddingHorizontal: 12, paddingBottom: 18 },
  loading: { marginTop: 90 },
  empty: { alignItems: 'center', marginTop: 84 },
  emptyText: { fontSize: 13, marginTop: 9 },
  form: { paddingHorizontal: 18, paddingBottom: 18 },
  formIntro: { flexDirection: 'row', alignItems: 'center', paddingVertical: 16, marginBottom: 18, borderBottomWidth: StyleSheet.hairlineWidth },
  formIcon: { width: 40, height: 40, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  formIntroText: { flex: 1, minWidth: 0, marginLeft: 11 },
  formTitle: { fontSize: 14, fontWeight: '700' },
  formHint: { fontSize: 11, marginTop: 3 },
  error: { color: '#E05260', fontSize: 12, marginTop: 10 },
  createButton: { height: 46, borderRadius: 8, alignItems: 'center', justifyContent: 'center', marginTop: 18 },
  createText: { color: '#FFFFFF', fontSize: 14, fontWeight: '800' },
});
