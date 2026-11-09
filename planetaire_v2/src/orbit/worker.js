// Worker de recherche : un essai (graine, indice) à la fois. Pendant la
// descente, envoie de temps en temps la courbe courante (pour l'écran de
// génération) ; à la fin, le résultat. Calcule aussi la stabilité sur demande.
import { createRng } from '../rng.js';
import { attempt } from './search.js';
import { sampleCurve } from './classify.js';
import { monodromyRadius, closure } from './integrate.js';

const SNAP_MS = 40;

self.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'attempt') {
    let last = 0;
    const onIter = m.live ? (stage, it, f, g, x, act) => {
      const t = performance.now();
      if (t - last < SNAP_MS) return;
      last = t;
      const pts = sampleCurve(x, { D: act.D, K: act.K }, 240);
      self.postMessage({ type: 'snap', job: m.job, index: m.index, stage, it, action: f, gnorm: g, pts, N: m.params.N }, [pts.buffer]);
    } : null;
    let r;
    try { r = attempt(m.params, createRng(`orbit:${m.seed}:${m.index}`), { onIter, index: m.index }); }
    catch (err) { r = { ok: false, reason: `erreur : ${err?.message || err}`, ms: 0 }; } // (un essai planté est un essai raté)
    self.postMessage({
      type: 'attempt', job: m.job, index: m.index, ok: r.ok, reason: r.reason, strategy: r.strategy, ms: r.ms,
      ...(r.ok && { coef: r.coef, params: r.params, action: r.action, residual: r.residual, info: r.info }),
    });
  } else if (m.type === 'stability') {
    const t0 = performance.now();
    const rho = monodromyRadius(m.coef, m.params, m.size);
    const cl = closure(m.coef, m.params, m.size).error;
    self.postMessage({ type: 'stability', job: m.job, rho, closure: cl, ms: performance.now() - t0 });
  }
};
