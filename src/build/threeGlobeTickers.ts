// BUILD-TIME helper, used by vite.config.ts; the app never imports it.
//
// three-globe's arcs, paths and rings layers each create a FrameTicker (a
// requestAnimationFrame loop) that starts running the moment it is constructed. At import
// time three-globe builds throwaway instances it never disposes: linkKapsule makes a dummy
// of every layer to read its defaults, and fromKapsule builds a whole globe state just to
// list its methods. The arcs and paths layers start their tickers when built, so four loops
// run for the life of the page and it never goes idle, even with the globe paused. Starting
// every such ticker paused fixes it without timing tricks: the real globe resumes its
// tickers through resumeAnimation() whenever it renders; the throwaway ones never are.

/** FrameTicker's constructor is (maxFPS?, minFPS?, paused?); undefined keeps its defaults. */
const SITE = /new (FrameTicker(?:\$\d+)?)\(\)/g;

/** The three layer tickers in three-globe 2.x. A different count means the library changed. */
export const EXPECTED_SITES = 3;

/** Matches three-globe's ESM entry, whatever the path separator. */
export const THREE_GLOBE_ENTRY = /[\\/]three-globe[\\/]dist[\\/]three-globe\.mjs$/;

export function startThreeGlobeTickersPaused(code: string): { code: string; count: number } {
  let count = 0;
  const out = code.replace(SITE, (_m, cls: string) => {
    count++;
    return `new ${cls}(undefined, undefined, true)`;
  });
  return { code: out, count };
}
