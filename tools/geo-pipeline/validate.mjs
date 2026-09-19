// Validate generated TopoJSON with a hand-rolled ray-casting point-in-polygon.
// This is the portable reference implementation of the spatial engine:
//   - bbox prefilter, then even-odd ray cast
//   - MultiPolygon + interior rings (holes) => a point in a hole is OUTSIDE
//   - NE pre-splits antimeridian polygons, so per-part PIP is correct
// Gate: the detailed (50m) dataset must pass every case.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { feature } from 'topojson-client';

const HERE = dirname(fileURLToPath(import.meta.url));
const GEO = join(HERE, '..', '..', 'assets', 'geo');

// [lon, lat] -> expected ADM0_A3 (null = should match no country).
// `coarse` overrides the expectation for the 110m overview layer, which is too
// generalized to resolve tiny enclaves/coastlines (documents a known limit).
// Interior points are used on purpose: coastal points near a simplified shore
// can fall in water and are better classified against the 10m layer or via a
// nearest-border tolerance fallback (see README).
const CASES = [
  { name: 'Paris',              pt: [2.3522, 48.8566],  expect: 'FRA' },
  { name: 'Denver',             pt: [-104.9903, 39.7392], expect: 'USA' },
  { name: 'Tokyo',              pt: [139.69, 35.68],    expect: 'JPN' },
  { name: 'Cape Town',          pt: [18.42, -33.92],    expect: 'ZAF' },
  { name: 'Sydney',             pt: [151.2, -33.86],    expect: 'AUS' },
  { name: 'Rome',               pt: [12.4964, 41.9028], expect: 'ITA' },
  { name: 'Maseru (Lesotho)',   pt: [27.48, -29.31],    expect: 'LSO', coarse: 'ZAF' }, // hole inside ZAF; 110m too coarse
  { name: 'Kaliningrad',        pt: [20.51, 54.71],     expect: 'RUS' }, // exclave
  { name: 'Chukotka (far E RU)',pt: [178.5, 66.0],      expect: 'RUS' }, // antimeridian side
  { name: 'Gulf of Guinea',     pt: [0, 0],             expect: null  }, // open ocean
];

// ---- ray-casting PIP -------------------------------------------------------
function pointInRing([x, y], ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const intersects = (yi > y) !== (yj > y) &&
      x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

// polygon = [exteriorRing, hole1, hole2, ...]
function pointInPolygon(pt, polygon) {
  if (!pointInRing(pt, polygon[0])) return false;
  for (let h = 1; h < polygon.length; h++) if (pointInRing(pt, polygon[h])) return false;
  return true;
}

function pointInGeometry(pt, geom) {
  if (geom.type === 'Polygon') return pointInPolygon(pt, geom.coordinates);
  if (geom.type === 'MultiPolygon') return geom.coordinates.some((poly) => pointInPolygon(pt, poly));
  return false;
}

// ---- index -----------------------------------------------------------------
function bboxOf(geom) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const scan = (c) => {
    if (typeof c[0] === 'number') {
      if (c[0] < minX) minX = c[0]; if (c[0] > maxX) maxX = c[0];
      if (c[1] < minY) minY = c[1]; if (c[1] > maxY) maxY = c[1];
    } else for (const x of c) scan(x);
  };
  scan(geom.coordinates);
  return [minX, minY, maxX, maxY];
}

function buildIndex(fc) {
  return fc.features.map((f) => ({
    id: f.id,
    name: f.properties?.NAME ?? f.id,
    bbox: bboxOf(f.geometry),
    geom: f.geometry,
  }));
}

function locate(index, [x, y]) {
  for (const r of index) {
    const [minX, minY, maxX, maxY] = r.bbox;
    if (x < minX || x > maxX || y < minY || y > maxY) continue; // bbox reject
    if (pointInGeometry([x, y], r.geom)) return r;
  }
  return null;
}

// ---- runner ----------------------------------------------------------------
async function loadIndex(file) {
  const topo = JSON.parse(await readFile(join(GEO, file), 'utf8'));
  const objName = Object.keys(topo.objects)[0];
  const fc = feature(topo, topo.objects[objName]);
  return { index: buildIndex(fc), count: fc.features.length };
}

async function run(file, gate, coarse = false) {
  console.log(`\n=== ${file} ===`);
  let idx;
  try { idx = await loadIndex(file); }
  catch (e) { console.error(`  cannot load: ${e.message}`); return gate ? 1 : 0; }
  console.log(`  ${idx.count} features`);
  let fail = 0;
  for (const c of CASES) {
    const want = coarse && 'coarse' in c ? c.coarse : c.expect;
    const hit = locate(idx.index, c.pt);
    const got = hit ? hit.id : null;
    const ok = got === want;
    if (!ok) fail++;
    const mark = ok ? 'PASS' : 'FAIL';
    const gotStr = hit ? `${got} (${hit.name})` : 'null';
    console.log(`  [${mark}] ${c.name.padEnd(20)} expect ${String(want).padEnd(5)} got ${gotStr}`);
  }
  console.log(`  ${CASES.length - fail}/${CASES.length} passed`);
  return gate && fail > 0 ? 1 : 0;
}

const code = (await run('world_110m.topojson', false, true)) | (await run('world_50m.topojson', true, false));
process.exit(code ? 1 : 0);
