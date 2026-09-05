import { useState, useCallback, useEffect, useRef } from 'react';
import { FlatList, StyleSheet, Text, View, ActivityIndicator, Modal, ScrollView } from 'react-native';
import { Pressable } from '@/components/pressable';
import { Ionicons } from '@expo/vector-icons';
import { useRouter, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { ScreenHeader } from '@/components/screen-header';
import { getNotifications, getPost, markSingleRead, markNotificationsRead, getUserProfile, getReefRetentionStatus, voteReefRetention } from '@/api/client';
import { useTheme } from '@/lib/theme';
import { useWs } from '@/contexts/ws';
import { useAuth } from '@/contexts/auth';
import { formatFullDateTime, formatRelativeTime } from '@/lib/time';
import { RefrigerantIcon } from '@/components/refrigerant-icon';
import { FrostShellIcon } from '@/components/frost-shell-icon';
import { AwardIcon } from '@/components/award-icon';
import { filterUserVisibleNotifications, isAchievementNotification } from '@/lib/notification-policy';
import { AppRefreshControl } from '@/components/app-refresh-control';

// 不同类型通知的图标和颜色
const TYPE_CONFIG: Record<string, { icon: string; color: string }> = {
  welcome:    { icon: 'sparkles-outline',    color: '#F7B731' },
  post_deleted: { icon: 'trash-outline',     color: '#E17055' },
  comment_deleted: { icon: 'chatbubble-ellipses-outline', color: '#E17055' },
  muted:      { icon: 'alert-circle-outline', color: '#E17055' },
  banned:     { icon: 'ban-outline',          color: '#E24B4A' },
  unmuted:    { icon: 'checkmark-circle-outline', color: '#00B894' },
  unbanned:   { icon: 'checkmark-circle-outline', color: '#00B894' },
  appeal_result: { icon: 'shield-checkmark-outline', color: '#33A9DC' },
  entropy_reward: { icon: 'analytics-outline', color: '#33A9DC' },
  entropy_penalty: { icon: 'analytics-outline', color: '#E17055' },
  achievement: { icon: 'notifications-outline', color: '#33A9DC' },
  reef_retention_vote: { icon: 'layers-outline', color: '#33A9DC' },
  reef_mention: { icon: 'at-outline', color: '#33A9DC' },
  feedback_reviewed: { icon: 'eye-outline', color: '#33A9DC' },
  feedback_reply: { icon: 'chatbox-ellipses-outline', color: '#33A9DC' },
  like:       { icon: 'snow-outline',         color: '#33A9DC' },
  comment:    { icon: 'chatbubble-outline',   color: '#6C5CE7' },
  follow:     { icon: 'person-add-outline',   color: '#E84393' },
  refrigerant: { icon: 'snow-outline',        color: '#33A9DC' },
  frost_shell: { icon: 'cube-outline',        color: '#33A9DC' },
  system:     { icon: 'megaphone-outline',    color: '#F7B731' },
};

async function enrichCommentNotifications(items: any[]) {
  const missing = items.filter(item =>
    item.type === 'comment' &&
    item.relatedId &&
    !/^(\S+)\s评论了你的切片[：:]\s*[\s\S]+$/.test(item.content || ''),
  );
  if (!missing.length) return items;

  const postIds = [...new Set(missing.map(item => item.relatedId as string))];
  const postEntries = await Promise.all(postIds.map(async postId => {
    try {
      return [postId, await getPost(postId)] as const;
    } catch {
      return [postId, null] as const;
    }
  }));
  const postsById = new Map(postEntries);

  return items.map(item => {
    if (!missing.includes(item)) return item;
    const nick = (item.content || '').match(/^(\S+)\s评论了你的切片/)?.[1];
    const comments = postsById.get(item.relatedId)?.comments || [];
    const candidates = comments.filter((comment: any) =>
      (comment.nickname || comment.username) === nick && comment.content,
    );
    if (!candidates.length) return item;

    const notificationTime = new Date((item.createdAt || '').replace(' ', 'T') + '+08:00').getTime();
    const matched = [...candidates].sort((a: any, b: any) => {
      const aTime = new Date((a.createdAt || '').replace(' ', 'T') + '+08:00').getTime();
      const bTime = new Date((b.createdAt || '').replace(' ', 'T') + '+08:00').getTime();
      return Math.abs(aTime - notificationTime) - Math.abs(bTime - notificationTime);
    })[0];

    return { ...item, content: `${item.content}：${matched.content}` };
  });
}

function NotifRow({ item, colors, onRead }: { item: any; colors: any; onRead: (id: string) => void }) {
  const router = useRouter();
  const cfg = TYPE_CONFIG[item.type] || { icon: 'notifications-outline', color: '#9AA0B4' };
  const read = item.isRead;
  const achievement = isAchievementNotification(item);
  const [showFull, setShowFull] = useState(false);
  const [reefVoteStatus, setReefVoteStatus] = useState<any>(null);
  const [reefVoteLoading, setReefVoteLoading] = useState(false);
  const [reefVoteError, setReefVoteError] = useState('');
  const appealable = ['post_deleted', 'comment_deleted', 'muted', 'banned'].includes(item.type);
  const welcomeContent = item.type === 'welcome'
    ? (item.content || '').split(/\r?\n/).map((paragraph: string) => paragraph ? `\u3000\u3000${paragraph}` : '').join('\n')
    : item.content || '';

  useEffect(() => {
    if (!showFull || item.type !== 'reef_retention_vote' || !item.relatedId) return;
    setReefVoteLoading(true);
    setReefVoteError('');
    getReefRetentionStatus(item.relatedId)
      .then(setReefVoteStatus)
      .catch((error: any) => setReefVoteError(error?.message || '无法读取投票状态'))
      .finally(() => setReefVoteLoading(false));
  }, [item.relatedId, item.type, showFull]);

  const submitReefVote = async (vote: 'yes' | 'no') => {
    if (!item.relatedId || reefVoteLoading || reefVoteStatus?.myVote) return;
    setReefVoteLoading(true);
    setReefVoteError('');
    try {
      const result = await voteReefRetention(item.relatedId, vote);
      setReefVoteStatus((current: any) => ({ ...current, ...result }));
      setShowFull(false);
    } catch (error: any) {
      setReefVoteError(error?.message || '提交失败，请稍后重试');
    } finally {
      setReefVoteLoading(false);
    }
  };

  const openUser = async (nick: string, userId?: string) => {
    if (userId) {
      router.push({ pathname: '/user/[name]', params: { name: nick, userId } });
      return;
    }
    try {
      const profile = await getUserProfile(nick);
      if (profile?.id) {
        router.push({ pathname: '/user/[name]', params: { name: nick, userId: profile.id } });
      }
    } catch { /* ignore */ }
  };

  // 解析内容，将昵称提取为可点击链接
  const renderContent = () => {
    const text = item.content || '';
    if (item.type === 'feedback_reply') {
      const [before, after = '进行查看。'] = text.split('【历史反馈】');
      return (
        <Text style={[styles.content, { color: colors.textMuted }]} numberOfLines={3}>
          {before}<Text style={styles.actor} onPress={() => router.push('/feedback-history' as any)}>【历史反馈】</Text>{after}
        </Text>
      );
    }
    if (item.type === 'follow') {
      const nick = item.actorName || text.match(/^(\S+)\s关注了你/)?.[1] || '用户';
      const actorId = item.actorId || item.relatedId;
      return (
        <Text style={[styles.content, { color: colors.textMuted }]} numberOfLines={3}>
          <Text style={styles.actor} onPress={(event) => { event.stopPropagation(); openUser(nick, actorId); }}>{nick}</Text>
          {' 关注了你'}
        </Text>
      );
    }
    if (item.type === 'like' || item.type === 'refrigerant') {
      const marker = item.type === 'refrigerant' ? '对你的切片' : '给你的切片';
      const markerIndex = text.indexOf(marker);
      const legacy = text.match(/^(\S+)\s+(.+)$/);
      const nick = item.actorName || (markerIndex > 0 ? text.slice(0, markerIndex) : legacy?.[1] || text.match(/^(\S+)/)?.[1] || '用户');
      const suffix = markerIndex > 0 ? text.slice(nick.length) : legacy?.[2] || text.slice(nick.length);
      return (
        <Text style={[styles.content, { color: colors.textMuted }]} numberOfLines={3}>
          <Text style={styles.actor} onPress={(event) => { event.stopPropagation(); openUser(nick); }}>{nick}</Text>
          {' '}{suffix}
        </Text>
      );
    }
    const commentMatch = text.match(/^(\S+)\s评论了你的切片(?:[：:]\s*([\s\S]+))?$/);
    if (item.type === 'comment' && commentMatch) {
      const [, nick, commentText] = commentMatch;
      return (
        <View>
          <Text style={[styles.content, { color: colors.textMuted }]}>
            <Text style={styles.actor} onPress={(event) => { event.stopPropagation(); openUser(nick); }}>{nick}</Text>
            {' 评论了你的切片'}
          </Text>
          {!!commentText?.trim() && (
            <View style={[styles.commentQuote, { backgroundColor: cfg.color + '0D', borderLeftColor: cfg.color }]}>
              <Text style={[styles.commentText, { color: colors.text }]} numberOfLines={4}>
                {commentText.trim()}
              </Text>
            </View>
          )}
        </View>
      );
    }

    // 匹配 "xxx 降温了/评论了/关注了..." 格式
    const match = text.match(/^(\S+)\s(降温了|评论了|关注了|回复了)(.*)/);
    if (match) {
      const nick = match[1];
      return (
        <Text style={[styles.content, { color: colors.textMuted }]} numberOfLines={3}>
          <Text style={styles.actor} onPress={(event) => { event.stopPropagation(); openUser(nick); }}>{nick}</Text>
          {' '}{match[2]}{match[3]}
        </Text>
      );
    }
    return <Text style={[styles.content, { color: colors.textMuted }]} numberOfLines={3}>{text}</Text>;
  };

  const handlePress = () => {
    onRead(item.id);
    markSingleRead(item.id).catch(() => {});
    if (item.type === 'reef_mention' && item.metadata?.roomId) {
      router.push({ pathname: '/reef/[id]', params: { id: item.metadata.roomId, messageId: item.metadata.messageId || '' } });
      return;
    }
    if ((item.type === 'comment' || item.type === 'like' || item.type === 'refrigerant') && item.relatedId) {
      router.push({ pathname: '/post/[id]', params: { id: String(item.relatedId) } });
      return;
    }
    if (item.type === 'welcome' || item.type === 'system' || item.type === 'achievement' || appealable || item.type === 'appeal_result' || item.type === 'entropy_reward' || item.type === 'entropy_penalty' || item.type === 'reef_retention_vote' || item.type === 'feedback_reviewed' || item.type === 'feedback_reply') {
      setShowFull(true);
    }
  };

  const opensFullText = item.type === 'welcome' || item.type === 'system' || item.type === 'achievement' || appealable || item.type === 'appeal_result' || item.type === 'entropy_reward' || item.type === 'entropy_penalty' || item.type === 'reef_retention_vote' || item.type === 'feedback_reviewed' || item.type === 'feedback_reply';
  const opensReefMention = item.type === 'reef_mention' && !!item.metadata?.roomId;
  const opensPost = (item.type === 'comment' || item.type === 'like' || item.type === 'refrigerant') && !!item.relatedId;

  return (
    <>
    <Pressable
      style={[styles.card, { backgroundColor: colors.card, opacity: read ? 0.6 : 1 }]}
      onPress={opensFullText || opensPost || opensReefMention ? handlePress : undefined}
      disabled={!opensFullText && !opensPost && !opensReefMention}
      accessibilityState={{ disabled: !opensFullText && !opensPost && !opensReefMention }}
    >
      <View style={[
        styles.iconBox,
        achievement
          ? styles.achievementIconBox
          : { backgroundColor: cfg.color + '18' },
      ]}>
        {item.type === 'refrigerant'
          ? <RefrigerantIcon size={23} color={cfg.color} />
          : item.type === 'frost_shell'
            ? <FrostShellIcon size={23} color={cfg.color} />
            : achievement
              ? <AwardIcon size={20} color={colors.accent} />
              : <Ionicons name={cfg.icon as any} size={20} color={cfg.color} />}
      </View>
      <View style={{ flex: 1, marginLeft: 12 }}>
        <View style={styles.titleRow}>
          <Text
            style={[
              styles.title,
              item.type === 'welcome' && styles.welcomeTitle,
              { color: item.type === 'welcome' ? colors.accent : colors.text },
            ]}
          >
            {item.title}
          </Text>
          <Text style={[styles.time, { color: colors.textMuted }]}>
            {formatRelativeTime(item.createdAt, { absoluteAfterDays: 30 })}
          </Text>
        </View>
        {renderContent()}
      </View>
      {!read && <View style={[styles.dot, { backgroundColor: colors.accent }]} />}
    </Pressable>
    <Modal visible={showFull} transparent animationType="fade" onRequestClose={() => setShowFull(false)}>
      <Pressable style={styles.modalBg} onPress={() => setShowFull(false)}>
        <Pressable style={[styles.modalCard, { backgroundColor: colors.card, borderColor: colors.cardBorder }]} onPress={e => e.stopPropagation()}>
          <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 16 }}>
            <Text
              style={[
                { flex: 1, fontSize: 18, fontWeight: '600', color: item.type === 'welcome' ? colors.accent : colors.text },
                item.type === 'welcome' && styles.welcomeTitle,
              ]}
            >
              {item.title}
            </Text>
            <Pressable onPress={() => setShowFull(false)}>
              <Ionicons name="close" size={22} color={colors.textMuted} />
            </Pressable>
          </View>
          <ScrollView
            style={{ width: '100%', maxHeight: 520 }}
            contentContainerStyle={{ paddingBottom: 2 }}
            showsVerticalScrollIndicator={false}
          >
            {item.type === 'feedback_reply' ? (
              <Text style={{ fontSize: 15, lineHeight: 26, color: colors.text }}>
                {item.content.split('【历史反馈】')[0]}
                <Text style={{ color: colors.accent, fontWeight: '700' }} onPress={() => { setShowFull(false); router.push('/feedback-history' as any); }}>【历史反馈】</Text>
                {item.content.split('【历史反馈】')[1] || '进行查看。'}
              </Text>
            ) : <Text style={{ fontSize: 15, lineHeight: 26, color: colors.text }}>{welcomeContent}</Text>}
          </ScrollView>
          {item.type === 'system' && (
            <View style={styles.officialMeta}>
              <Text style={[styles.officialName, { color: colors.textSecondary }]}>肆度官方</Text>
              <Text style={[styles.officialDate, { color: colors.textMuted }]}>
                {formatFullDateTime(item.createdAt).split(' ')[0]}
              </Text>
            </View>
          )}
          {item.type === 'reef_retention_vote' && (
            <View style={styles.reefVoteBlock}>
              {!reefVoteLoading && reefVoteStatus?.myVote ? (
                <Text style={[styles.reefVoteSelection, { color: colors.accent, backgroundColor: colors.accent + '12' }]}>你已选择了{reefVoteStatus.myVote === 'yes' ? '是' : '否'}</Text>
              ) : (
                <View style={styles.reefVoteActions}>
                  <Pressable
                    style={[
                      styles.reefVoteButton,
                      { borderColor: colors.divider, backgroundColor: 'transparent' },
                    ]}
                    disabled={reefVoteLoading || reefVoteStatus?.canVote === false}
                    onPress={() => submitReefVote('no')}
                  >
                    <Text style={{ color: colors.textSecondary, fontWeight: '700' }}>否</Text>
                  </Pressable>
                  <Pressable
                    style={[
                      styles.reefVoteButton,
                      { borderColor: colors.accent, backgroundColor: colors.accent },
                    ]}
                    disabled={reefVoteLoading || reefVoteStatus?.canVote === false}
                    onPress={() => submitReefVote('yes')}
                  >
                    <Text style={{ color: '#FFFFFF', fontWeight: '700' }}>是</Text>
                  </Pressable>
                </View>
              )}
              {reefVoteLoading && <ActivityIndicator size="small" color={colors.accent} style={{ marginTop: 10 }} />}
              {!!reefVoteError && <Text style={[styles.reefVoteHint, { color: colors.danger }]}>{reefVoteError}</Text>}
              {!reefVoteLoading && !reefVoteError && reefVoteStatus?.extended && (
                <Text style={[styles.reefVoteHint, { color: colors.accent }]}>已获得足够成员同意，礁石存续期已重置为 30 天。</Text>
              )}
              {!reefVoteLoading && !reefVoteError && !reefVoteStatus?.myVote && reefVoteStatus?.canVote === false && !reefVoteStatus?.extended && (
                <Text style={[styles.reefVoteHint, { color: colors.textMuted }]}>该礁石当前无法继续投票。</Text>
              )}
            </View>
          )}
          {appealable && (
            <View style={{ marginTop: 18 }}>
              {item.appeal ? (
                <View style={[styles.appealStatus, { backgroundColor: colors.accentBg }]}>
                  <Ionicons
                    name={item.appeal.status === 'pending' ? 'time-outline' : item.appeal.status === 'approved' ? 'checkmark-circle-outline' : 'close-circle-outline'}
                    size={18}
                    color={item.appeal.status === 'rejected' ? colors.danger : colors.accent}
                  />
                  <Text style={{ flex: 1, color: colors.text, fontSize: 13 }}>
                    {item.appeal.status === 'pending' ? '申诉审核中' : item.appeal.status === 'approved' ? '申诉已通过' : '申诉已驳回'}
                    {!!item.appeal.handle_note && `：${item.appeal.handle_note}`}
                  </Text>
                </View>
              ) : (
                <Pressable
                  style={[styles.appealButton, { borderColor: colors.accent }]}
                  onPress={() => {
                    setShowFull(false);
                    router.push({
                      pathname: '/appeal',
                      params: {
                        notificationId: item.id,
                        title: item.title,
                        content: item.content,
                      },
                    });
                  }}
                >
                  <Ionicons name="document-text-outline" size={18} color={colors.accent} />
                  <Text style={{ color: colors.accent, fontWeight: '600' }}>申诉</Text>
                </Pressable>
              )}
            </View>
          )}
        </Pressable>
      </Pressable>
    </Modal>
    </>
  );
}

