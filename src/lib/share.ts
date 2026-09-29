// Compact, backend-free sharing: encode a status map into a URL-safe string
// (JSON -> raw-deflate -> base64url) and back. Small enough for a link hash.
import type { Status, StatusMap } from '../state/status';

const TO_CODE: Record<Status, string> = { visited: 'v', want: 'w', lived: 'l', transit: 't' };
const FROM_CODE: Record<string, Status> = { v: 'visited', w: 'want', l: 'lived', t: 'transit' };

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function unb64url(str: string): Uint8Array {
  const s = str.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s);
  const a = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) a[i] = bin.charCodeAt(i);
  return a;
}

export async function encodeShare(name: string, statuses: StatusMap): Promise<string> {
  const m: Record<string, string> = {};
  for (const [id, st] of Object.entries(statuses)) m[id] = TO_CODE[st];
  const json = JSON.stringify({ n: name, m });
  const cs = new CompressionStream('deflate-raw');
  const buf = await new Response(new Blob([json]).stream().pipeThrough(cs)).arrayBuffer();
  return b64url(new Uint8Array(buf));
}

// A share link is untrusted input (anyone can craft one), so decoding is bounded:
// the code length, the inflated size (a "zip bomb" is aborted mid-stream, before it
// can hang the tab), the number of places, and the shape of every place id.
const MAX_CODE_CHARS = 200_000;
const MAX_JSON_BYTES = 2_000_000;
const MAX_PLACES = 60_000; // > every Admin-0/1/2 id in the app (~54k)
// Matches every real id (ADM0_A3, adm1_code incl. territory codes like "AUS+00?",
// "A3-2-<n>"); rejects "__proto__", markup and junk.
const ID_RE = /^[A-Za-z0-9][A-Za-z0-9+?]{1,11}(?:-[A-Za-z0-9+?]{1,12}){0,2}$/;

async function inflateCapped(bytes: Uint8Array, maxBytes: number): Promise<string> {
  const stream = new Blob([bytes as unknown as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) { await reader.cancel(); throw new Error('share code too large'); }
    chunks.push(value);
  }
  const all = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { all.set(c, off); off += c.byteLength; }
  return new TextDecoder().decode(all);
}

export async function decodeShare(code: string): Promise<{ name: string; statuses: StatusMap }> {
  if (code.length > MAX_CODE_CHARS) throw new Error('share code too long');
  const text = await inflateCapped(unb64url(code), MAX_JSON_BYTES);
  const p = JSON.parse(text) as { n?: unknown; m?: unknown };
  // Null-prototype map: no key (even "constructor") can reach Object.prototype.
  const statuses = Object.create(null) as StatusMap;
  const m = p.m && typeof p.m === 'object' && !Array.isArray(p.m) ? (p.m as Record<string, unknown>) : {};
  let n = 0;
  for (const [id, c] of Object.entries(m)) {
    if (++n > MAX_PLACES) break;
    // Own-property lookup only: FROM_CODE["constructor"] would otherwise return an inherited function.
    const s = typeof c === 'string' && Object.prototype.hasOwnProperty.call(FROM_CODE, c) ? FROM_CODE[c] : undefined;
    if (s && ID_RE.test(id)) statuses[id] = s;
  }
  // eslint-disable-next-line no-control-regex
  const name = typeof p.n === 'string' ? p.n.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 60) : '';
  return { name: name || 'Shared map', statuses };
}

/** Pull a share code from a pasted link or raw string. */
export function extractCode(input: string): string {
  const t = input.trim();
  const hash = t.indexOf('#s=');
  if (hash >= 0) return t.slice(hash + 3);
  return t;
}
