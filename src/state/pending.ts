// Sync state kept on this device until the server confirms it:
//  - tombstones: deletes (and "clear all") not yet confirmed, so a delete made offline is
//    retried instead of lost, and the next sign-in merge doesn't bring the mark back;
//  - dirty ids: places changed here since their last confirmed push, so a sync sends only
//    what this device actually changed (a stale device can no longer overwrite another
//    device's newer rows for places it never touched).
//
// Timestamps keep this last-write-wins, like the rest of the sync: a remote row that is
// NEWER than our delete means another device re-marked the place afterwards, so it wins
// and our tombstone is dropped instead of deleting the newer row.
import type { VisitMap } from './status';
import { isoTime } from '../lib/dates';

export interface Pending {
  dels: Record<string, string>; // place id -> ISO time it was deleted here
  clearedAt?: string;           // "Clear all marks" done here but not yet confirmed
  dirty: string[];              // place ids changed here, not yet confirmed by a push
}

const key = (uid: string) => `travel-tracker:pending:${uid}`;

export function loadPending(uid: string): Pending {
  try {
    const raw = localStorage.getItem(key(uid));
    if (!raw) return { dels: {}, dirty: [] };
    const p = JSON.parse(raw) as Partial<Pending>;
    return {
      dels: p.dels && typeof p.dels === 'object' ? p.dels : {},
      clearedAt: typeof p.clearedAt === 'string' ? p.clearedAt : undefined,
      dirty: Array.isArray(p.dirty) ? p.dirty.filter((x): x is string => typeof x === 'string') : [],
    };
  } catch {
    return { dels: {}, dirty: [] };
  }
}

function savePending(uid: string, p: Pending): void {
  try {
    if (!Object.keys(p.dels).length && !p.clearedAt && !p.dirty.length) localStorage.removeItem(key(uid));
    else localStorage.setItem(key(uid), JSON.stringify(p));
  } catch { /* storage full/blocked: worst case the next sign-in re-syncs everything */ }
}

/** Anything the server hasn't confirmed yet (drives the sync status line). */
export function hasPending(p: Pending): boolean {
  return !!p.clearedAt || Object.keys(p.dels).length > 0 || p.dirty.length > 0;
}

export function addTombstone(uid: string, id: string, at: string): void {
  const p = loadPending(uid);
  p.dels[id] = at;
  p.dirty = p.dirty.filter((x) => x !== id); // a deleted place has nothing left to push
  savePending(uid, p);
}

/** Its delete was confirmed by the server. */
export function dropTombstone(uid: string, id: string): void {
  const p = loadPending(uid);
  if (!(id in p.dels)) return;
  delete p.dels[id];
  savePending(uid, p);
}

/** Places changed on this device. Re-marking a place also retires its pending delete. */
export function markDirty(uid: string, ids: string[]): void {
  if (!ids.length) return;
  const p = loadPending(uid);
  const set = new Set(p.dirty);
  for (const id of ids) { set.add(id); delete p.dels[id]; }
  p.dirty = [...set];
  savePending(uid, p);
}

/** These places were pushed successfully. */
export function clearDirty(uid: string, ids: string[]): void {
  if (!ids.length) return;
  const p = loadPending(uid);
  const done = new Set(ids);
  p.dirty = p.dirty.filter((x) => !done.has(x));
  savePending(uid, p);
}

export function markCleared(uid: string, at: string): void {
  // A clear supersedes every earlier individual delete and pending push.
  savePending(uid, { dels: {}, clearedAt: at, dirty: [] });
}

export function confirmCleared(uid: string, at: string): void {
  const p = loadPending(uid);
  if (p.clearedAt === at) { p.clearedAt = undefined; savePending(uid, p); }
}

/**
 * Filter a freshly pulled remote map through this device's pending deletes.
 * `kept` excludes rows our deletes supersede; `stale` lists tombstones that lost to a
 * newer remote row (another device re-marked the place later) and should be dropped.
 */
export function applyTombstones(remote: VisitMap, p: Pending): { kept: VisitMap; stale: string[] } {
  const kept: VisitMap = {};
  const stale: string[] = [];
  const cleared = isoTime(p.clearedAt);
  for (const [id, v] of Object.entries(remote)) {
    const at = isoTime(v.updatedAt);
    if (p.clearedAt && at <= cleared) continue; // cleared here after this row was written
    const del = p.dels[id];
    if (del !== undefined) {
      if (at <= isoTime(del)) continue; // our delete is newer: keep it deleted
      stale.push(id);                    // the remote re-mark is newer: it wins
    }
    kept[id] = v;
  }
  return { kept, stale };
}
