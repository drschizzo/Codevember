// Panneau de réglages (lil-gui). Ce module ne connaît que la recette, les
// réglages de rendu et des fonctions de rappel : il ne touche pas à la scène.
import GUI from 'lil-gui';
import { FINISHES, SETS, FINISH_DEFAULTS, PATTERNS } from '../finishes.js';
import {
  MOODS, KINDS, FACE_KINDS, CONTENT_TYPES, FRAME_STYLES, NODE_STYLES, HOLE_SHAPES, HOLE_GRADS, NET_SHAPES, FLOORS, GEMS, STUD_MODES, LEAD_PATTERNS, RIPPLE_SOURCES, VIEW_DEFAULTS,
} from '../recipe.js';
import { CELL_NAMES, moveLabel } from '../math4.js';
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

// trois finitions d'une pièce (externe, interne, tranche)
function finishFolders(parent, finish, onChange, labels = ['Face externe', 'Face interne', 'Tranche et chanfreins']) {
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
    fs.addColor(F, 'color2').name('Couleur 2 / teinte du verre').onChange(onChange);
    for (const [k, l2, a, b, s] of FIN) fs.add(F, k, a, b, s).name(l2).onChange(onChange);
    fs.addColor(F, 'sheenColor').name('Couleur du lustre').onChange(onChange);
  });
}

