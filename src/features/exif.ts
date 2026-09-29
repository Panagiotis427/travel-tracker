// What photo import needs from one photo's EXIF: its GPS position and capture date. Used by
// the import worker (exifWorker.ts) and, where a worker can't start, on the main thread.
import exifr from 'exifr';
import { isoDate } from '../lib/dates';

export interface PhotoFix { lat: number; lng: number; date?: string }

/** A batch of photos for the worker, and its answer: one fix (or null) per photo, in order. */
export interface FixRequest { id: number; files: File[] }
export interface FixReply { id: number; fixes: Array<PhotoFix | null> }

/** The photo's GPS position and local capture date, or null when it has no usable position. */
export async function readPhotoFix(input: Blob | ArrayBuffer): Promise<PhotoFix | null> {
  try {
    const g = await exifr.gps(input);
    if (!g || !Number.isFinite(g.latitude) || !Number.isFinite(g.longitude) || (g.latitude === 0 && g.longitude === 0)) return null;
    let date: string | undefined;
    try {
      const p = await exifr.parse(input, ['DateTimeOriginal']);
      if (p?.DateTimeOriginal instanceof Date) date = isoDate(p.DateTimeOriginal);
    } catch { /* no date */ }
    return { lat: g.latitude, lng: g.longitude, date };
  } catch {
    return null; // unreadable file
  }
}
