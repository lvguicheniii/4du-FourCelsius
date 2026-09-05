import { Tabs, usePathname, useRouter } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { Animated, BackHandler, Modal, PanResponder, Platform, ScrollView, StyleSheet, Text, View, ColorValue, useWindowDimensions } from 'react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable } from '@/components/pressable';
import { AnimatedTabIcon } from '@/components/animated-tab-icon';
import { useTheme } from '@/lib/theme';
import { useAuth } from '@/contexts/auth';
import * as Haptics from 'expo-haptics';
import { reportAchievementEvent } from '@/api/client';
import { useCommunityConfig } from '@/contexts/community-config';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RedLineLink, RedLineModal } from '@/components/red-line-modal';
import { groupBoardsByCategory } from '@/data/board-categories';
import { BoardIcon } from '@/components/board-icon';
import { isIOSLiquidGlassEnabled, isNativeLiquidGlassEnabled, NativeLiquidGlassContainer, NativeLiquidGlassView } from '@/components/liquid-glass';

const BEGINNER_GUIDE = [
  { icon: 'warning-outline', title: 'red_line', text: '' },
  { icon: 'add-circle-outline', title: '制备切片', text: '点击底部中央的加号发布文字、图片、视频或实况照片，并可选择冰格、话题、礁石和切片盒。' },
  { icon: 'thermometer-outline', title: '温度与潜流', text: '互动能延缓切片升温；失温切片会进入潜流域，等待其他用户随机打捞。' },
  { icon: 'shield-checkmark-outline', title: '互动与安全', text: '评论、私信和礁石用于交流；长按内容可进行举报、拉黑或其他管理操作。' },
] as const;

