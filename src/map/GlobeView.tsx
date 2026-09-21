import { useEffect, useRef } from 'react';
import Globe from 'globe.gl';
import type { GlobeInstance } from 'globe.gl';
import { AmbientLight } from 'three';
import type { CountryFeature } from './geo';
import type { CityMarker } from './cities';
import type { StatusMap } from '../state/status';
import { STATUS_META, UNVISITED_COLOR } from '../state/status';
import type { Pov, Bounds } from '../lib/geo-util';

function lighten(hex: string, amt: number): string {
  const h = hex.replace('#', '');
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  const m = (c: number) => Math.round(c + (255 - c) * amt);
  return `rgb(${m(r)},${m(g)},${m(b)})`;
}

interface Props {
  polygons: CountryFeature[];
  statuses: StatusMap;
  selectedId: string | null;
  globeImage: string;
  onPick: (id: string) => void;
  onDeselect?: () => void;
  onHover?: (id: string | null) => void;
  onZoom?: (pov: Pov) => void;
  pov?: Pov | null;
  /** When set, overrides fill color per id (for compare/overlay views); null = unvisited. */
  colorOverride?: (id: string) => string | null;
  /** Capital / city markers to draw (already zoom-filtered + capped by the caller). */
  markers?: CityMarker[];
  /** Click a marker -> select its parent country (by ADM0_A3). */
  onMarkerPick?: (a3: string) => void;
  /** Fly-to + fit a selected area to the viewport (aspect-aware; supersedes `pov`). */
  fit?: Bounds | null;
  /** Current camera altitude, so marker size can track the live zoom level. */
  viewAltitude?: number;
  /** Country (ADM0_A3) to emphasise: its markers full size, other marked ones smaller. */
  emphasizeA3?: string | null;
}