export function createUI({ recipe: getRecipe, render, on }) {
  const gui = new GUI({ title: 'Tesseract', width: 330 });
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
  const fVoy = gui.addFolder('Voyage intérieur');
  const fView = gui.addFolder('Lisibilité et intérieur').close();
  const fChor = gui.addFolder('Chorégraphie').close();
  const fProj = gui.addFolder('Projection 4D').close();
  const fCam = gui.addFolder('Caméra').close();
  const fFrame = gui.addFolder('Ossature').close();
  const fCells = gui.addFolder('Cellules').close();
  const fLight = gui.addFolder('Lumière et plateau').close();
  const fRender = gui.addFolder('Rendu').close();

  let ctls = [], cellFolders = [], frameFolders = [];
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
    add(fScene, R.loop, 'duration', 6, 120, 1).name('Durée de la boucle (s)').onChange(ch);
    add(fScene, R.net, 'shape', NET_SHAPES).name('Patron déplié').onChange((v) => on.netChanged(v));
    add(fScene, { reroll: () => on.netChanged(R.net.shape) }, 'reroll').name('⟳  Autre patron');
    add(fScene, R, 'moveMode', { 'Quatre pièces (4 quarts de tour)': 'short', 'Toutes les cellules (8 quarts de tour)': 'tour', 'Un seul plan (4 quarts de tour)': 'same', 'Plans mêlés': 'mixed' }).name('Rotations 4D').onChange(() => on.movesChanged());
    add(fScene, { reroll: () => on.movesChanged() }, 'reroll').name(`⟳  Autre séquence (${R.moves.map(moveLabel).join(' · ')})`);

    R.view ??= { ...VIEW_DEFAULTS };
    const V = R.view;
    add(fView, V, 'ghost', 0, 2, 0.01).name('Fantôme de la forme pliée').onChange(ch);
    add(fView, V, 'seams', 0, 2, 0.01).name('Liserés des faces appariées').onChange(ch);
    add(fView, V, 'depth', 0, 2, 0.01).name('Profondeur 4D en couleur').onChange(ch);
    add(fView, render, 'captions').name('Légendes des étapes (L)').listen().onChange(() => on.renderChanged?.());
    add(fView, render, 'analogy').name('Analogie 3D, encart (A)').listen().onChange(() => on.renderChanged?.());
    add(fView, V, 'cutaway', 0, 1, 0.01).name('Coupe côté caméra').onChange(ch);
    add(fView, V, 'practical', 0, 30, 0.1).name('Lumières d’écrin').onChange(ch);
    addC(fView, V, 'practicalColor').name('Lumières d’écrin : teinte').onChange(ch);
    add(fView, V, 'hero', 0, 3, 0.01).name('Lumière de vedette (objets)').onChange(ch);
    add(fView, V, 'dolly', 0, 1, 0.01).name('Rapprochement (plié)').onChange(ch);

    const Vy = R.voyage;
    if (Vy) {
      const vch = () => on.voyageChanged();
      add(fVoy, Vy, 'on').name('Voyage intérieur').onChange(vch);
      add(fVoy, Vy, 'plunge', 1, 10, 0.1).name('Plongée (s)').onChange(vch);
      add(fVoy, Vy, 'dwell', 0.5, 8, 0.1).name('Halte dans chaque pièce (s)').onChange(vch);
      add(fVoy, Vy, 'travel', 1, 10, 0.1).name('Traversée (s)').onChange(vch);
      add(fVoy, Vy, 'surface', 1, 10, 0.1).name('Remontée (s)').onChange(vch);
      add(fVoy, Vy, 'radius', 0.1, 0.6, 0.01).name('Écart à l’axe de la traversée').onChange(ch);
      add(fVoy, Vy, 'orbitR', 0.3, 0.8, 0.01).name('Rayon du tour de l’objet').onChange(ch);
      add(fVoy, Vy, 'fov', 30, 110, 0.5).name('Champ intérieur (°)').onChange(ch);
      add(fVoy, Vy, 'lamp', 0, 4, 0.01).name('Lampe de la caméra').onChange(ch);
      add(fVoy, Vy, 'see', 0, 1, 0.01).name('Parois ajourées (de l’intérieur)').onChange(ch);
      add(fVoy, Vy, 'objScale', 0.12, 0.55, 0.01).name('Taille des objets').onChange(ch);
      add(fVoy, Vy, 'fogNear', 0, 6, 0.01).name('Brouillard : début').onChange(ch);
      add(fVoy, Vy, 'fogFar', 1, 14, 0.01).name('Brouillard : fin').onChange(ch);
    }

    const C = R.chor;
    add(fChor, C, 'open', 0.05, 4, 0.01).name('Pause dépliée').onChange(ch);
    add(fChor, C, 'fold', 0.2, 4, 0.01).name('Pliage').onChange(ch);
    add(fChor, C, 'hold', 0.05, 4, 0.01).name('Pause pliée').onChange(ch);
    add(fChor, C, 'turn', 0.2, 4, 0.01).name('Rotation 4D').onChange(ch);
    add(fChor, C, 'rest', 0.05, 4, 0.01).name('Pause après rotation').onChange(ch);
    add(fChor, C, 'unfold', 0.2, 4, 0.01).name('Dépliage').onChange(ch);
    add(fChor, C, 'stagger', 0, 0.9, 0.01).name('Décalage entre cellules').onChange(ch);
    add(fChor, C, 'antic', 0, 1, 0.01).name('Anticipation / rebond (pliage)').onChange(ch);
    add(fChor, C, 'turnAntic', 0, 1, 0.01).name('Anticipation / rebond (rotation)').onChange(ch);

    const P = R.proj;
    add(fProj, P, 'd', 1.6, 8, 0.01).name('Distance de l’œil 4D').onChange(ch);
    add(fProj, P, 'inflate', 0, 1, 0.01).name('Gonflement (stéréographique)').onChange(ch);
    add(fProj, P, 'inset', 0.8, 1, 0.001).name('Taille des cellules (écart)').onChange(ch);
    if (P.reveal === undefined) P.reveal = 1;
    add(fProj, P, 'reveal', 0, 1, 0.01).name('Ajourer la coque extérieure').onChange(ch);
    if (P.revealLo === undefined) { P.revealLo = -0.5; P.revealHi = 0.85; }
    add(fProj, P, 'revealLo', -1, 1, 0.01).name('Ajourage : début (w)').onChange(ch);
    add(fProj, P, 'revealHi', -1, 1.2, 0.01).name('Ajourage : effacement (w)').onChange(ch);
    add(fProj, P, 'size', 0.4, 1.6, 0.01).name('Taille à l’écran').onChange(ch);
    add(fProj, P, 'framing', 0, 1, 0.01).name('Cadrage automatique').onChange(ch);
    add(fProj, P, 'tiltX', -1.2, 1.2, 0.01).name('Inclinaison avant').onChange(ch);
    add(fProj, P, 'tiltZ', -1.2, 1.2, 0.01).name('Inclinaison latérale').onChange(ch);
    add(fProj, P, 'spin', -2, 2, 1).name('Tours sur lui-même / boucle').onChange(ch);

    const K = R.camera;
    add(fCam, K, 'fov', 12, 70, 0.5).name('Champ (°)').onChange(ch);
    add(fCam, K, 'dist', 0.5, 2.5, 0.01).name('Recul').onChange(ch);
    add(fCam, K, 'elev', -0.2, 1.2, 0.01).name('Hauteur (angle)').onChange(ch);
    add(fCam, K, 'az', -Math.PI, Math.PI, 0.01).name('Azimut').onChange(ch);
    add(fCam, K, 'orbit', -2, 2, 1).name('Tours d’orbite / boucle').onChange(ch);
    add(fCam, K, 'sway', 0, 1, 0.01).name('Balancement').onChange(ch);
    add(fCam, on.camState, 'free').name('Caméra libre (souris)').onChange((v) => on.freeCam(v));

    // ossature
    for (const f of frameFolders) f.destroy();
    frameFolders = [];
    const Fr = R.frame, geoF = () => on.frameGeometry();
    add(fFrame, Fr, 'style', FRAME_STYLES).name('Profil des barres').onChange(geoF);
    add(fFrame, Fr, 'w', 0.02, 0.14, 0.001).name('Épaisseur').onFinishChange(geoF);
    add(fFrame, Fr, 'chamfer', 0, 0.45, 0.01).name('Chanfrein').onFinishChange(geoF);
    add(fFrame, Fr, 'fillet').name('Arêtes arrondies').onChange(geoF);
    add(fFrame, Fr, 'node', NODE_STYLES).name('Nœuds d’angle').onChange(geoF);
    add(fFrame, Fr, 'nodeScale', 0.7, 1.8, 0.01).name('Taille des nœuds').onFinishChange(geoF);
    add(fFrame, { set: Fr.set }, 'set', opts(SETS)).name('Jeu de matériaux').onChange((s) => on.frameSet(s));
    const fm = fFrame.addFolder('Matériaux').close();
    frameFolders.push(fm);
    finishFolders(fm, Fr.finish, () => on.frameMaterial(), ['Plats', 'Faces intérieures (cornière)', 'Chanfreins et nœuds']);

    buildCells();
    buildLight();
  }

  function buildCells() {
    const R = getRecipe();
    for (const f of cellFolders) f.destroy();
    cellFolders = [];
    R.cells.forEach((cell, c) => {
      const f = fCells.addFolder(`${CELL_NAMES[c]} · ${KINDS[cell.kind]?.label ?? '—'} · ${SETS[cell.panelSet]?.label ?? 'sur mesure'}`).close();
      cellFolders.push(f);
      const geo = () => on.cellGeometry(c), mat = () => on.cellMaterial(c);
      const act = { kind: cell.kind, reroll: () => on.cellReroll(c) };
      f.add(act, 'kind', opts(KINDS)).name('Archétype').onChange((k) => on.cellKind(c, k));
      f.add(act, 'reroll').name('⟳  Autre tirage');
      const ff = f.addFolder('Faces').close();
      const FN = ['−a', '+a', '−b', '+b', '−c', '+c'];
      cell.faces.forEach((_, i) => ff.add(cell.faces, i, FACE_KINDS).name(`Face ${FN[i]}`).onChange(geo));
      ff.add(cell, 'panelT', 0.006, 0.06, 0.001).name('Épaisseur des panneaux').onFinishChange(geo);
      ff.add(cell, 'glassT', 0.006, 0.05, 0.001).name('Épaisseur du verre').onFinishChange(geo);
      const fp = f.addFolder('Tôle perforée').close();
      fp.add(cell.perf, 'n', 2, 14, 1).name('Trous par côté').onFinishChange(geo);
      fp.add(cell.perf, 'shape', HOLE_SHAPES).name('Forme').onChange(geo);
      fp.add(cell.perf, 'grad', HOLE_GRADS).name('Répartition').onChange(geo);
      fp.add(cell.perf, 'min', 0, 1, 0.01).name('Trou mini').onFinishChange(geo);
      fp.add(cell.perf, 'max', 0, 1, 0.01).name('Trou maxi').onFinishChange(geo);
      fp.add(cell.perf, 'twist', 0, Math.PI / 2, 0.01).name('Rotation des trous').onFinishChange(geo);
      const fl = f.addFolder('Persiennes et grille').close();
      fl.add(cell.louvre, 'n', 3, 20, 1).name('Lames').onFinishChange(geo);
      fl.add(cell.louvre, 'angle', -1.4, 1.4, 0.01).name('Inclinaison des lames').onFinishChange(geo);
      fl.add(cell.grid, 'n', 3, 20, 1).name('Joncs de la grille').onFinishChange(geo);
      const fo = f.addFolder('Autres panneaux').close();
      fo.add(cell.stud, 'mode', STUD_MODES).name('Relief').onChange(geo);
      fo.add(cell.stud, 'n', 2, 12, 1).name('Relief : nombre par côté').onFinishChange(geo);
      fo.add(cell.stud, 'height', 0.1, 1.2, 0.01).name('Relief : hauteur').onFinishChange(geo);
      fo.add(cell.corr, 'n', 1, 12, 1).name('Ondulations').onFinishChange(geo);
      fo.add(cell.corr, 'amp', 0.05, 0.6, 0.01).name('Ondulations : amplitude').onFinishChange(geo);
      fo.add(cell.leaded, 'pattern', LEAD_PATTERNS).name('Vitrail : réseau').onChange(geo);
      fo.add(cell.leaded, 'n', 1, 8, 1).name('Vitrail : divisions').onFinishChange(geo);
      fo.add(cell.bars, 'n', 3, 20, 1).name('Barreaux').onFinishChange(geo);
      fo.add(cell.bars, 'cross').name('Barreaux : traverse').onChange(geo);
      fo.add(cell.target, 'n', 2, 12, 1).name('Cible : anneaux').onFinishChange(geo);
      fo.add(cell.target, 'fill', 0.1, 0.95, 0.01).name('Cible : largeur des anneaux').onFinishChange(geo);
      const fn = f.addFolder('Motifs : pli, onde, lames, écailles, alvéoles, rosace').close();
      fn.add(cell.miura, 'n', 2, 12, 1).name('Pli Miura : colonnes').onFinishChange(geo);
      fn.add(cell.miura, 'rows', 2, 12, 2).name('Pli Miura : rangées').onFinishChange(geo);
      fn.add(cell.miura, 'h', 0.1, 1.2, 0.01).name('Pli Miura : profondeur').onFinishChange(geo);
      fn.add(cell.miura, 's', 0, 1, 0.01).name('Pli Miura : chevrons').onFinishChange(geo);
      fn.add(cell.ripple, 'src', RIPPLE_SOURCES).name('Onde : source').onChange(geo);
      fn.add(cell.ripple, 'n', 1, 8, 1).name('Onde : cercles').onFinishChange(geo);
      fn.add(cell.ripple, 'amp', 0.05, 1, 0.01).name('Onde : amplitude').onFinishChange(geo);
      fn.add(cell.twist, 'n', 4, 20, 1).name('Lames vrillées : nombre').onFinishChange(geo);
      fn.add(cell.twist, 'twist', -3.2, 3.2, 0.01).name('Lames vrillées : torsion').onFinishChange(geo);
      fn.add(cell.twist, 'ramp', -1.6, 1.6, 0.01).name('Lames vrillées : dégradé').onFinishChange(geo);
      fn.add(cell.twist, 'base', -1.6, 1.6, 0.01).name('Lames vrillées : angle').onFinishChange(geo);
      fn.add(cell.scales, 'n', 2, 10, 1).name('Écailles : par rang').onFinishChange(geo);
      fn.add(cell.scales, 'tilt', 0, 0.8, 0.01).name('Écailles : inclinaison').onFinishChange(geo);
      fn.add(cell.scales, 'dome', 0, 0.4, 0.01).name('Écailles : bombé').onFinishChange(geo);
      fn.add(cell.comb, 'n', 2, 9, 1).name('Alvéoles : par côté').onFinishChange(geo);
      fn.add(cell.comb, 'depth', 0.2, 1.5, 0.01).name('Alvéoles : profondeur').onFinishChange(geo);
      fn.add(cell.comb, 'rot').name('Alvéoles : tournées').onChange(geo);
      fn.add(cell.oculus, 'r', 0.3, 0.9, 0.01).name('Rosace : ouverture').onFinishChange(geo);
      fn.add(cell.oculus, 'spokes', 0, 16, 1).name('Rosace : rayons').onFinishChange(geo);
      fn.add(cell.oculus, 'ring').name('Rosace : remplage').onChange(geo);
      const fm = f.addFolder('Matériaux').close();
      fm.add({ set: cell.panelSet }, 'set', opts(SETS)).name('Jeu des panneaux').onChange((s) => on.cellSet(c, s));
      fm.add(cell.panel, 'wear', 0, 1, 0.01).name('Usure').onChange(mat);
      finishFolders(fm, cell.panel, mat);
      const fv = fm.addFolder('Verre').close();
      fv.addColor(cell.glass.outer, 'color2').name('Teinte').onChange(() => { for (const s of ['inner', 'edge']) cell.glass[s].color2 = cell.glass.outer.color2; mat(); });
      for (const [k, label, a, b, st] of [['rough', 'Dépoli', 0, 0.6, 0.005], ['attDist', 'Absorption', 0.05, 3, 0.01], ['dispersion', 'Dispersion', 0, 1, 0.01], ['ior', 'Indice', 1, 2.4, 0.01], ['smudge', 'Traces', 0, 1, 0.01]]) {
        fv.add(cell.glass.outer, k, a, b, st).name(label).onChange(() => { for (const s of ['inner', 'edge']) cell.glass[s][k] = k === 'rough' && s === 'edge' ? Math.max(0.25, cell.glass.outer[k]) : cell.glass.outer[k]; mat(); });
      }
      const con = cell.content;
      const fc = f.addFolder('Objet exposé').close();
      fc.add(con, 'type', CONTENT_TYPES).name('Objet').onChange(() => { geo(); on.rebuildCells(); });
      fc.add(con, 'size', 0.1, 0.8, 0.01).name('Taille').onFinishChange(geo);
      fc.add(con, 'turns', -4, 4, 1).name('Tours / boucle').onChange(on.recipeChanged);
      fc.add({ axis: () => on.contentAxis(c) }, 'axis').name('⟳  Autre axe');
      if (con.type === 'gem') {
        const pick = { k: con.gem.key };
        fc.add(pick, 'k', opts(GEMS)).name('Pierre').onChange((k) => { Object.assign(con.gem, GEMS[k], { key: k }); fc.controllersRecursive().forEach((x) => x.updateDisplay()); mat(); });
        fc.addColor(con.gem, 'color').name('Teinte').onChange(mat);
        fc.add(con.gem, 'ior', 1.3, 2.5, 0.01).name('Indice').onChange(mat);
        fc.add(con.gem, 'dispersion', 0, 1.5, 0.01).name('Dispersion (feu)').onChange(mat);
        fc.add(con.gem, 'depth', 0.05, 3, 0.01).name('Transparence').onChange(mat);
      } else {
        fc.add({ set: con.set }, 'set', opts(SETS)).name('Jeu de matériaux').onChange((s) => on.contentSet(c, s));
        finishFolders(fc, con.finish, mat, ['Surface', 'Faces internes', 'Détails polis']);
      }
    });
  }

  let lightCtls = [];
  function buildLight() {
    const R = getRecipe();
    for (const c of lightCtls) c.destroy();
    lightCtls = [];
    const add = (o, k, ...a) => { const c = fLight.add(o, k, ...a); lightCtls.push(c); return c; };
    const addC = (o, k) => { const c = fLight.addColor(o, k); lightCtls.push(c); return c; };
    const ch = () => on.recipeChanged();
    add(R.env, 'preset', opts(ENV_PRESETS)).name('Studio (reflets)').onChange(() => on.envChanged());
    add(R.env, 'intensity', 0, 3, 0.01).name('Studio : intensité').onChange(ch);
    add(R.env, 'rotation', 0, Math.PI * 2, 0.01).name('Studio : rotation').onChange(ch);
    addC(R.key, 'color').name('Projecteur : couleur').onChange(ch);
    add(R.key, 'intensity', 0, 2000, 1).name('Projecteur : intensité').onChange(ch);
    add(R.key, 'az', -Math.PI, Math.PI, 0.01).name('Projecteur : azimut').onChange(ch);
    add(R.key, 'el', 0.1, 1.5, 0.01).name('Projecteur : hauteur').onChange(ch);
    add(R.key, 'angle', 0.15, 1.2, 0.01).name('Projecteur : ouverture').onChange(ch);
    add(R.key, 'penumbra', 0, 1, 0.01).name('Projecteur : pénombre').onChange(ch);
    add(R.key, 'soft', 0, 10, 0.1).name('Douceur des ombres').onChange(ch);
    addC(R.rim, 'color').name('Contre-jour : couleur').onChange(ch);
    add(R.rim, 'intensity', 0, 1500, 1).name('Contre-jour : intensité').onChange(ch);
    add(R.rim, 'az', -Math.PI * 1.5, Math.PI * 1.5, 0.01).name('Contre-jour : azimut').onChange(ch);
    addC(R.rim2, 'color').name('Second contre-jour : couleur').onChange(ch);
    add(R.rim2, 'intensity', 0, 1500, 1).name('Second contre-jour : intensité').onChange(ch);
    add(R.floor, 'kind', FLOORS).name('Sol').onChange(ch);
    add(R.floor, 'level', 0.9, 2.5, 0.01).name('Hauteur du sol').onChange(ch);
    addC(R, 'bg').name('Fond').onChange(ch);
    add(R.fog, 'near', 2, 30, 0.1).name('Brume : début').onChange(ch);
    add(R.fog, 'far', 4, 60, 0.1).name('Brume : fin').onChange(ch);
  }

  // ── Rendu ──
  const rch = () => on.renderChanged();
  const r = render;
  fRender.add(r, 'quality', opts(QUALITY)).name('Qualité').onChange((k) => { on.quality(k); fRender.controllersRecursive().forEach((c) => c.updateDisplay()); });
  fRender.add(r, 'pixelRatio', 0.5, 2, 0.05).name('Résolution (× écran)').onChange(rch);
  fRender.add(r, 'aa', { Temporel: 'traa', SMAA: 'smaa', FXAA: 'fxaa', Aucun: 'none' }).name('Anticrénelage').onChange(rch);
  fRender.add(r, 'shadows', { Basses: 'low', Moyennes: 'medium', Hautes: 'high', 'Très hautes': 'ultra' }).name('Ombres').onChange(rch);
  fRender.add(r, 'microDetail', 0, 2, 0.01).name('Micro-relief').onChange(rch);
  fRender.add(r, 'patina', 0, 2, 0.01).name('Patine des parois').onChange(rch);
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
  const fb = fRender.addFolder('Bloom').close();
  fb.add(r, 'bloom').name('Actif').onChange(rch);
  fb.add(r, 'bloomStrength', 0, 2, 0.01).name('Intensité').onChange(rch);
  fb.add(r, 'bloomRadius', 0, 1, 0.01).name('Rayon').onChange(rch);
  fb.add(r, 'bloomThreshold', 0, 4, 0.01).name('Seuil').onChange(rch);
  const fa = fRender.addFolder('Occlusion ambiante').close();
  fa.add(r, 'ao').name('Active').onChange(rch);
  fa.add(r, 'aoStrength', 0, 1, 0.01).name('Intensité').onChange(rch);
  fa.add(r, 'aoRadius', 0.05, 1.5, 0.01).name('Rayon').onChange(rch);
  const fx = fRender.addFolder('Reflets et réfraction').close();
  fx.add(r, 'ssr').name('Reflets réels (espace écran)').onChange(rch);
  fx.add(r, 'ssrIntensity', 0, 2, 0.01).name('Intensité des reflets').onChange(rch);
  fx.add(r, 'ssrQuality', 0.1, 1, 0.01).name('Qualité (pas du rayon)').onChange(rch);
  fx.add(r, 'ssrRes', { 'Demi': 0.5, 'Pleine': 1 }).name('Résolution').onChange(rch);
  fx.add(r, 'ssrDistance', 0.2, 6, 0.05).name('Portée').onChange(rch);
  fx.add(r, 'ssrThickness', 0.005, 0.3, 0.005).name('Épaisseur des parois').onChange(rch);
  fx.add(r, 'ssrBlur', { 'Net': 1, 'Moyen': 2, 'Doux': 3 }).name('Flou des reflets mats').onChange(rch);
  fx.add(r, 'nestEnv', 0, 1, 0.01).name('Studio vu d’une cellule fermée').onChange(rch);
  fx.add(r, 'crystalThick', 0.2, 2, 0.01).name('Épaisseur des cristaux').onChange(rch);
  const fl = fRender.addFolder('Objectif').close();
  fl.add(r, 'motionBlur', 0, 2, 0.01).name('Flou de mouvement').onChange(rch);
  fl.add(r, 'dof').name('Profondeur de champ').onChange(rch);
  fl.add(r, 'focus', 0.5, 1.5, 0.01).name('Mise au point (× distance)').onChange(rch);
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
    rebuildCells: buildCells,
    setFps: (v) => { state.fps = v; fpsCtl.updateDisplay(); },
    refresh: () => gui.controllersRecursive().forEach((c) => c.updateDisplay()),
  };
}
