// P2 : le fuseau libéré. Un corps de glace de révolution, détaché de la colonne
// juste sous la ligne d'eau, remonte, bascule et se couche à la surface.
//
// Corps rigide plan (x, y, θ), θ = angle de l'axe avec la verticale.
//  - Poussée d'Archimède exacte par tranches : chaque tranche est un disque
//    coupé par le plan d'eau y = 0 ; volume immergé = segment de disque, centre
//    de poussée = centroïde du segment.
//  - Masse ajoutée (Ca = 0,5 en translation, sur le volume immergé), inertie
//    ajoutée de corps élancé (Ca = 1 sur ∫ π r² (s − s_G)² ds immergé).
//  - Traînée quadratique par tranche (Cd = 1,2 sur la vitesse normale à l'axe,
//    0,2 le long de l'axe), amortissement de pilonnement par rayonnement de
//    vagues (ζ = 0,15 sur la raideur hydrostatique).
//  - Contact sans frottement avec la souche (la colonne restée à la surface) :
//    pénalité raide sur les points du corps qui entrent dans la souche.
//
// node p2.js --name=fuseau [--L=0.07 --rmax=0.008 --tilt=1 --T=6 --Uc=0.004]
import fs from 'node:fs';
import path from 'node:path';
import { writePNG } from '../p0/png.js';

const args = Object.fromEntries(process.argv.slice(2).map((a) => { const [k, v] = a.replace(/^--/, '').split('='); return [k, v ?? '1']; }));
const name = args.name ?? 'fuseau';
const rhoW = 1000, rhoI = 917, g = 9.81;
const Lb = +(args.L ?? 0.07), rmax = +(args.rmax ?? 0.008);
const tilt0 = (+(args.tilt ?? 1)) * Math.PI / 180;
const Tend = +(args.T ?? 6);
const gap0 = +(args.gap ?? 0.0005);
const Uc = +(args.Uc ?? 0.004); // courant de surface (brise), m/s, vers −x // jeu initial entre la pointe du corps et la souche (m)

// profil du fuseau r(s), s ∈ [0, Lb] du bas (bout émoussé) au haut (pointe du col)
// (forme de P0, colonne suspendue à 8 °C : fût en goutte, effilé vers la ligne d'eau)
const NS = 140;
const ds = Lb / NS;
const sC = new Float64Array(NS), rS = new Float64Array(NS);
for (let n = 0; n < NS; n++) {
  const s = (n + 0.5) * ds, x = s / Lb;
  const base = Math.sqrt(Math.min(1, x / 0.12)); // bout arrondi
  const taper = Math.pow(Math.max(0, 1 - x), 0.85) * (1 + 0.9 * x); // effilé vers le haut
  sC[n] = s; rS[n] = rmax * base * taper / 1.18;
}
let V = 0, M1 = 0;
for (let n = 0; n < NS; n++) { const dv = Math.PI * rS[n] ** 2 * ds; V += dv; M1 += dv * sC[n]; }
const sG = M1 / V, m = rhoI * V;
let IG = 0;
for (let n = 0; n < NS; n++) { const dv = Math.PI * rS[n] ** 2 * ds; IG += rhoI * dv * ((sC[n] - sG) ** 2 + rS[n] ** 2 / 4); }
const DL = 2 * rS.reduce((a, b) => Math.max(a, b), 0) / Lb;

// souche : la colonne restée à la ligne d'eau, bout effilé (cône de demi-angle 25°)
// dont la pointe est à y = ys, sur l'axe x = 0
const ys0 = args.nostub ? 1 : -0.0005, stubR = 0.012, stubCone = 25 * Math.PI / 180;
const vFeed = +(args.vFeed ?? 5e-5); // la colonne continue de descendre (m/s, physique)
let ys = ys0;
function stubDepth(px, py) { // > 0 : enfoncement dans la souche (m)
  if (py > 0.03) return 0;
  const dxs = Math.abs(px), dy = py - ys;
  if (dy < 0) return 0;
  const rAt = Math.min(stubR, dy * Math.tan(stubCone));
  return Math.max(0, (rAt - dxs) * Math.cos(stubCone));
}

