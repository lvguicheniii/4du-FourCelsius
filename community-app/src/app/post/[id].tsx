import { useCallback, useMemo, useState, useRef, useEffect } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  Keyboard,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Alert } from '@/components/app-alert';
import { AppRefreshControl } from '@/components/app-refresh-control';
import { Ionicons } from '@expo/vector-icons';
import { Image as ExpoImage } from 'expo-image';
import * as Clipboard from 'expo-clipboard';
import * as Haptics from 'expo-haptics';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { getPost as apiGetPost, createComment as apiCreateComment, coolPost as apiCoolPost, likeComment as apiLikeComment, giftFrostShell, getMyStickers, moveStickerToFront, deleteStickerByUrl, deleteComment, reportComment, setUserBlocked, applyRefrigerantToPost, addStickerUrl, uploadFile } from '@/api/client';
import { isBlocked, isReported, setBlocked, isPostPrivate, getPostStats, setPostStats, myStickers } from '@/data/store';
import { useAuth } from '@/contexts/auth';
import { ScreenHeader } from '@/components/screen-header';
import { TemperatureBar } from '@/components/temperature-bar';
import { useCommunityConfig } from '@/contexts/community-config';

const AV_COLORS = ['#33A9DC','#1D9E75','#D85A30','#8854D0','#E17A2F','#0C8CE9','#E24B4A','#16A34A','#9333EA','#0891B2','#D97706','#DC2626'];
function avColor(name: string) { let h = 0; for (let i=0;i<name.length;i++) h=((h<<5)-h)+name.charCodeAt(i); return AV_COLORS[Math.abs(h)%AV_COLORS.length]; }
import { useStoreVersion } from '@/hooks/use-store';
import { PostActionsSheet, SliceBoxPickerModal } from '@/components/post-actions';
import { VideoViewer } from '@/components/video-viewer';
import { LivePhotoThumbnail, LivePhotoViewer, type LivePhotoItem, type MediaViewerItem } from '@/components/live-photo';
import { KeyboardSticky } from '@/components/keyboard-sticky';
import { useTheme } from '@/lib/theme';
import type { ThemeColors } from '@/lib/theme';
import { formatCommentTime, formatExactTime } from '@/lib/time';
import { useWs } from '@/contexts/ws';
import { PostContentText } from '@/components/post-content-text';
import { cachedImageSource, primeUploadedImageCache } from '@/lib/media-cache';
import { ReefShareCard } from '@/components/reef-share-card';
import { RefrigerantIcon } from '@/components/refrigerant-icon';
import { FrostShellIcon } from '@/components/frost-shell-icon';
import { ConfirmModal } from '@/components/confirm-modal';
import { StickerActionsModal } from '@/components/sticker-actions-modal';
import { queueRecommendationEvent } from '@/lib/recommendation-events';
import { isNativeLiquidGlassEnabled, NativeLiquidGlassView } from '@/components/liquid-glass';
import { launchImageLibrarySafely } from '@/lib/image-picker';

const EMOJIS = ['😀','😂','🥰','😍','🤩','😎','🥺','😭','🤔','👍','👎','🔥','💯','❤️','🎉','✨','💪','🙏','👀','💀','🤡','🐶','🌹','☕','🍺'];
const DETAIL_CARD_MARGIN = 12;
const DETAIL_CARD_PADDING = 14;
const DETAIL_MEDIA_PADDING = 8;
const DETAIL_MEDIA_GAP = 4;
const DETAIL_MEDIA_COLUMNS = 3;

function DetailVideo({ poster, onPress }: { poster?: string | null; onPress: () => void }) {
  return <Pressable onPress={onPress} style={{ width: '100%', height: 260, borderRadius: 8, overflow: 'hidden', backgroundColor: '#000000' }}>
    {poster ? <Image source={{ uri: poster }} style={StyleSheet.absoluteFill} resizeMode="contain" /> : null}
    <View pointerEvents="none" style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="play-circle" size={48} color="#FFFFFF" /></View>
  </Pressable>;
}

function DetailSingleImage({ uri, width, maxHeight, onPress }: { uri: string; width: number; maxHeight: number; onPress: () => void }) {
  const [aspectRatio, setAspectRatio] = useState(4 / 3);
  const imageHeight = Math.min(maxHeight, width / aspectRatio);
  const imageWidth = imageHeight * aspectRatio;
  return (
    <View style={[s.singleImageFrame, { width, height: imageHeight, borderRadius: 8 }]}>
      <Pressable onPress={onPress} style={{ borderRadius: 8, overflow: 'hidden' }}>
        <Image
          source={{ uri }}
          style={{ width: imageWidth, height: imageHeight, borderRadius: 8 }}
          resizeMode="contain"
          onLoad={({ nativeEvent }) => {
            const source = nativeEvent.source;
            if (source?.width > 0 && source?.height > 0) setAspectRatio(source.width / source.height);
          }}
        />
      </Pressable>
    </View>
  );
}

const themed = (c: ThemeColors) => ({
  page: { flex: 1, backgroundColor: c.bg },
  author: { fontSize: 15, fontWeight: '600' as const, color: c.text },
  meta: { fontSize: 11, color: c.textMuted, marginTop: 2 },
  content: { fontSize: 15, lineHeight: 24, color: c.text },
    commentTitle: { fontSize: 15, fontWeight: '600' as const, color: c.text, paddingHorizontal: 16, paddingTop: 14, paddingBottom: 8, borderTopWidth: 1, borderTopColor: c.divider },
    postCard: { backgroundColor: c.card, borderRadius: 14, marginHorizontal: 12, marginBottom: 10, padding: 14, position: 'relative' as const },
    commentCard: { backgroundColor: c.card, borderRadius: 12, marginHorizontal: 12, marginBottom: 6, padding: 14 },
    statsRow: { flexDirection: 'row' as const, justifyContent: 'space-between' as const, alignItems: 'center' as const, paddingVertical: 8 },
  statItem: { flexDirection: 'row' as const, alignItems: 'center' as const },
  statText: { fontSize: 13, color: c.textMuted, marginLeft: 4 },
  commentRow: { flexDirection: 'row' as const, paddingHorizontal: 16, paddingVertical: 10, backgroundColor: c.card },
  commentAuthor: { fontSize: 13, fontWeight: '600' as const, color: c.textMuted },
  commentContent: { fontSize: 14, lineHeight: 20, color: c.text, marginTop: 2 },
  commentTime: { fontSize: 10, color: c.textMuted, marginTop: 1 },
  commentLikeText: { fontSize: 11, color: c.textMuted, marginTop: 2 },
  bottomBar: {
    flexDirection: 'row' as const,
    backgroundColor: c.card,
    paddingHorizontal: 16,
    paddingVertical: 8,
    paddingBottom: 24,
  },
  bottomBtn: { flex: 1, flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, paddingVertical: 10 },
  bottomBtnText: { fontSize: 14, fontWeight: '600' as const, marginLeft: 6 },
  mutedIcon: c.textMuted as string,
});

