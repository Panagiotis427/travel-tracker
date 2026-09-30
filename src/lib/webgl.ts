let seen = false;

/**
 * Can this browser create a WebGL context? The probe's context is released at once. A yes is
 * remembered for the page's lifetime; a no is asked again next time, in case it was passing.
 */
export function webglAvailable(): boolean {
  if (seen) return true;
  try {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    seen = !!gl;
  } catch {
    // no WebGL
  }
  return seen;
}
