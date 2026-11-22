// Pool de workers de génération, avec cache : une même pièce n'est jamais
// reconstruite deux fois pour le même réglage.

// Le worker est celui du projet, trouvé par convention depuis l'adresse de la
// page : <projet>/src/gen/worker.js.
//
// maxCache : nombre de résultats gardés (96 par défaut ; quelques-uns
// seulement quand une scène pèse des dizaines de Mo).
// idleMs : arrêt des workers après ce délai sans travail (4 s ; 0 : jamais).

export function createGenerator(size = Math.max(2, Math.min(6, (navigator.hardwareConcurrency || 4) - 1)), { worker = new URL('./src/gen/worker.js', document.baseURI), maxCache = 96, idleMs = 4000 } = {}) {
  // Les workers sont arrêtés après idleMs sans travail (0 : jamais) et recréés à
  // la demande suivante. Une fois la scène prête, leurs tas (souvent des centaines
  // de Mo après une génération) ne restent pas en mémoire pendant toute la boucle.
  let workers = [];
  const idle = [];
  const queue = [];
  const pending = new Map();
  const cache = new Map();
  let nextId = 1, reapTimer = 0;

  function spawn() {
    workers = Array.from({ length: size }, () => {
      const w = new Worker(worker, { type: 'module' });
      w.onmessage = ({ data }) => {
        const job = pending.get(data.id);
        if (data.progress != null) { job?.onProgress?.(data.progress, data.label); return; } // (avancement d'un long calcul)
        pending.delete(data.id);
        idle.push(w);
        if (data.error) job.reject(new Error(data.error)); else job.resolve(data.out);
        pump();
      };
      w.onerror = (e) => console.error('worker', e.message);
      return w;
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
      w.postMessage({ id: job.id, spec: job.spec, what: job.what }, job.transfer ?? []);
    }
    if (idleMs > 0 && !pending.size && !queue.length && workers.length && !reapTimer) reapTimer = setTimeout(reap, idleMs);
  }

  // onProgress(f, label) : avancement posté par le worker pendant un long
  // calcul (0 → 1) ; une pièce déjà en cache arrive avec (1, 'cache')
  // opts (facultatif) : key — clé du cache à la place de la recette entière
  // (quand le spec porte de gros tampons) ; cache: false — ne pas garder le
  // résultat (une pièce intermédiaire) ; transfer — tampons cédés au worker
  function request(spec, what, onProgress = null, opts = {}) {
    const key = opts.key ?? `${what}|${JSON.stringify(spec)}`;
    const keep = opts.cache !== false;
    if (keep && cache.has(key)) { const p = cache.get(key); cache.delete(key); cache.set(key, p); onProgress?.(1, 'cache'); return p; }
    const p = new Promise((resolve, reject) => { queue.push({ id: nextId++, spec, what, resolve, reject, onProgress, transfer: opts.transfer }); pump(); });
    if (keep) {
      p.catch(() => cache.delete(key));
      cache.set(key, p);
      while (cache.size > maxCache) cache.delete(cache.keys().next().value);
    }
    return p;
  }
  // un résultat est-il déjà en cache (ou en cours) sous cette clé ?
  const has = (key) => cache.has(key);

  // fin du pool (la méga-scène libère un jour, montré ou abandonné en cours de
  // préparation) : les workers sont arrêtés, les demandes en attente
  // abandonnées sans réponse — les rejeter faisait remonter des erreurs du
  // code d'un jour qui n'existe plus ; ses promesses en attente partent avec lui
  function terminate() {
    clearTimeout(reapTimer); reapTimer = 0;
    for (const w of workers) w.terminate();
    workers = []; idle.length = 0;
    queue.splice(0);
    pending.clear(); cache.clear();
  }

  return { request, has, size, busy: () => pending.size + queue.length, terminate };
}
