import { useMemo, useRef, useState, useEffect } from 'react';
import {
  FlatList,
  Image as RNImage,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  Keyboard,
  LayoutAnimation,
  Modal,
  Dimensions,
  ActivityIndicator,
  ScrollView,
  Switch,
} from 'react-native';
import { Alert } from '@/components/app-alert';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Image as ExpoImage } from 'expo-image';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { ScreenHeader } from '@/components/screen-header';
import { useAuth } from '@/contexts/auth';
import { launchImageLibrarySafely } from '@/lib/image-picker';
import * as Haptics from 'expo-haptics';
import { ChatMessage, conversations, posts } from '@/data/mock';
import { isBlocked, myStickers, setLastPeerName, getLastPeerName, setBlocked } from '@/data/store';
import { useStoreVersion } from '@/hooks/use-store';
import { getChatByUsername, sendChatMessage as apiSendMessage, uploadFile, uploadMotionPhoto, uploadPairedLivePhoto, isNotMotionPhotoError, getUserProfile, getFollowStatus, getMyStickers, addStickerUrl, moveStickerToFront, deleteStickerByUrl, giftFrostShell, reportPrivateMessage, setUserBlocked, resolveApiUrl, deletePrivateMessageForMe, recallPrivateMessage, getConversationPreference, setConversationPreference } from '@/api/client';
import { useTheme } from '@/lib/theme';
import { useWs } from '@/contexts/ws';
import { ImageViewer } from '@/components/image-viewer';
import { VideoViewer } from '@/components/video-viewer';
import { LivePhotoThumbnail, LivePhotoViewer, type LivePhotoItem } from '@/components/live-photo';
import { RefrigerantIcon } from '@/components/refrigerant-icon';
import { FrostShellIcon } from '@/components/frost-shell-icon';
import { ConfirmModal } from '@/components/confirm-modal';
import { GenderSymbol } from '@/components/gender-badge';
import { formatChatMessageTime } from '@/lib/time';
import { MessageActionModal } from '@/components/message-action-modal';
import { UploadPieProgress } from '@/components/upload-pie-progress';
import { validatePickedVideo } from '@/lib/video-media';
import { useCommunityConfig } from '@/contexts/community-config';
import { cachedImageSource, primeUploadedImageCache, stableMediaCacheKey } from '@/lib/media-cache';
import { EmojiPicker } from '@/components/emoji-picker';
import { StickerActionsModal } from '@/components/sticker-actions-modal';
import { KeyboardInsetView } from '@/components/keyboard-sticky';
import { isNativeLiquidGlassEnabled, NativeLiquidGlassView } from '@/components/liquid-glass';

const { width: SW } = Dimensions.get('window');
const STICKER_GRID_GAP = 10;
const STICKER_PANEL_PADDING = 14;
const STICKER_CELL_SIZE = Math.floor((SW - STICKER_PANEL_PADDING * 2 - STICKER_GRID_GAP * 3) / 4);
const PRIVATE_MESSAGE_REPORT_REASONS = ['垃圾广告', '色情低俗', '人身攻击', '不实信息', '违法违规', '其他'];

type PendingMedia = {
  id: string;
  kind: 'image' | 'video' | 'live_photo' | 'android_motion_candidate';
  uri: string;
  stillUri?: string;
  motionUri?: string;
  width?: number;
  height?: number;
};

function resolveChatMediaUri(uri?: string | null) {
  const value = String(uri || '').trim();
  if (!value || /^(https?:|file:|content:|data:|blob:)/i.test(value)) return value;
  return resolveApiUrl(value);
}

function parseRefrigerantGift(content: string) {
  const match = String(content || '').replace(/\s+/g, ' ').trim().match(/^(.+?)\s*向\s*(.+?)\s*赠予了\s*1\s*(?:瓶制冷剂|枚脆弱(?:的)?浮霜贝)$/);
  return match ? { fromName: match[1], toName: match[2] } : null;
}

function parsePostContext(content: string): { postId: string; author: string; content: string; image?: string } | null {
  try {
    const value = JSON.parse(content);
    return value?.postId && value?.author ? value : null;
  } catch {
    return null;
  }
}

function MessageTimestamp({ value, isDark, exact, onPress }: { value: string; isDark: boolean; exact: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={5} style={styles.messageTimestampPressable}>
      <Text style={[styles.messageTimestamp, { color: isDark ? '#8E9AA7' : '#9AA0AA' }]}>
        {formatChatMessageTime(value, exact)}
      </Text>
    </Pressable>
  );
}

function ChatVideo({ poster, onPress, onLongPress }: { poster?: string; onPress: () => void; onLongPress?: () => void }) {
  return <Pressable onPress={onPress} onLongPress={onLongPress} delayLongPress={450} style={{ width: 240, height: 180, marginHorizontal: 8, borderRadius: 12, overflow: 'hidden', backgroundColor: '#101820' }}>
    {poster ? <ExpoImage source={cachedImageSource(poster)} style={{ position: 'absolute', width: 240, height: 180 }} contentFit="cover" cachePolicy="memory-disk" /> : null}
    <View pointerEvents="none" style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="play-circle" size={48} color="#FFFFFF" /></View>
  </Pressable>;
}

function parseCommentContext(content: string): { commentId: string; postId: string; author: string; content: string } | null {
  try {
    const value = JSON.parse(content);
    return value?.commentId && value?.postId && value?.author ? value : null;
  } catch {
    return null;
  }
}

const chatMessageCache = new Map<string, ChatMessage[]>();
const chatImageSizeCache = new Map<string, { width: number; height: number }>();
const chatProfileCache = new Map<string, any>();

function rememberChatProfile(name: string, profile: any) {
  if (!profile) return;
  const completeProfile = { ...profile, _chatProfileComplete: true };
  if (name) chatProfileCache.set(name, completeProfile);
  if (profile.id) chatProfileCache.set(String(profile.id), completeProfile);
}

