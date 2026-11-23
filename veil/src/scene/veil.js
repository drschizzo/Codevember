// Le voile à l'écran. La simulation (workers) donne n × n particules par image
// enregistrée ; à chaque image du film, on interpole dans le temps (Catmull-
// Rom sur les images voisines du même morceau) et on dépose les positions
// dans un tampon du GPU. Le vertex shader en tire une surface bicubique de
// Catmull-Rom (16 particules par sommet, trois sommets par maille), sa normale
// exacte (dérivées du patch) et sa pose à l'image précédente (vecteurs
// vitesse). L'ourlet roulotté suit le bord de la même surface.
import * as THREE from 'three/webgpu';
import {
  Fn, attribute, storage, int, float, vec2, vec3, vec4, floor, clamp, normalize, cross, uniform, mix, normalLocal, tangentLocal, positionPrevious,
  smoothstep, abs, sin, atan, fract, fwidth, max, min, length, dot, normalView, positionViewDirection, pow, select, step, sqrt, cameraViewMatrix,
  varying, bumpMap, If, screenCoordinate, positionWorld, exp,
} from 'three/tsl';
import { deq } from '../gen/quant.js';
import { G } from '../../../shared/scene/globals.js';
import { isLite, ditherThreshold, stableVelocity, noise } from '../../../shared/scene/materials.js';
import { locate } from '../timeline.js';

// poids de Catmull-Rom et leurs dérivées (JS et TSL partagent la même forme)
const crw = (t) => [t * ((2 - t) * t - 1) * 0.5, (t * t * (3 * t - 5) + 2) * 0.5, t * ((4 - 3 * t) * t + 1) * 0.5, (t - 1) * t * t * 0.5];
const crT = (t) => {
  const t2 = t.mul(t), t3 = t2.mul(t);
  return [t3.negate().add(t2.mul(2)).sub(t).mul(0.5), t3.mul(3).sub(t2.mul(5)).add(2).mul(0.5), t3.mul(-3).add(t2.mul(4)).add(t).mul(0.5), t3.sub(t2).mul(0.5)];
};
const crdT = (t) => {
  const t2 = t.mul(t);
  return [t2.mul(-3).add(t.mul(4)).sub(1).mul(0.5), t2.mul(9).sub(t.mul(10)).mul(0.5), t2.mul(-9).add(t.mul(8)).add(1).mul(0.5), t2.mul(3).sub(t.mul(2)).mul(0.5)];
};

// les dessins de dentelle, dans l'ordre de l'uniforme U.lace
export const LACE_KINDS = ['chantilly', 'guipure', 'filet', 'plumetis', 'cluny', 'ecailles', 'rinceaux'];

export const SUBDIV = 2; // sommets de rendu par maille simulée (et facteur de l'étage fin)

// ── Relecture des morceaux ───────────────────────────────────────────────────
// data = { H, segs: Map('desc:k' | 'rise:k' → { frames: Int16Array, count, fps }) }
export function sampleCloth(out, data, TL, tf, N) {
  const { seg, local } = locate(TL, tf);
  const S = data.segs.get(`${seg.kind}:${seg.k}`);
  if (!S) return false;
  const f = Math.min(S.count - 1, Math.max(0, local * S.fps));
  const i1 = Math.min(S.count - 1, Math.floor(f)), t = f - i1;
  const i0 = Math.max(0, i1 - 1), i2 = Math.min(S.count - 1, i1 + 1), i3 = Math.min(S.count - 1, i1 + 2);
  const [w0, w1, w2, w3] = crw(t);
  const F = S.frames, M = N * 3, o0 = i0 * M, o1 = i1 * M, o2 = i2 * M, o3 = i3 * M;
  for (let k = 0; k < N; k++) {
    for (let c = 0; c < 3; c++) {
      const q = k * 3 + c;
      out[k * 4 + c] = w0 * deq(F[o0 + q], c) + w1 * deq(F[o1 + q], c) + w2 * deq(F[o2 + q], c) + w3 * deq(F[o3 + q], c);
    }
  }
  return true;
}

