import { describe, it, expect } from 'vitest';
import { readPhotoFix } from './exif';

// A minimal JPEG (SOI, one EXIF APP1 segment, EOI) with a GPS position and a capture time.
function jpeg(lat: number, lng: number, when: string): ArrayBuffer {
  const ifd0 = 8, exif = ifd0 + 30, gps = exif + 18, date = gps + 54, latAt = date + 20, lngAt = latAt + 24;
  const t = new DataView(new ArrayBuffer(lngAt + 24));
  const ascii = (at: number, s: string) => { for (let i = 0; i < s.length; i++) t.setUint8(at + i, s.charCodeAt(i)); };
  const entry = (at: number, tag: number, type: number, count: number, value: number) => {
    t.setUint16(at, tag, true); t.setUint16(at + 2, type, true); t.setUint32(at + 4, count, true); t.setUint32(at + 8, value, true);
  };
  const dms = (v: number, at: number) => {
    const a = Math.abs(v), d = Math.floor(a), m = Math.floor((a - d) * 60), s = Math.round(((a - d) * 60 - m) * 60000);
    [[d, 1], [m, 1], [s, 1000]].forEach(([n, den], i) => { t.setUint32(at + i * 8, n, true); t.setUint32(at + i * 8 + 4, den, true); });
  };
  ascii(0, 'II'); t.setUint16(2, 42, true); t.setUint32(4, ifd0, true);
  t.setUint16(ifd0, 2, true); entry(ifd0 + 2, 0x8769, 4, 1, exif); entry(ifd0 + 14, 0x8825, 4, 1, gps);
  t.setUint16(exif, 1, true); entry(exif + 2, 0x9003, 2, 20, date);
  t.setUint16(gps, 4, true);
  entry(gps + 2, 0x0001, 2, 2, 0); ascii(gps + 10, lat >= 0 ? 'N' : 'S');
  entry(gps + 14, 0x0002, 5, 3, latAt);
  entry(gps + 26, 0x0003, 2, 2, 0); ascii(gps + 34, lng >= 0 ? 'E' : 'W');
  entry(gps + 38, 0x0004, 5, 3, lngAt);
  ascii(date, when); dms(lat, latAt); dms(lng, lngAt);
  const body = new Uint8Array(t.buffer);
  const out = new Uint8Array(2 + 4 + 6 + body.length + 2);
  out.set([0xff, 0xd8, 0xff, 0xe1, ((body.length + 8) >> 8) & 0xff, (body.length + 8) & 0xff], 0);
  out.set([0x45, 0x78, 0x69, 0x66, 0, 0], 6); // "Exif\0\0"
  out.set(body, 12);
  out.set([0xff, 0xd9], 12 + body.length);
  return out.buffer;
}

describe('readPhotoFix', () => {
  it('reads the GPS position and the local capture date', async () => {
    const fix = await readPhotoFix(jpeg(48.8566, -2.3522, '2026:05:01 12:30:00'));
    expect(fix?.lat).toBeCloseTo(48.8566, 3);
    expect(fix?.lng).toBeCloseTo(-2.3522, 3); // western longitude keeps its sign
    expect(fix?.date).toBe('2026-05-01');
  });

  it('has no fix for a photo without a position, or at the 0,0 placeholder', async () => {
    expect(await readPhotoFix(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]).buffer)).toBeNull();
    expect(await readPhotoFix(jpeg(0, 0, '2026:05:01 12:30:00'))).toBeNull();
  });
});
