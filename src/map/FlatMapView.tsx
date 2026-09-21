import { useEffect, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { CountryFeature } from './geo';
import type { CityMarker } from './cities';
import type { StatusMap } from '../state/status';
import { STATUS_META, UNVISITED_COLOR } from '../state/status';
import { BASE_W, BASE_H, lonLatToBase, baseToLonLat } from './projection';
import { pointInGeometry, bboxOf } from './pip';
import type { Polygon, MultiPolygon, Position } from 'geojson';

// A flat 2D equirectangular map. Deliberately lightweight: no three.js/WebGL, so it
// loads and runs far faster than the globe (polygons are plain canvas fills — even
// thousands of counties are cheap). Shares App's data model so the two views swap.

interface Props {
  polygons: CountryFeature[];
  statuses: StatusMap;
  selectedId: string | null;
  onPick: (id: string) => void;
  onDeselect?: () => void;
  colorOverride?: (id: string) => string | null;
  markers?: CityMarker[];
  /** Report an equivalent {lat,lng,altitude} so App can drive LOD + region expansion. */
  onView?: (v: { lat: number; lng: number; altitude: number }) => void;
}

interface View { k: number; tx: number; ty: number }

function lighten(hex: string, amt: number): string {
  const h = hex.replace('#', '');
  if (h.length < 6) return hex;
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  const m = (c: number) => Math.round(c + (255 - c) * amt);
  return `rgb(${m(r)},${m(g)},${m(b)})`;
}

function addRing(path: Path2D, ring: Position[]): void {
  for (let i = 0; i < ring.length; i++) {
    const [x, y] = lonLatToBase(ring[i][0], ring[i][1]);
    if (i === 0) path.moveTo(x, y); else path.lineTo(x, y);
  }
  path.closePath();
}
function buildPath(geom: Polygon | MultiPolygon): Path2D {
  const p = new Path2D();
  if (geom.type === 'Polygon') for (const ring of geom.coordinates) addRing(p, ring);
  else for (const poly of geom.coordinates) for (const ring of poly) addRing(p, ring);
  return p;
}

function maxRankForZoom(z: number): number {
  if (z < 1.6) return 2; if (z < 3) return 3; if (z < 6) return 4; if (z < 12) return 6; return 8;
}

export default function FlatMapView({ polygons, statuses, selectedId, onPick, onDeselect, colorOverride, markers, onView }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onViewRef = useRef(onView);
  onViewRef.current = onView;
  const view = useRef<View>({ k: 1, tx: 0, ty: 0 });
  const fitted = useRef(false);
  const paths = useRef<WeakMap<CountryFeature, Path2D>>(new WeakMap()); // keyed by feature object so LOD swaps (same id, finer geometry) rebuild
  const polysRef = useRef(polygons);
  const statusesRef = useRef(statuses);
  const selectedRef = useRef(selectedId);
  const coRef = useRef(colorOverride);
  const markersRef = useRef(markers);
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const pointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinch = useRef<{ dist: number; k: number } | null>(null);
  polysRef.current = polygons;
  statusesRef.current = statuses;
  selectedRef.current = selectedId;
  coRef.current = colorOverride;
  markersRef.current = markers;

  const fitK = () => { const c = canvasRef.current!; return Math.min(c.width / BASE_W, c.height / BASE_H); };
  const dpr = () => window.devicePixelRatio || 1;

  // Translate the flat view into the globe's {lat,lng,altitude} vocabulary so App's
  // existing LOD + Admin-1/2 expansion (keyed on altitude + centre) works here too.
  function reportView() {
    const cb = onViewRef.current; const c = canvasRef.current; if (!cb || !c) return;
    const { k, tx, ty } = view.current;
    const [lng, lat] = baseToLonLat((c.width / 2 - tx) / k, (c.height / 2 - ty) / k);
    const spanDeg = ((c.width / k) / BASE_W) * 360; // horizontal degrees in view
    cb({ lat, lng, altitude: Math.max(0.05, Math.min(spanDeg / 50, 3)) });
  }

  function fitWorld() {
    const c = canvasRef.current!; const k = fitK();
    if (!(k > 0)) return; // canvas not sized yet; ResizeObserver will re-fit
    view.current = { k, tx: (c.width - BASE_W * k) / 2, ty: (c.height - BASE_H * k) / 2 };
    fitted.current = true;
  }

  function fitBounds(geom: Polygon | MultiPolygon) {
    const c = canvasRef.current; if (!c || !(c.width > 0)) return;
    const [minLon, minLat, maxLon, maxLat] = bboxOf(geom);
    // Antimeridian-spanning bbox (e.g. Russia) blows up -> just show the world.
    if (maxLon - minLon > 300) { fitWorld(); draw(); reportView(); return; }
    const [x0, y0] = lonLatToBase(minLon, maxLat);
    const [x1, y1] = lonLatToBase(maxLon, minLat);
    const w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0);
    const k = Math.min(Math.max(Math.min(c.width / (w * 1.35), c.height / (h * 1.35)), fitK() * 0.9), fitK() * 90);
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    view.current = { k, tx: c.width / 2 - cx * k, ty: c.height / 2 - cy * k };
    draw();
    reportView();
  }

  function colorFor(id: string): string {
    const co = coRef.current;
    if (co) return co(id) ?? UNVISITED_COLOR;
    const st = statusesRef.current[id] ?? (id.includes('-') ? statusesRef.current[id.split('-')[0]] : undefined);
    return st ? STATUS_META[st].color : UNVISITED_COLOR;
  }

  function draw() {
    const c = canvasRef.current; if (!c) return;
    const ctx = c.getContext('2d'); if (!ctx) return;
    const { k, tx, ty } = view.current;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0b1f2a';
    ctx.fillRect(0, 0, c.width, c.height);

    ctx.setTransform(k, 0, 0, k, tx, ty);
    ctx.lineJoin = 'round';
    ctx.lineWidth = 0.5 / k;
    for (const f of polysRef.current) {
      let path = paths.current.get(f);
      if (!path) { path = buildPath(f.geometry as Polygon | MultiPolygon); paths.current.set(f, path); }
      const sel = f.id === selectedRef.current;
      ctx.fillStyle = sel ? lighten(colorFor(f.id), 0.35) : colorFor(f.id);
      ctx.fill(path);
      ctx.strokeStyle = sel ? '#ffffff' : 'rgba(11,31,42,0.5)';
      ctx.lineWidth = (sel ? 1.4 : 0.5) / k;
      ctx.stroke(path);
    }

    // Markers in screen space (constant on-screen size, always legible).
    const ms = markersRef.current;
    if (ms && ms.length) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      const z = k / Math.max(fitK(), 1e-6);
      const maxR = maxRankForZoom(z);
      const d = dpr();
      const drawn: [number, number, number, number][] = [];
      ctx.textBaseline = 'bottom';
      ctx.font = `${Math.round(11 * d)}px system-ui, sans-serif`;
      for (const m of ms) {
        if (!(m.r <= maxR || (m.c === 1 && m.r <= maxR + 2))) continue;
        const [bx, by] = lonLatToBase(m.x, m.y);
        const sx = bx * k + tx, sy = by * k + ty;
        if (sx < -20 || sy < -20 || sx > c.width + 20 || sy > c.height + 20) continue;
        const rad = (m.c ? 3.2 : 2.2) * d;
        ctx.beginPath();
        ctx.arc(sx, sy, rad, 0, Math.PI * 2);
        ctx.fillStyle = m.c ? '#fb4b60' : '#ffe14d';
        ctx.fill();
        // label for capitals + bigger cities, with simple overlap declutter
        if (m.c === 1 || m.r <= maxR - 2) {
          const tw = ctx.measureText(m.n).width;
          const lx = sx + rad + 2 * d, ly = sy + rad;
          const rect: [number, number, number, number] = [lx, ly - 12 * d, tw, 12 * d];
          const clash = drawn.some((q) => !(rect[0] > q[0] + q[2] || rect[0] + rect[2] < q[0] || rect[1] > q[1] + q[3] || rect[1] + rect[3] < q[1]));
          if (!clash) {
            drawn.push(rect);
            ctx.lineWidth = 3 * d;
            ctx.strokeStyle = 'rgba(11,31,42,0.85)';
            ctx.strokeText(m.n, lx, ly);
            ctx.fillStyle = m.c ? '#ffd0d6' : '#fff6c9';
            ctx.fillText(m.n, lx, ly);
          }
        }
      }
    }
  }

  function toBase(clientX: number, clientY: number): [number, number] {
    const c = canvasRef.current!; const rect = c.getBoundingClientRect(); const d = dpr();
    const sx = (clientX - rect.left) * d, sy = (clientY - rect.top) * d;
    const { k, tx, ty } = view.current;
    return [(sx - tx) / k, (sy - ty) / k];
  }

  // Redraw when the polygon set changes (WeakMap path cache invalidates itself: new
  // feature objects from an LOD swap or region expansion get fresh paths).
  useEffect(() => { draw(); /* eslint-disable-next-line */ }, [polygons]);
  useEffect(() => { draw(); /* eslint-disable-next-line */ }, [statuses, colorOverride, markers]);

  // Auto-fit the selected area (or whole world when cleared) — parity with the globe.
  useEffect(() => {
    if (!canvasRef.current) return;
    if (!selectedId) { fitWorld(); draw(); return; }
    const f = polysRef.current.find((x) => x.id === selectedId) ?? polysRef.current.find((x) => x.id === selectedId.split('-')[0]);
    if (f) fitBounds(f.geometry as Polygon | MultiPolygon);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId]);

  useEffect(() => {
    const c = canvasRef.current!;
    const resize = () => {
      const d = dpr(); const rect = c.getBoundingClientRect();
      c.width = Math.max(1, Math.round(rect.width * d));
      c.height = Math.max(1, Math.round(rect.height * d));
      if (!fitted.current) fitWorld();
      draw();
    };
    const ro = new ResizeObserver(resize); ro.observe(c); resize();
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const [bx, by] = toBase(e.clientX, e.clientY);
      const factor = Math.exp(-e.deltaY * 0.0015);
      const nk = Math.min(Math.max(view.current.k * factor, fitK() * 0.9), fitK() * 90);
      const d = dpr(); const rect = c.getBoundingClientRect();
      const sx = (e.clientX - rect.left) * d, sy = (e.clientY - rect.top) * d;
      view.current = { k: nk, tx: sx - bx * nk, ty: sy - by * nk };
      draw();
      reportView();
    };
    c.addEventListener('wheel', onWheel, { passive: false });
    return () => { ro.disconnect(); c.removeEventListener('wheel', onWheel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function onPointerDown(e: ReactPointerEvent) {
    (e.target as Element).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.current.size === 1) drag.current = { x: e.clientX, y: e.clientY, moved: false };
    else if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), k: view.current.k };
      drag.current = null;
    }
  }
  function onPointerMove(e: ReactPointerEvent) {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const d = dpr();
    if (pinch.current && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const midX = (a.x + b.x) / 2, midY = (a.y + b.y) / 2;
      const [bx, by] = toBase(midX, midY);
      const nk = Math.min(Math.max(pinch.current.k * (dist / pinch.current.dist), fitK() * 0.9), fitK() * 90);
      const rect = canvasRef.current!.getBoundingClientRect();
      const sx = (midX - rect.left) * d, sy = (midY - rect.top) * d;
      view.current = { k: nk, tx: sx - bx * nk, ty: sy - by * nk };
      draw();
      return;
    }
    const dr = drag.current; if (!dr) return;
    const dx = e.clientX - dr.x, dy = e.clientY - dr.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) dr.moved = true;
    view.current = { ...view.current, tx: view.current.tx + dx * d, ty: view.current.ty + dy * d };
    dr.x = e.clientX; dr.y = e.clientY;
    draw();
  }
  function onPointerUp(e: ReactPointerEvent) {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinch.current = null;
    const dr = drag.current; drag.current = null;
    if (dr && !dr.moved && pointers.current.size === 0) {
      const [bx, by] = toBase(e.clientX, e.clientY);
      const [lon, lat] = baseToLonLat(bx, by);
      let hit: string | null = null;
      for (const f of polysRef.current) {
        const bb = bboxOf(f.geometry as Polygon | MultiPolygon);
        if (lon < bb[0] || lon > bb[2] || lat < bb[1] || lat > bb[3]) continue;
        if (pointInGeometry([lon, lat], f.geometry as Polygon | MultiPolygon)) { hit = f.id; break; }
      }
      if (hit) onPick(hit); else onDeselect?.();
    } else {
      reportView(); // panned/pinched -> update LOD + region expansion for the new view
    }
  }

  return (
    <canvas
      ref={canvasRef}
      className="flat-map"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    />
  );
}
