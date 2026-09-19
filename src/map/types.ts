import type { Polygon, MultiPolygon } from 'geojson';

export type Pt = [number, number];
export type BBox = [number, number, number, number];

export interface Region {
  id: string;
  name: string;
  bbox: BBox;
  geom: Polygon | MultiPolygon;
  /** Pre-projected path in base world units (see projection.ts). */
  path: Path2D;
}
