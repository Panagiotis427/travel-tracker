import type { Polygon, MultiPolygon, Position } from 'geojson';

export interface Pov {
  lat: number;
  lng: number;
  altitude: number;
}

function exteriorRings(geom: Polygon | MultiPolygon): Position[][] {
  if (geom.type === 'Polygon') return [geom.coordinates[0]];
  return geom.coordinates.map((poly) => poly[0]);
}

function ringBBox(ring: Position[]): [number, number, number, number] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX, maxY];
}

/**
 * Fly-to target for a country/region. Uses the LARGEST polygon part's centroid,
 * which avoids the antimeridian bbox blow-up that would otherwise put the USA or
 * Russia centroid in the middle of an ocean.
 */
export function focusOf(geom: Polygon | MultiPolygon): Pov {
  let best: { ring: Position[]; span: number } | null = null;
  let bestArea = -1;
  for (const ring of exteriorRings(geom)) {
    const [minX, minY, maxX, maxY] = ringBBox(ring);
    const area = (maxX - minX) * (maxY - minY);
    if (area > bestArea) {
      bestArea = area;
      best = { ring, span: Math.max(maxX - minX, maxY - minY) };
    }
  }
  const ring = best!.ring;
  let sx = 0, sy = 0;
  for (const [x, y] of ring) {
    sx += x;
    sy += y;
  }
  const lng = sx / ring.length;
  const lat = sy / ring.length;
  const altitude = Math.min(Math.max(best!.span / 55, 0.22), 1.5);
  return { lat, lng, altitude };
}
