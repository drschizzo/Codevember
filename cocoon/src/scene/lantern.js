// La lampe d'une lanterne : une lumière ponctuelle dont la couleur, en chaque
// point éclairé, est multipliée par la transmission de la paroi de fil dans
// cette direction (« cookie » calculé fil par fil dans le worker). La même
// fonction sert aux murs, à l'appareil, à l'autre lanterne, à la doublure qui
// porte l'ombre du cocon, et aux faisceaux dans la brume.
import * as THREE from 'three/webgpu';
import {
  Fn, vec2, vec3, vec4, float, ivec2, textureLoad, uniform, positionWorld, acos, atan, clamp, floor, fract, mix, step,
  dot, length, exp, log, max, min, select, int, sin, cos, screenCoordinate, smoothstep,
} from 'three/tsl';
import { G } from '../../../shared/scene/globals.js';

export class LanternLight extends THREE.PointLight {
  constructor(...a) { super(...a); this.cookie = null; }
}
export class LanternLightNode extends THREE.PointLightNode {
  static get type() { return 'LanternLightNode'; }
  setupDirect(builder) {
    const d = super.setupDirect(builder);
    if (this.light.cookie) d.lightColor = d.lightColor.mul(this.light.cookie(positionWorld));
    return d;
  }
}

// Textures partagées par les deux stations (même cocon) : cookie (Np × Ns,
// RGBA32F : les s des quatre premiers fils) et table θ → (σ, distance à la
// paroi, rayon de la paroi). Leurs dimensions sont fixées par la qualité
// (la grille du worker l'est aussi) : une nouvelle scène remplace leurs
// données, sans rien recompiler.
export function createCookieTextures(lite = false) {
  const Np = lite ? 1024 : 2048, Ns = lite ? 512 : 1024;
  const cookie = new THREE.DataTexture(new Float32Array(Np * Ns * 4).fill(2), Np, Ns, THREE.RGBAFormat, THREE.FloatType);
  const theta = new THREE.DataTexture(new Float32Array(512 * 4), 512, 1, THREE.RGBAFormat, THREE.FloatType);
  for (const t of [cookie, theta]) { t.magFilter = t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; t.needsUpdate = true; }
  return {
    cookie, theta, Np, Ns,
    np: uniform(Np), ns: uniform(Ns), cs: uniform(1), cp: uniform((Math.PI * 2) / Np), sLo: uniform(0), sHi: uniform(1),
    ribs: uniform(16), wire: uniform(0.0016), rMax: uniform(0.13), hub: uniform(0.024),
  };
}

// Une station vue par sa lampe : matrice monde → station, part posée S,
// transmission d'une épaisseur de fil
export const stationUniforms = () => ({ Minv: uniform(new THREE.Matrix4()), S: uniform(0), tau: uniform(0.4), soft: uniform(0.0035), lampW: uniform(new THREE.Vector3()) });

// Transmission de la paroi d'une station vue de sa lampe, au point pw (monde).
// 1 à l'intérieur de la paroi ; τ^n au-delà, n = nombre de fils posés (s < S)
// sur la direction ; moyenne de 5 prélèvements (la pénombre du filament).
// transmission d'une cellule (σ en cellules, φ en cellules) à la part posée S
export function cellT(T, st, si, pk) {
  const ii = clamp(floor(si), 0, T.ns.sub(1)).toInt();
  const kk = floor(pk).add(T.np).mod(T.np).toInt();
  const c = textureLoad(T.cookie, ivec2(kk, ii));
  const n = dot(step(c, vec4(st.S)), vec4(1));
  return exp(n.mul(log(st.tau.max(1e-4))));
}
// Transmission filtrée (bilinéaire) en un point de la carte (si, pk en
// cellules) : quatre cellules voisines, chacune τ^n, pondérées. La lecture au
// plus proche dessinait sur les murs une grille de points (les cellules).
function bilinT(T, st, si, pk) {
  const lt = log(st.tau.max(1e-4));
  const x = pk.sub(0.5), y = si.sub(0.5);
  const x0 = floor(x), y0 = floor(y), fx = x.sub(x0), fy = y.sub(y0);
  const one = (dy, dx) => {
    const ii = clamp(y0.add(dy), 0, T.ns.sub(1)).toInt();
    const kk = x0.add(dx).add(T.np).mod(T.np).toInt();
    const c = textureLoad(T.cookie, ivec2(kk, ii));
    return exp(dot(step(c, vec4(st.S)), vec4(1)).mul(lt));
  };
  return mix(mix(one(0, 0), one(0, 1), fx), mix(one(1, 0), one(1, 1), fx), fy);
}
// direction issue de la lampe → point de la paroi (σ, φ en cellules), table θ interpolée
function wallLookup(T, st, pw) {
  const d = st.Minv.mul(vec4(pw, 1)).xyz.toVar();
  const L = length(d).max(1e-4);
  const x = acos(clamp(d.y.div(L), -1, 1)).mul(511 / Math.PI).toVar();
  const i0 = clamp(floor(x), 0, 510).toInt(), f = fract(x);
  const a = textureLoad(T.theta, ivec2(i0, int(0))), b = textureLoad(T.theta, ivec2(i0.add(1), int(0)));
  const sig = mix(a.x, b.x, f), shell = mix(a.y, b.y, f), rad = mix(a.z, b.z, f).max(0.01);
  const pk = atan(d.z, d.x).add(Math.PI * 2).mod(Math.PI * 2).div(T.cp);
  const outOfWall = step(sig, T.sLo.add(0.001)).add(step(T.sHi.sub(0.001), sig)).min(1);
  return { L, sig, shell, rad, si: sig.div(T.cs), pk, outOfWall };
}

