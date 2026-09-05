import { useCallback, useState, useEffect, useRef, useMemo } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View, Pressable, Animated as RNAnimated, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import { getPosts, getFollowingPosts, getRecommendPosts } from '@/api/client';
import { PostCard } from '@/components/post-card';
import { useTheme } from '@/lib/theme';
import { blockedUsers, reportedPosts, setPostStats } from '@/data/store';
import { useStructuralStoreVersion } from '@/hooks/use-store';
import { queueRecommendationEvent } from '@/lib/recommendation-events';
import { useAuth } from '@/contexts/auth';
import { useRouter } from 'expo-router';
import PagerView from 'react-native-pager-view';
import Reanimated, { Easing, interpolateColor, useAnimatedStyle, useEvent, useHandler, useSharedValue, withTiming, type SharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { isAndroidLiquidGlassEnabled, isNativeLiquidGlassEnabled, NativeLiquidGlassView } from '@/components/liquid-glass';
import { AppRefreshControl, refreshIndicatorBelow } from '@/components/app-refresh-control';

const AnimatedPagerView = Reanimated.createAnimatedComponent(PagerView);

function usePageScrollHandler(handlers: any, dependencies: any[] = []) {
  const { context, doDependenciesDiffer } = useHandler(handlers, dependencies);
  return useEvent<any, any>((event) => {
    'worklet';
    if (event.eventName.endsWith('onPageScroll')) handlers.onPageScroll?.(event, context);
  }, ['onPageScroll'], doDependenciesDiffer);
}

function FeedTabLabel({ label, index, progress, activeColor, mutedColor }: {
  label: string; index: number; progress: SharedValue<number>; activeColor: string; mutedColor: string;
}) {
  const animatedStyle = useAnimatedStyle(() => ({
    color: interpolateColor(progress.value, [index - 1, index, index + 1], [mutedColor, activeColor, mutedColor]),
  }), [activeColor, index, mutedColor]);
  return <Reanimated.Text style={[styles.tabText, animatedStyle]}>{label}</Reanimated.Text>;
}

type TabName = 'following' | 'recommend' | 'latest' | 'announce';
const TABS: { key: TabName; label: string }[] = [
  { key: 'following', label: '关注' },
  { key: 'recommend', label: '推荐' },
  { key: 'latest', label: '最新' },
  { key: 'announce', label: '公告' },
];

// Keep the feed bounded on low-memory Android devices. The server still
// supports pagination; the home screen only needs a modest first window.
const FEED_PAGE_LIMIT = 100;

interface Post {
  id: string; username: string; nickname: string; avatar: string | null;
  content: string; images: string[]; boardId: string;
  likes: number; comments: number; liked: boolean; createdAt: string;
}

export default function HomeScreen() {
  const router = useRouter();
  const { feedTab, refreshFeed, deepDive } = useLocalSearchParams<{ feedTab?: string; refreshFeed?: string; deepDive?: string }>();
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const { token, isLoading: authLoading } = useAuth();
  const { width: sw, height: sh } = useWindowDimensions();
  const [posts, setPosts] = useState<Post[]>([]);
  const [recommendPosts, setRecommendPosts] = useState<Post[]>([]);
  const [followingPosts, setFollowingPosts] = useState<Post[]>([]);
  const [announcePosts, setAnnouncePosts] = useState<Post[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const feedExitY = useRef(new RNAnimated.Value(0)).current;
  const mounted = useRef(true);
  const recommendCursorRef = useRef<string | null>(null);
  const recommendHasMoreRef = useRef(true);
  const recommendLoadingMoreRef = useRef(false);
  const recommendGenerationRef = useRef(0);
  const postsRequestRef = useRef(0);
  const followingRequestRef = useRef(0);
  const announceRequestRef = useRef(0);
  const [recommendLoadingMore, setRecommendLoadingMore] = useState(false);
  const storeVer = useStructuralStoreVersion();
  const [tab, setTab] = useState<TabName>('recommend');
  const pagerRef = useRef<any>(null);
  const recommendationViewabilityConfig = useRef({ itemVisiblePercentThreshold: 60, minimumViewTime: 600 }).current;
  const onRecommendationViewableItemsChanged = useRef(({ viewableItems }: any) => {
    viewableItems.forEach(({ item, isViewable }: any) => {
      if (isViewable && item?.id) queueRecommendationEvent(item.id, 'impression');
    });
  }).current;

  // 页面位移同时驱动下划线和标题颜色，拖动过程完全跟手。
  const pageProgress = useSharedValue(1);
  const androidTapTransitionActive = useSharedValue(false);
  const underlineW = 24;
  const tabWidth = (sw - 32) / TABS.length;
  const underlineStart = 16 + (tabWidth - underlineW) / 2;
  const underlineStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: underlineStart + pageProgress.value * tabWidth }],
  }), [tabWidth, underlineStart]);
  const glassBubbleStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: pageProgress.value * tabWidth }],
  }), [tabWidth]);
  const pageScrollHandler = usePageScrollHandler({
    onPageScroll: (event: any) => {
      'worklet';
      if (androidTapTransitionActive.value) return;
      pageProgress.value = event.position + event.offset;
    },
  });

  const switchTab = useCallback((t: TabName) => {
    const idx = TABS.findIndex(x => x.key === t);
    if (idx < 0) return;
    if (!isAndroidLiquidGlassEnabled) {
      pagerRef.current?.setPage(idx);
      return;
    }
    const distance = Math.abs(pageProgress.value - idx);
    androidTapTransitionActive.value = true;
    pageProgress.value = withTiming(
      idx,
      {
        duration: 220 + Math.min(distance, 3) * 45,
        easing: Easing.bezier(0.4, 0, 0.2, 1),
      },
      finished => {
        'worklet';
        if (finished) androidTapTransitionActive.value = false;
      },
    );
    // 点击标题时内容直接跳页，胶囊继续由 UI 线程完成单段连续动画；手势滑动仍由 PagerView 驱动。
    pagerRef.current?.setPageWithoutAnimation(idx);
  }, [androidTapTransitionActive, pageProgress]);

  const sortLatest = (arr: Post[]) => [...arr].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  const postsByTab = useMemo<Record<TabName, Post[]>>(() => ({
    following: followingPosts,
    recommend: recommendPosts,
    latest: sortLatest(posts),
    announce: announcePosts,
  }), [posts, recommendPosts, followingPosts, announcePosts]);

  const fetchRecommend = useCallback(async (reset = true) => {
    if (!reset && (!recommendHasMoreRef.current || recommendLoadingMoreRef.current)) return;
    const generation = reset ? ++recommendGenerationRef.current : recommendGenerationRef.current;
    if (!reset) {
      recommendLoadingMoreRef.current = true;
      setRecommendLoadingMore(true);
    }
    const requestStartedAt = Date.now();
    try {
      const data = await getRecommendPosts(reset ? undefined : recommendCursorRef.current || undefined, 20);
      if (generation !== recommendGenerationRef.current) return;
      const filtered = data.posts;
      filtered.forEach((p: any) => setPostStats(p.id, { likes: p.likes, liked: p.liked, comments: p.comments }, { silent: true, sourceStartedAt: requestStartedAt }));
      recommendCursorRef.current = data.nextCursor || null;
      recommendHasMoreRef.current = !!data.hasMore;
      if (mounted.current) {
        setRecommendPosts((current) => reset
          ? filtered as Post[]
          : [...current, ...filtered.filter((post: Post) => !current.some((item) => item.id === post.id))]);
      }
    } catch { /* ignore */ }
    finally {
      recommendLoadingMoreRef.current = false;
      if (mounted.current) setRecommendLoadingMore(false);
    }
  }, [storeVer]);

  const fetchPosts = useCallback(async (isRefresh: boolean) => {
    const requestId = ++postsRequestRef.current;
    const requestStartedAt = Date.now();
    try {
      const data = await getPosts(1, FEED_PAGE_LIMIT);
      if (!mounted.current || requestId !== postsRequestRef.current) return;
      const filtered = data.posts.filter((p: any) =>
        !blockedUsers[p.nickname || p.username || ''] && !reportedPosts[p.id] && !(p.boardId || '').includes('announce')
      );
      filtered.forEach((p: any) => setPostStats(p.id, { likes: p.likes, liked: p.liked, comments: p.comments }, { silent: true, sourceStartedAt: requestStartedAt }));
      setPosts(prev => {
        if (!isRefresh && prev.length === filtered.length && prev.every((p, i) => {
          const f = filtered[i] as any;
          return (p as any).id === f.id && (p as any).likes === f.likes && (p as any).comments === f.comments;
        })) return prev;
        return filtered as Post[];
      });
    } catch { /* ignore */ }
    if (mounted.current) setLoading(false);
  }, [storeVer]);

  const fetchFollowing = useCallback(async () => {
    const requestId = ++followingRequestRef.current;
    if (!token) {
      if (!authLoading) setFollowingPosts([]);
      return;
    }
    try {
      const data = await getFollowingPosts();
      if (!mounted.current || requestId !== followingRequestRef.current) return;
      setFollowingPosts(data.posts.filter((p: any) =>
        !blockedUsers[p.nickname || p.username || ''] && !reportedPosts[p.id] && !(p.boardId || '').includes('announce')
      ));
    } catch { /* ignore */ }
  }, [authLoading, token]);

  const fetchAnnounce = useCallback(async () => {
    const requestId = ++announceRequestRef.current;
    try {
      const data = await getPosts(1, FEED_PAGE_LIMIT);
      if (!mounted.current || requestId !== announceRequestRef.current) return;
      setAnnouncePosts(data.posts.filter((p: any) => {
        try { const ids = JSON.parse(p.boardId || '[]'); return Array.isArray(ids) ? ids.includes('announce') : false; } catch { return false; }
      }));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    mounted.current = true;
    fetchPosts(true);
    fetchRecommend();
    fetchFollowing();
    fetchAnnounce();
    return () => { mounted.current = false; };
  }, [fetchPosts, fetchRecommend, fetchFollowing, fetchAnnounce]);

  const onRefresh = useCallback((pageTab: TabName) => {
    setRefreshing(true);
    if (pageTab === 'following') fetchFollowing().then(() => setRefreshing(false));
    else if (pageTab === 'announce') fetchAnnounce().then(() => setRefreshing(false));
    else if (pageTab === 'recommend') fetchRecommend().then(() => setRefreshing(false));
    else fetchPosts(true).then(() => setRefreshing(false));
  }, [fetchPosts, fetchRecommend, fetchFollowing, fetchAnnounce]);

  useEffect(() => {
    if (!deepDive) return;
    feedExitY.stopAnimation();
    feedExitY.setValue(0);
    RNAnimated.timing(feedExitY, {
      toValue: sh,
      duration: 420,
      useNativeDriver: true,
    }).start();
    const navigationTimer = setTimeout(() => {
      router.push({ pathname: '/undercurrent', params: { entry: 'drop' } });
    }, 16);
    const resetTimer = setTimeout(() => feedExitY.setValue(0), 650);
    return () => {
      clearTimeout(navigationTimer);
      clearTimeout(resetTimer);
    };
  }, [deepDive, feedExitY, router, sh]);

  useEffect(() => {
    if (feedTab !== 'latest' || !refreshFeed) return;
    const latestIndex = TABS.findIndex(item => item.key === 'latest');
    setTab('latest');
    setRefreshing(true);
    requestAnimationFrame(() => {
      pagerRef.current?.setPageWithoutAnimation(latestIndex);
    });
    fetchPosts(true).finally(() => {
      if (mounted.current) setRefreshing(false);
    });
  }, [feedTab, refreshFeed, fetchPosts, sw]);

  const refreshKey = useCallback(async () => { await Promise.all([fetchPosts(true), fetchRecommend()]); }, [fetchPosts, fetchRecommend]);

  useEffect(() => {
    const index = TABS.findIndex(item => item.key === tab);
    pageProgress.value = index;
    requestAnimationFrame(() => {
      pagerRef.current?.setPageWithoutAnimation(index);
    });
  }, [pageProgress]);

  const activeIndex = TABS.findIndex(item => item.key === tab);
  const renderFeedPage = (page: { key: TabName; label: string }) => {
    const pageIndex = TABS.findIndex(item => item.key === page.key);
    const keepMounted = Math.abs(pageIndex - activeIndex) <= 1;
    return (
    <View key={page.key} collapsable={false} style={{ flex: 1, backgroundColor: colors.bg }}>
      {keepMounted ? <FlatList
        initialNumToRender={4}
        maxToRenderPerBatch={4}
        windowSize={5}
        removeClippedSubviews
        scrollEventThrottle={16}
        data={postsByTab[page.key]}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <PostCard post={item} onRefresh={refreshKey} feedContext={page.key} />}
        contentContainerStyle={{
          padding: 12,
          paddingTop: isNativeLiquidGlassEnabled ? insets.top + 108 : 4,
          paddingBottom: Math.max(insets.bottom + 104, 112),
          flexGrow: 1,
        }}
        style={{ flex: 1, backgroundColor: colors.bg }}
        showsVerticalScrollIndicator={false}
        refreshControl={(
          <AppRefreshControl
            refreshing={refreshing && tab === page.key}
            onRefresh={() => onRefresh(page.key)}
            progressViewOffset={refreshIndicatorBelow(isNativeLiquidGlassEnabled ? insets.top + 95 : 0)}
            colors={[colors.accent]}
            tintColor={colors.accent}
            progressBackgroundColor={colors.card}
          />
        )}
        onEndReached={page.key === 'recommend' ? () => fetchRecommend(false) : undefined}
        onEndReachedThreshold={0.45}
        viewabilityConfig={page.key === 'recommend' ? recommendationViewabilityConfig : undefined}
        onViewableItemsChanged={page.key === 'recommend' ? onRecommendationViewableItemsChanged : undefined}
        ListFooterComponent={page.key === 'recommend' && recommendLoadingMore
          ? <ActivityIndicator size="small" color={colors.accent} style={{ marginVertical: 16 }} />
          : null}
        ListEmptyComponent={
          loading ? (
            <ActivityIndicator size="large" color={colors.accent} style={{ marginTop: 60 }} />
          ) : (
            <View style={{ alignItems: 'center', justifyContent: 'center', paddingTop: 80 }}>
              <Ionicons name="snow-outline" size={48} color={colors.textMuted} />
              <Text style={{ color: colors.textMuted, fontSize: 14, marginTop: 12 }}>这里还没有内容</Text>
            </View>
          )
        }
      /> : null}
    </View>
    );
  };

  return (
    <RNAnimated.View style={{ flex: 1, backgroundColor: colors.bg, transform: [{ translateY: feedExitY }] }}>
      {isNativeLiquidGlassEnabled ? (
        <View pointerEvents="box-none" style={[styles.glassTabBarPlacement, { top: insets.top + 53 }]}>
          <NativeLiquidGlassView
            glassEffectStyle="regular"
            colorScheme={isDark ? 'dark' : 'light'}
            isInteractive
            style={styles.glassFeedBar}
          >
            <Reanimated.View
              pointerEvents="none"
              style={[
                styles.glassFeedBubbleMotion,
                { width: tabWidth },
                glassBubbleStyle,
              ]}
            >
              <NativeLiquidGlassView
                glassEffectStyle="clear"
                colorScheme={isDark ? 'dark' : 'light'}
                style={styles.glassFeedBubble}
              />
            </Reanimated.View>
            {TABS.map((t, index) => (
              <Pressable
                key={t.key}
                style={styles.glassFeedTabBtn}
                onPress={() => switchTab(t.key)}
              >
                <FeedTabLabel label={t.label} index={index} progress={pageProgress} activeColor={colors.accent} mutedColor={colors.textMuted} />
              </Pressable>
            ))}
          </NativeLiquidGlassView>
        </View>
      ) : (
        <View style={[styles.tabBar, { backgroundColor: colors.header }]}>
          {TABS.map((t, index) => {
            return (
              <Pressable key={t.key} style={styles.tabBtn} onPress={() => switchTab(t.key)}>
                <FeedTabLabel label={t.label} index={index} progress={pageProgress} activeColor={colors.accent} mutedColor={colors.textMuted} />
              </Pressable>
            );
          })}
          <Reanimated.View style={[styles.underline, { width: underlineW }, underlineStyle]} />
        </View>
      )}

      <AnimatedPagerView
        ref={pagerRef}
        style={styles.pager}
        initialPage={1}
        offscreenPageLimit={1}
        onPageScroll={pageScrollHandler}
        onPageSelected={(event) => {
          const index = event.nativeEvent.position;
          if (!androidTapTransitionActive.value) pageProgress.value = index;
          setTab(TABS[Math.min(Math.max(index, 0), TABS.length - 1)].key);
        }}
      >
        {TABS.map(renderFeedPage)}
      </AnimatedPagerView>
    </RNAnimated.View>
  );
}

const styles = StyleSheet.create({
  tabBar: { flexDirection: 'row', paddingTop: 0, paddingBottom: 8, paddingHorizontal: 16, position: 'relative' },
  tabBtn: { flex: 1, alignItems: 'center', paddingVertical: 6 },
  tabText: { fontSize: 14, color: '#9AA0B4' },
  underline: { position: 'absolute', bottom: 6, height: 2, borderRadius: 1, backgroundColor: '#33A9DC' },
  glassTabBarPlacement: { position: 'absolute', left: 0, right: 0, zIndex: 300, paddingHorizontal: 16, backgroundColor: 'transparent' },
  glassFeedBar: { height: 42, borderRadius: 21, overflow: 'hidden', flexDirection: 'row', position: 'relative' },
  glassFeedTabBtn: { flex: 1, alignItems: 'center', justifyContent: 'center', zIndex: 1 },
  glassFeedBubbleMotion: { position: 'absolute', left: 0, top: 3, bottom: 3, paddingHorizontal: 3 },
  glassFeedBubble: { flex: 1, borderRadius: 18, overflow: 'hidden' },
  pager: { flex: 1 },
});
