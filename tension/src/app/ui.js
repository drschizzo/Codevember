// Panneau de réglages (lil-gui). Ce module ne connaît que la recette, les
// réglages de rendu et des fonctions de rappel : il ne touche pas à la scène.
//
// Ordre des dossiers (commun à tous les projets) : en tête la graine et les
// actions, puis Export, puis la scène (du général au particulier : humeur et
// boucle, chorégraphie, caméra, chaque élément du thème, lumière), puis Rendu.
// Tout est replié sauf l'essentiel ; les libellés sont en français, avec la
// touche du clavier entre parenthèses.
import GUI from 'lil-gui';
import { FINISHES, FINISH_DEFAULTS, PATTERNS } from '../../../shared/finishes.js';
import { ENV_PRESETS } from '../../../shared/scene/env.js';
import { QUALITY } from './settings.js';
import { CABLES } from '../recipe.js';
import { FLOORS } from '../floors.js';

const opts = (o, label = (v) => v.label) => Object.fromEntries(Object.entries(o).map(([k, v]) => [label(v), k]));

// curseurs d'une finition : [clé, libellé, min, max, pas]
const FIN = [
  ['metal', 'Métal', 0, 1, 0.01], ['rough', 'Rugosité', 0.02, 1, 0.01], ['bump', 'Relief', 0, 2, 0.01], ['scale', 'Échelle du motif', 0.2, 4, 0.01],
  ['aniso', 'Anisotropie', 0, 1, 0.01], ['clearcoat', 'Vernis', 0, 1, 0.01], ['ccRough', 'Rugosité vernis', 0, 0.5, 0.005],
  ['sheen', 'Lustre (velours)', 0, 1, 0.01], ['irid', 'Irisation', 0, 1, 0.01], ['glass', 'Transmission (verre)', 0, 1, 0.01], ['ior', 'Indice', 1, 2.4, 0.01],
];

