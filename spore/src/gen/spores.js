// Les spores (module pur : worker, tests ; la même trajectoire est écrite en
// TSL dans scene/spores.js, et test/spores.test.mjs vérifie leur accord sur
// des points témoins).
//
// Une spore de 10 µm tombe dans l'air immobile à la vitesse de Stokes,
//     v = 2/9 · Δρ g r² / μ ≈ 0,3 cm/s ;
// le souffle (timeline.windSpeed) l'emporte. Sa trajectoire, depuis l'instant
// s_r où elle quitte sa tête, en secondes de référence τ = (s − s_r)·SEC :
//   x = x₀ + [W(s) − W(s_r)]            (vent moyen intégré : table W)
//         + σ·a(τ)·sin(1,3 τ + φ₁) + cₓ·min(1, τ/τ_sol)
//   y = y₀ + h·(1 − e^{−τ/0,8}) − v_s τ + ½σ·a(τ)·sin(1,7 τ + φ₃)
//   z = z₀ + σ·a(τ)·sin(0,9 τ + φ₂)    + c_z·min(1, τ/τ_sol)
// avec a(τ) = 1 − e^{−τ/1,2} (la dispersion croît depuis zéro) et h la
// montée dans le tourbillon de l'ouverture. Elle se pose à τ_sol, quand y
// rejoint le bois (calculé ici, par pas puis dichotomie), et y reste.
// Les points de germination du site suivant (plasmodium.seeds, translatés de
// L) sont des points de chute de spores réelles : pour chacun, la spore dont
// la chute naturelle tombe le plus près reçoit une petite correction c,
// appliquée progressivement pendant le vol.
import { createRng } from '../rng.js';
import { windSpeed, T } from '../timeline.js';
import { fruitState } from '../fruit.js';

export const SEC = 40;              // secondes de référence par boucle
export const WTAB = { s0: 0.6, s1: 1.35, n: 512 };
export const SETTLE = 0.3;          // cm/s (Stokes, 10 µm) ; ∝ d² : 8 µm → 0,19 cm/s

// table du vent intégré W(s) = ∫ U ds · SEC (cm)
export function windTable(R) {
  const { s0, s1, n } = WTAB, out = new Float32Array(n);
  let acc = 0;
  const ds = (s1 - s0) / (n - 1);
  for (let i = 0; i < n; i++) {
    out[i] = acc;
    const s = s0 + i * ds;
    acc += 0.5 * (windSpeed(s, R.wind.gust, R.wind.strength) + windSpeed(s + ds, R.wind.gust, R.wind.strength)) * ds * SEC;
  }
  return out;
}
export function windAt(tab, s) {
  const { s0, s1, n } = WTAB;
  const f = Math.min(n - 1, Math.max(0, ((s - s0) / (s1 - s0)) * (n - 1)));
  const i = Math.min(n - 2, Math.floor(f)), t = f - i;
  return tab[i] * (1 - t) + tab[i + 1] * t;
}

// position en vol (sans le sol) : sp = attributs d'une spore
export function flight(sp, s, tab) {
  const tau = Math.max(0, (s - sp.sr) * SEC);
  const a = 1 - Math.exp(-tau / 1.2), ramp = sp.tl > 0 ? Math.min(1, tau / sp.tl) : 0;
  return [
    sp.x0 + (windAt(tab, s) - windAt(tab, sp.sr)) + sp.sig * a * Math.sin(1.3 * tau + sp.p1) + sp.cx * ramp,
    sp.y0 + sp.lift * (1 - Math.exp(-tau / 0.8)) - sp.vs * tau + 0.5 * sp.sig * a * Math.sin(1.7 * tau + sp.p3),
    sp.z0 + sp.sig * a * Math.sin(0.9 * tau + sp.p2) + sp.cz * ramp,
  ];
}

