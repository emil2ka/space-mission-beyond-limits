// Graphics quality for every 3D scene (M5). The UI resolves Low / High / Auto (src/ui/settings.ts) and passes the
// result as the `quality` prop; each scene puts it into QualityContext inside its <Canvas>, so deep pieces
// (particle emitters, rain, stars, asteroid LOD, ink outlines) read it with useQuality() without prop drilling.
// Low: dpr 1, no shadows, no ink outlines, ½ particles / rain / stars, asteroid always lod1, no antialias.
// Device QA: FpsGuard — on High a sustained < 40 FPS asks Auto to drop to Low (src/ui/graphics.ts); on Low a sustained
// < 26 FPS lowers the 3D resolution once to dpr 0.75 for the rest of the session (the HTML UI stays sharp).
// The signal-noise overlay (StaticNoise) stays on both — it is gameplay information, not decoration.
import { Stars } from '@react-three/drei';
import { useThree } from '@react-three/fiber';
import { createContext, useContext, useEffect, type ComponentProps, type ReactNode } from 'react';
import { outlineMaterial } from './models/toon';

export type Quality = 'low' | 'high';

const QualityContext = createContext<Quality>('high');

export const useQuality = (): Quality => useContext(QualityContext);

/** Low's pixel ratio: 1, or LOW_DPR_FLOOR after FpsGuard measured a slow Low (kept for the session, every scene). */
let lowDpr = 1;
const LOW_DPR_FLOOR = 0.75;

/** Canvas pixel ratio: Low = 1 (0.75 on a device that was still slow on Low), High = the scene's own range. */
export const qualityDpr = (q: Quality | undefined, high: number | [number, number] = [1, 1.5]): number | [number, number] =>
  q === 'low' ? lowDpr : high;

/** Multiplier for particle pools, rain drops and star counts. */
export const qualityScale = (q: Quality) => (q === 'low' ? 0.5 : 1);

/** Scale a count by the current quality (at least 1). */
export function useQualityCount(n: number): number {
  return Math.max(1, Math.round(n * qualityScale(useQuality())));
}

/** drei <Stars> with the count scaled by quality (half on Low). */
export function QStars(props: ComponentProps<typeof Stars>) {
  const count = useQualityCount(props.count ?? 5000);
  return <Stars {...props} count={count} />;
}

/** WebGL context options per quality (antialias costs a lot of fill rate on phones). */
export const qualityGl = (q: Quality | undefined) => ({ powerPreference: 'high-performance' as const, antialias: q !== 'low' });

/**
 * Put inside a <Canvas>: provides the quality to the scene graph and applies the global switches
 * (the shared ink-outline material is hidden on Low — one flag hides every outline hull).
 */
export function QualityProvider({ quality = 'high', children }: { quality?: Quality; children: ReactNode }) {
  return (
    <QualityContext.Provider value={quality}>
      <QualityApply q={quality} />
      <FpsGuard q={quality} />
      {children}
    </QualityContext.Provider>
  );
}

function QualityApply({ q }: { q: Quality }) {
  useEffect(() => { outlineMaterial().visible = q !== 'low'; }, [q]);
  return null;
}

// ---------- runtime guard (Device QA): sustained low FPS → High asks Auto for Low; Low lowers the 3D resolution ----------

/** Must match SLOW_FPS in src/ui/graphics.ts (kept here so the scene layer does not import UI code). */
const SLOW_FPS = 40;
/** Low below this → dpr LOW_DPR_FLOOR. */
const LOW_SLOW_FPS = 26;
const WARM_MS = 3000;
const WINDOW_MS = 5000;
let slowReported = false;

/**
 * Averages FPS over 5 s windows (after a 3 s warm-up for shader compiles / model loads). High: fires the `window` event
 * `sm:slowfps` (detail = fps) once per page under SLOW_FPS. Low: under LOW_SLOW_FPS sets dpr LOW_DPR_FLOOR once.
 * A gap > 0.5 s between frames (hidden tab, alert, GC storm on load) restarts the measurement.
 */
function FpsGuard({ q }: { q: Quality }) {
  const setDpr = useThree((s) => s.setDpr);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (q === 'high' ? slowReported : lowDpr <= LOW_DPR_FLOOR) return;
    let raf = 0, start = -1, prev = -1, t0 = -1, frames = 0;
    const loop = (t: number) => {
      if (start < 0 || t - prev > 500 || document.visibilityState !== 'visible') { start = t; t0 = -1; frames = 0; }
      prev = t;
      if (t - start >= WARM_MS) {
        if (t0 < 0) { t0 = t; frames = 0; } else frames++;
        if (t0 >= 0 && t - t0 >= WINDOW_MS) {
          const fps = (frames * 1000) / (t - t0);
          if (q === 'high' && fps < SLOW_FPS) {
            slowReported = true;
            window.dispatchEvent(new CustomEvent('sm:slowfps', { detail: fps }));
            return;
          }
          if (q === 'low' && fps < LOW_SLOW_FPS) {
            lowDpr = LOW_DPR_FLOOR;
            setDpr(lowDpr);
            return;
          }
          t0 = t; frames = 0;
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [q, setDpr]);
  return null;
}

// ---------- dev frame counter (?dev=1): window.__sm_fps → { fps, calls, triangles } ----------

declare global {
  interface Window { __sm_fps?: { fps: number; calls: number; triangles: number; quality: Quality; dpr: number } }
}

/** Dev-only FPS / renderer.info probe; reads the last second. Mounted by scenes when ?dev=1. */
export function FpsProbe() {
  const gl = useThree((s) => s.gl);
  const q = useQuality();
  useEffect(() => {
    let frames = 0, last = performance.now(), raf = 0;
    const loop = () => {
      frames++;
      const now = performance.now();
      if (now - last >= 1000) {
        window.__sm_fps = { fps: Math.round((frames * 1000) / (now - last)), calls: gl.info.render.calls, triangles: gl.info.render.triangles, quality: q, dpr: gl.getPixelRatio() };
        frames = 0; last = now;
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [gl, q]);
  return null;
}

/** Dev scene pages: `?scene=titan&q=low` forces a quality (default High). */
export const DEV_QUALITY: Quality | undefined = typeof location !== 'undefined' && ['low', 'high'].includes(new URLSearchParams(location.search).get('q') ?? '')
  ? (new URLSearchParams(location.search).get('q') as Quality) : undefined;

export const DEV_FPS = import.meta.env.DEV && typeof location !== 'undefined' && new URLSearchParams(location.search).get('dev') === '1';
