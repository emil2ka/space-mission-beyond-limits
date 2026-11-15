// Graphics quality (M5): resolves the Low / High / Auto setting to what the 3D scenes get (src/scene/quality.tsx).
// Auto = Low on phones / tablets (coarse pointer + small screen), on weak hardware (≤ 4 GB memory or ≤ 2 cores
// when the browser tells us) and on software / old or budget integrated GPUs; High otherwise. Checked once per page load.
// Device QA (2026-11-15): plus a runtime guard — if a scene on Auto→High runs under SLOW_FPS for 5 s, Auto drops to Low
// (event `sm:slowfps` from src/scene/quality.tsx) and remembers it on this device (`sm:autoLow`).
import { useSyncExternalStore } from 'react';
import type { Quality } from '../scene/quality';
import { useSettings, type GraphicsSetting } from './settings';
import { tIn, type Lang, type Msg } from '../i18n';

/**
 * Software GL, old / budget integrated GPUs. Intel «HD Graphics …» (any) and «UHD Graphics 6xx» / bare «UHD Graphics»
 * (Celeron / Pentium / i3 school laptops; UHD 7xx desktop parts are fine), Mali-4xx/7xx and budget Mali-G31/G51/G52/G57,
 * Adreno 2xx–5xx, PowerVR, GMA.
 */
export const WEAK_GPU = /swiftshader|llvmpipe|softpipe|software|basic render|mali-[47]|mali-g(31|51|52|57)\b|adreno \(tm\) [2-5]\d\d|powervr|intel\(r\) hd graphics( [2-5]\d{2,3})?\b|uhd graphics(?! [7-9]\d\d)|gma/i;

function gpuName(): string {
  try {
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl') ?? c.getContext('experimental-webgl')) as WebGLRenderingContext | null;
    if (!gl) return 'none';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return name;
  } catch { return ''; }
}

export interface AutoReason { quality: Quality; why: string }

// `why` stays the Russian text (stable for tests / logs); the message behind it is kept aside for other languages.
const WHY = new WeakMap<AutoReason, Msg>();
function reason(quality: Quality, msg: Msg | null): AutoReason {
  const r: AutoReason = { quality, why: msg ? tIn('ru', msg.k, msg.p) : '' };
  if (msg) WHY.set(r, msg);
  return r;
}
/** The Auto reason in a language (for the settings hint): `autoWhy(auto, t.lang)`. */
export function autoWhy(r: AutoReason, lang: Lang): string {
  const m = WHY.get(r);
  return m ? tIn(lang, m.k, m.p) : r.why;
}

/** What the device tells us (pure input of pickAuto, so the rule is unit-tested). */
export interface DeviceHints {
  coarse: boolean;
  /** Shorter side of the screen, CSS px. */
  shortSide: number;
  memory?: number;
  cores?: number;
  gpu: string;
  /** FPS the runtime guard measured on High earlier on this device (sm:autoLow), if any. */
  slowFps?: number;
}

/** The Auto rule. */
export function pickAuto(d: DeviceHints): AutoReason {
  let why: Msg | null = null;
  if (d.coarse && d.shortSide < 820) why = { k: 'gfx.phone' };
  else if (d.memory !== undefined && d.memory <= 4) why = { k: 'gfx.memory', p: { n: d.memory } };
  else if (d.cores !== undefined && d.cores > 0 && d.cores <= 2) why = { k: 'gfx.cores', p: { n: d.cores } };
  else if (d.gpu === 'none' || WEAK_GPU.test(d.gpu)) why = { k: 'gfx.gpu' };
  else if (d.slowFps !== undefined) why = { k: 'gfx.slow', p: { n: d.slowFps } };
  return reason(why ? 'low' : 'high', why);
}

const AUTO_LOW_KEY = 'sm:autoLow';
/** Below this many FPS on High (5 s average, after 3 s warm-up), Auto switches to Low. */
export const SLOW_FPS = 40;

let cached: AutoReason | null = null;
const listeners = new Set<() => void>();

/** What Auto resolves to on this device (+ a short reason for the settings hint). */
export function autoQuality(): AutoReason {
  if (cached) return cached;
  if (typeof window === 'undefined') return { quality: 'high', why: '' };
  const nav = navigator as Navigator & { deviceMemory?: number };
  let slowFps: number | undefined;
  try { const v = Number(localStorage.getItem(AUTO_LOW_KEY)); if (v > 0) slowFps = v; } catch { /* storage blocked */ }
  cached = pickAuto({
    coarse: matchMedia('(pointer: coarse)').matches,
    shortSide: Math.min(screen.width, screen.height),
    memory: nav.deviceMemory,
    cores: navigator.hardwareConcurrency,
    gpu: gpuName(),
    slowFps,
  });
  return cached;
}

/** Runtime guard: a scene measured low FPS on High. Only Auto reacts (an explicit High stays High). */
function onSlowFps(fps: number) {
  if (useSettings.getState().graphics !== 'auto' || autoQuality().quality === 'low') return;
  const n = Math.max(1, Math.round(fps));
  cached = reason('low', { k: 'gfx.slow', p: { n } });
  try { localStorage.setItem(AUTO_LOW_KEY, String(n)); } catch { /* storage blocked */ }
  listeners.forEach((l) => l());
}

if (typeof window !== 'undefined') {
  window.addEventListener('sm:slowfps', (e) => onSlowFps(Number((e as CustomEvent<number>).detail)));
  // Choosing High by hand forgets the measured slowness: the next Auto probes again.
  useSettings.subscribe((s, prev) => {
    if (s.graphics === 'high' && prev.graphics !== 'high') { try { localStorage.removeItem(AUTO_LOW_KEY); } catch { /* ignore */ } }
  });
}

const subscribeAuto = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

/** autoQuality() as a hook: re-renders when the runtime guard drops Auto to Low. */
export function useAutoQuality(): AutoReason {
  return useSyncExternalStore(subscribeAuto, autoQuality, autoQuality);
}

export const resolveQuality = (g: GraphicsSetting): Quality => (g === 'auto' ? autoQuality().quality : g);

/** The resolved quality for <XxxScene quality={…}>. */
export function useGraphicsQuality(): Quality {
  const g = useSettings((s) => s.graphics);
  const auto = useAutoQuality();
  return g === 'auto' ? auto.quality : g;
}

/** [setting, setter] for the settings panel. */
export function useGraphicsSetting(): [GraphicsSetting, (v: GraphicsSetting) => void] {
  return [useSettings((s) => s.graphics), useSettings((s) => s.setGraphics)];
}
