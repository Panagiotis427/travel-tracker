import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ChangeEvent } from 'react';
import { loadFeatures, loadAdmin1, loadAdmin2, featureName, isSovereign } from './map/geo';
import type { CountryFeature } from './map/geo';
import { initCountryIndex, classifyCountry, classifyRegion } from './map/classify';
import { focusOf } from './lib/geo-util';
import type { Pov } from './lib/geo-util';
import { durationDays, fmtDuration, minIso, maxIso, isoDate } from './lib/dates';
import { encodeShare, decodeShare, extractCode } from './lib/share';
import { STATUS_META, UNVISITED_COLOR, normalizeVisit } from './state/status';
import type { Status, StatusMap, Visit, VisitMap, Trip } from './state/status';
import { getAllVisits, putVisit, deleteVisit, clearVisits, putMany } from './state/db';
import { supabase, cloudEnabled } from './lib/supabase';
import type { Session } from '@supabase/supabase-js';
import { pullRemote, pushRemote, deleteRemote, deleteAllRemote } from './state/cloud';
import type { AggMap } from './features/ImportPhotos';
import AuthScreen from './features/AuthScreen';
import { isNative, startBackground, stopBackground } from './features/bgLocation';

const GlobeView = lazy(() => import('./map/GlobeView'));
const ImportPhotos = lazy(() => import('./features/ImportPhotos'));

const COUNTRY_TARGET = 195;
const STATUSES: Status[] = ['visited', 'want', 'lived', 'transit'];
const LAYERS = { '110m': 'geo/world_110m.topojson', '50m': 'geo/world_50m.topojson', '10m': 'geo/world_10m.topojson' } as const;
type Lod = keyof typeof LAYERS;
const TEX = { dark: 'textures/earth-dark.jpg', day: 'textures/earth-blue-marble.jpg' } as const;
const OVERVIEW: Pov = { lat: 20, lng: 0, altitude: 2.3 };
const EXPAND_ALT = 0.9;  // resolve into Admin-1
const A2_ALT = 0.32;     // resolve into Admin-2
const MAX_EXPANDED = 6;
const BG_KEY = 'travel-tracker:bg';
const WELCOME_KEY = 'travel-tracker:welcome';
const OVERLAY_COLORS = ['#e74c3c', '#f1c40f', '#1abc9c', '#e67e22', '#9b59b6', '#16a085'];
const BOTH_COLOR = '#8e44ad';

interface CountryMeta { name: string; sov: boolean; }
interface Overlay { id: string; name: string; color: string; statuses: StatusMap; }

// "Been" checker for a status map: a country counts if it or any of its regions is
// visited/lived; a region counts if it or its parent country is.
function beenChecker(m: StatusMap): (id: string) => boolean {
  const country = new Set<string>();
  const region = new Set<string>();
  for (const [id, s] of Object.entries(m)) {
    if (s !== 'visited' && s !== 'lived') continue;
    if (id.includes('-')) { region.add(id); country.add(id.split('-')[0]); }
    else country.add(id);
  }
  return (id) => (id.includes('-') ? region.has(id) || country.has(id.split('-')[0]) : country.has(id));
}

