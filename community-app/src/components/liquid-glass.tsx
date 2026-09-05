import { GlassContainer, GlassView, isGlassEffectAPIAvailable, isLiquidGlassAvailable } from 'expo-glass-effect';
import { forwardRef, useRef, useState, type ComponentProps } from 'react';
import { Animated, Platform, StyleSheet, useColorScheme, View, type ViewStyle } from 'react-native';
import { SiduNativeGlassSurface } from '@/components/sidu-native-glass';

export const isIOSLiquidGlassEnabled =
  Platform.OS === 'ios' &&
  isGlassEffectAPIAvailable() &&
  isLiquidGlassAvailable();

// Android does not expose Apple's GlassView, so it uses the shared material
// implementation below. Keeping this flag platform-level lets every existing
// glass surface participate without duplicating screen layouts.
export const isAndroidLiquidGlassEnabled = Platform.OS === 'android';
export const isLiquidGlassEnabled = isIOSLiquidGlassEnabled || isAndroidLiquidGlassEnabled;

// Keep the existing export name so current screens stay source-compatible.
export const isNativeLiquidGlassEnabled = isLiquidGlassEnabled;

export type NativeLiquidGlassViewProps = ComponentProps<typeof GlassView>;

const AndroidLiquidGlassView = forwardRef<View, NativeLiquidGlassViewProps>(function AndroidLiquidGlassView(props, ref) {
  const {
    children,
    style,
    glassEffectStyle = 'regular',
    colorScheme = 'auto',
    tintColor,
    isInteractive,
    onTouchStart,
    onTouchEnd,
    onTouchCancel,
    ...viewProps
  } = props;
  const [pressed, setPressed] = useState(false);
  const pressLift = useRef(new Animated.Value(0)).current;
  const systemScheme = useColorScheme();
  const isDark = colorScheme === 'dark' || (colorScheme === 'auto' && systemScheme === 'dark');
  const effectStyle = typeof glassEffectStyle === 'object' ? glassEffectStyle.style : glassEffectStyle;
  const flattenedStyle = StyleSheet.flatten(style) as ViewStyle | undefined;
  const radius = typeof flattenedStyle?.borderRadius === 'number' ? flattenedStyle.borderRadius : 20;
  const isClear = effectStyle === 'clear';
  const pressLiftStyle = isInteractive ? {
    transform: [
      { scale: pressLift.interpolate({ inputRange: [0, 1], outputRange: [1, 1.025] }) },
      { translateY: pressLift.interpolate({ inputRange: [0, 1], outputRange: [0, -1.5] }) },
    ],
  } : undefined;
  const animatePress = (nextPressed: boolean) => {
    if (!isInteractive) return;
    setPressed(nextPressed);
    Animated.spring(pressLift, {
      toValue: nextPressed ? 1 : 0,
      mass: 0.45,
      stiffness: 330,
      damping: 22,
      useNativeDriver: true,
    }).start();
  };
  const nativeSurface = SiduNativeGlassSurface ? (
    <SiduNativeGlassSurface
      pointerEvents="none"
      variant={isClear ? 'clear' : 'regular'}
      dark={isDark}
      pressed={pressed}
      cornerRadius={radius}
      useBackdrop={!isClear}
      style={[StyleSheet.absoluteFill, { borderRadius: radius }]}
    />
  ) : null;

  if (isClear) {
    return (
      <Animated.View
        ref={ref}
        {...viewProps}
        onTouchStart={event => {
          animatePress(true);
          onTouchStart?.(event);
        }}
        onTouchEnd={event => {
          animatePress(false);
          onTouchEnd?.(event);
        }}
        onTouchCancel={event => {
          animatePress(false);
          onTouchCancel?.(event);
        }}
        style={[style, {
          borderRadius: radius,
          overflow: 'hidden',
          borderWidth: nativeSurface ? 0 : StyleSheet.hairlineWidth,
          borderColor: isDark ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.46)',
          backgroundColor: nativeSurface ? 'transparent' : isDark ? 'rgba(255,255,255,0.08)' : 'rgba(104,112,122,0.08)',
        }, pressLiftStyle]}
      >
        {nativeSurface}
        {children}
      </Animated.View>
    );
  }

  return (
    <Animated.View
      ref={ref}
      {...viewProps}
      onTouchStart={event => {
        animatePress(true);
        onTouchStart?.(event);
      }}
      onTouchEnd={event => {
        animatePress(false);
        onTouchEnd?.(event);
      }}
      onTouchCancel={event => {
        animatePress(false);
        onTouchCancel?.(event);
      }}
      style={[
        styles.androidGlass,
        {
          borderRadius: radius,
          borderColor: nativeSurface ? 'transparent' : isDark ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.72)',
          elevation: 0,
          backgroundColor: nativeSurface ? 'transparent' : isDark
            ? pressed ? 'rgba(255,255,255,0.16)' : 'rgba(255,255,255,0.10)'
            : pressed ? 'rgba(255,255,255,0.84)' : 'rgba(255,255,255,0.76)',
        },
        style,
        // Android's hardware clip path can draw a horizontal seam on nested rounded views.
        { overflow: 'visible', elevation: 0, shadowOpacity: 0, shadowRadius: 0, shadowColor: 'transparent' },
        pressLiftStyle,
      ]}
    >
      {nativeSurface}
      {tintColor ? (
        <View
          pointerEvents="none"
          style={[StyleSheet.absoluteFill, {
            borderRadius: radius,
            backgroundColor: tintColor,
            opacity: isClear ? (isDark ? 0.11 : 0.08) : (isDark ? 0.16 : 0.12),
          }]}
        />
      ) : null}
      {!nativeSurface ? <View
        pointerEvents="none"
        style={[
          StyleSheet.absoluteFill,
          {
            borderRadius: radius,
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: isDark ? 'rgba(255,255,255,0.09)' : 'rgba(255,255,255,0.34)',
          },
        ]}
      /> : null}
      {children}
    </Animated.View>
  );
});

