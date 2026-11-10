// Panneau de réglages (lil-gui). Ce module ne connaît que la recette, les
// réglages de rendu et des fonctions de rappel : il ne touche pas à la scène.
//
// Ordre des dossiers (commun à tous les projets) : en tête la graine et les
// actions, puis Export, puis la scène (du général au particulier : humeur et
// boucle, chorégraphie, caméra, chaque élément du thème, lumière), puis Rendu.
// Tout est replié sauf l'essentiel ; les libellés sont en français, avec la
// touche du clavier entre parenthèses.
import GUI from 'lil-gui';
import { FINISHES, FINISH_DEFAULTS, PATTERNS, SETS } from '../finishes.js';
import { ENV_PRESETS } from '../scene/env.js';
import { QUALITY } from './settings.js';

const opts = (o, label = (v) => v.label) => Object.fromEntries(Object.entries(o).map(([k, v]) => [label(v), k]));

// curseurs d'une finition : [clé, libellé, min, max, pas]
const FIN = [
  ['metal', 'Métal', 0, 1, 0.01], ['rough', 'Rugosité', 0.02, 1, 0.01], ['bump', 'Relief', 0, 2, 0.01], ['scale', 'Échelle du motif', 0.2, 4, 0.01],
  ['aniso', 'Anisotropie', 0, 1, 0.01], ['clearcoat', 'Vernis', 0, 1, 0.01], ['ccRough', 'Rugosité vernis', 0, 0.5, 0.005],
  ['sheen', 'Lustre (velours)', 0, 1, 0.01], ['irid', 'Irisation', 0, 1, 0.01], ['glass', 'Transmission (verre)', 0, 1, 0.01], ['ior', 'Indice', 1, 2.4, 0.01],
];

