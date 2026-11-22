// Fold · essai p2 : l'unité FP-ori bistable, sous presse.
// Quatre prismes de papier à α = 60° (= β/2), empilés, de chiralités
// alternées, pincés entre les deux plateaux d'une petite machine d'essai. La
// traverse descend : les unités tournent ensemble, se bloquent, puis claquent
// à plat une à une ; elle remonte : elles se redéploient une à une. La
// dynamique (sim.mjs) est calculée au chargement ; chaque image relit l'état
// (h, θ) de chaque unité et en déduit sa pose (bistable.mjs).
import * as THREE from 'three/webgpu';
import { Fn, uniform, float, vec2, vec3, vec4, mix, smoothstep, step, attribute, frontFacing, select, max, min, dot, normalize, fwidth, transformNormalToView, mx_noise_float, mx_noise_vec3, positionLocal, normalLocal, atan } from 'three/tsl';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { makeEnvironment } from '../../../shared/scene/env.js';
import { createPost } from '../../../shared/render/post.js';
import { unitTriangles, unitPoints } from '../p1/fpori.mjs';
import { unitParams, poseAt } from './bistable.mjs';
import { simulate, DEFAULTS } from './sim.mjs';

const Q = new URLSearchParams(location.search);
const W = +(Q.get('w') || 1280), H = +(Q.get('h') || 720);
const hud = document.getElementById('hud');
const errors = [];
addEventListener('error', (e) => errors.push(String(e.message)));
addEventListener('unhandledrejection', (e) => errors.push(String(e.reason)));

const ACCORDS = {
  bonbon: { a: '#ff2f6d', a2: '#ff8a1f', b: '#12c4d6', b2: '#2f6bff', c: '#ffe14a', wall: '#f7b7cf', floor: '#f4aac6' },
  citron: { a: '#ffe600', a2: '#a6f000', b: '#6a2cff', b2: '#ff3fb0', c: '#19e3c0', wall: '#b9a8f2', floor: '#ae9cee' },
  menthe: { a: '#10e0a0', a2: '#0fa8ff', b: '#ff3f98', b2: '#ff9a2f', c: '#7a3cff', wall: '#ffd9a8', floor: '#ffcf96' },
};
const AC = ACCORDS[Q.get('accord') || 'bonbon'];
const col3 = (hex) => new THREE.Color(hex);

const renderer = new THREE.WebGPURenderer({ antialias: false, powerPreference: 'high-performance' });
await renderer.init();
renderer.setPixelRatio(1); renderer.setSize(W, H);
document.body.appendChild(renderer.domElement);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
const scene = new THREE.Scene();
scene.background = new THREE.Color(AC.wall);
scene.environment = makeEnvironment('cyclo', 0, 512);
scene.environmentIntensity = 0.16;
const camera = new THREE.PerspectiveCamera(26, W / H, 0.2, 80);
camera.position.set(...(Q.get('cam') || '0.7,0.75,2.6').split(',').map(Number));
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(...(Q.get('look') || '0,0.46,0').split(',').map(Number)); controls.update();

