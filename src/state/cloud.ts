// Cloud sync (Supabase). Row-level security scopes every query to the logged-in
// user, so selects need no filter; writes include user_id to satisfy the policy.
import { supabase } from '../lib/supabase';
import type { Status, Visit, VisitMap } from './status';
import { normalizeVisit } from './status';

interface Row { user_id?: string; place_id: string; status: string; trips: unknown; updated_at: string; }

export async function pullRemote(): Promise<VisitMap> {
  if (!supabase) return {};
  const { data, error } = await supabase.from('visits').select('place_id,status,trips,updated_at');
  if (error || !data) return {};
  const m: VisitMap = {};
  for (const r of data as Row[]) {
    const v = normalizeVisit({ status: r.status as Status, trips: r.trips, updatedAt: r.updated_at });
    if (v) m[r.place_id] = v;
  }
  return m;
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

export async function pushRemote(userId: string, map: VisitMap): Promise<void> {
  if (!supabase) return;
  const rows = toRows(userId, map);
  if (!rows.length) return;
  await supabase.from('visits').upsert(rows, { onConflict: 'user_id,place_id' });
}

export async function upsertRemote(userId: string, id: string, v: Visit): Promise<void> {
  if (!supabase) return;
  await supabase.from('visits').upsert(toRows(userId, { [id]: v }), { onConflict: 'user_id,place_id' });
}

export async function deleteRemote(id: string): Promise<void> {
  if (!supabase) return;
  await supabase.from('visits').delete().eq('place_id', id);
}

export async function deleteAllRemote(): Promise<void> {
  if (!supabase) return;
  await supabase.from('visits').delete().neq('place_id', '');
}
