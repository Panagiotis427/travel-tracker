import { describe, it, expect, vi, afterEach } from 'vitest';
import { webglAvailable } from './webgl';

// A fake document whose canvases hand out `ctx` (or no context at all).
function stubCanvas(ctx: object | null) {
  const loseContext = vi.fn();
  const getContext = vi.fn(() => (ctx ? { ...ctx, getExtension: () => ({ loseContext }) } : null));
  vi.stubGlobal('document', { createElement: () => ({ getContext }) });
  return { getContext, loseContext };
}

// Order matters: a yes is remembered for the page's lifetime, so the no cases run first.
describe('webglAvailable', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('says no without WebGL, trying webgl2 then webgl, and asks again next time', () => {
    const { getContext } = stubCanvas(null);
    expect(webglAvailable()).toBe(false);
    expect(webglAvailable()).toBe(false);
    expect(getContext.mock.calls.map((c) => (c as unknown[])[0])).toEqual(['webgl2', 'webgl', 'webgl2', 'webgl']);
  });

  it('says no when creating the canvas throws', () => {
    vi.stubGlobal('document', { createElement: () => { throw new Error('no canvas'); } });
    expect(webglAvailable()).toBe(false);
  });

  it('says yes, releases the probe context, and remembers the yes', () => {
    const first = stubCanvas({});
    expect(webglAvailable()).toBe(true);
    expect(first.loseContext).toHaveBeenCalledTimes(1);
    const second = stubCanvas(null);
    expect(webglAvailable()).toBe(true);
    expect(second.getContext).not.toHaveBeenCalled();
  });
});
