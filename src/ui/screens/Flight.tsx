// Screens 14–16: launch, Mission Control, crisis layer (docs/03 Design/Screens.md, Crises and Blackout.md).
// The engine runs on the host (store ticks); this screen only reads room.flight and sends actions.
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  COMPONENT_BY_ID, MISSIONS, panelFor, rolesOf, signalStates, SITE_BY_ID, TITAN,
  type AsteroidPanel, type Build, type CapsuleStage, type CrisisRecord, type FlightState, type RoleId, type RolePanel, type ScienceMode,
} from '../../engine';
import { AsteroidScene } from '../../scene/AsteroidScene';
import { LaunchScene } from '../../scene/LaunchScene';
import { ReturnScene } from '../../scene/ReturnScene';
import { TitanScene } from '../../scene/TitanScene';
import type { Quality } from '../../scene/quality';
import { useT, type T } from '../../i18n';
import { DEV_SPEED, useGame, useMe } from '../../store/game';
import {
  A11yToggles, DemoRoleSwitch, HeatGauge, LeaveRoom, LEVEL_CLASS, MeChip, Meter, MISSION_ICON, mmss, Note, ROLE_ICON, RoleChip, TopBar, type Level,
} from '../components/common';
import { Icon, type IconName } from '../kit/Icon';
import { useDisableFlash, useReducedMotion } from '../settings';
import { RadioButtons, RadioOverlay } from '../Radio';
import { CrisisTaskWidget, ReaimCard, widgetOption } from '../tasks/FlightTasks';
import { RoleTabs, rolesToAnswer, useRoleTab } from '../rules/RoleTabs';
import { TRUST_TEXT, TrustChip } from '../rules/Trust';
import { useGraphicsQuality } from '../graphics';

export function Flight() {
  const stage = useGame((s) => s.room!.stage);
  return stage === 'launch' ? <Launch /> : <MissionControl />;
}

function Launch() {
  const t = useT();
  const room = useGame((s) => s.room)!;
  const dispatch = useGame((s) => s.dispatch);
  const isHost = useGame((s) => s.room?.hostId === s.me.id);
  const [reducedMotion] = useReducedMotion();
  const quality = useGraphicsQuality();
  const [waiting, setWaiting] = useState(false);
  return (
    <div className="launch-screen viewport viewport--bare">
      <LaunchScene build={room.build} mission={room.mission} reducedMotion={reducedMotion} quality={quality} skippable={isHost}
        onDone={() => (isHost ? dispatch({ type: 'launchDone' }) : setWaiting(true))} />
      {waiting && (
        <div className="launch-wait toast toast--warn">
          <span className="toast__badge"><Icon name="fl_timer" size={24} /></span>
          <div><div className="toast__title">{t('flight.waitHost')}</div><div className="toast__text">{t('flight.waitHostText')}</div></div>
        </div>
      )}
    </div>
  );
}

/** Panel parts hidden from a role (names: flight.hidden.<id>). */
const HIDDEN_IDS = new Set(['position', 'signal-detail', 'data-queue', 'power-lines', 'instrument-detail', 'crisis-causes']);

