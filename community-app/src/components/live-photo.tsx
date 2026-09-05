/* eslint-disable react-hooks/immutability -- expo-video exposes playback position through its mutable player object. */
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useVideoPlayer, VideoView } from 'expo-video';
import { Image as ExpoImage } from 'expo-image';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { FlatList, Modal, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDecay,
  withDelay,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { cachedVideoSource } from '@/lib/video-media';
import { cachedImageSource, stableMediaCacheKey } from '@/lib/media-cache';
import { LivePhotoIcon } from '@/components/live-photo-icon';
import { ZoomableImage } from '@/components/image-viewer';

type Props = { stillUri: string; motionUri: string; width: number; height: number; onLongPress?: () => void; onPressIn?: () => void; onOpen?: () => void; autoPlay?: boolean; contentFit?: 'cover' | 'contain'; preserveAspectRatio?: boolean; placeholderUri?: string };

type ThumbnailProps = Pick<Props, 'stillUri' | 'width' | 'height' | 'onLongPress' | 'onPressIn' | 'onOpen' | 'contentFit' | 'preserveAspectRatio' | 'placeholderUri'>;

const LIVE_PHOTO_BUFFER_OPTIONS = {
  preferredForwardBufferDuration: 4,
  waitsToMinimizeStalling: false,
  minBufferForPlayback: 0.15,
  prioritizeTimeOverSizeThreshold: true,
} as const;

const livePhotoDisplaySizeCache = new Map<string, { width: number; height: number }>();

export function LivePhotoThumbnail({ stillUri, width, height, onLongPress, onPressIn, onOpen, contentFit = 'cover', preserveAspectRatio = false, placeholderUri }: ThumbnailProps) {
  const longPressTriggered = useRef(false);
  const displayCacheKey = `${stableMediaCacheKey(stillUri)}:${width}x${height}`;
  const [displaySize, setDisplaySize] = useState(() => preserveAspectRatio ? (livePhotoDisplaySizeCache.get(displayCacheKey) || { width, height }) : { width, height });
  useEffect(() => {
    const cachedSize = livePhotoDisplaySizeCache.get(displayCacheKey);
    if (cachedSize) setDisplaySize(cachedSize);
    else if (!placeholderUri) setDisplaySize(preserveAspectRatio ? { width, height } : { width, height });
  }, [displayCacheKey, height, placeholderUri, preserveAspectRatio, width]);
  return <Pressable
    onPressIn={() => { longPressTriggered.current = false; onPressIn?.(); }}
    onPress={(event) => {
      event.stopPropagation();
      if (longPressTriggered.current) { longPressTriggered.current = false; return; }
      onOpen?.();
    }}
    onLongPress={onLongPress ? (event) => { event.stopPropagation(); longPressTriggered.current = true; onLongPress(); } : undefined}
    delayLongPress={450}
  >
    <View style={{ width: displaySize.width, height: displaySize.height, borderRadius: 8, overflow: 'hidden', backgroundColor: '#000000' }}>
      <ExpoImage
        source={cachedImageSource(stillUri)}
        placeholder={placeholderUri ? cachedImageSource(placeholderUri) : undefined}
        placeholderContentFit={contentFit}
        style={StyleSheet.absoluteFill}
        contentFit={contentFit}
        cachePolicy="disk"
        transition={0}
        onLoad={(event) => {
          if (!preserveAspectRatio || !event.source.width || !event.source.height) return;
          const scale = Math.min(1, width / event.source.width, height / event.source.height);
          const nextSize = { width: event.source.width * scale, height: event.source.height * scale };
          livePhotoDisplaySizeCache.set(displayCacheKey, nextSize);
          setDisplaySize(nextSize);
        }}
      />
      <View pointerEvents="none" style={s.badge}><LivePhotoIcon /></View>
    </View>
  </Pressable>;
}

export function LivePhoto({ stillUri, motionUri, width, height, onLongPress, onPressIn, onOpen, autoPlay = false, contentFit = 'cover' }: Props) {
  const source = useMemo(() => cachedVideoSource(motionUri), [motionUri]);
  const player = useVideoPlayer(source, instance => {
    instance.loop = false;
    instance.muted = false;
    instance.bufferOptions = LIVE_PHOTO_BUFFER_OPTIONS;
  });
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    const playingSub = player.addListener('playingChange', ({ isPlaying }) => setPlaying(isPlaying));
    const endSub = player.addListener('playToEnd', () => { setPlaying(false); player.currentTime = 0; });
    return () => { playingSub.remove(); endSub.remove(); };
  }, [player]);
  useEffect(() => {
    if (!autoPlay) return;
    player.currentTime = 0;
    player.play();
  }, [autoPlay, player]);
  return (
    <Pressable onPressIn={onPressIn} onPress={(event) => { event.stopPropagation(); if (onOpen) { onOpen(); return; } if (player.playing) player.pause(); else { player.currentTime = 0; setPlaying(true); player.play(); } }} onLongPress={onLongPress}>
      <View style={{ width, height, borderRadius: 10, overflow: 'hidden', backgroundColor: '#000000' }}>
        <VideoView player={player} style={StyleSheet.absoluteFill} contentFit={contentFit} nativeControls={false} useExoShutter={false} />
        {!playing && <ExpoImage source={cachedImageSource(stillUri)} style={StyleSheet.absoluteFill} contentFit={contentFit} cachePolicy="disk" transition={0} />}
        <View pointerEvents="none" style={s.badge}><LivePhotoIcon /></View>
      </View>
    </Pressable>
  );
}