function CommentRow({ item, c, colors, postUserId, onReply, onDeleted }: { item: any; c: ReturnType<typeof themed>; colors: ReturnType<typeof useTheme>['colors']; postUserId?: string; onReply?: () => void; onDeleted?: (commentId: string) => void }) {
  const router = useRouter();
  const { user, token, refreshUser } = useAuth();
  const isOwnComment = user?.id && item.userId && user.id === item.userId;
  const isPostAuthor = postUserId && item.userId === postUserId;
  const [liked, setLiked] = useState(!!item.liked);
  const [likes, setLikes] = useState(Number(item.likes) || 0);
  const [frostShells, setFrostShells] = useState(Number(item.frostShells ?? item.refrigerants) || 0);
  const [giftConfirmOpen, setGiftConfirmOpen] = useState(false);
  const [gifting, setGifting] = useState(false);
  const [cmtMenu, setCmtMenu] = useState(false);
  const [reportStep, setReportStep] = useState<'menu' | 'reason' | 'done' | null>(null);
  const [reportReason, setReportReason] = useState('');
  const [reportDetail, setReportDetail] = useState('');
  const [reporting, setReporting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const likePendingRef = useRef(false);
  const REPORT_REASONS = ['垃圾广告', '色情低俗', '人身攻击', '不实信息', '违法违规', '其他'];

  // 解析 "回复 XXX：" 前缀
  const replyMatch = (item.content || '').match(/^回复 (.+?)：(.*)/s);
  const replyToName = replyMatch?.[1];
  const replyText = replyMatch ? replyMatch[2] : (item.content || '');

  const openMenu = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setCmtMenu(true);
    setReportStep('menu');
  };

  const closeMenu = () => { setCmtMenu(false); setReportStep(null); setReportReason(''); setReportDetail(''); setReporting(false); setDeleting(false); };

  const handleCopyComment = async () => {
    const text = String(replyText || '');
    if (!text.trim()) return;
    await Clipboard.setStringAsync(text);
    closeMenu();
    void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
  };

  const handleDeleteComment = async () => {
    if (!isOwnComment || deleting) return;
    setDeleting(true);
    try {
      await deleteComment(item.id);
      closeMenu();
      onDeleted?.(item.id);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      setDeleting(false);
      Alert.alert('删除失败', error instanceof Error ? error.message : '请稍后重试');
    }
  };

  const handleReportReason = async () => {
    if (!reportReason || (reportReason === '其他' && !reportDetail.trim()) || reporting) return;
    setReporting(true);
    try {
      await reportComment(item.id, reportReason, reportDetail.trim());
      setReportStep('done');
    } catch (error) {
      closeMenu();
      Alert.alert('举报未提交', error instanceof Error ? error.message : '请稍后重试');
    } finally {
      setReporting(false);
    }
  };

  const toggleCommentLike = async () => {
    if (!token) { router.push('/login'); return; }
    if (likePendingRef.current) return;
    likePendingRef.current = true;
    const previousLiked = liked;
    const previousLikes = likes;
    const nextLiked = !previousLiked;
    setLiked(nextLiked);
    setLikes(Math.max(0, previousLikes + (nextLiked ? 1 : -1)));
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    try {
      const result = await apiLikeComment(item.id, nextLiked);
      setLiked(!!result.liked);
      setLikes(Number(result.likes) || 0);
    } catch (error) {
      setLiked(previousLiked);
      setLikes(previousLikes);
      Alert.alert('点赞失败', error instanceof Error ? error.message : '请稍后重试');
    } finally {
      likePendingRef.current = false;
    }
  };

  const confirmGift = () => {
    if (!token) { router.push('/login'); return; }
    setGiftConfirmOpen(true);
  };

  const handleGift = async () => {
    if (gifting) return;
    setGifting(true);
    try {
      const result = await giftFrostShell(item.userId, 'comment', item.id);
      if (Number.isFinite(result?.commentFrostShellCount)) {
        setFrostShells(result.commentFrostShellCount);
      }
      await refreshUser();
      setGiftConfirmOpen(false);
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    } catch (error) {
      setGiftConfirmOpen(false);
      Alert.alert('赠予失败', error instanceof Error ? error.message : '请稍后重试');
    } finally {
      setGifting(false);
    }
  };

  const handleReply = () => {
    if (!token) { router.push('/login'); return; }
    onReply?.();
  };

  const openPrivateChat = () => {
    if (!token) { router.push('/login'); return; }
    router.push({
      pathname: '/chat/[name]',
      params: {
        name: item.nickname || item.username,
        peerUserId: item.userId,
        peerAvatar: item.avatar || '',
        peerGender: item.gender || '',
        peerAge: item.age == null ? '' : String(item.age),
        peerProfileReady: '1',
        sourceCommentId: item.id,
      },
    });
  };

  return (
    <Pressable onLongPress={openMenu} delayLongPress={500} onPress={handleReply}>
      <View style={[c.commentCard, cmtMenu && { opacity: 1 }, { flexDirection: 'row', alignItems: 'flex-start' }]}>
        <Pressable style={{ marginLeft: 5 }} onPress={() => { if (!isOwnComment) router.push({ pathname: '/user/[name]', params: { name: item.nickname || item.username, userId: item.userId } }); }} disabled={isOwnComment}>
          {item.avatar ? <ExpoImage source={cachedImageSource(item.avatar)} style={{ width: 32, height: 32, borderRadius: 16 }} cachePolicy="memory-disk" transition={0} /> : <View style={[s.smallAvatar, { backgroundColor: avColor(item.nickname || item.username || '') }]}><Text style={s.smallAvatarText}>{(item.nickname || item.username || '?')[0]}</Text></View>}
        </Pressable>
        <View style={{ flex: 1, marginLeft: 10 }}>
          <Text style={[c.commentAuthor, isPostAuthor && { color: '#E84393' }]}>{isPostAuthor ? '作者' : (item.nickname || item.username)}</Text>
          <Text style={c.commentTime}>
            {[formatCommentTime(item.createdAt), item.ipRegion || '未知'].filter(Boolean).join(' · ')}
          </Text>
          {item.kind === 'sticker' && item.mediaUrl ? (
            <View>
              {replyToName ? <Text style={[c.commentContent, { color: '#33A9DC' }]}>回复 {replyToName}：</Text> : null}
              <ExpoImage
                source={cachedImageSource(item.mediaUrl)}
                style={{ width: 104, height: 104, marginTop: 6 }}
                contentFit="contain"
                cachePolicy="memory-disk"
                autoplay
                transition={0}
              />
            </View>
          ) : (
            <Text style={c.commentContent}>
              {replyToName ? (
                <>
                  <Text style={{ color: '#33A9DC' }}>回复 {replyToName}：</Text>
                  {replyText}
                </>
              ) : item.content}
            </Text>
          )}
          {item.image && <Image source={{ uri: item.image }} style={{ width: 80, height: 80, borderRadius: 8, marginTop: 4, backgroundColor: '#EDEEF3' }} />}
          <View style={s.commentActions}>
            <Pressable style={s.commentActionButton} onPress={handleReply}>
              <Ionicons name="return-up-back-outline" size={14} color={colors.textMuted} />
              <Text style={[s.commentActionText, { color: colors.textMuted }]}>回复</Text>
            </Pressable>
            {!isOwnComment && (
              <Pressable style={s.commentActionButton} onPress={openPrivateChat}>
                <Ionicons name="paper-plane-outline" size={14} color={colors.textMuted} />
                <Text style={[s.commentActionText, { color: colors.textMuted }]}>私信</Text>
              </Pressable>
            )}
          </View>
        </View>
        <View style={s.commentSideColumn}>
          <Pressable style={s.commentSideAction} onPress={toggleCommentLike}>
            <View style={s.commentSideIcon}><Ionicons name={liked ? 'heart' : 'heart-outline'} size={18} color={liked ? '#FF4D67' : '#C4C8D4'} /></View>
            <Text style={[s.commentSideCount, { color: liked ? '#FF4D67' : colors.textMuted }]}>{likes}</Text>
          </Pressable>
          {!isOwnComment && (
            <Pressable style={s.commentSideAction} accessibilityLabel="赠予浮霜贝" hitSlop={6} onPress={confirmGift}>
              <View style={s.commentSideIcon}><FrostShellIcon size={19} color={colors.accent} cracked /></View>
              <Text style={[s.commentSideCount, s.commentRefrigerantCount, { color: colors.textMuted }]}>{frostShells}</Text>
            </Pressable>
          )}
        </View>
      </View>

      <Modal visible={cmtMenu} transparent animationType="fade" onRequestClose={closeMenu}>
        <Pressable style={cm.overlay} onPress={closeMenu}>
          {reportStep === 'menu' ? (
            <View style={[cm.box, { backgroundColor: colors.card }]}>
              <Text style={[cm.title, { color: colors.textMuted }]}>评论操作</Text>
              <Pressable style={[cm.row, { borderBottomColor: colors.divider }]} onPress={handleCopyComment}>
                <Ionicons name="copy-outline" size={18} color={colors.accent} />
                <Text style={[cm.rowText, { color: colors.text }]}>复制评论</Text>
              </Pressable>
              {isOwnComment ? (
                <Pressable disabled={deleting} style={cm.rowLast} onPress={handleDeleteComment}>
                  {deleting ? <ActivityIndicator size="small" color="#E24B4A" /> : <Ionicons name="trash-outline" size={18} color="#E24B4A" />}
                  <Text style={[cm.rowText, { color: '#E24B4A' }]}>{deleting ? '删除中…' : '删除评论'}</Text>
                </Pressable>
              ) : (
                <>
                  <Pressable style={[cm.row, { borderBottomColor: colors.divider }]} onPress={() => setReportStep('reason')}>
                    <Ionicons name="flag-outline" size={18} color="#BA7517" />
                    <Text style={[cm.rowText, { color: colors.text }]}>举报评论</Text>
                  </Pressable>
                  <Pressable style={cm.rowLast} onPress={async () => {
                    try {
                      await setUserBlocked(item.userId, true);
                      setBlocked(item.nickname || item.username, true);
                      closeMenu();
                    } catch {}
                  }}>
                    <Ionicons name="ban-outline" size={18} color="#E24B4A" />
                    <Text style={[cm.rowText, { color: '#E24B4A' }]}>拉黑 {item.nickname || item.username}</Text>
                  </Pressable>
                </>
              )}
            </View>
          ) : reportStep === 'reason' ? (
            <View style={[cm.box, { backgroundColor: colors.card }]}>
              <Text style={[cm.title, { color: colors.textMuted }]}>选择举报理由</Text>
              <View style={cm.reportReasons}>{REPORT_REASONS.map((r) => (
                <Pressable key={r} style={[cm.reportReason, { backgroundColor: colors.input, borderColor: reportReason === r ? colors.accent : 'transparent' }]} onPress={() => setReportReason(r)}>
                  <Text style={{ color: reportReason === r ? colors.accent : colors.text }}>{r}</Text>
                </Pressable>
              ))}</View>
              <TextInput
                value={reportDetail}
                onChangeText={setReportDetail}
                multiline
                maxLength={500}
                placeholder={reportReason === '其他' ? '请填写举报理由（必填）' : '补充说明（选填）'}
                placeholderTextColor={colors.textMuted}
                style={[cm.reportInput, { color: colors.text, backgroundColor: colors.input, borderColor: colors.divider }]}
              />
              <Pressable
                style={[cm.reportSubmit, { backgroundColor: reportReason && (reportReason !== '其他' || reportDetail.trim()) ? colors.accent : colors.divider }]}
                disabled={!reportReason || (reportReason === '其他' && !reportDetail.trim()) || reporting}
                onPress={handleReportReason}
              >
                {reporting ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Text style={cm.reportSubmitText}>提交举报</Text>}
              </Pressable>
              <Pressable style={cm.reportCancel} onPress={closeMenu}><Text style={{ color: colors.textMuted }}>取消</Text></Pressable>
            </View>
          ) : reportStep === 'done' ? (
            <View style={[cm.box, { backgroundColor: colors.card }]}>
              <View style={cm.doneWrap}>
                <Ionicons name="checkmark-circle" size={48} color="#33A9DC" />
                <Text style={[cm.doneTitle, { color: colors.text }]}>举报已提交</Text>
                <Text style={[cm.doneDesc, { color: colors.textMuted }]}>我们会尽快审核处理</Text>
                <Pressable style={cm.doneBtn} onPress={closeMenu}>
                  <Text style={cm.doneBtnText}>完成</Text>
                </Pressable>
              </View>
            </View>
          ) : null}
        </Pressable>
      </Modal>
      <ConfirmModal
        visible={giftConfirmOpen}
        title="赠予浮霜贝"
        message={`确定赠予 ${item.nickname || item.username} 1 枚脆弱浮霜贝吗？`}
        confirmText="确认赠予"
        tone="accent"
        iconContent={<FrostShellIcon size={25} color={colors.accent} cracked />}
        loading={gifting}
        onCancel={() => setGiftConfirmOpen(false)}
        onConfirm={handleGift}
      />
    </Pressable>
  );
}



