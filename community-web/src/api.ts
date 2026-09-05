const SESSION_KEY = "sidu_web_session";
let token = sessionStorage.getItem(SESSION_KEY) || "";

const configuredApiOrigin = String(import.meta.env.VITE_API_ORIGIN || "").replace(/\/$/, "");
const productionApiOrigin = "";

export const API_ORIGIN = configuredApiOrigin || productionApiOrigin;

function resolveApiPath(path: string) {
  return `${API_ORIGIN}${path}`;
}

export function getToken() {
  return token;
}
export function setToken(value: string) {
  token = value;
  if (value) sessionStorage.setItem(SESSION_KEY, value);
  else sessionStorage.removeItem(SESSION_KEY);
}

function requestId() {
  return `web-${Date.now().toString(36)}-${crypto.getRandomValues(new Uint32Array(2)).join("")}`;
}

export async function request<T = any>(
  path: string,
  init: RequestInit = {},
  timeoutMs = 25_000,
): Promise<T> {
  const headers = new Headers(init.headers);
  if (!(init.body instanceof FormData))
    headers.set("Content-Type", "application/json");
  if (token) headers.set("Authorization", `Bearer ${token}`);
  if (init.method && init.method !== "GET")
    headers.set("Idempotency-Key", requestId());
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(resolveApiPath(path), {
      ...init,
      headers,
      signal: controller.signal,
    });
    const text = await response.text();
    const data = text
      ? (() => {
          try {
            return JSON.parse(text);
          } catch {
            return { error: text };
          }
        })()
      : {};
    if (!response.ok) {
      if (response.status === 401 && data.relogin) {
        setToken("");
        window.dispatchEvent(new Event("sidu-session-invalid"));
      }
      if (data.banned) {
        window.dispatchEvent(new CustomEvent("sidu-account-banned", { detail: data }));
      }
      const error = new Error(
        data.error || `请求失败 (${response.status})`,
      ) as Error & { status?: number; payload?: any };
      error.status = response.status;
      error.payload = data;
      throw error;
    }
    return data as T;
  } catch (error: any) {
    if (error?.name === "AbortError") throw new Error("请求超时，请稍后重试");
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function query(params: Record<string, string | number | undefined>) {
  const value = new URLSearchParams();
  Object.entries(params).forEach(([key, item]) => {
    if (item !== undefined && item !== "") value.set(key, String(item));
  });
  return value.toString();
}

export async function uploadFile(
  file: File,
  type: "p" | "a" | "c" | "m" | "f" | "s" = "p",
) {
  let lastError: any;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const body = new FormData();
    body.append("file", file);
    try {
      return await request<{
        url: string;
        thumbUrl?: string;
        mediaId?: string;
        mediaType?: string;
      }>(`/api/upload?type=${type}`, { method: "POST", body }, 120_000);
    } catch (error: any) {
      lastError = error;
      const status = Number(error?.status || 0);
      const transient = !status || status === 408 || status === 425 || status === 429 || status >= 500;
      if (!transient || attempt === 1) throw error;
      await new Promise((resolve) => window.setTimeout(resolve, 600));
    }
  }
  throw lastError;
}

