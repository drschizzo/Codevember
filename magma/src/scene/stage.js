// La scène : le champ de lave, le soleil et le ciel de l'humeur, le temps.
//
// update(ph) ne dépend que de la recette et de la phase : temps physique τ(ph)
// (timeline.js), surface du champ à ce temps, descente d'une nappe par boucle.
import * as THREE from 'three/webgpu';
import { createField } from './field.js';
import { createFumes } from './fumes.js';
import { makeTimeline } from '../timeline.js';
import { SLOTS, cellAt } from '../gen/toes.js';

const LIST_RES = 1024, LIST_H = 0.1;

export function createStage(scene, renderer, gen, { lite = false } = {}) {
  // ── Soleil (une seule lampe, fixe dans le monde) ──
  const sun = new THREE.DirectionalLight(0xffffff, 1);
  sun.castShadow = true;
  sun.shadow.mapSize.set(lite ? 1024 : 4096, lite ? 1024 : 4096);
  sun.shadow.bias = -0.0002; sun.shadow.normalBias = 0.01;
  const sc = sun.shadow.camera; sc.left = -2.4; sc.right = 2.4; sc.top = 2.4; sc.bottom = -2.4; sc.near = 0.1; sc.far = 20;
  scene.add(sun); scene.add(sun.target);
  // lueur d'autres coulées, hors champ (la nuit : c'est elle qui fait lire le champ)
  const far = new THREE.DirectionalLight(0xff6a1c, 0);
  scene.add(far); scene.add(far.target);

  const field = createField(scene, renderer, { lite });
  const fumes = createFumes(field, { lite });
  let R = null, TL = null, data = null, version = 0, pending = 0, total = 1, prog = 0;

  async function setRecipe(recipe) {
    R = recipe;
    const v = ++version;
    pending = 1; total = 1; prog = 0;
    try {
      const spec = { seed: R.seed, ...R.toes };
      const tree = await gen.request(spec, 'tree');
      if (v !== version) return;
      prog = 0.3;
      // le relief flouté ne dépend que de l'arbre : il part le premier, sur un
      // worker à lui, pendant que les autres cuisent les listes par bandes
      const blurP = gen.request({ T: tree.T, n: tree.n, F: tree.F, res: 512 }, 'blur', null, { key: `blur|${R.seed}|${JSON.stringify(R.toes)}` });
      const thermalP = gen.request({ cooling: {} }, 'thermal');
      const nb = Math.max(2, gen.size - 1), rows = Math.ceil(LIST_RES / nb);
      const bands = await Promise.all(Array.from({ length: nb }, (_, b) => gen.request(
        { T: tree.T, n: tree.n, F: tree.F, res: LIST_RES, h: LIST_H, rows: [b * rows, Math.min(LIST_RES, (b + 1) * rows)] }, 'lists',
        null, { key: `lists8|${R.seed}|${JSON.stringify(R.toes)}|${b}` },
      ).then((o) => { prog += 0.6 / nb; return o; })));
      const [thermal, blur] = await Promise.all([thermalP, blurP]);
      if (v !== version) return;
      const lists = new Float32Array(LIST_RES * LIST_RES * SLOTS);
      for (const b of bands) lists.set(b.lists, b.rows[0] * LIST_RES * SLOTS);
      // fin de la coulée À L'IMAGE : l'instant où 95 % du cadre est couvert
      // (mesuré sur une grille, premier passage du front) — le film montre la
      // coulée au rythme où elle remplit le cadre ; ce qui reste (les recoins,
      // le dehors) se finit pendant l'accéléré
      const [cx0, cz0] = R.camera.target;
      const Lc = { lists, res: LIST_RES, F: tree.F }, tas = [];
      for (let z = cz0 - 1.25; z <= cz0 + 0.85; z += 0.05) for (let x = cx0 - 1.3; x <= cx0 + 1.3; x += 0.05) tas.push(cellAt(tree.T, Lc, x, z).ta);
      tas.sort((p, q) => p - q);
      const tFlow = Math.min(tas[Math.floor(tas.length * 0.95)], 1e5) + 15;
      // l'accéléré suit la couverture du cadre : à part égale de film, part
      // égale d'image recouverte (mêlé à 15 % de temps régulier) — courbe monotone de 0 à 1
      const K = 64, shape = new Float64Array(K + 1);
      for (let i = 0; i <= K; i++) {
        const q = tas[Math.min(tas.length - 1, Math.floor((i / K) * 0.95 * tas.length))];
        shape[i] = 0.15 * (i / K) + 0.85 * Math.min(1, Math.max(0, q / tFlow));
      }
      shape[0] = 0; shape[K] = 1;
      for (let i = 1; i <= K; i++) shape[i] = Math.max(shape[i], shape[i - 1]);
      const h = R.toes.h; // (épaisseur d'une nappe)
      data = { tree, tFlow, h };
      TL = makeTimeline({ P: R.loop.P, tFlow, u0: R.loop.u0, u1: R.loop.u1, lead: 20, shape, ramp: 0.1 });
      field.setData({ T: tree.T, n: tree.n, lists, listRes: LIST_RES, cool: thermal.cool, coolN: thermal.n, ageMax: thermal.ageMax, emit: thermal.emit, F: tree.F, h, period: R.loop.P, delta: [0, 0], src: R.toes.sources[0], src2: R.toes.sources[1], blur });
      field.U.meshC.value.set(R.camera.target[0], R.camera.target[1]);
      prog = 1;
      pending = 0;
    } catch (e) { console.error(e); pending = 0; throw e; }
  }

  // glissement : nul pendant la coulée, de 0 à 1 pendant le refroidissement
  // (smootherstep : vitesse et accélération nulles aux deux bouts)
  const slide = (u) => {
    const f = u - Math.floor(u), a = TL.u1 + 0.025, b = 0.985;
    const x = Math.min(1, Math.max(0, (f - a) / (b - a)));
    return x * x * x * (x * (6 * x - 15) + 10);
  };

  let lastU = 0;
  function update(u, camera) {
    if (!R || !TL) return;
    fumes.update(camera, R, u, TL);
    const t = TL.tau(u) - Math.floor(u) * R.loop.P; // (temps physique dans la boucle)
    const tp = TL.tau(lastU) - Math.floor(u) * R.loop.P;
    field.U.tPrev.value = field.U.t.value;
    field.U.t.value = t;
    // la nappe neuve a monté le sol de h et le champ glisse de Δ : pendant
    // l'accéléré du refroidissement, le monde redescend de h et glisse de −Δ
    // (un travelling d'hyperlapse) ; à u = 1, la scène est celle de u = 0
    const m = slide(u);
    field.U.shiftPrev.value = field.U.shift.value;
    field.U.offPrev.value.copy(field.U.off.value);
    // (le sol redescend d'une nappe régulièrement sur toute la boucle — 3 mm/s,
    // imperceptible — et non d'un coup pendant l'accéléré)
    field.U.shift.value = -data.h * (u - Math.floor(u));
    void m;
    field.U.off.value.set(R.toes.delta[0] * m, R.toes.delta[1] * m);
    void tp;
    lastU = u;
    // soleil
    const S = R.sun, d = new THREE.Vector3(Math.cos(S.el) * Math.cos(S.az), Math.sin(S.el), Math.cos(S.el) * Math.sin(S.az));
    sun.position.copy(d).multiplyScalar(8);
    sun.target.position.set(0, 0, 0);
    sun.color.set(S.color);
    sun.intensity = S.klux; // (klux : unités de scène, 1 = 1 000 cd/m² pour un blanc parfait × π)
    sun.shadow.radius = S.soft;
    const Lk = R.look ?? {};
    field.U.ropes.value = Lk.ropes ?? 0; field.U.plates.value = Lk.plates ?? 0;
    field.U.wet.value = Lk.wet ?? 0; field.U.sulfur.value = Lk.sulfur ?? 0;
    const Fg = R.farGlow ?? { klux: 0, az: 0, el: 0.2 };
    far.position.set(Math.cos(Fg.el) * Math.cos(Fg.az) * 8, Math.sin(Fg.el) * 8, Math.cos(Fg.el) * Math.sin(Fg.az) * 8);
    far.intensity = Fg.klux;
    field.updatePass();
    // raccord : l'image précédente était la même scène dans le repère de la
    // boucle d'avant ; ici, aucune vitesse (rien n'a bougé à l'écran)
    if (Math.floor(u) !== Math.floor(prevU)) field.still();
    prevU = u;
  }
  let prevU = 0;

  return {
    setRecipe, update, field, fumes, sun,
    get timeline() { return TL; }, get data() { return data; },
    group: field.mesh,
    ready: () => pending === 0 && !!TL,
    progress: () => prog,
    setShadowQuality() {},
    syncFinishes() {},
  };
}
