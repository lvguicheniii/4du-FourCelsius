import { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode } from 'react';
import { AppState } from 'react-native';
import { getToken as getApiToken, setToken as setApiToken, getMe, setAuthInvalidationHandler, unregisterPushToken } from '@/api/client';
import * as SecureStore from 'expo-secure-store';
import { resetAccountScopedStore } from '@/data/store';

const TOKEN_KEY = 'auth_token';
const USER_KEY = 'auth_user';

interface User {
  id: string;
  username: string;
  nickname: string;
  avatar: string | null;
  bio: string;
  tags: string[];
  gender: 'male' | 'female' | null;
  age?: number;
  refrigerant_count?: number;
  gifted_refrigerant_count?: number;
  fragile_frost_shell_count?: number;
  eternal_frost_shell_count?: number;
  phone?: string;
  role?: string;
  status?: 'active' | 'banned' | 'deleted';
  ban_reason?: string;
  ban_until?: string | null;
  muted_until?: string | null;
}

interface AuthState {
  token: string | null;
  user: User | null;
  isLoading: boolean;
  login: (token: string, user: User) => Promise<void>;
  replaceToken: (token: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthState>({
  token: null, user: null, isLoading: true,
  login: async () => {}, replaceToken: async () => {}, logout: async () => {}, refreshUser: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const storageQueueRef = useRef<Promise<void>>(Promise.resolve());
  const refreshGenerationRef = useRef(0);

  const runStorageOperation = useCallback(<T,>(operation: () => Promise<T>): Promise<T> => {
    const result = storageQueueRef.current.then(operation, operation);
    storageQueueRef.current = result.then(() => undefined, () => undefined);
    return result;
  }, []);

  // 启动时从安全存储恢复 token 和用户
  useEffect(() => {
    (async () => {
      try {
        const savedToken = await SecureStore.getItemAsync(TOKEN_KEY);
        const savedUser = await SecureStore.getItemAsync(USER_KEY);
        if (savedToken && savedUser) {
          const parsedUser = JSON.parse(savedUser) as User;
          setToken(savedToken);
          setApiToken(savedToken);
          setUser(parsedUser);
        } else if (savedToken || savedUser) {
          await Promise.allSettled([
            SecureStore.deleteItemAsync(TOKEN_KEY),
            SecureStore.deleteItemAsync(USER_KEY),
          ]);
        }
      } catch {
        setToken(null);
        setUser(null);
        setApiToken(null);
        await Promise.allSettled([
          SecureStore.deleteItemAsync(TOKEN_KEY),
          SecureStore.deleteItemAsync(USER_KEY),
        ]);
      } finally {
        setIsLoading(false);
      }
    })();
  }, []);

  const login = useCallback(async (t: string, u: User) => {
    await runStorageOperation(async () => {
      try {
        await Promise.all([
          SecureStore.setItemAsync(TOKEN_KEY, t),
          SecureStore.setItemAsync(USER_KEY, JSON.stringify(u)),
        ]);
      } catch (error) {
        await Promise.allSettled([
          SecureStore.deleteItemAsync(TOKEN_KEY),
          SecureStore.deleteItemAsync(USER_KEY),
        ]);
        throw error;
      }
    });
    refreshGenerationRef.current += 1;
    resetAccountScopedStore();
    setToken(t);
    setUser(u);
    setApiToken(t);
  }, [runStorageOperation]);

  const replaceToken = useCallback(async (t: string) => {
    await runStorageOperation(() => SecureStore.setItemAsync(TOKEN_KEY, t));
    refreshGenerationRef.current += 1;
    setToken(t);
    setApiToken(t);
  }, [runStorageOperation]);

  const clearSession = useCallback(async () => {
    refreshGenerationRef.current += 1;
    setToken(null);
    setUser(null);
    setApiToken(null);
    resetAccountScopedStore();
    await runStorageOperation(() => Promise.allSettled([
      SecureStore.deleteItemAsync(TOKEN_KEY),
      SecureStore.deleteItemAsync(USER_KEY),
    ]));
  }, [runStorageOperation]);

  const logout = useCallback(async () => {
    const authToken = token;
    SecureStore.getItemAsync('expo_push_token').then((pushToken) => {
      if (pushToken && authToken) void unregisterPushToken(pushToken, authToken);
    }).catch(() => {});
    await clearSession();
  }, [clearSession, token]);

  useEffect(() => {
    setAuthInvalidationHandler(() => { void clearSession(); });
    return () => setAuthInvalidationHandler(null);
  }, [clearSession]);

  const refreshUser = useCallback(async () => {
    const requestToken = getApiToken();
    if (!requestToken) return;
    const refreshGeneration = ++refreshGenerationRef.current;
    try {
      const data = await getMe();
      if (getApiToken() !== requestToken || refreshGeneration !== refreshGenerationRef.current) return;
      const updated = {
        id: data.id,
        username: data.username,
        nickname: data.nickname || data.username,
        avatar: data.avatar,
        bio: data.bio || '',
        tags: data.tags || [],
        gender: data.gender || null,
        age: data.age,
        refrigerant_count: data.refrigerant_count ?? 0,
        gifted_refrigerant_count: data.gifted_refrigerant_count ?? 0,
        fragile_frost_shell_count: data.fragile_frost_shell_count ?? 0,
        eternal_frost_shell_count: data.eternal_frost_shell_count ?? data.gifted_refrigerant_count ?? 0,
        role: data.role || 'user',
        status: data.status || 'active',
        ban_reason: data.ban_reason || '',
        ban_until: data.ban_until || null,
        muted_until: data.muted_until || null,
      };
      setUser(updated);
      await runStorageOperation(async () => {
        if (getApiToken() !== requestToken || refreshGeneration !== refreshGenerationRef.current) return;
        await SecureStore.setItemAsync(USER_KEY, JSON.stringify(updated));
      });
    } catch (error) {
      // 网络瞬断时保留登录态；只有服务端明确判定凭证失效才退出。
      if (
        (error as { status?: number })?.status === 401
        && getApiToken() === requestToken
        && refreshGeneration === refreshGenerationRef.current
      ) void logout();
    }
  }, [logout, runStorageOperation]);

  // 管理后台变更账号状态后，App 最迟数秒内同步；回到前台时立即同步。
  useEffect(() => {
    if (!token) return;
    refreshUser();
    const timer = setInterval(refreshUser, 10_000);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refreshUser();
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [token, refreshUser]);

  return (
    <AuthContext.Provider value={{ token, user, isLoading, login, replaceToken, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
