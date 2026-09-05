import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, StyleSheet, useWindowDimensions, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useGlobalSearchParams, usePathname, useRouter } from 'expo-router';
import { useAuth } from '@/contexts/auth';
import { useWs } from '@/contexts/ws';

const ICON_SIZE = 58;
const EDGE_GAP = 14;
const DRAG_START_DISTANCE = 2;

function defaultPosition(width: number, height: number) {
  return {
    x: Math.max(EDGE_GAP, width - ICON_SIZE - EDGE_GAP),
    y: Math.max(EDGE_GAP, (height - ICON_SIZE) / 2),
  };
}

type IncomingChatNotice = {
  seq: number;
  peerName: string;
  peerUserId: string;
};

export function IncomingChatSnowflake() {
  const router = useRouter();
  const pathname = usePathname();
  const routeParams = useGlobalSearchParams<{ name?: string; peerUserId?: string }>();
  const { token, user } = useAuth();
  const { lastChatMsg } = useWs();
  const { width, height } = useWindowDimensions();
  const [notice, setNotice] = useState<IncomingChatNotice | null>(null);
  const handledSeqRef = useRef<number | null>(null);
  const position = useRef(new Animated.ValueXY(defaultPosition(width, height))).current;
  const bounce = useRef(new Animated.Value(0)).current;
  const bounceLoopRef = useRef<Animated.CompositeAnimation | null>(null);
  const draggingRef = useRef(false);
  const dragOriginRef = useRef({ x: 0, y: 0 });
  const boundsRef = useRef({ width, height });
  boundsRef.current = { width, height };

  const clampPosition = useCallback((x: number, y: number) => {
    const bounds = boundsRef.current;
    return {
      x: Math.min(Math.max(EDGE_GAP, x), Math.max(EDGE_GAP, bounds.width - ICON_SIZE - EDGE_GAP)),
      y: Math.min(Math.max(EDGE_GAP, y), Math.max(EDGE_GAP, bounds.height - ICON_SIZE - EDGE_GAP)),
    };
  }, []);

  const startBounce = useCallback(() => {
    bounceLoopRef.current?.stop();
    bounce.setValue(0);
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(bounce, { toValue: -10, duration: 220, useNativeDriver: true }),
      Animated.timing(bounce, { toValue: 0, duration: 220, useNativeDriver: true }),
      Animated.delay(650),
    ]));
    bounceLoopRef.current = loop;
    loop.start();
  }, [bounce]);

  useEffect(() => {
    const seq = lastChatMsg?._seq;
    if (!token || !seq || handledSeqRef.current === seq) return;
    handledSeqRef.current = seq;
    if (
      lastChatMsg.type !== 'chat'
      || lastChatMsg.from === 'me'
      || lastChatMsg.from === user?.id
      || !lastChatMsg.fromName
    ) return;
    const activePeer = typeof routeParams.name === 'string' ? routeParams.name : '';
    const incomingPeerUserId = String(lastChatMsg.peerId || lastChatMsg.from || '');
    if (
      pathname.startsWith('/chat/')
      && ((routeParams.peerUserId && routeParams.peerUserId === incomingPeerUserId) || activePeer === lastChatMsg.fromName)
    ) return;
    position.setValue(defaultPosition(width, height));
    setNotice({ seq, peerName: lastChatMsg.fromName, peerUserId: incomingPeerUserId });
  }, [height, lastChatMsg, pathname, position, routeParams.name, routeParams.peerUserId, token, user?.id, width]);

  useEffect(() => {
    if (
      notice
      && pathname.startsWith('/chat/')
      && routeParams.name === notice.peerName
    ) {
      setNotice(null);
    }
  }, [notice, pathname, routeParams.name]);

  useEffect(() => {
    if (notice) startBounce();
    return () => bounceLoopRef.current?.stop();
  }, [notice, startBounce]);

  useEffect(() => {
    position.stopAnimation(value => {
      position.setValue(clampPosition(value.x, value.y));
    });
  }, [clampPosition, height, position, width]);

  useEffect(() => {
    if (!token) setNotice(null);
  }, [token]);

  const openConversation = useCallback(() => {
    if (!notice) return;
    setNotice(null);
    router.navigate({
      pathname: '/chat/[name]',
      params: { name: notice.peerName, peerUserId: notice.peerUserId },
    });
  }, [notice, router]);

  const panResponder = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onPanResponderGrant: () => {
      draggingRef.current = false;
      position.stopAnimation(value => {
        dragOriginRef.current = value;
      });
    },
    onPanResponderMove: (_event, gesture) => {
      if (
        !draggingRef.current
        && Math.hypot(gesture.dx, gesture.dy) >= DRAG_START_DISTANCE
      ) {
        draggingRef.current = true;
        bounceLoopRef.current?.stop();
        bounce.setValue(0);
      }
      if (!draggingRef.current) return;
      const next = clampPosition(
        dragOriginRef.current.x + gesture.dx,
        dragOriginRef.current.y + gesture.dy,
      );
      position.setValue(next);
    },
    onPanResponderRelease: (_event, gesture) => {
      const wasDragging = draggingRef.current;
      draggingRef.current = false;
      if (wasDragging) {
        startBounce();
      } else if (Math.abs(gesture.dx) < 8 && Math.abs(gesture.dy) < 8) {
        openConversation();
      }
    },
    onPanResponderTerminate: () => {
      const wasDragging = draggingRef.current;
      draggingRef.current = false;
      if (wasDragging) startBounce();
    },
    onPanResponderTerminationRequest: () => !draggingRef.current,
  }), [bounce, clampPosition, openConversation, position, startBounce]);

  useEffect(() => () => {
    bounceLoopRef.current?.stop();
  }, []);

  if (!notice || !token) return null;

  return (
    <Animated.View
      accessibilityRole="button"
      accessibilityLabel={`收到 ${notice.peerName} 的新私信`}
      style={[styles.floating, { transform: position.getTranslateTransform() }]}
      {...panResponder.panHandlers}
    >
      <Animated.View style={[styles.bubble, { transform: [{ translateY: bounce }] }]}>
        <View style={styles.glow} />
        <Ionicons name="snow" size={34} color="#DDF7FF" />
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  floating: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: ICON_SIZE,
    height: ICON_SIZE,
    zIndex: 10000,
    elevation: 30,
  },
  bubble: {
    width: ICON_SIZE,
    height: ICON_SIZE,
    borderRadius: ICON_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#33A9DC',
    borderWidth: 2,
    borderColor: 'rgba(221,247,255,0.9)',
    shadowColor: '#33A9DC',
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.55,
    shadowRadius: 10,
  },
  glow: {
    position: 'absolute',
    width: 46,
    height: 46,
    borderRadius: 23,
    backgroundColor: 'rgba(127,216,245,0.28)',
  },
});