export type LivePhotoItem = { stillUrl: string; motionUrl: string };
export type MediaViewerItem = { stillUrl: string; motionUrl?: string };

type Size = { width: number; height: number };
type PlaybackHandle = { replay: () => void };

const MAX_SCALE = 5;
const DOUBLE_TAP_SCALE = 2.5;
const PAGE_SWIPE_DISTANCE = 52;
const PAGE_SWIPE_MIN_DISTANCE = 12;
const PAGE_SWIPE_VELOCITY = 700;

function clamp(value: number, min: number, max: number) {
  'worklet';
  return Math.min(max, Math.max(min, value));
}

function axisBound(contentSize: number, viewportSize: number, scale: number) {
  'worklet';
  return Math.max(0, (contentSize * scale - viewportSize) / 2);
}

function containedSize(naturalSize: Size | null, width: number, height: number): Size {
  if (!naturalSize?.width || !naturalSize.height) return { width, height };
  const ratio = Math.min(width / naturalSize.width, height / naturalSize.height);
  return { width: naturalSize.width * ratio, height: naturalSize.height * ratio };
}

function LiveBadge({ position }: { position?: { left: number; top: number } }) {
  if (!position) return null;
  return <View pointerEvents="none" style={[s.badge, position]}><LivePhotoIcon /></View>;
}

function StillPhoto({ uri, badgePosition, onNaturalSize, showBadge = true }: { uri: string; badgePosition?: { left: number; top: number }; onNaturalSize?: (size: Size) => void; showBadge?: boolean }) {
  return <>
    <ExpoImage
      source={cachedImageSource(uri)}
      style={StyleSheet.absoluteFill}
      contentFit="contain"
      cachePolicy="memory-disk"
      priority="high"
      transition={0}
      onLoad={(event) => {
        const { width, height } = event.source;
        if (width > 0 && height > 0) onNaturalSize?.({ width, height });
      }}
    />
    {showBadge ? <LiveBadge position={badgePosition} /> : null}
  </>;
}

