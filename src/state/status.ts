export type Status = 'visited' | 'want' | 'lived' | 'transit';

/** id -> status, derived from visits for the globe layer. */
export type StatusMap = Record<string, Status>;

/** One record per place (country ADM0_A3 or admin-1 adm1_code). */
export interface Visit {
  status: Status;
  start?: string; // ISO date yyyy-mm-dd
  end?: string; // ISO date yyyy-mm-dd
  note?: string;
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
