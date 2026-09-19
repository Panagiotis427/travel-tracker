import { useEffect, useRef } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import type { Region } from './types';
import type { StatusMap } from '../state/status';
import { STATUS_META, UNVISITED_COLOR } from '../state/status';
import { BASE_W, BASE_H, baseToLonLat } from './projection';
import { locate } from './pip';

interface View {
  k: number;
  tx: number;
  ty: number;
}

interface Props {
  regions: Region[];
  statuses: StatusMap;
  onToggle: (id: string) => void;
}

export default function MapCanvas({ regions, statuses, onToggle }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const view = useRef<View>({ k: 1, tx: 0, ty: 0 });
  const fitted = useRef(false);
  const regionsRef = useRef(regions);
  const statusesRef = useRef(statuses);
  regionsRef.current = regions;
  statusesRef.current = statuses;
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  function fitK(): number {
    const c = canvasRef.current!;
    return Math.min(c.width / BASE_W, c.height / BASE_H);
  }

  function fit(): void {
    const c = canvasRef.current!;
    const k = fitK();
    view.current = { k, tx: (c.width - BASE_W * k) / 2, ty: (c.height - BASE_H * k) / 2 };
    fitted.current = true;
  }

  function draw(): void {
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const { k, tx, ty } = view.current;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#0b1f2a'; // ocean
    ctx.fillRect(0, 0, c.width, c.height);

    ctx.setTransform(k, 0, 0, k, tx, ty);
    ctx.lineJoin = 'round';
    ctx.lineWidth = 0.4 / k;
    ctx.strokeStyle = 'rgba(11,31,42,0.55)';
    for (const r of regionsRef.current) {
      const st = statusesRef.current[r.id];
      ctx.fillStyle = st ? STATUS_META[st].color : UNVISITED_COLOR;
      ctx.fill(r.path);
      ctx.stroke(r.path);
    }
  }

  function toBase(clientX: number, clientY: number): [number, number] {
    const c = canvasRef.current!;
    const rect = c.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const sx = (clientX - rect.left) * dpr;
    const sy = (clientY - rect.top) * dpr;
    const { k, tx, ty } = view.current;
    return [(sx - tx) / k, (sy - ty) / k];
  }

  useEffect(() => {
    const c = canvasRef.current!;
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const rect = c.getBoundingClientRect();
      c.width = Math.max(1, Math.round(rect.width * dpr));
      c.height = Math.max(1, Math.round(rect.height * dpr));
      if (!fitted.current) fit();
      draw();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(c);
    resize();

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const [bx, by] = toBase(e.clientX, e.clientY);
      const factor = Math.exp(-e.deltaY * 0.0015);
      const min = fitK() * 0.9;
      const max = fitK() * 60;
      const nk = Math.min(Math.max(view.current.k * factor, min), max);
      const dpr = window.devicePixelRatio || 1;
      const rect = c.getBoundingClientRect();
      const sx = (e.clientX - rect.left) * dpr;
      const sy = (e.clientY - rect.top) * dpr;
      view.current = { k: nk, tx: sx - bx * nk, ty: sy - by * nk };
      draw();
    };
    c.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      ro.disconnect();
      c.removeEventListener('wheel', onWheel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Redraw when data changes.
  useEffect(() => {
    draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regions, statuses]);

  function onPointerDown(e: ReactPointerEvent) {
    (e.target as Element).setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, moved: false };
  }

  function onPointerMove(e: ReactPointerEvent) {
    const d = drag.current;
    if (!d) return;
    const dpr = window.devicePixelRatio || 1;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) d.moved = true;
    view.current = { ...view.current, tx: view.current.tx + dx * dpr, ty: view.current.ty + dy * dpr };
    d.x = e.clientX;
    d.y = e.clientY;
    draw();
  }

  function onPointerUp(e: ReactPointerEvent) {
    const d = drag.current;
    drag.current = null;
    if (d && !d.moved) {
      const [bx, by] = toBase(e.clientX, e.clientY);
      const [lon, lat] = baseToLonLat(bx, by);
      const hit = locate(regionsRef.current, [lon, lat]);
      if (hit) onToggle(hit.id);
    }
  }

  return (
    <canvas
      ref={canvasRef}
      className="map-canvas"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    />
  );
}