function FloatingBandTitle({ onOpenBoards }: { onOpenBoards: () => void }) {
  const router = useRouter();
  const { colors, isDark } = useTheme();
  const { width: screenWidth } = useWindowDimensions();
  const lastTapRef = useRef(0);
  const [guideOpen, setGuideOpen] = useState(false);
  const [redLineOpen, setRedLineOpen] = useState(false);

  const handlePress = () => {
    const now = Date.now();
    if (now - lastTapRef.current <= 360) {
      lastTapRef.current = 0;
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
      router.setParams({ deepDive: String(now) });
      return;
    }
    lastTapRef.current = now;
  };

  const iceGridButton = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="打开冰格入口"
      hitSlop={8}
      style={isNativeLiquidGlassEnabled ? styles.glassHeaderButtonPressable : [styles.iceGridButton, { backgroundColor: colors.accent + '18', borderColor: colors.accent + '55' }]}
      onPress={onOpenBoards}
    >
      <Ionicons name="grid-outline" size={15} color={colors.accent} />
    </Pressable>
  );

  const helpButton = (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="打开新手教程"
      hitSlop={8}
      style={isNativeLiquidGlassEnabled ? styles.glassHeaderButtonPressable : [styles.helpButton, { backgroundColor: colors.accent + '18', borderColor: colors.accent + '65' }]}
      onPress={() => setGuideOpen(true)}
    >
      <Ionicons name="help" size={14} color={colors.accent} />
    </Pressable>
  );

  return (
    <>
      {isNativeLiquidGlassEnabled ? (
        <NativeLiquidGlassContainer spacing={18} style={[styles.glassHeaderGroup, { width: Math.min(screenWidth - 48, 390) }]}>
          <NativeLiquidGlassView
            glassEffectStyle="regular"
            colorScheme={isDark ? 'dark' : 'light'}
            tintColor={isDark ? 'rgba(35,53,64,0.42)' : 'rgba(245,248,250,0.48)'}
            isInteractive
            style={[
              styles.glassHeaderRoundButton,
              isIOSLiquidGlassEnabled && styles.iosFloatingHeaderGlass,
              isIOSLiquidGlassEnabled && { borderColor: isDark ? 'rgba(181,226,247,0.28)' : 'rgba(255,255,255,0.72)' },
            ]}
          >
            {iceGridButton}
          </NativeLiquidGlassView>
          <NativeLiquidGlassView
            glassEffectStyle="regular"
            colorScheme={isDark ? 'dark' : 'light'}
            tintColor={isDark ? 'rgba(35,53,64,0.42)' : 'rgba(245,248,250,0.48)'}
            isInteractive
            style={[
              styles.glassHeaderTitle,
              isIOSLiquidGlassEnabled && styles.iosFloatingHeaderGlass,
              isIOSLiquidGlassEnabled && { borderColor: isDark ? 'rgba(181,226,247,0.28)' : 'rgba(255,255,255,0.72)' },
            ]}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="双击进入潜流域"
              hitSlop={10}
              onPress={handlePress}
              style={styles.glassHeaderTitleButton}
            >
              <Text style={[styles.headerTitleText, { color: colors.text }]}>浮霜带</Text>
            </Pressable>
          </NativeLiquidGlassView>
          <NativeLiquidGlassView
            glassEffectStyle="regular"
            colorScheme={isDark ? 'dark' : 'light'}
            tintColor={isDark ? 'rgba(35,53,64,0.42)' : 'rgba(245,248,250,0.48)'}
            isInteractive
            style={[
              styles.glassHeaderRoundButton,
              isIOSLiquidGlassEnabled && styles.iosFloatingHeaderGlass,
              isIOSLiquidGlassEnabled && { borderColor: isDark ? 'rgba(181,226,247,0.28)' : 'rgba(255,255,255,0.72)' },
            ]}
          >
            {helpButton}
          </NativeLiquidGlassView>
        </NativeLiquidGlassContainer>
      ) : (
        <View style={styles.headerTitleRow}>
          {iceGridButton}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="双击进入潜流域"
            hitSlop={10}
            onPress={handlePress}
            style={styles.headerTitleButton}
          >
            <Text style={[styles.headerTitleText, { color: colors.text }]}>浮霜带</Text>
          </Pressable>
          {helpButton}
        </View>
      )}

      <Modal visible={guideOpen} transparent animationType="fade" onRequestClose={() => setGuideOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setGuideOpen(false)}>
          <Pressable style={[styles.headerModal, { backgroundColor: colors.card, borderColor: colors.cardBorder }]} onPress={event => event.stopPropagation()}>
            <View style={styles.modalHeading}>
              <View>
                <Text style={[styles.modalTitle, { color: colors.text }]}>新手航行指南</Text>
                <Text style={[styles.modalSubtitle, { color: colors.textMuted }]}>第一次来到肆度，可以从这里开始</Text>
              </View>
              <Pressable accessibilityLabel="关闭新手教程" style={styles.modalClose} onPress={() => setGuideOpen(false)}>
                <Ionicons name="close" size={19} color={colors.textMuted} />
              </Pressable>
            </View>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.guideList}>
              {BEGINNER_GUIDE.map((item, index) => (
                <View key={item.title} style={[styles.guideRow, index > 0 && styles.guideRowSpacing, { backgroundColor: colors.input, borderColor: colors.cardBorder }]}>
                  <View style={[styles.guideIndex, { backgroundColor: colors.accent + '17' }]}>
                    <Text style={[styles.guideIndexText, { color: colors.accent }]}>{index + 1}</Text>
                  </View>
                  <View style={styles.guideCopy}>
                    {item.title === 'red_line' ? <Text style={[styles.guideTitle, { color: colors.text }]}>点击查看<RedLineLink size={13} onPress={() => setRedLineOpen(true)} />，请勿违反红线规则！</Text> : <>
                      <Text style={[styles.guideTitle, { color: colors.text }]}>{item.title}</Text>
                      <Text style={[styles.guideText, { color: colors.textSecondary }]}>{item.text}</Text>
                    </>}
                  </View>
                </View>
              ))}
            </ScrollView>
          </Pressable>
          {Platform.OS === 'ios' ? <RedLineModal visible={redLineOpen} onClose={() => setRedLineOpen(false)} embedded /> : null}
        </Pressable>
      </Modal>
      {Platform.OS !== 'ios' ? <RedLineModal visible={redLineOpen} onClose={() => setRedLineOpen(false)} /> : null}
    </>
  );
}

