import { useEffect, useRef } from 'react';
import Globe from 'globe.gl';
import type { GlobeInstance } from 'globe.gl';
import type { CountryFeature } from './geo';
import { featureName } from './geo';
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
  onPick: (id: string) => void;
  onHover?: (id: string | null) => void;
  onZoom?: (altitude: number) => void;
  pov?: Pov | null;
}

export default function GlobeView({ polygons, statuses, selectedId, onPick, onHover, onZoom, pov }: Props) {
  const elRef = useRef<HTMLDivElement>(null);
  const globeRef = useRef<GlobeInstance | null>(null);
  const statusesRef = useRef(statuses);
  const selectedRef = useRef(selectedId);
  const hoverRef = useRef<string | null>(null);
  const cbRef = useRef({ onPick, onHover, onZoom });
  statusesRef.current = statuses;
  selectedRef.current = selectedId;
  cbRef.current = { onPick, onHover, onZoom };

  const idOf = (d: unknown) => String((d as CountryFeature).id);

  const capColor = (d: unknown): string => {
    const id = idOf(d);
    const st = statusesRef.current[id];
    const base = st ? STATUS_META[st].color : UNVISITED_COLOR;
    if (id === selectedRef.current) return lighten(base, 0.4);
    if (id === hoverRef.current) return lighten(base, 0.18);
    return base;
  };
  const altitude = (d: unknown): number => {
    const id = idOf(d);
    if (id === selectedRef.current) return 0.09;
    if (id === hoverRef.current) return 0.05;
    return statusesRef.current[id] ? 0.045 : 0.006;
  };
  const strokeColor = (d: unknown): string =>
    idOf(d) === selectedRef.current ? '#ffffff' : 'rgba(255,255,255,0.22)';

  const refresh = () => {
    globeRef.current?.polygonCapColor(capColor).polygonAltitude(altitude).polygonStrokeColor(strokeColor);
  };

  useEffect(() => {
    const el = elRef.current!;
    const globe: GlobeInstance = new Globe(el)
      .backgroundColor('#0b1f2a')
      .globeImageUrl(import.meta.env.BASE_URL + 'textures/earth-dark.jpg')
      .showAtmosphere(true)
      .atmosphereColor('#4aa8ff')
      .atmosphereAltitude(0.18)
      .polygonsTransitionDuration(250)
      .polygonCapColor(capColor)
      .polygonSideColor(() => 'rgba(120,140,155,0.15)')
      .polygonStrokeColor(strokeColor)
      .polygonAltitude(altitude)
      .polygonLabel((d: unknown) => {
        const f = d as CountryFeature;
        const st = statusesRef.current[idOf(f)];
        return `<div style="font:600 13px system-ui;color:#fff">${featureName(f)}</div>
                <div style="font:12px system-ui;color:#9fb4c2">${st ? STATUS_META[st].label : 'Tap to select'}</div>`;
      })
      .onPolygonClick((d: unknown) => cbRef.current.onPick(idOf(d)))
      .onPolygonHover((d: unknown) => {
        hoverRef.current = d ? idOf(d) : null;
        cbRef.current.onHover?.(hoverRef.current);
        refresh();
      });
    globeRef.current = globe;

    const controls = globe.controls() as { autoRotate: boolean; autoRotateSpeed: number; enableDamping: boolean };
    controls.autoRotate = true;
    controls.autoRotateSpeed = 0.35;
    controls.enableDamping = true;
    const stopSpin = () => { controls.autoRotate = false; };
    el.addEventListener('pointerdown', stopSpin, { once: true });

    globe.onZoom((p: { altitude: number }) => cbRef.current.onZoom?.(p.altitude));

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

  useEffect(() => {
    globeRef.current?.polygonsData(polygons as unknown as object[]);
  }, [polygons]);

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statuses, selectedId]);

  useEffect(() => {
    if (pov) globeRef.current?.pointOfView(pov, 800);
  }, [pov]);

  return <div ref={elRef} className="globe-wrap" />;
}
