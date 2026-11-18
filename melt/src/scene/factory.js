// L'usine : tout ce qui n'est pas la cire. Construite d'après la recette (une
// graine = une usine) : le circuit (lignes, ascenseurs, rampe), le mât qui
// porte la source de chaleur et le barillet des cloches, les deux plateaux, le
// lieu. `pose(S, extra)` place les pièces mobiles pour un état du cycle
// (cycle.js · stateAt) : rien n'est intégré d'une image à l'autre.
import * as THREE from 'three/webgpu';
import { mx_noise_float, positionWorld, float, vec2, vec3, mix, uniform, smoothstep, fract, abs, min, max, floor, sin, dot } from 'three/tsl';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { circuit, beltAt } from '../cycle.js';
import { O, PBASE, CELL, PALLET } from '../sim/mpm.js';
import { MOODS, HEATS, WAXES } from '../recipe.js';
import { stableVelocity } from '../../../shared/scene/materials.js';

const RAILZ = 0.5, LEGZ = 0.74, COLZ = -1.36;
export const PLATE_Y = (O[1] - PBASE) * CELL; // dessus de l'assiette, au-dessus de l'origine du plateau
const DZ = (y) => (y - PBASE) * CELL;

const METALS = {
  steel: { color: 0x8d9096, roughness: 0.36 }, alu: { color: 0xc9ccd0, roughness: 0.3 }, brass: { color: 0xb69a52, roughness: 0.3 }, copper: { color: 0xb87352, roughness: 0.28 },
};
function mat(o, grain = 0) {
  const m = new THREE.MeshPhysicalNodeMaterial(o);
  if (grain) {
    // (un peu de vie dans la rugosité : bruit non périodique, à l'échelle de la main)
    const n = mx_noise_float(positionWorld.mul(vec3(9, 23, 9))).mul(0.5).add(mx_noise_float(positionWorld.mul(61)).mul(0.5));
    m.roughnessNode = float(o.roughness ?? 0.5).add(n.mul(grain)).clamp(0.05, 1);
  }
  m.mrtNode = stableVelocity();
  return m;
}

