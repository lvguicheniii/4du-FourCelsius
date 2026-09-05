import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, FlatList, Modal, Platform, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createReefRoom, getReefRooms, submitPublicReefApplication } from '@/api/client';
import { Pressable } from '@/components/pressable';
import { GenderSymbol } from '@/components/gender-badge';
import { useTheme } from '@/lib/theme';
import { useWs } from '@/contexts/ws';
import { useAuth } from '@/contexts/auth';
import PagerView from 'react-native-pager-view';
import { ReefCreationFields, normalizeReefNumber } from '@/components/reef-creation-fields';
import { RedLineLink, RedLineModal } from '@/components/red-line-modal';
import { isNativeLiquidGlassEnabled, NativeLiquidGlassView } from '@/components/liquid-glass';
import { Alert } from '@/components/app-alert';
import { AppRefreshControl, refreshIndicatorBelow } from '@/components/app-refresh-control';

type ReefZone = 'public' | 'private';
type ReefMember = { userId: string; nickname: string; gender?: string };
type ReefRoom = {
  id: string; zone: ReefZone; number?: number | null; name: string; color: string;
  capacity: number; currentCount: number; members: ReefMember[];
  latestMessage?: { sender: string; content: string; time: string } | null;
};

function RoomCard({ room, onPress }: { room: ReefRoom; onPress: () => void }) {
  const { colors, isDark } = useTheme();
  const visibleMembers = (room.members || []).slice(0, 5);
  return (
    <Pressable onPress={onPress} style={[s.card, { backgroundColor: room.color + (isDark ? '32' : '1F'), borderColor: room.color + '70' }]}>
      <View style={s.cardTop}>
        <Text style={[s.number, { color: room.color }]}>{room.number ? `#${room.number}` : '领海'}</Text>
        <View style={[s.countPill, { backgroundColor: room.color + '24' }]}>
          <Ionicons name="people" size={13} color={room.color} />
          <Text style={[s.count, { color: room.color }]}>{room.currentCount}/{room.capacity}</Text>
        </View>
      </View>
      <Text style={[s.roomName, { color: colors.text }]} numberOfLines={1}>{room.name}</Text>
      <View style={s.memberRow}>
        {visibleMembers.length ? visibleMembers.map((member, index) => (
          <View key={member.userId} style={[s.genderDot, { marginLeft: index ? -3 : 0, borderColor: colors.card }]}>
            {member.gender === 'male' || member.gender === 'female' ? (
              <GenderSymbol
                gender={member.gender}
                size={14}
                color={member.gender === 'female' ? '#EC85B5' : '#58AEE8'}
              />
            ) : (
              <Ionicons name="person" size={12} color={colors.textMuted} />
            )}
          </View>
        )) : <Text style={[s.emptyMembers, { color: colors.textMuted }]}>目前空无一人</Text>}
        {room.currentCount > visibleMembers.length && <Text style={[s.more, { color: colors.textMuted }]}>+{room.currentCount - visibleMembers.length}</Text>}
      </View>
      <View style={[s.latest, { borderTopColor: room.color + '35' }]}>
        <Ionicons name="chatbubble-ellipses-outline" size={14} color={room.color} />
        <Text style={[s.latestText, { color: colors.textMuted }]} numberOfLines={1}>
          {room.latestMessage ? `${room.latestMessage.sender}：${room.latestMessage.content}` : '海面很安静，来发第一句话吧'}
        </Text>
      </View>
    </Pressable>
  );
}

