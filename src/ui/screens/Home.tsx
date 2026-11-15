import { useState } from 'react';
import { useGame } from '../../store/game';
import { useT } from '../../i18n';
import { Icon } from '../kit/Icon';
import { Note } from '../components/common';
import { LangToggle } from '../components/LangToggle';

export function Home() {
  const t = useT();
  const { me, setName, create, join, connecting } = useGame();
  const mode = useGame((s) => s.transport?.mode);
  const [code, setCode] = useState('');
  const ready = !!me.id && !!me.name.trim() && !connecting;
  return (
    <div className="page page--center home">
      <div className="card card--cream home-card">
        <div className="card__head card__head--teal">
          <Icon name="act_launch" size={48} />
          <div className="grow">
            <h1 className="t-h2">SPACE MISSION</h1>
            <div className="t-eyebrow">{t('home.tagline')}</div>
          </div>
          <LangToggle />
        </div>
        <div className="stack">
          <label className="field">
            <span className="field__label">{t('home.nameLabel')}</span>
            <input className="input" value={me.name} onChange={(e) => setName(e.target.value)} maxLength={20} placeholder={t('home.namePlaceholder')} />
          </label>
          <button className="btn btn--primary btn--lg btn--block" disabled={!ready} onClick={() => create()}>
            <Icon name="act_launch" size={32} />{t('home.create')}
          </button>
          <div className="field">
            <span className="field__label">{t('home.haveCode')}</span>
            <div className="row row--nowrap">
              <input className="input t-mono home-code grow" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={6} placeholder={t('home.codePlaceholder')} aria-label={t('home.codeAria')} />
              <button className="btn btn--secondary" disabled={!ready || code.length !== 6} onClick={() => join(code)}><Icon name="act_add" size={24} />{t('home.join')}</button>
            </div>
          </div>
          <button className="btn btn--secondary btn--block" disabled={!ready} onClick={() => create({ demo: true })} title={t('home.demoTitle')}>
            <Icon name="act_play" size={24} />{t('home.demo')}
          </button>
          {connecting && <Note level="info">{t('home.connecting')}</Note>}
          {mode === 'local' && <Note level="info">{t('home.localMode')}</Note>}
        </div>
      </div>
    </div>
  );
}
