// Local (per tab) overlay screens on top of the room stage: the HQ and the mission preparation.
// They are views of room.agency, not engine stages: everyone can look, the engine checks who may press
// (unlock / upgrades / prep = commander or host, decision 0011 + M3 contract). App resets the view when the stage changes.
import { create } from 'zustand';

export type OverlayView = 'hq' | 'prep' | null;
/** Where confirmPrep goes next: «Ещё раз» → build (same mission), from the HQ → lobby (pick a mission). */
export type PrepNext = 'build' | 'lobby';

interface ViewStore {
  view: OverlayView;
  prepNext: PrepNext;
  open(view: OverlayView, prepNext?: PrepNext): void;
  close(): void;
}

export const useView = create<ViewStore>((set) => ({
  view: null,
  prepNext: 'build',
  open: (view, prepNext) => set((s) => ({ view, prepNext: prepNext ?? s.prepNext })),
  close: () => set({ view: null }),
}));
