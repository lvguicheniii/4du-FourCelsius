import { ReactNode } from 'react';
import { Platform, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import Animated, { useAnimatedKeyboard, useAnimatedStyle } from 'react-native-reanimated';

/**
 * 吸附在键盘顶部的底栏容器。
 *
 * 原理：useAnimatedKeyboard 通过系统窗口 inset 动画逐帧跟踪键盘的真实高度，
 * 而不是依赖 keyboardDidShow 一次性上报的高度值，因此对任何输入法
 * （不同厂商键盘、第三方输入法、中途切换输入法、表情面板高度变化）都能动态贴合，
 * 不需要任何硬编码偏移量。
 */
export function KeyboardSticky({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  if (Platform.OS === 'web') {
    // web 预览中软键盘不会遮挡视口，固定在底部即可
    return <View style={[styles.base, style]}>{children}</View>;
  }
  return <KeyboardStickyNative style={style}>{children}</KeyboardStickyNative>;
}

/**
 * Keeps normal flex layout while reserving the keyboard inset frame by frame.
 * Use this when a message list and its composer must resize together.
 */
export function KeyboardInsetView({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  if (Platform.OS === 'web') return <View style={[styles.flex, style]}>{children}</View>;
  return <KeyboardInsetViewNative style={style}>{children}</KeyboardInsetViewNative>;
}

function KeyboardInsetViewNative({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const keyboard = useAnimatedKeyboard();
  const animatedStyle = useAnimatedStyle(() => ({ paddingBottom: keyboard.height.value }));
  return <Animated.View style={[styles.flex, animatedStyle, style]}>{children}</Animated.View>;
}

function KeyboardStickyNative({ children, style }: { children: ReactNode; style?: ViewStyle }) {
  const keyboard = useAnimatedKeyboard();
  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -keyboard.height.value }],
  }));
  return <Animated.View style={[styles.base, animatedStyle, style]}>{children}</Animated.View>;
}

const styles = StyleSheet.create({
  base: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  flex: { flex: 1 },
});
