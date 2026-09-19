# Spatial engine notes

Reference implementation: `tools/geo-pipeline/validate.mjs`. Ports 1:1 to Dart (Flutter) or TypeScript (web).

## Algorithm

For a query point `(lon, lat)`:

1. **Bounding-box prefilter.** Reject any region whose bbox does not contain the point. O(n) over ~250 countries (or ~4k Admin-1 units) — trivially fast; upgrade to a grid/R-tree only if profiling demands.
2. **Even-odd ray cast.** For each surviving region, test the polygon rings.
   - `pointInRing`: horizontal ray, count edge crossings, odd = inside.
   - `pointInPolygon`: inside the exterior ring **and** not inside any hole ring.
   - `MultiPolygon`: inside if inside any constituent polygon.

Coordinates stay in lon/lat for PIP. Projection (equirectangular) is only for rendering and for turning a screen tap back into lon/lat.

## Edge cases (all covered by the test gate)

- **Interior rings / enclaves.** A point in a hole is outside. Verified: Maseru resolves to Lesotho, not South Africa (at 50m).
- **Exclaves.** Verified: Kaliningrad resolves to Russia.
- **Antimeridian.** Natural Earth pre-splits polygons at ±180, so per-part PIP is correct. Verified: far-east Chukotka resolves to Russia. If a future data source does not pre-split, normalize longitudes before testing.
- **Open ocean.** Returns null. Verified: Gulf of Guinea `(0,0)`.

## Known resolution limits

- **Overview layer (110m) cannot resolve tiny enclaves.** Maseru reads as South Africa at 110m. Use the 50m (or a 10m) layer for enclave-accurate classification. The test gate encodes this via a per-case `coarse` expectation.
- **Coastal points can fall in water after simplification.** A point right on a simplified shoreline (e.g. lower Manhattan) may miss. Two mitigations for automated ingestion:
  1. Classify against a finer layer (10m) for EXIF/GPS points.
  2. **Nearest-border tolerance fallback:** if PIP returns null but the point is within a small distance (e.g. a few km) of a region bbox, snap to the nearest region. Photos are rarely taken in open ocean, so a null over water plus a small-tolerance snap on land is a safe heuristic.

## Performance targets

- Tap hit-test: sub-millisecond after bbox prefilter.
- Batch EXIF classification: run on a background isolate/worker; thousands of points per second against the in-memory index.
