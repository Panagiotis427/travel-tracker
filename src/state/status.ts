export type Status = 'visited' | 'want' | 'lived' | 'transit';
export type StatusMap = Record<string, Status>;

export const STATUS_META: Record<Status, { label: string; color: string }> = {
  visited: { label: 'Visited', color: '#3498db' },
  want: { label: 'Want to go', color: '#e67e22' },
  lived: { label: 'Lived', color: '#2ecc71' },
  transit: { label: 'Transit', color: '#9b59b6' },
};

export const UNVISITED_COLOR = '#e7ecf0';

// Tap cycles through these; null clears the mark.
const CYCLE: (Status | null)[] = ['visited', 'want', 'lived', null];

export function nextStatus(cur: Status | undefined): Status | null {
  const i = CYCLE.indexOf(cur ?? null);
  return CYCLE[(i + 1) % CYCLE.length];
}

const KEY = 'travel-tracker:statuses:v1';

export function loadStatuses(): StatusMap {
  try {
    return JSON.parse(localStorage.getItem(KEY) || '{}') as StatusMap;
  } catch {
    return {};
  }
}

export function saveStatuses(m: StatusMap): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(m));
  } catch {
    /* private mode / blocked storage: keep working in-memory */
  }
}
