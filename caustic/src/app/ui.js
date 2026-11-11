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
import { SERIES } from '../gen/motifs.js';

const opts = (o, label = (v) => v.label) => Object.fromEntries(Object.entries(o).map(([k, v]) => [label(v), k]));

// curseurs d'une finition : [clé, libellé, min, max, pas]
const FIN = [
  ['metal', 'Métal', 0, 1, 0.01], ['rough', 'Rugosité', 0.02, 1, 0.01], ['bump', 'Relief', 0, 2, 0.01], ['scale', 'Échelle du motif', 0.2, 4, 0.01],
  ['aniso', 'Anisotropie', 0, 1, 0.01], ['clearcoat', 'Vernis', 0, 1, 0.01], ['ccRough', 'Rugosité vernis', 0, 0.5, 0.005],
  ['sheen', 'Lustre (velours)', 0, 1, 0.01], ['irid', 'Irisation', 0, 1, 0.01], ['glass', 'Transmission (verre)', 0, 1, 0.01], ['ior', 'Indice', 1, 2.4, 0.01],
];

export function createUI({ recipe: getRecipe, render, on, moods, families }) {
  const camState = on.camState;
  const gui = new GUI({ title: 'Caustic', width: 320 });
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
  const fFam = gui.addFolder('Le geste').close();
  const fWater = gui.addFolder('L’eau').close();
  const fLight = gui.addFolder('Lumière et fond').close();
  const fCam = gui.addFolder('Caméra').close();
  const fRender = gui.addFolder('Rendu').close();
  let ctls = [];

  function build() {
    const R = getRecipe();
    top.seed = R.seed;
    gui.controllersRecursive().forEach((c) => c.property === 'seed' && c.updateDisplay());
    for (const c of ctls) c.destroy();
    ctls = [];
    const add = (f, ...a) => { const c = f.add(...a); ctls.push(c); return c; };
    const addC = (f, ...a) => { const c = f.addColor(...a); ctls.push(c); return c; };
    const ch = () => on.recipeChanged();
    // une retouche de la forme : la scène est reconstruite (transport optimal)
    const rebuildScene = () => on.sceneChanged();

    add(fScene, R, 'family', opts(families)).name('Famille (nouvelle scène)').onChange((f) => on.familyChanged(f));
    add(fScene, R, 'mood', Object.fromEntries(Object.entries(moods).filter(([, m]) => m.families.includes(R.family)).map(([k, m]) => [m.label, k]))).name('Humeur (nouvelle scène)').onChange((m) => on.moodChanged(m));
    add(fScene, R.loop, 'duration', 12, 90, 1).name('Durée de la boucle (s)').onChange(ch);

    if (R.foyer) {
      const F = R.foyer;
      add(fFam, F, 'series', opts(SERIES, (v) => v.name)).name('Série de dessins').onFinishChange(rebuildScene);
      F.events.forEach((e, i) => add(fFam, e, 'rotation', 0, Math.PI * 2, 0.01).name(`Dessin ${i + 1} : orientation`).onFinishChange(rebuildScene));
      add(fFam, F.slow, 'vn', 0.1, 1, 0.01).name('Vitesse du film (× réel)').onChange(ch);
      add(fFam, F.slow, 'vmin', 0.002, 0.1, 0.001).name('Ralenti au dessin (× réel)').onChange(ch);
      add(fFam, F.slow, 'w', 0.5, 5, 0.05).name('Durée du ralenti (s)').onChange(ch);
      add(fFam, F, 'gain', 0, 4, 0.01).name('Course des plongeurs (× eau)').onChange(ch);
    }
    if (R.faraday) {
      const F = R.faraday;
      const L = { Carrés: 'square', Hexagones: 'hex', 'Quasi-cristal 8': 'quasi8', 'Quasi-cristal 10': 'quasi10', 'Quasi-cristal 12': 'quasi12' };
      add(fFam, F, 'first', L).name('Premier réseau').onChange(ch);
      add(fFam, F, 'second', L).name('Second réseau').onChange(ch);
      add(fFam, F, 'k', 150, 450, 1).name('Nombre d’onde (rad/m)').onChange(ch);
      add(fFam, F, 'amp', 0.00002, 0.0003, 0.000001).name('Amplitude (m)').onChange(ch);
      add(fFam, F, 'beats', 1, 12, 1).name('Battements du stroboscope / boucle').onChange(ch);
      add(fFam, F, 'angle', 0, Math.PI, 0.01).name('Orientation').onChange(ch);
    }
    if (R.karman) {
      const K = R.karman;
      add(fFam, K, 'emissions', 4, 20, 1).name('Tourbillons émis / boucle').onChange(ch);
      add(fFam, K, 'speed', 0.01, 0.08, 0.001).name('Vitesse du courant (m/s)').onChange(ch);
      add(fFam, K, 'depth', 0.0002, 0.004, 0.00001).name('Profondeur des fossettes (m)').onChange(ch);
      add(fFam, K, 'core', 0.002, 0.02, 0.0001).name('Rayon du cœur (m)').onChange(ch);
      add(fFam, K, 'spread', 0.02, 0.12, 0.001).name('Largeur de l’allée (m)').onChange(ch);
    }

    const Wt = R.water;
    add(fWater, Wt, 'turbid', 0, 1, 0.01).name('Turbidité (m⁻¹) : rideaux').onChange(ch);
    add(fWater, Wt, 'ambient', 0, 0.0004, 0.000001).name('Ride de fond (m)').onFinishChange(ch);

    const L = R.light;
    add(fLight, L, 'lux', 0, 12, 0.01).name('Éclairement de la source').onChange(ch);
    add(fLight, L, 'K', 3000, 9000, 50).name('Température (K)').onChange(ch);
    add(fLight, L, 'angular', 0.001, 0.05, 0.0005).name('Taille de la source (rad)').onChange(ch);
    add(fLight, R.env, 'preset', opts(ENV_PRESETS)).name('Studio HDR').onChange(() => on.envChanged());
    add(fLight, R.env, 'intensity', 0, 3, 0.01).name('Studio : intensité').onChange(ch);
    addC(fLight, R.bg, '0').name('Fond : haut').onChange(ch);
    addC(fLight, R.bg, '1').name('Fond : bas').onChange(ch);
    add(fLight, R.grade, 'exposure', 0.2, 4, 0.01).name('Exposition de l’humeur').onChange(ch);

    const C = R.camera;
    add(fCam, C, 'fov', 18, 70, 0.5).name('Champ (°)').onChange(ch);
    add(fCam, C, 'dist', 0.3, 1.6, 0.005).name('Distance (m)').onChange(ch);
    add(fCam, C, 'el', 0.1, 1.2, 0.005).name('Plongée (rad)').onChange(ch);
    add(fCam, C, 'az', -0.8, 0.8, 0.005).name('Azimut (rad)').onChange(ch);
    add(fCam, C, 'sway', 0, 0.15, 0.001).name('Balancement (rad)').onChange(ch);
    add(fCam, C, 'push', 0, 0.2, 0.001).name('Avancée au dessin').onChange(ch);
    add(fCam, camState, 'free').name('Caméra libre').onChange((v) => on.freeCam(v));
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