const LivePhotoPlayback = forwardRef<PlaybackHandle, {
  motionUri: string;
  active: boolean;
  itemIndex: number;
  autoPlay: boolean;
  onAutoPlayed: (index: number) => void;
}>(function LivePhotoPlayback({ motionUri, active, itemIndex, autoPlay, onAutoPlayed }, ref) {
  const source = useMemo(() => cachedVideoSource(motionUri), [motionUri]);
  const player = useVideoPlayer(source, instance => {
    instance.loop = false;
    instance.muted = false;
    instance.bufferOptions = LIVE_PHOTO_BUFFER_OPTIONS;
  });
  const [playing, setPlaying] = useState(false);
  const [firstFrameRendered, setFirstFrameRendered] = useState(false);
  const autoPlayedRef = useRef(false);
  const playFromStart = useCallback(() => {
    player.pause();
    player.loop = false;
    player.currentTime = 0;
    player.play();
  }, [player]);

  useImperativeHandle(ref, () => ({ replay: playFromStart }), [playFromStart]);

  useEffect(() => {
    if (active) return;
    player.pause();
    player.currentTime = 0;
  }, [active, player]);

  useEffect(() => {
    const startImmediately = () => {
      if (!active || !autoPlay || autoPlayedRef.current) return;
      autoPlayedRef.current = true;
      onAutoPlayed(itemIndex);
      playFromStart();
    };
    const playingSub = player.addListener('playingChange', ({ isPlaying }) => setPlaying(isPlaying));
    const endSub = player.addListener('playToEnd', () => {
      player.pause();
      setPlaying(false);
      player.currentTime = 0;
    });
    startImmediately();
    return () => { playingSub.remove(); endSub.remove(); };
  }, [active, autoPlay, itemIndex, onAutoPlayed, playFromStart, player]);

  return <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <VideoView
        player={player}
        style={[StyleSheet.absoluteFill, { opacity: playing && firstFrameRendered ? 1 : 0 }]}
        contentFit="contain"
        nativeControls={false}
        surfaceType="textureView"
        useExoShutter={false}
        onFirstFrameRender={() => setFirstFrameRendered(true)}
      />
    </View>
});

