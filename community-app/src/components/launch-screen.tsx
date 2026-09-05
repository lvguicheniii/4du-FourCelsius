import { useCallback, useEffect, useRef } from 'react';
import { StyleSheet, Text, useColorScheme, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import * as SplashScreen from 'expo-splash-screen';

const DISPLAY_DURATION_MS = 1400;

type LaunchScreenProps = {
  onFinish: () => void;
};

export function LaunchScreen({ onFinish }: LaunchScreenProps) {
  const isDark = useColorScheme() === 'dark';
  const nativeSplashHidden = useRef(false);
  const finishTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (finishTimer.current) clearTimeout(finishTimer.current);
  }, []);

  const hideNativeSplash = useCallback(() => {
    if (nativeSplashHidden.current) return;
    nativeSplashHidden.current = true;

    void SplashScreen.hideAsync()
      .catch(() => {})
      .finally(() => {
        finishTimer.current = setTimeout(onFinish, DISPLAY_DURATION_MS);
      });
  }, [onFinish]);

  const palette = isDark
    ? {
        background: '#101820', quote: '#7FD8F5', source: '#91A8B4',
        line: 'rgba(127,216,245,0.18)', lineSoft: 'rgba(127,216,245,0.08)',
        surface: 'rgba(127,216,245,0.035)', point: '#7FD8F5',
      }
    : {
        background: '#F4F9FC', quote: '#279BC9', source: '#627D8A',
        line: 'rgba(51,169,220,0.18)', lineSoft: 'rgba(51,169,220,0.08)',
        surface: 'rgba(51,169,220,0.035)', point: '#33A9DC',
      };

  return (
    <View
      accessibilityRole="text"
      accessibilityLabel="凡真实的人生，皆为相遇。马丁·布伯《我与你》"
      onLayout={hideNativeSplash}
      style={[styles.screen, { backgroundColor: palette.background }]}
    >
      <StatusBar style={isDark ? 'light' : 'dark'} />
      <View pointerEvents="none" style={styles.decorationLayer}>
        <View style={[styles.topSurface, { backgroundColor: palette.surface }]} />
        <View style={[styles.bottomSurface, { backgroundColor: palette.surface }]} />
        <View style={[styles.topOrbit, { borderColor: palette.line }]} />
        <View style={[styles.topOrbitInner, { borderColor: palette.lineSoft }]} />
        <View style={[styles.bottomOrbit, { borderColor: palette.line }]} />
        <View style={[styles.bottomOrbitInner, { borderColor: palette.lineSoft }]} />
        <View style={[styles.pathLeft, { backgroundColor: palette.line }]} />
        <View style={[styles.pathRight, { backgroundColor: palette.line }]} />
        <View style={[styles.meetingPointOuter, { borderColor: palette.line }]}>
          <View style={[styles.meetingPointInner, { backgroundColor: palette.point }]} />
        </View>
      </View>
      <View style={styles.quoteBlock}>
        <Text adjustsFontSizeToFit numberOfLines={1} minimumFontScale={0.82} style={[styles.quote, { color: palette.quote }]}>
          “凡真实的人生，皆为相遇。”
        </Text>
        <Text style={[styles.source, { color: palette.source }]}>——马丁·布伯《我与你》</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: 10000,
    elevation: 10000,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  decorationLayer: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  topSurface: {
    position: 'absolute',
    width: 310,
    height: 310,
    borderRadius: 155,
    top: -126,
    left: -118,
  },
  bottomSurface: {
    position: 'absolute',
    width: 360,
    height: 360,
    borderRadius: 180,
    right: -164,
    bottom: -138,
  },
  topOrbit: {
    position: 'absolute',
    width: 390,
    height: 390,
    borderRadius: 195,
    borderWidth: 1,
    top: -176,
    left: -208,
  },
  topOrbitInner: {
    position: 'absolute',
    width: 290,
    height: 290,
    borderRadius: 145,
    borderWidth: 1,
    top: -126,
    left: -158,
  },
  bottomOrbit: {
    position: 'absolute',
    width: 430,
    height: 430,
    borderRadius: 215,
    borderWidth: 1,
    right: -228,
    bottom: -188,
  },
  bottomOrbitInner: {
    position: 'absolute',
    width: 320,
    height: 320,
    borderRadius: 160,
    borderWidth: 1,
    right: -173,
    bottom: -133,
  },
  pathLeft: {
    position: 'absolute',
    width: '47%',
    height: StyleSheet.hairlineWidth,
    left: '-9%',
    top: '39%',
    transform: [{ rotate: '17deg' }],
  },
  pathRight: {
    position: 'absolute',
    width: '47%',
    height: StyleSheet.hairlineWidth,
    right: '-9%',
    bottom: '39%',
    transform: [{ rotate: '17deg' }],
  },
  meetingPointOuter: {
    position: 'absolute',
    top: '40%',
    left: '50%',
    width: 18,
    height: 18,
    marginLeft: -9,
    borderRadius: 9,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  meetingPointInner: {
    width: 4,
    height: 4,
    borderRadius: 2,
  },
  quoteBlock: {
    width: '100%',
    maxWidth: 440,
    paddingHorizontal: 8,
  },
  quote: {
    fontSize: 23,
    lineHeight: 34,
    fontStyle: 'italic',
    fontWeight: '500',
    letterSpacing: 0.7,
    textAlign: 'center',
  },
  source: {
    marginTop: 18,
    paddingRight: 4,
    fontSize: 13,
    lineHeight: 20,
    letterSpacing: 0.2,
    textAlign: 'right',
  },
});
