// Écran de chargement (module commun à tous les projets du dépôt).
//
// On regarde le calcul se faire : le dessin propre au projet (loaderArt.js)
// et l'avancement sont dessinés dans un worker, sur un OffscreenCanvas
// (loaderWorker.js) ; ils restent fluides même quand le fil principal traduit
// les matériaux ou construit la scène. Ce module ne fait que lui transmettre
// l'étape, l'avancement réel et les données du dessin.
//
// Il démarre dès sa lecture, avant que three.js ne soit téléchargé : la page
// le charge dans son propre <script type="module"> (sans dépendance), puis
// main.js l'importe (même module, même instance).
//
// Étapes : 'load' (le moteur, implicite au démarrage), puis celles que le
// projet déclare avec show({ steps }) — par défaut 'build' (la génération),
// 'compile' (les matériaux et la lumière) et 'settle' (les premières images).
// Le panneau de réglages est masqué pendant tout le chargement (body.loading).

const DEFAULT_STEPS = [['build', 'génération'], ['compile', 'préparation de la lumière'], ['settle', 'premières images']];

function createLoader(el) {
  const canvas = el.querySelector('canvas');
  const label = el.querySelector('.step');
  const msg = el.querySelector('.msg');
  const bar = el.querySelector('.actions');
  const bg = getComputedStyle(el).backgroundColor || '#050506';
  let steps = [['load', 'chargement du moteur'], ...DEFAULT_STEPS];
  let idx = 0, active = true, stopTimer = 0, sentAt = 0, lastF = -1;

  // ── le dessin : dans un worker si possible, sinon ici même ──
  let send = () => {};
  const size = () => {
    const dpr = Math.min(2, devicePixelRatio || 1);
    send({ type: 'size', w: Math.max(1, Math.round(canvas.clientWidth * dpr)), h: Math.max(1, Math.round(canvas.clientHeight * dpr)), dpr });
  };
  // (le dessin est celui du projet, trouvé par convention depuis l'adresse de
  // la page : <projet>/src/app/loaderArt.js)
  const art = new URL('./src/app/loaderArt.js', document.baseURI).href;
  const init = { type: 'init', art, bg, lite: document.body.classList.contains('lite') || matchMedia('(max-width: 640px)').matches };
  let worker = null;
  if (canvas?.transferControlToOffscreen && typeof Worker !== 'undefined') {
    try {
      worker = new Worker(new URL('./loaderWorker.js', import.meta.url), { type: 'module' });
      const off = canvas.transferControlToOffscreen();
      worker.postMessage({ ...init, canvas: off }, [off]);
      send = (m, tr) => worker.postMessage(m, tr || []);
      worker.onerror = (e) => console.warn('écran de chargement :', e.message);
    } catch { worker = null; }
  }
  if (!worker && canvas) { // (sans OffscreenCanvas : le même dessin, sur le fil principal)
    const queue = [];
    send = (m) => queue.push(m);
    import('./loaderWorker.js').then(({ createRunner }) => {
      const run = createRunner();
      run({ ...init, canvas });
      send = (m) => run(m);
      for (const m of queue.splice(0)) run(m);
    }, () => {});
  }
  size();
  addEventListener('resize', size);
  const post = () => send({ type: 'steps', steps: steps.map((s) => s[0]), idx });
  post();
  if (label) label.textContent = steps[0][1];
  send({ type: 'start' });

  const api = {
    get active() { return active; },
    // un nouveau chargement ; steps : [[clé, libellé], …] (sans 'load')
    show(opts = {}) {
      clearTimeout(stopTimer);
      if (opts.steps) steps = [['load', 'chargement du moteur'], ...opts.steps];
      active = true;
      // (le moteur est déjà là au deuxième chargement : on part de la première étape du projet)
      idx = Math.min(1, steps.length - 1); lastF = -1;
      el.classList.remove('gone', 'error');
      document.body.classList.add('loading');
      if (msg) msg.textContent = '';
      bar?.replaceChildren();
      if (label) label.textContent = steps[idx][1];
      post();
      send({ type: 'error', on: false });
      send({ type: 'start' });
      size();
    },
    // passe à l'étape `key` (libellé facultatif, sinon celui déclaré)
    step(key, text) {
      const i = steps.findIndex((s) => s[0] === key);
      if (i < 0) return;
      if (i !== idx) { idx = i; lastF = -1; post(); }
      if (label) label.textContent = text ?? steps[i][1];
    },
    // avancement réel de l'étape en cours (0 à 1), quand il est connu
    progress(f) {
      f = Math.max(0, Math.min(1, +f || 0));
      const now = performance.now();
      if (Math.abs(f - lastF) < 0.004 && now - sentAt < 250) return;
      lastF = f; sentAt = now;
      send({ type: 'progress', f });
    },
    // données propres au dessin du projet (voir loaderArt.js) ; transfer : tampons transférés
    art(data, transfer) { send({ type: 'art', data }, transfer); },
    // un échec : le message, et des boutons pour repartir ({ label, run })
    error(text, actions = []) {
      active = false;
      el.classList.remove('gone');
      el.classList.add('error');
      document.body.classList.remove('loading');
      if (msg) msg.textContent = text;
      send({ type: 'error', on: true });
      send({ type: 'start' });
      bar?.replaceChildren(...actions.map(({ label: l, run }) => {
        const b = document.createElement('button');
        b.textContent = l; b.onclick = () => run();
        return b;
      }));
    },
    // fin : le dessin achève son geste, puis l'écran s'efface (fondu de 1,2 s)
    hide() {
      if (!active && el.classList.contains('gone')) return;
      active = false;
      send({ type: 'done' });
      el.classList.add('gone');
      document.body.classList.remove('loading');
      clearTimeout(stopTimer);
      stopTimer = setTimeout(() => { if (el.classList.contains('gone')) send({ type: 'stop' }); }, 1600);
    },
    // (contrôle : images dessinées par le worker depuis le démarrage)
    stats: () => new Promise((res) => {
      if (!worker) return res(null);
      const on = (e) => { if (e.data?.type === 'stats') { worker.removeEventListener('message', on); res(e.data); } };
      worker.addEventListener('message', on);
      send({ type: 'stats' });
    }),
  };
  return api;
}

export const loader = createLoader(document.querySelector('#loader'));
