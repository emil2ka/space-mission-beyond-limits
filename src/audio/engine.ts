// WebAudio sound engine: every sound is synthesized here (oscillators + noise + filters), no audio files.
// Graph: [ambience layers] → ambBus ┐
//        [one-shots, launch] → sfxBus ┴→ master → compressor (soft limiter) → destination
// The AudioContext is created on the first user gesture (browser autoplay policy) — see unlock().
import { T as LAUNCH_T } from '../scene/flight/launchTimeline';
import { SILENT, type Ambience, type Layers, type SfxId } from './events';

export interface Volumes {
  on: boolean;
  /** 0..1 each. */
  master: number;
  ambience: number;
  sfx: number;
  /** «Без резких звуков»: soft buzzer, no high blips, quieter noise. */
  soft: boolean;
}

/** Hard ceiling of the whole mix (master = 1 still stays at a comfortable level). */
const CEILING = 0.55;
const RAMP = 0.6;

export interface AudioLogEntry { at: number; name: string; played: boolean; note?: string }

type Loop = { gain: GainNode; stop: () => void };

export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private ambBus!: GainNode;
  private sfxBus!: GainNode;
  private launchBus: GainNode | null = null;
  /** Output meter (dev panel / browser checks: proves that something is actually sounding). */
  private meter: AnalyserNode | null = null;
  private white: AudioBuffer | null = null;
  private brown: AudioBuffer | null = null;
  private loops = new Map<string, Loop>();
  private layers: Layers = SILENT;
  private vol: Volumes = { on: true, master: 0.6, ambience: 0.5, sfx: 0.7, soft: false };
  private gate = { ambience: false, sfx: false };
  private puffTimer: ReturnType<typeof setTimeout> | null = null;
  readonly log: AudioLogEntry[] = [];
  private listeners = new Set<() => void>();

  /** Called from a user gesture: creates / resumes the context. Safe to call many times. */
  unlock() {
    if (typeof window === 'undefined') return;
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    if (!this.ctx) {
      const ctx = new AC();
      this.ctx = ctx;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14; comp.knee.value = 10; comp.ratio.value = 8; comp.attack.value = 0.004; comp.release.value = 0.25;
      comp.connect(ctx.destination);
      this.meter = ctx.createAnalyser(); this.meter.fftSize = 2048; comp.connect(this.meter);
      this.master = ctx.createGain(); this.master.gain.value = 0; this.master.connect(comp);
      this.ambBus = ctx.createGain(); this.ambBus.gain.value = 0; this.ambBus.connect(this.master);
      this.sfxBus = ctx.createGain(); this.sfxBus.gain.value = 0; this.sfxBus.connect(this.master);
      this.white = this.makeNoise(false);
      this.brown = this.makeNoise(true);
      this.note('context', true, 'AudioContext создан');
      this.applyVolumes();
      this.applyLayers();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume().then(() => this.emit());
    this.emit();
  }

  get state(): string { return this.ctx?.state ?? 'none'; }

  /** Current output level, dBFS (−∞ = silence). */
  level(): number {
    if (!this.meter) return -Infinity;
    const d = new Float32Array(this.meter.fftSize);
    this.meter.getFloatTimeDomainData(d);
    let sum = 0;
    for (const x of d) sum += x * x;
    return sum ? 10 * Math.log10(sum / d.length) : -Infinity;
  }

  /** Active loops (dev panel). */
  get loopNames(): string[] { return [...this.loops.keys()]; }

  setVolumes(v: Volumes) { this.vol = v; this.applyVolumes(); }

  setGate(g: { ambience: boolean; sfx: boolean }) {
    if (g.ambience === this.gate.ambience && g.sfx === this.gate.sfx) return;
    this.gate = g;
    this.applyVolumes();
    this.applyLayers();
  }

  setLayers(l: Layers) {
    const prev = this.layers;
    this.layers = l;
    if (prev.launch && !l.launch) this.endLaunch();
    this.applyLayers();
  }

  subscribe(fn: () => void) { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }

  /** One-shot. `force` (settings «test» button) plays even in an unfocused tab. */
  play(id: SfxId, force = false) {
    const ok = !!this.ctx && this.vol.on && (this.gate.sfx || force) && this.ctx.state === 'running';
    const why = !this.ctx ? 'нет AudioContext (ещё не было клика)' : !this.vol.on ? 'звук выключен' : !(this.gate.sfx || force) ? 'вкладка не в фокусе' : this.ctx.state !== 'running' ? `context ${this.ctx.state}` : undefined;
    this.note(id, ok, why);
    if (!ok) return;
    const t = this.ctx!.currentTime + 0.02;
    const soft = this.vol.soft;
    switch (id) {
      case 'click': this.tone(t, soft ? 900 : 1500, 0.025, 0.05, 'sine'); break;
      case 'install':
        this.tone(t, 660, 0.06, 0.18, 'triangle'); this.tone(t + 0.05, 990, 0.08, 0.12, 'triangle');
        this.noiseHit(t, 0.03, 0.08, 3000, 'highpass'); break;
      case 'remove': this.glide(t, 700, 420, 0.12, 0.14, 'triangle'); break;
      case 'approve': [523.25, 659.25, 783.99].forEach((f, i) => this.bell(t + i * 0.09, f, 0.9, 0.16)); break;
      case 'veto': this.tone(t, 392, 0.22, 0.14, 'triangle', 0.02); this.tone(t + 0.2, 329.63, 0.32, 0.12, 'triangle', 0.02); break;
      case 'launch': this.launch(t); break;
      case 'phase': this.bell(t, 587.33, 1.4, 0.1); this.bell(t + 0.12, 880, 1.6, 0.07); break;
      case 'crisis': this.buzzer(t, soft); this.radioNoise(t + 0.6, 1.4, soft ? 0.03 : 0.05); break;
      case 'crisis-resolved': this.bell(t, 659.25, 1, 0.12); this.bell(t + 0.14, 987.77, 1.4, 0.1); break;
      case 'crisis-closed': this.bell(t, 493.88, 1.2, 0.1); break;
      case 'radio': this.radioBlip(t, false, soft); break;
      case 'radio-sos': this.radioBlip(t, true, soft); break;
      case 'signal-lost': this.glide(t, 900, 260, 0.6, 0.16, 'sine'); this.radioNoise(t + 0.1, 0.8, soft ? 0.06 : 0.11); break;
      case 'signal-back': this.tone(t, 660, 0.09, 0.2, 'sine'); this.tone(t + 0.12, 990, 0.14, 0.2, 'sine'); break;
      case 'grab': this.servo(t, 0.5); this.thump(t + 0.5, 140, 0.18); break;
      case 'jam': this.grind(t, soft); break;
      case 'seal': this.thump(t, 220, 0.14); this.noiseHit(t + 0.05, 0.5, 0.05, 4000, 'highpass'); break;
      case 'capsule-sep': this.thump(t, 90, 0.3); this.noiseHit(t, 0.12, 0.12, 600, 'lowpass'); break;
      case 'chute': this.whoosh(t, 0.8); break;
      case 'touchdown': this.thump(t, 60, 0.35); this.noiseHit(t, 0.3, 0.1, 500, 'lowpass'); break;
      case 'beacon': for (let i = 0; i < 3; i++) this.tone(t + i * 0.5, soft ? 880 : 1046.5, 0.12, 0.16, 'sine', 0.01); break;
      case 'outcome-perfect': this.chord(t, [261.63, 329.63, 392, 523.25, 659.25], true, 3.5); break;
      case 'outcome-success': this.chord(t, [261.63, 329.63, 392, 523.25], false, 3); break;
      case 'outcome-partial': this.chord(t, [261.63, 293.66, 392, 587.33], false, 3); break; // Csus2: open, unresolved
      case 'outcome-failed': this.chord(t, [174.61, 220, 261.63, 329.63], false, 3.4, 0.25); break; // soft Fmaj7: calm, «попробуем ещё»
    }
  }

  close() {
    if (this.puffTimer) clearTimeout(this.puffTimer);
    this.puffTimer = null;
    this.launchBus = null;
    this.loops.forEach((l) => l.stop());
    this.loops.clear();
    void this.ctx?.close();
    this.ctx = null;
    this.meter = null;
  }

  // ───────────────────────── internals ─────────────────────────

  private emit() { this.listeners.forEach((f) => f()); }
  private note(name: string, played: boolean, note?: string) {
    this.log.unshift({ at: Date.now(), name, played, note });
    this.log.length = Math.min(this.log.length, 40);
    if (import.meta.env.DEV) console.debug(`[audio] ${played ? '▶' : '·'} ${name}${note ? ` — ${note}` : ''}`);
    this.emit();
  }

  private applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const m = this.vol.on ? this.vol.master * CEILING : 0;
    this.master.gain.setTargetAtTime(m, t, 0.08);
    this.ambBus.gain.setTargetAtTime(this.gate.ambience ? this.vol.ambience : 0, t, RAMP / 2);
    this.sfxBus.gain.setTargetAtTime(this.gate.sfx ? this.vol.sfx * (this.vol.soft ? 0.75 : 1) : 0, t, 0.05);
  }

  private makeNoise(brown: boolean): AudioBuffer {
    const ctx = this.ctx!;
    const len = ctx.sampleRate * 3;
    const b = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (brown) { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; } else d[i] = w;
    }
    // Device QA: brown noise drifts — remove the buffer's DC offset (it was up to −51 dBFS in the launch roar).
    let mean = 0;
    for (let i = 0; i < len; i++) mean += d[i];
    mean /= len;
    for (let i = 0; i < len; i++) d[i] -= mean;
    return b;
  }

  private noiseSrc(brown = false): AudioBufferSourceNode {
    const s = this.ctx!.createBufferSource();
    s.buffer = brown ? this.brown : this.white;
    s.loop = true;
    s.loopStart = Math.random();
    return s;
  }

  private env(t: number, peak: number, attack: number, dur: number, out: AudioNode = this.sfxBus): GainNode {
    const g = this.ctx!.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(attack + 0.01, dur));
    g.connect(out);
    return g;
  }

  private tone(t: number, f: number, dur: number, peak: number, type: OscillatorType, attack = 0.004, out?: AudioNode) {
    const o = this.ctx!.createOscillator();
    o.type = type; o.frequency.value = f;
    o.connect(this.env(t, peak, attack, dur, out));
    o.start(t); o.stop(t + dur + 0.05);
  }

  private glide(t: number, f0: number, f1: number, dur: number, peak: number, type: OscillatorType) {
    const o = this.ctx!.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    o.connect(this.env(t, peak, 0.01, dur));
    o.start(t); o.stop(t + dur + 0.05);
  }

  /** Soft bell: sine + quiet octave partial, slow decay. */
  private bell(t: number, f: number, dur: number, peak: number, out?: AudioNode) {
    this.tone(t, f, dur, peak, 'sine', 0.01, out);
    this.tone(t, f * 2, dur * 0.5, peak * 0.25, 'sine', 0.01, out);
  }

  private noiseHit(t: number, dur: number, peak: number, freq: number, type: BiquadFilterType, out?: AudioNode) {
    const s = this.noiseSrc();
    const f = this.ctx!.createBiquadFilter();
    f.type = type; f.frequency.value = freq;
    s.connect(f); f.connect(this.env(t, peak, 0.005, dur, out));
    s.start(t); s.stop(t + dur + 0.05);
  }

  private thump(t: number, f: number, peak: number) {
    const o = this.ctx!.createOscillator();
    o.frequency.setValueAtTime(f * 1.6, t);
    o.frequency.exponentialRampToValueAtTime(f * 0.6, t + 0.25);
    o.connect(this.env(t, peak, 0.005, 0.3));
    o.start(t); o.stop(t + 0.35);
  }

  /** Crisis buzzer (design: short, no endless siren): two 0.18 s pulses. Soft mode: a two-tone sine chime instead. */
  private buzzer(t: number, soft: boolean) {
    if (soft) { this.tone(t, 523.25, 0.3, 0.26, 'sine', 0.03); this.tone(t + 0.28, 415.3, 0.4, 0.26, 'sine', 0.03); return; }
    const lp = this.ctx!.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 1600; lp.Q.value = 0.5;
    lp.connect(this.sfxBus);
    for (let i = 0; i < 2; i++) {
      const at = t + i * 0.26;
      for (const f of [330, 349]) this.tone(at, f, 0.18, 0.22, 'square', 0.012, lp);
    }
  }

  /** Quiet radio noise: band-passed hiss with a little crackle. */
  private radioNoise(t: number, dur: number, peak: number) {
    const s = this.noiseSrc();
    const bp = this.ctx!.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 0.8;
    const g = this.ctx!.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.06);
    g.gain.setValueAtTime(peak, t + dur * 0.6);
    g.gain.linearRampToValueAtTime(0, t + dur);
    s.connect(bp); bp.connect(g); g.connect(this.sfxBus);
    s.start(t); s.stop(t + dur + 0.05);
  }

  /** Tactical Radio: open-mic blip, short static, close blip (SOS: double open blip). */
  private radioBlip(t: number, sos: boolean, soft: boolean) {
    const hi = soft ? 1100 : 1600;
    this.tone(t, hi, 0.07, 0.17, 'sine', 0.004);
    if (sos) this.tone(t + 0.11, hi, 0.07, 0.17, 'sine', 0.004);
    this.radioNoise(t + (sos ? 0.2 : 0.09), 0.35, soft ? 0.06 : 0.1);
    this.tone(t + (sos ? 0.6 : 0.48), hi * 0.8, 0.06, 0.12, 'sine', 0.004);
  }

  private servo(t: number, dur: number) {
    const o = this.ctx!.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(180, t);
    o.frequency.linearRampToValueAtTime(320, t + dur);
    const lp = this.ctx!.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 900;
    o.connect(lp); lp.connect(this.env(t, 0.05, 0.05, dur));
    o.start(t); o.stop(t + dur + 0.05);
  }

  private grind(t: number, soft: boolean) {
    for (let i = 0; i < 4; i++) this.noiseHit(t + i * 0.09, 0.07, soft ? 0.05 : 0.09, 500, 'bandpass');
    this.thump(t + 0.38, 110, 0.12);
  }

  private whoosh(t: number, dur: number) {
    const s = this.noiseSrc();
    const bp = this.ctx!.createBiquadFilter();
    bp.type = 'bandpass'; bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(300, t);
    bp.frequency.exponentialRampToValueAtTime(1800, t + dur * 0.4);
    bp.frequency.exponentialRampToValueAtTime(500, t + dur);
    s.connect(bp); bp.connect(this.env(t, 0.14, 0.08, dur));
    s.start(t); s.stop(t + dur + 0.05);
    this.thump(t + dur * 0.4, 150, 0.12); // canopy snaps open
  }

  /** Outcome: a soft pad chord (+ an arpeggio of bells for Perfect). Never a «fail» buzzer. */
  private chord(t: number, notes: number[], arp: boolean, dur: number, attack = 0.12) {
    const ctx = this.ctx!;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass'; lp.frequency.value = 2200;
    lp.connect(this.sfxBus);
    notes.forEach((f, i) => {
      for (const det of [-4, 4]) {
        const o = ctx.createOscillator();
        o.type = 'triangle'; o.frequency.value = f; o.detune.value = det;
        const g = ctx.createGain();
        const at = t + (arp ? 0 : i * 0.06);
        g.gain.setValueAtTime(0, at);
        g.gain.linearRampToValueAtTime(0.035, at + attack);
        g.gain.setTargetAtTime(0, at + dur * 0.55, dur * 0.18);
        o.connect(g); g.connect(lp);
        o.start(at); o.stop(at + dur + 1);
      }
    });
    if (arp) notes.concat([notes[notes.length - 1] * 1.5]).forEach((f, i) => this.bell(t + 0.25 + i * 0.13, f * 2, 1.2, 0.06));
  }

  // ── launch: countdown beeps → ignition roar → liftoff → stage separation → stage 2 → fade (timeline = LaunchScene) ──
  private launch(t0: number) {
    const ctx = this.ctx!;
    this.launchBus?.disconnect();
    const bus = ctx.createGain();
    bus.gain.value = 1;
    bus.connect(this.sfxBus);
    this.launchBus = bus;
    const T = LAUNCH_T;
    const step = (T.ignition - T.countdown) / 3;
    for (let i = 0; i < 3; i++) this.tone(t0 + T.countdown + i * step, 880, 0.14, 0.08, 'sine', 0.005, bus);
    this.tone(t0 + T.ignition, 1318.5, 0.35, 0.09, 'sine', 0.005, bus);
    // Roar: brown noise through a low-pass that opens up at liftoff.
    const roar = (from: number, to: number, peak: number, cutoff: number) => {
      const s = this.noiseSrc(true);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(120, t0 + from);
      lp.frequency.linearRampToValueAtTime(cutoff, t0 + from + 1.2);
      lp.frequency.linearRampToValueAtTime(cutoff * 0.5, t0 + to);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t0 + from);
      g.gain.linearRampToValueAtTime(peak, t0 + from + 0.8);
      g.gain.setValueAtTime(peak, t0 + to - 0.4);
      g.gain.linearRampToValueAtTime(0, t0 + to);
      s.connect(lp); lp.connect(g); g.connect(bus);
      s.start(t0 + from); s.stop(t0 + to + 0.1);
    };
    roar(T.ignition, T.separation, 0.42, 700);
    roar(T.stage2, T.end, 0.22, 1100);
    this.rumbleAt(t0 + T.liftoff, 0.25, bus);
    // Separation: pyro thunk
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(140, t0 + T.separation);
    o.frequency.exponentialRampToValueAtTime(50, t0 + T.separation + 0.3);
    o.connect(this.env(t0 + T.separation, 0.25, 0.005, 0.35, bus));
    o.start(t0 + T.separation); o.stop(t0 + T.separation + 0.4);
    this.noiseHit(t0 + T.fairing, 0.25, 0.05, 2000, 'bandpass', bus);
  }

  private rumbleAt(t: number, peak: number, out: AudioNode) {
    const o = this.ctx!.createOscillator();
    o.type = 'sine'; o.frequency.value = 42;
    const g = this.ctx!.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.6);
    g.gain.setTargetAtTime(0, t + 3, 1.2);
    o.connect(g); g.connect(out);
    o.start(t); o.stop(t + 9);
  }

  private endLaunch() {
    if (!this.ctx || !this.launchBus) return;
    const bus = this.launchBus;
    this.launchBus = null;
    bus.gain.setTargetAtTime(0, this.ctx.currentTime, 0.4);
    setTimeout(() => bus.disconnect(), 3000);
  }

  // ── continuous layers ──
  private applyLayers() {
    if (!this.ctx) return;
    const l = this.layers;
    const amb: Ambience[] = ['hq', 'space', 'titan', 'earth'];
    for (const a of amb) this.loop(`amb:${a}`, l.ambience === a ? 1 : 0, () => this.makeAmbience(a!));
    this.loop('rain', l.rain, () => this.makeRain());
    this.loop('rotor', l.rotor, () => this.makeRotor());
    this.loop('drive:ion', l.drive === 'ion' ? 1 : 0, () => this.makeIon());
    this.loop('drive:chem', l.drive === 'chem' ? 1 : 0, () => this.makeChem());
    this.loop('static', l.static * (this.vol.soft ? 0.5 : 1), () => this.makeStatic());
    this.loop('reentry', l.reentry, () => this.makeReentry());
    if (l.thrusters && !this.puffTimer) { this.note('loop:thrusters', true, 'старт (импульсы каждые 1–4 с)'); this.schedulePuff(); }
    if (!l.thrusters && this.puffTimer) { clearTimeout(this.puffTimer); this.puffTimer = null; }
  }

  /** Start / ramp / stop a named loop. Level 0 fades it out and stops it. */
  private loop(name: string, level: number, make: () => Loop) {
    const ctx = this.ctx!;
    let lp = this.loops.get(name);
    if (level <= 0) {
      if (!lp) return;
      this.loops.delete(name);
      lp.gain.gain.setTargetAtTime(0, ctx.currentTime, RAMP);
      const l = lp;
      setTimeout(() => l.stop(), RAMP * 6000);
      return;
    }
    if (!lp) {
      lp = make();
      lp.gain.gain.value = 0;
      this.loops.set(name, lp);
      this.note(`loop:${name}`, true, 'старт');
    }
    lp.gain.gain.setTargetAtTime(level, ctx.currentTime, RAMP);
  }

  /** Builds a loop out of sources: returns its level gain (→ ambBus) and a stop() that ends everything. */
  private assemble(build: (out: GainNode) => (AudioScheduledSourceNode)[], bus: AudioNode = this.ambBus): Loop {
    const g = this.ctx!.createGain();
    g.connect(bus);
    const srcs = build(g);
    srcs.forEach((s) => s.start());
    return { gain: g, stop: () => { srcs.forEach((s) => { try { s.stop(); } catch { /* already stopped */ } }); g.disconnect(); } };
  }

  private lfo(rate: number, depth: number, target: AudioParam): OscillatorNode {
    const o = this.ctx!.createOscillator();
    o.frequency.value = rate;
    const g = this.ctx!.createGain();
    g.gain.value = depth;
    o.connect(g); g.connect(target);
    return o;
  }

  private filteredNoise(out: AudioNode, brown: boolean, type: BiquadFilterType, freq: number, gain: number, q = 0.7) {
    const ctx = this.ctx!;
    const s = this.noiseSrc(brown);
    const f = ctx.createBiquadFilter();
    f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = gain;
    s.connect(f); f.connect(g); g.connect(out);
    return { src: s, filter: f, gain: g };
  }

  private makeAmbience(a: Exclude<Ambience, null>): Loop {
    const ctx = this.ctx!;
    return this.assemble((out) => {
      const srcs: AudioScheduledSourceNode[] = [];
      if (a === 'hq') {
        // Agency hall: mains hum + air conditioning + a faint computer whine.
        for (const [f, v] of [[55, 0.032], [110, 0.016], [165, 0.005]] as const) {
          const o = ctx.createOscillator(); o.frequency.value = f;
          const g = ctx.createGain(); g.gain.value = v; o.connect(g); g.connect(out); srcs.push(o);
        }
        const air = this.filteredNoise(out, true, 'lowpass', 380, 0.076);
        srcs.push(air.src, this.lfo(0.07, 0.019, air.gain.gain));
      } else if (a === 'space') {
        // Deep, calm drone + a slow shimmer (cosy, not scary).
        for (const [f, v, det] of [[41.2, 0.038, 0], [61.7, 0.025, 3], [82.4, 0.013, -3]] as const) {
          const o = ctx.createOscillator(); o.frequency.value = f; o.detune.value = det;
          const g = ctx.createGain(); g.gain.value = v; o.connect(g); g.connect(out); srcs.push(o);
        }
        const pad = ctx.createGain(); pad.gain.value = 0.006; pad.connect(out);
        for (const f of [659.25, 987.77]) { const o = ctx.createOscillator(); o.frequency.value = f; o.connect(pad); srcs.push(o); }
        srcs.push(this.lfo(0.05, 0.005, pad.gain));
        const hiss = this.filteredNoise(out, true, 'lowpass', 220, 0.038);
        srcs.push(hiss.src);
      } else {
        // Wind: band-passed noise whose centre drifts (Titan thick and low, Earth lighter).
        const titan = a === 'titan';
        const w = this.filteredNoise(out, false, 'bandpass', titan ? 420 : 650, titan ? 0.09 : 0.06, 0.9);
        srcs.push(w.src, this.lfo(0.11, titan ? 180 : 260, w.filter.frequency), this.lfo(0.17, titan ? 0.04 : 0.03, w.gain.gain));
        const low = this.filteredNoise(out, true, 'lowpass', 160, titan ? 0.14 : 0.08);
        srcs.push(low.src);
      }
      return srcs;
    });
  }

  private makeRain(): Loop {
    return this.assemble((out) => {
      const r = this.filteredNoise(out, false, 'highpass', 2600, 0.035);
      const p = this.filteredNoise(out, false, 'bandpass', 1200, 0.02, 2);
      return [r.src, p.src, this.lfo(7.3, 0.012, p.gain.gain), this.lfo(3.1, 0.01, r.gain.gain)];
    });
  }

  /** Rotorcraft: low noise chopped by the blade-pass frequency («whup-whup»), plus the motor tone. */
  private makeRotor(): Loop {
    const ctx = this.ctx!;
    return this.assemble((out) => {
      const chop = ctx.createGain(); chop.gain.value = 0.05; chop.connect(out);
      const n = this.filteredNoise(chop, true, 'lowpass', 500, 1);
      const motor = ctx.createOscillator(); motor.type = 'triangle'; motor.frequency.value = 96;
      const mg = ctx.createGain(); mg.gain.value = 0.012; motor.connect(mg); mg.connect(out);
      return [n.src, this.lfo(17, 0.045, chop.gain), motor, this.lfo(0.3, 3, motor.frequency)];
    });
  }

  private makeIon(): Loop {
    const ctx = this.ctx!;
    return this.assemble((out) => {
      const srcs: AudioScheduledSourceNode[] = [];
      for (const [f, v] of [[220, 0.012], [330.5, 0.008]] as const) {
        const o = ctx.createOscillator(); o.frequency.value = f;
        const g = ctx.createGain(); g.gain.value = v; o.connect(g); g.connect(out);
        srcs.push(o, this.lfo(4.5, 1.5, o.frequency));
      }
      return srcs;
    });
  }

  private makeChem(): Loop {
    return this.assemble((out) => [this.filteredNoise(out, true, 'lowpass', 260, 0.1).src]);
  }

  /** Signal noise (blackout / interference) — goes to the effects bus: it is information, not ambience. */
  private makeStatic(): Loop {
    return this.assemble((out) => {
      const s = this.filteredNoise(out, false, 'bandpass', 2000, 0.03, 0.6);
      return [s.src, this.lfo(9, 0.012, s.gain.gain), this.lfo(0.4, 600, s.filter.frequency)];
    }, this.sfxBus);
  }

  private makeReentry(): Loop {
    return this.assemble((out) => {
      const r = this.filteredNoise(out, true, 'lowpass', 420, 0.21);
      const hi = this.filteredNoise(out, false, 'bandpass', 900, 0.014, 0.5);
      return [r.src, hi.src, this.lfo(5, 0.056, r.gain.gain)];
    });
  }

  /** Attitude thrusters: short hissing puffs every 1.2–3.8 s while the layer is on. */
  private schedulePuff() {
    this.puffTimer = setTimeout(() => {
      this.puffTimer = null;
      if (!this.layers.thrusters || !this.ctx) return;
      if (this.gate.ambience && this.vol.on && this.ctx.state === 'running') {
        const t = this.ctx.currentTime + 0.01;
        const n = 1 + Math.floor(Math.random() * 2);
        for (let i = 0; i < n; i++) this.noiseHit(t + i * 0.16, 0.12, 0.045, 1400, 'highpass', this.ambBus);
      }
      this.schedulePuff();
    }, 1200 + Math.random() * 2600);
  }
}
