import { useEffect, useRef } from 'react';
import Globe from 'globe.gl';
import type { GlobeInstance } from 'globe.gl';
import { AmbientLight } from 'three';
import type { CountryFeature } from './geo';
import type { CityMarker } from './cities';
import type { StatusMap } from '../state/status';
import { STATUS_META, UNVISITED_COLOR } from '../state/status';
import type { Pov } from '../lib/geo-util';

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
}

export default function GlobeView({ polygons, statuses, selectedId, globeImage, onPick, onDeselect, onHover, onZoom, pov, colorOverride, markers, onMarkerPick }: Props) {
  const elRef = useRef<HTMLDivElement>(null);
  const globeRef = useRef<GlobeInstance | null>(null);
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
    const globe: GlobeInstance = new Globe(el)
      .backgroundColor('#0b1f2a')
      .globeImageUrl(globeImage)
      .showAtmosphere(true)
      .atmosphereColor('#4aa8ff')
      .atmosphereAltitude(0.18)
      .polygonsTransitionDuration(0)
      .polygonCapColor(capColor)
      .polygonSideColor(() => 'rgba(0,0,0,0)') // invisible sides = flat caps, no 3D walls
      .polygonStrokeColor(strokeColor)
      .polygonAltitude(0.002)
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
      .labelSize((d: unknown) => ((d as CityMarker).c ? 0.6 : 0.42))
      .labelDotRadius((d: unknown) => ((d as CityMarker).c ? 0.34 : 0.22))
      .labelColor((d: unknown) => ((d as CityMarker).c ? '#ffd34d' : 'rgba(230,240,255,0.85)'))
      .labelAltitude(0.012)
      .labelResolution(2)
      .labelIncludeDot(true)
      .labelsTransitionDuration(0)
      .onLabelClick((d: unknown) => { const a3 = (d as CityMarker).a3; if (a3) cbRef.current.onMarkerPick?.(a3); })
      .onLabelHover((d: unknown) => { el.style.cursor = d ? 'pointer' : 'grab'; })
      .onGlobeClick(() => cbRef.current.onDeselect?.());
    globeRef.current = globe;
    // Cap pixel ratio: full DPR on retina/4K quadruples fragment work for little gain.
    try { globe.renderer().setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5)); } catch { /* ignore */ }
    // Flat, even lighting: no directional light means no dark hemisphere / "3D shadow".
    try { globe.lights([new AmbientLight(0xffffff, 2.6)]); } catch { /* ignore */ }
    // Kill specular shine so the sphere looks like a flat map, not a glossy ball.
    try {
      const gm = globe.globeMaterial() as { shininess?: number; specular?: { set: (c: number) => void } };
      gm.shininess = 0;
      gm.specular?.set(0x000000);
    } catch { /* ignore */ }

    const controls = globe.controls() as { autoRotate: boolean; autoRotateSpeed: number; enableDamping: boolean };
    // Respect "reduce motion": don't auto-spin (also easier on phone battery/CPU).
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
    controls.autoRotate = !reduceMotion;
    controls.autoRotateSpeed = 0.35;
    controls.enableDamping = true;
    const stopSpin = () => { controls.autoRotate = false; };
    el.addEventListener('pointerdown', stopSpin, { once: true });

    globe.onZoom((p: Pov) => cbRef.current.onZoom?.(p));

    const resize = () => globe.width(el.clientWidth).height(el.clientHeight);
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(el);

    return () => {
      ro.disconnect();
      el.removeEventListener('pointerdown', stopSpin);
      (globe as unknown as { _destructor?: () => void })._destructor?.();
      globeRef.current = null;
      el.innerHTML = '';
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { globeRef.current?.polygonsData(polygons as unknown as object[]); }, [polygons]);
  useEffect(() => { globeRef.current?.labelsData((markers ?? []) as unknown as object[]); }, [markers]);
  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [statuses, selectedId, colorOverride]);
  useEffect(() => { if (pov) globeRef.current?.pointOfView(pov, 800); }, [pov]);
  useEffect(() => { globeRef.current?.globeImageUrl(globeImage); }, [globeImage]);

  return <div ref={elRef} className="globe-wrap" />;
}
