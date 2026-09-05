import { Platform, Pressable as RNPressable } from 'react-native';

export function Pressable(props: React.ComponentProps<typeof RNPressable>) {
  // Android 上彻底关闭 Material ripple——透明 ripple 在深色模式下仍有视觉残留的"星星点点"效果
  return <RNPressable android_ripple={Platform.OS === 'android' ? null : undefined} {...props} />;
}
