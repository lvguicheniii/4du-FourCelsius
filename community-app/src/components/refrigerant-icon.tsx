import { View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export function RefrigerantIcon({ size = 20, color = '#33A9DC' }: { size?: number; color?: string }) {
  const tankWidth = size * 0.62;
  const tankHeight = size * 0.76;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'flex-end' }}>
      <View style={{ width: size * 0.3, height: size * 0.12, borderTopLeftRadius: size * 0.08, borderTopRightRadius: size * 0.08, backgroundColor: color, marginBottom: -1 }} />
      <View style={{ width: tankWidth, height: tankHeight, borderRadius: size * 0.22, borderWidth: Math.max(1.2, size * 0.07), borderColor: color, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', backgroundColor: color + '10' }}>
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: '42%', backgroundColor: color + '38' }} />
        <View style={{ position: 'absolute', top: size * 0.13, left: size * 0.1, width: size * 0.06, height: size * 0.28, borderRadius: size, backgroundColor: color + '42' }} />
        <Ionicons name="snow" size={size * 0.34} color={color} />
      </View>
    </View>
  );
}
