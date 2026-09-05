const PRIVATE_OPERATIONS_TITLES = new Set(['系统运维告警', '系统运维恢复']);

export function isPrivateOperationsNotification(item: { title?: string | null }) {
  return PRIVATE_OPERATIONS_TITLES.has(String(item.title || '').trim());
}

export function isAchievementNotification(item: { type?: string | null; title?: string | null }) {
  return item.type === 'achievement' || /^航行日志解锁[：:]/.test(String(item.title || '').trim());
}

export function filterUserVisibleNotifications<T extends { title?: string | null }>(items: T[]) {
  return items.filter(item => !isPrivateOperationsNotification(item));
}
