// Panneau de réglages (lil-gui). Ce module ne connaît que la recette, les
// réglages de rendu et des fonctions de rappel : il ne touche pas à la scène.
import GUI from 'lil-gui';
import { FINISHES, SETS, FINISH_DEFAULTS, PATTERNS } from '../finishes.js';
import { MOODS, ARMATURES, ORDERS, POLYS, STYLES, CUPS, RINGS, HEADS } from '../recipe.js';
import { MEMBRANES } from '../membranes.js';
import { ENV_PRESETS } from '../scene/env.js';
import { QUALITY } from './settings.js';

const opts = (o, label = (v) => v.label) => Object.fromEntries(Object.entries(o).map(([k, v]) => [label(v), k]));

const FIN = [
  ['metal', 'Métal', 0, 1, 0.01], ['rough', 'Rugosité', 0.02, 1, 0.01], ['bump', 'Relief', 0, 2, 0.01], ['scale', 'Échelle du motif', 0.2, 4, 0.01],
  ['aniso', 'Anisotropie', 0, 1, 0.01], ['clearcoat', 'Vernis', 0, 1, 0.01], ['ccRough', 'Rugosité vernis', 0, 0.5, 0.005],
  ['sheen', 'Lustre (velours)', 0, 1, 0.01], ['sheenRough', 'Rugosité lustre', 0, 1, 0.01],
  ['irid', 'Irisation', 0, 1, 0.01], ['iridIOR', 'Indice irisation', 1, 2.5, 0.01], ['iridMin', 'Couche mini (nm)', 0, 1200, 5], ['iridMax', 'Couche maxi (nm)', 0, 1200, 5],
  ['smudge', 'Traces de doigts', 0, 1, 0.01],
];

