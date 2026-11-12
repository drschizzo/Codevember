// Panneau de réglages (lil-gui). Ce module ne connaît que la recette, les
// réglages de rendu et des fonctions de rappel : il ne touche pas à la scène.
//
// Ordre des dossiers (commun à tous les projets) : en tête la graine et les
// actions, puis Export, puis la scène (du général au particulier : humeur et
// boucle, chorégraphie, caméra, chaque élément du thème, lumière), puis Rendu.
// Tout est replié sauf l'essentiel ; les libellés sont en français, avec la
// touche du clavier entre parenthèses.
import GUI from 'lil-gui';
import { ENV_PRESETS } from '../scene/env.js';
import { QUALITY } from './settings.js';
import { FAMILIES } from '../families.js';
import { NETWORKS, ORDERS } from '../recipe.js';

const opts = (o, label = (v) => v.label) => Object.fromEntries(Object.entries(o).map(([k, v]) => [label(v), k]));

export function createUI({ recipe: getRecipe, render, on, moods }) {
  const gui = new GUI({ title: 'Spore', width: 320 });
  const state = { fps: '' };

  // ── En tête : graine et actions ──
  const top = { seed: '', random: () => on.random(), link: () => on.copyLink(), pause: () => on.togglePause() };
  gui.add(top, 'seed').name('Graine').onFinishChange((v) => on.regenerate(v));
  gui.add(top, 'random').name('⟳  Nouvelle scène  (N)');
  gui.add(top, 'link').name('Copier le lien de cette scène');
  gui.add(top, 'pause').name('Pause / lecture  (espace)');
  const fpsCtl = gui.add(state, 'fps').name('Images / s').disable();

  // ── Export ──
  const exp = { width: 1920, height: 1080, fps: 60, mbps: 40, samples: 1, go: () => on.exportVideo({ ...exp }), png: () => on.exportPNG({ samples: exp.samples }) };
  const fExp = gui.addFolder('Export').close();
  fExp.add(exp, 'width', { '1280': 1280, '1920': 1920, '2560': 2560, '3840': 3840, '1080 (carré)': 1080 }).name('Largeur');
  fExp.add(exp, 'height', { '720': 720, '1080': 1080, '1440': 1440, '2160': 2160, '1920 (vertical)': 1920 }).name('Hauteur');
  fExp.add(exp, 'fps', [24, 30, 50, 60]).name('Images / s');
  fExp.add(exp, 'mbps', 8, 120, 1).name('Débit (Mb/s)');
  fExp.add(exp, 'samples', { 'Temps réel': 1, '8 passes': 8, '16 passes': 16, '32 passes': 32, '64 passes': 64 }).name('Rendu accumulé');
  fExp.add(exp, 'go').name('Exporter la boucle (MP4)');
  fExp.add(exp, 'png').name('Image (PNG)');

  // ── Scène (reconstruite à chaque recette) ──
  const fScene = gui.addFolder('Scène');
  const fCam = gui.addFolder('Caméra').close();
  const fPlas = gui.addFolder('Plasmodium').close();
  const fFruit = gui.addFolder('Fructification et vent').close();
  const fLight = gui.addFolder('Lumière et fond').close();
  const fRender = gui.addFolder('Rendu').close();
  let ctls = [], folders = [];

  function build() {
    const R = getRecipe();
    top.seed = R.seed;
    gui.controllersRecursive().forEach((c) => c.property === 'seed' && c.updateDisplay());
    for (const c of ctls) c.destroy();
    for (const f of folders) f.destroy();
    ctls = []; folders = [];
    const add = (f, o, k, ...a) => { const c = f.add(o, k, ...a); ctls.push(c); return c; };
    const addC = (f, o, k) => { const c = f.addColor(o, k); ctls.push(c); return c; };
    const ch = () => on.recipeChanged();
    const regen = () => on.siteChanged();

    add(fScene, R, 'mood', opts(moods)).name('Décor (nouvelle scène)').onChange((m) => on.moodChanged(m));
    add(fScene, R, 'family', opts(FAMILIES)).name('Famille (nouvelle scène)').onChange((f) => on.familyChanged(f));
    add(fScene, R, 'species', opts(FAMILIES[R.family].species)).name('Espèce').onChange(regen);
    add(fScene, R.loop, 'duration', 16, 120, 1).name('Durée de la boucle (s)').onChange(ch);

    add(fCam, R.camera, 'fov', 14, 50, 0.5).name('Champ (°)').onChange(() => on.cameraChanged());
    add(fCam, R.camera, 'dist', 2.5, 12, 0.01).name('Distance (cm)').onChange(() => on.cameraChanged());
    add(fCam, R.camera, 'elNet', 0.2, 1.4, 0.01).name('Plongée sur le réseau (rad)').onChange(() => on.cameraChanged());
    add(fCam, R.camera, 'elForest', 0.03, 1.2, 0.01).name('Hauteur sur la forêt (rad)').onChange(() => on.cameraChanged());
    add(fCam, R.camera, 'az', -1, 1, 0.01).name('Azimut (rad)').onChange(() => on.cameraChanged());
    add(fCam, R.camera, 'sway', 0, 0.1, 0.001).name('Balancement').onChange(() => on.cameraChanged());
    add(fCam, on.camState, 'free').name('Caméra libre (souris)').onChange((v) => on.freeCam(v));

    const P = R.plasmodium;
    add(fPlas, P, 'net', opts(NETWORKS)).name('Réseau').onChange((k) => { P.mu = NETWORKS[k].mu; P.explore = NETWORKS[k].explore; P.foci = NETWORKS[k].foci; regen(); build(); });
    add(fPlas, P, 'mu', 0.8, 2.2, 0.01).name('μ (Tero : arbre ↔ mailles)').onChange(regen);
    add(fPlas, P, 'explore', 0, 1, 0.01).name('Exploration').onChange(regen);
    add(fPlas, P, 'seeds', 2, 24, 1).name('Points de germination').onChange(regen);
    add(fPlas, P, 'aniso', 0.7, 2, 0.01).name('Anisotropie (fil du bois)').onChange(regen);
    add(fPlas, P, 'festoon', 0, 1.5, 0.01).name('Festons du front').onChange(regen);

    add(fFruit, R.fruit, 'order', Object.fromEntries(Object.entries(ORDERS).map(([k, v]) => [v, k]))).name('Ordre de maturation').onChange(regen);
    add(fFruit, R.fruit, 'density', 0.5, 1.6, 0.01).name('Densité').onChange(regen);
    add(fFruit, R.fruit, 'spread', 0, 0.1, 0.001).name('Étalement des retards').onChange(regen);
    add(fFruit, R.fruit, 'lean', 0, 0.3, 0.01).name('Penchant vers la lumière').onChange(ch);
    add(fFruit, R.wind, 'gust', 0, 1, 0.01).name('Rafales').onChange(regen);
    add(fFruit, R.wind, 'strength', 0.5, 1.6, 0.01).name('Force du souffle').onChange(regen);
    add(fFruit, R.wind, 'lift', 0.3, 2, 0.01).name('Montée des spores').onChange(regen);

    const L = R.light;
    addC(fLight, L.key, 'color').name('Lumière : couleur').onChange(ch);
    add(fLight, L.key, 'intensity', 0, 12, 0.01).name('Lumière : intensité').onChange(ch);
    add(fLight, L.key, 'az', -Math.PI, Math.PI, 0.01).name('Lumière : azimut').onChange(ch);
    add(fLight, L.key, 'el', 0.05, 1.5, 0.01).name('Lumière : hauteur').onChange(ch);
    add(fLight, L, 'night', 0, 1, 0.01).name('Lumière la nuit').onChange(ch);
    addC(fLight, L.rim, 'color').name('Contre-jour : couleur').onChange(ch);
    add(fLight, L.rim, 'intensity', 0, 8, 0.01).name('Contre-jour : intensité').onChange(ch);
    add(fLight, R.env, 'preset', opts(ENV_PRESETS)).name('Studio HDR').onChange(() => on.envChanged());
    add(fLight, R.env, 'intensity', 0, 3, 0.01).name('Studio : intensité').onChange(ch);
    add(fLight, R.env, 'rotation', -Math.PI, Math.PI, 0.01).name('Studio : rotation').onChange(ch);
    addC(fLight, R.fog, 'color').name('Fond et brume').onChange(ch);
    add(fLight, R.fog, 'near', 0, 30, 0.1).name('Brume : début (cm)').onChange(ch);
    add(fLight, R.fog, 'far', 1, 60, 0.1).name('Brume : fin (cm)').onChange(ch);
  }

  // ── Rendu (réglages du navigateur, indépendants de la graine) ──
  const r = render, rch = () => on.renderChanged();
  fRender.add(r, 'quality', opts(QUALITY)).name('Qualité').onChange((k) => { on.quality(k); fRender.controllersRecursive().forEach((c) => c.updateDisplay()); });
  fRender.add(r, 'pixelRatio', 0.5, 2, 0.05).name('Résolution (× écran)').onChange(rch);
  fRender.add(r, 'dynRes').name('Résolution dynamique').onChange(rch);
  fRender.add(r, 'maxFps', { Libre: 0, '30 i/s': 30, '60 i/s': 60 }).name('Cadence maximale').onChange(rch);
  fRender.add(r, 'aa', { Temporel: 'traa', SMAA: 'smaa', FXAA: 'fxaa', Aucun: 'none' }).name('Anticrénelage').onChange(rch);
  fRender.add(r, 'shadows', { Mobile: 'mobile', Basses: 'low', Moyennes: 'medium', Hautes: 'high', 'Très hautes': 'ultra' }).name('Ombres').onChange(rch);
  fRender.add(r, 'microDetail', 0, 2, 0.01).name('Micro-relief').onChange(rch);
  fRender.add(r, 'roughFloor', 0, 0.4, 0.005).name('Douceur des reflets').onChange(rch);
  const ft = fRender.addFolder('Image').close();
  ft.add(r, 'toneMapping', { AgX: 'agx', ACES: 'aces', Neutre: 'neutral' }).name('Courbe').onChange(rch);
  ft.add(r, 'exposure', 0.1, 4, 0.01).name('Exposition').onChange(rch);
  ft.add(r, 'hiCap', 1, 16, 0.1).name('Plafond des hautes lumières').onChange(rch);
  ft.add(r, 'contrast', 0.7, 1.5, 0.01).name('Contraste').onChange(rch);
  ft.add(r, 'saturation', 0, 2, 0.01).name('Saturation').onChange(rch);
  ft.add(r, 'warmth', -1, 1, 0.01).name('Température').onChange(rch);
  ft.add(r, 'vignette', 0, 1, 0.01).name('Vignettage').onChange(rch);
  ft.add(r, 'grain', 0, 0.15, 0.001).name('Grain').onChange(rch);
  ft.add(r, 'ca', 0, 1.5, 0.01).name('Aberration chromatique').onChange(rch);
  const fb = fRender.addFolder('Bloom et objectif').close();
  fb.add(r, 'bloom').name('Bloom').onChange(rch);
  fb.add(r, 'bloomStrength', 0, 2, 0.01).name('Bloom : intensité').onChange(rch);
  fb.add(r, 'bloomThreshold', 0, 4, 0.01).name('Bloom : seuil').onChange(rch);
  fb.add(r, 'streaks', 0, 2, 0.01).name('Traînées anamorphiques').onChange(rch);
  fb.add(r, 'halation', 0, 1.5, 0.01).name('Halation').onChange(rch);
  fb.add(r, 'dirt', 0, 2, 0.01).name('Poussière sur la lentille').onChange(rch);
  fb.add(r, 'motionBlur', 0, 2, 0.01).name('Flou de mouvement').onChange(rch);
  fb.add(r, 'dof').name('Profondeur de champ').onChange(rch);
  fb.add(r, 'focus', 0.1, 2, 0.01).name('Mise au point (× distance)').onChange(rch);
  fb.add(r, 'bokeh', 0, 8, 0.05).name('Bokeh').onChange(rch);
  const fa = fRender.addFolder('Occlusion et reflets').close();
  fa.add(r, 'ao').name('Occlusion ambiante').onChange(rch);
  fa.add(r, 'aoStrength', 0, 1, 0.01).name('Occlusion : intensité').onChange(rch);
  fa.add(r, 'ssr').name('Reflets en espace écran').onChange(rch);
  fa.add(r, 'ssrIntensity', 0, 1.5, 0.01).name('Reflets : intensité').onChange(rch);
  fRender.add({ reset: () => on.resetRender() }, 'reset').name('Réglages par défaut');

  return {
    gui,
    rebuild: build,
    setFps: (v) => { state.fps = v; fpsCtl.updateDisplay(); },
    refresh: () => gui.controllersRecursive().forEach((c) => c.updateDisplay()),
  };
}
