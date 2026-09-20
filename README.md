# travel-tracker

Private, open-source "scratch map" travel tracker rendered as a rotatable **3D globe**. $0 recurring cost. React + Vite + TypeScript; web now, Android (Capacitor) and desktop (installable PWA) later. iOS deferred.

Design blueprint: `docs/BLUEPRINT.md` (v3.1).

## Status

| Part | State |
| :-- | :-- |
| Geo data pipeline (admin-0 110m/50m/10m + admin-1 per country) | Done |
| Point-in-polygon spatial engine (reference impl + tests) | Done, 10/10 per layer |
| App shell: React + 3D globe (globe.gl / three.js) | Done |
| Auto level-of-detail (50m base, 10m on zoom-in) | Done |
| Admin-1 drill-down (states/provinces per country) | Done |
| Search + zoom-to-country, selection panel, status picker | Done |
| Manual UI (Tier 0): status + dates/duration/note per place | Done |
| Persistence (IndexedDB) + JSON export/import | Done |
| EXIF import (Tier 1): drop photos -> auto-mark countries + regions | Done (web) |
| PWA: installable + offline (service worker) | Done |
| Polish: day/night globe, marked-place labels, multiple trips, mark-my-location | Done |
| Unified zoom-LOD (countries -> Admin-1 -> Admin-2), no drill modes | Done |
| Multi-person share links + compare overlays (no backend) | Done |
| Accounts + cloud sync (Supabase, optional) | Code done — add keys per `docs/SUPABASE.md` |
| Deploy (GitHub Pages / Cloudflare) + Capacitor Android | Ready — see `docs/DEPLOY.md` |

## Run it

```
npm install
npm run dev        # http://localhost:5173
npm run build      # production build to dist/
npm run typecheck  # tsc --noEmit
```

Tap a country to cycle its status (visited -> want -> lived -> clear). Drag to rotate, scroll to zoom. Marks persist in localStorage.

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
    App.tsx                main layout + state (statuses, layer, stats)
    map/
      GlobeView.tsx        3D globe (globe.gl / three.js) — primary view
      MapCanvas.tsx        2D equirectangular canvas — alternate view (kept)
      geo.ts               load TopoJSON -> features / regions
      pip.ts               ray-cast point-in-polygon (for EXIF/GPS classification)
      projection.ts        equirectangular forward/inverse (2D view)
      types.ts
    state/status.ts        status model, colors, localStorage
  public/
    geo/*.topojson         served geometry
    textures/earth-dark.jpg globe base texture (93 KB, offline)
  assets/geo/              source of truth for geometry (generated, committed)
  tools/geo-pipeline/      offline build + validation (Node + Mapshaper)
  docs/                    BLUEPRINT.md, spatial-engine.md
```

## Rendering choice

Primary view is a WebGL globe (globe.gl on three.js): dark Earth texture, country
polygons colored and raised by visit status, atmosphere glow, orbit controls. The
three.js chunk (~550 KB gz) is code-split so the ~72 KB shell paints immediately.

**OpenStreetMap** was evaluated and not used: OSM tiles are a 2D Mercator basemap
that globe.gl cannot drape on a sphere, and a country-level scratch map needs no
street tiles. If a literal streets-on-globe look is ever wanted, switch the base to
MapLibre GL (globe projection) with OSM/MapTiler tiles plus a country fill layer.
See `docs/BLUEPRINT.md` §6.
