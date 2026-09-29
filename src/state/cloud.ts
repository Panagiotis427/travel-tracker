// Cloud sync (Supabase). Row-level security scopes every query to the logged-in
// user, so selects need no filter; writes include user_id to satisfy the policy.
// Deletes are soft: the row stays with deleted_at set, so a device that still holds the
// place drops it at its next sync instead of pushing it back. Only "Delete account"
// removes rows.
import { supabase } from '../lib/supabase';
import type { CloudMarks, Status, VisitMap } from './status';
import { normalizeVisit } from './status';
import { isoTime } from '../lib/dates';

interface Row { user_id?: string; place_id: string; status: string; trips: unknown; updated_at: string; deleted_at?: string | null; }

const COLUMNS = 'place_id,status,trips,updated_at,deleted_at';

// Supabase caps every select at its "Max rows" API setting (1000 by default), so rows are
// read in pages. PAGE must not exceed that setting: a capped page would look like the last.
const PAGE = 1000;
// Places per "what does the cloud hold for these" query, which keeps its URL short.
const CHUNK = 100;

const none = (): CloudMarks => ({ live: {}, deleted: {} });

// A row is deleted when its deleted_at is at least as new as its last write. An app version
// from before soft deletes re-marks a place without clearing deleted_at; the newer
// updated_at then makes the row live again.
function sortRows(rows: Row[], into: CloudMarks): void {
  for (const r of rows) {
    if (r.deleted_at && isoTime(r.deleted_at) >= isoTime(r.updated_at)) {
      into.deleted[r.place_id] = r.deleted_at;
      continue;
    }
    const v = normalizeVisit({ status: r.status as Status, trips: r.trips, updatedAt: r.updated_at });
    if (v) into.live[r.place_id] = v;
  }
}

/**
 * All of the user's rows, live and deleted, or null when they couldn't be read. Unreadable
 * is not empty: treating it as empty would make the sign-in merge re-push every row.
 */
export async function pullRemote(): Promise<CloudMarks | null> {
  if (!supabase) return none();
  const out = none();
  try {
    // Keyset paging (place_id is unique per user): rows written meanwhile can't shift a page.
    for (let after: string | null = null; ;) {
      let q = supabase.from('visits').select(COLUMNS).order('place_id').limit(PAGE);
      if (after !== null) q = q.gt('place_id', after);
      const { data, error } = await q;
      if (error || !data) return null;
      sortRows(data as Row[], out);
      if (data.length < PAGE) return out;
      after = (data[data.length - 1] as Row).place_id;
    }
  } catch {
    return null; // supabase-js throws on some transport failures
  }
}

/** What the cloud holds now for these places, live or deleted, or null when unreadable. */
export async function pullPlaces(ids: string[]): Promise<CloudMarks | null> {
  if (!supabase) return none();
  const out = none();
  try {
    for (let i = 0; i < ids.length; i += CHUNK) {
      const { data, error } = await supabase.from('visits').select(COLUMNS).in('place_id', ids.slice(i, i + CHUNK));
      if (error || !data) return null;
      sortRows(data as Row[], out);
    }
    return out;
  } catch {
    return null;
  }
}

function toRows(userId: string, map: VisitMap): Row[] {
  return Object.entries(map).map(([id, v]) => ({
    user_id: userId,
    place_id: id,
    status: v.status,
    trips: v.trips,
    updated_at: v.updatedAt,
    deleted_at: null, // a mark, or a re-mark after a delete, is live
  }));
}

// supabase-js RETURNS errors instead of throwing them (and throws on some transport
// failures), so every write reports success explicitly: callers retry what failed.
async function ok(req: PromiseLike<{ error: unknown }>): Promise<boolean> {
  try { const { error } = await req; return !error; } catch { return false; }
}

export async function pushRemote(userId: string, map: VisitMap): Promise<boolean> {
  if (!supabase) return true;
  const rows = toRows(userId, map);
  if (!rows.length) return true;
  return ok(supabase.from('visits').upsert(rows, { onConflict: 'user_id,place_id' }));
}

/**
 * Delete one place, unless the stored row is newer than our delete (last write wins). The
 * row keeps its status and trips and becomes a tombstone, so every device drops the place.
 */
export async function deleteRemote(id: string, deletedAt: string): Promise<boolean> {
  if (!supabase) return true;
  return ok(supabase.from('visits').update({ deleted_at: deletedAt, updated_at: deletedAt }).eq('place_id', id).lte('updated_at', deletedAt));
}

/** "Clear all marks": tombstone the rows written up to the clear; newer ones from another device survive. */
export async function deleteClearedRemote(clearedAt: string): Promise<boolean> {
  if (!supabase) return true;
  return ok(supabase.from('visits').update({ deleted_at: clearedAt, updated_at: clearedAt }).lte('updated_at', clearedAt));
}

/** Account deletion: remove every row, tombstones included. */
export async function deleteAllRemote(): Promise<boolean> {
  if (!supabase) return true;
  return ok(supabase.from('visits').delete().neq('place_id', ''));
}
