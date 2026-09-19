# Travel Tracker Application: Refined $0 Open-Source Blueprint (v3)

> Revision of `travel_tracker_app_research_architecture_guide.md`. Goal: a private, open-source polygon "scratch map" travel tracker at zero recurring cost — technical claims corrected, platform trade-offs made honest, hard parts de-risked, and now with a validated $0 multi-user path.

---

## Revision log

*Append-only. The body below is the single current plan.*

**v3 (2026-09-19) — decisions locked + multi-user investigated**
- **Platforms locked: Android + Web + Windows/desktop. iOS deferred** (removes all Apple signing friction and the $99/yr line — the build is now cleanly $0 on every shipped target).
- **Ingestion locked as a 3-tier opt-in model:** manual is the always-on baseline; EXIF import and background GPS are optional features the user enables (§8).
- **New §10: "$0 multi-user / shareable" investigated and confirmed feasible** at hobby/community scale, because this app's heavy work is client-side and its per-user server data is tiny.

**v2 — corrections vs the original research guide**
1. "$0 lifetime" → "$0 recurring cloud cost."
2. "Single codebase = feature parity" corrected — photo scan and background GPS are mobile/desktop-only, never web-automatic.
3. Background GPS demoted to optional; EXIF is the primary auto-fill.
4. Android EXIF requires `ACCESS_MEDIA_LOCATION` (scoped storage strips GPS otherwise).
5. Natural Earth `iso_a3` is `-99` for France/Norway/others — use `ADM0_A3` / `iso_3166_2`.
6. Equirectangular projection pinned for invertible tap → point-in-polygon.
7. Geometry bundled as versioned assets; DB holds user data only.
8. Ray-casting PIP hand-rolled with bbox prefilter (turf_dart = reference only).
9. Competitor prices flagged unverified.

---

## 1. Executive Summary

A private, open-source, high-level polygon scratch map (Admin-0 countries and Admin-1 states/provinces) with:

- **Core visualization:** interactive vector polygon rendering with multi-state fills (visited / want / lived / transit).
- **Data layer:** manual entry as the baseline, plus optional automated photo-EXIF import and optional background-GPS geofencing.
- **Cost:** genuinely $0 recurring on all shipped targets (Android, Web, Desktop) — no Apple fee, no server bill in single-user mode. An optional multi-user cloud sync also stays $0 within free-tier ceilings (§10).
- **Targets:** Android, Web, and Windows/macOS/Linux desktop from one Flutter codebase. iOS deferred.

---

## 2. Scope Decisions (LOCKED)

| # | Decision | Locked choice | Rationale |
| :-- | :-- | :-- | :-- |
| D1 | Platforms | **Android + Web + Windows/desktop** (iOS deferred) | Every target is $0; no Apple signing tax |
| D2 | Ingestion | **Manual baseline + optional EXIF + optional background GPS** | Progressive; users opt into permissions |
| D3 | Data granularity | **Admin-0 world + on-demand Admin-1** | Full Admin-1 bundled is >150 MB; lazy-load |
| D4 | Sharing | **Local-only default; optional $0 cloud sync/share** | Ship single-user first; multi-user is proven-feasible (§10) |

---

## 3. Platform Capability Matrix

| Capability | Android | Web | Windows / desktop |
| :-- | :--: | :--: | :--: |
| Polygon map render + manual edit | Yes | Yes | Yes |
| Local persistence | SQLite | IndexedDB | SQLite |
| EXIF import | Library scan* | Photo upload / drag-drop** | Folder scan*** |
| Background GPS geofence | Optional**** | No | No |
| $0 install / distribution | APK sideload | Free static host | Run locally |

\* Android needs `ACCESS_MEDIA_LOCATION` or GPS is redacted from EXIF.
\** Web cannot enumerate a camera roll, but the user can select or drag-drop photos and the app parses EXIF client-side (browser File API), with zero upload to any server.
\*** Desktop has no camera-roll API; scan a user-picked folder of image files.
\**** Android background location needs `ACCESS_BACKGROUND_LOCATION`; use DIY significant-change to avoid the paid plugin (§8).

