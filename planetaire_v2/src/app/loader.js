// L'écran de génération : on regarde le calcul se faire, et on le comprend.
// Le dessin (la courbe de l'essai en tête et ses astres, une vignette par essai)
// est fait dans un worker (loaderWorker.js, sur un OffscreenCanvas) : il reste
// fluide même quand le thread principal construit les machines ou compile les
// shaders. Ici, les textes : ce que cherche le moteur, l'étape de l'essai en
// tête, la raison de chaque rejet, et les quatre étapes du chargement.
// (Sans OffscreenCanvas, on se contente des textes.)

// raisons de rejet du solveur (orbit/search.js) : un mot pour la vignette, une
// phrase pour la ligne d'explication
const REASONS = {
  collision: ['collision', 'deux astres se sont percutés en cours de route'],
  Lagrange: ['polygone', 'il est retombé sur la solution la plus simple, un polygone d’astres qui tourne en bloc (Lagrange)'],
  'frôlement': ['trop serrée', 'deux astres s’y frôlent de trop près pour qu’une machine les porte'],
  plane: ['plane', 'la courbe s’est aplatie'],
  'parcourue plusieurs fois': ['déjà vue', 'c’est une orbite plus simple, parcourue plusieurs fois'],
  'non résolue': ['imprécise', 'la courbe n’obéit pas assez exactement à la loi de Newton'],
  'non convergée': ['imprécise', 'le calcul n’a pas convergé vers une solution exacte'],
  'trop de bras': ['trop complexe', 'il faudrait trop d’engrenages pour la tracer'],
  'continuation rompue': ['égarée', 'le calcul a perdu la solution en chemin'],
  'Newton égaré': ['égarée', 'le calcul a perdu la solution en chemin'],
};
const reasonOf = (r = '') => REASONS[r] || (r.startsWith('erreur') || r.startsWith('worker') ? ['erreur', 'le calcul a échoué'] : [r || 'écarté', r || 'écarté']);

// étape du solveur (orbit/search.js) → phrase
function stageText(stage = '') {
  const e = /^ε\s*([\d.]+)/.exec(stage);
  if (e) return Number(e[1]) > 0 ? 'descente : la courbe se déforme vers moins d’action, les astres se repoussent encore un peu pour ne pas se percuter' : 'descente sous la seule gravité';
  if (/K\s*\d+/.test(stage)) return `polissage (méthode de Newton, ${/K\s*(\d+)/.exec(stage)[1]} harmoniques) : la courbe devient une solution exacte`;
  return 'la courbe se déforme';
}

const STEPS = ['orbit', 'design', 'build', 'render'];

export function createLoader(el) {
  const canvas = el.querySelector('canvas');
  const msg = el.querySelector('.msg'), lead = el.querySelector('.lead'), head = el.querySelector('.tries .head'), why = el.querySelector('.why');
  const what = el.querySelector('.what');
  const txt = el.querySelector('.txt');
  const steps = [...el.querySelectorAll('.steps li')];
  const status = document.createElement('small'); status.className = 'status';
  const bar = document.createElement('div'); bar.className = 'actions';
  txt.append(status, bar);
  const whatBase = what.innerHTML;
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

  // état des essais (pour les textes)
  let seed = '', max = 24, N = 0, fails = 0, found = null, searching = false, lastLead = 0;
  const running = new Map(); // indice → { stage, action }
  const done = new Set();
  const setHead = () => {
    head.textContent = searching || found !== null
      ? `les ${max} essais de la graine ${seed} · ${fails} écarté${fails > 1 ? 's' : ''}${found !== null ? ` · essai ${found + 1} retenu` : ''}`
      : '';
  };
  const setLead = (force = false) => {
    const t = performance.now();
    if (!force && t - lastLead < 150) return;
    lastLead = t;
    if (found !== null) { lead.textContent = `essai ${found + 1} : une chorégraphie exacte de ${N} astres. Ses astres la parcourent déjà.`; return; }
    if (!searching) { lead.textContent = ''; return; }
    const ids = [...running.keys()].filter((i) => !done.has(i)).sort((a, b) => a - b);
    if (!ids.length) { lead.textContent = 'tirage des courbes de départ…'; return; }
    const r = running.get(ids[0]);
    lead.textContent = `essai ${ids[0] + 1} : ${stageText(r.stage)}`;
  };
  const setWhat = () => {
    what.innerHTML = N ? whatBase.replace('des astres de même masse', `${N} astres de même masse`) : whatBase;
  };
  const setStep = (k) => {
    const i = STEPS.indexOf(k);
    steps.forEach((li, j) => { li.classList.toggle('on', j === i); li.classList.toggle('done', j < i); });
  };
  const start = () => { size(); post({ type: 'start' }); };

  return {
    show(text = 'recherche d’une trajectoire…') {
      searching = false; found = null; N = 0; running.clear(); done.clear(); fails = 0;
      msg.textContent = text; lead.textContent = ''; head.textContent = ''; why.textContent = '';
      setWhat(); setStep('orbit');
      el.classList.remove('gone', 'error');
      document.body.classList.add('loading');
      bar.replaceChildren(); status.textContent = '';
      post({ type: 'clear' });
      start();
    },
    // étape du chargement : orbit, design, build, render
    step: setStep,
    // une nouvelle recherche (une graine, au plus max essais)
    begin(s, m = 24) {
      seed = s; max = m; fails = 0; found = null; searching = true; running.clear(); done.clear();
      why.textContent = '';
      post({ type: 'begin', max: m });
      setStep('orbit'); setHead(); setLead(true);
      msg.textContent = `recherche d’une trajectoire : jusqu’à ${m} essais en parallèle`;
    },
    snap(i, s) {
      const pts = Float32Array.from(s.pts);
      post({ type: 'snap', i, pts, N: s.N }, [pts.buffer]);
      if (s.N && s.N !== N) { N = s.N; setWhat(); }
      running.set(i, { stage: s.stage, action: s.action });
      setLead();
    },
    // fin d'un essai : { ok, reason }
    result(i, r) {
      done.add(i);
      const [short, long] = reasonOf(r.reason);
      post({ type: 'result', i, ok: !!r.ok, reason: r.ok ? '' : short });
      if (r.ok) { if (found === null || i < found) found = i; why.textContent = ''; }
      else { fails++; if (found === null) why.textContent = `essai ${i + 1} écarté : ${long}.`; }
      setHead(); setLead(true);
    },
    text(t) { searching = false; msg.textContent = t; setLead(true); },
    status(t) { status.textContent = t; },
    // un échec : le message, et des boutons pour repartir ({ label, run })
    error(t, actions = []) {
      el.classList.remove('gone');
      document.body.classList.remove('loading');
      el.classList.add('error'); searching = false; msg.textContent = t; status.textContent = 'N : nouvelle graine';
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
    hide() { el.classList.add('gone'); document.body.classList.remove('loading'); searching = false; setTimeout(() => { if (el.classList.contains('gone')) post({ type: 'stop' }); }, 1500); },
  };
}
