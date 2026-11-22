// La tour : quatre prismes de papier bistables empilés (src/sim/fpori.js),
// sur un plateau de laiton, coiffés d'un autre. Le film (worker) donne l'état
// (h, θ) de chaque unité à chaque image ; la pose en découle sur le
// processeur (quelques centaines de sommets), et la couleur que chaque pan
// renvoie sur ses voisins aussi.
import * as THREE from 'three/webgpu';
import { Fn, uniform, float, vec2, vec3, vec4, mix, smoothstep, step, attribute, frontFacing, select, max, min, dot, normalize, fwidth, transformNormalToView, mx_noise_float, mx_noise_vec3 } from 'three/tsl';
import { unitParams, unitTriangles, unitPoints, poseAt } from '../sim/fpori.js';
import { TOWER } from '../recipe.js';

const col3 = (hex) => new THREE.Color(hex);

// Le papier : celui des feuilles, mais lu d'attributs (la tour est recalculée
// sur le processeur à chaque image). Attributs fixes par sommet : distance
// aux trois arêtes du triangle, nature de ces arêtes (0 coupe, 1 montagne,
// 2 vallée, 3 rien), couleurs recto et verso, position de repos (le grain suit
// le papier). Recalculés : la lumière renvoyée par les pans voisins (bf, bb).
function paperMaterial(G, U) {
  const paper = new THREE.MeshPhysicalNodeMaterial({ side: THREE.DoubleSide, roughness: 0.82 });
  const ed = attribute('ed', 'vec3'), ek = attribute('ek', 'vec3');
  const cf = attribute('cf', 'vec3'), cb = attribute('cb', 'vec3'), rp = attribute('rp', 'vec3').toVarying();
  const px = fwidth(rp.x).add(fwidth(rp.y)).add(fwidth(rp.z));
  const grain = mx_noise_float(rp.mul(260)).mul(0.6).add(mx_noise_float(rp.mul(900)).mul(0.4)).mul(smoothstep(1.2, 0.3, px.mul(900)));
  const mottle = mx_noise_float(rp.mul(38)).mul(0.035).add(1);
  // un pli : la fibre cassée blanchit ; une coupe : la tranche montre l'âme blanche du papier
  // (un filet plus fin qu'un pixel s'estompe au lieu de s'élargir)
  const aa = (d) => max(fwidth(d), 1e-5);
  const lineOf = (d, k) => {
    const crease = step(0.5, k).mul(step(k, 2.5)), cut = float(1).sub(step(0.5, k));
    const wc = max(U.wc, aa(d).mul(1.5)), wt = max(U.wt, aa(d).mul(0.9));
    return vec2(float(1).sub(smoothstep(0, wc, d)).mul(crease).mul(min(U.wc.div(wc), 1)), float(1).sub(smoothstep(0, wt, d)).mul(cut).mul(0.7).mul(min(U.wt.div(wt), 1)));
  };
  const l3 = max(max(lineOf(ed.x, ek.x), lineOf(ed.y, ek.y)), lineOf(ed.z, ek.z));
  const front = frontFacing, base = select(front, cf, cb);
  const c = mix(mix(base, base.mul(0.6).add(0.4), l3.x.mul(0.16)), vec3(0.93, 0.92, 0.9), l3.y).mul(grain.mul(0.05).add(1)).mul(mottle);
  paper.colorNode = c;
  paper.roughnessNode = float(0.82).add(grain.mul(0.08)).sub(l3.x.mul(0.12));
  const nW = normalize(attribute('normal', 'vec3')).toVarying();
  const tooth = smoothstep(1.2, 0.3, px.mul(1400));
  paper.normalNode = transformNormalToView(normalize(nW.mul(select(front, float(1), float(-1))).add(mx_noise_vec3(rp.mul(700)).mul(tooth.mul(0.015)))));
  const through = max(dot(nW, U.L).mul(select(front, float(-1), float(1))), 0).mul(G.keyI).mul(G.thru);
  const bl = select(front, attribute('bf', 'vec3'), attribute('bb', 'vec3'));
  paper.emissiveNode = c.mul(bl).mul(G.bleed).add(c.mul(c.add(0.25)).mul(through.mul(0.6)));
  paper.sheen = 0.1; paper.sheenRoughness = 0.75;
  // l'ombre du papier prend ses couleurs ; sur le papier lui-même, elle reste neutre (comme les feuilles)
  paper.castShadowNode = vec4(cf.mul(cb).pow(vec3(0.5)).add(cf.add(cb).mul(0.25)).mul(0.3), 1);
  paper.receivedShadowNode = Fn(([shadow]) => { const l = dot(vec3(shadow), vec3(0.2126, 0.7152, 0.0722)); return vec3(l.mul(l.sqrt())); });
  return paper;
}

