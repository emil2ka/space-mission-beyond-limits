// RU/EN switch (decision 0013 §5). Each player picks their own language; nothing goes through the room.
import { LANGS, useLang, useT } from '../../i18n';

export function LangToggle({ className = '' }: { className?: string }) {
  const t = useT();
  const setLang = useLang((s) => s.setLang);
  return (
    <div className={`row row--nowrap lang-toggle ${className}`} role="group" aria-label={t('lang.label')} data-testid="lang-toggle">
      {LANGS.map((l) => (
        <button key={l} type="button" className={`btn ${t.lang === l ? 'btn--primary' : 'btn--secondary'}`} aria-pressed={t.lang === l} onClick={() => setLang(l)} data-lang={l}>
          {t(`lang.${l}`)}
        </button>
      ))}
    </div>
  );
}
