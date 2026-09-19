// Equirectangular projection in fixed "base world units" (2:1). Linear and
// invertible, so a screen tap converts back to lon/lat cheaply for PIP.
// Pan/zoom is applied on top via the canvas transform, not here.
export const BASE_W = 1000;
export const BASE_H = BASE_W / 2;

export function lonLatToBase(lon: number, lat: number): [number, number] {
  return [((lon + 180) / 360) * BASE_W, ((90 - lat) / 180) * BASE_H];
}

export function baseToLonLat(x: number, y: number): [number, number] {
  return [(x / BASE_W) * 360 - 180, 90 - (y / BASE_H) * 180];
}
