// Panneau de réglages (lil-gui). Ce module ne connaît que la recette, les
// réglages de rendu et des fonctions de rappel : il ne touche pas à la scène.
//
// Ordre des dossiers (commun à tous les projets) : en tête la graine et les
// actions, puis Export, puis la scène (du général au particulier : humeur et
// boucle, chorégraphie, caméra, chaque élément du thème, lumière), puis Rendu.
// Tout est replié sauf l'essentiel ; les libellés sont en français, avec la
// touche du clavier entre parenthèses.
import GUI from 'lil-gui';
import { SETS } from '../finishes.js';
import { ENV_PRESETS } from '../scene/env.js';
import { QUALITY } from './settings.js';
import { floorFinish, FORMS, MECHS, DECORS } from '../recipe.js';
import { GLASSES } from '../glasses.js';

const opts = (o, label = (v) => v.label) => Object.fromEntries(Object.entries(o).map(([k, v]) => [label(v), k]));

// réglages de fracture propres à chaque mécanisme : [clé, libellé, min, max, pas]
const MECH_PARAMS = {
  ball: [['rays', 'Fissures radiales', 5, 18, 1], ['aspect', 'Étirement radial des éclats', 0.3, 1, 0.01], ['ringStep', 'Écart des anneaux', 0.25, 1, 0.01], ['crush', 'Zone broyée', 0.015, 0.08, 0.001], ['branchAt', 'Bifurcation après l’anneau', 1, 6, 1]],
  resonance: [['strips', 'Lames', 4, 20, 1], ['elong', 'Hauteur des lames', 0.1, 0.5, 0.01]],
  tempered: [['dice', 'Dés', 60, 260, 1]],
  thermal: [['pieces', 'Pièces', 4, 20, 1]],
};

