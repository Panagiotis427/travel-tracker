import { useCallback, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import exifr from 'exifr';
import { initCountryIndex, classifyCountry, classifyRegion } from '../map/classify';
import { isoDate } from '../lib/dates';

export interface Agg { start?: string; end?: string; kind: 'country' | 'region'; name: string; }
export type AggMap = Record<string, Agg>;

interface Summary { photos: number; gps: number; countries: number; regions: number; }
interface Props {
  onClose: () => void;
  onApply: (agg: AggMap) => void;
}

function isImage(f: File): boolean {
  if (f.type.startsWith('image/')) return true;
  return /\.(jpe?g|heic|heif|tiff?|png|webp)$/i.test(f.name);
}

export default function ImportPhotos({ onClose, onApply }: Props) {
  const [phase, setPhase] = useState<'idle' | 'scanning' | 'done'>('idle');
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [summary, setSummary] = useState<Summary | null>(null);
  const [dragging, setDragging] = useState(false);
  const aggRef = useRef<AggMap>({});
  const inputRef = useRef<HTMLInputElement>(null);

  const scan = useCallback(async (files: File[]) => {
    const imgs = files.filter(isImage);
    if (!imgs.length) return;
    setPhase('scanning');
    setProgress({ done: 0, total: imgs.length });
    await initCountryIndex();

    const agg: AggMap = {};
    const countries = new Set<string>();
    const regions = new Set<string>();
    let gps = 0;

    const widen = (id: string, kind: Agg['kind'], name: string, date?: string) => {
      const a = agg[id] ?? (agg[id] = { kind, name });
      if (date) {
        if (!a.start || date < a.start) a.start = date;
        if (!a.end || date > a.end) a.end = date;
      }
    };

    for (let i = 0; i < imgs.length; i++) {
      try {
        const g = await exifr.gps(imgs[i]);
        if (g && Number.isFinite(g.latitude) && Number.isFinite(g.longitude) && (g.latitude !== 0 || g.longitude !== 0)) {
          gps++;
          let date: string | undefined;
          try {
            const p = await exifr.parse(imgs[i], ['DateTimeOriginal']);
            if (p?.DateTimeOriginal instanceof Date) date = isoDate(p.DateTimeOriginal);
          } catch { /* no date */ }
          const c = classifyCountry(g.longitude, g.latitude);
          if (c) {
            countries.add(c.id);
            widen(c.id, 'country', c.name, date);
            const r = await classifyRegion(c.id, g.longitude, g.latitude);
            if (r) { regions.add(r.id); widen(r.id, 'region', r.name, date); }
          }
        }
      } catch { /* skip unreadable file */ }
      if (i % 15 === 0) {
        setProgress({ done: i + 1, total: imgs.length });
        await new Promise((r) => setTimeout(r));
      }
    }

    aggRef.current = agg;
    setProgress({ done: imgs.length, total: imgs.length });
    setSummary({ photos: imgs.length, gps, countries: countries.size, regions: regions.size });
    setPhase('done');
  }, []);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    scan(Array.from(e.dataTransfer.files));
  };

  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h2>Import photos</h2>
          <button className="x" onClick={onClose} aria-label="Close">×</button>
        </div>

        {phase === 'idle' && (
          <div
            className={dragging ? 'dropzone drag' : 'dropzone'}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            onClick={() => inputRef.current?.click()}
          >
            <div className="dz-big">Drop photos here</div>
            <div className="dz-sub">or click to choose. Read on your device — nothing is uploaded.</div>
            <input
              ref={inputRef}
              type="file"
              accept="image/*,.heic,.heif"
              multiple
              hidden
              onChange={(e) => scan(Array.from(e.target.files ?? []))}
            />
          </div>
        )}

        {phase === 'scanning' && (
          <div className="scan">
            <div className="progress"><div className="bar" style={{ width: `${pct}%` }} /></div>
            <div className="stat-label">Scanning {progress.done} / {progress.total} photos…</div>
          </div>
        )}

        {phase === 'done' && summary && (
          <div className="summary">
            <ul>
              <li><b>{summary.photos}</b> photos scanned</li>
              <li><b>{summary.gps}</b> with GPS location</li>
              <li><b>{summary.countries}</b> countries · <b>{summary.regions}</b> regions matched</li>
            </ul>
            {summary.gps === 0 && <div className="err">No GPS found. Screenshots and some downloads have no location; camera photos usually do.</div>}
            <div className="modal-actions">
              <button className="io" onClick={() => { setPhase('idle'); setSummary(null); }}>Scan more</button>
              <button className="drill" disabled={summary.countries === 0} onClick={() => { onApply(aggRef.current); onClose(); }}>
                Apply marks
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