export const api = {
  createCaptchaChallenge: (purpose: "register" | "password_reset" | "password_change") => request<any>("/api/auth/captcha/challenge", { method: "POST", body: JSON.stringify({ purpose, client: "web" }) }),
  sendCode: (phone: string, purpose: "register" | "password_reset" | "password_change", captcha?: { challengeId: string; ticket: string; randstr: string }) =>
    request<{ ok: boolean; mode?: "fixed"; fixedCode?: string; cooldownSeconds?: number; expiresInSeconds?: number }>("/api/auth/send-code", {
      method: "POST",
      body: JSON.stringify({ phone, purpose, captcha }),
    }),
  register: (data: {
    username: string;
    password: string;
    phone: string;
    code: string;
    nickname: string;
    gender: "male" | "female";
    age: number;
    security_question: string;
    security_answer: string;
  }) =>
    request<any>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  login: (username: string, password: string) =>
    request<any>("/api/auth/web-login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  logout: () => request("/api/auth/web-logout", { method: "POST", body: "{}" }),
  me: () => request<any>("/api/auth/me"),
  profile: (id: string) =>
    request<any>(`/api/auth/profile/${encodeURIComponent(id)}`),
  updateProfile: (data: any) =>
    request("/api/auth/profile", { method: "PUT", body: JSON.stringify(data) }),
  changePassword: (data: any) =>
    request("/api/auth/change-password", {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  resetPassword: (data: { phone: string; password: string; verify_code: string }) =>
    request("/api/auth/forgot-password-step2", { method: "POST", body: JSON.stringify(data) }),
  changePhone: (data: any) =>
    request("/api/auth/change-phone", {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  deleteAccount: () => request("/api/auth/account", { method: "DELETE" }),
  posts: (
    page = 1,
    limit = 20,
    board?: string,
    userId?: string,
    sliceBoxId?: string,
  ) =>
    request<any>(
      `/api/posts?${query({ page, limit, board, user_id: userId, slice_box_id: sliceBoxId })}`,
    ),
  recommend: (cursor?: string) =>
    request<any>(`/api/posts/recommend?${query({ cursor, limit: 20 })}`),
  followingPosts: () => request<any>("/api/posts/following"),
  cooledPosts: () => request<any>("/api/posts/cooled"),
  post: (id: string) => request<any>(`/api/posts/${encodeURIComponent(id)}`),
  createPost: (data: any) =>
    request<any>("/api/posts", { method: "POST", body: JSON.stringify(data) }),
  publishStatus: () => request<any>("/api/posts/publish-status"),
  deletePost: (id: string) =>
    request(`/api/posts/${encodeURIComponent(id)}`, { method: "DELETE" }),
  visibility: (id: string, visibility: "public" | "private") =>
    request(`/api/posts/${id}/visibility`, {
      method: "PUT",
      body: JSON.stringify({ visibility }),
    }),
  cool: (id: string, cooled: boolean) =>
    request<any>(`/api/posts/${id}/cool`, {
      method: "POST",
      body: JSON.stringify({ cooled }),
    }),
  refrigerant: (id: string) =>
    request<any>(`/api/refrigerant/use-on-post/${id}`, {
      method: "POST",
      body: "{}",
    }),
  reportPost: (id: string, reason: string, detail = "") =>
    request(`/api/posts/${id}/report`, {
      method: "POST",
      body: JSON.stringify({ reason, detail }),
    }),
  comments: (id: string) => request<any>(`/api/comments/${id}`),
  comment: (id: string, content: string, kind = "text", mediaUrl?: string) =>
    request<any>(`/api/comments/${id}`, {
      method: "POST",
      body: JSON.stringify({ content, kind, mediaUrl }),
    }),
  likeComment: (id: string, liked: boolean) =>
    request<any>(`/api/comments/${id}/like`, {
      method: "POST",
      body: JSON.stringify({ liked }),
    }),
  deleteComment: (id: string) =>
    request(`/api/comments/${id}`, { method: "DELETE" }),
  reportComment: (id: string, reason: string, detail = "") =>
    request(`/api/comments/${id}/report`, {
      method: "POST",
      body: JSON.stringify({ reason, detail }),
    }),
  config: () => request<any>("/api/community-config"),
  topicPosts: (name: string, page = 1) =>
    request<any>(
      `/api/posts/topic/${encodeURIComponent(name.replace(/^#/, ""))}?page=${page}&limit=20`,
    ),
  undercurrent: (gender?: string) =>
    request<any>(`/api/posts/undercurrent${gender ? `?gender=${gender}` : ""}`),
  capsuleTexts: () => request<any>("/api/posts/capsule-texts"),
  beacons: (gender?: string) =>
    request<any>(`/api/beacons${gender ? `?gender=${gender}` : ""}`),
  myBeacon: () => request<any>("/api/beacons/mine"),
  beaconCounts: (gender?: string) =>
    request<any>(`/api/beacons/counts${gender ? `?gender=${gender}` : ""}`),
  createBeacon: (content: string, image?: string) =>
    request("/api/beacons", {
      method: "POST",
      body: JSON.stringify({ content, image }),
    }),
  achievementEvent: (key: string) =>
    request(`/api/achievements/events/${encodeURIComponent(key)}`, {
      method: "POST",
      body: "{}",
    }),
  conversations: () => request<any>("/api/chat/conversations"),
  favoriteConversations: () =>
    request<any>("/api/chat/conversations?favorites=1"),
  chat: (name: string, userId?: string, before?: string) =>
    request<any>(
      `/api/chat/with-name/${encodeURIComponent(name)}?${query({ limit: 60, userId, before })}`,
    ),
  sendChat: (
    toUsername: string,
    toUserId: string | undefined,
    content: string,
    kind = "text",
    mediaId?: string,
  ) =>
    request<any>("/api/chat/send", {
      method: "POST",
      body: JSON.stringify({ toUsername, toUserId, content, kind, mediaId }),
    }),
  chatPreference: (id: string, values: any) =>
    request(`/api/chat/conversations/${id}/preference`, {
      method: "PUT",
      body: JSON.stringify(values),
    }),
  recallMessage: (id: string) =>
    request(`/api/chat/messages/${id}/recall`, { method: "POST", body: "{}" }),
  deleteMessage: (id: string) =>
    request(`/api/chat/messages/${id}/self`, { method: "DELETE" }),
  stickers: () => request<string[]>("/api/stickers"),
  addSticker: (url: string) =>
    request<string[]>("/api/stickers", {
      method: "POST",
      body: JSON.stringify({ url }),
    }),
  reportMessage: (
    messageId: string,
    peerUserId: string,
    reason: string,
    detail = "",
  ) =>
    request("/api/chat/report", {
      method: "POST",
      body: JSON.stringify({ messageId, peerUserId, reason, detail }),
    }),
  notifications: (category: string) =>
    request<any>(`/api/notifications?category=${category}`),
  unread: () => request<any>("/api/notifications/unread-count"),
  readNotification: (id: string) =>
    request(`/api/notifications/${id}/read`, { method: "POST", body: "{}" }),
  readAll: (category: string) =>
    request(`/api/notifications/read-all?${query({ category })}`, {
      method: "POST",
      body: "{}",
    }),
  appeal: (id: string, reason: string) =>
    request(`/api/notifications/${id}/appeal`, {
      method: "POST",
      body: JSON.stringify({ reason }),
    }),
  reefs: (mode = "") =>
    request<any>(`/api/reef/rooms${mode ? `?${mode}=1` : ""}`),
  reefCard: (id: string) => request<any>(`/api/reef/rooms/${id}/card`),
  reefOverview: (id: string) => request<any>(`/api/reef/rooms/${id}/overview`),
  createReef: (name: string, capacity: number, durationHours: number) =>
    request<any>("/api/reef/rooms", {
      method: "POST",
      body: JSON.stringify({ name, capacity, durationHours }),
    }),
  submitPublicReefApplication: (reefName: string, reason: string) =>
    request<any>("/api/reef/public-applications", {
      method: "POST",
      body: JSON.stringify({ reefName, reason }),
    }),
  reefMessages: (id: string, messageId?: string) =>
    request<any>(`/api/reef/rooms/${id}/messages?limit=80${messageId ? `&messageId=${encodeURIComponent(messageId)}` : ""}`),
  sendReef: (id: string, content: string, kind = "text", mediaId?: string, mentionUserIds: string[] = []) =>
    request<any>(`/api/reef/rooms/${id}/messages`, {
      method: "POST",
      body: JSON.stringify({ content, kind, mediaId, mentionUserIds }),
    }),
  reportReef: (id: string, reason: string, detail = "") =>
    request(`/api/reef/rooms/${id}/report`, {
      method: "POST",
      body: JSON.stringify({ reason, detail }),
    }),
  reefPreference: (id: string, values: any) =>
    request(`/api/reef/rooms/${id}/preference`, {
      method: "PUT",
      body: JSON.stringify(values),
    }),
  reefRetention: (id: string) =>
    request<any>(`/api/reef/rooms/${id}/retention`),
  voteReefRetention: (id: string, vote: "yes" | "no") =>
    request<any>(`/api/reef/rooms/${id}/retention-vote`, {
      method: "POST",
      body: JSON.stringify({ vote }),
    }),
  achievements: () => request<any>("/api/achievements"),
  boxes: () => request<any>("/api/slice-boxes"),
  box: (id: string) => request<any>(`/api/slice-boxes/${id}`),
  createBox: (name: string) =>
    request<any>("/api/slice-boxes", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),
  renameBox: (id: string, name: string) =>
    request<any>(`/api/slice-boxes/${id}`, {
      method: "PUT",
      body: JSON.stringify({ name }),
    }),
  following: (id: string) => request<any>(`/api/follows/following/${id}`),
  followers: (id: string) => request<any>(`/api/follows/followers/${id}`),
  followStatus: (id: string) => request<any>(`/api/follows/status/${id}`),
  follow: (id: string, following: boolean) =>
    request<any>(`/api/follows/${id}`, {
      method: "POST",
      body: JSON.stringify({ following }),
    }),
  blocked: () => request<any>("/api/follows/blocks"),
  block: (id: string, blocked: boolean) =>
    request(`/api/follows/blocks/${id}`, {
      method: "PUT",
      body: JSON.stringify({ blocked }),
    }),
  frostShells: () => request<any>("/api/frost-shells"),
  giftFrostShell: (recipientId: string, source = "profile", relatedId = "") =>
    request<any>("/api/frost-shells/gift", {
      method: "POST",
      body: JSON.stringify({ recipientId, source, relatedId }),
    }),
  feedback: (content: string, imageUrl?: string) =>
    request("/api/feedback", {
      method: "POST",
      body: JSON.stringify({
        content,
        image_url: imageUrl,
        device_model: "网页端",
        os_version: navigator.platform,
        app_version: "web-0.1",
      }),
    }),
  feedbackHistory: () => request<any>("/api/feedback"),
};
