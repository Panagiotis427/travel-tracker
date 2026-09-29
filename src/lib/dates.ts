/** Inclusive day count between two ISO dates, or null if invalid/incomplete. */
export function durationDays(start?: string, end?: string): number | null {
  if (!start || !end) return null;
  const a = new Date(start).getTime();
  const b = new Date(end).getTime();
  if (Number.isNaN(a) || Number.isNaN(b) || b < a) return null;
  return Math.round((b - a) / 86_400_000) + 1;
}

/** Calendar day of an ISO date or datetime ("2026-09-29" or "2026-09-29T14:00"), DST-safe. */
function dayIndex(s: string): number | null {
  const ms = Date.parse(`${s.slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(ms) ? Math.round(ms / 86_400_000) : null;
}

/**
 * Distinct calendar days covered by any trip. A day counts once even when several places
 * record it, e.g. a country and its region marked for the same visit, or two countries
 * crossed on one day. Incomplete or reversed trips are ignored, as in durationDays.
 */
export function distinctTripDays(trips: Array<{ start?: string; end?: string }>): number {
  const days = new Set<number>();
  for (const t of trips) {
    if (!t.start || !t.end) continue;
    const a = dayIndex(t.start);
    const b = dayIndex(t.end);
    if (a === null || b === null || b < a) continue;
    for (let d = a; d <= Math.min(b, a + 36_600); d++) days.add(d); // cap a mistyped range at ~100 years
  }
  return days.size;
}

/** Date -> local yyyy-mm-dd (not UTC, so late-evening photos keep their day). */
export function isoDate(d: Date): string {
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

/**
 * ISO timestamp -> epoch ms (0 when missing/invalid). Sync compares INSTANTS this way,
 * never strings: the client writes "...Z" but PostgREST returns "...+00:00", and
 * comparing those strings can order two moments wrongly.
 */
export function isoTime(s?: string): number {
  const n = s ? Date.parse(s) : NaN;
  return Number.isFinite(n) ? n : 0;
}

export function minIso(a?: string, b?: string): string | undefined {
  if (!a) return b;
  if (!b) return a;
  return a < b ? a : b;
}

export function maxIso(a?: string, b?: string): string | undefined {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

export function fmtDuration(days: number | null): string {
  if (days == null) return '';
  if (days < 14) return `${days} day${days === 1 ? '' : 's'}`;
  if (days < 60) return `${Math.round(days / 7)} weeks`;
  if (days < 365) return `${Math.round(days / 30)} months`;
  const y = days / 365;
  return `${y.toFixed(y < 10 ? 1 : 0)} years`;
}
