// Generate PWA icons from an inline SVG globe. Offline, no design assets needed.
// Outputs to ../public/icons + ../public/favicon.svg
import { Resvg } from '@resvg/resvg-js';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const PUB = join(HERE, '..', 'public');
const ICONS = join(PUB, 'icons');

function svg(globeR, radius) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <radialGradient id="g" cx="42%" cy="36%" r="78%">
      <stop offset="0%" stop-color="#1f6293"/>
      <stop offset="100%" stop-color="#0e2f47"/>
    </radialGradient>
  </defs>
  <rect width="512" height="512" rx="${radius}" fill="#0b1f2a"/>
  <circle cx="256" cy="256" r="${globeR}" fill="url(#g)" stroke="#4aa8ff" stroke-width="6"/>
  <g fill="none" stroke="#4aa8ff" stroke-width="3.5" opacity="0.5">
    <ellipse cx="256" cy="256" rx="${globeR}" ry="${globeR * 0.35}"/>
    <ellipse cx="256" cy="256" rx="${globeR * 0.62}" ry="${globeR}"/>
    <line x1="${256 - globeR}" y1="256" x2="${256 + globeR}" y2="256"/>
  </g>
  <circle cx="${256 + globeR * 0.45}" cy="${256 - globeR * 0.42}" r="${globeR * 0.13}" fill="#2ecc71" stroke="#0b1f2a" stroke-width="6"/>
</svg>`;
}

const STD = svg(150, 112);        // standard, rounded tile
const MASK = svg(128, 0);         // maskable, full-bleed bg + smaller globe (safe zone)

function png(svgStr, size) {
  return new Resvg(svgStr, { fitTo: { mode: 'width', value: size } }).render().asPng();
}

async function main() {
  await mkdir(ICONS, { recursive: true });
  await writeFile(join(ICONS, 'icon-192.png'), png(STD, 192));
  await writeFile(join(ICONS, 'icon-512.png'), png(STD, 512));
  await writeFile(join(ICONS, 'icon-maskable-512.png'), png(MASK, 512));
  await writeFile(join(ICONS, 'apple-touch-icon.png'), png(STD, 180));
  await writeFile(join(PUB, 'favicon.svg'), STD);
  console.log('Icons written to public/icons + favicon.svg');
}

main().catch((e) => { console.error('ICON GEN FAILED:', e.message); process.exit(1); });
