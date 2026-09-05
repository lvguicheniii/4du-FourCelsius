import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { API_ORIGIN, api, getToken, setToken, uploadFile } from "./api";

type Session = {
  user: any | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  register: (data: Parameters<typeof api.register>[0], avatar?: File | null) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
};
const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<any | null>(null);
  const [loading, setLoading] = useState(true);
  const generation = useRef(0);
  const bannedRefreshInFlight = useRef(false);
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    if (!getToken()) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const data = await api.me();
      if (current === generation.current) setUser(data);
    } catch {
      if (current === generation.current) {
        setToken("");
        setUser(null);
      }
    } finally {
      if (current === generation.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const invalid = () => {
      generation.current++;
      setToken("");
      setUser(null);
      setLoading(false);
    };
    window.addEventListener("sidu-session-invalid", invalid);
    const banned = (event: Event) => {
      const detail = (event as CustomEvent<any>).detail || {};
      setUser((current: any) => current ? {
        ...current,
        status: "banned",
        ban_until: detail.banUntil || null,
        ban_reason: detail.reason || current.ban_reason || "",
      } : current);
      setLoading(false);
      if (bannedRefreshInFlight.current) return;
      bannedRefreshInFlight.current = true;
      void api.me().then((profile) => {
        generation.current++;
        setUser(profile);
      }).catch(() => {}).finally(() => {
        bannedRefreshInFlight.current = false;
      });
    };
    window.addEventListener("sidu-account-banned", banned);
    return () => {
      window.removeEventListener("sidu-session-invalid", invalid);
      window.removeEventListener("sidu-account-banned", banned);
    };
  }, [refresh]);
  const login = useCallback(async (username: string, password: string) => {
    const data = await api.login(username, password);
    setToken(data.token);
    generation.current++;
    setUser(data.user);
  }, []);
  const register = useCallback(async (values: Parameters<typeof api.register>[0], avatar?: File | null) => {
    const data = await api.register(values);
    setToken(data.token);
    generation.current++;
    setUser(data.user);
    if (avatar) {
      void (async () => {
        try {
          const uploaded = await uploadFile(avatar, "a");
          await api.updateProfile({ avatar: uploaded.url });
          const profile = await api.me();
          generation.current++;
          setUser(profile);
        } catch {}
      })();
    }
  }, []);
  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch {
    } finally {
      generation.current++;
      setToken("");
      setUser(null);
    }
  }, []);
  const value = useMemo(
    () => ({ user, loading, login, register, logout, refresh }),
    [user, loading, login, register, logout, refresh],
  );
  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function useSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error("SessionProvider missing");
  return value;
}

type RealtimeValue = {
  connected: boolean;
  version: number;
  lastEvent: any | null;
  enterReef: (roomId: string) => void;
  leaveReef: () => void;
};
const RealtimeContext = createContext<RealtimeValue>({
  connected: false,
  version: 0,
  lastEvent: null,
  enterReef: () => {},
  leaveReef: () => {},
});

export function RealtimeProvider({ children }: { children: ReactNode }) {
  const { user } = useSession();
  const [connected, setConnected] = useState(false);
  const [version, setVersion] = useState(0);
  const [lastEvent, setLastEvent] = useState<any>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const reefRoomRef = useRef("");
  const enterReef = useCallback((roomId: string) => {
    reefRoomRef.current = roomId;
    if (socketRef.current?.readyState === WebSocket.OPEN) socketRef.current.send(JSON.stringify({ type: "reef_enter", roomId }));
  }, []);
  const leaveReef = useCallback(() => {
    reefRoomRef.current = "";
    if (socketRef.current?.readyState === WebSocket.OPEN) socketRef.current.send(JSON.stringify({ type: "reef_leave" }));
  }, []);
  useEffect(() => {
    const sessionToken = getToken();
    if (!user || !sessionToken || user.status === "banned") {
      setConnected(false);
      return;
    }
    let closed = false;
    let socket: WebSocket | null = null;
    let timer = 0;
    const connect = () => {
      if (closed) return;
      const apiUrl = API_ORIGIN ? new URL(API_ORIGIN) : null;
      const protocol = (apiUrl?.protocol || location.protocol) === "https:" ? "wss" : "ws";
      const host = apiUrl?.host || location.host;
      socket = new WebSocket(
        `${protocol}://${host}/ws`,
        ['sidu-auth-v1', sessionToken],
      );
      socketRef.current = socket;
      socket.onopen = () => {
        setConnected(true);
        setVersion((v) => v + 1);
        socket?.send(JSON.stringify({ type: "app_active" }));
        if (reefRoomRef.current) socket?.send(JSON.stringify({ type: "reef_enter", roomId: reefRoomRef.current }));
      };
      socket.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type !== "pong") {
            setLastEvent(data);
            setVersion((v) => v + 1);
          }
        } catch {}
      };
      socket.onclose = (event) => {
        setConnected(false);
        if (event.code === 4003) {
          window.dispatchEvent(new CustomEvent("sidu-account-banned", { detail: {} }));
          return;
        }
        if (!closed) timer = window.setTimeout(connect, 1800);
      };
      socket.onerror = () => socket?.close();
    };
    connect();
    return () => {
      closed = true;
      clearTimeout(timer);
      socket?.close();
      socketRef.current = null;
    };
  }, [user?.id, user?.status]);
  return (
    <RealtimeContext.Provider value={{ connected, version, lastEvent, enterReef, leaveReef }}>
      {children}
    </RealtimeContext.Provider>
  );
}
export const useRealtime = () => useContext(RealtimeContext);