// ── Décor : cyclorama ──
const floorMat = new THREE.MeshStandardNodeMaterial({ color: AC.floor, roughness: 0.62, side: THREE.DoubleSide });
{
  const pts = [], R0 = 14, f = 2.5;
  for (let i = 0; i <= 24; i++) { const a = (i / 24) * Math.PI / 2; pts.push(new THREE.Vector2(R0 - f + f * Math.sin(a), f - f * Math.cos(a))); }
  pts.unshift(new THREE.Vector2(0, 0)); pts.push(new THREE.Vector2(R0, 12));
  const cyc = new THREE.Mesh(new THREE.LatheGeometry(pts, 96), floorMat);
  cyc.receiveShadow = true; scene.add(cyc);
}
// La lampe : un projecteur de studio, haut et de côté (comme la scène Fold).
// Sa nappe tombe sur les tours et s'éteint vers les bords du cyclorama.
const KEY_I = 3.4, KEY_D = 8.5;
const key = new THREE.SpotLight(0xfff6ee, KEY_I * KEY_D * KEY_D, 0, 0.6, 0.9, 2);
key.target.position.set(0, 0.45, 0);
key.position.copy(new THREE.Vector3(-3.2, 5.5, 2.4).normalize().multiplyScalar(KEY_D)).add(key.target.position);
key.castShadow = true; key.shadow.mapSize.set(4096, 4096);
key.shadow.camera.near = 3; key.shadow.camera.far = 16;
key.shadow.radius = 5; key.shadow.bias = -0.0008; key.shadow.normalBias = 0.03;
// un contre-jour froid, faible ; le reste vient des rebonds (lumière indirecte de la chaîne d'image)
const fill = new THREE.DirectionalLight(0xcfe4ff, 0.9); fill.position.set(4, 1.6, -2.5); fill.target.position.set(0, 1, 0);
const bounce = new THREE.DirectionalLight(0xffffff, 0.35); bounce.position.set(0.8, -4, 1.5); bounce.target.position.set(0, 1, 0);
scene.add(key, key.target, fill, fill.target, bounce, bounce.target);
renderer.shadowMap.transmitted = true; // (ombres colorées : la lumière qui traverse le papier)
const Lkey = new THREE.Vector3().subVectors(key.position, key.target.position).normalize();

// un fond : un grand disque de carton, rabattu vers la couleur du mur
{
  const col = new THREE.Color(AC.b2).lerp(new THREE.Color(AC.wall), 0.55);
  const d = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 0.06, 128), new THREE.MeshStandardNodeMaterial({ color: col, roughness: 0.6 }));
  d.rotation.x = Math.PI / 2 - 0.1; d.position.set(-0.75, 0.95, -1.9); d.scale.setScalar(0.7); d.castShadow = d.receiveShadow = true; scene.add(d);
}

