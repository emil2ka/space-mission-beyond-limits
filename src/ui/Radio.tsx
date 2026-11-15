// Tactical Radio (Crises and Blackout.md): 2 quick phrases per role → shared log + big for 2 s on every screen.
// In a blackout normal phrases wait (TITAN.radio.blackoutDelay), emergency ones pass if the channel is not off.
import { useEffect, useRef, useState } from 'react';
import type { FlightState, RadioMsg, RolePanel } from '../engine';
import { useGame } from '../store/game';
import { useT } from '../i18n';
import { RoleChip } from './components/common';
import { Icon } from './kit/Icon';

export function RadioButtons({ panel, f }: { panel: RolePanel; f: FlightState }) {
  const t = useT();
  const dispatch = useGame((s) => s.dispatch);
  const mine = (f.radio ?? []).filter((m) => m.role === panel.role && !m.delivered);
  return (
    <div className="radio stack gap-2">
      <div className="row row--between gap-2">
        <span className="section-title"><Icon name="act_radio" size={24} />Tactical Radio</span>
        {panel.blackout && <span className="chip chip--warn chip--sm"><Icon name="fl_blackout" size={24} />{panel.radio.channelOff ? t('radio.ui.channelOff') : t('radio.ui.boWait')}</span>}
      </div>
      <div className="radio-grid">
        {panel.radio.phrases.map((p) => (
          <button key={p.id} type="button" className={`btn radio-btn ${p.emergency ? 'radio-btn--emergency' : `radio-btn--${panel.role}`}`} onClick={() => dispatch({ type: 'radio', phrase: p.id })}
            title={p.emergency ? t('radio.ui.emergencyTitle') : t('radio.ui.normalTitle')}>
            <span className="radio-btn__phrase">{p.emergency && <span className="radio-btn__sos">SOS · </span>}{t.f(p, 'text').replace(/^[A-Z]+: /, '')}</span>
            {p.delayed && <span className="radio-btn__delay"><Icon name="fl_timer" size={20} />{t('radio.ui.delay', { n: p.delay })}</span>}
          </button>
        ))}
      </div>
      {mine.map((m) => (
        <div key={m.id} className="t-small t-warn row gap-2 row--nowrap"><Icon name="fl_timer" size={20} />{t('radio.ui.pending', { text: t.f(m, 'text'), n: Math.max(0, m.deliverTick - f.tick) })}</div>
      ))}
    </div>
  );
}

/** Shows each newly delivered radio phrase big for 2 s (everyone, whatever role). */
export function RadioOverlay({ f }: { f: FlightState }) {
  const t = useT();
  const delivered = (f.radio ?? []).filter((m) => m.delivered);
  const latest = delivered.length ? delivered.reduce((a, b) => (deliveredAt(b) >= deliveredAt(a) ? b : a)) : null;
  const seen = useRef<string | null>(latest?.id ?? null); // don't replay old messages on mount
  const [show, setShow] = useState<RadioMsg | null>(null);
  useEffect(() => {
    if (latest && latest.id !== seen.current) { seen.current = latest.id; setShow(latest); }
  }, [latest?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // Separate auto-off keyed on the shown message (StrictMode re-runs can't leave it stuck).
  useEffect(() => {
    if (!show) return;
    const id = setTimeout(() => setShow(null), 2000);
    return () => clearTimeout(id);
  }, [show]);
  if (!show) return null;
  const late = show.deliverTick - show.sentTick;
  return (
    <div className="radio-bubble radio-overlay" role="status" aria-live="assertive">
      <div className="radio-bubble__who"><Icon name="act_radio" size={24} /><RoleChip role={show.role}>{t('role.' + show.role)}</RoleChip></div>
      <div className="radio-bubble__text">{t.f(show, 'text')}</div>
      <div className="radio-bubble__meta">TACTICAL RADIO{late > 0 ? t('radio.ui.late', { n: late }) : ''}</div>
    </div>
  );
}

const deliveredAt = (m: RadioMsg) => m.deliverTick * 1000 + Number(m.id.slice(1));
