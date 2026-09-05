import { getToken, trackRecommendationEvents } from '@/api/client';

type RecommendationEvent = {
  postId: string;
  eventType: 'impression' | 'open' | 'dwell';
  dwellMs?: number;
  sessionId: string;
};

function createSessionId() {
  return `feed_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
}

let sessionId = createSessionId();
let queueToken = getToken();
const impressionIds = new Set<string>();
let queue: RecommendationEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

function resetScope(nextToken: string | null) {
  if (timer) clearTimeout(timer);
  timer = null;
  queue = [];
  impressionIds.clear();
  sessionId = createSessionId();
  queueToken = nextToken;
}

function ensureCurrentScope() {
  const currentToken = getToken();
  if (currentToken !== queueToken) resetScope(currentToken);
}

function flush() {
  timer = null;
  if (getToken() !== queueToken) {
    resetScope(getToken());
    return;
  }
  const batch = queue.splice(0, 50);
  if (!batch.length) return;
  trackRecommendationEvents(batch).catch(() => {});
  if (queue.length) timer = setTimeout(flush, 800);
}

export function queueRecommendationEvent(
  postId: string,
  eventType: RecommendationEvent['eventType'],
  dwellMs?: number,
) {
  if (!postId) return;
  ensureCurrentScope();
  if (eventType === 'impression') {
    if (impressionIds.has(postId)) return;
    impressionIds.add(postId);
  }
  queue.push({ postId, eventType, dwellMs, sessionId });
  if (!timer) timer = setTimeout(flush, 800);
}
