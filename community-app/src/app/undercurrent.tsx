import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { View, Text, StyleSheet, Dimensions, Pressable, FlatList, ActivityIndicator, NativeSyntheticEvent, NativeScrollEvent, StatusBar, Animated, Easing, Image, ScrollView, TextInput, LayoutChangeEvent } from 'react-native';
import { Alert } from '@/components/app-alert';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { getUndercurrent, getCapsuleTexts, getBeacons, getMyBeacon, createBeacon, getQianliuCounts, uploadFile, reportAchievementEvent } from '@/api/client';
import { ImageViewer } from '@/components/image-viewer';
import { GenderSymbol } from '@/components/gender-badge';
import { useAuth } from '@/contexts/auth';
import { useCommunityConfig } from '@/contexts/community-config';
import * as Haptics from 'expo-haptics';
import { launchImageLibrarySafely } from '@/lib/image-picker';

const { width: SW, height: SH } = Dimensions.get('window');
const CARD_H = 56;
const CARD_GAP = 10;
const ITEM_H = CARD_H + CARD_GAP;

const DEEP  = '#0A1628';
const DEEP2 = '#0F1E33';
const ACCENT = '#33A9DC';
const REPEAT = 500;
const SAFE_START = 250; // 从第 250 轮开始，远离上下边界

function formatRelativeTime(dateStr: string): string {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return '刚刚';
  if (mins < 60) return `${mins}分钟前`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}小时前`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}天前`;
  return new Date(dateStr).toLocaleDateString('zh-CN');
}

/** 深海植物装饰 */
function DeepSeaBg() {
  // 海草：底部左右的摇曳水草
  const kelps = useMemo(() => [
    { left: -8, h: SH * 0.5, w: 3, color: '#1B4A3A', bend: -12 },
    { left: 20, h: SH * 0.35, w: 2.5, color: '#1D5C40', bend: -8 },
    { left: 50, h: SH * 0.6, w: 2, color: '#1A4535', bend: -15 },
    { right: 10, h: SH * 0.45, w: 3, color: '#1B4A3A', bend: 10 },
    { right: 35, h: SH * 0.55, w: 2.5, color: '#1D5C40', bend: 14 },
    { right: 60, h: SH * 0.3, w: 2, color: '#1A4535', bend: 8 },
  ], []);

  // 海底石块
  const rocks = useMemo(() => [
    { left: 20, bottom: 0, w: 60, h: 30, r: 16, color: '#162535' },
    { left: SW * 0.4, bottom: 0, w: 45, h: 22, r: 12, color: '#142030' },
    { right: 30, bottom: 0, w: 55, h: 28, r: 14, color: '#162535' },
    { left: SW * 0.7, bottom: 0, w: 35, h: 20, r: 10, color: '#142030' },
  ], []);

  return (
    <View style={ds.wrap} pointerEvents="none">
      {/* 海草 */}
      {kelps.map((k, i) => (
        <View key={`kelp-${i}`} style={[ds.kelp, {
          [k.left != null ? 'left' : 'right']: (k.left ?? k.right),
          height: k.h, width: k.w,
          backgroundColor: k.color,
          borderTopLeftRadius: k.w * 2,
          borderTopRightRadius: k.w,
          transform: [{ rotate: `${k.bend}deg` }],
          transformOrigin: 'bottom center',
        }]} />
      ))}
      {/* 石块 */}
      {rocks.map((r, i) => (
        <View key={`rock-${i}`} style={[ds.rock, {
          left: r.left, right: (r as any).right,
          bottom: r.bottom,
          width: r.w, height: r.h,
          borderRadius: r.r,
          backgroundColor: r.color,
        }]} />
      ))}
    </View>
  );
}

const ds = StyleSheet.create({
  wrap: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 } as any,
  kelp: {
    position: 'absolute', bottom: 0,
    opacity: 0.45,
    borderBottomLeftRadius: 0, borderBottomRightRadius: 0,
  },
  rock: { position: 'absolute', opacity: 0.6 },
});

