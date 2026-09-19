export type Status = 'visited' | 'want' | 'lived' | 'transit';

/** id -> status, derived from visits for the globe layer. */
export type StatusMap = Record<string, Status>;

/** One trip to a place (a place can have several). */
export interface Trip {
  start?: string; // ISO date yyyy-mm-dd
  end?: string;
  note?: string;
}

/** One record per place (country ADM0_A3 or admin-1 adm1_code). */
export interface Visit {
  status: Status;
  trips: Trip[];
  updatedAt: string; // ISO timestamp — last-write-wins key for import merge
}

export type VisitMap = Record<string, Visit>;

export const STATUS_META: Record<Status, { label: string; color: string }> = {
  visited: { label: 'Visited', color: '#3498db' },
  want: { label: 'Want to go', color: '#e67e22' },
  lived: { label: 'Lived', color: '#2ecc71' },
  transit: { label: 'Transit', color: '#9b59b6' },
};

// Muted slate for unvisited land — reads well on the dark globe and in the legend.
export const UNVISITED_COLOR = '#5b7284';

/** Coerce any legacy/loose shape into a current Visit (single-date -> one trip). */
export function normalizeVisit(raw: unknown): Visit | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.status !== 'string') return null;
  let trips: Trip[];
  if (Array.isArray(r.trips)) {
    trips = (r.trips as Trip[]).filter((t) => t && typeof t === 'object');
  } else {
    trips = r.start || r.end || r.note ? [{ start: r.start as string, end: r.end as string, note: r.note as string }] : [];
  }
  return { status: r.status as Status, trips, updatedAt: (r.updatedAt as string) ?? new Date().toISOString() };
}