// Aspect de la membrane : [clé, libellé, min, max, pas] ou [clé, libellé, 'color']
const LOOK = [
  ['Matière', [
    ['scatter', 'Couleur diffusée', 'color'], ['absorb', 'Couleur transmise', 'color'], ['density', 'Densité (opacité)', 0, 4, 0.01],
    ['clarity', 'Netteté au travers', 0, 1, 0.01], ['blur', 'Flou au travers', 0, 1, 0.01], ['refract', 'Réfraction', 0, 0.08, 0.001],
    ['mottle', 'Irrégularité d’épaisseur', 0, 1.5, 0.01], ['mottleScale', 'Irrégularité : échelle', 0.2, 4, 0.01],
  ]],
  ['Translucidité', [
    ['sss', 'Translucidité', 0, 4, 0.01], ['sssColor', 'Couleur de la lumière traversante', 'color'], ['sssPower', 'Concentration', 0.5, 8, 0.01], ['sssDistort', 'Distorsion', 0, 1, 0.01],
  ]],
  ['Surface', [
    ['rough', 'Rugosité', 0.02, 1, 0.01], ['spec', 'Spéculaire', 0, 1, 0.01], ['wet', 'Film humide', 0, 1, 0.01], ['wetRough', 'Film : rugosité', 0, 0.3, 0.001],
    ['wetWave', 'Film : ondulation', 0, 2, 0.01], ['sheen', 'Lustre', 0, 1, 0.01], ['sheenColor', 'Lustre : couleur', 'color'], ['sheenRough', 'Lustre : rugosité', 0, 1, 0.01],
    ['irid', 'Irisation', 0, 1, 0.01], ['iridIOR', 'Irisation : indice', 1, 2.4, 0.01], ['iridNm', 'Film : épaisseur (nm)', 50, 1200, 1],
    ['metal', 'Feuille de métal', 0, 1, 0.01], ['metalColor', 'Métal : couleur', 'color'],
  ]],
  ['Vaisseaux, fibres, plis', [
    ['vessels', 'Vaisseaux', 0, 2, 0.01], ['vesselColor', 'Sang (absorption)', 'color'], ['vesselRelief', 'Vaisseaux : relief', 0, 2, 0.01], ['capillary', 'Capillaires', 0, 2, 0.01],
    ['fibers', 'Fibres', 0, 2, 0.01], ['fiberScale', 'Fibres : échelle', 0.3, 4, 0.01], ['wrinkles', 'Plis de compression', 0, 2, 0.01],
  ]],
  ['Tension et lèvres', [
    ['whiten', 'Blanchiment sous tension', 0, 1, 0.01], ['whitenColor', 'Blanchiment : couleur', 'color'], ['edgeWhite', 'Blanchiment des bords', 0, 1, 0.01],
    ['lipDensity', 'Épaisseur optique des lèvres', 0, 8, 0.01], ['lipColor', 'Couleur des lèvres', 'color'],
  ]],
];
// Comportement (nouvelle simulation)
const PHYS = [
  ['thick', 'Épaisseur', 0.002, 0.05, 0.001], ['pre', 'Précontrainte', 0, 0.15, 0.001], ['stretch', 'Souplesse (étirement)', 1e-7, 4e-5, 1e-7],
  ['bend', 'Souplesse (flexion)', 1e-6, 2e-3, 1e-6], ['strength', 'Résistance (allongement à la rupture)', 0.02, 1.2, 0.005], ['strengthVar', 'Hétérogénéité', 0, 0.9, 0.01],
  ['init', 'Amorce au pôle', 0, 0.9, 0.01], ['curl', 'Enroulement des lèvres', 0, 0.9, 0.01], ['curlWidth', 'Enroulement : largeur', 0.01, 0.2, 0.001],
  ['curlKick', 'Enroulement : impulsion', 0, 2, 0.01], ['curlSign', 'Sens (1 : dehors, −1 : dedans)', -1, 1, 2], ['damping', 'Viscosité', 0, 8, 0.01],
  ['drag', 'Résistance de l’air', 0, 30, 0.1], ['flutter', 'Frémissement des lambeaux', 0, 10, 0.1], ['leak', 'Fuite de la pression (s)', 0.01, 2, 0.01],
  ['friction', 'Adhérence aux lames', 0, 1, 0.01], ['lip', 'Épaisseur des lèvres', 0.5, 4, 0.01],
  ['fibrils', 'Filaments (densité)', 0, 1, 0.01], ['fibPer', 'Filaments par point', 1, 4, 1], ['fibSnap', 'Filaments : allongement avant claquage', 0.005, 0.4, 0.001],
  ['fibRadius', 'Filaments : rayon', 0.0004, 0.01, 0.0001], ['warp', 'Tracé : irrégularité', 0, 0.5, 0.005], ['warpScale', 'Tracé : échelle', 0.5, 8, 0.01],
  ['branch', 'Embranchements', 0, 2, 0.01], ['sectors', 'Épines : coupures par pointe', 2, 7, 1],
  ['peel', 'Retroussement des lambeaux', 0, 15, 0.1], ['fatigue', 'Fatigue (tout finit par céder)', 0, 0.98, 0.01], ['relax', 'Relaxation des lambeaux', 0, 20, 0.1],
  ['unzip', 'Dégrafage de l’avant (vitesse, 0 : non)', 0, 3, 0.01], ['unzipDelay', 'Dégrafage : délai', 0, 0.6, 0.01],
];
// Armature (nouvelle simulation)
const ARM = {
  common: [['struggle', 'Assauts avant la rupture', 0, 6, 1], ['strAmp', 'Assauts : force', 0.05, 0.8, 0.01], ['strFrac', 'Assauts : part du déploiement', 0.1, 0.8, 0.01], ['dur', 'Durée du déploiement', 0.2, 0.95, 0.01], ['stagger', 'Décalage entre pièces', 0, 0.4, 0.01], ['jitter', 'Irrégularité des angles', 0, 0.4, 0.01], ['thick', 'Épaisseur', 0.01, 0.06, 0.001]],
  calyx: [['rows', 'Rangs de lames (feuilleté)', 1, 3, 1], ['n', 'Lames', 2, 10, 1], ['width', 'Largeur', 0.5, 0.99, 0.01], ['tip', 'Pointe', 0.05, 0.8, 0.01], ['hinge', 'Charnière (°)', 95, 140, 1], ['angle', 'Ouverture (°)', 40, 150, 1], ['ridge', 'Nervure', 0, 3, 0.01]],
  iris: [['n', 'Lames', 3, 12, 1], ['width', 'Largeur', 0.5, 0.99, 0.01], ['tip', 'Pointe', 0.05, 0.8, 0.01], ['hinge', 'Charnière (°)', 95, 140, 1], ['angle', 'Ouverture (°)', 40, 150, 1], ['twist', 'Vrille', -2, 2, 0.01], ['tilt', 'Axe : de la tangente (0) au rayon (1,57)', 0, 1.57, 0.01], ['swell', 'Gonflement', 0, 0.4, 0.01], ['ridge', 'Nervure', 0, 3, 0.01]],
  pod: [['n', 'Mâchoires', 2, 4, 1], ['width', 'Largeur', 0.6, 0.99, 0.01], ['tip', 'Pointe', 0.02, 0.6, 0.01], ['hinge', 'Charnière (°)', 100, 145, 1], ['angle', 'Ouverture (°)', 40, 150, 1], ['ridge', 'Nervure', 0, 3, 0.01]],
  ribs: [['n', 'Baleines', 4, 24, 1], ['hinge', 'Charnière (°)', 95, 140, 1], ['angle', 'Ouverture (°)', 40, 150, 1]],
  crown: [['headStyle', 'Têtes', HEADS], ['n', 'Épingles', 6, 40, 1], ['head', 'Têtes (× épaisseur)', 0.6, 3, 0.01], ['hinge', 'Couronne (°)', 95, 140, 1], ['spread', 'Étendue (°)', 30, 90, 1], ['ext', 'Coulissement', 0.02, 0.4, 0.01], ['angle', 'Ouverture (°)', 0, 120, 1]],
  claws: [['n', 'Serres', 3, 9, 1], ['hinge', 'Charnière (°)', 100, 135, 1], ['angle', 'Ouverture (°)', 40, 150, 1], ['claw', 'Épaisseur des serres', 0.5, 2, 0.01], ['hook', 'Crochet', 0, 1, 0.01], ['reach', 'Portée (° du pôle)', 4, 30, 1]],
  cage: [['poly', 'Polyèdre', POLYS], ['inflate', 'Gonflement de la membrane (× pression)', 0, 5, 0.01]],
};

