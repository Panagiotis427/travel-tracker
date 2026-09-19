// Offline geo build: fetch Natural Earth Admin-0, simplify, emit TopoJSON.
// Public-domain source: nvkelso/natural-earth-vector (raw GeoJSON).
// Output: ../../assets/geo/*.topojson  (bundled into the app at build time)
//
// IDs use ADM0_A3 (never iso_a3 — that field is -99 for France/Norway/etc).
// Kept properties: NAME, CONTINENT, ISO_A2. Simplify keeps shapes (no dropouts).

import { mkdir, writeFile, stat, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import mapshaper from 'mapshaper';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, '..', '..', 'assets', 'geo');
const TMP_DIR = join(HERE, '.tmp');
const RAW = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson';

const DATASETS = [
  { id: 'world_110m', src: `${RAW}/ne_110m_admin_0_countries.geojson`, simplify: '18%' },
  { id: 'world_50m',  src: `${RAW}/ne_50m_admin_0_countries.geojson`,  simplify: '12%' },
];

const KEEP = 'ADM0_A3,NAME,CONTINENT,ISO_A2';

async function fetchToFile(url, dest) {
  process.stdout.write(`  fetch ${url} ... `);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(dest, buf);
  console.log(`${(buf.length / 1024).toFixed(0)} KB`);
}

async function sizeKB(p) {
  try { return `${((await stat(p)).size / 1024).toFixed(0)} KB`; } catch { return '?'; }
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  await mkdir(TMP_DIR, { recursive: true });

  for (const d of DATASETS) {
    console.log(`\n[${d.id}]`);
    const inFile = join(TMP_DIR, `${d.id}.geojson`);
    const outFile = join(OUT_DIR, `${d.id}.topojson`);
    await fetchToFile(d.src, inFile);

    const cmd = [
      `-i "${inFile}"`,
      `-filter-fields ${KEEP}`,
      `-simplify ${d.simplify} keep-shapes`,
      `-clean`,
      `-o "${outFile}" format=topojson id-field=ADM0_A3`,
    ].join(' ');

    process.stdout.write('  simplify + topojson ... ');
    await mapshaper.runCommands(cmd);
    console.log(`done -> ${await sizeKB(outFile)}`);
  }

  await rm(TMP_DIR, { recursive: true, force: true });
  console.log(`\nOK. Assets in ${OUT_DIR}`);
}

main().catch((e) => { console.error('\nBUILD FAILED:', e.message); process.exit(1); });
