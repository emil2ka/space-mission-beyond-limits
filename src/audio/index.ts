// Hook-up of the sound engine to the stores. Screens don't know about sound: everything comes from
// state changes (events.ts) + a delegated quiet click on any <button>. App calls startAudio() once.
import { useGame } from '../store/game';
import { useSettings } from '../ui/settings';
import { AudioEngine } from './engine';
import { audibility, layersFor, snapshotOf, soundEvents, type SfxId } from './events';

export const audio = new AudioEngine();
export type { SfxId } from './events';

/** For the few places that need an explicit sound (none of the screens today; the settings «test» button). */
export function playUi(id: SfxId, force = false) { audio.play(id, force); }

/** Subscribe to the game + settings stores, unlock on the first gesture, gate by tab focus. Returns cleanup. */
export function startAudio(): () => void {
  if (typeof window === 'undefined') return () => {};
  const offs: (() => void)[] = [];
  const on = <K extends keyof WindowEventMap>(t: EventTarget, type: K | string, fn: (e: Event) => void, opts?: AddEventListenerOptions) => {
    t.addEventListener(type, fn, opts);
    offs.push(() => t.removeEventListener(type, fn, opts));
  };

  // Settings → volumes.
  const applySettings = () => {
    const s = useSettings.getState();
    audio.setVolumes({ on: s.soundOn, master: s.masterVolume, ambience: s.ambienceVolume, sfx: s.sfxVolume, soft: s.softSounds });
  };
  applySettings();
  offs.push(useSettings.subscribe(applySettings));

  // Focus / visibility → who may hear.
  const applyGate = () => {
    const mode = useGame.getState().transport?.mode ?? null;
    audio.setGate(audibility(mode, document.hasFocus(), document.visibilityState === 'visible'));
  };
  applyGate();
  on(window, 'focus', applyGate);
  on(window, 'blur', applyGate);
  on(document, 'visibilitychange', applyGate);

  // Autoplay policy: the context starts on the first real gesture. Clicks on buttons also make the quiet UI tick.
  const unlock = () => { audio.unlock(); applyGate(); };
  on(window, 'pointerdown', unlock, { capture: true });
  on(window, 'keydown', unlock, { capture: true });
  on(document, 'click', (e) => {
    const el = (e.target as Element | null)?.closest?.('button, [role="button"], input[type="checkbox"], input[type="radio"]');
    if (el && !(el as HTMLButtonElement).disabled && !el.closest('[data-no-click-sound]')) audio.play('click');
  }, { capture: true });

  // Game state → one-shots + layers.
  let prev = snapshotOf(useGame.getState().room);
  audio.setLayers(layersFor(prev));
  offs.push(useGame.subscribe((s, old) => {
    if (s.transport?.mode !== old.transport?.mode) applyGate();
    if (s.room === old.room) return;
    const next = snapshotOf(s.room);
    for (const id of soundEvents(prev, next)) audio.play(id);
    audio.setLayers(layersFor(next));
    prev = next;
  }));

  if (import.meta.env.DEV) Object.assign(window as object, { __smAudio: audio, __smSettings: useSettings });
  return () => { offs.forEach((f) => f()); audio.close(); };
}
