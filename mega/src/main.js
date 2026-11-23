// La méga-scène : le relais. Les jours se succèdent en un seul plan ; la fin
// de l'un passe la main au suivant par la chaleur (composite.js).
//
// Streaming : un seul moteur, un seul canvas, et jamais plus de deux jours en
// mémoire. Pendant qu'un jour joue sa boucle, le suivant est généré (workers
// de son projet) puis compilé à raison d'un dessin par image, dans sa propre
// cible ; au passage, les deux sont dessinés et composés ; ensuite le premier
// est libéré (géométries, matériaux, cibles, workers) et le jour d'après se
// prépare à son tour.
//
// Paramètres d'URL : ?days=shatter,melt (l'ordre du relais ; par défaut, celui du calendrier), ?pr=1
// (rapport de pixels), ?t=5 (durée d'un passage, en secondes), ?loops=1
// (boucles jouées par jour au moins), ?debug (window.mega).
import * as THREE from 'three/webgpu';
import { asyncPipelines, sleep } from '../../shared/app/warmup.js';
import { createComposite } from './composite.js';
import { installLedger } from './kit.js';

const params = new URLSearchParams(location.search);
// l'ordre du calendrier (jour 1 à 23), puis retour au premier
const DAYS = (params.get('days') || 'fold,shatter,melt,tangle,moss,planetaire_v2,hollow,tesseract,membrane,caustic,rust,feather,labyrinth,tension,mirage,spore,kelp,pendulum,erosion,cocoon,bolt,echo,magma,nest,veil').split(',').filter(Boolean);
const ENTER = params.get('enter'); // (forcer un passage, pour le régler)
const T = +(params.get('t') || 5);          // durée d'un passage (s)
const LOOPS = +(params.get('loops') || 1);  // boucles jouées par jour, au moins
const PUSH = 0.45;                          // avancée de la caméra au passage
// (noms des jours pour le menu, sans charger leurs modules)
const NAMES = { planetaire_v2: 'Orrery' };
const nameOf = (id) => NAMES[id] ?? id[0].toUpperCase() + id.slice(1);
const $ = (s) => document.querySelector(s);
const ease = (x) => { x = Math.min(1, Math.max(0, x)); return x * x * (3 - 2 * x); };

function fail(msg) {
  $('#boot p').textContent = msg;
  $('#boot').classList.add('error');
}

