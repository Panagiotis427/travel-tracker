import { describe, it, expect } from 'vitest';
import { encodeShare, decodeShare, extractCode } from './share';

// Build a raw code the way an attacker could, bypassing encodeShare's own filtering.
async function deflate(json: string): Promise<string> {
  const buf = await new Response(new Blob([json]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer();
  let s = '';
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

describe('share codec', () => {
  it('round-trips real place ids, including territory codes', async () => {
    const map = { FRA: 'visited', 'USA-2-12': 'lived', 'AUS+00?': 'want', 'USA-3514': 'transit' } as const;
    const d = await decodeShare(await encodeShare('Anna', { ...map }));
    expect(d.name).toBe('Anna');
    expect({ ...d.statuses }).toEqual(map);
  });

  it('extracts the code from a pasted link', () => {
    expect(extractCode(' https://example.org/app/#s=abc_-1 ')).toBe('abc_-1');
    expect(extractCode('raw')).toBe('raw');
  });

  it('ignores status codes that name inherited object properties', async () => {
    const d = await decodeShare(await deflate(JSON.stringify({ n: 'x', m: { FRA: 'constructor', DEU: 'v', ITA: 'toString' } })));
    expect({ ...d.statuses }).toEqual({ DEU: 'visited' });
  });

  it('rejects a __proto__ id and builds the map without a prototype', async () => {
    const d = await decodeShare(await deflate('{"n":"x","m":{"__proto__":"v","FRA":"v"}}'));
    expect(Object.keys(d.statuses)).toEqual(['FRA']);
    expect(Object.getPrototypeOf(d.statuses)).toBeNull();
  });

  it('strips control characters from the name and caps it at 60', async () => {
    const d = await decodeShare(await deflate(JSON.stringify({ n: 'a\u0000b\u001bc' + 'z'.repeat(200), m: {} })));
    expect(d.name).toHaveLength(60);
    expect(d.name.startsWith('abc')).toBe(true);
  });

  it('aborts a payload that inflates past the cap', async () => {
    const code = await deflate(JSON.stringify({ n: 'b', m: {}, pad: ' '.repeat(5_000_000) }));
    await expect(decodeShare(code)).rejects.toThrow('share code too large');
  });

  it('rejects an over-long code and garbage input', async () => {
    await expect(decodeShare('A'.repeat(200_001))).rejects.toThrow('share code too long');
    await expect(decodeShare('%%%not-base64%%%')).rejects.toThrow();
  });
});
