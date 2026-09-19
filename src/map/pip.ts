// Ray-casting point-in-polygon. Portable twin of tools/geo-pipeline/validate.mjs
// (validated 10/10 per layer: holes, exclaves, antimeridian, ocean-null).
import type { Polygon, MultiPolygon, Position } from 'geojson';
import type { Pt, BBox } from './types';

export function pointInRing([x, y]: Pt, ring: Position[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1];
    const xj = ring[j][0], yj = ring[j][1];
    const hit = (yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (hit) inside = !inside;
  }
  return inside;
}

// polygon = [exteriorRing, hole1, hole2, ...]; a point in a hole is outside.
export function pointInPolygon(pt: Pt, polygon: Position[][]): boolean {
  if (!pointInRing(pt, polygon[0])) return false;
  for (let h = 1; h < polygon.length; h++) if (pointInRing(pt, polygon[h])) return false;
  return true;
}

export function pointInGeometry(pt: Pt, geom: Polygon | MultiPolygon): boolean {
  if (geom.type === 'Polygon') return pointInPolygon(pt, geom.coordinates);
  return geom.coordinates.some((poly) => pointInPolygon(pt, poly));
}

export function bboxOf(geom: Polygon | MultiPolygon): BBox {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const scan = (c: unknown): void => {
    if (typeof (c as number[])[0] === 'number') {
      const [x, y] = c as number[];
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    } else for (const x of c as unknown[]) scan(x);
  };
  scan(geom.coordinates);
  return [minX, minY, maxX, maxY];
}

// bbox prefilter, then ray cast. Returns the first containing region or null.
export function locate<T extends { bbox: BBox; geom: Polygon | MultiPolygon }>(
  index: T[],
  [x, y]: Pt,
): T | null {
  for (const r of index) {
    const [minX, minY, maxX, maxY] = r.bbox;
    if (x < minX || x > maxX || y < minY || y > maxY) continue;
    if (pointInGeometry([x, y], r.geom)) return r;
  }
  return null;
}