function finishFolders(parent, finish, onChange, labels = ['Faces externes', 'Faces internes', 'Tranches et charnières']) {
  ['outer', 'inner', 'edge'].forEach((side, i) => {
    const F = finish[side];
    const label = labels[i];
    const fs = parent.addFolder(`${label} · ${F.label}`).close();
    const sel = { preset: F.preset };
    fs.add(sel, 'preset', opts(FINISHES)).name('Finition').onChange((k) => {
      Object.assign(F, { ...FINISH_DEFAULTS, ...FINISHES[k], preset: k });
      fs.title(`${label} · ${F.label}`);
      fs.controllersRecursive().forEach((c) => c.updateDisplay());
      onChange();
    });
    fs.add(F, 'pattern', PATTERNS).name('Motif').onChange(onChange);
    fs.addColor(F, 'color').name('Couleur').onChange(onChange);
    fs.addColor(F, 'color2').name('Couleur 2').onChange(onChange);
    for (const [k, l2, a, b, s] of FIN) fs.add(F, k, a, b, s).name(l2).onChange(onChange);
    fs.addColor(F, 'sheenColor').name('Couleur du lustre').onChange(onChange);
  });
}

export function createUI({ recipe: getRecipe, render, on, nest }) {
  const gui = new GUI({ title: 'Membrane', width: 340 });
  gui.domElement.id = 'gui';
  const state = { fps: '' };

  const top = { seed: '', random: () => on.random(), link: () => on.copyLink(), pause: () => on.togglePause() };
  gui.add(top, 'seed').name('Graine').onFinishChange((v) => on.regenerate(v));
  gui.add(top, 'random').name('⟳  Nouvelle scène  (N)');
  gui.add(top, 'link').name('Copier le lien de cette scène');
  gui.add(top, 'pause').name('Pause / lecture  (espace)');
  const fpsCtl = gui.add(state, 'fps').name('Images / s').disable();

  const exp = { width: 1920, height: 1080, fps: 60, mbps: 40, go: () => on.exportVideo({ ...exp }), png: () => on.exportPNG() };
  const fExp = gui.addFolder('Export').close();
  fExp.add(exp, 'width', { '1280': 1280, '1920': 1920, '2560': 2560, '3840': 3840, '1080 (carré)': 1080 }).name('Largeur');
  fExp.add(exp, 'height', { '720': 720, '1080': 1080, '1440': 1440, '2160': 2160, '1920 (vertical)': 1920 }).name('Hauteur');
  fExp.add(exp, 'fps', [24, 30, 50, 60]).name('Images / s');
  fExp.add(exp, 'mbps', 8, 120, 1).name('Débit (Mb/s)');
  fExp.add(exp, 'go').name('Exporter la boucle (MP4)');
  fExp.add(exp, 'png').name('Image (PNG)');

  const fScene = gui.addFolder('Scène');
  const fChor = gui.addFolder('Plongée et chorégraphie').close();
  const fCam = gui.addFolder('Caméra').close();
  const fLevels = gui.addFolder('Couches').close();
  const fSim = gui.addFolder('Simulation').close();
  const fLight = gui.addFolder('Lumière et fond').close();
  const fRender = gui.addFolder('Rendu').close();

  let ctls = [], levelFolders = [];
  function buildScene() {
    const R = getRecipe();
    top.seed = R.seed;
    gui.controllers.forEach((c) => c.updateDisplay());
    for (const c of ctls) c.destroy();
    ctls = [];
    const add = (f, o, k, ...a) => { const c = f.add(o, k, ...a); ctls.push(c); return c; };
    const addC = (f, o, k) => { const c = f.addColor(o, k); ctls.push(c); return c; };
    const ch = () => on.recipeChanged();

    add(fScene, R, 'mood', opts(MOODS)).name('Humeur (nouvelle scène)').onChange(() => on.moodChanged());
    add(fScene, { n: R.levels.length }, 'n', 1, 6, 1).name('Couches différentes (nouvelle scène)').onFinishChange((n) => on.levelsChanged(n));
    add(fScene, R.loop, 'beat', 3, 30, 0.1).name('Durée par couche (s)').onChange(ch);

    add(fChor, R.nest, 'ratio', 0.3, 0.65, 0.01).name('Rapport entre couches').onFinishChange(() => on.resim());
    add(fChor, R.nest, 'open', 0.8, 3, 0.01).name('Début de l’éclosion (profondeur)').onChange(ch);
    add(fChor, R.nest, 'end', -1.5, 0.5, 0.01).name('Fin de l’éclosion (profondeur)').onChange(ch);
    R.nest.spin ??= 0.3;
    add(fChor, R.nest, 'spin', -1.5, 1.5, 0.01).name('Rotation en approchant').onChange(ch);
    add(fChor, R.chor, 'slow', -0.6, 0.95, 0.01).name('Ralenti à la déchirure').onChange(ch);
    add(fChor, R.chor, 'width', 0.1, 0.5, 0.01).name('Ralenti : durée').onChange(ch);
    add(fChor, R.chor, 'at', 0, 2.5, 0.01).name('Ralenti : profondeur').onChange(ch);

    const K = R.camera;
    add(fCam, K, 'fov', 15, 80, 0.5).name('Champ (°)').onChange(ch);
    add(fCam, K, 'sway', 0, 2, 0.01).name('Balancement').onChange(ch);
    add(fCam, K, 'roll', -Math.PI, Math.PI, 0.01).name('Roulis').onChange(ch);
    add(fCam, K, 'rollTurns', -2, 2, 1).name('Tours de roulis / boucle').onChange(ch);
    add(fCam, on.camState, 'free').name('Caméra libre (souris)').onChange((v) => on.freeCam(v));

    const S = R.sim, rs = () => on.resim();
    add(fSim, S, 'res', 16, 72, 1).name('Finesse du maillage').onFinishChange(rs);
    add(fSim, S, 'frames', 40, 200, 1).name('Images enregistrées').onFinishChange(rs);
    add(fSim, S, 'substeps', 4, 24, 1).name('Sous-pas par image').onFinishChange(rs);
    add(fSim, S, 'duration', 0.8, 6, 0.01).name('Durée physique (s)').onFinishChange(rs);
    add(fSim, S, 'settle', 20, 200, 1).name('Mise en place (images)').onFinishChange(rs);
    S.iters ??= 4;
    add(fSim, S, 'iters', 2, 12, 2).name('Passes de résolution').onFinishChange(rs);
    add(fSim, { info: () => { const t = nest.templates.map((t, i) => t.info ? `${i + 1} : ${t.info.particles} particules, ${t.info.broken}/${t.info.bonds} liens rompus, préparation ${t.info.prepMs} ms, GPU ${t.info.gpuMs} ms` : `${i + 1} : …`); alert(t.join('\n')); } }, 'info').name('Statistiques');

    buildLevels();
    buildLight();
  }

  function buildLevels() {
    const R = getRecipe();
    for (const f of levelFolders) f.destroy();
    levelFolders = [];
    R.levels.forEach((lv, i) => {
      const f = fLevels.addFolder(`${i + 1} · ${ARMATURES[lv.arm.kind]?.label} · ${MEMBRANES[lv.membrane]?.label ?? '—'}`).close();
      levelFolders.push(f);
      const act = { kind: lv.arm.kind, mem: lv.membrane, reroll: () => on.rerollLevel(i) };
      f.add(act, 'reroll').name('⟳  Autre tirage de cette couche');
      // armature
      const fa = f.addFolder('Armature').close();
      fa.add(act, 'kind', opts(ARMATURES)).name('Nature').onChange((k) => on.armKind(i, k));
      const rs = () => on.resim(i);
      for (const [k, l, a, b, s] of [...ARM[lv.arm.kind], ...ARM.common]) {
        if (typeof a === 'object') fa.add(lv.arm, k, a).name(l).onChange(rs);
        else fa.add(lv.arm, k, a, b, s).name(l).onFinishChange(rs);
      }
      if (lv.arm.kind !== 'cage') fa.add(lv.arm, 'order', ORDERS).name('Ordre d’ouverture').onChange(rs);
      lv.arm.style ??= 0; lv.arm.cup ??= 'smooth'; lv.arm.ringStyle ??= 'torus'; lv.arm.alternate ??= false;
      fa.add(lv.arm, 'style', STYLES).name('Allure').onChange(rs);
      fa.add(lv.arm, 'cup', CUPS).name('Coupe (socle)').onChange(rs);
      fa.add(lv.arm, 'ringStyle', RINGS).name('Couronne de charnières').onChange(rs);
      fa.add(lv.arm, 'alternate').name('Matériaux alternés').onChange(rs);
      fa.add({ s: () => { lv.arm.seed = Math.floor(Math.random() * 1e6); rs(); } }, 's').name('⟳  Autre orientation');
      const fm = fa.addFolder('Matériaux').close();
      fm.add({ set: lv.armSet }, 'set', opts(SETS)).name('Jeu de matériaux').onChange((s) => on.armSet(i, s));
      fm.add(lv.armFinish, 'wear', 0, 1, 0.01).name('Usure').onChange(() => on.look(i));
      finishFolders(fm, lv.armFinish, () => on.look(i));
      if (lv.accentFinish) {
        const fs2 = fa.addFolder('Matériaux du socle (second jeu)').close();
        fs2.add({ set: lv.accentSet }, 'set', opts(SETS)).name('Jeu de matériaux').onChange((s2) => on.accentSet(i, s2));
        finishFolders(fs2, lv.accentFinish, () => on.look(i));
      }
      // membrane
      const fmb = f.addFolder('Membrane : aspect').close();
      fmb.add(act, 'mem', opts(MEMBRANES)).name('Matière (nouvelle simulation)').onChange((k) => on.membrane(i, k));
      for (const [title, list] of LOOK) {
        const g = fmb.addFolder(title).close();
        for (const [k, l, a, b, s] of list) {
          if (a === 'color') g.addColor(lv.look, k).name(l).onChange(() => on.look(i));
          else g.add(lv.look, k, a, b, s).name(l).onChange(() => on.look(i));
        }
      }
      const fp = f.addFolder('Membrane : comportement (simulation)').close();
      for (const [k, l, a, b, s] of PHYS) fp.add(lv.phys, k, a, b, s).name(l).onFinishChange(rs);
      const fo = f.addFolder('Mouvement').close();
      fo.add(lv.motion, 'roll', 0, Math.PI * 2, 0.01).name('Orientation (dans la coupe)');
    });
  }

  let lightCtls = [];
  function buildLight() {
    const R = getRecipe();
    for (const c of lightCtls) c.destroy();
    lightCtls = [];
    const add = (o, k, ...a) => { const c = fLight.add(o, k, ...a); lightCtls.push(c); return c; };
    const addC = (o, k) => { const c = fLight.addColor(o, k); lightCtls.push(c); return c; };
    add(R.env, 'preset', opts(ENV_PRESETS)).name('Studio (reflets)').onChange(() => on.envChanged());
    add(R.env, 'intensity', 0, 3, 0.01).name('Studio : intensité');
    add(R.env, 'rotation', 0, Math.PI * 2, 0.01).name('Studio : rotation');
    addC(R.key, 'color').name('Lampe : couleur');
    add(R.key, 'intensity', 0, 6, 0.01).name('Lampe : intensité');
    add(R.key, 'x', -1.5, 1.5, 0.01).name('Lampe : décalage horizontal');
    add(R.key, 'y', -1.5, 1.5, 0.01).name('Lampe : décalage vertical');
    add(R.key, 'angle', 0.15, 1.2, 0.01).name('Lampe : ouverture');
    add(R.key, 'soft', 0, 12, 0.1).name('Lampe : douceur des ombres');
    addC(R.back, 'color').name('Contre-jour : couleur');
    add(R.back, 'intensity', 0, 10, 0.01).name('Contre-jour : intensité');
    add(R.back, 'x', -1.5, 1.5, 0.01).name('Contre-jour : décalage horizontal');
    add(R.back, 'y', -1.5, 1.5, 0.01).name('Contre-jour : décalage vertical');
    add(R.back, 'angle', 0.1, 1.2, 0.01).name('Contre-jour : ouverture');
    add(R.back, 'soft', 0, 12, 0.1).name('Contre-jour : douceur des ombres');
    addC(R.core, 'color').name('Cœur : couleur');
    add(R.core, 'intensity', 0, 1, 0.001).name('Cœur : lumière');
    add(R.core, 'decay', 0, 2, 0.01).name('Cœur : atténuation');
    add(R.core, 'glow', 0, 20, 0.1).name('Cœur : éclat');
    addC(R, 'bg').name('Fond');
    add(R.fog, 'near', 0.5, 8, 0.01).name('Brume : début');
    add(R.fog, 'far', 1, 20, 0.01).name('Brume : fin');
  }

  // ── Rendu ──
  const rch = () => on.renderChanged();
  const r = render;
  fRender.add(r, 'quality', opts(QUALITY)).name('Qualité').onChange((k) => { on.quality(k); fRender.controllersRecursive().forEach((c) => c.updateDisplay()); });
  fRender.add(r, 'pixelRatio', 0.5, 2, 0.05).name('Résolution (× écran)').onChange(rch);
  fRender.add(r, 'aa', { Temporel: 'traa', SMAA: 'smaa', FXAA: 'fxaa', Aucun: 'none' }).name('Anticrénelage').onChange(rch);
  fRender.add(r, 'shadows', { Basses: 'low', Moyennes: 'medium', Hautes: 'high', 'Très hautes': 'ultra' }).name('Ombres').onChange(rch);
  const fm = fRender.addFolder('Membranes').close();
  fm.add(r, 'detail').name('Maillage fin des couches proches').onChange(rch);
  fm.add(r, 'backdrop').name('Voir au travers (copie par couche)').onChange(rch);
  fm.add(r, 'backdropBlur', 0, 2, 0.01).name('Flou au travers (×)').onChange(rch);
  fm.add(r, 'grazing', 0, 1, 0.01).name('Silhouettes (épaisseur rasante)').onChange(rch);
  fm.add(r, 'sssBoost', 0, 3, 0.01).name('Translucidité (×)').onChange(rch);
  fm.add(r, 'armEnv', 0, 1, 0.01).name('Studio vu de l’intérieur').onChange(rch);
  fm.add(r, 'microDetail', 0, 2, 0.01).name('Micro-relief').onChange(rch);
  fm.add(r, 'roughFloor', 0, 0.4, 0.005).name('Douceur des reflets').onChange(rch);
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
  const fa = fRender.addFolder('Occlusion ambiante').close();
  fa.add(r, 'ao').name('Active').onChange(rch);
  fa.add(r, 'aoStrength', 0, 1, 0.01).name('Intensité').onChange(rch);
  fa.add(r, 'aoRadius', 0.05, 1.5, 0.01).name('Rayon').onChange(rch);
  const fx = fRender.addFolder('Reflets').close();
  fx.add(r, 'ssr').name('Reflets réels (espace écran)').onChange(rch);
  fx.add(r, 'ssrIntensity', 0, 2, 0.01).name('Intensité').onChange(rch);
  fx.add(r, 'ssrQuality', 0.1, 1, 0.01).name('Qualité').onChange(rch);
  fx.add(r, 'ssrRes', { Demi: 0.5, Pleine: 1 }).name('Résolution').onChange(rch);
  fx.add(r, 'ssrDistance', 0.2, 6, 0.05).name('Portée').onChange(rch);
  fx.add(r, 'ssrThickness', 0.005, 0.3, 0.005).name('Épaisseur').onChange(rch);
  const fl = fRender.addFolder('Objectif').close();
  fl.add(r, 'motionBlur', 0, 2, 0.01).name('Flou de mouvement').onChange(rch);
  fl.add(r, 'dof').name('Profondeur de champ').onChange(rch);
  fl.add(r, 'focus', 0.1, 2, 0.01).name('Mise au point').onChange(rch);
  fl.add(r, 'focusRange', 0.02, 2, 0.01).name('Zone nette').onChange(rch);
  fl.add(r, 'bokeh', 0, 8, 0.05).name('Bokeh').onChange(rch);
  fl.add(r, 'streaks', 0, 2, 0.01).name('Traînées anamorphiques').onChange(rch);
  fl.add(r, 'streakLen', 1, 16, 0.1).name('Traînées : longueur').onChange(rch);
  fl.add(r, 'halation', 0, 1.5, 0.01).name('Halation').onChange(rch);
  fl.add(r, 'dirt', 0, 2, 0.01).name('Poussière sur la lentille').onChange(rch);
  fRender.add({ reset: () => on.resetRender() }, 'reset').name('Réglages par défaut');

  return {
    gui,
    rebuild: buildScene,
    rebuildLevels: buildLevels,
    setFps: (v) => { state.fps = v; fpsCtl.updateDisplay(); },
    refresh: () => gui.controllersRecursive().forEach((c) => c.updateDisplay()),
  };
}
