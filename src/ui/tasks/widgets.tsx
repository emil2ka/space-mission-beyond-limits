// Individual Tasks — interactive widgets (comic UI kit): drag-to-reorder list, power wiring schematic,
// calibration spectrum + knob, antenna radar + noisy signal meter, measurement-mode picker.
// Pure UI: they get numbers from the engine (src/engine/tasks.ts) and report the player's input; no game rules here.
import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import type { Line, MeasureMode, ModePreview } from '../../engine';
import { useT } from '../../i18n';
import { Icon } from '../kit/Icon';

/** Widget words in the current language (re-renders on language change). */
function useText() {
  const t = useT();
  return {
    lang: t.lang,
    up: t('widget.up'), down: t('widget.down'), drag: t('widget.drag'),
    main: t('widget.main'), secondary: t('widget.secondary'), mainShort: t('widget.mainShort'), secondaryShort: t('widget.secondaryShort'), shedFirst: t('widget.shedFirst'),
    toMain: t('widget.toMain'), toSecondary: t('widget.toSecondary'),
    load: (w: number, cap: number) => `${w} / ${cap} W`,
    over: t('widget.over'), pick: t('widget.pick'),
    knob: t('widget.knob'), fine: t('widget.fine'), coarse: t('widget.coarse'),
    reference: t('widget.reference'), reading: t('widget.reading'),
    radar: t('widget.radar'), signal: t('widget.signal'), aimHint: t('widget.aimHint'),
    nudge: { up: t('widget.nudge.up'), down: t('widget.nudge.down'), left: t('widget.nudge.left'), right: t('widget.nudge.right') },
    mode: { cautious: t('widget.mode.cautious'), normal: t('widget.mode.normal'), intensive: t('widget.mode.intensive') } as Record<MeasureMode, string>,
    data: (pct: number) => (pct === 0 ? t('widget.dataSame') : t('widget.data', { v: `${pct > 0 ? '+' : ''}${pct}` })),
    heat: (d: number) => (d === 0 ? t('widget.heatSame') : t('widget.heat', { v: `${d > 0 ? '+' : ''}${d}` })),
    risk: [t('widget.risk0'), t('widget.risk1'), t('widget.risk2'), t('widget.risk3')] as const,
    riskCold: t('widget.riskCold'), riskFreeze: t('widget.riskFreeze'),
    frame: t('widget.frame'),
  };
}
type Text = ReturnType<typeof useText>;

/** Palette for canvases (the kit tokens, src/ui/kit/tokens.css). */
const C = { ink: '#12142A', cream: '#F3EAD7', creamDim: 'rgba(243,234,215,.45)', teal: '#34C3B5', night: '#1F1D32', night3: '#37344F', rim: '#4D4970', warn: '#F5C443', crit: '#E0525A', ok: '#4CCB94', orange: '#FF8A3D' };

const clamp = (x: number, a = 0, b = 1) => Math.max(a, Math.min(b, x));

/** Canvas sized to its box with the device pixel ratio; redraws on resize. */
function useCanvas(draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, deps: unknown[]) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drawRef = useRef(draw);
  drawRef.current = draw;
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const paint = () => {
      const w = c.clientWidth, h = c.clientHeight;
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
      const ctx = c.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      drawRef.current(ctx, w, h);
    };
    paint();
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(paint) : null;
    ro?.observe(c);
    return () => ro?.disconnect();
  }, deps); // eslint-disable-line react-hooks/exhaustive-deps
  return ref;
}