// ── Le papier ──
// Attributs fixes par sommet : distance aux trois arêtes du triangle (une
// composante par coin, interpolée = distance à l'arête opposée), nature de ces
// arêtes (0 coupe, 1 montagne, 2 vallée, 3 rien), couleur recto / verso,
// position de repos (le grain suit le papier). Attributs recalculés à chaque
// image : la lumière que les pans voisins renvoient sur chaque face (bf, bb).
const G = { thru: uniform(+(Q.get('thru') || 0.2)), keyI: uniform(KEY_I), L: uniform(Lkey), bleed: uniform(+(Q.get('bleed') || 1.6)) };
const paper = new THREE.MeshPhysicalNodeMaterial({ side: THREE.DoubleSide, roughness: 0.82 });
{
  const ed = attribute('ed', 'vec3'), ek = attribute('ek', 'vec3');
  const cf = attribute('cf', 'vec3'), cb = attribute('cb', 'vec3'), rp = attribute('rp', 'vec3').toVarying();
  // le grain s'efface quand un pixel couvre plusieurs grains (de loin, il ne ferait que scintiller)
  const px = fwidth(rp.x).add(fwidth(rp.y)).add(fwidth(rp.z));
  const grain = mx_noise_float(rp.mul(260)).mul(0.6).add(mx_noise_float(rp.mul(900)).mul(0.4)).mul(smoothstep(1.2, 0.3, px.mul(900)));
  const mottle = mx_noise_float(rp.mul(38)).mul(0.035).add(1); // (nuage de la pâte, à l'échelle du centimètre)
  // un pli : la fibre cassée blanchit sur ~1,5 mm ; une coupe : la tranche montre l'âme blanche du papier
  const aa = (d) => max(fwidth(d), 1e-5);
  const lineOf = (d, k) => {
    const crease = step(0.5, k).mul(step(k, 2.5)), cut = float(1).sub(step(0.5, k));
    // (un filet plus fin qu'un pixel s'estompe au lieu de s'élargir : de loin, une coupe fermée n'est qu'un trait de cheveu)
    const wc = max(0.0016, aa(d).mul(1.5)), wt = max(0.0007, aa(d).mul(0.9));
    return vec2(float(1).sub(smoothstep(0, wc, d)).mul(crease).mul(min(float(0.0016).div(wc), 1)), float(1).sub(smoothstep(0, wt, d)).mul(cut).mul(0.7).mul(min(float(0.0007).div(wt), 1)));
  };
  const l3 = max(max(lineOf(ed.x, ek.x), lineOf(ed.y, ek.y)), lineOf(ed.z, ek.z));
  const front = frontFacing;
  const base = select(front, cf, cb);
  const c = mix(mix(base, base.mul(0.6).add(0.4), l3.x.mul(0.16)), vec3(0.93, 0.92, 0.9), l3.y).mul(grain.mul(0.05).add(1)).mul(mottle);
  paper.colorNode = c;
  paper.roughnessNode = float(0.82).add(grain.mul(0.08)).sub(l3.x.mul(0.12));
  // la dent du papier : un relief très fin qui accroche la lumière rasante
  const nW = normalize(attribute('normal', 'vec3')).toVarying();
  const tooth = smoothstep(1.2, 0.3, px.mul(1400));
  paper.normalNode = transformNormalToView(normalize(nW.mul(select(front, float(1), float(-1))).add(mx_noise_vec3(rp.mul(700)).mul(tooth.mul(0.015)))));
  // à contre-jour, un peu de lumière traverse ; elle garde la teinte de la face qu'on regarde
  const through = max(dot(nW, G.L).mul(select(front, float(-1), float(1))), 0).mul(G.keyI).mul(G.thru);
  // la couleur des pans voisins, renvoyée sur cette face (calculée sur le processeur, voir bleedPass)
  const bl = select(front, attribute('bf', 'vec3'), attribute('bb', 'vec3'));
  paper.emissiveNode = c.mul(bl).mul(G.bleed).add(c.mul(c.add(0.25)).mul(through.mul(0.6)));
  paper.sheen = 0.1; paper.sheenRoughness = 0.75;
  // l'ombre du papier n'est pas noire : un cinquième de la lumière la traverse et prend ses couleurs…
  paper.castShadowNode = vec4(cf.mul(cb).pow(vec3(0.5)).add(cf.add(cb).mul(0.25)).mul(0.3), 1);
  // … mais sur le papier lui-même elle ferait des taches (une encre à travers l'autre) : ombre neutre
  paper.receivedShadowNode = Fn(([shadow]) => { const l = dot(vec3(shadow), vec3(0.2126, 0.7152, 0.0722)); return vec3(l.mul(l.sqrt())); });
}

