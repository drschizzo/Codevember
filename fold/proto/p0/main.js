// Fold · essai p0 : le papier duotone.
// Le film de la feuille est calculé une fois (bake.worker.js) ; ici, la carte
// graphique le relit : positions et normales par image, et la couleur que
// chaque pan renvoie sur le pan d'en face.
import * as THREE from 'three/webgpu';
import { Fn, Loop, uniform, float, int, ivec2, vec2, vec3, vec4, mix, smoothstep, attribute, frontFacing, select, textureLoad, max, min, abs, dot, normalize, length, floor, fract, sqrt, cos, sin, transformNormalToView, mx_noise_float, positionLocal } from 'three/tsl';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { makeEnvironment } from '../../../shared/scene/env.js';
import { createPost } from '../../../shared/render/post.js';

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
const lin = (hex) => vec3(...new THREE.Color(hex).toArray());

const renderer = new THREE.WebGPURenderer({ antialias: false, powerPreference: 'high-performance' });
await renderer.init();
renderer.setPixelRatio(1); renderer.setSize(W, H);
document.body.appendChild(renderer.domElement);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
scene.background = new THREE.Color(AC.wall);
scene.environment = makeEnvironment('cyclo', 0, 512);
scene.environmentIntensity = 0.16;
const camera = new THREE.PerspectiveCamera(26, W / H, 0.2, 80);
camera.position.set(...(Q.get('cam') || '1.5,1.5,5.2').split(',').map(Number));
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(...(Q.get('look') || '-0.1,0.78,0.3').split(',').map(Number)); controls.update();

// ── Décor : cyclorama ──
{
  const pts = [], R0 = 14, f = 2.5;
  for (let i = 0; i <= 24; i++) { const a = (i / 24) * Math.PI / 2; pts.push(new THREE.Vector2(R0 - f + f * Math.sin(a), f - f * Math.cos(a))); }
  pts.unshift(new THREE.Vector2(0, 0)); pts.push(new THREE.Vector2(R0, 12));
  const cyc = new THREE.Mesh(new THREE.LatheGeometry(pts, 96), new THREE.MeshStandardNodeMaterial({ color: AC.floor, roughness: 0.62, side: THREE.DoubleSide }));
  cyc.receiveShadow = true; scene.add(cyc);
}
const KEY_I = 3.4;
const key = new THREE.DirectionalLight(0xfff4ea, KEY_I);
key.position.set(-3.2, 5.5, 2.4); key.target.position.set(0, 1, 0); scene.add(key, key.target);
key.castShadow = true; key.shadow.mapSize.set(4096, 4096);
Object.assign(key.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3, near: 1, far: 14 });
key.shadow.radius = 4; key.shadow.bias = -0.0006; key.shadow.normalBias = 0.01;
const fill = new THREE.DirectionalLight(0xcfe4ff, 1.6); fill.position.set(4, 1.2, 2.5); fill.target.position.set(0, 1, 0);
const bounce = new THREE.DirectionalLight(new THREE.Color(AC.floor), 1.3); bounce.position.set(0.8, -4, 1.5); bounce.target.position.set(0, 1, 0);
scene.add(fill, fill.target, bounce, bounce.target);