// ── Géométrie de rendu ───────────────────────────────────────────────────────
function surfaceGeometry(n) {
  const m = (n - 1) * SUBDIV + 1;
  const gp = new Float32Array(m * m * 2), pos = new Float32Array(m * m * 3), nor = new Float32Array(m * m * 3);
  for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) {
    const k = j * m + i;
    gp[k * 2] = i / SUBDIV; gp[k * 2 + 1] = j / SUBDIV;
    pos[k * 3] = i / m; pos[k * 3 + 2] = j / m; nor[k * 3 + 1] = 1;
  }
  const idx = new Uint32Array((m - 1) * (m - 1) * 6);
  let p = 0;
  for (let j = 0; j + 1 < m; j++) for (let i = 0; i + 1 < m; i++) {
    const a = j * m + i, b = a + 1, c = a + m, d = c + 1;
    // (diagonale alternée : pas de direction privilégiée dans les plis)
    if ((i + j) & 1) { idx[p++] = a; idx[p++] = c; idx[p++] = b; idx[p++] = b; idx[p++] = c; idx[p++] = d; }
    else { idx[p++] = a; idx[p++] = c; idx[p++] = d; idx[p++] = a; idx[p++] = d; idx[p++] = b; }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('gp', new THREE.BufferAttribute(gp, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.5, 0), 3);
  return g;
}

// ourlet : un tube de rayon r le long du bord (paramètre s ∈ [0, 4(n−1)),
// angle a autour du bord)
function hemGeometry(n, ring = 8) {
  const per = (n - 1) * SUBDIV * 4;
  const cnt = per * ring;
  const hp = new Float32Array(cnt * 2), pos = new Float32Array(cnt * 3), nor = new Float32Array(cnt * 3);
  for (let i = 0; i < per; i++) for (let a = 0; a < ring; a++) {
    const k = i * ring + a;
    hp[k * 2] = i / SUBDIV; hp[k * 2 + 1] = (a / ring) * Math.PI * 2;
    nor[k * 3 + 1] = 1;
  }
  const idx = new Uint32Array(per * ring * 6);
  let p = 0;
  for (let i = 0; i < per; i++) for (let a = 0; a < ring; a++) {
    const i2 = (i + 1) % per, a2 = (a + 1) % ring;
    const A = i * ring + a, B = i2 * ring + a, C = i2 * ring + a2, D = i * ring + a2;
    idx[p++] = A; idx[p++] = B; idx[p++] = C; idx[p++] = A; idx[p++] = C; idx[p++] = D;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('hp', new THREE.BufferAttribute(hp, 2));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.5, 0), 3);
  return g;
}

