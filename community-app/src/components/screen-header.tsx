import { View, Text, StyleSheet } from 'react-native';
import { Pressable } from '@/components/pressable';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/lib/theme';
import { isNativeLiquidGlassEnabled, NativeLiquidGlassView } from '@/components/liquid-glass';
import type { Href } from 'expo-router';

type Props = {
  title: string;
  center?: React.ReactNode;
  right?: React.ReactNode;
  rightWidth?: number;
  onTitlePress?: () => void;
  backFallback?: Href;
  onBack?: () => void;
  floating?: boolean;
  floatingSpacer?: number;
};

export function ScreenHeader({ title, center, right, rightWidth = 34, onTitlePress, backFallback, onBack, floating = false, floatingSpacer = 88 }: Props) {
  const router = useRouter();
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const goBack = () => {
    if (onBack) {
      onBack();
      return;
    }
    if (router.canGoBack()) {
      router.back();
      return;
    }
    router.replace(backFallback ?? '/');
  };
  if (isNativeLiquidGlassEnabled && floating) {
    return (
      <>
        {floating ? <View pointerEvents="none" style={{ height: insets.top + floatingSpacer, backgroundColor: 'transparent' }} /> : null}
        <View pointerEvents="box-none" style={[s.wrap, s.glassWrap, floating && s.glassFloating, { paddingTop: insets.top + 7 }]}>
        <NativeLiquidGlassView glassEffectStyle="regular" colorScheme={isDark ? 'dark' : 'light'} isInteractive style={s.glassBack}>
          <Pressable accessibilityLabel="返回" style={s.glassBackPressable} onPress={goBack}>
            <Ionicons name="chevron-back" size={22} color={colors.accent} />
          </Pressable>
        </NativeLiquidGlassView>
        <NativeLiquidGlassView glassEffectStyle="regular" colorScheme={isDark ? 'dark' : 'light'} isInteractive style={s.glassTitle}>
          {onTitlePress ? (
            <Pressable style={s.glassTitlePressable} onPress={onTitlePress}>
              {center ?? <Text style={[s.title, s.glassTitleText, { color: colors.text }]} numberOfLines={1}>{title}</Text>}
            </Pressable>
          ) : <View style={s.glassTitlePressable}>{center ?? <Text style={[s.title, s.glassTitleText, { color: colors.text }]} numberOfLines={1}>{title}</Text>}</View>}
        </NativeLiquidGlassView>
        {right ? (
          <NativeLiquidGlassView glassEffectStyle="regular" colorScheme={isDark ? 'dark' : 'light'} isInteractive style={[s.glassRight, { width: Math.max(40, rightWidth) }]}>
            <View style={s.glassRightContent}>{right}</View>
          </NativeLiquidGlassView>
        ) : null}
        </View>
      </>
    );
  }
  return (
    <View style={[s.wrap, { backgroundColor: colors.bg, paddingTop: insets.top + 8 }]}>
      <Pressable accessibilityLabel="返回" style={[s.back, { width: rightWidth }]} onPress={goBack}>
        <Ionicons name="chevron-back" size={22} color={colors.accent} />
      </Pressable>
      {onTitlePress ? (
        <Pressable style={s.center} onPress={onTitlePress}>
          {center ?? <Text style={[s.title, { color: colors.accent }]} numberOfLines={1}>{title}</Text>}
        </Pressable>
      ) : (
        <View style={s.center}>{center ?? <Text style={[s.title, { color: colors.text }]} numberOfLines={1}>{title}</Text>}</View>
      )}
      <View style={[s.right, { width: rightWidth }]}>{right ?? <View style={{ width: rightWidth }} />}</View>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: { flexDirection: 'row', alignItems: 'center', paddingBottom: 8, paddingHorizontal: 2 },
  glassWrap: { backgroundColor: 'transparent', minHeight: 58, paddingHorizontal: 12, justifyContent: 'center', borderWidth: 0, position: 'relative', zIndex: 100, elevation: 0 },
  glassFloating: { position: 'absolute', top: 0, left: 0, right: 0 },
  glassBack: { position: 'absolute', left: 12, bottom: 8, width: 40, height: 40, borderRadius: 20, overflow: 'hidden' },
  glassBackPressable: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  glassTitle: { minWidth: 112, maxWidth: 230, height: 40, borderRadius: 20, overflow: 'hidden' },
  glassTitlePressable: { minWidth: 112, height: 40, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' },
  glassTitleText: { flex: 0, height: undefined, lineHeight: 22, includeFontPadding: false, textAlignVertical: 'center' },
  glassRight: { position: 'absolute', right: 12, bottom: 8, height: 40, borderRadius: 20, overflow: 'hidden' },
  glassRightContent: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  back: { height: 44, alignItems: 'center', justifyContent: 'center' },
  center: { flex: 1, height: 44, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, fontSize: 17, fontWeight: '600', textAlign: 'center', height: 44, lineHeight: 44 },
  right: { height: 44, alignItems: 'center', justifyContent: 'center' },
});
