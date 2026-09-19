# Travel Tracker Application: Refined $0 Open-Source Blueprint (v3.1)

> Revision of `travel_tracker_app_research_architecture_guide.md`. Goal: a private, open-source "scratch map" travel tracker at zero recurring cost. This revision reflects the locked decisions: React + TypeScript web-first, a 3D WebGL globe (globe.gl / three.js) as the primary view, and a validated $0 multi-user path.

---

## Revision log

*Append-only. The body below is the single current plan.*

**v3.1 (2026-09-19) — framework + render locked, OSM evaluated**
- **Framework locked: React + Vite + TypeScript** (not Flutter). Flutter/Dart were not installed and the owner's strong stack is JS/Next.js; React reuses the toolchain and skills, and the point-in-polygon engine is already JavaScript. Android later via Capacitor; desktop as an installable PWA.
- **Render locked: a 3D WebGL globe** (globe.gl on three.js) — the owner wants a Google-Earth-style rotatable globe, not a flat map. Country polygons are colored by visit status and rise slightly when marked. A 2D equirectangular canvas remains as an optional alternate view.
- **OpenStreetMap evaluated and not adopted** for the globe (see §6). OSM tiles are a 2D Mercator basemap; only MapLibre-globe or Cesium can drape them on a sphere, and a country-level scratch map does not need street tiles. Natural Earth polygons already beat OSM raw boundaries here.
- **Milestone 1 complete** (geo pipeline + PIP engine + React globe shell).

**v3 (2026-09-19) — decisions locked + multi-user investigated**
- Platforms: Android + Web + Windows/desktop. iOS deferred.
- Ingestion: 3-tier opt-in (manual baseline, optional EXIF, optional background GPS).
- $0 multi-user confirmed feasible at hobby/community scale (§10).

**v2 — corrections vs the original research guide**
- "$0 lifetime" -> "$0 recurring"; single-codebase feature parity corrected; background GPS demoted; Android EXIF needs `ACCESS_MEDIA_LOCATION`; Natural Earth `iso_a3` is `-99` for France/Norway (use `ADM0_A3`); geometry bundled as assets; PIP hand-rolled; competitor prices flagged unverified.

---

## 1. Executive Summary

A private, open-source scratch-map travel tracker with:

- **Core visualization:** a rotatable 3D WebGL globe; countries are colored by visit status (visited / want / lived / transit) and pop up when marked.
- **Data layer:** manual entry baseline, plus optional automated photo-EXIF import and optional background-GPS geofencing.
- **Cost:** genuinely $0 recurring on all shipped targets (Web, Android, desktop). Optional multi-user cloud sync also stays $0 within free-tier ceilings (§10).
- **Targets:** one React + TypeScript codebase — web now, Android via Capacitor, desktop as an installable PWA. iOS deferred.

---

## 2. Scope Decisions (LOCKED)

| # | Decision | Locked choice | Rationale |
| :-- | :-- | :-- | :-- |
| D1 | Framework | **React + Vite + TypeScript** | Installed toolchain + owner's stack; PIP already JS |
| D2 | Render | **3D WebGL globe (globe.gl / three.js)** | Owner wants a Google-Earth-style globe |
| D3 | Platforms | **Web + Android (Capacitor) + desktop PWA** (iOS deferred) | Every target is $0 |
| D4 | Ingestion | **Manual baseline + optional EXIF + optional background GPS** | Progressive permission model |
| D5 | Data granularity | **Admin-0 world + on-demand Admin-1** | Full Admin-1 bundled is >150 MB |
| D6 | Sharing | **Local-only default; optional $0 cloud sync/share** | Ship single-user first (§10) |

---

## 3. Platform Capability Matrix

| Capability | Web | Android (Capacitor) | Windows / desktop |
| :-- | :--: | :--: | :--: |
| 3D globe render + manual edit | Yes | Yes | Yes (PWA) |
| Local persistence | IndexedDB | SQLite | IndexedDB (PWA) |
| EXIF import | Photo upload / drag-drop* | Library scan** | Folder scan / upload |
| Background GPS geofence | No | Optional*** | No |
| $0 install / distribution | Free static host | APK sideload | Installable PWA |