/** requestAnimationFrame clock (seconds), paused with reduced motion. */
function useClock(on: boolean): number {
  const [t, setT] = useState(0);
  useEffect(() => {
    if (!on) return;
    let raf = 0;
    const t0 = performance.now();
    const step = (now: number) => { setT((now - t0) / 1000); raf = requestAnimationFrame(step); };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [on]);
  return t;
}

// ── Drag-to-reorder list ──

export interface ReorderItem { id: string; body: ReactNode; tone?: 'muted' | 'warn' | 'ok' }

/** Vertical list the player reorders: drag the handle (mouse / touch / pen) or use ▲▼ (keyboard: arrows on the handle). */
export function ReorderList({ items, order, onChange, label, numbered = true, testId }: {
  items: ReorderItem[]; order: string[]; onChange: (order: string[]) => void; label: string; numbered?: boolean; testId?: string;
}) {
  const TEXT = useText();
  const byId = useMemo(() => Object.fromEntries(items.map((i) => [i.id, i])), [items]);
  const rows = useRef<Record<string, HTMLLIElement | null>>({});
  const [dragId, setDragId] = useState<string | null>(null);
  const live = order.filter((id) => byId[id]);
  const move = (id: string, to: number) => {
    const from = live.indexOf(id);
    if (from < 0 || to < 0 || to >= live.length || to === from) return;
    const next = [...live];
    next.splice(from, 1);
    next.splice(to, 0, id);
    onChange(next);
  };
  const onDown = (e: RPointerEvent, id: string) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    setDragId(id);
  };
  const onMove = (e: RPointerEvent) => {
    if (!dragId) return;
    // Target slot = how many of the other rows have their middle above the pointer (stable while rows move).
    const y = e.clientY;
    const to = live.filter((id) => id !== dragId).filter((id) => { const r = rows.current[id]?.getBoundingClientRect(); return !!r && y > r.top + r.height / 2; }).length;
    if (to !== live.indexOf(dragId)) move(dragId, to);
  };
  const onKey = (e: KeyboardEvent, id: string, i: number) => {
    if (e.key === 'ArrowUp') { e.preventDefault(); move(id, i - 1); }
    if (e.key === 'ArrowDown') { e.preventDefault(); move(id, i + 1); }
  };
  return (
    <ol className="tk-reorder" aria-label={label} data-testid={testId}>
      {live.map((id, i) => (
        <li key={id} ref={(el) => { rows.current[id] = el; }} className={`tk-reorder__row ${dragId === id ? 'is-dragging' : ''} ${byId[id].tone ? `tk-reorder__row--${byId[id].tone}` : ''}`}>
          <button type="button" className="tk-reorder__handle" aria-label={`${TEXT.drag}: ${i + 1}`} title={TEXT.drag}
            onPointerDown={(e) => onDown(e, id)} onPointerMove={onMove} onPointerUp={() => setDragId(null)} onPointerCancel={() => setDragId(null)}
            onKeyDown={(e) => onKey(e, id, i)}>
            <span aria-hidden>⋮⋮</span>
          </button>
          {numbered && <span className="tk-reorder__n">{i + 1}</span>}
          <div className="tk-reorder__body">{byId[id].body}</div>
          <span className="tk-reorder__arrows">
            <button type="button" className="btn btn--mini btn--ghost" aria-label={TEXT.up} disabled={i === 0} onClick={() => move(id, i - 1)}>▲</button>
            <button type="button" className="btn btn--mini btn--ghost" aria-label={TEXT.down} disabled={i === live.length - 1} onClick={() => move(id, i + 1)}>▼</button>
          </span>
        </li>
      ))}
    </ol>
  );
}

// ── Power wiring schematic ──

export interface WireNode { id: string; name: string; watts: number; tag: string; tagTone?: 'crit' | 'warn' | 'muted'; on?: boolean; icon?: ReactNode }

