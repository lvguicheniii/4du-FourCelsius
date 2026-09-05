import { useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ScreenHeader } from '@/components/screen-header';
import { useTheme } from '@/lib/theme';
import { OFF_THE_LAND_TIPS } from '@/data/off-the-land';
import { Pressable } from '@/components/pressable';

function randomTip(previous?: string) {
  if (OFF_THE_LAND_TIPS.length < 2) return OFF_THE_LAND_TIPS[0] || '';
  const candidates = OFF_THE_LAND_TIPS.filter(item => item !== previous);
  return candidates[Math.floor(Math.random() * candidates.length)];
}

export default function OffTheLandScreen() {
  const { colors, isDark } = useTheme();
  const [tip, setTip] = useState(() => randomTip());

  return (
    <View style={[styles.screen, { backgroundColor: colors.bg }]}>
      <ScreenHeader title="离地而居" />
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={[
          styles.broadcast,
          {
            backgroundColor: isDark ? '#252D28' : '#E8D5A6',
            borderColor: isDark ? '#596A5C' : '#8B6B45',
          },
        ]}>
          <Image
            source={require('../../assets/images/Livin\'_Off_The_Land.png')}
            style={styles.broadcastImage}
            resizeMode="contain"
            fadeDuration={0}
          />
        </View>

        <Pressable accessibilityRole="button" accessibilityLabel="切换一条提示语" style={styles.quoteButton} onPress={() => setTip(current => randomTip(current))}>
          <Text style={[styles.quote, { color: colors.textSecondary }]}>“{tip}”</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { flexGrow: 1, alignItems: 'center', paddingHorizontal: 24, paddingTop: 22, paddingBottom: 48 },
  broadcast: {
    width: '100%',
    maxWidth: 360,
    aspectRatio: 1.5,
    borderWidth: 2,
    borderRadius: 6,
    padding: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  broadcastImage: { width: '100%', height: '100%' },
  quoteButton: {
    width: '100%',
    maxWidth: 360,
    marginTop: 34,
  },
  quote: {
    fontSize: 16,
    lineHeight: 29,
    fontStyle: 'italic',
    textAlign: 'left',
  },
});
