import { StyleSheet, Text, View } from 'react-native';

type Props = {
  gender: 'male' | 'female';
};

export function GenderSymbol({ gender, color, size = 20 }: Props & { color: string; size?: number }) {
  return (
    <Text style={[styles.symbol, { color, fontSize: size, lineHeight: size + 4 }]}>
      {gender === 'male' ? '\u2642' : '\u2640'}
    </Text>
  );
}

export function GenderBadge({ gender }: Props) {
  const color = gender === 'male' ? '#5BA0D9' : '#F08CB4';

  return (
    <View style={[styles.badge, { borderColor: `${color}55`, backgroundColor: `${color}16` }]}>
      <View style={styles.symbolSlot}>
        <GenderSymbol gender={gender} color={color} size={15} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    width: 29,
    height: 25,
    borderRadius: 10,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  symbolSlot: {
    width: 18,
    height: 23,
    alignItems: 'center',
    justifyContent: 'center',
  },
  symbol: { fontWeight: '300', textAlign: 'center', includeFontPadding: false },
});
