// Les décors : une pièce par humeur, chacune son fond, son sol, sa table et
// ses accessoires. Le banc pose sur la table (dessus à y = 0) ; tout est à
// l'échelle réelle (1 unité = 25 cm).
//
// Matières des murs et des sols : motifs procéduraux en coordonnées du monde
// (briques, lames de parquet, plâtre chaulé, quadrillage, carreaux, béton),
// lus dans le volume de bruit. Éclairage sélectif : le décor ne reçoit que la
// lampe et la lumière du lieu (les contre-jours n'effacent pas les ombres).
import * as THREE from 'three/webgpu';
import {
  positionWorld, length, color, vec2, vec3, vec4, float, uniform, mix, smoothstep, fract, floor, abs, step, max as tmax, min as tmin, lights, sin, normalWorld, clamp,
} from 'three/tsl';
import { noise, noise2, fbm } from './materials.js';
import { createRng } from '../rng.js';

const H = 2.8; // hauteur de la table (u)

// matériau du décor : couleur, rugosité, émission (nœuds) ; lit = [lampes]
function decorMat({ color, rough = 0.85, metal = 0, emissive = null, clearcoat = 0 }, lit) {
  const m = new THREE.MeshPhysicalNodeMaterial();
  m.colorNode = vec4(color, 1);
  m.roughnessNode = typeof rough === 'number' ? float(rough) : rough;
  m.metalnessNode = float(metal);
  if (clearcoat) { m.clearcoatNode = float(clearcoat); m.clearcoatRoughnessNode = float(0.2); }
  if (emissive) m.emissiveNode = emissive;
  if (lit) m.lightsNode = lights(lit);
  return m;
}
// (color() et non vec3(new Color()) : ce dernier donne une couleur fausse, presque noire)
const C = (hex) => color(new THREE.Color(hex));
const P = positionWorld;

// ── Motifs ───────────────────────────────────────────────────────────────────
// plâtre chaulé : voile irrégulier, coups de brosse
const plaster = (a, b, s = 1) => mix(C(a), C(b), smoothstep(-0.4, 0.6, fbm(P.mul(0.35 * s), 4)).mul(0.7).add(noise2(P.mul(vec3(3, 0.6, 3))).mul(0.15)));
// briques (plan x = const ou z = const : u horizontal, v vertical)
function brick(u, v, a, b, mortar) {
  const bh = 0.26, bw = 0.85; // (6,5 × 21 cm)
  const row = floor(v.div(bh)), uu = u.div(bw).add(row.mul(0.5));
  const fu = fract(uu), fv = fract(v.div(bh));
  const joint = tmax(smoothstep(0.05, 0.0, fu).add(smoothstep(0.95, 1.0, fu)), smoothstep(0.1, 0.0, fv).add(smoothstep(0.9, 1.0, fv))).min(1);
  const id = floor(uu).add(row.mul(17.3));
  const tone = noise(vec3(id, row, 0.5).mul(0.71)).mul(0.5).add(0.5);
  const col = mix(C(a), C(b), tone).mul(noise2(vec3(u, v, 0).mul(9)).mul(0.12).add(0.94));
  return { col: mix(col, C(mortar), joint), joint };
}
// lames de parquet (le long de x)
function planks(a, b) {
  const w = 0.55, row = floor(P.z.div(w)), off = noise(vec3(row, 0.3, 0.7)).mul(7);
  const x = P.x.add(off), seg = floor(x.div(5.5));
  const seam = smoothstep(0.035, 0.0, fract(P.z.div(w))).max(smoothstep(0.012, 0.0, fract(x.div(5.5))));
  const grain = noise(vec3(x.mul(0.25), P.z.mul(9), seg)).mul(0.5).add(0.5);
  const tone = noise2(vec3(row, seg, 2.2)).mul(0.5).add(0.5);
  return { col: mix(mix(C(a), C(b), grain.mul(0.6).add(tone.mul(0.4))), C(b).mul(0.4), seam), seam };
}

// ── Constructeurs ────────────────────────────────────────────────────────────
function add(group, geo, mat, { cast = false, receive = true } = {}) {
  const m = new THREE.Mesh(geo, mat);
  m.castShadow = cast; m.receiveShadow = receive;
  group.add(m);
  return m;
}
const boxGeo = (w, h, d, x, y, z) => new THREE.BoxGeometry(w, h, d).translate(x, y, z);
const planeXZ = (w, d, y) => new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2).translate(0, y, 0);

