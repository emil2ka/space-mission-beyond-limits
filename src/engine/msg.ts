// Engine messages (decision 0013 §5): the engine keeps its Russian text (tests, logs) and attaches a key + params,
// so the UI can render the same message in the player's language. Russian text is rendered from the ru dictionary.
import { RU } from '../i18n/dict';
import { render, type Msg, type Params } from '../i18n/format';

export type { Msg, Params } from '../i18n/format';

/** Build a message. */
export const m = (k: string, p?: Params): Msg => (p ? { k, p } : { k });
/** Russian text of a message (what the engine stores in its `text` fields). */
export const ru = (msg: Msg): string => render('ru', RU, msg);
/** Message + its Russian text in one go: `{ text, msg }`. */
export const mt = (k: string, p?: Params) => { const msg = m(k, p); return { text: ru(msg), msg }; };
/** Join messages / strings with a separator, skipping empty parts (rendered per language). */
export const join = (parts: (Msg | string | null | undefined | false)[], sep = ''): Msg => {
  const p: Params = { sep };
  parts.filter((x): x is Msg | string => !!x).forEach((x, i) => { p[`a${i}`] = x; });
  return { k: '_join', p };
};
