// Settings button on every screen (ТЗ screen 19 «Настройки доступности»): sound on/off, volumes, «без резких звуков»,
// plus the existing accessibility / graphics toggles. Dev builds also show the audio event log and a test button per sound.
import { useEffect, useReducer, useRef, useState } from 'react';
import { audio, playUi } from '../../audio';
import { ALL_SFX, type SfxId } from '../../audio/events';
import { useSettings } from '../settings';
import { A11yToggles } from './common';
import { LangToggle } from './LangToggle';
import { useT } from '../../i18n';
import { Icon } from '../kit/Icon';
import './SoundSettings.css';

/** Dev sound names: dictionary keys sound.sfx.<id>. */
const sfxKey = (id: SfxId) => `sound.sfx.${id}`;

function Slider({ label, value, onChange, disabled }: { label: string; value: number; onChange(v: number): void; disabled?: boolean }) {
  const v = Math.round(value * 100);
  return (
    <label className="setting setting--slider">
      <span className="setting__title">{label}</span>
      <input className="slider" type="range" min={0} max={100} step={5} value={v} disabled={disabled} style={{ ['--val' as string]: `${v}%` }}
        onChange={(e) => onChange(Number(e.target.value) / 100)} aria-label={label} />
      <span className="t-mono">{v}</span>
    </label>
  );
}

function Toggle({ on, onChange, label }: { on: boolean; onChange(v: boolean): void; label: string }) {
  const t = useT();
  return (
    <button type="button" className="toggle" role="switch" aria-checked={on} aria-label={label} onClick={() => onChange(!on)}>
      <span className="toggle__knob" /><span className="toggle__text">{on ? t('sound.on') : t('sound.off')}</span>
    </button>
  );
}

const DEV = import.meta.env.DEV;

export function SoundSettings() {
  const t = useT();
  const s = useSettings();
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const [, redraw] = useReducer((x: number) => x + 1, 0);
  const [test, setTest] = useState<SfxId>('crisis');

  useEffect(() => (open && DEV ? audio.subscribe(redraw) : undefined), [open]);
  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('pointerdown', close);
    window.addEventListener('keydown', esc);
    return () => { window.removeEventListener('pointerdown', close); window.removeEventListener('keydown', esc); };
  }, [open]);

  return (
    <div className="sound-settings" ref={box}>
      <button className="btn btn--icon ss-gear" aria-label={t('sound.gearAria')} aria-expanded={open} title={t('sound.gearTitle')}
        onClick={() => setOpen((o) => !o)}>
        <Icon name={s.soundOn ? 'act_sound' : 'act_sound_off'} size={32} />
      </button>
      {open && (
        <div className="ss-panel card card--cream card--tight" role="dialog" aria-label={t('sound.settings')}>
          <div className="card__head card__head--teal"><Icon name="act_settings" size={32} /><span className="card__title">{t('sound.settings')}</span></div>
          <div className="settings">
            <div className="setting">
              <Icon name="res_signal" size={32} />
              <div><div className="setting__title">Language / Язык</div></div>
              <LangToggle />
            </div>
            <div className="setting">
              <Icon name={s.soundOn ? 'act_sound' : 'act_sound_off'} size={32} />
              <div><div className="setting__title">{t('sound.sound')}</div><div className="setting__hint">{t('sound.soundHint')}</div></div>
              <Toggle on={s.soundOn} label={t('sound.sound')} onChange={(v) => s.setSound({ soundOn: v })} />
            </div>
            <Slider label={t('sound.master')} value={s.masterVolume} disabled={!s.soundOn} onChange={(v) => s.setSound({ masterVolume: v })} />
            <Slider label={t('sound.ambience')} value={s.ambienceVolume} disabled={!s.soundOn} onChange={(v) => s.setSound({ ambienceVolume: v })} />
            <Slider label={t('sound.sfx')} value={s.sfxVolume} disabled={!s.soundOn} onChange={(v) => s.setSound({ sfxVolume: v })} />
            <div className="setting">
              <Icon name="st_info" size={32} />
              <div><div className="setting__title">{t('sound.soft')}</div><div className="setting__hint">{t('sound.softHint')}</div></div>
              <Toggle on={s.softSounds} label={t('sound.soft')} onChange={(v) => s.setSound({ softSounds: v })} />
            </div>
            <div className="setting setting--plain" data-no-click-sound>
              <button className="btn btn--sm btn--secondary" disabled={!s.soundOn} onClick={() => playUi('approve', true)}><Icon name="act_play" size={20} />{t('sound.test')}</button>
            </div>
          </div>
          <div className="section-title ss-sub"><Icon name="act_settings" size={24} />{t('sound.a11y')}</div>
          <A11yToggles />
          {DEV && (
            <details className="ss-dev">
              <summary>{t('sound.dev', { state: audio.state, loops: audio.loopNames.join(', ') || t('sound.silence') })}</summary>
              <div className="row gap-2" data-no-click-sound>
                <span className="select-wrap grow">
                  <select className="select" value={test} onChange={(e) => setTest(e.target.value as SfxId)}>
                    {ALL_SFX.map((id) => <option key={id} value={id}>{t(sfxKey(id))}</option>)}
                  </select>
                </span>
                <button className="btn btn--sm btn--icon" aria-label={t('sound.play')} onClick={() => playUi(test, true)}><Icon name="act_play" size={20} /></button>
              </div>
              <ol className="ss-log t-mono">
                {audio.log.slice(0, 12).map((e, i) => (
                  <li key={i} className={e.played ? '' : 't-muted'}>{new Date(e.at).toLocaleTimeString()} {e.played ? '▶' : '·'} {e.name}{e.note ? ` — ${e.note}` : ''}</li>
                ))}
              </ol>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
