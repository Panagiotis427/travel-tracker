// Sync orchestration, kept free of React and of the Supabase client so it can be tested:
// send everything the cloud hasn't confirmed yet (a pending "clear all", pending deletes,
// then ONLY the places this device changed) and report where that leaves the device.
import type { VisitMap } from './status';
import { loadPending, hasPending, confirmCleared, dropTombstone, clearDirty } from './pending';

export type SyncState = 'synced' | 'syncing' | 'offline' | 'error';

export interface SyncDeps {
  deleteCleared: (clearedAt: string) => Promise<boolean>;
  deleteOne: (id: string, deletedAt: string) => Promise<boolean>;
  push: (uid: string, rows: VisitMap) => Promise<boolean>;
  /** The latest marks, read after the push: a place re-edited meanwhile stays queued. */
  latest: () => VisitMap;
  online: () => boolean;
}

/** 'synced' when nothing is left unconfirmed; otherwise 'offline' or 'error'. */
export async function flushPending(uid: string, map: VisitMap, d: SyncDeps): Promise<Exclude<SyncState, 'syncing'>> {
  let p = loadPending(uid);
  if (!hasPending(p)) return 'synced';
  if (p.clearedAt && (await d.deleteCleared(p.clearedAt))) confirmCleared(uid, p.clearedAt);
  for (const [id, at] of Object.entries(p.dels)) {
    if (await d.deleteOne(id, at)) dropTombstone(uid, id);
  }
  const gone = p.dirty.filter((id) => !map[id]); // unmarked since: its tombstone covers it
  if (gone.length) clearDirty(uid, gone);
  const ids = p.dirty.filter((id) => map[id]);
  if (ids.length && (await d.push(uid, Object.fromEntries(ids.map((id) => [id, map[id]]))))) {
    // Only clear what is still the version we sent: a place re-edited mid-push stays queued.
    const now = d.latest();
    clearDirty(uid, ids.filter((id) => now[id]?.updatedAt === map[id].updatedAt));
  }
  p = loadPending(uid);
  return !hasPending(p) ? 'synced' : d.online() ? 'error' : 'offline';
}