export default function PostDetailScreen() {
  const { boards } = useCommunityConfig();
  const { id, source } = useLocalSearchParams<{ id: string; source?: string }>();
  const router = useRouter();
  const { colors, isDark } = useTheme();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { user, token, refreshUser } = useAuth();
  const { lastNotification, lastPostStatsChange } = useWs();
  const c = useMemo(() => themed(colors), [colors]);
  const [post, setPost] = useState<any>(null);
  const detailOpenedAtRef = useRef(0);

  useEffect(() => {
    if (source !== 'recommend' || !id) return;
    detailOpenedAtRef.current = Date.now();
    queueRecommendationEvent(id, 'open');
    return () => {
      const dwellMs = Date.now() - detailOpenedAtRef.current;
      if (dwellMs >= 1000) queueRecommendationEvent(id, 'dwell', dwellMs);
    };
  }, [id, source]);
  const [loading, setLoading] = useState(true);
  const [comments, setComments] = useState<any[]>([]);
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  const [draft, setDraft] = useState('');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [viewVideo, setViewVideo] = useState(false);
  const [viewLivePhoto, setViewLivePhoto] = useState<{ items: MediaViewerItem[]; index: number } | null>(null);
  const [showInput, setShowInput] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [replyTo, setReplyTo] = useState<{ id: string; nickname: string; isOwn: boolean } | null>(null);
  const [showPanel, setShowPanel] = useState(false);
  const [panelTab, setPanelTab] = useState<'emoji' | 'sticker'>('emoji');
  const [stickers, setStickers] = useState<string[]>([]);
  const [selectedSticker, setSelectedSticker] = useState<string | null>(null);
  const [stickerActionAnchor, setStickerActionAnchor] = useState({ x: 0, y: 0 });
  const [stickerActionLoading, setStickerActionLoading] = useState(false);
  const [draftImage, setDraftImage] = useState<string | null>(null);
  const [postRefrigerantConfirm, setPostRefrigerantConfirm] = useState(false);
  const [postRefrigerantLoading, setPostRefrigerantLoading] = useState(false);
  const [sliceBoxPicker, setSliceBoxPicker] = useState(false);
  const [boostNow, setBoostNow] = useState(() => Date.now());
  useEffect(() => {
    if (!post?.refrigerantBoostExpiresAt) return;
    const timer = setInterval(() => setBoostNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, [post?.refrigerantBoostExpiresAt]);
  const boostExpiresMs = post?.refrigerantBoostExpiresAt ? Date.parse(String(post.refrigerantBoostExpiresAt).replace(' ', 'T') + (String(post.refrigerantBoostExpiresAt).includes('Z') ? '' : '+08:00')) : 0;
  const boostActive = boostExpiresMs > boostNow;
  const inputRef = useRef<TextInput>(null);
  const lastTap = useRef(0);
  const postLikePendingRef = useRef(false);
  const commentSendingRef = useRef(false);
  const stickerLongPressRef = useRef(false);
  const postRequestRef = useRef(0);
  const isOwnPost = !!user?.id && !!post?.userId && user.id === post.userId;
  const refreshPost = useCallback(async () => {
    const requestId = ++postRequestRef.current;
    const requestStartedAt = Date.now();
    setRefreshing(true);
    try {
      const data = await apiGetPost(id);
      if (requestId !== postRequestRef.current) return;
      const displayName = data.nickname || data.username || '';
      setPost((current: any) => ({
        ...data,
        author: displayName,
        time: formatExactTime(data.createdAt),
        avatarColor: current?.avatarColor || '#33A9DC',
      }));
      setComments(data.comments || []);
      setLiked(data.liked);
      setLikeCount(data.likes);
      setPostStats(data.id, { likes: data.likes ?? 0, liked: !!data.liked, comments: data.comments?.length || 0 }, { sourceStartedAt: requestStartedAt });
    } catch { /* ignore */ }
    if (requestId === postRequestRef.current) setRefreshing(false);
  }, [id]);

  useEffect(() => {
    if (!id) return;
    const requestId = ++postRequestRef.current;
    const requestStartedAt = Date.now();
    setLoading(true);
    apiGetPost(id).then(data => {
      if (requestId !== postRequestRef.current) return;
      const displayName = data.nickname || data.username || '';
      const mapped = {
        ...data,
        author: displayName,
        time: formatExactTime(data.createdAt),
        avatarColor: '#33A9DC',
      };
      const globalStats = getPostStats(data.id);
      setPost(mapped);
      setLiked(!!(globalStats?.liked) || data.liked || false);
      setLikeCount(globalStats?.likes ?? data.likes ?? 0);
      setComments(data.comments || []);
      setPostStats(data.id, { likes: data.likes ?? 0, liked: !!data.liked, comments: data.comments?.length || 0 }, { sourceStartedAt: requestStartedAt });
    }).catch(() => {}).finally(() => {
      if (requestId === postRequestRef.current) setLoading(false);
    });
  }, [id]);

  useEffect(() => {
    const event = lastPostStatsChange?.relatedId === id ? lastPostStatsChange : lastNotification;
    // 首屏请求必须独立完成 loading 结算；实时刷新不能抢占它的请求序号。
    if (!id || post?.id !== id || !event || event.relatedId !== id) return;
    const requestId = ++postRequestRef.current;
    apiGetPost(id).then(data => {
      if (requestId !== postRequestRef.current) return;
      setComments(data.comments || []);
      setLiked(!!data.liked);
      setLikeCount(data.likes ?? 0);
      setPostStats(data.id, {
        likes: data.likes ?? 0,
        liked: !!data.liked,
        comments: data.comments?.length || 0,
      });
    }).catch(() => {});
  }, [id, post?.id, lastNotification, lastPostStatsChange]);

  useEffect(() => {
    if (!token || !showPanel || panelTab !== 'sticker') return;
    getMyStickers().then((items) => {
      const next = Array.isArray(items) ? items : [];
      myStickers.splice(0, myStickers.length, ...next);
      setStickers(next);
    }).catch(() => setStickers([]));
  }, [token, showPanel, panelTab]);

  if (loading && !post) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
        <Text style={{ color: '#9AA0B4' }}>加载中...</Text>
      </View>
    );
  }

  if (!post && !loading) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg }}>
        <Text style={{ color: '#9AA0B4' }}>切片不存在</Text>
      </View>
    );
  }

  const boardIds: string[] = (() => { try { const p = JSON.parse(post?.boardId || '["daily"]'); return Array.isArray(p) ? p : [post?.boardId || 'daily']; } catch { return [post?.boardId || 'daily']; } })();
  const postImages = (post?.images) ?? (post?.image ? [post.image] : []);
  const postLivePhotos: LivePhotoItem[] = post?.livePhotos || [];
  const totalPhotoCount = postImages.length + postLivePhotos.length;
  const viewerMedia: MediaViewerItem[] = [
    ...postImages.map((stillUrl: string) => ({ stillUrl })),
    ...postLivePhotos,
  ];
  const detailMediaWidth = Math.max(0, windowWidth - (DETAIL_CARD_MARGIN + DETAIL_CARD_PADDING + DETAIL_MEDIA_PADDING) * 2);
  const livePhotoSize = (detailMediaWidth - DETAIL_MEDIA_GAP * (DETAIL_MEDIA_COLUMNS - 1)) / DETAIL_MEDIA_COLUMNS;
  const singleLivePhotoWidth = detailMediaWidth;

  const sendComment = async (stickerUrl?: string) => {
    if (commentSendingRef.current) return;
    const text = draft.trim();
    if (!text && !stickerUrl) return;
    commentSendingRef.current = true;
    const displayName = user?.nickname || user?.username || '用户';
    const content = replyTo ? `回复 ${replyTo.nickname}：${text || '[表情包]'}` : (text || '[表情包]');
    const tempId = 'temp-' + Date.now();
    // 先乐观插入评论
    setComments(prev => [{ id: tempId, content, kind: stickerUrl ? 'sticker' : 'text', mediaUrl: stickerUrl || '', nickname: displayName, username: user?.username, avatar: user?.avatar, createdAt: new Date().toISOString() }, ...prev]);
    const newCount = comments.length + 1;
    setPostStats(post.id, { comments: newCount });
    setDraft('');
    setDraftImage(null);
    setShowPanel(false);
    setShowInput(false);
    setReplyTo(null);
    Keyboard.dismiss();
    try {
      const cmt = await apiCreateComment(post.id, content, stickerUrl ? { kind: 'sticker', mediaUrl: stickerUrl } : undefined);
      // 用服务器返回的实际数据替换临时评论
      setComments(prev => prev.map(c => c.id === tempId ? { ...cmt, nickname: displayName, username: user?.username, avatar: user?.avatar } : c));
    } catch {
      // 失败则移除临时评论
      setComments(prev => prev.filter(c => c.id !== tempId));
      setPostStats(post.id, { comments: comments.length });
    } finally {
      commentSendingRef.current = false;
    }
  };

  const openStickerActions = (uri: string, x: number, y: number) => {
    stickerLongPressRef.current = true;
    setTimeout(() => { stickerLongPressRef.current = false; }, 800);
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setStickerActionAnchor({ x, y });
    setSelectedSticker(uri);
  };

  const sendStickerFromPanel = (uri: string) => {
    if (stickerLongPressRef.current) {
      stickerLongPressRef.current = false;
      return;
    }
    void sendComment(uri);
  };

  const addSticker = async () => {
    try {
      const result = await launchImageLibrarySafely({ mediaTypes: ['images'], allowsEditing: false, quality: 1 });
      if (!result.canceled && result.assets?.[0]) {
        const asset = result.assets[0];
        const uploaded = await uploadFile(asset.uri, 's', undefined, { mimeType: asset.mimeType });
        await addStickerUrl(uploaded.url);
        await primeUploadedImageCache(asset.uri, uploaded.url);
        const next = myStickers.includes(uploaded.url) ? [...myStickers] : [...myStickers, uploaded.url];
        myStickers.splice(0, myStickers.length, ...next);
        setStickers(next);
      }
    } catch (error: any) {
      Alert.alert('添加失败', error?.message || '请重试');
    }
  };

  const handleMoveStickerToFront = async () => {
    if (!selectedSticker || stickerActionLoading) return;
    setStickerActionLoading(true);
    try {
      await moveStickerToFront(selectedSticker);
      const next = [selectedSticker, ...stickers.filter((uri) => uri !== selectedSticker)];
      myStickers.splice(0, myStickers.length, ...next);
      setStickers(next);
      setSelectedSticker(null);
    } catch (error) {
      Alert.alert('操作失败', error instanceof Error ? error.message : '请稍后重试');
    } finally {
      setStickerActionLoading(false);
    }
  };

  const handleDeleteSticker = async () => {
    if (!selectedSticker || stickerActionLoading) return;
    setStickerActionLoading(true);
    try {
      await deleteStickerByUrl(selectedSticker);
      const next = stickers.filter((uri) => uri !== selectedSticker);
      myStickers.splice(0, myStickers.length, ...next);
      setStickers(next);
      setSelectedSticker(null);
    } catch (error) {
      Alert.alert('删除失败', error instanceof Error ? error.message : '请稍后重试');
    } finally {
      setStickerActionLoading(false);
    }
  };

  const handleLike = async () => {
    if (!token) { router.push('/login'); return; }
    if (postLikePendingRef.current) return;
    postLikePendingRef.current = true;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const newLiked = !liked; const newCount = liked ? Math.max(0, likeCount-1) : likeCount+1;
    setLiked(newLiked); setLikeCount(newCount);
    setPostStats(post.id, { likes: newCount, liked: newLiked, comments: comments.length });
    try {
      const result = await apiCoolPost(post.id, newLiked);
      const serverLikes = result.likes ?? newCount;
      setLiked(result.liked ?? newLiked); setLikeCount(serverLikes);
      setPostStats(post.id, { likes: serverLikes, liked: result.liked ?? newLiked, comments: comments.length });
    } catch {
      setLiked(liked); setLikeCount(likeCount);
      setPostStats(post.id, { likes: likeCount, liked: liked, comments: comments.length });
    } finally {
      postLikePendingRef.current = false;
    }
  };

  const handleDoubleTap = () => {
    const now = Date.now();
    if (now - lastTap.current < 300) {
      if (!liked) handleLike();
      lastTap.current = 0;
    } else {
      lastTap.current = now;
    }
  };

  const dismissInput = () => { if (showInput) { setShowInput(false); setShowPanel(false); Keyboard.dismiss(); } };

  return (
    <View style={c.page} onStartShouldSetResponder={() => { dismissInput(); return false; }}>
      <Stack.Screen options={{
        headerShown: false,
      }} />
      {/* 自定义表头，消除返回时滑动闪烁 */}
      <ScreenHeader title="切片详情" floating />
      <FlatList
        data={comments}
        onTouchStart={dismissInput}
        keyExtractor={(item) => item.id}
        showsVerticalScrollIndicator={false}
        refreshControl={<AppRefreshControl refreshing={refreshing} onRefresh={refreshPost} progressViewOffset={12} colors={[colors.accent]} tintColor={colors.accent} progressBackgroundColor={colors.card} />}
        onScrollBeginDrag={() => { if (showInput) { setShowInput(false); setShowPanel(false); Keyboard.dismiss(); } }}
        contentContainerStyle={{ paddingBottom: Math.max(insets.bottom + (isNativeLiquidGlassEnabled ? 126 : 106), isNativeLiquidGlassEnabled ? 146 : 126) }}
        removeClippedSubviews
        maxToRenderPerBatch={6}
        windowSize={5}
        ListHeaderComponent={
          <View style={c.postCard}>
            <View style={s.headerRow}>
              <Pressable style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }} onPress={() => { if (!isOwnPost) router.push({ pathname: '/user/[name]', params: { name: post.nickname || post.username, userId: post.userId } }); }} disabled={isOwnPost}>
                {post.avatar ? (
                  <ExpoImage source={cachedImageSource(post.avatar)} style={[s.avatar, { marginRight: 10 }]} cachePolicy="memory-disk" transition={0} />
                ) : (
                  <View style={[s.avatar, { backgroundColor: post.avatarColor }]}>
                    <Text style={s.avatarText}>{post.author[0]}</Text>
                  </View>
                )}
                <View>
                  <Text style={c.author}>{post.author}</Text>
                  <Text style={c.meta}>{post.time}</Text>
                </View>
              </Pressable>
              {boardIds.map((bid, i) => {
                const b = boards.find(bb => bb.id === bid);
                if (!b) return null;
                return (
                  <Pressable key={bid} style={[s.boardTag, { backgroundColor: b.color + '20', marginLeft: i > 0 ? 6 : 0, transform: [{ translateY: -7 }] }]} onPress={() => { if (source === `board:${bid}`) return; router.push({ pathname: '/board/[id]', params: { id: bid } }); }}>
                    <Text style={[s.boardTagText, { color: b.color }]}>{b.name}</Text>
                  </Pressable>
                );
              })}
              {isPostPrivate(post.id) && (
                <View style={[s.boardTag, { backgroundColor: '#636E72' + '15' }]}>
                  <Text style={[s.boardTagText, { color: '#636E72' }]}>仅自己可见</Text>
                </View>
              )}
              <Pressable onPress={() => setSheetOpen(true)} style={{ padding: 4, marginLeft: 4, transform: [{ translateY: -7 }] }}>
                <Ionicons name="ellipsis-horizontal" size={18} color="#9AA0B4" />
              </Pressable>
            </View>
            <PostContentText content={post.content} style={c.content} />
            {totalPhotoCount === 1 && postImages.length === 1 && (
              <View style={{ marginVertical: 4, paddingHorizontal: DETAIL_MEDIA_PADDING }}>
                <DetailSingleImage uri={postImages[0]} width={detailMediaWidth} maxHeight={Math.min(360, windowHeight * 0.45)} onPress={() => setViewLivePhoto({ items: viewerMedia, index: 0 })} />
              </View>
            )}
            {totalPhotoCount === 1 && postLivePhotos.length === 1 ? (
              <View style={s.singleLivePhoto}><LivePhotoThumbnail stillUri={postLivePhotos[0].stillUrl} width={singleLivePhotoWidth} height={220} preserveAspectRatio onOpen={() => setViewLivePhoto({ items: postLivePhotos, index: 0 })} /></View>
            ) : totalPhotoCount >= 2 ? (
              <View style={s.livePhotoGrid}>
                {postImages.slice(0, 9).map((uri: string, index: number) => (
                  <Pressable key={`${uri}-${index}`} onPress={() => setViewLivePhoto({ items: viewerMedia, index })}>
                    <Image source={{ uri }} style={{ width: livePhotoSize, height: livePhotoSize, borderRadius: 8, backgroundColor: '#EDEEF3' }} resizeMode="cover" />
                  </Pressable>
                ))}
                {postLivePhotos.slice(0, Math.max(0, 9 - postImages.length)).map((item, index) => (
                  <LivePhotoThumbnail key={`${item.stillUrl}-${index}`} stillUri={item.stillUrl} width={livePhotoSize} height={livePhotoSize} onOpen={() => setViewLivePhoto({ items: viewerMedia, index: postImages.length + index })} />
                ))}
              </View>
            ) : post?.videoUrl && post?.videoMediaType === 'live_photo' && post?.videoPoster ? (
              <View style={s.singleLivePhoto}><LivePhotoThumbnail stillUri={post.videoPoster} width={singleLivePhotoWidth} height={220} preserveAspectRatio onOpen={() => setViewLivePhoto({ items: [{ stillUrl: post.videoPoster, motionUrl: post.videoUrl }], index: 0 })} /></View>
            ) : post?.videoUrl ? (
              <View style={{ marginVertical: 4, paddingHorizontal: 8 }}><DetailVideo poster={post.videoPoster} onPress={() => setViewVideo(true)} /></View>
            ) : null}
            {post.reefRoomId ? <ReefShareCard roomId={post.reefRoomId} /> : null}
            {(post?.boardId || '').includes('announce') ? (
              <View style={{ alignItems: 'center', paddingVertical: 8 }}>
                <Text style={{ fontSize: 12, fontWeight: '600', color: '#33A9DC', backgroundColor: '#33A9DC' + '12', paddingHorizontal: 14, paddingVertical: 4, borderRadius: 10 }}>恒温态</Text>
              </View>
            ) : typeof post?.temperature === 'number' && <TemperatureBar temperature={post.temperature} boosted={boostActive} />}
            <View style={[c.statsRow, { position: 'relative' }]}>
              <View style={c.statItem}>
                <Ionicons name="chatbubble-outline" size={18} color={colors.textMuted} />
                <Text style={c.statText}>{comments.length}</Text>
              </View>
              {post?.sliceBox ? (
                <View pointerEvents="box-none" style={{ position: 'absolute', left: 28, right: 28, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`查看切片盒 ${post.sliceBox.name}`}
                    onPress={(event) => { event.stopPropagation(); if (source === `slice-box:${post.sliceBox.id}`) return; router.push({ pathname: '/slice-box/[id]' as any, params: { id: post.sliceBox.id, name: post.sliceBox.name } }); }}
                  >
                    <Text style={{ maxWidth: '100%', fontSize: 11, lineHeight: 17, fontWeight: '600', color: colors.accent, backgroundColor: colors.accent + '15', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 10, overflow: 'hidden' }} numberOfLines={1}>{post.sliceBox.name}</Text>
                  </Pressable>
                </View>
              ) : null}
              <View style={c.statItem}>
                <Text style={[c.statText, { marginLeft: 0, marginRight: 4 }]}>{getPostStats(post?.id)?.likes ?? likeCount}</Text>
                <Ionicons name={liked ? 'snow' : 'snow-outline'} size={18} color={liked ? colors.accent : colors.textMuted} />
              </View>
            </View>
          </View>
        }
        renderItem={({ item }) => <CommentRow item={item} c={c} colors={colors} postUserId={post?.userId} onDeleted={(commentId) => {
          const next = comments.filter((comment) => comment.id !== commentId);
          setComments(next);
          setPostStats(post.id, { likes: likeCount, liked, comments: next.length });
        }} onReply={() => {
          const isOwn = user?.id && item.userId && user.id === item.userId;
          setReplyTo({ id: item.id, nickname: item.nickname || item.username, isOwn: !!isOwn });
          setShowInput(true);
          inputRef.current?.focus();
        }} />}
      />

      {isNativeLiquidGlassEnabled ? (
        <NativeLiquidGlassView
          glassEffectStyle="regular"
          colorScheme={isDark ? 'dark' : 'light'}
          isInteractive
          style={[s.glassDetailBar, { bottom: Math.max(insets.bottom - 6, 8) }]}
        >
          <Pressable style={s.glassDetailButton} onPress={() => token ? (setReplyTo(null), setShowInput(true)) : router.push('/login')}>
            <Ionicons name="chatbubble-outline" size={20} color={colors.textMuted} />
            <Text style={[c.bottomBtnText, { color: colors.textMuted }]}>评论</Text>
          </Pressable>
          {!isOwnPost && (
            <Pressable style={s.glassDetailButton} onPress={() => token ? router.push({ pathname: '/chat/[name]', params: { name: post.author, peerUserId: post.userId, peerAvatar: post.avatar || '', peerGender: post.gender || '', peerAge: post.age == null ? '' : String(post.age), peerProfileReady: '1', sourcePostId: post.id } }) : router.push('/login')}>
              <Ionicons name="send-outline" size={20} color={colors.textMuted} />
              <Text style={[c.bottomBtnText, { color: colors.textMuted }]}>私信</Text>
            </Pressable>
          )}
          <Pressable style={s.glassDetailButton} onPress={handleLike}>
            <Ionicons name={liked ? 'snow' : 'snow-outline'} size={22} color={liked ? colors.accent : colors.textMuted} />
            <Text style={[c.bottomBtnText, { color: liked ? colors.accent : colors.textMuted }]}>降温</Text>
          </Pressable>
        </NativeLiquidGlassView>
      ) : (
      <View style={[c.bottomBar, { position: 'absolute', left: 0, right: 0, bottom: 0 }]}>
          <Pressable style={c.bottomBtn} onPress={() => token ? (setReplyTo(null), setShowInput(true)) : router.push('/login')}>
            <Ionicons name="chatbubble-outline" size={20} color={colors.textMuted} />
            <Text style={[c.bottomBtnText, { color: colors.textMuted }]}>评论</Text>
          </Pressable>
          {!isOwnPost && (
          <Pressable style={c.bottomBtn} onPress={() => token ? router.push({ pathname: '/chat/[name]', params: { name: post.author, peerUserId: post.userId, peerAvatar: post.avatar || '', peerGender: post.gender || '', peerAge: post.age == null ? '' : String(post.age), peerProfileReady: '1', sourcePostId: post.id } }) : router.push('/login')}>
            <Ionicons name="send-outline" size={20} color={colors.textMuted} />
            <Text style={[c.bottomBtnText, { color: colors.textMuted }]}>私信</Text>
          </Pressable>
          )}
          <Pressable style={c.bottomBtn} onPress={handleLike}>
            <Ionicons name={liked ? 'snow' : 'snow-outline'} size={22} color={liked ? colors.accent : colors.textMuted} />
            <Text style={[c.bottomBtnText, { color: liked ? colors.accent : colors.textMuted }]}>降温</Text>
          </Pressable>
      </View>
      )}

      <ConfirmModal
        visible={postRefrigerantConfirm}
        title="为切片使用制冷剂"
        message="消耗 1 瓶制冷剂，使这条切片在接下来的 6 小时获得一次推荐加权。"
        confirmText="使用 1 瓶"
        tone="accent"
        loading={postRefrigerantLoading}
        iconContent={<RefrigerantIcon size={27} color={colors.accent} />}
        onCancel={() => setPostRefrigerantConfirm(false)}
        onConfirm={async () => {
          setPostRefrigerantLoading(true);
          try {
            const result = await applyRefrigerantToPost(post.id);
            setPost((current: any) => current ? { ...current, refrigerants: result.refrigerants } : current);
            setPostRefrigerantConfirm(false);
            await refreshUser();
          } catch (error: any) {
            setPostRefrigerantConfirm(false);
            Alert.alert('暂时无法使用', error?.message || '请稍后重试');
          } finally {
            setPostRefrigerantLoading(false);
          }
        }}
      />

      {showInput && (
        <KeyboardSticky>
          <View style={{ backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.divider }}>
            {showPanel && (
              <View style={{ backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.divider }}>
                <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.divider }}>
                  <Pressable style={{ flex: 1, alignItems: 'center', paddingVertical: 10, borderBottomWidth: 2, borderBottomColor: panelTab === 'emoji' ? '#33A9DC' : 'transparent' }} onPress={() => setPanelTab('emoji')}>
                    <Ionicons name="happy-outline" size={20} color={panelTab === 'emoji' ? '#33A9DC' : '#9AA0B4'} />
                  </Pressable>
                  <Pressable style={{ flex: 1, alignItems: 'center', paddingVertical: 10, borderBottomWidth: 2, borderBottomColor: panelTab === 'sticker' ? '#33A9DC' : 'transparent' }} onPress={() => setPanelTab('sticker')}>
                    <Ionicons name="heart-outline" size={20} color={panelTab === 'sticker' ? '#33A9DC' : '#9AA0B4'} />
                  </Pressable>
                </View>
                {panelTab === 'emoji' ? (
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', padding: 8, paddingHorizontal: 12 }}>
                    {EMOJIS.map((e) => (
                      <Pressable key={e} style={{ padding: 6 }} onPress={() => setDraft((prev) => prev + e)}>
                        <Text style={{ fontSize: 22 }}>{e}</Text>
                      </Pressable>
                    ))}
                  </View>
                ) : (
                  <View style={{ padding: 12, minHeight: 100 }}>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
                      {stickers.map((uri) => (
                        <Pressable
                          key={uri}
                          onPress={() => sendStickerFromPanel(uri)}
                          onLongPress={(event) => openStickerActions(uri, event.nativeEvent.pageX, event.nativeEvent.pageY)}
                          delayLongPress={450}
                          style={{ width: 72, height: 72, alignItems: 'center', justifyContent: 'center' }}
                        >
                          <ExpoImage source={cachedImageSource(uri)} style={{ width: 68, height: 68 }} contentFit="contain" cachePolicy="memory-disk" autoplay transition={0} />
                        </Pressable>
                      ))}
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="添加表情包"
                        style={[s.addStickerBase, { borderColor: colors.textMuted + '40', backgroundColor: colors.input }]}
                        onPress={addSticker}
                      >
                        <Ionicons name="add" size={26} color={colors.textMuted} />
                      </Pressable>
                      {stickers.length === 0 && (
                        <Text style={{ color: '#9AA0B4', fontSize: 13, paddingVertical: 30, textAlign: 'center', width: '100%' }}>还没有添加表情包</Text>
                      )}
                    </View>
                  </View>
                )}
              </View>
            )}
            <View style={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 8 }}>
              <Pressable style={{ padding: 6 }} onPress={() => { setShowPanel(!showPanel); setPanelTab('emoji'); }}>
                <Ionicons name={showPanel ? 'close-circle-outline' : 'happy-outline'} size={22} color={colors.textMuted} />
              </Pressable>
              <View style={{ flex: 1, marginHorizontal: 8 }}>
                {replyTo && (
                  <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 6, paddingLeft: 4 }}>
                    <Text style={{ fontSize: 12, color: colors.textMuted }}>
                      回复：<Text style={{ fontWeight: '600', color: colors.accent }}>{replyTo.isOwn ? '自己' : replyTo.nickname}</Text>
                    </Text>
                    <Pressable onPress={() => { setReplyTo(null); setDraft(''); }} style={{ marginLeft: 8 }}>
                      <Ionicons name="close-circle" size={14} color={colors.textMuted} />
                    </Pressable>
                  </View>
                )}
                <TextInput
                  ref={inputRef}
                  style={{ flex: 1, backgroundColor: colors.input, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 8, fontSize: 14, color: colors.text }}
                  placeholder={replyTo ? `回复 ${replyTo.isOwn ? '自己' : replyTo.nickname}...` : '说点什么...'}
                  placeholderTextColor="#9AA0B4"
                value={draft}
                onChangeText={setDraft}
                onSubmitEditing={() => sendComment()}
                autoFocus
                multiline
              />
              </View>
              <Pressable style={[s.sendBtn, !draft.trim() && { backgroundColor: '#C4C8D4' }]} disabled={!draft.trim()} onPress={() => sendComment()}>
                <Text style={s.sendBtnText}>发送</Text>
              </Pressable>
            </View>
          </View>
        </KeyboardSticky>
      )}

      <PostActionsSheet
        visible={sheetOpen}
        onClose={() => { setSheetOpen(false); if (isReported(post.id) || isBlocked(post.author)) router.back(); }}
        onDeleted={() => router.back()}
        onUseRefrigerant={() => token ? setPostRefrigerantConfirm(true) : router.push('/login')}
        onMoveToSliceBox={() => setSliceBoxPicker(true)}
        postId={post.id}
        author={post.author}
        authorId={post.userId || post.authorUid}
        isOwn={isOwnPost}
        isPrivate={post.isPrivate || post.visibility === 'private'}
      />
      <SliceBoxPickerModal visible={sliceBoxPicker} postId={post.id} currentBox={post.sliceBox} onClose={() => setSliceBoxPicker(false)} onSaved={() => refreshPost()} />
      <StickerActionsModal
        visible={!!selectedSticker}
        anchor={stickerActionAnchor}
        previewUri={selectedSticker}
        loading={stickerActionLoading}
        onClose={() => setSelectedSticker(null)}
        onMoveToFront={handleMoveStickerToFront}
        onDelete={handleDeleteSticker}
      />
      {post?.videoUrl ? <VideoViewer visible={viewVideo} uri={post.videoUrl} poster={post.videoPoster} onClose={() => setViewVideo(false)} /> : null}
      {viewLivePhoto ? <LivePhotoViewer visible items={viewLivePhoto.items} index={viewLivePhoto.index} onClose={() => setViewLivePhoto(null)} /> : null}
    </View>
  );
}