// ── Les feuilles ──
const dataTex = (arr, w, h) => { const t = new THREE.DataTexture(arr, w, h, THREE.RGBAFormat, THREE.FloatType); t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true; return t; };
const brass = new THREE.MeshStandardNodeMaterial({ color: '#e6d3ad', metalness: 1, roughness: 0.3 });
let done = 0;
const progress = [];
async function addSheet(C, idx) {
  const M = await new Promise((res) => {
    const w = new Worker(new URL('./bake.worker.js', import.meta.url), { type: 'module' });
    w.onmessage = ({ data }) => { if (data.done) { res(data); w.terminate(); } else { progress[idx] = data.progress; hud.textContent = `pliage… ${Math.round(100 * progress.reduce((a, b) => a + b, 0) / SHEETS.length)} %`; } };
    w.onerror = (e) => errors.push('worker ' + e.message);
    w.postMessage({ sheet: { n: C.n, rings: C.rings, sub: 2, m: C.m, hole: C.hole ?? 0.08 }, film: { amp: C.amp ?? 2.0, open: C.open ?? 0.3 } });
  });
  const { RN, F1, K } = M;
  const posTex = dataTex(M.pos, RN, F1), norTex = dataTex(M.nor, RN, F1), nearTex = dataTex(M.near, RN, K);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(M.rest, 3));
  geo.setAttribute('crease', new THREE.BufferAttribute(M.crease, 1));
  geo.setAttribute('rid', new THREE.BufferAttribute(Float32Array.from({ length: RN }, (_, i) => i), 1));
  geo.setIndex(new THREE.BufferAttribute(M.index, 1));
  const U = { frame: uniform(0), turn: uniform(0), L: uniform(new THREE.Vector3()) };
  const paper = new THREE.MeshPhysicalNodeMaterial({ side: THREE.DoubleSide, roughness: 0.8 });
  const f0 = floor(U.frame).toInt(), ft = fract(U.frame);
  const at = (tex, id) => mix(textureLoad(tex, ivec2(id, f0)).xyz, textureLoad(tex, ivec2(id, f0.add(1))).xyz, ft);
  const rid = attribute('rid').toInt();
  const P = at(posTex, rid), Nl = normalize(at(norTex, rid));
  const rest = attribute('position'), rr = length(rest.xz);
  const top = mix(lin(C.top[0]), lin(C.top[1]), smoothstep(0.1, 1.0, rr)), bot = mix(lin(C.bot[0]), lin(C.bot[1]), smoothstep(0.2, 1.1, rr));
  // ce que les pans d'en face renvoient sur ce sommet, côté recto (+1) ou verso (−1)
  const bleed = (side) => Fn(() => {
    const acc = vec3(0).toVar();
    Loop(K, ({ i }) => {
      const e = textureLoad(nearTex, ivec2(rid, i)), j = e.x.toInt(), A = e.y;
      const d = at(posTex, j).sub(P), r2 = dot(d, d).add(1e-7), dh = d.div(sqrt(r2)), m = normalize(at(norTex, j));
      const ci = dot(Nl, dh).mul(side), cj = dot(m, dh);
      const sj = select(cj.lessThan(0), float(1), float(-1)); // (la face du voisin tournée vers ce sommet)
      const E = max(dot(m, U.L).mul(sj), 0).mul(G.keyI).add(G.amb);
      const F = max(ci, 0).mul(abs(cj)).mul(A).div(r2.mul(Math.PI).add(A));
      acc.addAssign(select(sj.greaterThan(0), top, bot).mul(E).mul(F));
    });
    return acc;
  })().toVarying();
  const bF = bleed(1), bB = bleed(-1), nV = Nl.toVarying(), cr = attribute('crease').toVarying();
  paper.positionNode = P;
  paper.normalNode = transformNormalToView(nV);
  // le papier : grain, pliures marquées (la fibre blanchit là où elle a été cassée)
  const c0 = cos(U.turn), s0 = sin(U.turn), rp = vec3(rest.x.mul(c0).sub(rest.z.mul(s0)), 0, rest.x.mul(s0).add(rest.z.mul(c0))).toVarying();
  const grain = mx_noise_float(rp.mul(260)).mul(0.5).add(mx_noise_float(rp.mul(900)).mul(0.5));
  const line = float(1).sub(smoothstep(0.0, 0.16, cr));
  const base = select(frontFacing, top, bot);
  const col = mix(base, base.add(0.25), line.mul(0.35)).mul(grain.mul(0.06).add(1));
  paper.colorNode = col;
  paper.roughnessNode = float(0.78).add(grain.mul(0.08)).add(line.mul(0.1));
  const facing = select(frontFacing, float(1), float(-1));
  const through = max(dot(nV, U.L).mul(facing).negate(), 0).mul(G.keyI).mul(G.thru);
  paper.emissiveNode = col.mul(select(frontFacing, bF, bB)).mul(G.bleed).add(select(frontFacing, bot, top).mul(col).mul(through));
  paper.sheen = 0.12; paper.sheenRoughness = 0.7;
  const sheet = new THREE.Mesh(geo, paper);
  sheet.castShadow = sheet.receiveShadow = true; sheet.frustumCulled = false;
  sheet.scale.setScalar(C.size); sheet.position.set(C.at[0], C.y, C.at[1]);
  // la tige, sa bague et son pied
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, C.y, 20), brass); rod.position.set(C.at[0], C.y / 2, C.at[1]); rod.castShadow = true;
  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.022, 24, 16), brass); cap.position.set(C.at[0], C.y, C.at[1]); cap.castShadow = true;
  const foot = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.11, 0.022, 48), brass); foot.position.set(C.at[0], 0.011, C.at[1]); foot.castShadow = foot.receiveShadow = true;
  scene.add(sheet, rod, cap, foot);
  const up = new THREE.Vector3(0, 1, 0);
  return { M, U, sheet, pose(t) {
    const tt = t + C.phase, h = Math.floor(tt), u = tt - h;
    U.frame.value = Math.min(u * (F1 - 1), F1 - 1.001);
    U.turn.value = h * M.w;
    sheet.rotation.y = C.rot - h * M.w;
    U.L.value.copy(key.position).sub(key.target.position).normalize().applyAxisAngle(up, -sheet.rotation.y);
  } };
}
const G = { keyI: uniform(KEY_I), amb: uniform(0.5), bleed: uniform(+(Q.get('bleed') || 3)), thru: uniform(+(Q.get('thru') || 0.22)) };
const FINE = +(Q.get('fine') || 1);
const SHEETS = [
  { n: 4, rings: 16, m: Math.round(16 * FINE), size: 1.0, at: [0, 0], y: 1.12, rot: 0.6, phase: 0, top: [AC.a, AC.a2], bot: [AC.b, AC.b2] },
  { n: 64, rings: 12, m: Math.round(14 * FINE), size: 0.62, at: [-1.25, 0.75], y: 0.62, rot: 0.2, phase: 0.37, top: [AC.b2, AC.b], bot: [AC.a2, AC.a], hole: 0.14 },
  { n: 6, rings: 11, m: Math.round(13 * FINE), size: 0.5, at: [0.95, 1.15], y: 0.42, rot: 0.3, phase: 0.71, top: [AC.c, AC.a], bot: [AC.b2, AC.b] },
].slice(0, +(Q.get('sheets') || 3));
const sheets = await Promise.all(SHEETS.map(addSheet));

