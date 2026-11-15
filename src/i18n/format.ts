// Tiny i18n core (decision 0013 §5). Pure: no React, no store — the engine uses it to build Russian text from keys.
export type Lang = 'ru' | 'en';
export const LANGS: Lang[] = ['ru', 'en'];

/** A translatable message: dictionary key + params. Params may be nested messages. */
export interface Msg { k: string; p?: Params }
export type Param = string | number | Msg | null | undefined;
export type Params = Record<string, Param>;
export type Dict = Record<string, string>;

export const isMsg = (v: unknown): v is Msg => !!v && typeof v === 'object' && typeof (v as Msg).k === 'string';

/** Plural form: ru one/few/many, en one/other. */
function pluralIndex(lang: Lang, n: number): number {
  n = Math.abs(Math.trunc(n));
  if (lang === 'en') return n === 1 ? 0 : 1;
  const d = n % 10, dd = n % 100;
  if (d === 1 && dd !== 11) return 0;
  if (d >= 2 && d <= 4 && (dd < 12 || dd > 14)) return 1;
  return 2;
}

/**
 * Fill a template. `{name}` → param; `{n|минута|минуты|минут}` → plural form of the word for param n.
 * `resolve` turns a nested Msg or a string param into text of the same language.
 */
export function interpolate(lang: Lang, tpl: string, p: Params | undefined, resolve: (v: Param) => string): string {
  if (!p) return tpl;
  return tpl.replace(/\{(\w+)(\|[^}]*)?\}/g, (all, name: string, forms?: string) => {
    if (!(name in p)) return all;
    const v = p[name];
    if (forms) {
      const list = forms.slice(1).split('|');
      return list[Math.min(pluralIndex(lang, Number(v) || 0), list.length - 1)] ?? '';
    }
    return resolve(v);
  });
}

/** Render a message with one dictionary (and an optional fallback dictionary). */
export function render(lang: Lang, dict: Dict, msg: Msg, opts: { fallback?: Dict; str?: (s: string) => string } = {}): string {
  const resolve = (v: Param): string => (v === null || v === undefined ? '' : typeof v === 'number' ? String(v) : typeof v === 'string' ? (opts.str ? opts.str(v) : v) : render(lang, dict, v, opts));
  // Built-in `_join`: params a0..aN joined with `sep` (lists of names / sentences built by the engine).
  if (msg.k === '_join') {
    const p = msg.p ?? {};
    const out: string[] = [];
    for (let i = 0; `a${i}` in p; i++) { const s = resolve(p[`a${i}`]); if (s) out.push(s); }
    return out.join(typeof p.sep === 'string' ? p.sep : ', ');
  }
  const tpl = dict[msg.k] ?? opts.fallback?.[msg.k] ?? msg.k;
  return interpolate(lang, tpl, msg.p, resolve);
}