// ── Le voile ─────────────────────────────────────────────────────────────────
// fine : l'étage fin (scene/fine.js) ; sans lui (version mobile), la surface
// est le patch de Catmull-Rom de la simulation grossière
export function createVeil(n, fine = null, holo = null) {
  const N = n * n;
  const curA = new THREE.StorageBufferAttribute(new Float32Array(N * 4), 4);
  const prvA = new THREE.StorageBufferAttribute(new Float32Array(N * 4), 4);
  const cur = storage(curA, 'vec4', N).toReadOnly(), prv = storage(prvA, 'vec4', N).toReadOnly();
  const nU = int(n);
  const U = {
    color: uniform(new THREE.Color('#eeeeee')), sheenColor: uniform(new THREE.Color('#ffffff')),
    rough: uniform(0.6), sheen: uniform(1), sheenRough: uniform(0.45),
    open: uniform(0), // part de jour (0 : opaque) — moyenne de la trame
    netScale: uniform(0.003), // pas de la trame (tulle, dentelle), en mètres
    lace: uniform(0), // dessin de la dentelle : indice dans LACE_KINDS
    trans: uniform(0.5), // translucidité (lumière qui traverse)
    weave: uniform(0.3), // relief de l'armure
    h: uniform(0.016), // pas de la grille simulée (m)
    hem: uniform(0.0013),
    // lumière transmise : direction de la lampe (monde, vers la lampe) et
    // éclairement qu'elle donne au sujet (lux de la scène, I/d²)
    keyDir: uniform(new THREE.Vector3(0, 1, 0)), keyE: uniform(1), keyCol: uniform(new THREE.Color('#ffffff')),
    ambE: uniform(0.3), // (part diffuse transmise du reste de la lumière)
    aniso: uniform(0), // anisotropie du lustre (satin)
    // la dentelle (aspect seul) : fil du motif, pas du dessin (m), côté du voile, largeur d'un feston (m)
    color2: uniform(new THREE.Color('#888888')), mScale: uniform(0.06), L: uniform(1), scW: uniform(0.04),
    // la fibre : pas de l'armure (m), relief des fils, réflexion spéculaire
    // (un coton renvoie moitié moins qu'un vernis), humidité du linge (0…1)
    pitch: uniform(0.0007), relief: uniform(1), spec: uniform(0.5), wet: uniform(0.8),
  };

  // point du patch (i, j réels en mailles) : position, dérivées
  const P = (buf, i, j) => buf.element(clamp(j, int(0), nU.sub(1)).mul(nU).add(clamp(i, int(0), nU.sub(1)))).xyz;
  const patch = (buf, g, deriv) => {
    const fi = clamp(g.x, 0, n - 1.0001), fj = clamp(g.y, 0, n - 1.0001);
    const i0 = int(floor(fi)), j0 = int(floor(fj));
    const tu = fi.sub(floor(fi)), tv = fj.sub(floor(fj));
    const wu = crT(tu), wv = crT(tv);
    const du = deriv ? crdT(tu) : null, dv = deriv ? crdT(tv) : null;
    let p = vec3(0), pu = vec3(0), pv = vec3(0);
    for (let b = 0; b < 4; b++) {
      let row = vec3(0), rowU = vec3(0);
      for (let a = 0; a < 4; a++) {
        const q = P(buf, i0.add(a - 1), j0.add(b - 1));
        row = row.add(q.mul(wu[a]));
        if (deriv) rowU = rowU.add(q.mul(du[a]));
      }
      p = p.add(row.mul(wv[b]));
      if (deriv) { pu = pu.add(rowU.mul(wv[b])); pv = pv.add(row.mul(dv[b])); }
    }
    return { p, pu, pv };
  };

  const surfPos = Fn(() => {
    const g = attribute('gp', 'vec2');
    const s = patch(cur, g, true);
    normalLocal.assign(normalize(cross(s.pu, s.pv).add(vec3(0, 1e-7, 0))));
    if (!isLite()) positionPrevious.assign(patch(prv, g, false).p);
    return s.p;
  });

  // ourlet : bord paramétré, rayon U.hem
  const borderGP = (s) => {
    // s ∈ [0, 4(n−1)) : bas (j = 0), droite (i = n−1), haut, gauche
    const L = float(n - 1);
    const side = floor(s.div(L)), t = s.sub(side.mul(L));
    const gx = select(side.lessThan(1), t, select(side.lessThan(2), L, select(side.lessThan(3), L.sub(t), float(0))));
    const gy = select(side.lessThan(1), float(0), select(side.lessThan(2), t, select(side.lessThan(3), L, L.sub(t))));
    // (un rien à l'intérieur : l'ourlet roulé est cousu sur le bord)
    const inset = 0.12;
    return vec2(clamp(gx, inset, L.sub(inset)), clamp(gy, inset, L.sub(inset)));
  };
  const hemFrame = (buf, s, a, deriv) => {
    const S = patch(buf, borderGP(s), true);
    const nrm = normalize(cross(S.pu, S.pv).add(vec3(0, 1e-7, 0)));
    const tg = normalize(S.pu.add(S.pv).add(vec3(1e-7, 0, 0)));
    const bi = normalize(cross(nrm, tg).add(vec3(0, 0, 1e-7)));
    const dir = nrm.mul(a.cos()).add(bi.mul(a.sin()));
    return { p: S.p.add(dir.mul(U.hem)), n: dir };
  };
  // ── l'étage fin : la grille fine calculée sur le GPU (m × m, même grille
  // que le maillage de rendu : SUBDIV = R) ──
  const FM = fine ? fine.m : 0;
  const fcur = fine ? storage(fine.cur, 'vec4', FM * FM).toReadOnly() : null;
  const fprv = fine ? storage(fine.prv, 'vec4', FM * FM).toReadOnly() : null;
  const fmU = int(FM);
  const FP = (buf, i, j) => buf.element(clamp(j, int(0), fmU.sub(1)).mul(fmU).add(clamp(i, int(0), fmU.sub(1)))).xyz;
  const fineIJ = (g) => [int(g.x.mul(SUBDIV).add(0.5)), int(g.y.mul(SUBDIV).add(0.5))];
  const fineNormal = (i, j) => {
    const du = FP(fcur, i.add(1), j).sub(FP(fcur, i.sub(1), j)), dv = FP(fcur, i, j.add(1)).sub(FP(fcur, i, j.sub(1)));
    return normalize(cross(du, dv).add(vec3(0, 1e-7, 0)));
  };
  // le linge collé (étage fin, w) : porté du sommet au fragment
  const fineCling = Fn(() => {
    const [i, j] = fineIJ(attribute('gp', 'vec2'));
    return fcur.element(clamp(j, int(0), fmU.sub(1)).mul(fmU).add(clamp(i, int(0), fmU.sub(1)))).w;
  });
  const finePos = Fn(() => {
    const [i, j] = fineIJ(attribute('gp', 'vec2'));
    normalLocal.assign(fineNormal(i, j));
    if (!isLite()) positionPrevious.assign(FP(fprv, i, j));
    return FP(fcur, i, j);
  });
  // ourlet sur la grille fine : sommet du bord, normale du voile, direction vers l'extérieur
  const fineHem = (buf, s, a) => {
    const L = float(FM - 1);
    const t = s.mul(SUBDIV);
    const side = floor(t.div(L)), q = t.sub(side.mul(L));
    const gx = select(side.lessThan(1), q, select(side.lessThan(2), L, select(side.lessThan(3), L.sub(q), float(0))));
    const gy = select(side.lessThan(1), float(0), select(side.lessThan(2), q, select(side.lessThan(3), L, L.sub(q))));
    const i = int(gx.add(0.5)), j = int(gy.add(0.5));
    const p = FP(buf, i, j), nrm = fineNormal(i, j);
    // (vers l'extérieur : du voisin intérieur vers le sommet, dans le plan du voile)
    const out0 = p.sub(FP(buf, clamp(i.add(select(gx.lessThan(L.mul(0.5)), int(1), int(-1))), int(0), fmU.sub(1)), clamp(j.add(select(gy.lessThan(L.mul(0.5)), int(1), int(-1))), int(0), fmU.sub(1))));
    const out = normalize(out0.sub(nrm.mul(dot(out0, nrm))).add(vec3(1e-7, 0, 0)));
    const dir = nrm.mul(a.cos()).add(out.mul(a.sin()));
    return { p: p.add(dir.mul(U.hem)), n: dir };
  };
  const fineHemPos = Fn(() => {
    const hp = attribute('hp', 'vec2');
    const F = fineHem(fcur, hp.x, hp.y);
    normalLocal.assign(F.n);
    if (!isLite()) positionPrevious.assign(fineHem(fprv, hp.x, hp.y).p);
    return F.p;
  });

  const hemPos = Fn(() => {
    const hp = attribute('hp', 'vec2');
    const F = hemFrame(cur, hp.x, hp.y);
    normalLocal.assign(F.n);
    if (!isLite()) positionPrevious.assign(hemFrame(prv, hp.x, hp.y).p);
    return F.p;
  });

  // ── Matière : la dentelle ──
  // coordonnées de l'étoffe (m) : gp × h
  const cloth = () => attribute('gp', 'vec2').mul(U.h);
  // petits outils de dessin : dedans(d) vaut 1 où d < 0, trait(d, w) vaut 1 à
  // moins de w de d = 0 ; f est la largeur du pixel dans l'unité de d
  const dedans = (d, f) => float(1).sub(smoothstep(f.negate(), f, d));
  const trait = (d, w, f) => float(1).sub(smoothstep(float(w).sub(f), float(w).add(f), abs(d)));
  const rot2 = (v, a) => vec2(v.x.mul(Math.cos(a)).add(v.y.mul(Math.sin(a))), v.y.mul(Math.cos(a)).sub(v.x.mul(Math.sin(a))));
  // feuille en amande, grand axe a le long de x, demi-largeur b
  const amande = (v, a, b) => max(abs(v.y).sub(float(b).mul(float(1).sub(v.x.div(a).mul(v.x.div(a))))), abs(v.x).sub(a));
  // réseau de tulle : mailles hexagonales à fil fin (demi-largeur t, en pas) ;
  // la distance est celle de l'hexagone, les fils ont donc partout la même
  // largeur (des jours ronds donnaient une tôle perforée) ; sous le pixel, sa moyenne
  const tulle = (p, pitch, t, fwp) => {
    const uv = p.div(pitch), r = vec2(1, 1.7320508);
    const a = fract(uv.div(r)).sub(0.5).mul(r), b = fract(uv.sub(r.mul(0.5)).div(r)).sub(0.5).mul(r);
    const v = select(length(a).lessThan(length(b)), a, b);
    const hd = max(abs(v.x), abs(v.x).mul(0.5).add(abs(v.y).mul(0.8660254))), f = fwp.div(pitch);
    const fil = smoothstep(float(0.5 - t).sub(f), float(0.5 - t).add(f), hd);
    return mix(fil, float(1 - (1 - 2 * t) ** 2), smoothstep(0.3, 0.7, f));
  };
  // Les dessins. Chacun rend (fond, toilé, cordonnet) : la part de fil du
  // réseau, le masque du toilé (une toile tissée, à demi ajourée) et celui du
  // cordonnet (le fil de contour et les pleins brodés, opaques et en saillie). Un seul
  // est évalué par fragment (branche sur l'uniforme U.lace).
  const DESSINS = {
    // Chantilly : fleurs à cinq pétales en quinconce, brins de deux feuilles, sur tulle
    chantilly: (p, q, f, fwp) => {
      const sq = q.add(vec2(floor(q.y).mul(0.5), 0)), c = fract(sq).sub(0.5), r = length(c), th = atan(c.y, c.x);
      const fl = r.sub(float(0.27).add(th.mul(5).cos().mul(0.11)));
      const nerv = trait(th.mul(2.5).sin().mul(r), 0.007, f).mul(dedans(fl.add(0.03), f)).mul(float(1).sub(dedans(r.sub(0.115), f)));
      const c2 = fract(sq.add(0.5)).sub(0.5), m = rot2(vec2(abs(c2.x), c2.y).sub(vec2(0.11, 0.03)), 0.7);
      const lf = amande(m, 0.1, 0.045);
      const toile = max(dedans(fl, f), dedans(lf, f));
      const cord = max(max(max(trait(fl, 0.018, f), trait(r.sub(0.115), 0.012, f)), max(trait(lf, 0.013, f), trait(m.y, 0.007, f).mul(dedans(abs(m.x).sub(0.1), f)))), max(nerv, max(dedans(r.sub(0.055), f), dedans(length(c2).sub(0.035), f))));
      return vec3(tulle(p, 0.0026, 0.09, fwp), toile, cord);
    },
    // guipure : marguerites ajourées reliées par des brides, sans réseau
    guipure: (p, q, f) => {
      const c = fract(q).sub(0.5), r = length(c), th = atan(c.y, c.x);
      const fl = r.sub(float(0.33).add(th.mul(8).cos().mul(0.07)));
      const rayons = trait(th.mul(4).sin().mul(r), 0.018, f).mul(dedans(r.sub(0.36), f)).mul(float(1).sub(dedans(r.sub(0.13), f)));
      const brides = max(trait(c.y, 0.02, f).mul(float(1).sub(dedans(abs(c.x).sub(0.37), f))), trait(c.x, 0.02, f).mul(float(1).sub(dedans(abs(c.y).sub(0.37), f))));
      const c2 = fract(q.add(0.5)).sub(0.5), r2 = length(c2);
      const coin = max(trait(r2.sub(0.1), 0.028, f), trait(abs(c2.x).sub(abs(c2.y)).mul(0.7071), 0.018, f).mul(dedans(r2.sub(0.3), f)).mul(float(1).sub(dedans(r2.sub(0.1), f))));
      const plein = max(max(trait(fl, 0.035, f), trait(r.sub(0.13), 0.03, f)), max(dedans(r.sub(0.055), f), max(rayons, max(brides, coin))));
      return vec3(0, 0, plein);
    },
    // filet brodé : réseau carré, carreaux reprisés en losanges et croisettes
    filet: (p, q, f) => {
      const g = q.mul(12), ig = floor(g), cg = fract(g).sub(0.5), fg = f.mul(12);
      const fil = float(1).sub(dedans(max(abs(cg.x), abs(cg.y)).sub(0.4), fg));
      const u = abs(ig.x.mod(12).sub(6)), v = abs(ig.y.mod(12).sub(6)), d1 = u.add(v);
      const on = d1.greaterThan(2.5).and(d1.lessThan(4.5)).or(d1.lessThan(1.5)).or(max(u, v).greaterThan(5.5).and(min(u, v).lessThan(1.5)));
      const plein = select(on, dedans(max(abs(cg.x), abs(cg.y)).sub(0.47), fg), float(0));
      return vec3(mix(fil, float(0.36), smoothstep(0.3, 0.7, fg)), 0, mix(plein, select(on, float(1), float(0)), smoothstep(0.3, 0.7, fg))); // (carreaux reprisés : pleins)
    },
    // plumetis : semis de pois brodés sur un tulle fin
    plumetis: (p, q, f, fwp) => {
      const sq = q.add(vec2(floor(q.y).mul(0.5), 0)), c = fract(sq).sub(0.5), r = length(c);
      return vec3(tulle(p, 0.0022, 0.075, fwp), 0, dedans(r.sub(0.15), f));
    },
    // Cluny : treillis de tresses en biais, araignées aux croisements, quatre-feuilles dans les jours
    cluny: (p, q, f, fwp) => {
      const d = vec2(q.x.add(q.y), q.x.sub(q.y)), cu = fract(d.x).sub(0.5), cv = fract(d.y).sub(0.5), fd = f.mul(1.41);
      const tresse = max(trait(cu, 0.075, fd), trait(cv, 0.075, fd));
      const natte = max(trait(cu, 0.075, fd).mul(d.y.mul(75).sin().mul(0.5).add(0.5)), trait(cv, 0.075, fd).mul(d.x.mul(75).sin().mul(0.5).add(0.5)));
      const araignee = dedans(length(vec2(cu, cv)).sub(0.19), fd);
      const c2 = fract(d.add(0.5)).sub(0.5), r2 = length(c2), t2 = atan(c2.y, c2.x);
      const feuille = r2.sub(abs(t2.mul(2).cos()).mul(0.27));
      return vec3(tulle(p, 0.004, 0.07, fwp), max(tresse.mul(natte.mul(0.5).add(0.5)), dedans(feuille, fd)), max(araignee, max(trait(abs(cu).sub(0.075), 0.012, fd), max(trait(abs(cv).sub(0.075), 0.012, fd), trait(feuille, 0.02, fd)))));
    },
    // écailles : éventails qui se recouvrent, rangs décalés d'une moitié
    ecailles: (p, q, f, fwp) => {
      const R = 0.5, dy = 0.25, k0 = q.y.sub(R).div(dy).ceil();
      let t = float(2);
      for (let i = 3; i >= 0; i--) { // (le rang le plus bas qui couvre le point passe devant)
        const k = k0.add(i), off = k.mod(2).mul(0.5), cx = q.x.sub(off).add(0.5).floor().add(off);
        const dd = length(q.sub(vec2(cx, k.mul(dy)))).div(R);
        t = select(dd.lessThan(1), dd, t);
      }
      const ft = f.div(R);
      const cord = max(trait(t.sub(0.93), 0.06, ft), max(trait(t.sub(0.62), 0.028, ft), trait(t.sub(0.36), 0.028, ft)));
      return vec3(tulle(p, 0.0028, 0.09, fwp), 0, max(cord, dedans(t.sub(0.17), ft)));
    },
    // rinceaux : une tige qui ondule, une fleur à chaque crête, deux feuilles à chaque nœud
    rinceaux: (p, q, f, fwp) => {
      const row = floor(q.y), x = q.x.add(row.mod(2).mul(0.5)), cy = fract(q.y).sub(0.5), A = 0.2, w = Math.PI * 2;
      const y0 = x.mul(w).sin().mul(A), sl = x.mul(w).cos().mul(A * w);
      const tige = trait(cy.sub(y0).div(sqrt(sl.mul(sl).add(1))), 0.026, f);
      const hx = x.mul(2).add(0.5), sg = floor(hx).mod(2).mul(-2).add(1); // (crête à x = 1/4, creux à x = 3/4)
      const c3 = vec2(fract(hx).sub(0.5).mul(0.5), cy.sub(sg.mul(A + 0.13))), r3 = length(c3), t3 = atan(c3.y, c3.x);
      const fl = r3.sub(float(0.1).add(t3.mul(5).cos().mul(0.045)));
      const sn = floor(x.mul(2)).mod(2).mul(-2).add(1); // (pente de la tige au nœud : +, −, +…)
      const c4 = vec2(fract(x.mul(2)).sub(0.5).mul(0.5).mul(sn), cy), m4 = rot2(c4, 0.9), m = rot2(vec2(m4.x, abs(m4.y)).sub(vec2(0.0, 0.075)), 1.0);
      const lf = amande(m, 0.085, 0.036);
      const toile = max(dedans(fl, f), dedans(lf, f));
      return vec3(tulle(p, 0.0026, 0.09, fwp), toile, max(max(tige, dedans(r3.sub(0.03), f)), max(trait(fl, 0.015, f), max(trait(lf, 0.012, f), trait(m.y, 0.006, f).mul(dedans(abs(m.x).sub(0.085), f))))));
    },
  };
  // la dentelle au point de l'étoffe : (couverture, toilé, cordonnet). Le bord
  // est festonné : des lobes ronds, un galon qui les suit, un œillet par lobe.
  const lace = Fn(() => {
    // (variables posées avant les branches : un nœud émis pour la première
    // fois dans une branche n'existe pas en dehors d'elle)
    const p = cloth().toVar(), s = U.mScale, q = p.div(s).toVar();
    const fwp = fwidth(p.x).add(fwidth(p.y)).mul(0.5).add(1e-6).toVar(), f = fwp.div(s).toVar();
    const o = vec3(0).toVar();
    LACE_KINDS.reduce((chain, kind, i) => {
      const body = () => { o.assign(DESSINS[kind](p, q, f, fwp)); };
      return i === 0 ? If(U.lace.lessThan(0.5), body) : i === LACE_KINDS.length - 1 ? chain.Else(body) : chain.ElseIf(U.lace.lessThan(i + 0.5), body);
    }, null);
    // (loin : le motif passe sous le pixel, il ne reste que sa moyenne)
    const far = smoothstep(0.22, 0.5, f);
    const toile = mix(o.y, float(0.3), far), cord = mix(o.z, float(0.1), far);
    // le toilé : une toile tissée serrée, à petits jours carrés (pas de 0,6 mm)
    const g = p.div(0.0006), fg = fwp.div(0.0006);
    const jour = dedans(max(abs(fract(g.x).sub(0.5)), abs(fract(g.y).sub(0.5))).sub(0.27), fg);
    const tissu = mix(float(1).sub(jour), float(0.71), smoothstep(0.3, 0.7, fg));
    // le feston
    const ex = min(p.x, U.L.sub(p.x)), ey = min(p.y, U.L.sub(p.y)), e = min(ex, ey), sa = select(ex.lessThan(ey), p.y, p.x);
    const w = U.scW, fe = fwp.div(w);
    const ph = sa.div(w), de = e.div(w).sub(float(0.3).mul(float(1).sub(abs(ph.mul(Math.PI).sin())))); // (> 0 : dans l'étoffe)
    const galon = dedans(de.sub(0.1), fe), filet2 = trait(de.sub(0.24), 0.02, fe);
    const c5 = vec2(fract(ph).sub(0.5), e.div(w).sub(0.42)), r5 = length(c5);
    const oeil = dedans(r5.sub(0.085), fe), tour = trait(r5.sub(0.11), 0.035, fe);
    const fil = max(max(cord, galon), max(filet2, tour));
    const cov = max(max(o.x, toile.mul(tissu)), fil).mul(float(1).sub(dedans(de, fe))).mul(float(1).sub(oeil));
    // (relief du tissage, pour la normale : dans le toilé seulement, et tant qu'il se voit)
    const grain = g.x.mul(Math.PI).sin().mul(g.y.mul(Math.PI).sin()).mul(toile).mul(float(1).sub(smoothstep(0.25, 0.6, fg)));
    return vec4(cov, toile, fil, grain);
  });

  // ── La fibre : relief sous le pixel, filtré ──
  // fils irréguliers (flammes de filature) et froissure d'un linge déjà plié ;
  // le tout s'efface en sa moyenne quand il passe sous le pixel
  const fiber = Fn(([cling]) => {
    const p = cloth();
    const fs = fwidth(p.x).add(fwidth(p.y)); // (mètres par pixel)
    const slubA = noise(vec3(p.x.mul(18), p.y.mul(520), 0.37)).sub(0.5), slubB = noise(vec3(p.x.mul(520), p.y.mul(18), 1.91)).sub(0.5);
    const slub = slubA.add(slubB).mul(float(1).sub(smoothstep(0.0012, 0.004, fs)));
    const crease = noise(vec3(p.x.mul(42), p.y.mul(42), 3.3)).sub(0.5).mul(0.6).add(noise(vec3(p.x.mul(9), p.y.mul(9), 5.1)).sub(0.5).mul(0.4));
    // (mouillé et plaqué, le linge se lisse : les fils se couchent)
    return slub.mul(0.5).add(crease.mul(0.8)).mul(U.relief).mul(float(1).sub(cling.mul(0.65)));
  });

  function material({ hem = false } = {}) {
    const m = new THREE.MeshPhysicalNodeMaterial({ side: THREE.DoubleSide });
    m.positionNode = fine ? (hem ? fineHemPos() : finePos()) : (hem ? hemPos() : surfPos());
    const lc = hem ? vec4(1, 1, 0, 0) : lace();
    const toile = lc.y, cord = lc.z;
    // le linge collé à la statue : l'eau le plaque, il fonce (moins de
    // diffusion entre les fils) et se lisse (un film d'eau) ; humide partout,
    // il fonce un peu
    const cling = fine && !hem ? varying(fineCling()).clamp(0, 1).mul(U.wet) : float(0);
    // (le motif peut être d'un autre fil que le réseau : or sur noir, blanc sur ivoire)
    // (le second fil est celui du cordonnet ; le toilé n'en prend qu'un reflet —
    // entièrement teint, le motif devenait un aplat collé sur le réseau)
    const base = mix(U.color, U.color2, max(cord, toile.mul(0.3)).clamp(0, 1)).mul(float(1).sub(U.wet.mul(0.08)));
    m.colorNode = base.mul(mix(float(1), float(0.7), cling));
    // (le cordonnet est un fil retors, plus lisse et plus brillant que le réseau)
    const r0 = U.rough.sub(cord.mul(0.18));
    m.roughnessNode = mix(r0, r0.mul(0.55).max(0.2), cling);
    m.specularIntensityNode = U.spec.mul(float(1).add(cling.mul(0.6))).mul(float(1).add(cord.mul(0.4)));
    // relief : le toilé est plus épais que le réseau, le cordonnet le borde en saillie
    if (!hem) m.normalNode = bumpMap(fiber(cling).add(toile.mul(0.8)).add(cord.mul(1.8)).add(lc.w.mul(0.35)), 0.0012);
    m.metalnessNode = float(0);
    m.sheen = 1;
    m.sheenNode = U.sheenColor.mul(U.sheen).mul(float(1).sub(cling.mul(0.6)));
    m.sheenRoughnessNode = U.sheenRough;
    if (!hem) {
      // translucidité : un voile mince laisse passer une part de la lumière
      // qui éclaire son autre face (diffusion dans les fils, Lambert de
      // l'autre côté) ; elle sort teintée par l'étoffe. Le toilé, plus épais,
      // en laisse passer moins que le réseau.
      const Lv = normalize(cameraViewMatrix.mul(vec4(U.keyDir, 0)).xyz);
      const back = max(dot(normalView, Lv).negate(), 0);
      m.emissiveNode = base.mul(U.trans).mul(float(1).sub(toile.mul(0.55))).mul(float(1).add(cling.mul(0.8))).mul(U.keyCol.mul(back.mul(U.keyE)).add(U.ambE.mul(0.25))).mul(1 / Math.PI);
      // l'hologramme éclaire la dentelle : la bande qui le parcourt est une
      // source de lumière, et le linge qui la longe la reçoit, d'autant plus
      // qu'il est près de la statue (portée de 5 cm) ; hors de la bande, un
      // reste de lueur là où il la touche
      if (holo) {
        const H = holo.U;
        const glow = Fn(() => {
          const o = float(0).toVar();
          If(H.amp.greaterThan(0.002), () => {
            const q = positionWorld.sub(H.org).div(H.size);
            If(q.x.greaterThan(0).and(q.y.greaterThan(0)).and(q.z.greaterThan(0)).and(q.x.lessThan(1)).and(q.y.lessThan(1)).and(q.z.lessThan(1)), () => {
              const d = holo.sd(q).max(0);
              const band = exp(abs(positionWorld.y.sub(H.scan)).mul(-34));
              o.assign(exp(d.mul(-20)).mul(band.mul(1.5).add(0.08)).mul(H.amp));
            });
          });
          return o;
        })();
        m.emissiveNode = m.emissiveNode.add(H.col.mul(glow).mul(2.2).mul(max(toile, cord).mul(0.5).add(0.5)));
      }
      m.maskNode = lc.x.greaterThan(ditherThreshold(7));
      // ombre portée : tramée elle aussi (trame fixe dans la carte d'ombre,
      // que son filtre adoucit) — le réseau laisse passer la moitié de la
      // lumière, le motif la retient, et la dentelle se dessine sur le socle
      const sx = screenCoordinate.x, sy = screenCoordinate.y;
      m.maskShadowNode = lace().x.greaterThan(fract(fract(sx.mul(0.06711056).add(sy.mul(0.00583715))).mul(52.9829189)));
    }
    const v = stableVelocity();
    if (v) m.mrtNode = v;
    return m;
  }

  const geo = surfaceGeometry(n);
  const mesh = new THREE.Mesh(geo, material());
  mesh.frustumCulled = false;
  mesh.castShadow = true; mesh.receiveShadow = true;
  const hem = new THREE.Mesh(hemGeometry(n), material({ hem: true }));
  hem.frustumCulled = false;
  hem.castShadow = true; hem.receiveShadow = true;
  const group = new THREE.Group();
  // doublure de profondeur : le voile plein, sans ses jours, qui n'écrit que la
  // profondeur, après les objets opaques. L'hologramme ne passe que là où
  // quelque chose est devant lui : avec la dentelle seule, il n'apparaissait
  // que sur les fils. Montrée seulement pendant qu'il luit.
  const twinMat = new THREE.MeshBasicNodeMaterial({ transparent: true, colorWrite: false, depthWrite: true, side: THREE.DoubleSide });
  twinMat.positionNode = fine ? finePos() : surfPos();
  const depthTwin = new THREE.Mesh(geo, twinMat);
  depthTwin.frustumCulled = false; depthTwin.renderOrder = 2; depthTwin.visible = false;
  depthTwin.castShadow = depthTwin.receiveShadow = false;
  hem.visible = false; // (une dentelle n'a pas d'ourlet roulotté : son bord est festonné, dans la matière)
  group.add(mesh, hem, depthTwin);

  const tmp = { cur: curA.array, prv: prvA.array };
  return {
    group, mesh, hem, depthTwin, U, n, N,
    // dépose l'image du film tf (et la précédente, tfPrev)
    upload(data, TL, tf, tfPrev) {
      if (!sampleCloth(tmp.cur, data, TL, tf, N)) return false;
      sampleCloth(tmp.prv, data, TL, tfPrev, N);
      curA.needsUpdate = true; prvA.needsUpdate = true;
      return true;
    },
    knot(out) { const c = ((n - 1) >> 1) * n + ((n - 1) >> 1); out.set(tmp.cur[c * 4], tmp.cur[c * 4 + 1], tmp.cur[c * 4 + 2]); return out; },
    positions: () => tmp.cur,
    dispose() { geo.dispose(); hem.geometry.dispose(); mesh.material.dispose(); hem.material.dispose(); twinMat.dispose(); },
  };
}
