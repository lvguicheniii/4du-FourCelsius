// API 客户端 —— 连接真实后端
// 真机测试用服务器 IP，模拟器用 localhost，生产打包用域名


// 公网 IP 使用受信任的短期 TLS 证书；备案通过后再切回 https://your-web.example
import { getNetworkAwareError } from '@/lib/network-error';
import { prepareImageForUpload, type UploadFileType, type UploadImagePreset } from '@/lib/upload-image';

const configuredBaseUrl = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3001';
export const BASE_URL = configuredBaseUrl.replace(/\/+$/, '');

export function resolveApiUrl(path: string) {
  if (/^https?:\/\//i.test(path)) return path;
  return `${BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

let _token: string | null = null;
let authInvalidationHandler: (() => void) | null = null;

export function setToken(token: string | null) {
  _token = token;
}

export function getToken(): string | null {
  return _token;
}

export function setAuthInvalidationHandler(handler: (() => void) | null) {
  authInvalidationHandler = handler;
}

function uploadRetryDelay(result: any, attempt: number) {
  let serverSeconds = 0;
  try {
    const payload = JSON.parse(String(result?.body || '{}'));
    serverSeconds = Number(payload?.retryAfterSeconds) || 0;
  } catch {}
  const headerValue = result?.headers?.['retry-after'] || result?.headers?.['Retry-After'];
  serverSeconds = Math.max(serverSeconds, Number(headerValue) || 0);
  const baseMs = serverSeconds > 0
    ? serverSeconds * 1000
    : Math.min(8000, 500 * (2 ** attempt));
  return Math.round(baseMs * (0.8 + Math.random() * 0.4));
}

async function uploadWithNetworkError<T extends { status?: number; body?: string; headers?: Record<string, string> }>(createUpload: () => Promise<T>, onRetry?: () => void): Promise<T> {
  let lastError: unknown;
  const maxAttempts = 6;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const result = await createUpload();
      const status = Number(result?.status) || 0;
      const retryable = status === 408 || status === 429 || status >= 500;
      if (!retryable || attempt === maxAttempts - 1) return result;
      onRetry?.();
      await new Promise(resolve => setTimeout(resolve, uploadRetryDelay(result, attempt)));
      continue;
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts - 1) break;
      onRetry?.();
      await new Promise(resolve => setTimeout(resolve, uploadRetryDelay(null, attempt)));
    }
  }
  throw await getNetworkAwareError(lastError, '上传失败，请稍后重试');
}

async function performRequest(path: string, options: RequestInit = {}): Promise<any> {
  const url = resolveApiUrl(path);
  const requestToken = _token;
  const method = String(options.method || 'GET').toUpperCase();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store, no-cache',
    Pragma: 'no-cache',
    ...(options.headers as Record<string, string> || {}),
  };
  if (requestToken) {
    headers['Authorization'] = `Bearer ${requestToken}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  const callerSignal = options.signal;
  const abortFromCaller = () => controller.abort();
  callerSignal?.addEventListener('abort', abortFromCaller, { once: true });
  if (callerSignal?.aborted) controller.abort();
  let res: Response;
  let body: string;
  try {
    res = await fetch(url, {
      ...options,
      cache: 'no-store',
      headers,
      signal: controller.signal,
    });
    if (res.status === 304 && (method === 'GET' || method === 'HEAD')) {
      const separator = url.includes('?') ? '&' : '?';
      res = await fetch(`${url}${separator}_sidu_refresh=${Date.now()}`, {
        ...options,
        cache: 'no-store',
        headers,
        signal: controller.signal,
      });
    }
    body = await res.text();
  } catch (error: any) {
    const networkError = await getNetworkAwareError(error);
    if (networkError.message !== error?.message) throw networkError;
    if (error?.name === 'AbortError') throw new Error('请求超时，请检查网络连接');
    throw error;
  } finally {
    clearTimeout(timeout);
    callerSignal?.removeEventListener('abort', abortFromCaller);
  }
  let data: any = {};
  if (body) {
    try { data = JSON.parse(body); }
    catch { data = { error: body }; }
  }

  if (!res.ok) {
    // 单设备登录被挤掉 → 清 token 跳转登录
    if (res.status === 401 && data.relogin && requestToken && _token === requestToken) {
      _token = null;
      authInvalidationHandler?.();
      if (typeof window !== 'undefined') {
        // 使用 URL hash 通信，跳转登录页
        import('expo-router').then(({ router }) => {
          router.replace('/login');
        }).catch(() => {});
      }
    }
    const requestId = data.requestId || res.headers.get('X-Request-ID') || undefined;
    const baseMessage = data.error || `请求失败 (${res.status})`;
    const error = new Error(res.status >= 500 && requestId ? `${baseMessage}\n错误编号：${requestId}` : baseMessage) as Error & {
      status?: number;
      payload?: any;
      requestId?: string;
    };
    error.status = res.status;
    error.payload = data;
    error.requestId = requestId;
    throw error;
  }
  return data;
}

const inFlightMutations = new Map<string, Promise<any>>();

function createIdempotencyKey() {
  return `app-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function isRetryableMutation(path: string, method: string) {
  if (method !== 'POST' && method !== 'DELETE') return false;
  return path === '/api/posts'
    || /^\/api\/posts\/[^/]+\/cool$/.test(path)
    || /^\/api\/comments\/[^/]+$/.test(path)
    || /^\/api\/comments\/[^/]+\/like$/.test(path)
    || path === '/api/chat/send'
    || path === '/api/reef/rooms'
    || path === '/api/reef/public-applications'
    || /^\/api\/reef\/rooms\/[^/]+\/messages$/.test(path)
    || /^\/api\/refrigerant\/(?:gift|use-on-post\/[^/]+)$/.test(path)
    || /^\/api\/frost-shells\/gift$/.test(path)
    || path === '/api/slice-boxes'
    || path === '/api/beacons'
    || /^\/api\/follows\/[^/]+$/.test(path)
    || /^\/api\/app-moderation\/posts\/[^/]+\/action$/.test(path);
}

async function request(path: string, options: RequestInit = {}): Promise<any> {
  const method = String(options.method || 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD') return performRequest(path, options);

  const fingerprint = `${_token || 'guest'}:${method}:${path}:${String(options.body || '')}`;
  const existing = inFlightMutations.get(fingerprint);
  if (existing) return existing;

  const headers = {
    ...(options.headers as Record<string, string> || {}),
    'Idempotency-Key': createIdempotencyKey(),
  };
  const execute = () => performRequest(path, { ...options, headers });
  const operation = (async () => {
    try {
      return await execute();
    } catch (error) {
      const status = Number((error as { status?: number })?.status) || 0;
      if (!isRetryableMutation(path, method) || (status > 0 && status < 500)) throw error;
      return execute();
    }
  })();
  inFlightMutations.set(fingerprint, operation);
  operation.finally(() => {
    if (inFlightMutations.get(fingerprint) === operation) inFlightMutations.delete(fingerprint);
  }).catch(() => {});
  return operation;
}

// ====== Auth ======
export type SmsVerificationPurpose = 'register' | 'password_change' | 'password_reset';
export type CaptchaProof = { challengeId: string; ticket: string; randstr: string };

export async function createCaptchaChallenge(purpose: SmsVerificationPurpose) {
  return request('/api/auth/captcha/challenge', {
    method: 'POST',
    body: JSON.stringify({ purpose }),
  }) as Promise<{ challengeId: string; expiresAt: number; redirectUri: string; launchUrl: string }>;
}

export async function sendCode(phone: string, purpose: SmsVerificationPurpose, captcha?: CaptchaProof) {
  return request('/api/auth/send-code', {
    method: 'POST',
    body: JSON.stringify({ phone, purpose, captcha }),
  }) as Promise<{ ok: boolean; mode?: 'fixed'; fixedCode?: string; cooldownSeconds?: number; expiresInSeconds?: number }>;
}

export async function register(username: string, password: string, phone: string, code: string, nickname?: string, avatar?: string, gender?: string, security_question?: string, security_answer?: string, age?: number) {
  return request('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ username, password, phone, code, nickname, avatar, gender, security_question, security_answer, age }),
  });
}

export async function login(username: string, password: string) {
  return request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  });
}

export async function getMe() {
  return request('/api/auth/me');
}

export async function updateProfile(data: { nickname?: string; bio?: string; tags?: string[]; avatar?: string; cover_image?: string; age?: number }) {
  return request('/api/auth/profile', { method: 'PUT', body: JSON.stringify(data) });
}

export async function changePassword(data: { password: string; current_password: string; verify_code: string }) {
  return request('/api/auth/change-password', { method: 'PUT', body: JSON.stringify(data) });
}

export async function changePhone(data: { phone: string; current_password: string }) {
  return request('/api/auth/change-phone', { method: 'PUT', body: JSON.stringify(data) });
}

export async function forgotPasswordStep1(phone: string) {
  return request('/api/auth/forgot-password-step1', { method: 'POST', body: JSON.stringify({ phone }) });
}

export async function forgotPasswordStep2(data: { phone: string; password: string; verify_code: string }) {
  return request('/api/auth/forgot-password-step2', { method: 'POST', body: JSON.stringify(data) });
}

export async function getUserProfile(userId: string) {
  return request(`/api/auth/profile/${userId}`);
}

export async function deleteAccount() {
  return request('/api/auth/account', { method: 'DELETE' });
}

// ====== Posts ======
export async function getPosts(page = 1, limit = 20, board?: string, userId?: string) {
  const params = new URLSearchParams({ page: String(page), limit: String(limit) });
  if (board) params.set('board', board);
  if (userId) params.set('user_id', userId);
  return request(`/api/posts?${params.toString()}`);
}

export async function getRecommendPosts(cursor?: string, limit = 20) {
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set('cursor', cursor);
  return request(`/api/posts/recommend?${params.toString()}`);
}

export async function getTopicPosts(topic: string, page = 1, limit = 20) {
  const name = topic.replace(/^#/, '');
  return request(`/api/posts/topic/${encodeURIComponent(name)}?page=${page}&limit=${limit}`);
}

export async function trackRecommendationEvents(events: {
  postId: string;
  eventType: 'impression' | 'open' | 'dwell';
  dwellMs?: number;
  sessionId: string;
}[]) {
  if (!events.length) return { accepted: 0 };
  return request('/api/posts/recommend/events', {
    method: 'POST',
    body: JSON.stringify({ events }),
  });
}

export async function getFollowingPosts() {
  return request('/api/posts/following');
}

export async function getCooledPosts() {
  return request('/api/posts/cooled');
}

export async function getPost(postId: string) {
  return request(`/api/posts/${postId}`);
}

export async function createPost(data: { content?: string; images?: string[]; thumbnails?: string[]; livePhotos?: { stillUrl: string; motionUrl: string }[]; videoUrl?: string; videoPoster?: string; videoDurationMs?: number; videoMediaId?: string; videoMediaType?: 'video' | 'live_photo'; boardId?: string; reefRoomId?: string; sliceBoxId?: string }) {
  return request('/api/posts', { method: 'POST', body: JSON.stringify(data) });
}

export async function getPostPublishStatus(): Promise<{ canPublish: boolean; retryAfterSeconds: number }> {
  return request('/api/posts/publish-status');
}

export async function deletePost(postId: string) {
  return request(`/api/posts/${postId}`, { method: 'DELETE' });
}

export async function setPostVisibility(postId: string, visibility: 'public' | 'private') {
  return request(`/api/posts/${postId}/visibility`, {
    method: 'PUT',
    body: JSON.stringify({ visibility }),
  });
}

export async function coolPost(postId: string, cooled?: boolean) {
  return request(`/api/posts/${postId}/cool`, {
    method: 'POST',
    body: JSON.stringify(typeof cooled === 'boolean' ? { cooled } : {}),
  });
}

export type SliceBox = {
  id: string;
  name: string;
  postCount: number;
  ownerId?: string;
  ownerName?: string;
  createdAt?: string;
};

export async function getSliceBoxes() {
  return request('/api/slice-boxes') as Promise<{ boxes: SliceBox[] }>;
}

export async function createSliceBox(name: string) {
  return request('/api/slice-boxes', {
    method: 'POST',
    body: JSON.stringify({ name }),
  }) as Promise<SliceBox>;
}

export async function getSliceBox(sliceBoxId: string) {
  return request(`/api/slice-boxes/${encodeURIComponent(sliceBoxId)}`) as Promise<SliceBox>;
}

export async function getSliceBoxPosts(sliceBoxId: string, page = 1, limit = 50) {
  return request(`/api/posts?page=${page}&limit=${limit}&slice_box_id=${encodeURIComponent(sliceBoxId)}`);
}

// ====== Comments ======
export async function getComments(postId: string) {
  return request(`/api/comments/${postId}`);
}

export async function getUndercurrent(gender?: 'male' | 'female') {
  const query = gender ? `?gender=${gender}` : '';
  return request(`/api/posts/undercurrent${query}`);
}

export async function getCapsuleTexts() {
  return request('/api/posts/capsule-texts');
}

export async function createComment(postId: string, content: string, options?: { kind?: 'text' | 'sticker'; mediaUrl?: string }) {
  return request(`/api/comments/${postId}`, {
    method: 'POST',
    body: JSON.stringify({ content, kind: options?.kind || 'text', mediaUrl: options?.mediaUrl || '' }),
  });
}

export async function renameSliceBox(sliceBoxId: string, name: string) {
  return request(`/api/slice-boxes/${encodeURIComponent(sliceBoxId)}`, {
    method: 'PUT',
    body: JSON.stringify({ name }),
  }) as Promise<SliceBox>;
}

export async function updatePostSliceBox(postId: string, sliceBoxId: string | null) {
  return request(`/api/posts/${encodeURIComponent(postId)}/slice-box`, {
    method: 'PUT',
    body: JSON.stringify({ sliceBoxId }),
  }) as Promise<{ sliceBox: { id: string; name: string } | null }>;
}

export async function reportComment(commentId: string, reason: string, detail?: string) {
  return request(`/api/comments/${commentId}/report`, {
    method: 'POST',
    body: JSON.stringify({ reason, detail }),
  });
}

export async function deleteComment(commentId: string) {
  return request(`/api/comments/${commentId}`, { method: 'DELETE' });
}

export async function likeComment(commentId: string, liked?: boolean) {
  return request(`/api/comments/${commentId}/like`, {
    method: 'POST',
    body: JSON.stringify(typeof liked === 'boolean' ? { liked } : {}),
  });
}

export async function giftFrostShell(recipientId: string, source: 'chat' | 'comment' | 'profile', relatedId?: string) {
  return request('/api/frost-shells/gift', {
    method: 'POST',
    body: JSON.stringify({ recipientId, source, relatedId }),
  });
}

export async function giftRefrigerant(recipientId: string, source: 'chat' | 'comment' | 'profile', relatedId?: string) {
  return giftFrostShell(recipientId, source, relatedId);
}

export async function applyRefrigerantToPost(postId: string) {
  return request(`/api/refrigerant/use-on-post/${postId}`, { method: 'POST' });
}

// ====== Follows ======
export async function followUser(userId: string, following?: boolean) {
  return request(`/api/follows/${userId}`, {
    method: 'POST',
    body: JSON.stringify(typeof following === 'boolean' ? { following } : {}),
  });
}

export async function getFollowStatus(userId: string) {
  return request(`/api/follows/status/${userId}`);
}

export async function getFollowing(userId: string) {
  return request(`/api/follows/following/${userId}`);
}

export async function getFollowers(userId: string) {
  return request(`/api/follows/followers/${userId}`);
}

export async function getBlockedUsers() {
  return request('/api/follows/blocks');
}

export async function setUserBlocked(userId: string, blocked: boolean) {
  return request(`/api/follows/blocks/${userId}`, {
    method: 'PUT',
    body: JSON.stringify({ blocked }),
  });
}

// ====== Reports ======
export async function reportPost(postId: string, reason: string, detail?: string) {
  return request(`/api/posts/${postId}/report`, { method: 'POST', body: JSON.stringify({ reason, detail }) });
}

// ====== Upload ======
// type: 'p'=帖子, 'a'=头像, 'c'=主页背景, 's'=表情包
export type UploadProgressCallback = (progress: number) => void;
export type UploadFileOptions = { imagePreset?: UploadImagePreset; livePhotoMotion?: boolean; mimeType?: string | null };

export async function uploadFile(uri: string, type: UploadFileType = 'p', onProgress?: UploadProgressCallback, options: UploadFileOptions = {}) {
  const FileSystem = require('expo-file-system/legacy');
  const headers: Record<string, string> = {
    'Content-Type': 'multipart/form-data',
    'Idempotency-Key': createIdempotencyKey(),
  };
  if (_token) headers['Authorization'] = `Bearer ${_token}`;

  const uploadUri = await prepareImageForUpload(uri, type, options.imagePreset);
  const uploadOptions = {
    httpMethod: 'POST',
    uploadType: FileSystem.FileSystemUploadType.MULTIPART,
    fieldName: 'file',
    headers,
    ...(options.mimeType ? { mimeType: options.mimeType } : {}),
  };
  const uploadQuery = `type=${encodeURIComponent(type)}${options.livePhotoMotion ? '&livePhoto=1' : ''}`;
  const createUpload = () => onProgress
    ? FileSystem.createUploadTask(resolveApiUrl(`/api/upload?${uploadQuery}`), uploadUri, uploadOptions, (event: { totalBytesSent: number; totalBytesExpectedToSend: number }) => {
        const total = event.totalBytesExpectedToSend;
        if (total > 0) onProgress(Math.min(1, Math.max(0, event.totalBytesSent / total)));
      }).uploadAsync()
    : FileSystem.uploadAsync(resolveApiUrl(`/api/upload?${uploadQuery}`), uploadUri, uploadOptions);
  const res = await uploadWithNetworkError<any>(createUpload, () => onProgress?.(0));
  if (!res) throw new Error('上传未完成，请重试');

  const data = JSON.parse(res.body);
  if (res.status !== 200 && res.status !== 201) throw new Error(data.error || '上传失败');
  const fullUrl = resolveApiUrl(data.url);
  const thumbFullUrl = data.thumbUrl ? resolveApiUrl(data.thumbUrl) : undefined;
  return { url: fullUrl, originalUrl: data.originalUrl ? resolveApiUrl(data.originalUrl) : undefined, thumbUrl: thumbFullUrl, filename: data.filename, mediaId: data.mediaId as string | null, mediaType: data.mediaType, mimeType: data.mimeType, width: data.width as number | undefined, height: data.height as number | undefined, durationMs: data.durationMs as number | undefined };
}

export async function uploadMotionPhoto(uri: string, context: 'post' | 'message' | 'reef', onProgress?: UploadProgressCallback) {
  const FileSystem = require('expo-file-system/legacy');
  const headers: Record<string, string> = {
    'Content-Type': 'multipart/form-data',
    'Idempotency-Key': createIdempotencyKey(),
  };
  if (_token) headers.Authorization = `Bearer ${_token}`;
  const options = {
    httpMethod: 'POST',
    uploadType: FileSystem.FileSystemUploadType.MULTIPART,
    fieldName: 'file',
    headers,
  };
  const createUpload = () => onProgress
    ? FileSystem.createUploadTask(resolveApiUrl(`/api/upload/motion-photo?context=${context}`), uri, options, (event: { totalBytesSent: number; totalBytesExpectedToSend: number }) => {
        const total = event.totalBytesExpectedToSend;
        if (total > 0) onProgress(Math.min(1, Math.max(0, event.totalBytesSent / total)));
      }).uploadAsync()
    : FileSystem.uploadAsync(resolveApiUrl(`/api/upload/motion-photo?context=${context}`), uri, options);
  const res = await uploadWithNetworkError<any>(createUpload, () => onProgress?.(0));
  if (!res) throw new Error('动态照片上传未完成，请重试');
  const data = JSON.parse(res.body);
  if (res.status !== 200 && res.status !== 201) {
    const error = new Error(data.error || '动态照片处理失败') as Error & { code?: string; status?: number };
    error.code = data.code;
    error.status = res.status;
    throw error;
  }
  return {
    mediaId: data.mediaId as string,
    motionUrl: resolveApiUrl(data.motionUrl),
    stillUrl: resolveApiUrl(data.stillUrl),
    originalUrl: resolveApiUrl(data.originalUrl),
  };
}

export type LivePhotoUploadContext = 'post' | 'message' | 'reef';

const LIVE_PHOTO_UPLOAD_TYPES: Record<LivePhotoUploadContext, { motion: UploadFileType; still: UploadFileType }> = {
  post: { motion: 'vp', still: 'p' },
  message: { motion: 'vm', still: 'm' },
  reef: { motion: 'vr', still: 'm' },
};

function isUploadedMediaUri(uri: string) {
  return /^(https?:\/\/|\/uploads\/)/i.test(uri);
}

export async function uploadPairedLivePhoto(
  stillUri: string,
  motionUri: string,
  context: LivePhotoUploadContext,
  onProgress?: UploadProgressCallback,
) {
  const types = LIVE_PHOTO_UPLOAD_TYPES[context];
  const [motion, still] = await Promise.all([
    isUploadedMediaUri(motionUri)
      ? Promise.resolve({ url: motionUri, mediaId: null as string | null })
      : uploadFile(motionUri, types.motion, value => onProgress?.(value * 0.78), { livePhotoMotion: true }),
    isUploadedMediaUri(stillUri)
      ? Promise.resolve({ url: stillUri })
      : uploadFile(stillUri, types.still, value => onProgress?.(0.78 + value * 0.22), { imagePreset: 'media-cover' }),
  ]);
  return { motionUrl: motion.url, stillUrl: still.url, mediaId: motion.mediaId };
}

export function isNotMotionPhotoError(error: unknown) {
  return (error as { code?: string } | null)?.code === 'NOT_MOTION_PHOTO';
}

// ====== Chat ======
export async function sendChatMessage(toUsername: string, content: string, kind: 'text' | 'image' | 'sticker' | 'video' | 'live_photo' | 'post_context' | 'comment_context' = 'text', mediaId?: string | null, toUserId?: string) {
  return request('/api/chat/send', {
    method: 'POST',
    body: JSON.stringify({ toUserId: toUserId || undefined, toUsername, content, kind, mediaId }),
  });
}

export async function getChatByUsername(username: string, options: { limit?: number; before?: string; userId?: string } = {}) {
  const params = new URLSearchParams();
  if (options.limit) params.set('limit', String(options.limit));
  if (options.before) params.set('before', options.before);
  if (options.userId) params.set('userId', options.userId);
  const query = params.toString();
  return request(`/api/chat/with-name/${encodeURIComponent(username)}${query ? `?${query}` : ''}`);
}

export async function getConversations() {
  return request('/api/chat/conversations');
}

export async function getFavoriteConversations() {
  return request('/api/chat/conversations?favorites=1');
}

export async function getConversationPreference(peerId: string) {
  return request(`/api/chat/conversations/${encodeURIComponent(peerId)}/preference`);
}

export async function setConversationPreference(peerId: string, values: { hidden?: boolean; important?: boolean }) {
  return request(`/api/chat/conversations/${encodeURIComponent(peerId)}/preference`, {
    method: 'PUT', body: JSON.stringify(values),
  });
}

export async function reportPrivateMessage(peerUsername: string, reason: string, detail = '', messageId?: string, peerUserId?: string) {
  return request('/api/chat/report', {
    method: 'POST',
    body: JSON.stringify({ peerUserId: peerUserId || undefined, peerUsername, reason, detail, messageId }),
  });
}

export async function deletePrivateMessageForMe(messageId: string) {
  return request(`/api/chat/messages/${encodeURIComponent(messageId)}/self`, { method: 'DELETE' });
}

export async function recallPrivateMessage(messageId: string) {
  return request(`/api/chat/messages/${encodeURIComponent(messageId)}/recall`, { method: 'POST' });
}

export async function checkNewMessages(since: string) {
  return request(`/api/chat/new-since/${encodeURIComponent(since)}`);
}

// ====== Notifications ======
export async function getNotifications(category?: string) {
  const params = category ? `?category=${category}` : '';
  const result = await request(`/api/notifications${params}`);
  return Array.isArray(result) ? result.map((item: any) => {
    if (item?.metadata && typeof item.metadata === 'object') return item;
    try {
      const parsed = JSON.parse(item?.metadataJson || item?.metadata_json || '{}');
      return { ...item, metadata: parsed && typeof parsed === 'object' ? parsed : {} };
    } catch {
      return { ...item, metadata: {} };
    }
  }) : result;
}

export async function markNotificationsRead(category?: 'system' | 'interaction') {
  const params = category ? `?category=${category}` : '';
  return request(`/api/notifications/read-all${params}`, { method: 'POST' });
}

export async function markSingleRead(notifId: string) {
  return request(`/api/notifications/${notifId}/read`, { method: 'POST' });
}

export async function getCommunityConfig() {
  return request('/api/community-config');
}

export async function registerPushToken(token: string, platform: 'android' | 'ios') {
  return request('/api/product/push-token', {
    method: 'PUT',
    body: JSON.stringify({ token, platform }),
  });
}

export async function unregisterPushToken(token: string, authToken?: string | null) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  const bearer = authToken || _token;
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  return fetch(resolveApiUrl('/api/product/push-token'), {
    method: 'DELETE',
    headers,
    body: JSON.stringify({ token }),
  }).catch(() => null);
}

export async function submitAppeal(notificationId: string, reason: string) {
  return request(`/api/notifications/${notificationId}/appeal`, {
    method: 'POST',
    body: JSON.stringify({ reason }),
  });
}

export async function getUnreadNotificationCount() {
  return request('/api/notifications/unread-count');
}

// ====== 航行日志（成就） ======
export type AchievementItem = {
  key: string;
  name: string;
  hint?: string;
  conditionText?: string;
  isHidden: boolean;
  unlocked: boolean;
  unlockedAt?: string | null;
  triggerCount?: number;
};

export async function getAchievements(): Promise<{ achievements: AchievementItem[] }> {
  return request('/api/achievements');
}

export async function getPendingAchievementEvents(): Promise<{ events: any[] }> {
  return request('/api/achievements/events/pending');
}

export async function acknowledgeAchievementEvents(ids: string[]) {
  return request('/api/achievements/events/ack', {
    method: 'POST',
    body: JSON.stringify({ ids }),
  });
}

export async function reportAchievementEvent(key: string) {
  return request(`/api/achievements/events/${encodeURIComponent(key)}`, { method: 'POST' });
}

// ====== Beacons ======
export async function createBeacon(content: string, image?: string) {
  return request('/api/beacons', {
    method: 'POST',
    body: JSON.stringify({ content, image }),
  });
}

export async function getBeacons(gender?: 'male' | 'female') {
  const query = gender ? `?gender=${gender}` : '';
  return request(`/api/beacons${query}`);
}

export async function getMyBeacon() {
  return request('/api/beacons/mine');
}

export async function getQianliuCounts(gender?: 'male' | 'female') {
  const query = gender ? `?gender=${gender}` : '';
  return request(`/api/beacons/counts${query}`);
}

// ====== 隐海礁群聊 ======
export async function getReefRooms() {
  return request('/api/reef/rooms');
}

export async function appModeratePost(postId: string, data: { action: 'delete' | 'mute' | 'ban'; reason: string; hours?: number; days?: number }) {
  return request(`/api/app-moderation/posts/${encodeURIComponent(postId)}/action`, { method: 'POST', body: JSON.stringify(data) });
}

export async function getReefCard(roomId: string) {
  return request(`/api/reef/rooms/${encodeURIComponent(roomId)}/card`);
}

export async function getParticipatingReefRooms() {
  return request('/api/reef/rooms?messages=1');
}

export async function getMyReefRooms() {
  return request('/api/reef/rooms?mine=1');
}

export async function getFavoriteReefRooms() {
  return request('/api/reef/rooms?favorites=1');
}

export async function setReefPreference(roomId: string, values: { hidden?: boolean; important?: boolean }) {
  return request(`/api/reef/rooms/${encodeURIComponent(roomId)}/preference`, {
    method: 'PUT', body: JSON.stringify(values),
  });
}

export async function getReefOverview(roomId: string) {
  return request(`/api/reef/rooms/${encodeURIComponent(roomId)}/overview`);
}

export async function createReefRoom(name: string, capacity = 30, durationHours = 24) {
  return request('/api/reef/rooms', {
    method: 'POST',
    body: JSON.stringify({ name, capacity, durationHours }),
  });
}

export async function submitPublicReefApplication(reefName: string, reason: string) {
  return request('/api/reef/public-applications', {
    method: 'POST',
    body: JSON.stringify({ reefName, reason }),
  });
}

export async function getReefRetentionStatus(roomId: string) {
  return request(`/api/reef/rooms/${encodeURIComponent(roomId)}/retention`);
}

export async function voteReefRetention(roomId: string, vote: 'yes' | 'no') {
  return request(`/api/reef/rooms/${encodeURIComponent(roomId)}/retention-vote`, {
    method: 'POST',
    body: JSON.stringify({ vote }),
  });
}

export async function getReefMessages(roomId: string, limit = 60, messageId?: string) {
  const anchor = messageId ? `&messageId=${encodeURIComponent(messageId)}` : '';
  return request(`/api/reef/rooms/${encodeURIComponent(roomId)}/messages?limit=${limit}${anchor}`);
}

export async function sendReefMessage(roomId: string, content: string, kind: 'text' | 'image' | 'sticker' | 'video' | 'live_photo' = 'text', mediaId?: string | null, mentionUserIds: string[] = []) {
  return request(`/api/reef/rooms/${encodeURIComponent(roomId)}/messages`, {
    method: 'POST',
    body: JSON.stringify({ content, kind, mediaId, mentionUserIds }),
  });
}

export async function reportReefMessage(roomId: string, messageId: string, reason: string, detail = '') {
  return request(`/api/reef/rooms/${encodeURIComponent(roomId)}/messages/${encodeURIComponent(messageId)}/report`, {
    method: 'POST',
    body: JSON.stringify({ reason, detail }),
  });
}

export async function reportReef(roomId: string, reason: string, detail = '') {
  return request(`/api/reef/rooms/${encodeURIComponent(roomId)}/report`, {
    method: 'POST', body: JSON.stringify({ reason, detail }),
  });
}

// ====== Stickers ======
function canonicalStickerUrl(url: string) {
  const value = String(url || '').trim();
  try {
    const parsed = new URL(value);
    parsed.search = '';
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return value.split(/[?#]/, 1)[0];
  }
}

export type FeedbackDeviceInfo = {
  deviceModel: string;
  osVersion: string;
  appVersion: string;
};

export async function submitFeedback(content: string, imageUrl?: string | null, deviceInfo?: FeedbackDeviceInfo | null) {
  return request('/api/feedback', {
    method: 'POST',
    body: JSON.stringify({
      content,
      image_url: imageUrl || null,
      device_model: deviceInfo?.deviceModel || null,
      os_version: deviceInfo?.osVersion || null,
      app_version: deviceInfo?.appVersion || null,
    }),
  });
}

export async function getFeedbackHistory() {
  return request('/api/feedback');
}

export async function getMyStickers() {
  return request('/api/stickers');
}

export async function addStickerUrl(url: string) {
  return request('/api/stickers', { method: 'POST', body: JSON.stringify({ url }) });
}

export async function moveStickerToFront(url: string) {
  return request('/api/stickers/front', { method: 'PUT', body: JSON.stringify({ url: canonicalStickerUrl(url) }) });
}

export async function deleteStickerByUrl(url: string) {
  return request('/api/stickers/by-url', { method: 'DELETE', body: JSON.stringify({ url: canonicalStickerUrl(url) }) });
}
