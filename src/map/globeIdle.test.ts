import { describe, it, expect, vi, afterEach } from 'vitest';

// GlobeView renders on demand: it pauses the globe whenever nothing moves, so an idle page
// costs nothing. That only works if three-globe runs no requestAnimationFrame loop of its
// own. Up to 2.45.2 it did: importing it built throwaway layer instances whose tickers ran
// for the life of the page (vasturiano/three-globe#119, fixed in 2.45.3).
describe('three-globe', () => {
  afterEach(() => vi.unstubAllGlobals());

  // A cold first import of three.js and three-globe can outlast the default 5 s timeout.
  it('leaves no requestAnimationFrame loop running once imported', { timeout: 30_000 }, async () => {
    const pending = new Map<number, FrameRequestCallback>();
    let nextId = 1;
    const raf = (cb: FrameRequestCallback) => { pending.set(nextId, cb); return nextId++; };
    const caf = (id: number) => { pending.delete(id); };
    vi.stubGlobal('window', { requestAnimationFrame: raf, cancelAnimationFrame: caf });
    vi.stubGlobal('requestAnimationFrame', raf);
    vi.stubGlobal('cancelAnimationFrame', caf);

    await import('three-globe');
    // A running ticker re-arms on every frame; a paused or destroyed one does not.
    for (let frame = 1; frame <= 3; frame++) {
      const due = [...pending.values()];
      pending.clear();
      for (const cb of due) cb(frame * 16.7);
    }
    expect(pending.size).toBe(0);
  });
});