export default function GlobeView({ polygons, statuses, selectedId, globeImage, onPick, onDeselect, onHover, onZoom, pov, colorOverride, markers, onMarkerPick, fit, viewAltitude, emphasizeA3 }: Props) {
  const elRef = useRef<HTMLDivElement>(null);
  const globeRef = useRef<GlobeInstance | null>(null);
  const maxAltRef = useRef<number>(2.5);
  const wakeRef = useRef<((ms?: number) => void) | null>(null);
  const labelDataRef = useRef<CityMarker[]>([]);
  const statusesRef = useRef(statuses);
  const selectedRef = useRef(selectedId);
  const hoverRef = useRef<string | null>(null);
  const coRef = useRef(colorOverride);
  const cbRef = useRef({ onPick, onDeselect, onHover, onZoom, onMarkerPick });
  statusesRef.current = statuses;
  selectedRef.current = selectedId;
  coRef.current = colorOverride;
  cbRef.current = { onPick, onDeselect, onHover, onZoom, onMarkerPick };

  const idOf = (d: unknown) => String((d as CountryFeature).id);

  const capColor = (d: unknown): string => {
    const id = idOf(d);
    let base: string;
    if (coRef.current) {
      base = coRef.current(id) ?? UNVISITED_COLOR;
    } else {
      // A region with no mark of its own inherits its country's mark (id "USA-3514" -> "USA").
      const st = statusesRef.current[id] ?? (id.includes('-') ? statusesRef.current[id.split('-')[0]] : undefined);
      base = st ? STATUS_META[st].color : UNVISITED_COLOR;
    }
    if (id === selectedRef.current) return lighten(base, 0.4);
    return base;
  };
  // Countries lie flat on the sphere at a constant tiny altitude: nothing rises,
  // bobs, or pokes past the globe's edge on hover. Hover/selection = colour only.
  const strokeColor = (d: unknown): string =>
    idOf(d) === selectedRef.current ? '#ffffff' : 'rgba(255,255,255,0.22)';

  const refresh = () => {
    globeRef.current?.polygonCapColor(capColor).polygonStrokeColor(strokeColor);
  };

  useEffect(() => {
    const el = elRef.current!;
    const isMobileGl = window.matchMedia?.('(max-width: 720px)').matches ?? false;
    // logarithmicDepthBuffer stops the country polygons (which sit a hair above the
    // globe surface) from z-fighting the texture as the camera moves — that was the
    // shifting dark speckle. antialias smooths the polygon/label edges too.
    const globe: GlobeInstance = new Globe(el, { rendererConfig: { antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' } })
      .backgroundColor('#0b1f2a')
      .globeImageUrl(globeImage)
      .showAtmosphere(!isMobileGl) // the atmosphere glow is extra per-frame fill; drop it on phones
      .atmosphereColor('#4aa8ff')
      .atmosphereAltitude(0.18)
      .polygonsTransitionDuration(0)
      .polygonCapColor(capColor)
      .polygonSideColor(() => 'rgba(0,0,0,0)') // invisible sides = flat caps, no 3D walls
      .polygonStrokeColor(strokeColor)
      .polygonAltitude(0.002)
      .polygonCapCurvatureResolution(10) // coarser cap tessellation (default 5) = fewer triangles, faster geometry build; invisible on a near-flat map
      .onPolygonClick((d: unknown) => cbRef.current.onPick(idOf(d)))
      .onPolygonHover((d: unknown) => {
        // No recolor here (that re-renders every polygon per hover = laggy).
        // The name shows in the HTML banner via onHover; only the cursor changes.
        hoverRef.current = d ? idOf(d) : null;
        el.style.cursor = d ? 'pointer' : 'grab';
        cbRef.current.onHover?.(hoverRef.current);
      })
      // City / capital markers: a dot plus (for the bigger ones) a name. Sat just
      // above the country fill so it's never obscured, and — being a 3D object at
      // surface radius — correctly hidden by the globe when it's on the far side.
      .labelLat((d: unknown) => (d as CityMarker).y)
      .labelLng((d: unknown) => (d as CityMarker).x)
      .labelText((d: unknown) => ((d as CityMarker).t ? (d as CityMarker).n : ''))
      .labelSize((d: unknown) => ((d as CityMarker).c ? 0.4 : 0.28))
      .labelDotRadius((d: unknown) => ((d as CityMarker).c ? 0.1 : 0.065))
      .labelColor((d: unknown) => ((d as CityMarker).c ? '#fb4b60' : '#ffe14d'))
      .labelAltitude(0.003) // just above the country fill (0.002): minimal radial lift = minimal off-axis parallax = dot sits on its true point
      .labelResolution(2)
      .labelIncludeDot(true)
      .labelsTransitionDuration(0)
      .onLabelClick((d: unknown) => { const a3 = (d as CityMarker).a3; if (a3) cbRef.current.onMarkerPick?.(a3); })
      .onLabelHover((d: unknown) => { el.style.cursor = d ? 'pointer' : 'grab'; })
      .onGlobeClick(() => cbRef.current.onDeselect?.());
    globeRef.current = globe;
    // Cap pixel ratio: fragment work scales with its SQUARE. Phones are fill-rate
    // bound and often report DPR 2-3, so cap to 1 on small screens (big win, antialias
    // still smooths edges); 1.5 on desktop.
    try {
      const dprCap = window.matchMedia?.('(max-width: 720px)').matches ? 1 : 1.5;
      globe.renderer().setPixelRatio(Math.min(window.devicePixelRatio || 1, dprCap));
    } catch { /* ignore */ }
    // Flat, even lighting: no directional light means no dark hemisphere / "3D shadow".
    try { globe.lights([new AmbientLight(0xffffff, 2.6)]); } catch { /* ignore */ }
    // Kill specular shine so the sphere looks like a flat map, not a glossy ball.
    try {
      const gm = globe.globeMaterial() as { shininess?: number; specular?: { set: (c: number) => void } };
      gm.shininess = 0;
      gm.specular?.set(0x000000);
    } catch { /* ignore */ }

    const controls = globe.controls() as {
      autoRotate: boolean; autoRotateSpeed: number; enableDamping: boolean;
      minDistance: number; maxDistance: number; update?: () => void;
      addEventListener?: (t: string, fn: () => void) => void;
      removeEventListener?: (t: string, fn: () => void) => void;
    };
    // Respect "reduce motion": don't auto-spin (also easier on phone battery/CPU).
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    controls.autoRotate = !reduceMotion;
    controls.autoRotateSpeed = 0.35;
    controls.enableDamping = true;

    // RENDER-ON-DEMAND. globe.gl otherwise runs its requestAnimationFrame loop forever,
    // rendering ~60fps even when nothing moves — constant GPU/battery. Instead: run only
    // while something is actually changing (interaction, damping tail, auto-spin, or a
    // programmatic update), then pause. Idle cost drops to zero, so the device stays cool
    // and doesn't thermal-throttle -> everything else feels faster.
    const anim = globe as unknown as { pauseAnimation?: () => void; resumeAnimation?: () => void };
    let idleTimer = 0;
    const wake = (ms = 700) => {
      anim.resumeAnimation?.();
      clearTimeout(idleTimer);
      idleTimer = window.setTimeout(() => { if (!controls.autoRotate) anim.pauseAnimation?.(); }, ms);
    };
    wakeRef.current = wake;
    const onChange = () => wake();
    controls.addEventListener?.('change', onChange); // fires each frame during drag/zoom/damping
    // On phones, hide marker labels while dragging: each label is a draw call, so many of
    // them stutter the drag. Restore on release (a brief rebuild, but the drag is smooth).
    let labelsHidden = false;
    const hideLabels = () => {
      if (labelsHidden || !isMobileGl || labelDataRef.current.length <= 16) return;
      labelsHidden = true;
      globe.labelsData([] as unknown as object[]);
    };
    const restoreLabels = () => {
      if (!labelsHidden) return;
      labelsHidden = false;
      globe.labelsData(labelDataRef.current as unknown as object[]);
      wake();
    };
    const onPointerDown = () => { controls.autoRotate = false; hideLabels(); wake(); };
    el.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('pointerup', restoreLabels);
    window.addEventListener('pointercancel', restoreLabels);

    const radius = () => (globe as unknown as { getGlobeRadius?: () => number }).getGlobeRadius?.() ?? 100;
    // Clamp zoom-out so Earth can never shrink to a dot: cap distance just past the
    // altitude at which the whole globe fits the NARROWER screen axis (portrait phones
    // need to pull back further, so this adapts to the viewport aspect).
    const applyZoomLimits = () => {
      const cam = globe.camera() as unknown as { fov?: number };
      const vfov = ((cam.fov ?? 50) * Math.PI) / 180;
      const aspect = el.clientWidth / Math.max(1, el.clientHeight);
      const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
      const minFov = Math.min(vfov, hfov);
      maxAltRef.current = (1 / Math.sin(minFov / 2) - 1) * 1.12;
      const r = radius();
      controls.maxDistance = r * (1 + maxAltRef.current);
      controls.minDistance = r * 1.02;
      controls.update?.();
    };
    applyZoomLimits();
    globe.pointOfView({ lat: 20, lng: 0, altitude: Math.min(2.2, maxAltRef.current) }, 0);

    globe.onZoom((p: Pov) => cbRef.current.onZoom?.(p));

    const resize = () => { globe.width(el.clientWidth).height(el.clientHeight); applyZoomLimits(); wake(); };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);

    wake(2500); // render the initial frames (incl. async texture) then settle to idle

    return () => {
      ro.disconnect();
      clearTimeout(idleTimer);
      controls.removeEventListener?.('change', onChange);
      el.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointerup', restoreLabels);
      window.removeEventListener('pointercancel', restoreLabels);
      (globe as unknown as { _destructor?: () => void })._destructor?.();
      globeRef.current = null;
      wakeRef.current = null;
      el.innerHTML = '';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { globeRef.current?.polygonsData(polygons as unknown as object[]); wakeRef.current?.(); }, [polygons]);
  useEffect(() => { labelDataRef.current = markers ?? []; globeRef.current?.labelsData((markers ?? []) as unknown as object[]); wakeRef.current?.(); }, [markers]);
  // Marker size tracks the live zoom. Labels are 3D (perspective-scaled), so to keep
  // them a roughly constant, legible size on screen at every zoom their world size
  // must scale with camera altitude (screen size ~ worldSize / distance). Re-applied
  // on each altitude change; fresh closures force three-globe to re-render the layer.
  useEffect(() => {
    const g = globeRef.current;
    if (!g) return;
    const a = Math.max(0.08, Math.min(viewAltitude ?? 1, 2.5));
    // Emphasise the picked country; other marked countries stay as smaller context.
    const emph = (d: unknown) => (emphasizeA3 && (d as CityMarker).a3 !== emphasizeA3 ? 0.72 : 1);
    g.labelSize((d: unknown) => ((d as CityMarker).c ? 1.15 : 0.82) * a * emph(d))
     .labelDotRadius((d: unknown) => ((d as CityMarker).c ? 0.32 : 0.2) * a * emph(d));
    wakeRef.current?.();
  }, [viewAltitude, emphasizeA3]);
  useEffect(() => { refresh(); wakeRef.current?.(); /* eslint-disable-next-line */ }, [statuses, selectedId, colorOverride]);
  useEffect(() => { if (pov) { globeRef.current?.pointOfView({ ...pov, altitude: Math.min(pov.altitude, maxAltRef.current) }, 800); wakeRef.current?.(900); } }, [pov]);
  // Fit a selected area to the viewport: turn its angular size + the camera's field
  // of view into the altitude at which it just fills the screen (per-axis, so a wide
  // country on a tall phone still fits), then fly there.
  useEffect(() => {
    const globe = globeRef.current;
    const el = elRef.current;
    if (!fit || !globe || !el) return;
    const cam = globe.camera() as unknown as { fov?: number };
    const vfov = ((cam.fov ?? 50) * Math.PI) / 180;
    const aspect = el.clientWidth / Math.max(1, el.clientHeight);
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect);
    // Exact altitude at which a surface arc of angular span `spanDeg` (centred on the
    // camera axis) just reaches the edge of a half-FOV: the edge point sits at central
    // angle phi, so tan(halfFov) = r*sin(phi) / (D - r*cos(phi)). Solve for D/r - 1.
    const fitAlt = (spanDeg: number, halfFov: number) => {
      const phi = (spanDeg * Math.PI) / 360;
      return Math.cos(phi) + Math.sin(phi) / Math.tan(halfFov) - 1;
    };
    const alt = Math.max(fitAlt(fit.h, vfov / 2), fitAlt(fit.w, hfov / 2)) * 1.12;
    globe.pointOfView({ lat: fit.lat, lng: fit.lng, altitude: Math.max(0.08, Math.min(alt, maxAltRef.current)) }, 800);
    wakeRef.current?.(900);
  }, [fit]);
  useEffect(() => { globeRef.current?.globeImageUrl(globeImage); wakeRef.current?.(2500); }, [globeImage]);

  return <div ref={elRef} className="globe-wrap" />;
}
