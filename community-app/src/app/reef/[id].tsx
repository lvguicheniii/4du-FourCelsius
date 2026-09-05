import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ActivityIndicator, FlatList, Keyboard, LayoutAnimation, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { Alert } from '@/components/app-alert';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Image as ExpoImage } from 'expo-image';
import { launchImageLibrarySafely } from '@/lib/image-picker';
import * as Haptics from 'expo-haptics';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { addStickerUrl, deleteStickerByUrl, getMyStickers, getReefCard, getReefMessages, getReefRooms, moveStickerToFront, reportReefMessage, resolveApiUrl, sendReefMessage, setUserBlocked, uploadFile, uploadMotionPhoto, uploadPairedLivePhoto, isNotMotionPhotoError } from '@/api/client';
import { Pressable } from '@/components/pressable';
import { GenderSymbol } from '@/components/gender-badge';
import { useTheme } from '@/lib/theme';
import { useAuth } from '@/contexts/auth';
import { useWs } from '@/contexts/ws';
import { formatChatMessageTime } from '@/lib/time';
import { ImageViewer } from '@/components/image-viewer';
import { VideoViewer } from '@/components/video-viewer';
import { LivePhotoThumbnail, LivePhotoViewer, type LivePhotoItem } from '@/components/live-photo';
import { ConfirmModal } from '@/components/confirm-modal';
import { MessageActionModal } from '@/components/message-action-modal';
import { UploadPieProgress } from '@/components/upload-pie-progress';
import { myStickers, setBlocked } from '@/data/store';
import { validatePickedVideo } from '@/lib/video-media';
import { useCommunityConfig } from '@/contexts/community-config';
import { EmojiPicker } from '@/components/emoji-picker';
import { StickerActionsModal } from '@/components/sticker-actions-modal';
import { cachedImageSource, primeUploadedImageCache, stableMediaCacheKey } from '@/lib/media-cache';
import { KeyboardInsetView } from '@/components/keyboard-sticky';
import { isNativeLiquidGlassEnabled, NativeLiquidGlassView } from '@/components/liquid-glass';

type RoomMessage = {
  id: string; roomId: string; userId: string; nickname: string;
  avatar?: string | null; gender?: string; content: string; kind: 'text' | 'image' | 'sticker' | 'video' | 'live_photo'; time: string;
};

type PendingMedia = {
  id: string;
  kind: 'image' | 'video' | 'live_photo' | 'android_motion_candidate';
  uri: string;
  stillUri?: string;
  motionUri?: string;
};

const REPORT_REASONS = ['垃圾广告', '色情低俗', '人身攻击', '不实信息', '违法违规', '其他'];
const STICKER_GRID_GAP = 10;
const STICKER_PANEL_PADDING = 14;

function reefMediaUri(value: string) {
  return /^(https?:|file:|content:|data:|blob:)/i.test(value) ? value : resolveApiUrl(value);
}

function ReefVideo({ poster, onPress }: { poster?: string; onPress?: () => void }) {
  return <Pressable onPress={onPress} style={{ width: 240, height: 180, borderRadius: 12, overflow: 'hidden', backgroundColor: '#101820' }}>
    {poster ? <ExpoImage source={{ uri: poster }} style={{ position: 'absolute', width: 240, height: 180 }} contentFit="cover" cachePolicy="memory-disk" /> : null}
    <View pointerEvents="none" style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="play-circle" size={44} color="#FFFFFF" /></View>
  </Pressable>;
}

