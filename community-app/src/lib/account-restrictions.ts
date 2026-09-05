export function restrictionRemaining(until?: string | null): string {
  if (!until) return '永久';
  const remaining = Date.parse(until) - Date.now();
  if (remaining <= 0) return '即将解除';
  const days = Math.floor(remaining / 86_400_000);
  const hours = Math.floor((remaining % 86_400_000) / 3_600_000);
  const minutes = Math.max(1, Math.ceil((remaining % 3_600_000) / 60_000));
  if (days) return `${days}天${hours ? `${hours}小时` : ''}`;
  if (hours) return `${hours}小时${minutes ? `${minutes}分钟` : ''}`;
  return `${minutes}分钟`;
}