const cm = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 40 },
  box: { borderRadius: 16, paddingVertical: 10, width: '100%', maxWidth: 300 },
  title: { fontSize: 13, textAlign: 'center', paddingVertical: 10 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 20, borderBottomWidth: StyleSheet.hairlineWidth },
  rowLast: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 20 },
  rowText: { fontSize: 15, marginLeft: 10 },
  reportReasons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, paddingHorizontal: 14 },
  reportReason: { width: '48%', minHeight: 40, borderWidth: 1, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  reportInput: { minHeight: 78, marginHorizontal: 14, marginTop: 12, borderWidth: 1, borderRadius: 11, padding: 10, textAlignVertical: 'top' },
  reportSubmit: { minHeight: 43, marginHorizontal: 14, marginTop: 12, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  reportSubmitText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  reportCancel: { alignItems: 'center', paddingVertical: 13 },
  doneWrap: { alignItems: 'center', paddingVertical: 20, paddingHorizontal: 20 },
  doneTitle: { fontSize: 17, fontWeight: '600', marginTop: 12 },
  doneDesc: { fontSize: 13, marginTop: 6, textAlign: 'center', lineHeight: 19 },
  doneBtn: { backgroundColor: '#33A9DC', borderRadius: 20, paddingHorizontal: 40, paddingVertical: 10, marginTop: 16 },
  doneBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
});

