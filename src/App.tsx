import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ChangeEvent } from 'react';
import { loadFeatures, loadAdmin1, featureName, isSovereign } from './map/geo';
import type { CountryFeature } from './map/geo';
import { initCountryIndex, classifyCountry, classifyRegion } from './map/classify';
import { focusOf } from './lib/geo-util';
import type { Pov } from './lib/geo-util';
import { durationDays, fmtDuration, minIso, maxIso, isoDate } from './lib/dates';
import { STATUS_META, UNVISITED_COLOR, normalizeVisit } from './state/status';
import type { Status, StatusMap, Visit, VisitMap, Trip } from './state/status';
import { getAllVisits, putVisit, deleteVisit, clearVisits, putMany } from './state/db';
import type { AggMap } from './features/ImportPhotos';
import type { LabelPoint } from './map/GlobeView';

const GlobeView = lazy(() => import('./map/GlobeView'));
const ImportPhotos = lazy(() => import('./features/ImportPhotos'));

const COUNTRY_TARGET = 195; // UN members + observers — stable denominator
const STATUSES: Status[] = ['visited', 'want', 'lived', 'transit'];
const LAYERS = { '110m': 'geo/world_110m.topojson', '50m': 'geo/world_50m.topojson', '10m': 'geo/world_10m.topojson' } as const;
type Lod = keyof typeof LAYERS;
const TEX = { dark: 'textures/earth-dark.jpg', day: 'textures/earth-blue-marble.jpg' } as const;
const OVERVIEW: Pov = { lat: 20, lng: 0, altitude: 2.3 };

interface CountryMeta { name: string; sov: boolean; }

