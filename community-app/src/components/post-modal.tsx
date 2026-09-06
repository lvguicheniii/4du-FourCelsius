import { useMemo, useState } from 'react';
import { Modal, FlatList, Image, Platform, Pressable, StyleSheet, Text, TextInput, View, Dimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { useRouter } from 'expo-router';
import { posts, boardName, comments as allComments, boards, Comment } from '@/data/mock';
import { isBlocked, isReported, setBlocked, selectPost } from '@/data/store';
import { PostActionsSheet } from '@/components/post-actions';
import { ImageViewer } from '@/components/image-viewer';
import { PostContentText } from '@/components/post-content-text';
import { useTheme } from '@/lib/theme';
import type { ThemeColors } from '@/lib/theme';

const { width: SW, height: SH } = Dimensions.get('window');
const CARD_W = Math.min(SW - 32, 400);
const CARD_H = Math.min(SH * 0.66, 600);

const themed = (c: ThemeColors, dark: boolean) => ({
  overlay: { flex: 1 },
  cardWrap: { flex: 1, justifyContent: 'center' as const, alignItems: 'center' as const, paddingHorizontal: 20 },
  card: { backgroundColor: c.card, borderRadius: 18, width: CARD_W, maxHeight: CARD_H, overflow: 'hidden' as const },
  author: { fontSize: 15, fontWeight: '600' as const, color: c.text },
  meta: { fontSize: 12, color: c.textMuted, marginTop: 2 },
  content: { fontSize: 15, lineHeight: 24, color: c.text, paddingHorizontal: 16, paddingBottom: 12 },
  actions: { flexDirection: 'row' as const, paddingVertical: 10, paddingHorizontal: 8, borderTopWidth: 1, borderTopColor: c.divider },
  actionText: { fontSize: 13, color: c.textMuted, marginLeft: 5 },
  commentSection: { borderTopWidth: 1, borderTopColor: c.divider, paddingHorizontal: 12, paddingTop: 10 },
  commentTitle: { fontSize: 14, fontWeight: '600' as const, color: c.text, marginBottom: 8, paddingHorizontal: 4 },
  commentRow: { flexDirection: 'row' as const, paddingHorizontal: 4, paddingVertical: 8 },
  commentAuthor: { fontSize: 13, fontWeight: '600' as const, color: c.textMuted },
  commentContent: { fontSize: 14, lineHeight: 20, color: c.text, marginTop: 2 },
  commentTime: { fontSize: 11, color: c.textMuted, marginTop: 3 },
  commentLikeText: { fontSize: 11, color: c.textMuted, marginTop: 2 },
  inputBar: { flexDirection: 'row' as const, alignItems: 'center' as const, borderTopWidth: 1, borderTopColor: c.divider, paddingHorizontal: 12, paddingVertical: 8 },
  commentInput: { flex: 1, backgroundColor: c.input, borderRadius: 16, paddingHorizontal: 12, paddingVertical: 7, fontSize: 13, color: c.text },
  mutedIcon: c.textMuted as string,
});

function CmtRow({ item, c, onBlockUser }: { item: Comment; c: ReturnType<typeof themed>; onBlockUser: (name: string) => void }) {
  const router = useRouter();
  const [liked, setLiked] = useState(false);
  const [menu, setMenu] = useState(false);
  return (
    <Pressable style={c.commentRow} onLongPress={() => setMenu(true)} delayLongPress={500}>
      <Pressable onPress={() => { selectPost(null); router.push({ pathname: '/user/[name]', params: { name: item.author } }); }}>
        <View style={[s2.smallAvatar, { backgroundColor: item.avatarColor }]}>
          <Text style={s2.smallAvatarText}>{item.author[0]}</Text>
        </View>
      </Pressable>
      <View style={{ flex: 1, marginLeft: 8 }}>
        <Text style={c.commentAuthor}>{item.author}</Text>
        <Text style={c.commentContent}>{item.content}</Text>
        <Text style={c.commentTime}>{item.time}</Text>
      </View>
      <Pressable style={s2.commentLike} onPress={() => setLiked(!liked)}>
        <Ionicons name={liked ? 'heart' : 'heart-outline'} size={14} color={liked ? '#E24B4A' : '#C4C8D4'} />
        <Text style={c.commentLikeText}>{item.likes + (liked ? 1 : 0)}</Text>
      </Pressable>
      <Modal visible={menu} transparent animationType="fade">
        <Pressable style={s3.overlay} onPress={() => setMenu(false)}>
          <View style={[s3.box, { backgroundColor: c.card.backgroundColor }]}>
            <Pressable style={[s3.row, { borderBottomColor: (c as any).divider ?? '#F2F3F7' }]} onPress={() => setMenu(false)}>
              <Ionicons name="flag-outline" size={18} color="#BA7517" />
              <Text style={s3.rowText}>举报评论</Text>
            </Pressable>
            <Pressable style={s3.row} onPress={() => { setMenu(false); onBlockUser(item.author); }}>
              <Ionicons name="ban-outline" size={18} color="#E24B4A" />
              <Text style={[s3.rowText, { color: '#E24B4A' }]}>拉黑 {item.author}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </Pressable>
  );
}

export function PostDetailModal({ postId }: { postId: string }) {
  const router = useRouter();
  const { colors, isDark } = useTheme();
  const c = useMemo(() => themed(colors, isDark), [colors, isDark]);
  const post = posts.find((p) => p.id === postId);
  const [liked, setLiked] = useState(false);
  const [draft, setDraft] = useState('');
  const [sheetOpen, setSheetOpen] = useState(false);
  const [viewImage, setViewImage] = useState<string | null>(null);
  const [extraComments, setExtraComments] = useState<Comment[]>([]);

  if (!post) return null;

  const postComments = [...allComments.filter((cm) => cm.postId === post.id), ...extraComments];
  const boardColor = boards.find((b) => b.id === post.boardId)?.color ?? '#33A9DC';

  const sendComment = () => {
    const text = draft.trim();
    if (!text) return;
    setExtraComments((prev) => [...prev, { id: `local-${Date.now()}`, postId: post.id, author: '示例用户', avatarColor: '#33A9DC', time: '刚刚', content: text, likes: 0 }]);
    setDraft('');
  };

  const close = () => selectPost(null);

  return (
    <Modal visible={true} transparent animationType="fade" onRequestClose={close} statusBarTranslucent>
      <BlurView intensity={60} tint="default" style={c.overlay}>
        <Pressable style={c.cardWrap} onPress={close}>
          <Pressable style={c.card} onPress={() => {}}>
            <View style={s2.headerRow}>
              <Pressable style={{ flexDirection: 'row', alignItems: 'center', flex: 1 }} onPress={() => { close(); router.push({ pathname: '/user/[name]', params: { name: post.author } }); }}>
                <View style={[s2.avatar, { backgroundColor: post.avatarColor }]}>
                  <Text style={s2.avatarText}>{post.author[0]}</Text>
                </View>
                <View>
                  <Text style={c.author}>{post.author}</Text>
                  <Text style={c.meta}>{post.time}</Text>
                </View>
              </Pressable>
              <Pressable style={[s2.boardTag, { backgroundColor: boardColor + '20' }]} onPress={() => { close(); router.push({ pathname: '/board/[id]', params: { id: post.boardId } }); }}>
                <Text style={[s2.boardTagText, { color: boardColor }]}>{boardName(post.boardId)}</Text>
              </Pressable>
              <Pressable style={s2.closeBtn} onPress={close}>
                <Ionicons name="close" size={22} color="#9AA0B4" />
              </Pressable>
            </View>
            <PostContentText content={post.content} style={c.content} numberOfLines={5} />
            {post.image && <Pressable onPress={() => setViewImage(post.image!)}><Image source={{ uri: post.image }} style={s2.postImage} /></Pressable>}
            <View style={c.actions}>
              <Pressable style={s2.actionBtn} onPress={() => setLiked(!liked)}>
                <Ionicons name={liked ? 'heart' : 'heart-outline'} size={20} color={liked ? '#E24B4A' : c.mutedIcon} />
                <Text style={[c.actionText, liked && { color: '#E24B4A' }]}>{post.likes + (liked ? 1 : 0)}</Text>
              </Pressable>
              <View style={{ flex: 1 }} />
              <Pressable style={s2.actionBtn} onPress={() => setSheetOpen(true)}>
                <Ionicons name="ellipsis-horizontal" size={18} color={c.mutedIcon} />
              </Pressable>
            </View>
            <View style={c.commentSection}>
              <Text style={c.commentTitle}>评论 {postComments.length}</Text>
              <FlatList data={postComments} keyExtractor={(item) => item.id} renderItem={({ item }) => <CmtRow item={item} c={c} onBlockUser={(n) => setBlocked(n, true)} />} style={{ maxHeight: 180 }} showsVerticalScrollIndicator={false} />
            </View>
            <View style={c.inputBar}>
              <TextInput style={c.commentInput} placeholder="说点什么..." placeholderTextColor="#9AA0B4" value={draft} onChangeText={setDraft} onSubmitEditing={sendComment} />
              <Pressable style={[s2.sendBtn, !draft.trim() && { backgroundColor: '#C4C8D4' }]} disabled={!draft.trim()} onPress={sendComment}>
                <Text style={s2.sendBtnText}>发送</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
        <PostActionsSheet visible={sheetOpen} onClose={() => { setSheetOpen(false); if (isReported(post.id) || isBlocked(post.author)) close(); }} postId={post.id} author={post.author} authorId={post.authorUid} onBlocked={close} />
      </BlurView>
      <ImageViewer images={viewImage ? [viewImage] : []} index={0} visible={!!viewImage} onClose={() => setViewImage(null)} />
    </Modal>
  );
}

const s2 = StyleSheet.create({
  headerRow: { flexDirection: 'row', alignItems: 'center', padding: 14, paddingBottom: 0 },
  avatar: { width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  avatarText: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
  boardTag: { paddingHorizontal: 9, paddingVertical: 3, borderRadius: 10 },
  boardTagText: { fontSize: 11, fontWeight: '500' },
  closeBtn: { padding: 4, marginLeft: 6 },
  postImage: { width: CARD_W - 32, height: 170, borderRadius: 10, marginHorizontal: 16, marginTop: 8, marginBottom: 4, backgroundColor: '#EDEEF3', alignSelf: 'center' as const },
  actionBtn: { flexDirection: 'row', alignItems: 'center' },
  smallAvatar: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  smallAvatarText: { color: '#FFFFFF', fontSize: 12, fontWeight: '600' },
  commentLike: { alignItems: 'center', marginLeft: 6 },
  sendBtn: { backgroundColor: '#33A9DC', borderRadius: 14, paddingHorizontal: 14, paddingVertical: 7, marginLeft: 8 },
  sendBtnText: { color: '#FFFFFF', fontSize: 13, fontWeight: '500' },
});

const s3 = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 40 },
  box: { borderRadius: 16, paddingVertical: 10, width: '100%', maxWidth: 300 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 20, borderBottomWidth: StyleSheet.hairlineWidth },
  rowText: { fontSize: 15, marginLeft: 10, color: '#1A1D26' },
});