export function createUI({ recipe: getRecipe, render, on, moods }) {
  const gui = new GUI({ title: 'Calcin', width: 330 });
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
  const fPieces = gui.addFolder('Pièces').close();
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
    const geo = () => on.pieceChanged();

    add(fScene, R, 'mood', opts(moods)).name('Humeur (nouvelle scène)').onChange((m) => on.moodChanged(m));
    const cnt = { n: R.pieces.length };
    add(fScene, cnt, 'n', { '2 pièces': 2, '3 pièces': 3, '4 pièces': 4 }).name('Pièces par boucle').onChange((n) => on.countChanged(n));
    add(fScene, R.loop, 'stage', 6, 16, 0.1).name('Durée d’une étape (s)').onFinishChange(geo);
    add(fScene, R.loop.slow, 'k', 4, 40, 1).name('Caméra rapide (ralenti ×)').onChange(ch);
    add(fScene, R.loop.slow, 'plat', 0.5, 4, 0.01).name('Durée du ralenti (s)').onChange(ch);
    add(fScene, R.loop.slow, 'post', 0.3, 3, 0.01).name('Retour au temps réel (s)').onChange(ch);


    add(fCam, R.camera, 'fov', 18, 70, 0.5).name('Champ (°)').onChange(ch);
    add(fCam, R.camera, 'dist', 3, 14, 0.01).name('Distance').onChange(ch);
    add(fCam, R.camera, 'height', -1, 4, 0.01).name('Hauteur').onChange(ch);
    add(fCam, R.camera, 'orbit', -2, 2, 1).name('Tours / boucle').onChange(ch);
    add(fCam, R.camera, 'sway', 0, 0.6, 0.01).name('Balancement').onChange(ch);
    add(fCam, R.camera, 'push', 0, 0.35, 0.01).name('Rapprochement à la rupture').onChange(ch);
    add(fCam, on.camState, 'free').name('Caméra libre (souris)').onChange((v) => on.freeCam(v));

    R.pieces.forEach((P, i) => {
      const f = fPieces.addFolder(`${i + 1}. ${FORMS[P.form].label} · ${GLASSES[P.glass].label} · ${MECHS[P.mech].label}`).close();
      folders.push(f);
      f.add(P, 'form', opts(FORMS)).name('Forme').onChange(geo);
      f.add(P, 'glass', opts(GLASSES)).name('Verre').onChange(() => { on.finishChanged(); });
      f.add(P, 'mech', opts(MECHS)).name('Déclencheur').onChange((m) => on.mechChanged(i, m));
      const fd = f.addFolder('Modelé, parties, filigrane').close();
      fd.add(P, 'decor', opts(DECORS)).name('Modelé').onChange(geo);
      fd.add(P, 'decorN', 3, 30, 1).name('Côtes, lobes ou festons').onFinishChange(geo);
      fd.add(P, 'decorAmp', 0, 0.1, 0.001).name('Relief').onFinishChange(geo);
      fd.add(P, 'twist', -1.5, 1.5, 0.01).name('Torsion (tours)').onFinishChange(geo);
      for (const part of FORMS[P.form].parts ?? []) {
        const st = { on: P.parts.includes(part) };
        fd.add(st, 'on').name({ anse: 'Anse', anses2: 'Deux anses', bouchon: 'Bouchon', fil: 'Fil appliqué' }[part]).onChange((v) => { P.parts = v ? [...P.parts, part] : P.parts.filter((x) => x !== part); geo(); });
      }
      fd.add(P, 'fil', 0, 1, 1).name('Filigrane').onChange(ch);
      fd.add(P, 'filN', 4, 40, 1).name('Filigrane : fils').onChange(ch);
      fd.add(P, 'filTwist', -3, 3, 0.01).name('Filigrane : torsion').onChange(ch);
      for (const [k, l, a, b, st] of [['stretch', 'Hauteur', 0.7, 1.4, 0.01], ['wide', 'Largeur', 0.7, 1.4, 0.01], ['bulge', 'Renflement', -0.2, 0.3, 0.005], ['waist', 'Taille', -0.12, 0.12, 0.005], ['thickness', 'Épaisseur de la paroi', 0.008, 0.04, 0.001]]) f.add(P, k, a, b, st).name(l).onFinishChange(geo);
      const fr = f.addFolder('Fracture').close();
      for (const [k, l, a, b, st] of MECH_PARAMS[P.mech] ?? []) if (P[k] !== undefined) fr.add(P, k, a, b, st).name(l).onFinishChange(geo);
      fr.add(P, 'warp', 0, 0.08, 0.001).name('Sinuosité des fissures').onFinishChange(geo);
      fr.add(P, 'force', 0.2, 2.5, 0.01).name('Force de l’éclatement').onFinishChange(geo);
      fr.add({ r: () => { P.seed = `${i}:${Math.floor(Math.random() * 1e6)}`; geo(); } }, 'r').name('⟳  Autre fracture');
      f.add(P, 'spin', -2, 2, 0.01).name('Plateau tournant (rad/s)').onChange(ch);
      f.add(P, 'fire', 0, 2, 0.01).name('Feu (dispersion)').onChange(ch);
    });

    const L = R.light;
    addC(fLight, L.key, 'color').name('Lampe : couleur').onChange(ch);
    add(fLight, L.key, 'intensity', 0, 2500, 1).name('Lampe : intensité').onChange(ch);
    add(fLight, L.key, 'az', -Math.PI, Math.PI, 0.01).name('Lampe : azimut').onChange(ch);
    add(fLight, L.key, 'el', 0.1, 1.5, 0.01).name('Lampe : hauteur').onChange(ch);
    add(fLight, L.key, 'penumbra', 0, 1, 0.01).name('Lampe : pénombre').onChange(ch);
    L.rim.forEach((r, i) => {
      addC(fLight, r, 'color').name(`Contre-jour ${i + 1} : couleur`).onChange(ch);
      add(fLight, r, 'intensity', 0, 1500, 1).name(`Contre-jour ${i + 1} : intensité`).onChange(ch);
    });
    add(fLight, L, 'heat', 0, 3, 0.01).name('Incandescence').onChange(ch);
    add(fLight, L, 'uv', 0, 2, 0.01).name('Lumière noire (fluorescence)').onChange(ch);
    add(fLight, R.env, 'preset', opts(ENV_PRESETS)).name('Studio HDR').onChange(() => on.envChanged());
    add(fLight, R.env, 'intensity', 0, 3, 0.01).name('Studio : intensité').onChange(ch);
    add(fLight, R.env, 'rotation', 0, Math.PI * 2, 0.01).name('Studio : rotation').onChange(ch);
    addC(fLight, R.fog, 'color').name('Fond et brume').onChange(ch);
    addC(fLight, R.backdrop, 'color').name('Fond éclairé : couleur').onChange(ch);
    add(fLight, R.backdrop, 'gain', 0, 2, 0.01).name('Fond éclairé : intensité').onChange(ch);
    add(fLight, R.fog, 'near', 0, 30, 0.1).name('Brume : début').onChange(ch);
    add(fLight, R.fog, 'far', 1, 60, 0.1).name('Brume : fin').onChange(ch);
    const fl = { set: R.floor.finish.set };
    add(fLight, fl, 'set', opts(SETS)).name('Sol').onChange((k) => { R.floor.finish = floorFinish(k, R.floor.finish.outer.color); on.floorChanged(); });
    const fc = { color: R.floor.finish.outer.color };
    addC(fLight, fc, 'color').name('Sol : teinte').onChange((c) => { for (const k of ['outer', 'inner', 'edge']) R.floor.finish[k].color = c; on.floorChanged(); });
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
