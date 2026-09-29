import { describe, it, expect, beforeEach, vi } from 'vitest';
import { flushPending, mergeSignIn } from './sync';
import type { SyncDeps } from './sync';
import { loadPending, markDirty, addTombstone, markCleared } from './pending';
import type { CloudMarks, VisitMap } from './status';

const store = new Map<string, string>();
beforeEach(() => {
  store.clear();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
  });
});

const v = (updatedAt: string, status: VisitMap[string]['status'] = 'visited'): VisitMap[string] => ({ status, trips: [], updatedAt });
const cloud = (live: VisitMap = {}, deleted: Record<string, string> = {}): CloudMarks => ({ live, deleted });

function deps(over: Partial<SyncDeps> = {}, latest: VisitMap = {}): SyncDeps & { pushed: VisitMap[] } {
  const pushed: VisitMap[] = [];
  return {
    pushed,
    deleteCleared: vi.fn(async () => true),
    deleteOne: vi.fn(async () => true),
    check: vi.fn(async () => cloud()),
    push: vi.fn(async (_uid: string, rows: VisitMap) => { pushed.push(rows); return true; }),
    adopt: vi.fn(),
    latest: () => latest,
    online: () => true,
    ...over,
  };
}

describe('mergeSignIn', () => {
  const none = { dels: {}, dirty: [] };

  it('drops a place deleted on another device after this device last changed it', () => {
    const r = mergeSignIn({ FRA: v('2026-01-01T00:00:00Z') }, cloud({}, { FRA: '2026-02-01T00:00:00Z' }), none);
    expect(r.merged).toEqual({});
    expect(r.drop).toEqual(['FRA']);
    expect(r.push).toEqual([]); // not pushed back
  });

  it('keeps and pushes a re-mark made here after the delete elsewhere', () => {
    const local = { FRA: v('2026-03-01T00:00:00Z') };
    const r = mergeSignIn(local, cloud({}, { FRA: '2026-02-01T00:00:00Z' }), none);
    expect(r.merged).toEqual(local);
    expect(r.push).toEqual(['FRA']);
    expect(r.drop).toEqual([]);
  });

  it('takes newer cloud rows, pushes what the cloud lacks or holds older, leaves equal ones', () => {
    const local = { FRA: v('2026-01-01T00:00:00Z'), DEU: v('2026-03-01T00:00:00Z'), ITA: v('2026-02-01T00:00:00Z'), ESP: v('2026-01-15T00:00:00Z') };
    const live = { FRA: v('2026-02-01T00:00:00Z', 'lived'), DEU: v('2026-01-01T00:00:00Z'), ITA: v('2026-02-01T00:00:00Z'), PRT: v('2026-01-01T00:00:00Z') };
    const r = mergeSignIn(local, cloud(live), none);
    expect(r.merged).toEqual({ FRA: live.FRA, DEU: local.DEU, ITA: local.ITA, ESP: local.ESP, PRT: live.PRT });
    expect(r.push).toEqual(['DEU', 'ESP']);
  });

  it('keeps an offline delete made here over an older cloud row, but not over a newer re-mark', () => {
    const p = { dels: { FRA: '2026-02-01T00:00:00Z', DEU: '2026-02-01T00:00:00Z' }, dirty: [] };
    const live = { FRA: v('2026-01-01T00:00:00Z'), DEU: v('2026-03-01T00:00:00Z') };
    const r = mergeSignIn({}, cloud(live), p);
    expect(Object.keys(r.merged)).toEqual(['DEU']);
    expect(r.stale).toEqual(['DEU']);
  });
});

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
    expect(d.check).toHaveBeenCalledWith(['FRA']);
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

describe('flushPending against the cloud as it is now', () => {
  const edit = { FRA: v('2026-01-01T00:00:00Z') };

  it('drops a changed place that another device deleted afterwards, instead of pushing it back', async () => {
    markDirty('u', ['FRA']);
    const d = deps({ check: async () => cloud({}, { FRA: '2026-02-01T00:00:00Z' }) }, edit);
    expect(await flushPending('u', edit, d)).toBe('synced');
    expect(d.adopt).toHaveBeenCalledWith(['FRA'], {});
    expect(d.push).not.toHaveBeenCalled();
    expect(loadPending('u').dirty).toEqual([]);
  });

  it('takes a newer version from another device instead of overwriting it', async () => {
    markDirty('u', ['FRA']);
    const newer = v('2026-02-01T00:00:00Z', 'lived');
    const d = deps({ check: async () => cloud({ FRA: newer }) }, edit);
    expect(await flushPending('u', edit, d)).toBe('synced');
    expect(d.adopt).toHaveBeenCalledWith([], { FRA: newer });
    expect(d.push).not.toHaveBeenCalled();
  });

  it('pushes a re-mark newer than the delete in the cloud', async () => {
    const remark = { FRA: v('2026-03-01T00:00:00Z') };
    markDirty('u', ['FRA']);
    const d = deps({ check: async () => cloud({}, { FRA: '2026-02-01T00:00:00Z' }) }, remark);
    expect(await flushPending('u', remark, d)).toBe('synced');
    expect(d.pushed).toEqual([remark]);
    expect(d.adopt).not.toHaveBeenCalled();
  });

  it('clears a place the cloud already holds in this very version', async () => {
    markDirty('u', ['FRA']);
    const d = deps({ check: async () => cloud({ FRA: edit.FRA }) }, edit);
    expect(await flushPending('u', edit, d)).toBe('synced');
    expect(d.push).not.toHaveBeenCalled();
    expect(loadPending('u').dirty).toEqual([]);
  });

  it('sends nothing while the cloud cannot be read, and keeps the change queued', async () => {
    markDirty('u', ['FRA']);
    const d = deps({ check: async () => null }, edit);
    expect(await flushPending('u', edit, d)).toBe('error');
    expect(d.push).not.toHaveBeenCalled();
    expect(loadPending('u').dirty).toEqual(['FRA']);
  });

  it('leaves a place queued, and untouched, if it was re-edited while the check ran', async () => {
    markDirty('u', ['FRA']);
    const d = deps({ check: async () => cloud({}, { FRA: '2026-02-01T00:00:00Z' }) }, { FRA: v('2026-02-05T00:00:00Z') });
    expect(await flushPending('u', edit, d)).toBe('error');
    expect(d.adopt).not.toHaveBeenCalled();
    expect(d.push).not.toHaveBeenCalled();
    expect(loadPending('u').dirty).toEqual(['FRA']);
  });
});