/** Two power lines (rails) and the consumers between them. Click a consumer, then a line (or the socket on its side). */
export function WiringBoard({ nodes, lines, onAssign, caps, loads, frame, selectable = true, onPick, picked, compact }: {
  nodes: WireNode[]; lines: Record<string, Line>; onAssign?: (id: string, line: Line) => void;
  caps: { main: number; secondary: number }; loads: { main: number; secondary: number };
  /** Frame avionics on the main line, W (shown as a fixed row). */ frame?: number;
  selectable?: boolean;
  /** Pick mode (in flight): clicking a consumer calls onPick instead of selecting. */ onPick?: (id: string) => void; picked?: string | null;
  compact?: boolean;
}) {
  const TEXT = useText();
  const [sel, setSel] = useState<string | null>(null);
  const assign = (line: Line) => { if (sel && onAssign) { onAssign(sel, line); setSel(null); } };
  const rail = (line: Line) => {
    const load = loads[line], cap = caps[line];
    const over = load > cap;
    return (
      <button type="button" className={`tk-rail tk-rail--${line} ${over ? 'is-over' : ''} ${sel ? 'is-armed' : ''}`} onClick={() => assign(line)} disabled={!selectable || !sel}
        aria-label={`${line === 'main' ? TEXT.main : TEXT.secondary}: ${TEXT.load(load, cap)}${over ? `, ${TEXT.over}` : ''}`}>
        <span className="tk-rail__name" title={line === 'main' ? TEXT.main : TEXT.secondary}>{line === 'main' ? TEXT.mainShort : TEXT.secondaryShort}</span>
        <span className="tk-rail__pipe"><i style={{ height: `${(clamp(load / Math.max(1, cap), 0, 1.25) / 1.25) * 100}%` }} /><b style={{ bottom: `${100 / 1.25}%` }} /></span>
        <span className="tk-rail__load t-mono">{load}<small>/{cap} W</small></span>
        {over && <span className="tk-rail__over">{TEXT.over}</span>}
      </button>
    );
  };
  return (
    <div className={`tk-wiring ${compact ? 'tk-wiring--compact' : ''}`}>
      <div className="tk-wiring__legend t-small"><span className="tk-wiring__key tk-wiring__key--main">{TEXT.mainShort} — {TEXT.main.toLowerCase()}</span><span className="tk-wiring__key tk-wiring__key--secondary">{TEXT.secondaryShort} — {TEXT.secondary.toLowerCase()}: {TEXT.shedFirst}</span></div>
      {rail('main')}
      <ul className="tk-wiring__nodes">
        {frame ? (
          <li className="tk-node tk-node--fixed" data-line="main">
            <span className="tk-node__wire tk-node__wire--main is-on" />
            <span className="tk-node__chip"><Icon name="dept_structure" size={20} /><span className="tk-node__name">{TEXT.frame}</span><span className="t-mono tk-node__w">{frame} W</span></span>
            <span className="tk-node__wire tk-node__wire--secondary" />
          </li>
        ) : null}
        {nodes.map((n) => {
          const line = lines[n.id] ?? 'main';
          const on = n.on !== false;
          return (
            <li key={n.id} className={`tk-node ${sel === n.id || picked === n.id ? 'is-selected' : ''} ${on ? '' : 'is-off'}`} data-line={line}>
              <button type="button" className={`tk-node__wire tk-node__wire--main ${line === 'main' ? 'is-on' : ''}`} aria-label={`${n.name}: ${TEXT.toMain}`}
                disabled={!selectable || !onAssign} onClick={() => onAssign?.(n.id, 'main')} />
              <button type="button" className="tk-node__chip" aria-pressed={sel === n.id || picked === n.id} disabled={!on && !!onPick}
                onClick={() => (onPick ? onPick(n.id) : selectable && setSel(sel === n.id ? null : n.id))}
                onKeyDown={(e) => { if (!onAssign) return; if (e.key === 'ArrowLeft') onAssign(n.id, 'main'); if (e.key === 'ArrowRight') onAssign(n.id, 'secondary'); }}>
                {n.icon}
                <span className="tk-node__name">{n.name}</span>
                <span className="t-mono tk-node__w">{n.watts} W</span>
                <span className={`tk-node__tag ${n.tagTone ? `tk-node__tag--${n.tagTone}` : ''}`}>{n.tag}</span>
              </button>
              <button type="button" className={`tk-node__wire tk-node__wire--secondary ${line === 'secondary' ? 'is-on' : ''}`} aria-label={`${n.name}: ${TEXT.toSecondary}`}
                disabled={!selectable || !onAssign} onClick={() => onAssign?.(n.id, 'secondary')} />
            </li>
          );
        })}
      </ul>
      {rail('secondary')}
      {selectable && onAssign && <div className="tk-wiring__hint t-small">{sel ? `${nodes.find((n) => n.id === sel)?.name} → ?` : TEXT.pick}</div>}
    </div>
  );
}

// ── Calibration: spectrum + knob ──