// La lumière qu'un pan renvoie sur un autre. Pour chaque sommet (un peu
// rentré vers le centre de son triangle), on somme les autres triangles de la
// tour : facteur de forme entre deux petits éléments (cos·cos·A / (πr² + A)),
// fois l'éclairement de la face du voisin tournée vers ce point. Le dehors
// d'une face reçoit la lampe (n·L) ; le dedans d'une tour fermée est dans
// l'ombre, il ne renvoie que la lumière ambiante. Sans occultation : les
// voisins utiles sont ceux d'un même étage, à moins d'un côté de distance.
const AMB = 0.35;
function bleedPass(pos, nor, cf, cb, bf, bb, T, reach) {
  const cx = new Float32Array(T * 3), ar = new Float32Array(T), rad = new Float32Array(T * 6);
  for (let t = 0; t < T; t++) {
    const o = t * 9;
    const ux = pos[o + 3] - pos[o], uy = pos[o + 4] - pos[o + 1], uz = pos[o + 5] - pos[o + 2], vx = pos[o + 6] - pos[o], vy = pos[o + 7] - pos[o + 1], vz = pos[o + 8] - pos[o + 2];
    ar[t] = 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    for (let k = 0; k < 3; k++) cx[t * 3 + k] = (pos[o + k] + pos[o + 3 + k] + pos[o + 6 + k]) / 3;
    const nl = nor[o] * Lkey.x + nor[o + 1] * Lkey.y + nor[o + 2] * Lkey.z;
    const eF = Math.max(nl, 0) * KEY_I * 0.25 + AMB, eB = AMB * 0.5;
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
        const ci = nx * hx + ny * hy + nz * hz; // > 0 : le voisin est devant le recto
        const q = j * 9, cj = -(nor[q] * hx + nor[q + 1] * hy + nor[q + 2] * hz); // > 0 : le voisin nous montre son recto
        const F = Math.abs(ci) * Math.abs(cj) * ar[j] / (Math.PI * r2 + ar[j]);
        const s = cj > 0 ? 0 : 3, R = rad[j * 6 + s], Gc = rad[j * 6 + s + 1], B = rad[j * 6 + s + 2];
        if (ci > 0) { fr += R * F; fg += Gc * F; fb += B * F; } else { br += R * F; bg += Gc * F; bbl += B * F; }
      }
      const w = o + v * 3;
      bf[w] = fr; bf[w + 1] = fg; bf[w + 2] = fb; bb[w] = br; bb[w + 1] = bg; bb[w + 2] = bbl;
    }
  }
}
// ── La dynamique ──
// Calculée une fois au chargement : deux cycles, on garde le second (il
// commence là où le premier finit, la boucle raccorde).
const LOOP = +(Q.get('loop') || DEFAULTS.loop);
hud.textContent = 'calcul de la dynamique…';
const SIM = simulate({ loop: LOOP });
const FPS = SIM.o.fps, NF = SIM.frames.length;
function stateAt(time) {
  const t = ((time % LOOP) + LOOP) % LOOP, u = t * FPS, i = Math.floor(u) % NF, j = (i + 1) % NF, f = u - Math.floor(u);
  const A = SIM.frames[i], B = SIM.frames[j], L = (a, b) => a + (b - a) * f;
  return { th: A.th.map((x, k) => L(x, B.th[k])), h: A.h.map((x, k) => L(x, B.h[k])), press: L(A.press, B.press) };
}
const BLEED = Q.get('bleed') !== '0';

// Assemblage : unités empilées, une sur deux en miroir (z → −z), plateaux
// partagés ; le plateau j monte de Σ h et tourne de Σ ±θ (comme p1).
function towerPose(P, st, gap) {
  const units = [], plates = [{ y: 0, psi: 0 }];
  let y = 0, psi = 0;
  st.h.forEach((h, j) => {
    const mirror = j % 2 === 1, p = poseAt(P, h, st.th[j], null, gap);
    const c = Math.cos(psi), s = Math.sin(psi);
    const W = (q) => { const z = mirror ? -q[2] : q[2]; return [q[0] * c + z * s, q[1] + y, -q[0] * s + z * c]; };
    units.push({ pts: unitPoints(p).map(W) });
    y += h; psi += mirror ? -st.th[j] : st.th[j];
    plates.push({ y, psi });
  });
  return { units, plates, height: y };
}

