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
import { FAMILIES, BIRDS, birdsOf } from '../families.js';

const opts = (o, label = (v) => v.label) => Object.fromEntries(Object.entries(o).map(([k, v]) => [label(v), k]));

export function createUI({ recipe: getRecipe, render, on, moods }) {
  const gui = new GUI({ title: 'Feather', width: 320 });
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
  const fShape = gui.addFolder('La plume').close();
  const fLook = gui.addFolder('Couleurs').close();
  const fLight = gui.addFolder('Lumière et fond').close();
  const fRender = gui.addFolder('Rendu').close();
  let ctls = [];

  function build() {
    const R = getRecipe();
    top.seed = R.seed;
    gui.controllersRecursive().forEach((c) => c.property === 'seed' && c.updateDisplay());
    for (const c of ctls) c.destroy();
    ctls = [];
    const add = (f, o, k, ...a) => { const c = f.add(o, k, ...a); ctls.push(c); return c; };
    const addC = (f, o, k) => { const c = f.addColor(o, k); ctls.push(c); return c; };
    const ch = () => on.recipeChanged();
    const sel = { family: R.family, bird: R.bird };

    add(fScene, sel, 'family', opts(FAMILIES)).name('Famille (nouvelle scène)').onChange((f) => on.familyChanged(f));
    add(fScene, sel, 'bird', Object.fromEntries(birdsOf(R.family).map((k) => [BIRDS[k].label, k]))).name('Oiseau').onChange((b) => on.birdChanged(b));
    add(fScene, R, 'mood', opts(moods)).name('Humeur (nouvelle scène)').onChange((m) => on.moodChanged(m));
    add(fScene, R.loop, 'duration', 16, 90, 1).name('Durée de la boucle (s)').onChange(ch);

    add(fCam, R.camera, 'fov', 18, 60, 0.5).name('Champ (°)').onChange(() => on.cameraChanged());
    add(fCam, R.camera, 'd', 0.6, 2.5, 0.01).name('Distance (× longueur de plume)').onChange(() => on.cameraChanged());
    add(fCam, R.camera, 'el', 0.05, 1.3, 0.01).name('Plongée (rad)').onChange(() => on.cameraChanged());
    add(fCam, R.camera, 'az', -1.6, 1.6, 0.01).name('Trois quarts (rad)').onChange(() => on.cameraChanged());
    add(fCam, R.camera, 'drift', 0, 0.6, 0.01).name('Balancement (rad)').onChange(() => on.cameraChanged());
    add(fCam, on.camState, 'free').name('Caméra libre (souris)').onChange((v) => on.freeCam(v));

    const S = R.shape, sh = () => on.shapeChanged();
    if (!S.radial) {
      add(fShape, S, 'L', 3, 16, 0.01).name('Longueur du rachis (cm)').onChange(sh);
      add(fShape, S, 'W', 0.5, 10, 0.01).name('Largeur du vexille (cm)').onChange(sh);
      add(fShape, S, 'asym', -0.4, 0.4, 0.01).name('Asymétrie').onChange(sh);
      add(fShape, S, 'alpha', 0.3, 1.1, 0.01).name('Angle des barbes (rad)').onChange(sh);
      add(fShape, S, 'curl', 0, 0.5, 0.005).name('Courbure des barbes (1/cm)').onChange(sh);
      add(fShape, S, 'tipPow', 1, 8, 0.1).name('Pointe (arrondie →)').onChange(sh);
      add(fShape, S, 'plum', 0, 0.5, 0.01).name('Base duveteuse').onChange(sh);
      add(fShape, S, 'density', 4, 30, 0.5).name('Barbes par cm').onChange(sh);
    } else {
      add(fShape, S, 'L', 1.5, 5, 0.01).name('Longueur des barbes (cm)').onChange(sh);
      add(fShape, S, 'count', 30, 140, 1).name('Barbes').onChange(sh);
      add(fShape, S, 'curl', 0, 1.2, 0.01).name('Frisure').onChange(sh);
    }
    add(fShape, S, 'bend', 0, 0.1, 0.001).name('Courbure du rachis (1/cm)').onChange(ch);
    add(fShape, R.pattern, 'program', ['plain', 'bars', 'chevrons', 'spots', 'streaks', 'shaft']).name('Motif (collier)').onChange(sh);
    if (R.pattern.cover !== undefined) add(fShape, R.pattern, 'cover', 0.05, 0.7, 0.01).name('Part du motif').onChange(sh);

    const K = R.look, lk = () => on.lookChanged();
    for (const [k, l] of [['base', 'Fond du vexille'], ['mark', 'Motif'], ['down', 'Duvet'], ['rachis', 'Rachis'], ['sheath', 'Gaine']]) addC(fLook, K, k).name(l).onChange(lk);
    add(fLook, K, 'irid', 0, 1, 0.01).name('Couleur structurale (irisation)').onChange(lk);
    add(fLook, K, 'bragg', 0, 700, 1).name('Longueur d\'onde de Bragg λ₀ (nm)').onChange(lk);
    add(fLook, K, 'iridMark', 0, 1, 1).name('Irisée sur le motif seul').onChange(lk);
    add(fLook, K, 'sheen', 0, 1.5, 0.01).name('Lustre des barbules').onChange(lk);
    add(fLook, K, 'translucency', 0, 2, 0.01).name('Translucidité').onChange(lk);

    const L = R.light;
    for (const [k, l] of [['key', 'Lampe'], ['rim', 'Contre-jour'], ['fill', 'Débouchage']]) {
      addC(fLight, L[k], 'color').name(`${l} : couleur`).onChange(ch);
      add(fLight, L[k], 'intensity', 0, 10, 0.01).name(`${l} : intensité`).onChange(ch);
      add(fLight, L[k], 'az', -Math.PI, Math.PI, 0.01).name(`${l} : azimut (0 : de face)`).onChange(ch);
      add(fLight, L[k], 'el', 0.05, 1.5, 0.01).name(`${l} : hauteur`).onChange(ch);
    }
    add(fLight, R.env, 'preset', opts(ENV_PRESETS)).name('Studio HDR').onChange(() => on.envChanged());
    add(fLight, R.env, 'intensity', 0, 3, 0.01).name('Studio : intensité').onChange(ch);
    add(fLight, R.env, 'rotation', 0, Math.PI * 2, 0.01).name('Studio : rotation').onChange(ch);
    addC(fLight, R.bg, 'top').name('Fond : haut').onChange(ch);
    addC(fLight, R.bg, 'bottom').name('Fond : bas').onChange(ch);
    add(fLight, R.bg, 'glow', 0, 2, 0.01).name('Fond : lueur').onChange(ch);
    addC(fLight, R.fog, 'color').name('Brume').onChange(ch);
    add(fLight, R.fog, 'density', 0, 1, 0.01).name('Brume : densité').onChange(ch);
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
  fb.add(r, 'bokeh', 0, 20, 0.1).name('Flou de macro (px)').onChange(rch);
  fb.add(r, 'focusRange', 0.05, 1, 0.01).name('Profondeur nette (× distance)').onChange(rch);
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
