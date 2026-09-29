import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { startThreeGlobeTickersPaused, EXPECTED_SITES, THREE_GLOBE_ENTRY } from './threeGlobeTickers';

const require = createRequire(import.meta.url);

describe('three-globe ticker patch (build time)', () => {
  const entry = require.resolve('three-globe');
  const src = readFileSync(entry, 'utf8');

  it('targets the installed three-globe entry', () => {
    expect(THREE_GLOBE_ENTRY.test(entry)).toBe(true);
    expect(THREE_GLOBE_ENTRY.test('C:\\x\\node_modules\\three-globe\\dist\\three-globe.mjs')).toBe(true);
    expect(THREE_GLOBE_ENTRY.test('/x/node_modules/three-globe/dist/three-globe.min.js')).toBe(false);
  });

  it('starts every layer ticker paused', () => {
    const { code, count } = startThreeGlobeTickersPaused(src);
    expect(count).toBe(EXPECTED_SITES);
    expect(code).not.toMatch(/new FrameTicker(?:\$\d+)?\(\)/);
    expect(code.match(/new FrameTicker(?:\$\d+)?\(undefined, undefined, true\)/g)).toHaveLength(EXPECTED_SITES);
  });
});

type Ticker = { resume(): void; pause(): void };
type TickerCtor = new (maxFPS?: number, minFPS?: number, paused?: boolean) => Ticker;

describe('FrameTicker start-paused contract (why the patch stops the idle loops)', () => {
  const frames: Array<() => void> = [];
  let raf: ReturnType<typeof vi.fn>;
  let caf: ReturnType<typeof vi.fn>;
  const FrameTicker = (): TickerCtor => {
    const m = require('frame-ticker') as { default?: TickerCtor } & TickerCtor;
    return m.default ?? m;
  };

  beforeEach(() => {
    frames.length = 0;
    raf = vi.fn((cb: () => void) => { frames.push(cb); return frames.length; });
    caf = vi.fn();
    vi.stubGlobal('window', { requestAnimationFrame: raf, cancelAnimationFrame: caf });
  });

  it('an unpatched ticker starts looping as soon as it is built (the leak)', () => {
    new (FrameTicker())();
    expect(raf).toHaveBeenCalledTimes(1);
  });

  it('a patched ticker requests no frame until resumed, and stops for good when paused', () => {
    const t = new (FrameTicker())(undefined, undefined, true);
    expect(raf).not.toHaveBeenCalled();  // the throwaway instances' tickers stay like this
    t.resume();                          // the real globe's resumeAnimation()
    expect(raf).toHaveBeenCalledTimes(1);
    frames.shift()!();                   // a frame runs and re-arms the loop
    expect(raf).toHaveBeenCalledTimes(2);
    t.pause();
    expect(caf).toHaveBeenCalled();
    frames.shift()!();                   // even a frame that slipped through does not re-arm
    expect(raf).toHaveBeenCalledTimes(2);
  });
});