const post = createPost(renderer, scene, camera);
const RENDER = {
  aa: 'smaa', toneMapping: 'aces', exposure: 1, contrast: 1.04, saturation: 1.06, warmth: 0, vignette: 0.25,
  bloom: true, bloomStrength: 0.08, bloomRadius: 0.5, bloomThreshold: 1.4, hiCap: 6,
  ao: true, aoStrength: 1, aoRadius: 0.25, ssr: false, dof: true, focus: 4.0, focusRange: 1.3, bokeh: 2.5,
  motionBlur: 0, ca: 0.05, grain: 0.02, streaks: 0, halation: 0, dirt: 0,
};

// t : temps en demi-cycles (un demi-cycle = une bascule de la selle)
const HALF = +(Q.get('half') || 7);
const pose = (t) => { for (const s of sheets) s.pose(t); };
function draw() { RENDER.focus = camera.position.distanceTo(controls.target); post.update(RENDER, null); post.render(); }
async function send(name, url = `http://127.0.0.1:${Q.get('sink') || 8098}/`) {
  for (let i = 0; i < 6; i++) draw();
  const b = await new Promise((r) => renderer.domElement.toBlob(r, 'image/jpeg', 0.92));
  await fetch(url + name, { method: 'POST', body: b });
  return b.size;
}
pose(0);
hud.textContent = sheets.map((s) => `${s.M.RN} sommets`).join(' · ');
window.p0 = { renderer, scene, camera, controls, sheets, G, pose, draw, send, errors, RENDER, key, fill, bounce };
// caméra : un lent va-et-vient autour des trois pièces, qui s'approche de la grande
function cam(t) {
  const a = 0.25 + 0.5 * Math.sin(t * 0.35), d = 3.9 + 0.9 * Math.cos(t * 0.5);
  camera.position.set(-0.1 + d * Math.sin(a), 1.25 + 0.25 * Math.sin(t * 0.27), 0.3 + d * Math.cos(a));
  controls.target.set(-0.1, 0.82, 0.3); camera.lookAt(controls.target);
}
let fps = 0;
if (Q.get('run') !== '0') { const t0 = performance.now(); let last = t0; renderer.setAnimationLoop(() => { const now = performance.now(); fps += (1000 / Math.max(now - last, 1) - fps) * 0.05; last = now; const t = (now - t0) / 1000 / HALF; pose(t); cam(t); draw(); hud.textContent = `${fps.toFixed(0)} i/s`; }); }
window.p0.cam = cam; window.p0.fps = () => fps;