// table (dessus à y = 0)
function table(group, kind, mat, legMat) {
  if (kind === 'plinth') { add(group, boxGeo(5, H, 2.2, 0, -H / 2, 0), mat, { cast: true }); return; }
  add(group, boxGeo(5.2, 0.22, 2.2, 0, -0.11, 0), mat, { cast: true });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) add(group, boxGeo(0.22, H - 0.22, 0.22, sx * 2.3, -0.22 - (H - 0.22) / 2, sz * 0.85), legMat, { cast: true });
  add(group, boxGeo(4.6, 0.16, 0.12, 0, -H + 0.5, 0), legMat, { cast: true });
}

// une pièce de cyclorama (sol qui se courbe en mur) : profil en L arrondi, extrudé en x
function cyclorama(width, depth, height, radius) {
  const shape = [];
  const n = 16;
  shape.push([depth, 0]);
  for (let i = 0; i <= n; i++) { const a = (i / n) * Math.PI / 2; shape.push([-depth + radius - Math.sin(a) * radius, radius - Math.cos(a) * radius]); }
  shape.push([-depth, height]);
  const pos = [], idx = [];
  const cols = 2;
  for (let j = 0; j < shape.length; j++) for (let i = 0; i < cols; i++) { const [z, y] = shape[j]; pos.push((i / (cols - 1) - 0.5) * width, y, z); }
  for (let j = 0; j + 1 < shape.length; j++) { const a = j * cols, b = (j + 1) * cols; idx.push(a, a + 1, b + 1, a, b + 1, b); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

export function createDecor(scene) {
  const group = new THREE.Group();
  scene.add(group);
  let kind = '';

  function clear() {
    group.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
    group.clear();
  }

  // lit : lumières qui éclairent le décor (lampe, lieu)
  function setRecipe(R, B, lit) {
    clear();
    kind = R.decor.kind;
    const rng = createRng(`${R.seed}-decor`);
    const floorY = -H;
    const tableMat = (fin) => decorMat({ color: C(fin.outer.color), rough: fin.outer.rough, metal: fin.outer.metal, clearcoat: fin.outer.clearcoat }, lit);
    const tf = R.bench.table;
    const woodTop = (a, b) => decorMat({ color: mix(C(a), C(b), noise(P.mul(vec3(0.4, 3, 6))).mul(0.5).add(0.5)), rough: 0.5, clearcoat: 0.3 }, lit);

    switch (kind) {
      case 'corderie': {
        const fl = planks('#6e4e30', '#3d2a19');
        add(group, planeXZ(60, 60, floorY), decorMat({ color: fl.col, rough: 0.7 }, lit));
        // longue halle : mur de briques à gauche, percé de fenêtres en arc (lumière), mur du fond lointain
        const wx = -7.5;
        const wall = brick(P.z, P.y, '#8a4a32', '#6b3524', '#b9ab95');
        // fenêtre en plein cintre : un rectangle et un demi-disque (bords doux)
        const win = (zc) => {
          const dz = abs(P.z.sub(zc)), y0 = floorY + 1.2, y1 = floorY + 3.4;
          const rect = smoothstep(0.92, 0.88, dz).mul(smoothstep(y0 - 0.02, y0 + 0.02, P.y)).mul(smoothstep(y1 + 0.02, y1 - 0.02, P.y));
          const arch = smoothstep(0.92, 0.88, vec2(dz, P.y.sub(y1)).length()).mul(step(y1, P.y));
          return rect.max(arch);
        };
        let open = float(0);
        for (let k = -3; k <= 3; k++) open = open.max(win(k * 4.2 + 1));
        const wm = decorMat({ color: wall.col.mul(open.oneMinus()), rough: 0.9, emissive: C('#fff4e0').mul(open).mul(2.2) }, lit);
        add(group, new THREE.PlaneGeometry(60, 14).rotateY(Math.PI / 2).translate(wx, floorY + 7, 0), wm);
        add(group, new THREE.PlaneGeometry(30, 14).translate(0, floorY + 7, -26), decorMat({ color: brick(P.x, P.y, '#7a4330', '#5c2e20', '#a89a85').col.mul(0.7), rough: 0.9 }, lit));
        add(group, new THREE.PlaneGeometry(60, 14).rotateY(-Math.PI / 2).translate(9, floorY + 7, 0), decorMat({ color: plaster('#bfb39c', '#9c8f78'), rough: 0.95 }, lit));
        // rouleaux de cordage posés au sol, au loin
        const coilMat = decorMat({ color: mix(C('#a8875a'), C('#7a5f3a'), sin(P.y.mul(60).add(P.x.mul(30))).mul(0.5).add(0.5)), rough: 0.9 }, lit);
        for (let i = 0; i < 6; i++) {
          const x = rng.range(-6, 6), z = rng.range(-22, -6), r = rng.range(0.5, 0.9);
          for (let k = 0; k < 5; k++) add(group, new THREE.TorusGeometry(r - k * 0.05, 0.12, 10, 40).rotateX(Math.PI / 2).translate(x, floorY + 0.12 + k * 0.2, z), coilMat, { cast: true });
        }
        table(group, 'table', tableMat(tf), woodTop('#7a5a3a', '#4e3622'));
        break;
      }
      case 'cabinet': {
        const fl = planks('#3a2618', '#1c120b');
        add(group, planeXZ(40, 40, floorY), decorMat({ color: fl.col, rough: 0.45, clearcoat: 0.4 }, lit));
        // boiseries : panneaux à moulures (cadres) sur le mur du fond
        const z0 = -4.2;
        const wood = mix(C('#3b2416'), C('#1e120a'), noise(P.mul(vec3(0.3, 4, 0.3))).mul(0.5).add(0.5));
        add(group, new THREE.PlaneGeometry(40, 14).translate(0, floorY + 7, z0), decorMat({ color: wood.mul(0.8), rough: 0.5, clearcoat: 0.5 }, lit));
        const frame = decorMat({ color: wood, rough: 0.4, clearcoat: 0.6 }, lit);
        for (let i = -4; i <= 4; i++) for (const [y0, h] of [[floorY + 0.4, 2.6], [floorY + 3.6, 4.2]]) {
          const x = i * 2.6, w = 2.2;
          for (const [dx, dy, ww, hh] of [[0, 0, w, 0.12], [0, h, w, 0.12], [-w / 2, h / 2, 0.12, h], [w / 2, h / 2, 0.12, h]]) add(group, boxGeo(ww + 0.12, hh, 0.1, x + dx, y0 + dy, z0 + 0.05), frame);
        }
        add(group, boxGeo(40, 0.18, 0.2, 0, floorY + 3.3, z0 + 0.1), frame); // (cimaise)
        // une planche gravée encadrée (un diagramme, sombre et lumineux)
        add(group, boxGeo(2.2, 1.6, 0.06, -3.4, floorY + 5.6, z0 + 0.14), decorMat({ color: C('#d8ccb0').mul(smoothstep(0.02, 0.0, abs(fract(P.x.mul(3)).sub(0.5)).mul(0.1)).oneMinus().mul(0.8).add(0.2)), rough: 0.8 }, lit));
        table(group, 'table', tableMat(tf), woodTop('#3b2416', '#1e120a'));
        break;
      }
      case 'epure': {
        const g = cyclorama(40, 9, 16, 3).translate(0, floorY, 0);
        add(group, g, decorMat({ color: plaster('#e9e7e2', '#dcd9d2', 0.5), rough: 0.92 }, lit));
        table(group, 'plinth', decorMat({ color: plaster('#f0eee9', '#e2dfd8', 2), rough: 0.9 }, lit));
        break;
      }
      case 'muybridge': {
        // mur noir quadrillé de lignes blanches (5 cm), sol noir
        const z0 = -3.4;
        add(group, planeXZ(40, 40, floorY), decorMat({ color: C('#0b0b0c'), rough: 0.6 }, lit));
        const cell = 0.2, gl = (x) => smoothstep(0.012, 0.004, abs(fract(x.div(cell)).sub(0.5)).mul(cell).sub(cell / 2 - 0.012).abs());
        const bold = (x) => smoothstep(0.02, 0.008, abs(fract(x.div(cell * 5)).sub(0.5)).mul(cell * 5).sub(cell * 2.5 - 0.02).abs());
        const line = tmax(gl(P.x), gl(P.y)).mul(0.55).max(tmax(bold(P.x), bold(P.y)));
        add(group, new THREE.PlaneGeometry(40, 16).translate(0, floorY + 8, z0), decorMat({ color: mix(C('#090909'), C('#d8d8d2'), line), rough: 0.8, emissive: C('#ffffff').mul(line).mul(0.05) }, lit));
        table(group, 'plinth', decorMat({ color: C('#0e0e10'), rough: 0.5 }, lit));
        break;
      }
      case 'mercerie': {
        const fl = planks('#5a3a22', '#2e1d10');
        add(group, planeXZ(40, 40, floorY), decorMat({ color: fl.col, rough: 0.55 }, lit));
        // mur de casiers : tiroirs à boutons, étagères de bobines de fil
        const z0 = -4.6;
        const wood = mix(C('#6b4528'), C('#3e2614'), noise(P.mul(vec3(0.5, 6, 0.5))).mul(0.5).add(0.5));
        add(group, new THREE.PlaneGeometry(40, 14).translate(0, floorY + 7, z0), decorMat({ color: wood.mul(0.55), rough: 0.6 }, lit));
        const wmat = decorMat({ color: wood, rough: 0.45, clearcoat: 0.4 }, lit);
        for (let r = 0; r < 4; r++) for (let c = -6; c <= 6; c++) add(group, boxGeo(1.45, 0.75, 0.3, c * 1.55, floorY + 0.5 + r * 0.85, z0 + 0.15), wmat);
        for (let r = 0; r < 3; r++) add(group, boxGeo(22, 0.1, 0.9, 0, floorY + 4.3 + r * 1.3, z0 + 0.45), wmat);
        const hues = ['#b3261e', '#d9a640', '#2c4f9a', '#2d5a45', '#7d1420', '#e6dfd0', '#5a2d6e', '#d0581c', '#1d2b4a', '#c9a6c4'];
        const spoolGeo = new THREE.CylinderGeometry(0.16, 0.16, 0.42, 20);
        for (let r = 0; r < 3; r++) for (let i = 0; i < 46; i++) {
          const col = hues[(i * 7 + r * 3) % hues.length];
          add(group, spoolGeo.clone().translate(-10.5 + i * 0.46 + rng.range(-0.05, 0.05), floorY + 4.56 + r * 1.3, z0 + 0.35 + rng.range(-0.1, 0.15)),
            decorMat({ color: C(col).mul(sin(P.y.mul(160)).mul(0.08).add(0.92)), rough: 0.7 }, lit), { cast: false });
        }
        table(group, 'table', tableMat(tf), woodTop('#4e3020', '#2a180c'));
        break;
      }
      case 'essais': {
        // béton, mur peint à mi-hauteur, tuyauteries, tubes au plafond
        const conc = mix(C('#7d8084'), C('#5d6064'), fbm(P.mul(0.6), 4).mul(0.5).add(0.5));
        add(group, planeXZ(60, 60, floorY), decorMat({ color: conc, rough: 0.85 }, lit));
        const z0 = -5.5, split = floorY + 4.2;
        const wcol = mix(C('#4f6a62'), C('#d9d6cc'), step(split, P.y)).mul(fbm(P.mul(0.8), 2).mul(0.06).add(1));
        add(group, new THREE.PlaneGeometry(60, 16).translate(0, floorY + 8, z0), decorMat({ color: wcol, rough: 0.7 }, lit));
        add(group, boxGeo(60, 0.08, 0.05, 0, split, z0 + 0.03), decorMat({ color: C('#2a2f30'), rough: 0.5 }, lit));
        const pipe = decorMat({ color: C('#8d4b2a'), rough: 0.5, metal: 0.6 }, lit);
        for (const [y, r] of [[floorY + 6.5, 0.18], [floorY + 7.2, 0.1]]) add(group, new THREE.CylinderGeometry(r, r, 60, 16).rotateZ(Math.PI / 2).translate(0, y, z0 + 0.4), pipe);
        const tubeMat = decorMat({ color: C('#ffffff'), rough: 0.3, emissive: C('#eaf4ff').mul(3) }, lit);
        for (const x of [-4, 0, 4]) add(group, new THREE.CylinderGeometry(0.06, 0.06, 4.5, 12).rotateZ(Math.PI / 2).translate(x, floorY + 9.5, -1), tubeMat);
        table(group, 'table', tableMat(tf), decorMat({ color: C('#1b1d1f'), rough: 0.4, metal: 0.7 }, lit));
        break;
      }
      case 'midi': {
        // mur chaulé, dallage de pierre
        const stone = (() => {
          const s = 1.6, fx = fract(P.x.div(s)), fz = fract(P.z.div(s).add(floor(P.x.div(s)).mul(0.37)));
          const joint = tmax(smoothstep(0.02, 0, fx).add(smoothstep(0.98, 1, fx)), smoothstep(0.02, 0, fz).add(smoothstep(0.98, 1, fz))).min(1);
          return mix(mix(C('#cdbfa4'), C('#b3a184'), fbm(P.mul(0.9), 3).mul(0.5).add(0.5)), C('#8c7d64'), joint);
        })();
        add(group, planeXZ(60, 60, floorY), decorMat({ color: stone, rough: 0.8 }, lit));
        add(group, new THREE.PlaneGeometry(60, 18).translate(0, floorY + 9, -3.2), decorMat({ color: plaster('#f1ede4', '#ddd6c8', 0.8), rough: 0.95 }, lit));
        table(group, 'table', tableMat(tf), woodTop('#8a6a46', '#5e4430'));
        break;
      }
      default: break;
    }
  }

  return { group, setRecipe, get kind() { return kind; } };
}
