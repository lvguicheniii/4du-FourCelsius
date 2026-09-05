import { useEffect, useMemo, useRef } from 'react';
import { Animated, PanResponder, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

const MIN_AGE = 0;
const MAX_AGE = 444;
const AGE_COUNT = MAX_AGE - MIN_AGE + 1;
const ITEM_HEIGHT = 42;
const VISIBLE_ITEMS = 3;
const VISIBLE_OFFSETS = [-2, -1, 0, 1, 2];

function wrapAge(age: number) {
  return ((age - MIN_AGE) % AGE_COUNT + AGE_COUNT) % AGE_COUNT + MIN_AGE;
}

type AgeDescription = {
  title: string;
  detail: string;
};

export function getAgeDescription(age: number): AgeDescription {
  if (age <= 5) return { title: '纯净碳基样本', detail: '尚未受到互联网复杂情绪污染，处于出厂默认状态' };
  if (age <= 12) return { title: '幼年探测器', detail: '正在执行“九年义务教育”主线任务，请注意保护视力' };
  if (age <= 16) return { title: '高频波动区', detail: '观测到极强的心智成长能量，俗称“青春期乱流”' };
  if (age === 17) return { title: '临界准备态', detail: '倒计时加载中，您还有一年即可解除所有深海探索限制' };
  if (age === 18) return { title: '万能伪装刻度', detail: '数据表明，这是全网被借用次数最多的人工降龄数值' };
  if (age <= 22) return { title: '生物钟紊乱样本', detail: '根据算法，该年龄段极易在凌晨3点的深海中活跃出没' };
  if (age <= 26) return { title: '初入洋流区', detail: '正在经历现实世界的引力重塑，请带好您的赛博氧气瓶' };
  if (age <= 30) return { title: '咖啡因驱动体', detail: '靠冰美式维持日常运转，正在努力抵抗精神下沉' };
  if (age <= 35) return { title: '硬件过保修期', detail: '善意提醒：请注意保养您的颈椎和腰椎，深海水压较大' };
  if (age <= 45) return { title: '恒温心智带', detail: '恭喜！您已成功解锁“情绪稳定”与“心如止水”双重成就' };
  if (age <= 60) return { title: '资深潜水员', detail: '已看透世俗洋流，对绝大多数互联网无效内耗完全免疫' };
  if (age <= 80) return { title: '优雅降速区', detail: '正在享受真正的“慢放”时光，生活节奏平稳且从容' };
  if (age <= 99) return { title: 'SSR级高阶样本', detail: '您的每一次打字，都是极为珍贵的人类行为学观测记录' };
  if (age <= 149) return { title: '跨世纪航行者', detail: '您好，百岁先驱！纯好奇，深海里真的能修仙吗？' };
  if (age <= 199) return { title: '生物学报错', detail: '系统算不明白了，难道您是哪位吸血鬼伯爵在偷偷上网？' };
  if (age <= 299) return { title: '历史见证者', detail: '您的同龄人基本都在博物馆里，而您还在潜流区快乐冲浪' };
  if (age <= 399) return { title: '神话级机体', detail: '正在呼叫碳基生命科学研究所……这里发现了一个不可思议的奇迹' };
  if (age <= 443) return { title: '远古深海巨兽', detail: '警告：您的长寿已引起深海古神的注意，请谨慎散发脑电波' };
  return { title: 'Error 444', detail: '观测对象已跳出三界外，不在五行中！数据严重溢出，本系统决定放弃思考' };
}

export function AgeWheelPicker({
  value,
  onChange,
  onInteractionChange,
  onValueCommit,
  palette,
}: {
  value: number;
  onChange: (age: number) => void;
  onInteractionChange?: (active: boolean) => void;
  onValueCommit?: (age: number) => void;
  palette?: {
    text: string;
    textMuted: string;
    accent: string;
    divider: string;
  };
}) {
  const valueRef = useRef(value);
  const onChangeRef = useRef(onChange);
  const onInteractionChangeRef = useRef(onInteractionChange);
  const onValueCommitRef = useRef(onValueCommit);
  const dragStartAgeRef = useRef(value);
  const motionY = useRef(new Animated.Value(0)).current;
  const offsetY = useRef(new Animated.Value(0)).current;
  const motionAnimationRef = useRef<Animated.CompositeAnimation | null>(null);
  const settleAnimationRef = useRef<Animated.CompositeAnimation | null>(null);
  const interactionIdRef = useRef(0);
  const lastHapticAtRef = useRef(0);
  valueRef.current = value;
  onChangeRef.current = onChange;
  onInteractionChangeRef.current = onInteractionChange;
  onValueCommitRef.current = onValueCommit;
  const description = useMemo(() => getAgeDescription(value), [value]);

  useEffect(() => {
    const listenerId = motionY.addListener(({ value: distance }) => {
      const steps = -Math.round(distance / ITEM_HEIGHT);
      const nextAge = wrapAge(dragStartAgeRef.current + steps);
      offsetY.setValue(distance + steps * ITEM_HEIGHT);
      if (nextAge !== valueRef.current) {
        valueRef.current = nextAge;
        onChangeRef.current(nextAge);
        const now = Date.now();
        if (now - lastHapticAtRef.current >= 24) {
          lastHapticAtRef.current = now;
          Haptics.selectionAsync().catch(() => {});
        }
      }
    });
    return () => {
      interactionIdRef.current += 1;
      motionAnimationRef.current?.stop();
      settleAnimationRef.current?.stop();
      motionY.stopAnimation();
      motionY.removeListener(listenerId);
      onInteractionChangeRef.current?.(false);
    };
  }, [motionY, offsetY]);

  const settleWheel = () => {
    settleAnimationRef.current?.stop();
    const animation = Animated.spring(offsetY, {
      toValue: 0,
      tension: 170,
      friction: 19,
      useNativeDriver: false,
    });
    settleAnimationRef.current = animation;
    animation.start(({ finished }) => {
      if (finished) onValueCommitRef.current?.(valueRef.current);
    });
  };

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onStartShouldSetPanResponderCapture: () => true,
    onMoveShouldSetPanResponder: (_event, gesture) =>
      Math.abs(gesture.dy) > 1 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
    onMoveShouldSetPanResponderCapture: (_event, gesture) =>
      Math.abs(gesture.dy) > 1 && Math.abs(gesture.dy) > Math.abs(gesture.dx),
    onPanResponderGrant: () => {
      interactionIdRef.current += 1;
      onInteractionChangeRef.current?.(true);
      dragStartAgeRef.current = valueRef.current;
      motionAnimationRef.current?.stop();
      settleAnimationRef.current?.stop();
      motionY.stopAnimation();
      offsetY.stopAnimation();
      motionY.setValue(0);
      offsetY.setValue(0);
    },
    onPanResponderMove: (_event, gesture) => {
      motionY.setValue(gesture.dy);
    },
    onPanResponderRelease: (_event, gesture) => {
      onInteractionChangeRef.current?.(false);
      motionY.setValue(gesture.dy);
      if (Math.abs(gesture.vy) < 0.05) {
        settleWheel();
        return;
      }
      const interactionId = interactionIdRef.current;
      const animation = Animated.decay(motionY, {
        velocity: gesture.vy,
        deceleration: 0.995,
        useNativeDriver: false,
      });
      motionAnimationRef.current = animation;
      animation.start(({ finished }) => {
        if (finished && interactionId === interactionIdRef.current) settleWheel();
      });
    },
    onPanResponderTerminate: () => {
      interactionIdRef.current += 1;
      onInteractionChangeRef.current?.(false);
      motionAnimationRef.current?.stop();
      motionY.stopAnimation();
      settleWheel();
    },
    onPanResponderTerminationRequest: () => false,
    onShouldBlockNativeResponder: () => true,
  }), [motionY, offsetY]);

  return (
    <View style={styles.section}>
      <Ionicons name="calendar-outline" size={18} color={palette?.textMuted || '#6B7185'} style={styles.icon} />
      <Text style={[styles.label, palette && { color: palette.textMuted }]}>年龄</Text>
      <View pointerEvents="none" style={styles.description}>
        <Text style={[styles.descriptionTitle, palette && { color: palette.accent }]} numberOfLines={1}>{description.title}</Text>
        <Text style={[styles.descriptionDetail, palette && { color: palette.textMuted }]} numberOfLines={3}>{description.detail}</Text>
      </View>
      <View
        style={styles.wheel}
        accessibilityRole="adjustable"
        accessibilityLabel={`年龄 ${value} 岁`}
        {...panResponder.panHandlers}
      >
        <View pointerEvents="none" style={[
          styles.selection,
          palette && {
            borderColor: palette.accent + '66',
            backgroundColor: palette.accent + '0A',
          },
        ]} />
        <Animated.View style={[styles.items, { transform: [{ translateY: offsetY }] }]}>
          {VISIBLE_OFFSETS.map(relativeOffset => {
            const age = wrapAge(value + relativeOffset);
            return (
              <View key={relativeOffset} style={styles.item}>
                <Text style={[
                  styles.age,
                  palette && { color: palette.textMuted + '90' },
                  relativeOffset === 0 && styles.ageSelected,
                  relativeOffset === 0 && palette && { color: palette.accent },
                ]}>
                  {age}
                </Text>
              </View>
            );
          })}
        </Animated.View>
        <Text pointerEvents="none" style={[styles.unit, palette && { color: palette.textMuted }]}>岁</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    minHeight: ITEM_HEIGHT * VISIBLE_ITEMS,
    flexDirection: 'row',
    alignItems: 'center',
    borderBottomWidth: 1,
    borderBottomColor: '#F2F3F7',
    paddingVertical: 6,
    marginBottom: 8,
  },
  icon: { marginRight: 8 },
  label: { width: 42, fontSize: 14, color: '#6B7185' },
  wheel: {
    width: 76,
    height: ITEM_HEIGHT * VISIBLE_ITEMS,
    overflow: 'hidden',
  },
  items: { position: 'absolute', top: -ITEM_HEIGHT, left: 0, right: 0 },
  item: { height: ITEM_HEIGHT, alignItems: 'center', justifyContent: 'center', paddingRight: 18 },
  age: { fontSize: 16, color: '#A8ADBA', fontVariant: ['tabular-nums'] },
  ageSelected: { fontSize: 20, color: '#33A9DC', fontWeight: '700' },
  selection: {
    position: 'absolute',
    zIndex: 1,
    top: ITEM_HEIGHT,
    left: 4,
    right: 18,
    height: ITEM_HEIGHT,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#33A9DC66',
    backgroundColor: '#33A9DC0A',
    borderRadius: 8,
  },
  unit: {
    position: 'absolute',
    zIndex: 2,
    right: 1,
    top: ITEM_HEIGHT,
    height: ITEM_HEIGHT,
    lineHeight: ITEM_HEIGHT,
    fontSize: 12,
    color: '#6B7185',
  },
  description: { flex: 1, minWidth: 0, marginLeft: 2, marginRight: 6, justifyContent: 'center' },
  descriptionTitle: { color: '#33A9DC', fontSize: 11, lineHeight: 16, fontWeight: '700' },
  descriptionDetail: { color: '#6B7185', fontSize: 10, lineHeight: 15, marginTop: 2 },
});