export default function HiddenReefScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const { colors, isDark } = useTheme();
  const { token } = useAuth();
  const { lastReefEvent, connectionVersion } = useWs();
  const [zone, setZone] = useState<ReefZone>('public');
  const [rooms, setRooms] = useState<ReefRoom[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [reefRulesOpen, setReefRulesOpen] = useState(false);
  const [redLineOpen, setRedLineOpen] = useState(false);
  const [roomName, setRoomName] = useState('');
  const [roomCapacity, setRoomCapacity] = useState('30');
  const [roomDuration, setRoomDuration] = useState('24');
  const [createError, setCreateError] = useState('');
  const [creating, setCreating] = useState(false);
  const [applicationOpen, setApplicationOpen] = useState(false);
  const [applicationName, setApplicationName] = useState('');
  const [applicationReason, setApplicationReason] = useState('');
  const [applicationError, setApplicationError] = useState('');
  const [applicationSubmitting, setApplicationSubmitting] = useState(false);
  const [segmentWidth, setSegmentWidth] = useState(0);
  const [scrollMetricsByZone, setScrollMetricsByZone] = useState<Record<ReefZone, { y: number; content: number; viewport: number }>>({
    public: { y: 0, content: 0, viewport: 0 },
    private: { y: 0, content: 0, viewport: 0 },
  });
  const [scrollIndicatorVisible, setScrollIndicatorVisible] = useState(false);
  const scrollIndicatorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const segmentProgress = useRef(new Animated.Value(zone === 'private' ? 1 : 0)).current;
  const pagerRef = useRef<PagerView>(null);
  const scrollMetrics = scrollMetricsByZone[zone];
  const floatingSegmentTop = Platform.OS === 'android' ? insets.top + 78 : 140;
  const floatingListTop = Platform.OS === 'android' ? floatingSegmentTop + 58 : insets.top + 140;

  const revealScrollIndicator = useCallback(() => {
    setScrollIndicatorVisible(true);
    if (scrollIndicatorTimerRef.current) clearTimeout(scrollIndicatorTimerRef.current);
    scrollIndicatorTimerRef.current = setTimeout(() => setScrollIndicatorVisible(false), 750);
  }, []);

  useEffect(() => () => {
    if (scrollIndicatorTimerRef.current) clearTimeout(scrollIndicatorTimerRef.current);
  }, []);

  useEffect(() => {
    Animated.spring(segmentProgress, {
      toValue: zone === 'private' ? 1 : 0,
      mass: 0.55,
      stiffness: 280,
      damping: 24,
      useNativeDriver: true,
    }).start();
  }, [segmentProgress, zone]);

  const loadRooms = useCallback(async (quiet = false) => {
    if (!quiet) setRefreshing(true);
    try {
      const data = await getReefRooms();
      setRooms(data.rooms || []);
    } catch {} finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [token]);

  useFocusEffect(useCallback(() => { void loadRooms(true); }, [loadRooms]));
  useEffect(() => { if (lastReefEvent || connectionVersion > 0) void loadRooms(true); }, [lastReefEvent?._seq, connectionVersion]);

  const switchZone = useCallback((nextZone: ReefZone) => {
    setZone(nextZone);
    pagerRef.current?.setPage(nextZone === 'public' ? 0 : 1);
  }, []);
  const createRoom = async () => {
    if (creating) return;
    if (roomName.trim().length < 2) {
      setCreateError('礁石名称至少需要两个字');
      return;
    }
    setCreateError('');
    setCreating(true);
    try {
      const room = await createReefRoom(
        roomName.trim(),
        normalizeReefNumber(roomCapacity, 2, 30),
        normalizeReefNumber(roomDuration, 1, 24),
      );
      setCreateOpen(false);
      setRoomName('');
      setRoomCapacity('30');
      setRoomDuration('24');
      await loadRooms(true);
      router.push({ pathname: '/reef/[id]' as any, params: { id: room.id, name: room.name, color: room.color } });
    } catch (error: any) {
      setCreateError(error?.message || '创建失败，请重试');
    } finally { setCreating(false); }
  };

  const openPublicApplication = () => {
    if (!token) { router.push('/login'); return; }
    setApplicationError('');
    setApplicationOpen(true);
  };

  const submitApplication = async () => {
    const nextName = applicationName.trim();
    const nextReason = applicationReason.trim();
    if (nextName.length < 2) return setApplicationError('公海礁石名称至少需要两个字');
    if (!nextReason) return setApplicationError('请填写申请理由');
    setApplicationSubmitting(true);
    setApplicationError('');
    try {
      await submitPublicReefApplication(nextName, nextReason);
      setApplicationOpen(false);
      setApplicationName('');
      setApplicationReason('');
      Alert.alert('提交成功', '申请已提交给肆度管理团队。');
    } catch (error: any) {
      setApplicationError(error?.message || '提交失败，请稍后重试');
    } finally {
      setApplicationSubmitting(false);
    }
  };

  const segmentButtons = () => (['public', 'private'] as ReefZone[]).map(item => {
    const active = zone === item;
    return <Pressable
      key={item}
      style={s.segmentBtn}
      onPress={() => switchZone(item)}
    >
      <Ionicons name={item === 'public' ? 'earth-outline' : 'shield-half-outline'} size={16} color={active ? colors.accent : colors.textMuted} />
      <Text style={[s.segmentText, { color: active ? colors.accent : colors.textMuted }]}>{item === 'public' ? '公海' : '领海'}</Text>
    </Pressable>;
  });

  return (
    <View style={[s.page, { backgroundColor: colors.bg }]}>
      <View style={[s.header, isNativeLiquidGlassEnabled && s.floatingHeader, { paddingTop: insets.top + 8 }]}>
        {isNativeLiquidGlassEnabled ? (
          <NativeLiquidGlassView
            glassEffectStyle="regular"
            colorScheme={isDark ? 'dark' : 'light'}
            isInteractive
            style={s.glassTitleGroup}
          >
            <Text style={[s.title, { color: colors.text }]}>隐海礁</Text>
            <Text style={[s.subtitle, { color: colors.textMuted }]}>海面之下，声音在礁石间相遇</Text>
          </NativeLiquidGlassView>
        ) : (
          <View style={s.titleGroup}>
            <Text style={[s.title, { color: colors.text }]}>隐海礁</Text>
            <Text style={[s.subtitle, { color: colors.textMuted }]}>海面之下，声音在礁石间相遇</Text>
          </View>
        )}
        {isNativeLiquidGlassEnabled ? (
          <NativeLiquidGlassView
            glassEffectStyle="regular"
            colorScheme={isDark ? 'dark' : 'light'}
            isInteractive
            style={[s.glassCreateButton, { top: insets.top + 16 }]}
          >
            <Pressable style={s.glassCreatePressable} onPress={zone === 'public' ? openPublicApplication : () => {
              if (!token) { router.push('/login'); return; }
              setCreateOpen(true);
            }}>
              <Ionicons name={zone === 'public' ? 'document-text-outline' : 'add'} size={21} color={colors.accent} />
            </Pressable>
          </NativeLiquidGlassView>
        ) : (
          <Pressable style={[s.headerBtn, { top: insets.top + 16 }]} onPress={zone === 'public' ? openPublicApplication : () => {
            if (!token) { router.push('/login'); return; }
            setCreateOpen(true);
        }}><Ionicons name={zone === 'public' ? 'document-text-outline' : 'add-circle-outline'} size={23} color={colors.accent} /></Pressable>
        )}
      </View>
      {isNativeLiquidGlassEnabled ? (
        <NativeLiquidGlassView
          glassEffectStyle="regular"
          colorScheme={isDark ? 'dark' : 'light'}
          isInteractive
          style={[s.glassSegment, s.floatingSegment, { top: floatingSegmentTop }]}
          onLayout={event => {
            const width = event.nativeEvent?.layout?.width;
            if (typeof width === 'number' && Number.isFinite(width) && width > 0) setSegmentWidth(width);
          }}
        >
          {segmentWidth > 0 ? (
            <Animated.View
              pointerEvents="none"
              style={[
                s.glassSegmentBubbleMotion,
                { width: (segmentWidth - 8) / 2, transform: [{ translateX: segmentProgress.interpolate({ inputRange: [0, 1], outputRange: [0, (segmentWidth - 8) / 2] }) }] },
              ]}
            >
              <NativeLiquidGlassView glassEffectStyle="clear" colorScheme={isDark ? 'dark' : 'light'} style={s.glassSegmentBubble} />
            </Animated.View>
          ) : null}
          {segmentButtons()}
        </NativeLiquidGlassView>
      ) : (
        <View style={[s.segment, { backgroundColor: isDark ? '#20242E' : '#E9ECF2' }]}>
          {segmentButtons()}
        </View>
      )}
      {loading ? <ActivityIndicator color={colors.accent} style={{ marginTop: 80 }} /> : (
        <PagerView
          ref={pagerRef}
          style={s.pager}
          initialPage={0}
          onPageSelected={(event) => setZone(event.nativeEvent.position === 0 ? 'public' : 'private')}
        >
          {(['public', 'private'] as ReefZone[]).map(pageZone => (
            <View key={pageZone} style={{ backgroundColor: colors.bg }}>
              <FlatList
                data={rooms.filter(room => room.zone === pageZone).sort((a, b) => b.currentCount - a.currentCount || String(a.name).localeCompare(String(b.name), 'zh-CN'))}
                keyExtractor={item => item.id}
                numColumns={2}
                columnWrapperStyle={s.cardRow}
                renderItem={({ item }) => <RoomCard room={item} onPress={() => {
                  if (!token) { router.push('/login'); return; }
                  router.push({ pathname: '/reef/[id]' as any, params: { id: item.id, name: item.name, color: item.color, number: item.number ? String(item.number) : '' } });
                }} />}
                contentContainerStyle={[s.list, { paddingTop: isNativeLiquidGlassEnabled ? floatingListTop : 0, paddingBottom: Math.max(insets.bottom + 104, 112) }]}
                onScroll={event => {
                  revealScrollIndicator();
                  const offsetY = event.nativeEvent?.contentOffset?.y;
                  if (typeof offsetY === 'number' && Number.isFinite(offsetY)) {
                    setScrollMetricsByZone(current => ({ ...current, [pageZone]: { ...current[pageZone], y: Math.max(0, offsetY) } }));
                  }
                }}
                onScrollBeginDrag={revealScrollIndicator}
                onScrollEndDrag={revealScrollIndicator}
                onMomentumScrollBegin={revealScrollIndicator}
                onMomentumScrollEnd={revealScrollIndicator}
                onContentSizeChange={(_, height) => {
                  if (typeof height === 'number' && Number.isFinite(height) && height > 0) {
                    setScrollMetricsByZone(current => ({ ...current, [pageZone]: { ...current[pageZone], content: height } }));
                  }
                }}
                onLayout={event => {
                  const height = event.nativeEvent?.layout?.height;
                  if (typeof height === 'number' && Number.isFinite(height) && height > 0) {
                    setScrollMetricsByZone(current => ({ ...current, [pageZone]: { ...current[pageZone], viewport: height } }));
                  }
                }}
                scrollEventThrottle={16}
                showsVerticalScrollIndicator={false}
                refreshControl={<AppRefreshControl refreshing={refreshing && zone === pageZone} onRefresh={() => loadRooms(false)} progressViewOffset={refreshIndicatorBelow(isNativeLiquidGlassEnabled ? floatingSegmentTop + 46 : 0)} colors={[colors.accent]} tintColor={colors.accent} progressBackgroundColor={colors.card} />}
                ListEmptyComponent={<View style={s.empty}><Ionicons name="boat-outline" size={40} color={colors.textMuted} /><Text style={{ color: colors.textMuted, marginTop: 10 }}>{pageZone === 'public' ? '公海暂时没有开放的礁石' : '这里空空如也，创建第一座礁石吧！'}</Text></View>}
              />
            </View>
          ))}
        </PagerView>
      )}
      {isNativeLiquidGlassEnabled && scrollIndicatorVisible && rooms.some(room => room.zone === zone) ? (() => {
        const trackTop = Platform.OS === 'android' ? floatingSegmentTop + 50 : Math.max(154, insets.top + 130);
        const trackBottom = Math.max(insets.bottom + 100, 108);
        const trackHeight = Math.max(120, windowHeight - trackTop - trackBottom);
        const listPadding = floatingListTop + Math.max(insets.bottom + 104, 112);
        const usableViewport = Math.max(1, scrollMetrics.viewport - listPadding);
        const reefContent = Math.max(usableViewport, scrollMetrics.content - listPadding);
        const thumbHeight = Math.min(trackHeight, Math.max(36, trackHeight * usableViewport / reefContent));
        const maxOffset = Math.max(1, scrollMetrics.content - scrollMetrics.viewport);
        const thumbTop = (trackHeight - thumbHeight) * Math.min(1, scrollMetrics.y / maxOffset);
        return <View pointerEvents="none" style={[s.scrollTrack, { top: trackTop, height: trackHeight }]}>
          <View style={[s.scrollThumb, { height: thumbHeight, transform: [{ translateY: thumbTop }], backgroundColor: isDark ? '#8EDCFF' : '#33A9DC' }]} />
        </View>;
      })() : null}
      <Modal visible={applicationOpen} transparent animationType="fade" onRequestClose={() => !applicationSubmitting && setApplicationOpen(false)}>
        <Pressable style={s.modalShade} onPress={() => !applicationSubmitting && setApplicationOpen(false)}>
          <Pressable style={[s.applicationCard, { backgroundColor: colors.card }]} onPress={() => {}}>
            <Text style={[s.applicationTitle, { color: colors.text }]}>新增公海礁石申请</Text>
            <Text style={[s.applicationLabel, { color: colors.textSecondary }]}>公海礁石名称</Text>
            <TextInput
              value={applicationName}
              onChangeText={setApplicationName}
              maxLength={18}
              placeholder="输入 2 至 18 个字"
              placeholderTextColor={colors.textMuted}
              style={[s.applicationInput, { color: colors.text, backgroundColor: colors.input, borderColor: colors.divider }]}
            />
            <Text style={[s.applicationLabel, { color: colors.textSecondary }]}>申请理由</Text>
            <TextInput
              value={applicationReason}
              onChangeText={setApplicationReason}
              maxLength={200}
              multiline
              textAlignVertical="top"
              placeholder="说说为什么希望新增这座公海礁石"
              placeholderTextColor={colors.textMuted}
              style={[s.applicationInput, s.applicationReason, { color: colors.text, backgroundColor: colors.input, borderColor: colors.divider }]}
            />
            <Text style={[s.applicationCounter, { color: colors.textMuted }]}>{Array.from(applicationReason).length}/200</Text>
            {!!applicationError && <Text style={[s.applicationError, { color: colors.danger }]}>{applicationError}</Text>}
            <Pressable
              disabled={applicationSubmitting || applicationName.trim().length < 2 || !applicationReason.trim()}
              style={[s.applicationSubmit, { backgroundColor: colors.accent }, (applicationSubmitting || applicationName.trim().length < 2 || !applicationReason.trim()) && s.applicationDisabled]}
              onPress={submitApplication}
            >
              {applicationSubmitting ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Text style={s.applicationSubmitText}>提交申请</Text>}
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
      <Modal visible={createOpen} transparent animationType="fade" onRequestClose={() => setCreateOpen(false)}>
        <Pressable style={s.modalShade} onPress={() => setCreateOpen(false)}>
          <Pressable style={[s.modalCard, { backgroundColor: colors.card }]} onPress={() => {}}>
            <View style={s.modalHeader}>
              <View style={[s.modalIcon, { backgroundColor: colors.accent + '18' }]}>
                <Ionicons name="shield-half-outline" size={23} color={colors.accent} />
              </View>
              <View style={s.modalHeading}>
                <View style={s.modalTitleRow}>
                  <Text style={[s.modalTitle, { color: colors.text }]}>创建领海礁石</Text>
                  <Pressable accessibilityLabel="查看私人礁石规则" hitSlop={7} style={[s.rulesHelp, { backgroundColor: colors.accent + '18', borderColor: colors.accent + '55' }]} onPress={() => setReefRulesOpen(true)}>
                    <Ionicons name="help" size={13} color={colors.accent} />
                  </Pressable>
                </View>
                <Text style={[s.modalHint, { color: colors.textMuted }]}>创建后会出现在领海广场</Text>
              </View>
              <Pressable accessibilityLabel="关闭" style={s.modalClose} onPress={() => setCreateOpen(false)}>
                <Ionicons name="close" size={21} color={colors.textMuted} />
              </Pressable>
            </View>
            <ReefCreationFields
              name={roomName}
              capacity={roomCapacity}
              duration={roomDuration}
              onNameChange={text => { setRoomName(text); setCreateError(''); }}
              onCapacityChange={setRoomCapacity}
              onDurationChange={setRoomDuration}
            />
            {!!createError && <Text style={[s.createError, { color: colors.danger }]}>{createError}</Text>}
            <View style={s.modalActions}>
              <Pressable style={s.cancelBtn} onPress={() => setCreateOpen(false)}><Text style={{ color: colors.textMuted }}>取消</Text></Pressable>
              <Pressable style={[s.createBtn, { backgroundColor: colors.accent }]} onPress={createRoom}><Text style={s.createText}>{creating ? '创建中…' : '创建'}</Text></Pressable>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
      <Modal visible={reefRulesOpen} transparent animationType="fade" onRequestClose={() => setReefRulesOpen(false)}>
        <Pressable style={s.modalShade} onPress={() => setReefRulesOpen(false)}>
          <Pressable style={[s.rulesCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]} onPress={event => event.stopPropagation()}>
            <View style={s.rulesHeader}>
              <Text style={[s.rulesTitle, { color: colors.text }]}>私人礁石规则</Text>
              <Pressable accessibilityLabel="关闭私人礁石规则" style={[s.rulesClose, { backgroundColor: colors.input }]} onPress={() => setReefRulesOpen(false)}><Ionicons name="close" size={19} color={colors.textMuted} /></Pressable>
            </View>
            <View style={[s.ruleItem, { backgroundColor: colors.input, borderColor: colors.cardBorder }]}>
              <View style={[s.ruleNumber, { backgroundColor: colors.accent + '17' }]}><Text style={[s.ruleNumberText, { color: colors.accent }]}>1</Text></View>
              <Text style={[s.ruleText, { color: colors.textSecondary }]}>礁石内依旧受到<RedLineLink onPress={() => { setReefRulesOpen(false); setRedLineOpen(true); }} />严格管控！</Text>
            </View>
            <View style={[s.ruleItem, s.ruleItemSpacing, { backgroundColor: colors.input, borderColor: colors.cardBorder }]}>
              <View style={[s.ruleNumber, { backgroundColor: colors.accent + '17' }]}><Text style={[s.ruleNumberText, { color: colors.accent }]}>2</Text></View>
              <Text style={[s.ruleText, { color: colors.textSecondary }]}>礁石创建4小时后，会向礁石内发言过的用户及创建者发布一条礁石存续许可投票，如果同意票达到5票，礁石存续时长会延长至30天。</Text>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
      <RedLineModal visible={redLineOpen} onClose={() => setRedLineOpen(false)} />
    </View>
  );
}

const s = StyleSheet.create({
  page: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, backgroundColor: 'transparent', minHeight: 64 },
  floatingHeader: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 20, elevation: 20 },
  headerBtn: { position: 'absolute', right: 16, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  titleGroup: { width: 226, alignItems: 'center', justifyContent: 'center', minHeight: 58 },
  glassTitleGroup: { width: 226, minHeight: 58, paddingHorizontal: 18, paddingVertical: 8, borderRadius: 29, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  title: { fontSize: 19, fontWeight: '700' },
  subtitle: { textAlign: 'center', fontSize: 12, marginTop: 1, marginBottom: 0 },
  glassCreateButton: { position: 'absolute', right: 16, width: 42, height: 42, borderRadius: 21, overflow: 'hidden' },
  glassCreatePressable: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center' },
  segment: { flexDirection: 'row', marginHorizontal: 16, padding: 4, borderRadius: 14 },
  glassSegment: { flexDirection: 'row', position: 'relative', height: 46, marginHorizontal: 16, padding: 4, borderRadius: 16, overflow: 'hidden' },
  floatingSegment: { position: 'absolute', left: 16, right: 16, marginHorizontal: 0, zIndex: 20, elevation: 20 },
  scrollTrack: { position: 'absolute', right: 3, width: 4, zIndex: 30, elevation: 30, borderRadius: 2 },
  scrollThumb: { width: 4, borderRadius: 2, opacity: 0.9 },
  applicationCard: { width: '100%', maxWidth: 360, borderRadius: 12, padding: 19 },
  applicationTitle: { fontSize: 18, fontWeight: '700', textAlign: 'center', marginBottom: 18 },
  applicationLabel: { fontSize: 12, fontWeight: '600', marginBottom: 6, marginTop: 9 },
  applicationInput: { minHeight: 44, borderWidth: 1, borderRadius: 9, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  applicationReason: { minHeight: 116, maxHeight: 150 },
  applicationCounter: { fontSize: 11, textAlign: 'right', marginTop: 5 },
  applicationError: { fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 8 },
  applicationSubmit: { minHeight: 44, borderRadius: 9, alignItems: 'center', justifyContent: 'center', marginTop: 15 },
  applicationDisabled: { opacity: 0.45 },
  applicationSubmitText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  glassSegmentBubbleMotion: { position: 'absolute', left: 4, top: 4, bottom: 4, paddingHorizontal: 2 },
  glassSegmentBubble: { flex: 1, borderRadius: 12, overflow: 'hidden' },
  segmentBtn: { flex: 1, height: 38, borderRadius: 11, flexDirection: 'row', gap: 7, alignItems: 'center', justifyContent: 'center', backgroundColor: 'transparent' },
  segmentText: { fontSize: 14, fontWeight: '600' },
  pager: { flex: 1 },
  list: { padding: 12, paddingBottom: 112, flexGrow: 1 },
  cardRow: { justifyContent: 'space-between', gap: 10 },
  card: { width: '48.5%', minHeight: 128, borderWidth: 1, borderRadius: 14, padding: 10, marginBottom: 10 },
  cardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 24 },
  number: { fontSize: 10, fontWeight: '800' },
  roomName: { fontSize: 14, lineHeight: 19, fontWeight: '700', marginTop: 4 },
  countPill: { flexDirection: 'row', alignItems: 'center', gap: 3, paddingHorizontal: 6, paddingVertical: 3, borderRadius: 9 },
  count: { fontSize: 9, fontWeight: '700' },
  memberRow: { height: 28, flexDirection: 'row', alignItems: 'center', marginTop: 6 },
  genderDot: { width: 21, height: 21, borderRadius: 11, borderWidth: 1.5, backgroundColor: '#FFFFFFCC', alignItems: 'center', justifyContent: 'center' },
  emptyMembers: { fontSize: 9 }, more: { fontSize: 9, marginLeft: 3 },
  latest: { flexDirection: 'row', alignItems: 'center', gap: 5, borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 7 },
  latestText: { flex: 1, fontSize: 10, lineHeight: 14 },
  empty: { alignItems: 'center', marginTop: 90 },
  modalShade: { flex: 1, backgroundColor: 'rgba(4,12,24,0.58)', alignItems: 'center', justifyContent: 'center', padding: 20 },
  modalCard: { width: '100%', maxWidth: 520, borderRadius: 8, padding: 18 },
  modalHeader: { width: '100%', flexDirection: 'row', alignItems: 'center', marginBottom: 20 },
  modalIcon: { width: 42, height: 42, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  modalHeading: { flex: 1, minWidth: 0, marginLeft: 11 },
  modalTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  modalTitle: { fontSize: 17, fontWeight: '700' },
  rulesHelp: { width: 23, height: 23, borderRadius: 12, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  modalHint: { fontSize: 11, marginTop: 3 },
  modalClose: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  expiryHint: { width: '100%', fontSize: 11, lineHeight: 17, marginTop: 7 },
  createError: { width: '100%', fontSize: 12, lineHeight: 17, marginTop: 5 },
  modalActions: { flexDirection: 'row', width: '100%', gap: 10, marginTop: 16 },
  cancelBtn: { flex: 1, height: 42, alignItems: 'center', justifyContent: 'center' },
  createBtn: { flex: 1, height: 42, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  createText: { color: '#FFFFFF', fontWeight: '700' },
  rulesCard: { width: '100%', maxWidth: 420, borderRadius: 16, borderWidth: StyleSheet.hairlineWidth, padding: 17 },
  rulesHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 2 },
  rulesTitle: { fontSize: 17, fontWeight: '800' },
  rulesClose: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  ruleItem: { alignSelf: 'stretch', minHeight: 42, paddingHorizontal: 9, paddingVertical: 8, borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, flexDirection: 'row', alignItems: 'flex-start', gap: 7 },
  ruleItemSpacing: { marginTop: 8 },
  ruleNumber: { width: 20, height: 20, flexShrink: 0, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  ruleNumberText: { fontSize: 10, fontWeight: '800' },
  ruleCopy: { flex: 1, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  ruleText: { flex: 1, minWidth: 0, flexShrink: 1, fontSize: 12, lineHeight: 18, includeFontPadding: false },
});
