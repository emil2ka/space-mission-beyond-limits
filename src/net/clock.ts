// Timers that keep running in a background tab. Browsers throttle setTimeout/setInterval in hidden
// tabs (down to once a minute after 5 min), which would mark a tabbed-away player offline and stall
// the flight clock on a host that switched tabs. Timers inside a dedicated Worker are not throttled
// that way, and its messages still reach the page. Falls back to plain timers without Worker (tests).

type Cb = () => void;
let worker: Worker | null = null;
let nextId = 1;
const cbs = new Map<number, { fn: Cb; repeat: boolean }>();

const SRC = `const t = new Map();
onmessage = (e) => {
  const { op, id, ms } = e.data;
  if (op === 'clear') { const h = t.get(id); if (h) { clearTimeout(h); clearInterval(h); t.delete(id); } return; }
  if (op === 'once') t.set(id, setTimeout(() => { t.delete(id); postMessage(id); }, ms));
  else t.set(id, setInterval(() => postMessage(id), ms));
};`;

function getWorker(): Worker | null {
  if (worker) return worker;
  if (typeof Worker === 'undefined' || typeof Blob === 'undefined' || typeof URL?.createObjectURL !== 'function') return null;
  try {
    worker = new Worker(URL.createObjectURL(new Blob([SRC], { type: 'text/javascript' })));
    worker.onmessage = (e) => {
      const c = cbs.get(e.data as number);
      if (!c) return;
      if (!c.repeat) cbs.delete(e.data as number);
      c.fn();
    };
  } catch { worker = null; }
  return worker;
}

export type TimerHandle = { clear(): void };

function start(ms: number, fn: Cb, repeat: boolean): TimerHandle {
  const w = getWorker();
  if (!w) {
    const h = repeat ? setInterval(fn, ms) : setTimeout(fn, ms);
    return { clear: () => (repeat ? clearInterval(h) : clearTimeout(h)) };
  }
  const id = nextId++;
  cbs.set(id, { fn, repeat });
  w.postMessage({ op: repeat ? 'every' : 'once', id, ms });
  return { clear: () => { if (cbs.delete(id)) w.postMessage({ op: 'clear', id }); } };
}

export const every = (ms: number, fn: Cb) => start(ms, fn, true);
export const after = (ms: number, fn: Cb) => start(ms, fn, false);