export function createUI({ recipe: getRecipe, render, on, moods, plants, containers }) {
  const gui = new GUI({ title: 'Fold', width: 320 });
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
  const fPlant = gui.addFolder('Plante').close();
  const fMat = gui.addFolder('Matières').close();
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
    const regen = () => on.sceneChanged();

    add(fScene, R, 'mood', opts(moods)).name('Décor (nouvelle scène)').onChange((m) => on.moodChanged(m));
    add(fScene, R.loop, 'duration', 16, 120, 1).name('Durée de la boucle (s)').onChange(regen);
    add(fScene, R.loop, 'spacing', 420, 900, 10).name('Temps physique entre deux touchers (s)').onChange(regen);
    const evs = { list: R.events.map((e) => (e.cause === 'tap' ? 'M' : 'G')).join('') };
    add(fScene, evs, 'list', { 'G M': 'GM', 'G M G': 'GMG', 'G G M': 'GGM', 'G M G G': 'GMGG', 'G G M M': 'GGMM', 'G G G': 'GGG', 'M': 'M', 'G': 'G' })
      .name('Touchers (G goutte, M marteau)').onChange((v) => { const src = R.container === 'cloche' || R.container === 'ward' ? 'roof' : 'burette'; R.events = [...v].map((c) => (c === 'M' ? { cause: 'tap' } : { cause: 'drop', source: src })); regen(); });

    add(fCam, R.camera, 'fov', 18, 60, 0.5).name('Champ (°)').onChange(regen);
    add(fCam, R.camera, 'close', 1.4, 4, 0.01).name('Distance, gros plan').onChange(regen);
    add(fCam, R.camera, 'wide', 3, 9, 0.01).name('Distance, plan large').onChange(regen);
    add(fCam, R.camera, 'el', -0.2, 0.8, 0.01).name('Hauteur du regard (rad)').onChange(regen);
    add(fCam, R.camera, 'az', -3.2, 3.2, 0.01).name('Azimut de départ (rad)').onChange(regen);
    add(fCam, R.camera, 'orbit', -2, 2, 1).name('Tours / boucle').onChange(regen);
    add(fCam, R.camera, 'sway', 0, 0.12, 0.001).name('Balancement').onChange(regen);
    add(fCam, on.camState, 'free').name('Caméra libre (souris)').onChange((v) => on.freeCam(v));

    // la plante
    add(fPlant, R.plant, 'kind', opts(plants)).name('Plante').onChange(regen);
    add(fPlant, R.plant, 'seed').name('Graine de la plante').onFinishChange(regen);
    add(fPlant, R, 'container', opts(containers)).name('Monture').onChange(() => { const src = R.container === 'cloche' || R.container === 'ward' ? 'roof' : 'burette'; for (const e of R.events) if (e.cause === 'drop') e.source = src; regen(); });
    const look = () => on.lookChanged();
    add(fPlant, R.leaf, 'hue', 70, 130, 0.5).name('Feuilles : teinte (°)').onChange(look);
    add(fPlant, R.leaf, 'sat', 0.1, 0.9, 0.01).name('Feuilles : saturation').onChange(look);
    add(fPlant, R.leaf, 'light', 0.1, 0.6, 0.005).name('Feuilles : clarté').onChange(look);
    add(fPlant, R.leaf, 'translucency', 0, 3, 0.01).name('Translucidité').onChange(look);
    addC(fPlant, R.leaf, 'flower').name('Fleurs').onChange(look);

    // matières des montures et des appareils
    for (const [k, label] of [['table', 'Table'], ['pot', 'Pot'], ['base', 'Socle, caisse'], ['stand', 'Statif'], ['brass', 'Marteau'], ['coil', 'Bobine']]) {
      const fin = R.decor[k];
      if (!fin) continue;
      const f = fMat.addFolder(`${label} · ${SETS[fin.set]?.label ?? 'sur mesure'}`).close();
      folders.push(f);
      for (const [side, sl] of [['outer', 'Face principale'], ['inner', 'Seconde'], ['edge', 'Tranche']]) {
        const F = fin[side];
        const fs = f.addFolder(`${sl} · ${F.label}`).close();
        const pick = { preset: F.preset };
        fs.add(pick, 'preset', opts(FINISHES)).name('Finition').onChange((key) => { Object.assign(F, { ...FINISH_DEFAULTS, ...FINISHES[key], preset: key }); on.finishChanged(); build(); });
        fs.add(F, 'pattern', PATTERNS).name('Motif').onChange(() => on.finishChanged());
        fs.addColor(F, 'color').name('Couleur').onChange(() => on.finishChanged());
        fs.addColor(F, 'color2').name('Couleur 2').onChange(() => on.finishChanged());
        for (const [kk, l, a, b, st] of FIN) fs.add(F, kk, a, b, st).name(l).onChange(() => on.finishChanged());
      }
    }

    const L = R.light;
    addC(fLight, L.key, 'color').name('Lampe : couleur').onChange(ch);
    add(fLight, L.key, 'intensity', 0, 2500, 1).name('Lampe : intensité (cd)').onChange(ch);
    add(fLight, L.key, 'az', -Math.PI * 2, Math.PI * 2, 0.01).name('Lampe : azimut').onChange(ch);
    add(fLight, L.key, 'el', 0.05, 1.5, 0.01).name('Lampe : hauteur').onChange(ch);
    add(fLight, L.key, 'angle', 0.1, 1.2, 0.01).name('Lampe : ouverture').onChange(ch);
    add(fLight, L.key, 'penumbra', 0, 1, 0.01).name('Lampe : pénombre').onChange(ch);
    L.rim.forEach((r, i) => {
      addC(fLight, r, 'color').name(`Contre-jour ${i + 1} : couleur`).onChange(ch);
      add(fLight, r, 'intensity', 0, 1200, 1).name(`Contre-jour ${i + 1} : intensité`).onChange(ch);
      add(fLight, r, 'az', -Math.PI * 2, Math.PI * 2, 0.01).name(`Contre-jour ${i + 1} : azimut`).onChange(ch);
    });
    if (L.sky) {
      addC(fLight, L.sky, 'color').name('Lumière du lieu : ciel').onChange(ch);
      addC(fLight, L.sky, 'ground').name('Lumière du lieu : sol').onChange(ch);
      add(fLight, L.sky, 'intensity', 0, 3, 0.01).name('Lumière du lieu : intensité').onChange(ch);
    }
    add(fLight, R.env, 'preset', opts(ENV_PRESETS)).name('Studio HDR').onChange(() => on.envChanged());
    add(fLight, R.env, 'intensity', 0, 2, 0.01).name('Studio : intensité').onChange(ch);
    add(fLight, R.env, 'rotation', 0, Math.PI * 2, 0.01).name('Studio : rotation').onChange(ch);
    add(fLight, R.decor, 'wall', 0, 3, 0.01).name('Lumière du fond').onChange(look);
    addC(fLight, R.fog, 'color').name('Fond et brume').onChange(look);
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
