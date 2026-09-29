import { useCallback, useEffect, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import { initCountryIndex, classifyCountry, classifyRegion } from '../map/classify';
import type { FixReply, FixRequest, PhotoFix } from './exif';

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

// Photos per worker message: at least 20, and few enough messages (about 40) that a huge
// import doesn't spend its time messaging and repainting the progress bar.
const batchSize = (n: number) => Math.max(20, Math.ceil(n / 40));

/**
 * Read the EXIF fixes of these photos with a small pool of workers, handing each finished
 * batch to `onBatch` one at a time. Where a worker can't start or fails, its batches are
 * read on the main thread instead.
 */
async function readFixes(imgs: File[], onBatch: (fixes: Array<PhotoFix | null>, count: number) => Promise<void>, signal: AbortSignal): Promise<void> {
  const batches: File[][] = [];
  const per = batchSize(imgs.length);
  for (let i = 0; i < imgs.length; i += per) batches.push(imgs.slice(i, i + per));
  const size = Math.min(4, Math.max(1, (navigator.hardwareConcurrency || 2) - 1), batches.length);
  const workers: Worker[] = [];
  try {
    for (let i = 0; i < size; i++) workers.push(new Worker(new URL('./exifWorker.ts', import.meta.url), { type: 'module' }));
  } catch { /* no workers here: read on the main thread */ }
  const pending = new Set<() => void>();
  const stop = () => { workers.forEach((w) => w.terminate()); pending.forEach((cancel) => cancel()); };
  signal.addEventListener('abort', stop);

  const onMain = async (files: File[]) => {
    const { readPhotoFix } = await import('./exif');
    const out: Array<PhotoFix | null> = [];
    for (const f of files) out.push(await readPhotoFix(f));
    return out;
  };
  const ask = (w: Worker, id: number, files: File[]) => new Promise<Array<PhotoFix | null>>((resolve, reject) => {
    const settle = () => { pending.delete(cancel); w.onmessage = null; w.onerror = null; };
    const cancel = () => { settle(); reject(new Error('stopped')); };
    pending.add(cancel);
    w.onmessage = (e: MessageEvent<FixReply>) => { if (e.data.id === id) { settle(); resolve(e.data.fixes); } };
    w.onerror = (e) => { e.preventDefault(); settle(); reject(new Error('worker failed')); };
    w.postMessage({ id, files } satisfies FixRequest);
  });

  let next = 0;
  let chain = Promise.resolve(); // batches are classified one at a time, as they finish
  const run = async (w: Worker | null) => {
    while (!signal.aborted && next < batches.length) {
      const id = next++;
      let fixes: Array<PhotoFix | null>;
      if (w) {
        try { fixes = await ask(w, id, batches[id]); } catch {
          if (signal.aborted) return;
          w.terminate();
          w = null;
          fixes = await onMain(batches[id]);
        }
      } else {
        fixes = await onMain(batches[id]);
      }
      if (signal.aborted) return;
      chain = chain.then(() => onBatch(fixes, batches[id].length));
    }
  };
  try {
    await Promise.all(workers.length ? workers.map((w) => run(w)) : [run(null)]);
    await chain;
  } finally {
    signal.removeEventListener('abort', stop);
    workers.forEach((w) => w.terminate());
  }
}

export default function ImportPhotos({ onClose, onApply }: Props) {
  const [phase, setPhase] = useState<'idle' | 'scanning' | 'done'>('idle');
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [summary, setSummary] = useState<Summary | null>(null);
  const [dragging, setDragging] = useState(false);
  const aggRef = useRef<AggMap>({});
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []); // closing the dialog stops the workers

  const scan = useCallback(async (files: File[]) => {
    const imgs = files.filter(isImage);
    if (!imgs.length) return;
    const ctl = new AbortController();
    abortRef.current = ctl;
    setPhase('scanning');
    setProgress({ done: 0, total: imgs.length });
    await initCountryIndex();
    if (ctl.signal.aborted) return; // closed while the country outlines loaded

    const agg: AggMap = {};
    const countries = new Set<string>();
    const regions = new Set<string>();
    let gps = 0;
    let done = 0;

    const widen = (id: string, kind: Agg['kind'], name: string, date?: string) => {
      const a = agg[id] ?? (agg[id] = { kind, name });
      if (date) {
        if (!a.start || date < a.start) a.start = date;
        if (!a.end || date > a.end) a.end = date;
      }
    };

    await readFixes(imgs, async (fixes, count) => {
      for (const fix of fixes) {
        if (!fix) continue;
        gps++;
        try {
          const c = classifyCountry(fix.lng, fix.lat);
          if (c) {
            countries.add(c.id);
            widen(c.id, 'country', c.name, fix.date);
            const r = await classifyRegion(c.id, fix.lng, fix.lat);
            if (r) { regions.add(r.id); widen(r.id, 'region', r.name, fix.date); }
          }
        } catch { /* skip this photo */ }
      }
      done += count;
      setProgress({ done, total: imgs.length });
    }, ctl.signal);
    if (ctl.signal.aborted) return;

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
