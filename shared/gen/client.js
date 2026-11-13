// Pool de workers de génération, avec cache : une même pièce n'est jamais
// reconstruite deux fois pour le même réglage.

// Le worker est celui du projet, trouvé par convention depuis l'adresse de la
// page : <projet>/src/gen/worker.js.
//
// maxCache : nombre de résultats gardés (96 par défaut ; quelques-uns
// seulement quand une scène pèse des dizaines de Mo).

export function createGenerator(size = Math.max(2, Math.min(6, (navigator.hardwareConcurrency || 4) - 1)), { worker = new URL('./src/gen/worker.js', document.baseURI), maxCache = 96 } = {}) {
  const workers = Array.from({ length: size }, () => new Worker(worker, { type: 'module' }));
  const idle = [...workers];
  const queue = [];
  const pending = new Map();
  const cache = new Map();
  let nextId = 1;

  workers.forEach((w) => {
    w.onmessage = ({ data }) => {
      const job = pending.get(data.id);
      if (data.progress != null) { job?.onProgress?.(data.progress, data.label); return; } // (avancement d'un long calcul)
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

  // onProgress(f, label) : avancement posté par le worker pendant un long
  // calcul (0 → 1) ; une pièce déjà en cache arrive avec (1, 'cache')
  function request(spec, what, onProgress = null) {
    const key = `${what}|${JSON.stringify(spec)}`;
    if (cache.has(key)) { const p = cache.get(key); cache.delete(key); cache.set(key, p); onProgress?.(1, 'cache'); return p; }
    const p = new Promise((resolve, reject) => { queue.push({ id: nextId++, spec, what, resolve, reject, onProgress }); pump(); });
    p.catch(() => cache.delete(key));
    cache.set(key, p);
    while (cache.size > maxCache) cache.delete(cache.keys().next().value);
    return p;
  }

  return { request, busy: () => pending.size + queue.length };
}