function IceGridOverlay({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { colors, isDark } = useTheme();
  const { width: screenWidth } = useWindowDimensions();
  const { boards } = useCommunityConfig();
  useEffect(() => {
    if (!visible || Platform.OS !== 'android') return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => subscription.remove();
  }, [onClose, visible]);
  const swipeResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_event, gesture) => Math.abs(gesture.dx) > 12 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.2,
    onPanResponderRelease: (_event, gesture) => {
      if (Math.abs(gesture.dx) >= 55) onClose();
    },
  }), [onClose]);
  if (!visible) return null;
  const visibleBoards = boards.filter(board => board.id !== 'free' && board.id !== 'announce' && board.active !== 0 && board.active !== false);
  const boardCategories = groupBoardsByCategory(visibleBoards);
  const boardColumns = Math.max(4, Math.min(5, Math.floor((screenWidth - 28) / 84)));
  const boardTileWidth = (screenWidth - 28) / boardColumns;
  return (
    <View {...swipeResponder.panHandlers} style={[styles.boardPageOverlay, { bottom: 0, paddingTop: insets.top + 10, backgroundColor: colors.bg }]}>
      <View style={[styles.boardPageHeader, { borderBottomColor: colors.divider }]}>
        <Text style={[styles.boardPageTitle, { color: colors.text }]}>全部冰格</Text>
        <Pressable accessibilityLabel="关闭冰格页面" style={[styles.modalClose, { backgroundColor: colors.input }]} onPress={onClose}>
          <Ionicons name="close" size={20} color={colors.text} />
        </Pressable>
      </View>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={[styles.boardPageContent, { paddingBottom: Math.max(insets.bottom + 112, 126) }]}>
        {boardCategories.map(category => category.boards.length > 0 && (
          <View key={category.name} style={styles.boardCategory}>
            <Text style={[styles.boardCategoryTitle, { color: colors.text }]}>{category.name}</Text>
            <View style={[styles.boardPageGrid, { width: screenWidth - 28 }]}>
              {category.boards.map(board => {
                const boardColor = (isDark ? board.colorDark : board.color) || colors.accent;
                return (
                  <Pressable
                    key={board.id}
                    style={[styles.boardPageButton, { width: boardTileWidth }]}
                    onPress={() => {
                      onClose();
                      router.push({ pathname: '/board/[id]', params: { id: board.id } });
                    }}
                  >
                    <View style={[styles.boardPageIcon, isDark ? { backgroundColor: board.color + '28', borderWidth: 1, borderColor: boardColor + '55' } : { backgroundColor: boardColor }]}>
                      <BoardIcon name={board.icon} size={23} color={isDark ? boardColor : '#FFFFFF'} />
                    </View>
                    <Text style={[styles.boardPageName, { color: colors.text }]} numberOfLines={1}>{board.name}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

function AnimatedTabText({ focused, color, text }: { focused: boolean; color: ColorValue; text: string }) {
  const scale = useRef(new Animated.Value(focused ? 1 : 0.85)).current;
  useEffect(() => {
    Animated.spring(scale, { toValue: focused ? 1 : 0.85, mass: 0.5, stiffness: 260, damping: 12, useNativeDriver: true }).start();
  }, [focused]);
  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Text style={{ fontSize: 17, fontWeight: '700', color: color as string, letterSpacing: -0.5 }}>{text}</Text>
    </Animated.View>
  );
}

/** 三条原生圆角波浪线 */
function WavesIcon({ focused, color }: { focused: boolean; color: ColorValue }) {
  const scale = useRef(new Animated.Value(focused ? 1 : 0.85)).current;
  useEffect(() => {
    Animated.spring(scale, { toValue: focused ? 1 : 0.85, mass: 0.5, stiffness: 260, damping: 12, useNativeDriver: true }).start();
  }, [focused]);
  return (
    <Animated.View style={{ transform: [{ scale }], gap: 3, alignItems: 'center' }}>
      <View style={{ width: 22, height: 3, borderRadius: 1.5, backgroundColor: color as string, opacity: 1 }} />
      <View style={{ width: 16, height: 3, borderRadius: 1.5, backgroundColor: color as string, opacity: 0.75 }} />
      <View style={{ width: 22, height: 3, borderRadius: 1.5, backgroundColor: color as string, opacity: 1 }} />
    </Animated.View>
  );
}

const TAB_ICONS = [
  { route: 'index', title: '浮霜带', activeIcon: 'snow', inactiveIcon: 'snow-outline', customIcon: '4°C' as const },
  { route: 'qianliu', title: '隐海礁', activeIcon: 'layers', inactiveIcon: 'layers-outline' },
  null,
  { route: 'messages', title: '消息', activeIcon: 'chatbubbles', inactiveIcon: 'chatbubbles-outline' },
  { route: 'profile', title: '我的', activeIcon: 'person-circle', inactiveIcon: 'person-circle-outline' },
];

function PublishBtn({ onPress, barBg, accent, isDark }: { onPress: () => void; barBg: string; accent: string; isDark: boolean }) {
  const scale = useRef(new Animated.Value(1)).current;
  const pressIn = () => Animated.spring(scale, { toValue: 0.9, mass: 0.3, stiffness: 400, damping: 10, useNativeDriver: true }).start();
  const pressOut = () => Animated.spring(scale, { toValue: 1, mass: 0.5, stiffness: 300, damping: 14, useNativeDriver: true }).start();

  return (
    <Pressable onPress={onPress} onPressIn={pressIn} onPressOut={pressOut} style={styles.tabBtn}>
      {isNativeLiquidGlassEnabled ? (
        <Animated.View style={[styles.glassFabLift, { transform: [{ scale }] }]}>
          <View style={[styles.glassFab, { backgroundColor: accent + (isDark ? '28' : '1C') }]}>
            <Ionicons name="add" size={30} color={accent} />
          </View>
        </Animated.View>
      ) : (
        <Animated.View style={[styles.fab, { transform: [{ scale }], borderColor: barBg }]}>
          <Ionicons name="add" size={30} color="#FFFFFF" />
        </Animated.View>
      )}
    </Pressable>
  );
}

function CustomTabBar({ state, descriptors, navigation, onNavigate }: any) {
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const { token } = useAuth();
  const router = useRouter();
  const labelColor = (focused: boolean) => focused ? colors.accent : colors.textMuted;
  const lastDoubleTap = useRef(0);
  const activeSlot = useRef(new Animated.Value(state.index < 2 ? state.index : state.index + 1)).current;
  const [glassBarWidth, setGlassBarWidth] = useState(0);

  useEffect(() => {
    const slot = state.index < 2 ? state.index : state.index + 1;
    Animated.spring(activeSlot, {
      toValue: slot,
      mass: 0.56,
      stiffness: 260,
      damping: 24,
      useNativeDriver: true,
    }).start();
  }, [activeSlot, state.index]);

  const ICON_BY_NAME: Record<string, any> = {};
  for (const t of TAB_ICONS) { if (t) ICON_BY_NAME[t.route] = t; }

  // 在 boards 和 messages 之间插入发布按钮
  const items: ({ kind: 'tab'; route: any; index: number } | { kind: 'publish' })[] = [];
  let tabIdx = 0;
  for (const r of state.routes) {
    items.push({ kind: 'tab', route: r, index: tabIdx++ });
    if (r.name === 'qianliu') {
      items.push({ kind: 'publish' });
    }
  }

  const content = (
    <>
      {items.map((item) => {
        if (item.kind === 'publish') {
          return <PublishBtn key="publish" onPress={() => {
            onNavigate?.();
            if (token) {
              navigation.getParent()?.navigate('publish');
            } else {
              navigation.getParent()?.navigate('login');
            }
          }} barBg={colors.tabBar} accent={colors.accent} isDark={isDark} />;
        }
        const { route, index: displayIdx } = item;
        const { options } = descriptors[route.key];
        const info = ICON_BY_NAME[route.name];
        const label = info?.title ?? options.title ?? '';
        const isFocused = state.routes[state.index]?.key === route.key;
        const color = labelColor(isFocused);

        const onPress = () => {
          onNavigate?.();
          if (route.name === 'profile' && !token) {
            navigation.navigate('index');
            navigation.getParent()?.navigate('login');
            return;
          }
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!isFocused && !event.defaultPrevented) {
            navigation.navigate(route.name, route.params);
            return;
          }
          // 双击浮霜带 → 永冻层（隐藏彩蛋）
          if (isFocused && route.name === 'index') {
            const now = Date.now();
            if (now - lastDoubleTap.current < 400) {
              lastDoubleTap.current = 0;
              void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
              reportAchievementEvent('ground_state').catch(() => {});
              router.push('/boards');
              return;
            }
            lastDoubleTap.current = now;
          }
        };

        return (
          <Pressable
            key={route.key}
            onPress={onPress}
            onPressIn={() => {
              if (!isNativeLiquidGlassEnabled) return;
              const slot = displayIdx < 2 ? displayIdx : displayIdx + 1;
              Animated.spring(activeSlot, {
                toValue: slot,
                mass: 0.42,
                stiffness: 360,
                damping: 26,
                useNativeDriver: true,
              }).start();
            }}
            style={styles.tabBtn}
          >
            <View style={styles.iconWrap}>
            {info?.wavesIcon ? (
              <WavesIcon focused={isFocused} color={color} />
            ) : info?.customIcon ? (
              <AnimatedTabText focused={isFocused} color={color} text={info.customIcon} />
            ) : (
              <AnimatedTabIcon
                focused={isFocused}
                color={color}
                size={24}
                activeIcon={info?.activeIcon ?? 'help'}
                inactiveIcon={info?.inactiveIcon ?? 'help-outline'}
              />
            )}
            </View>
            <Text style={[styles.label, { color }]}>{label}</Text>
          </Pressable>
        );
      })}
    </>
  );

  if (isNativeLiquidGlassEnabled) {
    const slotWidth = glassBarWidth / 5;
    return (
      <NativeLiquidGlassView
        glassEffectStyle="regular"
        colorScheme={isDark ? 'dark' : 'light'}
        isInteractive
        style={[styles.bar, styles.glassBar, { marginBottom: Math.max(insets.bottom - 6, 8) }]}
        onLayout={(event) => setGlassBarWidth(event.nativeEvent.layout.width)}
      >
        {slotWidth > 0 ? (
          <Animated.View
            pointerEvents="none"
            style={[
              styles.glassTabBubbleMotion,
              {
                width: slotWidth - 8,
                transform: [{
                  translateX: activeSlot.interpolate({
                    inputRange: [0, 4],
                    outputRange: [4, 4 + slotWidth * 4],
                  }),
                }],
              },
            ]}
          >
            <NativeLiquidGlassView
              glassEffectStyle="clear"
              colorScheme={isDark ? 'dark' : 'light'}
              isInteractive
              style={styles.glassTabBubble}
            />
          </Animated.View>
        ) : null}
        {content}
      </NativeLiquidGlassView>
    );
  }

  return (
    <View style={[styles.bar, { backgroundColor: colors.tabBar, borderTopWidth: 1, borderTopColor: colors.tabBarBorder }]}>
      {content}
    </View>
  );
}

export default function RootLayout() {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const pathname = usePathname();
  const [boardsOpen, setBoardsOpen] = useState(false);
  const [floatingHeaderReady, setFloatingHeaderReady] = useState(false);
  const isFloatingBandRoute = pathname === '/' || pathname === '/index';
  useEffect(() => {
    setFloatingHeaderReady(false);
    if (!isFloatingBandRoute || boardsOpen) return;
    const timer = setTimeout(() => setFloatingHeaderReady(true), 100);
    return () => clearTimeout(timer);
  }, [boardsOpen, isFloatingBandRoute]);
  return (
    <View style={styles.root}>
      <Tabs
        tabBar={(props) => <CustomTabBar {...props} onNavigate={() => setBoardsOpen(false)} />}
        screenOptions={{
          headerTitleAlign: 'center',
          headerShadowVisible: false,
          headerStyle: { backgroundColor: colors.header },
          headerTitleStyle: { fontSize: 17, fontWeight: '600', color: colors.text },
          sceneStyle: { backgroundColor: colors.bg },
        }}
      >
        <Tabs.Screen name="index" options={{
          title: '浮霜带',
          headerShown: !isNativeLiquidGlassEnabled,
          headerTitleContainerStyle: { left: 8, right: 8 },
          headerTitle: isNativeLiquidGlassEnabled ? undefined : () => <FloatingBandTitle onOpenBoards={() => setBoardsOpen(true)} />,
        }} />
        <Tabs.Screen name="qianliu" options={{ title: '隐海礁', headerShown: false }} />
        <Tabs.Screen name="messages" options={{ title: '消息', headerShown: !isNativeLiquidGlassEnabled }} />
        <Tabs.Screen name="profile" options={{ title: '我的', headerShown: false }} />
      </Tabs>
      {isNativeLiquidGlassEnabled ? (
        <View
          pointerEvents={isFloatingBandRoute && !boardsOpen && floatingHeaderReady ? 'box-none' : 'none'}
          style={[styles.floatingBandHeaderOverlay, { top: insets.top + 7, opacity: isFloatingBandRoute && !boardsOpen && floatingHeaderReady ? 1 : 0 }]}
        >
          <FloatingBandTitle onOpenBoards={() => setBoardsOpen(true)} />
        </View>
      ) : null}
      <IceGridOverlay visible={boardsOpen} onClose={() => setBoardsOpen(false)} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  floatingBandHeaderOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 320,
    elevation: 320,
  },
  bar: {
    flexDirection: 'row',
    paddingBottom: Platform.OS === 'ios' ? 30 : 12,
    paddingTop: 6,
    position: 'relative',
    zIndex: 200,
    elevation: 200,
  },
  tabBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingVertical: 5,
  },
  iconWrap: { height: 26, justifyContent: 'center', alignItems: 'center' },
  label: { fontSize: 11, marginTop: 2 },
  fab: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#33A9DC',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -11,
    borderWidth: 4,
    borderColor: '#FFFFFF',
  },
  glassBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    marginHorizontal: 12,
    paddingTop: 8,
    paddingBottom: 8,
    borderRadius: 32,
    overflow: 'hidden',
  },
  glassTabBubbleMotion: {
    position: 'absolute',
    top: 4,
    bottom: 4,
    left: 0,
  },
  glassTabBubble: {
    flex: 1,
    borderRadius: 27,
    overflow: 'hidden',
  },
  glassFabLift: {
    width: 58,
    height: 58,
    borderRadius: 29,
    marginTop: -12,
    top: 2,
  },
  glassFab: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  headerTitleRow: { width: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  iceGridButton: { width: 29, height: 29, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center', transform: [{ translateX: -6 }] },
  helpButton: { width: 29, height: 29, borderRadius: 15, borderWidth: 1, alignItems: 'center', justifyContent: 'center', transform: [{ translateX: -8 }] },
  glassHeaderGroup: { height: 36, alignSelf: 'center', flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  glassHeaderRoundButton: { width: 34, height: 34, borderRadius: 17 },
  glassHeaderTitle: { width: 108, height: 36, borderRadius: 18 },
  iosFloatingHeaderGlass: {
    borderWidth: StyleSheet.hairlineWidth,
    shadowColor: '#000000',
    shadowOpacity: 0.22,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
  },
  glassHeaderButtonPressable: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  glassHeaderTitleButton: { flex: 1, height: 36, alignItems: 'center', justifyContent: 'center' },
  headerTitleButton: { paddingHorizontal: 9, paddingVertical: 8, transform: [{ translateX: -7 }] },
  headerTitleText: { width: '100%', fontSize: 17, lineHeight: 22, fontWeight: '600', textAlign: 'center', textAlignVertical: 'center', includeFontPadding: false },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.42)', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 22, paddingVertical: 44 },
  headerModal: { width: '100%', maxWidth: 390, maxHeight: '78%', borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, padding: 16 },
  modalHeading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  modalTitle: { fontSize: 17, lineHeight: 23, fontWeight: '700' },
  modalSubtitle: { fontSize: 11, lineHeight: 17, marginTop: 2 },
  modalClose: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  boardGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingBottom: 2 },
  boardButton: { width: '31.5%', minHeight: 72, borderRadius: 8, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 9, alignItems: 'center', justifyContent: 'center' },
  boardIcon: { width: 31, height: 31, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  boardName: { width: '100%', marginTop: 6, fontSize: 11, lineHeight: 16, fontWeight: '600', textAlign: 'center' },
  boardPageOverlay: { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 100, elevation: 20 },
  boardPageHeader: { minHeight: 54, paddingHorizontal: 18, paddingBottom: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderBottomWidth: StyleSheet.hairlineWidth },
  boardPageTitle: { fontSize: 20, lineHeight: 27, fontWeight: '800' },
  boardPageContent: { paddingHorizontal: 14, paddingTop: 13, paddingBottom: 26 },
  boardCategory: { marginBottom: 16 },
  boardCategoryTitle: { marginLeft: 4, marginBottom: 11, fontSize: 15, lineHeight: 21, fontWeight: '800' },
  boardPageGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  boardPageButton: { alignItems: 'center', marginBottom: 18 },
  boardPageIcon: { width: 48, height: 48, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  boardPageName: { width: '100%', marginTop: 6, textAlign: 'center', fontSize: 11, fontWeight: '600' },
  guideList: { width: '100%', paddingBottom: 2 },
  guideRow: { alignSelf: 'stretch', minHeight: 42, paddingHorizontal: 9, paddingVertical: 8, borderWidth: StyleSheet.hairlineWidth, borderRadius: 10, flexDirection: 'row', alignItems: 'flex-start', gap: 7 },
  guideRowSpacing: { marginTop: 8 },
  guideIndex: { width: 20, height: 20, flexShrink: 0, borderRadius: 7, alignItems: 'center', justifyContent: 'center' },
  guideIndexText: { fontSize: 10, fontWeight: '800' },
  guideCopy: { flex: 1, minWidth: 0 },
  guideTitle: { fontSize: 12, lineHeight: 18, fontWeight: '700', includeFontPadding: false },
  guideTitleInline: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' },
  guideText: { marginTop: 2, fontSize: 12, lineHeight: 18, includeFontPadding: false },
});
