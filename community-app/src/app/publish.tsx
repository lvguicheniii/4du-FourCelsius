import { useTheme } from "@/lib/theme";
import type { ReactNode } from 'react';
import { useCallback, useRef, useState, useEffect } from 'react';
import { Pressable } from '@/components/pressable';
import { ScrollView, StyleSheet, Text, TextInput, View, Image, BackHandler, ActivityIndicator, Platform } from 'react-native';
import { Alert } from '@/components/app-alert';
import { Ionicons } from '@expo/vector-icons';
import { LivePhotoIcon } from '@/components/live-photo-icon';
import * as ImagePicker from 'expo-image-picker';
import { launchImageLibrarySafely } from '@/lib/image-picker';
import * as Haptics from 'expo-haptics';
import * as VideoThumbnails from 'expo-video-thumbnails';
import { GridPositions, SortableGrid, SortableGridItem, type SortableGridRenderItemProps } from 'react-native-reanimated-dnd';
import { useRouter, useNavigation, useLocalSearchParams, useFocusEffect } from 'expo-router';
import { ScreenHeader } from '@/components/screen-header';
import { useCommunityConfig } from '@/contexts/community-config';
import { createPost, getPostPublishStatus, uploadFile, uploadMotionPhoto, uploadPairedLivePhoto, reportAchievementEvent, type SliceBox } from '@/api/client';
import { useAuth } from '@/contexts/auth';
import { ConfirmModal } from '@/components/confirm-modal';
import { ReefPickerModal } from '@/components/reef-picker-modal';
import { ReefRoomSummary, ReefShareCard } from '@/components/reef-share-card';
import { BoardIcon } from '@/components/board-icon';
import { validatePickedVideo } from '@/lib/video-media';

type DraftLivePhoto = { stillUri: string; motionUri: string; previewUri?: string };
type SortableMediaItem = { id: string; uri: string; isLive?: boolean };

