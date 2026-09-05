import { Ionicons } from '@expo/vector-icons';
import { Image as ExpoImage } from 'expo-image';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Alert } from '@/components/app-alert';
import {
  Gesture,
  GestureDetector,
  GestureHandlerRootView,
} from 'react-native-gesture-handler';
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

const AnimatedExpoImage = Animated.createAnimatedComponent(ExpoImage);
const MAX_SCALE = 5;
const DOUBLE_TAP_SCALE = 2.5;
const PAGE_SWIPE_DISTANCE = 52;
const PAGE_SWIPE_MIN_DISTANCE = 12;
const PAGE_SWIPE_VELOCITY = 700;

type Size = {
  width: number;
  height: number;
};

export type ZoomableImageProps = {
  active: boolean;
  height: number;
  onClose: () => void;
  onPinchStart: () => void;
  onPageRequest: (direction: -1 | 1) => void;
  nextUri?: string;
  previousUri?: string;
  fallbackUri?: string;
  uri: string;
  width: number;
};

function clamp(value: number, min: number, max: number) {
  'worklet';
  return Math.min(max, Math.max(min, value));
}

function axisBound(contentSize: number, viewportSize: number, scale: number) {
  'worklet';
  return Math.max(0, (contentSize * scale - viewportSize) / 2);
}

function containedSize(
  naturalSize: Size | null,
  viewportWidth: number,
  viewportHeight: number,
): Size {
  if (!naturalSize || naturalSize.width <= 0 || naturalSize.height <= 0) {
    return { width: viewportWidth, height: viewportHeight };
  }

  const ratio = Math.min(
    viewportWidth / naturalSize.width,
    viewportHeight / naturalSize.height,
  );

  return {
    width: naturalSize.width * ratio,
    height: naturalSize.height * ratio,
  };
}