export default function App() {
  const [visits, setVisits] = useState<VisitMap>({});
  const [mode, setMode] = useState<'world' | 'country'>('world');
  const [lod, setLod] = useState<Lod>('50m');
  const [theme, setTheme] = useState<'dark' | 'day'>('dark');
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
  const [showImport, setShowImport] = useState(false);
  const [geoMsg, setGeoMsg] = useState<string | null>(null);

  const admin0Cache = useRef<Map<Lod, CountryFeature[]>>(new Map());
  const lodTimer = useRef<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const globeImage = import.meta.env.BASE_URL + TEX[theme];

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

  // Labels for marked places (+ the current selection).
  const labels = useMemo<LabelPoint[]>(() => {
    const out: LabelPoint[] = [];
    for (const f of displayFeatures) {
      if (visits[f.id] || f.id === selectedId) {
        const p = focusOf(f.geometry);
        out.push({ lat: p.lat, lng: p.lng, text: featureName(f) });
      }
    }
    return out;
  }, [displayFeatures, visits, selectedId]);

  const pick = useCallback((id: string) => {
    setSelectedId(id);
    setDrillErr(null);
    const f = displayFeatures.find((x) => x.id === id);
    if (f) setPov(focusOf(f.geometry));
  }, [displayFeatures]);

  // --- mutations (state + IndexedDB) ---
  function setStatus(id: string, status: Status | null) {
    if (status === null) {
      setVisits((prev) => { const c = { ...prev }; delete c[id]; void deleteVisit(id); return c; });
      return;
    }
    setVisits((prev) => {
      const next: Visit = { status, trips: prev[id]?.trips ?? [], updatedAt: new Date().toISOString() };
      void putVisit(id, next);
      return { ...prev, [id]: next };
    });
  }
  function mutateTrips(id: string, fn: (t: Trip[]) => Trip[]) {
    setVisits((prev) => {
      const cur = prev[id];
      const next: Visit = { status: cur?.status ?? 'visited', trips: fn(cur?.trips ?? []), updatedAt: new Date().toISOString() };
      void putVisit(id, next);
      return { ...prev, [id]: next };
    });
  }
  const addTrip = (id: string) => mutateTrips(id, (t) => [...t, {}]);
  const updateTrip = (id: string, i: number, patch: Partial<Trip>) =>
    mutateTrips(id, (t) => t.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const removeTrip = (id: string, i: number) => mutateTrips(id, (t) => t.filter((_, j) => j !== i));

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
  function resetView() { setSelectedId(null); setPov({ ...OVERVIEW }); }
  function clearAll() {
    if (window.confirm('Clear all marks? This cannot be undone.')) { setVisits({}); void clearVisits(); }
  }

  function applyImport(agg: AggMap) {
    setVisits((prev) => {
      const now = new Date().toISOString();
      const copy = { ...prev };
      const changed: VisitMap = {};
      for (const [id, a] of Object.entries(agg)) {
        const cur = copy[id];
        const status: Status = !cur || cur.status === 'want' ? 'visited' : cur.status;
        const trips = [...(cur?.trips ?? [])];
        if (!trips.length) trips.push({ start: a.start, end: a.end });
        else trips[0] = { ...trips[0], start: minIso(trips[0].start, a.start), end: maxIso(trips[0].end, a.end) };
        const next: Visit = { status, trips, updatedAt: now };
        copy[id] = next;
        changed[id] = next;
      }
      void putMany(changed);
      return copy;
    });
  }

  function markLocation() {
    if (!navigator.geolocation) { setGeoMsg('Geolocation not available here.'); return; }
    setGeoMsg('Locating…');
    navigator.geolocation.getCurrentPosition(
      async (posn) => {
        const { latitude: lat, longitude: lng } = posn.coords;
        await initCountryIndex();
        const c = classifyCountry(lng, lat);
        if (!c) { setGeoMsg('No country found at your location.'); return; }
        const today = isoDate(new Date());
        const r = await classifyRegion(c.id, lng, lat);
        setVisits((prev) => {
          const now = new Date().toISOString();
          const copy = { ...prev };
          const changed: VisitMap = {};
          const mark = (id: string) => {
            const cur = copy[id];
            const status: Status = !cur || cur.status === 'want' ? 'visited' : cur.status;
            const trips = [...(cur?.trips ?? [])];
            if (!trips.some((t) => t.start === today && t.end === today)) trips.push({ start: today, end: today });
            const next: Visit = { status, trips, updatedAt: now };
            copy[id] = next;
            changed[id] = next;
          };
          mark(c.id);
          if (r) mark(r.id);
          void putMany(changed);
          return copy;
        });
        setGeoMsg(`Marked ${c.name}${r ? ` · ${r.name}` : ''}.`);
        pick(c.id);
      },
      (err) => setGeoMsg(err.code === err.PERMISSION_DENIED ? 'Location permission denied.' : 'Could not get location.'),
      { enableHighAccuracy: false, timeout: 10_000 },
    );
  }

  function exportJson() {
    const data = { app: 'travel-tracker', version: 3, exportedAt: new Date().toISOString(), visits };
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
        const data = JSON.parse(String(reader.result)) as { visits?: Record<string, unknown> };
        const incoming = data.visits ?? {};
        setVisits((prev) => {
          const merged: VisitMap = { ...prev };
          const changed: VisitMap = {};
          for (const [id, raw] of Object.entries(incoming)) {
            const v = normalizeVisit(raw);
            if (!v) continue;
            const cur = merged[id];
            if (!cur || (v.updatedAt ?? '') > (cur.updatedAt ?? '')) { merged[id] = v; changed[id] = v; }
          }
          void putMany(changed);
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
      for (const t of v.trips) { const d = durationDays(t.start, t.end); if (d) totalDays += d; }
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
  const totalDur = selVisit ? fmtDuration(selVisit.trips.reduce((s, t) => s + (durationDays(t.start, t.end) ?? 0), 0)) : '';
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
                  onClick={() => setStatus(selectedId!, s)}
                >
                  {STATUS_META[s].label}
                </button>
              ))}
              <button className="st clear" onClick={() => setStatus(selectedId!, null)}>Clear</button>
            </div>

            {selVisit && (
              <div className="visit-fields">
                {selVisit.trips.map((t, i) => (
                  <div className="trip" key={i}>
                    <div className="date-row">
                      <label>From
                        <input type="date" value={t.start ?? ''} onChange={(e) => updateTrip(selectedId!, i, { start: e.target.value || undefined })} />
                      </label>
                      <label>To
                        <input type="date" value={t.end ?? ''} onChange={(e) => updateTrip(selectedId!, i, { end: e.target.value || undefined })} />
                      </label>
                      <button className="x trip-x" onClick={() => removeTrip(selectedId!, i)} aria-label="Remove trip">×</button>
                    </div>
                    <textarea placeholder="Notes…" value={t.note ?? ''} onChange={(e) => updateTrip(selectedId!, i, { note: e.target.value || undefined })} />
                  </div>
                ))}
                <button className="io addtrip" onClick={() => addTrip(selectedId!)}>+ Add trip</button>
                {totalDur && <div className="dur">{totalDur} total</div>}
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
          <button className="drill" onClick={() => setShowImport(true)}>Import photos</button>
          <button className="io" onClick={markLocation}>Mark my location</button>
          {geoMsg && <div className="stat-label geo-msg">{geoMsg}</div>}
          <div className="io-row">
            <button className="io" onClick={() => setTheme((t) => (t === 'dark' ? 'day' : 'dark'))}>
              {theme === 'dark' ? 'Day globe' : 'Night globe'}
            </button>
            <button className="io" onClick={resetView}>Reset view</button>
          </div>
          <div className="io-row">
            <button className="io" onClick={exportJson}>Export JSON</button>
            <button className="io" onClick={() => fileRef.current?.click()}>Import JSON</button>
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
            globeImage={globeImage}
            labels={labels}
            onPick={pick}
            onZoom={onZoom}
            pov={pov}
          />
        </Suspense>
      </main>

      {showImport && (
        <Suspense fallback={null}>
          <ImportPhotos onClose={() => setShowImport(false)} onApply={applyImport} />
        </Suspense>
      )}
    </div>
  );
}
