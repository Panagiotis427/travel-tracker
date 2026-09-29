// Cloud sync (Supabase). Row-level security scopes every query to the logged-in
// user, so selects need no filter; writes include user_id to satisfy the policy.
import { supabase } from '../lib/supabase';
import type { Status, VisitMap } from './status';
import { normalizeVisit } from './status';

interface Row { user_id?: string; place_id: string; status: string; trips: unknown; updated_at: string; }

// Supabase caps every select at its "Max rows" API setting (1000 by default), so rows are
// read in pages. PAGE must not exceed that setting: a capped page would look like the last.
const PAGE = 1000;

/**
 * All of the user's rows, or null when they couldn't be read. Unreadable is not empty:
 * treating it as empty would make the sign-in merge re-push every row on this device.
 */
export async function pullRemote(): Promise<VisitMap | null> {
  if (!supabase) return {};
  const m: VisitMap = {};
  try {
    // Keyset paging (place_id is unique per user): rows written meanwhile can't shift a page.
    for (let after: string | null = null; ;) {
      let q = supabase.from('visits').select('place_id,status,trips,updated_at').order('place_id').limit(PAGE);
      if (after !== null) q = q.gt('place_id', after);
      const { data, error } = await q;
      if (error || !data) return null;
      for (const r of data as Row[]) {
        const v = normalizeVisit({ status: r.status as Status, trips: r.trips, updatedAt: r.updated_at });
        if (v) m[r.place_id] = v;
      }
      if (data.length < PAGE) return m;
      after = (data[data.length - 1] as Row).place_id;
    }
  } catch {
    return null; // supabase-js throws on some transport failures
  }
}

function toRows(userId: string, map: VisitMap): Row[] {
  return Object.entries(map).map(([id, v]) => ({
    user_id: userId,
    place_id: id,
    status: v.status,
    trips: v.trips,
    updated_at: v.updatedAt,
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

/** Delete one place, unless the stored row is newer than our delete (last write wins). */
export async function deleteRemote(id: string, deletedAt: string): Promise<boolean> {
  if (!supabase) return true;
  return ok(supabase.from('visits').delete().eq('place_id', id).lte('updated_at', deletedAt));
}

/** "Clear all marks": delete rows written up to the clear; newer ones from another device survive. */
export async function deleteClearedRemote(clearedAt: string): Promise<boolean> {
  if (!supabase) return true;
  return ok(supabase.from('visits').delete().lte('updated_at', clearedAt));
}

/** Account deletion: remove every row. */
export async function deleteAllRemote(): Promise<boolean> {
  if (!supabase) return true;
  return ok(supabase.from('visits').delete().neq('place_id', ''));
}
