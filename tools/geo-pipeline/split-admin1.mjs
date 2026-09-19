// Split the combined admin-1 TopoJSON (one object per country) into self-contained
// per-country TopoJSON files, so a drill-down loads only that country (~KB).
// Re-encodes arcs per country via topojson-server (geometry already simplified).
import { readFile, writeFile, rm, readdir, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { feature } from 'topojson-client';
import { topology } from 'topojson-server';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = join(HERE, '..', '..', 'assets', 'geo', 'admin1');
const COMBINED = join(DIR, 'admin1.json');

export async function splitCombined() {
  const t = JSON.parse(await readFile(COMBINED, 'utf8'));
  const codes = Object.keys(t.objects);
  let n = 0;
  for (const code of codes) {
    const fc = feature(t, t.objects[code]);
    const topo = topology({ a1: fc }, 1e5);
    await writeFile(join(DIR, `${code}.topojson`), JSON.stringify(topo));
    n++;
  }
  await rm(COMBINED, { force: true });

  const files = (await readdir(DIR)).filter((f) => f.endsWith('.topojson'));
  let total = 0;
  for (const f of files) total += (await stat(join(DIR, f))).size;
  console.log(`Split into ${n} per-country files, ${(total / 1024).toFixed(0)} KB total.`);
}

// Run only when invoked directly (not on import). endsWith is Windows-path safe.
if (process.argv[1] && process.argv[1].endsWith('split-admin1.mjs')) {
  splitCombined().catch((e) => { console.error('SPLIT FAILED:', e.message); process.exit(1); });
}
