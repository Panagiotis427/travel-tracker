// Local-first persistence in IndexedDB, SCOPED PER USER. Keys are `${uid}::${placeId}`
// so accounts never see each other's data. Guests (no uid) are handled by the caller:
// nothing is written, so "continue without an account" saves nothing.
import { openDB } from 'idb';
import type { IDBPDatabase } from 'idb';
import type { Visit, VisitMap } from './status';
import { normalizeVisit } from './status';

const DB_NAME = 'travel-tracker';
const STORE = 'visits';

let dbp: Promise<IDBPDatabase> | null = null;
function db(): Promise<IDBPDatabase> {
  if (!dbp) {
    dbp = openDB(DB_NAME, 1, {
      upgrade(d) {
        if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE);
      },
    });
  }
  return dbp;
}

const key = (uid: string, id: string) => `${uid}::${id}`;

export async function getUserVisits(uid: string): Promise<VisitMap> {
  try {
    const d = await db();
    const keys = await d.getAllKeys(STORE);
    const vals = await d.getAll(STORE);
    const pref = `${uid}::`;
    const map: VisitMap = {};
    keys.forEach((k, i) => {
      const ks = String(k);
      if (!ks.startsWith(pref)) return;
      const v = normalizeVisit(vals[i]);
      if (v) map[ks.slice(pref.length)] = v;
    });
    return map;
  } catch {
    return {};
  }
}

export async function putUserVisit(uid: string, id: string, v: Visit): Promise<void> {
  try { const d = await db(); await d.put(STORE, v, key(uid, id)); } catch { /* ignore */ }
}

export async function deleteUserVisit(uid: string, id: string): Promise<void> {
  try { const d = await db(); await d.delete(STORE, key(uid, id)); } catch { /* ignore */ }
}

export async function putUserMany(uid: string, map: VisitMap): Promise<void> {
  try {
    const d = await db();
    const tx = d.transaction(STORE, 'readwrite');
    for (const [id, v] of Object.entries(map)) tx.store.put(v, key(uid, id));
    await tx.done;
  } catch { /* ignore */ }
}

export async function clearUserVisits(uid: string): Promise<void> {
  try {
    const d = await db();
    const keys = await d.getAllKeys(STORE);
    const pref = `${uid}::`;
    const tx = d.transaction(STORE, 'readwrite');
    for (const k of keys) if (String(k).startsWith(pref)) tx.store.delete(k);
    await tx.done;
  } catch { /* ignore */ }
}
