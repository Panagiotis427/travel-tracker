// Generate a gitignored .env.local for Vite from the shared secrets file
// (../../secrets.env). Single source of truth = secrets.env; nothing is committed.
// Only the URL + PUBLISHABLE (client) key are exported — the SECRET key is never
// touched, since it must not reach the browser bundle. Safe no-op if secrets.env
// is absent (e.g. CI), where build-time env vars are used instead.
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SECRETS = join(HERE, '..', '..', 'secrets.env'); // D:\Code Projects\secrets.env
const OUT = join(HERE, '..', '.env.local');

// Accept any form the user pastes (dashboard link, api-keys page, or the api URL)
// and derive the API endpoint https://<ref>.supabase.co. Project refs are 20 chars.
function apiUrl(raw) {
  const patterns = [/\/project\/([a-z0-9]{20})/i, /https?:\/\/([a-z0-9]{20})\.supabase\.co/i, /\b([a-z0-9]{20})\b/i];
  for (const re of patterns) {
    const m = raw.match(re);
    if (m) return `https://${m[1]}.supabase.co`;
  }
  return raw;
}

function parse(text) {
  const m = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const k = line.slice(0, eq).trim();
    let v = line.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    m[k] = v;
  }
  return m;
}

try {
  const s = parse(await readFile(SECRETS, 'utf8'));
  const rawUrl = s.TRAVELTRACKER_SUPABASE_URL || '';
  const key = s.TRAVELTRACKER_SUPABASE_PUBLISHABLE_KEY || '';
  if (!rawUrl || !key) {
    console.warn('[sync-env] Supabase URL / publishable key missing in secrets.env — skipping (local-only).');
    process.exit(0);
  }
  const url = apiUrl(rawUrl);
  await writeFile(OUT, `VITE_SUPABASE_URL=${url}\nVITE_SUPABASE_ANON_KEY=${key}\n`, 'utf8');
  console.log('[sync-env] wrote .env.local (VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY)');
} catch (e) {
  console.warn(`[sync-env] secrets.env not found (${e.code || e.message}) — skipping; app runs local-only.`);
  process.exit(0);
}
