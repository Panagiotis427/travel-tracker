import { feature } from 'topojson-client';
import type { Feature, FeatureCollection, Polygon, MultiPolygon, Position } from 'geojson';
import type { Region } from './types';
import { bboxOf } from './pip';
import { lonLatToBase } from './projection';

/** Properties we keep from Natural Earth (admin-0 UPPERCASE, admin-1 lowercase). */
export interface GeoProps {
  NAME?: string;
  TYPE?: string;        // 'Sovereign country' | 'Country' | 'Dependency' | 'Disputed' | ...
  CONTINENT?: string;
  SUBREGION?: string;
  REGION_UN?: string;
  POP_EST?: number;
  name?: string;        // admin-1
  admin?: string;       // admin-1 parent country name
  adm0_a3?: string;     // admin-1 parent country code
  iso_3166_2?: string;  // admin-1 ISO code
  type_en?: string;     // admin-1 type (Province/State/...)
}

/** A polygon feature (country or sub-region) with a guaranteed string id. */
export type CountryFeature = Feature<Polygon | MultiPolygon, GeoProps> & { id: string };

export function featureName(f: CountryFeature): string {
  return f.properties?.NAME ?? f.properties?.name ?? f.id;
}

export function isSovereign(f: CountryFeature): boolean {
  const t = f.properties?.TYPE;
  return t === 'Sovereign country' || t === 'Country';
}

async function fetchFeatures(url: string): Promise<Feature[]> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load ${url}: ${res.status}`);
  // topojson-client types are loose; shape is guaranteed by our build pipeline.
  const topo = (await res.json()) as { objects: Record<string, unknown> };
  const objName = Object.keys(topo.objects)[0];
  const fc = feature(topo as never, topo.objects[objName] as never) as unknown as FeatureCollection;
  return fc.features.filter(
    (f) => f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon'),
  );
}

/** For the 3D globe: raw GeoJSON features fed straight to globe.gl. */
export async function loadFeatures(url: string): Promise<CountryFeature[]> {
  const feats = await fetchFeatures(url);
  return feats.map((f) => ({ ...f, id: String(f.id) })) as CountryFeature[];
}

/** Sub-regions (states/provinces) for one country, by ADM0_A3. Throws if absent. */
export async function loadAdmin1(a3: string): Promise<CountryFeature[]> {
  return loadFeatures(import.meta.env.BASE_URL + `geo/admin1/${a3}.topojson`);
}

// --- 2D canvas path (kept for the flat view + EXIF point-in-polygon) ---------
function addRing(path: Path2D, ring: Position[]): void {
  for (let i = 0; i < ring.length; i++) {
    const [x, y] = lonLatToBase(ring[i][0], ring[i][1]);
    if (i === 0) path.moveTo(x, y);
    else path.lineTo(x, y);
  }
  path.closePath();
}

function buildPath(geom: Polygon | MultiPolygon): Path2D {
  const path = new Path2D();
  if (geom.type === 'Polygon') for (const ring of geom.coordinates) addRing(path, ring);
  else for (const poly of geom.coordinates) for (const ring of poly) addRing(path, ring);
  return path;
}

export async function loadRegions(url: string): Promise<Region[]> {
  const feats = await fetchFeatures(url);
  return feats.map((f) => {
    const geom = f.geometry as Polygon | MultiPolygon;
    return {
      id: String(f.id),
      name: (f.properties?.NAME as string) ?? String(f.id),
      bbox: bboxOf(geom),
      geom,
      path: buildPath(geom),
    };
  });
}
