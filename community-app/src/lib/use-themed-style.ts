import { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import { useTheme, type ThemeColors } from '@/lib/theme';

export function useThemedStyle<T extends StyleSheet.NamedStyles<T>>(
  factory: (c: ThemeColors) => T
): T {
  const { colors } = useTheme();
  return useMemo(() => factory(colors), [colors]);
}
