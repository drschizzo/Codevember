// Côté page : une réserve de workers, et la recherche d'une graine répartie
// entre eux. Les essais sont lancés par ordre d'indice ; le résultat est le
// premier essai réussi dont tous les essais d'indice inférieur ont échoué :
// le même, quel que soit le nombre de workers ou leur vitesse.
import { orbitParams } from './search.js';

export function createPool(size = Math.max(2, Math.min(8, (navigator.hardwareConcurrency || 4) - 1))) {
  const spawn = () => {
    const w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    w.busy = false;
    return w;
  };
  const workers = Array.from({ length: size }, spawn);
  // un worker qui s'emballe (recherche trop longue) est remplacé
  const respawn = () => { for (let i = 0; i < workers.length; i++) { workers[i].terminate(); workers[i] = spawn(); } };
  let jobId = 0;

  // recherche d'une graine ; onSnap(index, snap) pendant la descente, onTry(index, essai)
  // timeout (ms) : au-delà, la recherche rend { ok: false, reason: 'timeout' }
  function search(seed, { maxAttempts = 24, onSnap = null, onTry = null, over, timeout = 0 } = {}) {
    const job = ++jobId;
    const params = orbitParams(seed, over);
    const t0 = performance.now();
    const results = new Map();
    let next = 0, cancelled = false;
    return new Promise((resolve) => {
      let timer = 0;
      const settle = () => {
        for (let i = 0; i < maxAttempts; i++) {
          const r = results.get(i);
          if (!r) return false; // un essai d'indice inférieur est encore en cours
          if (r.ok) { finish({ ok: true, index: i, orbit: r }); return true; }
        }
        finish({ ok: false });
        return true;
      };
      const finish = (out) => {
        if (cancelled) return;
        cancelled = true;
        clearTimeout(timer);
        const tries = [...results.entries()].sort((a, b) => a[0] - b[0]).map(([i, r]) => ({ index: i, ok: r.ok, reason: r.reason, ms: r.ms }))
          .filter((t) => out.index === undefined || t.index <= out.index);
        resolve({ seed, params, ...out, tries, ms: performance.now() - t0 });
      };
      const launch = (w) => {
        if (cancelled || next >= maxAttempts) { w.busy = false; return; }
        const index = next++;
        w.busy = true;
        w.onmessage = (e) => {
          const m = e.data;
          if (m.job !== job) return;
          if (m.type === 'snap') { if (!cancelled && onSnap) onSnap(index, m); return; }
          if (m.type === 'attempt') {
            results.set(index, m);
            if (onTry && !cancelled) onTry(index, m);
            if (!settle()) launch(w); else w.busy = false;
          }
        };
        // un worker qui plante (erreur hors de l'essai) : l'essai est raté
        w.onerror = (ev) => {
          ev.preventDefault?.();
          if (cancelled || results.has(index)) return;
          results.set(index, { ok: false, reason: `worker : ${ev.message || 'erreur'}` });
          if (!settle()) launch(w); else w.busy = false;
        };
        w.postMessage({ type: 'attempt', job, seed, index, params, live: !!onSnap });
      };
      if (timeout) timer = setTimeout(() => { if (!cancelled) { respawn(); finish({ ok: false, reason: 'timeout' }); } }, timeout);
      for (const w of workers) launch(w);
    });
  }

  // stabilité (multiplicateurs de Floquet) et raccord des tirs multiples
  function stability(orbit) {
    const job = ++jobId;
    const w = workers.find((x) => !x.busy) || workers[0];
    return new Promise((resolve) => {
      const prev = w.onmessage;
      w.onmessage = (e) => {
        if (e.data.job !== job) { if (prev) prev(e); return; }
        w.onmessage = prev;
        resolve(e.data);
      };
      w.postMessage({ type: 'stability', job, coef: orbit.coef, params: orbit.params, size: orbit.info.size });
    });
  }

  return { size, search, stability };
}
