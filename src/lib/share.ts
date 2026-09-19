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

export async function decodeShare(code: string): Promise<{ name: string; statuses: StatusMap }> {
  const bytes = unb64url(code) as unknown as BlobPart;
  const ds = new DecompressionStream('deflate-raw');
  const text = await new Response(new Blob([bytes]).stream().pipeThrough(ds)).text();
  const p = JSON.parse(text) as { n?: string; m?: Record<string, string> };
  const statuses: StatusMap = {};
  for (const [id, c] of Object.entries(p.m ?? {})) {
    const s = FROM_CODE[c];
    if (s) statuses[id] = s;
  }
  return { name: p.n || 'Shared map', statuses };
}

/** Pull a share code from a pasted link or raw string. */
export function extractCode(input: string): string {
  const t = input.trim();
  const hash = t.indexOf('#s=');
  if (hash >= 0) return t.slice(hash + 3);
  return t;
}
