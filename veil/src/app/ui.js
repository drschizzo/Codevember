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
import { FORMS, PLINTHS, LACES } from '../recipe.js';

const opts = (o, label = (v) => v.label) => Object.fromEntries(Object.entries(o).map(([k, v]) => [label(v), k]));

export function createUI({ recipe: getRecipe, render, on, moods }) {
  const gui = new GUI({ title: 'Veil', width: 320 });
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
  const fVeil = gui.addFolder('Le voile').close();
  const fForms = gui.addFolder('Les statues absentes').close();
  const fCam = gui.addFolder('Caméra').close();
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
    const look = () => on.finishChanged();
    const sim = () => on.resimulate(); // (une retouche du geste relance les simulations)

    add(fScene, R, 'mood', opts(moods)).name('Humeur (nouvelle scène)').onChange((m) => on.moodChanged(m));
    add(fScene, R.loop, 'duration').name('Durée de la boucle (s)').disable();

    add(fVeil, R.veil.lace, 'kind', opts(LACES)).name('Dentelle').onChange(look);
    addC(fVeil, R.veil, 'color').name('Fil du réseau').onChange(look);
    addC(fVeil, R.veil.lace, 'color2').name('Fil du motif').onChange(look);
    add(fVeil, R.veil.lace, 'scale', 0.02, 0.12, 0.001).name('Pas du dessin (m)').onChange(look);
    add(fVeil, R.veil.lace, 'scallops', 10, 48, 1).name('Festons par côté').onChange(look);
    add(fVeil, R.veil, 'sheen', 0, 1.5, 0.01).name('Lustre').onChange(look);
    add(fForms, R.veil, 'holo', 0, 2, 0.05).name('Hologramme').onChange(ch);
    add(fVeil, R.veil, 'L', 1.0, 1.6, 0.01).name('Côté (m)').onFinishChange(sim);
    add(fVeil, R.veil, 'rot', 0, Math.PI / 2, 0.01).name('Orientation').onFinishChange(sim);
    add(fVeil, R.wind, 'speed', 0, 4, 0.05).name('Vent (m/s)').onFinishChange(sim);
    add(fVeil, R.wind, 'az', -1.2, 1.2, 0.01).name('Vent : direction').onFinishChange(sim);
    add(fVeil, R.wind, 'breath', 0.5, 4, 0.05).name('Vent : souffle').onFinishChange(sim);
    add(fVeil, R.timing.desc, 'lower', 1.5, 5, 0.05).name('Descente (s)').onFinishChange(sim);
    add(fVeil, R.timing.desc, 'settle', 2, 8, 0.05).name('Repos (s)').onFinishChange(sim);
    add(fVeil, R.timing.rise, 'lift', 1.5, 4, 0.05).name('Montée (s)').onFinishChange(sim);
    add(fVeil, R.timing.rise, 'hang', 1, 3, 0.05).name('Pendaison (s)').onFinishChange(sim);
    add(fVeil, R.sim, 'n', { '41 × 41': 41, '53 × 53': 53, '65 × 65': 65, '81 × 81': 81, '97 × 97': 97 }).name('Finesse de la simulation').onChange(sim);

    R.forms.forEach((F, i) => {
      const f = fForms.addFolder(`${i + 1}. ${FORMS[F.kind].label}`).close();
      folders.push(f);
      f.add(F, 'kind', opts(FORMS)).name('Forme').onFinishChange(sim);
      f.addColor(F, 'holo').name('Hologramme').onChange(ch);
      f.add(F, 'turn', -0.8, 0.8, 0.01).name('Rotation').onFinishChange(sim);
      f.add(F, 'tilt', -0.3, 0.3, 0.01).name('Inclinaison').onFinishChange(sim);
      f.add(F, 'lean', -0.3, 0.3, 0.01).name('Penché').onFinishChange(sim);
    });
    add(fForms, R.plinth, 'kind', opts(PLINTHS)).name('Socle').onFinishChange(sim);
    add(fForms, R.plinth, 'height', 0.8, 1.2, 0.01).name('Hauteur du socle').onFinishChange(sim);

    add(fCam, R.camera, 'fov', 18, 60, 0.5).name('Champ (°)').onChange(ch);
    add(fCam, R.camera, 'dist', 1.4, 4, 0.01).name('Distance').onChange(ch);
    add(fCam, R.camera, 'az', -1.5, 1.5, 0.01).name('Azimut').onChange(ch);
    add(fCam, R.camera, 'el', -0.2, 0.6, 0.01).name('Plongée').onChange(ch);
    add(fCam, R.camera, 'sway', 0, 0.4, 0.001).name('Balancement').onChange(ch);
    add(fCam, on.camState, 'free').name('Caméra libre (souris)').onChange((v) => on.freeCam(v));

    const L = R.light;
    addC(fLight, L, 'color').name('Lumière : couleur').onChange(ch);
    add(fLight, L, 'key', 0, 3, 0.01).name('Lampe').onChange(ch);
    add(fLight, L, 'fill', 0, 2, 0.01).name('Débouchage').onChange(ch);
    add(fLight, L, 'rim', 0, 2, 0.01).name('Contre-jour').onChange(ch);
    add(fLight, L, 'az', -Math.PI, Math.PI, 0.01).name('Lampe : azimut').onChange(ch);
    add(fLight, L, 'el', 0.1, 1.5, 0.01).name('Lampe : hauteur').onChange(ch);
    add(fLight, R.env, 'preset', opts(ENV_PRESETS)).name('Studio HDR').onChange(() => on.envChanged());
    add(fLight, R.env, 'intensity', 0, 3, 0.01).name('Studio : intensité').onChange(ch);
    add(fLight, R.env, 'rotation', 0, Math.PI * 2, 0.01).name('Studio : rotation').onChange(ch);
    addC(fLight, R.bg, 'color').name('Fond').onChange(look);
    addC(fLight, R.bg, 'color2').name('Fond, en haut').onChange(look);
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
