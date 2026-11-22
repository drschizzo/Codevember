// Pool de workers de génération, avec cache : une même pièce n'est jamais
// reconstruite deux fois pour le même réglage.

const MAX_CACHE = 96;

export function createGenerator(size = Math.max(2, Math.min(6, (navigator.hardwareConcurrency || 4) - 1))) {
  let workers = [];
  const idle = [];
  const queue = [];
  const pending = new Map();
  const cache = new Map();
  let nextId = 1;

  // Les workers sont arrêtés après 4 s sans travail et recréés à la demande
  // suivante : une fois la scène prête, leurs tas (souvent des centaines de Mo
  // après une génération) ne restent pas en mémoire pendant toute la boucle.
  let reapTimer = 0;
  function spawn() {
    workers = Array.from({ length: size }, () => new Worker(new URL('./worker.js', import.meta.url), { type: 'module' }));
    workers.forEach((w) => {
      w.onmessage = ({ data }) => {
        if (data.part) { pending.get(data.id)?.onPart?.(data.part); return; } // (nouvelles en route)
        const job = pending.get(data.id);
        pending.delete(data.id);
        idle.push(w);
        if (data.error) job.reject(new Error(data.error)); else job.resolve(data.out);
        pump();
      };
      w.onerror = (e) => console.error('worker', e.message);
    });
    idle.push(...workers);
  }
  function reap() {
    reapTimer = 0;
    if (pending.size || queue.length || !workers.length) return;
    for (const w of workers) w.terminate();
    workers = []; idle.length = 0;
  }
  spawn(); // (dès maintenant : les modules des workers se chargent pendant que la page s'installe)

  function pump() {
    if (queue.length) { clearTimeout(reapTimer); reapTimer = 0; if (!workers.length) spawn(); }
    while (idle.length && queue.length) {
      const job = queue.shift();
      const w = idle.pop();
      pending.set(job.id, job);
      w.postMessage({ id: job.id, spec: job.spec, what: job.what, live: !!job.onPart });
    }
    if (!pending.size && !queue.length && workers.length && !reapTimer) reapTimer = setTimeout(reap, 4000);
  }

  // onPart(part) : nouvelles en route du calcul (seulement pour le premier
  // demandeur : une pièce déjà en cache arrive sans elles)
  function request(spec, what, onPart) {
    const key = `${what}|${JSON.stringify(spec)}`;
    if (cache.has(key)) { const p = cache.get(key); cache.delete(key); cache.set(key, p); return p; }
    const p = new Promise((resolve, reject) => { queue.push({ id: nextId++, spec, what, onPart, resolve, reject }); pump(); });
    p.catch(() => cache.delete(key));
    cache.set(key, p);
    while (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value);
    return p;
  }

  return { request, busy: () => pending.size + queue.length };
}
