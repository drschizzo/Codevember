// Panneau de réglages (lil-gui). Ce module ne connaît que la recette, les
// réglages de rendu et des fonctions de rappel : il ne touche pas à la scène.
//
// Ordre des dossiers (commun à tous les projets) : en tête la graine et les
// actions, puis Export, puis la scène (du général au particulier : humeur et
// boucle, chorégraphie, caméra, chaque élément du thème, lumière), puis Rendu.
// Tout est replié sauf l'essentiel ; les libellés sont en français, avec la
// touche du clavier entre parenthèses.
import GUI from 'lil-gui';
import { ENV_PRESETS } from '../../../shared/scene/env.js';
import { QUALITY } from './settings.js';
import { THREADS, ACCORDS, SHAPES, FAMILIES } from '../recipe.js';

const opts = (o, label = (v) => v.label) => Object.fromEntries(Object.entries(o).map(([k, v]) => [label(v), k]));

export function createUI({ recipe: getRecipe, render, on, moods }) {
  const gui = new GUI({ title: 'Cocoon', width: 320 });
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
  const fCocoon = gui.addFolder('Cocon').close();
  const fMachine = gui.addFolder('Appareil et tempo').close();
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

    const geo = () => on.geometryChanged(); // (nouveau bobinage : le worker recalcule le cocon)
    add(fScene, R, 'mood', opts(moods)).name('Humeur (nouvelle scène)').onChange((m) => on.moodChanged(m));
    add(fScene, R, 'family', opts(FAMILIES)).name('Famille (nouvelle scène)').onChange((f) => on.familyChanged(f));
    add(fScene, R.loop, 'duration', 20, 120, 1).name('Durée de la boucle (s)').onChange(ch);

    add(fCocoon, R.cage, 'shape', opts(SHAPES)).name('Forme de la cage').onChange(geo);
    add(fCocoon, R.cage, 'R', 0.1, 0.16, 0.001).name('Rayon de la cage (m)').onChange(geo);
    add(fCocoon, R.cage, 'ribs', 8, 32, 1).name('Côtes').onChange(geo);
    add(fCocoon, R.cage, 'hub', 0.012, 0.035, 0.001).name('Rosaces polaires (m)').onChange(geo);
    add(fCocoon, R.band, 'threads', 2, 18, 1).name('Fils par ruban').onChange(() => { R.band.width = +(R.band.threads * R.band.thread * R.band.gap).toFixed(4); geo(); });
    add(fCocoon, R.band, 'thread', 0.0008, 0.0025, 0.0001).name('Diamètre du fil (m)').onChange(() => { R.band.width = +(R.band.threads * R.band.thread * R.band.gap).toFixed(4); geo(); });
    if (R.family === 'losange') {
      add(fCocoon, R.wind, 'c1', 0.3, 0.75, 0.01).name('Armature : ouverture (× R)').onChange(geo);
      add(fCocoon, R.wind, 'n1', 3, 14, 1).name('Armature : circuits').onChange(geo);
      add(fCocoon, R.wind, 'c2', 0.15, 0.5, 0.01).name('Fermeture : ouverture (× R)').onChange(geo);
    } else if (R.family === 'cerclage') {
      add(fCocoon, R.wind, 'ribs', 2, 10, 1).name('Côtes de fil (circuits)').onChange(geo);
      add(fCocoon, R.wind, 'mu', 0.3, 1, 0.01).name('Frottement des côtes crantées').onChange(geo);
    } else if (R.family === 'huit') {
      add(fCocoon, R.wind, 'amp', 0.02, 0.06, 0.001).name('Taille des boucles (m)').onChange(geo);
      add(fCocoon, R.wind, 'k', 0.7, 1.8, 0.01).name('Couches par passage').onChange(geo);
      add(fCocoon, R.wind, 'passes', 1, 3, 1).name('Passages').onChange(geo);
    }
    const T = R.thread, look = () => on.recipeChanged();
    add(fCocoon, T, 'kind', opts(THREADS)).name('Fil').onChange((k) => { const { label, ...F } = THREADS[k]; Object.assign(T, F, { kind: k }); look(); build(); });
    addC(fCocoon, T, 'color').name('Fil : couleur').onChange(look);
    add(fCocoon, T, 'tau', 0, 0.9, 0.01).name('Fil : transmission').onChange(look);
    add(fCocoon, T, 'rough', 0.05, 0.8, 0.01).name('Fil : largeur du reflet').onChange(look);
    add(fCocoon, T, 'shift', 0, 0.2, 0.005).name('Fil : décalage des reflets').onChange(look);

    add(fMachine, R, 'accord', opts(ACCORDS)).name('Matières').onChange(geo);
    add(fMachine, R.tempo.speeds, '1', 1, 8, 0.1).name('Fermeture : accéléré (×)').onChange(() => on.tempoChanged());
    add(fMachine, R.tempo.speeds, '2', 0.5, 4, 0.1).name('Finition : vitesse (×)').onChange(() => on.tempoChanged());
    add(fMachine, R.tempo, 'overshoot', 0, 0.15, 0.005).name('Relève : dépassement (rad)').onChange(ch);

    add(fCam, R.camera, 'fov', 18, 60, 0.5).name('Champ (°)').onChange(ch);
    add(fCam, R.camera, 'dist', 1.2, 4.5, 0.01).name('Distance (m)').onChange(ch);
    add(fCam, R.camera, 'el', -0.3, 0.8, 0.01).name('Hauteur (rad)').onChange(ch);
    add(fCam, R.camera, 'az', -1.6, 1.6, 0.01).name('Azimut (rad)').onChange(ch);
    add(fCam, R.camera, 'sway', 0, 0.12, 0.001).name('Balancement').onChange(ch);
    add(fCam, on.camState, 'free').name('Caméra libre').onChange((v) => on.freeCam(v));

    const L = R.light;
    addC(fLight, L.lamp, 'color').name('Lampes : couleur').onChange(ch);
    add(fLight, L.lamp, 'power', 0, 3, 0.01).name('Lampes : puissance').onChange(ch);
    add(fLight, L.lamp, 'glow', 0, 0.5, 0.001).name('Lampes : lueur à travers la paroi').onChange(ch);
    addC(fLight, L.key, 'color').name('Lumière de la pièce : couleur').onChange(ch);
    add(fLight, L.key, 'power', 0, 3, 0.01).name('Lumière de la pièce : puissance').onChange(ch);
    add(fLight, L.key, 'az', -Math.PI, Math.PI, 0.01).name('Lumière de la pièce : azimut').onChange(ch);
    add(fLight, L.key, 'el', 0.1, 1.5, 0.01).name('Lumière de la pièce : hauteur').onChange(ch);
    add(fLight, L.key, 'soft', 0, 1, 0.01).name('Lumière de la pièce : douceur').onChange(ch);
    add(fLight, L, 'fill', 0, 1, 0.01).name('Remplissage').onChange(ch);
    addC(fLight, R.room, 'wall').name('Murs').onChange(look);
    addC(fLight, R.room, 'floor').name('Sol').onChange(look);
    add(fLight, R.room, 'haze', 0, 0.4, 0.001).name('Brume').onChange(ch);
    add(fLight, R.env, 'preset', opts(ENV_PRESETS)).name('Studio HDR').onChange(() => on.envChanged());
    add(fLight, R.env, 'intensity', 0, 2, 0.01).name('Studio : intensité').onChange(ch);
  }

  // ── Rendu (réglages du navigateur, indépendants de la graine) ──
  const r = render, rch = () => on.renderChanged();
  fRender.add(r, 'quality', opts(QUALITY)).name('Qualité').onChange((k) => { on.quality(k); fRender.controllersRecursive().forEach((c) => c.updateDisplay()); });
  fRender.add(r, 'pixelRatio', 0.5, 2, 0.05).name('Résolution (× écran)').onChange(rch);
  fRender.add(r, 'dynRes').name('Résolution dynamique').onChange(rch);
  fRender.add(r, 'maxFps', { Libre: 0, '30 i/s': 30, '60 i/s': 60 }).name('Cadence maximale').onChange(rch);
  fRender.add(r, 'aa', { Temporel: 'traa', SMAA: 'smaa', FXAA: 'fxaa', Aucun: 'none' }).name('Anticrénelage').onChange(rch);
  fRender.add(r, 'msaa', { Aucun: 0, '2×': 2, '4×': 4 }).name('MSAA (arêtes et fils)').onChange(rch);
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
