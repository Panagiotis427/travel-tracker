# travel-tracker

Private, open-source "scratch map" travel tracker rendered as a rotatable **3D globe**. $0 recurring cost. React + Vite + TypeScript, for the web and the desktop (installable PWA); native Android and iOS apps are not planned.

Design blueprint: `docs/BLUEPRINT.md` (v3.1).

## Status

| Part | State |
| :-- | :-- |
| Geo data pipeline (admin-0 110m/50m/10m, admin-1 and admin-2 per country, city/capital markers) | Done |
| Point-in-polygon spatial engine (reference impl + tests) | Done, 10/10 per layer |
| App shell: React + 3D globe (globe.gl / three.js) | Done |
| Auto level-of-detail (110m world, 50m mid, 10m close; phones stop at 50m) | Done |
| Search + zoom-to-country, selection panel, status picker | Done |
| Manual UI (Tier 0): status + dates/duration/note per place | Done |
| Persistence (IndexedDB) + JSON export/import | Done |
| EXIF import (Tier 1): drop photos -> auto-mark countries + regions, read in background workers | Done (web) |
| PWA: installable + offline (service worker) | Done |
| Polish: day/night globe, city/capital markers, multiple trips, mark-my-location | Done |
| Unified zoom-LOD (countries -> Admin-1 -> Admin-2 counties, optional and viewport-culled), no drill modes | Done |
| 2D map view (canvas, no three.js) for weak devices | Done |
| Multi-person share links + compare overlays (no backend) | Done |
| Accounts + cloud sync (Supabase, optional): offline edits and deletes retried, a delete sticks on every device, sync status shown | Live; without keys marks stay on the device (`docs/SUPABASE.md`) |
| Unit tests (Vitest) + CI | Done |
| Deploy: GitHub Pages on every push to `main`; desktop = install the site as a PWA | Live — see `docs/DEPLOY.md` |

## Run it

```
npm install
npm run dev        # http://localhost:5180
npm run build      # production build to dist/
npm run typecheck  # tsc --noEmit
npm test           # unit tests (Vitest)
```

Tap a country or region (or search for one) to select it, then set its status and trips in the panel. Drag to rotate, scroll or pinch to zoom; **View** switches between the 3D globe and a lighter 2D map. Marks are saved on the device (IndexedDB); with Supabase keys set, per signed-in account and synced (`docs/SUPABASE.md`).

## Rebuild the geo assets

```
npm run geo        # fetch NE, simplify to TopoJSON, validate PIP, copy to public/geo
```

Data sources: **Natural Earth** (Admin-0/1, public domain) via `nvkelso/natural-earth-vector`;
**geoBoundaries** (Admin-2, CC BY 4.0) via their gbOpen API — `npm run admin2` in `tools/geo-pipeline`
writes `public/geo/admin2/<A3>.topojson` (180 countries, ~20 MB). Admin-0 IDs use `ADM0_A3`
(never `iso_a3`, which is `-99` for France/Norway/etc); region IDs are `A3-<n>` / `A3-2-<n>`.

Attribution (required by CC BY 4.0): boundary data © geoBoundaries (Runfola et al.), CC BY 4.0;
Natural Earth is public domain. This credit is shown in-app and here.

## Repository layout

```
travel-tracker/
  src/
    App.tsx                main layout + state (marks, level of detail, sync, stats)
    map/
      GlobeView.tsx        3D globe (globe.gl / three.js) — primary view
      FlatMapView.tsx      2D equirectangular canvas map (no three.js)
      geo.ts               load TopoJSON -> features / regions
      classify.ts          which country/region a lat/lng is in (EXIF, GPS, zoom)
      cities.ts            city/capital markers, zoom-gated
      pip.ts               ray-cast point-in-polygon
      projection.ts        equirectangular forward/inverse (2D map)
      types.ts
    features/              sign-in screen, password and share dialogs, photo import
                           (EXIF read in a worker pool), background GPS (unused)
    build/                 build-time patch that starts three-globe's layer tickers paused
    lib/                   share links, fit-to-view maths, dates, Supabase client
    state/status.ts        status model, colors
    state/db.ts            IndexedDB storage, per account
    state/cloud.ts         optional Supabase sync: pull, push, soft deletes
    state/sync.ts          sign-in merge and flush, last write wins against the cloud
    state/pending.ts       unconfirmed deletes + changed places, retried until synced
    **/*.test.ts           unit tests (Vitest)
  public/
    geo/*.topojson         served geometry (+ capitals.json, cities.json)
    textures/earth-dark.jpg globe base texture (93 KB, offline)
  assets/geo/              source of truth for geometry (generated, committed)
  tools/geo-pipeline/      offline build + validation (Node + Mapshaper)
  docs/                    BLUEPRINT.md, spatial-engine.md, SUPABASE.md, DEPLOY.md
```

## Rendering choice

Primary view is a WebGL globe (globe.gl on three.js): dark Earth texture, flat
country polygons (caps only, no side walls) colored by visit status, orbit controls,
and an atmosphere glow on larger screens. It renders only while something moves, so
an idle globe costs no GPU time, and the intro spin stops by itself after 8 s. The
three.js chunk (~550 KB gz) is code-split so the shell (~150 KB gz with the Supabase
client) paints immediately; the 2D map view never loads it.

**OpenStreetMap** was evaluated and not used: OSM tiles are a 2D Mercator basemap
that globe.gl cannot drape on a sphere, and a country-level scratch map needs no
street tiles. If a literal streets-on-globe look is ever wanted, switch the base to
MapLibre GL (globe projection) with OSM/MapTiler tiles plus a country fill layer.
See `docs/BLUEPRINT.md` §6.