export default function ReefRoomScreen() {
  const { id, name, color, number, status, messageId: targetMessageId } = useLocalSearchParams<{ id: string; name?: string; color?: string; number?: string; status?: string; messageId?: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { width: screenWidth } = useWindowDimensions();
  const { colors, isDark } = useTheme();
  const { user } = useAuth();
  const { features } = useCommunityConfig();
  const videoUploadEnabled = features.video_upload === true;
  const { reefEvents, sendWs, connectionVersion } = useWs();
  const roomColor = color || colors.accent;
  const stickerCellSize = Math.floor((screenWidth - STICKER_PANEL_PADDING * 2 - STICKER_GRID_GAP * 3) / 4);
  const [messages, setMessages] = useState<RoomMessage[]>([]);
  const [members, setMembers] = useState<any[]>([]);
  const [draft, setDraft] = useState('');
  const [mentions, setMentions] = useState<{ userId: string; nickname: string }[]>([]);
  const [sending, setSending] = useState(false);
  const [destroyed, setDestroyed] = useState(status === 'destroyed');
  const [exactMessageTimes, setExactMessageTimes] = useState(false);
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
  const [previewUri, setPreviewUri] = useState<string | null>(null);
  const [previewVideo, setPreviewVideo] = useState<{ uri: string; poster?: string } | null>(null);
  const [previewLivePhoto, setPreviewLivePhoto] = useState<LivePhotoItem | null>(null);
  const [actionMessage, setActionMessage] = useState<RoomMessage | null>(null);
  const [actionStep, setActionStep] = useState<'menu' | 'report'>('menu');
  const [reportReason, setReportReason] = useState('');
  const [reportDetail, setReportDetail] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [blockTarget, setBlockTarget] = useState<RoomMessage | null>(null);
  const processedReefSeqRef = useRef(0);
  const listRef = useRef<FlatList>(null);
  const userAwayFromBottomRef = useRef(false);
  const keyboardShouldPinLatestRef = useRef(false);
  const stickerLongPressRef = useRef(false);
  const composerInputRef = useRef<TextInput>(null);
  const keyboardTransitionRef = useRef(false);
  const roomRequestRef = useRef(0);
  const scrolledTargetRef = useRef('');

  const scrollToLatest = useCallback((force = false) => {
    if (!force && userAwayFromBottomRef.current) return;
    if (force) userAwayFromBottomRef.current = false;
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        listRef.current?.scrollToEnd({ animated: false });
      });
    });
  }, []);

  const loadRoom = useCallback(async () => {
    const requestId = ++roomRequestRef.current;
    try {
      const [messageResult, cardResult] = await Promise.allSettled([getReefMessages(id, 80, targetMessageId), getReefCard(id)]);
      if (requestId !== roomRequestRef.current) return;
      if (messageResult.status === 'fulfilled') setMessages(current => {
        const serverMessages = messageResult.value.messages || [];
        const serverIds = new Set(serverMessages.map((item: RoomMessage) => item.id));
        return [...serverMessages, ...current.filter(item => !serverIds.has(item.id))];
      });
      if (cardResult.status === 'fulfilled') {
        const room = cardResult.value?.room;
        setDestroyed(room?.status === 'destroyed');
        setMembers(room?.members || []);
      }
    } catch {}
  }, [id, targetMessageId]);

  useEffect(() => { void loadRoom(); }, [loadRoom]);
  useEffect(() => {
    const eventName = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const subscription = Keyboard.addListener(eventName, event => {
      if (Platform.OS === 'ios') Keyboard.scheduleLayoutAnimation(event);
      setComposerPanelHeight(Math.max(250, Math.min(320, event.endCoordinates.height)));
      if (keyboardTransitionRef.current) {
        keyboardTransitionRef.current = false;
        setPanelOpen(false);
      }
      if (keyboardShouldPinLatestRef.current) scrollToLatest(true);
    });
    const hideSubscription = Keyboard.addListener('keyboardDidHide', () => {
      keyboardShouldPinLatestRef.current = false;
    });
    return () => {
      subscription.remove();
      hideSubscription.remove();
    };
  }, [scrollToLatest]);
  useEffect(() => {
    if (connectionVersion > 1) void loadRoom();
  }, [connectionVersion, loadRoom]);
  useEffect(() => {
    getMyStickers().then(urls => {
      if (!Array.isArray(urls)) return;
      setStickers(urls);
      myStickers.length = 0;
      myStickers.push(...urls);
    }).catch(() => {});
  }, []);
  useEffect(() => {
    if (!id) return;
    sendWs({ type: 'reef_enter', roomId: id });
    return () => { sendWs({ type: 'reef_leave', roomId: id }); };
  }, [id, connectionVersion, sendWs]);

  useEffect(() => {
    const pending = reefEvents.filter(event => (event._seq || 0) > processedReefSeqRef.current);
    if (!pending.length) return;
    processedReefSeqRef.current = Math.max(...pending.map(event => event._seq || 0));
    if (pending.some(event => event.type === 'reef_block_changed')) void loadRoom();
    const roomEvents = pending.filter(event => event.roomId === id);
    if (!roomEvents.length) return;

    if (roomEvents.some(event => event.type === 'reef_room_updated' && event.action === 'destroyed')) {
      setDestroyed(true);
    }
    const incomingMessages = roomEvents
      .filter(event => event.type === 'reef_message' && event.message)
      .map(event => event.message as RoomMessage);
    if (incomingMessages.length) {
      setMessages(current => {
        const knownIds = new Set(current.map(item => item.id));
        return [...current, ...incomingMessages.filter(item => !knownIds.has(item.id))];
      });
    }
    if (roomEvents.some(event => event.type === 'reef_room_updated')) {
      getReefRooms().then(data => {
        const room = (data.rooms || []).find((item: any) => item.id === id);
        if (room) setMembers(room.members || []);
      }).catch(() => {});
    }
  }, [id, loadRoom, reefEvents]);

  const openProfile = (userId: string, nickname: string) => {
    router.push({ pathname: '/user/[name]', params: { name: nickname, userId } });
  };

  const displayMessages = useMemo(() => {
    const toTimestamp = (value: string) => {
      const source = String(value || '').trim();
      const normalized = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(source)
        ? source
        : `${source.replace(' ', 'T')}+08:00`;
      const timestamp = Date.parse(normalized);
      return Number.isFinite(timestamp) ? timestamp : 0;
    };
    return messages.map((message, index) => {
      if (index === 0) return { message, showTime: true };
      const currentTime = toTimestamp(message.time);
      const previousTime = toTimestamp(messages[index - 1].time);
      return {
        message,
        showTime: currentTime <= 0 || previousTime <= 0 || currentTime - previousTime >= 5 * 60 * 1000,
      };
    });
  }, [messages]);

  useEffect(() => {
    if (userAwayFromBottomRef.current || messages.length <= 1) return;
    scrollToLatest();
  }, [messages.length, scrollToLatest]);
  useEffect(() => {
    if (!targetMessageId || scrolledTargetRef.current === targetMessageId) return;
    const index = messages.findIndex(message => message.id === targetMessageId);
    if (index < 0) return;
    scrolledTargetRef.current = targetMessageId;
    userAwayFromBottomRef.current = true;
    const timer = setTimeout(() => listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.45 }), 120);
    return () => clearTimeout(timer);
  }, [messages, targetMessageId]);

  const addMention = (message: RoomMessage) => {
    if (!message.userId || message.userId === user?.id) return;
    setMentions(current => current.some(item => item.userId === message.userId)
      ? current
      : [...current, { userId: message.userId, nickname: message.nickname }].slice(0, 8));
    setPanelOpen(false);
    keyboardShouldPinLatestRef.current = true;
    requestAnimationFrame(() => composerInputRef.current?.focus());
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const send = async (kind: 'text' | 'image' | 'sticker' | 'video' | 'live_photo', source: string, mediaId?: string | null, mentionUserIds: string[] = []): Promise<boolean> => {
    if (sending) return false;
    let content = source;
    let sendMediaId = mediaId;
    const mediaAlreadyUploaded = /^(https?:\/\/|\/uploads\/)/i.test(content) || (kind === 'live_photo' && content.trim().startsWith('{'));
    if ((kind === 'image' || kind === 'video' || kind === 'live_photo') && !mediaAlreadyUploaded) {
      try {
        const uploaded = await uploadFile(content, kind === 'image' ? 'm' : 'vr');
        content = uploaded.url;
        sendMediaId = uploaded.mediaId;
      } catch (error) {
        Alert.alert('图片发送失败', error instanceof Error ? error.message : '请检查网络后重试');
        return false;
      }
    }
    setSending(true);
    try {
      const message = await sendReefMessage(id, content, kind, sendMediaId, mentionUserIds);
      setMessages(current => current.some(item => item.id === message.id) ? current : [...current, message]);
      return true;
    } catch (error) {
      Alert.alert('发送失败', error instanceof Error ? error.message : '请稍后重试');
      return false;
    } finally { setSending(false); }
  };

  const sendPendingMedia = async (media: PendingMedia): Promise<boolean> => {
    const optimisticId = `reef-upload-${Date.now()}-${media.id}`;
    const initialKind: RoomMessage['kind'] = media.kind === 'video' ? 'video' : media.kind === 'live_photo' ? 'live_photo' : 'image';
    const initialContent = media.kind === 'live_photo'
      ? JSON.stringify({ stillUrl: media.stillUri || media.uri, motionUrl: media.motionUri || media.uri })
      : media.uri;
    const optimisticMessage: RoomMessage = {
      id: optimisticId,
      roomId: id,
      userId: user?.id || 'me',
      nickname: user?.nickname || user?.username || '我',
      avatar: user?.avatar,
      gender: user?.gender || undefined,
      content: initialContent,
      kind: initialKind,
      time: new Date().toISOString(),
    };
    setMessages(current => [...current, optimisticMessage]);
    setUploadProgressById(current => ({ ...current, [optimisticId]: 0 }));
    requestAnimationFrame(() => listRef.current?.scrollToEnd({ animated: true }));

    const setProgress = (value: number) => setUploadProgressById(current => ({ ...current, [optimisticId]: value }));
    let finalKind: 'image' | 'video' | 'live_photo' = initialKind;
    let content = initialContent;
    let mediaId: string | null | undefined;
    try {
      if (media.kind === 'live_photo' && media.motionUri) {
        const uploaded = await uploadPairedLivePhoto(media.stillUri || media.uri, media.motionUri, 'reef', setProgress);
        content = JSON.stringify({ motionUrl: uploaded.motionUrl, stillUrl: uploaded.stillUrl });
        mediaId = uploaded.mediaId;
      } else if (media.kind === 'android_motion_candidate') {
        try {
          const motion = await uploadMotionPhoto(media.uri, 'reef', setProgress);
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
        const uploaded = await uploadFile(media.uri, media.kind === 'video' ? 'vr' : 'm', setProgress);
        content = uploaded.url;
        mediaId = uploaded.mediaId;
      }

      setProgress(1);
      const message = await sendReefMessage(id, content, finalKind, mediaId);
      setMessages(current => {
        const replaced = current.map(item => item.id === optimisticId ? message : item);
        const seen = new Set<string>();
        return replaced.filter(item => !seen.has(item.id) && !!seen.add(item.id));
      });
      setUploadProgressById(current => {
        const next = { ...current };
        delete next[optimisticId];
        return next;
      });
      return true;
    } catch (error) {
      setMessages(current => current.filter(item => item.id !== optimisticId));
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
    if (sending || sendingImages) return;
    setPanelOpen(false);
    if (pendingMedia.length) {
      const selected = [...pendingMedia];
      setPendingMedia([]);
      setSendingImages(true);
      const failed: PendingMedia[] = [];
      for (const media of selected) {
        if (!(await sendPendingMedia(media))) failed.push(media);
      }
      setPendingMedia(current => [...failed, ...current].slice(0, 9));
      setSendingImages(false);
      return;
    }
    const mentionPrefix = mentions.map(item => `@${item.nickname}`).join(' ');
    const content = [mentionPrefix, draft.trim()].filter(Boolean).join(' ');
    if (!content) return;
    const selectedMentions = [...mentions];
    setDraft('');
    setMentions([]);
    if (!(await send('text', content, null, selectedMentions.map(item => item.userId)))) {
      setDraft(draft.trim());
      setMentions(selectedMentions);
    }
  };

  const chooseImages = async () => {
    if (sendingImages) return;
    const result = await launchImageLibrarySafely({
      mediaTypes: ['images', 'livePhotos'], allowsMultipleSelection: false, quality: 1,
    });
    if (result.canceled || !result.assets?.[0]) return;
    const asset = result.assets[0];
    if (asset.pairedVideoAsset?.uri) {
      const validationError = await validatePickedVideo(asset.pairedVideoAsset, { livePhoto: true });
      if (validationError) { Alert.alert('无法添加实况照片', validationError); return; }
      setPendingMedia(current => [...current, ({
        id: `pending-${Date.now()}`,
        kind: 'live_photo',
        uri: asset.uri,
        stillUri: asset.uri,
        motionUri: asset.pairedVideoAsset!.uri,
      } as PendingMedia)].slice(0, 9));
      return;
    }
    if (Platform.OS === 'android') {
      setPendingMedia(current => [...current, ({ id: `pending-${Date.now()}`, kind: 'android_motion_candidate', uri: asset.uri } as PendingMedia)].slice(0, 9));
      return;
    }
    setPendingMedia(current => [...current, ({ id: `pending-${Date.now()}`, kind: 'image', uri: asset.uri } as PendingMedia)].slice(0, 9));
  };

  const chooseVideo = async () => {
    if (sendingImages) return;
    try {
      const result = await launchImageLibrarySafely({ mediaTypes: ['videos', 'livePhotos'], quality: 0.8 });
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
      } : {
        id: `pending-${Date.now()}`,
        kind: 'video',
        uri: asset.uri,
      };
      setPendingMedia(current => [...current, queued].slice(0, 9));
    } catch (error) {
      Alert.alert('媒体选择失败', error instanceof Error ? error.message : '请重试');
    }
  };

  const addSticker = async () => {
    try {
      const result = await launchImageLibrarySafely({ mediaTypes: ['images'], allowsEditing: false, quality: 1 });
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];
      const uploaded = await uploadFile(asset.uri, 's', undefined, { mimeType: asset.mimeType });
      await addStickerUrl(uploaded.url);
      await primeUploadedImageCache(asset.uri, uploaded.url);
      const next = myStickers.includes(uploaded.url) ? [...myStickers] : [...myStickers, uploaded.url];
      myStickers.splice(0, myStickers.length, ...next);
      setStickers(next);
    } catch (error) {
      Alert.alert('添加失败', error instanceof Error ? error.message : '请稍后重试');
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
    setPanelOpen(false);
    void send('sticker', uri);
  };

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

  const openMessageActions = (message: RoomMessage) => {
    if (message.userId === user?.id) return;
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setActionMessage(message);
    setActionStep('menu');
    setReportReason('');
    setReportDetail('');
  };

  const submitReport = async (reason = reportReason, detail = reportDetail) => {
    if (!actionMessage || !reason || actionLoading) return;
    setActionLoading(true);
    try {
      await reportReefMessage(id, actionMessage.id, reason, detail);
      setActionMessage(null);
    } catch (error) {
      Alert.alert('举报失败', error instanceof Error ? error.message : '请稍后重试');
    } finally { setActionLoading(false); }
  };

  const confirmBlock = async () => {
    if (!blockTarget || actionLoading) return;
    setActionLoading(true);
    try {
      await setUserBlocked(blockTarget.userId, true);
      setBlocked(blockTarget.nickname, true);
      setMessages(current => current.filter(message => message.userId !== blockTarget.userId));
      setBlockTarget(null);
    } catch (error) {
      Alert.alert('拉黑失败', error instanceof Error ? error.message : '请稍后重试');
    } finally { setActionLoading(false); }
  };

  const hasComposerContent = !!draft.trim() || mentions.length > 0 || pendingMedia.length > 0;

  return (
    <KeyboardInsetView style={[s.page, { backgroundColor: colors.bg }]}>
      <View style={[s.header, { paddingTop: insets.top + 6, borderBottomColor: colors.divider }]}>
        <Pressable style={s.headerBtn} onPress={() => router.back()}><Ionicons name="chevron-back" size={24} color={colors.accent} /></Pressable>
        <View style={s.headerTitle}>
          <Text style={[s.title, { color: colors.text }]} numberOfLines={1}>{number ? `#${number} ${name || '礁石'}` : name || '礁石'}</Text>
          <Text style={[s.presence, { color: colors.textMuted }]}>{members.length}人正在礁间交谈</Text>
        </View>
        {!destroyed ? <Pressable
          accessibilityLabel="查看礁石概览"
          style={s.headerMembers}
          onPress={() => router.push({ pathname: '/reef-info/[id]' as any, params: { id, name: name || '礁石', color: roomColor } })}
        >
          <Ionicons name="information-circle-outline" size={25} color={colors.accent} />
        </Pressable> : <View style={s.headerMembers} />}
      </View>
      {destroyed ? (
        <View style={s.destroyedState}>
          <Ionicons name="layers-outline" size={42} color={colors.textMuted} />
          <Text style={[s.destroyedTitle, { color: colors.text }]}>这座礁石已经摧毁</Text>
          <Pressable style={[s.destroyedButton, { borderColor: colors.accent }]} onPress={() => router.back()}>
            <Text style={{ color: colors.accent, fontWeight: '700' }}>返回隐海礁</Text>
          </Pressable>
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={displayMessages}
          keyExtractor={item => item.message.id}
          contentContainerStyle={s.messages}
          keyboardShouldPersistTaps="handled"
          onLayout={() => {
            if (keyboardShouldPinLatestRef.current) scrollToLatest(true);
          }}
          onContentSizeChange={() => {
            if (keyboardShouldPinLatestRef.current || !userAwayFromBottomRef.current) scrollToLatest(keyboardShouldPinLatestRef.current);
          }}
          onScroll={({ nativeEvent }) => {
            const distanceFromBottom = nativeEvent.contentSize.height - nativeEvent.layoutMeasurement.height - nativeEvent.contentOffset.y;
            userAwayFromBottomRef.current = distanceFromBottom > 72;
          }}
          onScrollToIndexFailed={({ index, averageItemLength }) => {
            listRef.current?.scrollToOffset({ offset: Math.max(0, index * averageItemLength), animated: false });
            setTimeout(() => listRef.current?.scrollToIndex({ index, animated: true, viewPosition: 0.45 }), 120);
          }}
          scrollEventThrottle={16}
          renderItem={({ item }) => {
            const message = item.message;
            const mine = message.userId === user?.id;
            const uploadProgress = uploadProgressById[message.id];
            return <View style={s.messageItem}>
              {item.showTime && (
                <Pressable
                  hitSlop={5}
                  style={s.messageTimestampPressable}
                  onPress={() => setExactMessageTimes(current => !current)}
                >
                  <Text style={[s.messageTimestamp, { color: colors.textMuted }]}>
                    {formatChatMessageTime(message.time, exactMessageTimes)}
                  </Text>
                </Pressable>
              )}
              <View style={[s.messageRow, mine && s.messageRowMine]}>
              <Pressable
                accessibilityLabel={`查看${message.nickname}的主页`}
                style={[s.avatar, { backgroundColor: roomColor + '32' }]}
                onPress={() => openProfile(message.userId, message.nickname)}
                onLongPress={() => addMention(message)}
                delayLongPress={450}
              >
                {message.avatar ? (
                  <ExpoImage source={{ uri: message.avatar }} style={s.avatarImage} cachePolicy="memory-disk" />
                ) : (
                  <Text style={[s.avatarText, { color: roomColor }]}>{message.nickname?.[0] || '?'}</Text>
                )}
              </Pressable>
              <View style={{ maxWidth: '76%', alignItems: mine ? 'flex-end' : 'flex-start' }}>
                {!mine && <View style={s.senderRow}>
                  <Text style={[s.sender, { color: colors.textMuted }]}>{message.nickname}</Text>
                  {message.gender === 'male' || message.gender === 'female' ? (
                    <View style={s.senderGenderSlot}>
                      <GenderSymbol gender={message.gender} size={12} color={message.gender === 'female' ? '#EC85B5' : '#58AEE8'} />
                    </View>
                  ) : (
                    <View style={s.senderGenderSlot}><Ionicons name="person" size={10} color={colors.textMuted} /></View>
                  )}
                </View>}
                {message.kind === 'image' ? (
                  <Pressable
                    onPress={() => setPreviewUri(reefMediaUri(message.content))}
                    onLongPress={() => openMessageActions(message)}
                    delayLongPress={450}
                  >
                    <ExpoImage source={{ uri: reefMediaUri(message.content) }} style={[s.messageImage, { backgroundColor: colors.input }]} contentFit="cover" cachePolicy="memory-disk" transition={0} />
                    {uploadProgress !== undefined && <UploadPieProgress progress={uploadProgress} color={roomColor} />}
                  </Pressable>
                ) : message.kind === 'video' || message.kind === 'live_photo' ? (
                  <Pressable onLongPress={() => uploadProgress === undefined && openMessageActions(message)} delayLongPress={450}>
                    {(() => {
                      let media: ReactNode;
                      if (message.kind !== 'live_photo') {
                        const uri = reefMediaUri(message.content);
                        media = <ReefVideo onPress={() => uploadProgress === undefined && setPreviewVideo({ uri })} />;
                      } else {
                        try {
                          const value = JSON.parse(message.content);
                          const motionUri = reefMediaUri(value.motionUrl);
                          const stillUri = value.stillUrl ? reefMediaUri(value.stillUrl) : '';
                          media = stillUri
                            ? <LivePhotoThumbnail
                                stillUri={stillUri}
                                width={240}
                                height={180}
                                preserveAspectRatio
                                onLongPress={() => uploadProgress === undefined && openMessageActions(message)}
                                onOpen={() => uploadProgress === undefined && setPreviewLivePhoto({ stillUrl: stillUri, motionUrl: motionUri })}
                              />
                            : <ReefVideo onPress={() => uploadProgress === undefined && setPreviewVideo({ uri: motionUri })} />;
                        } catch {
                          const uri = reefMediaUri(message.content);
                          media = <ReefVideo onPress={() => uploadProgress === undefined && setPreviewVideo({ uri })} />;
                        }
                      }
                      return <View>{media}{uploadProgress !== undefined && <UploadPieProgress progress={uploadProgress} color={roomColor} />}</View>;
                    })()}
                  </Pressable>
                ) : message.kind === 'sticker' ? (
                  <Pressable onLongPress={() => openMessageActions(message)} delayLongPress={450}>
                    <ExpoImage source={cachedImageSource(reefMediaUri(message.content))} style={s.messageSticker} contentFit="contain" cachePolicy="memory-disk" autoplay transition={0} />
                  </Pressable>
                ) : (
                  <Pressable
                    style={[s.bubble, mine ? { backgroundColor: roomColor } : { backgroundColor: colors.card }]}
                    onLongPress={() => openMessageActions(message)}
                    delayLongPress={450}
                  >
                    <Text style={[s.content, { color: mine ? '#FFFFFF' : colors.text }]}>{String(message.content || '').split(/(@[^\s@，。！？,.!?:：；;]+)/g).map((part, index) => part.startsWith('@') ? <Text key={`${part}-${index}`} style={{ color: mine ? '#DDF6FF' : colors.accent, fontWeight: '700' }}>{part}</Text> : part)}</Text>
                  </Pressable>
                )}
              </View>
              </View>
            </View>;
          }}
          ListEmptyComponent={<View style={s.empty}><Ionicons name="chatbubbles-outline" size={38} color={colors.textMuted} /><Text style={{ color: colors.textMuted, marginTop: 10 }}>这里还很安静，说点什么吧</Text></View>}
        />
      )}
      {!destroyed && <View style={{ backgroundColor: colors.card }}>
        {pendingMedia.length > 0 && <View style={s.pendingImages}>{pendingMedia.map(media => <View key={media.id}><ExpoImage source={{ uri: media.stillUri || media.uri }} style={[s.pendingImage, { backgroundColor: colors.input }]} contentFit="cover" />{(media.kind === 'video' || media.kind === 'live_photo' || media.kind === 'android_motion_candidate') && <View pointerEvents="none" style={s.pendingMediaBadge}><Ionicons name={media.kind === 'video' ? 'videocam' : 'aperture'} size={12} color="#FFFFFF" /></View>}<Pressable style={s.pendingRemove} onPress={() => setPendingMedia(current => current.filter(item => item.id !== media.id))}><Ionicons name="close-circle" size={17} color="#FFFFFF" /></Pressable></View>)}</View>}
        <View style={[s.composer, { paddingBottom: Math.max(insets.bottom, 10), borderTopColor: colors.divider }]}>
          {isNativeLiquidGlassEnabled ? <NativeLiquidGlassView glassEffectStyle="regular" colorScheme={isDark ? 'dark' : 'light'} isInteractive style={s.glassComposerIcon}><Pressable style={s.composerGlassPressable} onPress={toggleComposerPanel}>{panelOpen ? <MaterialCommunityIcons name="keyboard-outline" size={26} color={roomColor} /> : <Ionicons name="happy-outline" size={26} color={colors.textMuted} />}</Pressable></NativeLiquidGlassView> : <Pressable style={s.composerIcon} onPress={toggleComposerPanel}>{panelOpen ? <MaterialCommunityIcons name="keyboard-outline" size={26} color={roomColor} /> : <Ionicons name="happy-outline" size={26} color={colors.textMuted} />}</Pressable>}
          {isNativeLiquidGlassEnabled ? <NativeLiquidGlassView glassEffectStyle="regular" colorScheme={isDark ? 'dark' : 'light'} isInteractive style={s.glassComposerIcon}><Pressable style={s.composerGlassPressable} onPress={chooseImages}><Ionicons name="image-outline" size={24} color={colors.textMuted} /></Pressable></NativeLiquidGlassView> : <Pressable style={s.composerIcon} onPress={chooseImages}><Ionicons name="image-outline" size={24} color={colors.textMuted} /></Pressable>}
          {videoUploadEnabled ? <Pressable style={s.composerIcon} onPress={chooseVideo} disabled={sendingImages}>{sendingImages ? <ActivityIndicator size="small" color={roomColor} /> : <Ionicons name="videocam-outline" size={24} color={colors.textMuted} />}</Pressable> : null}
          {isNativeLiquidGlassEnabled ? <NativeLiquidGlassView glassEffectStyle="regular" colorScheme={isDark ? 'dark' : 'light'} style={s.glassInput}><View style={s.composerInputShell}>{mentions.map(mention => <Text key={mention.userId} style={[s.mentionToken, { color: colors.accent }]}>@{mention.nickname}</Text>)}<TextInput
            ref={composerInputRef}
            value={draft}
            onChangeText={setDraft}
            onFocus={() => {
              if (panelOpen) keyboardTransitionRef.current = true;
              keyboardShouldPinLatestRef.current = true;
              scrollToLatest(true);
            }}
            onBlur={() => { keyboardShouldPinLatestRef.current = false; }}
            multiline
            maxLength={500}
            placeholder="向礁间发送一段声音…"
            placeholderTextColor={colors.textMuted}
            onKeyPress={({ nativeEvent }) => { if (nativeEvent.key === 'Backspace' && !draft && mentions.length) setMentions(current => current.slice(0, -1)); }}
            style={[s.input, s.mentionInput, { color: colors.text, backgroundColor: 'transparent' }]}
          /></View></NativeLiquidGlassView> : <View style={[s.composerInputShell, { backgroundColor: colors.bg }]}>{mentions.map(mention => <Text key={mention.userId} style={[s.mentionToken, { color: colors.accent }]}>@{mention.nickname}</Text>)}<TextInput
            ref={composerInputRef}
            value={draft}
            onChangeText={setDraft}
            onFocus={() => {
              if (panelOpen) keyboardTransitionRef.current = true;
              keyboardShouldPinLatestRef.current = true;
              scrollToLatest(true);
            }}
            onBlur={() => { keyboardShouldPinLatestRef.current = false; }}
            multiline
            maxLength={500}
            placeholder="向礁间发送一段声音…"
            placeholderTextColor={colors.textMuted}
            onKeyPress={({ nativeEvent }) => { if (nativeEvent.key === 'Backspace' && !draft && mentions.length) setMentions(current => current.slice(0, -1)); }}
            style={[s.input, s.mentionInput, { color: colors.text, backgroundColor: 'transparent' }]}
          /></View>}
          {isNativeLiquidGlassEnabled ? <NativeLiquidGlassView glassEffectStyle="regular" colorScheme={isDark ? 'dark' : 'light'} isInteractive style={s.glassSend}><Pressable style={s.composerGlassPressable} onPress={sendText} disabled={!hasComposerContent || sending || sendingImages}>{sendingImages ? <ActivityIndicator size="small" color={colors.accent} /> : <Ionicons name="arrow-up" size={20} color={hasComposerContent ? colors.accent : colors.textMuted} />}</Pressable></NativeLiquidGlassView> : <Pressable style={[s.send, { backgroundColor: hasComposerContent ? roomColor : colors.divider }]} onPress={sendText} disabled={!hasComposerContent || sending || sendingImages}>{sendingImages ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Ionicons name="arrow-up" size={20} color={hasComposerContent ? '#FFFFFF' : '#7F8796'} />}</Pressable>}
        </View>
        {panelOpen && (
          <View style={{ height: composerPanelHeight, overflow: 'hidden', borderTopWidth: 1, borderTopColor: colors.divider }}>
            <View style={s.panelTabs}>
              <Pressable style={[s.panelTab, { borderBottomColor: panelTab === 'emoji' ? roomColor : 'transparent' }]} onPress={() => setPanelTab('emoji')}>
                <Ionicons name="happy-outline" size={20} color={panelTab === 'emoji' ? roomColor : colors.textMuted} />
              </Pressable>
              <Pressable style={[s.panelTab, { borderBottomColor: panelTab === 'sticker' ? roomColor : 'transparent' }]} onPress={() => setPanelTab('sticker')}>
                <Ionicons name="heart-outline" size={20} color={panelTab === 'sticker' ? roomColor : colors.textMuted} />
              </Pressable>
            </View>
            {panelTab === 'emoji' ? (
              <EmojiPicker onSelect={(emoji) => setDraft(current => current + emoji)} />
            ) : (
              <ScrollView style={{ maxHeight: 180 }} contentContainerStyle={s.stickerPanel} keyboardDismissMode="none" keyboardShouldPersistTaps="always">
                <View style={s.stickerGrid}>
                  {stickers.map((uri) => {
                    const mediaUri = reefMediaUri(uri);
                    return <Pressable key={uri} onPress={() => sendStickerFromPanel(uri)} onLongPress={(event) => openStickerActions(uri, event.nativeEvent.pageX, event.nativeEvent.pageY)} delayLongPress={450}><ExpoImage source={cachedImageSource(mediaUri)} recyclingKey={stableMediaCacheKey(mediaUri)} style={[s.stickerThumb, { width: stickerCellSize, height: stickerCellSize }]} contentFit="contain" cachePolicy="memory-disk" autoplay transition={0} /></Pressable>;
                  })}
                  <Pressable style={[s.addSticker, { width: stickerCellSize, height: stickerCellSize, borderColor: colors.textMuted + '55', backgroundColor: colors.input }]} onPress={addSticker}><Ionicons name="add" size={26} color={colors.textMuted} /></Pressable>
                </View>
              </ScrollView>
            )}
          </View>
        )}
      </View>}
      <ImageViewer images={previewUri ? [previewUri] : []} index={0} visible={!!previewUri} onClose={() => setPreviewUri(null)} />
      {previewVideo && <VideoViewer visible={!!previewVideo} uri={previewVideo.uri} poster={previewVideo.poster} onClose={() => setPreviewVideo(null)} />}
      <LivePhotoViewer visible={!!previewLivePhoto} items={previewLivePhoto ? [previewLivePhoto] : []} index={0} onClose={() => setPreviewLivePhoto(null)} />
      <MessageActionModal visible={!!actionMessage} mode="other" accent={roomColor} loading={actionLoading} onClose={() => setActionMessage(null)} onReport={submitReport} onBlock={() => { setBlockTarget(actionMessage); setActionMessage(null); }} />
      <StickerActionsModal visible={!!selectedSticker} anchor={stickerActionAnchor} previewUri={selectedSticker ? reefMediaUri(selectedSticker) : null} loading={stickerActionLoading} onClose={() => setSelectedSticker(null)} onMoveToFront={handleMoveStickerToFront} onDelete={handleDeleteSticker} />
      <Modal visible={false} transparent animationType="fade" onRequestClose={() => setActionMessage(null)}>
        <Pressable style={s.actionOverlay} onPress={() => setActionMessage(null)}>
          <Pressable style={[s.actionCard, { backgroundColor: colors.card }]} onPress={event => event.stopPropagation()}>
            {actionStep === 'menu' ? <>
              <Text style={[s.actionTitle, { color: colors.text }]}>消息操作</Text>
              <Pressable style={[s.actionRow, { borderColor: colors.divider }]} onPress={() => setActionStep('report')}><Ionicons name="flag-outline" size={20} color={colors.danger} /><Text style={[s.actionRowText, { color: colors.text }]}>举报消息</Text></Pressable>
              <Pressable style={[s.actionRow, { borderColor: colors.divider }]} onPress={() => { setBlockTarget(actionMessage); setActionMessage(null); }}><Ionicons name="ban-outline" size={20} color={colors.danger} /><Text style={[s.actionRowText, { color: colors.text }]}>拉黑用户</Text></Pressable>
            </> : <>
              <Text style={[s.actionTitle, { color: colors.text }]}>选择举报原因</Text>
              <View style={s.reportReasons}>{REPORT_REASONS.map(reason => <Pressable key={reason} style={[s.reportReason, { backgroundColor: colors.input, borderColor: reportReason === reason ? roomColor : 'transparent' }]} onPress={() => setReportReason(reason)}><Text style={{ color: reportReason === reason ? roomColor : colors.text }}>{reason}</Text></Pressable>)}</View>
              <TextInput value={reportDetail} onChangeText={setReportDetail} maxLength={500} multiline placeholder="补充说明（可选）" placeholderTextColor={colors.textMuted} style={[s.reportInput, { color: colors.text, backgroundColor: colors.input, borderColor: colors.divider }]} />
              <Pressable style={[s.reportSubmit, { backgroundColor: reportReason ? roomColor : colors.divider }]} disabled={!reportReason || actionLoading} onPress={() => submitReport()}>{actionLoading ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Text style={s.reportSubmitText}>提交举报</Text>}</Pressable>
            </>}
          </Pressable>
        </Pressable>
      </Modal>
      <ConfirmModal visible={!!blockTarget} title="拉黑用户" message={`拉黑后，你和${blockTarget?.nickname || '对方'}将在全 App 互相不可见，包括礁石消息、切片、评论、信标和失温切片。`} confirmText="确认拉黑" cancelText="取消" tone="danger" loading={actionLoading} icon="ban-outline" onCancel={() => setBlockTarget(null)} onConfirm={confirmBlock} />
    </KeyboardInsetView>
  );
}

const s = StyleSheet.create({
  page: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 6, paddingBottom: 8, borderBottomWidth: StyleSheet.hairlineWidth },
  headerBtn: { width: 42, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, alignItems: 'center' }, title: { fontSize: 16, fontWeight: '700' }, presence: { fontSize: 10, marginTop: 2 },
  headerMembers: { width: 42, height: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  messages: { padding: 14, paddingTop: 22 },
  messageItem: { marginBottom: 13 },
  messageTimestampPressable: { alignSelf: 'center', paddingHorizontal: 10, paddingVertical: 4, marginBottom: 7 },
  messageTimestamp: { fontSize: 11, lineHeight: 15, textAlign: 'center' },
  messageRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  messageRowMine: { justifyContent: 'flex-start', flexDirection: 'row-reverse' },
  avatar: { width: 31, height: 31, borderRadius: 16, alignItems: 'center', justifyContent: 'center' }, avatarText: { fontSize: 13, fontWeight: '700' },
  avatarImage: { width: '100%', height: '100%', borderRadius: 16 },
  senderRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginBottom: 3 }, sender: { fontSize: 10 },
  senderGenderSlot: { width: 16, height: 16, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  bubble: { borderRadius: 16, paddingHorizontal: 13, paddingVertical: 9 }, content: { fontSize: 14, lineHeight: 20 },
  messageImage: { width: 210, height: 210, borderRadius: 12 },
  messageSticker: { width: 110, height: 110, borderRadius: 10 },
  empty: { alignItems: 'center', paddingTop: 120 },
  destroyedState: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 36 },
  destroyedTitle: { fontSize: 17, fontWeight: '700', marginTop: 14 },
  destroyedText: { fontSize: 13, lineHeight: 20, textAlign: 'center', marginTop: 7 },
  destroyedButton: { height: 42, borderWidth: 1, borderRadius: 12, paddingHorizontal: 22, alignItems: 'center', justifyContent: 'center', marginTop: 20 },
  panelTabs: { flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: '#00000018' },
  panelTab: { flex: 1, alignItems: 'center', paddingVertical: 10, borderBottomWidth: 2 },
  emojiGrid: { minHeight: 120, flexDirection: 'row', flexWrap: 'wrap', padding: 10 },
  emojiCell: { padding: 8 }, emojiText: { fontSize: 24 },
  stickerPanel: { padding: STICKER_PANEL_PADDING }, stickerGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: STICKER_GRID_GAP },
  stickerThumb: { width: 64, height: 64, borderRadius: 8, backgroundColor: '#EDEEF3' },
  addSticker: { width: 64, height: 64, borderRadius: 8, borderWidth: 1, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
  pendingImages: { flexDirection: 'row', flexWrap: 'wrap', gap: 7, paddingHorizontal: 12, paddingTop: 8 },
  pendingImage: { width: 56, height: 56, borderRadius: 8 },
  pendingMediaBadge: { position: 'absolute', left: 4, bottom: 4, width: 19, height: 19, borderRadius: 10, backgroundColor: '#101820B8', alignItems: 'center', justifyContent: 'center' },
  pendingRemove: { position: 'absolute', top: -6, right: -6, width: 18, height: 18, borderRadius: 9, backgroundColor: '#1A1D26', alignItems: 'center', justifyContent: 'center' },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 5, paddingHorizontal: 10, paddingTop: 8, borderTopWidth: StyleSheet.hairlineWidth },
  composerIcon: { width: 32, height: 42, alignItems: 'center', justifyContent: 'center' },
  glassComposerIcon: { width: 38, height: 42, borderRadius: 14, overflow: 'hidden' },
  composerGlassPressable: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  input: { flex: 1, minHeight: 42, maxHeight: 110, borderRadius: 18, paddingHorizontal: 14, paddingTop: 10, paddingBottom: 9, fontSize: 14 },
  composerInputShell: { flex: 1, minHeight: 42, maxHeight: 110, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', paddingHorizontal: 14, borderRadius: 18 },
  mentionToken: { fontSize: 14, lineHeight: 20, fontWeight: '700', marginRight: 5 },
  mentionInput: { minWidth: 80, paddingHorizontal: 0 },
  glassInput: { flex: 1, minHeight: 42, maxHeight: 110, borderRadius: 18, overflow: 'hidden' },
  send: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  glassSend: { width: 42, height: 42, borderRadius: 21, overflow: 'hidden' },
  actionOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.44)', alignItems: 'center', justifyContent: 'center', padding: 28 },
  actionCard: { width: '100%', maxWidth: 340, borderRadius: 22, padding: 18, paddingBottom: 24 },
  actionTitle: { fontSize: 17, fontWeight: '700', textAlign: 'center', marginBottom: 15 },
  actionRow: { minHeight: 52, borderBottomWidth: StyleSheet.hairlineWidth, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8 },
  actionRowText: { fontSize: 15, fontWeight: '600', marginLeft: 12 },
  reportReasons: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  reportReason: { width: '48%', minHeight: 42, borderWidth: 1, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  reportInput: { minHeight: 84, borderWidth: 1, borderRadius: 12, padding: 11, marginTop: 12, textAlignVertical: 'top' },
  reportSubmit: { minHeight: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center', marginTop: 13 },
  reportSubmitText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
});
