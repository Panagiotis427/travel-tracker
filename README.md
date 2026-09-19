# travel-tracker

Private, open-source polygon "scratch map" travel tracker. $0 recurring cost. Targets Android, Web, and Windows/desktop from one codebase (iOS deferred).

Design blueprint: `docs/BLUEPRINT.md` (see also the market/architecture research it derives from).

## Status

| Part | State |
| :-- | :-- |
| Geo data pipeline (Natural Earth -> TopoJSON) | Done |
| Point-in-polygon spatial engine (reference impl + tests) | Done, 10/10 per layer |
| App shell (framework) | Pending decision (Flutter vs web/TS stack) |
| Data model + manual UI (Tier 0) | Not started |
| EXIF import (Tier 1) | Not started |

## Repository layout

```
travel-tracker/
  assets/geo/            generated, bundled map geometry (committed)
    world_110m.topojson  overview layer  (~49 KB)
    world_50m.topojson   detail layer    (~137 KB)
  tools/geo-pipeline/    offline build + validation (Node)
    build-geo.mjs        fetch NE, simplify, emit TopoJSON
    validate.mjs         ray-cast PIP reference impl + correctness gate
  docs/
    BLUEPRINT.md         full architecture plan (v3)
    spatial-engine.md    PIP algorithm notes + coastal/enclave handling
```

## Build the geo assets

```
cd tools/geo-pipeline
npm install
npm run all        # build then validate
```

Data source: Natural Earth via `nvkelso/natural-earth-vector` (public domain).
IDs use `ADM0_A3` (never `iso_a3`, which is `-99` for France/Norway/etc).

## Spatial engine (validated)

Hand-rolled ray-casting point-in-polygon with a bounding-box prefilter. Handles
MultiPolygon, interior rings (a point in a hole is outside), exclaves, and the
antimeridian (Natural Earth pre-splits those polygons). See
`docs/spatial-engine.md`. The reference implementation lives in
`tools/geo-pipeline/validate.mjs` and ports directly to Dart or TypeScript.
