// La scène : l'usine (factory.js), la cire (wax.js) et sa simulation
// (sim/mpm.js), posées d'après l'état du cycle (cycle.js).
//
// La simulation avance d'une image (1/60 s) à la fois. Elle ne dépend que de
// l'objet et du temps écoulé depuis le début du demi-cycle : pour une phase
// donnée, l'image de simulation voulue est connue. En lecture, on avance d'une
// image ; après un saut (flèches, export, image fixe), on repart de l'objet
// neuf et l'on rattrape, par paquets.
import * as THREE from 'three/webgpu';
import { createSim, O, PBASE, CELL, PS, GX, GY, GZ, SEED_H } from '../sim/mpm.js';
import { createWax } from './wax.js';
import { createFactory, PLATE_Y } from './factory.js';
import { NMAX } from '../gen/shape.js';
import { stateAt, TL, smooth, beltAt } from '../cycle.js';
import { WAXES, HEATS, MOODS } from '../recipe.js';

// une figurine prête : particules (repère de la grille), texture de distance et
// moule, à partir des données calculées dans le worker (gen/shape.js)
function assemble(d) {
  const tex = new THREE.Data3DTexture(d.sdf, d.dims[0], d.dims[1], d.dims[2]);
  tex.format = THREE.RedFormat; tex.type = THREE.HalfFloatType; tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.ClampToEdgeWrapping; tex.needsUpdate = true;
  // le moule : deux demi-coques (repère objet, unités du monde)
  const halves = d.halves.map((h) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(h.position, 3));
    g.setIndex(new THREE.BufferAttribute(h.index, 1));
    g.computeVertexNormals();
    return g;
  });
  return { key: d.key, data: d.data, tex, n: d.n, height: d.height, mould: { halves, top: d.top, zBack: d.zBack } };
}

// ── Caméra : elle accompagne la cire ──
// naissance (gros plan sur le moule), montée (plan large qui suit le plateau),
// fonte (gros plan, lente avancée), puis redescente le long du filet de cire
// vers le moule, où naît l'objet suivant. Périodique par demi-cycle.
export function cameraAt(R, ph) {
  const S = stateAt(R, ph), F = R.factory, t = S.t, C = R.camera;
  const lampP = [0, F.y1], mouldP = [0, F.y0];
  const wp = S.pallets[S.wax];
  const back = smooth(TL.melt - 1.5, TL.half - 0.4, t); // (redescente)
  const base = t < TL.move ? [wp[0], wp[1]] : [lampP[0] + (mouldP[0] - lampP[0]) * back, lampP[1] + (mouldP[1] - lampP[1]) * back];
  const wide = smooth(TL.lift - 0.6, TL.lift + 1.4, t) * (1 - smooth(TL.move - 2.2, TL.move + 0.6, t)) + 0.55 * smooth(TL.melt - 1, TL.melt + 2, t) * (1 - smooth(TL.half - 2.2, TL.half - 0.2, t));
  const push = smooth(TL.heat, TL.melt, t) * (1 - back);
  const dist = 4.7 + 4.4 * wide - 0.7 * push;
  const u = ph * R.objects.length;
  const az = C.side * (0.5 + 0.22 * Math.sin(Math.PI * 2 * u + 1) * 0 + 0.3 * push - 0.12 * wide) + C.sway * Math.sin(Math.PI * 2 * u);
  const el = 0.2 + C.lift * 0.3 + 0.1 * wide + 0.07 * Math.sin(Math.PI * 2 * u + 0.8) * C.sway * 6;
  const tgt = [base[0] * (1 - 0.25 * wide), base[1] + PLATE_Y + 0.42 + 0.25 * wide, 0];
  const pos = [tgt[0] + Math.sin(az) * Math.cos(el) * dist, Math.max(0.35, tgt[1] + Math.sin(el) * dist), Math.cos(az) * Math.cos(el) * dist];
  return { pos, tgt, fov: 30, dist };
}

