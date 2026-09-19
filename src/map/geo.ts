import { feature } from 'topojson-client';
import type { FeatureCollection, Polygon, MultiPolygon, Position } from 'geojson';
import type { Region } from './types';
import { bboxOf } from './pip';
import { lonLatToBase } from './projection';

function addRing(path: Path2D, ring: Position[]): void {
  for (let i = 0; i < ring.length; i++) {
    const [x, y] = lonLatToBase(ring[i][0], ring[i][1]);
    if (i === 0) path.moveTo(x, y); else path.lineTo(x, y);
  }
  path.closePath();
}

function buildPath(geom: Polygon | MultiPolygon): Path2D {
  const path = new Path2D();
  if (geom.type === 'Polygon') {
    for (const ring of geom.coordinates) addRing(path, ring);
  } else {
    for (const poly of geom.coordinates) for (const ring of poly) addRing(path, ring);
  }
  return path;
}

export async function loadRegions(url: string): Promise<Region[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  // topojson-client types are loose; the shape is validated by our pipeline.
  const topo = (await res.json()) as { objects: Record<string, unknown> };
  const objName = Object.keys(topo.objects)[0];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fc = feature(topo as any, topo.objects[objName] as any) as unknown as FeatureCollection;

  const out: Region[] = [];
  for (const f of fc.features) {
    const g = f.geometry;
    if (!g || (g.type !== 'Polygon' && g.type !== 'MultiPolygon')) continue;
    const geom = g as Polygon | MultiPolygon;
    out.push({
      id: String(f.id),
      name: (f.properties?.NAME as string) ?? String(f.id),
      bbox: bboxOf(geom),
      geom,
      path: buildPath(geom),
    });
  }
  return out;
}
