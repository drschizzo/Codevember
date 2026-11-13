// Dessin de l'écran de chargement (module commun à tous les projets du dépôt).
// Il tourne dans un worker, sur un OffscreenCanvas : il reste fluide quand le
// fil principal est occupé. Il dessine le geste propre au projet
// (loaderArt.js, qui reçoit l'état ci-dessous) et, en bas, un fil d'avancement
// découpé en étapes. L'avancement affiché ne s'arrête jamais tout à fait :
// entre deux nouvelles du fil principal, il avance lentement vers la fin de
// l'étape en cours, sans jamais l'atteindre (un écran figé passe pour une
// page plantée) ; une vraie nouvelle le recale.
//
// État transmis au dessin (S) : w, h, dpr (taille en pixels), t (secondes
// depuis le début), dt, p (avancement affiché, 0 à 1), step (clé de l'étape),
// stepIdx, steps (clés), real (avancement réel de l'étape), done (0 → 1 après
// la fin : le dessin achève son geste pendant le fondu), error, lite.

export function createRunner() {
  const S = { w: 1, h: 1, dpr: 1, t: 0, dt: 0, p: 0, step: 'load', stepIdx: 0, steps: ['load'], real: 0, done: 0, error: false, lite: false, bg: '#050506' };
  let cv = null, ctx = null, art = null, artReady = null, running = false, frames = 0, last = 0, ended = false;
  const pending = [];
  const raf = typeof requestAnimationFrame === 'function' ? requestAnimationFrame : (f) => setTimeout(() => f(performance.now()), 16);

  const target = () => (S.stepIdx + S.real) / Math.max(1, S.steps.length);
  function frame(now) {
    if (!running) return;
    const dt = frame.manual ?? Math.min(0.1, last ? (now - last) / 1000 : 0.016);
    last = now; S.dt = dt; S.t += dt; frames++;
    // avancement : vers le vrai, et sinon une lente dérive vers la fin de l'étape (sans l'atteindre)
    const n = Math.max(1, S.steps.length), tgt = target();
    const cap = (S.stepIdx + 0.92) / n;
    if (S.p < tgt) S.p += (tgt - S.p) * Math.min(1, dt * 4);
    else if (S.p < cap) S.p += (cap - S.p) * Math.min(1, dt * 0.12);
    if (ended) { S.p += (1 - S.p) * Math.min(1, dt * 6); S.done = Math.min(1, S.done + dt / 1.3); }
    const { w, h } = S;
    ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = S.bg; ctx.fillRect(0, 0, w, h);
    if (art) { ctx.save(); try { art.draw(ctx, S); } catch (e) { console.warn(e); art = null; } ctx.restore(); }
    if (!S.error) bar();
    if (ended && S.done >= 1) { running = false; return; }
    if (frame.manual === undefined) raf(frame);
  }

  // le fil d'avancement : un trait fin, une encoche par étape, une tête qui respire
  function bar() {
    const { w, h, dpr } = S, n = Math.max(1, S.steps.length);
    const L = Math.min(220 * dpr, w * 0.5), x0 = (w - L) / 2, y = Math.round(h - Math.max(46 * dpr, h * 0.07)) + 0.5;
    const fade = 1 - S.done;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineWidth = Math.max(1, dpr);
    ctx.strokeStyle = `rgba(255, 244, 228, ${0.1 * fade})`;
    ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(x0 + L, y); ctx.stroke();
    for (let i = 1; i < n; i++) {
      const x = x0 + (L * i) / n;
      ctx.strokeStyle = `rgba(255, 244, 228, ${(S.p * n >= i ? 0.4 : 0.16) * fade})`;
      ctx.beginPath(); ctx.moveTo(x, y - 2.5 * dpr); ctx.lineTo(x, y + 2.5 * dpr); ctx.stroke();
    }
    const xp = x0 + L * Math.min(1, S.p);
    const g = ctx.createLinearGradient(x0, 0, xp, 0);
    g.addColorStop(0, `rgba(233, 196, 138, ${0.15 * fade})`); g.addColorStop(1, `rgba(240, 214, 170, ${0.85 * fade})`);
    ctx.strokeStyle = g;
    ctx.beginPath(); ctx.moveTo(x0, y); ctx.lineTo(xp, y); ctx.stroke();
    const breathe = 0.55 + 0.45 * Math.sin(S.t * 3.2);
    const r = (2.2 + 1.4 * breathe) * dpr;
    const glow = ctx.createRadialGradient(xp, y, 0, xp, y, r * 3.5);
    glow.addColorStop(0, `rgba(255, 232, 196, ${0.75 * fade})`); glow.addColorStop(1, 'rgba(255, 232, 196, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath(); ctx.arc(xp, y, r * 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  const start = () => { if (!running && ctx) { running = true; last = 0; raf(frame); } };
  function handle(m) {
    switch (m.type) {
      case 'init':
        S.bg = m.bg || S.bg; S.lite = !!m.lite;
        if (m.canvas) { cv = m.canvas; ctx = cv.getContext('2d'); }
        artReady = import(m.art).then((mod) => {
          art = (mod.default || mod.createArt)(S) || null;
          for (const d of pending.splice(0)) art?.data?.(d, S);
        }, (e) => console.warn('dessin du chargement :', e));
        break;
      case 'size':
        S.w = m.w; S.h = m.h; S.dpr = m.dpr;
        if (cv) { cv.width = m.w; cv.height = m.h; }
        art?.resize?.(S);
        break;
      case 'steps': {
        const prev = S.stepIdx;
        S.steps = m.steps; S.stepIdx = m.idx; S.step = m.steps[m.idx];
        if (m.idx !== prev) S.real = 0;
        // (retour en arrière — une nouvelle scène — : on repart de là)
        if (m.idx < prev) { S.p = m.idx / Math.max(1, S.steps.length); S.done = 0; ended = false; }
        art?.step?.(S);
        break;
      }
      case 'progress': S.real = m.f; break;
      case 'art': if (art) art.data?.(m.data, S); else pending.push(m.data); break;
      case 'error': S.error = !!m.on; break;
      case 'start': ended = false; S.done = 0; start(); break;
      case 'done': ended = true; art?.end?.(S); break;
      case 'stop': running = false; break;
      case 'stats': return { type: 'stats', frames, t: S.t };
      // (contrôle : une image à la main, sans horloge — captures, tests)
      case 'frame': running = true; last = 0; frame.manual = m.dt ?? 1 / 60; frame(0); running = false; break;
    }
  }
  return handle;
}

// dans un worker : les messages du fil principal
if (typeof WorkerGlobalScope !== 'undefined' && self instanceof WorkerGlobalScope) {
  const run = createRunner();
  self.onmessage = ({ data }) => { const r = run(data); if (r) self.postMessage(r); };
}
