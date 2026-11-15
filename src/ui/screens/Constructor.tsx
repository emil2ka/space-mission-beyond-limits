// Constructor: catalog by department, +/−, numbers, issues, 3D stand. «На проверку» sends the build to the readiness review.
// Look: UI kit constructor (docs/05 Assets/UI/kit/shots/constructor-*.png): department rail + compact module cards,
// stand in the middle, night parameters panel on the right.
import { useEffect, useMemo, useRef, useState } from 'react';
import { canAdd, changeReasons, COMPONENTS, computeStats, rolesOf, DEPARTMENTS, MISSIONS, THERMAL, UPGRADE_BY_ID, type Department } from '../../engine';
import { StandScene } from '../../scene/StandScene';
import { useGame, useMe } from '../../store/game';
import { useT, type T } from '../../i18n';
import { useReducedMotion } from '../settings';
import { useGraphicsQuality } from '../graphics';
import { AutonomyPlanner } from '../AutonomyPlanner';
import { Icon, type IconName } from '../kit/Icon';
import { ModuleIcon } from '../kit/ModuleIcon';
import { OwnershipBadge, RULES_TEXT, RulesPanel } from '../rules/BuildRules';
import { A11yToggles, DEPT_ICON, HeatGauge, IssueLine, LeaveRoom, MeChip, Meter, MISSION_ICON, Note, RoleChip, TopBar } from '../components/common';

/** Dictionary keys of the need words (render with t()). */
export const NEED_LABEL = { required: 'build.need.required', recommended: 'build.need.recommended', optional: 'build.need.optional', useless: 'build.need.useless', incompatible: 'build.need.incompatible' };
export const NEED_ICON: Record<keyof typeof NEED_LABEL, IconName> = {
  required: 'need_required', recommended: 'need_recommended', optional: 'need_optional', useless: 'need_useless', incompatible: 'st_crit',
};
const THERMAL_LEVEL = { freezing: 'bad', cold: 'warn', nominal: 'ok', hot: 'warn', overheat: 'bad' } as const;
/** Same as engine fmtHours, in the current language. */
const fmtH = (t: T, h: number) => (!isFinite(h) ? '∞' : h < 1 ? t('unit.min', { n: Math.round(h * 60) }) : t('unit.h', { n: Math.round(h * 10) / 10 }));

