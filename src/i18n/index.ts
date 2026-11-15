// i18n for the UI: language store (per player, never synced through the room) + t().
import { useCallback } from 'react';
import { create } from 'zustand';
import { EN, RU } from './dict';
import { DATA_EN } from './data.en';
import { isMsg, render, type Dict, type Lang, type Msg, type Params } from './format';

export type { Lang, Msg, Params } from './format';
export { LANGS } from './format';

const KEY = 'sm:lang';
function initialLang(): Lang {
  try { const s = localStorage.getItem(KEY); if (s === 'ru' || s === 'en') return s; } catch { /* ignore */ }
  const nav = typeof navigator !== 'undefined' ? navigator.language || '' : '';
  return nav.toLowerCase().startsWith('ru') ? 'ru' : 'en';
}
const applyDoc = (l: Lang) => { if (typeof document !== 'undefined') document.documentElement.lang = l; };

export const useLang = create<{ lang: Lang; setLang(l: Lang): void }>((set) => ({
  lang: initialLang(),
  setLang(l) { try { localStorage.setItem(KEY, l); } catch { /* ignore */ } applyDoc(l); set({ lang: l }); },
}));
applyDoc(useLang.getState().lang);

const DICTS: Record<Lang, Dict> = { ru: RU, en: EN };

/** Data text (component captions, mission goals, phase names…): the engine keeps Russian, English comes from DATA_EN. */
export function tdIn(lang: Lang, s: string): string {
  return lang === 'en' ? DATA_EN[s] ?? s : s;
}

export function tIn(lang: Lang, key: string, params?: Params): string {
  return render(lang, DICTS[lang], { k: key, p: params }, { fallback: RU, str: (s) => tdIn(lang, s) });
}

/** Message from the engine, or plain engine/data text when there is no message. */
export function tmIn(lang: Lang, msg: Msg | string | undefined | null, fallback = ''): string {
  if (isMsg(msg)) return tIn(lang, msg.k, msg.p);
  return tdIn(lang, typeof msg === 'string' ? msg : fallback);
}

/** Field of an engine object that carries `i18n: { [field]: Msg }` next to its Russian text. */
export function tfIn<T extends object>(lang: Lang, obj: T | undefined | null, field: keyof T & string): string {
  if (!obj) return '';
  const m = (obj as { i18n?: Record<string, Msg | undefined> }).i18n?.[field];
  const raw = (obj as Record<string, unknown>)[field];
  return m ? tIn(lang, m.k, m.p) : tdIn(lang, typeof raw === 'string' ? raw : '');
}

/** Array field (`effects: string[]`) with `i18n: { effects: Msg[] }` aligned to it. */
export function tflIn<T extends object>(lang: Lang, obj: T | undefined | null, field: keyof T & string): string[] {
  if (!obj) return [];
  const raw = (obj as Record<string, unknown>)[field];
  const ms = (obj as { i18n?: Record<string, unknown> }).i18n?.[field];
  const arr = Array.isArray(raw) ? (raw as unknown[]) : [];
  return arr.map((s, i) => { const m = Array.isArray(ms) ? ms[i] : undefined; return isMsg(m) ? tIn(lang, m.k, m.p) : tdIn(lang, String(s)); });
}

/** Non-reactive helpers (read the current language). Inside components prefer useT(). */
export const t = (key: string, params?: Params) => tIn(useLang.getState().lang, key, params);
export const td = (s: string) => tdIn(useLang.getState().lang, s);
export const tm = (msg: Msg | string | undefined | null, fallback = '') => tmIn(useLang.getState().lang, msg, fallback);
export const tf = <T extends object>(obj: T | undefined | null, field: keyof T & string) => tfIn(useLang.getState().lang, obj, field);

/** Reactive t(): re-renders the component when the language changes. Also gives td/tm/tf bound to the same language. */
export function useT() {
  const lang = useLang((s) => s.lang);
  const fn = useCallback((key: string, params?: Params) => tIn(lang, key, params), [lang]);
  return Object.assign(fn, {
    lang,
    d: (s: string) => tdIn(lang, s),
    m: (msg: Msg | string | undefined | null, fallback = '') => tmIn(lang, msg, fallback),
    f: <T extends object>(obj: T | undefined | null, field: keyof T & string) => tfIn(lang, obj, field),
    fl: <T extends object>(obj: T | undefined | null, field: keyof T & string) => tflIn(lang, obj, field),
  });
}
export type T = ReturnType<typeof useT>;