// La lumière qu'un pan renvoie sur un autre : pour chaque sommet (un peu
// rentré vers le centre de son triangle), les autres triangles à moins d'un
// côté de distance, par le facteur de forme de deux petits éléments
// (cos·cos·A / (πr² + A)). Le dehors d'une face reçoit la lampe (n·L) ; le
// dedans d'une tour fermée ne renvoie que la lumière ambiante.
function bleedPass(pos, nor, cf, cb, bf, bb, T, reach, L, keyI, amb) {
  const cx = new Float32Array(T * 3), ar = new Float32Array(T), rad = new Float32Array(T * 6);
  for (let t = 0; t < T; t++) {
    const o = t * 9;
    const ux = pos[o + 3] - pos[o], uy = pos[o + 4] - pos[o + 1], uz = pos[o + 5] - pos[o + 2], vx = pos[o + 6] - pos[o], vy = pos[o + 7] - pos[o + 1], vz = pos[o + 8] - pos[o + 2];
    ar[t] = 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    for (let k = 0; k < 3; k++) cx[t * 3 + k] = (pos[o + k] + pos[o + 3 + k] + pos[o + 6 + k]) / 3;
    const nl = nor[o] * L.x + nor[o + 1] * L.y + nor[o + 2] * L.z;
    const eF = Math.max(nl, 0) * keyI * 0.25 + amb, eB = amb * 0.5;
    for (let k = 0; k < 3; k++) { rad[t * 6 + k] = cf[o + k] * eF; rad[t * 6 + 3 + k] = cb[o + k] * eB; }
  }
  const r2max = reach * reach;
  for (let t = 0; t < T; t++) {
    const o = t * 9, nx = nor[o], ny = nor[o + 1], nz = nor[o + 2];
    for (let v = 0; v < 3; v++) {
      const px = pos[o + v * 3] * 0.8 + cx[t * 3] * 0.2, py = pos[o + v * 3 + 1] * 0.8 + cx[t * 3 + 1] * 0.2, pz = pos[o + v * 3 + 2] * 0.8 + cx[t * 3 + 2] * 0.2;
      let fr = 0, fg = 0, fb = 0, br = 0, bg = 0, bbl = 0;
      for (let j = 0; j < T; j++) {
        if (j === t) continue;
        const dx = cx[j * 3] - px, dy = cx[j * 3 + 1] - py, dz = cx[j * 3 + 2] - pz, r2 = dx * dx + dy * dy + dz * dz;
        if (r2 > r2max || r2 < 1e-10) continue;
        const r = Math.sqrt(r2), hx = dx / r, hy = dy / r, hz = dz / r;
        const ci = nx * hx + ny * hy + nz * hz, q = j * 9, cj = -(nor[q] * hx + nor[q + 1] * hy + nor[q + 2] * hz);
        const F = Math.abs(ci) * Math.abs(cj) * ar[j] / (Math.PI * r2 + ar[j]);
        const s = cj > 0 ? 0 : 3, R = rad[j * 6 + s], Gc = rad[j * 6 + s + 1], B = rad[j * 6 + s + 2];
        if (ci > 0) { fr += R * F; fg += Gc * F; fb += B * F; } else { br += R * F; bg += Gc * F; bbl += B * F; }
      }
      const w = o + v * 3;
      bf[w] = fr; bf[w + 1] = fg; bf[w + 2] = fb; bb[w] = br; bb[w + 1] = bg; bb[w + 2] = bbl;
    }
  }
}