export function Constructor() {
  const t = useT();
  const room = useGame((s) => s.room)!;
  const dispatch = useGame((s) => s.dispatch);
  const me = useMe();
  const [dept, setDept] = useState<Department>('power');
  const [view, setView] = useState<'catalog' | 'planner'>('catalog');
  const [reducedMotion] = useReducedMotion();
  const quality = useGraphicsQuality();
  const mission = MISSIONS[room.mission];
  const stats = useMemo(() => computeStats(room.build, mission, room.agency), [room.build, mission, room.agency]);
  const lastVeto = room.decisions.at(-1)?.kind === 'veto' ? room.decisions.at(-1) : null;
  // Narrow screens: the department rail is a horizontal strip — keep the chosen one in view (only the strip scrolls, not the page).
  const deptTabs = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const strip = deptTabs.current;
    const on = strip?.querySelector<HTMLElement>('.tab.is-selected');
    if (!strip || !on || strip.scrollWidth <= strip.clientWidth) return;
    strip.scrollLeft = on.offsetLeft - strip.offsetLeft - (strip.clientWidth - on.offsetWidth) / 2;
  }, [dept, view]);
  const deptName = t(`dept.${dept}`);
  const list = COMPONENTS.filter((c) => c.department === dept);

  return (
    <div className="scr scr--fixed">
      <TopBar icon="dept_structure" title={t('build.title')} sub={mission.name}><MeChip /></TopBar>
      <div className="layout-constructor">
        <section className="lc-catalog panel--night">
          <div className="row row--between gap-2">
            <h2 className="section-title"><Icon name="dept_structure" size={24} />{view === 'catalog' ? t('build.catalogTitle') : t('build.autonomy')}</h2>
            <div className="seg" role="group" aria-label={t('build.modeAria')}>
              <button type="button" className="seg__item" aria-pressed={view === 'catalog'} onClick={() => setView('catalog')}><Icon name="dept_structure" size={20} />{t('build.catalog')}</button>
              <button type="button" className="seg__item" aria-pressed={view === 'planner'} onClick={() => setView('planner')}><Icon name="fl_rule" size={20} />{t('build.autonomy')} {room.rules.length}/{stats.ruleSlots}</button>
            </div>
          </div>
          {view === 'planner' ? <div className="lc-catalog__list"><AutonomyPlanner /></div> : (
            <div className="lc-catalog__body">
              <div className="tabs tabs--rail" ref={deptTabs} role="tablist" aria-label={t('build.deptsAria')}>
                {DEPARTMENTS.map((d) => (
                  <button key={d.id} type="button" role="tab" aria-selected={d.id === dept} className={`tab ${d.id === dept ? 'is-selected' : ''}`} onClick={() => setDept(d.id)}>
                    <Icon name={DEPT_ICON[d.id]} size={24} />
                    <span>{t(`dept.${d.id}`)}</span>
                    <span className="tab__count">{stats.slotsUsed[d.id]}/{stats.slotsTotal[d.id]}</span>
                  </button>
                ))}
              </div>
              <div className="lc-catalog__list" aria-label={t('build.deptModules', { dept: deptName })}>
                {list.map((c) => {
                  const n = room.build[c.id] ?? 0;
                  const check = canAdd(room.build, c.id, mission, room.agency);
                  const fit = c.fit[room.mission];
                  const reason = !check.ok ? (n >= c.maxInstances ? 'max' : /бюджет/i.test(check.reason ?? '') ? 'budget' : '') : '';
                  return (
                    <article key={c.id} className={`module-card module-card--compact ${n > 0 ? 'is-installed' : ''} ${fit.need === 'incompatible' ? 'is-incompatible' : ''}`}>
                      {n > 0 && <span className="module-card__flag"><Icon name="st_ok" size={20} />{t('build.installed', { n })}</span>}
                      <div className="module-card__top">
                        <ModuleIcon id={c.id} mission={room.mission} size={48} />
                        <div className="min0">
                          <h3 className="module-card__name">{c.name}</h3>
                          <div className="module-card__cap" title={t.f(c, 'caption')}>{t.f(c, 'caption')}</div>
                        </div>
                      </div>
                      <div className="module-card__stats">
                        <span className="stat"><Icon name="res_mass" size={20} />{t('build.kg', { n: c.mass })}</span>
                        <span className="stat"><Icon name="res_budget" size={20} />{t('build.mc', { n: c.cost })}</span>
                        {c.generation ? <span className="stat"><Icon name="res_power_gen" size={20} />+{c.generation} W</span> : null}
                        {c.consumption ? <span className="stat"><Icon name="res_power_use" size={20} />−{c.consumption} W</span> : null}
                        {c.capacityWh ? <span className="stat"><Icon name="res_battery" size={20} />{c.capacityWh} Wh</span> : null}
                        <span className={`stat ${c.heat > 40 ? 'stat--warn' : ''}`}><Icon name="res_heat" size={20} />{c.heat > 0 ? '+' : ''}{c.heat}</span>
                      </div>
                      <div className="module-card__fit" title={t.f(fit, 'why')}>
                        <span className={`chip chip--need-${fit.need}`}><Icon name={NEED_ICON[fit.need]} size={24} />{t(NEED_LABEL[fit.need])}</span>
                        <span className="module-card__why">{t.f(fit, 'why')}</span>
                      </div>
                      <OwnershipBadge componentId={c.id} />
                      <div className="module-card__count">
                        <span className="module-card__n"><b>{n} / {c.maxInstances}</b><small>{t('build.installedMax')}</small></span>
                        <button type="button" className="btn btn--secondary btn--sm btn--icon" aria-label={RULES_TEXT.removeTitle(c.name, changeReasons(room, rolesOf(me), 'remove', c.id).reasons.length > 0)} disabled={n === 0}
                          onClick={() => dispatch({ type: 'removeComponent', id: c.id })}><Icon name="act_remove" size={24} /></button>
                        <button type="button" className="btn btn--primary btn--sm btn--icon" aria-label={RULES_TEXT.addTitle(c.name, changeReasons(room, rolesOf(me), 'add', c.id).reasons.length > 0)} disabled={!check.ok}
                          onClick={() => dispatch({ type: 'addComponent', id: c.id })}><Icon name="act_add" size={24} /></button>
                      </div>
                      {!check.ok && fit.need !== 'incompatible' && (
                        <div className={`module-card__reason ${reason ? `module-card__reason--${reason}` : ''}`}>
                          <Icon name={reason === 'budget' ? 'res_budget' : reason === 'max' ? 'st_info' : 'st_warn'} size={20} />{t.f(check, 'reason')}
                        </div>
                      )}
                      {fit.need === 'incompatible' && <div className="module-card__reason"><Icon name="st_crit" size={20} />{t('build.incompatible', { why: t.f(fit, 'why') })}</div>}
                    </article>
                  );
                })}
              </div>
            </div>
          )}
        </section>

        <section className="lc-stage">
          <div className="viewport viewport--scene">
            <div className="viewport__canvas">
              <StandScene build={room.build} stats={stats} role={me?.role ?? null} reducedMotion={reducedMotion} quality={quality} mission={room.mission} />
            </div>
            <div className="viewport__hud">
              <div className="hud-row">
                <span className="chip"><Icon name={MISSION_ICON[room.mission]} size={24} />{mission.name}</span>
                {me?.role ? <RoleChip role={me.role} /> : <span className="chip chip--text chip--offline">{t('common.ui.noRole')}</span>}
              </div>
              <div className="hud-row">
                {stats.issues.filter((i) => i.severity !== 'info').slice(0, 2).map((i) => (
                  <span key={i.id} className={`chip chip--hud ${i.severity === 'critical' ? 'chip--crit' : 'chip--warn'}`} title={t.f(i, 'text')}>
                    <Icon name={i.severity === 'critical' ? 'st_crit' : 'st_warn'} size={24} /><span className="chip__ellipsis">{t.f(i, 'text')}</span>
                  </span>
                ))}
              </div>
            </div>
          </div>
        </section>

        <aside className="lc-params panel--night">
          {/* 0013 §2: departments, the commander's budget split and the request queue — first thing the commander sees. */}
          <RulesPanel />
          <h2 className="section-title"><Icon name="fl_hull" size={24} />{t('build.params')}</h2>
          <Meter icon="res_mass" label={t('build.mass')} value={<>{stats.mass} <span className="meter__limit">/ {t('build.kg', { n: stats.massLimit })}</span></>} k={stats.mass / stats.massLimit} />
          <Meter icon="res_budget" label={t('build.budget')} value={<>{stats.cost} <span className="meter__limit">/ {t('build.mc', { n: stats.budget })}</span></>} k={stats.cost / stats.budget} />
          <div className="meter">
            <div className="meter__head">
              <Icon name="dept_power" size={24} />
              <span className="meter__label">{t('build.power')}</span>
              <span className={`meter__value ${stats.netPower < 0 ? 't-crit' : 't-ok'}`}>{stats.netPower >= 0 ? '+' : ''}{stats.netPower} W</span>
            </div>
            <div className="meter__rows">
              <Icon name="res_power_gen" size={20} />
              <div className="meter__track"><i className="meter__fill" style={{ width: `${Math.min(1, stats.generation / Math.max(1, stats.generation, stats.consumption)) * 100}%` }} /></div>
              <span className="t-mono">+{stats.generation}</span>
              <Icon name="res_power_use" size={20} />
              <div className="meter__track"><i className="meter__fill meter__fill--alt" style={{ width: `${Math.min(1, stats.consumption / Math.max(1, stats.generation, stats.consumption)) * 100}%` }} /></div>
              <span className="t-mono">−{stats.consumption}</span>
            </div>
            <div className="meter__status">
              <Icon name="res_battery" size={20} />
              {t('build.capacity', { n: stats.capacityWh })}{stats.netPower < 0 ? <>{t('build.deficit', { n: -stats.netPower, h: fmtH(t, stats.hoursOfReserve) })}</> : <>{t('build.surplus', { n: stats.netPower })}</>}
            </div>
          </div>
          <HeatGauge heat={stats.heatBalance} t={THERMAL} value={`${stats.heatBalance} · ${t(`build.thermal.${stats.thermalState}`)}`} level={THERMAL_LEVEL[stats.thermalState]} />
          <div className="row gap-2">
            <span className="stat"><Icon name="res_signal" size={20} />{t('build.bandwidth', { n: stats.bandwidth })}</span>
            <span className="stat"><Icon name="res_data" size={20} />{t('build.storage', { n: stats.storage })}</span>
            <span className="stat"><Icon name="fl_rule" size={20} />{t('build.ruleSlots', { n: stats.ruleSlots })}</span>
          </div>
          {room.agency.upgrades.length > 0 && (
            <div className="t-small t-muted row gap-2"><Icon name="hq_upgrade" size={20} />{t('build.upgrades', { list: room.agency.upgrades.map((u) => t.f(UPGRADE_BY_ID[u], 'name')).join(', ') })}</div>
          )}
          {stats.issues.length > 0 && <div className="t-eyebrow t-muted">{t('build.issues', { n: stats.issues.length })}</div>}
          <div className="stack gap-2">
            {stats.issues.map((i) => <IssueLine key={i.id} severity={i.severity} text={t.f(i, 'text')} modules={i.componentIds} mission={room.mission} />)}
          </div>
          {lastVeto && <Note level="bad">{t('build.veto', { text: t.f(lastVeto, 'text') })}</Note>}
          <button className="btn btn--primary btn--lg btn--block" onClick={() => dispatch({ type: 'openTasks' })} data-testid="to-tasks">
            <Icon name="act_approve" size={32} />{t('build.toTasks')}
          </button>
          <span className="t-small t-muted">{t('build.next')}</span>
          <div className="panel-foot">
            <A11yToggles />
            <LeaveRoom />
          </div>
        </aside>
      </div>
    </div>
  );
}
