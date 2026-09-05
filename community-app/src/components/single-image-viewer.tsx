import { useCallback, useEffect, useRef, useState } from 'react';
import { Modal, Image, Pressable, Dimensions, View, Text, Animated } from 'react-native';
import { Alert } from '@/components/app-alert';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';

const SW = Dimensions.get('window').width;
const SH = Dimensions.get('window').height;
const MAX_SCALE = 2;
const ZOOMED_THRESHOLD = 1.05;

function getDistance(a: any, b: any) {
  if (!a || !b) return 1;
  return Math.max(1, Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY));
}

function clampScale(s: number) {
  return Math.max(1, Math.min(MAX_SCALE, s));
}

export function SingleImageViewer({
  uri,
  visible,
  onClose,
}: {
  uri: string | null;
  visible: boolean;
  onClose: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [imgSize, setImgSize] = useState({ width: SW, height: SH * 0.75 });

  useEffect(() => {
    if (uri && visible) {
      Image.getSize(
        uri,
        (w, h) => {
          const containerRatio = SW / (SH * 0.85);
          const imgRatio = w / h;
          if (imgRatio > containerRatio) {
            setImgSize({ width: SW, height: SW / imgRatio });
          } else {
            setImgSize({ width: (SH * 0.85) * imgRatio, height: SH * 0.85 });
          }
        },
        () => {
          setImgSize({ width: SW, height: SH * 0.75 });
        }
      );
    }
  }, [uri, visible]);

  const scaleAnim = useRef(new Animated.Value(1)).current;
  const translateXAnim = useRef(new Animated.Value(0)).current;
  const translateYAnim = useRef(new Animated.Value(0)).current;

  const scaleRef = useRef(1);
  const translateXRef = useRef(0);
  const translateYRef = useRef(0);

  useEffect(() => {
    const id1 = scaleAnim.addListener(({ value }) => {
      scaleRef.current = value;
    });
    const id2 = translateXAnim.addListener(({ value }) => {
      translateXRef.current = value;
    });
    const id3 = translateYAnim.addListener(({ value }) => {
      translateYRef.current = value;
    });
    return () => {
      scaleAnim.removeListener(id1);
      translateXAnim.removeListener(id2);
      translateYAnim.removeListener(id3);
    };
  }, [scaleAnim, translateXAnim, translateYAnim]);

  useEffect(() => {
    if (visible) {
      scaleRef.current = 1;
      translateXRef.current = 0;
      translateYRef.current = 0;
      scaleAnim.setValue(1);
      translateXAnim.setValue(0);
      translateYAnim.setValue(0);
    }
  }, [visible, scaleAnim, translateXAnim, translateYAnim]);

  const isPinchingRef = useRef(false);
  const wasPinchingRef = useRef(false);
  const startDistRef = useRef(0);
  const startScaleRef = useRef(1);
  const touchStartRef = useRef({ x: 0, y: 0, time: 0 });
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastPageXRef = useRef(0);
  const lastPageYRef = useRef(0);

  const saveImage = useCallback(async () => {
    if (saving || !uri) return;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    setSaving(true);
    try {
      const FileSystem = await import('expo-file-system/legacy');
      const { default: Sharing } = await import('expo-sharing');
      const ext = uri.split('.').pop()?.split('?')[0] || 'jpg';
      const local = FileSystem.cacheDirectory + `img_${Date.now()}.${ext}`;
      await FileSystem.downloadAsync(uri, local);
      await Sharing.shareAsync(local, { dialogTitle: '保存图片' });
    } catch {
      Alert.alert('操作失败', '当前环境不支持保存');
    } finally {
      setSaving(false);
    }
  }, [uri, saving]);

  const resetZoom = useCallback(() => {
    scaleRef.current = 1;
    translateXRef.current = 0;
    translateYRef.current = 0;
    Animated.parallel([
      Animated.spring(scaleAnim, { toValue: 1, useNativeDriver: false, friction: 8, tension: 40 }),
      Animated.spring(translateXAnim, { toValue: 0, useNativeDriver: false, friction: 8, tension: 40 }),
      Animated.spring(translateYAnim, { toValue: 0, useNativeDriver: false, friction: 8, tension: 40 }),
    ]).start();
  }, [scaleAnim, translateXAnim, translateYAnim]);

  const clampTranslate = useCallback(
    (scale: number, tx: number, ty: number) => {
      // 标准容器边界：放大后图片边缘可以贴到屏幕边缘，但不允许露出黑边。
      // 如果图片尺寸没有超过屏幕，则保持居中。
      if (scale <= 1.05) return { x: 0, y: 0 };
      const W = imgSize.width * scale;
      const H = imgSize.height * scale;
      const maxX = Math.max(0, (W - SW) / 2);
      const maxY = Math.max(0, (H - SH) / 2);
      return {
        x: Math.max(-maxX, Math.min(maxX, tx)),
        y: Math.max(-maxY, Math.min(maxY, ty)),
      };
    },
    [imgSize]
  );

  const isPointInsideImage = useCallback(
    (px: number, py: number) => {
      const scale = scaleRef.current;
      const W = imgSize.width * scale;
      const H = imgSize.height * scale;
      const left = SW / 2 + translateXRef.current - W / 2;
      const right = SW / 2 + translateXRef.current + W / 2;
      const top = SH / 2 + translateYRef.current - H / 2;
      const bottom = SH / 2 + translateYRef.current + H / 2;
      return px >= left && px <= right && py >= top && py <= bottom;
    },
    [imgSize]
  );

  const handleTouchStart = useCallback(
    (e: any) => {
      const touches = e.nativeEvent.touches;
      const time = Date.now();

      if (touches.length === 1) {
        touchStartRef.current = { x: touches[0].pageX, y: touches[0].pageY, time };
        lastPageXRef.current = touches[0].pageX;
        lastPageYRef.current = touches[0].pageY;
        longPressTimerRef.current = setTimeout(() => {
          saveImage();
          longPressTimerRef.current = null;
        }, 500);
      }

      if (touches.length >= 2) {
        isPinchingRef.current = true;
        wasPinchingRef.current = true;
        const t1 = touches[0];
        const t2 = touches[1];
        startDistRef.current = getDistance(t1, t2);
        startScaleRef.current = scaleRef.current;
        if (longPressTimerRef.current) {
          clearTimeout(longPressTimerRef.current);
          longPressTimerRef.current = null;
        }
      }
    },
    [saveImage]
  );

  const handleTouchMove = useCallback(
    (e: any) => {
      const touches = e.nativeEvent?.touches || [];

      if (longPressTimerRef.current && touches.length === 1) {
        const dx = Math.abs(touches[0].pageX - touchStartRef.current.x);
        const dy = Math.abs(touches[0].pageY - touchStartRef.current.y);
        if (dx > 5 || dy > 5) {
          clearTimeout(longPressTimerRef.current);
          longPressTimerRef.current = null;
        }
      }

      if (touches.length >= 2) {
        const t1 = touches[0];
        const t2 = touches[1];
        const dist = getDistance(t1, t2);

        if (!isPinchingRef.current) {
          isPinchingRef.current = true;
          wasPinchingRef.current = true;
          startDistRef.current = dist;
          startScaleRef.current = scaleRef.current;
        }

        const ratio = dist / (startDistRef.current || dist);
        const newScale = clampScale(startScaleRef.current * ratio);

        // 以图片中心为锚点缩放：保持当前 translate，并按新的图片尺寸重新限制边界。
        const clamped = clampTranslate(newScale, translateXRef.current, translateYRef.current);
        scaleRef.current = newScale;
        translateXRef.current = clamped.x;
        translateYRef.current = clamped.y;
        scaleAnim.setValue(newScale);
        translateXAnim.setValue(clamped.x);
        translateYAnim.setValue(clamped.y);
        return;
      }

      if (touches.length === 1 && !isPinchingRef.current && lastPageXRef.current !== 0) {
        const touch = touches[0];
        // 给平移加 0.85 阻尼，避免随手一滑图片就“飞”到远处，手感更接近“拖拽重物”。
        const deltaX = (touch.pageX - lastPageXRef.current) * 0.85;
        const deltaY = (touch.pageY - lastPageYRef.current) * 0.85;
        lastPageXRef.current = touch.pageX;
        lastPageYRef.current = touch.pageY;

        if (scaleRef.current > 1) {
          const clamped = clampTranslate(
            scaleRef.current,
            translateXRef.current + deltaX,
            translateYRef.current + deltaY
          );
          translateXRef.current = clamped.x;
          translateYRef.current = clamped.y;
          translateXAnim.setValue(clamped.x);
          translateYAnim.setValue(clamped.y);
        }
      }
    },
    [scaleAnim, translateXAnim, translateYAnim, clampTranslate]
  );

  const handleTouchEnd = useCallback(
    (e: any) => {
      const touches = e.nativeEvent?.touches || [];
      const changedTouches = e.nativeEvent?.changedTouches || [];

      if (longPressTimerRef.current) {
        clearTimeout(longPressTimerRef.current);
        longPressTimerRef.current = null;
      }

      if (touches.length > 0) {
        // 双指变单指：更新剩余手指状态，避免平移跳变。
        if (touches.length === 1) {
          lastPageXRef.current = touches[0].pageX;
          lastPageYRef.current = touches[0].pageY;
          touchStartRef.current = { x: touches[0].pageX, y: touches[0].pageY, time: Date.now() };
        }
        isPinchingRef.current = false;
        startDistRef.current = 0;
        return;
      }

      if (isPinchingRef.current) {
        isPinchingRef.current = false;
        wasPinchingRef.current = false;
        startDistRef.current = 0;
        if (scaleRef.current <= ZOOMED_THRESHOLD) {
          resetZoom();
        } else {
          const clamped = clampTranslate(scaleRef.current, translateXRef.current, translateYRef.current);
          translateXRef.current = clamped.x;
          translateYRef.current = clamped.y;
          Animated.parallel([
            Animated.spring(translateXAnim, { toValue: clamped.x, useNativeDriver: false, friction: 8, tension: 40 }),
            Animated.spring(translateYAnim, { toValue: clamped.y, useNativeDriver: false, friction: 8, tension: 40 }),
          ]).start();
        }
        return;
      }

      const touch = changedTouches[0];
      if (!touch) return;

      const dx = touch.pageX - touchStartRef.current.x;
      const dy = touch.pageY - touchStartRef.current.y;
      const dt = Date.now() - touchStartRef.current.time;

      if (Math.abs(dx) < 5 && Math.abs(dy) < 5 && dt < 300 && !wasPinchingRef.current) {
        if (scaleRef.current > ZOOMED_THRESHOLD) {
          resetZoom();
        } else if (!isPointInsideImage(touch.pageX, touch.pageY)) {
          onClose();
        }
        return;
      }
      wasPinchingRef.current = false;

      if (scaleRef.current <= ZOOMED_THRESHOLD) {
        resetZoom();
        return;
      }

      const clamped = clampTranslate(scaleRef.current, translateXRef.current, translateYRef.current);
      translateXRef.current = clamped.x;
      translateYRef.current = clamped.y;
      Animated.parallel([
        Animated.spring(translateXAnim, { toValue: clamped.x, useNativeDriver: false, friction: 8, tension: 40 }),
        Animated.spring(translateYAnim, { toValue: clamped.y, useNativeDriver: false, friction: 8, tension: 40 }),
      ]).start();
    },
    [onClose, scaleAnim, translateXAnim, translateYAnim, clampTranslate, resetZoom, isPointInsideImage]
  );

  if (!uri) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        <View
          style={{ flex: 1 }}
          onStartShouldSetResponder={() => true}
          onMoveShouldSetResponder={() => true}
          onResponderTerminationRequest={() => false}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <Animated.View
            style={{
              position: 'absolute',
              left: (SW - imgSize.width) / 2,
              top: (SH - imgSize.height) / 2,
              width: imgSize.width,
              height: imgSize.height,
              transform: [{ scale: scaleAnim }, { translateX: translateXAnim }, { translateY: translateYAnim }],
            }}
          >
            <Image source={{ uri }} style={{ width: imgSize.width, height: imgSize.height }} resizeMode="contain" />
          </Animated.View>
        </View>

        <Pressable
          onPress={onClose}
          style={{
            position: 'absolute',
            top: 50,
            left: 16,
            padding: 8,
            backgroundColor: 'rgba(0,0,0,0.4)',
            borderRadius: 20,
          }}
        >
          <Ionicons name="close" size={22} color="#FFFFFF" />
        </Pressable>

        <View
          style={{ position: 'absolute', bottom: 40, left: 0, right: 0, alignItems: 'center' }}
          pointerEvents="none"
        >
          <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 12 }}>长按保存</Text>
        </View>
      </View>
    </Modal>
  );
}