// instant de chute (s) : premier passage sous le bois
function landing(sp, tab, ground) {
  const f = (s) => { const p = flight(sp, s, tab); return p[1] - ground(p[0], p[2]); };
  let s = sp.sr + 0.0005, prev = f(s);
  if (prev < 0) return { s, tl: (s - sp.sr) * SEC };
  for (let k = 0; k < 600; k++) {
    const s2 = s + 0.0025, v = f(s2);
    if (v < 0) {
      let a = s, b = s2;
      for (let q = 0; q < 24; q++) { const m = (a + b) / 2; if (f(m) < 0) b = m; else a = m; }
      return { s: b, tl: (b - sp.sr) * SEC };
    }
    s = s2; prev = v;
  }
  return { s: s, tl: (s - sp.sr) * SEC };
}

// heads : pour chaque sporange, une fonction (s) → { c: centre de la tête,
// r: rayon, h: demi-hauteur } dans les coordonnées du site ; weights : part
// des spores de chaque tête
export function buildSpores({ R, sp, beads, heads, ground, seeds, L, count, seed = 'spores' }) {
  const rng = createRng(seed), tab = windTable(R);
  const n = beads.length;
  if (!n) return { list: [], tab };
  const wsum = beads.reduce((a, b) => a + b.size ** 3, 0);
  const cum = []; let acc = 0;
  for (const b of beads) { acc += b.size ** 3 / wsum; cum.push(acc); }
  const list = [];
  for (let k = 0; k < count; k++) {
    const u = rng.next();
    let i = cum.findIndex((c) => c >= u); if (i < 0) i = n - 1;
    const b = beads[i];
    // instant de départ : l'ouverture de sa tête, puis une traîne (la tête se vide)
    const open0 = T.open[0] + b.delay * R.fruit.spread * 0.8;
    const sr = open0 + 0.012 + 0.09 * rng.next() ** 1.6;
    const H = heads(i, sr);
    // point de départ : sur la tête, plutôt du côté exposé et vers le haut
    const a = rng.next() * Math.PI * 2, yy = rng.next() ** 0.6;
    const x0 = H.c[0] + Math.cos(a) * H.r, z0 = H.c[2] + Math.sin(a) * H.r, y0 = H.c[1] + (yy - 0.5) * 2 * H.h;
    const lift = R.wind.lift * (0.1 + 1.7 * rng.next() ** 2.2) * (sp.mode === 'tuft' ? 0.6 : 1) + (sp.mode === 'net' ? 0.25 : 0);
    const s0 = { x0, y0, z0, sr, lift, vs: SETTLE * ((sp.spore ?? 10) / 10) ** 2 * (0.75 + 0.5 * rng.next()), sig: 0.06 + 0.14 * rng.next(), p1: rng.next() * 6.283, p2: rng.next() * 6.283, p3: rng.next() * 6.283, cx: 0, cz: 0, tl: 0, src: i };
    list.push(s0);
  }
  for (const s0 of list) { const l = landing(s0, tab, ground); s0.tl = l.tl; s0.sl = l.s; }
  // points de germination du site suivant : des chutes réelles
  const used = new Set();
  const designated = [];
  for (const g of seeds) {
    const tx = g.x + L, tz = g.z;
    let best = -1, bd = Infinity;
    list.forEach((q, k) => {
      if (used.has(k)) return;
      const p = flight(q, q.sl, tab), d = (p[0] - tx) ** 2 + (p[2] - tz) ** 2;
      if (d < bd) { bd = d; best = k; }
    });
    if (best < 0) continue;
    used.add(best);
    const q = list[best];
    // correction appliquée pendant le vol, pleine à l'instant de chute naturel
    // (inchangé) : le point de chute est exactement la graine
    const p = flight(q, q.sl, tab);
    q.cx = tx - p[0]; q.cz = tz - p[2];
    designated.push(best);
  }
  // point de chute (posé sur le bois)
  for (const q of list) { const p = flight(q, q.sl, tab); q.lx = p[0]; q.lz = p[2]; q.ly = ground(p[0], p[2]); }
  return { list, tab, designated };
}

// pose d'une spore à la phase s (avec le sol) : null avant le départ
export function sporeAt(q, s, tab) {
  if (s < q.sr) return null;
  if (s >= q.sl) return [q.lx, q.ly, q.lz];
  return flight(q, s, tab);
}

export { fruitState };
