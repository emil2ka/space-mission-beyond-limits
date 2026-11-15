// Debris Alert: debris_1..3 (or placeholder chunks) stream past the craft, tumbling, in loops while `active`.
// Piece 2 grazes the hull: `onHit` fires at its closest point (the scene flashes the hull if it is a crisis).
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import { Group, IcosahedronGeometry, Mesh, MeshStandardMaterial, Vector3, type Object3D } from 'three';
import { useEnvModel } from '../models/loader';
import { toonify } from '../models/toon';

const PERIOD = 4.6;
const SPAN = 9;
/** Per piece: time offset in the loop, cross offsets (up, toward camera), spin rates, scale. */
const PIECES = [
  { dt: 0, up: 2.6, out: -2, spin: [1.3, 0.7, 0.4], s: 1 },
  { dt: 0.7, up: 0.8, out: 0.4, spin: [0.6, 1.6, 0.9], s: 0.8 },
  { dt: 2.6, up: -2.2, out: 1.5, spin: [1.9, 0.3, 1.2], s: 0.9 },
];

function placeholder(): Object3D {
  const root = new Group();
  PIECES.forEach((_, i) => {
    const g = new Group(); g.name = `debris_${i + 1}`;
    const m = new Mesh(new IcosahedronGeometry(0.35 + i * 0.08, 0), new MeshStandardMaterial({ color: ['#8A8494', '#C9A27A', '#6F6879'][i], flatShading: true }));
    m.scale.set(1.4, 0.7, 1);
    g.add(m);
    root.add(g);
  });
  toonify(root, { castShadow: false });
  return root;
}

export function Debris({ active, centre, along, up, onHit, reducedMotion }: {
  active: boolean;
  /** Craft world position (read every frame). */
  centre: () => Vector3;
  /** Unit direction the debris travels (world), and an "up" across it. */
  along: () => Vector3;
  up: () => Vector3;
  onHit: () => void;
  reducedMotion: boolean;
}) {
  const model = useEnvModel('debris');
  const root = useMemo(() => model?.scene ?? placeholder(), [model]);
  const pieces = useMemo(() => PIECES.map((_, i) => root.getObjectByName(`debris_${i + 1}`)).filter(Boolean) as Object3D[], [root]);
  const st = useRef({ t: 0, on: false, lastHitLoop: -1, stopAt: Infinity });
  const tmp = useMemo(() => new Vector3(), []);
  const side = useMemo(() => new Vector3(), []);

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.1);
    const s = st.current;
    if (active && !s.on) { s.on = true; s.t = 0; s.lastHitLoop = -1; }
    if (active) s.stopAt = Infinity; else if (s.on && s.stopAt === Infinity) s.stopAt = s.t;
    if (s.on) s.t += dt;
    const c = centre(), a = along(), u = up();
    side.crossVectors(a, u).normalize();
    let any = false;
    pieces.forEach((o, i) => {
      const p = PIECES[i];
      const local = s.t - p.dt;
      const loop = Math.floor(local / PERIOD);
      const k = local / PERIOD - loop;
      // stop launching new loops once inactive; let the current pass finish
      const show = s.on && local >= 0 && loop * PERIOD + p.dt < s.stopAt;
      o.visible = show;
      if (!show) return;
      any = true;
      tmp.copy(c).addScaledVector(a, (k - 0.5) * SPAN * 2).addScaledVector(u, p.up).addScaledVector(side, p.out);
      o.position.copy(tmp);
      o.scale.setScalar(p.s);
      const r = reducedMotion ? 0.3 : 1;
      o.rotation.set(s.t * p.spin[0] * r, s.t * p.spin[1] * r, s.t * p.spin[2] * r);
      if (i === 1 && active && k >= 0.5 && loop !== s.lastHitLoop) { s.lastHitLoop = loop; onHit(); }
    });
    if (!active && !any) s.on = false;
  });

  return <primitive object={root} />;
}
