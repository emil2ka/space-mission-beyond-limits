// «!» button on every screen, next to the settings gear: says where artificial intelligence was used in the project.
// Same popover behaviour as SoundSettings: click outside or Esc closes it.
import { useEffect, useRef, useState } from 'react';
import { useT } from '../../i18n';
import { Icon, type IconName } from '../kit/Icon';
import './AiNotice.css';

const AI_ITEMS: { key: string; icon: IconName }[] = [
  { key: 'models', icon: 'dept_structure' },
  { key: 'ui', icon: 'act_settings' },
  { key: 'concepts', icon: 'mis_titan' },
  { key: 'texts', icon: 'fl_log' },
];

export function AiNotice() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', esc); };
  }, [open]);

  return (
    <div className="ai-notice" ref={box}>
      <button type="button" className="btn btn--icon ai-notice__btn" aria-label={t('ai.aria')} aria-expanded={open} title={t('ai.title')}
        onClick={() => setOpen((o) => !o)} data-testid="ai-notice">
        <span className="ai-notice__mark" aria-hidden>!</span>
      </button>
      {open && (
        <div className="ai-notice__panel card card--cream card--tight" role="dialog" aria-label={t('ai.title')}>
          <div className="card__head card__head--warn">
            <span className="ai-notice__badge" aria-hidden>!</span>
            <span className="card__title">{t('ai.title')}</span>
          </div>
          <p className="ai-notice__intro">{t('ai.intro')}</p>
          <ul className="ai-notice__list">
            {AI_ITEMS.map(({ key, icon }) => (
              <li key={key} className="ai-notice__item">
                <Icon name={icon} size={32} />
                <div>
                  <div className="setting__title">{t(`ai.${key}.title`)}</div>
                  <p className="setting__hint">{t(`ai.${key}.text`)}</p>
                </div>
              </li>
            ))}
          </ul>
          <div className="ai-notice__item ai-notice__item--team">
            <Icon name="role_commander" size={32} />
            <div>
              <div className="setting__title">{t('ai.team.title')}</div>
              <p className="setting__hint">{t('ai.team.text')}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