export function createUI({ recipe: getRecipe, render, on, moods, families }) {
  const gui = new GUI({ title: 'Tension', width: 320 });
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
  const fSim = gui.addFolder('Allure (nouvelle simulation)').close();
  const fPieces = gui.addFolder('Matières').close();
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

    add(fScene, R, 'mood', opts(moods)).name('Humeur (nouvelle scène)').onChange((m) => on.moodChanged(m));
    add(fScene, R, 'family', opts(families)).name('Famille (nouvelle scène)').onChange((f) => on.familyChanged(f));
    add(fScene, R.loop, 'duration').name('Durée du pas simulé (s)').disable();
    add(fScene, R.floor, 'type', opts(FLOORS)).name('Sol').onChange(() => on.simChanged());

    add(fCam, R.camera, 'fov', 14, 60, 0.5).name('Champ (°)').onChange(ch);
    add(fCam, R.camera, 'dist', 0.5, 2.5, 0.01).name('Distance (× taille)').onChange(ch);
    add(fCam, R.camera, 'az', -1.5, 1.5, 0.01).name('Azimut (0 = profil)').onChange(ch);
    add(fCam, R.camera, 'el', 0, 1.2, 0.01).name('Hauteur (rad)').onChange(ch);
    add(fCam, R.camera, 'lead', -0.5, 0.6, 0.01).name('Avance du cadre').onChange(ch);
    add(fCam, R.camera, 'sway', 0, 0.2, 0.001).name('Balancement').onChange(ch);
    add(fCam, on.camState, 'free').name('Caméra libre (souris)').onChange((v) => on.freeCam(v));

    // simulation : toute retouche relance le calcul (forme, allure, cycle limite)
    const S = R.sim, sim = () => on.simChanged();
    if (S.family === 'chenille') {
      add(fSim, S, 'm', { '4': 4, '6': 6 }).name('Modules (pairs : le cap tient)').onChange(sim);
      S.amp ??= 0.34; S.waves ??= 4; S.pulse ??= 1.1; S.lag ??= 0.45;
      add(fSim, S, 'amp', 0.15, 0.4, 0.01).name('Contraction (part)').onFinishChange(sim);
      add(fSim, S, 'waves', 2, 6, 2).name('Ondes par boucle (aller et retour)').onFinishChange(sim);
      add(fSim, S, 'pulse', 0.6, 2, 0.05).name('Durée d\u2019une contraction (s)').onFinishChange(sim);
      add(fSim, S, 'lag', 0.2, 0.9, 0.05).name('Retard d\u2019un module (s)').onFinishChange(sim);
    } else if (S.family === 'cerceau') {
      S.dur ??= 8; S.omax ??= 1.25;
      add(fSim, S, 'dur', 5, 14, 0.5).name('Durée du tour (s)').onFinishChange(sim);
      add(fSim, S, 'omax', 0.6, 1.6, 0.05).name('Décalage max. du moyeu').onFinishChange(sim);
    } else {
      S.lead ??= 0.4;
      add(fSim, S, 'lead', 0.2, 1.5, 0.05).name('Attente initiale (s)').onFinishChange(sim);
    }

    // matières par rôle : tube, virole, embout ; rotules ; treuils ; câble
    for (const [role, label] of [['strut', 'Barres'], ['ball', 'Rotules et moyeu'], ['winch', 'Treuils']]) {
      const M = R.mats[role];
      const f = fPieces.addFolder(label).close();
      folders.push(f);
      for (const [side, sl] of [['outer', role === 'strut' ? 'Tube' : 'Corps'], ['inner', role === 'strut' ? 'Viroles' : 'Bagues'], ['edge', 'Embouts et laiton']]) {
        const F = M[side];
        const fs = f.addFolder(`${sl} · ${F.label}`).close();
        const pick = { preset: F.preset };
        fs.add(pick, 'preset', opts(FINISHES)).name('Finition').onChange((k) => {
          Object.assign(F, { ...FINISH_DEFAULTS, ...FINISHES[k], preset: k });
          on.finishChanged(); build();
        });
        fs.add(F, 'pattern', PATTERNS).name('Motif').onChange(() => on.finishChanged());
        fs.addColor(F, 'color').name('Couleur').onChange(() => on.finishChanged());
        for (const [k, l, a, b, st] of FIN) fs.add(F, k, a, b, st).name(l).onChange(() => on.finishChanged());
      }
    }
    add(fPieces, R.mats, 'cable', opts(CABLES)).name('Câbles').onChange(() => on.finishChanged());

    const L = R.light;
    addC(fLight, L.key, 'color').name('Lampe : couleur').onChange(ch);
    add(fLight, L.key, 'scale', 0, 3, 0.01).name('Lampe : éclairement').onChange(ch);
    add(fLight, L.key, 'az', -Math.PI, Math.PI, 0.01).name('Lampe : azimut (0 = devant)').onChange(ch);
    add(fLight, L.key, 'el', 0.05, 1.55, 0.01).name('Lampe : hauteur').onChange(ch);
    add(fLight, L.key, 'angle', 0.1, 1.2, 0.01).name('Lampe : ouverture').onChange(ch);
    add(fLight, L.key, 'penumbra', 0, 1, 0.01).name('Lampe : pénombre').onChange(ch);
    L.rim.forEach((r, i) => {
      addC(fLight, r, 'color').name(`Contre-jour ${i + 1} : couleur`).onChange(ch);
      add(fLight, r, 'scale', 0, 1.5, 0.01).name(`Contre-jour ${i + 1} : éclairement`).onChange(ch);
    });
    add(fLight, R.env, 'preset', opts(ENV_PRESETS)).name('Studio HDR').onChange(() => on.envChanged());
    add(fLight, R.env, 'intensity', 0, 3, 0.01).name('Studio : intensité').onChange(ch);
    add(fLight, R.env, 'rotation', 0, Math.PI * 2, 0.01).name('Studio : rotation').onChange(ch);
    addC(fLight, R.fog, 'color').name('Fond et brume').onChange(ch);
    add(fLight, R.fog, 'near', 0, 30, 0.1).name('Brume : début').onChange(ch);
    add(fLight, R.fog, 'far', 1, 60, 0.1).name('Brume : fin').onChange(ch);
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
