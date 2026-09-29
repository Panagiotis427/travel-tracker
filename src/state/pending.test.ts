import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  applyTombstones, loadPending, addTombstone, dropTombstone, markDirty, clearDirty,
  markCleared, confirmCleared, hasPending,
} from './pending';
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

describe('applyTombstones (last write wins)', () => {
  const remote: VisitMap = {
    FRA: v('2026-01-01T00:00:00Z'),
    DEU: v('2026-03-01T00:00:00Z'),
    ITA: v('2026-01-01T00:00:00Z'),
  };

  it('keeps an older remote row deleted, so it is not resurrected', () => {
    const { kept } = applyTombstones(remote, { dels: { FRA: '2026-02-01T00:00:00Z' }, dirty: [] });
    expect(kept).not.toHaveProperty('FRA');
    expect(kept).toHaveProperty('ITA');
  });

  it('lets a newer remote re-mark win and reports the losing tombstone', () => {
    const { kept, stale } = applyTombstones(remote, { dels: { DEU: '2026-02-01T00:00:00Z' }, dirty: [] });
    expect(kept).toHaveProperty('DEU');
    expect(stale).toEqual(['DEU']);
  });

  it('drops rows written before a clear-all and keeps later ones', () => {
    const { kept } = applyTombstones(remote, { dels: {}, dirty: [], clearedAt: '2026-02-01T00:00:00Z' });
    expect(Object.keys(kept)).toEqual(['DEU']);
  });

  it('compares instants, not strings, across timestamp formats', () => {
    // 12:00+02:00 is 10:00 UTC: older than a delete at 11:00Z, although the string sorts later.
    const r: VisitMap = { A: v('2026-05-01T12:00:00+02:00') };
    const { kept, stale } = applyTombstones(r, { dels: { A: '2026-05-01T11:00:00.000Z' }, dirty: [] });
    expect(kept).toEqual({});
    expect(stale).toEqual([]);
  });

  it('keeps everything when nothing is pending', () => {
    expect(applyTombstones(remote, { dels: {}, dirty: [] }).kept).toEqual(remote);
  });
});

describe('pending storage', () => {
  it('persists tombstones per user', () => {
    addTombstone('u1', 'FRA', '2026-02-01T00:00:00Z');
    expect(loadPending('u1').dels).toEqual({ FRA: '2026-02-01T00:00:00Z' });
    expect(loadPending('u2').dels).toEqual({});
    dropTombstone('u1', 'FRA');
    expect(loadPending('u1').dels).toEqual({});
  });

  it('marks places dirty, and re-marking retires a pending delete', () => {
    addTombstone('u1', 'FRA', '2026-02-01T00:00:00Z');
    markDirty('u1', ['FRA', 'ESP']);
    const p = loadPending('u1');
    expect(p.dels).toEqual({});
    expect(new Set(p.dirty)).toEqual(new Set(['FRA', 'ESP']));
  });

  it('deleting a place removes it from the dirty set', () => {
    markDirty('u1', ['FRA', 'ESP']);
    addTombstone('u1', 'FRA', '2026-02-01T00:00:00Z');
    expect(loadPending('u1').dirty).toEqual(['ESP']);
  });

  it('clears only the pushed places', () => {
    markDirty('u1', ['FRA', 'ESP', 'ITA']);
    clearDirty('u1', ['ESP']);
    expect(new Set(loadPending('u1').dirty)).toEqual(new Set(['FRA', 'ITA']));
  });

  it('a clear-all supersedes earlier deletes and pushes, then frees storage once confirmed', () => {
    markDirty('u1', ['FRA']);
    addTombstone('u1', 'DEU', '2026-02-01T00:00:00Z');
    markCleared('u1', '2026-03-01T00:00:00Z');
    const p = loadPending('u1');
    expect(p).toEqual({ dels: {}, dirty: [], clearedAt: '2026-03-01T00:00:00Z' });
    expect(hasPending(p)).toBe(true);
    confirmCleared('u1', '2026-03-01T00:00:00Z');
    expect(hasPending(loadPending('u1'))).toBe(false);
    expect(store.has('travel-tracker:pending:u1')).toBe(false);
  });

  it('survives corrupt storage', () => {
    store.set('travel-tracker:pending:u1', '{not json');
    expect(loadPending('u1')).toEqual({ dels: {}, dirty: [] });
  });
});