/** Normalised spectrum with absorption bands: 1 = no absorption. */
export function spectrumAt(x: number, bands: [number, number, number][]): number {
  let v = 1;
  for (const [c, d, w] of bands) v -= d * Math.exp(-(((x - c) / w) ** 2) / 2);
  return v;
}

/** Spectrum canvas: lab reference (dashed) and the instrument reading shifted by its calibration error (+ noise). */
export function Spectrum({ bands, shift, noise, animate, label }: { bands: [number, number, number][]; shift: number; noise: number; animate: boolean; label: string }) {
  const TEXT = useText();
  const t = useClock(animate);
  const seedRef = useRef(Math.random() * 1000);
  const ref = useCanvas((ctx, w, h) => {
    const pad = 10, top = 14, bottom = h - 18;
    ctx.fillStyle = C.night; ctx.fillRect(0, 0, w, h);
    // grid
    ctx.strokeStyle = C.rim; ctx.lineWidth = 1;
    for (let i = 1; i < 6; i++) { const x = pad + ((w - 2 * pad) * i) / 6; ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.stroke(); }
    const y = (v: number) => bottom - (bottom - top) * clamp(v, 0, 1.05) / 1.05;
    const N = Math.max(60, Math.floor(w / 3));
    const path = (f: (x: number) => number) => { ctx.beginPath(); for (let i = 0; i <= N; i++) { const x = i / N; const px = pad + (w - 2 * pad) * x; const py = y(f(x)); if (i) ctx.lineTo(px, py); else ctx.moveTo(px, py); } };
    // reference
    ctx.setLineDash([6, 5]); ctx.strokeStyle = C.creamDim; ctx.lineWidth = 2;
    path((x) => spectrumAt(x, bands)); ctx.stroke(); ctx.setLineDash([]);
    // reading (ink outline + teal, comic style)
    const s = seedRef.current + Math.floor(t * 12);
    const nz = (x: number) => noise * (Math.sin(x * 97 + s * 1.7) * 0.5 + Math.sin(x * 211 + s * 3.1) * 0.35 + Math.sin(x * 431 + s) * 0.15);
    const reading = (x: number) => spectrumAt(x + shift, bands) + nz(x);
    ctx.strokeStyle = C.ink; ctx.lineWidth = 5; path(reading); ctx.stroke();
    ctx.strokeStyle = C.teal; ctx.lineWidth = 2.5; path(reading); ctx.stroke();
    // labels
    ctx.font = '700 11px Rubik, system-ui, sans-serif';
    ctx.fillStyle = C.creamDim; ctx.fillText(`- - ${TEXT.reference}`, pad, h - 4);
    ctx.fillStyle = C.teal; ctx.fillText(`—— ${TEXT.reading}`, pad + 80, h - 4);
  }, [bands, shift, noise, t, TEXT.lang]);
  return <canvas ref={ref} className="tk-spectrum" role="img" aria-label={label} />;
}

