// Le plateau : les langues de cire pendues sous la voûte, la lumière.
//
// - update(ph) ne dépend que de la recette et de la phase ;
// - les matériaux du rayon sont construits quand la cuisson est arrivée (les
//   textures font partie du shader), et libérés à la recette suivante ;
// - les lumières sont créées une fois, dans un ordre fixe.
import * as THREE from 'three/webgpu';
import { float, positionWorld, uniform, mix, Fn, attribute, positionLocal, normalLocal, normalize, vec2, vec3, vec4, length, fwidth, sin, smoothstep, normalView, fract, modelWorldMatrix } from 'three/tsl';
import { combUniforms, buildComb, combGeometries, warpOf, MAXLEG } from './comb.js';
import { fbm, noise, perturb } from '../../../shared/scene/materials.js';
import { G } from '../../../shared/scene/globals.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const SHADOW = { mobile: 1024, low: 1024, medium: 2048, high: 4096, ultra: 4096 };

// profil (z, y) : sol, gorge en quart de rond, mur du fond ; extrudé en x
function coveGeometry(i0, i1, back = -7.5, r = 3.4, half = 40) {
  const prof = [[14, 0]];
  for (let i = 0; i <= 20; i++) { const a = (i / 20) * Math.PI / 2; prof.push([back + r - r * Math.sin(a), r - r * Math.cos(a)]); }
  prof.push([back, 40]);
  const pos = [], nor = [], idx = [];
  prof.forEach(([z, y], i) => {
    const p = prof[Math.max(0, i - 1)], q = prof[Math.min(prof.length - 1, i + 1)];
    let nz = q[1] - p[1], ny = -(q[0] - p[0]); const l = Math.hypot(nz, ny) || 1; nz /= l; ny /= l; // (vers la scène : vers le haut au sol, vers l'avant devant le mur)
    for (const x of [-half, half]) { pos.push(x, y, z); nor.push(0, ny, nz); }
  });
  for (let i = Math.max(0, i0); i < Math.min(prof.length - 1, i1); i++) { const a = 2 * i; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setIndex(idx);
  return g;
}

export function createStage(scene, gen, { lite = false } = {}) {
  // ── Lumières (ordre fixe) ──
  // la lampe : une lumière parallèle (le jour d'une fenêtre, le soleil), dont la
  // carte d'ombres est cadrée sur les langues — chaque paroi porte son ombre
  const key = new THREE.DirectionalLight(0xffffff, 5);
  key.castShadow = true;
  key.shadow.bias = -0.0002;
  key.shadow.normalBias = 0.004;
  key.shadow.radius = 2.5;
  key.shadow.mapSize.set(4096, 4096);
  Object.assign(key.shadow.camera, { left: -3.4, right: 3.4, top: 3.4, bottom: -3.4, near: 1, far: 26 });
  const back = new THREE.SpotLight(0xffffff, 300, 0, 0.6, 0.9, 2);
  // le remplissage : le ciel, froid, du côté opposé à la lampe, sans ombre portée —
  // il donne leur couleur aux ombres (chaud côté lampe, froid côté ciel)
  const fill = new THREE.DirectionalLight(0xffffff, 1);
  for (const l of [key, back, fill]) { scene.add(l); scene.add(l.target); }

  // ── Fond : un sol qui remonte en mur loin derrière (cyclorama). Le sol reçoit les ombres ;
  // la gorge et le mur sont un fond, sans ombre détachée ──
  const vaultU = { color: uniform(new THREE.Color('#d8d4cb')), plinth: uniform(new THREE.Color('#cfcbc2')) };
  const vault = new THREE.Mesh(coveGeometry(0, 1)), backdrop = new THREE.Mesh(coveGeometry(1, 99));
  {
    const m = new THREE.MeshStandardNodeMaterial();
    const q = positionWorld;
    const big = fbm(q.mul(0.35), 3), mid = fbm(q.mul(1.7), 2);
    m.colorNode = vaultU.color.mul(big.mul(0.1).add(mid.mul(0.04)).add(0.97));
    m.roughnessNode = float(0.92);
    vault.material = backdrop.material = m;
  }
  vault.receiveShadow = true;
  scene.add(vault, backdrop);

  // ── Matières du mobilier : le bois des cadres, le métal des supports, le socle ──
  const decoU = { wood: uniform(new THREE.Color('#d6c19a')), woodDark: uniform(new THREE.Color('#8c6f47')), stand: uniform(new THREE.Color('#b3925c')), metal: uniform(1) };
  const woodMat = new THREE.MeshStandardNodeMaterial();
  {
    // Du bois débité : chaque barre est taillée dans un tronc dont l'axe suit à peu près sa
    // longueur (x). Les cernes sont des cylindres autour de cet axe, placé hors de la barre et
    // propre à chacune : sur la face large on lit des flammes, sur le chant des lignes serrées.
    const q = positionLocal, w = positionWorld;
    const o = modelWorldMatrix.mul(vec4(0, 0, 0, 1)).xyz; // (l'origine de la barre : sa graine)
    const sd = vec3(sin(o.x.mul(12.9).add(o.y.mul(78.2))), sin(o.y.mul(37.7).add(o.z.mul(11.1))), sin(o.x.mul(5.3).add(o.z.mul(91.7))));
    const px = length(fwidth(w));
    // le fil ondule le long de la barre, et l'axe du tronc dérive
    const drift = vec2(fbm(vec3(q.x.mul(0.22), sd.x.mul(3), sd.y), 2), fbm(vec3(q.x.mul(0.22).add(7), sd.z.mul(3), sd.x), 2)).mul(0.11);
    // (l'axe passe près de la barre : les cernes y sont courbes, et leur dérive dessine des flammes)
    const c = vec2(sd.x.mul(0.09), sd.y.mul(0.08).add(0.15)).add(drift);
    const rr = length(q.yz.sub(c)).add(noise(vec3(q.x.mul(1.3), q.y.mul(9), q.z.mul(9)).add(sd)).mul(0.006));
    // un cerne : bois de printemps clair et large, bois d'été sombre et étroit, bord net vers l'extérieur
    // (des cernes inégaux : les années ne se ressemblent pas)
    // (et le fil n'est jamais droit : il serpente d'un rien tout le long de la barre)
    const ringR = rr.add(noise(vec3(rr.mul(7), sd.x, sd.y)).mul(0.012)).add(noise(vec3(q.x.mul(2.4), q.y.mul(5), q.z.mul(5)).add(sd.zxy)).mul(0.007));
    const t = fract(ringR.mul(62).add(sd.z.mul(4)));
    const late = smoothstep(0.55, 0.92, t).mul(smoothstep(1.0, 0.95, t)).mul(smoothstep(0.9, 0.3, px.mul(62))).mul(noise(vec3(rr.mul(3), q.x.mul(0.6), sd.z)).mul(0.35).add(0.75));
    // fibres étirées le long du fil, pores, rayons : le détail fin s'efface avant le pixel
    const fibre = noise(vec3(q.x.mul(4), q.y.mul(130), q.z.mul(130)).add(sd)).mul(smoothstep(0.5, 0.15, px.mul(130)));
    const streak = fbm(vec3(q.x.mul(0.8), q.y.mul(24), q.z.mul(24)).add(sd.mul(5)), 3);
    // le bois a vécu : cire et propolis laissées par les abeilles, en taches ambrées
    const stain = smoothstep(0.1, 0.7, fbm(w.mul(2.3).add(sd), 3)).mul(0.5);
    let col = mix(decoU.wood, decoU.woodDark, late.mul(0.5).add(smoothstep(0.0, 0.6, streak).mul(0.3)).clamp(0, 1));
    col = col.mul(fibre.mul(0.13).add(1));
    col = mix(col, col.mul(vec3(1.0, 0.82, 0.55)), stain);
    woodMat.colorNode = col;
    // le bois d'été, plus dense, est plus lisse ; la tache de cire aussi
    woodMat.roughnessNode = float(0.68).sub(late.mul(0.12)).sub(stain.mul(0.16)).add(fibre.mul(0.05));
    // relief de sciage : le bois de printemps, tendre, est un peu creusé
    woodMat.normalNode = perturb(late.mul(0.00012).add(fibre.mul(0.00025)).mul(G.microDetail), normalView);
  }
  const standMat = new THREE.MeshStandardNodeMaterial();
  {
    const brush = noise(vec3(positionLocal.x.mul(300), positionLocal.y.mul(4), positionLocal.z.mul(300)));
    standMat.colorNode = decoU.stand.mul(brush.mul(0.05).add(1));
    standMat.metalnessNode = decoU.metal;
    standMat.roughnessNode = float(0.34).add(brush.mul(0.08));
  }
  const plinthMat = new THREE.MeshStandardNodeMaterial();
  plinthMat.colorNode = vaultU.plinth.mul(fbm(positionWorld.mul(0.9), 3).mul(0.06).add(0.98));
  plinthMat.roughnessNode = float(0.86);
  const decor = new THREE.Group();
  scene.add(decor);
  let decorGeo = [];

  const U = combUniforms(), _c = new THREE.Color();
  const group = new THREE.Group();
  scene.add(group);
  let R = null, pending = 0, total = 1, version = 0, disposables = [];

  function clear() {
    for (const d of disposables) d.dispose?.();
    disposables = [];
    group.clear();
  }

  // Le mobilier d'une recette : un cadre par rayon (barre du haut à oreilles, deux montants,
  // barre du bas), pendu par ses oreilles sur deux tiges, et un socle commun. Rien ne flotte :
  // chaque oreille repose sur la coupelle d'une tige, chaque tige a son pied sur le socle.
  function buildDecor() {
    for (const g of decorGeo) g.dispose();
    decorGeo = []; decor.clear();
    const C = R.comb, F = C.frame, zc = 0.05; // (zc : le rayon a ses alvéoles vers l'avant)
    const box = (w, h, d, r = 0.009) => { const g = new RoundedBoxGeometry(w, h, d, 3, r); decorGeo.push(g); return g; };
    const cyl = (r, h, n = 20) => { const g = new THREE.CylinderGeometry(r, r, h, n); decorGeo.push(g); return g; };
    const add = (parent, geo, mat, x, y, z, rz = 0) => { const o = new THREE.Mesh(geo, mat); o.position.set(x, y, z); o.rotation.z = rz; o.castShadow = o.receiveShadow = true; parent.add(o); return o; };
    const drop = F.Hi + F.bb + F.gap; // (du dessous de la barre du haut au dessus du socle)
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity;
    for (const l of C.lobes) {
      const g = new THREE.Group();
      // (le cadre suit le rayon : z = l·x, le même cisaillement que dans le shader des alvéoles)
      g.matrixAutoUpdate = false;
      g.matrix.set(1, 0, 0, l.x, 0, 1, 0, C.top, l.warp[1], 0, 1, l.z, 0, 0, 0, 1);
      const full = 2 * (F.Wi + F.st);
      add(g, box(full + 2 * F.lug, F.tb, F.depth), woodMat, 0, F.tb / 2, zc);
      const sideLen = F.Hi + F.bb * 0.4;
      for (const sx of [-1, 1]) add(g, box(sideLen, F.st, F.depth * 0.86), woodMat, sx * (F.Wi + F.st / 2), -sideLen / 2, zc, Math.PI / 2);
      add(g, box(full, F.bb, F.depth * 0.5, 0.009), woodMat, 0, -F.Hi - F.bb / 2, zc);
      for (const sx of [-1, 1]) {
        const x = sx * (F.Wi + F.st + F.lug * 0.55);
        add(g, cyl(0.02, drop), standMat, x, -drop / 2, zc);
        add(g, cyl(0.055, 0.014, 28), standMat, x, -0.007, zc); // (coupelle sous l'oreille)
        add(g, cyl(0.1, 0.022, 32), standMat, x, -drop + 0.011, zc); // (pied)
      }
      decor.add(g);
      x0 = Math.min(x0, l.x - F.Wi - 0.75); x1 = Math.max(x1, l.x + F.Wi + 0.75); z0 = Math.min(z0, l.z);
    }
    const py = C.top - drop;
    add(decor, box(x1 - x0, F.plinthH, 0.75 - z0 + 0.75, 0.01), plinthMat, (x0 + x1) / 2, py - F.plinthH / 2, (0.75 + z0 - 0.75) / 2);
    vault.position.set(0, py - F.plinthH, 0); backdrop.position.copy(vault.position);
    const half = (x1 - x0) / 2 + 0.4;
    Object.assign(key.shadow.camera, { left: -half, right: half, top: half, bottom: -half });
    key.shadow.camera.updateProjectionMatrix();
  }

  function setRecipe(recipe) {
    R = recipe;
    const v = ++version;
    const C = R.comb, NL = C.lobes.length;
    const n = lite ? 10 : 16, RL = lite ? 32 : 48, sdfN = lite ? 48 : 96, M = 6 * n, W = M + 2;
    // une cuisson par langue (son pavage), en deux tranches ; ses instances ; l'atlas des langues
    buildDecor();
    const jobs = [], plan = [];
    let rowBase = 0;
    C.lobes.forEach((l, k) => {
      const T = l.tiling, L = T.path.legs.length, rows = L * RL;
      const base = { group: T.group, path: T.path, profiles: T.profiles, amp: T.amp, wall: T.wall, n, RL, sdfN };
      const ext = Math.hypot(l.W * 1.3, l.L) / C.cell * 0.62 + 7.3 + Math.hypot(l.off[0], l.off[1]);
      const entry = { k, L, rows, rowBase, parts: [], inst: null };
      for (let c = 0; c < 2; c++) jobs.push(gen.request({ ...base, rows: [Math.floor(rows * c / 2), Math.floor(rows * (c + 1) / 2)] }, 'tiling').then((o) => { entry.parts.push(o); }));
      jobs.push(gen.request({ group: T.group, path: T.path, profiles: T.profiles, amp: T.amp, R: ext }, 'instances').then((o) => { entry.inst = o; }));
      plan.push(entry);
      rowBase += rows;
    });
    const rowsAll = rowBase;
    let lob = null;
    jobs.push(gen.request({ lobes: C.lobes.map(({ tiling, ...l }) => l), content: C.content, seed: R.seed }, 'lobes').then((o) => { lob = o; }));
    total = jobs.length; pending = total;
    for (const j of jobs) j.then(() => { if (v === version) pending--; });
    Promise.all(jobs).then(() => {
      if (v !== version) return;
      clear();
      // ── textures : les pavages empilés (rangées) ──
      const curves = new Float32Array(rowsAll * W * 4), sdf = new Uint16Array(rowsAll * sdfN * sdfN * 2);
      for (const e of plan) for (const p of e.parts) { curves.set(p.curves, (e.rowBase + p.r0) * W * 4); sdf.set(p.sdf, (e.rowBase + p.r0) * sdfN * sdfN * 2); }
      const tc = new THREE.DataTexture(curves, W, rowsAll, THREE.RGBAFormat, THREE.FloatType);
      tc.minFilter = tc.magFilter = THREE.NearestFilter; tc.generateMipmaps = false; tc.needsUpdate = true;
      const ts = new THREE.Data3DTexture(sdf, sdfN, sdfN, rowsAll);
      ts.format = THREE.RGFormat; ts.type = THREE.HalfFloatType; ts.minFilter = ts.magFilter = THREE.LinearFilter;
      ts.wrapS = ts.wrapT = ts.wrapR = THREE.ClampToEdgeWrapping; ts.unpackAlignment = 1; ts.needsUpdate = true;
      const ta = new THREE.DataTexture(lob.atlas, lob.width, lob.height, THREE.RGBAFormat, THREE.HalfFloatType);
      ta.minFilter = ta.magFilter = THREE.LinearFilter; ta.generateMipmaps = false; ta.needsUpdate = true;
      disposables.push(tc, ts, ta);
      // ── uniformes de structure ──
      U.RL.value = RL; U.rows.value = rowsAll; U.M.value = M; U.sdfN.value = sdfN; U.nLobes.value = NL;
      const mul = (a, q) => ({ c: a.c * q.c - a.s * q.s, s: a.s * q.c + a.c * q.s, tx: a.c * q.tx - a.s * q.ty + a.tx, ty: a.s * q.tx + a.c * q.ty + a.ty });
      const isoA = [], lobeA = [], isoB = [], lobeB = [];
      for (const e of plan) {
        const l = C.lobes[e.k], T = l.tiling, k = e.k, inst = e.inst;
        U.lobeP.array[k].set(e.L, e.rowBase, T.wall, T.wave);
        { const w = l.warp ?? [0, 0, 0, 0, 1, 0]; U.warpA.array[k].set(w[0], w[1], w[2], w[3]); U.warpB.array[k].set(w[4], w[5], 0, 0); }
        const b = e.parts[0].boxes;
        for (let g = 0; g < MAXLEG; g++) U.boxes.array[k * MAXLEG + g].set(b[4 * g] ?? 0, b[4 * g + 1] ?? 0, b[4 * g + 2] ?? 1, 0);
        // relais : h⁰, h⁻¹, h⁻²
        const h = inst.relay, inv = { c: h.c, s: -h.s, tx: -(h.c * h.tx + h.s * h.ty), ty: -(-h.s * h.tx + h.c * h.ty) }, inv2 = mul(inv, inv);
        U.relay.array[k * 3].set(1, 0, 0, 0); U.relay.array[k * 3 + 1].set(inv.c, inv.s, inv.tx, inv.ty); U.relay.array[k * 3 + 2].set(inv2.c, inv2.s, inv2.tx, inv2.ty);
        U.lobeBox.array[k].set(lob.boxes[4 * k], lob.boxes[4 * k + 1], lob.boxes[4 * k + 2], 0);
        { const det = (1 - h.c) ** 2 + h.s ** 2 || 1; U.ringC.array[k].set(((1 - h.c) * h.tx - h.s * h.ty) / det, (h.s * h.tx + (1 - h.c) * h.ty) / det, 0, 0); } // (point fixe du relais)
        // les éléments du groupe qui couvrent la langue
        const ox = l.off[0], oy = l.off[1] - l.L / 2 / C.cell; // (décalage du pavage dans la langue, en alvéoles)
        for (let i = 0; i < inst.count; i++) {
          const c = inst.iso[4 * i], s = inst.iso[4 * i + 1], tx = inst.iso[4 * i + 2] + ox, ty = inst.iso[4 * i + 3] + oy;
          const x = (c * inst.ref[0] - s * inst.ref[1] + tx) * C.cell, y = (s * inst.ref[0] + c * inst.ref[1] + ty) * C.cell;
          const m = 2.4 * C.cell;
          if (y > m || y < -l.L - m || Math.abs(x) > l.W * 1.25 + m) continue;
          (k === 0 ? isoA : isoB).push(c, s, tx, ty);
          (k === 0 ? lobeA : lobeB).push(l.x, C.top, l.z, k);
        }
      }
      const mats = buildComb(U, { curves: tc, sdf: ts, atlas: ta });
      disposables.push(mats.wall, mats.floor, mats.cap);
      const addSet = (isoArr, lobeArr, step) => {
        if (!isoArr.length) return;
        const geo = combGeometries(M, new Float32Array(isoArr), new Float32Array(lobeArr), isoArr.length / 4, step);
        disposables.push(geo.ring, geo.quad);
        const walls = new THREE.Mesh(geo.ring, mats.wall); walls.castShadow = walls.receiveShadow = true;
        const floors = new THREE.Mesh(geo.quad, mats.floor); floors.receiveShadow = true;
        const caps = new THREE.Mesh(geo.quad, mats.cap); caps.receiveShadow = true;
        for (const o of [walls, floors, caps]) { o.frustumCulled = false; group.add(o); }
      };
      addSet(isoA, lobeA, 1);
      addSet(isoB, lobeB, 2); // (les langues du fond : un point sur deux)
      // ── nervures ──
      const pm = new THREE.MeshSSSNodeMaterial({ side: THREE.DoubleSide });
      const gr = fbm(positionWorld.mul(40), 3);
      pm.colorNode = mix(U.waxDeep, U.wax, 0.8).mul(gr.mul(0.1).add(0.95));
      // (la nervure suit le cintrage de sa langue)
      pm.positionNode = Fn(() => {
        const k = attribute('lobeK', 'float'), W = warpOf(U, positionLocal.xy, k);
        const n = normalLocal;
        normalLocal.assign(normalize(vec3(n.xy.sub(W.yz.mul(n.z)), n.z)));
        return vec3(positionLocal.xy, positionLocal.z.add(W.x));
      })();
      pm.roughnessNode = float(0.5);
      pm.thicknessColorNode = mix(U.waxDeep, U.wax, 0.5).mul(U.trans);
      pm.thicknessDistortionNode = float(0.3); pm.thicknessAmbientNode = U.sss; pm.thicknessAttenuationNode = float(1); pm.thicknessPowerNode = float(3); pm.thicknessScaleNode = float(0.7);
      disposables.push(pm);
      lob.plates.forEach((p, k) => {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(p.position, 3));
        g.setAttribute('normal', new THREE.BufferAttribute(p.normal, 3));
        g.setAttribute('lobeK', new THREE.BufferAttribute(new Float32Array(p.position.length / 3).fill(k), 1));
        g.setIndex(new THREE.BufferAttribute(p.index, 1));
        const o = new THREE.Mesh(g, pm);
        o.position.set(C.lobes[k].x, C.top, C.lobes[k].z);
        o.castShadow = true; o.receiveShadow = true;
        disposables.push(g);
        group.add(o);
      });
    }).catch((e) => { console.error(e); pending = 0; });
  }

  const place = (l, az, el, r, target) => {
    l.position.set(Math.sin(az) * Math.cos(el) * r + target[0], Math.sin(el) * r + target[1], Math.cos(az) * Math.cos(el) * r + target[2]);
    l.target.position.set(...target);
  };

  function update() {
    if (!R) return;
    const L = R.light, C = R.comb, Wx = R.wax;
    const mid = [0, C.top - C.lobes[0].L * 0.5, 0];
    place(key, L.key.az, L.key.el, 12, mid);
    key.color.set(L.key.color); key.intensity = L.key.intensity; key.shadow.radius = 1 + 5 * L.key.soft;
    U.keyDir.value.copy(key.position).sub(key.target.position).normalize();
    U.keyCol.value.set(L.key.color).multiplyScalar(L.key.intensity * 4.5);
    U.skyCol.value.set(R.fog.color).multiplyScalar(R.env.intensity);
    place(back, Math.PI + L.back.az, L.back.el, 8, mid);
    back.color.set(L.back.color); back.intensity = L.back.intensity;
    place(fill, -L.key.az * 0.9 + 0.25, L.fill.el, 10, mid);
    fill.color.set(L.fill.color); fill.intensity = L.fill.intensity;
    vaultU.color.value.set(Wx.vault); vaultU.plinth.value.set(R.decor.plinth);
    decoU.wood.value.set(R.decor.wood); decoU.woodDark.value.set(R.decor.woodDark); decoU.stand.value.set(R.decor.stand); decoU.metal.value = R.decor.standMetal;
    U.cell.value = C.cell; U.depth.value = C.depth; U.tilt.value = C.tilt; U.edge.value = C.edge; U.rim.value = C.rim;
    U.wave.value = R.wave; U.waveDir.value.set(...R.waveDir);
    U.wax.value.set(Wx.wax); U.waxDeep.value.set(Wx.deep); U.waxOld.value.set(Wx.old); U.waxGold.value.set(Wx.gold); U.zoning.value = Wx.zoning; U.capCol.value.set(Wx.cap); U.honey.value.set(Wx.honey); U.honeyDeep.value.set(Wx.honeyDeep);
    U.trans.value = Wx.trans; U.sss.value = Wx.sss ?? 0.08; U.honeyFill.value = C.content.fill;
  }

  function setShadowQuality(q) {
    const s = SHADOW[q] ?? 2048;
    if (key.shadow.mapSize.x !== s) { key.shadow.mapSize.set(s, s); key.shadow.map?.dispose(); key.shadow.map = null; }
  }

  return {
    setRecipe, update, setShadowQuality, syncFinishes() {}, group, key, back, fill, U,
    ready: () => pending === 0 && group.children.length > 0,
    progress: () => 1 - pending / total,
  };
}
