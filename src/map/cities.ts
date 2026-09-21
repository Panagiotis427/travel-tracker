// City / capital markers for the globe. Data built by tools/geo-pipeline/build-cities.mjs
// from Natural Earth (public domain). Loaded on demand — nothing fetched unless the
// user turns markers on. capitals.json is tiny (~14 KB); cities.json is lazy.

export interface CityMarker {
  n: string;  // name
  y: number;  // latitude
  x: number;  // longitude
  r: number;  // Natural Earth SCALERANK (0 = biggest); drives zoom reveal
  p: number;  // population (POP_MAX)
  c: 0 | 1;   // national capital?
  a3: string; // parent country ADM0_A3 (for click -> select country)
  t?: 0 | 1;  // show text label (set by selectMarkers; else dot only)
}

// 'selected' = only the country the user picked (default); 'all' = everywhere.
export type MarkerMode = 'off' | 'selected' | 'all';

let capsCache: CityMarker[] | null = null;
let citiesCache: CityMarker[] | null = null;
let capsPromise: Promise<CityMarker[]> | null = null;
let citiesPromise: Promise<CityMarker[]> | null = null;

async function fetchJson(file: string): Promise<CityMarker[]> {
  const res = await fetch(import.meta.env.BASE_URL + 'geo/' + file);
  if (!res.ok) throw new Error(`Failed to load ${file}: ${res.status}`);
  return (await res.json()) as CityMarker[];
}

export function loadCapitals(): Promise<CityMarker[]> {
  if (capsCache) return Promise.resolve(capsCache);
  if (!capsPromise) capsPromise = fetchJson('capitals.json').then((d) => (capsCache = d));
  return capsPromise;
}

export function loadCities(): Promise<CityMarker[]> {
  if (citiesCache) return Promise.resolve(citiesCache);
  if (!citiesPromise) citiesPromise = fetchJson('cities.json').then((d) => (citiesCache = d));
  return citiesPromise;
}

/** Biggest SCALERANK to show as a dot at this camera altitude (lower alt = more cities). */
function maxRankForAltitude(alt: number): number {
  if (alt >= 1.4) return 2;   // world view: only megacities + major capitals
  if (alt >= 0.9) return 3;
  if (alt >= 0.55) return 4;
  if (alt >= 0.32) return 6;
  return 8;                   // zoomed onto a country: show the lot
}

/**
 * Pick the markers to draw for the current view: zoom-gated by SCALERANK, capitals
 * favoured, hard-capped so the globe never has to render a swarm. Names (`t`) show
 * only for the bigger cities so the world view stays readable — dots fill in first,
 * labels appear as you zoom.
 */
export function selectMarkers(pool: CityMarker[], alt: number, cap: number): CityMarker[] {
  if (!pool.length) return pool;
  const maxR = maxRankForAltitude(alt);
  const textR = maxR - 2;
  const vis = pool.filter((m) => m.r <= maxR || (m.c === 1 && m.r <= maxR + 2));
  vis.sort((a, b) => (a.c ? 0 : 1) - (b.c ? 0 : 1) || a.r - b.r || b.p - a.p);
  return vis.slice(0, cap).map((m) => ({ ...m, t: m.c === 1 || m.r <= textR ? 1 : 0 }));
}

/** How many markers to draw at once, kept lower on phones. */
export function markerCap(alt: number, mobile: boolean): number {
  const near = alt < 0.9;
  if (mobile) return near ? 90 : 22;
  return near ? 160 : 40;
}