export default function App() {
  const [visits, setVisits] = useState<VisitMap>({});
  const [lod, setLod] = useState<Lod>('50m');
  const [theme, setTheme] = useState<'dark' | 'day'>('dark');
  const [worldFeatures, setWorldFeatures] = useState<CountryFeature[]>([]);
  const [regions1, setRegions1] = useState<Record<string, CountryFeature[]>>({});
  const [regions2, setRegions2] = useState<Record<string, CountryFeature[]>>({});
  const [expanded, setExpanded] = useState<Record<string, 1 | 2>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [pov, setPov] = useState<Pov | null>(null);
  const [query, setQuery] = useState('');
  const [meta, setMeta] = useState<Record<string, CountryMeta>>({});
  const [loading, setLoading] = useState(true);
  const [showImport, setShowImport] = useState(false);
  const [geoMsg, setGeoMsg] = useState<string | null>(null);
  const [bgOn, setBgOn] = useState(false);
  const [overlays, setOverlays] = useState<Overlay[]>([]);
  const [compareId, setCompareId] = useState<string | null>(null);
  const [shareMsg, setShareMsg] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  const [profileMsg, setProfileMsg] = useState<string | null>(null);

  const admin0Cache = useRef<Map<Lod, CountryFeature[]>>(new Map());
  const lodTimer = useRef<number | null>(null);
  const loaded1 = useRef<Set<string>>(new Set());
  const loaded2 = useRef<Set<string>>(new Set());
  const fileRef = useRef<HTMLInputElement>(null);
  const userIdRef = useRef<string | null>(null);
  const syncedFor = useRef<string | null>(null);

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

  // Import a shared map from the URL hash (#s=...) once on load.
  useEffect(() => {
    const h = window.location.hash;
    if (h.startsWith('#s=')) {
      void addOverlayFromCode(h.slice(3));
      window.history.replaceState(null, '', window.location.pathname + window.location.search);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Track the auth session (persists on this device = "remember me").
  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setAuthReady(true); });
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === 'PASSWORD_RECOVERY') {
        const np = window.prompt('Enter a new password (at least 6 characters):');
        if (np) void supabase!.auth.updateUser({ password: np }).then(({ error }) => window.alert(error ? error.message : 'Password updated.'));
      }
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Show the optional welcome/auth screen on first run (only when cloud is set up).
  useEffect(() => {
    if (!authReady) return;
    if (session) { setShowAuth(false); return; }
    if (cloudEnabled && localStorage.getItem(WELCOME_KEY) !== '1') setShowAuth(true);
  }, [authReady, session]);

  // On login: pull the user's cloud data, merge (last-write-wins), push the union.
  useEffect(() => {
    const uid = session?.user?.id ?? null;
    userIdRef.current = uid;
    if (!uid) { syncedFor.current = null; return; }
    if (syncedFor.current === uid) return;
    syncedFor.current = uid;
    (async () => {
      const remote = await pullRemote();
      setVisits((prev) => {
        const merged: VisitMap = { ...prev };
        for (const [id, rv] of Object.entries(remote)) {
          const cur = merged[id];
          if (!cur || (rv.updatedAt ?? '') > (cur.updatedAt ?? '')) merged[id] = rv;
        }
        void putMany(merged);
        void pushRemote(uid, merged);
        return merged;
      });
    })();
  }, [session]);

  // Mirror local changes to the cloud (debounced) while logged in.
  useEffect(() => {
    const uid = userIdRef.current;
    if (!uid) return;
    const t = window.setTimeout(() => void pushRemote(uid, visits), 800);
    return () => window.clearTimeout(t);
  }, [visits]);

  // Seamless LOD: swap admin-0 detail, then resolve the viewed country into
  // Admin-1 (zoom in) or Admin-2 (zoom in further); only a few kept expanded.
  function onZoom(p: Pov) {
    if (lodTimer.current) window.clearTimeout(lodTimer.current);
    lodTimer.current = window.setTimeout(async () => {
      const wantLod: Lod = p.altitude < 0.55 ? '10m' : '50m';
      setLod((cur) => { if (cur !== wantLod) void loadWorld(wantLod); return wantLod; });

      const wantLevel = p.altitude < A2_ALT ? 2 : p.altitude < EXPAND_ALT ? 1 : 0;
      if (wantLevel === 0) { setExpanded((e) => (Object.keys(e).length ? {} : e)); return; }

      await initCountryIndex();
      const c = classifyCountry(p.lng, p.lat);
      if (!c) return;
      const a3 = c.id;

      if (!loaded1.current.has(a3)) {
        loaded1.current.add(a3);
        try { const rs = await loadAdmin1(a3); setRegions1((prev) => ({ ...prev, [a3]: rs })); }
        catch { loaded1.current.delete(a3); }
      }
      if (wantLevel === 2 && !loaded2.current.has(a3)) {
        loaded2.current.add(a3);
        try { const rs = await loadAdmin2(a3); setRegions2((prev) => ({ ...prev, [a3]: rs })); }
        catch { loaded2.current.delete(a3); }
      }

      setExpanded((prev) => {
        const level: 1 | 2 = wantLevel === 2 && loaded2.current.has(a3) ? 2 : 1;
        const next: Record<string, 1 | 2> = { [a3]: level };
        // Keep at most one country at Admin-2 (counties are heavy); demote the rest.
        for (const [k, v] of Object.entries(prev).filter(([k2]) => k2 !== a3).slice(0, MAX_EXPANDED - 1)) {
          next[k] = level === 2 ? 1 : v;
        }
        return next;
      });
    }, 180);
  }

  const displayFeatures = useMemo(() => {
    const out: CountryFeature[] = [];
    for (const f of worldFeatures) {
      const lvl = expanded[f.id];
      if (!lvl) { out.push(f); continue; }
      if (lvl === 2 && regions2[f.id]) out.push(...regions2[f.id]);
      else if (regions1[f.id]) out.push(...regions1[f.id]);
      else out.push(f);
    }
    return out;
  }, [worldFeatures, expanded, regions1, regions2]);

  const statuses = useMemo(() => {
    const m: StatusMap = {};
    for (const [id, v] of Object.entries(visits)) m[id] = v.status;
    return m;
  }, [visits]);

  const featureById = useCallback((id: string): CountryFeature | null => {
    return (
      displayFeatures.find((f) => f.id === id) ??
      worldFeatures.find((f) => f.id === id) ??
      Object.values(regions1).flat().find((f) => f.id === id) ??
      Object.values(regions2).flat().find((f) => f.id === id) ??
      null
    );
  }, [displayFeatures, worldFeatures, regions1, regions2]);

  const selectedFeature = useMemo(() => (selectedId ? featureById(selectedId) : null), [selectedId, featureById]);

  // Compare coloring when a person overlay is selected; else default status colors.
  const colorOverride = useMemo(() => {
    if (!compareId) return undefined;
    const ov = overlays.find((o) => o.id === compareId);
    if (!ov) return undefined;
    const mine = beenChecker(statuses);
    const theirs = beenChecker(ov.statuses);
    return (id: string): string | null => {
      const y = mine(id);
      const t = theirs(id);
      if (y && t) return BOTH_COLOR;
      if (y) return STATUS_META.visited.color;
      if (t) return ov.color;
      return null;
    };
  }, [compareId, overlays, statuses]);

  function pick(id: string) {
    setSelectedId(id);
    const f = featureById(id);
    if (f) setPov(focusOf(f.geometry));
  }

  const dtv = (s?: string) => (s ? (s.includes('T') ? s : `${s}T00:00`) : '');

  function setStatus(id: string, status: Status | null) {
    if (status === null) {
      setVisits((prev) => { const c = { ...prev }; delete c[id]; void deleteVisit(id); return c; });
      if (userIdRef.current) void deleteRemote(id);
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
  const updateTrip = (id: string, i: number, patch: Partial<Trip>) => mutateTrips(id, (t) => t.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const removeTrip = (id: string, i: number) => mutateTrips(id, (t) => t.filter((_, j) => j !== i));

  function resetView() { setSelectedId(null); setPov({ ...OVERVIEW }); }
  function clearAll() {
    if (window.confirm('Clear all marks? This cannot be undone.')) {
      setVisits({});
      void clearVisits();
      if (userIdRef.current) void deleteAllRemote();
    }
  }

  async function logout() {
    if (!supabase) return;
    await supabase.auth.signOut();
    syncedFor.current = null;
    setProfileMsg(null);
  }
  async function changePassword() {
    if (!supabase) return;
    const np = window.prompt('New password (at least 6 characters):');
    if (!np) return;
    const { error } = await supabase.auth.updateUser({ password: np });
    setProfileMsg(error ? error.message : 'Password updated.');
  }
  function skipWelcome() {
    setShowAuth(false);
    try { localStorage.setItem(WELCOME_KEY, '1'); } catch { /* ignore */ }
  }
  async function deleteAccount() {
    if (!supabase) return;
    if (!window.confirm('Delete your account data and sign out? Your marks are removed from the cloud. This cannot be undone.')) return;
    await deleteAllRemote();
    setVisits({});
    void clearVisits();
    await supabase.auth.signOut();
    syncedFor.current = null;
    setProfileMsg('Account data deleted and signed out.');
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
        copy[id] = next; changed[id] = next;
      }
      void putMany(changed);
      return copy;
    });
  }

  const markCoords = useCallback(async (lat: number, lng: number) => {
    await initCountryIndex();
    const c = classifyCountry(lng, lat);
    if (!c) return null;
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
        copy[id] = next; changed[id] = next;
      };
      mark(c.id);
      if (r) mark(r.id);
      void putMany(changed);
      return copy;
    });
    return c;
  }, []);

  function markLocation() {
    if (!navigator.geolocation) { setGeoMsg('Geolocation not available here.'); return; }
    setGeoMsg('Locating…');
    navigator.geolocation.getCurrentPosition(
      async (posn) => {
        const c = await markCoords(posn.coords.latitude, posn.coords.longitude);
        if (!c) { setGeoMsg('No country found at your location.'); return; }
        setGeoMsg(`Marked ${c.name}.`);
        pick(c.id);
      },
      (err) => setGeoMsg(err.code === err.PERMISSION_DENIED ? 'Location permission denied.' : 'Could not get location.'),
      { enableHighAccuracy: false, timeout: 10_000 },
    );
  }

  async function toggleBg() {
    if (!isNative()) { window.alert('Background tracking runs in the Android app only. On web/desktop, use "Mark my location".'); return; }
    if (bgOn) { await stopBackground(); setBgOn(false); try { localStorage.setItem(BG_KEY, '0'); } catch { /* ignore */ } }
    else { const ok = await startBackground((la, ln) => { void markCoords(la, ln); }); setBgOn(ok); if (ok) try { localStorage.setItem(BG_KEY, '1'); } catch { /* ignore */ } }
  }
  useEffect(() => {
    if (!isNative()) return;
    try { if (localStorage.getItem(BG_KEY) === '1') startBackground((la, ln) => { void markCoords(la, ln); }).then(setBgOn); } catch { /* ignore */ }
  }, [markCoords]);

  // --- sharing (backend-free) ---
  async function shareMine() {
    if (!Object.keys(statuses).length) { setShareMsg('Nothing marked to share yet.'); return; }
    const name = window.prompt('Your name for the shared map?', 'Me');
    if (name === null) return;
    const code = await encodeShare(name || 'Me', statuses);
    const link = `${window.location.origin}${window.location.pathname}#s=${code}`;
    try { await navigator.clipboard.writeText(link); setShareMsg('Share link copied to clipboard.'); }
    catch { window.prompt('Copy your share link:', link); setShareMsg('Share link ready.'); }
  }
  async function addOverlayFromCode(code: string) {
    try {
      const { name, statuses: st } = await decodeShare(extractCode(code));
      setOverlays((prev) => [...prev, { id: crypto.randomUUID(), name, color: OVERLAY_COLORS[prev.length % OVERLAY_COLORS.length], statuses: st }]);
      setShareMsg(`Added ${name}.`);
    } catch { setShareMsg('Could not read that share link.'); }
  }
  function addOverlayPrompt() {
    const code = window.prompt('Paste a share link:');
    if (code) void addOverlayFromCode(code);
  }
  function removeOverlay(id: string) {
    setOverlays((prev) => prev.filter((o) => o.id !== id));
    setCompareId((c) => (c === id ? null : c));
  }

  function exportJson() {
    const data = { app: 'travel-tracker', version: 3, exportedAt: new Date().toISOString(), visits };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `scratch-globe-${new Date().toISOString().slice(0, 10)}.json`; a.click();
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
      } catch { window.alert('Could not read that file — expected a Scratch Globe export.'); }
    };
    reader.readAsText(file);
  }

  const stats = useMemo(() => {
    const been = new Set<string>();
    let regionsMarked = 0, totalDays = 0;
    const counts: Record<Status, number> = { visited: 0, want: 0, lived: 0, transit: 0 };
    for (const [id, v] of Object.entries(visits)) {
      counts[v.status]++;
      for (const t of v.trips) { const d = durationDays(t.start, t.end); if (d) totalDays += d; }
      if (id.includes('-')) regionsMarked++;
      if (v.status === 'visited' || v.status === 'lived') been.add(id.includes('-') ? id.split('-')[0] : id);
    }
    let countriesBeen = 0;
    for (const a3 of been) if (meta[a3]?.sov ?? true) countriesBeen++;
    return { countriesBeen, regionsMarked, totalDays, counts };
  }, [visits, meta]);

  const pct = Math.round((stats.countriesBeen / COUNTRY_TARGET) * 100);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return worldFeatures.filter((f) => featureName(f).toLowerCase().includes(q)).sort((a, b) => featureName(a).localeCompare(featureName(b))).slice(0, 8);
  }, [query, worldFeatures]);

  const selName = selectedFeature ? featureName(selectedFeature) : '';
  const selVisit = selectedId ? visits[selectedId] : undefined;
  const isRegion = !!selectedId && selectedId.includes('-');
  const selSub = selectedFeature
    ? isRegion
      ? `${selectedFeature.properties?.type_en ?? 'Region'}${meta[selectedId!.split('-')[0]] ? ` · ${meta[selectedId!.split('-')[0]].name}` : ''}`
      : [selectedFeature.properties?.SUBREGION, selectedFeature.properties?.CONTINENT].filter(Boolean)[0] ?? ''
    : '';
  const totalDur = selVisit ? fmtDuration(selVisit.trips.reduce((s, t) => s + (durationDays(t.start, t.end) ?? 0), 0)) : '';
  const compareOverlay = overlays.find((o) => o.id === compareId);
  const hoveredFeature = !selectedFeature && hoveredId ? featureById(hoveredId) : null;
  const bannerName = selectedFeature ? selName : hoveredFeature ? featureName(hoveredFeature) : '';

  return (
    <div className="app">
      <aside className="sidebar">
        <h1>Scratch Globe</h1>

        <div className="stat">
          <div className="stat-big">{pct}%</div>
          <div className="stat-label">
            {stats.countriesBeen} of {COUNTRY_TARGET} countries
            {stats.regionsMarked ? ` · ${stats.regionsMarked} regions` : ''}
            {stats.totalDays ? ` · ${stats.totalDays} days` : ''}
          </div>
        </div>

        <div className="search">
          <input placeholder="Search country…" value={query} onChange={(e) => setQuery(e.target.value)} />
          {matches.length > 0 && (
            <ul className="search-list">
              {matches.map((f) => (<li key={f.id} onClick={() => { pick(f.id); setQuery(''); }}>{featureName(f)}</li>))}
            </ul>
          )}
        </div>

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
                <button key={s} className={selVisit?.status === s ? 'st on' : 'st'} style={{ '--c': STATUS_META[s].color } as CSSProperties} onClick={() => setStatus(selectedId!, s)}>{STATUS_META[s].label}</button>
              ))}
              <button className="st clear" onClick={() => setStatus(selectedId!, null)}>Clear</button>
            </div>
            {selVisit && (
              <div className="visit-fields">
                {selVisit.trips.map((t, i) => (
                  <div className="trip" key={i}>
                    <div className="date-row">
                      <label>From<input type="datetime-local" value={dtv(t.start)} onChange={(e) => updateTrip(selectedId!, i, { start: e.target.value || undefined })} /></label>
                      <label>To<input type="datetime-local" value={dtv(t.end)} onChange={(e) => updateTrip(selectedId!, i, { end: e.target.value || undefined })} /></label>
                      <button className="x trip-x" onClick={() => removeTrip(selectedId!, i)} aria-label="Remove trip">×</button>
                    </div>
                    <textarea placeholder="Notes…" value={t.note ?? ''} onChange={(e) => updateTrip(selectedId!, i, { note: e.target.value || undefined })} />
                  </div>
                ))}
                <button className="io addtrip" onClick={() => addTrip(selectedId!)}>+ Add trip</button>
                {totalDur && <div className="dur">{totalDur} total</div>}
              </div>
            )}
          </div>
        )}

        <ul className="legend">
          {STATUSES.map((s) => (<li key={s}><span className="swatch" style={{ background: STATUS_META[s].color }} />{STATUS_META[s].label}<b>{stats.counts[s]}</b></li>))}
          <li><span className="swatch" style={{ background: UNVISITED_COLOR }} />Unvisited</li>
        </ul>

        {cloudEnabled && (
          <div className="account">
            {session ? (
              <>
                <div className="acct-in">
                  <span className="acct-email">{session.user.email}</span>
                  <button className="io" onClick={logout}>Log out</button>
                </div>
                <button className="io" onClick={changePassword}>Change password</button>
                <button className="io danger" onClick={deleteAccount}>Delete account</button>
              </>
            ) : (
              <button className="io" onClick={() => setShowAuth(true)}>Sign in / Sign up</button>
            )}
            {profileMsg && <div className="stat-label">{profileMsg}</div>}
          </div>
        )}

        <div className="people">
          <div className="people-head"><span>People</span><button className="io" onClick={shareMine}>Share my map</button></div>
          <ul className="people-list">
            <li className={compareId ? '' : 'on'} onClick={() => setCompareId(null)}>
              <span className="swatch" style={{ background: STATUS_META.visited.color }} />Me
            </li>
            {overlays.map((o) => (
              <li key={o.id} className={compareId === o.id ? 'on' : ''}>
                <span className="swatch" style={{ background: o.color }} />
                <span className="pname" onClick={() => setCompareId(compareId === o.id ? null : o.id)}>{o.name}</span>
                <button className="x" onClick={() => removeOverlay(o.id)} aria-label="Remove">×</button>
              </li>
            ))}
          </ul>
          <button className="io" onClick={addOverlayPrompt}>Add person from link</button>
          {compareOverlay && <div className="stat-label">Comparing: <b style={{ color: STATUS_META.visited.color }}>you</b> · <b style={{ color: compareOverlay.color }}>{compareOverlay.name}</b> · <b style={{ color: BOTH_COLOR }}>both</b></div>}
          {shareMsg && <div className="stat-label">{shareMsg}</div>}
        </div>

        <div className="actions">
          <button className="drill" onClick={() => setShowImport(true)}>Import photos</button>
          <button className="io" onClick={markLocation}>Mark my location</button>
          <button className={bgOn ? 'io bg-on' : 'io'} onClick={toggleBg}>Background GPS: {bgOn ? 'On' : 'Off'}</button>
          {geoMsg && <div className="stat-label geo-msg">{geoMsg}</div>}
          <div className="io-row">
            <button className="io" onClick={() => setTheme((t) => (t === 'dark' ? 'day' : 'dark'))}>{theme === 'dark' ? 'Day globe' : 'Night globe'}</button>
            <button className="io" onClick={resetView}>Reset view</button>
          </div>
          <div className="io-row">
            <button className="io" onClick={exportJson}>Export JSON</button>
            <button className="io" onClick={() => fileRef.current?.click()}>Import JSON</button>
          </div>
          <button className="reset" onClick={clearAll}>Clear all marks</button>
          <input ref={fileRef} type="file" accept="application/json" hidden onChange={onImportFile} />
        </div>
        <footer>{loading ? 'Loading globe…' : `${lod} · ${displayFeatures.length} shapes · zoom for regions`}</footer>
        <div className="credit">Boundaries: Natural Earth (public domain) · geoBoundaries (CC BY 4.0)</div>
      </aside>

      <main className="map-wrap">
        {bannerName && (
          <div className="map-banner">
            <span className="mb-name">{bannerName}</span>
            {selectedFeature && selVisit && <span className="mb-pill" style={{ background: STATUS_META[selVisit.status].color }}>{STATUS_META[selVisit.status].label}</span>}
            {selectedFeature && <button className="mb-x" onClick={() => setSelectedId(null)} aria-label="Close">×</button>}
          </div>
        )}
        <Suspense fallback={<div className="globe-loading">Loading globe…</div>}>
          <GlobeView polygons={displayFeatures} statuses={statuses} selectedId={selectedId} globeImage={globeImage} onPick={pick} onDeselect={() => setSelectedId(null)} onHover={setHoveredId} onZoom={onZoom} pov={pov} colorOverride={colorOverride} />
        </Suspense>
      </main>

      {showImport && (
        <Suspense fallback={null}>
          <ImportPhotos onClose={() => setShowImport(false)} onApply={applyImport} />
        </Suspense>
      )}

      {showAuth && !session && cloudEnabled && <AuthScreen onSkip={skipWelcome} />}
    </div>
  );
}
