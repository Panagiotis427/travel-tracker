// Admin-2 (counties/districts) pipeline via geoBoundaries gbOpen (CC-BY 4.0).
// Per-country simplified GeoJSON -> further simplify -> TopoJSON, one file per country.
// Output: ../../public/geo/admin2/<ADM0_A3>.topojson  (served + bundled; lazy-loaded).
// Resilient: skips countries without ADM2 or that fail; reports a summary.
//
// IDs are "<A3>-2-<n>" so region->country aggregation (split('-')[0]) still works.
import { mkdir, writeFile, rm, readdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import mapshaper from 'mapshaper';

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, '..', '..', 'public', 'geo', 'admin2');
const TMP = join(HERE, '.tmp2');
const API = 'https://www.geoboundaries.org/api/current/gbOpen/ALL/ADM2/';

async function main() {
  await mkdir(OUT, { recursive: true });
  await mkdir(TMP, { recursive: true });

  console.log('fetching ADM2 country list...');
  const list = await (await fetch(API)).json();
  const withGeo = list.filter((c) => c.simplifiedGeometryGeoJSON && c.simplifiedGeometryGeoJSON !== '');
  console.log(`${withGeo.length} countries have ADM2`);

  let ok = 0;
  const failed = [];
  for (let i = 0; i < withGeo.length; i++) {
    const c = withGeo[i];
    const a3 = c.boundaryISO;
    process.stdout.write(`[${i + 1}/${withGeo.length}] ${a3} ... `);
    const inF = join(TMP, `${a3}.geojson`);
    try {
      const res = await fetch(c.simplifiedGeometryGeoJSON);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = Buffer.from(await res.arrayBuffer());
      await writeFile(inF, buf);
      const outF = join(OUT, `${a3}.topojson`);
      const cmd = [
        `-i "${inF}"`,
        `-rename-fields name=shapeName`,
        `-filter-fields name,shapeGroup`,
        `-simplify 22% keep-shapes`,
        `-clean`,
        `-each 'gid = shapeGroup + "-2-" + this.id'`,
        `-o "${outF}" format=topojson id-field=gid`,
      ].join(' ');
      await mapshaper.runCommands(cmd);
      await rm(inF, { force: true });
      ok++;
      console.log(`ok`);
    } catch (e) {
      failed.push(a3);
      console.log(`FAIL ${e.message}`);
    }
  }

  await rm(TMP, { recursive: true, force: true });
  const files = (await readdir(OUT)).filter((f) => f.endsWith('.topojson'));
  let tot = 0;
  for (const f of files) tot += (await stat(join(OUT, f))).size;
  console.log(`\nDONE ok=${ok} failed=${failed.length} total=${(tot / 1024 / 1024).toFixed(1)}MB`);
  if (failed.length) console.log(`failed: ${failed.join(',')}`);
}

main().catch((e) => { console.error('ADMIN2 BUILD FAILED:', e.message); process.exit(1); });