async function main() {
  if (!navigator.gpu) return fail('Ce navigateur ne prend pas en charge WebGPU.');
  const renderer = new THREE.WebGPURenderer({ antialias: false, powerPreference: 'high-performance' });
  try { await renderer.init(); } catch (e) { return fail(`Impossible d'initialiser le rendu : ${e.message}`); }
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.shadowMap.transmitted = true;
  $('#app').appendChild(renderer.domElement);
  const pipes = asyncPipelines(renderer);
  installLedger(renderer); // (avant tout jour : chaque texture est rattachée à son projet)

  let comp = null; // (composition : créée à la taille du canvas, après le premier resize)
  const PR = +(params.get('pr') || Math.min(devicePixelRatio, 1.5));
  const bufSize = () => renderer.getDrawingBufferSize(new THREE.Vector2());
  function resize() {
    renderer.setPixelRatio(PR);
    renderer.setSize(innerWidth, innerHeight);
    const s = bufSize();
    comp?.resize(s.x, s.y);
    for (const d of [cur, next]) d?.resize(s.x, s.y);
  }

  // ── Images de l'hôte ──
  // nextFrame() : se résout à la fin de l'image suivante (la préparation d'un
  // jour ne dessine qu'une fois par image, sans voler celle du jour qui joue)
  let waiters = [];
  const nextFrame = () => new Promise((r) => waiters.push(r));

  // Un dessin du jour qui joue ne doit pas être découpé par la préparation de
  // l'autre (warmup.js saute les objets nouveaux au-delà de son budget).
  function live(day, u, look) {
    const g = renderer.__gate, gOn = g?.on, pOn = pipes.on;
    if (g) g.on = false;
    pipes.on = false;
    day.render(u, look);
    if (g) g.on = gOn;
    pipes.on = pOn;
  }

  // ── Jours ──
  const stats = [];
  let cur = null, next = null;
  async function load(i) {
    const id = DAYS[((i % DAYS.length) + DAYS.length) % DAYS.length];
    const t0 = performance.now();
    const mod = await import(`../../${id}/src/day.js`);
    const s = bufSize();
    const day = await mod.createDay({ renderer, pipes, width: s.x, height: s.y, nextFrame });
    day.index = i; day.prog = 0;
    day.slot = ((i % 2) + 2) % 2; // (le jour qui joue et le suivant n'ont jamais le même emplacement)
    day.useTarget(comp.slots[day.slot]);
    const st = { id, start: +(t0 / 1000).toFixed(1) };
    stats.push(st);
    day.ready = day.prepare({ yieldFn: nextFrame, background: i > 0 && !params.has('fgprep'), onProgress: (f) => { day.prog = f; } }).then((ok) => {
      st.ready = +((performance.now() - t0) / 1000).toFixed(1);
      if (ok) st.duration = +day.duration.toFixed(2);
      { const m = renderer.info.memory; st.withNext = { texMB: Math.round(m.texturesSize / 1e6), heapMB: Math.round((performance.memory?.usedJSHeapSize ?? 0) / 1e6) }; }
      return ok;
    });
    return day;
  }

  // ── Premier jour : sous l'écran d'ouverture ──
  let firstShown = false;
  const caption = (day) => {
    $('#caption h2').textContent = day.meta.name;
    $('#caption p').textContent = day.meta.subtitle;
    $('#caption small').textContent = `jour ${(day.index % DAYS.length) + 1} / ${DAYS.length}`;
    // (l'explication suit le jour à l'écran, pas celle du relais)
    const how = $('#how');
    how.href = `../${day.meta.id}/explainer.html`;
    how.title = `Comment est fait ${day.meta.name}`;
    const c = $('#caption');
    c.classList.remove('on'); void c.offsetWidth; c.classList.add('on');
  };

  resize();
  addEventListener('resize', resize);
  { const s = bufSize(); comp = createComposite(renderer, s.x, s.y); comp.warm(); }
  // (?idle : l'hôte sans jour, pour mesurer un jour seul depuis la console)
  if (!params.has('idle')) cur = await load(0);
  cur?.ready.then((ok) => {
    if (!ok) return;
    cur.u = 0; cur.end = LOOPS;
    firstShown = true;
    $('#boot').classList.add('gone');
    caption(cur);
    prepareNext();
  }).catch((e) => fail(e.message));

  // Le jour suivant : celui de l'ordre, ou celui choisi dans le menu (index
  // du relais : le choisi garde la parité de l'emplacement libre, et l'ordre
  // reprend après lui). Un choix remplace le jour en préparation, qui est
  // libéré ; un chargement dépassé par un autre choix est libéré à son arrivée.
  let loadTok = 0, pending = null; // (pending : le jour en cours de création)
  async function prepareNext(i = cur.index + 1) {
    const tok = ++loadTok;
    pending = DAYS[((i % DAYS.length) + DAYS.length) % DAYS.length];
    let d = null;
    try { d = await load(i); } catch (e) { console.error(e); }
    if (tok !== loadTok) { d?.dispose(); return; }
    pending = null;
    next = d;
  }
  // choisir le jour qui suivra (menu) ; il prend la main à la fin de la boucle
  function choose(id) {
    const j = DAYS.indexOf(id);
    if (j < 0 || !cur || trans || id === cur.meta.id) return;
    if (next?.meta.id === id || pending === id) return;
    next?.dispose(); next = null;
    let i = cur.index + 1 + ((((j - cur.index - 1) % DAYS.length) + DAYS.length) % DAYS.length);
    if ((i - cur.index) % 2 === 0) i += DAYS.length; // (l'autre emplacement que le jour qui joue)
    armed = false;
    prepareNext(i);
  }

  // ── Boucle ──
  let last = performance.now(), clock = 0, trans = null, paused = false, hurry = false, preview = null, hold = false;
  let armed = false; // (bouton « suivant » pressé avant que le jour soit prêt : passage dès qu'il l'est)
  function tick(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    try {
      if (hold) return; // (une capture en cours : la boucle ne dessine rien)
      if (!firstShown) {
        if (!cur) return;
        $('#boot u').style.width = `${(cur ? cur.prog * 100 : 0).toFixed(1)}%`;
        return;
      }
      if (preview && next?.state === 'ready') {
        live(cur, preview.ua); live(next, preview.ub);
        comp.blend(cur.slot, preview.p, clock, preview.kind);
        return;
      }
      if (!paused) clock += dt;
      if (armed && next?.state === 'ready' && !trans) { armed = false; hurry = true; }
      const D = cur.duration;
      if (!paused) cur.u += dt / D;
      // Le passage se termine sur le raccord de la boucle : le jour sortant ne
      // repasse jamais par son début (Melt y recharge sa figurine). Et jamais
      // de saut de phase : après un saut, la simulation de Melt rattrape le
      // temps sauté, jusqu'à 48 pas par image, d'autant plus que l'image est
      // longue — le passage tombait à 4 images par seconde.
      if (trans) cur.u = Math.min(cur.u, cur.end - 1e-4);
      if (!trans && (cur.u >= cur.end - T / D || hurry)) {
        const early = hurry && cur.u < cur.end - T / D;
        hurry = false;
        // (passage demandé en avance : il part d'où en est la boucle, sans saut
        // de phase — un saut ferait rattraper à Melt tout le temps sauté)
        if (next?.state === 'ready') { trans = { t: 0 }; cur.end = Math.max(cur.u + T / D, cur.end); next.u = 0; next.end = LOOPS; next.pull = 0; }
        else if (!early) cur.end += 1; // (le suivant n'est pas prêt : encore un tour)
      }
      if (trans) {
        if (!paused) { trans.t += dt; next.u += dt / next.duration; }
        const p = Math.min(1, trans.t / T);
        live(cur, cur.u, { push: PUSH * ease(p) });
        live(next, next.u, { push: PUSH * (1 - ease(trans.t / (T * 1.6))) });
        comp.blend(cur.slot, p, clock, ENTER || next.meta.enter);
        if (p >= 1) {
          const done = cur;
          cur = next; next = null;
          cur.pull = trans.t;
          trans = null;
          done.dispose();
          // (mémoire avec un seul jour chargé : ce que la libération a rendu)
          const m = renderer.info.memory;
          stats.at(-1).alone = { texMB: Math.round(m.texturesSize / 1e6), rts: m.renderTargets };
          caption(cur);
          prepareNext();
        }
      } else {
        // (le jour arrivé finit de reculer, puis la caméra est celle de son film)
        const look = cur.pull != null && cur.pull < T * 1.6 ? { push: PUSH * (1 - ease(cur.pull / (T * 1.6))) } : { push: 0 };
        if (cur.pull != null && !paused) cur.pull += dt;
        live(cur, cur.u, look);
        comp.show(cur.slot);
      }
    } finally {
      ui();
      const w = waiters; waiters = [];
      for (const r of w) r();
    }
  }
  renderer.setAnimationLoop(tick);

  // ── Commandes discrètes : le menu des jours, le jour suivant ──
  // (bas à droite ; s'effacent quand la souris se repose, disparaissent avec H)
  const menu = $('#days'), list = $('#days ol'), pickBtn = $('#pick'), goBtn = $('#go');
  DAYS.forEach((id, j) => {
    const li = document.createElement('li'), b = document.createElement('button');
    b.type = 'button'; b.dataset.id = id;
    b.innerHTML = `<i>${String(j + 1).padStart(2, '0')}</i><span>${nameOf(id)}</span><em></em>`;
    b.addEventListener('click', () => { choose(id); openMenu(false); });
    li.append(b); list.append(li);
  });
  function openMenu(v = menu.hidden) {
    menu.hidden = !v;
    pickBtn.setAttribute('aria-expanded', String(v));
  }
  pickBtn.addEventListener('click', (e) => { e.stopPropagation(); openMenu(); });
  addEventListener('pointerdown', (e) => { if (!menu.hidden && !e.target.closest('#relay')) openMenu(false); });
  function goNext() {
    if (!cur || trans) return;
    if (next?.state === 'ready') { armed = false; hurry = true; }
    else armed = !armed; // (pas encore prêt : passage dès qu'il l'est ; un second appui annule)
  }
  goBtn.addEventListener('click', goNext);
  let idleTimer = 0;
  const wake = () => { document.body.classList.remove('idle'); clearTimeout(idleTimer); idleTimer = setTimeout(() => menu.hidden && document.body.classList.add('idle'), 3000); };
  addEventListener('pointermove', wake); addEventListener('pointerdown', wake); wake();
  let uiKey = '';
  function ui() {
    if (!firstShown || !cur) return;
    const id = next?.meta.id ?? pending ?? DAYS[(((cur.index + 1) % DAYS.length) + DAYS.length) % DAYS.length];
    const ready = next?.state === 'ready';
    // (la compilation annonce parfois un peu moins que la génération : la barre ne recule pas)
    if (next) next.shown = Math.max(next.shown ?? 0, next.prog);
    const prog = ready ? 1 : (next?.shown ?? 0);
    const key = `${cur.meta.id}|${id}|${ready}|${!!trans}|${armed}|${Math.round(prog * 50)}`;
    if (key === uiKey) return;
    uiKey = key;
    goBtn.disabled = !!trans;
    goBtn.classList.toggle('ready', ready);
    goBtn.classList.toggle('armed', armed);
    goBtn.querySelector('span').textContent = trans ? `passage vers ${nameOf(id)}` : ready ? `${nameOf(id)} →` : armed ? `${nameOf(id)} · dès qu'il est prêt` : `${nameOf(id)} · préparation`;
    goBtn.title = ready ? 'Passer au jour suivant (→)' : 'Le jour suivant se prépare ; cliquer pour y passer dès qu\'il est prêt (→)';
    goBtn.querySelector('u').style.width = `${(prog * 100).toFixed(0)}%`;
    pickBtn.disabled = !!trans;
    for (const b of list.querySelectorAll('button')) {
      const d = b.dataset.id, isCur = d === cur.meta.id, isNext = d === id;
      b.disabled = isCur || !!trans;
      b.classList.toggle('cur', isCur); b.classList.toggle('next', isNext);
      b.querySelector('em').textContent = isCur ? 'en cours' : isNext ? (ready ? 'prêt' : 'se prépare') : '';
    }
  }

  addEventListener('keydown', (e) => {
    if (e.code === 'Space') { e.preventDefault(); paused = !paused; }
    else if (e.key === 'h' || e.key === 'H') document.body.classList.toggle('clean');
    else if (e.key === 'f' || e.key === 'F') document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
    // → : aller au passage suivant (dès que le jour suivant est prêt)
    else if (e.key === 'ArrowRight') goNext();
    else if (e.key === 'Escape') openMenu(false);
  });

  if (params.has('debug')) {
    window.mega = {
      renderer, pipes, comp, stats,
      get cur() { return cur; }, get next() { return next; }, get trans() { return trans; },
      memory: () => {
        const m = renderer.info.memory;
        return { texMB: Math.round(m.texturesSize / 1e6), bufMB: Math.round((m.attributesSize + m.indexAttributesSize + m.storageAttributesSize) / 1e6), rts: m.renderTargets, programs: m.programs, heapMB: Math.round((performance.memory?.usedJSHeapSize ?? 0) / 1e6) };
      },
      // une image à la main, mesurée : fil principal, puis GPU compris (ms)
      async step(dtMs = 16.7) {
        last = performance.now() - dtMs;
        const t0 = performance.now();
        renderer._nodes?.nodeFrame?.update();
        tick(performance.now());
        const cpu = performance.now() - t0;
        await renderer.backend.device?.queue.onSubmittedWorkDone();
        return { cpu, gpu: performance.now() - t0, state: trans ? 'T' : next && next.state !== 'ready' ? 'P' : '-', day: cur?.meta.id };
      },
      // un passage à l'arrêt, pour le régler : preview('melt', 0.4) ; preview() : fin
      preview(kind, p = 0.5, ua = 0.45, ub = 0.1) {
        if (!kind) { preview = null; paused = false; return 'fin'; }
        if (!cur || !next || next.state !== 'ready') return 'il faut deux jours prêts';
        preview = { kind, p, ua, ub }; paused = true;
        return 'ok';
      },
      // un passage figé envoyé au collecteur (tools/sink.py) : la seule image
      // fiable quand le panneau est masqué. shot('melt', 0.4, 'melt-40')
      async shot(kind, p, name, ua = 0.45, ub = 0.1, port = 8099) {
        if (!cur || !next || next.state !== 'ready') return 'il faut deux jours prêts';
        hold = true; // (la boucle ne dessine rien pendant la capture)
        try {
        const s = bufSize(), w = Math.floor(s.x / 2 / 64) * 64, h = Math.round((w * s.y) / s.x); // (relecture : lignes de 256 octets)
        const rt = new THREE.RenderTarget(w, h);
        live(cur, ua); live(next, ub);
        comp.blend(cur.slot, p, clock, kind, rt);
        const px = await renderer.readRenderTargetPixelsAsync(rt, 0, 0, w, h);
        rt.dispose();
        const c = new OffscreenCanvas(w, h);
        c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(px.buffer, px.byteOffset, w * h * 4), w, h), 0, 0);
        const blob = await c.convertToBlob({ type: 'image/jpeg', quality: 0.85 });
        await fetch(`http://127.0.0.1:${port}/${name}.jpg`, { method: 'POST', body: blob });
        return name;
        } finally { hold = false; }
      },
      // le jour courant figé à la phase u, envoyé au collecteur : pour le
      // comparer à sa propre page (window.<jour>.shot(u) puis send(nom))
      // l'image d'un jour figé à la phase u (n images d'affilée : historique de
      // l'anticrénelage), relue sur le GPU : ImageData. which : 'cur' | 'next'
      // (tools/relay-check.html la compare à celle de la page du projet)
      async grab(u, which = 'cur', n = 12) {
        const day = which === 'next' ? next : cur;
        if (!day || day.state !== 'ready') throw new Error(`jour ${which} pas prêt`);
        hold = true; // (la boucle ne dessine rien pendant la capture)
        try {
          paused = true; preview = null;
          for (let i = 0; i < n; i++) { renderer._nodes?.nodeFrame?.update(); live(day, u); await renderer.backend.device.queue.onSubmittedWorkDone(); }
          const s = bufSize(), w = s.x, h = s.y;
          const rt = new THREE.RenderTarget(w, h);
          comp.show(day.slot, rt);
          const px = await renderer.readRenderTargetPixelsAsync(rt, 0, 0, w, h);
          rt.dispose();
          const img = new ImageData(w, h), stride = Math.ceil((w * 4) / 256) * 256; // (lignes alignées sur 256 octets)
          for (let y = 0; y < h; y++) img.data.set(px.subarray(y * stride, y * stride + w * 4), y * w * 4);
          return img;
        } finally { hold = false; }
      },
      // la même, envoyée au collecteur (tools/sink.py) en demi-taille
      async dayShot(u, name, port = 8241, n = 12, which = 'cur') {
        const img = await window.mega.grab(u, which, n), w = img.width, h = img.height;
        const c = new OffscreenCanvas(w, h); c.getContext('2d').putImageData(img, 0, 0);
        const sc = new OffscreenCanvas(Math.round(w / 2), Math.round(h / 2)); sc.getContext('2d').drawImage(c, 0, 0, sc.width, sc.height);
        await fetch(`http://127.0.0.1:${port}/${name}.jpg`, { method: 'POST', body: await sc.convertToBlob({ type: 'image/jpeg', quality: 0.88 }) });
        return name;
      },
      // aller directement à un jour (le relais repart de lui) : goto('bolt')
      async goto(id) {
        const i = DAYS.indexOf(id);
        if (i < 0) return 'inconnu';
        firstShown = false; trans = null; preview = null;
        next?.dispose(); next = null;
        const old = cur; cur = null; old?.dispose();
        cur = await load(i);
        await cur.ready;
        cur.u = 0; cur.end = LOOPS; firstShown = true; $('#boot').classList.add('gone');
        prepareNext();
        return cur.meta.id;
      },
      skip: () => { if (cur && !trans) hurry = true; },
      // la boucle à la main quand le navigateur suspend requestAnimationFrame
      async run(seconds = 1) {
        const t0 = performance.now();
        while (performance.now() - t0 < seconds * 1000) {
          renderer._nodes?.nodeFrame?.update();
          tick(performance.now());
          await sleep(16);
        }
      },
    };
  }
}

main().catch((e) => { console.error(e); fail(e.message); });
