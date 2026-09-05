import { useEffect, useRef } from 'react';
import { Animated, ColorValue } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

type Props = {
  focused: boolean;
  color: ColorValue;
  size: number;
  activeIcon: any;
  inactiveIcon: any;
};

export function AnimatedTabIcon({ focused, color, size, activeIcon, inactiveIcon }: Props) {
  const scale = useRef(new Animated.Value(focused ? 1 : 0.85)).current;

  useEffect(() => {
    Animated.spring(scale, {
      toValue: focused ? 1 : 0.85,
      mass: 0.5,
      stiffness: 260,
      damping: 12,
      useNativeDriver: true,
    }).start();
  }, [focused]);

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Ionicons name={focused ? activeIcon : inactiveIcon} size={size} color={color} />
    </Animated.View>
  );
}
