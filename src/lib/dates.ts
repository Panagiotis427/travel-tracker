/** Inclusive day count between two ISO dates, or null if invalid/incomplete. */
export function durationDays(start?: string, end?: string): number | null {
  if (!start || !end) return null;
  const a = new Date(start).getTime();
  const b = new Date(end).getTime();
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return null;
  return Math.round((b - a) / 86_400_000) + 1;
}

export function fmtDuration(days: number | null): string {
  if (days == null) return '';
  if (days < 14) return `${days} day${days === 1 ? '' : 's'}`;
  if (days < 60) return `${Math.round(days / 7)} weeks`;
  if (days < 365) return `${Math.round(days / 30)} months`;
  const y = days / 365;
  return `${y.toFixed(y < 10 ? 1 : 0)} years`;
}