// ── La tour ──
const C = { n: SIM.o.n, l: SIM.o.l, units: SIM.o.units, rot: 0.25, out: [AC.a, AC.a2], in: [AC.b, AC.b2] };
const P = unitParams(C.n, SIM.o.alpha, C.l);
// écart entre deux triangles pressés : une épaisseur de papier (0,35 mm) vue
// depuis l'arête verticale, à la distance de l'apex
const GAP = 0.00035 / Math.sqrt(P.d * P.d - P.H0 * P.H0 / 4);
const N = C.units, n = C.n;
const tris = [];
{
  const base = unitTriangles(n);
  for (let j = 0; j < N; j++) for (const t of base) {
    const mirror = j % 2 === 1;
    const v = mirror ? [t.v[0], t.v[2], t.v[1]] : t.v, e = mirror ? [t.e[2], t.e[1], t.e[0]] : t.e;
    const u = j / Math.max(N - 1, 1);
    tris.push({ src: v.map((k) => ({ j, k })), e, cf: col3(C.out[0]).lerp(col3(C.out[1]), u), cb: col3(C.in[0]).lerp(col3(C.in[1]), u) });
  }
  for (let i = 0; i <= N; i++) for (let k = 0; k < n; k++) {
    const u = Math.min(i, N - 1) / Math.max(N - 1, 1), inC = col3(C.in[0]).lerp(col3(C.in[1]), u);
    tris.push({ src: [{ plate: i, c: true }, { plate: i, k }, { plate: i, k: (k + 1) % n }], e: [3, 1, 3], cf: inC, cb: inC, plate: true });
  }
}
const T = tris.length, V = T * 3;
const pos = new Float32Array(V * 3), nor = new Float32Array(V * 3), bf = new Float32Array(V * 3), bb = new Float32Array(V * 3);
const ed = new Float32Array(V * 3), ek = new Float32Array(V * 3), cf = new Float32Array(V * 3), cb = new Float32Array(V * 3), rp = new Float32Array(V * 3);
const poly = (i, k, pose) => { const pl = pose.plates[i], a = (2 * Math.PI * k) / n;
  const x = P.R * Math.cos(a), z = -P.R * Math.sin(a), c = Math.cos(pl.psi), s = Math.sin(pl.psi);
  return [x * c + z * s, pl.y, -x * s + z * c]; };