export function createFactory(scene) {
  const root = new THREE.Group();
  scene.add(root);
  // lumières (ordre fixe)
  const key = new THREE.DirectionalLight(0xffffff, 3);
  key.castShadow = true; key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -0.0004; key.shadow.normalBias = 0.02; key.shadow.radius = 3;
  const rim = new THREE.DirectionalLight(0xffffff, 2);
  const heatL = new THREE.PointLight(0xff8040, 0, 4.5, 1.6);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.5);
  scene.add(key, key.target, rim, rim.target, heatL, hemi);

  let built = null, R = null, P = null; // P : pièces mobiles
  const glowU = uniform(0);

  function clear() {
    if (!built) return;
    root.remove(built);
    built.traverse((o) => { o.geometry?.dispose(); });
    built = null;
  }

  function build(recipe) {
    clear();
    R = recipe;
    const F = R.factory, M = MOODS[R.mood], H = HEATS[R.heat];
    F0 = F;
    const g = new THREE.Group(); built = g; root.add(g);
    const paint = mat({ color: F.paint, metalness: 0, roughness: 0.42, clearcoat: 0.6, clearcoatRoughness: 0.25 }, 0.06);
    const metal = mat({ ...METALS[F.metal], metalness: 1 }, 0.1);
    const pal = mat({ ...METALS[F.pallet], metalness: 1 }, 0.08);
    const dark = mat({ color: 0x1d1e21, metalness: 0.7, roughness: 0.5 }, 0.1);
    const rubber = mat({ color: 0x121214, metalness: 0, roughness: 0.9 });
    const add = (geo, m, x, y, z, parent = g) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; parent.add(o); return o; };
    const box = (w, h, d, m, x, y, z, parent) => add(new THREE.BoxGeometry(w, h, d), m, x, y, z, parent);
    const cyl = (r, h, m, x, y, z, parent, seg = 32) => add(new THREE.CylinderGeometry(r, r, h, seg), m, x, y, z, parent);
    const rbox = (w, h, d, r, m, x, y, z, parent) => add(new RoundedBoxGeometry(w, h, d, 3, Math.min(r, w / 2.01, h / 2.01, d / 2.01)), m, x, y, z, parent);
    const lathe = (pts, m, parent, seg = 72) => add(new THREE.LatheGeometry(pts.map(([r, y]) => new THREE.Vector2(r, y)), seg), m, 0, 0, 0, parent);
    // une poutre d'un point à un autre (dans le plan z donné)
    const beam = (p, q, z, w, h, m) => {
      const L = Math.hypot(q[0] - p[0], q[1] - p[1]);
      const o = box(L + w, h, w, m, (p[0] + q[0]) / 2, (p[1] + q[1]) / 2, z);
      o.rotation.z = Math.atan2(q[1] - p[1], q[0] - p[0]);
      return o;
    };

    // ── le lieu : un sol dallé, un mur à soubassement peint, une plinthe ──
    const floorM = mat({ color: M.floor, metalness: 0, roughness: 0.6 });
    {
      const p = positionWorld.xz.div(1.5), f = fract(p), id = floor(p);
      const joint = smoothstep(0.012, 0.004, min(min(f.x, f.x.oneMinus()), min(f.y, f.y.oneMinus())));
      const tone = fract(sin(dot(id, vec2(12.9898, 78.233))).mul(43758.5453)).sub(0.5).mul(0.1).add(1);
      const stain = mx_noise_float(positionWorld.mul(0.7)).mul(0.5).add(mx_noise_float(positionWorld.mul(3.1)).mul(0.25));
      const c = new THREE.Color(M.floor);
      floorM.colorNode = vec3(c.r, c.g, c.b).mul(tone).mul(stain.mul(0.16).add(1)).mul(mix(float(1), float(0.45), joint));
      floorM.roughnessNode = float(0.55).add(stain.mul(0.2)).add(joint.mul(0.3)).clamp(0.1, 1);
    }
    const fl = add(new THREE.PlaneGeometry(60, 40).rotateX(-Math.PI / 2), floorM, 0, 0, 6); fl.castShadow = false;
    const wallM = mat({ color: M.wall, metalness: 0, roughness: 0.85 });
    {
      const y = positionWorld.y, c = new THREE.Color(M.wall), pc = new THREE.Color(F.paint);
      const dado = smoothstep(1.52, 1.5, y);
      const stripe = smoothstep(0.035, 0.03, abs(y.sub(1.56)));
      const grime = mx_noise_float(positionWorld.mul(vec3(0.5, 1.3, 1))).mul(0.5).add(mx_noise_float(positionWorld.mul(4)).mul(0.2));
      const base = vec3(c.r, c.g, c.b);
      wallM.colorNode = mix(mix(base, base.mul(0.62), dado), vec3(pc.r, pc.g, pc.b).mul(0.7), stripe).mul(grime.mul(0.12).add(1));
      wallM.roughnessNode = mix(float(0.88), float(0.5), dado).add(grime.mul(0.1));
    }
    const wall = add(new THREE.PlaneGeometry(60, 24), wallM, 0, 12, -4.2); wall.castShadow = false;
    box(60, 0.2, 0.07, mat({ color: 0x1c1c1e, roughness: 0.6 }), 0, 0.1, -4.16);

    // ── le circuit ──
    // Langage des pièces : des tubes fins de métal poli, une bague chanfreinée à chaque
    // jonction, un pied tourné sous chaque montant ; la peinture ne sert qu'aux accents.
    const C = circuit(F);
    const segs = [];
    for (const poly of [C.down, C.up]) for (let i = 0; i + 1 < poly.length; i++) segs.push([poly[i], poly[i + 1]]);
    const V = (x, y, z) => new THREE.Vector3(x, y, z), UP = V(0, 1, 0);
    const tube = (a, b, r, m, parent = g, seg = 16) => {
      const d = b.clone().sub(a), o = add(new THREE.CylinderGeometry(r, r, d.length(), seg), m, 0, 0, 0, parent);
      o.position.copy(a).addScaledVector(d, 0.5); o.quaternion.setFromUnitVectors(UP, d.normalize());
      return o;
    };
    // bague : un anneau chanfreiné autour d'un tube de rayon r, d'axe `axis`
    const collar = (pos, axis, r, m = metal, h = 0.045, parent = g) => {
      const ro = r + 0.013, c = 0.006;
      const o = add(new THREE.LatheGeometry([[r * 0.98, -h / 2], [ro - c, -h / 2], [ro, -h / 2 + c], [ro, h / 2 - c], [ro - c, h / 2], [r * 0.98, h / 2]].map(([a, b]) => new THREE.Vector2(a, b)), 24), m, pos.x, pos.y, pos.z, parent);
      o.quaternion.setFromUnitVectors(UP, axis.clone().normalize());
      return o;
    };
    const ball = (pos, r, m = metal, parent = g) => add(new THREE.SphereGeometry(r, 18, 12), m, pos.x, pos.y, pos.z, parent);
    // montant : un tube du sol à la hauteur h, sur un pied tourné, coiffé d'une bague
    const post = (x, z, h, r = 0.026, m = metal) => {
      add(new THREE.LatheGeometry([[0, 0], [0.07, 0], [0.078, 0.006], [0.078, 0.016], [0.05, 0.03], [r + 0.014, 0.05], [r + 0.014, 0.085], [r, 0.092], [0, 0.092]].map(([a, b]) => new THREE.Vector2(a, b)), 28), dark, x, 0, z);
      tube(V(x, 0.08, z), V(x, h, z), r, m);
      return V(x, h, z);
    };
    const xs = [];
    for (const [p, q] of segs) {
      const dx = q[0] - p[0], dy = q[1] - p[1];
      if (Math.abs(dy) < 1e-6) {
        // une ligne : deux convoyeurs étroits (le milieu reste libre pour la buse) — profilé, bande, tambours, liseré
        const L = Math.abs(dx), cx = (p[0] + q[0]) / 2, y = p[1], x0 = Math.min(p[0], q[0]), x1 = Math.max(p[0], q[0]);
        for (const z of [-RAILZ, RAILZ]) {
          rbox(L + 0.2, 0.036, 0.125, 0.01, metal, cx, y - 0.086, z);
          rbox(L + 0.24, 0.022, 0.112, 0.008, rubber, cx, y - 0.052, z);
          rbox(L + 0.2, 0.046, 0.01, 0.004, paint, cx, y - 0.078, z + Math.sign(z) * 0.068);
          for (const x of [x0 - 0.12, x1 + 0.12]) if (Math.abs(x) > 0.3) {
            add(new THREE.CylinderGeometry(0.032, 0.032, 0.116, 22).rotateX(Math.PI / 2), dark, x, y - 0.056, z);
            add(new THREE.CylinderGeometry(0.012, 0.012, 0.16, 12).rotateX(Math.PI / 2), metal, x, y - 0.056, z);
          }
        }
        xs.push([x0, x1, y, dx]);
      } else if (Math.abs(dx) < 1e-6) {
        // un ascenseur : deux colonnes de guidage polies, une vis, un socle, une tête et son moteur
        const sx = Math.sign(p[0]) || 1, x = p[0] + sx * 0.98, top = Math.max(p[1], q[1]) + 0.42;
        rbox(0.26, 0.045, 0.86, 0.018, dark, x, 0.022, 0);
        for (const z of [-0.3, 0.3]) { tube(V(x, 0.04, z), V(x, top, z), 0.026, metal); collar(V(x, 0.07, z), UP, 0.026, dark); collar(V(x, top - 0.03, z), UP, 0.026, dark); }
        tube(V(x, 0.04, 0), V(x, top, 0), 0.012, dark, g, 10);
        rbox(0.17, 0.06, 0.8, 0.022, paint, x, top + 0.01, 0);
        add(new THREE.CylinderGeometry(0.06, 0.06, 0.15, 28), dark, x, top + 0.115, 0); ball(V(x, top + 0.19, 0), 0.06, dark).scale.y = 0.45;
        const lampM = new THREE.MeshBasicNodeMaterial(); lampM.colorNode = vec3(2.2, 0.9, 0.12); lampM.mrtNode = stableVelocity();
        add(new THREE.SphereGeometry(0.022, 14, 10), lampM, x, top + 0.062, 0.33);
      } else {
        // une rampe : deux tubes inclinés, à l'écart des plateaux, sous les galets du chariot
        const off = -0.3 - 0.05 - 0.03;
        for (const z of [-LEGZ, LEGZ]) {
          const a = V(p[0], p[1] + off, z), b = V(q[0], q[1] + off, z), d = b.clone().sub(a).normalize();
          tube(a.clone().addScaledVector(d, -0.25), b.clone().addScaledVector(d, 0.2), 0.028, metal);
          ball(a.clone().addScaledVector(d, -0.25), 0.028); ball(b.clone().addScaledVector(d, 0.2), 0.028);
          for (const fr of [0.03, 0.5, 0.97]) {
            const mx = p[0] + dx * fr, my = p[1] + dy * fr + off;
            if (my > 0.2) { post(mx, z, my - 0.03); collar(V(mx, my, z), d, 0.028, dark); }
          }
        }
        for (const fr of [0.03, 0.97]) { const mx = p[0] + dx * fr, my = p[1] + dy * fr + off - 0.25; if (my > 0.3) tube(V(mx, my, -LEGZ), V(mx, my, LEGZ), 0.014, metal, g, 10); }
      }
    }
    // appuis des lignes : aux bouts seulement (le barillet des moules balaie le milieu) ; des montants
    // à l'écart du passage des plateaux, une console courte vers chaque convoyeur, un tirant fin
    const onRamp = (x, y) => segs.some(([p, q]) => Math.abs(q[1] - p[1]) > 1e-6 && Math.abs(q[0] - p[0]) > 1e-6 && (Math.hypot(p[0] - x, p[1] - y) < 0.05 || Math.hypot(q[0] - x, q[1] - y) < 0.05));
    for (const [x0, x1, y, dx] of xs) for (const x of [x0, x1]) {
      if (Math.abs(x) < 0.3) continue;
      const out = Math.sign(x), yb = y - 0.104;
      if (onRamp(x, y)) {
        // (la ligne s'appuie sur les tubes de la rampe)
        for (const z of [-RAILZ, RAILZ]) { const zo = Math.sign(z) * LEGZ; tube(V(x - out * 0.1, yb, z), V(x - out * 0.1, yb, zo), 0.015, metal, g, 10); tube(V(x - out * 0.1, yb, zo), V(x - out * 0.1, y - 0.38, zo), 0.015, metal, g, 10); ball(V(x - out * 0.1, yb, zo), 0.015); }
        continue;
      }
      const xl = x + out * 0.02;
      for (const z of [-LEGZ, LEGZ]) {
        const zi = Math.sign(z) * RAILZ;
        const t = post(xl, z, yb + 0.03);
        ball(t, 0.026);
        tube(V(xl, yb, z), V(xl, yb, zi), 0.018, metal, g, 12); collar(V(xl, yb, z - Math.sign(z) * 0.05), V(0, 0, 1), 0.018, dark, 0.03);
        if (yb > 0.8) tube(V(xl, yb - 0.3, z), V(xl, yb - 0.01, zi + Math.sign(z) * 0.04), 0.008, metal, g, 8); // tirant
        if (yb > 0.8) collar(V(xl, yb - 0.3, z), UP, 0.026, dark, 0.03);
      }
      tube(V(xl, 0.14, -LEGZ), V(xl, 0.14, LEGZ), 0.012, metal, g, 10); // entretoise au ras du sol (sous le passage des plateaux)
      void dx;
    }
    // chariots : un par ascenseur ou par rampe, à demeure (il attend, emporte le plateau, revient à vide)
    const cars = [];
    for (const [p, q] of segs) {
      if (Math.abs(q[1] - p[1]) < 1e-6) continue;
      const c = new THREE.Group(); g.add(c);
      // deux bras sous la cuvette, de part et d'autre de la buse, entre les convoyeurs ; un patin au bout
      const arms = (xa, xb) => { for (const z of [-0.27, 0.27]) { tube(V(xa, -0.066, z), V(xb, -0.066, z), 0.02, metal, c, 12); ball(V(xa, -0.066, z), 0.02, metal, c); rbox(0.16, 0.012, 0.05, 0.005, rubber, xa + Math.sign(xb - xa) * 0.12, -0.046, z, c); } };
      if (Math.abs(q[0] - p[0]) < 1e-6) {
        // ascenseur : un coulisseau sur les deux colonnes, qui porte les bras
        const sx = Math.sign(p[0]) || 1;
        arms(-sx * 0.36, sx * 0.94);
        rbox(0.11, 0.2, 0.72, 0.028, paint, sx * 0.98, -0.1, 0, c);
        for (const z of [-0.3, 0.3]) { collar(V(sx * 0.98, 0.02, z), UP, 0.027, dark, 0.05, c); collar(V(sx * 0.98, -0.22, z), UP, 0.027, dark, 0.05, c); }
        for (const z of [-0.27, 0.27]) tube(V(sx * 0.94, -0.19, z), V(sx * 0.42, -0.07, z), 0.008, metal, c, 8); // jambes de force
      } else {
        // rampe : un chariot dont les bras restent de niveau, sur un essieu à quatre galets
        const a = Math.atan2(q[1] - p[1], Math.abs(q[0] - p[0])), sx = Math.sign(q[0] - p[0]) || 1, dy = Math.tan(a) * 0.12;
        arms(-0.42, 0.42);
        for (const z of [-0.27, 0.27]) { tube(V(0, -0.066, z), V(0, -0.3, z), 0.016, metal, c, 10); collar(V(0, -0.09, z), UP, 0.016, dark, 0.03, c); }
        tube(V(0, -0.3, -LEGZ - 0.07), V(0, -0.3, LEGZ + 0.07), 0.02, metal, c, 12);
        for (const z of [-LEGZ, LEGZ]) {
          tube(V(-sx * 0.12, -0.3 - dy, z + Math.sign(z) * 0.05), V(sx * 0.12, -0.3 + dy, z + Math.sign(z) * 0.05), 0.012, dark, c, 8);
          for (const e of [-1, 1]) add(new THREE.CylinderGeometry(0.045, 0.045, 0.04, 20).rotateX(Math.PI / 2), rubber, sx * e * 0.12, -0.3 + e * dy, z, c);
        }
      }
      cars.push(c);
    }

    // ── les plateaux : cuvette en entonnoir à bord roulé, buse, assiette sur trois colonnettes ──
    const pr = PALLET, rN = (pr.holeR + 1.2) * CELL, rH = pr.holeR * CELL, rB = pr.bowlR * CELL;
    const pallets = [0, 1].map(() => {
      const q = new THREE.Group(); g.add(q);
      const yr = DZ(PBASE + pr.rimH), yb0 = DZ(PBASE - 2);
      lathe([[rN, -0.12], [rN, yb0 - 0.004], [rB - 0.03, yb0 - 0.004], [rB - 0.006, yb0 + 0.012], [rB, yb0 + 0.04], [rB, yr - 0.012], [rB + 0.008, yr - 0.004], [rB + 0.008, yr + 0.006], [rB - 0.004, yr + 0.012], [rB - 0.03, yr + 0.006],
        [rB - 0.04, yr - 0.008], [rB - 0.04, DZ(PBASE + pr.floor0 + pr.slope * (pr.bowlR - 2))], [rH, DZ(PBASE + pr.floor0 + pr.slope * pr.holeR)], [rH, -0.12], [rN, -0.12]], pal, q);
      const rp = pr.plateR * CELL;
      lathe([[0, PLATE_Y], [rp - 0.008, PLATE_Y], [rp, PLATE_Y - 0.008], [rp, PLATE_Y - 0.036], [rp - 0.012, PLATE_Y - 0.05], [0.26, PLATE_Y - 0.06], [0, PLATE_Y - 0.06]], pal, q);
      const yb = DZ(PBASE + pr.floor0 + pr.slope * 11);
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2 + 0.5, x = Math.cos(a) * 0.23, z = Math.sin(a) * 0.23;
        tube(V(x, yb, z), V(x, PLATE_Y - 0.055, z), 0.012, metal, q, 10); collar(V(x, yb + 0.012, z), UP, 0.012, pal, 0.022, q); collar(V(x, PLATE_Y - 0.07, z), UP, 0.012, pal, 0.022, q);
      }
      return q;
    });

    // ── le mât : il porte le barillet des moules et la source de chaleur ──
    const topY = F.y1 + PLATE_Y + 1.25, mastH = topY + 0.45, MR = 0.055;
    add(new THREE.LatheGeometry([[0, 0], [0.19, 0], [0.2, 0.008], [0.2, 0.024], [0.15, 0.04], [0.1, 0.1], [MR + 0.02, 0.2], [MR + 0.02, 0.24], [MR, 0.25], [0, 0.25]].map(([a, b]) => new THREE.Vector2(a, b)), 40), dark, 0, 0, COLZ);
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; add(new THREE.CylinderGeometry(0.012, 0.012, 0.014, 6), metal, Math.cos(a) * 0.165, 0.03, COLZ + Math.sin(a) * 0.165); }
    tube(V(0, 0.24, COLZ), V(0, mastH, COLZ), MR, metal, g, 28);
    ball(V(0, mastH, COLZ), MR * 1.25);
    // le pupitre : une tablette inclinée sur une colonne fine, trois voyants, un conduit vers le mât
    {
      const cx = -F.dir * 1.75, cz = -2.7;
      const t = post(cx, cz, 1.02, 0.024);
      const pup = rbox(0.44, 0.045, 0.26, 0.016, paint, cx, 1.06, cz + 0.02); pup.rotation.x = 0.5;
      collar(V(cx, 0.99, cz), UP, 0.024, dark); void t;
      [[2.4, 0.3, 0.2], [2.2, 1.3, 0.15], [0.25, 1.8, 0.4]].forEach((c, i) => { const m2 = new THREE.MeshBasicNodeMaterial(); m2.colorNode = vec3(...c).mul(i === 2 ? 1 : 0.12); m2.mrtNode = stableVelocity(); add(new THREE.SphereGeometry(0.02, 14, 10), m2, cx - 0.13 + i * 0.13, 1.12, cz + 0.06); });
      const path = new THREE.CatmullRomCurve3([V(cx, 0.55, cz - 0.03), V(cx + F.dir * 0.12, 0.2, cz - 0.08), V(cx + F.dir * 0.6, 0.06, cz + 0.25), V(-F.dir * 0.5, 0.06, COLZ - 0.5), V(0, 0.1, COLZ - 0.17)]);
      add(new THREE.TubeGeometry(path, 48, 0.014, 8), dark, 0, 0, 0);
    }
    const hub = new THREE.Group(); hub.position.set(0, 0, COLZ); g.add(hub);
    {
      const r0 = MR + 0.004, r1 = MR + 0.03, r2 = MR + 0.05, y0 = F.bellH + 0.08;
      add(new THREE.LatheGeometry([[r0, 0], [r1, 0], [r2, 0.014], [r2, 0.06], [r1, 0.075], [r1, 0.265], [r2, 0.28], [r2, 0.326], [r1, 0.34], [r0, 0.34]].map(([a, b]) => new THREE.Vector2(a, b)), 36), dark, 0, y0, 0, hub);
    }
    const n = R.objects.length;
    const mouldM = [metal, mat({ ...METALS[F.metal === 'alu' ? 'steel' : 'alu'], metalness: 1 }, 0.1), mat({ ...METALS.brass, metalness: 1 }, 0.1)];
    const spokes = [];
    for (let i = 0; i < n; i++) { const s = new THREE.Group(); s.rotation.y = -(i / n) * Math.PI * 2; hub.add(s); spokes.push(s); }
    // source de chaleur : portée par un col de cygne qui part du mât
    const glow = new THREE.MeshBasicNodeMaterial();
    glow.colorNode = mix(vec3(0.03, 0.02, 0.02), vec3(7, 1.5, 0.25), smoothstep(0, 1, glowU).mul(glowU));
    glow.mrtNode = stableVelocity();
    const heat = new THREE.Group(); g.add(heat);
    const dirv = new THREE.Vector3(...H.dir).normalize();
    if (R.heat === 'bruleur') dirv.x *= R.camera.side;
    let ring = null;
    const neck = (pts, r = 0.02) => { add(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, r, 12), metal, 0, 0, 0); collar(pts[0], pts[1].clone().sub(pts[0]), r, dark, 0.05); ball(pts[0], MR + 0.012, dark).scale.set(1, 0.5, 1); };
    if (R.heat === 'lampe') {
      heat.position.set(0, topY, 0);
      lathe([[0.03, 0.3], [0.07, 0.3], [0.1, 0.27], [0.21, 0.215], [0.43, 0.055], [0.465, 0.004], [0.48, 0], [0.486, 0.008], [0.455, 0.07], [0.225, 0.24], [0.11, 0.3], [0.085, 0.335], [0.03, 0.335]], paint, heat);
      for (const [r, y] of [[0.3, 0.07], [0.2, 0.115], [0.1, 0.16]]) add(new THREE.TorusGeometry(r, 0.014, 10, 56).rotateX(Math.PI / 2), glow, 0, y, 0, heat);
      collar(V(0, 0.36, 0), UP, 0.02, dark, 0.05, heat);
      neck([V(0, topY + 0.2, COLZ), V(0, topY + 0.62, COLZ * 0.62), V(0, topY + 0.66, COLZ * 0.2), V(0, topY + 0.33, 0)]);
    } else if (R.heat === 'bruleur') {
      // une rampe de trois becs, de biais
      const c = new THREE.Vector3(0, F.y1 + PLATE_Y + 0.5, 0).addScaledVector(dirv, 1.05);
      heat.position.copy(c); heat.lookAt(0, F.y1 + PLATE_Y + 0.5, 0);
      tube(V(-0.4, 0, 0), V(0.4, 0, 0), 0.026, dark, heat); ball(V(-0.4, 0, 0), 0.026, dark, heat); ball(V(0.4, 0, 0), 0.026, dark, heat);
      for (const x of [-0.27, 0, 0.27]) {
        add(new THREE.CylinderGeometry(0.02, 0.03, 0.17, 16).rotateX(Math.PI / 2), metal, x, 0, 0.1, heat);
        collar(V(x, 0, 0.03), V(0, 0, 1), 0.026, metal, 0.03, heat);
        const fl2 = add(new THREE.ConeGeometry(0.036, 0.3, 16).rotateX(Math.PI / 2), glow, x, 0, 0.33, heat); fl2.castShadow = false;
      }
      neck([V(0, topY + 0.2, COLZ), V(c.x * 0.3, topY + 0.5, COLZ * 0.7 + c.z * 0.3), V(c.x * 0.9, c.y + 0.3, c.z * 0.9 + COLZ * 0.1), c.clone().addScaledVector(dirv, 0.03)]);
    } else {
      // une ceinture : un anneau suspendu à trois tiges, sur une tige qui coulisse dans le col de cygne
      ring = new THREE.Group(); heat.add(ring);
      add(new THREE.TorusGeometry(0.46, 0.028, 12, 72).rotateX(Math.PI / 2), glow, 0, 0, 0, ring);
      add(new THREE.TorusGeometry(0.5, 0.016, 10, 72).rotateX(Math.PI / 2), dark, 0, 0.018, 0, ring);
      for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2 + 0.3; tube(V(Math.cos(a) * 0.5, 0.02, Math.sin(a) * 0.5), V(0, 0.42, 0), 0.008, metal, ring, 8); ball(V(Math.cos(a) * 0.5, 0.02, Math.sin(a) * 0.5), 0.02, dark, ring); }
      ball(V(0, 0.42, 0), 0.03, dark, ring);
      tube(V(0, 0.42, 0), V(0, 2.25, 0), 0.01, metal, ring, 10);
      const gy = F.y1 + PLATE_Y + 1.95;
      neck([V(0, gy - 0.25, COLZ), V(0, gy + 0.2, COLZ * 0.62), V(0, gy + 0.22, COLZ * 0.2), V(0, gy + 0.02, 0)]);
      collar(V(0, gy, 0), UP, 0.012, dark, 0.07);
    }
    // socle de l'usine : une tôle mince, bords adoucis
    const xmin = Math.min(...segs.flat().map((p) => p[0])) - 1.25, xmax = Math.max(...segs.flat().map((p) => p[0])) + 1.25;
    const slab = rbox(xmax - xmin, 0.03, 3.3, 0.012, mat({ color: 0x33353a, metalness: 0.5, roughness: 0.5 }, 0.12), (xmin + xmax) / 2, 0.012, -0.5); slab.castShadow = false;
    // filet de cire
    const W = WAXES[R.wax];
    const stream = add(new THREE.CylinderGeometry(1, 0.8, 1, 16), mat({ color: new THREE.Color(...W.a), roughness: 0.15, metalness: 0 }), 0, 0, 0);
    stream.castShadow = false;

    // lumières du lieu
    const dirOf = (az, el) => new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
    const mid = new THREE.Vector3(0, (F.y0 + F.y1) / 2 + 0.6, 0);
    const kd = dirOf(M.key.az * R.camera.side, M.key.el), rd = dirOf(M.rim.az * R.camera.side, M.rim.el);
    key.position.copy(mid).addScaledVector(kd, 16); key.target.position.copy(mid);
    const kc = new THREE.Color().setHSL(0.09, M.key.K < 5500 ? 0.5 : 0.12, M.key.K < 5500 ? 0.9 : 0.96);
    key.color.copy(kc); key.intensity = M.key.I;
    Object.assign(key.shadow.camera, { left: xmin - 1, right: xmax + 1, top: mastH / 2 + 1.5, bottom: -mastH / 2 - 1.5, near: 2, far: 34 }); key.shadow.camera.updateProjectionMatrix();
    rim.position.copy(mid).addScaledVector(rd, 16); rim.target.position.copy(mid); rim.color.set(M.rim.color); rim.intensity = M.rim.I;
    hemi.color.set(M.wall).lerp(new THREE.Color(1, 1, 1), 0.6); hemi.groundColor.set(M.floor); hemi.intensity = 0.55;
    heatL.position.set(0, F.y1 + PLATE_Y + 0.6, 0).addScaledVector(dirv, 0.9);

    P = { F, pallets, cars, hub, spokes, mouldM, paint, dark, metal, moulds: [], heat, ring, stream, dirv, topY, n, C, kd, rd, kc, rimC: new THREE.Color(M.rim.color), M };
    return P;
  }

  // Les moules : un par objet, au bout d'un rayon du barillet. Chaque moule est une coque à la
  // forme de sa figurine, en deux moitiés articulées sur une charnière, derrière l'objet.
  // shapes[i].mould : { halves: [géométrie +x, géométrie −x] (repère objet, unités du monde), top, zBack }
  function setMoulds(shapes) {
    if (!P) return;
    for (const m of P.moulds) { m.group.parent.remove(m.group); m.halves.forEach((h) => h.children[0].geometry.dispose()); }
    P.moulds = shapes.map((sh, i) => {
      const s = P.spokes[i], Mo = sh.mould, zh = Mo.zBack - 0.05;
      const g = new THREE.Group(); g.position.set(0, 0, -COLZ); s.add(g);
      const halves = Mo.halves.map((geo) => {
        const piv = new THREE.Group(); piv.position.set(0, 0, zh); g.add(piv);
        const me = new THREE.Mesh(geo, P.mouldM[i % 3]); me.position.set(0, 0, -zh); me.castShadow = me.receiveShadow = true; piv.add(me);
        return piv;
      });
      // la charnière (une tige et ses deux embouts), et le bras qui la tient au barillet
      const hArm = F0.bellH + 0.25, L = -COLZ + zh, Y = new THREE.Vector3(0, 1, 0);
      const cyl2 = (a, b2, r, m, parent) => { const d = b2.clone().sub(a), o = new THREE.Mesh(new THREE.CylinderGeometry(r, r, d.length(), 16), m); o.position.copy(a).addScaledVector(d, 0.5); o.quaternion.setFromUnitVectors(Y, d.normalize()); o.castShadow = true; parent.add(o); return o; };
      cyl2(new THREE.Vector3(0, 0.06, zh - 0.03), new THREE.Vector3(0, hArm + 0.04, zh - 0.03), 0.016, P.metal, g);
      for (const y of [0.06, hArm + 0.04]) { const s2 = new THREE.Mesh(new THREE.SphereGeometry(0.024, 14, 10), P.dark); s2.position.set(0, y, zh - 0.03); g.add(s2); }
      cyl2(new THREE.Vector3(0, hArm, 0.1), new THREE.Vector3(0, hArm, L - 0.03), 0.024, P.metal, s);
      for (const z of [0.13, L - 0.06]) { const c2 = new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.036, 0.04, 20).rotateX(Math.PI / 2), P.dark); c2.position.set(0, hArm, z); c2.castShadow = true; s.add(c2); }
      return { group: g, halves, top: Mo.top };
    });
  }
  let F0 = null;

  // S : état du cycle ; rate : débit de cire à la buse (0…1) ; hObj : hauteur de l'objet (monde)
  function pose(S, { rate = 0, hObj = 1 } = {}) {
    if (!P) return;
    const { F } = P;
    S.pallets.forEach((p, i) => { P.pallets[i].position.set(p[0], p[1], 0); });
    S.carriers.forEach((c, i) => { P.cars[i]?.position.set(c.pos[0], c.pos[1], 0); });
    P.hub.position.y = F.y0 + PLATE_Y + S.bell * (F.bellH + 0.14);
    P.hub.rotation.y = (S.arm / P.n) * Math.PI * 2;
    glowU.value = S.heat;
    heatL.intensity = 26 * S.heat;
    if (P.ring) P.ring.position.y = F.y1 + PLATE_Y + beltAt(S.t) * hObj;
    // les moules : seul celui du poste s'ouvre
    P.moulds.forEach((m, i) => {
      const here = i === S.k % P.n ? S.open : 0;
      m.halves[0].rotation.y = here * 1.75; m.halves[1].rotation.y = -here * 1.75;
    });
    const cur = P.moulds[((S.k + 1) % P.n + P.n) % P.n];
    const top = F.y1 - 0.12, bot = F.y0 + PLATE_Y + (cur ? cur.top - 0.1 : F.bellH), r = 0.006 + 0.034 * Math.sqrt(Math.max(0, rate));
    P.stream.visible = rate > 0.012 && S.bell < 0.01;
    P.stream.position.set(0, (top + bot) / 2, 0); P.stream.scale.set(r, top - bot, r);
  }

  return { build, pose, setMoulds, root, key, parts: () => P };
}