// état : G = (x, y), θ ; vitesses
let x = 0, y, th = tilt0, vx = 0, vy = 0, w = 0;
// au départ, la pointe du corps est juste sous la pointe de la souche
y = (args.nostub ? -0.0005 : ys) - gap0 - (Lb - sG) * Math.cos(th);

function forces(x, y, th, vx, vy, w) {
  const ax = Math.sin(th), ay = Math.cos(th); // axe (du bas vers le haut)
  const e1x = Math.cos(th), e1y = -Math.sin(th); // dans le plan de basculement, ⟂ axe
  let Fx = 0, Fy = -m * g, Tq = 0, Vsub = 0, Iadd = 0, wpl = 0, wplI = 0;
  for (let n = 0; n < NS; n++) {
    const s = sC[n] - sG, r = rS[n];
    const cx = x + s * ax, cy = y + s * ay;
    const sn = Math.abs(Math.sin(th));
    // fraction immergée du disque et centroïde (le long de e1, côté bas)
    let f, xb = 0;
    if (r * sn < 1e-9) { f = cy < 0 ? 1 : 0; }
    else {
      const hN = Math.max(-1, Math.min(1, cy / (r * sn)));
      const A = Math.acos(hN) - hN * Math.sqrt(1 - hN * hN);
      f = A / Math.PI;
      xb = A > 1e-12 ? (2 / 3) * Math.pow(1 - hN * hN, 1.5) / A * r : 0;
    }
    if (f <= 0) continue;
    // le côté immergé est celui où e1 descend (e1y < 0 si sin θ > 0)
    const sgn = Math.sin(th) >= 0 ? 1 : -1;
    const bx = cx + sgn * xb * e1x, by = cy + sgn * xb * e1y;
    const dV = Math.PI * r * r * ds * f;
    Vsub += dV;
    const Fb = rhoW * g * dV;
    Fy += Fb; Tq += (bx - x) * Fb;
    // traînée (vitesse du centre de tranche)
    const ux = vx + w * (cy - y) + Uc, uy = vy - w * (cx - x); // vitesse relative à l'eau ; θ croît dans le sens horaire
    const un = ux * e1x + uy * e1y, ua = ux * ax + uy * ay;
    const Fn = -0.5 * rhoW * 1.2 * (2 * r * ds * f) * Math.abs(un) * un;
    const Fa = -0.5 * rhoW * 0.2 * (2 * Math.PI * r * ds * f) * Math.abs(ua) * ua;
    const fx = Fn * e1x + Fa * ax, fy = Fn * e1y + Fa * ay;
    Fx += fx; Fy += fy; Tq += (cx - x) * fy - (cy - y) * fx;
    Iadd += rhoW * Math.PI * r * r * ds * f * s * s;
    if (f > 0 && f < 1) { wpl += 2 * r * ds; wplI += 2 * r * ds * s * s; } // aire de flottaison et son moment
  }
  // contact avec la souche (pointes et flancs du corps, deux côtés)
  let contact = 0;
  for (let n = 0; n < NS; n++) for (const side of [-1, 1]) {
    const s = sC[n] - sG, r = rS[n] * side;
    const px = x + s * Math.sin(th) + r * Math.cos(th), py = y + s * Math.cos(th) - r * Math.sin(th);
    const d = stubDepth(px, py);
    if (d > 0) {
      contact = Math.max(contact, d);
      const k = 3e3, nxv = Math.sign(px || 1) * Math.cos(stubCone), nyv = -Math.sin(stubCone);
      const ux = vx + w * (py - y), uy = vy - w * (px - x);
      const vn = ux * nxv + uy * nyv;
      const Fc = Math.max(0, k * d - 0.3 * Math.min(0, vn));
      Fx += Fc * nxv; Fy += Fc * nyv; Tq += (px - x) * Fc * nyv - (py - y) * Fc * nxv;
    }
  }
  // amortissement de pilonnement (rayonnement), à la flottaison
  if (wpl > 0) {
    const kh = rhoW * g * wpl; Fy += -2 * 0.15 * Math.sqrt(kh * m) * vy;
    // roulis et tangage amortis par les vagues rayonnées (ζ = 0,15) ; Tq trigonométrique, w horaire
    const kr = rhoW * g * wplI; Tq += 2 * 0.15 * Math.sqrt(kr * IG) * w;
  }
  return { Fx, Fy, Tq, Vsub, Iadd, contact };
}

