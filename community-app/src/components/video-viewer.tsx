import { Ionicons } from '@expo/vector-icons';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Dimensions, Modal, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { cachedVideoSource, initializeVideoCache } from '@/lib/video-media';

type Props = {
  visible: boolean;
  uri: string;
  poster?: string | null;
  onClose: () => void;
};

export function VideoViewer({ visible, uri, poster, onClose }: Props) {
  if (!visible) return null;
  return <MountedVideoViewer uri={uri} poster={poster} onClose={onClose} />;
}

function MountedVideoViewer({ uri, poster, onClose }: Omit<Props, 'visible'>) {
  useEffect(() => { void initializeVideoCache(); }, []);
  const source = useMemo(() => cachedVideoSource(uri), [uri]);
  const player = useVideoPlayer(source, instance => { instance.loop = false; instance.muted = false; });
  const [playing, setPlaying] = useState(false);
  const [ended, setEnded] = useState(false);
  const [dragOffset, setDragOffset] = useState(0);
  const [aspectRatio, setAspectRatio] = useState(16 / 9);
  const [currentTime, setCurrentTime] = useState(0);
  const [showControls, setShowControls] = useState(true);
  const [progressWidth, setProgressWidth] = useState(0);
  const dragStart = useRef(0);
  const isScrubbing = useRef(false);
  const didDrag = useRef(false);
  const lastTap = useRef(0);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const screen = Dimensions.get('window');
  useEffect(() => {
    if (poster) return;
    const sub = player.addListener('sourceLoad', () => {
      const size = player.videoTrack?.size;
      if (size?.width && size.height) setAspectRatio(size.width / size.height);
    });
    return () => sub.remove();
  }, [player, poster]);
  const width = Math.min(screen.width - 24, 520);
  const height = Math.min(screen.height * 0.72, width / aspectRatio);

  useEffect(() => {
    const playingSub = player.addListener('playingChange', ({ isPlaying }) => { setPlaying(isPlaying); if (isPlaying) setEnded(false); });
    const endSub = player.addListener('playToEnd', () => { setPlaying(false); setEnded(true); setCurrentTime(player.duration); setShowControls(true); });
    const timeSub = player.addListener('timeUpdate', ({ currentTime: next }) => { if (!isScrubbing.current) setCurrentTime(next); });
    return () => { playingSub.remove(); endSub.remove(); timeSub.remove(); };
  }, [player]);

  useEffect(() => {
    player.currentTime = 0;
    setEnded(false);
    player.timeUpdateEventInterval = 0.25;
    player.play();
    setShowControls(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setShowControls(false), 1000);
    return () => {
      player.pause();
      player.currentTime = 0;
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [player]);

  const scheduleHide = useCallback(() => {
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setShowControls(false), 1000);
  }, []);

  const togglePlayback = useCallback(() => {
    const duration = player.duration;
    const reachedEnd = ended || (Number.isFinite(duration) && duration > 0 && player.currentTime >= duration - 0.12);
    if (reachedEnd) {
      setCurrentTime(0);
      setEnded(false);
      player.replay();
      return;
    }
    if (player.playing) player.pause(); else player.play();
  }, [ended, player]);

  const handleVideoTap = useCallback(() => {
    const now = Date.now();
    if (now - lastTap.current < 280) {
      togglePlayback();
    }
    setShowControls(true);
    scheduleHide();
    lastTap.current = now;
  }, [scheduleHide, togglePlayback]);

  const seekFromProgress = useCallback((locationX: number, trackWidth = progressWidth) => {
    if (!trackWidth || !Number.isFinite(player.duration) || player.duration <= 0) return;
    player.currentTime = Math.max(0, Math.min(player.duration, (locationX / trackWidth) * player.duration));
    setEnded(false);
    setCurrentTime(player.currentTime);
    setShowControls(true);
    scheduleHide();
  }, [player, progressWidth, scheduleHide]);

  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponderCapture: () => true,
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponderCapture: () => true,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: () => {
      dragStart.current = player.currentTime;
      isScrubbing.current = true;
      didDrag.current = false;
      setDragOffset(0);
      if (hideTimer.current) clearTimeout(hideTimer.current);
    },
    onPanResponderMove: (_, g) => {
      if (Math.abs(g.dx) < 2) return;
      didDrag.current = true;
      const duration = Number.isFinite(player.duration) && player.duration > 0 ? player.duration : 30;
      const preview = Math.max(0, Math.min(duration, dragStart.current + (g.dx / Math.max(1, width)) * duration));
      setDragOffset(g.dx);
      setCurrentTime(preview);
      setShowControls(true);
    },
    onPanResponderRelease: (event, g) => {
      if (!didDrag.current && Math.abs(g.dx) < 2) {
        isScrubbing.current = false;
        setDragOffset(0);
        const { locationX, locationY } = event.nativeEvent;
        const trackLeft = 14;
        const trackWidth = Math.max(1, width - trackLeft * 2);
        if (locationY >= height - 42 && locationY <= height) {
          seekFromProgress(Math.max(0, Math.min(trackWidth, locationX - trackLeft)), trackWidth);
          return;
        }
        const centerX = width / 2;
        const centerY = height / 2;
        if (Math.abs(locationX - centerX) <= 34 && Math.abs(locationY - centerY) <= 34) {
          togglePlayback();
          setShowControls(true);
          scheduleHide();
          return;
        }
        handleVideoTap();
        return;
      }
      const duration = Number.isFinite(player.duration) && player.duration > 0 ? player.duration : 30;
      const next = Math.max(0, Math.min(duration, dragStart.current + (g.dx / Math.max(1, width)) * duration));
      player.currentTime = next;
      setCurrentTime(next);
      isScrubbing.current = false;
      didDrag.current = false;
      setDragOffset(0);
      scheduleHide();
    },
    onPanResponderTerminate: () => { isScrubbing.current = false; didDrag.current = false; setDragOffset(0); scheduleHide(); },
  }), [handleVideoTap, height, player, scheduleHide, seekFromProgress, togglePlayback, width]);

  return (
    <Modal visible transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={s.overlay}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <Pressable style={s.close} onPress={onClose} hitSlop={10}><Ionicons name="close" size={24} color="#FFFFFF" /></Pressable>
        <View style={{ width, height, borderRadius: 14, overflow: 'hidden', backgroundColor: '#071018' }}>
          {poster ? <View pointerEvents="none" style={StyleSheet.absoluteFill}><View style={{ flex: 1, backgroundColor: '#071018' }} /></View> : null}
          <VideoView
            player={player}
            pointerEvents="none"
            style={StyleSheet.absoluteFill}
            contentFit="contain"
            nativeControls={false}
            surfaceType="textureView"
            useExoShutter={false}
          />
          {showControls && <View pointerEvents="none" style={s.centerButton}>
            <Ionicons name={playing ? 'pause' : 'play'} size={34} color="#FFFFFF" />
          </View>}
          {(showControls || Math.abs(dragOffset) > 0) && <View style={s.progressWrap} onLayout={(event) => setProgressWidth(event.nativeEvent.layout.width)}>
            <View style={s.progressTrack}>
              <View style={[s.progressFill, { width: `${player.duration > 0 ? Math.min(100, (currentTime / player.duration) * 100) : 0}%` }]} />
            </View>
          </View>}
          {Math.abs(dragOffset) > 10 && <View pointerEvents="none" style={s.seekHint}><Text style={s.seekText}>{dragOffset > 0 ? '快进' : '快退'}</Text></View>}
          <View {...pan.panHandlers} style={s.interactionLayer} />
        </View>
      </View>
    </Modal>
  );
}

const s = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.92)', alignItems: 'center', justifyContent: 'center' },
  close: { position: 'absolute', right: 16, top: 48, zIndex: 3, width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.14)' },
  centerButton: { position: 'absolute', left: '50%', top: '50%', marginLeft: -28, marginTop: -28, width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.45)' },
  progressWrap: { position: 'absolute', left: 14, right: 14, bottom: 14, height: 20, justifyContent: 'center' },
  progressTrack: { height: 4, borderRadius: 2, backgroundColor: 'rgba(255,255,255,0.35)', overflow: 'hidden' },
  progressFill: { height: 4, borderRadius: 2, backgroundColor: '#8EDCFF' },
  seekHint: { position: 'absolute', left: '50%', top: '50%', marginLeft: -44, marginTop: -20, paddingHorizontal: 14, paddingVertical: 8, borderRadius: 16, backgroundColor: 'rgba(0,0,0,0.55)' },
  seekText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
  interactionLayer: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, zIndex: 5, backgroundColor: 'transparent' },
});
