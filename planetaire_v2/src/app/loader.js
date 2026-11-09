// L'écran de génération : on regarde le calcul se faire, sans avoir à lire.
// Tout est dessiné dans un worker (loaderWorker.js, sur un OffscreenCanvas) :
// il reste fluide même quand le thread principal construit les machines ou
// compile les shaders. Ici, on ne fait que lui transmettre les essais, l'étape
// du chargement et les bras de la machine. Le seul texte est celui d'un échec
// (et ses boutons pour repartir).

const STEPS = ['orbit', 'design', 'build', 'render'];

export function createLoader(el) {
  const canvas = el.querySelector('canvas');
  const msg = el.querySelector('.msg');
  const txt = el.querySelector('.txt');
  const status = document.createElement('small'); status.className = 'status';
  const bar = document.createElement('div'); bar.className = 'actions';
  txt.append(status, bar);
  let worker = null;
  if (canvas.transferControlToOffscreen) {
    try {
      worker = new Worker(new URL('./loaderWorker.js', import.meta.url), { type: 'module' });
      const off = canvas.transferControlToOffscreen();
      worker.postMessage({ type: 'init', canvas: off }, [off]);
    } catch { worker = null; }
  }
  const post = (m, tr) => worker?.postMessage(m, tr || []);
  const size = () => {
    const dpr = Math.min(2, devicePixelRatio || 1);
    post({ type: 'size', w: Math.round(canvas.clientWidth * dpr), h: Math.round(canvas.clientHeight * dpr), dpr });
  };
  size();
  addEventListener('resize', size);
  const setStep = (k) => post({ type: 'step', step: Math.max(0, STEPS.indexOf(k)) });
  const start = () => { size(); post({ type: 'start' }); };

  return {
    show() {
      msg.textContent = '';
      el.classList.remove('gone', 'error');
      document.body.classList.add('loading');
      bar.replaceChildren(); status.textContent = '';
      post({ type: 'clear' }); post({ type: 'error', on: false });
      start();
    },
    // étape du chargement : orbit, design, build, render
    step: setStep,
    // une nouvelle recherche (une graine, au plus m essais)
    begin(s, m = 24) { post({ type: 'begin', max: m }); setStep('orbit'); },
    snap(i, s) {
      const pts = Float32Array.from(s.pts);
      post({ type: 'snap', i, pts, N: s.N }, [pts.buffer]);
    },
    // fin d'un essai : { ok, reason }
    result(i, r) { post({ type: 'result', i, ok: !!r.ok }); },
    // la machine conçue : ses bras apparaissent sur la courbe
    machine(D) { post({ type: 'machine', mech: { k: Array.from(D.k), L: Array.from(D.L), phi: Array.from(D.phi), N: D.N } }); },
    // (les étapes se lisent dans l'anneau : plus de légende)
    text() {},
    status(t) { if (el.classList.contains('error')) status.textContent = t; },
    // un échec : le message, et des boutons pour repartir ({ label, run })
    error(t, actions = []) {
      el.classList.remove('gone');
      document.body.classList.remove('loading');
      el.classList.add('error'); msg.textContent = t; status.textContent = 'N : nouvelle graine';
      post({ type: 'error', on: true });
      start();
      bar.replaceChildren(...actions.map(({ label: l, run }) => {
        const b = document.createElement('button');
        b.textContent = l; b.onclick = () => run();
        return b;
      }));
    },
    // (contrôle : images dessinées par le worker)
    stats: () => new Promise((res) => { if (!worker) return res(null); worker.onmessage = (e) => res(e.data); post({ type: 'stats' }); }),
    // (le dessin s'arrête à la fin du fondu)
    hide() { el.classList.add('gone'); document.body.classList.remove('loading'); setTimeout(() => { if (el.classList.contains('gone')) post({ type: 'stop' }); }, 1500); },
  };
}
