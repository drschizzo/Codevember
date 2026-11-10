// Panneau de réglages (lil-gui). Ce module ne connaît que la recette, les
// réglages de rendu et des fonctions de rappel : il ne touche pas à la scène.
//
// Ordre des dossiers (commun à tous les projets) : en tête la graine et les
// actions, puis Export, puis la scène (du général au particulier : humeur et
// boucle, chorégraphie, caméra, chaque élément du thème, lumière), puis Rendu.
// Tout est replié sauf l'essentiel ; les libellés sont en français, avec la
// touche du clavier entre parenthèses.
import GUI from 'lil-gui';
import { QUALITY } from './settings.js';

const opts = (o, label = (v) => v.label) => Object.fromEntries(Object.entries(o).map(([k, v]) => [label(v), k]));

export function createUI({ recipe: getRecipe, render, on, moods, families }) {
  const gui = new GUI({ title: 'Melt', width: 320 });
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
  const fCrystal = gui.addFolder('Cristal').close();
  const fWater = gui.addFolder('Eau').close();
  const fCam = gui.addFolder('Caméra').close();
  const fLight = gui.addFolder('Lumière et support').close();
  const fRender = gui.addFolder('Rendu').close();
  let ctls = [];

  function build() {
    const R = getRecipe();
    top.seed = R.seed;
    gui.controllersRecursive().forEach((c) => c.property === 'seed' && c.updateDisplay());
    for (const c of ctls) c.destroy();
    ctls = [];
    const add = (f, o, k, ...a) => { const c = f.add(o, k, ...a); ctls.push(c); return c; };
    const addC = (f, o, k) => { const c = f.addColor(o, k); ctls.push(c); return c; };
    const ch = () => on.recipeChanged();
    const re = () => on.reload();

    add(fScene, R, 'mood', opts(moods)).name('Humeur (nouvelle scène)').onChange((m) => on.moodChanged(m));
    add(fScene, R, 'family', opts(families)).name('Famille').onChange((f) => on.familyChanged(f, Object.keys(families[f].forms)[0]));
    add(fScene, R, 'form', opts(families[R.family].forms)).name('Forme').onChange((f) => on.familyChanged(R.family, f));
    add(fScene, R.loop, 'duration', 12, 120, 1).name('Durée de la boucle (s)').onChange(ch);

    const F = families[R.family];
    add(fCrystal, R.crystal, 'size', F.size[0] * 0.7, F.size[1] * 1.2, 0.01).name('Diamètre (mm)').onFinishChange(re);
    add(fCrystal, R.crystal, 'seed', 1, 1e6, 1).name('Graine de la forme').onFinishChange(re);
    add(fCrystal, R.crystal, 'sigma', 0, 0.0004, 0.00001).name('Asymétrie des bras').onFinishChange(re);
    add(fCrystal, R.crystal, 'spin', 0, Math.PI / 3, 0.01).name('Orientation (rad)').onChange(ch);

    add(fWater, R.water, 'theta', 0.3, 2.4, 0.01).name('Angle de contact sur le support (rad)').onChange(ch);
    add(fWater, R.water, 'thetaIce', 0.2, 1.2, 0.01).name('Angle de contact sur la glace (rad)').onFinishChange(re);
    add(fWater, R.water, 'bead', 0.05, 0.25, 0.005).name('Perle gelée : rayon (mm)').onFinishChange(re);

    add(fCam, R.camera, 'el', 8, 89, 0.5).name('Hauteur (°)').onChange(ch);
    add(fCam, R.camera, 'az', -Math.PI, Math.PI, 0.01).name('Azimut (rad)').onChange(ch);
    add(fCam, R.camera, 'sway', 0, 30, 0.5).name('Balancement (°)').onChange(ch);
    add(fCam, R.camera, 'fov', 12, 60, 0.5).name('Champ (°)').onChange(ch);
    add(fCam, R.camera, 'fill', 0.3, 0.95, 0.01).name('Part du cadre occupée').onChange(ch);
    add(fCam, on.camState, 'free').name('Caméra libre (souris)').onChange((v) => on.freeCam(v));

    const L = R.light;
    addC(fLight, L.sun, 'color').name('Soleil : couleur').onChange(ch);
    add(fLight, L.sun, 'intensity', 0, 10, 0.01).name('Soleil : intensité').onChange(ch);
    add(fLight, L.sun, 'az', -Math.PI, Math.PI, 0.01).name('Soleil : azimut').onChange(ch);
    add(fLight, L.sun, 'el', 0.05, 1.5, 0.01).name('Soleil : hauteur').onChange(ch);
    addC(fLight, L.key, 'color').name('Ciel : couleur').onChange(ch);
    add(fLight, L.key, 'intensity', 0, 4, 0.01).name('Ciel : intensité').onChange(ch);
    add(fLight, L.key, 'az', -Math.PI, Math.PI, 0.01).name('Ciel : azimut').onChange(ch);
    add(fLight, L.key, 'el', 0.1, 1.5, 0.01).name('Ciel : hauteur').onChange(ch);
    add(fLight, L.key, 'soft', 0, 1, 0.01).name('Ciel : douceur').onChange(ch);
    addC(fLight, L.rim, 'color').name('Contre-jour : couleur').onChange(ch);
    add(fLight, L.rim, 'intensity', 0, 4, 0.01).name('Contre-jour : intensité').onChange(ch);
    add(fLight, R.env, 'intensity', 0, 3, 0.01).name('Ciel (reflets) : intensité').onChange(ch);
    add(fLight, R.sky, 'boxW', 0.1, 1.2, 0.01).name('Boîte à lumière : largeur (rad)').onFinishChange(() => on.envChanged());
    add(fLight, R.sky, 'boxH', 0.1, 1.0, 0.01).name('Boîte à lumière : hauteur (rad)').onFinishChange(() => on.envChanged());
    addC(fLight, R.sub, 'color').name('Support : couleur').onChange(re);
    addC(fLight, R.sub, 'color2').name('Support : seconde couleur').onChange(re);
    addC(fLight, R.fog, 'color').name('Fond et brume').onChange(ch);
    add(fLight, R.fog, 'near', 0, 40, 0.1).name('Brume : début (mm)').onChange(ch);
    add(fLight, R.fog, 'far', 1, 120, 0.1).name('Brume : fin (mm)').onChange(ch);
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
