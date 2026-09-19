// Admin-1 (states/provinces) pipeline: fetch NE 10m admin-1, simplify, and SPLIT
// into one TopoJSON per country (by adm0_a3) for lazy drill-down loading.
// Output: ../../assets/geo/admin1/<ADM0_A3>.topojson
//
// Heavy source (~tens of MB) — run on demand, not on every build.

import { mkdir, writeFile, rm, readdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import mapshaper from 'mapshaper';
import { splitCombined } from './split-admin1.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(HERE, '..', '..', 'assets', 'geo', 'admin1');
const TMP_DIR = join(HERE, '.tmp');
const SRC = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_10m_admin_1_states_provinces.geojson';

// admin-1 uses lowercase field names in Natural Earth.
const KEEP = 'adm1_code,iso_3166_2,name,admin,adm0_a3,type_en';

async function fetchToFile(url, dest) {
  process.stdout.write(`  fetch admin-1 (large) ... `);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(dest, buf);
  console.log(`${(buf.length / 1024 / 1024).toFixed(1)} MB`);
}

async function dirSummary(dir) {
  const files = (await readdir(dir)).filter((f) => f.endsWith('.topojson'));
  let total = 0;
  for (const f of files) total += (await stat(join(dir, f))).size;
  return { count: files.length, kb: (total / 1024).toFixed(0) };
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  await mkdir(TMP_DIR, { recursive: true });
  await rm(OUT_DIR, { recursive: true, force: true });
  await mkdir(OUT_DIR, { recursive: true });

  const inFile = join(TMP_DIR, 'admin1.geojson');
  await fetchToFile(SRC, inFile);

  const cmd = [
    `-i "${inFile}"`,
    `-filter-fields ${KEEP}`,
    `-simplify 12% keep-shapes`,
    `-clean`,
    `-split adm0_a3`,
    `-o "${OUT_DIR}/" format=topojson id-field=adm1_code`,
  ].join(' ');

  process.stdout.write('  simplify + split by country ... ');
  await mapshaper.runCommands(cmd);
  console.log('done (combined)');

  process.stdout.write('  re-encode into per-country files ... ');
  await splitCombined();

  await rm(TMP_DIR, { recursive: true, force: true });
  const s = await dirSummary(OUT_DIR);
  console.log(`\nOK. ${s.count} country files, ${s.kb} KB total in ${OUT_DIR}`);
}

main().catch((e) => { console.error('\nADMIN-1 BUILD FAILED:', e.message); process.exit(1); });
