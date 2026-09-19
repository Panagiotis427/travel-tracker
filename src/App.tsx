import { useEffect, useMemo, useState } from 'react';
import MapCanvas from './map/MapCanvas';
import { loadRegions } from './map/geo';
import type { Region } from './map/types';
import {
  STATUS_META,
  UNVISITED_COLOR,
  nextStatus,
  loadStatuses,
  saveStatuses,
} from './state/status';
import type { Status, StatusMap } from './state/status';

const LAYERS = { '50m': 'geo/world_50m.topojson', '110m': 'geo/world_110m.topojson' } as const;
type LayerKey = keyof typeof LAYERS;

export default function App() {
  const [layer, setLayer] = useState<LayerKey>('50m');
  const [regions, setRegions] = useState<Region[]>([]);
  const [statuses, setStatuses] = useState<StatusMap>(() => loadStatuses());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    loadRegions(import.meta.env.BASE_URL + LAYERS[layer])
      .then((r) => {
        if (alive) {
          setRegions(r);
          setLoading(false);
        }
      })
      .catch((e) => {
        console.error(e);
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [layer]);

  useEffect(() => {
    saveStatuses(statuses);
  }, [statuses]);

  function toggle(id: string) {
    setStatuses((prev) => {
      const nx = nextStatus(prev[id]);
      const copy = { ...prev };
      if (nx === null) delete copy[id];
      else copy[id] = nx;
      return copy;
    });
  }

  function reset() {
    if (window.confirm('Clear all marks?')) setStatuses({});
  }

  const counts = useMemo(() => {
    const c: Record<Status, number> = { visited: 0, want: 0, lived: 0, transit: 0 };
    for (const s of Object.values(statuses)) c[s]++;
    return c;
  }, [statuses]);

  const beenTotal = counts.visited + counts.lived;
  const pct = regions.length ? Math.round((beenTotal / regions.length) * 100) : 0;

  return (
    <div className="app">
      <aside className="sidebar">
        <h1>Scratch Map</h1>
        <p className="sub">Tap a country to cycle its status. Everything stays on your device.</p>

        <div className="stat">
          <div className="stat-big">{pct}%</div>
          <div className="stat-label">
            {beenTotal} of {regions.length || '…'} countries marked been-there
          </div>
        </div>

        <ul className="legend">
          {(Object.keys(STATUS_META) as Status[]).map((s) => (
            <li key={s}>
              <span className="swatch" style={{ background: STATUS_META[s].color }} />
              {STATUS_META[s].label}
              <b>{counts[s]}</b>
            </li>
          ))}
          <li>
            <span className="swatch" style={{ background: UNVISITED_COLOR }} />
            Unvisited
          </li>
        </ul>

        <div className="row">
          <label htmlFor="detail">Detail</label>
          <select id="detail" value={layer} onChange={(e) => setLayer(e.target.value as LayerKey)}>
            <option value="50m">High (50m)</option>
            <option value="110m">Fast (110m)</option>
          </select>
        </div>

        <button className="reset" onClick={reset}>
          Reset all
        </button>
        <footer>{loading ? 'Loading map…' : `${regions.length} regions loaded`}</footer>
      </aside>

      <main className="map-wrap">
        <MapCanvas regions={regions} statuses={statuses} onToggle={toggle} />
      </main>
    </div>
  );
}
