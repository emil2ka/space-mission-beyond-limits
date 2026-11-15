import { create } from 'zustand';

/**
 * Accessibility settings (ТЗ §9.1, §13). Shared store, so a toggle in one place applies to every screen.
 * Reduced Motion: respects the OS setting by default, can be overridden. Disable Flash: no blinking indicators.
 */
const os = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
const read = (key: string, fallback: boolean) => {
  try { const s = localStorage.getItem(key); return s === null ? fallback : s === '1'; } catch { return fallback; }
};
const write = (key: string, v: boolean) => { try { localStorage.setItem(key, v ? '1' : '0'); } catch { /* ignore */ } };

export type GraphicsSetting = 'auto' | 'low' | 'high';
const readGraphics = (): GraphicsSetting => {
  try { const s = localStorage.getItem('sm:graphics'); return s === 'low' || s === 'high' ? s : 'auto'; } catch { return 'auto'; }
};

interface Settings {
  reducedMotion: boolean;
  disableFlash: boolean;
  /** Graphics quality (M5): Auto picks Low on phones / weak GPUs (src/ui/graphics.ts). */
  graphics: GraphicsSetting;
  setGraphics(v: GraphicsSetting): void;
  setReducedMotion(v: boolean): void;
  setDisableFlash(v: boolean): void;
  /** Sound (M5, src/audio): on/off, volumes 0..1 (master, ambience/music, effects), «без резких звуков». */
  soundOn: boolean;
  masterVolume: number;
  ambienceVolume: number;
  sfxVolume: number;
  softSounds: boolean;
  setSound(v: Partial<SoundSettings>): void;
}

export type SoundSettings = Pick<Settings, 'soundOn' | 'masterVolume' | 'ambienceVolume' | 'sfxVolume' | 'softSounds'>;
const readVol = (key: string, fallback: number) => {
  try { const n = Number(localStorage.getItem(key)); return localStorage.getItem(key) === null || !Number.isFinite(n) ? fallback : Math.min(1, Math.max(0, n)); } catch { return fallback; }
};
const SOUND_KEYS: Record<keyof SoundSettings, string> = {
  soundOn: 'sm:soundOn', masterVolume: 'sm:volMaster', ambienceVolume: 'sm:volAmbience', sfxVolume: 'sm:volSfx', softSounds: 'sm:softSounds',
};

export const useSettings = create<Settings>((set) => ({
  reducedMotion: read('sm:reducedMotion', os),
  disableFlash: read('sm:disableFlash', false),
  graphics: readGraphics(),
  setGraphics(v) { try { localStorage.setItem('sm:graphics', v); } catch { /* ignore */ } set({ graphics: v }); },
  setReducedMotion(v) { write('sm:reducedMotion', v); set({ reducedMotion: v }); },
  setDisableFlash(v) { write('sm:disableFlash', v); set({ disableFlash: v }); },
  soundOn: read(SOUND_KEYS.soundOn, true),
  masterVolume: readVol(SOUND_KEYS.masterVolume, 0.6),
  ambienceVolume: readVol(SOUND_KEYS.ambienceVolume, 0.5),
  sfxVolume: readVol(SOUND_KEYS.sfxVolume, 0.7),
  softSounds: read(SOUND_KEYS.softSounds, false),
  setSound(v) {
    for (const [k, val] of Object.entries(v) as [keyof SoundSettings, number | boolean][]) {
      try { localStorage.setItem(SOUND_KEYS[k], typeof val === 'boolean' ? (val ? '1' : '0') : String(val)); } catch { /* ignore */ }
    }
    set(v);
  },
}));

export function useReducedMotion(): [boolean, (v: boolean) => void] {
  const v = useSettings((s) => s.reducedMotion);
  const setV = useSettings((s) => s.setReducedMotion);
  return [v, setV];
}

export function useDisableFlash(): [boolean, (v: boolean) => void] {
  const v = useSettings((s) => s.disableFlash);
  const setV = useSettings((s) => s.setDisableFlash);
  return [v, setV];
}