export function ZoomableImage({
  active,
  height,
  onClose,
  onPinchStart,
  onPageRequest,
  nextUri,
  previousUri,
  fallbackUri,
  uri,
  width,
}: ZoomableImageProps) {
  const [naturalSize, setNaturalSize] = useState<Size | null>(null);
  const [displayUri, setDisplayUri] = useState(uri);
  const [loadFailed, setLoadFailed] = useState(false);
  const imageSize = useMemo(
    () => containedSize(naturalSize, width, height),
    [height, naturalSize, width],
  );

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

  useEffect(() => {
    setDisplayUri(uri);
    setLoadFailed(false);
    setNaturalSize(null);
  }, [uri]);

  const reset = useCallback(
    (animated = true) => {
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
    },
    [pageDragX, scale, translateX, translateY],
  );

  useEffect(() => {
    if (!active) reset(false);
  }, [active, reset]);

  useEffect(() => {
    reset(false);
  }, [active, height, reset, width]);

  const pinchGesture = useMemo(
    () =>
      Gesture.Pinch()
        .onStart((event) => {
          cancelAnimation(scale);
          cancelAnimation(translateX);
          cancelAnimation(translateY);
          cancelAnimation(pageDragX);
          cancelAnimation(pinchGuard);
          cancelAnimation(panBlocked);
          pageDragX.value = 0;
          pinchGuard.value = 1;
          panBlocked.value = 1;

          // 双指一开始就锁定外层翻页，避免 FlatList 暗中积累几像素位移，
          // 在松手结算时造成画面闪动和焦点偏移。
          runOnJS(onPinchStart)();

          savedScale.value = scale.value;
          savedTranslateX.value = translateX.value;
          savedTranslateY.value = translateY.value;

          const focalX = event.focalX - width / 2;
          const focalY = event.focalY - height / 2;
          anchorX.value = (focalX - translateX.value) / scale.value;
          anchorY.value = (focalY - translateY.value) / scale.value;
        })
        .onUpdate((event) => {
          // Android 在其中一根手指先离开时，可能发送一次焦点跳到剩余手指的更新。
          // 忽略这帧，避免松手瞬间把放大中心拉走。
          if (event.numberOfPointers < 2) return;
          const nextScale = clamp(
            savedScale.value * event.scale,
            1,
            MAX_SCALE,
          );
          const focalX = event.focalX - width / 2;
          const focalY = event.focalY - height / 2;
          const boundX = axisBound(imageSize.width, width, nextScale);
          const boundY = axisBound(imageSize.height, height, nextScale);

          scale.value = nextScale;
          translateX.value = clamp(
            focalX - anchorX.value * nextScale,
            -boundX,
            boundX,
          );
          translateY.value = clamp(
            focalY - anchorY.value * nextScale,
            -boundY,
            boundY,
          );
        })
        .onEnd(() => {
          const zoomed = scale.value > 1.01;
          if (!zoomed) {
            scale.value = withSpring(1, { damping: 20, stiffness: 220 });
            translateX.value = withSpring(0, {
              damping: 20,
              stiffness: 220,
            });
            translateY.value = withSpring(0, {
              damping: 20,
              stiffness: 220,
            });
          }
        })
        .onFinalize(() => {
          // 阻止双指依次离开时，剩余手指被重新识别成一次带惯性的单指拖动。
          pinchGuard.value = withDelay(90, withTiming(0, { duration: 0 }));
          panBlocked.value = withDelay(90, withTiming(0, { duration: 0 }));
        }),
    [
      anchorX,
      anchorY,
      height,
      imageSize.height,
      imageSize.width,
      onPinchStart,
      pageDragX,
      panBlocked,
      pinchGuard,
      savedScale,
      savedTranslateX,
      savedTranslateY,
      scale,
      translateX,
      translateY,
      width,
    ],
  );

  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .enabled(active)
        .maxPointers(1)
        .minDistance(2)
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
          const boundX = axisBound(imageSize.width, width, scale.value);
          const boundY = axisBound(imageSize.height, height, scale.value);
          const proposedX =
            savedTranslateX.value + event.translationX;
          const draggingPrevious =
            Boolean(previousUri) &&
            proposedX > boundX;
          const draggingNext =
            Boolean(nextUri) &&
            proposedX < -boundX;

          if (draggingPrevious || draggingNext) {
            const overflowX = draggingPrevious
              ? proposedX - boundX
              : proposedX + boundX;
            pageDragX.value = clamp(overflowX, -width, width);
            translateX.value = draggingPrevious ? boundX : -boundX;
          } else {
            pageDragX.value = 0;
            translateX.value = clamp(
              savedTranslateX.value + event.translationX,
              -boundX,
              boundX,
            );
          }

          translateY.value = clamp(
            savedTranslateY.value + event.translationY,
            -boundY,
            boundY,
          );
        })
        .onEnd((event) => {
          if (panBlocked.value > 0) {
            pageDragX.value = 0;
            return;
          }
          const boundX = axisBound(imageSize.width, width, scale.value);
          const boundY = axisBound(imageSize.height, height, scale.value);
          const pageThreshold = Math.min(
            PAGE_SWIPE_DISTANCE,
            width * 0.22,
          );
          const draggedPrevious = pageDragX.value > 0;
          const draggedNext = pageDragX.value < 0;
          const commitPrevious =
            draggedPrevious &&
            (pageDragX.value > pageThreshold ||
              (pageDragX.value > PAGE_SWIPE_MIN_DISTANCE &&
                event.velocityX > PAGE_SWIPE_VELOCITY));
          const commitNext =
            draggedNext &&
            (pageDragX.value < -pageThreshold ||
              (pageDragX.value < -PAGE_SWIPE_MIN_DISTANCE &&
                event.velocityX < -PAGE_SWIPE_VELOCITY));

          if (commitPrevious || commitNext) {
            const direction: -1 | 1 = commitPrevious ? -1 : 1;
            pageDragX.value = withTiming(
              direction === -1 ? width : -width,
              { duration: 180 },
              (finished) => {
                if (finished) runOnJS(onPageRequest)(direction);
              },
            );
            return;
          }

          if (draggedPrevious || draggedNext) {
            pageDragX.value = withSpring(0, {
              damping: 22,
              stiffness: 240,
            });
          }

          translateX.value =
            boundX === 0
              ? withSpring(0)
              : withDecay({
                  velocity: event.velocityX,
                  clamp: [-boundX, boundX],
                  deceleration: 0.995,
                });
          translateY.value =
            boundY === 0
              ? withSpring(0)
              : withDecay({
                  velocity: event.velocityY,
                  clamp: [-boundY, boundY],
                  deceleration: 0.995,
                });
        }),
    [
      height,
      imageSize.height,
      imageSize.width,
      active,
      nextUri,
      onPageRequest,
      pageDragX,
      panBlocked,
      pinchGuard,
      previousUri,
      savedTranslateX,
      savedTranslateY,
      scale,
      translateX,
      translateY,
      width,
    ],
  );

  const doubleTapGesture = useMemo(
    () =>
      Gesture.Tap()
        .numberOfTaps(2)
        .maxDelay(260)
        .maxDistance(12)
        .onEnd((event, success) => {
          if (!success) return;

          if (scale.value > 1.01) {
            scale.value = withSpring(1, { damping: 20, stiffness: 220 });
            translateX.value = withSpring(0, {
              damping: 20,
              stiffness: 220,
            });
            translateY.value = withSpring(0, {
              damping: 20,
              stiffness: 220,
            });
            return;
          }

          const nextScale = DOUBLE_TAP_SCALE;
          const focalX = event.x - width / 2;
          const focalY = event.y - height / 2;
          const boundX = axisBound(imageSize.width, width, nextScale);
          const boundY = axisBound(imageSize.height, height, nextScale);

          scale.value = withSpring(nextScale, {
            damping: 20,
            stiffness: 220,
          });
          translateX.value = withSpring(
            clamp(focalX * (1 - nextScale), -boundX, boundX),
            { damping: 20, stiffness: 220 },
          );
          translateY.value = withSpring(
            clamp(focalY * (1 - nextScale), -boundY, boundY),
            { damping: 20, stiffness: 220 },
          );
        }),
    [
      height,
      imageSize.height,
      imageSize.width,
      scale,
      translateX,
      translateY,
      width,
    ],
  );

  const singleTapGesture = useMemo(
    () =>
      Gesture.Tap()
        .numberOfTaps(1)
        .maxDistance(6)
        .maxDuration(180)
        .onEnd((_event, success) => {
          // 捏合结束时可能伴随一次抬指事件。仅原始尺寸下的明确点击才关闭，
          // 避免放大后被误判为“返回”。
          if (success && scale.value <= 1.01) runOnJS(onClose)();
        }),
    [onClose, scale],
  );

  const gesture = useMemo(
    () =>
      Gesture.Simultaneous(
        pinchGesture,
        Gesture.Race(
          panGesture,
          Gesture.Exclusive(doubleTapGesture, singleTapGesture),
        ),
      ),
    [doubleTapGesture, panGesture, pinchGesture, singleTapGesture],
  );

  const animatedImageStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  const animatedStageStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: pageDragX.value }],
  }));

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={[styles.page, { width, height }]}>
        <Animated.View
          style={[styles.stage, { width, height }, animatedStageStyle]}
        >
          {active && previousUri && (
            <View
              pointerEvents="none"
              style={[styles.neighborPage, { left: -width, width, height }]}
            >
              <ExpoImage
                cachePolicy="memory-disk"
                contentFit="contain"
                priority="high"
                source={{ uri: previousUri }}
                style={{ width, height }}
                transition={0}
              />
            </View>
          )}

          <AnimatedExpoImage
            allowDownscaling
            cachePolicy="memory-disk"
            contentFit="contain"
            priority={active ? 'high' : 'normal'}
            onError={() => {
              if (fallbackUri && fallbackUri !== displayUri) {
                setDisplayUri(fallbackUri);
                setLoadFailed(false);
              } else {
                setLoadFailed(true);
              }
            }}
            onLoad={(event) => {
              const source = event.source;
              if (source.width > 0 && source.height > 0) {
                setNaturalSize((current) =>
                  current?.width === source.width && current?.height === source.height
                    ? current
                    : { width: source.width, height: source.height },
                );
              }
              setLoadFailed(false);
            }}
            source={{ uri: displayUri }}
            style={[
              {
                // 容器尺寸始终固定，真实图片仍由 contentFit="contain" 居中显示。
                // 避免 onLoad 获得尺寸后重新布局，从根源消除切页时的闪动。
                width,
                height,
              },
              animatedImageStyle,
            ]}
            transition={0}
          />

          {loadFailed && (
            <View pointerEvents="none" style={styles.loadError}>
              <Ionicons color="#B8C5CE" name="image-outline" size={34} />
              <Text style={styles.loadErrorText}>图片加载失败</Text>
            </View>
          )}

          {active && nextUri && (
            <View
              pointerEvents="none"
              style={[styles.neighborPage, { left: width, width, height }]}
            >
              <ExpoImage
                cachePolicy="memory-disk"
                contentFit="contain"
                priority="high"
                source={{ uri: nextUri }}
                style={{ width, height }}
                transition={0}
              />
            </View>
          )}
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
}

