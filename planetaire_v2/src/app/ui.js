// Panneau de réglages (lil-gui). Ce module ne connaît que la recette, les
// réglages de rendu et des fonctions de rappel : il ne touche pas à la scène.
import GUI from 'lil-gui';
import { MOODS, MATTERS } from '../recipe.js';
import { ENV_PRESETS } from '../scene/env.js';
import { QUALITY, SHADOWS } from './settings.js';
import { symmetryOptions } from '../orbit/symmetry.js';

const opts = (o, label = (v) => v.label) => Object.fromEntries(Object.entries(o).map(([k, v]) => [label(v), k]));
const FRACTIONS = ['0/1', '1/1', '-1/1', '1/2', '-1/2', '1/3', '-1/3', '2/3', '-2/3', '1/4', '-1/4', '3/4', '-3/4', '1/5', '-1/5', '2/5', '-2/5', '3/5', '-3/5', '4/5', '-4/5', '6/5', '-6/5'];

export function createUI({ recipe: getRecipe, render: RENDER, on }) {
  const gui = new GUI({ title: 'Chorégraphies', width: 320 });
  gui.domElement.id = 'gui';
  const state = { fps: '', info: '' };

  // ── En tête ──
  const top = { seed: '', random: () => on.random(), link: () => on.copyLink(), pause: () => on.togglePause() };
  const seedCtl = gui.add(top, 'seed').name('Graine').onFinishChange((v) => on.regenerate(v));
  gui.add(top, 'random').name('⟳  Nouvelle orbite  (N)');
  gui.add(top, 'link').name('Copier le lien de cette scène');
  gui.add(top, 'pause').name('Pause / lecture  (espace)');
  const fpsCtl = gui.add(state, 'fps').name('Images / s').disable();

  // ── Export ──
  const exp = { width: 1920, height: 1080, fps: 30, mbps: 24, go: () => on.exportVideo({ ...exp }), png: () => on.exportPNG() };
  const fExp = gui.addFolder('Export').close();
  fExp.add(exp, 'width', { '1280': 1280, '1920': 1920, '2560': 2560, '3840': 3840, '1080 (carré)': 1080 }).name('Largeur');
  fExp.add(exp, 'height', { '720': 720, '1080': 1080, '1440': 1440, '2160': 2160, '1920 (vertical)': 1920 }).name('Hauteur');
  fExp.add(exp, 'fps', [24, 30, 50, 60]).name('Images / s');
  fExp.add(exp, 'mbps', 8, 120, 1).name('Débit (Mb/s)');
  fExp.add(exp, 'go').name('Exporter la boucle (MP4)  (E)');
  fExp.add(exp, 'png').name('Image (PNG)  (P)');

  const fOrbit = gui.addFolder('Orbite');
  const fScene = gui.addFolder('Scène').close();
  const fMat = gui.addFolder('Matières').close();
  const fBodies = gui.addFolder('Astres').close();
  const fTrace = gui.addFolder('Verre filé').close();
  const fMotion = gui.addFolder('Mise en scène').close();
  const fLight = gui.addFolder('Lumières').close();
  const fRender = gui.addFolder('Rendu').close();

  // ── Recette (reconstruite à chaque nouvelle scène) ──
  let ctls = [];
  function build() {
    const R = getRecipe();
    top.seed = R.seed; seedCtl.updateDisplay();
    for (const c of ctls) c.destroy();
    ctls = [];
    const add = (f, o, k, ...a) => { const c = f.add(o, k, ...a); ctls.push(c); return c; };
    const addC = (f, o, k) => { const c = f.addColor(o, k); ctls.push(c); return c; };
    const live = () => on.recipeChanged();

    // orbite : contraintes du solveur (« auto » : tirées de la graine)
    const o = {
      N: R.orbit.N ? String(R.orbit.N) : 'auto',
      sym: R.orbit.sym === null || R.orbit.sym === undefined ? 'auto' : R.orbit.sym === 'none' ? 'none' : `${R.orbit.sym.m}/${R.orbit.sym.l}${R.orbit.sym.mirror ? 'M' : ''}`,
      omega: R.orbit.omega ? R.orbit.omega.join('/') : 'auto',
    };
    add(fOrbit, o, 'N', { Auto: 'auto', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9' }).name('Corps').onChange((v) => {
      R.orbit.N = v === 'auto' ? null : Number(v);
      R.orbit.sym = null; // (les classes dépendent du nombre de corps)
      build(); on.orbitChanged();
    });
    const symChoices = { Auto: 'auto', Aucune: 'none' };
    if (R.orbit.N) {
      for (const c of symmetryOptions(R.orbit.N)) {
        symChoices[`${c.m} pétales (l = ${c.l})${c.weak ? ' ·  fragile' : ''}`] = `${c.m}/${c.l}`;
        symChoices[`${c.m} pétales (l = ${c.l}), miroir${c.weak ? ' ·  fragile' : ''}`] = `${c.m}/${c.l}M`;
      }
    }
    add(fOrbit, o, 'sym', symChoices).name(R.orbit.N ? 'Symétrie' : 'Symétrie (choisir N)').onChange((v) => {
      if (v === 'auto') R.orbit.sym = null;
      else if (v === 'none') R.orbit.sym = 'none';
      else { const [m, l] = v.replace('M', '').split('/').map(Number); R.orbit.sym = { m, l, mirror: v.endsWith('M') }; }
      on.orbitChanged();
    });
    add(fOrbit, o, 'omega', ['auto', ...FRACTIONS]).name('Plateau (tours / période)').onChange((v) => {
      R.orbit.omega = v === 'auto' ? null : v.split('/').map(Number);
      on.orbitChanged();
    });
    add(fOrbit, state, 'info').name('Orbite trouvée').disable();

    // scène
    add(fScene, R, 'mood', opts(MOODS)).name('Humeur (nouvelle scène)').onChange(() => on.moodChanged());

    // matières
    const mat = opts(MATTERS);
    for (const [k, name] of [['plate', 'Plateau'], ['arms', 'Bras'], ['arms2', 'Bras (alternés)'], ['gears', 'Roues'], ['pins', 'Tenons, goupilles, vis'], ['foot', 'Pied, bâti']]) {
      add(fMat, R.matters, k, mat).name(name).onChange(live);
    }

    // astres
    addC(fBodies, R.bodies, 'color').name('Couleur').onChange(live);
    add(fBodies, R.bodies, 'glow', 0.2, 3, 0.01).name('Éclat').onChange(live);
    add(fBodies, R.bodies, 'flare', 0, 4, 0.01).name('Embrasement aux passages').onChange(live);
    add(fBodies, R.bodies, 'light', 0, 0.5, 0.005).name('Lumière portée').onChange(live);

    // verre filé
    add(fTrace, R.trace, 'show').name('Visible').onChange(live);
    add(fTrace, R.trace, 'cool', 1, 20, 0.1).name('Refroidissement').onChange(live);
    add(fTrace, R.trace, 'thick', 0.3, 3, 0.01).name('Épaisseur (nouvelle scène)').onFinishChange(() => on.rebuild());
    add(fTrace, R.trace, 'glow', 0, 3, 0.01).name('Incandescence').onChange(live);
    addC(fTrace, R.trace, 'glass').name('Verre froid').onChange(live);

    // mise en scène
    add(fMotion, R.motion, 'period', 4, 30, 0.5).name('Durée d’une période (s)').onFinishChange(() => on.motionChanged());
    add(fMotion, R.motion, 'slowmo', 0, 1.4, 0.01).name('Ralentis').onFinishChange(() => on.motionChanged());
    add(fMotion, R.motion, 'shotLength', 3, 20, 0.5).name('Durée des plans (s)').onFinishChange(() => on.motionChanged());
    add(fMotion, R.motion, 'free').name('Caméra libre (souris)').onChange(() => on.motionChanged());

    // lumières
    add(fLight, R.light, 'env', opts(ENV_PRESETS)).name('Studio (reflets)').onChange(live);
    add(fLight, R.light, 'envIntensity', 0, 2, 0.01).name('Intensité du studio').onChange(live);
    addC(fLight, R.light, 'bg').name('Fond').onChange(live);
    addC(fLight, R.light, 'floor').name('Sol').onChange(live);
    addC(fLight, R.light.key, 'color').name('Lampe : couleur').onChange(live);
    add(fLight, R.light.key, 'intensity', 0, 20, 0.1).name('Lampe : intensité').onChange(live);
    addC(fLight, R.light.rim, 'color').name('Contre-jour : couleur').onChange(live);
    add(fLight, R.light.rim, 'intensity', 0, 3, 0.01).name('Contre-jour : intensité').onChange(live);
  }

  // ── Rendu (indépendant de la scène, mémorisé) ──
  const rc = () => on.renderChanged();
  fRender.add(RENDER, 'quality', opts(QUALITY)).name('Qualité').onChange((v) => on.qualityChanged(v));
  fRender.add(RENDER, 'pixelRatio', 0.5, 2, 0.05).name('Résolution').onFinishChange(rc);
  fRender.add(RENDER, 'aa', { SMAA: 'smaa', FXAA: 'fxaa', 'Temporel (TRAA)': 'traa', Aucun: 'none' }).name('Anticrénelage').onChange(rc);
  fRender.add(RENDER, 'shadows', Object.fromEntries(Object.keys(SHADOWS).map((k) => [k, k]))).name('Ombres').onChange(rc);
  fRender.add(RENDER, 'toneMapping', { AgX: 'agx', ACES: 'aces', Neutre: 'neutral' }).name('Tone mapping').onChange(rc);
  fRender.add(RENDER, 'exposure', 0.2, 3, 0.01).name('Exposition').onChange(rc);
  fRender.add(RENDER, 'contrast', 0.6, 1.6, 0.01).name('Contraste').onChange(rc);
  fRender.add(RENDER, 'saturation', 0, 1.6, 0.01).name('Saturation').onChange(rc);
  fRender.add(RENDER, 'warmth', -1, 1, 0.01).name('Chaleur (étalonnage)').onChange(rc);
  fRender.add(RENDER, 'vignette', 0, 1, 0.01).name('Vignettage').onChange(rc);
  fRender.add(RENDER, 'bloom').name('Bloom').onChange(rc);
  fRender.add(RENDER, 'bloomStrength', 0, 0.6, 0.005).name('Bloom : force').onChange(rc);
  fRender.add(RENDER, 'bloomThreshold', 0, 4, 0.01).name('Bloom : seuil').onChange(rc);
  fRender.add(RENDER, 'dof').name('Profondeur de champ').onChange(rc);
  fRender.add(RENDER, 'bokeh', 0, 4, 0.01).name('Bokeh').onChange(rc);
  fRender.add(RENDER, 'focusSpread', 0.1, 2, 0.01).name('Zone nette').onChange(rc);
  fRender.add(RENDER, 'halation', 0, 1, 0.01).name('Halation').onChange(rc);
  fRender.add(RENDER, 'streaks', 0, 1, 0.01).name('Traînées').onChange(rc);
  fRender.add(RENDER, 'dirt', 0, 1, 0.01).name('Poussière (lentille)').onChange(rc);
  fRender.add(RENDER, 'ca', 0, 1, 0.01).name('Aberration chromatique').onChange(rc);
  fRender.add(RENDER, 'grain', 0, 0.15, 0.001).name('Grain').onChange(rc);
  fRender.add({ reset: () => on.resetRender() }, 'reset').name('Réglages de rendu par défaut');

  return {
    gui, build,
    setFps(v) { state.fps = v; fpsCtl.updateDisplay(); },
    setInfo(v) { state.info = v; gui.controllersRecursive().forEach((c) => c.property === 'info' && c.updateDisplay()); },
    refreshRender() { gui.controllersRecursive().forEach((c) => c.updateDisplay()); },
  };
}