const dt = 2e-5;
const traj = [];
let maxContact = 0, tCapsize = null;
for (let t = 0, k = 0; t <= Tend; t += dt, k++) {
  ys = ys0 - vFeed * t;
  const f = forces(x, y, th, vx, vy, w);
  maxContact = Math.max(maxContact, f.contact);
  const mE = m + 0.5 * rhoW * f.Vsub, IE = IG + f.Iadd;
  vx += dt * f.Fx / mE; vy += dt * f.Fy / mE; w -= dt * f.Tq / IE; // Tq compté dans le sens trigonométrique, θ dans le sens horaire
  x += dt * vx; y += dt * vy; th += dt * w;
  if (tCapsize === null && Math.abs(th) > Math.PI / 4) tCapsize = t;
  if (k % 500 === 0) traj.push({ t: +t.toFixed(3), x, y, th, Vsub: f.Vsub / V, contact: f.contact, ys });
}
const last = traj.at(-1);
const out = {
  name, L_mm: Lb * 1e3, D_L: DL, stabilityLimit_D_L: Math.sqrt(8 * 0.917 * 0.083), V_cm3: V * 1e6, m_g: m * 1e3,
  tCapsize_s: tCapsize, final: { th_deg: last.th * 180 / Math.PI, emerged: 1 - last.Vsub, y_mm: last.y * 1e3, x_mm: last.x * 1e3 },
  maxPenetration_mm: maxContact * 1e3, traj,
};
const dir = path.join(path.dirname(new URL(import.meta.url).pathname), 'out');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, `${name}.json`), JSON.stringify(out));
console.log(`${name} : D/L = ${DL.toFixed(3)} (debout stable si > ${out.stabilityLimit_D_L.toFixed(2)}), V = ${out.V_cm3.toFixed(2)} cm³`);
console.log(`  bascule (|θ| > 45°) à t = ${tCapsize?.toFixed(2)} s ; final : θ = ${out.final.th_deg.toFixed(1)}°, émergé ${(out.final.emerged * 100).toFixed(1)} %, dérive ${out.final.x_mm.toFixed(1)} mm`);
console.log(`  enfoncement maximal dans la souche : ${out.maxPenetration_mm.toFixed(3)} mm`);

// image : poses tous les 0,25 s, plan d'eau, souche
const W = 1400, H = 520, S = 4500; // px par m
const img = new Uint8Array(W * H * 3);
for (let p = 0; p < W * H; p++) { const yy = Math.floor(p / W); const c = yy < H * 0.35 ? [200, 210, 225] : [20, 35, 55]; img.set(c, p * 3); }
const ox = W / 2, oy = H * 0.35;
const put = (px, py, c) => { const X = Math.round(ox + px * S), Y = Math.round(oy - py * S); if (X >= 0 && X < W && Y >= 0 && Y < H) img.set(c, (Y * W + X) * 3); };
// souche
for (let yy = ys; yy < 0.03; yy += 0.0001) { const rr = Math.min(stubR, (yy - ys) * Math.tan(stubCone)); for (let xx = -rr; xx <= rr; xx += 0.0001) put(xx, yy, [160, 170, 185]); }
const frames = traj.filter((p, i) => i % Math.round(0.25 / (500 * dt)) === 0);
frames.forEach((p, i) => {
  const c = [255, Math.round(255 - 200 * i / frames.length), Math.round(80 + 175 * (1 - i / frames.length))];
  for (let n = 0; n < NS; n++) for (const side of [-1, 1]) {
    const s = sC[n] - sG, r = rS[n] * side;
    put(p.x + s * Math.sin(p.th) + r * Math.cos(p.th), p.y + s * Math.cos(p.th) - r * Math.sin(p.th), c);
  }
});
writePNG(path.join(dir, `${name}.png`), W, H, img);