function MissionControl() {
  const t = useT();
  const room = useGame((s) => s.room)!;
  const me = useMe();
  const [reducedMotion] = useReducedMotion();
  const [noFlash] = useDisableFlash();
  const quality = useGraphicsQuality();
  const f = room.flight;
  const mission = MISSIONS[room.mission];
  // 0013 §4: a player with several roles gets a tab per role; each tab sees exactly what that role sees.
  const myRoles = useMemo(() => (room.demo ? (me?.role ? [me.role] : []) : rolesOf(me)), [room.demo, me]);
  const [role, setTab] = useRoleTab(myRoles, f);
  const panel = useMemo(() => (f && role ? panelFor(role, f, room.build) : null), [f, role, room.build]);
  // Radio phrases of every role of mine (one block per role).
  const radioPanels = useMemo(() => (f && myRoles.length > 1 ? myRoles.map((r) => (r === role && panel ? panel : panelFor(r, f, room.build))) : undefined), [f, myRoles, role, panel, room.build]);
  const needs = rolesToAnswer(f, myRoles);

  // «Эффект катастрофы»: 0.7 s glitch + big CRITICAL EVENT when a new crisis starts.
  const crisisId = f?.crisis?.id ?? null;
  const [glitch, setGlitch] = useState(false);
  const [banner, setBanner] = useState(false);
  const [result, setResult] = useState<CrisisRecord | null>(null);
  const lastCrisis = useRef<string | null>(null);
  useEffect(() => {
    if (crisisId && crisisId !== lastCrisis.current) {
      lastCrisis.current = crisisId;
      setResult(null);
      setBanner(true);
      if (!reducedMotion) setGlitch(true);
    } else if (!crisisId && lastCrisis.current) {
      const rec = f?.history.find((h) => h.id === lastCrisis.current) ?? f?.history.at(-1) ?? null;
      lastCrisis.current = null;
      setBanner(false);
      setResult(rec);
    }
  }, [crisisId]); // eslint-disable-line react-hooks/exhaustive-deps
  useAutoOff(glitch, () => setGlitch(false), 700);
  useAutoOff(banner, () => setBanner(false), 2600);
  useAutoOff(!!result, () => setResult(null), 9000);

  if (!f) return <div className="page page--center"><Note level="info">{t('flight.preparing')}</Note></div>;
  const phase = mission.phases[f.phaseIndex];
  const storm = !!f.storm && f.tick >= f.storm.from && f.tick < f.storm.until;
  const total = mission.phases.reduce((s, p) => s + p.ticks, 0);
  const c = f.crisis;
  const lost = f.signal === 'lost';

  return (
    <div className={`scr scr--fixed scr--mc ${c ? 'in-crisis' : ''}`}>
      <TopBar icon={MISSION_ICON[f.mission]} title={<>Mission Control · {mission.name}</>}>
        <span className="clock"><Icon name="fl_timer" size={24} />T+{mmss(f.tick)}<small>/ ~{mmss(total)}</small></span>
        <MeChip />
      </TopBar>
      <div className="mc-strip">
        <Phases f={f} />
        <SignalStrip f={f} />
      </div>

      <div className="layout-mc">
        <section className="mc-view">
          <div className={`viewport viewport--scene ${f.asteroid ? '' : 'viewport--titan'} ${glitch ? 'is-glitch' : ''}`}>
            <div className="viewport__canvas">
              {f.asteroid ? <AsteroidView f={f} build={room.build} reducedMotion={reducedMotion} quality={quality} /> : (
                <TitanScene build={room.build} phaseId={phase?.id ?? 'uplink'} waypointIndex={f.waypointIndex} waypointProgress={f.waypointProgress}
                  route={f.route} crisis={c ? { kind: c.kind, nodeIds: c.nodeIds } : null} offIds={f.off} signal={f.signal}
                  role={role} reducedMotion={reducedMotion} quality={quality} storm={storm} />
              )}
            </div>
            {c && <div className="crisis-layer" aria-hidden />}
            <div className="viewport__hud">
              <div className="hud-row">
                <span className="chip chip--hud"><Icon name="fl_waypoint" size={24} /><span className="chip__ellipsis">{phase ? t.f(phase, 'name') : t('flight.phaseDone')} · {routeLabel(t, f)}</span></span>
                <span className="row gap-2">
                  {storm && <span className="chip chip--risk"><Icon name="fl_storm" size={24} />{t('flight.storm')}</span>}
                  {f.asteroid?.debris && <span className="chip chip--crit"><Icon name="fl_debris" size={24} />{t('flight.debris')}</span>}
                  <span className={`chip ${lost ? 'chip--crit' : f.signal === 'interference' ? 'chip--warn' : 'chip--ok'}`}><Icon name={lost ? 'fl_blackout' : 'res_signal'} size={24} />{signalLabel(t, f)}</span>
                  {DEV_SPEED > 1 && <span className="chip chip--warn chip--text">dev ×{DEV_SPEED}</span>}
                </span>
              </div>
              <div className="hud-row hud-row--bottom">
                {c && !banner && (
                  <span className={`chip chip--crit chip--lg ${noFlash ? '' : 'is-blink3'}`}>
                    <Icon name="fl_crisis" size={24} /><span className="chip__ellipsis">CRITICAL EVENT · {t.f(c, 'title')} · {t('flight.sec', { n: Math.max(0, c.deadlineTick - f.tick) })}</span>
                  </span>
                )}
                {f.waypoints.length > 0 && <Waypoints f={f} />}
              </div>
            </div>
            {lost && (
              <div className="blackout">
                <div className="blackout__plate">
                  <Icon name="fl_blackout" size={48} />
                  <div className="blackout__title">NO SIGNAL</div>
                  <div className="blackout__sub">{f.mission === 'titan' && f.phaseIndex === 1 ? t('flight.blackoutEntry') : t('flight.blackoutSub')}</div>
                </div>
              </div>
            )}
            {c && banner && (
              <div className="crisis-stage">
                <div className="burst burst--crit"><div className="burst__text">Critical<br />event</div></div>
                <div className="crisis-title">{t.f(c, 'title')}</div>
              </div>
            )}
            <RadioOverlay f={f} />
          </div>
        </section>

        <EventLog f={f} />

        <aside className="mc-side">
          {c && panel?.crisis && <CrisisCard f={f} panel={panel} mine={myRoles} />}
          {!c && result && <CrisisResult rec={result} />}
          <ReaimCard f={f} role={role} />
          <div className="panel--night mc-panel">
            <div className={`card__head ${role ? `card__head--${role}` : 'card__head--night'}`}>
              <Icon name={role ? ROLE_ICON[role] : 'act_settings'} size={32} />
              <div className="grow min0">
                <div className="t-eyebrow">{t('flight.yourPanel', { name: me?.name })}</div>
                <div className="card__title">{panel ? t.f(panel, 'title') : t('flight.noRole')}</div>
              </div>
            </div>
            <div className="stack gap-4">
              <RoleTabs roles={myRoles} active={role} onPick={setTab} needs={needs} />
              <DemoRoleSwitch label={t('flight.demoView')} />
              {panel ? <RolePanelView panel={panel} f={f} radio={radioPanels} /> : <Note level="info">{t('flight.pickRole')}</Note>}
              <div className="panel-foot">
                <A11yToggles />
                <LeaveRoom />
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

/** Turns a transient flag off after `ms` (separate effect, so StrictMode re-runs don't leave it stuck). */
function useAutoOff(active: boolean, off: () => void, ms: number) {
  const offRef = useRef(off);
  offRef.current = off;
  useEffect(() => {
    if (!active) return;
    const id = setTimeout(() => offRef.current(), ms);
    return () => clearTimeout(id);
  }, [active, ms]);
}

/** Phase arrows (kit .phases): done / current / next; the current one shows its progress. */
function Phases({ f }: { f: FlightState }) {
  const t = useT();
  const mission = MISSIONS[f.mission];
  return (
    <ol className="phases" aria-label={t('flight.phases')}>
      {mission.phases.map((p, i) => {
        const cur = i === f.phaseIndex;
        const k = cur ? Math.min(1, phaseProgress(f, p.id, p.ticks)) : 0;
        return (
          <li key={p.id} className={`phase ${cur ? 'is-current' : ''} ${i < f.phaseIndex ? 'is-done' : ''}`} style={cur ? { ['--k' as string]: k } : undefined} title={t.f(p, 'name')}>
            <span className="phase__n">{i + 1}.</span><span className="phase__name">{t.f(p, 'name')}</span>
            {cur && <i className="phase__progress" style={{ width: `${k * 100}%` }} />}
          </li>
        );
      })}
    </ol>
  );
}

function Waypoints({ f }: { f: FlightState }) {
  const t = useT();
  return (
    <span className="row gap-2 waypoints">
      {f.waypoints.map((w, i) => {
        const cur = i === f.waypointIndex;
        const state = w.reached ? (cur ? t('flight.wp.here') : t('flight.wp.passed')) : cur && f.phaseIndex >= 2 ? `${Math.round(f.waypointProgress * 100)} %` : t('flight.wp.ahead');
        return (
          <span key={w.id} className={`chip ${w.reached ? 'chip--ok' : cur ? 'chip--open' : 'chip--night'} ${cur ? 'is-current' : ''}`}>
            <Icon name={w.reached ? 'st_ok' : 'fl_waypoint'} size={24} />{t.f(w, 'name')}<span className="chip__dim">· {state}{w.mode ? ` · ${w.mode === 'fast' ? t('flight.wp.fast') : t('flight.wp.precise')}` : ''}</span>
          </span>
        );
      })}
    </span>
  );
}

function CrisisCard({ f, panel, mine = [] }: { f: FlightState; panel: RolePanel; mine?: RoleId[] }) {
  const t = useT();
  const dispatch = useGame((s) => s.dispatch);
  const pc = panel.crisis!;
  const c = f.crisis;
  const total = c ? Math.max(1, c.deadlineTick - c.startedTick) : TITAN.crisis.deadline;
  const waiting = waitingFor(t, f, panel, mine);
  return (
    <div className="card card--cream crisis-card mc-crisis" role="alertdialog" aria-label={`CRITICAL EVENT: ${t.f(pc, 'title')}`}>
      <div className="card__head card__head--crit">
        <Icon name="fl_crisis" size={32} />
        <div className="grow min0"><div className="t-eyebrow">Critical event</div><div className="crisis-card__name">{t.f(pc, 'title')}</div></div>
      </div>
      <div className="mc-crisis__pinned">
        <div className={`crisis-timer ${pc.secondsLeft <= 5 ? 'is-urgent' : ''}`}>
          <Icon name="fl_timer" size={32} />
          <span className="crisis-timer__num">{pc.secondsLeft}<small> {t('flight.secUnit')}</small></span>
          <div className="timebar grow"><i className="timebar__fill" style={{ width: `${Math.max(0, Math.min(1, pc.secondsLeft / total)) * 100}%` }} /></div>
        </div>
        <p className="crisis-card__text">{t.f(pc, 'text')}</p>
      </div>
      <div className="mc-crisis__scroll">
        {pc.options.length ? (
          <div className="stack gap-3">
            <div className="row gap-2"><b className="t-h3">{t('flight.yourAction')}</b>{panel.role && <RoleChip role={panel.role} />}</div>
            <CrisisTaskWidget f={f} role={panel.role} chosen={pc.chosen} />
            {pc.options.filter((o) => !widgetOption(f, panel.role, o.id)).map((o) => {
              const chosen = pc.chosen === o.id;
              return (
                <button key={o.id} type="button" className={`btn btn--stacked crisis-option ${chosen ? 'is-selected' : pc.chosen ? 'is-dimmed' : ''}`} disabled={!!pc.chosen}
                  onClick={() => dispatch({ type: 'crisisChoice', optionId: o.id })}>
                  <span className="crisis-option__title">{t.f(o, 'label')}{chosen && <span className="crisis-option__check">✓</span>}</span>
                  <span className="btn__sub">{t.f(o, 'hint')}</span>
                </button>
              );
            })}
          </div>
        ) : <Note level="info">{t('flight.noActions')}</Note>}
        <hr className="divider" />
        <div className="others">
          <div className="t-eyebrow t-muted">{t('flight.othersTitle')}</div>
          {pc.others.length ? pc.others.map((o) => (
            <div key={o.role} className="others__line"><span className="t-ok">✓</span><RoleChip role={o.role} />{t.f(o, 'label')}</div>
          )) : <div className="others__line t-muted">{t('flight.nobodyYet')}</div>}
          <div className="t-small t-muted">{t('flight.waiting', { list: waiting.join(', ') || '—' })}</div>
        </div>
      </div>
    </div>
  );
}

function waitingFor(t: T, f: FlightState, panel: RolePanel, mine: RoleId[] = []): string[] {
  const c = f.crisis!;
  const roles = [...new Set(c.options.map((o) => o.role))];
  // 0013 §4: my other roles are «вы (Инженер)» — answer them in their tab.
  return roles.filter((r) => !c.chosen[r] && r !== panel.role).map((r) => (mine.includes(r) ? t('flight.youOtherTab', { role: t('roleShort.' + r) }) : t('role.' + r))).concat(panel.crisis!.options.length && !panel.crisis!.chosen ? [t('flight.you')] : []);
}

function CrisisResult({ rec }: { rec: CrisisRecord }) {
  const t = useT();
  const by = rec.by === 'team' ? t('flight.by.team') : rec.by === 'autonomy' ? t('flight.by.autonomy') : t('flight.by.safe');
  return (
    <div className={`crisis-result ${rec.resolved ? '' : rec.by === 'safe' ? 'crisis-result--fail' : 'crisis-result--partial'}`}>
      <div className="crisis-result__title"><Icon name={rec.resolved ? 'st_ok' : 'st_warn'} size={24} />{t.f(rec, 'title')}: {rec.resolved ? t('flight.resolved') : t('flight.unresolved')}</div>
      <div className="t-small">{t('flight.firedBy', { by })}</div>
      <ul className="crisis-result__list">{t.fl(rec, 'effects').map((e, i) => <li key={i}>{e}</li>)}</ul>
    </div>
  );
}

/** Label / value rows (kit-style key-value list on a night panel). */
function Kv({ rows }: { rows: { id: string; label: string; value: string; level?: Level; icon?: IconName }[] }) {
  if (!rows.length) return null;
  return (
    <ul className="kv">
      {rows.map((r) => (
        <li key={r.id}>{r.icon && <Icon name={r.icon} size={20} />}<span className="kv__label">{r.label}</span><b className={`t-mono ${r.level ? LEVEL_CLASS[r.level] : ''}`}>{r.value}</b></li>
      ))}
    </ul>
  );
}

/** On / off / broken lines (power lines, engines, data queue). */
function Lines({ rows }: { rows: { id: string; name: string; right: string; state?: 'off' | 'broken' | 'warn' }[] }) {
  return (
    <ul className="lines">
      {rows.map((l) => (
        <li key={l.id} className={l.state ? `is-${l.state}` : ''}>
          <i className="dot-status" /><span className="grow">{l.name}</span><span className="t-mono">{l.right}</span>
        </li>
      ))}
    </ul>
  );
}

const ITEM_ICON: Record<string, IconName> = {
  hull: 'fl_hull', battery: 'res_battery', bus: 'res_power_use', heat: 'res_heat', memory: 'res_data', signal: 'res_signal', fuel: 'res_fuel',
  generation: 'res_power_gen', demand: 'res_power_use', net: 'dept_power', delay: 'fl_timer', packets: 'res_data', data: 'res_data',
};

function RolePanelView({ panel, f, radio }: { panel: RolePanel; f: FlightState; radio?: RolePanel[] }) {
  const t = useT();
  const alertsT = t.fl(panel, 'alerts');
  const heatItem = panel.items.find((i) => i.id === 'heat');
  const dispatch = useGame((s) => s.dispatch);
  return (
    <div className="stack gap-4 role-panel">
      {panel.blackout && (
        <div className="blackout-head">
          <div className="row gap-2"><Icon name="fl_blackout" size={32} /><b className="blackout-head__title">NO SIGNAL</b></div>
          <div className="t-small">{t('flight.bo.text')}{panel.blackoutInfo ? t('flight.bo.reason', { reason: t.f(panel.blackoutInfo, 'reasonText') }) : ''}</div>
          {panel.blackoutInfo && (
            <div className="t-mono t-small">
              {t('flight.bo.noLink', { time: mmss(panel.blackoutInfo.elapsed) })}{panel.blackoutInfo.expectedLeft !== null ? t('flight.bo.expect', { time: mmss(panel.blackoutInfo.expectedLeft) }) : t('flight.bo.unknown')}{t('flight.bo.craft', { by: panel.blackoutInfo.by === 'autonomy' ? t('flight.bo.byAutonomy') : 'Safe Protocol' })}
            </div>
          )}
        </div>
      )}
      {panel.alerts.map((a, i) => [a, alertsT[i]] as const).filter(([a]) => !a.startsWith('CRITICAL EVENT') && !a.startsWith('NO SIGNAL')).map(([a, text]) => <Note key={a} level="warn">{text}</Note>)}
      <Kv rows={panel.items.filter((i) => !AS_METER.has(i.id)).map((i) => ({ id: i.id, label: t.f(i, 'label'), value: t.f(i, 'value'), level: i.level, icon: ITEM_ICON[i.id] }))} />

      {panel.power && (
        <div className="stack gap-3">
          <Meter icon="res_battery" label={t('flight.charge')} value={`${panel.power.stored} / ${panel.power.capacity} Wh`} k={panel.power.capacity ? panel.power.stored / panel.power.capacity : 0}
            tone={panel.power.capacity && panel.power.stored / panel.power.capacity < 0.2 ? 'crit' : 'ok'} />
          <Meter icon="res_power_use" label={t('flight.bus')} value={`${panel.power.busLoad} / ${panel.power.busLimit} W`} k={panel.power.busLimit ? panel.power.busLoad / panel.power.busLimit : 0} />
          <HeatGauge heat={panel.power.heat} t={panel.power.thresholds} value={heatItem ? t.f(heatItem, 'value') : undefined} level={heatItem?.level} />
          <div className="t-eyebrow t-muted">{t('flight.powerLines')}</div>
          <Lines rows={panel.power.lines.map((l) => ({ id: l.id, name: t.f(l, 'name'), right: `${l.watts} W · ${l.broken ? t('flight.broken') : l.on ? t('flight.on') : t('flight.off')}`, state: l.broken ? 'broken' : l.on ? undefined : 'off' }))} />
          {panel.diagnostics && (
            <>
              <div className="t-eyebrow t-muted">{t('flight.diag')}</div>
              <ul className="diag">
                {panel.diagnostics.map((d) => <li key={d.id} className={LEVEL_CLASS[d.level]}><Icon name={d.level === 'bad' ? 'st_crit' : d.level === 'warn' ? 'st_warn' : d.level === 'ok' ? 'st_ok' : 'st_info'} size={20} />{t.f(d, 'text')}</li>)}
              </ul>
            </>
          )}
        </div>
      )}

      {panel.science && (
        <div className="stack gap-3">
          {panel.science.choice && (
            <div className="subpanel stack gap-2">
              <div className="t-small">{t('flight.sci.mode')} <b>{t.f(panel.science.choice, 'name')}</b> {panel.science.choice.atWaypoint ? t('flight.sci.here') : t('flight.sci.next')}</div>
              <div className="seg seg--block">
                {(['fast', 'precise'] as ScienceMode[]).map((m) => (
                  <button key={m} type="button" className="seg__item" aria-pressed={panel.science!.choice!.mode === m}
                    onClick={() => dispatch({ type: 'scienceMode', waypoint: panel.science!.choice!.waypoint, mode: m })}>
                    {m === 'fast' ? t('flight.sci.fast', { s: TITAN.dwell.fast, q: Math.round(TITAN.modeQuality.fast * 100) }) : t('flight.sci.precise', { s: TITAN.dwell.precise })}
                  </button>
                ))}
              </div>
              {!panel.science.choice.mode && <div className="t-small t-muted">{t('flight.sci.notChosen')}</div>}
            </div>
          )}
          {panel.science.targets.map((tg) => (
            <div key={tg.id} className={`target ${tg.possible ? '' : 'is-impossible'}`}>
              {tg.possible ? (
                <Meter icon={tg.sent >= tg.required ? 'st_ok' : 'dept_science'} label={t.f(tg, 'name')} value={`${tg.sent}/${tg.required}`} k={tg.collected / tg.required} k2={tg.sent / tg.required} tone="alt" compact
                  status={<>{t('flight.sci.status', { c: tg.collected, s: tg.stored, q: Math.round(tg.quality * 100) })}</>} />
              ) : (
                <div className="row gap-2 t-muted"><Icon name="st_locked" size={20} /><span className="grow">{t.f(tg, 'name')}</span><span className="t-small">{t('flight.sci.noInstr')}</span></div>
              )}
            </div>
          ))}
          {panel.blackout && (
            <div className="stuck stack gap-2">
              <div className="t-eyebrow t-muted">{t('flight.sci.stuck')}</div>
              <Lines rows={panel.science.targets.some((tg) => tg.stored > 0)
                ? panel.science.targets.filter((tg) => tg.stored > 0).map((tg) => ({ id: tg.id, name: t.f(tg, 'name'), right: t('flight.units', { n: tg.stored }), state: 'warn' as const }))
                : [{ id: 'empty', name: t('flight.sci.memEmpty'), right: '', state: 'off' }]} />
            </div>
          )}
          <Meter icon="res_data" label={t('flight.memory')} value={`${panel.science.memoryUsed} / ${panel.science.memoryCap}`} k={panel.science.memoryCap ? panel.science.memoryUsed / panel.science.memoryCap : 0} />
          <div className="row gap-2">
            {panel.science.instruments.map((i) => <span key={i.id} className={`chip ${i.on ? 'chip--ok' : 'chip--warn'}`}><Icon name={i.on ? 'st_ok' : 'st_warn'} size={24} />{t.f(i, 'name')}: {i.on ? t('flight.working') : t('flight.off')}</span>)}
          </div>
        </div>
      )}

      {panel.comms && (
        <div className="stack gap-3">
          <div className={`signal-big signal-big--${panel.comms.signal}`}>
            <Icon name={panel.comms.signal === 'lost' ? 'fl_blackout' : panel.comms.signal === 'interference' ? 'fl_storm' : 'res_signal'} size={32} />
            {panel.comms.signal === 'lost' ? 'NO SIGNAL' : panel.comms.signal === 'interference' ? 'INTERFERENCE' : 'SIGNAL OK'}
          </div>
          <Meter icon="fl_storm" label={t('flight.noise')} value={`${Math.round(panel.comms.noise * 100)} %`} k={panel.comms.noise} tone={panel.comms.noise > 0.3 ? 'crit' : 'warn'} />
          <div className="row gap-3 row--nowrap">
            <AntennaDial deg={panel.comms.direction?.deg ?? null} />
            <div className="t-small stack gap-1">
              <div>{t('flight.antenna', { list: panel.comms.antennas.map((id) => COMPONENT_BY_ID[id]?.name ?? id).join(', ') || t('common.none') })}</div>
              <div className={LEVEL_CLASS[panel.comms.direction?.level ?? 'info']}>{t('flight.direction', { text: t.f(panel.comms.direction, 'text') })}</div>
              <div className="t-muted">{t('flight.delayOneWay', { n: panel.comms.delayTicks })}</div>
            </div>
          </div>
          <div className="row gap-2">
            <span className={`stat ${panel.comms.queueFull ? 'stat--crit' : ''}`}><Icon name="res_data" size={20} />{t('flight.packets', { n: panel.comms.packets ?? 0 })}</span>
            <span className={`stat ${panel.comms.queueFull ? 'stat--crit' : ''}`}><Icon name="res_data" size={20} />{t('flight.free', { n: panel.comms.memoryFree })}</span>
          </div>
          <Lines rows={panel.comms.queue.length ? panel.comms.queue.map((q) => ({ id: q.id, name: t.f(q, 'name'), right: t('flight.units', { n: q.stored }) })) : [{ id: 'empty', name: t('flight.empty'), right: '', state: 'off' }]} />
          {panel.comms.queueFull && <Note level="bad">DATA QUEUE FULL</Note>}
        </div>
      )}

      {panel.command && (
        <div className="stack gap-3">
          <Meter icon="fl_hull" label={t('flight.hull')} value={`${panel.command.hull} %`} k={panel.command.hull / 100} tone={panel.command.hull < 40 ? 'crit' : panel.command.hull < 80 ? 'warn' : 'ok'} />
          <div className="row gap-2">
            {panel.command.waypointsTotal > 0 && <span className="stat"><Icon name="fl_waypoint" size={20} />{t('flight.points', { a: panel.command.waypointsReached, b: panel.command.waypointsTotal })}</span>}
            <span className="stat"><Icon name="res_data" size={20} />{t('flight.delivered', { a: panel.command.delivered, b: panel.command.targetsTotal })}</span>
          </div>
          {panel.command.trust && (
            <div className="row gap-2" data-testid="flight-trust">
              <TrustChip value={panel.command.trust.value} />
              <span className="t-small t-muted">{panel.command.trust.crisisBonus ? TRUST_TEXT.flightBonus(panel.command.trust.crisisBonus) : TRUST_TEXT.effect[panel.command.trust.tier](panel.command.trust)}</span>
            </div>
          )}
          {panel.command.timerSeconds !== null && (
            <div className="crisis-timer crisis-timer--sm"><Icon name="fl_timer" size={24} /><span className="t-crit">{t('flight.decisionTimer')} <b className="t-mono">{t('flight.sec', { n: panel.command.timerSeconds })}</b></span></div>
          )}
          {panel.command.blackoutTimer && (
            <div className="cmd-timer">
              <Icon name="fl_blackout" size={32} />
              <div className="grow"><div className="t-eyebrow">{t('flight.noLink')}</div><b className="cmd-timer__num">{mmss(panel.command.blackoutTimer.elapsed)}</b></div>
              <span className="t-small t-muted">{panel.command.blackoutTimer.expectedLeft !== null ? t('flight.linkIn', { time: mmss(panel.command.blackoutTimer.expectedLeft) }) : t('flight.unknown')}</span>
            </div>
          )}
        </div>
      )}

      {panel.asteroid && <AsteroidPanelView ap={panel.asteroid} />}

      <RoleActions panel={panel} />
      <CommandStrip panel={panel} f={f} />
      {!f.done && (radio ?? [panel]).map((p) => <RadioButtons key={p.role} panel={p} f={f} />)}

      {panel.hidden.length > 0 && <div className="t-small t-muted row gap-2 row--nowrap"><Icon name="st_info" size={20} />{t('flight.hiddenNote', { list: panel.hidden.map((h) => (HIDDEN_IDS.has(h) ? t('flight.hidden.' + h) : h)).join(', ') })}</div>}
      {f.done && <Note level="ok">{t('flight.done')}</Note>}
    </div>
  );
}

/** Panel items drawn as meters below (hull, battery, bus, heat, memory) — not repeated as text rows. */
const AS_METER = new Set(['hull', 'battery', 'bus', 'heat', 'memory', 'fuel', 'composition']);

const pct = (x: number) => `${Math.round(x * 100)} %`;
const riskClass = (r: number) => (r >= 0.6 ? 't-crit' : r >= 0.3 ? 't-warn' : 't-ok');

/** Asteroid parts of the role panel (panelFor(role).asteroid): each role gets only its pieces. */
function AsteroidPanelView({ ap }: { ap: AsteroidPanel }) {
  const t = useT();
  const dispatch = useGame((s) => s.dispatch);
  return (
    <div className="stack gap-3" data-testid="asteroid-panel">
      {ap.fuel && (
        <div className="stack gap-2">
          <Meter icon="res_fuel" label={t('flight.ast.fuel', { drive: ap.fuel.drive === 'ion' ? t('flight.ast.ion') : t('flight.ast.chem') })} value={`${ap.fuel.now} / ${ap.fuel.max}`} status={<>{t('flight.ast.need', { n: ap.fuel.forecast })}</>}
            k={ap.fuel.max ? ap.fuel.now / ap.fuel.max : 0} tone={!ap.fuel.enough ? 'crit' : ap.fuel.now < ap.fuel.forecast * 1.2 ? 'warn' : 'ok'} />
          {!ap.fuel.enough && <Note level="bad">{t('flight.ast.noFuel')}</Note>}
        </div>
      )}
      {ap.engines && ap.engines.length > 0 && (
        <Lines rows={ap.engines.map((e) => ({ id: e.id, name: t.f(e, 'name'), right: e.broken ? t('flight.broken') : e.on ? t('flight.on') : t('flight.off'), state: e.broken ? 'broken' : e.on ? undefined : 'off' }))} />
      )}
      {ap.protection && (
        <div className="row gap-2">
          <span className={`chip ${ap.protection.micrometeoroidShield ? 'chip--ok' : 'chip--warn'}`}><Icon name={ap.protection.micrometeoroidShield ? 'hq_insurance' : 'st_warn'} size={24} />{ap.protection.micrometeoroidShield ? t('flight.ast.shield') : t('flight.ast.noShield')}</span>
          <span className={`chip ${ap.protection.heatShield === 'ok' ? 'chip--ok' : 'chip--crit'}`}><Icon name="fl_hull" size={24} />{t('flight.ast.heatShield', { state: ap.protection.heatShield === 'ok' ? t('flight.ast.intact') : ap.protection.heatShield === 'damaged' ? t('flight.ast.damaged') : t('common.none') })}</span>
          {ap.protection.armDamaged && <span className="chip chip--crit"><Icon name="st_crit" size={24} />{t('flight.ast.armDamaged')}</span>}
        </div>
      )}
      {ap.site && (
        <div className="stack gap-2" data-testid="site-choice">
          <div className="t-small">
            {t('flight.ast.site')} <b>{ap.site.current ? t.f(SITE_BY_ID[ap.site.current], 'name') : t('flight.ast.notChosen')}</b>{ap.site.by === 'auto' ? t('flight.ast.byAuto') : ''}
          </div>
          {ap.site.why && <div className="t-small t-muted">{t.f(ap.site, 'why')}</div>}
          <div className="stack gap-2">
            {ap.site.options.map((o) => {
              const on = ap.site!.current === o.id;
              return (
                <button key={o.id} type="button" className={`btn btn--stacked crisis-option site-option ${on ? 'is-selected' : ''}`} disabled={!ap.site!.canChoose || on}
                  onClick={() => dispatch({ type: 'chooseSite', site: o.id })} data-site={o.id}>
                  <span className="crisis-option__title"><Icon name="fl_waypoint" size={20} />{t.f(o, 'name')}{on && <span className="crisis-option__check">✓</span>}</span>
                  <span className="btn__sub">{t.f(o, 'text')}</span>
                  <span className="btn__sub t-mono site-option__nums">
                    {t('flight.ast.jam')} <b className={riskClass(o.jamRisk)}>{pct(o.jamRisk)}</b>{t('flight.ast.nums', { v: o.science, r: Math.round(o.rate * 1000) / 10 })}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
      {ap.arm && (ap.arm.state !== 'idle' || ap.arm.attempts > 0) && (
        <Meter icon="fl_sample" label={`${t('flight.ast.arm', { state: t('flight.sampling.' + ap.arm.state) })}${ap.arm.attempts > 1 ? t('flight.ast.attempt', { n: ap.arm.attempts }) : ''}`} value={pct(ap.arm.progress)} k={ap.arm.progress}
          tone={ap.arm.state === 'jam' || ap.arm.state === 'failed' ? 'crit' : 'teal'} />
      )}
      {ap.sample && (ap.sample.collected || ap.sample.sealProgress > 0) && (
        <Meter icon="fl_sample" label={`${t('flight.ast.sample', { m: ap.sample.mass })}${ap.sample.heated ? t('flight.ast.heated') : ''}`} value={ap.sample.sealed ? t('flight.ast.sealed') : t('flight.ast.sealing', { p: pct(ap.sample.sealProgress) })}
          k={ap.sample.sealed ? 1 : ap.sample.sealProgress} tone={ap.sample.sealed ? 'ok' : 'warn'} />
      )}
      {ap.composition && (
        <Meter icon={ap.composition.delivered ? 'st_ok' : 'res_data'} label={t('flight.ast.comp')} value={`${ap.composition.sent} / ${ap.composition.required}`}
          k={ap.composition.collected / ap.composition.required} k2={ap.composition.sent / ap.composition.required} tone="alt" compact
          status={<>{t('flight.ast.compStatus', { c: ap.composition.collected, s: ap.composition.stored })}</>} />
      )}
      {ap.capsule && (
        <div className="row gap-2">
          <Icon name="fl_capsule" size={32} />
          <span className="grow">{t('flight.ast.capsule')} <b className={ap.capsule.stage === 'found' ? 't-ok' : ap.capsule.stage === 'lost' ? 't-crit' : ''}>{t('flight.capsule.' + ap.capsule.stage)}</b></span>
          <span className="t-small t-muted">{ap.capsule.beacon ? t('flight.ast.beacon') : t('flight.ast.noBeacon')}{ap.capsule.offTarget ? t('flight.ast.offTarget') : ''}</span>
        </div>
      )}
    </div>
  );
}

/** name: dictionary key. */
const SIGNAL_KIT: Record<string, { cls: string; icon: IconName; name: string }> = {
  delay: { cls: 'signal-state--delay', icon: 'fl_timer', name: 'flight.sig.delay' },
  lost: { cls: 'signal-state--lost', icon: 'fl_blackout', name: 'flight.sig.lost' },
  interference: { cls: 'signal-state--noise', icon: 'fl_storm', name: 'flight.sig.interference' },
  queue: { cls: 'signal-state--queue', icon: 'res_data', name: 'flight.sig.queue' },
};

/** The four signal states (Crises and Blackout.md): active ones lit, the rest dim. */
function SignalStrip({ f }: { f: FlightState }) {
  const t = useT();
  const states = useMemo(() => signalStates(f), [f]);
  return (
    <div className="signal-states">
      {states.map((x) => {
        const k = SIGNAL_KIT[x.id] ?? SIGNAL_KIT.delay;
        return (
          <span key={x.id} className={`signal-state ${k.cls} ${x.active ? 'is-active' : ''}`} title={`${t.f(x, 'label')}: ${x.active ? t.f(x, 'detail') : '—'}`}>
            <Icon name={k.icon} size={20} /><span className="signal-state__name">{x.id === 'delay' && x.active ? t('flight.sig.delayN', { n: f.delayTicks }) : t(k.name)}</span>
          </span>
        );
      })}
    </div>
  );
}

/** Concrete action of the role (ground → craft, delayed by the signal). */
function RoleActions({ panel }: { panel: RolePanel }) {
  const t = useT();
  const dispatch = useGame((s) => s.dispatch);
  const [arg, setArg] = useState<string>('');
  if (!panel.actions.length) return null;
  return (
    <div className="stack gap-2">
      <div className="section-title"><Icon name="act_approve" size={24} />{t('flight.yourAction')}</div>
      {panel.actions.map((a) => {
        const value = a.args ? arg || a.args[0]?.id || '' : undefined;
        return (
          <div key={a.kind} className="subpanel stack gap-2">
            {a.args && (
              <span className="select-wrap">
                <select className="select" value={value} onChange={(e) => setArg(e.target.value)} disabled={!!a.disabled}>
                  {a.args.map((x) => <option key={x.id} value={x.id}>{t.f(x, 'label')}</option>)}
                </select>
              </span>
            )}
            <button type="button" className="btn btn--primary btn--sm btn--block btn--wrap" disabled={!!a.disabled || (a.args && !value)} onClick={() => dispatch({ type: 'command', cmd: a.kind, arg: value })}>{t.f(a, 'label')}</button>
            <div className="t-small t-muted">{a.disabled != null ? t.f(a, 'disabled') : t.f(a, 'hint')}</div>
          </div>
        );
      })}
    </div>
  );
}

/** Command delay: sent → reached the craft → confirmation back on Earth. */
function CommandStrip({ panel, f }: { panel: RolePanel; f: FlightState }) {
  const t = useT();
  if (!panel.commands.length) return null;
  const at = (tick: number) => (tick < 0 ? '…' : `T+${mmss(tick)}`);
  return (
    <div className="stack gap-2">
      <div className="t-eyebrow t-muted">{t('flight.cmd.title', { n: f.delayTicks })}</div>
      {panel.commands.map((c) => (
        <div key={c.id} className={`subpanel cmd ${c.state}`}>
          <div className="t-small">{t.f(c, 'label')}</div>
          <div className="steps">
            <span className="step is-done">{t('flight.cmd.sent', { at: at(c.sentTick) })}</span>
            <span className="steps__arrow">→</span>
            <span className={`step ${c.applied ? 'is-done' : c.state === 'queued' ? 'is-current' : ''}`}>{c.state === 'queued' ? t('flight.cmd.queued') : c.applied ? t('flight.cmd.arrived', { at: at(c.arriveTick) }) : t('flight.cmd.arriveIn', { n: Math.max(0, c.arriveTick - f.tick) })}</span>
            <span className="steps__arrow">→</span>
            <span className={`step ${c.acked ? 'is-done' : ''}`}>{c.acked ? t('flight.cmd.acked', { at: at(c.ackTick) }) : c.ackTick >= 0 ? t('flight.cmd.ackIn', { n: Math.max(0, c.ackTick - f.tick) }) : t('flight.cmd.ackWait')}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

/** Antenna pointing dial: needle = error from Earth; «?» while there is no data. */
function AntennaDial({ deg }: { deg: number | null }) {
  const t = useT();
  const a = ((deg ?? 0) - 90) * (Math.PI / 180);
  return (
    <svg width="72" height="72" viewBox="0 0 64 64" aria-label={t('flight.dial')} className="antenna-dial">
      <circle cx="32" cy="32" r="28" fill="var(--night-2)" stroke="var(--ink)" strokeWidth="3" />
      <circle cx="32" cy="32" r="28" fill="none" stroke="var(--night-edge)" strokeWidth="1" />
      <text x="32" y="13" textAnchor="middle" fontSize="7" fontWeight="800" fill="var(--ok)" fontFamily="var(--font-display)">{t('flight.earth')}</text>
      <line x1="32" y1="32" x2="32" y2="15" stroke="var(--ok)" strokeWidth="2" strokeDasharray="2 2" />
      {deg === null
        ? <text x="32" y="39" textAnchor="middle" fontSize="18" fill="var(--crit-on-night)" fontWeight="900" fontFamily="var(--font-display)">?</text>
        : <line x1="32" y1="32" x2={32 + Math.cos(a) * 22} y2={32 + Math.sin(a) * 22} stroke={deg > 8 ? 'var(--warn)' : 'var(--teal)'} strokeWidth="4" strokeLinecap="round" />}
      <circle cx="32" cy="32" r="4" fill="var(--cream)" stroke="var(--ink)" strokeWidth="2" />
    </svg>
  );
}

const KIND_ICON: Record<string, IconName> = {
  crisis: 'fl_crisis', shed: 'res_power_use', 'battery-empty': 'res_battery', thermal: 'res_heat', signal: 'res_signal',
  phase: 'fl_phase', data: 'res_data', autonomy: 'fl_rule', mass: 'res_mass', route: 'fl_waypoint', science: 'dept_science',
  radio: 'act_radio', command: 'act_approve',
};
const KIND_LINE: Record<string, string> = { crisis: 'log__line--crisis', phase: 'log__line--phase', autonomy: 'log__line--rule' };

function EventLog({ f }: { f: FlightState }) {
  const t = useT();
  const list = f.causes.slice(-80).reverse();
  return (
    <section className="mc-log panel--night">
      <div className="card__head card__head--night"><Icon name="fl_log" size={32} /><span className="card__title">{t('flight.log')}</span></div>
      <div className="log">
        {list.map((e, i) => {
          const isNew = i === 0 && f.tick - e.tick <= 3;
          const start = e.kind === 'crisis' && e.ref?.startsWith('crisis:');
          const icon = e.kind === 'signal' && /нет|потер|lost|NO SIGNAL/i.test(e.text) ? 'fl_blackout' : KIND_ICON[e.kind] ?? 'fl_log';
          return (
            <div key={`${e.tick}-${i}`} className={`log__line ${KIND_LINE[e.kind] ?? ''} ${start ? 'log__line--start' : ''} ${isNew ? 'is-new' : ''}`}>
              <span className="log__time">T+{mmss(e.tick)}</span>
              <Icon name={icon} size={20} />
              <span className="log__text">{t.f(e, 'text')}</span>
            </div>
          );
        })}
        {!list.length && <div className="log__line"><span className="log__time">—</span><Icon name="fl_log" size={20} /><span className="log__text t-muted">{t('flight.quiet')}</span></div>}
      </div>
    </section>
  );
}

/** Asteroid cruise / approach end on arrival, not on the phase's max ticks (engine hand-over): show the real progress. */
function phaseProgress(f: FlightState, id: string, ticks: number) {
  const a = f.asteroid;
  if (a && id === 'cruise') return a.cruise;
  if (a && id === 'approach') return a.approach;
  return f.phaseTick / ticks;
}

// Capsule stage / sampling state names: flight.capsule.<stage>, flight.sampling.<state>.
const capsuleName = (t: T, s: CapsuleStage) => t('flight.capsule.' + s);
const samplingName = (t: T, s: NonNullable<FlightState['asteroid']>['sampling']) => t('flight.sampling.' + s);

function asteroidLabel(t: T, f: FlightState) {
  const a = f.asteroid!;
  const id = MISSIONS.asteroid.phases[f.phaseIndex]?.id;
  switch (id) {
    case 'cruise': return t('flight.route.cruise', { n: Math.round(a.cruise * 100), drive: a.drive === 'ion' ? t('flight.route.ion') : t('flight.ast.chem') });
    case 'approach': return `${Math.round(a.approach * 100)} %${a.site ? t('flight.route.site', { site: t.f(SITE_BY_ID[a.site], 'name') }) : ''}`;
    case 'site': return a.site ? t.f(SITE_BY_ID[a.site], 'name') : t('flight.route.waitSci');
    case 'sampling': return `${samplingName(t, a.sampling)}${a.sampling === 'grab' || a.sampling === 'jam' ? ` ${Math.round(a.samplingProgress * 100)} %` : ''}`;
    case 'stow': return a.sample.sealed ? t('flight.route.sealed') : a.sample.collected ? t('flight.ast.sealing', { p: `${Math.round(a.sealProgress * 100)} %` }) : t('flight.sampling.failed');
    case 'return': return a.capsule === 'stowed' ? t('flight.route.home', { n: Math.round(a.cruise * 100) }) : t('flight.route.capsule', { name: capsuleName(t, a.capsule) });
    default: return t('flight.route.capsule', { name: capsuleName(t, a.capsule) });
  }
}

/** Asteroid 3D: AsteroidScene until the capsule leaves the craft, then the capsule's return to Earth (ReturnScene). */
function AsteroidView({ f, build, reducedMotion, quality }: { f: FlightState; build: Build; reducedMotion: boolean; quality: Quality }) {
  const a = f.asteroid!;
  const c = f.crisis;
  const phaseId = MISSIONS.asteroid.phases[f.phaseIndex]?.id ?? 'return';
  if (a.capsule !== 'stowed' || f.done) {
    const beacon = (build.recovery_beacon ?? 0) > 0 && !f.off.includes('recovery_beacon') && !f.broken.includes('recovery_beacon');
    return <ReturnScene build={build} capsule={a.capsule} capsuleProgress={a.capsuleProgress} beacon={beacon} reducedMotion={reducedMotion} quality={quality} />;
  }
  return (
    <AsteroidScene build={build} phaseId={phaseId} approach={a.approach} site={a.site} sampling={a.sampling} sampleSealed={a.sample.sealed}
      crisis={c ? { kind: c.kind, nodeIds: c.nodeIds } : null} debris={a.debris} offIds={f.off} signal={f.signal} reducedMotion={reducedMotion} quality={quality} />
  );
}

function routeLabel(t: T, f: FlightState) {
  if (f.asteroid) return asteroidLabel(t, f);
  if (f.phaseIndex < 2) return f.phaseIndex === 0 ? t('flight.route.toTitan') : t('flight.route.chute');
  const wp = f.waypoints[f.waypointIndex];
  if (!wp) return f.route === 'landed' ? t('flight.route.doneLanded') : t('flight.route.done');
  const name = t.f(wp, 'name');
  if (f.route === 'stopped') return t('flight.route.stopped', { wp: name });
  if (wp.reached) return f.route === 'landed' ? t('flight.route.landedAt', { wp: name }) : t('flight.route.hoverAt', { wp: name });
  return t('flight.route.flying', { wp: name });
}

function signalLabel(t: T, f: FlightState) {
  switch (f.signal) {
    case 'lost': return t('flight.signal.lost');
    case 'interference': return t('flight.signal.interference');
    default: return t('flight.signal.delay', { n: f.delayTicks });
  }
}