// Transmission vue de la lampe, avec la pénombre du filament : quatre
// prélèvements filtrés sur un disque dont le rayon (sur la paroi) croît avec
// la distance du point éclairé, tournés à chaque pixel et à chaque image (le
// TRAA en fait un flou continu).
export function makeCookie(T, st, other = null) {
  const fastOther = other ? makeCookieFast(T, other) : null;
  return Fn(([pw]) => {
    const W = wallLookup(T, st, pw);
    const soft = st.soft.mul(float(1).sub(W.shell.div(W.L)).clamp(0, 1));
    const ign = fract(fract(screenCoordinate.x.mul(0.06711056).add(screenCoordinate.y.mul(0.00583715))).mul(52.9829189).add(G.frame.mul(0.618034)));
    const a0 = ign.mul(Math.PI * 2);
    let t = float(0);
    // (deux prélèvements opposés, sur un rayon qui varie lui aussi d'une image
    // à l'autre : le TRAA accumule le disque entier)
    const rr = soft.mul(fract(ign.mul(7.13)).sqrt());
    for (let k = 0; k < 2; k++) {
      const a = a0.add(k * Math.PI);
      const di = rr.mul(sin(a)).div(T.cs), dk = rr.mul(cos(a)).div(W.rad.mul(T.cp));
      t = t.add(bilinT(T, st, W.si.add(di), W.pk.add(dk)).mul(0.5));
    }
    // dedans (avant la paroi) ou hors de la paroi enroulable : pas de fil
    const inside = step(W.L, W.shell.sub(0.004));
    let v = mix(t, float(1), inside.max(W.outOfWall));
    // ombres analytiques (à la place d'une carte d'ombre cubique) :
    // - les côtes de la cage : fils de rayon wire/2 aux angles 2πk/n, vus de
    //   la lampe sous un angle wire/r ; pénombre du filament
    const beyond = step(W.shell.sub(0.002), W.L);
    const sec = T.cp.mul(W.pk).mul(T.ribs).div(Math.PI * 2);
    const dRib = fract(sec.add(0.5)).sub(0.5).abs().mul(Math.PI * 2).div(T.ribs).mul(W.rad); // (distance à la côte, m, sur la paroi)
    const ribW = T.wire.mul(0.5), pen = soft.add(0.0006);
    const rib = smoothstep(ribW.sub(pen), ribW.add(pen), dRib);
    // - les rosaces polaires : disques opaques autour de l'axe
    const hubs = smoothstep(T.sLo.sub(0.004), T.sLo.add(0.002), W.sig).mul(smoothstep(T.sHi.add(0.004), T.sHi.sub(0.002), W.sig));
    v = v.mul(mix(float(1), rib.mul(hubs), beyond));
    // - l'autre cocon : si le rayon lampe → point traverse sa paroi (une sphère
    //   de rayon rMax), la lumière passe deux fois sa paroi
    if (other) {
      const Lw = st.lampW, d = pw.sub(Lw), len = length(d).max(1e-4), dir = d.div(len);
      const oc = other.lampW.sub(Lw), tc = dot(oc, dir).clamp(0, len);
      const closest = Lw.add(dir.mul(tc)), miss = length(closest.sub(other.lampW));
      const hit = smoothstep(T.rMax.mul(1.02), T.rMax.mul(0.8), miss).mul(step(tc.add(T.rMax.mul(0.5)), len));
      const To = fastOther(closest);
      v = v.mul(mix(float(1), To.mul(To), hit));
    }
    return v;
  });
}

// Remplit les textures depuis la sortie du worker
export function setCookieData(T, o) {
  const { Np, Ns, cs, cp } = o.grid;
  if (Np !== T.Np || Ns !== T.Ns) throw new Error(`grille ${Np}×${Ns} ≠ ${T.Np}×${T.Ns}`);
  T.cookie.image.data = o.cookie; T.cookie.needsUpdate = true;
  // table θ : (σ, distance lampe → paroi, rayon de la paroi)
  const th = T.theta.image.data, P = o.profile, n = P.r.length, ds = P.len / (n - 1);
  for (let k = 0; k < 512; k++) {
    const s = o.theta[k], x = Math.min(n - 1, Math.max(0, s / ds)), i = Math.min(n - 2, Math.floor(x)), f = x - i;
    const r = P.r[i] + (P.r[i + 1] - P.r[i]) * f, y = P.y[i] + (P.y[i + 1] - P.y[i]) * f;
    th.set([s, Math.hypot(r, y), r, 0], k * 4);
  }
  T.theta.needsUpdate = true;
  T.cs.value = cs; T.cp.value = cp; T.sLo.value = P.sLo; T.sHi.value = P.sHi;
  T.rMax.value = P.rMax; T.hub.value = P.hub;
}

// Version rapide (un seul prélèvement) pour la brume : renvoie la transmission
// au-delà de la paroi, et 0 en dedans (la brume intérieure ne se voit pas)
export function makeCookieFast(T, st, { hideInside = true } = {}) {
  return Fn(([pw]) => {
    const W = wallLookup(T, st, pw);
    const v = mix(bilinT(T, st, W.si, W.pk), float(1), W.outOfWall);
    return hideInside ? v.mul(step(W.shell.add(0.004), W.L)) : mix(v, float(1), step(W.L, W.shell.sub(0.004)));
  });
}
