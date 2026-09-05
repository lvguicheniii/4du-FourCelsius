import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, Text, View } from 'react-native';
import { setAudioModeAsync, useAudioPlayer } from 'expo-audio';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { AwardIcon } from '@/components/award-icon';
import { acknowledgeAchievementEvents, getPendingAchievementEvents } from '@/api/client';
import { useAuth } from '@/contexts/auth';
import { useWs } from '@/contexts/ws';
import { useTheme } from '@/lib/theme';

type ToastEvent = { id: string; key: string; name: string; hint: string };
const achievementChime = require('../../assets/sounds/achievement-chime.mp3');

export function AchievementToast() {
  const { colors } = useTheme();
  const { token } = useAuth();
  const { lastAchievement, connectionVersion } = useWs();
  const insets = useSafeAreaInsets();
  const [translateY] = useState(() => new Animated.Value(-180));
  const seen = useRef(new Set<string>());
  const queue = useRef<ToastEvent[]>([]);
  const activeRef = useRef<ToastEvent | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const sessionGenerationRef = useRef(0);
  const [active, setActive] = useState<ToastEvent | null>(null);
  const soundPlayer = useAudioPlayer(achievementChime, { downloadFirst: true });

  useEffect(() => {
    // AudioPlayer is an imperative native handle; playback is non-looping by default.
    // eslint-disable-next-line react-hooks/immutability
    soundPlayer.volume = 0.58;
    setAudioModeAsync({
      interruptionMode: 'mixWithOthers',
      playsInSilentMode: true,
      shouldPlayInBackground: false,
    }).catch(() => {});
  }, [soundPlayer]);

  useEffect(() => {
    const generation = ++sessionGenerationRef.current;
    queue.current = [];
    seen.current.clear();
    activeRef.current = null;
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = null;
    translateY.stopAnimation(() => {
      if (generation === sessionGenerationRef.current) setActive(null);
    });
  }, [token, translateY]);

  const enqueue = useCallback((item: ToastEvent) => {
    if (!token || !item.id || seen.current.has(item.id)) return;
    seen.current.add(item.id);
    if (activeRef.current) {
      queue.current.push(item);
      return;
    }

    function present(next: ToastEvent) {
      const generation = sessionGenerationRef.current;
      activeRef.current = next;
      setActive(next);
      try {
        soundPlayer.seekTo(0);
        soundPlayer.play();
      } catch {}
      translateY.setValue(-180);
      Animated.spring(translateY, {
        toValue: 0,
        damping: 18,
        stiffness: 210,
        mass: 0.8,
        useNativeDriver: true,
      }).start(() => {
        if (generation !== sessionGenerationRef.current) return;
        hideTimerRef.current = setTimeout(() => {
          hideTimerRef.current = null;
          if (generation !== sessionGenerationRef.current) return;
          Animated.timing(translateY, {
            toValue: -180,
            duration: 220,
            useNativeDriver: true,
          }).start(() => {
            if (generation !== sessionGenerationRef.current) return;
            acknowledgeAchievementEvents([next.id]).catch(() => {});
            activeRef.current = null;
            setActive(null);
            const following = queue.current.shift();
            if (following) requestAnimationFrame(() => present(following));
          });
        }, 3200);
      });
    }

    present(item);
  }, [soundPlayer, token, translateY]);

  useEffect(() => () => {
    sessionGenerationRef.current += 1;
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    translateY.stopAnimation();
  }, [translateY]);

  const pullPending = useCallback(() => {
    if (!token) return;
    getPendingAchievementEvents().then(({ events }) => {
      events.forEach(event => enqueue({
        id: event.id,
        key: event.achievementKey,
        name: event.name,
        hint: event.hint,
      }));
    }).catch(() => {});
  }, [enqueue, token]);

  useEffect(() => {
    const id = lastAchievement?.eventId || lastAchievement?._eventId;
    const achievement = lastAchievement?.achievement;
    if (id && achievement) enqueue({ id, ...achievement });
  }, [enqueue, lastAchievement]);

  useEffect(() => {
    pullPending();
    if (!token) return;
    const timer = setInterval(pullPending, 15000);
    return () => clearInterval(timer);
  }, [connectionVersion, pullPending, token]);

  if (!active) return null;
  return (
    <View pointerEvents="none" style={[styles.host, { top: insets.top + 8 }]}>
      <Animated.View style={[
        styles.toast,
        { backgroundColor: colors.card, borderColor: colors.cardBorder, transform: [{ translateY }] },
      ]}>
        <View style={styles.icon}>
          <AwardIcon size={20} color={colors.accent} />
        </View>
        <View style={styles.copy}>
          <Text style={[styles.name, { color: colors.text }]} numberOfLines={1}>{active.name}</Text>
          <Text style={[styles.hint, { color: colors.textSecondary }]} numberOfLines={2}>{active.hint}</Text>
        </View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: { position: 'absolute', left: 12, right: 12, zIndex: 1000, elevation: 1000 },
  toast: {
    minHeight: 82,
    borderRadius: 8,
    borderWidth: StyleSheet.hairlineWidth,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 12,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 5 },
    elevation: 8,
  },
  icon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  copy: { flex: 1, marginLeft: 12 },
  name: { fontSize: 16, lineHeight: 22, fontWeight: '800' },
  hint: { marginTop: 4, fontSize: 13, lineHeight: 18, fontStyle: 'italic' },
});