// S : la pièce de la recette ; F : le film (worker) ; A : l'accord ;
// G : les uniformes de lumière de la scène ; keyPos : la lampe ; brass : le laiton des tiges.
export function createTower(S, F, A, G, keyPos, brass) {
  const P = unitParams(TOWER.n, TOWER.alpha, S.l), N = S.units, n = TOWER.n, k = S.l / F.l; // (le film est à l'échelle l = F.l)
  // deux triangles pressés l'un contre l'autre : écartés d'une épaisseur de papier (0,35 mm à l = 9 cm)
  const GAP = (0.00035 * k) / Math.sqrt(P.d * P.d - P.H0 * P.H0 / 4);
  const out = A.papers[S.top], inn = A.papers[S.bot];
  const tris = [];
  const base = unitTriangles(n);
  for (let j = 0; j < N; j++) for (const t of base) {
    const mirror = j % 2 === 1, u = j / Math.max(N - 1, 1);
    const v = mirror ? [t.v[0], t.v[2], t.v[1]] : t.v, e = mirror ? [t.e[2], t.e[1], t.e[0]] : t.e;
    tris.push({ src: v.map((kk) => ({ j, k: kk })), e, cf: col3(out[0]).lerp(col3(out[1]), u), cb: col3(inn[0]).lerp(col3(inn[1]), u) });
  }
  for (let i = 0; i <= N; i++) for (let kk = 0; kk < n; kk++) {
    const u = Math.min(i, N - 1) / Math.max(N - 1, 1), c = col3(inn[0]).lerp(col3(inn[1]), u);
    tris.push({ src: [{ plate: i, c: true }, { plate: i, k: kk }, { plate: i, k: (kk + 1) % n }], e: [3, 1, 3], cf: c, cb: c });
  }
  const T = tris.length, V = T * 3;
  const pos = new Float32Array(V * 3), nor = new Float32Array(V * 3), bf = new Float32Array(V * 3), bb = new Float32Array(V * 3);
  const ed = new Float32Array(V * 3), ek = new Float32Array(V * 3), cf = new Float32Array(V * 3), cb = new Float32Array(V * 3), rp = new Float32Array(V * 3);

  // Assemblage : une unité sur deux en miroir (z → −z), plateaux partagés ;
  // le plateau j monte de Σ h et tourne de Σ ±θ.
  function towerPose(hs, ths) {
    const units = [], plates = [{ y: 0, psi: 0 }];
    let y = 0, psi = 0;
    for (let j = 0; j < N; j++) {
      const mirror = j % 2 === 1, p = poseAt(P, hs[j], ths[j], null, GAP);
      const c = Math.cos(psi), s = Math.sin(psi);
      const W = (q) => { const z = mirror ? -q[2] : q[2]; return [q[0] * c + z * s, q[1] + y, -q[0] * s + z * c]; };
      units.push(unitPoints(p).map(W));
      y += hs[j]; psi += mirror ? -ths[j] : ths[j];
      plates.push({ y, psi });
    }
    return { units, plates, height: y };
  }
  const poly = (i, kk, pose) => { const pl = pose.plates[i], a = (2 * Math.PI * kk) / n;
    const x = P.R * Math.cos(a), z = -P.R * Math.sin(a), c = Math.cos(pl.psi), s = Math.sin(pl.psi);
    return [x * c + z * s, pl.y, -x * s + z * c]; };
  const P3 = (src, pose) => src.plate !== undefined ? (src.c ? [0, pose.plates[src.plate].y, 0] : poly(src.plate, src.k, pose)) : pose.units[src.j][src.k];
  function fillPose(pose) {
    for (let t = 0; t < T; t++) {
      const p = tris[t].src.map((s) => P3(s, pose));
      const ux = p[1][0] - p[0][0], uy = p[1][1] - p[0][1], uz = p[1][2] - p[0][2], vx = p[2][0] - p[0][0], vy = p[2][1] - p[0][1], vz = p[2][2] - p[0][2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
      for (let i = 0; i < 3; i++) { pos.set(p[i], (t * 3 + i) * 3); nor.set([nx, ny, nz], (t * 3 + i) * 3); }
    }
  }
  { // attributs fixes, depuis la pose déployée
    const rest = towerPose(Array(N).fill(P.H0), Array(N).fill(0));
    for (let t = 0; t < T; t++) {
      const p = tris[t].src.map((s) => P3(s, rest)), e = tris[t].e;
      const L = (a, b) => Math.hypot(p[a][0] - p[b][0], p[a][1] - p[b][1], p[a][2] - p[b][2]);
      const u = [p[1][0] - p[0][0], p[1][1] - p[0][1], p[1][2] - p[0][2]], v = [p[2][0] - p[0][0], p[2][1] - p[0][1], p[2][2] - p[0][2]];
      const area2 = Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]);
      const alt = [area2 / L(1, 2), area2 / L(2, 0), area2 / L(0, 1)], kinds = [e[1], e[2], e[0]];
      for (let i = 0; i < 3; i++) {
        const o = (t * 3 + i) * 3;
        ed.set([i === 0 ? alt[0] : 0, i === 1 ? alt[1] : 0, i === 2 ? alt[2] : 0], o);
        ek.set(kinds, o); cf.set(tris[t].cf.toArray(), o); cb.set(tris[t].cb.toArray(), o); rp.set(p[i], o);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  // (WebGPU limite un pipeline à 8 tampons de sommets : attributs fixes entrelacés, lumière renvoyée dans un autre)
  const fix = new THREE.InterleavedBuffer(new Float32Array(V * 15), 15);
  for (let v = 0; v < V; v++) [ed, ek, cf, cb, rp].forEach((a, i) => fix.array.set(a.subarray(v * 3, v * 3 + 3), v * 15 + i * 3));
  ['ed', 'ek', 'cf', 'cb', 'rp'].forEach((key, i) => geo.setAttribute(key, new THREE.InterleavedBufferAttribute(fix, 3, i * 3)));
  const dyn = new THREE.InterleavedBuffer(new Float32Array(V * 6), 6); dyn.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('bf', new THREE.InterleavedBufferAttribute(dyn, 3, 0)); geo.setAttribute('bb', new THREE.InterleavedBufferAttribute(dyn, 3, 3));

  const top = S.base;
  const U = { L: uniform(new THREE.Vector3()), wc: uniform(0.0016 * Math.sqrt(k)), wt: uniform(0.0007 * Math.sqrt(k)) };
  const mesh = new THREE.Mesh(geo, paperMaterial(G, U));
  mesh.castShadow = mesh.receiveShadow = true; mesh.frustumCulled = false;
  mesh.position.set(S.at[0], top + 0.0005, S.at[1]); mesh.rotation.y = S.rot;
  // la lampe dans le repère de la tour
  const L = keyPos.clone().sub(mesh.position).normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), -S.rot);
  U.L.value.copy(L);
  // les plateaux de laiton : dessous, sur le socle ; dessus, il tourne avec le plateau du haut
  const pr = P.R * 1.3, pt = 0.012; // (rayon, épaisseur)
  const plate = (y) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(pr, pr, pt, 96), brass); m.castShadow = m.receiveShadow = true; m.position.set(S.at[0], y, S.at[1]); return m; };
  const bottom = plate(top - pt / 2), cap = plate(0);
  const group = new THREE.Group(); group.add(mesh, bottom, cap);

  const th = new Float64Array(N), hs = new Float64Array(N);
  // ph : phase de la boucle de la scène ; le film d'une tour dure une boucle
  function update(ph, G0) {
    const t = (((ph + S.phase) % 1) + 1) % 1, u = t * F.F, i = Math.floor(u) % F.F, j = (i + 1) % F.F, f = u - Math.floor(u);
    for (let a = 0; a < N; a++) {
      th[a] = F.th[i * N + a] + (F.th[j * N + a] - F.th[i * N + a]) * f;
      hs[a] = k * (F.h[i * N + a] + (F.h[j * N + a] - F.h[i * N + a]) * f);
    }
    const pose = towerPose(hs, th);
    fillPose(pose);
    bleedPass(pos, nor, cf, cb, bf, bb, T, S.l * 1.3, L, G0.keyI.value, G0.amb.value);
    const d = dyn.array; for (let v = 0; v < V; v++) { d.set(bf.subarray(v * 3, v * 3 + 3), v * 6); d.set(bb.subarray(v * 3, v * 3 + 3), v * 6 + 3); }
    dyn.needsUpdate = true;
    geo.attributes.position.needsUpdate = geo.attributes.normal.needsUpdate = true;
    cap.position.y = top + pose.height + pt / 2 + 0.0003; cap.rotation.y = S.rot + pose.plates[N].psi;
  }
  return { group, mesh, update, dispose: () => { geo.dispose(); mesh.material.dispose(); bottom.geometry.dispose(); cap.geometry.dispose(); } };
}
