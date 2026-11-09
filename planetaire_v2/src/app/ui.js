// Panneau de réglages (lil-gui). Ce module ne connaît que la recette, les
// réglages de rendu et des fonctions de rappel : il ne touche pas à la scène.
import GUI from 'lil-gui';
import { MOODS, MATTERS, FINISHES, TRACE_KINDS } from '../recipe.js';
import { GLOBE_KINDS, GLASS_TINTS } from '../scene/world.js';
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

  const fDive = gui.addFolder('Plongée');
  const fLayers = gui.addFolder('Couches');
  const fRender = gui.addFolder('Rendu').close();
  const inv = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [v, k]));

  // ── Recette (reconstruite à chaque nouvelle scène) ──
  let ctls = [], folders = [];
  function build() {
    const R = getRecipe();
    top.seed = R.seed; seedCtl.updateDisplay();
    for (const c of ctls) c.destroy();
    for (const f of folders) f.destroy();
    ctls = []; folders = [];
    const add = (f, o, k, ...a) => { const c = f.add(o, k, ...a); ctls.push(c); return c; };
    const addC = (f, o, k) => { const c = f.addColor(o, k); ctls.push(c); return c; };
    const live = () => on.recipeChanged();

    add(fDive, R.motion, 'segment', 6, 40, 0.5).name('Durée d’une couche (s)');
    add(fDive, R.motion, 'hold', 0.1, 0.85, 0.01).name('Part avant la plongée');
    add(fDive, R.motion, 'free').name('Caméra libre (souris)').onChange(() => on.motionChanged());
    add(fDive, state, 'info').name('Couche à l’écran').disable();

    R.layers.forEach((L, m) => {
      const f = fLayers.addFolder(`Couche ${m + 1} — ${MOODS[L.mood].label}`).close();
      folders.push(f);
      // orbite : contraintes du solveur (« auto » : tirées de la graine)
      const fo = f.addFolder('Orbite');
      const o = {
        N: L.orbit.N ? String(L.orbit.N) : 'auto',
        sym: L.orbit.sym === null || L.orbit.sym === undefined ? 'auto' : L.orbit.sym === 'none' ? 'none' : `${L.orbit.sym.m}/${L.orbit.sym.l}${L.orbit.sym.mirror ? 'M' : ''}`,
        omega: L.orbit.omega ? L.orbit.omega.join('/') : 'auto',
      };
      add(fo, o, 'N', { Auto: 'auto', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9' }).name('Corps').onChange((v) => {
        L.orbit.N = v === 'auto' ? null : Number(v);
        L.orbit.sym = null; // (les classes dépendent du nombre de corps)
        build(); on.orbitChanged(m);
      });
      const symChoices = { Auto: 'auto', Aucune: 'none' };
      if (L.orbit.N) {
        for (const c of symmetryOptions(L.orbit.N)) {
          symChoices[`${c.m} pétales (l = ${c.l})${c.weak ? ' · fragile' : ''}`] = `${c.m}/${c.l}`;
          symChoices[`${c.m} pétales (l = ${c.l}), miroir${c.weak ? ' · fragile' : ''}`] = `${c.m}/${c.l}M`;
        }
      }
      add(fo, o, 'sym', symChoices).name(L.orbit.N ? 'Symétrie' : 'Symétrie (choisir N)').onChange((v) => {
        if (v === 'auto') L.orbit.sym = null;
        else if (v === 'none') L.orbit.sym = 'none';
        else { const [mm, l] = v.replace('M', '').split('/').map(Number); L.orbit.sym = { m: mm, l, mirror: v.endsWith('M') }; }
        on.orbitChanged(m);
      });
      add(fo, o, 'omega', ['auto', ...FRACTIONS]).name('Plateau (tours / période)').onChange((v) => {
        L.orbit.omega = v === 'auto' ? null : v.split('/').map(Number);
        on.orbitChanged(m);
      });
      // humeur et plateau
      add(f, L, 'mood', opts(MOODS)).name('Humeur (retire la couche)').onChange(() => on.moodChanged(m));
      add(f, L.stage, 'finish', inv(FINISHES)).name('Plateau : finition').onChange(live);
      add(f, L.stage, 'finishScale', 0.3, 3, 0.01).name('Plateau : échelle du motif').onFinishChange(live);
      // matières
      const fm = f.addFolder('Matières').close();
      const mat = opts(MATTERS);
      for (const [k, name] of [['plate', 'Plateau'], ['arms', 'Bras'], ['arms2', 'Bras (alternés)'], ['gears', 'Roues'], ['pins', 'Tenons, goupilles, montures'], ['foot', 'Pied, bâti']]) add(fm, L.matters, k, mat).name(name).onChange(live);
      // astres
      const fb = f.addFolder('Astres').close();
      add(fb, L.bodies, 'globe', inv(GLOBE_KINDS)).name('Monture').onChange(live);
      add(fb, L.bodies, 'tint', Object.fromEntries(Object.keys(GLASS_TINTS).map((k) => [k, k]))).name('Verre').onChange(live);
      add(fb, L.bodies, 'irid', 0, 1, 0.01).name('Irisation').onFinishChange(live);
      addC(fb, L.bodies, 'color').name('Lumière').onChange(live);
      add(fb, L.bodies, 'flare', 0, 4, 0.01).name('Embrasement aux passages');
      add(fb, L.bodies, 'light', 0, 0.5, 0.005).name('Lumière portée');
      // trace
      const ft = f.addFolder('Trace').close();
      add(ft, L.trace, 'kind', inv(TRACE_KINDS)).name('Nature').onChange(live);
      add(ft, L.trace, 'show').name('Visible').onChange(live);
      add(ft, L.trace, 'cool', 1, 20, 0.1).name('Refroidissement').onFinishChange(live);
      add(ft, L.trace, 'thick', 0.3, 3, 0.01).name('Épaisseur').onFinishChange(live);
      add(ft, L.trace, 'glow', 0, 3, 0.01).name('Incandescence').onFinishChange(live);
      addC(ft, L.trace, 'glass').name('Verre froid').onChange(live);
      // rythme et caméra
      const fr = f.addFolder('Rythme et caméra').close();
      add(fr, L.motion, 'slowmo', 0, 1.4, 0.01).name('Ralentis').onFinishChange(live);
      add(fr, L.motion, 'periodsPerLayer', 0.25, 3, 0.05).name('Périodes par couche').onFinishChange(live);
      add(fr, L.camera, 'az', 0, 6.28, 0.01).name('Caméra : azimut').onFinishChange(live);
      add(fr, L.camera, 'el', 0.05, 1.3, 0.01).name('Caméra : élévation').onFinishChange(live);
      add(fr, L.camera, 'sweep', -1.2, 1.2, 0.01).name('Caméra : balayage').onFinishChange(live);
      // lumières
      const fl = f.addFolder('Lumières').close();
      add(fl, L.light, 'env', opts(ENV_PRESETS)).name('Studio (reflets)').onChange(live);
      add(fl, L.light, 'envIntensity', 0, 2, 0.01).name('Intensité du studio').onFinishChange(live);
      addC(fl, L.light, 'bg').name('Fond').onFinishChange(live);
      addC(fl, L.light, 'floor').name('Sol').onFinishChange(live);
      addC(fl, L.light.key, 'color').name('Lampe : couleur').onFinishChange(live);
      add(fl, L.light.key, 'intensity', 0, 20, 0.1).name('Lampe : intensité').onFinishChange(live);
      addC(fl, L.light.rim, 'color').name('Contre-jour : couleur').onFinishChange(live);
      add(fl, L.light.rim, 'intensity', 0, 3, 0.01).name('Contre-jour : intensité').onFinishChange(live);
    });
  }

  // ── Rendu (indépendant de la scène, mémorisé) ──
  const rc = () => on.renderChanged();
  fRender.add(RENDER, 'quality', opts(QUALITY)).name('Qualité').onChange((v) => on.qualityChanged(v));
  fRender.add(RENDER, 'pixelRatio', 0.5, 2, 0.05).name('Résolution').onFinishChange(rc);
  fRender.add(RENDER, 'dynRes').name('Résolution dynamique').onChange(rc);
  fRender.add(RENDER, 'maxFps', { Libre: 0, 30: 30, 60: 60 }).name('Cadence maximale').onChange(rc);
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