function ZoomableLivePhoto({
  active,
  autoPlay,
  height,
  item,
  itemIndex,
  nextItem,
  onAutoPlayed,
  onClose,
  onPageRequest,
  previousItem,
  preload,
  width,
}: {
  active: boolean;
  autoPlay: boolean;
  height: number;
  item: LivePhotoItem;
  itemIndex: number;
  nextItem?: MediaViewerItem;
  onAutoPlayed: (index: number) => void;
  onClose: () => void;
  onPageRequest: (direction: -1 | 1) => void;
  previousItem?: MediaViewerItem;
  preload: boolean;
  width: number;
}) {
  const playerRef = useRef<PlaybackHandle>(null);
  const [naturalSize, setNaturalSize] = useState<Size | null>(null);
  const mediaSize = useMemo(() => containedSize(naturalSize, width, height), [height, naturalSize, width]);
  const badgePosition = useMemo(() => naturalSize ? ({
    left: (width - mediaSize.width) / 2 + 7,
    top: (height - mediaSize.height) / 2 + 7,
  }) : undefined, [height, mediaSize.height, mediaSize.width, naturalSize, width]);
  const scale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedScale = useSharedValue(1);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);
  const anchorX = useSharedValue(0);
  const anchorY = useSharedValue(0);
  const pageDragX = useSharedValue(0);
  const pinchGuard = useSharedValue(0);
  const panBlocked = useSharedValue(0);

  const setMeasuredSize = useCallback((size: Size) => {
    setNaturalSize(current => current?.width === size.width && current.height === size.height ? current : size);
  }, []);
  const replay = useCallback(() => {
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    playerRef.current?.replay();
  }, []);
  const reset = useCallback((animated = true) => {
    if (animated) {
      scale.value = withSpring(1, { damping: 20, stiffness: 220 });
      translateX.value = withSpring(0, { damping: 20, stiffness: 220 });
      translateY.value = withSpring(0, { damping: 20, stiffness: 220 });
    } else {
      scale.value = 1;
      translateX.value = 0;
      translateY.value = 0;
    }
    pageDragX.value = 0;
  }, [pageDragX, scale, translateX, translateY]);

  useEffect(() => {
    if (!active) reset(false);
  }, [active, reset]);

  const pinchGesture = useMemo(() => Gesture.Pinch()
    .enabled(active)
    .onStart((event) => {
      cancelAnimation(scale);
      cancelAnimation(translateX);
      cancelAnimation(translateY);
      cancelAnimation(pageDragX);
      pageDragX.value = 0;
      pinchGuard.value = 1;
      panBlocked.value = 1;
      savedScale.value = scale.value;
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
      const focalX = event.focalX - width / 2;
      const focalY = event.focalY - height / 2;
      anchorX.value = (focalX - translateX.value) / scale.value;
      anchorY.value = (focalY - translateY.value) / scale.value;
    })
    .onUpdate((event) => {
      if (event.numberOfPointers < 2) return;
      const nextScale = clamp(savedScale.value * event.scale, 1, MAX_SCALE);
      const focalX = event.focalX - width / 2;
      const focalY = event.focalY - height / 2;
      const boundX = axisBound(mediaSize.width, width, nextScale);
      const boundY = axisBound(mediaSize.height, height, nextScale);
      scale.value = nextScale;
      translateX.value = clamp(focalX - anchorX.value * nextScale, -boundX, boundX);
      translateY.value = clamp(focalY - anchorY.value * nextScale, -boundY, boundY);
    })
    .onEnd(() => {
      if (scale.value <= 1.01) {
        scale.value = withSpring(1, { damping: 20, stiffness: 220 });
        translateX.value = withSpring(0, { damping: 20, stiffness: 220 });
        translateY.value = withSpring(0, { damping: 20, stiffness: 220 });
      }
    })
    .onFinalize(() => {
      pinchGuard.value = withDelay(90, withTiming(0, { duration: 0 }));
      panBlocked.value = withDelay(90, withTiming(0, { duration: 0 }));
    }), [active, anchorX, anchorY, height, mediaSize.height, mediaSize.width, pageDragX, panBlocked, pinchGuard, savedScale, savedTranslateX, savedTranslateY, scale, translateX, translateY, width]);

  const panGesture = useMemo(() => Gesture.Pan()
    .enabled(active)
    .maxPointers(1)
    .minDistance(6)
    .onStart(() => {
      panBlocked.value = pinchGuard.value > 0 ? 1 : 0;
      if (panBlocked.value > 0) return;
      cancelAnimation(translateX);
      cancelAnimation(translateY);
      cancelAnimation(pageDragX);
      pageDragX.value = 0;
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    })
    .onUpdate((event) => {
      if (panBlocked.value > 0) return;
      const boundX = axisBound(mediaSize.width, width, scale.value);
      const boundY = axisBound(mediaSize.height, height, scale.value);
      const proposedX = savedTranslateX.value + event.translationX;
      const draggingPrevious = Boolean(previousItem) && proposedX > boundX;
      const draggingNext = Boolean(nextItem) && proposedX < -boundX;
      if (draggingPrevious || draggingNext) {
        const overflowX = draggingPrevious ? proposedX - boundX : proposedX + boundX;
        pageDragX.value = clamp(overflowX, -width, width);
        translateX.value = draggingPrevious ? boundX : -boundX;
      } else {
        pageDragX.value = 0;
        translateX.value = clamp(proposedX, -boundX, boundX);
      }
      translateY.value = clamp(savedTranslateY.value + event.translationY, -boundY, boundY);
    })
    .onEnd((event) => {
      if (panBlocked.value > 0) {
        pageDragX.value = 0;
        return;
      }
      const boundX = axisBound(mediaSize.width, width, scale.value);
      const boundY = axisBound(mediaSize.height, height, scale.value);
      const threshold = Math.min(PAGE_SWIPE_DISTANCE, width * 0.22);
      const previous = pageDragX.value > 0;
      const next = pageDragX.value < 0;
      const commitPrevious = previous && (pageDragX.value > threshold || (pageDragX.value > PAGE_SWIPE_MIN_DISTANCE && event.velocityX > PAGE_SWIPE_VELOCITY));
      const commitNext = next && (pageDragX.value < -threshold || (pageDragX.value < -PAGE_SWIPE_MIN_DISTANCE && event.velocityX < -PAGE_SWIPE_VELOCITY));
      if (commitPrevious || commitNext) {
        const direction: -1 | 1 = commitPrevious ? -1 : 1;
        pageDragX.value = withTiming(direction === -1 ? width : -width, { duration: 180 }, finished => {
          if (finished) runOnJS(onPageRequest)(direction);
        });
        return;
      }
      if (previous || next) pageDragX.value = withSpring(0, { damping: 22, stiffness: 240 });
      translateX.value = boundX === 0 ? withSpring(0) : withDecay({ velocity: event.velocityX, clamp: [-boundX, boundX], deceleration: 0.995 });
      translateY.value = boundY === 0 ? withSpring(0) : withDecay({ velocity: event.velocityY, clamp: [-boundY, boundY], deceleration: 0.995 });
    }), [active, height, mediaSize.height, mediaSize.width, nextItem, onPageRequest, pageDragX, panBlocked, pinchGuard, previousItem, savedTranslateX, savedTranslateY, scale, translateX, translateY, width]);

  const longPressGesture = useMemo(() => Gesture.LongPress()
    .enabled(active)
    .minDuration(220)
    .maxDistance(16)
    // Gesture callbacks run after render and may safely call the current player handle.
    // eslint-disable-next-line react-hooks/refs
    .onStart(() => runOnJS(replay)()), [active, replay]);

  const doubleTapGesture = useMemo(() => Gesture.Tap()
    .enabled(active)
    .numberOfTaps(2)
    .maxDelay(260)
    .maxDistance(12)
    .onEnd((event, success) => {
      if (!success) return;
      if (scale.value > 1.01) {
        scale.value = withSpring(1, { damping: 20, stiffness: 220 });
        translateX.value = withSpring(0, { damping: 20, stiffness: 220 });
        translateY.value = withSpring(0, { damping: 20, stiffness: 220 });
        return;
      }
      const nextScale = DOUBLE_TAP_SCALE;
      const focalX = event.x - width / 2;
      const focalY = event.y - height / 2;
      const boundX = axisBound(mediaSize.width, width, nextScale);
      const boundY = axisBound(mediaSize.height, height, nextScale);
      scale.value = withSpring(nextScale, { damping: 20, stiffness: 220 });
      translateX.value = withSpring(clamp(focalX * (1 - nextScale), -boundX, boundX), { damping: 20, stiffness: 220 });
      translateY.value = withSpring(clamp(focalY * (1 - nextScale), -boundY, boundY), { damping: 20, stiffness: 220 });
    }), [active, height, mediaSize.height, mediaSize.width, scale, translateX, translateY, width]);

  const singleTapGesture = useMemo(() => Gesture.Tap()
    .enabled(active)
    .numberOfTaps(1)
    .maxDistance(6)
    .maxDuration(180)
    .onEnd((_event, success) => {
      if (success && scale.value <= 1.01) runOnJS(onClose)();
    }), [active, onClose, scale]);

  const gesture = useMemo(() => Gesture.Simultaneous(
    pinchGesture,
    Gesture.Race(panGesture, Gesture.Exclusive(longPressGesture, doubleTapGesture, singleTapGesture)),
  ), [doubleTapGesture, longPressGesture, panGesture, pinchGesture, singleTapGesture]);

  const mediaStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }, { translateY: translateY.value }, { scale: scale.value }],
  }));
  const stageStyle = useAnimatedStyle(() => ({ transform: [{ translateX: pageDragX.value }] }));

  return <GestureDetector gesture={gesture}>
    <Animated.View style={[s.page, { width, height }]}>
      <Animated.View style={[s.stage, { width, height }, stageStyle]}>
        {active && previousItem ? <View pointerEvents="none" style={[s.neighbor, { left: -width, width, height }]}><StillPhoto uri={previousItem.stillUrl} showBadge={false} /></View> : null}
        <Animated.View style={[StyleSheet.absoluteFill, mediaStyle]}>
          <StillPhoto uri={item.stillUrl} onNaturalSize={setMeasuredSize} showBadge={false} />
          {preload ? <LivePhotoPlayback
            ref={active ? playerRef : undefined}
            motionUri={item.motionUrl!}
            active={active}
            itemIndex={itemIndex}
            autoPlay={active && autoPlay}
            onAutoPlayed={onAutoPlayed}
          /> : null}
          <LiveBadge position={badgePosition} />
        </Animated.View>
        {active && nextItem ? <View pointerEvents="none" style={[s.neighbor, { left: width, width, height }]}><StillPhoto uri={nextItem.stillUrl} showBadge={false} /></View> : null}
      </Animated.View>
    </Animated.View>
  </GestureDetector>;
}