const P3 = (src, pose) => src.plate !== undefined ? (src.c ? [0, pose.plates[src.plate].y, 0] : poly(src.plate, src.k, pose)) : pose.units[src.j].pts[src.k];
function fillPose(pose) {
  for (let t = 0; t < T; t++) {
    const p = tris[t].src.map((s) => P3(s, pose));
    const ux = p[1][0] - p[0][0], uy = p[1][1] - p[0][1], uz = p[1][2] - p[0][2], vx = p[2][0] - p[0][0], vy = p[2][1] - p[0][1], vz = p[2][2] - p[0][2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
    for (let i = 0; i < 3; i++) { pos.set(p[i], (t * 3 + i) * 3); nor.set([nx, ny, nz], (t * 3 + i) * 3); }
  }
}
{ // attributs fixes, depuis la pose déployée
  const rest = towerPose(P, { th: Array(N).fill(0), h: Array(N).fill(P.H0) }, 0);
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
const fix = new THREE.InterleavedBuffer(new Float32Array(V * 15), 15);
for (let v = 0; v < V; v++) [ed, ek, cf, cb, rp].forEach((a, i) => fix.array.set(a.subarray(v * 3, v * 3 + 3), v * 15 + i * 3));
['ed', 'ek', 'cf', 'cb', 'rp'].forEach((k, i) => geo.setAttribute(k, new THREE.InterleavedBufferAttribute(fix, 3, i * 3)));
const dyn = new THREE.InterleavedBuffer(new Float32Array(V * 6), 6); dyn.setUsage(THREE.DynamicDrawUsage);
geo.setAttribute('bf', new THREE.InterleavedBufferAttribute(dyn, 3, 0)); geo.setAttribute('bb', new THREE.InterleavedBufferAttribute(dyn, 3, 3));
const tower = new THREE.Mesh(geo, paper);
tower.castShadow = tower.receiveShadow = true; tower.frustumCulled = false;

// ── La machine d'essai ──
// Un socle (le carter de l'entraînement), deux vis-mères, une traverse
// mobile qui porte le plateau du haut sur une butée à billes, une traverse
// fixe en tête. Le bâti est peint dans la valeur du décor ; ce qui agit
// (vis, écrous, plateaux) est en métal.
const steel = new THREE.MeshPhysicalNodeMaterial({ color: 0xdadde2, metalness: 1, roughness: 0.2 });
const brass = new THREE.MeshPhysicalNodeMaterial({ color: 0xd8b06a, metalness: 1, roughness: 0.26 });
const lacquer = new THREE.MeshPhysicalNodeMaterial({ color: col3(AC.floor).lerp(col3(AC.wall), 0.4).multiplyScalar(0.9), roughness: 0.42, clearcoat: 0.25, clearcoatRoughness: 0.35 });
const PITCH = 0.006;
const screwMat = new THREE.MeshPhysicalNodeMaterial({ color: 0xcfd3d8, metalness: 1, roughness: 0.3 });
{ // le filet : un relief hélicoïdal dans le repère de la vis (il tourne avec elle)
  const pl = positionLocal, ang = atan(pl.z, pl.x);
  const ph = pl.y.div(PITCH).sub(ang.div(2 * Math.PI)).fract();
  const prof = ph.mul(2).sub(1).abs().mul(2).sub(1); // triangle −1..1
  screwMat.normalNode = transformNormalToView(normalize(normalLocal.add(vec3(0, prof.mul(0.45), 0))));
  screwMat.colorNode = mix(vec3(0.55, 0.57, 0.6), vec3(0.85, 0.87, 0.9), smoothstep(-0.6, 0.6, prof));
}
const BASE_H = 0.07, PLATEN_H = 0.014, PLATEN_R = P.R * 1.32, Y0 = BASE_H + PLATEN_H;
const SX = 0.2, TRAV = SIM.top + PLATEN_H + 0.02 + 0.05, BEAM_Y = Y0 + TRAV + 0.09;
const machine = new THREE.Group();
const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; machine.add(m); return m; };
const rbox = (w, h, d) => new THREE.BoxGeometry(w, h, d, 1, 1, 1);
add(rbox(0.56, BASE_H, 0.26), lacquer, 0, BASE_H / 2, 0);
add(new THREE.CylinderGeometry(PLATEN_R, PLATEN_R, PLATEN_H, 96), brass, 0, BASE_H + PLATEN_H / 2, 0);
const screws = [-SX, SX].map((x) => add(new THREE.CylinderGeometry(0.011, 0.011, BEAM_Y - BASE_H, 48, 1), screwMat, x, (BEAM_Y + BASE_H) / 2, 0));
add(rbox(0.52, 0.05, 0.12), lacquer, 0, BEAM_Y + 0.025, 0);
for (const x of [-SX, SX]) add(new THREE.CylinderGeometry(0.02, 0.02, 0.016, 48), steel, x, BEAM_Y + 0.058, 0); // paliers
const head = new THREE.Group(); machine.add(head);
const hadd = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true; head.add(m); return m; };
// (la traverse mobile, repère : y = 0 au-dessus du plateau du haut)
hadd(rbox(0.48, 0.045, 0.11), lacquer, 0, 0.02 + 0.0225, 0);
for (const x of [-SX, SX]) hadd(new THREE.CylinderGeometry(0.026, 0.026, 0.075, 48), brass, x, 0.045, 0); // écrous
hadd(new THREE.CylinderGeometry(0.03, 0.034, 0.02, 48), steel, 0, 0.01, 0); // butée à billes
const topPlaten = new THREE.Mesh(new THREE.CylinderGeometry(PLATEN_R, PLATEN_R, PLATEN_H, 96), brass);
topPlaten.castShadow = topPlaten.receiveShadow = true;
scene.add(machine, tower, topPlaten);
machine.rotation.y = 0;
tower.position.set(0, Y0, 0); tower.rotation.y = C.rot;

function pose(time) {
  const st = stateAt(time), tp = towerPose(P, st, GAP);
  fillPose(tp);
  if (BLEED) {
    bleedPass(pos, nor, cf, cb, bf, bb, T, C.l * 1.3);
    const d = dyn.array; for (let v = 0; v < V; v++) { d.set(bf.subarray(v * 3, v * 3 + 3), v * 6); d.set(bb.subarray(v * 3, v * 3 + 3), v * 6 + 3); }
    dyn.needsUpdate = true;
  }
  geo.attributes.position.needsUpdate = geo.attributes.normal.needsUpdate = true;
  const yTop = Y0 + tp.height, top = tp.plates[N];
  topPlaten.position.set(0, yTop + PLATEN_H / 2 + 0.0003, 0); topPlaten.rotation.y = C.rot + top.psi;
  head.position.y = yTop + PLATEN_H;
  // les vis tournent d'un tour par pas de course
  const spin = ((SIM.top - st.press) / PITCH) * 2 * Math.PI;
  screws[0].rotation.y = spin; screws[1].rotation.y = spin;
  return st;
}

