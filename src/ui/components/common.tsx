// Shared UI pieces on the comic UI kit (src/ui/kit, docs/05 Assets/UI/kit/README.md): top bar, meters, role chips,
// demo role switch, accessibility toggles, «Выйти из комнаты» modal.
import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { COMPONENT_BY_ID, electHost, ROLES, rolesOf, type Department, type MissionId, type RoleId } from '../../engine';
import { useGame, useMe } from '../../store/game';
import { useDisableFlash, useReducedMotion } from '../settings';
import { autoWhy, useAutoQuality, useGraphicsSetting } from '../graphics';
import { Icon, type IconName } from '../kit/Icon';
import { ModuleIcon } from '../kit/ModuleIcon';
import { t as tNow, useT } from '../../i18n';

/** Engine roles; `name` reads the current language (non-reactive: components re-render via their own useT()). */
export const ROLE_BY_ID = Object.fromEntries(ROLES.map((r) => [r.id, Object.defineProperty({ ...r }, 'name', { get: () => tNow(`role.${r.id}`), enumerable: true })])) as Record<RoleId, (typeof ROLES)[number]>;
export const roleName = (r: RoleId | null | undefined) => (r ? ROLE_BY_ID[r].name : tNow('common.ui.noRole'));

/** Record of dictionary words `${prefix}.${id}` read in the current language (non-reactive getters; components re-render via useT()). */
export const tKeys = <K extends string>(prefix: string, ids: readonly K[]): Record<K, string> =>
  Object.defineProperties({} as Record<K, string>, Object.fromEntries(ids.map((id) => [id, { get: () => tNow(`${prefix}.${id}`), enumerable: true }])));

/** Short role words (current language). */
export const ROLE_SHORT: Record<RoleId, string> = tKeys('common.ui.roleShort', ROLES.map((r) => r.id));
export const ROLE_ICON: Record<RoleId, IconName> = { commander: 'role_commander', engineer: 'role_engineer', science: 'role_science', comms: 'role_comms' };
export const DEPT_ICON: Record<Department, IconName> = {
  power: 'dept_power', propulsion: 'dept_propulsion', navigation: 'dept_navigation', science: 'dept_science',
  comms: 'dept_comms', structure: 'dept_structure', recovery: 'dept_recovery',
};
export const MISSION_ICON: Record<MissionId, IconName> = { titan: 'mis_titan', asteroid: 'mis_asteroid' };

/** Ticks → «m:ss» of mission time (TICK_SECONDS = 1 → real seconds). */
export const mmss = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

export type Level = 'ok' | 'warn' | 'bad' | 'info';
/** Text colour class for a status level (the kit maps it per surface: cream / night). */
export const LEVEL_CLASS: Record<Level, string> = { ok: 't-ok', warn: 't-warn', bad: 't-crit', info: 't-muted' };
export const LEVEL_ICON: Record<Level, IconName> = { ok: 'st_ok', warn: 'st_warn', bad: 'st_crit', info: 'st_info' };

export type Tone = 'ok' | 'warn' | 'crit' | 'gold' | 'teal' | 'alt';
/** Load-style tone: > 100 % crit, > 90 % warn, else ok. */
export const loadTone = (k: number): Tone => (k > 1 ? 'crit' : k > 0.9 ? 'warn' : 'ok');

/** Kit meter (.meter): icon + label + value, ink track, chunky fill. */
export function Meter({ k, tone, label, value, icon, compact, status, k2 }: {
  k: number; tone?: Tone; label?: ReactNode; value?: ReactNode; icon?: IconName; compact?: boolean; status?: ReactNode;
  /** Second (front) fill, e.g. «sent» over «collected». */ k2?: number;
}) {
  const t = tone ?? loadTone(k);
  const cls = t === 'crit' ? 'meter--crit' : t === 'warn' ? 'meter--warn' : t === 'gold' ? 'meter--gold' : t === 'ok' ? 'meter--ok' : '';
  const w = (x: number) => `${Math.max(0, Math.min(x, 1)) * 100}%`;
  return (
    <div className={`meter ${cls} ${compact ? 'meter--compact' : ''}`}>
      {(label || value) && (
        <div className="meter__head">
          {icon && <Icon name={icon} size={24} />}
          <span className="meter__label">{label}</span>
          {value !== undefined && <span className="meter__value">{value}</span>}
        </div>
      )}
      <div className="meter__track">
        <i className={`meter__fill ${t === 'alt' ? 'meter__fill--alt' : ''}`} style={{ width: w(k) }} />
        {k2 !== undefined && <i className="meter__fill meter__fill--front" style={{ width: w(k2) }} />}
        {k > 1 && <i className="meter__over" style={{ width: `${Math.min(40, (k - 1) * 100)}%` }} />}
      </div>
      {status && <div className="meter__status">{status}</div>}
    </div>
  );
}

