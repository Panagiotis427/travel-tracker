import { describe, it, expect } from 'vitest';
import type { MultiPolygon } from 'geojson';
import { boundsOf } from './geo-util';

describe('boundsOf (fit-to-view extent)', () => {
  // A 10 x 10 degree block centred on 60N, plus a small island elsewhere.
  const geom: MultiPolygon = {
    type: 'MultiPolygon',
    coordinates: [
      [[[0, 55], [10, 55], [10, 65], [0, 65], [0, 55]]],
      [[[50, 0], [51, 0], [51, 1], [50, 1], [50, 0]]],
    ],
  };

  it('frames the largest part, not the far-away island', () => {
    const b = boundsOf(geom);
    expect(b.lat).toBeCloseTo(60);
    expect(b.lng).toBeCloseTo(5);
    expect(b.h).toBeCloseTo(10);
  });

  it('compresses the east-west span by cos(latitude)', () => {
    expect(boundsOf(geom).w).toBeCloseTo(10 * Math.cos((60 * Math.PI) / 180));
  });
});
