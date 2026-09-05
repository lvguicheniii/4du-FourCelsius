import { useMemo } from 'react';
import { StyleSheet, View } from 'react-native';
import { useTheme } from '@/lib/theme';
import { RefrigerantIcon } from '@/components/refrigerant-icon';
import { TemperatureIceIcon, TemperatureWaterIcon } from '@/components/temperature-icons';

interface Props {
  temperature: number;
  boosted?: boolean;
}

function tempToPercent(temp: number): number {
  return Math.min(((temp + 18) / 44) * 100, 100);
}

function gradientColor(ratio: number): string {
  const t = Math.min(Math.max(ratio, 0), 1);
  const r = t < 0.5
    ? { from: [51, 169, 220], to: [144, 176, 196], t: t * 2 }
    : { from: [144, 176, 196], to: [255, 107, 53], t: (t - 0.5) * 2 };
  const rt = r.t;
  const cr = Math.round(r.from[0] + (r.to[0] - r.from[0]) * rt);
  const cg = Math.round(r.from[1] + (r.to[1] - r.from[1]) * rt);
  const cb = Math.round(r.from[2] + (r.to[2] - r.from[2]) * rt);
  return `rgb(${cr},${cg},${cb})`;
}

const SEGMENTS = 30;
const gradientSegments = Array.from({ length: SEGMENTS }, (_, i) => gradientColor(i / (SEGMENTS - 1)));

export function TemperatureBar({ temperature, boosted = false }: Props) {
  const { colors } = useTheme();
  const percent = useMemo(() => tempToPercent(temperature), [temperature]);
  const isMelting = temperature > 22;
  const isExpired = temperature >= 26;
  const barColor = gradientColor(percent / 100);

  return (
    <View style={styles.wrapper}>
      {boosted ? <View style={styles.leftIcon}><View style={styles.refrigerantIcon}><RefrigerantIcon size={18} color={colors.accent} /></View></View> : <View style={styles.leftIcon}><TemperatureIceIcon size={18} color={colors.accent} /></View>}
      <View style={styles.barContainer}>
        <View style={styles.barTrack}>
          <View style={styles.gradientBg}>
            {gradientSegments.map((color, i) => (
              <View key={i} style={[styles.segment, { backgroundColor: color }]} />
            ))}
          </View>
        </View>
        <View style={[styles.tick, { left: `${percent}%` }]}>
          <View style={[styles.tickArrow, { borderBottomColor: barColor }]} />
        </View>
      </View>
      <View style={[styles.rightIconSlot, (isMelting || isExpired) && styles.melting]}><TemperatureWaterIcon size={18} /></View>
    </View>
  );
}


const styles = StyleSheet.create({
  wrapper: {
    width: '100%',
    flexDirection: 'row' as const,
    alignItems: 'center',
    marginTop: 10,
    height: 24,
  },
  leftIcon: { width: 18, height: 24, alignItems: 'center', justifyContent: 'center' },
  rightIconSlot: { width: 18, height: 24, alignItems: 'center', justifyContent: 'center' },
  refrigerantIcon: { transform: [{ translateY: -2 }] },
  barContainer: {
    flex: 1,
    position: 'relative' as const,
    marginHorizontal: 0,
  },
  barTrack: {
    height: 4,
    borderRadius: 2,
    backgroundColor: '#E8EAED',
    overflow: 'hidden' as const,
  },
  gradientBg: {
    flexDirection: 'row' as const,
    width: '100%',
    height: 4,
  },
  segment: {
    flex: 1,
    height: 4,
  },
  tick: {
    position: 'absolute' as const,
    top: 4,
    marginLeft: -4,
  },
  tickArrow: {
    width: 0,
    height: 0,
    borderLeftWidth: 4,
    borderRightWidth: 4,
    borderBottomWidth: 5,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  melting: {
    opacity: 0.6,
  },
});