/** Rotary knob 0..1 (−135°…+135°): drag around it, wheel, arrow keys; fine / coarse buttons beside it. */
export function Knob({ value, onChange, label }: { value: number; onChange: (v: number) => void; label: string }) {
  const TEXT = useText();
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<{ a: number; v: number } | null>(null);
  const angleOf = (e: RPointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return Math.atan2(e.clientY - (r.top + r.height / 2), e.clientX - (r.left + r.width / 2));
  };
  const set = (v: number) => onChange(Math.round(clamp(v) * 1000) / 1000);
  const deg = -135 + value * 270;
  return (
    <div className="tk-knob">
      <div ref={ref} className="tk-knob__dial" role="slider" tabIndex={0} aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(value * 1000) / 10}
        onPointerDown={(e) => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); drag.current = { a: angleOf(e), v: value }; }}
        onPointerMove={(e) => {
          if (!drag.current) return;
          let d = angleOf(e) - drag.current.a;
          if (d > Math.PI) d -= 2 * Math.PI;
          if (d < -Math.PI) d += 2 * Math.PI;
          // A full turn of the hand = 0.5 of the scale: precise enough to hit a 1 % window.
          const v = drag.current.v + d / (Math.PI * 4);
          drag.current = { a: angleOf(e), v };
          set(v);
        }}
        onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }}
        onWheel={(e) => set(value - Math.sign(e.deltaY) * 0.004)}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 0.02 : 0.003;
          if (e.key === 'ArrowRight' || e.key === 'ArrowUp') { e.preventDefault(); set(value + step); }
          if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') { e.preventDefault(); set(value - step); }
        }}>
        <svg viewBox="0 0 100 100" aria-hidden>
          {Array.from({ length: 28 }, (_, i) => {
            const a = ((-135 + (i * 270) / 27 - 90) * Math.PI) / 180;
            const long = i % 9 === 0;
            return <line key={i} x1={50 + Math.cos(a) * 44} y1={50 + Math.sin(a) * 44} x2={50 + Math.cos(a) * (long ? 36 : 40)} y2={50 + Math.sin(a) * (long ? 36 : 40)} stroke={C.cream} strokeWidth={long ? 3 : 1.5} />;
          })}
          <circle cx="50" cy="50" r="31" fill={C.orange} stroke={C.ink} strokeWidth="4" />
          <circle cx="50" cy="50" r="22" fill="none" stroke="rgba(18,20,42,.35)" strokeWidth="2" strokeDasharray="3 4" />
          <g transform={`rotate(${deg} 50 50)`}>
            <rect x="46" y="19" width="8" height="22" rx="3" fill={C.cream} stroke={C.ink} strokeWidth="3" />
          </g>
        </svg>
      </div>
      <div className="tk-knob__btns">
        <button type="button" className="btn btn--sm btn--secondary" onClick={() => set(value - 0.02)} aria-label={`${TEXT.coarse} −`}>«</button>
        <button type="button" className="btn btn--sm btn--secondary" onClick={() => set(value - 0.003)} aria-label={`${TEXT.fine} −`}>‹</button>
        <span className="t-mono tk-knob__val">{(value * 100).toFixed(1)}</span>
        <button type="button" className="btn btn--sm btn--secondary" onClick={() => set(value + 0.003)} aria-label={`${TEXT.fine} +`}>›</button>
        <button type="button" className="btn btn--sm btn--secondary" onClick={() => set(value + 0.02)} aria-label={`${TEXT.coarse} +`}>»</button>
      </div>
    </div>
  );
}

// ── Antenna radar + signal meter ──

/**
 * Radar scope: a sweep passes over the sky; where it crosses Earth's bearing a faint, noisy blip lights up.
 * The player sets the antenna aim (click / drag / arrows); the beam circle shows how wide the antenna «sees».
 */