async function mapWithConcurrency<T, R>(items: T[], limit: number, task: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      results[index] = await task(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function VideoPreview({ posterUri, colors, onRemove }: { posterUri: string | null; colors: any; onRemove: () => void }) {
  return (
    <View style={{ position: 'relative', width: 150, height: 90 }}>
      {posterUri ? <Image source={{ uri: posterUri }} style={{ width: 150, height: 90, borderRadius: 10, backgroundColor: colors.input }} /> : <View style={{ width: 150, height: 90, borderRadius: 10, backgroundColor: colors.input }} />}
      <View style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center' }} pointerEvents="none"><Ionicons name="play-circle" size={34} color="#FFFFFF" /></View>
      <Pressable style={{ position: 'absolute', top: -4, right: -4, backgroundColor: 'rgba(0,0,0,0.65)', borderRadius: 10, width: 20, height: 20, alignItems: 'center', justifyContent: 'center' }} onPress={onRemove}>
        <Ionicons name="close" size={13} color="#FFFFFF" />
      </Pressable>
    </View>
  );
}

function MediaAddButton({ accessibilityLabel, color, disabled, icon, onPress }: {
  accessibilityLabel: string;
  color: string;
  disabled: boolean;
  icon: 'images-outline' | 'videocam-outline';
  onPress: () => void;
}) {
  return <Pressable
    accessibilityLabel={accessibilityLabel}
    accessibilityRole="button"
    disabled={disabled}
    onPress={onPress}
    style={[styles.mediaAddButton, { backgroundColor: color + '10', borderColor: color + '55' }, disabled && styles.mediaAddButtonDisabled]}
  >
    <View style={[styles.mediaAddIconShell, { backgroundColor: color + '18' }]}>
      <Ionicons name={icon} size={29} color={color} />
      <View style={[styles.mediaAddPlus, { backgroundColor: color }]}>
        <Ionicons name="add" size={13} color="#FFFFFF" />
      </View>
    </View>
  </Pressable>;
}

function SortableMediaGrid({ items, trailingItems, colors, onReorder, onRemove }: {
  items: SortableMediaItem[];
  trailingItems: ReactNode[];
  colors: any;
  onReorder: (orderedIds: string[]) => void;
  onRemove: (id: string) => void;
}) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const mediaRows = Math.ceil(items.length / 3);
  const rows = Math.ceil((items.length + trailingItems.length) / 3);
  const finishDrag = useCallback((_id: string, _position: number, positions?: GridPositions) => {
    setActiveId(null);
    if (!positions) return;
    const orderedIds = Object.entries(positions)
      .sort(([, left], [, right]) => left.index - right.index)
      .map(([id]) => id);
    onReorder(orderedIds);
  }, [onReorder]);
  const renderItem = useCallback((props: SortableGridRenderItemProps<SortableMediaItem>) => {
    const { item, id, ...itemProps } = props;
    const active = id === activeId;
    return <SortableGridItem
      key={id}
      id={id}
      data={item}
      {...itemProps}
      activationDelay={240}
      onDragStart={(dragId) => {
        setActiveId(dragId);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
      }}
      onDrop={finishDrag}
      style={[styles.sortableCell, active && styles.sortableCellActive]}
    >
      <Image source={{ uri: item.uri }} style={[styles.sortableImage, { backgroundColor: colors.input }]} />
      {item.isLive ? <View style={styles.liveBadge}><LivePhotoIcon size={21} /></View> : null}
      <Pressable style={styles.mediaRemove} onPress={(event) => { event.stopPropagation(); onRemove(id); }}>
        <Ionicons name="close" size={13} color="#FFFFFF" />
      </Pressable>
    </SortableGridItem>;
  }, [activeId, colors.input, finishDrag, onRemove]);

  return <View style={{ width: '100%', height: rows * 98 }}>
    {items.length > 0 ? <SortableGrid
      data={items}
      renderItem={renderItem}
      dimensions={{ columns: 3, itemWidth: 90, itemHeight: 90, rowGap: 8, columnGap: 8 }}
      scrollEnabled={false}
      style={{ width: '100%', height: mediaRows * 98, overflow: 'visible' }}
      contentContainerStyle={{ overflow: 'visible' }}
    /> : null}
    {trailingItems.map((item, trailingIndex) => {
      const slot = items.length + trailingIndex;
      return <View key={`media-trailing-${trailingIndex}`} style={[styles.mediaTrailingCell, { left: (slot % 3) * 98, top: Math.floor(slot / 3) * 98 }]}>{item}</View>;
    })}
  </View>;
}

export default function PublishScreen() {
  const { boards, dailyTopic, features } = useCommunityConfig();
  const videoUploadEnabled = features.video_upload === true;
  const { isDark, colors } = useTheme();
  const router = useRouter();
  const navigation = useNavigation();
  const { selectedBoard, boardSelection, selectedTopic, topicSelection, selectedSliceBoxId, selectedSliceBoxName, sliceBoxSelection } = useLocalSearchParams<{
    selectedBoard?: string;
    boardSelection?: string;
    selectedTopic?: string;
    topicSelection?: string;
    selectedSliceBoxId?: string;
    selectedSliceBoxName?: string;
    sliceBoxSelection?: string;
  }>();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin';
  const [content, setContent] = useState('');
  const [tags, setTags] = useState<string[]>([]);
  const [topic, setTopic] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [livePhotos, setLivePhotos] = useState<DraftLivePhoto[]>([]);
  const [pendingMediaUris, setPendingMediaUris] = useState<string[]>([]);
  const [videoUri, setVideoUri] = useState<string | null>(null);
  const [videoPosterUri, setVideoPosterUri] = useState<string | null>(null);
  const [videoDurationMs, setVideoDurationMs] = useState(0);
  const [videoMediaId, setVideoMediaId] = useState<string | null>(null);
  const [videoMediaType, setVideoMediaType] = useState<'video' | 'live_photo' | null>(null);
  const [processingMedia, setProcessingMedia] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [publishSucceeded, setPublishSucceeded] = useState(false);
  const [publishLimitMessage, setPublishLimitMessage] = useState('');
  const [reefPickerOpen, setReefPickerOpen] = useState(false);
  const [selectedReefRoom, setSelectedReefRoom] = useState<ReefRoomSummary | null>(null);
  const [selectedSliceBox, setSelectedSliceBox] = useState<SliceBox | null>(null);
  const [discardConfirmOpen, setDiscardConfirmOpen] = useState(false);
  const openingChildPageRef = useRef(false);
  const pendingRemovalActionRef = useRef<any>(null);
  const allowNextRemovalRef = useRef(false);
  const successTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const publishLimitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasContent = content.trim().length > 0 || topic.length > 0 || images.length > 0 || livePhotos.length > 0 || pendingMediaUris.length > 0 || !!videoUri || !!selectedReefRoom;
  const canSubmit = hasContent && !submitted && !processingMedia;
  const hasDraft = hasContent;
  const selectedBoardItem = boards.find(board => board.id === tags[0]);
  const selectedBoardColor = selectedBoardItem
    ? (isDark ? selectedBoardItem.colorDark : selectedBoardItem.color)
    : colors.accent;
  useFocusEffect(useCallback(() => {
    openingChildPageRef.current = false;
  }, []));

  useEffect(() => () => {
    if (successTimerRef.current) clearTimeout(successTimerRef.current);
    if (publishLimitTimerRef.current) clearTimeout(publishLimitTimerRef.current);
  }, []);

  const showPublishLimitMessage = () => {
    if (publishLimitTimerRef.current) clearTimeout(publishLimitTimerRef.current);
    setPublishLimitMessage('44秒内只能发布一份切片！');
    publishLimitTimerRef.current = setTimeout(() => {
      setPublishLimitMessage('');
      publishLimitTimerRef.current = null;
    }, 2000);
  };

  useEffect(() => {
    if (!boardSelection || typeof selectedBoard !== 'string') return;
    setTags(selectedBoard ? [selectedBoard] : []);
  }, [boardSelection, selectedBoard]);

  useEffect(() => {
    if (boardSelection || tags.length > 0) return;
    const nowBoard = boards.find(board => board.name.trim().toUpperCase() === 'NOW');
    if (nowBoard) setTags([nowBoard.id]);
  }, [boardSelection, boards, tags.length]);

  useEffect(() => {
    if (!topicSelection || typeof selectedTopic !== 'string') return;
    setTopic(selectedTopic
      ? (selectedTopic.startsWith('#') ? selectedTopic : `#${selectedTopic}`)
      : '');
  }, [selectedTopic, topicSelection]);

  useEffect(() => {
    if (!sliceBoxSelection || !selectedSliceBoxId || typeof selectedSliceBoxName !== 'string') return;
    setSelectedSliceBox({ id: selectedSliceBoxId, name: selectedSliceBoxName, postCount: 0 });
  }, [selectedSliceBoxId, selectedSliceBoxName, sliceBoxSelection]);

  useEffect(() => {
    const unsub = navigation.addListener('beforeRemove', (e: any) => {
      if (allowNextRemovalRef.current) {
        allowNextRemovalRef.current = false;
        return;
      }
      if (openingChildPageRef.current || !navigation.isFocused() || submitted || !hasDraft) return;
      e.preventDefault();
      pendingRemovalActionRef.current = e.data.action;
      setDiscardConfirmOpen(true);
    });
    return unsub;
  }, [navigation, hasDraft, submitted]);

  useEffect(() => {
    const backHandler = BackHandler.addEventListener('hardwareBackPress', () => {
      if (openingChildPageRef.current || !navigation.isFocused() || submitted || !hasDraft) return false;
      pendingRemovalActionRef.current = null;
      setDiscardConfirmOpen(true);
      return true;
    });
    return () => backHandler.remove();
  }, [hasDraft, navigation, submitted, router]);

  const pickImages = async () => {
    if (processingMedia || videoUri || images.length + livePhotos.length >= 9) return;
    const remainingSlots = Math.max(0, 9 - images.length - livePhotos.length);
    // iOS only returns pairedVideoAsset reliably for a single Live Photo
    // selection. Users can press the image button repeatedly for up to 9
    // ordinary images.
    const result = await launchImageLibrarySafely({
      mediaTypes: ['images', 'livePhotos'],
      allowsMultipleSelection: Platform.OS === 'android',
      selectionLimit: Platform.OS === 'android' ? remainingSlots : 1,
      // Android Motion Photos store their video inside the original JPEG.
      // Re-encoding here strips that track, so Android must keep quality 1.
      quality: Platform.OS === 'android' ? 1 : 0.75,
      exif: true,
      preferredAssetRepresentationMode: ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
    });
    if (result.canceled || !result.assets.length) return;
    // Some Android gallery providers ignore selectionLimit and return their
    // whole selection history. Clamp before rendering processing thumbnails.
    const selectedAssets = result.assets.slice(0, remainingSlots);
    for (const asset of selectedAssets) {
      if (!asset.pairedVideoAsset?.uri) continue;
      const validationError = await validatePickedVideo(asset.pairedVideoAsset, { livePhoto: true });
      if (validationError) { Alert.alert('无法添加实况照片', validationError); return; }
    }
    const selectedUris = selectedAssets.map(asset => asset.uri);
    const progressStartedAt = Date.now();
    setPendingMediaUris(current => [...current, ...selectedUris]);
    setProcessingMedia(true);
    await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    const pickedLive = selectedAssets.filter(asset => asset.pairedVideoAsset?.uri || asset.type === 'livePhoto');
    const ordinary = selectedAssets.filter(asset => !asset.pairedVideoAsset?.uri && asset.type !== 'livePhoto');
    const newLive: DraftLivePhoto[] = pickedLive.filter(asset => asset.pairedVideoAsset?.uri).map(asset => ({ stillUri: asset.uri, motionUri: asset.pairedVideoAsset!.uri }));
    const probeAssets = pickedLive.filter(asset => !asset.pairedVideoAsset?.uri);
    if (Platform.OS === 'android') {
      // Expo cannot expose Android Motion Photo pairs. Let the server inspect
      // every original JPEG so one picker can reliably handle both kinds.
      probeAssets.push(...ordinary.splice(0));
    }
    if (probeAssets.length) {
      const probed = await mapWithConcurrency(probeAssets, 2, async asset => {
        try {
          const motion = await uploadMotionPhoto(asset.uri, 'post');
          return { kind: 'live' as const, value: { stillUri: motion.stillUrl, motionUri: motion.motionUrl, previewUri: asset.uri } as DraftLivePhoto };
        } catch (error) {
          if ((error as { code?: string })?.code === 'NOT_MOTION_PHOTO') {
            return { kind: 'ordinary' as const, value: asset };
          }
          return { kind: 'error' as const, value: asset };
        }
      });
      probed.forEach(result => {
        if (result.kind === 'live') newLive.push(result.value);
        if (result.kind === 'ordinary') ordinary.push(result.value);
      });
      if (probed.some(result => result.kind === 'error')) {
        Alert.alert('部分照片处理失败', '动态照片暂时无法处理，请稍后重试');
      }
    }
    const finishDelay = Math.max(0, 450 - (Date.now() - progressStartedAt));
    setTimeout(() => requestAnimationFrame(() => {
      setPendingMediaUris(current => current.filter(uri => !selectedUris.includes(uri)));
      if (newLive.length) setLivePhotos(current => [...current, ...newLive].slice(0, 9 - images.length));
      if (ordinary.length) setImages(current => [...current, ...ordinary.map(asset => asset.uri)].slice(0, 9 - livePhotos.length - newLive.length));
      setProcessingMedia(false);
    }), finishDelay);
  };

  const pickVideo = async () => {
    if (videoUri || images.length || livePhotos.length || processingMedia) return;
    const result = await launchImageLibrarySafely({ mediaTypes: ['videos'], allowsMultipleSelection: false, quality: 0.85 });
    if (result.canceled || !result.assets?.[0]) return;
    const video = result.assets[0];
    const validationError = await validatePickedVideo(video);
    if (validationError) { Alert.alert('无法添加视频', validationError); return; }
    setVideoUri(video.uri); setVideoMediaId(null); setVideoMediaType('video'); setVideoDurationMs(Math.round(video.duration || 0));
    try { setVideoPosterUri((await VideoThumbnails.getThumbnailAsync(video.uri, { time: 400, quality: 0.6 })).uri); } catch { setVideoPosterUri(null); }
  };

  const discardDraft = () => {
    if (content.length > 50) reportAchievementEvent('words_unsaid').catch(() => {});
    setDiscardConfirmOpen(false);
    allowNextRemovalRef.current = true;
    const action = pendingRemovalActionRef.current;
    pendingRemovalActionRef.current = null;
    if (action) navigation.dispatch(action);
    else router.back();
  };

  const handleSubmit = async () => {
    if (publishLimitTimerRef.current) {
      clearTimeout(publishLimitTimerRef.current);
      publishLimitTimerRef.current = null;
    }
    setPublishLimitMessage('');
    setSubmitted(true);
    try {
      const publishStatus = await getPostPublishStatus();
      if (!publishStatus.canPublish) {
        showPublishLimitMessage();
        setSubmitted(false);
        return;
      }
      // 先上传图片
      let imgUrls: string[] = [];
      let thumbUrls: string[] = [];
      try {
        const uploadedImages = await mapWithConcurrency(images, 3, uri => uploadFile(uri));
        imgUrls = uploadedImages.map(result => result.url);
        thumbUrls = uploadedImages.map(result => result.thumbUrl || result.url);
      } catch (e: any) {
        console.log('Upload failed:', e?.message);
        Alert.alert('上传失败', e?.message || '图片上传失败，请重试');
        setSubmitted(false);
        return;
      }
      let uploadedVideo: { url: string; thumbUrl?: string; mediaId?: string | null; durationMs?: number } | null = null;
      let uploadedLivePhotos: { stillUrl: string; motionUrl: string }[] = [];
      try {
        uploadedLivePhotos = await mapWithConcurrency(livePhotos, 2, async item => {
          const uploaded = await uploadPairedLivePhoto(item.stillUri, item.motionUri, 'post');
          return { stillUrl: uploaded.stillUrl, motionUrl: uploaded.motionUrl };
        });
      } catch (e: any) {
        Alert.alert('实况照片上传失败', e?.message || '请稍后重试');
        setSubmitted(false);
        return;
      }
      if (videoUri) {
        try { uploadedVideo = /^(https?:\/\/|\/uploads\/)/i.test(videoUri) ? { url: videoUri, mediaId: videoMediaId } : await uploadFile(videoUri, 'vp'); }
        catch (e: any) { Alert.alert('视频上传失败', e?.message || '请重试'); setSubmitted(false); return; }
      }
      // 创建帖子
      const body = content.trim();
      await createPost({
        content: topic
          ? `${topic}${body ? `\n${body}` : ''}`
          : (body || (imgUrls.length > 0 ? '分享了图片' : '')),
        images: imgUrls,
        thumbnails: thumbUrls,
        livePhotos: uploadedLivePhotos,
        videoUrl: uploadedVideo?.url,
        // Local preview posters are only for the editor. The server already
        // creates a compressed poster while transcoding, avoiding a duplicate
        // COS object and upload. Preserve remote posters from Motion Photos.
        videoPoster: uploadedVideo?.thumbUrl || (videoPosterUri && /^(https?:\/\/|\/uploads\/)/i.test(videoPosterUri) ? videoPosterUri : undefined),
        videoDurationMs: uploadedVideo?.durationMs || videoDurationMs,
        videoMediaId: uploadedVideo?.mediaId || undefined,
        videoMediaType: videoMediaType || undefined,
        boardId: tags.length > 0 ? JSON.stringify(tags) : '["free"]',
        reefRoomId: selectedReefRoom?.id,
        sliceBoxId: selectedSliceBox?.id,
      });
      setPublishSucceeded(true);
      successTimerRef.current = setTimeout(() => {
        setContent('');
        setTags([]);
        setTopic('');
        setImages([]);
        setLivePhotos([]);
        setVideoUri(null);
        setVideoPosterUri(null);
        setVideoMediaId(null);
        setVideoMediaType(null);
        setSelectedReefRoom(null);
        setSelectedSliceBox(null);
        router.dismissTo({
          pathname: '/',
          params: {
            feedTab: 'latest',
            refreshFeed: Date.now().toString(),
          },
        });
      }, 800);
    } catch (error: any) {
      setSubmitted(false);
      setPublishSucceeded(false);
      if (error?.status === 429 && error?.payload?.code === 'POST_PUBLISH_COOLDOWN') {
        showPublishLimitMessage();
        return;
      }
      Alert.alert('发布失败', '切片没有成功发布，请稍后重试');
    }
  };

  const sortableMediaItems: SortableMediaItem[] = [
    ...images.map(uri => ({ id: `image:${uri}`, uri })),
    ...livePhotos.map(item => ({ id: `live:${item.stillUri}`, uri: item.previewUri || item.stillUri, isLive: true })),
  ];
  const visibleMediaCount = images.length + livePhotos.length + pendingMediaUris.length;
  const trailingMediaItems: ReactNode[] = pendingMediaUris.map((uri, index) => (
    <View key={`pending-${uri}-${index}`} style={styles.pendingMediaThumb}>
      <Image source={{ uri }} style={styles.pendingMediaImage} />
      <View style={styles.pendingMediaOverlay}>
        <View style={styles.pendingMediaProgress}><ActivityIndicator size="small" color="#FFFFFF" /></View>
      </View>
    </View>
  ));
  if (!videoUri && visibleMediaCount < 9) {
    trailingMediaItems.push(<MediaAddButton key="add-image" accessibilityLabel="添加图片或实况照片" color={colors.accent} disabled={processingMedia} icon="images-outline" onPress={pickImages} />);
  }
  if (videoUploadEnabled && !videoUri && visibleMediaCount === 0) {
    const videoColor = isDark ? '#9AAAF2' : '#6878C8';
    trailingMediaItems.push(<MediaAddButton key="add-video" accessibilityLabel="添加视频" color={videoColor} disabled={processingMedia} icon="videocam-outline" onPress={pickVideo} />);
  }

  const reorderMedia = (orderedIds: string[]) => {
    const orderedImages = orderedIds.filter(id => id.startsWith('image:')).map(id => id.slice(6));
    const orderedLivePhotos = orderedIds.filter(id => id.startsWith('live:')).map(id => id.slice(5));
    setImages(orderedImages);
    setLivePhotos(current => orderedLivePhotos.map(stillUri => current.find(item => item.stillUri === stillUri)).filter((item): item is DraftLivePhoto => !!item));
  };

  const removeMedia = (id: string) => {
    if (id.startsWith('image:')) setImages(current => current.filter(uri => uri !== id.slice(6)));
    if (id.startsWith('live:')) setLivePhotos(current => current.filter(item => item.stillUri !== id.slice(5)));
  };

  return (
    <>
      <ScreenHeader
        title="制备"
        floating
        floatingSpacer={Platform.OS === 'android' ? 68 : 88}
        rightWidth={54}
        right={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="发布切片"
            style={styles.headerSubmit}
            disabled={!canSubmit}
            onPress={handleSubmit}
          >
            {submitted ? (
              <ActivityIndicator size="small" color={colors.accent} />
            ) : (
              <Text style={[
                styles.headerSubmitText,
                { color: canSubmit ? colors.accent : colors.textMuted },
              ]}>
                发布
              </Text>
            )}
          </Pressable>
        }
      />
      {!!publishLimitMessage && (
        <View style={[styles.publishLimitNotice, { backgroundColor: colors.danger + '12' }]}>
          <Text style={[styles.publishLimitNoticeText, { color: colors.danger }]}>
            {publishLimitMessage}
          </Text>
        </View>
      )}
      {publishSucceeded && (
        <View style={[styles.successNotice, {
          backgroundColor: colors.accent + '12',
          borderBottomColor: colors.accent + '30',
        }]}>
          <Ionicons name="checkmark-circle-outline" size={14} color={colors.accent} />
          <Text style={[styles.successNoticeText, { color: colors.accent }]}>
            切片制备完毕，正在推入浮霜带
          </Text>
        </View>
      )}
    <ScrollView
      contentContainerStyle={{
        paddingHorizontal: 12,
        paddingBottom: 12,
        paddingTop: Platform.OS === 'android' ? 8 : 12,
        backgroundColor: colors.bg,
      }}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="always"
      keyboardDismissMode="none"
    >
      {dailyTopic && (
        <Pressable
          style={[styles.dailyTopic, { backgroundColor: colors.accent + '12', borderColor: colors.accent + '35' }]}
          onPress={() => {
            setTopic(`#${dailyTopic.title.replace(/^#/, '')}`);
          }}
        >
          <View style={[styles.dailyTopicIcon, { backgroundColor: colors.accent + '20' }]}>
            <Ionicons name="sparkles-outline" size={18} color={colors.accent} />
          </View>
          <View style={{ flex: 1 }}>
            <Text style={[styles.dailyTopicLabel, { color: colors.accent }]}>今日话题 · #{dailyTopic.title.replace(/^#/, '')}</Text>
          </View>
          <Ionicons name="add-circle-outline" size={20} color={colors.accent} />
        </Pressable>
      )}
      <View style={[styles.card, { backgroundColor: colors.card }]}>
        {!!topic && (
          <View style={styles.selectedTopicRow}>
            <Text style={[styles.selectedTopic, { color: colors.accent }]} numberOfLines={1}>
              {topic}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="移除已选话题"
              hitSlop={8}
              style={[styles.removeTopic, { backgroundColor: colors.input, borderColor: colors.divider }]}
              onPress={() => setTopic('')}
            >
              <Ionicons name="close" size={12} color={colors.textMuted} />
            </Pressable>
          </View>
        )}
        <TextInput
          style={[styles.input, { color: colors.text }]}
          multiline
          placeholder="分享你的想法……"
          placeholderTextColor={colors.textMuted}
          value={content}
          onChangeText={setContent}
          maxLength={4444}
        />
        <Text style={[styles.counter, { color: colors.textMuted }]}>{content.length}/4444</Text>

        {selectedReefRoom && (
          <View>
            <ReefShareCard roomId={selectedReefRoom.id} initialRoom={selectedReefRoom} />
            <Pressable accessibilityLabel="移除礁石卡片" style={[styles.removeReef, { backgroundColor: colors.card }]} onPress={() => setSelectedReefRoom(null)}>
              <Ionicons name="close" size={15} color={colors.textMuted} />
            </Pressable>
          </View>
        )}

        <View style={styles.mediaArea}>
          {videoUri ? <VideoPreview posterUri={videoPosterUri} colors={colors} onRemove={() => { setVideoUri(null); setVideoPosterUri(null); setVideoMediaId(null); }} /> : null}
          {!videoUri && (sortableMediaItems.length > 0 || trailingMediaItems.length > 0) ? <SortableMediaGrid
            items={sortableMediaItems}
            trailingItems={trailingMediaItems}
            colors={colors}
            onReorder={reorderMedia}
            onRemove={removeMedia}
          /> : null}
        </View>
      </View>

      <View style={styles.selectorRow}>
        <Pressable
          style={[styles.selectorButton, { backgroundColor: colors.card }]}
          onPress={() => {
            openingChildPageRef.current = true;
            router.push({
              pathname: '/select-board',
              params: { selected: tags[0] || (isAdmin ? 'announce' : '') },
            });
          }}
        >
          <View style={[styles.selectorIcon, {
            backgroundColor: selectedBoardItem
              ? (isDark ? selectedBoardItem.color + '28' : selectedBoardColor)
              : colors.accent + (isDark ? '28' : '18'),
            borderWidth: selectedBoardItem && isDark ? 1 : 0,
            borderColor: selectedBoardColor + '55',
          }]}>
            <BoardIcon
              name={selectedBoardItem?.icon || 'grid-outline'}
              size={20}
              color={selectedBoardItem ? (isDark ? selectedBoardColor : '#FFFFFF') : colors.accent}
            />
          </View>
          <Text
            style={[styles.selectorTitle, { color: selectedBoardItem ? selectedBoardColor : colors.text }]}
            numberOfLines={1}
          >
            {selectedBoardItem?.name || '冰格'}
          </Text>
          <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
        </Pressable>

        <Pressable
          style={[styles.selectorButton, { backgroundColor: colors.card }]}
          onPress={() => {
            openingChildPageRef.current = true;
            router.push({
              pathname: '/select-topic',
              params: { selected: topic },
            });
          }}
        >
          <View style={[styles.selectorIcon, {
            backgroundColor: colors.accent + (isDark ? '28' : '18'),
            borderWidth: isDark ? 1 : 0,
            borderColor: colors.accent + '55',
          }]}>
            <Text style={[styles.topicIcon, { color: colors.accent }]}>#</Text>
          </View>
          <Text style={[styles.selectorTitle, { color: colors.text }]}>话题</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
        </Pressable>

        <Pressable style={[styles.selectorButton, { backgroundColor: colors.card }]} onPress={() => setReefPickerOpen(true)}>
          <View style={[styles.selectorIcon, { backgroundColor: colors.accent + (isDark ? '28' : '18'), borderWidth: isDark ? 1 : 0, borderColor: colors.accent + '55' }]}>
            <Ionicons name="layers-outline" size={20} color={colors.accent} />
          </View>
          <Text style={[styles.selectorTitle, { color: selectedReefRoom ? colors.accent : colors.text }]} numberOfLines={1}>{selectedReefRoom?.name || '礁石'}</Text>
          <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
        </Pressable>

        <Pressable
          style={[styles.selectorButton, { backgroundColor: colors.card }]}
          onPress={() => {
            openingChildPageRef.current = true;
            router.push({ pathname: '/slice-boxes', params: { mode: 'select' } });
          }}
        >
          <View style={[styles.selectorIcon, { backgroundColor: colors.accent + (isDark ? '28' : '18'), borderWidth: isDark ? 1 : 0, borderColor: colors.accent + '55' }]}>
            <Ionicons name="file-tray-stacked-outline" size={20} color={colors.accent} />
          </View>
          <Text style={[styles.selectorTitle, { color: selectedSliceBox ? colors.accent : colors.text }]} numberOfLines={1}>{selectedSliceBox?.name || '切片盒'}</Text>
          {selectedSliceBox ? (
            <Pressable
              accessibilityLabel="移除切片盒"
              hitSlop={8}
              onPress={(event) => { event.stopPropagation(); setSelectedSliceBox(null); }}
            >
              <Ionicons name="close-circle" size={17} color={colors.textMuted} />
            </Pressable>
          ) : <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />}
        </Pressable>
      </View>

    </ScrollView>
      <ConfirmModal
        visible={discardConfirmOpen}
        title="放弃发布？"
        message="当前编辑的内容将不会保存，离开后无法恢复。"
        cancelText="继续编辑"
        confirmText="放弃"
        tone="danger"
        icon="close-circle-outline"
        onCancel={() => {
          pendingRemovalActionRef.current = null;
          setDiscardConfirmOpen(false);
        }}
        onConfirm={discardDraft}
      />
      <ReefPickerModal visible={reefPickerOpen} onClose={() => setReefPickerOpen(false)} onSelect={setSelectedReefRoom} />
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: 14,
    padding: 14,
    marginBottom: 12,
  },
  input: {
    minHeight: 120,
    fontSize: 15,
    lineHeight: 23,
    textAlignVertical: 'top',
  },
  counter: { fontSize: 12, textAlign: 'right', marginTop: 6 },
  imagePicker: {
    marginTop: 10,
    height: 90,
    borderRadius: 10,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#D5D8E2',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FAFBFD',
  },
  imagePickerText: { fontSize: 13, color: '#6B7185', marginTop: 4 },
  mediaArea: { marginTop: 10, width: '100%' },
  mediaAddButton: { width: 90, height: 90, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  mediaAddButtonDisabled: { opacity: 0.45 },
  mediaAddIconShell: { width: 52, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  mediaAddPlus: { position: 'absolute', right: -3, bottom: -3, width: 21, height: 21, borderRadius: 11, borderWidth: 2, borderColor: '#FFFFFF', alignItems: 'center', justifyContent: 'center' },
  mediaTrailingCell: { position: 'absolute', width: 90, height: 90, zIndex: 5 },
  pendingMediaThumb: { position: 'relative', width: 90, height: 90, borderRadius: 10, overflow: 'hidden' },
  pendingMediaImage: { width: 90, height: 90, borderRadius: 10 },
  pendingMediaOverlay: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(5,16,26,0.42)', alignItems: 'center', justifyContent: 'center' },
  pendingMediaProgress: { width: 38, height: 38, borderRadius: 19, backgroundColor: 'rgba(20,36,48,0.72)', borderWidth: 2, borderColor: 'rgba(142,220,255,0.72)', alignItems: 'center', justifyContent: 'center' },
  liveBadge: { position: 'absolute', left: 5, top: 5, width: 22, height: 22, alignItems: 'center', justifyContent: 'center' },
  sortableCell: { position: 'relative', width: 90, height: 90, borderRadius: 10 },
  sortableCellActive: { zIndex: 20, elevation: 16, opacity: 0.98, transform: [{ scale: 1.07 }], shadowColor: '#07131C', shadowOpacity: 0.28, shadowRadius: 14, shadowOffset: { width: 0, height: 8 } },
  sortableImage: { width: 90, height: 90, borderRadius: 10 },
  mediaRemove: { position: 'absolute', top: 2, right: 2, backgroundColor: 'rgba(0,0,0,0.65)', borderRadius: 10, width: 20, height: 20, alignItems: 'center', justifyContent: 'center' },
  headerSubmit: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  headerSubmitText: { fontSize: 14, fontWeight: '700' },
  selectorRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginBottom: 12,
  },
  selectedTopicRow: { minHeight: 25, flexDirection: 'row', alignItems: 'flex-start', marginBottom: 2 },
  selectedTopic: { flex: 1, minWidth: 0, fontSize: 15, lineHeight: 23, fontWeight: '600', paddingRight: 8 },
  removeTopic: { width: 20, height: 20, borderRadius: 10, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  dailyTopic: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderWidth: 1, borderRadius: 14, padding: 11, marginBottom: 10,
  },
  dailyTopicIcon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  dailyTopicLabel: { fontSize: 12, fontWeight: '700' },
  selectorButton: {
    flexGrow: 0,
    flexShrink: 0,
    flexBasis: '48%',
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 11,
  },
  selectorIcon: {
    width: 34,
    height: 34,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  selectorTitle: { flex: 1, minWidth: 0, fontSize: 14, fontWeight: '600', marginLeft: 8 },
  topicIcon: { fontSize: 21, lineHeight: 24, fontWeight: '800' },
  removeReef: { position: 'absolute', top: 4, right: -5, width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  successNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 28,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  successNoticeText: { fontSize: 11, lineHeight: 16, fontWeight: '500', marginLeft: 5 },
  publishLimitNotice: {
    minHeight: 30,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  publishLimitNoticeText: { fontSize: 12, lineHeight: 18, fontWeight: '600' },
});