/** Role chip: icon + role colour + word. */
export function RoleChip({ role, children, lg }: { role: RoleId; children?: ReactNode; lg?: boolean }) {
  const t = useT();
  return <span className={`chip chip--${role} ${lg ? 'chip--lg' : ''}`}><Icon name={ROLE_ICON[role]} size={24} />{children ?? t(`role.${role}`)}</span>;
}

/** Local / demo mode, as chips in the top bar (the full explanation sits in the title and on the home / lobby screens). */
export function ModeChips() {
  const t = useT();
  const room = useGame((s) => s.room);
  const mode = useGame((s) => s.transport?.mode);
  const local = mode === 'local';
  if (!local && !room?.demo) return null;
  return (
    <span className="row gap-2 mode-chips">
      {local && (
        <span className="chip chip--demo" title={t('common.ui.localTitle')} data-testid="demo-banner">
          <Icon name="st_info" size={24} />{t('common.ui.local')}
        </span>
      )}
      {room?.demo && (
        <span className="chip chip--demo" title={t('common.ui.demoTitle')}>
          <Icon name="st_warn" size={24} />{t('common.ui.demo')}
        </span>
      )}
    </span>
  );
}

/** Night top bar of a screen: brand icon + title (+ sub), spacer, right-side items. Leaves room for the fixed settings button. */
export function TopBar({ icon, title, sub, children }: { icon: IconName; title: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  return (
    <header className="topbar app-topbar">
      <div className="topbar__brand">
        <Icon name={icon} size={32} />
        <div className="topbar__text">
          <div className="topbar__title">{title}</div>
          {sub && <div className="topbar__sub">{sub}</div>}
        </div>
      </div>
      <ModeChips />
      <span className="topbar__spacer" />
      {children}
    </header>
  );
}

/** «Вы: Главный инженер» chip for the top bar. */
export function MeChip() {
  const t = useT();
  const me = useMe();
  if (!me?.role) return <span className="chip chip--night chip--text">{t('common.ui.noRolePicked')}</span>;
  // 0013 §4: a player may hold several roles (2–3 players).
  const roles = rolesOf(me);
  if (roles.length > 1) return <span className="topbar-me row gap-1">{roles.map((r, i) => <RoleChip key={r} role={r} lg={i === 0}>{i === 0 ? t('common.ui.you', { who: t(`common.ui.roleShort.${r}`) }) : t(`common.ui.roleShort.${r}`)}</RoleChip>)}</span>;
  return <span className="topbar-me"><RoleChip role={me.role} lg>{t('common.ui.you', { who: t(`role.${me.role}`) })}</RoleChip></span>;
}

/** MC balance pill. */
export function McChip({ value, testId }: { value: number; testId?: string }) {
  return <span className="mc mc--compact" data-testid={testId}><Icon name="res_credits" size={24} className="ic--coin-img" />{value}<span className="mc__unit">MC</span></span>;
}

/**
 * Local demo mode: one player can switch roles to see every panel and close crises
 * (the engine waits for every role with options in demo rooms). Roles held by other tabs stay locked.
 */
export function DemoRoleSwitch({ label }: { label?: string }) {
  const t = useT();
  const room = useGame((s) => s.room);
  const dispatch = useGame((s) => s.dispatch);
  const me = useMe();
  if (!room?.demo || !me) return null;
  return (
    <div className="role-switch stack gap-2" role="group" aria-label={t('common.ui.switchRoleAria')}>
      <span className="t-eyebrow t-muted">{label ?? t('common.ui.demoRole')}</span>
      <div className="seg role-switch__seg">
        {ROLES.map((r) => {
          const holder = room.players.find((p) => p.role === r.id && p.id !== me.id);
          const on = me.role === r.id;
          return (
            <button key={r.id} type="button" className={`seg__item seg__item--${r.id}`} aria-pressed={on} disabled={!!holder} title={holder ? t('common.ui.takenBy', { name: holder.name }) : t(`role.${r.id}`)}
              onClick={() => !on && dispatch({ type: 'pickRole', role: r.id })}>
              <Icon name={ROLE_ICON[r.id]} size={20} /><span className="role-switch__name">{t(`common.ui.roleShort.${r.id}`)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Kit checkbox (.checkbox): hidden native input + ink box. */
export function Check({ checked, onChange, children, disabled, testId }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode; disabled?: boolean; testId?: string }) {
  return (
    <label className={`checkbox ${checked ? 'is-checked' : ''} ${disabled ? 'is-disabled' : ''}`}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} data-testid={testId} />
      <span className="checkbox__box" aria-hidden>{checked ? '✓' : ''}</span>
      <span>{children}</span>
    </label>
  );
}

/** Reduced Motion / Disable Flash toggles + graphics quality (compact, for panel footers and the settings popover). */
export function A11yToggles() {
  const [rm, setRm] = useReducedMotion();
  const [nf, setNf] = useDisableFlash();
  return (
    <div className="a11y stack gap-2">
      <div className="row gap-4">
        <Check checked={rm} onChange={setRm}>Reduced Motion</Check>
        <Check checked={nf} onChange={setNf}>Disable Flash</Check>
      </div>
      <GraphicsToggle />
    </div>
  );
}


/** Graphics quality Low / High / Auto (M5): Auto shows what it picked on this device. */
export function GraphicsToggle() {
  const t = useT();
  const [g, setG] = useGraphicsSetting();
  const auto = useAutoQuality();
  return (
    <div className="row gap-2 gfx" role="group" aria-label={t('common.ui.gfxAria')}>
      <span className="t-small">{t('common.ui.gfx')}</span>
      <div className="seg">
        {(['auto', 'low', 'high'] as const).map((v) => (
          <button key={v} type="button" className="seg__item" aria-pressed={g === v} onClick={() => setG(v)}
            title={v === 'auto' ? `${t('common.ui.gfxNow', { q: auto.quality === 'low' ? 'Low' : 'High' })}${auto.why ? ` (${autoWhy(auto, t.lang)})` : ''}` : undefined}>
            {t(`common.ui.gfx.${v}`)}{v === 'auto' && g === 'auto' ? ` · ${auto.quality === 'low' ? 'Low' : 'High'}` : ''}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Kit modal over a backdrop, portalled to <body> (fixed, above every screen). */
export function Modal({ onClose, icon, title, titleId, children, actions }: {
  onClose: () => void; icon?: ReactNode; title: ReactNode; titleId: string; children: ReactNode; actions: ReactNode;
}) {
  return createPortal(
    <div className="app-portal">
      <div className="backdrop backdrop--fixed" role="presentation" onClick={onClose} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
        <div className="modal" role="alertdialog" aria-modal="true" aria-labelledby={titleId} onClick={(e) => e.stopPropagation()}>
          <div className="modal__icon">{icon}<h3 className="modal__title" id={titleId}>{title}</h3></div>
          {children}
          <div className="modal__actions">{actions}</div>
        </div>
      </div>
    </div>,
    document.querySelector('.app') ?? document.body,
  );
}

/**
 * «Выйти из комнаты» during the build / review / flight (M5) with a confirmation. Mid-game the engine keeps the
 * player's slot and role (OFFLINE, can come back with the room code); the host is warned who takes over.
 */
export function LeaveRoom({ className = '' }: { className?: string }) {
  const t = useT();
  const room = useGame((s) => s.room);
  const myId = useGame((s) => s.me.id);
  const online = useGame((s) => s.online);
  const leave = useGame((s) => s.leave);
  const [ask, setAsk] = useState(false);
  if (!room) return null;
  const isHost = room.hostId === myId;
  const others = new Set(online.length ? online.filter((id) => id !== myId) : room.players.filter((p) => p.online && p.id !== myId).map((p) => p.id));
  const nextId = isHost ? electHost({ hostId: '', players: room.players }, others) : null;
  const next = room.players.find((p) => p.id === nextId);
  return (
    <>
      <button type="button" className={`btn btn--danger btn--sm leave-btn ${className}`} onClick={() => setAsk(true)} data-testid="leave-room">
        <Icon name="act_exit" size={20} />{t('common.ui.leave')}
      </button>
      {ask && (
        <Modal onClose={() => setAsk(false)} titleId="leave-title" icon={<Icon name="act_exit" size={48} />} title={<>{t('common.ui.leaveQ', { code: room.code })}</>}
          actions={<>
            <button type="button" className="btn btn--secondary" autoFocus onClick={() => setAsk(false)}>{t('common.ui.stay')}</button>
            <button type="button" className="btn btn--danger" onClick={() => { setAsk(false); leave(); }} data-testid="leave-confirm"><Icon name="act_exit" size={24} />{t('common.ui.exit')}</button>
          </>}>
          <p className="modal__text">
            {t('common.ui.leaveText')}<b className="t-mono">{room.code}</b>.
          </p>
          {isHost && (
            <div className="note note--warn">
              <Icon name="st_warn" size={24} />
              <span>{t('common.ui.youHost')} {next ? <>{t('common.ui.nextHost')}<b>{next.name}</b>{next.role ? ` (${t(`role.${next.role}`)})` : ''}.</> : t('common.ui.noOthers')}</span>
            </div>
          )}
        </Modal>
      )}
    </>
  );
}

/** Icon + text note line (warn / crit / info / ok) — status always as icon + word. */
export function Note({ level = 'warn', children, className = '', testId }: { level?: Level; children: ReactNode; className?: string; testId?: string }) {
  const cls = level === 'bad' ? 'note--crit' : level === 'warn' ? 'note--warn' : level === 'ok' ? 'note--ok' : 'note--info';
  return <div className={`note ${cls} ${className}`} data-testid={testId}><Icon name={LEVEL_ICON[level]} size={24} /><div className="note__text">{children}</div></div>;
}

/** Kit heat gauge (.gauge): cold / norm / hot / limit zones + needle. Thresholds = engine THERMAL (or the panel's copy). */
export function HeatGauge({ heat, t, value, level }: {
  heat: number; t: { freezing: number; cold: number; hot: number; overheat: number }; value?: ReactNode; level?: Level;
}) {
  const tr = useT();
  const lo = t.freezing - 40, hi = t.overheat + 40;
  const k = (v: number) => (Math.max(lo, Math.min(hi, v)) - lo) / (hi - lo);
  const pct = (v: number) => `${k(v) * 100}%`;
  return (
    <div className="gauge">
      <div className="meter__head">
        <Icon name="res_heat" size={24} />
        <span className="meter__label">{tr('common.ui.heat')}</span>
        <span className={`meter__value ${level ? LEVEL_CLASS[level] : ''}`}>{value ?? heat}</span>
      </div>
      <div className="gauge__scale">
        <div className="gauge__zones">
          <i className="gauge__zone gauge__zone--crit" style={{ ['--w' as string]: k(t.freezing) }} />
          <i className="gauge__zone gauge__zone--cold" style={{ ['--w' as string]: k(t.cold) - k(t.freezing) }} />
          <i className="gauge__zone gauge__zone--norm" style={{ ['--w' as string]: k(t.hot) - k(t.cold) }} />
          <i className="gauge__zone gauge__zone--hot" style={{ ['--w' as string]: k(t.overheat) - k(t.hot) }} />
          <i className="gauge__zone gauge__zone--crit" style={{ ['--w' as string]: 1 - k(t.overheat) }} />
        </div>
        <i className="gauge__limit" style={{ left: pct(t.overheat) }} />
        <i className="gauge__needle" style={{ left: pct(heat) }} />
      </div>
      <div className="gauge__labels"><span>{tr('common.ui.gauge.freezing')}</span><span>{tr('common.ui.gauge.cold')}</span><span>{tr('common.ui.gauge.norm')}</span><span>{tr('common.ui.gauge.hot')}</span><span>{tr('common.ui.gauge.limit')}</span></div>
    </div>
  );
}

const SEV = {
  critical: { cls: 'check-line--block', word: 'common.ui.sev.critical', icon: 'st_crit' },
  warn: { cls: 'check-line--warn', word: 'common.ui.sev.warn', icon: 'st_warn' },
  info: { cls: 'check-line--info', word: 'common.ui.sev.info', icon: 'st_info' },
} as const;

/** One build issue as a kit check line (icon + word + text); clickable when `onClick` is given. */
export function IssueLine({ severity, text, title, onClick, selected, compact = true, modules, mission }: {
  severity: 'critical' | 'warn' | 'info'; text: ReactNode; title?: ReactNode; onClick?: () => void; selected?: boolean; compact?: boolean;
  /** Component ids behind the issue: up to 3 module icons at the end of the line. */ modules?: readonly string[]; mission?: MissionId;
}) {
  const t = useT();
  const s = SEV[severity];
  const mods = [...new Set(modules ?? [])].filter((id) => COMPONENT_BY_ID[id]).slice(0, 3);
  const body = (
    <>
      <span className="check-line__badge"><Icon name={s.icon} size={24} /></span>
      <span className="min0">
        <span className="check-line__title">{title}<span className="check-line__word">{t(s.word)}</span></span>
        <span className="check-line__reason">{text}</span>
      </span>
      <span className="check-line__end">
        {mods.length > 0 && <span className="check-line__mods">{mods.map((id) => <ModuleIcon key={id} id={id} mission={mission} size={32} title={COMPONENT_BY_ID[id].name} />)}</span>}
        {onClick && <span className="check-line__go" aria-hidden />}
      </span>
    </>
  );
  const cls = `check-line ${s.cls} ${compact ? 'check-line--compact' : ''} ${onClick ? '' : 'check-line--static'}`;
  return onClick
    ? <button type="button" className={cls} aria-pressed={!!selected} onClick={onClick}>{body}</button>
    : <div className={cls}>{body}</div>;
}
