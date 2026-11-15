# 0003 Stack — accepted (2026-11-13)
**Decision:** React 19 + TypeScript + Vite, three.js via @react-three/fiber + drei, zustand, Supabase Realtime, Vitest.
**Why:** r3f keeps 3D and UI in one React tree; Supabase is suggested in the spec (TZ v2.0); Vite gives fast dev.
**Alternatives:** Babylon.js (heavier, worse with React), Unity WebGL (heavy build for phones, slow startup), Colyseus (needs our own server).
