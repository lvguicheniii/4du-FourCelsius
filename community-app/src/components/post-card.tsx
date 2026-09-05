import { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import { Pressable } from '@/components/pressable';
import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { PostActionsSheet, SliceBoxPickerModal } from '@/components/post-actions';
import { ConfirmModal } from '@/components/confirm-modal';
import { RefrigerantIcon } from '@/components/refrigerant-icon';
import { Alert } from '@/components/app-alert';
import { useRouter } from 'expo-router';
import { useAuth } from '@/contexts/auth';
import { useCommunityConfig } from '@/contexts/community-config';
import { getPostStats, setPostStats, subscribeStore } from '@/data/store';
import { applyRefrigerantToPost, coolPost } from '@/api/client';
import { UserAvatar } from '@/components/user-avatar';
import { TemperatureBar } from '@/components/temperature-bar';
import { VideoViewer } from '@/components/video-viewer';
import { LivePhotoThumbnail, LivePhotoViewer, type MediaViewerItem } from '@/components/live-photo';
import { PostContentText } from '@/components/post-content-text';
import { useTheme } from '@/lib/theme';
import type { ThemeColors } from '@/lib/theme';
import { formatRelativeTime } from '@/lib/time';
import { ReefShareCard } from '@/components/reef-share-card';

const CARD_OUTER_GUTTER = 12;
const CARD_INNER_PADDING = 14;
const MEDIA_GRID_GAP = 4;
const MEDIA_GRID_COLUMNS = 3;

function themed(c: ThemeColors) {
  return {
    card: { backgroundColor: c.card, borderRadius: 14, padding: 14, marginBottom: 12 } as const,
    author: { fontSize: 15, fontWeight: '600' as const, color: c.text } as const,
    meta: { fontSize: 12, color: c.textMuted, marginTop: 2 } as const,
    content: { fontSize: 15, lineHeight: 23, color: c.text } as const,
    actions: { flexDirection: 'row' as const, alignItems: 'center' as const, minHeight: 28, marginTop: 8, justifyContent: 'space-between' as const } as const,
    actionText: { fontSize: 13, color: c.textMuted, marginLeft: 5 } as const,
    mutedIcon: c.textMuted as string,
  };
}

export interface ApiPost {
  id: string;
  userId?: string; username?: string; nickname?: string; avatar?: string | null; author?: string; authorUid?: string; avatarColor?: string;
  content?: string; images?: string[]; thumbnails?: string[]; image?: string; boardId?: string; likes?: number; comments?: number;
  liked?: boolean; createdAt?: string; time?: string; temperature?: number; onRefresh?: () => void;
  visibility?: 'public' | 'private'; isPrivate?: boolean;
  refrigerants?: number;
  refrigerantBoostExpiresAt?: string | null;
  reefRoomId?: string | null;
  sliceBox?: { id: string; name: string } | null;
  videoUrl?: string | null; videoPoster?: string | null; videoMediaType?: 'video' | 'live_photo' | null;
  livePhotos?: { stillUrl: string; motionUrl: string }[];
}

function PostVideo({ poster, onPress }: { poster?: string | null; onPress: () => void }) {
  return <Pressable onPress={(event) => { event.stopPropagation(); onPress(); }} style={{ height: 220, marginTop: 10, borderRadius: 10, overflow: 'hidden', backgroundColor: '#101820' }}>
    {poster ? <ExpoImage source={{ uri: poster }} style={{ width: '100%', height: '100%' }} contentFit="cover" cachePolicy="memory-disk" /> : null}
    <View pointerEvents="none" style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="play-circle" size={48} color="#FFFFFF" /></View>
  </Pressable>;
}

function SinglePostImage({ uri, width, onPress }: { uri: string; width: number; onPress: () => void }) {
  const [aspectRatio, setAspectRatio] = useState(4 / 3);
  const maxHeight = 300;
  const imageWidth = Math.min(width, maxHeight * aspectRatio);
  const imageHeight = imageWidth / aspectRatio;

  return (
    <View style={[s.singleImageFrame, { width: imageWidth, height: imageHeight }]}>
      <Pressable onPress={(event) => { event.stopPropagation(); onPress(); }}>
        <ExpoImage
          source={{ uri }}
          style={{ width: imageWidth, height: imageHeight }}
          contentFit="contain"
          cachePolicy="disk"
          transition={200}
          onLoad={(event) => {
            if (event.source.width > 0 && event.source.height > 0) {
              setAspectRatio(event.source.width / event.source.height);
            }
          }}
        />
      </Pressable>
    </View>
  );
}

export function PostCard({ post, onRefresh, feedContext }: { post: ApiPost; onRefresh?: () => void; feedContext?: string }) {
  const router = useRouter(); const { token, user, refreshUser } = useAuth(); const { colors } = useTheme();
  const { boards } = useCommunityConfig();
  const { width: screenW } = useWindowDimensions();
  const contentW = Math.max(0, screenW - (CARD_OUTER_GUTTER + CARD_INNER_PADDING) * 2);
  const imgSize = (contentW - MEDIA_GRID_GAP * (MEDIA_GRID_COLUMNS - 1)) / MEDIA_GRID_COLUMNS;
  const S = useMemo(() => themed(colors), [colors]);
  // 订阅全局 store 变化（其他设备的点赞操作）
  const [, forceUpdate] = useState(0);
  useEffect(() => subscribeStore(() => forceUpdate(v => v + 1)), []);

  // Feed and detail pages share these optimistic stats.
  const stats = getPostStats(post.id);
  // The shared store is the single source of truth so detail/feed state stays in sync.
  const liked = stats?.liked ?? post.liked ?? false;
  // count: store（本人乐观更新）> API 返回值
  const likeCount = stats?.likes ?? post.likes ?? 0;
  const commentCount = stats?.comments ?? post.comments ?? 0;

  const [showActions, setShowActions] = useState(false); const [viewVideo, setViewVideo] = useState(false); const [viewLivePhoto, setViewLivePhoto] = useState<{ items: MediaViewerItem[]; index: number } | null>(null);
  const [refrigerantConfirm, setRefrigerantConfirm] = useState(false); const [refrigerantLoading, setRefrigerantLoading] = useState(false); const [sliceBoxPicker, setSliceBoxPicker] = useState(false);
  const [currentSliceBox, setCurrentSliceBox] = useState(post.sliceBox ?? null);
  useEffect(() => setCurrentSliceBox(post.sliceBox ?? null), [post.sliceBox]);
  const [boostNow, setBoostNow] = useState(() => Date.now());
  useEffect(() => {
    if (!post.refrigerantBoostExpiresAt) return;
    const timer = setInterval(() => setBoostNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, [post.refrigerantBoostExpiresAt]);
  const boostExpiresMs = post.refrigerantBoostExpiresAt ? Date.parse(post.refrigerantBoostExpiresAt.replace(' ', 'T') + (post.refrigerantBoostExpiresAt.includes('Z') ? '' : '+08:00')) : 0;
  const boostRemainingMs = boostExpiresMs - boostNow;
  // Android may still bubble a nested Live Photo press to the card.
  const suppressCardPressRef = useRef(false);
  const likePendingRef = useRef(false);
  const suppressCardPress = useCallback(() => {
    suppressCardPressRef.current = true;
    setTimeout(() => { suppressCardPressRef.current = false; }, 350);
  }, []);
  const openLivePhoto = useCallback((items: MediaViewerItem[], index: number) => {
    suppressCardPress();
    setViewLivePhoto({ items, index });
  }, [suppressCardPress]);
  const author = post.nickname || post.author || '';
  const authorId = post.userId || post.authorUid || '';
  const canOpenAuthor = !!authorId && authorId !== user?.id;
  const AVATAR_COLORS = ['#33A9DC','#1D9E75','#D85A30','#8854D0','#E17A2F','#0C8CE9','#E24B4A','#16A34A','#9333EA','#0891B2','#D97706','#DC2626'];
  const hashColor = (s: string) => { let h = 0; for (let i=0;i<s.length;i++) h=((h<<5)-h)+s.charCodeAt(i); return AVATAR_COLORS[Math.abs(h)%AVATAR_COLORS.length]; };
  const avatarUri = post.avatar; const imgList = post.thumbnails?.length ? post.thumbnails : (post.images ?? (post.image ? [post.image] : []));
  const fullImgList = imgList.map((uri, index) => post.images?.[index] || (index === 0 ? post.image : undefined) || uri);
  const livePhotoList = post.livePhotos || [];
  const totalPhotoCount = imgList.length + livePhotoList.length;
  const viewerMedia: MediaViewerItem[] = [
    ...fullImgList.map(stillUrl => ({ stillUrl })),
    ...livePhotoList,
  ];
  const time = post.createdAt ? formatRelativeTime(post.createdAt) : (post.time || '');
  const boardIds: string[] = (() => { try { const p = JSON.parse(post.boardId || '["daily"]'); return Array.isArray(p) ? p : [post.boardId || 'daily']; } catch { return [post.boardId || 'daily']; } })();

  const handleLike = useCallback(async () => {
    if (!token) { router.push('/login'); return; }
    if (likePendingRef.current) return;
    likePendingRef.current = true;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    const prevLiked = liked; const prevCount = likeCount;
    const newLiked = !prevLiked; const newCount = prevLiked ? Math.max(0, prevCount-1) : prevCount+1;
    setPostStats(post.id, { likes: newCount, liked: newLiked, comments: commentCount });
    try {
      const result = await coolPost(post.id, newLiked);
      setPostStats(post.id, { likes: result.likes ?? newCount, liked: result.liked ?? newLiked, comments: commentCount });
    } catch {
      setPostStats(post.id, { likes: prevCount, liked: prevLiked, comments: commentCount });
    } finally {
      likePendingRef.current = false;
    }
  }, [post.id, liked, likeCount, commentCount, token, router]);

  const openAuthor = useCallback(() => {
    if (!canOpenAuthor) return;
    router.push({ pathname: '/user/[name]', params: { name: author, userId: authorId } });
  }, [author, authorId, canOpenAuthor, router]);

  return (
    <Pressable style={S.card} onPress={() => {
      if (suppressCardPressRef.current) return;
      router.push({ pathname: '/post/[id]', params: { id: post.id, source: feedContext } });
      }} onLongPress={() => { Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium); setShowActions(true); }}>
      <View style={s.header}>
        <Pressable disabled={!canOpenAuthor} onPress={(event) => { event.stopPropagation(); openAuthor(); }}>
          <UserAvatar uri={avatarUri} name={author} size={38} />
        </Pressable>
        <View style={{flex:1}}>
          <Pressable disabled={!canOpenAuthor} onPress={(event) => { event.stopPropagation(); openAuthor(); }}>
            <Text style={S.author}>{author}</Text>
          </Pressable>
          <Text style={S.meta}>{time}</Text>
        </View>
        {boardIds.map((bid, i) => {
          const b = boards.find((bb) => bb.id === bid);
          if (!b) return null;
          return (
            <Pressable key={bid} style={[s.boardTag, { backgroundColor: b.color + '20', marginLeft: i > 0 ? 4 : 0, transform: [{ translateY: -7 }] }]} onPress={(e) => { e.stopPropagation(); if (feedContext === `board:${bid}`) return; router.push({ pathname: '/board/[id]', params: { id: bid } }); }}>
              <Text style={[s.boardTagText, { color: b.color }]} numberOfLines={1}>{b.name}</Text>
            </Pressable>
          );
        })}
      </View>
      {post.content ? <PostContentText content={post.content} style={S.content} numberOfLines={5} /> : null}
      {totalPhotoCount === 1 && imgList.length === 1 ? (
        <SinglePostImage uri={fullImgList[0]} width={contentW} onPress={() => openLivePhoto(viewerMedia, 0)} />
      ) : totalPhotoCount === 1 && livePhotoList.length === 1 ? (
        <View style={s.singleLivePhoto}>
          <LivePhotoThumbnail stillUri={livePhotoList[0].stillUrl} width={contentW} height={220} preserveAspectRatio onPressIn={suppressCardPress} onOpen={() => openLivePhoto(livePhotoList, 0)} />
        </View>
      ) : totalPhotoCount >= 2 ? (
        <View style={s.mediaGrid}>
          {imgList.slice(0, 9).map((uri,i)=>(
          <Pressable key={i} onPress={(e)=>{e.stopPropagation();openLivePhoto(viewerMedia, i);}}>
            <ExpoImage source={{uri}} style={{ width: imgSize, height: imgSize, borderRadius: 8, backgroundColor: '#EDEEF3' }} contentFit="cover" cachePolicy="disk" transition={200} />
          </Pressable>))}
          {livePhotoList.slice(0, Math.max(0, 9 - imgList.length)).map((item, index) => (
            <LivePhotoThumbnail key={`${item.stillUrl}-${index}`} stillUri={item.stillUrl} width={imgSize} height={imgSize} onPressIn={suppressCardPress} onOpen={() => openLivePhoto(viewerMedia, fullImgList.length + index)} />
          ))}
        </View>
      ) : null}
      {post.reefRoomId ? <ReefShareCard roomId={post.reefRoomId} /> : null}
      {post.videoUrl && post.videoMediaType === 'live_photo' && post.videoPoster ? (
        <View style={s.singleLivePhoto}><LivePhotoThumbnail stillUri={post.videoPoster} width={contentW} height={220} preserveAspectRatio onPressIn={suppressCardPress} onOpen={() => openLivePhoto([{ stillUrl: post.videoPoster!, motionUrl: post.videoUrl! }], 0)} /></View>
      ) : post.videoUrl ? <PostVideo poster={post.videoPoster} onPress={() => setViewVideo(true)} /> : null}
      {(post.boardId || '').includes('announce') ? (
        <View style={{ alignItems: 'center', paddingVertical: 6 }}>
          <Text style={{ fontSize: 11, fontWeight: '600', color: '#33A9DC', backgroundColor: '#33A9DC12', paddingHorizontal: 10, paddingVertical: 3, borderRadius: 8 }}>恒温态</Text>
        </View>
      ) : typeof post.temperature === 'number' && <TemperatureBar temperature={post.temperature} boosted={boostRemainingMs > 0} />}
      <View style={S.actions}>
        <View style={[s.btn, s.commentAction]}><Ionicons name="chatbubble-outline" size={18} color={S.mutedIcon}/><Text style={S.actionText}>{commentCount}</Text></View>
        {currentSliceBox ? (
          <View pointerEvents="box-none" style={s.sliceBoxTagRow}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`查看切片盒 ${currentSliceBox.name}`}
              onPress={(event) => {
                event.stopPropagation();
                if (feedContext === `slice-box:${currentSliceBox.id}`) return;
                router.push({ pathname: '/slice-box/[id]' as any, params: { id: currentSliceBox.id, name: currentSliceBox.name } });
              }}
            >
              <View style={[s.sliceBoxTag, { backgroundColor: colors.accent + '15' }]}><Text style={[s.sliceBoxTagText, { color: colors.accent }]} numberOfLines={1}>{currentSliceBox.name}</Text></View>
            </Pressable>
          </View>
        ) : null}
        <Pressable style={[s.btn, { marginRight: 0 }]} onPress={(e)=>{e.stopPropagation();handleLike();}}>
          <Text style={[S.actionText, { marginLeft: 0, marginRight: 5 }, liked&&{color:colors.accent}]}>{likeCount}</Text>
          <Ionicons name={liked?'snow':'snow-outline'} size={18} color={liked?colors.accent:S.mutedIcon}/></Pressable>
      </View>
      {post.videoUrl ? <VideoViewer visible={viewVideo} uri={post.videoUrl} poster={post.videoPoster} onClose={() => setViewVideo(false)} /> : null}
      {viewLivePhoto ? <LivePhotoViewer visible items={viewLivePhoto.items} index={viewLivePhoto.index} onClose={() => setViewLivePhoto(null)} /> : null}
      <PostActionsSheet
        visible={showActions}
        postId={post.id}
        author={author}
        authorId={post.userId || post.authorUid}
        isOwn={!!user?.id && user.id === (post.userId || post.authorUid)}
        isPrivate={post.isPrivate || post.visibility === 'private'}
        onClose={() => setShowActions(false)}
        onDeleted={onRefresh}
        onUseRefrigerant={() => token ? setRefrigerantConfirm(true) : router.push('/login')}
        onMoveToSliceBox={() => setSliceBoxPicker(true)}
      />
      <SliceBoxPickerModal visible={sliceBoxPicker} postId={post.id} currentBox={currentSliceBox} onClose={() => setSliceBoxPicker(false)} onSaved={(box) => setCurrentSliceBox(box)} />
      <ConfirmModal visible={refrigerantConfirm} title="为切片使用制冷剂" message="消耗 1 瓶制冷剂，让这条切片在接下来的 6 小时获得一次推荐加权。" confirmText="使用 1 瓶" tone="accent" loading={refrigerantLoading} iconContent={<RefrigerantIcon size={27} color={colors.accent} />} onCancel={() => setRefrigerantConfirm(false)} onConfirm={async () => { setRefrigerantLoading(true); try { await applyRefrigerantToPost(post.id); setRefrigerantConfirm(false); await refreshUser(); } catch (error: any) { setRefrigerantConfirm(false); Alert.alert('暂时无法使用', error?.message || '请稍后重试'); } finally { setRefrigerantLoading(false); } }} />
    </Pressable>
  );
}

const s = StyleSheet.create({
  header: { flexDirection:'row', alignItems:'center', marginBottom:10, gap:10 },
  boardTag: { flexShrink: 0, alignItems: 'center', paddingHorizontal:9, paddingVertical:4, borderRadius:12 },
  boardTagText: { fontSize:11, lineHeight: 16, fontWeight:'600' },
  mediaGrid: { width: '100%', flexDirection:'row', flexWrap:'wrap', gap: MEDIA_GRID_GAP, marginTop:10 },
  singleImageFrame: { marginTop: 10, overflow: 'hidden', alignSelf: 'flex-start', alignItems: 'flex-start', justifyContent: 'center', borderRadius: 8 },
  singleLivePhoto: { marginTop: 10, alignItems: 'flex-start' },
  img: { width:100, height:100, borderRadius:8, backgroundColor:'#EDEEF3' },
  btn: { flexDirection:'row', alignItems:'center', marginRight:24 },
  commentAction: { minWidth: 44, marginRight: 0 },
  sliceBoxTagRow: { position: 'absolute', left: 48, right: 48, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  sliceBoxTag: { maxWidth: '100%', minHeight: 24, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  sliceBoxTagText: { maxWidth: '100%', fontSize: 11, lineHeight: 16, fontWeight: '600', includeFontPadding: false },
});
