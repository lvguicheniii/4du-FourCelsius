function parseDate(value?: string | Date | null): Date | null {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;

  const normalized = /(?:Z|[+-]\d{2}:\d{2})$/.test(value)
    ? value
    : `${value.replace(' ', 'T')}+08:00`;
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : date;
}

function pad(value: number) {
  return String(value).padStart(2, '0');
}

export function formatExactTime(value?: string | Date | null) {
  const date = parseDate(value);
  if (!date) return '';

  const now = new Date();
  const year = date.getFullYear();
  const prefix = year === now.getFullYear() ? '' : `${year}-`;
  return `${prefix}${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function formatChatMessageTime(value?: string | Date | null, exact = false) {
  const date = parseDate(value);
  if (!date) return typeof value === 'string' ? value : '';

  const now = new Date();
  const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const dateTimeGap = '\u00A0';
  if (exact) {
    const year = date.getFullYear() === now.getFullYear() ? '' : `${date.getFullYear()}年`;
    return `${year}${date.getMonth() + 1}月${date.getDate()}日${dateTimeGap}${clock}`;
  }

  const diff = Math.max(0, now.getTime() - date.getTime());
  if (diff < 60_000) return '刚刚';

  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const calendarDays = Math.max(0, Math.round((startOfToday - startOfDate) / 86_400_000));
  if (calendarDays === 0) return clock;
  if (calendarDays === 1) return `昨天${dateTimeGap}${clock}`;
  if (calendarDays < 30) return `${calendarDays}天前${dateTimeGap}${clock}`;
  return `${date.getMonth() + 1}月${date.getDate()}日${dateTimeGap}${clock}`;
}

export function formatFullDateTime(value?: string | Date | null) {
  const date = parseDate(value);
  if (!date) return '';
  return `${date.getFullYear()}年${pad(date.getMonth() + 1)}月${pad(date.getDate())}日 ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function formatCommentTime(value?: string | Date | null) {
  const date = parseDate(value);
  if (!date) return '';

  const now = new Date();
  const diff = Math.max(0, now.getTime() - date.getTime());
  const minutes = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.max(1, Math.floor(diff / 86_400_000));
  const clock = `${pad(date.getHours())}:${pad(date.getMinutes())}`;

  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes}分钟前`;
  if (hours < 24) return `${hours}小时前`;
  if (hours < 48) return `昨天 ${clock}`;
  if (days < 30) return `${days}天前 ${clock}`;
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${clock}`;
}

export function formatRelativeTime(
  value?: string | Date | null,
  options: { absoluteAfterDays?: number | null } = {},
) {
  const date = parseDate(value);
  if (!date) return '';

  const now = new Date();
  const diff = Math.max(0, now.getTime() - date.getTime());
  const minutes = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);
  const absoluteAfterDays = options.absoluteAfterDays;

  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes}分钟前`;
  if (hours < 24) return `${hours}小时前`;

  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfDate = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const calendarDays = Math.round((startOfToday - startOfDate) / 86_400_000);
  if (calendarDays === 1) return '昨天';

  if (absoluteAfterDays != null && days >= absoluteAfterDays) {
    return formatExactTime(date);
  }
  if (days < 30) return `${Math.max(1, days)}天前`;
  if (days < 365) return `${Math.max(1, Math.floor(days / 30))}个月前`;
  return `${Math.max(1, Math.floor(days / 365))}年前`;
}
