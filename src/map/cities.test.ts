import { describe, it, expect } from 'vitest';
import { selectMarkers, markerCap } from './cities';
import type { CityMarker } from './cities';

const m = (n: string, r: number, c: 0 | 1 = 0, p = 1000): CityMarker => ({ n, y: 0, x: 0, r, p, c, a3: 'FRA' });
const pool: CityMarker[] = [m('Big', 0), m('Mid', 2), m('Capital', 3, 1), m('Town', 5), m('Village', 8)];

describe('selectMarkers', () => {
  it('shows only the biggest places, plus capitals, at world zoom', () => {
    const names = selectMarkers(pool, 2.0, 100).map((x) => x.n);
    expect(names).toEqual(['Capital', 'Big', 'Mid']); // capitals first, then by rank
  });

  it('reveals smaller places as you zoom in', () => {
    expect(selectMarkers(pool, 0.2, 100)).toHaveLength(5);
  });

  it('respects the cap', () => {
    expect(selectMarkers(pool, 0.2, 2)).toHaveLength(2);
  });

  it('labels capitals always and cities only when they are big for the zoom', () => {
    const byName = Object.fromEntries(selectMarkers(pool, 2.0, 100).map((x) => [x.n, x.t]));
    expect(byName).toEqual({ Capital: 1, Big: 1, Mid: 0 });
  });

  it('draws fewer markers on phones', () => {
    expect(markerCap(0.5, true)).toBeLessThan(markerCap(0.5, false));
    expect(markerCap(2.0, true)).toBeLessThan(markerCap(0.5, true));
  });
});