\* Web parses EXIF client-side (File API + a JS EXIF reader); nothing is uploaded.
\** Android needs `ACCESS_MEDIA_LOCATION` (via a Capacitor plugin) or GPS is redacted.
\*** Android background location needs `ACCESS_BACKGROUND_LOCATION`; use a DIY significant-change approach to avoid a paid plugin (§8).

> iOS deferred. Same React/Capacitor codebase, so it is an add-on later (free 7-day resign or $99/yr).

---

## 4. Market Analysis (condensed)

Three archetypes: **polygon scratch maps** (Been, Visited, Mark O'Travel — our target), **timeline/route planners** (Polarsteps, Wanderlog), **fog-of-war mappers** (Fog of World). No commercial standalone scratch map is 100% free without locking sub-regions, multi-status categories, or export. Client-side, zero-telemetry processing is our privacy differentiator. (Competitor prices from the original research are unverified — confirm before public use.)

---

## 5. Technology Stack

**Framework: React + Vite + TypeScript.** Reuses the owner's existing web toolchain (Node already installed) and skills; the validated point-in-polygon engine is already JavaScript and drops straight in.

```text
+---------------------------------------------------------------------------+
|                        CLIENT (React + Vite + TS)                         |
|                                                                           |
|  Targets:  Web (now) | Android (Capacitor) | Desktop (installable PWA)     |
|                                                                           |
|  Render:                                                                  |
|   • Primary: 3D WebGL globe — globe.gl on three.js                        |
|       dark Earth texture + country polygons colored by status,            |
|       altitude pop when marked, atmosphere glow, orbit controls           |
|   • Alternate: 2D equirectangular <canvas> (kept, not default)            |
|   • Lazy-split so the shell paints instantly while three.js streams       |
|                                                                           |
|  Spatial (for ingestion): hand-rolled ray-cast PIP + bbox prefilter       |
|       (classifies EXIF/GPS lat-lng -> country; globe clicks use the lib)  |
|                                                                           |
|  State: React hooks (upgrade to a store if needed)                        |
|  Persistence (user data only): localStorage now -> IndexedDB / wa-sqlite  |
|  Geometry: bundled versioned TopoJSON assets loaded to memory            |
+---------------------------------------------------------------------------+
                                    |
                                    v
+---------------------------------------------------------------------------+
|                              DATA / DISTRIBUTION                           |
|  Vector assets: Natural Earth (public domain), pre-simplified, in-repo     |
|  Hosting (web): Cloudflare Pages / GitHub Pages ($0)                       |
|  Sync (optional): §10 — local + JSON default; $0 cloud path available      |
+---------------------------------------------------------------------------+
```

**Bundle note:** three.js makes the globe chunk ~550 KB gzipped. It is code-split (React.lazy) so the ~72 KB shell renders immediately and the globe streams in behind a loader.

**Desktop:** the web build installs as a PWA on Windows/macOS/Linux; EXIF there comes from a picked folder or file upload.

---

## 6. Rendering & Spatial Engine

### Primary view — 3D globe (globe.gl / three.js)

- A dark Earth texture (93 KB, bundled, offline, no API key) on a sphere with a blue atmosphere.
- Country polygons from Natural Earth are fed to `polygonsData`; `polygonCapColor` maps each to its status color (or muted slate when unvisited), and `polygonAltitude` raises marked countries for a 3D pop.
- Interaction: drag to rotate, scroll to zoom, hover for a label, click to cycle status. Hit-testing is handled by the library, so tap detection needs no manual math.
- Gentle auto-rotate until the first interaction.

### Alternate view — 2D equirectangular canvas (kept)

- Linear, invertible projection (`x=(lon+180)/360·W`, `y=(90−lat)/180·H`) with pan/zoom and tap→lon/lat→PIP. Retained as a lightweight flat option; not the default.

### Point-in-polygon (now for ingestion)

- The validated ray-caster (bbox prefilter, MultiPolygon, holes, antimeridian) classifies EXIF/GPS coordinates to a country. It is no longer needed for globe clicks but is essential for automated ingestion. Reference + tests: `tools/geo-pipeline/validate.mjs` (10/10 per layer); app copy: `src/map/pip.ts`.
- Known limits: the 110m layer cannot resolve tiny enclaves; coastal points can fall in water after simplification — classify ingestion points against a finer layer or add a nearest-border tolerance fallback.

### Does OpenStreetMap help? (investigated)

Short answer: **not for this globe.** Detail:

- **OSM tiles are a 2D Web-Mercator basemap** (streets, labels). globe.gl/three consume a single full-globe texture, not slippy tiles, so OSM tiles do not plug in. Only **MapLibre GL** (globe projection) or **CesiumJS** can drape map tiles on a sphere.
- **A country-level scratch map does not need street tiles.** The value of OSM (streets, POIs) is wasted at country granularity.
- **OSM raw boundaries are redundant here.** Natural Earth is already public-domain, cleaner, and generalized for exactly this use; OSM boundaries are heavier and need processing.
- **Tile-usage asterisk:** OSM's public tile servers forbid heavy/bulk use; a real app would need a provider (MapTiler free tier needs an API key) or self-hosting — friction against "$0, no account."

**When OSM would help:** only if the product later wants a literal "Google-Maps-with-streets, draped on a 3D globe" look. Then switch the base to **MapLibre GL with globe projection**, use OSM (or MapTiler) tiles as the basemap, and add a country **fill layer** with feature-state coloring and click handlers for the scratch mechanic. That is the documented alternative, carrying the tile-provider asterisk. For now, the globe.gl vector globe is fully $0, offline, and key-free.

---

## 7. Vector Data Sourcing & Optimization

Raw global Admin-1 GeoJSON is >150 MB, so pre-process offline and bundle the result.

- **Sources (public domain):** `ne_110m_admin_0_countries` (overview), `ne_50m_admin_0_countries` (detail), `ne_10m_admin_1_states_provinces` (Admin-1, on demand).
- **Pipeline (`tools/geo-pipeline`, Node + Mapshaper):** simplify (Visvalingam-Whyatt) -> TopoJSON (70–80% smaller) -> split Admin-1 per country. IDs use `ADM0_A3` (never `iso_a3`); Admin-1 `iso_3166_2` fallback `adm1_code`.
- Result today: `world_110m.topojson` ~49 KB, `world_50m.topojson` ~137 KB, bundled in `assets/geo` and served from `public/geo`.

---

## 8. Automated Ingestion — Tiered Opt-In Model

Permissions are requested only when a tier is enabled, never on first launch.

- **Tier 0 — Manual (baseline).** Tap a country to cycle status; set dates/note. All platforms, no permissions.
- **Tier 1 — EXIF import (recommended opt-in).** Web: user selects/drag-drops photos, parsed client-side (File API + a JS EXIF reader), zero upload. Android (Capacitor): media-library scan with `ACCESS_MEDIA_LOCATION`. Desktop: picked folder / file upload. Pipeline: read lat/lng + `DateTimeOriginal` -> PIP -> upsert visit + store the raw point as evidence -> dedup per region per day. Privacy is the selling point: all on-device.
- **Tier 2 — Background GPS (optional, experimental, Android).** DIY significant-change (Capacitor geolocation + `ACCESS_BACKGROUND_LOCATION`) to avoid a paid plugin; fix once on wake, PIP, store, release. Label experimental.

Recommendation: ship Tiers 0 and 1; treat Tier 2 as a stretch.

---

## 9. Data Model (local-first)

Geometry lives in bundled assets; the database holds **user data only** — tiny, and cheap to sync or share.

- **regions** (from bundled geo): `id` (ADM0_A3 / ISO 3166-2), `parent_id`, `name`, `admin_level`, `continent`, `iso_a2`.
- **visit_records:** `id` (uuid), `region_id`, `status` (visited|want|lived|transit), `start_date`, `end_date`, `source` (manual|exif|gps), `note`, `created_at`, `updated_at` (LWW merge key).
- **evidence:** raw geotagged points (`lat`, `lng`, `taken_at`, `source`, `asset_ref`) to re-derive visits.
- **app_meta:** `schema_version`, `geo_data_version`.

Now = `localStorage` (`travel-tracker:statuses:v1`); next = IndexedDB (via `idb`) or `wa-sqlite`. Export/import = one JSON file; import merges by `id` with last-write-wins.

---

## 10. Sharing & Multi-User at $0 (investigated)

**Feasible at hobby-to-community scale**, because the heavy work (geometry, render, PIP, EXIF) is client-side and the map geometry ships in the app, so a backend only moves each user's tiny text payload.

- **Free-tier options:** Supabase (Postgres 500 MB, 5 GB egress/mo, 50k MAU, auth + RLS + realtime; free projects pause after ~1 week idle), Firebase (Firestore ~50k reads/day), Cloudflare (Workers 100k req/day, D1 ~5 GB, **R2 zero egress fees**), Turso, Neon.
- **Recommended:** Supabase (easiest) or Cloudflare (best economics, commercial-OK). Media on R2 (no egress fees).
- **Sharing, cheapest first:** private per-user sync -> public read-only snapshot links (no live backend load) -> social feeds (defer; burns quotas first).
- **Three asterisks:** "$0" means within free-tier ceilings; egress is the first wall (mitigated by tiny payloads + R2); some free hosts ban commercial use (Vercel Hobby) — use Cloudflare if monetizing.

---

## 11. Roadmap

- **Milestone 1 — DONE.** Geo pipeline (NE -> TopoJSON), PIP engine (10/10 per layer), React + 3D globe shell (rotate/zoom/tap-to-cycle, live stats, localStorage).
- **Milestone 2 — Data model & manual UI.** Region inspector (status/dates/duration/note), stats dashboard, JSON export/import, IndexedDB persistence.
- **Milestone 3 — EXIF import (Tier 1).** Web upload + client-side parse first; Android via Capacitor later.
- **Milestone 4 — Packaging.** Web to Cloudflare Pages; Android via Capacitor (needs Android SDK); desktop PWA.
- **Optional M5** background GPS; **Optional M6** $0 cloud sync + public share links.

---

## 12. Risk Register

| Risk | Likelihood | Impact | Mitigation |
| :-- | :-- | :-- | :-- |
| three.js bundle weight (~550 KB gz) | Certain | Low | Code-split (done); shell 72 KB gz |
| Background GPS unreliable / plugin cost | High | Medium | Optional Tier 2; DIY significant-change |
| Android GPS redacted from EXIF | Medium | High | `ACCESS_MEDIA_LOCATION` |
| NE code fields wrong (`iso_a3=-99`) | High | Medium | Use `ADM0_A3` / `iso_3166_2` |
| Coastal/enclave PIP misses after simplify | Medium | Medium | Finer layer + nearest-border fallback |
| Multi-user egress/quota overrun | Low (hobby) | Medium | Tiny payloads + R2; gate social |

---

## 13. References

1. **Natural Earth** — public-domain vector data. naturalearthdata.com (via `nvkelso/natural-earth-vector`).
2. **globe.gl / three-globe / three.js** — WebGL globe with polygon layers. github.com/vasturiano/globe.gl
3. **MapLibre GL JS** — open-source map renderer with a **globe projection** (the OSM-on-globe alternative). maplibre.org
4. **Mapshaper** — simplification (Visvalingam-Whyatt) + TopoJSON. mapshaper.org
5. **Shimrat (1962)**, **Visvalingam & Whyatt (1993)**, **Bostock (TopoJSON spec)** — PIP + generalization + topology.
6. **Supabase / Cloudflare / Firebase / Turso / Neon** — free-tier BaaS/edge (§10).