export function Radar({ earth, aim, beam, noise, onAim, animate, label, size = 260 }: {
  earth: { x: number; y: number }; aim: { x: number; y: number }; beam: number; noise: number; onAim: (a: { x: number; y: number }) => void;
  animate: boolean; label: string; size?: number;
}) {
  const TEXT = useText();
  const t = useClock(animate);
  const blips = useRef<{ x: number; y: number; at: number }[]>([]);
  const lastSweep = useRef(0);
  const ref = useCanvas((ctx, w, h) => {
    const R = Math.min(w, h) / 2 - 6, cx = w / 2, cy = h / 2;
    if (R <= 4) return; // not laid out yet
    const P = (x: number, y: number) => [cx + x * R, cy + y * R] as const;
    ctx.fillStyle = C.night; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = C.rim; ctx.lineWidth = 1;
    for (const k of [0.25, 0.5, 0.75]) { ctx.beginPath(); ctx.arc(cx, cy, R * k, 0, Math.PI * 2); ctx.stroke(); }
    ctx.beginPath(); ctx.moveTo(cx - R, cy); ctx.lineTo(cx + R, cy); ctx.moveTo(cx, cy - R); ctx.lineTo(cx, cy + R); ctx.stroke();
    // sweep
    const sweep = animate ? (t * 1.6) % (Math.PI * 2) : -Math.PI / 4;
    const ea = Math.atan2(earth.y, earth.x);
    const norm = (a: number) => ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    if (animate) {
      const prev = lastSweep.current;
      const crossed = norm(ea - prev) <= norm(sweep - prev) && norm(sweep - prev) < 1;
      if (crossed) {
        const k = noise * 1.6;
        blips.current.push({ x: earth.x + (Math.random() * 2 - 1) * k, y: earth.y + (Math.random() * 2 - 1) * k, at: t });
        blips.current = blips.current.slice(-4);
      }
      lastSweep.current = sweep;
      const g = ctx.createConicGradient ? ctx.createConicGradient(sweep - 0.6, cx, cy) : null;
      if (g) {
        g.addColorStop(0, 'rgba(52,195,181,0)'); g.addColorStop(0.095, 'rgba(52,195,181,.28)'); g.addColorStop(0.0955, 'rgba(52,195,181,0)');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
      }
      ctx.strokeStyle = C.teal; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(...P(Math.cos(sweep), Math.sin(sweep))); ctx.stroke();
      for (const b of blips.current) {
        const age = t - b.at;
        if (age > 2.4) continue;
        ctx.fillStyle = `rgba(245,196,67,${(1 - age / 2.4) * 0.85})`;
        ctx.beginPath(); ctx.arc(...P(b.x, b.y), 5, 0, Math.PI * 2); ctx.fill();
      }
    } else {
      // Reduced motion: one static, deliberately rough fix of where Earth is.
      ctx.strokeStyle = 'rgba(245,196,67,.8)'; ctx.setLineDash([4, 4]); ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(...P(earth.x + noise * 0.6, earth.y - noise * 0.5), R * noise * 1.6, 0, Math.PI * 2); ctx.stroke(); ctx.setLineDash([]);
    }
    // beam + crosshair
    const [ax, ay] = P(aim.x, aim.y);
    ctx.fillStyle = 'rgba(184,169,240,.18)'; ctx.strokeStyle = '#B8A9F0'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(ax, ay, beam * R, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = C.ink; ctx.lineWidth = 5;
    ctx.beginPath(); ctx.moveTo(ax - 11, ay); ctx.lineTo(ax + 11, ay); ctx.moveTo(ax, ay - 11); ctx.lineTo(ax, ay + 11); ctx.stroke();
    ctx.strokeStyle = C.cream; ctx.lineWidth = 2.5;
    ctx.beginPath(); ctx.moveTo(ax - 10, ay); ctx.lineTo(ax + 10, ay); ctx.moveTo(ax, ay - 10); ctx.lineTo(ax, ay + 10); ctx.stroke();
    // rim
    ctx.strokeStyle = C.ink; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
  }, [t, aim.x, aim.y, beam, earth.x, earth.y, noise, animate]);
  const toAim = (e: RPointerEvent) => {
    const c = e.currentTarget as HTMLCanvasElement;
    const r = c.getBoundingClientRect();
    const R = Math.min(r.width, r.height) / 2 - 6;
    let x = (e.clientX - (r.left + r.width / 2)) / R, y = (e.clientY - (r.top + r.height / 2)) / R;
    const d = Math.hypot(x, y);
    if (d > 1) { x /= d; y /= d; }
    onAim({ x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 });
  };
  const nudge = (dx: number, dy: number) => onAim({ x: clamp(aim.x + dx, -1, 1), y: clamp(aim.y + dy, -1, 1) });
  return (
    <div className="tk-radar" style={{ ['--radar' as string]: `${size}px` }}>
      <canvas ref={ref} className="tk-radar__scope" role="slider" tabIndex={0} aria-label={`${label}. ${TEXT.aimHint}`}
        aria-valuetext={`x ${aim.x.toFixed(2)}, y ${aim.y.toFixed(2)}`}
        onPointerDown={(e) => { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); toAim(e); }}
        onPointerMove={(e) => { if (e.buttons) toAim(e); }}
        onKeyDown={(e) => {
          const s = e.shiftKey ? 0.05 : 0.01;
          const m: Record<string, [number, number]> = { ArrowUp: [0, -s], ArrowDown: [0, s], ArrowLeft: [-s, 0], ArrowRight: [s, 0] };
          if (m[e.key]) { e.preventDefault(); nudge(...m[e.key]); }
        }} />
      <div className="tk-radar__pad" role="group" aria-label={TEXT.fine}>
        <button type="button" className="btn btn--mini btn--secondary" aria-label={TEXT.nudge.up} onClick={() => nudge(0, -0.01)}>▲</button>
        <span>
          <button type="button" className="btn btn--mini btn--secondary" aria-label={TEXT.nudge.left} onClick={() => nudge(-0.01, 0)}>◀</button>
          <button type="button" className="btn btn--mini btn--secondary" aria-label={TEXT.nudge.right} onClick={() => nudge(0.01, 0)}>▶</button>
        </span>
        <button type="button" className="btn btn--mini btn--secondary" aria-label={TEXT.nudge.down} onClick={() => nudge(0, 0.01)}>▼</button>
      </div>
    </div>
  );
}

