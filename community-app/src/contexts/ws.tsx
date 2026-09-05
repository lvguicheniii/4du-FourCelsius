// WebSocket 实时上下文 — 事件队列模式 + 防重连风暴
import { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { AppState } from 'react-native';
import { BASE_URL, getPost } from '@/api/client';
import { useAuth } from '@/contexts/auth';
import { setPostStats } from '@/data/store';
import { useCommunityConfig } from '@/contexts/community-config';

interface WsMessage {
  type: 'pong' | 'chat' | 'chat_message_recalled' | 'like' | 'comment' | 'follow' | 'notification' | 'achievement' | 'account_restriction' | 'community_config_changed' | 'post_stats_changed' | 'reef_message' | 'reef_message_batch' | 'reef_room_updated' | 'reef_entered' | 'reef_error' | 'reef_block_changed' | 'frost_shell_inventory';
  _seq?: number;
  _eventId?: string;
  [key: string]: any;
}

const WsCtx = createContext({
  lastChatMsg: null as WsMessage | null,
  chatEvents: [] as WsMessage[],
  lastNotification: null as WsMessage | null,
  lastPostStatsChange: null as WsMessage | null,
  lastAchievement: null as WsMessage | null,
  connected: false,
  connectionVersion: 0,
  lastReefEvent: null as WsMessage | null,
  reefEvents: [] as WsMessage[],
  sendWs: (_message: Record<string, any>): boolean => false,
});

let globalSeq = 0;

export function WsProvider({ children }: { children: React.ReactNode }) {
  const { token, refreshUser } = useAuth();
  const { refresh: refreshCommunityConfig } = useCommunityConfig();
  const wsRef = useRef<any>(null);
  const timerRef = useRef<any>(null);
  const pongTimerRef = useRef<any>(null);
  const reconnectAttemptRef = useRef(0);
  const seenEventIdsRef = useRef(new Set<string>());
  const activeTokenRef = useRef<string | null>(null);
  const [connected, setConnected] = useState(false);
  const [connectionVersion, setConnectionVersion] = useState(0);
  const [lastChatMsg, setChatMsg] = useState<WsMessage | null>(null);
  const [chatEvents, setChatEvents] = useState<WsMessage[]>([]);
  const [, setChatSeq] = useState(0);
  const [lastNotification, setNotification] = useState<WsMessage | null>(null);
  const [lastPostStatsChange, setLastPostStatsChange] = useState<WsMessage | null>(null);
  const [lastAchievement, setAchievement] = useState<WsMessage | null>(null);
  const [lastReefEvent, setReefEvent] = useState<WsMessage | null>(null);
  const [reefEvents, setReefEvents] = useState<WsMessage[]>([]);

  const sendWs = useCallback((message: Record<string, any>) => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return false;
    wsRef.current.send(JSON.stringify(message));
    return true;
  }, []);

  const connect = useCallback(function connectSocket() {
    // 标记旧连接为主动关闭，防止 onclose 触发重连
    if (wsRef.current) {
      wsRef.current._intentional = true;
      wsRef.current.close();
      wsRef.current = null;
    }

    if (activeTokenRef.current !== token) {
      activeTokenRef.current = token;
      seenEventIdsRef.current.clear();
      setChatMsg(null);
      setChatEvents([]);
      setNotification(null);
      setLastPostStatsChange(null);
      setAchievement(null);
      setReefEvent(null);
      setReefEvents([]);
    }

    if (!token) {
      clearTimeout(timerRef.current);
      clearTimeout(pongTimerRef.current);
      setConnected(false);
      setChatMsg(null);
      setChatEvents([]);
      setNotification(null);
      setAchievement(null);
      setReefEvent(null);
      setReefEvents([]);
      return;
    }

    try {
      const wsUrl = BASE_URL.replace(/^http/, 'ws') + '/ws';
      const ws = new WebSocket(wsUrl, ['sidu-auth-v1', token]) as any;
      ws._intentional = false;
      wsRef.current = ws;

      ws.onopen = () => {
        if (wsRef.current !== ws) {
          ws._intentional = true;
          ws.close();
          return;
        }
        clearTimeout(timerRef.current);
        clearTimeout(pongTimerRef.current);
        reconnectAttemptRef.current = 0;
        setConnected(true);
        setConnectionVersion(version => version + 1);
        // 重连时补拉一次，避免离线期间错过后台配置变更事件。
        refreshCommunityConfig();
        if (AppState.currentState === 'active') {
          ws.send(JSON.stringify({ type: 'app_active' }));
        }
      };

      ws.onmessage = (e: MessageEvent) => {
        if (wsRef.current !== ws) return;
        try {
          const msg: WsMessage = JSON.parse(e.data);
          if (msg.type === 'pong') {
            clearTimeout(pongTimerRef.current);
            return;
          }
          if (msg._eventId) {
            if (seenEventIdsRef.current.has(msg._eventId)) return;
            seenEventIdsRef.current.add(msg._eventId);
            if (seenEventIdsRef.current.size > 500) {
              const oldest = seenEventIdsRef.current.values().next().value;
              if (oldest) seenEventIdsRef.current.delete(oldest);
            }
          }
          if (msg.type === 'reef_message_batch' && Array.isArray(msg.messages)) {
            const events = msg.messages.map((message: any) => ({
              type: 'reef_message' as const,
              roomId: msg.roomId,
              message,
              sentAt: msg.sentAt,
              _seq: ++globalSeq,
            }));
            if (events.length) {
              setReefEvent(events[events.length - 1]);
              setReefEvents(current => [...current, ...events].slice(-100));
            }
            return;
          }
          msg._seq = ++globalSeq;
          if (msg.type === 'account_restriction') {
            refreshUser();
            if (msg.restriction === 'banned') {
              ws._intentional = true;
              ws.close();
            }
            return;
          }
          if (msg.type === 'frost_shell_inventory') {
            refreshUser();
            return;
          }
          if (msg.type === 'community_config_changed') {
            refreshCommunityConfig();
            return;
          }
          if (msg.type === 'chat' || msg.type === 'chat_message_recalled') {
            setChatMsg(msg);
            setChatEvents(current => [...current, msg].slice(-100));
            setChatSeq(s => s + 1);
          } else if (msg.type === 'achievement') {
            setAchievement(msg);
          } else if (msg.type.startsWith('reef_')) {
            setReefEvent(msg);
            setReefEvents(current => [...current, msg].slice(-100));
          } else {
            if (msg.type === 'post_stats_changed') setLastPostStatsChange(msg);
            else setNotification(msg);
            if (msg.relatedId) {
              getPost(msg.relatedId).then(post => {
                if (wsRef.current !== ws) return;
                setPostStats(post.id, {
                  likes: post.likes ?? 0,
                  liked: !!post.liked,
                  comments: Array.isArray(post.comments)
                    ? post.comments.length
                    : Math.max(0, Number(post.comments) || 0),
                });
              }).catch(() => {});
            }
          }
        } catch {}
      };

      ws.onclose = (event: CloseEvent) => {
        if (wsRef.current !== ws) return;
        clearTimeout(pongTimerRef.current);
        setConnected(false);
        wsRef.current = null;
        if (!ws._intentional && (event.code === 4001 || event.code === 4003)) {
          refreshUser();
          return;
        }
        if (!ws._intentional && AppState.currentState === 'active') {
          clearTimeout(timerRef.current);
          const attempt = event.code === 1012 ? 0 : reconnectAttemptRef.current++;
          const baseDelay = event.code === 1012 ? 500 : Math.min(30000, 1000 * 2 ** attempt);
          const delay = Math.round(baseDelay * (0.8 + Math.random() * 0.4));
          timerRef.current = setTimeout(connectSocket, delay);
        }
      };

      ws.onerror = () => ws.close();
    } catch {}
  }, [token, refreshUser, refreshCommunityConfig]);

  useEffect(() => {
    connect();
    return () => {
      clearTimeout(timerRef.current);
      clearTimeout(pongTimerRef.current);
      if (wsRef.current) {
        wsRef.current._intentional = true;
        wsRef.current.close();
      }
    };
  }, [connect]);

  useEffect(() => {
    if (!token) return;
    const subscription = AppState.addEventListener('change', state => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: state === 'active' ? 'app_active' : 'app_inactive' }));
      }
      if (state !== 'active') return;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        clearTimeout(timerRef.current);
        connect();
        return;
      }
      clearTimeout(pongTimerRef.current);
      ws.send(JSON.stringify({ type: 'ping' }));
      pongTimerRef.current = setTimeout(() => {
        if (wsRef.current === ws) ws.close();
      }, 5000);
    });
    return () => subscription.remove();
  }, [connect, token]);

  return (
    <WsCtx.Provider value={{ lastChatMsg, chatEvents, lastNotification, lastPostStatsChange, lastAchievement, connected, connectionVersion, lastReefEvent, reefEvents, sendWs }}>
      {children}
    </WsCtx.Provider>
  );
}

export function useWs() {
  return useContext(WsCtx);
}
