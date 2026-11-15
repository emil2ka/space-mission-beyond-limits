import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import './ui/styles.css';

// Dev only: `?scene=launch` / `?scene=titan` open the M1 flight scenes with mock props (src/scene/flight/DevScenes.tsx).
const devScene = import.meta.env.DEV ? new URLSearchParams(location.search).get('scene') : null;
const DevScenes = devScene ? lazy(() => import('./scene/flight/DevScenes').then((m) => ({ default: m.DevScenes }))) : null;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {DevScenes && devScene ? <Suspense fallback={null}><DevScenes scene={devScene} /></Suspense> : <App />}
  </StrictMode>,
);
