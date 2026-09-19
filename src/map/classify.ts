// Classify a lat/lng (from a photo's EXIF) to a country, and optionally an
// admin-1 region. Uses the finest layer (10m) for accuracy and a small
// nearest-border fallback so coastal/offshore points still resolve.
import { loadRegions } from './geo';
import { locate } from './pip';
import type { Region } from './types';

const NEAR_TOL = 0.75; // degrees (~80 km) — snap coastal points to nearest land

interface Near { r: Region; pts: number[][]; }

let countryIdx: Region[] | null = null;
let nearIdx: Near[] | null = null;
const regionIdx = new Map<string, Region[]>();

// Exterior-ring vertices of a geometry (used for nearest-border snapping).
function exteriorPts(r: Region): number[][] {
  const g = r.geom;
  const rings = g.type === 'Polygon' ? [g.coordinates[0]] : g.coordinates.map((p) => p[0]);
  const out: number[][] = [];
  for (const ring of rings) for (const p of ring) out.push(p as number[]);
  return out;
}

export async function initCountryIndex(): Promise<Region[]> {
  if (!countryIdx) {
    countryIdx = await loadRegions(import.meta.env.BASE_URL + 'geo/world_10m.topojson');
    nearIdx = countryIdx.map((r) => ({ r, pts: exteriorPts(r) }));
  }
  return countryIdx;
}

export function classifyCountry(lng: number, lat: number): Region | null {
  if (!countryIdx) return null;
  const hit = locate(countryIdx, [lng, lat]);
  if (hit) return hit;
  // Nearest border vertex (bbox distance is wrong for antimeridian-spanning
  // countries like Russia, whose bbox covers the whole globe longitudinally).
  let best: Region | null = null;
  let bd = Infinity;
  for (const n of nearIdx!) {
    for (const [px, py] of n.pts) {
      const d = Math.hypot(px - lng, py - lat);
      if (d < bd) { bd = d; best = n.r; }
    }
  }
  return bd <= NEAR_TOL ? best : null;
}

export async function classifyRegion(a3: string, lng: number, lat: number): Promise<Region | null> {
  let idx = regionIdx.get(a3);
  if (!idx) {
    try { idx = await loadRegions(import.meta.env.BASE_URL + `geo/admin1/${a3}.topojson`); }
    catch { idx = []; }
    regionIdx.set(a3, idx);
  }
  if (!idx.length) return null;
  return locate(idx, [lng, lat]);
}
