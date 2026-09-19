// Copy generated geometry from assets/geo (source of truth) into public/geo,
// which Vite serves and bundles. Run via `npm run geo`.
import { cp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const root = join(HERE, '..');
await cp(join(root, 'assets', 'geo'), join(root, 'public', 'geo'), { recursive: true });
console.log('Copied assets/geo -> public/geo');
