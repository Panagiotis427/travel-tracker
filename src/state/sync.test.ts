import { describe, it, expect, beforeEach, vi } from 'vitest';
import { flushPending } from './sync';
import type { SyncDeps } from './sync';
import { loadPending, markDirty, addTombstone, markCleared } from './pending';
import type { VisitMap } from './status';

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  });
});

const v = (updatedAt: string): VisitMap[string] => ({ status: 'visited', trips: [], updatedAt });

function deps(over: Partial<SyncDeps> = {}, latest: VisitMap = {}): SyncDeps & { pushed: VisitMap[] } {
  const pushed: VisitMap[] = [];
  return {
    pushed,
    deleteCleared: vi.fn(async () => true),
    deleteOne: vi.fn(async () => true),
    push: vi.fn(async (_uid: string, rows: VisitMap) => { pushed.push(rows); return true; }),
    latest: () => latest,
    online: () => true,
    ...over,
  };
}

describe('flushPending', () => {
  it('does nothing and reports synced when nothing is pending', async () => {
    const d = deps();
    expect(await flushPending('u', { FRA: v('2026-01-01T00:00:00Z') }, d)).toBe('synced');
    expect(d.push).not.toHaveBeenCalled();
  });

  it('pushes only the places this device changed, then clears them', async () => {
    const map = { FRA: v('2026-01-01T00:00:00Z'), DEU: v('2026-01-02T00:00:00Z') };
    markDirty('u', ['FRA']);
    const d = deps({}, map);
    expect(await flushPending('u', map, d)).toBe('synced');
    expect(d.pushed).toEqual([{ FRA: map.FRA }]); // DEU was not changed here, so it is not sent
    expect(loadPending('u').dirty).toEqual([]);
  });

  it('keeps changes queued when the push fails, reporting error online and offline otherwise', async () => {
    const map = { FRA: v('2026-01-01T00:00:00Z') };
    markDirty('u', ['FRA']);
    expect(await flushPending('u', map, deps({ push: async () => false }, map))).toBe('error');
    expect(await flushPending('u', map, deps({ push: async () => false, online: () => false }, map))).toBe('offline');
    expect(loadPending('u').dirty).toEqual(['FRA']);
  });

  it('keeps a place queued if it was re-edited while its push was in flight', async () => {
    const sent = { FRA: v('2026-01-01T00:00:00Z') };
    markDirty('u', ['FRA']);
    const d = deps({}, { FRA: v('2026-01-01T00:00:05Z') }); // newer edit landed meanwhile
    expect(await flushPending('u', sent, d)).toBe('error');
    expect(loadPending('u').dirty).toEqual(['FRA']);
  });

  it('drops queued places that are no longer marked, without pushing them', async () => {
    markDirty('u', ['FRA']);
    const d = deps();
    expect(await flushPending('u', {}, d)).toBe('synced');
    expect(d.push).not.toHaveBeenCalled();
  });

  it('retries pending deletes and forgets them once the server confirms', async () => {
    addTombstone('u', 'FRA', '2026-02-01T00:00:00Z');
    addTombstone('u', 'DEU', '2026-02-01T00:00:00Z');
    const d = deps({ deleteOne: vi.fn(async (id: string) => id === 'FRA') });
    expect(await flushPending('u', {}, d)).toBe('error');
    expect(d.deleteOne).toHaveBeenCalledWith('FRA', '2026-02-01T00:00:00Z');
    expect(Object.keys(loadPending('u').dels)).toEqual(['DEU']);
  });

  it('confirms a pending clear-all only when the server accepts it', async () => {
    markCleared('u', '2026-03-01T00:00:00Z');
    expect(await flushPending('u', {}, deps({ deleteCleared: async () => false }))).toBe('error');
    expect(loadPending('u').clearedAt).toBe('2026-03-01T00:00:00Z');
    const d = deps();
    expect(await flushPending('u', {}, d)).toBe('synced');
    expect(d.deleteCleared).toHaveBeenCalledWith('2026-03-01T00:00:00Z');
    expect(loadPending('u').clearedAt).toBeUndefined();
  });
});
