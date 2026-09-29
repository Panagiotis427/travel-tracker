import { describe, it, expect, vi, beforeEach } from 'vitest';

// A stand-in for the Supabase query builder: records each select's paging and answers it
// with the next scripted page.
type Page = { data: unknown[] | null; error: unknown } | Error;
const h = vi.hoisted(() => ({ calls: [] as Array<{ order?: string; limit?: number; after?: string }>, pages: [] as Page[] }));
vi.mock('../lib/supabase', () => {
  const from = () => {
    const call: { order?: string; limit?: number; after?: string } = {};
    const q = {
      select: () => q,
      order: (c: string) => { call.order = c; return q; },
      limit: (n: number) => { call.limit = n; return q; },
      gt: (_c: string, v: string) => { call.after = v; return q; },
      then: (ok: (r: unknown) => unknown, bad: (e: unknown) => unknown) => {
        h.calls.push(call);
        const p = h.pages.shift() ?? { data: [], error: null };
        return (p instanceof Error ? Promise.reject(p) : Promise.resolve(p)).then(ok, bad);
      },
    };
    return q;
  };
  return { supabase: { from }, cloudEnabled: true };
});

import { pullRemote } from './cloud';

const rows = (n: number, from = 0) => Array.from({ length: n }, (_, i) => ({
  place_id: `P${String(from + i).padStart(5, '0')}`, status: 'visited', trips: [], updated_at: '2026-01-01T00:00:00Z',
}));

beforeEach(() => { h.calls.length = 0; h.pages.length = 0; });

describe('pullRemote', () => {
  it('reads every page, not just the first 1000 rows the server returns', async () => {
    h.pages.push({ data: rows(1000), error: null }, { data: rows(500, 1000), error: null });
    const m = await pullRemote();
    expect(Object.keys(m!)).toHaveLength(1500);
    expect(h.calls).toEqual([
      { order: 'place_id', limit: 1000 },
      { order: 'place_id', limit: 1000, after: 'P00999' }, // continues after the last row seen
    ]);
  });

  it('reads a small account in one request', async () => {
    h.pages.push({ data: rows(3), error: null });
    expect(Object.keys((await pullRemote())!)).toEqual(['P00000', 'P00001', 'P00002']);
    expect(h.calls).toHaveLength(1);
  });

  it('reports an unreadable cloud as null, never as an empty or partial one', async () => {
    h.pages.push({ data: null, error: { message: 'JWT expired' } });
    expect(await pullRemote()).toBeNull();
    h.pages.push({ data: rows(1000), error: null }, { data: null, error: { message: 'timeout' } });
    expect(await pullRemote()).toBeNull();
    h.pages.push(new TypeError('Failed to fetch'));
    expect(await pullRemote()).toBeNull();
  });

  it('reports an empty cloud as an empty map', async () => {
    h.pages.push({ data: [], error: null });
    expect(await pullRemote()).toEqual({});
  });
});