function Bubble({ msg, showTime, exactTimes, onToggleTimes, peerName, peerColor, peerAvatar, isDark, myAvatar, myName, onMessageLongPress, onPeerAvatarPress, uploadProgress }: { msg: ChatMessage; showTime: boolean; exactTimes: boolean; onToggleTimes: () => void; peerName: string; peerColor: string; peerAvatar?: string | null; isDark: boolean; myAvatar?: string | null; myName?: string; onMessageLongPress?: (message: ChatMessage) => void; onPeerAvatarPress?: () => void; uploadProgress?: number }) {
  const router = useRouter();
  const mine = msg.from === 'me';
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [previewVideo, setPreviewVideo] = useState<{ uri: string; poster?: string } | null>(null);
  const [previewLivePhoto, setPreviewLivePhoto] = useState<LivePhotoItem | null>(null);
  const maxImageWidth = Math.min(SW * 0.6, 240);
  const mediaUri = resolveChatMediaUri(msg.content);
  const imageCacheKey = stableMediaCacheKey(mediaUri);
  const initialLocalSize = msg.localPreviewSize?.width && msg.localPreviewSize?.height
    ? (() => {
        const ratio = Math.min(1, maxImageWidth / msg.localPreviewSize!.width);
        return { width: msg.localPreviewSize!.width * ratio, height: msg.localPreviewSize!.height * ratio };
      })()
    : null;
  const [imageSize, setImageSize] = useState(() => chatImageSizeCache.get(imageCacheKey) || initialLocalSize || { width: 240, height: 240 });
  const livePhotoMedia = useMemo<LivePhotoItem | null>(() => {
    if (msg.kind !== 'live_photo') return null;
    try {
      const value = JSON.parse(msg.content);
      const stillUrl = resolveChatMediaUri(value.stillUrl);
      const motionUrl = resolveChatMediaUri(value.motionUrl);
      return stillUrl && motionUrl ? { stillUrl, motionUrl } : null;
    } catch { return null; }
  }, [msg.content, msg.kind]);
  const timestamp = showTime ? <MessageTimestamp value={msg.time} isDark={isDark} exact={exactTimes} onPress={onToggleTimes} /> : null;

  useEffect(() => {
    if (msg.kind !== 'image') return;
    const cachedSize = chatImageSizeCache.get(imageCacheKey);
    if (cachedSize) { setImageSize(cachedSize); return; }
    RNImage.getSize(mediaUri, (width, height) => {
      const ratio = Math.min(1, maxImageWidth / width);
      const nextSize = { width: width * ratio, height: height * ratio };
      chatImageSizeCache.set(imageCacheKey, nextSize);
      setImageSize(current => current.width === nextSize.width && current.height === nextSize.height ? current : nextSize);
    });
  }, [imageCacheKey, maxImageWidth, mediaUri, msg.kind]);

  const closePreview = () => {
    setPreviewUri(null);
  };

  const renderContent = () => {
    if (msg.kind === 'text') {
      return (
        <View style={[
          styles.bubble,
          mine
            ? [styles.bubbleMine, { backgroundColor: '#33A9DC' }]
            : [styles.bubbleOther, isDark ? { backgroundColor: '#3A3D45' } : { backgroundColor: '#FFFFFF', borderWidth: 0.5, borderColor: '#1A1D26' }]
        ]}>
          <Text style={[styles.bubbleText, mine ? { color: '#FFFFFF' } : (isDark ? { color: '#FFFFFF' } : { color: '#1A1D26' })]}>{msg.content}</Text>
        </View>
      );
    }
    if (msg.kind === 'image') {
      return (
        <Pressable onPress={() => uploadProgress === undefined && setPreviewUri(mediaUri)} onLongPress={() => uploadProgress === undefined && onMessageLongPress?.(msg)} delayLongPress={450}>
          <ExpoImage
            source={cachedImageSource(mediaUri)}
            placeholder={msg.localPreviewUri ? cachedImageSource(resolveChatMediaUri(msg.localPreviewUri)) : undefined}
            placeholderContentFit="cover"
            style={{ width: imageSize.width, height: imageSize.height, borderRadius: 12, marginHorizontal: 8, backgroundColor: isDark ? '#2A3038' : '#EDEEF3' }}
            contentFit="cover"
            cachePolicy="memory-disk"
            transition={0}
          />
          {uploadProgress !== undefined && <UploadPieProgress progress={uploadProgress} />}
        </Pressable>
      );
    }
    if (msg.kind === 'video' || msg.kind === 'live_photo') {
      let videoUri = mediaUri; let poster: string | undefined;
      if (livePhotoMedia) { videoUri = livePhotoMedia.motionUrl; poster = livePhotoMedia.stillUrl; }
      return <View style={{ marginHorizontal: 8 }}>
        {msg.kind === 'live_photo' && poster
          ? <LivePhotoThumbnail
              stillUri={poster}
              width={initialLocalSize?.width || maxImageWidth}
              height={initialLocalSize?.height || 180}
              preserveAspectRatio
              placeholderUri={msg.localPreviewUri}
              onLongPress={() => uploadProgress === undefined && onMessageLongPress?.(msg)}
              onOpen={() => uploadProgress === undefined && setPreviewLivePhoto({ stillUrl: poster!, motionUrl: videoUri })}
            />
          : <ChatVideo poster={poster} onPress={() => uploadProgress === undefined && setPreviewVideo({ uri: videoUri, poster })} onLongPress={() => uploadProgress === undefined && onMessageLongPress?.(msg)} />}
        {uploadProgress !== undefined && <UploadPieProgress progress={uploadProgress} />}
      </View>;
    }
    // sticker
    return (
      <Pressable onLongPress={() => onMessageLongPress?.(msg)} delayLongPress={450}>
        <ExpoImage source={cachedImageSource(mediaUri)} style={styles.stickerMsg} contentFit="contain" cachePolicy="memory-disk" autoplay transition={0} />
      </Pressable>
    );
  };

  if (msg.kind === 'post_context') {
    const source = parsePostContext(msg.content);
    if (!source) return null;
    return (
      <View style={styles.messageItem}>
        {timestamp}
        <View style={[styles.postContextWrap, { backgroundColor: isDark ? '#202A35' : '#EDF7FB' }]}>
        <Text style={[styles.postContextLead, { color: isDark ? '#9AA8B6' : '#73818C' }]}>从 {source.author} 的切片开始对话</Text>
        <Pressable style={[styles.postContextCard, { backgroundColor: isDark ? '#293644' : '#FFFFFF' }]} onPress={() => router.push({ pathname: '/post/[id]', params: { id: source.postId } })}>
          <View style={styles.postContextText}>
            <Text style={styles.postContextAuthor} numberOfLines={1}>{source.author}</Text>
            <Text style={[styles.postContextContent, { color: isDark ? '#D7E0E7' : '#3D4952' }]} numberOfLines={2}>{source.content || '[图片切片]'}</Text>
          </View>
          {!!source.image && <ExpoImage source={cachedImageSource(resolveChatMediaUri(source.image))} style={styles.postContextImage} contentFit="cover" cachePolicy="memory-disk" transition={0} />}
        </Pressable>
        </View>
      </View>
    );
  }


  if (msg.kind === 'comment_context') {
    const source = parseCommentContext(msg.content);
    if (!source) return null;
    return (
      <View style={styles.messageItem}>
        {timestamp}
        <View style={[styles.postContextWrap, { backgroundColor: isDark ? '#202A35' : '#EDF7FB' }]}>
          <Text style={[styles.postContextLead, { color: isDark ? '#9AA8B6' : '#73818C' }]}>从这条评论开始对话</Text>
          <Pressable
            style={[styles.commentContextCard, { backgroundColor: isDark ? '#293644' : '#FFFFFF' }]}
            onPress={() => router.push({ pathname: '/post/[id]', params: { id: source.postId } })}
          >
            <Text style={styles.postContextAuthor} numberOfLines={1}>{source.author}</Text>
            <Text style={[styles.commentContextContent, { color: isDark ? '#D7E0E7' : '#3D4952' }]} numberOfLines={4}>{source.content}</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  if (msg.kind === 'system') {
    const gift = parseRefrigerantGift(msg.content);
    const recalledText = msg.content === '消息已撤回' ? (mine ? '你刚撤回了一条消息' : `【${peerName}】刚撤回了一条消息`) : msg.content;
    return (
      <View style={styles.messageItem}>
        {timestamp}
        <View style={styles.systemGiftMessage}>
        <FrostShellIcon size={21} color="#33A9DC" cracked />
        {gift ? (
          <View style={{ alignItems: 'center' }}>
            <Text style={[styles.systemGiftText, { color: isDark ? '#D9EAF2' : '#5E6E78' }]}>
              {mine ? (
                <><Text style={styles.systemGiftActor}>你</Text>{'向'}<Text style={styles.systemGiftActor}>{gift.toName}</Text></>
              ) : (
                <><Text style={styles.systemGiftActor}>{gift.fromName}</Text>{'向'}<Text style={styles.systemGiftActor}>你</Text></>
              )}
            </Text>
            <Text style={[styles.systemGiftSecondLine, { color: isDark ? '#D9EAF2' : '#5E6E78' }]}>赠予了1枚脆弱浮霜贝</Text>
          </View>
        ) : (
          <Text style={[styles.systemGiftText, { color: isDark ? '#D9EAF2' : '#5E6E78' }]}>{recalledText}</Text>
        )}
        </View>
      </View>
    );
  }

  return (
    <View style={styles.messageItem}>
      {timestamp}
      <Pressable style={[styles.msgRow, mine && { flexDirection: 'row-reverse' }]} onLongPress={() => onMessageLongPress?.(msg)} delayLongPress={450}>
      <Pressable
        onPress={mine ? undefined : onPeerAvatarPress}
      >
        <View style={[styles.msgAvatar, { backgroundColor: mine ? '#33A9DC' : peerColor }]}>
          {mine && myAvatar ? (
            <ExpoImage source={cachedImageSource(resolveChatMediaUri(myAvatar))} style={styles.msgAvatarImg} cachePolicy="disk" />
          ) : !mine && peerAvatar ? (
            <ExpoImage source={cachedImageSource(resolveChatMediaUri(peerAvatar))} style={styles.msgAvatarImg} cachePolicy="disk" />
          ) : (
            <Text style={styles.msgAvatarText}>{mine ? (myName || '我')[0] : peerName[0]}</Text>
          )}
        </View>
      </Pressable>
      {renderContent()}
      <ImageViewer images={previewUri ? [previewUri] : []} index={0} visible={!!previewUri} onClose={closePreview} />
      {previewVideo && <VideoViewer visible={!!previewVideo} uri={previewVideo.uri} poster={previewVideo.poster} onClose={() => setPreviewVideo(null)} />}
      <LivePhotoViewer visible={!!previewLivePhoto} items={previewLivePhoto ? [previewLivePhoto] : []} index={0} onClose={() => setPreviewLivePhoto(null)} />
      </Pressable>
    </View>
  );
}

let _localMessageSequence = 0;

function dedupeMessages(items: ChatMessage[]): ChatMessage[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

function areMessageListsEqual(a: ChatMessage[], b: ChatMessage[]): boolean {
  return a.length === b.length && a.every((message, index) => {
    const other = b[index];
    return other != null
      && message.id === other.id
      && message.from === other.from
      && message.kind === other.kind
      && message.content === other.content
      && message.time === other.time;
  });
}

function ConversationProfileCard({ profile, detailsReady, name, avatarColor, colors, onPress }: { profile: any; detailsReady: boolean; name: string; avatarColor: string; colors: any; onPress: () => void }) {
  const avatar = resolveChatMediaUri(profile?.avatar);
  const gender = profile?.gender === 'male' || profile?.gender === 'female' ? profile.gender : null;
  const age = profile?.age !== null && profile?.age !== undefined && Number.isFinite(Number(profile.age)) ? Number(profile.age) : null;
  return (
    <Pressable onPress={onPress} style={[styles.conversationProfileCard, { backgroundColor: colors.card, borderColor: colors.divider }]}>
      <View style={[styles.conversationProfileAvatar, { backgroundColor: avatarColor }]}>
        {avatar ? <ExpoImage source={cachedImageSource(avatar)} style={styles.conversationProfileAvatarImage} cachePolicy="memory-disk" /> : <Text style={styles.conversationProfileAvatarText}>{name[0]}</Text>}
      </View>
      <View style={styles.conversationProfileMeta}>
        <Text style={[styles.conversationProfileName, { color: colors.text }]} numberOfLines={1}>{name}</Text>
        <View style={styles.conversationProfileDetails}>
          {detailsReady && gender && <GenderSymbol gender={gender} color={gender === 'male' ? '#5BA0D9' : '#F08CB4'} size={16} />}
          {detailsReady && <Text style={[styles.conversationProfileDetailText, { color: colors.textMuted }]}>{age == null ? '年龄未设置' : `${age}岁`}</Text>}
        </View>
      </View>
      <Ionicons name="chevron-forward" size={17} color={colors.textMuted} />
    </Pressable>
  );
}

export default function ChatScreen() {
  const { name, sourcePostId, sourceCommentId, peerUserId, peerAvatar: entryPeerAvatar, peerGender, peerAge, peerProfileReady: entryProfileReady } = useLocalSearchParams<{
    name: string;
    sourcePostId?: string;
    sourceCommentId?: string;
    peerUserId?: string;
    peerAvatar?: string;
    peerGender?: string;
    peerAge?: string;
    peerProfileReady?: string;
  }>();
  const router = useRouter();
  const { isDark, colors } = useTheme();
  const { user, refreshUser } = useAuth();
  const { features } = useCommunityConfig();
  const videoUploadEnabled = features.video_upload === true;
  const { chatEvents, connected, connectionVersion } = useWs();
  const lastProcessedRef = useRef<number | undefined>(undefined);
  const messagesRevisionRef = useRef(0);
  const hiddenMessageIdsRef = useRef(new Set<string>());
  const sourcePostSentRef = useRef('');
  const sourceCommentSentRef = useRef('');
  useStoreVersion();
  const peerName = name || getLastPeerName();
  const activePeerNameRef = useRef(peerName);
  const previousPeerNameRef = useRef(peerName);
  activePeerNameRef.current = peerName;
  useEffect(() => {
    if (name) setLastPeerName(name);
  }, [name]);
  const blocked = isBlocked(peerName);
  const viewerId = String(user?.id || 'guest');
  const messageCacheKey = `${viewerId}:${peerName}`;
  const peerColor = useMemo(() => {
    return conversations.find((c) => c.name === peerName)?.avatarColor ??
      posts.find((p) => p.author === peerName)?.avatarColor ?? '#888780';
  }, [peerName]);

  const cachedMessagesForPeer = chatMessageCache.get(messageCacheKey);
  const [messages, setMessages] = useState<ChatMessage[]>(() => cachedMessagesForPeer || []);
  const [exactMessageTimes, setExactMessageTimes] = useState(false);
  
  // 从消息中提取对方的头像
  const peerAvatar = useMemo(() => {
    const peerMsg = messages.find(m => (m as any).fromAvatar && m.from !== 'me');
    return (peerMsg as any)?.fromAvatar || null;
  }, [messages]);

  const [draft, setDraft] = useState('');
  const [loadingMsgs, setLoadingMsgs] = useState(cachedMessagesForPeer === undefined);
  const [pendingMedia, setPendingMedia] = useState<PendingMedia[]>([]);
  const [sendingImages, setSendingImages] = useState(false);
  const [uploadProgressById, setUploadProgressById] = useState<Record<string, number>>({});
  const [panelOpen, setPanelOpen] = useState(false);
  const [composerPanelHeight, setComposerPanelHeight] = useState(264);
  const [panelTab, setPanelTab] = useState<'emoji' | 'sticker'>('emoji');
  const [stickers, setStickers] = useState<string[]>([]);
  const [selectedSticker, setSelectedSticker] = useState<string | null>(null);
  const [stickerActionAnchor, setStickerActionAnchor] = useState({ x: 0, y: 0 });
  const [stickerActionLoading, setStickerActionLoading] = useState(false);
  const stickerLongPressRef = useRef(false);
  const composerInputRef = useRef<TextInput>(null);
  const keyboardTransitionRef = useRef(false);

  // 从服务端加载表情包（每次进入聊天都加载）
  useEffect(() => {
    getMyStickers().then(urls => {
      if (urls && Array.isArray(urls)) {
        setStickers(urls);
        myStickers.length = 0;
        if (urls.length) myStickers.push(...urls);
      }
    }).catch(() => {});
  }, [peerName]);
  const cachedPeerProfile = chatProfileCache.get(peerUserId || '') || chatProfileCache.get(peerName);
  const entryAge = peerAge !== undefined && peerAge !== '' && Number.isFinite(Number(peerAge)) ? Number(peerAge) : undefined;
  const initialPeerProfile = cachedPeerProfile || (entryPeerAvatar || peerGender || entryAge !== undefined ? {
    id: peerUserId || undefined,
    avatar: entryPeerAvatar || null,
    gender: peerGender || null,
    age: entryAge,
    _chatProfileComplete: entryProfileReady === '1',
  } : null);
  const [peerId, setPeerId] = useState(peerUserId || cachedPeerProfile?.id || '');
  const [peerProfile, setPeerProfile] = useState<any>(initialPeerProfile);
  const [peerProfileDetailsReady, setPeerProfileDetailsReady] = useState(!!initialPeerProfile?._chatProfileComplete);
  const [giftSheetOpen, setGiftSheetOpen] = useState(false);
  const [giftConfirmOpen, setGiftConfirmOpen] = useState(false);
  const [gifting, setGifting] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [conversationImportant, setConversationImportant] = useState(false);
  const [conversationPreferenceSaving, setConversationPreferenceSaving] = useState(false);
  const [reportMenuOpen, setReportMenuOpen] = useState(false);
  const [privateReportReason, setPrivateReportReason] = useState('');
  const [privateReportDetail, setPrivateReportDetail] = useState('');
  const [privateReporting, setPrivateReporting] = useState(false);
  const [actionMessage, setActionMessage] = useState<ChatMessage | null>(null);
  const [messageActionLoading, setMessageActionLoading] = useState(false);
  const [recallError, setRecallError] = useState('');
  const listRef = useRef<FlatList>(null);
  const userAwayFromBottomRef = useRef(false);
  const keyboardShouldPinLatestRef = useRef(false);
  const loadingOlderRef = useRef(false);
  const [hasOlderMessages, setHasOlderMessages] = useState(false);
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);

  useEffect(() => {
    if (previousPeerNameRef.current === peerName) return;
    previousPeerNameRef.current = peerName;
    setDraft('');
    setPendingMedia([]);
    setUploadProgressById({});
    setPanelOpen(false);
    setGiftSheetOpen(false);
    setGiftConfirmOpen(false);
    setMenuOpen(false);
    setActionMessage(null);
  }, [peerName]);
  const sourceContextMessage = useMemo(
    () => messages.find(message => message.kind === 'post_context' || message.kind === 'comment_context') || null,
    [messages],
  );
  const displayMessages = useMemo(() => {
    const toTimestamp = (value: string) => {
      const source = String(value || '').trim();
      const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(source)
        ? source
        : `${source.replace(' ', 'T')}+08:00`;
      const timestamp = Date.parse(normalized);
      return Number.isFinite(timestamp) ? timestamp : 0;
    };
    const regularMessages = messages.filter(message => message.kind !== 'post_context' && message.kind !== 'comment_context');
    const grouped = regularMessages.map((message, index) => {
      if (index === 0) return { message, showTime: true };
      const currentTime = toTimestamp(message.time);
      const previousTime = toTimestamp(regularMessages[index - 1].time);
      return { message, showTime: currentTime <= 0 || previousTime <= 0 || currentTime - previousTime >= 5 * 60 * 1000 };
    });
    return grouped.reverse();
  }, [messages]);

  // 键盘高度（只用于输入框位移，不干扰滚动）
  useEffect(() => {
    if (!peerName) return;
    let cancelled = false;
    const cached = chatProfileCache.get(peerUserId || '') || chatProfileCache.get(peerName);
    if (cached) {
      setPeerProfile(cached);
      setPeerProfileDetailsReady(true);
      if (cached.id) setPeerId(cached.id);
    } else {
      const entryProfile = entryPeerAvatar || peerGender || entryAge !== undefined ? {
        id: peerUserId || undefined,
        avatar: entryPeerAvatar || null,
        gender: peerGender || null,
        age: entryAge,
        _chatProfileComplete: entryProfileReady === '1',
      } : null;
      setPeerId(peerUserId || '');
      setPeerProfile(entryProfile);
      setPeerProfileDetailsReady(!!entryProfile?._chatProfileComplete);
    }
    getUserProfile(peerUserId || peerName).then((p: any) => {
      if (cancelled || !p) return;
      if (p.id) setPeerId(p.id);
      rememberChatProfile(peerName, p);
      setPeerProfile((current: any) => ({ ...current, ...p, _chatProfileComplete: true }));
      setPeerProfileDetailsReady(true);
      if (typeof p?.blocked === 'boolean') setBlocked(peerName, p.blocked);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [entryAge, entryPeerAvatar, entryProfileReady, peerGender, peerName, peerUserId]);

  useEffect(() => {
    if (!peerId) return;
    let cancelled = false;
    getConversationPreference(peerId)
      .then((preference: any) => { if (!cancelled) setConversationImportant(!!preference?.important); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [peerId]);

  const doScroll = (force = false) => {
    if (!force && userAwayFromBottomRef.current) return;
    if (force) userAwayFromBottomRef.current = false;
    // 倒置列表的 offset 0 就是最新消息，不再从历史消息顶部快速滚到底部。
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        listRef.current?.scrollToOffset({ offset: 0, animated: false });
      });
    });
  };

  const openMessageActions = (message: ChatMessage) => {
    if (message.kind === 'system' || message.kind === 'post_context' || message.kind === 'comment_context' || message.id.startsWith('m-')) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setRecallError('');
    setActionMessage(message);
  };

  const deleteMessageForMe = async () => {
    if (!actionMessage || messageActionLoading) return;
    setMessageActionLoading(true);
    try {
      await deletePrivateMessageForMe(actionMessage.id);
      hiddenMessageIdsRef.current.add(actionMessage.id);
      messagesRevisionRef.current += 1;
      setMessages(current => current.filter(message => message.id !== actionMessage.id));
      setActionMessage(null);
    } catch (error) { Alert.alert('删除失败', error instanceof Error ? error.message : '请稍后重试'); }
    finally { setMessageActionLoading(false); }
  };

  const recallMessage = async () => {
    if (!actionMessage || messageActionLoading) return;
    setMessageActionLoading(true);
    try {
      const result = await recallPrivateMessage(actionMessage.id);
      messagesRevisionRef.current += 1;
      setMessages(current => current.map(message => message.id === actionMessage.id ? { ...message, kind: 'system', content: '你刚撤回了一条消息' } : message));
      setActionMessage(null);
    } catch (error) { setRecallError(error instanceof Error ? error.message : '暂时无法撤回，请稍后重试'); }
    finally { setMessageActionLoading(false); }
  };

  const reportSelectedMessage = async (reason: string, detail: string) => {
    if (!actionMessage || messageActionLoading) return;
    setMessageActionLoading(true);
    try {
      await reportPrivateMessage(peerName, reason, detail, actionMessage.id, peerId || undefined);
      setActionMessage(null);
    } catch (error) { Alert.alert('举报失败', error instanceof Error ? error.message : '请稍后重试'); }
    finally { setMessageActionLoading(false); }
  };

  const blockSelectedPeer = async () => {
    if (!peerId || messageActionLoading) return;
    setMessageActionLoading(true);
    try {
      await setUserBlocked(peerId, true);
      setBlocked(peerName, true);
      setActionMessage(null);
    } catch (error) { Alert.alert('拉黑失败', error instanceof Error ? error.message : '请稍后重试'); }
    finally { setMessageActionLoading(false); }
  };

  const confirmChatGift = () => {
    setGiftSheetOpen(false);
    setGiftConfirmOpen(true);
  };

  const handleChatGift = async () => {
    if (gifting) return;
    setGifting(true);
    try {
      const result = await giftFrostShell(peerId, 'chat');
      if (result?.message) {
        messagesRevisionRef.current += 1;
        setMessages(current => dedupeMessages([...current, result.message as ChatMessage]));
        setTimeout(() => doScroll(true), 30);
      }
      await refreshUser();
      setGiftConfirmOpen(false);
    } catch (error) {
      setGiftConfirmOpen(false);
      Alert.alert('赠予失败', error instanceof Error ? error.message : '请稍后重试');
    } finally {
      setGifting(false);
    }
  };

  useEffect(() => {
    const s1 = Keyboard.addListener(Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow', (e) => {
      if (Platform.OS === 'ios') Keyboard.scheduleLayoutAnimation(e);
      setComposerPanelHeight(Math.max(250, Math.min(320, e.endCoordinates.height)));
      if (keyboardTransitionRef.current) {
        keyboardTransitionRef.current = false;
        setPanelOpen(false);
      }
    });
    const s2 = Keyboard.addListener('keyboardDidHide', () => {
      keyboardShouldPinLatestRef.current = false;
    });
    return () => { s1.remove(); s2.remove(); };
  }, []);

  // 加载历史消息
  useEffect(() => {
    if (!peerName) return;
    let cancelled = false;
    userAwayFromBottomRef.current = false;
    keyboardShouldPinLatestRef.current = false;
    loadingOlderRef.current = false;
    // 先显示内存中的最近会话，后台再静默校准服务器状态。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    const cached = chatMessageCache.get(messageCacheKey);
    const revisionAtStart = messagesRevisionRef.current;
    setMessages(cached || []);
    setHasOlderMessages((cached?.length || 0) >= 50);
    setLoadingMsgs(cached === undefined);
    getChatByUsername(peerName, { limit: 50, userId: peerId || peerUserId || undefined }).then(msgs => {
      if (cancelled) return;
      const next = dedupeMessages(msgs || []).filter(message => !hiddenMessageIdsRef.current.has(message.id));
      chatMessageCache.set(messageCacheKey, next);
      setMessages(current => {
        if (revisionAtStart === messagesRevisionRef.current) return areMessageListsEqual(current, next) ? current : next;
        const serverById = new Map(next.map(message => [message.id, message]));
        const currentIds = new Set(current.map(message => message.id));
        return dedupeMessages([
          ...current.filter(message => !hiddenMessageIdsRef.current.has(message.id)).map(message => serverById.get(message.id) || message),
          ...next.filter(message => !currentIds.has(message.id)),
        ]);
      });
      setHasOlderMessages(next.length === 50);
      setLoadingMsgs(false);
    }).catch(() => {
      if (cancelled) return;
      if (cached === undefined) setMessages([]);
      setLoadingMsgs(false);
    });
    return () => { cancelled = true; };
  }, [messageCacheKey, peerId, peerName, peerUserId]);

  useEffect(() => {
    if (!peerName || loadingMsgs) return;
    chatMessageCache.set(messageCacheKey, messages);
  }, [loadingMsgs, messageCacheKey, messages, peerName]);

  const loadOlderMessages = async () => {
    if (!peerName || !hasOlderMessages || loadingOlderRef.current || messages.length === 0) return;
    const requestedPeerName = peerName;
    const oldestServerMessage = messages.find((message) => !message.id.startsWith('m-'));
    if (!oldestServerMessage) return;
    loadingOlderRef.current = true;
    setLoadingOlderMessages(true);
    try {
      const older = dedupeMessages(await getChatByUsername(peerName, { limit: 50, before: oldestServerMessage.id, userId: peerId || peerUserId || undefined }) || []);
      if (activePeerNameRef.current !== requestedPeerName) return;
      setMessages((current) => dedupeMessages([...older, ...current]));
      setHasOlderMessages(older.length === 50);
    } catch {}
    finally {
      loadingOlderRef.current = false;
      setLoadingOlderMessages(false);
    }
  };

  // WebSocket 实时接收
  useEffect(() => {
    const pending = chatEvents.filter(event => (event._seq || 0) > (lastProcessedRef.current || 0));
    if (!pending.length) return;
    lastProcessedRef.current = Math.max(...pending.map(event => event._seq || 0));
    // WebSocket 消息是外部实时事件，收到后应立即同步到当前会话。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    messagesRevisionRef.current += 1;
    setMessages(current => {
      let next = current;
      for (const msg of pending) {
        if (msg.type === 'chat_message_recalled') {
          next = next.map(message => message.id === msg.messageId ? {
            ...message,
            kind: 'system',
            content: message.from === 'other' ? `【${msg.senderName || peerName}】刚撤回了一条消息` : '你刚撤回了一条消息',
          } : message);
          continue;
        }
        const eventPeerId = String(msg.peerId || '');
        const isFromPeer = msg.fromName === peerName || msg.from === peerName;
        const isForCurrentPeer = eventPeerId && peerId
          ? eventPeerId === peerId
          : msg.from === 'me'
            ? !msg.peerName || msg.peerName === peerName
            : isFromPeer;
        if (!isForCurrentPeer) continue;
        if (next.some(message => message.id === msg.id)) continue;
        next = [...next, {
          id: msg.id,
          from: msg.from === 'me' ? 'me' : 'other',
          kind: msg.kind || 'text',
          content: msg.content,
          time: msg.time || nowTime(),
        }];
      }
      return dedupeMessages(next);
    });
    setTimeout(() => doScroll(), 30);
  }, [chatEvents, peerId, peerName]);

  // WebSocket 断线时轮询兜底，在线时只依赖实时事件。
  useEffect(() => {
    if (!peerName || connected) return;
    let cancelled = false;
    const syncMessages = async () => {
      try {
        const serverMsgs = await getChatByUsername(peerName, { limit: 50, userId: peerId || peerUserId || undefined });
        if (cancelled || activePeerNameRef.current !== peerName || !serverMsgs?.length) return;
        setMessages(prev => {
          const next = dedupeMessages([...prev, ...serverMsgs]);
          return areMessageListsEqual(prev, next) ? prev : next;
        });
      } catch {}
    };
    syncMessages();
    const t = setInterval(syncMessages, 5000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [connected, peerId, peerName, peerUserId]);

  useEffect(() => {
    if (connectionVersion <= 1 || !peerName) return;
    let cancelled = false;
    getChatByUsername(peerName, { limit: 50, userId: peerId || peerUserId || undefined }).then(serverMsgs => {
      if (cancelled || activePeerNameRef.current !== peerName) return;
      setMessages(prev => {
        const next = dedupeMessages([...prev, ...(serverMsgs || [])]);
        return areMessageListsEqual(prev, next) ? prev : next;
      });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [connectionVersion, peerId, peerName, peerUserId]);

  const send = async (kind: 'text' | 'sticker' | 'image' | 'video' | 'live_photo', content: string, mediaId?: string | null): Promise<boolean> => {
    const sendingPeerName = peerName;
    const sendingPeerId = peerId || peerUserId || undefined;
    let sendContent = content;
    let sendMediaId = mediaId;
    const mediaAlreadyUploaded = /^(https?:\/\/|\/uploads\/)/i.test(sendContent) || (kind === 'live_photo' && sendContent.trim().startsWith('{'));
    if ((kind === 'image' || kind === 'video' || kind === 'live_photo') && !mediaAlreadyUploaded) {
      try {
        const uploaded = await uploadFile(sendContent, kind === 'image' ? 'm' : 'vm');
        sendContent = uploaded.url;
        sendMediaId = uploaded.mediaId;
      } catch (error) {
        Alert.alert('图片发送失败', error instanceof Error ? error.message : '请检查网络后重试');
        return false;
      }
    }
    // 只在用户触发发送时生成乐观消息 ID，不参与渲染结果计算。
    // eslint-disable-next-line react-hooks/purity
    const optimisticId = `m-${Date.now()}-${++_localMessageSequence}`;
    const localMsg: ChatMessage = { id: optimisticId, clientId: optimisticId, from: 'me', kind, content: sendContent, time: nowTime() };
    messagesRevisionRef.current += 1;
    setMessages(prev => dedupeMessages([...prev, localMsg]));
    // 乐观消息渲染后立刻滚到底
    setTimeout(() => doScroll(true), 30);

    try {
      const result = await apiSendMessage(sendingPeerName, sendContent, kind, sendMediaId, sendingPeerId);
      if (result?.id) {
        if (activePeerNameRef.current !== sendingPeerName) return true;
        setMessages(prev => dedupeMessages(
          prev.map(m => m.id === optimisticId ? { ...m, id: result.id, content: result.content ?? m.content, time: result.time ?? m.time } : m),
        ));
      }
      setTimeout(() => doScroll(true), 50);
      return true;
    } catch (e) {
      console.log('发送失败', e);
      if (activePeerNameRef.current !== sendingPeerName) return false;
      setMessages(prev => prev.filter(message => message.id !== optimisticId));
      if (kind === 'image' || kind === 'video' || kind === 'live_photo') Alert.alert('媒体发送失败', e instanceof Error ? e.message : '请检查网络后重试');
      return false;
    }
  };

  const toggleConversationFavorite = async (nextValue: boolean) => {
    if (!peerId || conversationPreferenceSaving) return;
    const previousValue = conversationImportant;
    setConversationImportant(nextValue);
    setConversationPreferenceSaving(true);
    try {
      const preference: any = await setConversationPreference(peerId, { important: nextValue });
      setConversationImportant(!!preference?.important);
    } catch (error) {
      setConversationImportant(previousValue);
      Alert.alert('操作失败', error instanceof Error ? error.message : '请稍后重试');
    } finally {
      setConversationPreferenceSaving(false);
    }
  };

  const sendPendingMedia = async (media: PendingMedia): Promise<boolean> => {
    const sendingPeerName = peerName;
    const sendingPeerId = peerId || peerUserId || undefined;
    // The local message is inserted before upload so slow videos have an immediate, visible destination.
    // eslint-disable-next-line react-hooks/purity
    const optimisticId = `m-upload-${Date.now()}-${++_localMessageSequence}`;
    const initialKind: ChatMessage['kind'] = media.kind === 'video' ? 'video' : media.kind === 'live_photo' ? 'live_photo' : 'image';
    const initialContent = media.kind === 'live_photo'
      ? JSON.stringify({ stillUrl: media.stillUri || media.uri, motionUrl: media.motionUri || media.uri })
      : media.uri;
    const localMsg: ChatMessage = {
      id: optimisticId,
      clientId: optimisticId,
      localPreviewUri: media.stillUri || media.uri,
      localPreviewSize: media.width && media.height ? { width: media.width, height: media.height } : undefined,
      from: 'me',
      kind: initialKind,
      content: initialContent,
      time: nowTime(),
    };
    messagesRevisionRef.current += 1;
    setMessages(current => dedupeMessages([...current, localMsg]));
    setUploadProgressById(current => ({ ...current, [optimisticId]: 0 }));
    setTimeout(() => doScroll(true), 30);

    const setProgress = (value: number) => {
      if (activePeerNameRef.current !== sendingPeerName) return;
      setUploadProgressById(current => ({ ...current, [optimisticId]: value }));
    };
    let finalKind: 'image' | 'video' | 'live_photo' = initialKind as 'image' | 'video' | 'live_photo';
    let content = initialContent;
    let mediaId: string | null | undefined;
    try {
      if (media.kind === 'live_photo' && media.motionUri) {
        const uploaded = await uploadPairedLivePhoto(media.stillUri || media.uri, media.motionUri, 'message', setProgress);
        content = JSON.stringify({ motionUrl: uploaded.motionUrl, stillUrl: uploaded.stillUrl });
        mediaId = uploaded.mediaId;
      } else if (media.kind === 'android_motion_candidate') {
        try {
          const motion = await uploadMotionPhoto(media.uri, 'message', setProgress);
          finalKind = 'live_photo';
          content = JSON.stringify({ motionUrl: motion.motionUrl, stillUrl: motion.stillUrl });
          mediaId = motion.mediaId;
        } catch (error) {
          if (!isNotMotionPhotoError(error)) throw error;
          setProgress(0);
          const image = await uploadFile(media.uri, 'm', setProgress);
          finalKind = 'image';
          content = image.url;
          mediaId = image.mediaId;
        }
      } else {
        const uploaded = await uploadFile(media.uri, media.kind === 'video' ? 'vm' : 'm', setProgress);
        content = uploaded.url;
        mediaId = uploaded.mediaId;
      }

      setProgress(1);
      const result = await apiSendMessage(sendingPeerName, content, finalKind, mediaId, sendingPeerId);
      if (activePeerNameRef.current !== sendingPeerName) return true;
      setMessages(current => dedupeMessages(current.map(message => message.id === optimisticId ? {
        ...message,
        id: result?.id || message.id,
        kind: result?.kind || finalKind,
        content: result?.content ?? content,
        time: result?.time ?? message.time,
      } : message)));
      setUploadProgressById(current => {
        const next = { ...current };
        delete next[optimisticId];
        return next;
      });
      return true;
    } catch (error) {
      if (activePeerNameRef.current !== sendingPeerName) return false;
      setMessages(current => current.filter(message => message.id !== optimisticId));
      setUploadProgressById(current => {
        const next = { ...current };
        delete next[optimisticId];
        return next;
      });
      Alert.alert('媒体发送失败', error instanceof Error ? error.message : '请检查网络后重试');
      return false;
    }
  };

  const sendText = async () => {
    if (sendingImages) return;
    const sendingPeerName = peerName;
    const text = draft.trim();
    setPanelOpen(false);
    if (pendingMedia.length > 0) {
      const selectedMedia = [...pendingMedia];
      setPendingMedia([]);
      setSendingImages(true);
      try {
        const failedMedia: PendingMedia[] = [];
        for (const media of selectedMedia) {
          if (!(await sendPendingMedia(media))) failedMedia.push(media);
        }
        if (activePeerNameRef.current === sendingPeerName) {
          setPendingMedia(current => [...failedMedia, ...current].slice(0, 9));
          if (failedMedia.length === 0) setDraft('');
        }
      } finally {
        setSendingImages(false);
      }
      return;
    }
    if (!text) return;
    setDraft('');
    if (!(await send('text', text)) && activePeerNameRef.current === sendingPeerName) setDraft(current => current || text);
  };

  useEffect(() => {
    if (!sourcePostId || !peerName || !peerId || loadingMsgs) return;
    let cancelled = false;
    const sourceKey = `${peerName}:${sourcePostId}`;
    if (sourcePostSentRef.current === sourceKey) return;
    sourcePostSentRef.current = sourceKey;
    apiSendMessage(peerName, JSON.stringify({ postId: sourcePostId }), 'post_context', undefined, peerId)
      .then((result) => {
        if (cancelled || activePeerNameRef.current !== peerName || !result?.id) return;
        setMessages(current => dedupeMessages([...current, {
          id: result.id,
          from: 'me',
          kind: 'post_context',
          content: result.content,
          time: result.time,
        }]));
        setTimeout(() => doScroll(true), 30);
      })
      .catch((error) => {
        if (cancelled || activePeerNameRef.current !== peerName) return;
        sourcePostSentRef.current = '';
        Alert.alert('无法附带切片', error instanceof Error ? error.message : '请稍后重试');
      });
    return () => { cancelled = true; };
  }, [loadingMsgs, peerId, peerName, sourcePostId]);

  useEffect(() => {
    if (!sourceCommentId || !peerName || !peerId || loadingMsgs) return;
    let cancelled = false;
    const sourceKey = `${peerName}:${sourceCommentId}`;
    if (sourceCommentSentRef.current === sourceKey) return;
    sourceCommentSentRef.current = sourceKey;
    apiSendMessage(peerName, JSON.stringify({ commentId: sourceCommentId }), 'comment_context', undefined, peerId)
      .then((result) => {
        if (cancelled || activePeerNameRef.current !== peerName || !result?.id) return;
        setMessages(current => dedupeMessages([...current, {
          id: result.id,
          from: 'me',
          kind: 'comment_context',
          content: result.content,
          time: result.time,
        }]));
        setTimeout(() => doScroll(true), 30);
      })
      .catch((error) => {
        if (cancelled || activePeerNameRef.current !== peerName) return;
        sourceCommentSentRef.current = '';
        Alert.alert('无法附带评论', error instanceof Error ? error.message : '请稍后重试');
      });
    return () => { cancelled = true; };
  }, [loadingMsgs, peerId, peerName, sourceCommentId]);

  const toggleComposerPanel = () => {
    if (panelOpen) {
      keyboardTransitionRef.current = true;
      composerInputRef.current?.focus();
      return;
    }
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    composerInputRef.current?.blur();
    Keyboard.dismiss();
    setPanelOpen(true);
  };

  const addSticker = async () => {
    try {
      const result = await launchImageLibrarySafely({
        mediaTypes: ['images'],
        allowsEditing: false,
        quality: 1,
      });
      if (!result.canceled && result.assets?.[0]) {
        const asset = result.assets[0];
        const uploaded = await uploadFile(asset.uri, 's', undefined, { mimeType: asset.mimeType });
        await addStickerUrl(uploaded.url);
        await primeUploadedImageCache(asset.uri, uploaded.url);
        const next = myStickers.includes(uploaded.url) ? [...myStickers] : [...myStickers, uploaded.url];
        myStickers.splice(0, myStickers.length, ...next);
        setStickers(next);
      }
    } catch (e: any) {
      Alert.alert('添加失败', e?.message || '请重试');
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
    void send('sticker', uri);
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

  const saveStickerFn = (uri: string) => {
    if (!myStickers.includes(uri)) {
      myStickers.push(uri);
      setStickers([...myStickers]);
    }
  };

  const sendImage = async () => {
    let targetId = peerId;
    try {
      if (!targetId) {
        const latestProfile = await getUserProfile(peerName);
        targetId = latestProfile.id;
        setPeerId(latestProfile.id);
        setPeerProfile(latestProfile);
      }
      const relationship = await getFollowStatus(targetId);
      setPeerProfile((current: any) => ({ ...current, ...relationship }));
      if (!relationship.mutuallyFollowing) {
        Alert.alert('无法发送', '需要互相关注后才能发送图片');
        return;
      }
    } catch {
      Alert.alert('暂时无法确认关注状态', '请检查网络后重试');
      return;
    }
    if (!targetId) {
      Alert.alert('无法发送', '需要互相关注后才能发送图片');
      return;
    }
    const remaining = 9 - pendingMedia.length;
    if (remaining <= 0) { Alert.alert('最多选择9张图片'); return; }
    const result = await launchImageLibrarySafely({
      mediaTypes: ['images', 'livePhotos'],
      // iOS only exposes the paired motion asset reliably for single picks.
      // Users can repeat the action to queue up to nine Live Photos.
      allowsMultipleSelection: Platform.OS === 'android',
      selectionLimit: Platform.OS === 'android' ? remaining : 1,
      quality: Platform.OS === 'android' ? 1 : 0.75,
      exif: true,
    });
    if (!result.canceled && result.assets.length > 0) {
      const selectedAssets = result.assets.slice(0, remaining);
      for (const asset of selectedAssets) {
        if (!asset.pairedVideoAsset?.uri) continue;
        const validationError = await validatePickedVideo(asset.pairedVideoAsset, { livePhoto: true });
        if (validationError) { Alert.alert('无法添加实况照片', validationError); return; }
      }
      const pickedAt = Date.now();
      const queued = selectedAssets.map((asset, index): PendingMedia => asset.pairedVideoAsset?.uri ? {
        id: `pending-${pickedAt}-${index}`,
        kind: 'live_photo',
        uri: asset.uri,
        stillUri: asset.uri,
        motionUri: asset.pairedVideoAsset.uri,
        width: asset.width,
        height: asset.height,
      } : {
        id: `pending-${pickedAt}-${index}`,
        kind: Platform.OS === 'android' ? 'android_motion_candidate' : 'image',
        uri: asset.uri,
        width: asset.width,
        height: asset.height,
      });
      setPendingMedia(current => [...current, ...queued].slice(0, 9));
    }
  };

  const sendVideo = async () => {
    if (sendingImages) return;
    try {
      const result = await launchImageLibrarySafely({ mediaTypes: ['videos'], allowsMultipleSelection: false, quality: 0.8 });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      const paired = asset.pairedVideoAsset;
      const validationError = await validatePickedVideo(paired || asset, { livePhoto: Boolean(paired) });
      if (validationError) { Alert.alert(paired ? '无法添加实况照片' : '无法添加视频', validationError); return; }
      const queued: PendingMedia = paired ? {
        id: `pending-${Date.now()}`,
        kind: 'live_photo',
        uri: asset.uri,
        stillUri: asset.uri,
        motionUri: paired.uri,
        width: asset.width,
        height: asset.height,
      } : {
        id: `pending-${Date.now()}`,
        kind: 'video',
        uri: asset.uri,
        width: asset.width,
        height: asset.height,
      };
      setPendingMedia(current => [...current, queued].slice(0, 9));
    } catch (error) {
      Alert.alert('媒体选择失败', error instanceof Error ? error.message : '请重试');
    }
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.bg }}>
      <ScreenHeader
        title={peerName}
        floating
        center={
          <View style={styles.chatHeaderIdentity}>
            <View style={[styles.chatHeaderAvatar, { backgroundColor: peerColor }]}>
              {(peerProfile?.avatar || peerAvatar) ? <ExpoImage source={cachedImageSource(resolveChatMediaUri(peerProfile?.avatar || peerAvatar))} style={styles.chatHeaderAvatarImage} cachePolicy="memory-disk" /> : <Text style={styles.chatHeaderAvatarText}>{peerName[0]}</Text>}
            </View>
            <Text style={[styles.chatHeaderName, { color: colors.accent }]} numberOfLines={1}>{peerName}</Text>
          </View>
        }
        onTitlePress={() => router.push({ pathname: '/user/[name]', params: { name: peerName, userId: peerId } })}
        right={
          <Pressable onPress={() => setMenuOpen(true)} hitSlop={8} style={{ padding: 4 }}>
            <Ionicons name="ellipsis-horizontal" size={20} color={colors.textMuted} />
          </Pressable>
        }
      />
      <View style={{ height: 1, backgroundColor: '#33A9DC' + '20', marginHorizontal: 14 }} />
      <Modal visible={giftSheetOpen} transparent animationType="fade" onRequestClose={() => setGiftSheetOpen(false)}>
        <Pressable style={styles.giftOverlay} onPress={() => setGiftSheetOpen(false)}>
          <Pressable style={[styles.giftCard, { backgroundColor: colors.card }]} onPress={(event) => event.stopPropagation()}>
            <Pressable onPress={() => { setGiftSheetOpen(false); router.push({ pathname: '/user/[name]', params: { name: peerName, userId: peerId } }); }}>
              <View style={[styles.giftAvatar, { backgroundColor: peerColor }]}>
                {(peerProfile?.avatar || peerAvatar) ? (
                  <ExpoImage source={cachedImageSource(resolveChatMediaUri(peerProfile?.avatar || peerAvatar))} style={styles.giftAvatarImage} cachePolicy="disk" />
                ) : (
                  <Text style={styles.giftAvatarText}>{peerName[0]}</Text>
                )}
              </View>
            </Pressable>
            <View style={styles.giftNameRow}>
              <Text style={[styles.giftName, { color: colors.text }]}>{peerName}</Text>
              {(peerProfile?.gender === 'male' || peerProfile?.gender === 'female' || peerGender === 'male' || peerGender === 'female') && (
                <GenderSymbol
                  gender={(peerProfile?.gender === 'male' || peerProfile?.gender === 'female') ? peerProfile.gender : peerGender as 'male' | 'female'}
                  color={((peerProfile?.gender || peerGender) === 'male') ? '#5BA0D9' : '#F08CB4'}
                  size={16}
                />
              )}
            </View>
            <Pressable style={styles.giftButton} onPress={confirmChatGift}>
              <FrostShellIcon size={20} color="#FFFFFF" cracked />
              <Text style={styles.giftButtonText}>赠予浮霜贝</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
      <ConfirmModal
        visible={giftConfirmOpen}
        title="赠予浮霜贝"
        message={`确定赠予 ${peerName} 1 枚脆弱浮霜贝吗？`}
        confirmText="确认赠予"
        tone="accent"
        iconContent={<FrostShellIcon size={25} color={colors.accent} cracked />}
        loading={gifting}
        onCancel={() => setGiftConfirmOpen(false)}
        onConfirm={handleChatGift}
      />
      {/* 三点菜单 — 全屏页面 */}
      <Modal visible={menuOpen} transparent presentationStyle="overFullScreen" animationType="slide" onRequestClose={() => setMenuOpen(false)}>
        <View style={{ flex: 1, backgroundColor: colors.bg }}>
          <ScreenHeader title="聊天设置" floating onBack={() => setMenuOpen(false)} />
          <View style={{ flex: 1, padding: 14 }}>
            <View style={[styles.menuBtn, { backgroundColor: colors.card }]}>
              <Ionicons name={conversationImportant ? 'bookmark' : 'bookmark-outline'} size={20} color={colors.accent} />
              <Text style={[styles.menuBtnText, { color: colors.text }]}>收藏对话</Text>
              <Switch
                value={conversationImportant}
                disabled={!peerId}
                onValueChange={toggleConversationFavorite}
                trackColor={{ false: '#D5D8E2', true: colors.accent }}
                thumbColor="#FFFFFF"
              />
            </View>
            <View style={{ height: 8 }} />
            <Pressable style={[styles.menuBtn, { backgroundColor: colors.card }]} onPress={() => {
              setMenuOpen(false);
              setReportMenuOpen(true);
            }}>
              <Ionicons name="flag-outline" size={20} color={colors.text} />
              <Text style={[styles.menuBtnText, { color: colors.text }]}>举报私信</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
            </Pressable>
            <View style={{ height: 8 }} />
            <Pressable style={[styles.menuBtn, { backgroundColor: colors.card }]} onPress={async () => {
              if (!peerId) return;
              try {
                await setUserBlocked(peerId, !blocked);
                setBlocked(peerName, !blocked);
                setMenuOpen(false);
              } catch (error) {
                Alert.alert('操作失败', error instanceof Error ? error.message : '请稍后重试');
              }
            }}>
              <Ionicons name="ban-outline" size={20} color="#E84393" />
              <Text style={[styles.menuBtnText, { color: '#E84393' }]}>{blocked ? '取消拉黑' : '拉黑用户'}</Text>
              <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
            </Pressable>
          </View>
        </View>
      </Modal>
      <Modal visible={reportMenuOpen} animationType="slide" onRequestClose={() => setReportMenuOpen(false)}>
        <View style={{ flex: 1, backgroundColor: colors.bg }}>
          <ScreenHeader title="举报私信" floating />
          <ScrollView contentContainerStyle={{ padding: 14 }} keyboardShouldPersistTaps="handled">
            <Text style={{ color: colors.textMuted, fontSize: 13, lineHeight: 20, marginBottom: 12 }}>
              请选择举报原因，系统会提交双方最近的20条聊天记录进行核查。
            </Text>
            {PRIVATE_MESSAGE_REPORT_REASONS.map((reason) => (
              <Pressable
                key={reason}
                style={[styles.menuBtn, { backgroundColor: colors.card, borderWidth: 1, borderColor: privateReportReason === reason ? colors.accent : 'transparent', marginBottom: 8 }]}
                onPress={() => setPrivateReportReason(reason)}
              >
                <Text style={[styles.menuBtnText, { color: privateReportReason === reason ? colors.accent : colors.text }]}>{reason}</Text>
                {privateReportReason === reason && <Ionicons name="checkmark-circle" size={18} color={colors.accent} />}
              </Pressable>
            ))}
            <TextInput
              value={privateReportDetail}
              onChangeText={setPrivateReportDetail}
              multiline
              maxLength={500}
              placeholder={privateReportReason === '其他' ? '请填写举报理由（必填）' : '补充说明（选填）'}
              placeholderTextColor={colors.textMuted}
              style={{ minHeight: 92, color: colors.text, backgroundColor: colors.card, borderColor: colors.divider, borderWidth: 1, borderRadius: 12, padding: 12, marginTop: 4, textAlignVertical: 'top' }}
            />
            <Pressable
              disabled={!privateReportReason || (privateReportReason === '其他' && !privateReportDetail.trim()) || privateReporting}
              style={{ minHeight: 46, borderRadius: 13, alignItems: 'center', justifyContent: 'center', marginTop: 14, backgroundColor: privateReportReason && (privateReportReason !== '其他' || privateReportDetail.trim()) ? colors.accent : colors.divider }}
              onPress={async () => {
                setPrivateReporting(true);
                try {
                  await reportPrivateMessage(peerName, privateReportReason, privateReportDetail.trim(), undefined, peerId || undefined);
                  setReportMenuOpen(false);
                  setPrivateReportReason('');
                  setPrivateReportDetail('');
                  Alert.alert('已举报', '举报已提交，我们会尽快处理。');
                } catch (e: any) {
                  Alert.alert('提交失败', e?.message || '请稍后重试');
                } finally {
                  setPrivateReporting(false);
                }
              }}
            >
              {privateReporting ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Text style={{ color: '#FFFFFF', fontSize: 15, fontWeight: '700' }}>提交举报</Text>}
            </Pressable>
            <Pressable style={{ alignItems: 'center', paddingVertical: 15 }} onPress={() => { setReportMenuOpen(false); setPrivateReportReason(''); setPrivateReportDetail(''); }}><Text style={{ color: colors.textMuted }}>取消</Text></Pressable>
          </ScrollView>
        </View>
      </Modal>
      <MessageActionModal
        visible={!!actionMessage}
        mode={actionMessage?.from === 'me' ? 'self' : 'other'}
        loading={messageActionLoading}
        onClose={() => setActionMessage(null)}
        onReport={reportSelectedMessage}
        onBlock={blockSelectedPeer}
        onDelete={deleteMessageForMe}
        onRecall={recallMessage}
        recallError={recallError}
      />
      <StickerActionsModal
        visible={!!selectedSticker}
        anchor={stickerActionAnchor}
        previewUri={selectedSticker}
        loading={stickerActionLoading}
        onClose={() => setSelectedSticker(null)}
        onMoveToFront={handleMoveStickerToFront}
        onDelete={handleDeleteSticker}
      />
      <KeyboardInsetView>
      <FlatList
        ref={listRef}
        data={displayMessages}
        inverted
        keyExtractor={(item) => item.message.clientId || item.message.id}
        initialNumToRender={18}
        maxToRenderPerBatch={12}
        windowSize={7}
        removeClippedSubviews={false}
        maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
        renderItem={({ item }) => <Bubble msg={item.message} showTime={item.showTime} exactTimes={exactMessageTimes} onToggleTimes={() => setExactMessageTimes(current => !current)} peerName={peerName} peerColor={peerColor} peerAvatar={peerProfile?.avatar || peerAvatar} isDark={isDark} myAvatar={user?.avatar} myName={user?.nickname || user?.username} onMessageLongPress={openMessageActions} onPeerAvatarPress={() => setGiftSheetOpen(true)} uploadProgress={uploadProgressById[item.message.clientId || item.message.id]} />}
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 14, paddingBottom: 8, flexGrow: 1, justifyContent: 'flex-end' }}
        showsVerticalScrollIndicator={false}
        onLayout={() => {
          if (keyboardShouldPinLatestRef.current) doScroll(true);
        }}
        onScroll={({ nativeEvent }) => {
          userAwayFromBottomRef.current = Math.max(0, nativeEvent.contentOffset.y) > 56;
        }}
        scrollEventThrottle={16}
        onEndReached={loadOlderMessages}
        onEndReachedThreshold={0.35}
        ListFooterComponent={
          <View style={styles.conversationTopMatter}>
            {loadingOlderMessages && <ActivityIndicator size="small" color="#33A9DC" style={{ marginVertical: 14 }} />}
            <ConversationProfileCard
              profile={peerProfile}
              detailsReady={peerProfileDetailsReady}
              name={peerName}
              avatarColor={peerColor}
              colors={colors}
              onPress={() => router.push({ pathname: '/user/[name]', params: { name: peerName, userId: peerId } })}
            />
            {sourceContextMessage && (
              <Bubble
                msg={sourceContextMessage}
                showTime={false}
                exactTimes={false}
                onToggleTimes={() => {}}
                peerName={peerName}
                peerColor={peerColor}
                peerAvatar={peerProfile?.avatar || peerAvatar}
                isDark={isDark}
                myAvatar={user?.avatar}
                myName={user?.nickname || user?.username}
              />
            )}
            {!loadingMsgs && displayMessages.length === 0 ? <Text style={styles.emptyTip}>还没有聊天记录，打个招呼吧</Text> : null}
          </View>
        }
        ListEmptyComponent={
          loadingMsgs ? <ActivityIndicator size="large" color="#33A9DC" style={{ marginTop: 60 }} /> : null
        }
      />

      <View>
        {blocked ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: colors.card, paddingVertical: 16, borderTopWidth: 1, borderTopColor: colors.divider }}>
            <Ionicons name="ban-outline" size={16} color="#9AA0B4" />
            <Text style={{ fontSize: 13, color: colors.textMuted, marginLeft: 6 }}>你已拉黑对方，无法发送消息</Text>
          </View>
        ) : (
        <View>
        {pendingMedia.length > 0 && (
          <View style={{ backgroundColor: colors.card, paddingHorizontal: 12, paddingTop: 8, flexDirection: 'row', flexWrap: 'wrap' }}>
            {pendingMedia.map((media, i) => (
              <View key={media.id} style={{ width: 56, height: 56, marginRight: 6, marginBottom: 6, borderRadius: 8, overflow: 'visible' }}>
                <ExpoImage source={{ uri: media.stillUri || media.uri }} style={{ width: 56, height: 56, borderRadius: 8, backgroundColor: colors.input }} contentFit="cover" cachePolicy="disk" />
                {(media.kind === 'video' || media.kind === 'live_photo' || media.kind === 'android_motion_candidate') && <View pointerEvents="none" style={{ position: 'absolute', left: 4, bottom: 4, width: 19, height: 19, borderRadius: 10, backgroundColor: '#101820B8', alignItems: 'center', justifyContent: 'center' }}><Ionicons name={media.kind === 'video' ? 'videocam' : 'aperture'} size={12} color="#FFFFFF" /></View>}
                <Pressable onPress={() => setPendingMedia((current) => current.filter(item => item.id !== media.id))} style={{ position: 'absolute', top: -6, right: -6, backgroundColor: '#1A1D26', borderRadius: 10 }}>
                  <Ionicons name="close-circle" size={16} color="#FFFFFF" />
                </Pressable>
              </View>
            ))}
          </View>
        )}
        <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: colors.card, paddingHorizontal: 10, paddingVertical: 8, borderTopWidth: 1, borderTopColor: colors.divider }}>
          {isNativeLiquidGlassEnabled ? <NativeLiquidGlassView glassEffectStyle="regular" colorScheme={isDark ? 'dark' : 'light'} isInteractive style={styles.glassComposerIcon}>
            <Pressable onPress={toggleComposerPanel} style={styles.composerGlassPressable}>
              {panelOpen ? <MaterialCommunityIcons name="keyboard-outline" size={26} color="#33A9DC" /> : <Ionicons name="happy-outline" size={26} color="#6B7185" />}
            </Pressable>
          </NativeLiquidGlassView> : <Pressable onPress={toggleComposerPanel} style={styles.emojiBtn}>
              {panelOpen ? <MaterialCommunityIcons name="keyboard-outline" size={26} color="#33A9DC" /> : <Ionicons name="happy-outline" size={26} color="#6B7185" />}
          </Pressable>}
          {isNativeLiquidGlassEnabled ? <NativeLiquidGlassView glassEffectStyle="regular" colorScheme={isDark ? 'dark' : 'light'} isInteractive style={styles.glassComposerIcon}>
            <Pressable onPress={sendImage} style={styles.composerGlassPressable}>
              <Ionicons name="image-outline" size={24} color="#6B7185" />
            </Pressable>
          </NativeLiquidGlassView> : <Pressable onPress={sendImage} style={{ padding: 6, marginRight: 4 }}>
              <Ionicons name="image-outline" size={24} color="#6B7185" />
          </Pressable>}
          {videoUploadEnabled ? <Pressable onPress={sendVideo} disabled={sendingImages} style={{ padding: 6, marginRight: 4 }}>
            {sendingImages ? <ActivityIndicator size="small" color="#33A9DC" /> : <Ionicons name="videocam-outline" size={24} color="#6B7185" />}
          </Pressable> : null}
          {isNativeLiquidGlassEnabled ? <NativeLiquidGlassView glassEffectStyle="regular" colorScheme={isDark ? 'dark' : 'light'} style={styles.glassComposerInput}>
            <TextInput
              ref={composerInputRef}
              style={[styles.composerInput, { color: colors.text }]}
              placeholder="发消息……"
              placeholderTextColor="#9AA0B4"
              value={draft}
              onChangeText={setDraft}
              onSubmitEditing={sendText}
              onFocus={() => {
                if (panelOpen) keyboardTransitionRef.current = true;
                keyboardShouldPinLatestRef.current = !userAwayFromBottomRef.current;
              }}
              onBlur={() => { keyboardShouldPinLatestRef.current = false; }}
            />
          </NativeLiquidGlassView> : <TextInput
            ref={composerInputRef}
            style={{ flex: 1, backgroundColor: colors.input, borderRadius: 18, paddingHorizontal: 14, paddingVertical: 8, fontSize: 14, color: colors.text }}
            placeholder="发消息……"
            placeholderTextColor="#9AA0B4"
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={sendText}
            onFocus={() => {
              if (panelOpen) {
                keyboardTransitionRef.current = true;
              }
              keyboardShouldPinLatestRef.current = !userAwayFromBottomRef.current;
            }}
            onBlur={() => {
              keyboardShouldPinLatestRef.current = false;
            }}
          />}
          {isNativeLiquidGlassEnabled ? <NativeLiquidGlassView glassEffectStyle="regular" colorScheme={isDark ? 'dark' : 'light'} isInteractive style={[styles.glassSendBtn, ((!draft.trim() && pendingMedia.length === 0) || sendingImages) && styles.glassSendDisabled]}>
            <Pressable style={styles.composerGlassPressable} disabled={(!draft.trim() && pendingMedia.length === 0) || sendingImages} onPress={sendText}>
              {sendingImages ? <ActivityIndicator size="small" color={colors.accent} /> : <Ionicons name="arrow-up" size={18} color={draft.trim() || pendingMedia.length > 0 ? colors.accent : colors.textMuted} />}
            </Pressable>
          </NativeLiquidGlassView> : <Pressable
            style={[styles.sendBtn, ((!draft.trim() && pendingMedia.length === 0) || sendingImages) && { backgroundColor: '#C4C8D4' }]}
            disabled={(!draft.trim() && pendingMedia.length === 0) || sendingImages}
            onPress={sendText}
          >
            {sendingImages ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Ionicons name="arrow-up" size={18} color={draft.trim() || pendingMedia.length > 0 ? '#FFFFFF' : '#7F8796'} />}
          </Pressable>}
        </View>
        </View>
        )}
        {panelOpen && !blocked && (
          <View style={{ height: composerPanelHeight, overflow: 'hidden', backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.divider }}>
            <View style={{ flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.divider }}>
              <Pressable style={{ flex: 1, alignItems: 'center', paddingVertical: 10, borderBottomWidth: 2, borderBottomColor: panelTab === 'emoji' ? '#33A9DC' : 'transparent' }} onPress={() => setPanelTab('emoji')}>
                <Ionicons name="happy-outline" size={20} color={panelTab === 'emoji' ? '#33A9DC' : '#9AA0B4'} />
              </Pressable>
              <Pressable style={{ flex: 1, alignItems: 'center', paddingVertical: 10, borderBottomWidth: 2, borderBottomColor: panelTab === 'sticker' ? '#33A9DC' : 'transparent' }} onPress={() => setPanelTab('sticker')}>
                <Ionicons name="heart-outline" size={20} color={panelTab === 'sticker' ? '#33A9DC' : '#9AA0B4'} />
              </Pressable>
            </View>
            {panelTab === 'emoji' ? (
              <EmojiPicker onSelect={(emoji) => setDraft((previous: string) => previous + emoji)} />
            ) : (
              <ScrollView
                style={{ maxHeight: 180 }}
                contentContainerStyle={{ padding: 14 }}
                keyboardDismissMode="none"
                keyboardShouldPersistTaps="always"
              >
                <View style={styles.stickerGrid}>
                  {stickers.length === 0 && (
                    <Text style={{ color: '#9AA0B4', fontSize: 13, paddingVertical: 30, textAlign: 'center', width: '100%' }}>点击左下角 + 按钮，从相册上传表情包</Text>
                  )}
                  {stickers.map((uri) => (
                    <Pressable key={uri} onPress={() => sendStickerFromPanel(uri)} onLongPress={(event) => openStickerActions(uri, event.nativeEvent.pageX, event.nativeEvent.pageY)} delayLongPress={450}>
                      <ExpoImage source={cachedImageSource(uri)} recyclingKey={stableMediaCacheKey(uri)} style={[styles.stickerThumb, { width: STICKER_CELL_SIZE, height: STICKER_CELL_SIZE }]} contentFit="contain" cachePolicy="memory-disk" autoplay transition={0} />
                    </Pressable>
                  ))}
                  <Pressable style={[styles.addStickerBase, { width: STICKER_CELL_SIZE, height: STICKER_CELL_SIZE, borderColor: colors.textMuted + '40', backgroundColor: colors.input }]} onPress={addSticker}>
                    <Ionicons name="add" size={26} color="#9AA0B4" />
                  </Pressable>
                </View>
              </ScrollView>
            )}
          </View>
        )}
      </View>
      </KeyboardInsetView>
    </View>
  );
}

function nowTime() {
  return new Date().toISOString();
}

const styles = StyleSheet.create({
  messageItem: { width: '100%' },
  messageTimestampPressable: { alignSelf: 'center', minHeight: 24, justifyContent: 'center', paddingHorizontal: 12, marginBottom: 5 },
  messageTimestamp: { fontSize: 11, lineHeight: 16, textAlign: 'center' },
  msgRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 14 },
  msgAvatar: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  msgAvatarText: { color: '#FFFFFF', fontSize: 13, fontWeight: '600' },
  msgAvatarImg: { width: 34, height: 34, borderRadius: 17 },
  chatHeaderIdentity: { maxWidth: '100%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  chatHeaderAvatar: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  chatHeaderAvatarImage: { width: 30, height: 30, borderRadius: 15 },
  chatHeaderAvatarText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  chatHeaderName: { flexShrink: 1, fontSize: 16, fontWeight: '600' },
  conversationTopMatter: { paddingTop: 6, paddingBottom: 12 },
  conversationProfileCard: { width: '88%', alignSelf: 'center', flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 84, paddingHorizontal: 14, paddingVertical: 12, borderWidth: 1, borderRadius: 8, marginBottom: 10 },
  conversationProfileAvatar: { width: 52, height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  conversationProfileAvatarImage: { width: 52, height: 52, borderRadius: 26 },
  conversationProfileAvatarText: { color: '#FFFFFF', fontSize: 19, fontWeight: '700' },
  conversationProfileMeta: { flex: 1, minWidth: 0 },
  conversationProfileName: { fontSize: 16, fontWeight: '700', marginBottom: 5 },
  conversationProfileDetails: { flexDirection: 'row', alignItems: 'center', minHeight: 22 },
  conversationProfileDetailText: { fontSize: 12, marginLeft: 3 },
  systemGiftMessage: { alignSelf: 'center', maxWidth: '86%', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, paddingHorizontal: 14, paddingVertical: 9, marginBottom: 14, borderRadius: 15, backgroundColor: '#33A9DC16' },
  systemGiftText: { fontSize: 12, lineHeight: 17, textAlign: 'center' },
  systemGiftActor: { color: '#33A9DC', fontWeight: '700' },
  systemGiftSecondLine: { fontSize: 12, lineHeight: 17, textAlign: 'center' },
  postContextWrap: { alignSelf: 'center', width: '88%', borderRadius: 8, padding: 10 },
  postContextLead: { fontSize: 11, textAlign: 'center', marginBottom: 8 },
  postContextCard: { minHeight: 72, borderRadius: 8, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 10 },
  postContextText: { flex: 1, minWidth: 0 },
  postContextAuthor: { color: '#33A9DC', fontSize: 13, fontWeight: '700', marginBottom: 4 },
  postContextContent: { fontSize: 12, lineHeight: 18 },
  postContextImage: { width: 54, height: 54, borderRadius: 9, backgroundColor: '#DDE4E8' },
  commentContextCard: { minHeight: 68, borderRadius: 8, paddingHorizontal: 12, paddingVertical: 11 },
  commentContextContent: { fontSize: 13, lineHeight: 19 },
  bubble: { maxWidth: '68%', borderRadius: 16, paddingHorizontal: 13, paddingVertical: 9, marginHorizontal: 8 },
  bubbleMine: { borderBottomRightRadius: 4 },
  bubbleOther: { borderBottomLeftRadius: 4 },
  bubbleText: { fontSize: 15, lineHeight: 21 },
  stickerMsg: { width: 110, height: 110, borderRadius: 10, marginHorizontal: 8, backgroundColor: '#EDEEF3' },
  emptyTip: { textAlign: 'center', color: '#9AA0B4', fontSize: 13, marginTop: 40 },
  emojiBtn: { padding: 4, marginRight: 4 },
  glassComposerIcon: { width: 38, height: 38, borderRadius: 13, overflow: 'hidden', marginRight: 4 },
  composerGlassPressable: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  glassComposerInput: { flex: 1, minHeight: 36, borderRadius: 18, overflow: 'hidden' },
  composerInput: { flex: 1, minHeight: 36, paddingHorizontal: 14, paddingVertical: 7, fontSize: 14, backgroundColor: 'transparent' },
  glassSendBtn: { width: 36, height: 36, borderRadius: 18, overflow: 'hidden', marginLeft: 8 },
  glassSendDisabled: { opacity: 0.55 },
  sendBtn: { width: 34, height: 34, borderRadius: 17, backgroundColor: '#33A9DC', alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
  stickerGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: STICKER_GRID_GAP },
  stickerThumb: { width: 64, height: 64, borderRadius: 8, backgroundColor: '#EDEEF3' },
  addStickerBase: { width: 64, height: 64, borderRadius: 8, borderWidth: 1, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
  addSticker: { width: 64, height: 64, borderRadius: 8, borderWidth: 1, borderStyle: 'dashed', borderColor: '#D5D8E2', alignItems: 'center', justifyContent: 'center', backgroundColor: '#FAFBFD' },
  panelHint: { fontSize: 11, color: '#C4C8D4', marginTop: 12, lineHeight: 16 },
  menuBtn: { flexDirection: 'row' as const, alignItems: 'center' as const, borderRadius: 14, padding: 14, marginBottom: 2 },
  menuBtnText: { flex: 1, fontSize: 16, marginLeft: 12 },
  giftOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.42)', justifyContent: 'flex-end' },
  giftCard: { alignItems: 'center', paddingHorizontal: 24, paddingTop: 24, paddingBottom: 36, borderTopLeftRadius: 24, borderTopRightRadius: 24 },
  giftAvatar: { width: 68, height: 68, borderRadius: 34, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  giftAvatarImage: { width: 68, height: 68, borderRadius: 34 },
  giftAvatarText: { color: '#FFFFFF', fontSize: 25, fontWeight: '700' },
  giftNameRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, marginTop: 10, marginBottom: 18 },
  giftName: { fontSize: 18, fontWeight: '700' },
  giftButton: { minWidth: 180, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 9, backgroundColor: '#33A9DC', borderRadius: 20, paddingHorizontal: 22, paddingVertical: 11 },
  giftButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
});
