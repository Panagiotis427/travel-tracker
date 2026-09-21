// City markers pipeline: fetch Natural Earth 10m populated places (public domain),
// trim to a compact JSON the globe can drop points/labels from.
//
// Emits TWO files (source of truth = assets/geo, mirrored to public/geo):
//   capitals.json  - national capitals only (tiny; the "Capitals" marker mode)
//   cities.json    - capitals + notable cities up to SCALERANK 7 ("Cities" mode)
//
// Row schema (short keys keep the file small; gzip does the rest):
//   n name, y lat, x lng, r scalerank(0..10, lower=bigger), p pop_max, c capital(1/0), a3 country
//
// SCALERANK is Natural Earth's built-in zoom rank: the app reveals higher ranks
// as you zoom in, so the world view stays uncluttered.

import { mkdir, writeFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
const OUT_DIRS = [join(ROOT, 'assets', 'geo'), join(ROOT, 'public', 'geo')];
const SRC = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_populated_places.geojson';

const CITY_MAX_RANK = 7; // drop the long tail of tiny villages (ranks 8-10)

function r3(n) { return Math.round(n * 1000) / 1000; } // ~110 m precision

async function sizeKB(p) {
  try { return `${((await stat(p)).size / 1024).toFixed(0)} KB`; } catch { return '?'; }
}

async function writeBoth(name, data) {
  const json = JSON.stringify(data);
  for (const dir of OUT_DIRS) {
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, name), json);
  }
  console.log(`  ${name}: ${data.length} rows -> ${await sizeKB(join(OUT_DIRS[0], name))}`);
}

async function main() {
  process.stdout.write(`  fetch populated places ... `);
  const res = await fetch(SRC);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${SRC}`);
  const fc = await res.json();
  console.log(`${fc.features.length} places`);

  const rows = [];
  for (const f of fc.features) {
    const p = f.properties ?? {};
    const coord = f.geometry?.coordinates ?? [p.LONGITUDE, p.LATITUDE];
    if (!coord || coord.length < 2) continue;
    const name = p.NAME || p.NAMEASCII || p.NAME_EN;
    if (!name) continue;
    const cap = p.ADM0CAP === 1 || p.ADM0CAP === '1' || /Admin-0 capital/i.test(String(p.FEATURECLA ?? ''));
    rows.push({
      n: name,
      y: r3(+coord[1]),
      x: r3(+coord[0]),
      r: Number.isFinite(+p.SCALERANK) ? +p.SCALERANK : 10,
      p: Math.round(+p.POP_MAX || +p.POP_MIN || 0),
      c: cap ? 1 : 0,
      a3: p.ADM0_A3 && p.ADM0_A3 !== '-99' ? String(p.ADM0_A3) : '',
    });
  }

  // Capitals: keep one per country (highest population wins over "alt" capitals).
  const bestCap = new Map();
  for (const row of rows) {
    if (!row.c) continue;
    const key = row.a3 || row.n;
    const cur = bestCap.get(key);
    if (!cur || row.p > cur.p) bestCap.set(key, row);
  }
  const capitals = [...bestCap.values()].sort((a, b) => a.r - b.r || b.p - a.p);

  // Cities: capitals + everything up to the rank cutoff, biggest first.
  const capSet = new Set(capitals);
  const cities = rows
    .filter((row) => capSet.has(row) || row.r <= CITY_MAX_RANK)
    .sort((a, b) => a.r - b.r || b.p - a.p);

  await writeBoth('capitals.json', capitals);
  await writeBoth('cities.json', cities);
  console.log('\nOK. City markers built.');
}

main().catch((e) => { console.error('\nCITIES BUILD FAILED:', e.message); process.exit(1); });
