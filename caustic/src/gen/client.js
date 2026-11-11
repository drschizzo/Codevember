// Pool de workers de génération, avec cache : une même pièce n'est jamais
// reconstruite deux fois pour le même réglage.

const MAX_CACHE = 96;

export function createGenerator(size = Math.max(2, Math.min(6, (navigator.hardwareConcurrency || 4) - 1))) {
  const workers = Array.from({ length: size }, () => new Worker(new URL('./worker.js', import.meta.url), { type: 'module' }));
  const idle = [...workers];
  const queue = [];
  const pending = new Map();
  const cache = new Map();
  let nextId = 1;

  workers.forEach((w) => {
    w.onmessage = ({ data }) => {
      const job = pending.get(data.id);
      if (data.progress) { job?.onProgress?.(data.progress); return; } // (avancement d'un long calcul)
      pending.delete(data.id);
      idle.push(w);
      if (data.error) job.reject(new Error(data.error)); else job.resolve(data.out);
      pump();
    };
    w.onerror = (e) => console.error('worker', e.message);
  });

  function pump() {
    while (idle.length && queue.length) {
      const job = queue.shift();
      const w = idle.pop();
      pending.set(job.id, job);
      w.postMessage({ id: job.id, spec: job.spec, what: job.what });
    }
  }

  // (onProgress : avancement d'un long calcul ; noCache : gros tampons
  // transférés, qu'on ne garde pas — un spectre de 8 Mo par dessin)
  function request(spec, what, { onProgress = null, noCache = false } = {}) {
    const key = `${what}|${JSON.stringify(spec)}`;
    if (!noCache && cache.has(key)) { const p = cache.get(key); cache.delete(key); cache.set(key, p); return p; }
    const p = new Promise((resolve, reject) => { queue.push({ id: nextId++, spec, what, resolve, reject, onProgress }); pump(); });
    if (noCache) return p;
    p.catch(() => cache.delete(key));
    cache.set(key, p);
    while (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value);
    return p;
  }

  return { request, busy: () => pending.size + queue.length };
}
