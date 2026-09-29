// Pending cloud deletes ("tombstones"), kept on this device until the server confirms.
// Without them a delete made offline, or while the sync server is paused, never reaches
// the cloud, and the next sign-in's merge brings the "deleted" mark back.
//
// Timestamps keep this last-write-wins, like the rest of the sync: a remote row that is
// NEWER than our delete means another device re-marked the place afterwards, so it wins
// and our tombstone is dropped instead of deleting the newer row.
import type { VisitMap } from './status';

export interface Pending {
  dels: Record<string, string>; // place id -> ISO time it was deleted here
  clearedAt?: string;           // "Clear all marks" done here but not yet confirmed
}

const key = (uid: string) => `travel-tracker:pending:${uid}`;

export function loadPending(uid: string): Pending {
  try {
    const raw = localStorage.getItem(key(uid));
    if (!raw) return { dels: {} };
    const p = JSON.parse(raw) as Partial<Pending>;
    return { dels: p.dels && typeof p.dels === 'object' ? p.dels : {}, clearedAt: typeof p.clearedAt === 'string' ? p.clearedAt : undefined };
  } catch {
    return { dels: {} };
  }
}

function savePending(uid: string, p: Pending): void {
  try {
    if (!Object.keys(p.dels).length && !p.clearedAt) localStorage.removeItem(key(uid));
    else localStorage.setItem(key(uid), JSON.stringify(p));
  } catch { /* storage full/blocked: worst case we fall back to the old behaviour */ }
}

export function addTombstone(uid: string, id: string, at: string): void {
  const p = loadPending(uid);
  p.dels[id] = at;
  savePending(uid, p);
}

/** The place is alive again (re-marked) or its delete was confirmed. */
export function dropTombstone(uid: string, id: string): void {
  const p = loadPending(uid);
  if (!(id in p.dels)) return;
  delete p.dels[id];
  savePending(uid, p);
}

export function markCleared(uid: string, at: string): void {
  // A clear supersedes every individual delete made before it.
  savePending(uid, { dels: {}, clearedAt: at });
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
  for (const [id, v] of Object.entries(remote)) {
    const at = v.updatedAt ?? '';
    if (p.clearedAt && at <= p.clearedAt) continue; // cleared here after this row was written
    const del = p.dels[id];
    if (del !== undefined) {
      if (at <= del) continue;  // our delete is newer: keep it deleted
      stale.push(id);           // remote re-mark is newer: it wins
    }
    kept[id] = v;
  }
  return { kept, stale };
}
