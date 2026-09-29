// Sync orchestration, kept free of React and of the Supabase client so it can be tested:
// the sign-in merge, and the flush that sends everything the cloud hasn't confirmed yet
// (a pending "clear all", pending deletes, then ONLY the places this device changed).
import type { CloudMarks, VisitMap } from './status';
import type { Pending } from './pending';
import { loadPending, hasPending, confirmCleared, dropTombstone, clearDirty, applyTombstones } from './pending';
import { isoTime } from '../lib/dates';

export type SyncState = 'synced' | 'syncing' | 'offline' | 'error';

/**
 * The sign-in merge, last write wins per place. `local` is what this device stores, `cloud`
 * what the pull returned and `p` this device's unconfirmed work. Returns the merged marks,
 * the places to push (the cloud lacks them or holds an older version), the places to drop
 * here (deleted elsewhere after this device last changed them, so they are not pushed back)
 * and this device's tombstones that lost to a newer re-mark elsewhere.
 */
export function mergeSignIn(local: VisitMap, cloud: CloudMarks, p: Pending): { merged: VisitMap; push: string[]; drop: string[]; stale: string[] } {
  // Rows this device deleted while offline must not come back from the cloud; a newer
  // re-mark from another device wins and retires its tombstone.
  const { kept: remote, stale } = applyTombstones(cloud.live, p);
  const merged: VisitMap = { ...local };
  const drop: string[] = [];
  for (const [id, at] of Object.entries(cloud.deleted)) {
    if (merged[id] && isoTime(at) >= isoTime(merged[id].updatedAt)) { delete merged[id]; drop.push(id); }
  }
  for (const [id, rv] of Object.entries(remote)) {
    const cur = merged[id];
    if (!cur || isoTime(rv.updatedAt) > isoTime(cur.updatedAt)) merged[id] = rv;
  }
  const dropped = new Set(drop);
  const push = Object.entries(local)
    .filter(([id, lv]) => !dropped.has(id) && (!remote[id] || isoTime(lv.updatedAt) > isoTime(remote[id].updatedAt)))
    .map(([id]) => id);
  return { merged, push, drop, stale };
}

export interface SyncDeps {
  deleteCleared: (clearedAt: string) => Promise<boolean>;
  deleteOne: (id: string, deletedAt: string) => Promise<boolean>;
  /** What the cloud holds now for these places, or null when it can't be read. */
  check: (ids: string[]) => Promise<CloudMarks | null>;
  push: (uid: string, rows: VisitMap) => Promise<boolean>;
  /** Take what the cloud won: drop the places deleted there, keep its newer versions. */
  adopt: (drop: string[], take: VisitMap) => void;
  /** The latest marks, read after the network calls: a place re-edited meanwhile stays queued. */
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
  // Last write wins against the cloud as it is now: a place deleted or changed on another
  // device after this device's edit is taken from there instead of being overwritten by
  // the older edit (a device can reconnect long after it went offline).
  const cloud = ids.length ? await d.check(ids) : null;
  if (cloud) {
    const now = d.latest();
    const unchanged = (id: string) => now[id]?.updatedAt === map[id].updatedAt; // not re-edited meanwhile
    const drop: string[] = [];
    const take: VisitMap = {};
    const held: string[] = []; // the cloud already holds exactly this version
    const send = ids.filter((id) => {
      const t = isoTime(map[id].updatedAt);
      const del = cloud.deleted[id];
      const rv = cloud.live[id];
      if (del !== undefined && isoTime(del) >= t) { if (unchanged(id)) drop.push(id); return false; }
      if (rv && isoTime(rv.updatedAt) > t) { if (unchanged(id)) take[id] = rv; return false; }
      if (rv && isoTime(rv.updatedAt) === t) { if (unchanged(id)) held.push(id); return false; }
      return true;
    });
    if (drop.length || Object.keys(take).length) d.adopt(drop, take);
    clearDirty(uid, [...drop, ...Object.keys(take), ...held]);
    if (send.length && (await d.push(uid, Object.fromEntries(send.map((id) => [id, map[id]]))))) {
      // Only clear what is still the version we sent: a place re-edited mid-push stays queued.
      const after = d.latest();
      clearDirty(uid, send.filter((id) => after[id]?.updatedAt === map[id].updatedAt));
    }
  }
  p = loadPending(uid);
  return !hasPending(p) ? 'synced' : d.online() ? 'error' : 'offline';
}
