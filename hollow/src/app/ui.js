// Panneau de réglages (lil-gui). Ce module ne connaît que la recette, les
// réglages de rendu et des fonctions de rappel : il ne touche pas à la scène.
import GUI from 'lil-gui';
import { FINISHES, SETS, FINISH_DEFAULTS } from '../finishes.js';
import { MOODS, GEMS } from '../recipe.js';
import { TYPES, P, HOLE_SHAPES, IRIS_PARAMS, SETTINGS } from '../types.js';
import { ENV_PRESETS } from '../scene/env.js';
import { QUALITY } from './settings.js';

const opts = (o, label = (v) => v.label) => Object.fromEntries(Object.entries(o).map(([k, v]) => [label(v), k]));

const FIN = [
  ['metal', 'Métal', 0, 1, 0.01], ['rough', 'Rugosité', 0.02, 1, 0.01], ['bump', 'Relief', 0, 2, 0.01], ['scale', 'Échelle du motif', 0.2, 4, 0.01],
  ['aniso', 'Anisotropie', 0, 1, 0.01], ['clearcoat', 'Vernis', 0, 1, 0.01], ['ccRough', 'Rugosité vernis', 0, 0.5, 0.005],
  ['sheen', 'Lustre (velours)', 0, 1, 0.01], ['sheenRough', 'Rugosité lustre', 0, 1, 0.01],
  ['irid', 'Irisation', 0, 1, 0.01], ['iridIOR', 'Indice irisation', 1, 2.5, 0.01], ['iridMin', 'Couche mini (nm)', 0, 1200, 5], ['iridMax', 'Couche maxi (nm)', 0, 1200, 5],
  ['smudge', 'Traces de doigts', 0, 1, 0.01], ['glass', 'Transmission (verre)', 0, 1, 0.01], ['ior', 'Indice', 1, 2.4, 0.01],
  ['dispersion', 'Dispersion', 0, 1, 0.01], ['attDist', 'Absorption', 0.02, 2, 0.01],
];