/** Noisy signal meter: true strength + jitter (10 Hz), smoothed number. Bars go green near the peak. */
export function SignalMeter({ strength, noise, animate }: { strength: number; noise: number; animate: boolean }) {
  const TEXT = useText();
  const [read, setRead] = useState(strength);
  const smooth = useRef(strength);
  useEffect(() => {
    if (!animate) { setRead(strength); smooth.current = strength; return; }
    const id = setInterval(() => {
      const v = clamp(strength + (Math.random() * 2 - 1) * noise);
      smooth.current = smooth.current * 0.6 + v * 0.4;
      setRead(v);
    }, 100);
    return () => clearInterval(id);
  }, [strength, noise, animate]);
  const bars = 12;
  const lit = Math.round(read * bars);
  return (
    <div className="tk-meter" aria-label={TEXT.signal} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(smooth.current * 100)}>
      <div className="tk-meter__head"><Icon name="res_signal" size={20} /><span>{TEXT.signal}</span><b className="t-mono">{Math.round(smooth.current * 100)} %</b></div>
      <div className="tk-meter__bars">
        {Array.from({ length: bars }, (_, i) => <i key={i} className={i < lit ? (i >= bars * 0.8 ? 'is-hi' : i >= bars * 0.5 ? 'is-mid' : 'is-lo') : ''} style={{ height: `${30 + (70 * (i + 1)) / bars}%` }} />)}
      </div>
    </div>
  );
}

// ── Measurement mode ──

const riskWord = (TEXT: Text, m: ModePreview) => (m.thermal === 'freezing' ? TEXT.riskFreeze : m.thermal === 'cold' ? TEXT.riskCold : TEXT.risk[m.risk]);
const riskTone = (m: ModePreview) => (m.risk >= 2 ? 'crit' : m.risk === 1 ? 'warn' : 'ok');

/** Three modes with their honest numbers: data rate and heat. */
export function ModePicker({ modes, value, onChange, disabled, only }: {
  modes: ModePreview[]; value: MeasureMode; onChange: (m: MeasureMode) => void; disabled?: boolean; only?: MeasureMode[];
}) {
  const TEXT = useText();
  return (
    <div className="tk-modes" role="radiogroup">
      {modes.filter((m) => !only || only.includes(m.mode) || m.mode === value).map((m) => (
        <button key={m.mode} type="button" role="radio" aria-checked={value === m.mode} className={`tk-mode tk-mode--${m.mode} ${value === m.mode ? 'is-selected' : ''}`}
          disabled={disabled || (only && !only.includes(m.mode))} onClick={() => onChange(m.mode)}>
          <span className="tk-mode__name">{TEXT.mode[m.mode]}</span>
          <span className="tk-mode__row"><Icon name="res_data" size={20} />{TEXT.data(Math.round((m.rate - 1) * 100))}</span>
          <span className="tk-mode__row"><Icon name="res_heat" size={20} />{TEXT.heat(m.heatDelta)}</span>
          <span className={`tk-mode__risk tk-mode__risk--${riskTone(m)}`}>{riskWord(TEXT, m)} · {m.heat > 0 ? '+' : ''}{m.heat}</span>
        </button>
      ))}
    </div>
  );
}
