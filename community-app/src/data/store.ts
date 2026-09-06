import { ChatMessage, Post, myPosts, posts, seedChats, comments, Comment } from './mock';
import { useState, useEffect } from 'react';

export const chatStore: Record<string, ChatMessage[]> = Object.fromEntries(
  Object.entries(seedChats).map(([k, v]) => [k, [...v]])
);

export function getChat(name: string): ChatMessage[] {
  if (!chatStore[name]) chatStore[name] = [];
  return chatStore[name];
}

export function appendMessage(name: string, msg: ChatMessage) {
  getChat(name).push(msg);
  // 更新对话列表
  const existing = _conversations.findIndex(c => c.name === name);
  const entry = {
    id: `conv-${name}`,
    name,
    avatarColor: '#33A9DC',
    lastMessage: msg.kind === 'text' ? msg.content : msg.kind === 'image' ? '[图片]' : '[贴纸]',
    time: '',
    unread: 0,
  };
  if (existing >= 0) {
    _conversations[existing] = entry;
  } else {
    _conversations.unshift(entry);
  }
  // 触发更新
  version++;
  listeners.forEach((fn) => fn());
  _conversationListeners.forEach((fn) => fn());
}

// 对话列表
const _conversations: { id: string; name: string; avatarColor: string; lastMessage: string; time: string; unread: number }[] = [];
const _conversationListeners: (() => void)[] = [];

export function getConversations() {
  return _conversations;
}

export function subscribeConversations(fn: () => void) {
  _conversationListeners.push(fn);
  return () => {
    const i = _conversationListeners.indexOf(fn);
    if (i >= 0) _conversationListeners.splice(i, 1);
  };
}

export const myStickers: string[] = [];

export const postPrivateState: Record<string, boolean> = {};

export function isPostPrivate(postId: string): boolean {
  return !!postPrivateState[postId];
}
export function togglePostPrivate(postId: string): boolean {
  postPrivateState[postId] = !postPrivateState[postId];
  bump();
  return postPrivateState[postId];
}
export function setPostPrivate(postId: string, value: boolean): void {
  postPrivateState[postId] = value;
  bump();
}
export function deleteUserPost(postId: string): void {
  const idx = userPosts.findIndex((p) => p.id === postId);
  if (idx >= 0) userPosts.splice(idx, 1);
  const idx2 = posts.findIndex((p) => p.id === postId);
  if (idx2 >= 0) posts.splice(idx2, 1);
  postCache.delete(postId);
  bump();
}

let version = 0;
let structuralVersion = 0;
const listeners = new Set<() => void>();