const post = createPost(renderer, scene, camera);
const RENDER = {
  aa: Q.get('aa') || 'traa', toneMapping: 'aces', exposure: 1, contrast: 1, saturation: 1, warmth: 0, vignette: 0.25,
  bloom: true, bloomStrength: 0.08, bloomRadius: 0.5, bloomThreshold: 1.4, hiCap: 6,
  ao: true, aoStrength: 1, aoRadius: 0.2, gi: Q.get('gi') !== '0', giIntensity: 1, giRadius: 6,
  ssr: false, dof: true, focus: 2.6, focusRange: 0.8, bokeh: 2,
  motionBlur: 0, ca: 0.05, grain: 0.02, streaks: 0, halation: 0, dirt: 0,
};
function draw() { const d = camera.position.distanceTo(controls.target); RENDER.focus = d; RENDER.focusRange = 0.3 * d; post.update(RENDER, null); post.render(); }
// caméra : une lente dérive, périodique sur la boucle
function cam(t) {
  const w = (2 * Math.PI * t) / LOOP, a = 0.3 + 0.12 * Math.sin(w), d = 2.2 + 0.08 * Math.cos(w);
  camera.position.set(d * Math.sin(a), 0.6 + 0.05 * Math.sin(w + 1), d * Math.cos(a));
  controls.target.set(0, 0.47, 0); camera.lookAt(controls.target);
}
pose(0);
window.p2 = { renderer, scene, camera, controls, SIM, stateAt, G, pose, draw, errors, RENDER, key, cam };
let fps = 0;
if (Q.get('run') !== '0') {
  const t0 = performance.now(); let last = t0;
  renderer.setAnimationLoop(() => {
    const now = performance.now(); fps += (1000 / Math.max(now - last, 1) - fps) * 0.05; last = now;
    const t = (now - t0) / 1000; pose(t); if (Q.get('orbit') !== '0') cam(t); draw();
    hud.textContent = `${fps.toFixed(0)} i/s`;
  });
} else hud.textContent = '';
window.p2.fps = () => fps;

function messageClock() {
  let id = 0; const pending = new Map(), mc = new MessageChannel();
  mc.port1.onmessage = (e) => { const f = pending.get(e.data); pending.delete(e.data); f?.(performance.now()); };
  return { requestAnimationFrame: (f) => { pending.set(++id, f); mc.port2.postMessage(id); return id; }, cancelAnimationFrame: (i) => pending.delete(i) };
}
// Captures : rendues dans la boucle d'animation, envoyées à un collecteur local.
window.p2.capture = (shots, sink = `http://127.0.0.1:${Q.get('sink') || 8197}/`, settle = 6) => new Promise((done) => {
  let i = 0, k = 0, busy = false;
  const A = renderer._animation, ctx0 = A._context;
  // (toujours : un panneau caché peut se dire visible et ne plus recevoir d'images)
  // (la boucle attend encore une image de l'ancienne horloge : on la relance sur la nouvelle)
  renderer.setAnimationLoop(null); A.stop(); A.setContext(messageClock()); A.start();
  renderer.setAnimationLoop(async () => {
    if (busy) return;
    const s = shots[i];
    if (s.cam) { camera.position.set(...s.cam); controls.target.set(...s.look); camera.lookAt(...s.look); } else cam(s.t);
    pose(s.t); draw();
    if (++k < settle) return;
    busy = true; k = 0;
    const b = await new Promise((r) => renderer.domElement.toBlob(r, 'image/jpeg', 0.92));
    await fetch(sink + s.name, { method: 'POST', body: b });
    busy = false;
    if (++i >= shots.length) { renderer.setAnimationLoop(null); A.stop(); A.setContext(ctx0); A.start(); done(i); }
  });
});