const s = StyleSheet.create({
  headerRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 10 },
  avatar: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  avatarText: { color: '#FFFFFF', fontSize: 16, fontWeight: '600' },
  boardTag: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12 },
  boardTagText: { fontSize: 12, fontWeight: '500' },
  singleImageFrame: { overflow: 'hidden', alignItems: 'flex-start', justifyContent: 'center', backgroundColor: 'transparent' },
  postImage: { width: '100%', height: 260, backgroundColor: '#EDEEF3', marginTop: 4 },
  livePhotoGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: DETAIL_MEDIA_GAP, marginVertical: 4, paddingHorizontal: DETAIL_MEDIA_PADDING },
  singleLivePhoto: { marginVertical: 4, paddingHorizontal: DETAIL_MEDIA_PADDING, alignItems: 'center' },
  smallAvatar: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  smallAvatarText: { color: '#FFFFFF', fontSize: 13, fontWeight: '600' },
  commentActions: { flexDirection: 'row', alignItems: 'center', gap: 16, marginTop: 8 },
  commentActionButton: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 3, paddingRight: 4 },
  commentActionText: { fontSize: 11, fontWeight: '500' },
  commentSideColumn: { width: 54, marginRight: -6, alignSelf: 'stretch', alignItems: 'flex-end', justifyContent: 'space-between', paddingVertical: 1 },
  commentSideAction: { width: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-end', gap: 5, paddingVertical: 3 },
  commentSideIcon: { width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
  commentSideCount: { minWidth: 18, fontSize: 11, lineHeight: 16, textAlign: 'left', fontVariant: ['tabular-nums'] },
  commentRefrigerantCount: { transform: [{ translateY: 2 }] },
  glassDetailBar: { position: 'absolute', left: 12, right: 12, minHeight: 58, borderRadius: 29, overflow: 'hidden', flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 4 },
  glassDetailButton: { flex: 1, minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 8 },
  addStickerBase: { width: 72, height: 72, borderRadius: 8, borderWidth: 1, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
  sendBtn: { backgroundColor: '#33A9DC', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 8, marginLeft: 10 },
  sendBtnText: { color: '#FFFFFF', fontSize: 13, fontWeight: '500' },
});