export function LivePhotoViewer({ visible, items, index, onClose }: { visible: boolean; items: MediaViewerItem[]; index: number; onClose: () => void }) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const listRef = useRef<FlatList<MediaViewerItem>>(null);
  const safeIndex = items.length ? Math.min(Math.max(index, 0), items.length - 1) : 0;
  const [currentIndex, setCurrentIndex] = useState(safeIndex);
  const [autoPlayedIndices, setAutoPlayedIndices] = useState<Set<number>>(() => new Set());
  const itemKey = items.map(item => `${item.stillUrl}\u0000${item.motionUrl}`).join('\u0001');
  const scrollToInitialItem = useCallback(() => {
    if (!items.length) return;
    listRef.current?.scrollToOffset({ offset: safeIndex * width, animated: false });
  }, [items.length, safeIndex, width]);
  const markAutoPlayed = useCallback((playedIndex: number) => {
    setAutoPlayedIndices(previous => {
      if (previous.has(playedIndex)) return previous;
      const next = new Set(previous);
      next.add(playedIndex);
      return next;
    });
  }, []);
  const requestPage = useCallback((direction: -1 | 1) => {
    const nextIndex = currentIndex + direction;
    if (nextIndex < 0 || nextIndex >= items.length) return;
    listRef.current?.scrollToOffset({ offset: nextIndex * width, animated: false });
    setCurrentIndex(nextIndex);
  }, [currentIndex, items.length, width]);

  useEffect(() => {
    if (!visible) return;
    const frame = requestAnimationFrame(scrollToInitialItem);
    if (items.length) ExpoImage.prefetch(items.map(item => item.stillUrl), 'memory-disk').catch(() => {});
    return () => cancelAnimationFrame(frame);
  }, [itemKey, items, scrollToInitialItem, visible]);

  return <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose} onShow={scrollToInitialItem}>
    <GestureHandlerRootView style={s.viewer}>
      <FlatList
        ref={listRef}
        data={items}
        horizontal
        pagingEnabled
        scrollEnabled={false}
        showsHorizontalScrollIndicator={false}
        removeClippedSubviews={false}
        initialNumToRender={Math.min(3, items.length)}
        maxToRenderPerBatch={3}
        windowSize={3}
        getItemLayout={(_data, itemIndex) => ({ index: itemIndex, length: width, offset: width * itemIndex })}
        keyExtractor={(item, itemIndex) => `${item.stillUrl}-${itemIndex}`}
        renderItem={({ item, index: itemIndex }) => item.motionUrl ? <ZoomableLivePhoto
            active={itemIndex === currentIndex}
            autoPlay={!autoPlayedIndices.has(itemIndex)}
            height={height}
            item={{ stillUrl: item.stillUrl, motionUrl: item.motionUrl }}
            itemIndex={itemIndex}
            nextItem={items[itemIndex + 1]}
            onAutoPlayed={markAutoPlayed}
            onClose={onClose}
            onPageRequest={requestPage}
            preload={itemIndex === currentIndex}
            previousItem={items[itemIndex - 1]}
            width={width}
          /> : <ZoomableImage
            active={itemIndex === currentIndex}
            height={height}
            nextUri={items[itemIndex + 1]?.stillUrl}
            onClose={onClose}
            onPageRequest={requestPage}
            onPinchStart={() => {}}
            previousUri={items[itemIndex - 1]?.stillUrl}
            uri={item.stillUrl}
            width={width}
          />}
      />
      {items.length > 1 ? <View pointerEvents="none" style={[s.counter, { top: insets.top + 12 }]}><Text style={s.counterText}>{currentIndex + 1} / {items.length}</Text></View> : null}
      <Pressable accessibilityLabel="关闭实况照片" hitSlop={12} style={[s.close, { top: insets.top + 12 }]} onPress={onClose}><Ionicons name="close" size={30} color="#FFFFFF" /></Pressable>
    </GestureHandlerRootView>
  </Modal>;
}

const s = StyleSheet.create({
  badge: { position: 'absolute', left: 7, top: 7, width: 25, height: 25, alignItems: 'center', justifyContent: 'center' },
  viewer: { flex: 1, backgroundColor: '#000000' },
  page: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  stage: { alignItems: 'center', justifyContent: 'center' },
  neighbor: { position: 'absolute', top: 0, alignItems: 'center', justifyContent: 'center' },
  counter: { position: 'absolute', right: 0, left: 0, height: 50, alignItems: 'center', justifyContent: 'center' },
  counterText: { color: '#FFFFFF', fontSize: 14, fontWeight: '600' },
  close: { position: 'absolute', right: 18, padding: 10 },
});