export default function NotificationsScreen() {
  const { category } = useLocalSearchParams<{ category: string }>();
  const { colors } = useTheme();
  const { lastNotification } = useWs();
  const { token } = useAuth();
  const loadGenerationRef = useRef(0);
  const [notifs, setNotifs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const visibleSystemUnreadIds = useRef(new Set<string>());
  const viewabilityConfig = useRef({ itemVisiblePercentThreshold: 50, minimumViewTime: 250 }).current;
  const onViewableItemsChanged = useRef(({ viewableItems }: any) => {
    viewableItems.forEach(({ item, isViewable }: any) => {
      if (isViewable && item?.id && !item.isRead && !visibleSystemUnreadIds.current.has(item.id)) {
        visibleSystemUnreadIds.current.add(item.id);
        // 保留本页的小蓝点直到退出，但提前把服务端状态写好，避免返回消息页时红点短暂回闪。
        void markSingleRead(item.id).catch(() => {});
      }
    });
  }).current;
  const flushVisibleSystemReads = useCallback(() => {
    if ((category || 'interaction') !== 'system') return;
    const ids = [...visibleSystemUnreadIds.current];
    visibleSystemUnreadIds.current.clear();
    if (ids.length) void Promise.allSettled(ids.map(id => markSingleRead(id)));
  }, [category]);

  useFocusEffect(useCallback(() => () => {
    flushVisibleSystemReads();
  }, [flushVisibleSystemReads]));
  const title = category === 'system' ? '系统通知' : '互动通知';
  const acknowledgeVisibleInteraction = useCallback(async (items: any[]) => {
    if ((category || 'interaction') !== 'interaction') return;
    const unreadIds = items.filter(item => !item.isRead).map(item => item.id);
    if (!unreadIds.length) return;
    await Promise.allSettled(unreadIds.map(id => markSingleRead(id)));
  }, [category]);

  useFocusEffect(useCallback(() => {
    const generation = ++loadGenerationRef.current;
    setLoading(true);
    if (!token) {
      setNotifs([]);
      setLoading(false);
      return () => { loadGenerationRef.current += 1; };
    }
    void (async () => {
      try {
        const data = await getNotifications(category || 'interaction');
        if (generation !== loadGenerationRef.current) return;
        const items = filterUserVisibleNotifications(data || []);
        const enriched = await enrichCommentNotifications(items);
        if (generation !== loadGenerationRef.current) return;
        await acknowledgeVisibleInteraction(items);
        if (generation !== loadGenerationRef.current) return;
        setNotifs(enriched);
      } catch {
        if (generation === loadGenerationRef.current) setNotifs([]);
      } finally {
        if (generation === loadGenerationRef.current) setLoading(false);
      }
    })();
    return () => { loadGenerationRef.current += 1; };
  }, [acknowledgeVisibleInteraction, category, token]));

  useEffect(() => {
    if (!token || !lastNotification || lastNotification.category !== (category || 'interaction')) return;
    const generation = ++loadGenerationRef.current;
    void (async () => {
      try {
        const data = await getNotifications(category || 'interaction');
        if (generation !== loadGenerationRef.current) return;
        const items = filterUserVisibleNotifications(data || []);
        const enriched = await enrichCommentNotifications(items);
        if (generation !== loadGenerationRef.current) return;
        await acknowledgeVisibleInteraction(items);
        if (generation === loadGenerationRef.current) setNotifs(enriched);
      } catch {}
    })();
  }, [acknowledgeVisibleInteraction, category, lastNotification, token]);

  const onRefresh = useCallback(async () => {
    const generation = ++loadGenerationRef.current;
    setRefreshing(true);
    try {
      if (!token) {
        setNotifs([]);
        return;
      }
      const data = filterUserVisibleNotifications(await getNotifications(category || 'interaction') || []);
      if (generation !== loadGenerationRef.current) return;
      const enriched = await enrichCommentNotifications(data);
      if (generation !== loadGenerationRef.current) return;
      await acknowledgeVisibleInteraction(data);
      if (generation === loadGenerationRef.current) setNotifs(enriched);
    } catch {}
    finally {
      if (generation === loadGenerationRef.current) setRefreshing(false);
    }
  }, [acknowledgeVisibleInteraction, category, token]);

  const markAllRead = useCallback(async () => {
    try { await markNotificationsRead((category || 'interaction') as 'system' | 'interaction'); } catch {}
    setNotifs(prev => prev.map(n => ({ ...n, isRead: true })));
  }, [category]);

  const markOneRead = useCallback((id: string) => {
    setNotifs(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n));
  }, []);

  const unreadCount = notifs.filter(n => !n.isRead).length;

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScreenHeader title={title} floating floatingSpacer={58} right={
        unreadCount > 0 ? (
          <Pressable onPress={markAllRead}>
            <Ionicons name="checkmark-done" size={22} color={colors.accent} />
          </Pressable>
        ) : undefined
      } />
      {loading ? (
        <ActivityIndicator size="large" color={colors.accent} style={{ marginTop: 60 }} />
      ) : (
        <FlatList
          data={notifs}
          extraData={notifs}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => <NotifRow item={item} colors={colors} onRead={markOneRead} />}
          contentContainerStyle={{ paddingHorizontal: 12, paddingTop: 4, flexGrow: 1, paddingBottom: 30 }}
          showsVerticalScrollIndicator={false}
          refreshControl={<AppRefreshControl refreshing={refreshing} onRefresh={onRefresh} progressViewOffset={12} colors={[colors.accent]} tintColor={colors.accent} progressBackgroundColor={colors.card} />}
          viewabilityConfig={viewabilityConfig}
          onViewableItemsChanged={category === 'system' ? onViewableItemsChanged : undefined}
          ListEmptyComponent={
            <View style={{ alignItems: 'center', paddingTop: 80 }}>
              <Ionicons name="notifications-off-outline" size={40} color={colors.textMuted} />
              <Text style={{ color: colors.textMuted, fontSize: 14, marginTop: 12 }}>暂无通知</Text>
            </View>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', alignItems: 'flex-start', borderRadius: 16, padding: 15, marginBottom: 8 },
  iconBox: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  achievementIconBox: { backgroundColor: 'transparent' },
  titleRow: { flexDirection: 'row', alignItems: 'center' },
  title: { flex: 1, fontSize: 14, fontWeight: '600' },
  welcomeTitle: { fontStyle: 'italic' },
  content: { fontSize: 13, marginTop: 4, lineHeight: 19 },
  actor: { color: '#33A9DC', fontWeight: '600' },
  time: { fontSize: 10, marginLeft: 8 },
  commentQuote: { borderLeftWidth: 3, borderRadius: 8, marginTop: 8, paddingHorizontal: 11, paddingVertical: 9 },
  commentText: { fontSize: 13, lineHeight: 19 },
  dot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
  modalBg: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', alignItems: 'center' },
  modalCard: { width: '92%', maxHeight: '88%', borderWidth: 1, borderRadius: 16, padding: 22 },
  officialMeta: { alignSelf: 'flex-end', alignItems: 'flex-end', marginTop: 18 },
  officialName: { fontSize: 13, fontWeight: '700' },
  officialDate: { fontSize: 11, marginTop: 3 },
  appealButton: { height: 44, borderWidth: 1, borderRadius: 12, flexDirection: 'row', gap: 7, alignItems: 'center', justifyContent: 'center' },
  appealStatus: { minHeight: 44, borderRadius: 12, paddingHorizontal: 12, paddingVertical: 10, flexDirection: 'row', gap: 8, alignItems: 'center' },
  reefVoteBlock: { marginTop: 18 },
  reefVoteActions: { flexDirection: 'row', gap: 10 },
  reefVoteButton: { flex: 1, height: 44, borderWidth: 1, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  reefVoteSelection: { minHeight: 44, borderRadius: 12, textAlign: 'center', textAlignVertical: 'center', paddingHorizontal: 14, paddingVertical: 12, fontSize: 14, fontWeight: '700', overflow: 'hidden' },
  reefVoteHint: { fontSize: 12, lineHeight: 18, textAlign: 'center', marginTop: 10 },
});