export function subscribeStore(fn: () => void) {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function getStoreVersion() {
  return version;
}

export function getStructuralStoreVersion() {
  return structuralVersion;
}

function bump() {
  version++;
  structuralVersion++;
  listeners.forEach((f) => f());
}

function bumpStats() {
  version++;
  listeners.forEach((f) => f());
}

// 全局帖子计数（服务器为唯一真相来源）
// 格式: { postId: { likes: number, liked: boolean, comments: number } }
const postStats = new Map<string, { likes: number; liked: boolean; comments: number }>();
const postStatsUpdatedAt = new Map<string, number>();
export function getPostStats(postId: string) {
  return postStats.get(postId);
}
export function setPostStats(postId: string, stats: { likes?: number; liked?: boolean; comments?: number }, opts?: { silent?: boolean; sourceStartedAt?: number }) {
  if (opts?.sourceStartedAt && (postStatsUpdatedAt.get(postId) || 0) > opts.sourceStartedAt) return;
  const existing = postStats.get(postId) || { likes: 0, liked: false, comments: 0 };
  postStats.set(postId, {
    likes: stats.likes ?? existing.likes,
    liked: stats.liked ?? existing.liked,
    comments: stats.comments ?? existing.comments,
  });
  postStatsUpdatedAt.set(postId, opts?.sourceStartedAt || Date.now());
  // 点赞、评论等数字变化只刷新已挂载的卡片，不能触发信息流重新请求。
  // 否则较早返回的列表响应可能覆盖 WebSocket 刚同步的新统计，造成数字横跳。
  if (!opts?.silent) bumpStats();
}

let _selPostId: string | null = null;
const _postSubs = new Set<() => void>();
export function selectPost(id: string | null) { _selPostId = id; _postSubs.forEach((f) => f()); }

export const blockedUsers: Record<string, true> = {};
const mutualPairs = new Set<string>();

const NAME_TO_UID: Record<string, string> = {
  '山间清风': '10234567', '深夜干饭人': '10289123', 'Tech小王': '10345678',
  '一只咸鱼': '10412001', '阅读记录本': '10567890', '路人甲': '10654321',
  '示例用户': '1000001',
  '系统通知': '10000000', '背包客小李': '10789012', '在路上': '10890123',
  '摄影穷三代': '10901234', '干饭魂': '11012345', '过路的': '11123456',
  '数码羊毛党': '11234567', '峡谷养老院': '11345678', '书虫一枚': '11456789',
  '摸鱼选手': '11567890',
  '旅行达人': '10765432', '摄影师阿杰': '10876543', '健身教练Lee': '10987654',
  '喵星人控': '11098765', '音乐爱好者': '11210987', '校园小王': '11321098',
  '职场老司机': '11432109', '家居改造家': '11543210',
};

function pairKey(a: string, b: string) {
  return [a, b].sort().join('||');
}

export function getUid(name: string): string {
  return NAME_TO_UID[name] ?? '0';
}

export type NotifType = 'like' | 'follow' | 'comment' | 'reply' | 'system';

export interface NotifItem {
  id: string;
  type: NotifType;
  text: string;
  time: string;
  read: boolean;
}

export const notifications: NotifItem[] = [
  { id: 'n1', type: 'like', text: '山间清风 给你的切片降温了', time: '5分钟前', read: false },
  { id: 'n2', type: 'comment', text: 'Tech小王 评论了你的切片：等不及看完整评测了', time: '18分钟前', read: false },
  { id: 'n3', type: 'follow', text: '深夜干饭人 关注了你', time: '1小时前', read: false },
  { id: 'n4', type: 'reply', text: '阅读记录本 回复了你的评论：完全同意！', time: '2小时前', read: true },
  { id: 'n5', type: 'like', text: '一只咸鱼 给你的切片降温了', time: '3小时前', read: true },
  { id: 'n6', type: 'system', text: '欢迎来到社区！完善个人资料可获得专属标识', time: '昨天', read: true },
  { id: 'n7', type: 'follow', text: '路人甲 关注了你', time: '昨天', read: true },
  { id: 'n8', type: 'like', text: '背包客小李 给你的评论降温了', time: '昨天', read: true },
];

export function isBlockedByUid(uid: string) {
  return !!blockedUsers[uid];
}

export function isBlocked(name: string) {
  return !!blockedUsers[name] || isBlockedByUid(getUid(name));
}

export function isMutuallyHidden(nameA: string, nameB: string) {
  return mutualPairs.has(pairKey(getUid(nameA), getUid(nameB)));
}

export function setBlocked(name: string, blocked: boolean) {
  if (blocked) {
    blockedUsers[name] = true;
    mutualPairs.add(pairKey(getUid('示例用户'), getUid(name)));
  } else {
    delete blockedUsers[name];
    mutualPairs.delete(pairKey(getUid('示例用户'), getUid(name)));
  }
  bump();
}

export const reportedPosts: Record<string, string> = {};

export function isReported(postId: string) {
  return !!reportedPosts[postId];
}

export function reportPost(postId: string, reason: string) {
  reportedPosts[postId] = reason;
  bump();
}

export const userPosts: Post[] = [...myPosts];

export function addUserPost(post: Post) {
  userPosts.unshift(post);
  bump();
}

export const postCache = new Map<string, Post>();

export function getPost(id: string | undefined): Post | undefined {
  if (!id) return undefined;
  let found = posts.find((p) => p.id === id) ?? userPosts.find((p) => p.id === id) ?? postCache.get(id);
  if (found) postCache.set(found.id, found);
  return found;
}

// 启动时把所有帖子预热进缓存——后续任何组件即使未曾挂载过也能通过 getPost 查到帖子，
// pop 返回时组件销毁再重建也不受影响
for (const p of [...posts, ...myPosts]) {
  postCache.set(p.id, p);
}

export function resetAccountScopedStore() {
  postStats.clear();
  postStatsUpdatedAt.clear();
  for (const key of Object.keys(postPrivateState)) delete postPrivateState[key];
  for (const key of Object.keys(blockedUsers)) delete blockedUsers[key];
  mutualPairs.clear();
  for (const key of Object.keys(reportedPosts)) delete reportedPosts[key];
  myStickers.length = 0;
  _conversations.length = 0;
  _lastPostId = undefined;
  _lastPeerName = '';
  _selPostId = null;
  _bio = '';
  _tags = [];
  _avatar = null;
  _nickname = '';
  _deepFreezeTrigger = 0;
  for (const key of Object.keys(_extraComments)) delete _extraComments[key];
  _postSubs.forEach(listener => listener());
  _profileListeners.forEach(listener => listener());
  bump();
}

let _lastPostId: string | undefined;

export function setLastPostId(id: string | undefined) {
  _lastPostId = id;
}

export function getLastPostId(): string | undefined {
  return _lastPostId;
}

let _lastPeerName: string = '';

export function setLastPeerName(name: string) {
  _lastPeerName = name;
}

export function getLastPeerName(): string {
  return _lastPeerName;
}

let _bio = '';
let _tags: string[] = [];
let _avatar: string | null = null;
// 永冻层触发
let _deepFreezeTrigger = 0;
export function triggerDeepFreeze() { _deepFreezeTrigger++; }
export function getDeepFreezeTrigger() { return _deepFreezeTrigger; }

let _nickname: string = '';
const _profileListeners: Array<() => void> = [];

export function getUserBio() {
  return _bio;
}

export function getUserTags() {
  return _tags;
}

export function getUserAvatar(): string | null {
  return _avatar;
}

export function getUserNickname(): string {
  return _nickname;
}

export function updateProfile(bio: string, tags: string[]) {
  _bio = bio;
  _tags = [...tags];
  _profileListeners.forEach((fn) => fn());
}

export function updateAvatar(uri: string | null) {
  _avatar = uri;
  _profileListeners.forEach((fn) => fn());
}

export function updateNickname(name: string) {
  _nickname = name;
  _profileVersion++;
  _profileListeners.forEach((fn) => fn());
  // Trigger store version so feed re-renders with updated nicknames
  version++;
  structuralVersion++;
  listeners.forEach((fn) => fn());
}

export let _profileVersion = 0;
export function getProfileVersion() { return _profileVersion; }

export function onProfileChange(fn: () => void) {
  _profileListeners.push(fn);
  return () => {
    const i = _profileListeners.indexOf(fn);
    if (i >= 0) _profileListeners.splice(i, 1);
  };
}

export function useSelectedPost(): [string | null, (id: string | null) => void] {
  const [id, setId] = useState<string | null>(_selPostId);
  useEffect(() => {
    const fn = () => setId(_selPostId);
    _postSubs.add(fn);
    return () => { _postSubs.delete(fn); };
  }, []);
  return [id, (v) => { _selPostId = v; _postSubs.forEach((f) => f()); }];
}

// ---- 评论计数 ----
export function getCommentCount(postId: string): number {
  return comments.filter((c) => c.postId === postId).length;
}

// ---- 评论扩展 ----
const _extraComments: Record<string, Comment[]> = {};

export function getExtraComments(postId: string): Comment[] {
  return _extraComments[postId] ?? [];
}

export function addComment(postId: string, cmt: Comment) {
  if (!_extraComments[postId]) _extraComments[postId] = [];
  _extraComments[postId].push(cmt);
  bump();
}