export default function QianliuScreen() {
  const router = useRouter();
  const { entry } = useLocalSearchParams<{ entry?: string }>();
  const insets = useSafeAreaInsets();
  const { user, token } = useAuth();
  const { features } = useCommunityConfig();
  const [capsules, setCapsules] = useState<string[]>([]);
  const [pool, setPool] = useState<any[]>([]);
  const [beaconPool, setBeaconPool] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<'salvage' | 'sonar'>('salvage'); // 打捞 / 声呐
  const [genderMode, setGenderMode] = useState<'male' | 'female'>(user?.gender === 'female' ? 'female' : 'male');
  const [centerIdx, setCenterIdx] = useState(-1);
  const [stats, setStats] = useState({ undercurrent: 0, beacons: 0 });
  // 信标编辑器
  const [showBeaconEditor, setShowBeaconEditor] = useState(false);
  const [beaconText, setBeaconText] = useState('');
  const [beaconImg, setBeaconImg] = useState<string | null>(null);
  const [beaconSending, setBeaconSending] = useState(false);
  const [imgViewerVisible, setImgViewerVisible] = useState(false);
  const [imgViewerUri, setImgViewerUri] = useState('');
  const prevIdx = useRef(0);
  const hasUserInteracted = useRef(false);
  const salvagePendingFromDragRef = useRef(false);
  const dragStartOffsetRef = useRef(0);
  const isDraggingWheelRef = useRef(false);
  const listHeightRef = useRef(0);
  const listRef = useRef<FlatList<string>>(null);
  const [salvagedPost, setSalvagedPost] = useState<any>(null);
  const [showModal, setShowModal] = useState(false);
  const modalFade = useRef(new Animated.Value(0)).current;
  const salvageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const triggerSalvageRef = useRef<() => void>(() => {});
  const isSalvagingRef = useRef(false);
  const unopenedSalvageCountRef = useRef(0);
  const entryY = useRef(new Animated.Value(entry === 'drop' ? -SH : 0)).current;

  useEffect(() => {
    reportAchievementEvent('abyss_dive').catch(() => {});
  }, []);

  useEffect(() => {
    if (entry !== 'drop') return;
    Animated.timing(entryY, {
      toValue: 0,
      duration: 420,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [entry, entryY]);

  const data = useMemo(() => {
    const arr: string[] = [];
    for (let r = 0; r < REPEAT; r++) arr.push(...capsules);
    return arr;
  }, [capsules]);

  const startIdx = useMemo(() => data.length > 0 ? Math.floor(data.length / 2) : 0, [data]);

  const displayIdx = centerIdx >= 0 ? centerIdx : startIdx;

  const centerListOnIndex = useCallback((index: number, height = listHeightRef.current) => {
    if (!listRef.current || height <= 0) return;
    const offset = index * ITEM_H - height / 2 + ITEM_H / 2;
    listRef.current.scrollToOffset({ offset: Math.max(0, offset), animated: false });
  }, []);

  // 冷启动时安全区、字体和头部数据可能分多帧完成布局。始终使用列表最终
  // 实测高度计算初始偏移，避免固定高亮框与选中胶囊相差一格。
  useEffect(() => {
    if (data.length === 0) return;
    hasUserInteracted.current = false;
    salvagePendingFromDragRef.current = false;
    isDraggingWheelRef.current = false;
    prevIdx.current = startIdx;
    const frame = requestAnimationFrame(() => {
      setCenterIdx(startIdx);
      centerListOnIndex(startIdx);
    });
    return () => cancelAnimationFrame(frame);
  }, [centerListOnIndex, data.length, startIdx]);

  const handleListLayout = useCallback((e: LayoutChangeEvent) => {
    const nextHeight = e.nativeEvent.layout.height;
    if (nextHeight <= 0 || Math.abs(nextHeight - listHeightRef.current) < 0.5) return;
    listHeightRef.current = nextHeight;
    if (!hasUserInteracted.current && data.length > 0) {
      requestAnimationFrame(() => centerListOnIndex(startIdx, nextHeight));
    }
  }, [centerListOnIndex, data.length, startIdx]);

  useEffect(() => {
    // 核心数据：胶囊文案 + 失温切片（必须成功才能显示轮盘）
    Promise.all([getCapsuleTexts(), getUndercurrent(genderMode)])
      .then(([caps, uc]) => {
        const texts = (caps?.texts || []).map((t: any) => t.text);
        for (let i = texts.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [texts[i], texts[j]] = [texts[j], texts[i]];
        }
        setCapsules(texts);
        setPool(uc?.posts || []);
      })
      .catch(() => {})
      .finally(() => setLoading(false));

    // 辅助数据：信标 + 统计（不阻塞轮盘）
    Promise.allSettled([getBeacons(genderMode), getQianliuCounts()])
      .then(([beaconsResult, countsResult]) => {
        if (beaconsResult.status === 'fulfilled') {
          setBeaconPool(beaconsResult.value?.beacons || []);
        }
        if (countsResult.status === 'fulfilled') {
          const counts = countsResult.value;
          setStats(prev => ({
            undercurrent: counts?.undercurrent ?? prev.undercurrent,
            beacons: counts?.beacons ?? prev.beacons,
          }));
        }
      });
  }, [genderMode]);

  // 实时刷新信标池 + 统计数据（每5秒，保证其他用户修改信标即时可见）
  useEffect(() => {
    const refresh = async () => {
      const [beaconsResult, countsResult] = await Promise.allSettled([getBeacons(genderMode), getQianliuCounts()]);
      if (beaconsResult.status === 'fulfilled') {
        setBeaconPool(beaconsResult.value?.beacons || []);
      }
      if (countsResult.status === 'fulfilled') {
        const counts = countsResult.value;
        setStats(prev => ({
          undercurrent: counts?.undercurrent ?? prev.undercurrent,
          beacons: counts?.beacons ?? prev.beacons,
        }));
      }
    };
    refresh(); // 首屏也刷新一次确保最新
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, [genderMode]);

  const handleScroll = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y;
    if (isDraggingWheelRef.current && Math.abs(y - dragStartOffsetRef.current) > 2) {
      salvagePendingFromDragRef.current = true;
    }
    const flh = e.nativeEvent.layoutMeasurement.height;
    const idx = Math.round((y + flh / 2 - ITEM_H / 2) / ITEM_H);
    if (idx !== prevIdx.current) {
      prevIdx.current = idx;
      setCenterIdx(idx);
      Haptics.selectionAsync();
    }
  }, []);

  const scheduleSalvage = useCallback((delay = 250) => {
    if (salvageTimer.current) clearTimeout(salvageTimer.current);
    if (isSalvagingRef.current || !salvagePendingFromDragRef.current) return;
    salvageTimer.current = setTimeout(() => {
      if (isSalvagingRef.current || !salvagePendingFromDragRef.current) return;
      salvagePendingFromDragRef.current = false;
      isSalvagingRef.current = true;
      triggerSalvageRef.current();
    }, delay);
  }, []);

  useEffect(() => () => {
    if (salvageTimer.current) clearTimeout(salvageTimer.current);
  }, []);

  useEffect(() => {
    if (salvageTimer.current) clearTimeout(salvageTimer.current);
    salvagePendingFromDragRef.current = false;
    isSalvagingRef.current = false;
  }, [genderMode, mode]);

  // 惯性停止后做一次微小吸附（最多半格），边界自动回环
  const onMomentumEnd = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y;
    const flh = e.nativeEvent.layoutMeasurement.height;
    let idx = Math.round((y + flh / 2 - ITEM_H / 2) / ITEM_H);
    
    // 边界回环：靠近顶部或底部时静默跳回中间同一胶囊位置
    const total = data.length;
    const capCount = capsules.length || 1;
    const safeRound = Math.floor(REPEAT / 2);
    const nearTop = idx < capCount * 2;
    const nearBottom = idx > total - capCount * 2 - 1;
    if (capCount > 0 && (nearTop || nearBottom)) {
      const localIdx = idx % capCount;
      idx = safeRound * capCount + localIdx;
      const jumpTarget = idx * ITEM_H - flh / 2 + ITEM_H / 2;
      listRef.current?.scrollToOffset({ offset: Math.max(0, jumpTarget), animated: false });
    }

    const target = idx * ITEM_H - flh / 2 + ITEM_H / 2;
    const diff = target - y;
    if (Math.abs(diff) > 2) {
      listRef.current?.scrollToOffset({ offset: Math.max(0, target), animated: true });
    }
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    // 只有用户亲手拖动轮盘后才打捞；初始化居中和布局校正也可能产生
    // momentum 回调，不能把这类程序化滚动视为用户操作。
    scheduleSalvage(250);
  }, [data.length, capsules.length, scheduleSalvage]);

  const triggerSalvage = useCallback(async () => {
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
      if (mode === 'sonar') {
        // 池为空时先即时重拉一次，避免网络抖动或首屏竞态造成轮盘永久空转。
        let available = beaconPool;
        if (available.length === 0) {
          const fresh = await getBeacons(genderMode);
          available = fresh?.beacons || [];
          setBeaconPool(available);
        }
        if (available.length === 0) {
          isSalvagingRef.current = false;
          Alert.alert('暂无可共振的信标', '这片水域暂时没有可打捞的深海信标，请稍后再试。');
          return;
        }
        const beacon = available[Math.floor(Math.random() * available.length)];
        setSalvagedPost({ ...beacon, isBeacon: true });
        setShowModal(true);
        reportAchievementEvent('resonant_echo').catch(() => {});
      } else {
        let available = pool;
        if (available.length === 0) {
          const fresh = await getUndercurrent(genderMode);
          available = fresh?.posts || [];
          setPool(available);
        }
        if (available.length === 0) {
          isSalvagingRef.current = false;
          Alert.alert('暂无可打捞的切片', '这片水域暂时没有符合条件的失温切片，请稍后再试。');
          return;
        }
        const post = available[Math.floor(Math.random() * available.length)];
        setSalvagedPost(post);
        setShowModal(true);
        reportAchievementEvent('slice_salvage').catch(() => {});
        unopenedSalvageCountRef.current += 1;
        if (unopenedSalvageCountRef.current >= 44) {
          unopenedSalvageCountRef.current = 0;
          reportAchievementEvent('sentient_cable').catch(() => {});
        }
      }
      Animated.timing(modalFade, { toValue: 1, duration: 300, useNativeDriver: true }).start();
    } catch {
      isSalvagingRef.current = false;
      Alert.alert('打捞失败', '水流暂时不稳定，请稍后再试。');
    }
  }, [pool, beaconPool, mode, genderMode, modalFade]);
  triggerSalvageRef.current = triggerSalvage;

  const pickBeaconImage = async () => {
    const result = await launchImageLibrarySafely({ mediaTypes: ['images'], quality: 0.8 });
    if (!result.canceled && result.assets?.length) {
      const uploaded = await uploadFile(result.assets[0].uri);
      setBeaconImg(uploaded?.url || result.assets[0].uri);
    }
  };

  const sendBeacon = async () => {
    if (!token) { router.push('/login'); return; }
    if (!beaconText.trim()) return;
    setBeaconSending(true);
    try {
      await createBeacon(beaconText.trim(), beaconImg || undefined);
      // 刷新信标池和计数（从服务端拉真实数字）
      const [beacons, counts] = await Promise.all([getBeacons(genderMode), getQianliuCounts()]);
      setBeaconPool(beacons?.beacons || []);
      setStats(counts || {});
      setBeaconText('');
      setBeaconImg(null);
      setShowBeaconEditor(false);
    } catch (e: any) {
      Alert.alert('投放失败', e.message || '请重试');
    } finally {
      setBeaconSending(false);
    }
  };

  const closeModal = useCallback(() => {
    Animated.timing(modalFade, { toValue: 0, duration: 200, useNativeDriver: true }).start(() => {
      setShowModal(false);
      setSalvagedPost(null);
      isSalvagingRef.current = false;
    });
  }, [modalFade]);

  const renderItem = useCallback(({ item, index }: { item: string; index: number }) => {
    const dist = Math.abs(index - displayIdx);
    const fontSize = Math.max(11, 15 - dist * 0.9);
    const alpha = Math.max(0.25, 1 - dist * 0.15);
    const color = dist === 0 ? '#D8ECFF' : dist <= 2 ? '#7AA8C8' : '#4A6A8A';
    return (
      <View style={s.slot}>
        <View style={[s.card, dist === 0 ? s.cardCenter : s.cardDim, { opacity: Math.max(0.4, alpha) }]}>
          <Text style={[s.cText, { color, fontSize }]} numberOfLines={2}>
            {item}
          </Text>
        </View>
      </View>
    );
  }, [displayIdx]);

  if (loading) {
    return (
      <Animated.View style={[s.container, { transform: [{ translateY: entryY }] }]}>
        <DeepSeaBg />
        <ActivityIndicator size="large" color={ACCENT} style={{ marginTop: SH * 0.4 }} />
      </Animated.View>
    );
  }

  if (data.length === 0) {
    return (
      <Animated.View style={[s.container, { transform: [{ translateY: entryY }] }]}>
        <DeepSeaBg />
        <View style={s.empty}>
          <Ionicons name="water-outline" size={48} color={ACCENT + '40'} />
          <Text style={s.emptyTitle}>潜流域暂空</Text>
          <Text style={s.emptySub}>浮霜带里正在升温的切片，终将沉入深海</Text>
        </View>
      </Animated.View>
    );
  }

  return (
    <Animated.View style={[s.container, { transform: [{ translateY: entryY }] }]}>
      <DeepSeaBg />
      <StatusBar barStyle="light-content" backgroundColor={DEEP} />
      <View style={[s.header, { paddingTop: insets.top + 12 }]}>
        <Pressable style={s.backBtn} onPress={() => router.back()}>
          <Ionicons name="chevron-back" size={24} color={ACCENT} />
        </Pressable>
        <View style={s.headerCenter}>
          <View style={s.titleRow}>
            <Pressable
              accessibilityLabel={`当前为${mode === 'salvage' ? '打捞' : '共振'}模式，点击切换`}
              hitSlop={8}
              onPress={() => setMode(m => m === 'salvage' ? 'sonar' : 'salvage')}
              style={s.modeSwitch}
            >
              <Ionicons
                name={mode === 'salvage' ? 'fish' : 'pulse'}
                size={22}
                color={ACCENT}
              />
            </Pressable>
            <Text style={s.hTitle}>潜流域</Text>
            {features.qianliu_gender !== false && <Pressable
              accessibilityLabel={`当前匹配${genderMode === 'male' ? '男性' : '女性'}，点击切换`}
              hitSlop={8}
              onPress={() => setGenderMode(current => current === 'male' ? 'female' : 'male')}
              style={[s.genderSwitch, genderMode === 'female' && s.genderSwitchFemale]}
            >
              <GenderSymbol
                gender={genderMode}
                size={17}
                color={genderMode === 'male' ? '#75BDF0' : '#F19BC0'}
              />
            </Pressable>}
          </View>
          <Text style={s.hSub}>
            <Text style={s.hNum}>{stats.undercurrent}</Text> 份失温切片沉入潜流，<Text style={s.hNum}>{stats.beacons}</Text> 枚深海信标完成投放。
          </Text>
        </View>
        <Pressable style={s.backBtn} onPress={async () => {
          if (!token) { router.push('/login'); return; }
          try { const mine = await getMyBeacon(); if (mine?.beacon) { setBeaconText(mine.beacon.content || ''); setBeaconImg(mine.beacon.image || null); } else { setBeaconText(''); setBeaconImg(null); } } catch { setBeaconText(''); setBeaconImg(null); }
          setShowBeaconEditor(true);
        }}>
          <Ionicons name="locate" size={22} color={ACCENT} />
        </Pressable>
      </View>

      <View style={s.wheelArea}>
        <FlatList
          key={data.length}
          ref={listRef}
          data={data}
          renderItem={renderItem}
          keyExtractor={(_, i) => String(i)}
          showsVerticalScrollIndicator={false}
          decelerationRate={0.992}
          onScroll={handleScroll}
          onLayout={handleListLayout}
          scrollEventThrottle={16}
          onScrollBeginDrag={({ nativeEvent }) => {
            hasUserInteracted.current = true;
            isDraggingWheelRef.current = true;
            salvagePendingFromDragRef.current = false;
            dragStartOffsetRef.current = nativeEvent.contentOffset.y;
            if (salvageTimer.current) clearTimeout(salvageTimer.current);
          }}
          onScrollEndDrag={() => {
            isDraggingWheelRef.current = false;
            scheduleSalvage(450);
          }}
          onMomentumScrollBegin={() => {
            if (salvageTimer.current) clearTimeout(salvageTimer.current);
          }}
          onMomentumScrollEnd={onMomentumEnd}
          removeClippedSubviews
          maxToRenderPerBatch={5}
          windowSize={7}
          initialNumToRender={9}
          getItemLayout={(_, index) => ({ length: ITEM_H, offset: ITEM_H * index, index })}
          bounces={false}
          style={{ flex: 1 }}
        />

        <View style={s.centerBox} pointerEvents="none">
          <View style={s.cBg} />
        </View>
      </View>

      <View style={s.footer}>
        <Text style={s.fText}>宇宙充满无序的布朗运动，</Text>
        <Text style={s.fText}>直到两次心跳产生短暂的纠缠。</Text>
      </View>

      {/* 打捞/声呐结果弹窗 */}
      {showModal && salvagedPost && (
        <View style={s.modalOverlay}>
          <Animated.View style={[s.modalBg, { opacity: modalFade }]}>
            <Pressable style={StyleSheet.absoluteFill} onPress={closeModal} />
          </Animated.View>
          <Animated.View style={[s.modalCard, {
            opacity: modalFade,
            transform: [{ translateY: modalFade.interpolate({ inputRange: [0, 1], outputRange: [60, 0] }) }],
          }]}>
            <View style={s.modalHandle} />
            <View style={s.modalAuthor}>
              <View style={[s.modalAvatar, { backgroundColor: ACCENT }]}>
                <Text style={s.modalAvatarText}>
                  {(salvagedPost.nickname || salvagedPost.username || '?')[0]}
                </Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.modalName}>{salvagedPost.nickname || salvagedPost.username}</Text>
                <Text style={s.modalTime}>{formatRelativeTime(salvagedPost.createdAt)}</Text>
              </View>
              <Pressable onPress={closeModal} style={s.modalClose}>
                <Ionicons name="close" size={20} color={ACCENT + '80'} />
              </Pressable>
            </View>
            <ScrollView style={s.modalBody} showsVerticalScrollIndicator={false}>
              {(salvagedPost as any).isBeacon ? (
                <>
                  <Text style={[s.modalContent, { textAlign: 'center', fontStyle: 'italic', color: '#C8D8E8', fontSize: 15 }]}>{salvagedPost.content || '（无内容）'}</Text>
                  {(salvagedPost as any).image && (
                    <Pressable onPress={() => { setImgViewerUri((salvagedPost as any).image); setImgViewerVisible(true); }}>
                      <Image source={{ uri: (salvagedPost as any).image }} style={{ width: '100%', height: 200, borderRadius: 8, marginTop: 12, backgroundColor: DEEP }} resizeMode="contain" />
                    </Pressable>
                  )}
                </>
              ) : (
                <>
                  <Text style={s.modalContent}>{salvagedPost.content || '（无内容）'}</Text>
                  {salvagedPost.images?.length > 0 && (
                    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 12 }}>
                      {salvagedPost.images.map((img: string, i: number) => (
                        <Image key={i} source={{ uri: img }} style={s.modalImg} />
                      ))}
                    </ScrollView>
                  )}
                </>
              )}
            </ScrollView>
            <View style={s.modalActions}>
              {(salvagedPost as any).isBeacon ? (
                <Pressable style={s.modalBtn} onPress={() => { closeModal(); router.push({ pathname: '/chat/[name]', params: { name: salvagedPost.nickname || salvagedPost.username, peerUserId: salvagedPost.userId || '' } }); }}>
                  <Ionicons name="send-outline" size={18} color={ACCENT} />
                  <Text style={s.modalBtnText}>私信</Text>
                </Pressable>
              ) : (
                <Pressable style={s.modalBtn} onPress={() => { unopenedSalvageCountRef.current = 0; closeModal(); router.push({ pathname: '/post/[id]', params: { id: salvagedPost.id } }); }}>
                  <Ionicons name="open-outline" size={18} color={ACCENT} />
                  <Text style={s.modalBtnText}>查看完整切片</Text>
                </Pressable>
              )}
            </View>
          </Animated.View>
        </View>
      )}

      {/* 信标编辑器 */}
      {showBeaconEditor && (
        <View style={s.modalOverlay}>
          <Animated.View style={[s.modalBg, { opacity: 1 }]}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setShowBeaconEditor(false)} />
          </Animated.View>
          <View style={s.beaconCard}>
            <View style={s.modalAuthor}>
              <Text style={{ flex: 1, textAlign: 'center', fontSize: 17, fontStyle: 'italic', color: ACCENT, fontWeight: '300' }}>深海信标</Text>
              <Pressable onPress={() => setShowBeaconEditor(false)}>
                <Ionicons name="close" size={22} color={ACCENT + '80'} />
              </Pressable>
            </View>
            <ScrollView style={{ maxHeight: SH * 0.45 }}>
              <View style={s.beaconTextBox}>
                <TextInput
                  style={s.beaconInput}
                  placeholder="写下你的深海信标…"
                  placeholderTextColor={ACCENT + '50'}
                  multiline
                  maxLength={200}
                  value={beaconText}
                  onChangeText={setBeaconText}
                />
                <Text style={[s.fText, { textAlign: 'right', marginBottom: 8, fontSize: 10, fontStyle: 'normal' }]}>{beaconText.length}/200</Text>
              </View>
              {beaconImg ? (
                <View style={{ paddingHorizontal: 20, position: 'relative' }}>
                  <Image source={{ uri: beaconImg }} style={{ width: '80%', alignSelf: 'center', height: 180, borderRadius: 8 }} resizeMode="contain" />
                  <Pressable style={s.removeImg} onPress={() => setBeaconImg(null)}>
                    <Ionicons name="close-circle" size={22} color="#E24B4A" />
                  </Pressable>
                </View>
              ) : (
                <Pressable style={s.addImg} onPress={pickBeaconImage}>
                  <Ionicons name="image-outline" size={24} color={ACCENT + '50'} />
                  <Text style={[s.fText, { color: ACCENT + '50' }]}>添加图片（可选）</Text>
                </Pressable>
              )}
            </ScrollView>
            <View style={s.modalActions}>
              <Pressable style={[s.modalBtn, { opacity: !beaconText.trim() || beaconSending ? 0.4 : 1 }]} onPress={sendBeacon} disabled={!beaconText.trim() || beaconSending}>
                <Ionicons name="send" size={18} color={ACCENT} />
                <Text style={s.modalBtnText}>{beaconSending ? '投放中…' : '投放信标'}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      )}
      <ImageViewer images={imgViewerUri ? [imgViewerUri] : []} index={0} visible={imgViewerVisible} onClose={() => setImgViewerVisible(false)} />
    </Animated.View>
  );
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: DEEP },
  header: { flexDirection: 'row', alignItems: 'flex-start', paddingBottom: 12 },
  backBtn: { width: 40, height: 40, justifyContent: 'center', alignItems: 'center' },
  headerCenter: { flex: 1, alignItems: 'center' },
  hTitle: { fontSize: 22, fontWeight: '300', color: '#C8D8E8', letterSpacing: 8 },
  hSub: { fontSize: 11, color: ACCENT + '60', marginTop: 4, letterSpacing: 1 },
  hNum: { fontSize: 12, color: ACCENT, fontWeight: '700' },

  wheelArea: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  slot: { height: ITEM_H, justifyContent: 'center', alignItems: 'center' },

  card: {
    width: SW * 0.72, height: CARD_H,
    borderRadius: 28,
    justifyContent: 'center', alignItems: 'center',
    paddingHorizontal: 20,
    borderWidth: 1,
  },
  cardCenter: {
    opacity: 1, transform: [{ scale: 1 }],
    backgroundColor: DEEP2, borderColor: ACCENT + '60',
  },
  cardDim: {
    opacity: 0.38, transform: [{ scale: 0.84 }],
    backgroundColor: DEEP, borderColor: ACCENT + '06',
  },
  cText: { fontSize: 12, lineHeight: 17, textAlign: 'center' },

  centerBox: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    justifyContent: 'center', alignItems: 'center',
  },
  cBg: {
    width: SW * 0.72 + 4, height: CARD_H + 4,
    borderRadius: 30, borderWidth: 1, borderColor: ACCENT + '30',
  },

  footer: {
    alignItems: 'center', justifyContent: 'center',
    paddingBottom: 40, gap: 2,
  },
  fText: { fontSize: 11, color: ACCENT + '60', letterSpacing: 2, fontStyle: 'italic' },

  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: SH * 0.15 },
  emptyTitle: { fontSize: 16, color: '#C8D8E8', marginTop: 16, fontWeight: '300', letterSpacing: 4 },
  emptySub: { fontSize: 12, color: ACCENT + '50', marginTop: 8 },

  // 切片弹窗
  modalOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    justifyContent: 'center', alignItems: 'center', zIndex: 100,
  },
  modalBg: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0,0,0,0.65)',
  },
  modalCard: {
    width: SW * 0.88,
    maxHeight: SH * 0.62,
    backgroundColor: DEEP2,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: ACCENT + '25',
    overflow: 'hidden',
  },
  modalHandle: {
    width: 40, height: 4, borderRadius: 2,
    backgroundColor: ACCENT + '30',
    alignSelf: 'center', marginTop: 10,
  },
  modalAuthor: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 20, paddingTop: 16, paddingBottom: 8,
  },
  modalAvatar: {
    width: 36, height: 36, borderRadius: 18,
    alignItems: 'center', justifyContent: 'center',
    marginRight: 10,
  },
  modalAvatarText: { color: '#FFF', fontSize: 15, fontWeight: '600' },
  modalName: { color: '#C8D8E8', fontSize: 15, fontWeight: '600' },
  modalTime: { color: ACCENT + '60', fontSize: 11, marginTop: 2 },
  modalClose: { padding: 6 },
  modalBody: { paddingHorizontal: 20, maxHeight: SH * 0.3 },
  modalContent: { color: '#A0B8D0', fontSize: 14, lineHeight: 22 },
  modalImg: {
    width: 120, height: 120, borderRadius: 8,
    marginRight: 8, backgroundColor: DEEP,
  },
  modalActions: {
    flexDirection: 'row', justifyContent: 'center',
    paddingVertical: 16, borderTopWidth: 1,
    borderTopColor: ACCENT + '15',
  },
  modalBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 24, paddingVertical: 10,
    borderRadius: 20, backgroundColor: ACCENT + '18',
  },
  modalBtnText: { color: ACCENT, fontSize: 14, fontWeight: '600' },

  // 标题行 + 信标编辑器
  titleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  modeSwitch: {
    width: 27, height: 27,
    alignItems: 'center', justifyContent: 'center',
  },
  genderSwitch: {
    width: 27, height: 27, borderRadius: 14,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: '#75BDF055', backgroundColor: '#75BDF016',
  },
  genderSwitchFemale: { borderColor: '#F19BC055', backgroundColor: '#F19BC016' },
  beaconCard: {
    width: SW * 0.88,
    maxHeight: SH * 0.7,
    backgroundColor: DEEP2,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: ACCENT + '25',
    overflow: 'hidden',
  },
  beaconTextBox: {
    marginHorizontal: 20, marginTop: 12, marginBottom: 8,
    borderWidth: 1, borderColor: ACCENT + '30', borderStyle: 'dashed',
    borderRadius: 12, paddingRight: 12,
  },
  beaconInput: {
    marginHorizontal: 16, marginTop: 12,
    minHeight: 100,
    color: '#C8D8E8',
    fontSize: 15,
    lineHeight: 24,
    textAlignVertical: 'top',
  },
  addImg: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginHorizontal: 20, marginBottom: 16,
    padding: 16, borderRadius: 12,
    borderWidth: 1, borderColor: ACCENT + '30', borderStyle: 'dashed',
    justifyContent: 'center',
  },
  removeImg: { position: 'absolute', top: -8, right: 8 },
});
