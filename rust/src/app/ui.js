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
import { CLIMATES, FAMILIES, MACHINES } from '../recipe.js';

const opts = (o, label = (v) => v.label) => Object.fromEntries(Object.entries(o).map(([k, v]) => [label(v), k]));

export function createUI({ recipe: getRecipe, render, on, moods }) {
  const gui = new GUI({ title: 'Rust', width: 320 });
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
  const fPiece = gui.addFolder('Pièce').close();
  const fRust = gui.addFolder('Rouille et pluie').close();
  const fMach = gui.addFolder('Machine').close();
  const fCam = gui.addFolder('Caméra').close();
  const fLight = gui.addFolder('Lumière et fond').close();
  const fRender = gui.addFolder('Rendu').close();
  let ctls = [];

  // libellés des paramètres de pièce et de machine : [min, max, pas, libellé]
  const PP = {
    chordLength: [1.1, 1.8, 0.01, 'Membrure : longueur (m)'], chordLeg: [0.08, 0.13, 0.01, 'Membrure : aile (m)'], memberLeg: [0.07, 0.12, 0.01, 'Barres : aile (m)'],
    memberLength: [0.6, 1.2, 0.01, 'Barres : longueur (m)'], pitch: [0.06, 0.1, 0.005, 'Pas des rivets (m)'], rivetsPerRow: [3, 8, 1, 'Rivets par rangée'],
    pipe: [0.15, 0.25, 0.001, 'Conduite : diamètre (m)'], bolts: [8, 20, 4, 'Boulons par bride'], bonnetBolts: [6, 14, 2, 'Boulons du chapeau'], length: [1.0, 1.7, 0.01, 'Longueur (m)'], wheel: [0.14, 0.26, 0.01, 'Volant : rayon (m)'], spokes: [3, 20, 1, 'Rayons'],
    radius: [0.5, 0.7, 0.01, 'Rayon de roulement (m)'], counterSpan: [1, 2.2, 0.01, 'Contrepoids : ouverture (rad)'], crankR: [0.24, 0.36, 0.01, 'Maneton : rayon (m)'],
    width: [0.6, 0.85, 0.01, 'Largeur (m)'], height: [1.0, 1.35, 0.01, 'Hauteur (m)'], dogs: [4, 12, 2, 'Taquets'],
    band: [0.06, 0.12, 0.005, 'Hauteur de la ligne (m)'], standoff: [0.12, 0.3, 0.01, 'Distance de travail (m)'], turns: [5, 12, 1, 'Tours du plateau'], foot: [0.12, 0.22, 0.005, 'Empreinte de la buse (m)'],
    tilt: [0.1, 0.5, 0.01, 'Inclinaison de la buse (rad)'], side: [-2.4, 2.4, 0.01, 'Colonne : angle à la caméra (rad)'], margin: [0.08, 0.2, 0.01, 'Marge de la fosse (m)'], hold: [0.2, 0.5, 0.01, 'Immersion (part du décapage)'], swing: [0, 0.02, 0.001, 'Balancement'],
  };

  function build() {
    const R = getRecipe();
    top.seed = R.seed;
    gui.controllersRecursive().forEach((c) => c.property === 'seed' && c.updateDisplay());
    for (const c of ctls) c.destroy();
    ctls = [];
    const add = (f, o, k, ...a) => { const c = f.add(o, k, ...a); ctls.push(c); return c; };
    const addC = (f, o, k) => { const c = f.addColor(o, k); ctls.push(c); return c; };
    const ch = () => on.recipeChanged();
    const sel = { family: R.family, machine: R.machine.kind, climate: R.climate };

    add(fScene, R, 'mood', opts(moods)).name('Humeur (même graine)').onChange((m) => on.moodChanged(m));
    add(fScene, sel, 'family', opts(FAMILIES)).name('Pièce (même graine)').onChange((v) => on.forceChanged({ family: v }));
    add(fScene, sel, 'machine', opts(MACHINES)).name('Machine (même graine)').onChange((v) => on.forceChanged({ machine: v }));
    add(fScene, sel, 'climate', opts(CLIMATES)).name('Climat (même graine)').onChange((v) => on.forceChanged({ climate: v }));
    add(fScene, R.loop, 'duration', 20, 120, 1).name('Durée de la boucle (s)').onChange(ch);

    for (const [k, v] of Object.entries(R.piece.params)) {
      if (typeof v === 'boolean') add(fPiece, R.piece.params, k).name(k === 'oval' ? 'Ovale' : k).onChange(() => on.rebuild());
      else if (PP[k]) add(fPiece, R.piece.params, k, PP[k][0], PP[k][1], PP[k][2]).name(PP[k][3]).onFinishChange(() => on.rebuild());
    }
    for (const [k, v] of Object.entries(R.machine)) {
      if (k === 'kind') continue;
      if (typeof v === 'boolean') add(fMach, R.machine, k).name(k === 'startLeft' ? 'Commence à gauche' : k).onChange(() => on.rebuild());
      else if (k === 'park' || k === 'dir') add(fMach, R.machine, k, { 'Gauche / horaire': -1, 'Droite / direct': 1 }).name(k === 'park' ? 'Garage du portique' : 'Sens de rotation').onChange(() => on.rebuild());
      else if (PP[k]) add(fMach, R.machine, k, PP[k][0], PP[k][1], PP[k][2]).name(PP[k][3]).onFinishChange(() => on.rebuild());
    }
    const Ru = R.rust;
    add(fRust, Ru, 'pits', 6, 50, 0.5).name('Germes (piqûres / m)').onChange(ch);
    add(fRust, Ru, 'depth', 0.4, 1.4, 0.01).name('Épaisseur de la croûte').onChange(ch);
    add(fRust, Ru, 'flake', 0, 2, 0.01).name('Écailles').onChange(ch);
    add(fRust, Ru, 'blister', 0, 2, 0.01).name('Cloques').onChange(ch);
    add(fRust, Ru, 'streak', 0, 2.5, 0.01).name('Coulures').onChange(ch);
    add(fRust, Ru, 'hue', -0.3, 0.6, 0.01).name('Teinte (chlorures)').onChange(ch);
    add(fRust, R.rain, 'density', 0, 2, 0.01).name('Pluie : densité').onChange(ch);
    add(fRust, R.rain, 'len', 0.02, 0.25, 0.005).name('Pluie : traînée (m)').onChange(ch);
    add(fRust, R.rain, 'wind', -0.6, 0.6, 0.01).name('Pluie : vent').onChange(ch);

    add(fCam, R.camera, 'fov', 18, 50, 0.5).name('Champ (°)').onChange(() => on.cameraChanged());
    add(fCam, R.camera, 'el', 0, 40, 0.5).name('Hauteur (°)').onChange(() => on.cameraChanged());
    add(fCam, R.camera, 'az', -1.2, 1.2, 0.01).name('Azimut (rad)').onChange(() => on.cameraChanged());
    add(fCam, R.camera, 'fit', 0.8, 1.6, 0.01).name('Cadrage large').onChange(() => on.cameraChanged());
    add(fCam, R.camera, 'close', 0.4, 1, 0.01).name('Rapprochement (× distance)').onChange(() => on.cameraChanged());
    add(fCam, R.camera, 'sway', 0, 0.15, 0.001).name('Balancement').onChange(() => on.cameraChanged());
    add(fCam, on.camState, 'free').name('Caméra libre (souris)').onChange((v) => on.freeCam(v));

    const L = R.light;
    addC(fLight, L.key, 'color').name('Lampe : couleur').onChange(ch);
    add(fLight, L.key, 'power', 0, 3, 0.01).name('Lampe : puissance').onChange(ch);
    add(fLight, L.key, 'az', -Math.PI, Math.PI, 0.01).name('Lampe : azimut').onChange(ch);
    add(fLight, L.key, 'el', 0.2, 1.5, 0.01).name('Lampe : hauteur').onChange(ch);
    add(fLight, L.key, 'angle', 0.2, 0.55, 0.01).name('Lampe : ouverture').onChange(ch);
    add(fLight, L.key, 'penumbra', 0, 1, 0.01).name('Lampe : pénombre').onChange(ch);
    L.rim.forEach((r, i) => {
      addC(fLight, r, 'color').name(`Contre-jour ${i + 1} : couleur`).onChange(ch);
      add(fLight, r, 'power', 0, 3, 0.01).name(`Contre-jour ${i + 1} : puissance`).onChange(ch);
    });
    add(fLight, R.env, 'preset', opts(ENV_PRESETS)).name('Studio HDR').onChange(() => on.envChanged());
    add(fLight, R.env, 'intensity', 0, 2, 0.01).name('Studio : intensité').onChange(ch);
    add(fLight, R.env, 'rotation', -Math.PI, Math.PI, 0.01).name('Studio : rotation').onChange(ch);
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
