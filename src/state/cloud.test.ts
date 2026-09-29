import { describe, it, expect, vi, beforeEach } from 'vitest';

// A stand-in for the Supabase query builder: records each request (operation, body, paging,
// filters) and answers it with the next scripted result.
type Call = { op: string; body?: unknown; order?: string; limit?: number; filters: string[] };
type Answer = { data: unknown[] | null; error: unknown } | Error;
const h = vi.hoisted(() => ({ calls: [] as Call[], answers: [] as Answer[] }));
vi.mock('../lib/supabase', () => {
  const from = () => {
    const call: Call = { op: 'select', filters: [] };
    const f = (op: string) => (c: string, v: unknown) => { call.filters.push(`${c}=${op}.${Array.isArray(v) ? `(${v.join(',')})` : v}`); return q; };
    const q = {
      select: () => q,
      order: (c: string) => { call.order = c; return q; },
      limit: (n: number) => { call.limit = n; return q; },
      gt: f('gt'), lte: f('lte'), eq: f('eq'), neq: f('neq'), in: f('in'),
      update: (b: unknown) => { call.op = 'update'; call.body = b; return q; },
      upsert: (b: unknown) => { call.op = 'upsert'; call.body = b; return q; },
      delete: () => { call.op = 'delete'; return q; },
      then: (ok: (r: unknown) => unknown, bad: (e: unknown) => unknown) => {
        h.calls.push(call);
        const a = h.answers.shift() ?? { data: [], error: null };
        return (a instanceof Error ? Promise.reject(a) : Promise.resolve(a)).then(ok, bad);
      },
    };
    return q;
  };
  return { supabase: { from }, cloudEnabled: true };
});

import { pullRemote, pullPlaces, pushRemote, deleteRemote, deleteClearedRemote } from './cloud';

const rows = (n: number, from = 0) => Array.from({ length: n }, (_, i) => ({
  place_id: `P${String(from + i).padStart(5, '0')}`, status: 'visited', trips: [], updated_at: '2026-01-01T00:00:00Z', deleted_at: null,
}));

beforeEach(() => { h.calls.length = 0; h.answers.length = 0; });

describe('pullRemote', () => {
  it('reads every page, not just the first 1000 rows the server returns', async () => {
    h.answers.push({ data: rows(1000), error: null }, { data: rows(500, 1000), error: null });
    const m = await pullRemote();
    expect(Object.keys(m!.live)).toHaveLength(1500);
    expect(h.calls).toEqual([
      { op: 'select', order: 'place_id', limit: 1000, filters: [] },
      { op: 'select', order: 'place_id', limit: 1000, filters: ['place_id=gt.P00999'] }, // after the last row seen
    ]);
  });

  it('reads a small account in one request', async () => {
    h.answers.push({ data: rows(3), error: null });
    expect(Object.keys((await pullRemote())!.live)).toEqual(['P00000', 'P00001', 'P00002']);
    expect(h.calls).toHaveLength(1);
  });

  it('separates deleted places from live ones, and treats a later re-mark as live', async () => {
    h.answers.push({ data: [
      { place_id: 'FRA', status: 'visited', trips: [], updated_at: '2026-02-01T00:00:00Z', deleted_at: '2026-02-01T00:00:00Z' },
      // written by an app version from before soft deletes, which leaves deleted_at in place
      { place_id: 'DEU', status: 'lived', trips: [], updated_at: '2026-03-01T00:00:00Z', deleted_at: '2026-02-01T00:00:00Z' },
      { place_id: 'ITA', status: 'want', trips: [], updated_at: '2026-01-01T00:00:00Z', deleted_at: null },
    ], error: null });
    const m = (await pullRemote())!;
    expect(m.deleted).toEqual({ FRA: '2026-02-01T00:00:00Z' });
    expect(Object.keys(m.live)).toEqual(['DEU', 'ITA']);
  });

  it('reports an unreadable cloud as null, never as an empty or partial one', async () => {
    h.answers.push({ data: null, error: { message: 'JWT expired' } });
    expect(await pullRemote()).toBeNull();
    h.answers.push({ data: rows(1000), error: null }, { data: null, error: { message: 'timeout' } });
    expect(await pullRemote()).toBeNull();
    h.answers.push(new TypeError('Failed to fetch'));
    expect(await pullRemote()).toBeNull();
  });

  it('reports an empty cloud as empty', async () => {
    h.answers.push({ data: [], error: null });
    expect(await pullRemote()).toEqual({ live: {}, deleted: {} });
  });
});

describe('pullPlaces', () => {
  it('asks about many places in short queries', async () => {
    const ids = rows(250).map((r) => r.place_id);
    await pullPlaces(ids);
    expect(h.calls.map((c) => c.filters[0].split(',').length)).toEqual([100, 100, 50]);
    expect(h.calls[0].filters[0].startsWith('place_id=in.(P00000,')).toBe(true);
  });

  it('reports a failed query as null', async () => {
    h.answers.push({ data: null, error: { message: 'unavailable' } });
    expect(await pullPlaces(['FRA'])).toBeNull();
  });
});

describe('writes', () => {
  it('pushes marks as live rows, so a re-mark undoes a delete', async () => {
    await pushRemote('u', { FRA: { status: 'visited', trips: [], updatedAt: '2026-03-01T00:00:00Z' } });
    expect(h.calls[0].op).toBe('upsert');
    expect(h.calls[0].body).toEqual([{ user_id: 'u', place_id: 'FRA', status: 'visited', trips: [], updated_at: '2026-03-01T00:00:00Z', deleted_at: null }]);
  });

  it('deletes a place softly, and only where the stored row is not newer', async () => {
    const at = '2026-02-01T00:00:00Z';
    expect(await deleteRemote('FRA', at)).toBe(true);
    expect(h.calls[0]).toEqual({ op: 'update', body: { deleted_at: at, updated_at: at }, filters: ['place_id=eq.FRA', `updated_at=lte.${at}`] });
  });

  it('clears all marks softly, up to the moment of the clear', async () => {
    const at = '2026-02-01T00:00:00Z';
    expect(await deleteClearedRemote(at)).toBe(true);
    expect(h.calls[0]).toEqual({ op: 'update', body: { deleted_at: at, updated_at: at }, filters: [`updated_at=lte.${at}`] });
  });

  it('reports a failed write', async () => {
    h.answers.push({ data: null, error: { message: 'unavailable' } });
    expect(await deleteRemote('FRA', '2026-02-01T00:00:00Z')).toBe(false);
  });
});