export function createStage(scene, gen, { renderer, lite = false } = {}) {
  const sim = createSim(renderer, NMAX);
  const wax = createWax(sim);
  const factory = createFactory(scene);
  scene.add(wax.mesh);
  let R = null, shapes = null, prog = 0, token = 0;
  let cur = { k: -1 }, rate = 0, lastDrain = 0, frozenSim = false;
  const dbg = { want: 0, k: 0, reloads: [] };

  function setRecipe(r) {
    R = r; shapes = null; prog = 0; cur = { k: -1 };
    const my = ++token;
    factory.build(R);
    const W = WAXES[R.wax];
    wax.U.a.value.setRGB(...W.a); wax.U.b.value.setRGB(...W.b);
    // (les figurines : calculées dans les workers, en parallèle — gen/shape.js)
    (async () => {
      const C = { O, PS, CELL, SEED_H };
      let done = 0;
      const data = await Promise.all(R.objects.map((key, i) => gen.request({ key, salt: i * 3.1 + R.seed.length, C }, 'shape', null, { cache: false })
        .then((d) => { prog = ++done / R.objects.length; return d; })));
      if (my !== token) return;
      const out = data.map(assemble);
      factory.setMoulds(out);
      shapes = out;
    })().catch((e) => console.error('figurines', e));
  }

  // chaleur reçue à l'instant t du demi-cycle (la même loi que cycle.js · stateAt)
  const heatOf = (t) => smooth(TL.heat, TL.heat + 1.4, t) * (1 - smooth(TL.melt, TL.melt + 1.2, t));

  function update(ph, camera, size, sub = null) {
    if (!R || !shapes) return;
    const S = stateAt(R, ph), P = factory.parts(), H = HEATS[R.heat], M = MOODS[R.mood];
    const shape = shapes[S.k];
    // ── la simulation rejoint l'image voulue ──
    if (!frozenSim) {
      const want = Math.floor(S.t * 60);
      dbg.want = want; dbg.k = S.k;
      // (un recul de moins d'une demi-seconde n'est pas un saut : on attend simplement)
      if (cur.k !== S.k || want < sim.frames() - 30) {
        dbg.reloads.push([cur.k, S.k, want, sim.frames()]);
        sim.load(shape.data); wax.setShape(shape.tex);
        cur = { k: S.k }; lastDrain = 0; rate = 0;
        const hc = shape.height / CELL;
        sim.U.heatDir.value.copy(P.dirv); sim.U.heatFlat.value = H.flat; sim.U.band.value.set(0, H.band[0] ? H.band[1] * hc : 0);
      }
      // (avant la chaleur, rien ne bouge : on saute ces images, sauf les premières qui posent les appuis)
      let n = 0;
      while (sim.frames() < want && n < 48) {
        const tf = sim.frames() / 60;
        if (tf < TL.heat - 0.2 && sim.frames() > 50 && want / 60 >= TL.heat - 0.2) { sim.skipTo?.(Math.floor((TL.heat - 0.2) * 60)); }
        sim.U.heat.value = H.power * heatOf(tf);
        if (H.band[0]) sim.U.band.value.set(beltAt(tf) * shape.height / CELL, H.band[1] * shape.height / CELL);
        sim.U.sweep.value = 90 * smooth(TL.melt + 0.3, TL.melt + 1.3, tf);
        sim.U.plateHot.value = smooth(TL.heat + 0.34 * (TL.melt - TL.heat), TL.heat + 0.6 * (TL.melt - TL.heat), tf);
        sim.advance(); n++;
      }
    }
    sim.resolve();
    // ── la machine ──
    const d = sim.drained();
    rate += (Math.min(1, Math.max(0, d - lastDrain) / 160) - rate) * 0.12; lastDrain = d;
    factory.pose(S, { rate, hObj: shape.height });
    // ── la cire : la grille suit son plateau ──
    const wp = S.pallets[S.wax];
    wax.U.origin.value.set(wp[0] - (GX / 2) * CELL, wp[1] - PBASE * CELL, -(GZ / 2) * CELL);
    wax.mesh.position.set(wp[0], wp[1] - PBASE * CELL + (GY / 2) * CELL, 0);
    wax.U.keyDir.value.copy(P.kd); wax.U.keyCol.value.copy(P.kc).multiplyScalar(M.key.I * 0.22);
    wax.U.rimDir.value.copy(P.rd); wax.U.rimCol.value.copy(P.rimC).multiplyScalar(M.rim.I * 0.5);
    wax.U.heatDir.value.copy(P.dirv); wax.U.heatCol.value.setRGB(1, 0.55, 0.3).multiplyScalar(0.6 * S.heat);
    wax.U.amb.value.set(M.wall).multiplyScalar(0.16);
    void camera; void size; void sub;
  }

  return {
    group: factory.root, setRecipe, update, sim, wax, factory,
    ready: () => !!R && !!shapes, progress: () => prog,
    freezeSim: (v) => { frozenSim = v; },
    setShadowQuality(q) { const s = { mobile: 1024, low: 1024, medium: 2048, high: 2048, ultra: 4096 }[q] ?? 2048; const k = factory.key; if (k.shadow.mapSize.x !== s) { k.shadow.mapSize.set(s, s); k.shadow.map?.dispose(); k.shadow.map = null; } },
    syncFinishes() {},
    state: (ph) => stateAt(R, ph), dbg, shapes: () => shapes,
  };
}
