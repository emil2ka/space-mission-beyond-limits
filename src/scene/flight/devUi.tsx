// Tiny dev-page UI shared by the scene demo pages (dev builds only).
import type { CSSProperties, ReactNode } from 'react';

export const PAGE: CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 300px', height: '100vh', background: '#0E1330', color: '#F7F8FF' };
export const STAGE: CSSProperties = { position: 'relative', minWidth: 0 };
export const HINT: CSSProperties = { fontSize: 12, opacity: 0.7 };
export const ON: CSSProperties = { background: '#B8A9F0', color: '#0E1330' };
export const SMALL: CSSProperties = { padding: '3px 7px', fontSize: 11, borderRadius: 8 };

export function Panel({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div style={{ padding: 14, overflow: 'auto', borderLeft: '1px solid rgba(207,232,255,0.14)', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <b className="mono">{title}</b>
      {children}
    </div>
  );
}
export function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
      <span style={{ opacity: 0.8 }}>{label}</span>
      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>{children}</div>
    </label>
  );
}
export function Select<T extends string>({ value, options, set }: { value: T; options: readonly T[]; set: (v: T) => void }) {
  return (
    <select value={value} onChange={(e) => set(e.target.value as T)} style={{ width: '100%', padding: 6, borderRadius: 8, background: '#151C42', color: '#F7F8FF' }}>
      {options.map((o) => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}
export function Check({ label, value, set }: { label: string; value: boolean; set: (v: boolean) => void }) {
  return (
    <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 13 }}>
      <input type="checkbox" checked={value} onChange={(e) => set(e.target.checked)} /> {label}
    </label>
  );
}
