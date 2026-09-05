import { Image, Text, View, StyleSheet } from 'react-native';
import { useTheme } from '@/lib/theme';

const COLORS = ['#33A9DC','#1D9E75','#D85A30','#8854D0','#E17A2F','#0C8CE9','#E24B4A','#16A34A','#9333EA'];
function hashColor(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = ((h << 5) - h) + s.charCodeAt(i);
  return COLORS[Math.abs(h) % COLORS.length];
}

interface Props {
  uri?: string | null;
  name?: string;
  size?: number;
  isDeleted?: boolean;
}

export function UserAvatar({ uri, name, size = 38, isDeleted }: Props) {
  const { colors } = useTheme();
  const displayName = name || '?';

  if (isDeleted) {
    return (
      <View style={[s.avatar, { width: size, height: size, borderRadius: size / 2, backgroundColor: '#888780' }]}>
        <Text style={[s.text, { fontSize: size * 0.4 }]}>{displayName[0]}</Text>
      </View>
    );
  }

  if (uri) {
    return <Image source={{ uri }} style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: colors.bg }} />;
  }

  return (
    <View style={[s.avatar, { width: size, height: size, borderRadius: size / 2, backgroundColor: hashColor(displayName) }]}>
      <Text style={[s.text, { fontSize: size * 0.4 }]}>{displayName[0]}</Text>
    </View>
  );
}

const s = StyleSheet.create({
  avatar: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  text: { color: '#FFF', fontWeight: '600' },
});
