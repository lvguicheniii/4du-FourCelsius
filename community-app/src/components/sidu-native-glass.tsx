import { requireNativeViewManager, requireOptionalNativeModule } from 'expo-modules-core';
import type { ComponentType } from 'react';
import { Platform, type ViewProps } from 'react-native';

export type SiduNativeGlassSurfaceProps = ViewProps & {
  variant?: 'regular' | 'clear';
  dark?: boolean;
  pressed?: boolean;
  cornerRadius?: number;
  useBackdrop?: boolean;
};

const hasNativeModule = Platform.OS === 'android' && requireOptionalNativeModule('SiduGlass') !== null;

export const SiduNativeGlassSurface: ComponentType<SiduNativeGlassSurfaceProps> | null = hasNativeModule
  ? requireNativeViewManager<SiduNativeGlassSurfaceProps>('SiduGlass', 'SiduGlassSurface')
  : null;