export function createUI({ recipe: getRecipe, render, on }) {
  const gui = new GUI({ title: 'Hollow', width: 320 });
  gui.domElement.id = 'gui';
  const state = { seed: '', fps: '' };
  let layerRoot = null;

  // ── En tête : graine et actions ──
  const top = {
    seed: '',
    random: () => on.random(),
    apply: () => on.regenerate(top.seed),
    link: () => on.copyLink(),
    pause: () => on.togglePause(),
    png: () => on.exportPNG(),
  };
  gui.add(top, 'seed').name('Graine').onFinishChange((v) => on.regenerate(v));
  gui.add(top, 'random').name('⟳  Nouvelle scène  (N)');
  gui.add(top, 'link').name('Copier le lien de cette scène');
  gui.add(top, 'pause').name('Pause / lecture  (espace)');
  const fpsCtl = gui.add(state, 'fps').name('Images / s').disable();

  // ── Export ──
  const exp = { width: 1920, height: 1080, fps: 60, mbps: 40, go: () => on.exportVideo({ ...exp }), png: () => on.exportPNG() };
  const fExp = gui.addFolder('Export').close();
  fExp.add(exp, 'width', { '1280': 1280, '1920': 1920, '2560': 2560, '3840': 3840, '1080 (carré)': 1080 }).name('Largeur');
  fExp.add(exp, 'height', { '720': 720, '1080': 1080, '1440': 1440, '2160': 2160, '1920 (vertical)': 1920 }).name('Hauteur');
  fExp.add(exp, 'fps', [24, 30, 50, 60]).name('Images / s');
  fExp.add(exp, 'mbps', 8, 120, 1).name('Débit (Mb/s)');
  fExp.add(exp, 'go').name('Exporter la boucle (MP4)');
  fExp.add(exp, 'png').name('Image (PNG)');

  // ── Scène (recette) ──
  const fScene = gui.addFolder('Scène');
  const fLoop = fScene.addFolder('Boucle et plongée');
  const fNest = fScene.addFolder('Nid').close();
  const fCam = fScene.addFolder('Caméra').close();
  const fLight = gui.addFolder('Lumière').close();
  layerRoot = gui.addFolder('Couches').close();
  const fRender = gui.addFolder('Rendu').close();

  let sceneCtls = [];
  function buildScene() {
    const R = getRecipe();
    top.seed = R.seed;
    gui.controllersRecursive().forEach((c) => c.property === 'seed' && c.updateDisplay());
    for (const c of sceneCtls) c.destroy();
    sceneCtls = [];
    const add = (f, o, k, ...a) => { const c = f.add(o, k, ...a); sceneCtls.push(c); return c; };
    const addC = (f, o, k) => { const c = f.addColor(o, k); sceneCtls.push(c); return c; };
    const ch = () => on.recipeChanged();
    add(fLoop, R.loop, 'duration', 4, 120, 1).name('Durée (s)').onChange(ch);
    add(fLoop, R.loop, 'dive').name('Plongée').onChange(ch);
    add(fLoop, R.loop, 'depth', -1, 6, 0.01).name('Profondeur (sans plongée)').onChange(ch);
    add(fLoop, R, 'mood', opts(MOODS)).name('Humeur (nouvelle scène)').onChange(() => on.moodChanged());
    add(fNest, R.nest, 'ratio', 0.45, 0.8, 0.005).name('Rapport entre couches').onChange(ch);
    add(fNest, R.nest, 'core', 0.015, 0.15, 0.001).name('Taille du cœur').onChange(ch);
    add(fNest, R.fog, 'near', 0.5, 4, 0.01).name('Brouillard : début').onChange(ch);
    add(fNest, R.fog, 'far', 1, 6, 0.01).name('Brouillard : fin').onChange(ch);
    addC(fNest, R.fog, 'color').name('Fond').onChange(ch);
    if (R.dust) {
      add(fNest, R.dust, 'amount', 0, 1, 0.01).name('Poussière d’or').onChange(ch);
      add(fNest, R.dust, 'size', 0.2, 3, 0.01).name('Poussière : taille').onChange(ch);
      addC(fNest, R.dust, 'color').name('Poussière : teinte').onChange(ch);
    }
    add(fCam, R.camera, 'fov', 18, 80, 0.5).name('Champ (°)').onChange(ch);
    add(fCam, R.camera, 'sway', 0, 0.08, 0.001).name('Balancement').onChange(ch);
    add(fCam, R.camera, 'roll', 0, 0.2, 0.001).name('Roulis').onChange(ch);
    add(fCam, on.camState, 'free').name('Caméra libre (souris)').onChange((v) => on.freeCam(v));

    const fc = fLight;
    addC(fc, R.core, 'color').name('Cœur : couleur').onChange(ch);
    add(fc, R.core, 'intensity', 0, 200, 0.5).name('Cœur : intensité').onChange(ch);
    add(fc, R.core, 'glow', 0, 80, 0.5).name('Cœur : éclat').onChange(ch);
    if (R.core.halo === undefined) R.core.halo = 2.4;
    add(fc, R.core, 'halo', 1, 5, 0.01).name('Cœur : halo').onChange(ch);
    add(fc, R.core, 'decay', 0.5, 2.5, 0.01).name('Cœur : décroissance').onChange(ch);
    add(fc, R.core, 'pulse', 0, 0.5, 0.01).name('Cœur : pulsation').onChange(ch);
    add(fc, R.core, 'shadowSoft', 0, 8, 0.1).name('Cœur : douceur des ombres').onChange(ch);
    addC(fc, R.key, 'color').name('Lampe : couleur').onChange(ch);
    add(fc, R.key, 'intensity', 0, 400, 1).name('Lampe : intensité').onChange(ch);
    add(fc, R.key, 'x', -0.6, 0.6, 0.01).name('Lampe : décalage x').onChange(ch);
    add(fc, R.key, 'y', -0.6, 0.6, 0.01).name('Lampe : décalage y').onChange(ch);
    add(fc, R.key, 'angle', 0.2, 1.2, 0.01).name('Lampe : ouverture').onChange(ch);
    add(fc, R.key, 'penumbra', 0, 1, 0.01).name('Lampe : pénombre').onChange(ch);
    add(fc, R.env, 'preset', opts(ENV_PRESETS)).name('Studio').onChange(() => on.envChanged());
    add(fc, R.env, 'intensity', 0, 3, 0.01).name('Studio : intensité').onChange(ch);
    add(fc, R.env, 'rotation', 0, Math.PI * 2, 0.01).name('Studio : rotation').onChange(ch);
    buildLayers();
  }

  // ── Couches ──
  let layerFolders = [];
  function buildLayers() {
    const R = getRecipe();
    for (const f of layerFolders) f.destroy();
    layerFolders = [];
    const actions = { add: () => on.addLayer(), remove: () => on.removeLayer() };
    const fa = layerRoot.addFolder('Nombre de couches');
    fa.add(actions, 'add').name('+ Ajouter une couche');
    fa.add(actions, 'remove').name('− Retirer la dernière');
    layerFolders.push(fa);
    R.layers.forEach((L, i) => {
      const T = TYPES[L.type];
      const f = layerRoot.addFolder(`${i + 1}. ${T.label} · ${SETS[L.set]?.label ?? 'sur mesure'}`).close();
      layerFolders.push(f);
      const geo = () => on.layerGeometry(i);
      const mat = () => on.layerMaterial(i);
      const act = { type: L.type, set: L.set, reroll: () => on.layerReroll(i), axis: () => on.layerAxis(i) };
      f.add(act, 'type', opts(TYPES)).name('Type').onChange((t) => on.layerType(i, t));
      f.add(act, 'reroll').name('⟳  Autre forme');
      const fg = f.addFolder('Forme').close();
      const g = L.geo;
      for (const [k, label, o] of T.selects || []) fg.add(g, k, o).name(label).onChange(geo);
      for (const [k, label] of T.toggles || []) fg.add(g, k).name(label).onChange(geo);
      for (const [k, label, a, b, s] of [...(T.params || []), ...P.common]) if (g[k] !== undefined) fg.add(g, k, a, b, s).name(label).onFinishChange(geo);
      if (g.chamfer !== undefined && !T.noChamfer) fg.add(g, 'chamfer').name('Chanfrein plat').onChange(geo);
      if (T.holes) {
        const fh = f.addFolder('Trous et usinage').close();
        fh.add(g, 'shape', HOLE_SHAPES).name('Forme des trous').onChange(geo);
        for (const [k, label, a, b, st] of [...P.holes, ...P.machining]) if (g[k] !== undefined) fh.add(g, k, a, b, st).name(label).onFinishChange(geo);
        if (g.setting !== undefined) fh.add(g, 'setting', SETTINGS).name('Jonctions').onChange(() => { geo(); on.layerGeometry(i, true); });
      }
      if (g.iris) {
        const fi = f.addFolder('Diaphragme de l’oculus').close();
        for (const [k, label, a, b, st] of IRIS_PARAMS) fi.add(g.iris, k, a, b, st).name(label).onFinishChange(geo);
      }

      const fm = f.addFolder('Matériaux').close();
      fm.add(act, 'set', opts(SETS)).name('Jeu de matériaux').onChange((s) => on.layerSet(i, s));
      fm.add(L.finish, 'wear', 0, 1, 0.01).name('Usure des bords').onChange(mat);
      if (L.geo.burst) fm.add(L.finish, 'seam', 0, 0.3, 0.005).name('Filet d’or des cassures').onChange(mat);
      if (L.finish.groove !== undefined && !T.noGroove) {
        fm.add(L.finish, 'groove', 0, 1, 0.01).name('Gravure').onChange(mat);
        fm.add(L.finish, 'grooveAt', 0.1, 0.9, 0.01).name('Gravure : position').onChange(mat);
      }
      for (const [side, label] of [['outer', 'Face externe'], ['inner', 'Face interne'], ['edge', 'Tranche et biseaux']]) {
        const F = L.finish[side];
        const fs = fm.addFolder(`${label} · ${F.label}`).close();
        const sel = { preset: F.preset };
        fs.add(sel, 'preset', opts(FINISHES)).name('Finition').onChange((k) => {
          Object.assign(F, { ...FINISH_DEFAULTS, ...FINISHES[k], preset: k });
          fs.title(`${label} · ${F.label}`);
          fs.controllersRecursive().forEach((c) => c.updateDisplay());
          mat();
        });
        fs.add(F, 'pattern', ['plain', 'brushed', 'hammered', 'glaze', 'weave', 'rock', 'glitter', 'nacre', 'oxide', 'velvet', 'agate', 'patina']).name('Motif').onChange(mat);
        fs.addColor(F, 'color').name('Couleur').onChange(mat);
        fs.addColor(F, 'color2').name('Couleur 2').onChange(mat);
        for (const [k, l2, a, b, s] of FIN) fs.add(F, k, a, b, s).name(l2).onChange(mat);
        fs.addColor(F, 'sheenColor').name('Couleur du lustre').onChange(mat);
      }
      if (g.setting === 'gem' && L.gem) {
        const fj = fm.addFolder('Pierres serties').close();
        const pick = { preset: '' };
        fj.add(pick, 'preset', opts(GEMS)).name('Pierre').onChange((k) => { Object.assign(L.gem, GEMS[k]); fj.controllersRecursive().forEach((c) => c.updateDisplay()); mat(); });
        fj.addColor(L.gem, 'color').name('Teinte').onChange(mat);
        fj.add(L.gem, 'ior', 1.4, 2.5, 0.01).name('Indice').onChange(mat);
        fj.add(L.gem, 'dispersion', 0, 1.5, 0.01).name('Dispersion (feu)').onChange(mat);
        fj.add(L.gem, 'depth', 0.05, 3, 0.01).name('Transparence').onChange(mat);
      }
      if (g.crystals !== undefined) {
        const fk = fm.addFolder('Cristaux').close();
        fk.addColor(L.crystal, 'tip').name('Pointe').onChange(geo);
        fk.addColor(L.crystal, 'base').name('Pied').onChange(geo);
        fk.add(L.crystal, 'rough', 0, 0.5, 0.005).name('Rugosité').onChange(geo);
        fk.add(L.crystal, 'dispersion', 0, 1, 0.01).name('Dispersion').onChange(geo);
        fk.add(L.crystal, 'ior', 1.3, 2.4, 0.01).name('Indice').onChange(geo);
      }
      const fmo = f.addFolder('Mouvement').close();
      fmo.add(L.motion, 'spin', -4, 4, 1).name('Tours sur l’axe / boucle').onChange(on.recipeChanged);
      fmo.add(L.motion, 'tumble', -3, 3, 1).name('Culbutes / boucle').onChange(on.recipeChanged);
      fmo.add(L.motion, 'phase', 0, Math.PI * 2, 0.01).name('Phase').onChange(on.recipeChanged);
      fmo.add(act, 'axis').name('⟳  Autre axe de culbute');
    });
  }

  // ── Rendu ──
  const rch = () => on.renderChanged();
  const r = render;
  fRender.add(r, 'quality', opts(QUALITY)).name('Qualité').onChange((k) => { on.quality(k); fRender.controllersRecursive().forEach((c) => c.updateDisplay()); });
  fRender.add(r, 'pixelRatio', 0.5, 2, 0.05).name('Résolution (× écran)').onChange(rch);
  fRender.add(r, 'aa', { Temporel: 'traa', SMAA: 'smaa', FXAA: 'fxaa', Aucun: 'none' }).name('Anticrénelage').onChange(rch);
  fRender.add(r, 'shadows', { Basses: 'low', Moyennes: 'medium', Hautes: 'high', 'Très hautes': 'ultra' }).name('Ombres').onChange(rch);
  fRender.add(r, 'detail', 0.5, 2.5, 0.05).name('Détail géométrique').onChange(rch);
  fRender.add(r, 'microDetail', 0, 2, 0.01).name('Micro-relief').onChange(rch);
  fRender.add(r, 'roughFloor', 0, 0.4, 0.005).name('Douceur des reflets').onChange(rch);
  fRender.add(r, 'envFalloff', 0, 1, 0.01).name('Ombre ambiante au centre').onChange(rch);
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
  const fb = fRender.addFolder('Bloom').close();
  fb.add(r, 'bloom').name('Actif').onChange(rch);
  fb.add(r, 'bloomStrength', 0, 2, 0.01).name('Intensité').onChange(rch);
  fb.add(r, 'bloomRadius', 0, 1, 0.01).name('Rayon').onChange(rch);
  fb.add(r, 'bloomThreshold', 0, 4, 0.01).name('Seuil').onChange(rch);
  const fg2 = fRender.addFolder('Rayons du cœur').close();
  fg2.add(r, 'godrays').name('Actifs').onChange(rch);
  fg2.add(r, 'godraysIntensity', 0, 3, 0.01).name('Intensité').onChange(rch);
  fg2.add(r, 'godraysDensity', 0, 2, 0.01).name('Densité').onChange(rch);
  fg2.add(r, 'godraysMax', 0, 1, 0.01).name('Plafond').onChange(rch);
  const fa = fRender.addFolder('Occlusion ambiante').close();
  fa.add(r, 'ao').name('Active').onChange(rch);
  fa.add(r, 'aoStrength', 0, 1, 0.01).name('Intensité').onChange(rch);
  fa.add(r, 'aoRadius', 0.05, 1.5, 0.01).name('Rayon').onChange(rch);
  const fl = fRender.addFolder('Objectif').close();
  fl.add(r, 'motionBlur', 0, 2, 0.01).name('Flou de mouvement').onChange(rch);
  fl.add(r, 'dof').name('Profondeur de champ').onChange(rch);
  fl.add(r, 'focus', 0.1, 2, 0.01).name('Mise au point (× distance)').onChange(rch);
  fl.add(r, 'focusRange', 0.02, 2, 0.01).name('Zone nette').onChange(rch);
  fl.add(r, 'bokeh', 0, 8, 0.05).name('Bokeh').onChange(rch);
  fRender.add({ reset: () => on.resetRender() }, 'reset').name('Réglages par défaut');

  return {
    gui,
    rebuild: buildScene,
    rebuildLayers: buildLayers,
    setFps: (v) => { state.fps = v; fpsCtl.updateDisplay(); },
    refresh: () => gui.controllersRecursive().forEach((c) => c.updateDisplay()),
  };
}
