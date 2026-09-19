import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ChangeEvent } from 'react';
import { loadFeatures, loadAdmin1, featureName, isSovereign } from './map/geo';
import type { CountryFeature } from './map/geo';
import { focusOf } from './lib/geo-util';
import type { Pov } from './lib/geo-util';
import { durationDays, fmtDuration } from './lib/dates';
import { STATUS_META, UNVISITED_COLOR } from './state/status';
import type { Status, StatusMap, Visit, VisitMap } from './state/status';
import { getAllVisits, putVisit, deleteVisit, clearVisits, putMany } from './state/db';

const GlobeView = lazy(() => import('./map/GlobeView'));

const COUNTRY_TARGET = 195; // UN members + observers — stable denominator
const STATUSES: Status[] = ['visited', 'want', 'lived', 'transit'];
const LAYERS = { '110m': 'geo/world_110m.topojson', '50m': 'geo/world_50m.topojson', '10m': 'geo/world_10m.topojson' } as const;
type Lod = keyof typeof LAYERS;
const OVERVIEW: Pov = { lat: 20, lng: 0, altitude: 2.3 };

interface CountryMeta { name: string; sov: boolean; }

export default function App() {
  const [visits, setVisits] = useState<VisitMap>({});
  const [mode, setMode] = useState<'world' | 'country'>('world');
  const [lod, setLod] = useState<Lod>('50m');
  const [worldFeatures, setWorldFeatures] = useState<CountryFeature[]>([]);
  const [country, setCountry] = useState<{ a3: string; name: string } | null>(null);
  const [regionFeatures, setRegionFeatures] = useState<CountryFeature[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [pov, setPov] = useState<Pov | null>(null);
  const [query, setQuery] = useState('');
  const [meta, setMeta] = useState<Record<string, CountryMeta>>({});
  const [drilling, setDrilling] = useState(false);
  const [drillErr, setDrillErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const admin0Cache = useRef<Map<Lod, CountryFeature[]>>(new Map());
  const lodTimer = useRef<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const mergeMeta = useCallback((feats: CountryFeature[]) => {
    setMeta((prev) => {
      const next = { ...prev };
      for (const f of feats) if (!next[f.id]) next[f.id] = { name: featureName(f), sov: isSovereign(f) };
      return next;
    });
  }, []);

  const loadWorld = useCallback(async (which: Lod) => {
    const cached = admin0Cache.current.get(which);
    if (cached) { setWorldFeatures(cached); mergeMeta(cached); return; }
    const feats = await loadFeatures(import.meta.env.BASE_URL + LAYERS[which]);
    admin0Cache.current.set(which, feats);
    mergeMeta(feats);
    setWorldFeatures(feats);
  }, [mergeMeta]);

  useEffect(() => {
    setLoading(true);
    loadWorld('50m').finally(() => setLoading(false));
    getAllVisits().then(setVisits).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto level-of-detail: 50m base, upgrade to 10m when zoomed in (world mode).
  const onZoom = useCallback((altitude: number) => {
    if (mode !== 'world') return;
    if (lodTimer.current) window.clearTimeout(lodTimer.current);
    lodTimer.current = window.setTimeout(() => {
      const want: Lod = altitude < 0.55 ? '10m' : '50m';
      setLod((cur) => { if (cur !== want) void loadWorld(want); return want; });
    }, 180);
  }, [mode, loadWorld]);

  const displayFeatures = mode === 'country' ? regionFeatures : worldFeatures;

  const statuses = useMemo(() => {
    const m: StatusMap = {};
    for (const [id, v] of Object.entries(visits)) m[id] = v.status;
    return m;
  }, [visits]);

  const selectedFeature = useMemo(
    () => displayFeatures.find((f) => f.id === selectedId) ?? null,
    [displayFeatures, selectedId],
  );

  const pick = useCallback((id: string) => {
    setSelectedId(id);
    setDrillErr(null);
    const f = displayFeatures.find((x) => x.id === id);
    if (f) setPov(focusOf(f.geometry));
  }, [displayFeatures]);

  // --- mutations (state + IndexedDB) ---
  function upsertVisit(id: string, patch: Partial<Visit>) {
    setVisits((prev) => {
      const prevV = prev[id];
      const next: Visit = {
        ...prevV,
        ...patch,
        status: patch.status ?? prevV?.status ?? 'visited',
        updatedAt: new Date().toISOString(),
      };
      void putVisit(id, next);
      return { ...prev, [id]: next };
    });
  }
  function setStatusFor(id: string, status: Status | null) {
    if (status === null) {
      setVisits((prev) => { const c = { ...prev }; delete c[id]; void deleteVisit(id); return c; });
    } else {
      upsertVisit(id, { status });
    }
  }

  async function drill() {
    if (!selectedFeature) return;
    const a3 = selectedFeature.id;
    setDrilling(true);
    setDrillErr(null);
    try {
      const regions = await loadAdmin1(a3);
      if (!regions.length) throw new Error('no sub-regions');
      setRegionFeatures(regions);
      setCountry({ a3, name: featureName(selectedFeature) });
      setMode('country');
      setSelectedId(null);
      setPov(focusOf(selectedFeature.geometry));
    } catch {
      setDrillErr('No sub-regions available for this country.');
    } finally {
      setDrilling(false);
    }
  }

  function backToWorld() {
    setMode('world');
    setCountry(null);
    setRegionFeatures([]);
    setSelectedId(null);
    setPov({ ...OVERVIEW });
  }

  function resetView() {
    setSelectedId(null);
    setPov({ ...OVERVIEW });
  }

  function clearAll() {
    if (window.confirm('Clear all marks? This cannot be undone.')) {
      setVisits({});
      void clearVisits();
    }
  }

  function exportJson() {
    const data = { app: 'travel-tracker', version: 2, exportedAt: new Date().toISOString(), visits };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `scratch-globe-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function onImportFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result)) as { visits?: VisitMap };
        const incoming = data.visits ?? {};
        setVisits((prev) => {
          const merged: VisitMap = { ...prev };
          for (const [id, v] of Object.entries(incoming)) {
            if (!v || typeof v.status !== 'string') continue;
            const cur = merged[id];
            if (!cur || (v.updatedAt ?? '') > (cur.updatedAt ?? '')) merged[id] = v;
          }
          void putMany(merged);
          return merged;
        });
      } catch {
        window.alert('Could not read that file — expected a Scratch Globe export.');
      }
    };
    reader.readAsText(file);
  }

  // --- stats (stable denominator; hyphen id = admin-1 region) ---
  const stats = useMemo(() => {
    let countriesBeen = 0, territoriesBeen = 0, regionsMarked = 0, totalDays = 0;
    const counts: Record<Status, number> = { visited: 0, want: 0, lived: 0, transit: 0 };
    for (const [id, v] of Object.entries(visits)) {
      counts[v.status]++;
      const d = durationDays(v.start, v.end);
      if (d) totalDays += d;
      if (id.includes('-')) { regionsMarked++; continue; }
      const been = v.status === 'visited' || v.status === 'lived';
      if (!been) continue;
      if (meta[id]?.sov ?? true) countriesBeen++;
      else territoriesBeen++;
    }
    return { countriesBeen, territoriesBeen, regionsMarked, totalDays, counts };
  }, [visits, meta]);

  const pct = Math.round((stats.countriesBeen / COUNTRY_TARGET) * 100);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return worldFeatures
      .filter((f) => featureName(f).toLowerCase().includes(q))
      .sort((a, b) => featureName(a).localeCompare(featureName(b)))
      .slice(0, 8);
  }, [query, worldFeatures]);

  const selName = selectedFeature ? featureName(selectedFeature) : '';
  const selVisit = selectedId ? visits[selectedId] : undefined;
  const selSub = selectedFeature
    ? mode === 'country'
      ? `${selectedFeature.properties?.type_en ?? 'Region'}${country ? ` · ${country.name}` : ''}`
      : [selectedFeature.properties?.SUBREGION, selectedFeature.properties?.CONTINENT].filter(Boolean)[0] ?? ''
    : '';
  const durTxt = fmtDuration(durationDays(selVisit?.start, selVisit?.end));
  const regionsHere = mode === 'country' ? regionFeatures.filter((f) => visits[f.id]).length : 0;

  return (
    <div className="app">
      <aside className="sidebar">
        <h1>Scratch Globe</h1>

        {mode === 'world' ? (
          <>
            <div className="stat">
              <div className="stat-big">{pct}%</div>
              <div className="stat-label">
                {stats.countriesBeen} of {COUNTRY_TARGET} countries
                {stats.territoriesBeen ? ` · +${stats.territoriesBeen} territories` : ''}
                {stats.regionsMarked ? ` · ${stats.regionsMarked} regions` : ''}
                {stats.totalDays ? ` · ${stats.totalDays} days` : ''}
              </div>
            </div>

            <div className="search">
              <input placeholder="Search country…" value={query} onChange={(e) => setQuery(e.target.value)} />
              {matches.length > 0 && (
                <ul className="search-list">
                  {matches.map((f) => (
                    <li key={f.id} onClick={() => { pick(f.id); setQuery(''); }}>{featureName(f)}</li>
                  ))}
                </ul>
              )}
            </div>
          </>
        ) : (
          <div className="country-head">
            <button className="back" onClick={backToWorld}>‹ World</button>
            <div>
              <div className="panel-name">{country?.name}</div>
              <div className="stat-label">{regionsHere ? `${regionsHere} of ${regionFeatures.length} regions` : 'Tap regions to mark'}</div>
            </div>
          </div>
        )}

        {selectedFeature && (
          <div className="panel">
            <div className="panel-head">
              <div>
                <div className="panel-name">{selName}</div>
                {selSub && <div className="panel-sub">{selSub}</div>}
              </div>
              <button className="x" onClick={() => setSelectedId(null)} aria-label="Close">×</button>
            </div>

            <div className="status-grid">
              {STATUSES.map((s) => (
                <button
                  key={s}
                  className={selVisit?.status === s ? 'st on' : 'st'}
                  style={{ '--c': STATUS_META[s].color } as CSSProperties}
                  onClick={() => setStatusFor(selectedId!, s)}
                >
                  {STATUS_META[s].label}
                </button>
              ))}
              <button className="st clear" onClick={() => setStatusFor(selectedId!, null)}>Clear</button>
            </div>

            {selVisit && (
              <div className="visit-fields">
                <div className="date-row">
                  <label>From
                    <input type="date" value={selVisit.start ?? ''}
                      onChange={(e) => upsertVisit(selectedId!, { start: e.target.value || undefined })} />
                  </label>
                  <label>To
                    <input type="date" value={selVisit.end ?? ''}
                      onChange={(e) => upsertVisit(selectedId!, { end: e.target.value || undefined })} />
                  </label>
                </div>
                {durTxt && <div className="dur">{durTxt}</div>}
                <textarea placeholder="Notes…" value={selVisit.note ?? ''}
                  onChange={(e) => upsertVisit(selectedId!, { note: e.target.value || undefined })} />
              </div>
            )}

            {mode === 'world' && (
              <button className="drill" onClick={drill} disabled={drilling}>
                {drilling ? 'Loading…' : 'Drill into regions'}
              </button>
            )}
            {drillErr && <div className="err">{drillErr}</div>}
          </div>
        )}

        <ul className="legend">
          {STATUSES.map((s) => (
            <li key={s}>
              <span className="swatch" style={{ background: STATUS_META[s].color }} />
              {STATUS_META[s].label}
              <b>{stats.counts[s]}</b>
            </li>
          ))}
          <li><span className="swatch" style={{ background: UNVISITED_COLOR }} />Unvisited</li>
        </ul>

        <div className="actions">
          <button className="reset" onClick={resetView}>Reset view</button>
          <div className="io-row">
            <button className="io" onClick={exportJson}>Export</button>
            <button className="io" onClick={() => fileRef.current?.click()}>Import</button>
          </div>
          <button className="reset" onClick={clearAll}>Clear all marks</button>
          <input ref={fileRef} type="file" accept="application/json" hidden onChange={onImportFile} />
        </div>
        <footer>{loading ? 'Loading globe…' : mode === 'country' ? `${regionFeatures.length} regions` : `${lod} · ${worldFeatures.length} countries`}</footer>
      </aside>

      <main className="map-wrap">
        <Suspense fallback={<div className="globe-loading">Loading globe…</div>}>
          <GlobeView
            polygons={displayFeatures}
            statuses={statuses}
            selectedId={selectedId}
            onPick={pick}
            onZoom={onZoom}
            pov={pov}
          />
        </Suspense>
      </main>
    </div>
  );
}
