import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { boards as fallbackBoards, type Board } from '@/data/mock';
import { getCommunityConfig } from '@/api/client';
import { useAuth } from '@/contexts/auth';

const fallbackTopics = [
  '#社交断电','#允许自己融化','#无意义漂浮','#低能量预警','#一次静音的崩溃','#情绪回收站',
  '#潜流打捞局','#4°C避难所','#寻找同频','#今日水压偏高','#人类观察日志','#光合作用记录',
  '#深夜白噪音','#毫无用处的冷知识','#路灯下的影子','#强制下线','#精神离职','#做一棵树',
];

type CommunityConfig = {
  boards: Board[];
  topics: string[];
  features: Record<string, boolean>;
  dailyTopic: { id: string; title: string; themeDate: string } | null;
  dailyTopicHistory: { id: string; title: string; themeDate: string }[];
  refresh: () => Promise<void>;
};

const Context = createContext<CommunityConfig>({ boards: fallbackBoards, topics: fallbackTopics, features: {}, dailyTopic: null, dailyTopicHistory: [], refresh: async () => {} });

export function CommunityConfigProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const [boards, setBoards] = useState<Board[]>(fallbackBoards);
  const [topics, setTopics] = useState<string[]>(fallbackTopics);
  const [features, setFeatures] = useState<Record<string, boolean>>({});
  const [dailyTopic, setDailyTopic] = useState<CommunityConfig['dailyTopic']>(null);
  const [dailyTopicHistory, setDailyTopicHistory] = useState<CommunityConfig['dailyTopicHistory']>([]);
  const refresh = useCallback(async () => {
    try {
      const data = await getCommunityConfig();
      if (Array.isArray(data.boards)) {
        setBoards(data.boards.map((b: any) => ({ ...b, members: 0, posts: 0 })));
      }
      if (Array.isArray(data.topics)) setTopics(data.topics.map((t: any) => t.name));
      if (data.features && typeof data.features === 'object') setFeatures(data.features);
      setDailyTopic(data.dailyTopic || null);
      setDailyTopicHistory(Array.isArray(data.dailyTopicHistory) ? data.dailyTopicHistory : []);
    } catch { /* 离线时保留内置配置 */ }
  }, [token]);
  useEffect(() => {
    refresh();
    const now = Date.now();
    const cst = new Date(now + 8 * 60 * 60 * 1000);
    const nextMidnight = Date.UTC(cst.getUTCFullYear(), cst.getUTCMonth(), cst.getUTCDate() + 1) - 8 * 60 * 60 * 1000;
    let interval: ReturnType<typeof setInterval> | undefined;
    const timer = setTimeout(() => {
      void refresh();
      interval = setInterval(() => void refresh(), 24 * 60 * 60 * 1000);
    }, Math.max(1000, nextMidnight - now + 1000));
    const appState = AppState.addEventListener('change', state => {
      if (state === 'active') void refresh();
    });
    return () => {
      clearTimeout(timer);
      if (interval) clearInterval(interval);
      appState.remove();
    };
  }, [refresh]);
  const value = useMemo(() => ({ boards, topics, features, dailyTopic, dailyTopicHistory, refresh }), [boards, topics, features, dailyTopic, dailyTopicHistory, refresh]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

export const useCommunityConfig = () => useContext(Context);
