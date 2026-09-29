import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ChangeEvent } from 'react';
import { loadFeatures, loadAdmin1, loadAdmin2, featureName, isSovereign } from './map/geo';
import type { CountryFeature } from './map/geo';
import { loadCities, selectMarkers, markerCap } from './map/cities';
import type { CityMarker, MarkerMode } from './map/cities';
import { initCountryIndex, classifyCountry, classifyRegion } from './map/classify';
import { bboxOf } from './map/pip';
import { boundsOf } from './lib/geo-util';
import type { Pov, Bounds } from './lib/geo-util';
import { durationDays, distinctTripDays, fmtDuration, minIso, maxIso, isoDate, isoTime } from './lib/dates';
import { encodeShare, decodeShare, extractCode } from './lib/share';
import { STATUS_META, UNVISITED_COLOR, normalizeVisit } from './state/status';
import type { Status, StatusMap, Visit, VisitMap, Trip } from './state/status';
import { getUserVisits, putUserVisit, deleteUserVisit, clearUserVisits, putUserMany } from './state/db';
import { supabase, cloudEnabled } from './lib/supabase';
import type { Session } from '@supabase/supabase-js';
import { pullRemote, pushRemote, deleteRemote, deleteClearedRemote, deleteAllRemote } from './state/cloud';
import { loadPending, addTombstone, dropTombstone, markDirty, clearDirty, hasPending, markCleared, confirmCleared, applyTombstones } from './state/pending';
import type { AggMap } from './features/ImportPhotos';
import AuthScreen from './features/AuthScreen';
import PasswordDialog from './features/PasswordDialog';
import FlatMapView from './map/FlatMapView'; // light (no three.js): rendered directly so 2D mode never loads the globe chunk
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
const MARKER_KEY = 'travel-tracker:markers';
const COUNTIES_KEY = 'travel-tracker:counties2'; // v2: default ON now that counties are viewport-culled
const VIEW_KEY = 'travel-tracker:view';
const LOCAL_UID = 'local'; // the single owner of the marks in a build without Supabase keys
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
  const [lod, setLod] = useState<Lod>('110m');
  const [theme, setTheme] = useState<'dark' | 'day'>('dark');
  const [worldFeatures, setWorldFeatures] = useState<CountryFeature[]>([]);
  const [regions1, setRegions1] = useState<Record<string, CountryFeature[]>>({});
  const [regions2, setRegions2] = useState<Record<string, CountryFeature[]>>({});
  const [expanded, setExpanded] = useState<Record<string, 1 | 2>>({});
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [pov, setPov] = useState<Pov | null>(null);
  const [fit, setFit] = useState<Bounds | null>(null);
  const [query, setQuery] = useState('');
  const [meta, setMeta] = useState<Record<string, CountryMeta>>({});
  const [loading, setLoading] = useState(true);
  const [showImport, setShowImport] = useState(false);
  const [geoMsg, setGeoMsg] = useState<string | null>(null);
  const [bgOn, setBgOn] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [markerMode, setMarkerMode] = useState<MarkerMode>(() => {
    try { const v = localStorage.getItem(MARKER_KEY); if (v === 'off' || v === 'selected' || v === 'all') return v; } catch { /* ignore */ }
    return 'selected';
  });
  const [zoomAlt, setZoomAlt] = useState<number>(OVERVIEW.altitude);
  const [viewCenter, setViewCenter] = useState<{ lat: number; lng: number }>({ lat: 20, lng: 0 });
  const [countiesOn, setCountiesOn] = useState<boolean>(() => { try { return localStorage.getItem(COUNTIES_KEY) !== '0'; } catch { return true; } });
  const [viewMode, setViewMode] = useState<'globe' | 'flat'>(() => { try { return localStorage.getItem(VIEW_KEY) === 'flat' ? 'flat' : 'globe'; } catch { return 'globe'; } });
  const [citiesData, setCitiesData] = useState<CityMarker[]>([]);
  const [overlays, setOverlays] = useState<Overlay[]>([]);
  const [compareId, setCompareId] = useState<string | null>(null);
  const [shareMsg, setShareMsg] = useState<string | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [showAuth, setShowAuth] = useState(false);
  const [profileMsg, setProfileMsg] = useState<string | null>(null);
  const [syncState, setSyncState] = useState<'synced' | 'syncing' | 'offline' | 'error'>('synced');
  const [pwDialog, setPwDialog] = useState<'change' | 'recovery' | null>(null);
  const [guestToast, setGuestToast] = useState(false);
  const guestWarned = useRef(false);

  const admin0Cache = useRef<Map<Lod, CountryFeature[]>>(new Map());
  const bboxCache = useRef<Map<string, [number, number, number, number]>>(new Map());
  const lodTimer = useRef<number | null>(null);
  const loaded1 = useRef<Set<string>>(new Set());
  const loaded2 = useRef<Set<string>>(new Set());
  const fileRef = useRef<HTMLInputElement>(null);
  const userIdRef = useRef<string | null>(null);
  const syncedFor = useRef<string | null>(null);
  const visitsRef = useRef<VisitMap>({}); // latest marks, for retries fired outside React (the 'online' event)
  visitsRef.current = visits;

  const globeImage = import.meta.env.BASE_URL + TEX[theme];
  const isMobile = useMemo(() => typeof window !== 'undefined' && !!window.matchMedia?.('(max-width: 720px)').matches, []);
  const selectedA3 = selectedId ? selectedId.split('-')[0] : null;

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
    loadWorld('110m').finally(() => setLoading(false));
    // Visits are loaded per account on login, or for LOCAL_UID when there are no accounts;
    // guests start empty and save nothing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // City / capital markers. Remember the user's choice on this device (a view
  // preference, not travel data). Fetch the data only when it will actually be
  // shown — in 'selected' mode that's not until a country is picked.
  useEffect(() => { try { localStorage.setItem(MARKER_KEY, markerMode); } catch { /* ignore */ } }, [markerMode]);
  useEffect(() => {
    try { localStorage.setItem(COUNTIES_KEY, countiesOn ? '1' : '0'); } catch { /* ignore */ }
    if (!countiesOn) setExpanded((e) => { // drop any counties already on screen
      let ch = false; const n: Record<string, 1 | 2> = { ...e };
      for (const k in n) if (n[k] === 2) { n[k] = 1; ch = true; }
      return ch ? n : e;
    });
  }, [countiesOn]);

  // Every country the user has marked (any status); region ids -> parent country a3.
  const markedA3 = useMemo(() => new Set(Object.keys(visits).map((id) => id.split('-')[0])), [visits]);

  useEffect(() => {
    const need = markerMode === 'all' || (markerMode === 'selected' && (!!selectedA3 || markedA3.size > 0));
    if (need && !citiesData.length) loadCities().then(setCitiesData).catch(() => { /* offline / not built */ });
  }, [markerMode, selectedA3, markedA3.size, citiesData.length]);

  useEffect(() => { try { localStorage.setItem(VIEW_KEY, viewMode); } catch { /* ignore */ } }, [viewMode]);

  // Marker pool for the 2D map: same selection logic but NOT zoom-gated (the flat view
  // does its own zoom/declutter cheaply on canvas).
  const flatMarkerPool = useMemo(() => {
    if (markerMode === 'off' || !citiesData.length) return [];
    if (markerMode === 'selected') {
      if (!selectedA3 && markedA3.size === 0) return [];
      return citiesData.filter((m) => m.a3 === selectedA3 || markedA3.has(m.a3));
    }
    return citiesData;
  }, [markerMode, citiesData, selectedA3, markedA3]);

  const visibleMarkers = useMemo(() => {
    if (markerMode === 'off' || !citiesData.length) return [];
    if (markerMode === 'selected') {
      // The picked country PLUS every marked place, so your travels always show cities.
      if (!selectedA3 && markedA3.size === 0) return [];
      const sub = citiesData.filter((m) => m.a3 === selectedA3 || markedA3.has(m.a3));
      const cap = Math.min(260, Math.max(markerCap(zoomAlt, isMobile), markedA3.size + 12));
      return selectMarkers(sub, zoomAlt, cap);
    }
    return selectMarkers(citiesData, zoomAlt, markerCap(zoomAlt, isMobile));
  }, [markerMode, citiesData, selectedA3, markedA3, zoomAlt, isMobile]);

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
    supabase.auth.getSession()
      .then(({ data }) => setSession(data.session))
      .catch(() => setSession(null)) // e.g. a stored session whose refresh fails while the server is unreachable
      .finally(() => setAuthReady(true)); // never leave the app waiting on auth
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      setSession(s);
      if (event === 'PASSWORD_RECOVERY') setPwDialog('recovery'); // opened from a reset e-mail link
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // Show the optional welcome/auth screen on first run (only when cloud is set up).
  useEffect(() => {
    if (!authReady) return;
    if (session) { setShowAuth(false); return; }
    if (cloudEnabled && localStorage.getItem(WELCOME_KEY) !== '1') setShowAuth(true);
  }, [authReady, session]);

  // Send everything the cloud hasn't confirmed yet: a pending "clear all", pending deletes,
  // then ONLY the places changed on this device. Used after sign-in, after edits and when
  // the device comes back online, so work done offline is never silently lost, and a stale
  // device never overwrites another device's rows for places it didn't change.
  async function flushSync(uid: string, map: VisitMap) {
    if (!cloudEnabled) return;
    let p = loadPending(uid);
    if (!hasPending(p)) { setSyncState('synced'); return; }
    setSyncState('syncing');
    if (p.clearedAt && (await deleteClearedRemote(p.clearedAt))) confirmCleared(uid, p.clearedAt);
    for (const [id, at] of Object.entries(p.dels)) {
      if (await deleteRemote(id, at)) dropTombstone(uid, id);
    }
    const gone = p.dirty.filter((id) => !map[id]); // unmarked since: its tombstone covers it
    if (gone.length) clearDirty(uid, gone);
    const ids = p.dirty.filter((id) => map[id]);
    if (ids.length && (await pushRemote(uid, Object.fromEntries(ids.map((id) => [id, map[id]]))))) {
      // Only clear what is still the version we sent: a place re-edited mid-push stays dirty.
      clearDirty(uid, ids.filter((id) => visitsRef.current[id]?.updatedAt === map[id].updatedAt));
    }
    p = loadPending(uid);
    setSyncState(!hasPending(p) ? 'synced' : navigator.onLine === false ? 'offline' : 'error');
  }

  // On login: pull the user's cloud data, merge (last-write-wins), push the union.
  // Without Supabase keys there are no accounts, so marks are saved on the device under LOCAL_UID.
  useEffect(() => {
    const uid = session?.user?.id ?? (cloudEnabled ? null : LOCAL_UID);
    userIdRef.current = uid;
    if (!uid) { syncedFor.current = null; setVisits({}); return; } // guest / logged out = empty, nothing saved
    if (syncedFor.current === uid) return;
    syncedFor.current = uid;
    (async () => {
      const [local, remoteRaw] = await Promise.all([getUserVisits(uid), pullRemote()]);
      // Rows this device deleted while offline must not come back from the cloud; a newer
      // re-mark from another device wins and retires its tombstone.
      const { kept: remote, stale } = applyTombstones(remoteRaw, loadPending(uid));
      for (const id of stale) dropTombstone(uid, id);
      const merged: VisitMap = { ...local };
      for (const [id, rv] of Object.entries(remote)) {
        const cur = merged[id];
        if (!cur || isoTime(rv.updatedAt) > isoTime(cur.updatedAt)) merged[id] = rv;
      }
      // Push only local rows the cloud lacks or holds an older version of (e.g. edited here
      // offline); rows the cloud already has at least as new are left alone.
      if (cloudEnabled) {
        markDirty(uid, Object.entries(local)
          .filter(([id, lv]) => !remote[id] || isoTime(lv.updatedAt) > isoTime(remote[id].updatedAt))
          .map(([id]) => id));
      }
      setVisits(merged);
      void putUserMany(uid, merged);
      void flushSync(uid, merged);
    })();
  }, [session]);

  // Mirror local changes to the cloud (debounced) while logged in.
  useEffect(() => {
    const uid = userIdRef.current;
    if (!uid) return;
    if (cloudEnabled && hasPending(loadPending(uid))) setSyncState('syncing');
    const t = window.setTimeout(() => void flushSync(uid, visits), 800);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visits]);

  // The guest warning toast hides itself after a few seconds.
  useEffect(() => {
    if (!guestToast) return;
    const t = window.setTimeout(() => setGuestToast(false), 8000);
    return () => window.clearTimeout(t);
  }, [guestToast]);

  // Back online: retry whatever failed while offline.
  useEffect(() => {
    const onOnline = () => { const uid = userIdRef.current; if (uid) void flushSync(uid, visitsRef.current); };
    window.addEventListener('online', onOnline);
    return () => window.removeEventListener('online', onOnline);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Seamless LOD: swap admin-0 detail, then resolve the viewed country into
  // Admin-1 (zoom in) or Admin-2 (zoom in further); only a few kept expanded.
  function onZoom(p: Pov) {
    if (lodTimer.current) window.clearTimeout(lodTimer.current);
    lodTimer.current = window.setTimeout(async () => {
      // Drives city-marker density + size. Hysteresis: ignore <6% zoom changes so we
      // don't rebuild every label's (expensive) text geometry on tiny nudges.
      setZoomAlt((prev) => (Math.abs(p.altitude - prev) / Math.max(prev, 0.001) > 0.06 ? p.altitude : prev));
      // Track view centre (for county viewport-culling); ignore <1 degree drift.
      setViewCenter((prev) => (Math.abs(prev.lat - p.lat) + Math.abs(prev.lng - p.lng) > 1 ? { lat: p.lat, lng: p.lng } : prev));
      // 3-tier LOD: light 110m at world view, sharper 50m mid-zoom, 10m up close.
      // Phones skip the heavy 10m base world (~2x the vertices) = fewer triangles/frame;
      // the focused country still gets sharp Admin-1/2 detail on top.
      const wantLod: Lod = !isMobile && p.altitude < 0.55 ? '10m' : p.altitude < 1.4 ? '50m' : '110m';
      setLod((cur) => { if (cur !== wantLod) void loadWorld(wantLod); return wantLod; });

      // Admin-2 (counties) is opt-in: building thousands of county polygons is the one
      // heavy transition, so normal zoom stops at Admin-1 unless the user turns it on.
      const wantLevel = countiesOn && p.altitude < A2_ALT ? 2 : p.altitude < EXPAND_ALT ? 1 : 0;
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
    // NOTE: no view deps here -> identity is stable while dragging = no polygon rebuild.
  }, [worldFeatures, expanded, regions1, regions2]);

  // Only a huge expanded county set is worth viewport-culling. When it is, `renderFeatures`
  // tracks the view (rebuilds on pan, but a small on-screen subset); otherwise it IS
  // displayFeatures (same reference), so ordinary dragging never rebuilds geometry.
  const cullActive = useMemo(
    () => Object.entries(expanded).some(([a3, lvl]) => lvl === 2 && (regions2[a3]?.length ?? 0) > 400),
    [expanded, regions2],
  );
  const renderFeatures = useMemo(() => {
    if (!cullActive) return displayFeatures;
    const hLat = Math.min(zoomAlt * 32 + 1.5, 90);
    const hLng = hLat / Math.max(0.2, Math.cos((viewCenter.lat * Math.PI) / 180));
    return displayFeatures.filter((f) => {
      if (!f.id.includes('-2-')) return true; // cull only admin-2 (county) polygons
      let bb = bboxCache.current.get(f.id);
      if (!bb) { bb = bboxOf(f.geometry); bboxCache.current.set(f.id, bb); }
      return !(bb[2] < viewCenter.lng - hLng || bb[0] > viewCenter.lng + hLng || bb[3] < viewCenter.lat - hLat || bb[1] > viewCenter.lat + hLat);
    });
  }, [displayFeatures, cullActive, zoomAlt, viewCenter]);

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
    setMenuOpen(false); // close the mobile drawer so the globe is visible
    const f = featureById(id);
    if (f) setFit(boundsOf(f.geometry)); // fly + fit the area to the viewport
  }

  const dtv = (s?: string) => (s ? (s.includes('T') ? s : `${s}T00:00`) : '');

  // Persist helpers: write locally (scoped to the signed-in user) and let the
  // debounced effect push to the cloud. Guests (no uid) save nothing.
  // A changed place is marked dirty (pushed on the next sync); that also retires any
  // pending delete for it, since re-marking makes it alive again.
  function pLocal(id: string, v: Visit) {
    const u = userIdRef.current; if (!u) return;
    void putUserVisit(u, id, v);
    if (cloudEnabled) markDirty(u, [id]);
  }
  function pDelete(id: string) {
    const u = userIdRef.current; if (!u) return;
    void deleteUserVisit(u, id);
    if (!cloudEnabled) return;
    const at = new Date().toISOString();
    addTombstone(u, id, at); // recorded BEFORE the request: an offline delete is retried, never lost
    void deleteRemote(id, at).then((done) => { if (done) dropTombstone(u, id); });
  }
  function pMany(map: VisitMap) {
    const u = userIdRef.current; if (!u) return;
    void putUserMany(u, map);
    if (cloudEnabled) markDirty(u, Object.keys(map));
  }

  // On the synced site a signed-out visitor's marks live only in memory. Say so once, at
  // their first mark, on the map itself (on a phone the sidebar notice sits in a drawer).
  function warnGuestOnce() {
    if (!cloudEnabled || userIdRef.current || guestWarned.current) return;
    guestWarned.current = true;
    setGuestToast(true);
  }

  function setStatus(id: string, status: Status | null) {
    if (status === null) {
      setVisits((prev) => { const c = { ...prev }; delete c[id]; return c; });
      pDelete(id);
      return;
    }
    warnGuestOnce();
    setVisits((prev) => {
      const next: Visit = { status, trips: prev[id]?.trips ?? [], updatedAt: new Date().toISOString() };
      pLocal(id, next);
      return { ...prev, [id]: next };
    });
  }
  function mutateTrips(id: string, fn: (t: Trip[]) => Trip[]) {
    setVisits((prev) => {
      const cur = prev[id];
      const next: Visit = { status: cur?.status ?? 'visited', trips: fn(cur?.trips ?? []), updatedAt: new Date().toISOString() };
      pLocal(id, next);
      return { ...prev, [id]: next };
    });
  }
  const addTrip = (id: string) => mutateTrips(id, (t) => [...t, {}]);
  const updateTrip = (id: string, i: number, patch: Partial<Trip>) => mutateTrips(id, (t) => t.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  const removeTrip = (id: string, i: number) => mutateTrips(id, (t) => t.filter((_, j) => j !== i));

  function resetView() { setSelectedId(null); setFit(null); setPov({ ...OVERVIEW }); }
  function clearAll() {
    if (window.confirm('Clear all marks? This cannot be undone.')) {
      setVisits({});
      const u = userIdRef.current;
      if (u) {
        void clearUserVisits(u);
        if (cloudEnabled) {
          const at = new Date().toISOString();
          markCleared(u, at); // kept until the server confirms, so a clear made offline still happens
          void deleteClearedRemote(at).then((done) => { if (done) confirmCleared(u, at); });
        }
      }
    }
  }

  async function logout() {
    if (!supabase) return;
    await supabase.auth.signOut();
    syncedFor.current = null;
    setProfileMsg(null);
  }
  function changePassword() {
    setProfileMsg(null);
    setPwDialog('change');
  }
  function skipWelcome() {
    setShowAuth(false);
    try { localStorage.setItem(WELCOME_KEY, '1'); } catch { /* ignore */ }
  }
  async function deleteAccount() {
    if (!supabase) return;
    if (!window.confirm('Delete your account data and sign out? Your marks are removed from the cloud. This cannot be undone.')) return;
    const u = userIdRef.current;
    if (!(await deleteAllRemote())) {
      // Don't wipe this device or sign out on a failed delete: that would claim success falsely.
      setProfileMsg('Could not reach the sync server, so nothing was deleted. Try again when you are online.');
      return;
    }
    if (u) void clearUserVisits(u);
    setVisits({});
    await supabase.auth.signOut();
    syncedFor.current = null;
    setProfileMsg('Account data deleted and signed out.');
  }

  function applyImport(agg: AggMap) {
    warnGuestOnce();
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
      pMany(changed);
      return copy;
    });
  }

  const markCoords = useCallback(async (lat: number, lng: number) => {
    await initCountryIndex();
    const c = classifyCountry(lng, lat);
    if (!c) return null;
    const today = isoDate(new Date());
    const r = await classifyRegion(c.id, lng, lat);
    warnGuestOnce();
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
      pMany(changed);
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
        warnGuestOnce();
        setVisits((prev) => {
          const merged: VisitMap = { ...prev };
          const changed: VisitMap = {};
          for (const [id, raw] of Object.entries(incoming)) {
            const v = normalizeVisit(raw);
            if (!v) continue;
            const cur = merged[id];
            if (!cur || isoTime(v.updatedAt) > isoTime(cur.updatedAt)) { merged[id] = v; changed[id] = v; }
          }
          pMany(changed);
          return merged;
        });
      } catch { window.alert('Could not read that file — expected a Scratch Globe export.'); }
    };
    reader.readAsText(file);
  }

  const stats = useMemo(() => {
    const been = new Set<string>();
    let regionsMarked = 0;
    const counts: Record<Status, number> = { visited: 0, want: 0, lived: 0, transit: 0 };
    for (const [id, v] of Object.entries(visits)) {
      counts[v.status]++;
      if (id.includes('-')) regionsMarked++;
      if (v.status === 'visited' || v.status === 'lived') been.add(id.includes('-') ? id.split('-')[0] : id);
    }
    // Distinct days, not a sum: a country and its region marked for one visit is one day.
    const totalDays = distinctTripDays(Object.values(visits).flatMap((v) => v.trips));
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
      <button className="menu-btn" onClick={() => setMenuOpen((o) => !o)} aria-label="Menu">☰</button>
      {menuOpen && <div className="menu-backdrop" onClick={() => setMenuOpen(false)} />}
      <aside className={menuOpen ? 'sidebar open' : 'sidebar'}>
        <div className="sidebar-head">
          <h1>Scratch Globe</h1>
          <button className="menu-close" onClick={() => setMenuOpen(false)} aria-label="Close menu">×</button>
        </div>

        <div className="stat">
          <div className="stat-big">{pct}%</div>
          <div className="stat-label">
            {stats.countriesBeen} of {COUNTRY_TARGET} countries
            {stats.regionsMarked ? ` · ${stats.regionsMarked} regions` : ''}
            {stats.totalDays ? ` · ${stats.totalDays} days` : ''}
          </div>
        </div>

        <div className="search">
          <input
            placeholder="Search country…"
            aria-label="Search country"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && matches.length) { pick(matches[0].id); setQuery(''); }
              else if (e.key === 'Escape') setQuery('');
            }}
          />
          {matches.length > 0 && (
            <ul className="search-list" aria-label="Matching countries">
              {matches.map((f) => (
                <li key={f.id}>
                  <button type="button" className="search-hit" onClick={() => { pick(f.id); setQuery(''); }}>{featureName(f)}</button>
                </li>
              ))}
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
                <button key={s} className={selVisit?.status === s ? 'st on' : 'st'} aria-pressed={selVisit?.status === s} style={{ '--c': STATUS_META[s].color } as CSSProperties} onClick={() => setStatus(selectedId!, s)}>{STATUS_META[s].label}</button>
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
                <div className={`sync-line sync-${syncState}`} role="status" aria-live="polite">
                  {syncState === 'synced' ? 'Synced'
                    : syncState === 'syncing' ? 'Saving…'
                    : syncState === 'offline' ? 'Offline: saved on this device, syncs when you are back online'
                    : 'Not synced yet: saved on this device, will retry'}
                </div>
                <button className="io" onClick={changePassword}>Change password</button>
                <button className="io danger" onClick={deleteAccount}>Delete account</button>
              </>
            ) : (
              <>
                {authReady && <div className="guest-note">Not signed in: marks are not saved when you close the app.</div>}
                <button className="io" onClick={() => setShowAuth(true)}>Sign in / Sign up</button>
              </>
            )}
            {profileMsg && <div className="stat-label">{profileMsg}</div>}
          </div>
        )}

        <div className="people">
          <div className="people-head"><span>People</span><button className="io" onClick={shareMine}>Share my map</button></div>
          <ul className="people-list">
            <li className={compareId ? '' : 'on'}>
              <button type="button" className="pname" aria-pressed={!compareId} onClick={() => setCompareId(null)}>
                <span className="swatch" style={{ background: STATUS_META.visited.color }} />Me
              </button>
            </li>
            {overlays.map((o) => (
              <li key={o.id} className={compareId === o.id ? 'on' : ''}>
                <button type="button" className="pname" aria-pressed={compareId === o.id} onClick={() => setCompareId(compareId === o.id ? null : o.id)}>
                  <span className="swatch" style={{ background: o.color }} />{o.name}
                </button>
                <button className="x" onClick={() => removeOverlay(o.id)} aria-label={`Remove ${o.name}`}>×</button>
              </li>
            ))}
          </ul>
          <button className="io" onClick={addOverlayPrompt}>Add person from link</button>
          {compareOverlay && <div className="stat-label">Comparing: <b style={{ color: STATUS_META.visited.color }}>you</b> · <b style={{ color: compareOverlay.color }}>{compareOverlay.name}</b> · <b style={{ color: BOTH_COLOR }}>both</b></div>}
          {shareMsg && <div className="stat-label">{shareMsg}</div>}
        </div>

        <div className="tools">
          <div className="section-label">Tools</div>
          <div className="actions">
          <button className="drill" onClick={() => setShowImport(true)}>Import photos</button>
          <button className="io" onClick={markLocation}>Mark my location</button>
          <button className={bgOn ? 'io bg-on' : 'io'} onClick={toggleBg}>Background GPS: {bgOn ? 'On' : 'Off'}</button>
          {geoMsg && <div className="stat-label geo-msg">{geoMsg}</div>}
          <div className="io-row">
            <button className="io" onClick={() => setViewMode((v) => (v === 'globe' ? 'flat' : 'globe'))}>View: {viewMode === 'globe' ? '3D globe' : '2D map'}</button>
            <button className="io" onClick={resetView}>Reset view</button>
          </div>
          {viewMode === 'globe' && (
            <button className="io" onClick={() => setTheme((t) => (t === 'dark' ? 'day' : 'dark'))}>{theme === 'dark' ? 'Day globe' : 'Night globe'}</button>
          )}
          <div className="io-row">
            <button className="io" onClick={() => setMarkerMode((m) => (m === 'off' ? 'selected' : m === 'selected' ? 'all' : 'off'))}>
              Cities: {markerMode === 'off' ? 'Off' : markerMode === 'selected' ? 'Marked + picked' : 'Everywhere'}
            </button>
            <button className={countiesOn ? 'io bg-on' : 'io'} onClick={() => setCountiesOn((v) => !v)}>
              Counties: {countiesOn ? 'On' : 'Off'}
            </button>
          </div>
          <div className="io-row">
            <button className="io" onClick={exportJson}>Export JSON</button>
            <button className="io" onClick={() => fileRef.current?.click()}>Import JSON</button>
          </div>
          <button className="reset" onClick={clearAll}>Clear all marks</button>
          <input ref={fileRef} type="file" accept="application/json" hidden onChange={onImportFile} />
          </div>
        </div>
        <footer>{loading ? 'Loading globe…' : `${lod} · ${renderFeatures.length} shapes · zoom for regions`}</footer>
        <div className="credit">Boundaries: Natural Earth (public domain) · geoBoundaries (CC BY 4.0)</div>
      </aside>

      <main className="map-wrap">
        {guestToast && (
          <div className="guest-toast" role="status">
            <span>Not signed in: this mark will not be kept.</span>
            <button className="io" onClick={() => { setGuestToast(false); setShowAuth(true); }}>Sign in</button>
            <button className="mb-x" onClick={() => setGuestToast(false)} aria-label="Dismiss">×</button>
          </div>
        )}
        {bannerName && (
          <div className="map-banner">
            <span className="mb-name">{bannerName}</span>
            {selectedFeature && selVisit && <span className="mb-pill" style={{ background: STATUS_META[selVisit.status].color }}>{STATUS_META[selVisit.status].label}</span>}
            {selectedFeature && <button className="mb-x" onClick={() => setSelectedId(null)} aria-label="Close">×</button>}
          </div>
        )}
        {viewMode === 'globe' ? (
          <Suspense fallback={<div className="globe-loading">Loading globe…</div>}>
            <GlobeView polygons={renderFeatures} statuses={statuses} selectedId={selectedId} globeImage={globeImage} onPick={pick} onDeselect={() => setSelectedId(null)} onHover={setHoveredId} onZoom={onZoom} pov={pov} colorOverride={colorOverride} markers={visibleMarkers} onMarkerPick={pick} fit={fit} viewAltitude={zoomAlt} emphasizeA3={selectedA3} />
          </Suspense>
        ) : (
          <FlatMapView polygons={renderFeatures} statuses={statuses} selectedId={selectedId} onPick={pick} onDeselect={() => setSelectedId(null)} colorOverride={colorOverride} markers={flatMarkerPool} onView={onZoom} />
        )}
      </main>

      {showImport && (
        <Suspense fallback={null}>
          <ImportPhotos onClose={() => setShowImport(false)} onApply={applyImport} />
        </Suspense>
      )}

      {showAuth && !session && cloudEnabled && <AuthScreen onSkip={skipWelcome} />}
      {pwDialog && <PasswordDialog mode={pwDialog} onClose={(m) => { setPwDialog(null); if (m) setProfileMsg(m); }} />}
    </div>
  );
}
