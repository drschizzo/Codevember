// Pool de workers de génération, avec file d'attente à priorités et cache
// (une même couche n'est jamais reconstruite deux fois pour le même réglage).
//
// Priorité : les niveaux de détail grossiers d'abord (la scène apparaît vite,
// puis s'affine), et les demandes récentes avant les anciennes.

const MAX_CACHE = 72;

export function createGenerator(size = Math.max(2, Math.min(6, (navigator.hardwareConcurrency || 4) - 1))) {
  const workers = Array.from({ length: size }, () => new Worker(new URL('./worker.js', import.meta.url), { type: 'module' }));
  const idle = [...workers];
  const queue = [];
  const pending = new Map();
  const cache = new Map(); // clé → Promise
  let nextId = 1, seq = 0;

  workers.forEach((w) => {
    w.onmessage = ({ data }) => {
      const job = pending.get(data.id);
      pending.delete(data.id);
      idle.push(w);
      if (data.error) job.reject(new Error(data.error)); else job.resolve(data.out);
      pump();
    };
    w.onerror = (e) => console.error('worker', e.message);
  });

  function pump() {
    while (idle.length && queue.length) {
      queue.sort((a, b) => a.prio - b.prio || b.seq - a.seq);
      const job = queue.shift();
      if (job.cancelled) { job.reject(new Error('cancelled')); continue; }
      const w = idle.pop();
      pending.set(job.id, job);
      w.postMessage({ id: job.id, spec: job.spec, lod: job.lod, what: job.what });
    }
  }

  // spec : description d'une couche (sérialisable) ; lod : 0..3 ; what : 'mesh' | 'crystals'
  function request(spec, lod, what = 'mesh') {
    const key = `${what}|${lod}|${JSON.stringify(spec)}`;
    if (cache.has(key)) { const p = cache.get(key); cache.delete(key); cache.set(key, p); return p; }
    const p = new Promise((resolve, reject) => {
      queue.push({ id: nextId++, seq: seq++, prio: what === 'crystals' ? 1.5 : 3 - lod, spec, lod, what, resolve, reject });
      pump();
    });
    p.catch(() => cache.delete(key));
    cache.set(key, p);
    while (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value);
    return p;
  }

  return { request, size, busy: () => pending.size + queue.length };
}
