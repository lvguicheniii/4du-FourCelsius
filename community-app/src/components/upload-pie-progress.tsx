import { StyleSheet, Text, View } from 'react-native';

export function UploadPieProgress({ progress, color = '#69D7FF' }: { progress: number; color?: string }) {
  const normalized = Math.min(1, Math.max(0, progress));
  const percent = Math.round(normalized * 100);
  return (
    <View pointerEvents="none" style={styles.overlay}>
      <View style={styles.pie}>
        <View style={[styles.fill, { height: `${percent}%`, backgroundColor: color }]} />
        <Text style={styles.label}>{percent}%</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 12,
    backgroundColor: 'rgba(7, 17, 27, 0.34)',
  },
  pie: {
    width: 48,
    height: 48,
    borderRadius: 24,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.9)',
    backgroundColor: 'rgba(10, 22, 34, 0.78)',
  },
  fill: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  label: { color: '#FFFFFF', fontSize: 10, fontWeight: '800', textShadowColor: '#10202D', textShadowRadius: 2 },
});