export function ImageViewer({
  images,
  fallbackImages,
  index,
  visible,
  onClose,
}: {
  images: string[];
  fallbackImages?: string[];
  index: number;
  visible: boolean;
  onClose: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const listRef = useRef<FlatList<string>>(null);
  const [curIdx, setCurIdx] = useState(index);
  const [saving, setSaving] = useState(false);
  const imageKey = images.join('\u0000');
  const safeIndex = images.length
    ? Math.min(Math.max(index, 0), images.length - 1)
    : 0;

  const scrollToInitialImage = useCallback(() => {
    if (!images.length) return;
    listRef.current?.scrollToOffset({
      offset: safeIndex * width,
      animated: false,
    });
  }, [images.length, safeIndex, width]);

  useEffect(() => {
    if (!visible) return;

    setCurIdx(safeIndex);
    const frame = requestAnimationFrame(scrollToInitialImage);
    // 必须使用与实际渲染相同的 expo-image 缓存；RN Image.prefetch 使用的是另一套缓存。
    if (images.length) ExpoImage.prefetch(images, 'memory-disk').catch(() => {});

    return () => cancelAnimationFrame(frame);
  }, [imageKey, images, safeIndex, scrollToInitialImage, visible]);

  const handlePinchStart = useCallback(() => {
    // 翻页完全交给图片页自身的手势处理，外层列表不会再积累暗中位移。
  }, []);

  const handlePageRequest = useCallback(
    (direction: -1 | 1) => {
      const nextIndex = curIdx + direction;
      if (nextIndex < 0 || nextIndex >= images.length) return;

      listRef.current?.scrollToOffset({
        offset: nextIndex * width,
        animated: false,
      });
      // 同一轮 JS 任务内更新当前页，避免额外等待一帧造成黑场或旧图闪回。
      setCurIdx(nextIndex);
    },
    [curIdx, images.length, width],
  );

  const saveToGallery = async () => {
    if (saving || !images[curIdx]) return;
    setSaving(true);
    try {
      const localUri = `${FileSystem.cacheDirectory}save_${Date.now()}.jpg`;
      await FileSystem.downloadAsync(images[curIdx], localUri);
      await Sharing.shareAsync(localUri, { dialogTitle: '保存图片' });
    } catch {
      Alert.alert('操作失败', '当前环境不支持保存图片');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      animationType="fade"
      onRequestClose={onClose}
      onShow={scrollToInitialImage}
      transparent
      visible={visible}
    >
      <GestureHandlerRootView style={styles.root}>
        <FlatList
          data={images}
          decelerationRate="fast"
          getItemLayout={(_data, itemIndex) => ({
            index: itemIndex,
            length: width,
            offset: width * itemIndex,
          })}
          horizontal
          initialNumToRender={Math.min(3, images.length)}
          keyExtractor={(uri, itemIndex) => `${uri}-${itemIndex}`}
          maxToRenderPerBatch={3}
          pagingEnabled
          ref={listRef}
          removeClippedSubviews={false}
          renderItem={({ item: uri, index: itemIndex }) => (
            <ZoomableImage
              active={itemIndex === curIdx}
              fallbackUri={fallbackImages?.[itemIndex]}
              height={height}
              nextUri={images[itemIndex + 1]}
              onClose={onClose}
              onPinchStart={handlePinchStart}
              onPageRequest={handlePageRequest}
              previousUri={images[itemIndex - 1]}
              uri={uri}
              width={width}
            />
          )}
          scrollEnabled={false}
          showsHorizontalScrollIndicator={false}
          windowSize={3}
        />

        {images.length > 1 && (
          <View pointerEvents="none" style={[styles.counter, { top: insets.top + 12 }]}>
            <Text style={styles.counterText}>
              {curIdx + 1} / {images.length}
            </Text>
          </View>
        )}

        <Pressable
          accessibilityLabel="关闭图片"
          hitSlop={12}
          onPress={onClose}
          style={[styles.closeButton, { top: insets.top + 12 }]}
        >
          <Ionicons color="#FFF" name="close" size={30} />
        </Pressable>

        <Pressable
          accessibilityLabel="保存图片"
          disabled={saving}
          onPress={saveToGallery}
          style={styles.saveButton}
        >
          <Ionicons color="#FFF" name="download-outline" size={21} />
        </Pressable>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000',
  },
  page: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  stage: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  neighborPage: {
    position: 'absolute',
    top: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  counter: {
    position: 'absolute',
    right: 0,
    left: 0,
    height: 50,
    alignItems: 'center',
    justifyContent: 'center',
  },
  counterText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '600',
  },
  closeButton: {
    position: 'absolute',
    right: 18,
    padding: 10,
  },
  saveButton: {
    position: 'absolute',
    right: 20,
    bottom: 40,
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadError: {
    position: 'absolute',
    alignItems: 'center',
    gap: 8,
  },
  loadErrorText: {
    color: '#B8C5CE',
    fontSize: 13,
  },
});