const AndroidLiquidGlassContainer = forwardRef<View, ComponentProps<typeof GlassContainer>>(function AndroidLiquidGlassContainer(props, ref) {
  const { spacing: _spacing, ...viewProps } = props;
  return <View ref={ref} {...viewProps} />;
});

const AnimatedGlassView = Animated.createAnimatedComponent(GlassView);

const IOSLiquidGlassView = forwardRef<View, NativeLiquidGlassViewProps>(function IOSLiquidGlassView(props, ref) {
  const { children, style, isInteractive, onTouchStart, onTouchEnd, onTouchCancel, ...glassProps } = props;
  const bounce = useRef(new Animated.Value(0)).current;
  if (!isInteractive) return <GlassView ref={ref} {...props} />;
  const bounceStyle = {
    transform: [{ scale: bounce.interpolate({ inputRange: [0, 1], outputRange: [1, 1.025] }) }],
  };
  const animatePress = (active: boolean) => {
    Animated.spring(bounce, {
      toValue: active ? 1 : 0,
      mass: 0.42,
      stiffness: 360,
      damping: 23,
      useNativeDriver: true,
    }).start();
  };
  return (
    <AnimatedGlassView
      ref={ref as any}
      {...glassProps}
      isInteractive
      onStartShouldSetResponderCapture={() => {
        animatePress(true);
        return false;
      }}
      onResponderRelease={() => animatePress(false)}
      onResponderTerminate={() => animatePress(false)}
      onTouchStart={event => {
        animatePress(true);
        onTouchStart?.(event);
      }}
      onTouchEnd={event => {
        animatePress(false);
        onTouchEnd?.(event);
      }}
      onTouchCancel={event => {
        animatePress(false);
        onTouchCancel?.(event);
      }}
      style={[style, bounceStyle] as any}
    >
      {children}
    </AnimatedGlassView>
  );
});

export const NativeLiquidGlassView = isAndroidLiquidGlassEnabled
  ? AndroidLiquidGlassView
  : isIOSLiquidGlassEnabled
    ? IOSLiquidGlassView
    : GlassView;
export const NativeLiquidGlassContainer = isAndroidLiquidGlassEnabled ? AndroidLiquidGlassContainer : GlassContainer;

const styles = StyleSheet.create({
  androidGlass: {
    backgroundColor: 'transparent',
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
  },
});
