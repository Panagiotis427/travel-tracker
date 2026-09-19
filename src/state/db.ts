// Local-first persistence in IndexedDB (one row per place). All calls are wrapped
// so the app keeps working in-memory if storage is unavailable (private mode etc.).
// Reads normalize legacy shapes; a one-time migration imports the old localStorage map.
import { openDB } from 'idb';
import type { IDBPDatabase } from 'idb';
import type { Status, Visit, VisitMap } from './status';
import { normalizeVisit } from './status';

const DB_NAME = 'travel-tracker';
const STORE = 'visits';
const OLD_KEY = 'travel-tracker:statuses:v1';

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

async function migrateFromLocalStorage(d: IDBPDatabase): Promise<VisitMap> {
  const map: VisitMap = {};
  try {
    const raw = localStorage.getItem(OLD_KEY);
    if (!raw) return map;
    const old = JSON.parse(raw) as Record<string, Status>;
    const now = new Date().toISOString();
    const tx = d.transaction(STORE, 'readwrite');
    for (const [id, status] of Object.entries(old)) {
      const v: Visit = { status, trips: [], updatedAt: now };
      map[id] = v;
      await tx.store.put(v, id);
    }
    await tx.done;
    localStorage.removeItem(OLD_KEY);
  } catch {
    /* ignore */
  }
  return map;
}

export async function getAllVisits(): Promise<VisitMap> {
  try {
    const d = await db();
    const keys = await d.getAllKeys(STORE);
    const vals = await d.getAll(STORE);
    const map: VisitMap = {};
    keys.forEach((k, i) => {
      const v = normalizeVisit(vals[i]);
      if (v) map[String(k)] = v;
    });
    if (keys.length === 0) return migrateFromLocalStorage(d);
    return map;
  } catch {
    return {};
  }
}

export async function putVisit(id: string, v: Visit): Promise<void> {
  try { const d = await db(); await d.put(STORE, v, id); } catch { /* ignore */ }
}

export async function deleteVisit(id: string): Promise<void> {
  try { const d = await db(); await d.delete(STORE, id); } catch { /* ignore */ }
}

export async function clearVisits(): Promise<void> {
  try { const d = await db(); await d.clear(STORE); } catch { /* ignore */ }
}

export async function putMany(map: VisitMap): Promise<void> {
  try {
    const d = await db();
    const tx = d.transaction(STORE, 'readwrite');
    for (const [id, v] of Object.entries(map)) await tx.store.put(v, id);
    await tx.done;
  } catch { /* ignore */ }
}