> iOS deferred. If revived later: free Apple-ID signing expires every 7 days (3-app cap); a frictionless install costs $99/yr. Same codebase, so it is an add-on, not a rewrite.

---

## 4. Market Analysis (condensed)

Three archetypes:

1. **Polygon scratch maps** (*Been*, *Visited*, *Mark O'Travel*) — geopolitical completeness, percentage metrics, clean vector look. Our target.
2. **Timeline / route planners** (*Polarsteps*, *Wanderlog*, *FindPenguins*) — GPS lines, journals, social feeds.
3. **Fog-of-war mappers** (*Fog of World*, *World Uncovered*) — continuous high-resolution tile discovery.

### Competitor comparison (prices unverified — confirm before public use)

| App | UX paradigm | Admin-1 | Temporal | Auto ingestion | Pricing |
| :-- | :-- | :-- | :-- | :-- | :-- |
| Been | 2D/3D polygon scratch | Limited (IAP) | Basic toggle | None | Freemium |
| Visited | Polygon + bucket lists | Extensive | Dates + checklists | None | Aggressive freemium |
| Mark O'Travel | Vector polygon | Per-region download | Arrival/departure | None | Paid/freemium |
| Polarsteps | GPS path + journal | No | Rich timeline | Continuous GPS | Free (sells books) |
| Google Maps Timeline | Points/path history | No | Automated | Passive location | Free (Google account) |
| Wanderlog | Itinerary + route | No | Itinerary dates | Email sync | Freemium |

**Takeaway:** no commercial standalone polygon scratch map is 100% free without locking Admin-1 regions, multi-status categories, or export. That gap is what this build fills — and the client-side, zero-telemetry design is a genuine privacy differentiator.

---

## 5. Technology Stack

**Framework: Flutter (Dart)** — one canvas abstraction across Android/Web/Desktop, Skia/Impeller renders complex vector geometry directly with no bridge. Right call for a canvas-heavy vector app.

```text
+---------------------------------------------------------------------------+
|                             CLIENT (Flutter 3.x)                          |
|                                                                           |
|  Targets:  Android | Web (CanvasKit / Wasm) | Windows·macOS·Linux         |
|                                                                           |
|  UI / Map:                                                                |
|   • Strategy A (default): CustomPainter, GeoJSON->Path, equirectangular   |
|   • Strategy B (optional): flutter_map + PolygonLayer for slippy zoom     |
|                                                                           |
|  Processing (Dart Isolate / Web Worker):                                  |
|   • Spatial: hand-rolled ray-cast PIP + bbox prefilter                    |
|   • EXIF: photo_manager (Android) / file picker (desktop) / File API (web)|
|   • Location (optional): DIY significant-change (Android)                 |
|                                                                           |
|  State: Riverpod                                                          |
|  Persistence (user data only): drift -> SQLite (native) / IndexedDB (web) |
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

**Web caveats:** CanvasKit adds a ~2 MB first-load payload; the Wasm-GC build targets modern browsers only. Fine for this use.

**Desktop:** same code as a Windows/macOS/Linux app; on desktop, EXIF comes from a user-picked folder scan.

---

## 6. Spatial Engine (the polygon core)

### Rendering — Strategy A (recommended, the "Been" look)

- Parse coordinates into Flutter `Path` objects with **equirectangular** mapping (`x = (lon+180)/360·W`, `y = (90−lat)/180·H`). Linear and invertible.
- Cache each region's `Path` and a pre-recorded `Picture` for the static base; repaint only re-fills changed regions. Wrap in `RepaintBoundary`.
- Pan/zoom via a transform matrix. On tap: inverse-transform to lon/lat → bbox-filter candidates → ray-cast PIP on survivors.
- Status fills: `#3498db` visited, `#e67e22` want, `#2ecc71` lived, `#ecf0f1` unvisited.

### Point-in-polygon

- Ray-casting per region over `{id, bbox, MultiPolygon}`: reject by bbox first, then cast. Handle **MultiPolygon**, **interior rings** (lakes/enclaves), and the **antimeridian** (normalize longitudes for Russia/Fiji/Aleutians).
- Bbox linear prefilter suffices for ~250 countries and ~4,000 Admin-1 units; add a grid/R-tree only if profiling demands.

### Correctness tests

- Known coordinates resolve correctly (Eiffel Tower → FRA/Île-de-France; a Lesotho point is not South Africa; Kaliningrad → RUS).
- Golden-image tests for the base render.

---

## 7. Vector Data Sourcing & Optimization

Raw global Admin-1 GeoJSON is >150 MB, so pre-process offline and bundle the result.

**Sources (public domain):** `ne_110m_admin_0_countries` (~200 KB, overview); `ne_50m_admin_0_countries` (detail); `ne_10m_admin_1_states_provinces` (Admin-1, split per country, on demand).

**Pipeline (committed build scripts):**
1. Simplify with **Mapshaper** (Visvalingam-Whyatt): `mapshaper in.shp -simplify 8% keep-shapes -o format=topojson out.json`.
2. Convert to **TopoJSON** to drop shared vertices (70–80% smaller).
3. Split Admin-1 per country; load lazily on drill-down.
4. **IDs:** Admin-0 = `ADM0_A3` (never `iso_a3`, which is `-99` for France/Norway/etc.). Admin-1 = `iso_3166_2`, fallback `adm1_code`; patch blanks manually.

---

## 8. Automated Ingestion — Tiered Opt-In Model

The end user gets manual control by default and opts into automation per feature. Permissions are requested only when a tier is enabled (progressive disclosure), never on first launch.

```text
  TIER 0  Manual            always on · all platforms · no permissions
     |
  TIER 1  EXIF import       opt-in · Android(library) / Desktop(folder) / Web(upload)
     |                      100% on-device, zero upload
  TIER 2  Background GPS    opt-in · advanced/experimental · Android only
                            DIY significant-change to stay $0
```

### Tier 0 — Manual (baseline)
Tap a region, set status, dates, note. Works everywhere, no permissions, no risk. The product's floor.

### Tier 1 — EXIF import (recommended optional flagship)
- **Android:** `photo_manager` library scan; request read access **and** `ACCESS_MEDIA_LOCATION`.
- **Desktop:** user picks a folder; scan image files for EXIF.
- **Web:** user selects or drag-drops photos; parse EXIF in-browser via the File API — nothing is uploaded.
- Pipeline: page assets on an Isolate → read `latitude`/`longitude`/`DateTimeOriginal` → discard no-GPS → ray-cast PIP → upsert visit + store the raw point as evidence → dedup to one visit per region per day.
- Privacy is the selling point: all parsing is on-device, no telemetry.

### Tier 2 — Background GPS (optional, advanced, Android)
- DIY significant-change (Fused passive + activity recognition + `ACCESS_BACKGROUND_LOCATION`) to avoid the paid `flutter_background_geolocation` Android license and keep the developer at $0.
- On wake: single fix → PIP → store → release location hardware. Label it experimental in the UI.

**My recommendation (you asked):** your instinct is right. Manual as the mandatory floor, EXIF as the strongly-recommended opt-in, background GPS as a clearly-labeled experimental extra. EXIF is the sweet spot — deterministic, one-time permission, no battery cost, and it delivers most of the "auto-fill where I've been" value. Background GPS earns its place last: it is the only tier with ongoing battery/permission cost, the only one that could force a plugin fee, and the only one Play Store scrutinizes. Ship 0 and 1; treat 2 as a stretch.

---

## 9. Data Model (local-first)

Geometry lives in bundled assets; the database holds **user data only** — tiny, and therefore cheap to sync or share.

```text
Table: regions        (populated once from bundled geo; names + stats)
  id  TEXT PK          -- ADM0_A3 (country) or ISO 3166-2 (admin-1)
  parent_id  TEXT NULL -- country ADM0_A3 for admin-1
  name  TEXT
  admin_level  INTEGER -- 0 country, 1 state/province
  continent  TEXT
  iso_a2  TEXT NULL

Table: visit_records
  id  TEXT PK          -- uuid
  region_id  TEXT FK -> regions(id)
  status  TEXT         -- 'visited'|'want'|'lived'|'transit' (extensible)
  start_date  TEXT NULL
  end_date  TEXT NULL
  source  TEXT         -- 'manual'|'exif'|'gps'
  note  TEXT NULL
  created_at  TEXT
  updated_at  TEXT     -- last-write-wins key for merge

Table: evidence        (raw geotagged points; re-derive visits)
  id  TEXT PK
  region_id  TEXT FK
  visit_id  TEXT NULL FK
  lat  REAL
  lng  REAL
  taken_at  TEXT
  source  TEXT
  asset_ref  TEXT NULL  -- local photo id, NOT the bytes

Table: app_meta
  schema_version  INTEGER
  geo_data_version  TEXT

Indices: visit_records(region_id), (status), (start_date)
```

Multiple visits per region allowed. Stats derive from these: % of world, % per continent, total days, count by status. **Export/import:** the dataset serializes to one JSON file; import merges by `id` with last-write-wins on `updated_at`.

---

## 10. Sharing & Multi-User at $0 (investigated)

**You asked whether shareable / multi-user is possible at $0. Yes — for this app specifically, and at hobby-to-community scale.** The reason is structural: the expensive parts (map geometry, rendering, point-in-polygon, EXIF parsing) all run on the client, and the map geometry ships inside the app rather than being served per request. So a backend only ever moves each user's tiny text payload (a few thousand JSON rows). Storage, bandwidth, and compute per user are near-zero, which is exactly what free tiers are generous about.

### Free-tier building blocks

| Service | Free ceiling (approx.) | Watch-out |
| :-- | :-- | :-- |
| **Supabase** | Postgres 500 MB, 5 GB egress/mo, 50k monthly active users, auth + row-level security + realtime | Free projects pause after ~1 week idle (a non-issue once real users keep it active) |
| **Firebase (Spark)** | Firestore 1 GB, ~50k reads / 20k writes per day, auth free, 10 GB/mo hosting | Daily quotas are the wall; no pause |
| **Cloudflare** | Pages (unlimited static bandwidth), Workers 100k req/day, D1 SQLite ~5 GB, **R2 storage with zero egress fees** | No built-in auth (add via Workers); best economics |
| **Turso (libSQL)** | ~9 GB storage, ~1B row-reads/mo, 25M writes/mo | SQLite semantics |
| **Neon (Postgres)** | ~0.5 GB, scales to zero | You already use this on another project |

### Recommended $0 multi-user stack (when you want it)
- **Easiest:** Supabase — Postgres + auth + row-level security + realtime in one, 50k MAU free. Lowest wiring effort.
- **Best economics / commercial-OK:** Cloudflare Workers + D1 for data, **R2 for any shared media (zero egress fees)**, Pages for the web client.

### Sharing models, cheapest first
1. **Private per-user cloud sync** — each user's rows row-level-secured. Cheap: tiny text sync.
2. **Public read-only share links** — publish a static JSON or a rendered map snapshot to the static host / R2. The cheapest possible sharing: no live backend load per view.
3. **Social / following / feeds** — most expensive (N-to-N reads). Defer; this is what burns free-tier quotas first.

### The three honest asterisks
1. **"$0" means "$0 within free-tier ceilings,"** not at infinite scale. At hundreds-to-low-thousands of users you stay free; a viral spike breaks it — a good problem you would monetize by then.
2. **Egress is the first wall.** Mitigate by keeping payloads tiny (this app already does) and putting any shared media on Cloudflare R2 (no egress fees).
3. **Some free hosts forbid commercial use** (e.g. Vercel Hobby is non-commercial). If you ever monetize, host on Cloudflare (commercial-OK on free) or self-host.

**Bottom line:** ship single-user local-first first. Multi-user sync and public share links are a proven, low-cost add-on for this app; social features are the only thing that meaningfully threatens $0, so gate them behind demand.

---

## 11. Roadmap (tiered, with acceptance criteria)

**Milestone 1 — Spatial engine & canvas**
- Offline scripts download + simplify Natural Earth 110m/50m; TopoJSON in repo.
- Dart TopoJSON unpacker + ray-cast PIP (bbox prefilter, MultiPolygon/holes/antimeridian).
- CustomPainter map: pan/zoom, tap-to-select, multi-color fills.
- *Done when:* tapping any country selects the correct one at 60 fps on a mid device; PIP unit tests pass.

**Milestone 2 — Data model & manual UI (Tier 0)**
- drift schema + Riverpod; region inspector (status/dates/duration/note); stats dashboard; JSON export/import.
- *Done when:* a visit survives restart; export→import round-trips losslessly.

**Milestone 3 — EXIF import (Tier 1)**
- Android library scan (+`ACCESS_MEDIA_LOCATION`), desktop folder scan, web upload — client-side parse, Isolate batching, evidence rows, dedup.
- *Done when:* a geotagged photo set auto-populates the right regions with no UI jank.

**Milestone 4 — Multi-platform build & $0 distribution**
- Flutter Web (CanvasKit/Wasm) to Cloudflare Pages; signed Android APK; desktop build.
- *Done when:* all three targets run the same feature set (minus platform-limited ingestion).

**Optional Milestone 5 — Background GPS (Tier 2, Android).**
**Optional Milestone 6 — $0 cloud sync + public share links** (Supabase or Cloudflare; §10).

---

## 12. Risk Register

| Risk | Likelihood | Impact | Mitigation |
| :-- | :-- | :-- | :-- |
| Background GPS unreliable / plugin cost | High | Medium | Optional Tier 2; DIY significant-change; lead with EXIF |
| Android GPS redacted from EXIF | Medium | High | Request `ACCESS_MEDIA_LOCATION` |
| NE code fields wrong/blank (`iso_a3=-99`) | High | Medium | Use `ADM0_A3` / `iso_3166_2`; patch blanks |
| Antimeridian polygons mis-render/mis-PIP | Medium | Medium | Normalize longitudes; test Russia/Fiji |
| Web bundle heavy | Low | Low | Accept CanvasKit payload; lazy-load Admin-1 |
| Multi-user egress/quota overrun | Low (hobby) | Medium | Tiny payloads + R2; gate social features |
| Free host commercial-use ToS | Low | Medium | Cloudflare (commercial-OK) if monetizing |

---

## 13. References

1. **Natural Earth** — public-domain vector data at 1:10m/50m/110m. naturalearthdata.com
2. **Shimrat, M. (1962)** — *Algorithm 112: Position of point relative to polygon.* CACM 5(8), 434.
3. **Visvalingam, M. & Whyatt, J. D. (1993)** — *Line generalisation by repeated elimination of the smallest area.* The Cartographic Journal 30(1), 46–51.
4. **Bostock, M.** — *TopoJSON Specification.* github.com/topojson/topojson-specification
5. **Mapshaper** — CLI + web GIS simplification. mapshaper.org
6. **OpenStreetMap** — ISO 3166 administrative boundaries. wiki.openstreetmap.org
7. **Flutter** — cross-platform graphics (Impeller). docs.flutter.dev
8. **drift** — reactive local-first SQLite for Dart/Flutter. drift.simonbinder.eu
9. **Supabase / Cloudflare / Firebase / Turso / Neon** — free-tier BaaS and edge platforms (§10).
