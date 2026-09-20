import { useEffect, useRef } from 'react';
import Globe from 'globe.gl';
import type { GlobeInstance } from 'globe.gl';
import { AmbientLight } from 'three';
import type { CountryFeature } from './geo';
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
}

export default function GlobeView({ polygons, statuses, selectedId, globeImage, onPick, onDeselect, onHover, onZoom, pov, colorOverride }: Props) {
  const elRef = useRef<HTMLDivElement>(null);
  const globeRef = useRef<GlobeInstance | null>(null);
  const statusesRef = useRef(statuses);
  const selectedRef = useRef(selectedId);
  const hoverRef = useRef<string | null>(null);
  const coRef = useRef(colorOverride);
  const cbRef = useRef({ onPick, onDeselect, onHover, onZoom });
  statusesRef.current = statuses;
  selectedRef.current = selectedId;
  coRef.current = colorOverride;
  cbRef.current = { onPick, onDeselect, onHover, onZoom };

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
      .polygonSideColor(() => 'rgba(120,140,155,0.15)')
      .polygonStrokeColor(strokeColor)
      .polygonAltitude(0.01)
      .onPolygonClick((d: unknown) => cbRef.current.onPick(idOf(d)))
      .onPolygonHover((d: unknown) => {
        // No recolor here (that re-renders every polygon per hover = laggy).
        // The name shows in the HTML banner via onHover; only the cursor changes.
        hoverRef.current = d ? idOf(d) : null;
        el.style.cursor = d ? 'pointer' : 'grab';
        cbRef.current.onHover?.(hoverRef.current);
      })
      .onGlobeClick(() => cbRef.current.onDeselect?.());
    globeRef.current = globe;
    // Cap pixel ratio: full DPR on retina/4K quadruples fragment work for little gain.
    try { globe.renderer().setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5)); } catch { /* ignore */ }
    // Flat, even lighting: no directional light means no dark hemisphere / "3D shadow".
    try { globe.lights([new AmbientLight(0xffffff, 2.6)]); } catch { /* ignore */ }

    const controls = globe.controls() as { autoRotate: boolean; autoRotateSpeed: number; enableDamping: boolean };
    controls.autoRotate = true;
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
  useEffect(() => { refresh(); /* eslint-disable-next-line */ }, [statuses, selectedId, colorOverride]);
  useEffect(() => { if (pov) globeRef.current?.pointOfView(pov, 800); }, [pov]);
  useEffect(() => { globeRef.current?.globeImageUrl(globeImage); }, [globeImage]);

  return <div ref={elRef} className="globe-wrap" />;
}
