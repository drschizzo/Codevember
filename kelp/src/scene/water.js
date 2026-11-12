// L'eau : les champs enregistrés de la mer (gen/sea.js) lus sur le GPU, la
// surface (vue d'en dessus et d'en dessous), et le milieu — le brouillard
// d'eau calculé pour chaque pixel sur la partie immergée de son rayon, depuis
// le hublot-dôme de la caméra.
//
// Une seule horloge : la hauteur de l'eau, son courant, son écume et ses
// bulles sont lus dans la même texture (x le long du profil, t le long de la
// boucle) par la surface, le brouillard, la roche (mouillée), les laminaires
// (soleil atténué sous l'eau) et la caméra (ménisque sur le dôme).
import * as THREE from 'three/webgpu';
import {
  Fn, uniform, texture, vec2, vec3, vec4, float, positionWorld, cameraPosition, normalize, length, max, min, exp, mix, select,
  clamp, output, smoothstep, sqrt, dot, reflect, abs, pow, positionLocal, normalLocal, attribute, If, fract, sin, cos, equirectUV,
  normalWorld, mrt, velocity, positionPrevious,
} from 'three/tsl';
import { NZ, noise, fbm } from './materials.js';
import { G } from './globals.js';

const g = 9.81;

function dataTex(data, w, h, type = THREE.HalfFloatType, format = THREE.RGBAFormat, wrapT = THREE.ClampToEdgeWrapping) {
  const t = new THREE.DataTexture(data, w, h, format, type);
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.wrapS = THREE.ClampToEdgeWrapping; t.wrapT = wrapT;
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

export function createWater() {
  // ── uniformes (une scène les remplit, la boucle les avance) ──
  const U = {
    t: uniform(0), tPrev: uniform(0),
    obliq: uniform(0.06), zRef: uniform(0.8),
    seaX0: uniform(-9), seaW: uniform(19), fps: uniform(60), nf: uniform(1920),
    box: uniform(new THREE.Vector4(-7, -12, 16, 16)), // (x0, z0, largeur, profondeur) de la roche cuite
    ext: uniform(new THREE.Vector3(0.6, 0.2, 0.28)), tint: uniform(new THREE.Color(0.1, 0.3, 0.25)), scat: uniform(0.3),
    dome: uniform(0.09),
    sunDir: uniform(new THREE.Vector3(0, 1, 0)), sunE: uniform(new THREE.Color(1, 1, 1)), skyE: uniform(new THREE.Color(0.3, 0.4, 0.5)),
    haze: uniform(new THREE.Color(0.7, 0.75, 0.8)), hazeDist: uniform(90), glow: uniform(0),
    // vagues au large (champ lointain, mêmes vagues que le bord de la simulation)
    w0: uniform(new THREE.Vector4()), w1: uniform(new THREE.Vector4()), w2: uniform(new THREE.Vector4()),
    v0: uniform(new THREE.Vector4()), v1: uniform(new THREE.Vector4()), v2: uniform(new THREE.Vector4()),
    T: uniform(32), c0: uniform(Math.sqrt(g * 1.4)),
    foamK: uniform(1), caustic: uniform(1),
  };
  // textures provisoires (remplacées à l'arrivée d'une scène)
  const seaT = texture(dataTex(new Uint16Array(4 * 4), 2, 2, THREE.HalfFloatType, THREE.RGBAFormat, THREE.RepeatWrapping));
  const wetT = texture(dataTex(new Uint16Array(4), 2, 2, THREE.HalfFloatType, THREE.RedFormat, THREE.RepeatWrapping));
  const fillT = texture(dataTex(new Uint16Array(4), 2, 2, THREE.HalfFloatType, THREE.RedFormat));
  const reliefT = texture(dataTex(new Uint16Array(16), 2, 2));
  const profT = texture(dataTex(new Uint16Array(8), 2, 1));

  // ── lectures ──
  // le temps local : la houle arrive en biais (retard le long de la côte)
  const localT = (z, t) => t.sub(z.sub(U.zRef).mul(U.obliq));
  const fieldUV = (x, tl) => vec2(x.sub(U.seaX0).div(U.seaW), tl.mul(U.fps).add(0.5).div(U.nf));
  // vague incidente au large (forme analytique, la même qu'au bord de la simulation)
  const oneWave = (w, v, t) => {
    let s = float(0);
    for (const k of [-1, 0, 1]) {
      const dt = t.sub(w.x).sub(U.T.mul(k));
      s = s.add(w.y.mul(exp(dt.div(v.x).pow(2).negate()))).sub(w.y.mul(w.z).mul(exp(dt.add(w.w).div(v.y).pow(2).negate())));
    }
    return s;
  };
  const farEta = (x, tl) => {
    const tt = tl.sub(U.seaX0.sub(x).max(0).div(U.c0));
    // (le temps est replié sur la boucle)
    const tw = tt.sub(U.T.mul(tt.div(U.T).floor()));
    return oneWave(U.w0, U.v0, tw).add(oneWave(U.w1, U.v1, tw)).add(oneWave(U.w2, U.v2, tw)).mul(smoothstep(-90, -30, x));
  };
  // (η, u, écume, bulles) au point (x, z) à l'instant t
  const sea = (x, z, t) => {
    const tl = localT(z, t);
    const s = seaT.sample(fieldUV(x, tl)).level(0);
    const far = farEta(x, tl);
    const wf = smoothstep(U.seaX0.add(0.6), U.seaX0.add(0.15), x);
    return vec4(mix(s.x, far, wf), s.y.mul(wf.oneMinus()), s.z.mul(wf.oneMinus()), s.w.mul(wf.oneMinus()));
  };
  const boxUV = (x, z) => vec2(x.sub(U.box.x).div(U.box.z), z.sub(U.box.y).div(U.box.w));
  const inBox = (x, z) => {
    const q = boxUV(x, z);
    return smoothstep(0, 0.02, q.x).mul(smoothstep(1, 0.98, q.x)).mul(smoothstep(0, 0.02, q.y)).mul(smoothstep(1, 0.98, q.y));
  };
  // la roche : cuite dans la boîte, le profil moyen au-delà
  const rockAt = (x, z) => {
    const prof = profT.sample(vec2(x.sub(U.seaX0).div(U.seaW), 0.5)).level(0).x;
    const r = reliefT.sample(boxUV(x, z)).level(0).x;
    return mix(prof, r, inBox(x, z));
  };
  const pool = (x, z) => mix(float(-9), fillT.sample(boxUV(x, z)).level(0).x, inBox(x, z).step(0.999));
  const level = (x, z, t) => max(sea(x, z, t).x, pool(x, z));
  // enveloppe de séchage : la roche sous ce niveau est encore mouillée
  const wetLevel = (x, z, t) => max(wetT.sample(fieldUV(x, localT(z, t))).level(0).x, pool(x, z).add(0.02));

  // ── le milieu : brouillard d'eau sur la partie immergée du rayon ──
  // (le rayon part du hublot-dôme, à `dome` devant le centre optique ; le
  // niveau de l'eau le long du rayon est pris linéaire entre ses deux bouts)
  const medium = Fn(([P, C, rgbIn]) => {
    const d = P.sub(C), L = length(d).max(1e-4), dir = d.div(L);
    const O = C.add(dir.mul(U.dome));
    const segL = L.sub(U.dome).max(0);
    const a = O.y.sub(level(O.x, O.z, U.t)).toVar(), b = P.y.sub(level(P.x, P.z, U.t)).toVar();
    const s0 = a.div(a.sub(b).add(select(a.sub(b).greaterThanEqual(0), 1e-6, -1e-6))).clamp(0, 1);
    const aIn = a.lessThan(0), bIn = b.lessThan(0);
    const frac = select(aIn, select(bIn, float(1), s0), select(bIn, s0.oneMinus(), float(0)));
    const lw = segL.mul(frac);
    const sA = select(aIn, float(0), s0), sB = select(bIn, float(1), s0);
    const M = O.add(P.sub(O).mul(sA.add(sB).mul(0.5)));
    const sm = sea(M.x, M.z, U.t);
    const aer = sm.w.clamp(0, 1.2);
    const depthM = level(M.x, M.z, U.t).sub(M.y).max(0);
    // l'eau aérée diffuse fort et blanc
    const sig = vec3(U.ext).add(aer.mul(2.5));
    const Tr = exp(sig.mul(lw).negate());
    // lumière diffusée : soleil et ciel qui descendent jusqu'à cette profondeur
    const down = exp(vec3(U.ext).mul(depthM).negate());
    const E = vec3(U.sunE).mul(U.sunDir.y.max(0)).add(vec3(U.skyE));
    const ins = mix(vec3(U.tint).mul(0.5), vec3(0.5, 0.56, 0.55), aer.div(aer.add(0.6)).mul(0.8)).mul(E).mul(down);
    // la nuit : l'eau agitée s'allume (noctiluques)
    const lum = vec3(0.15, 0.55, 1.0).mul(U.glow).mul(aer.mul(2.2).add(sm.z.mul(0.6)));
    let rgb = rgbIn.mul(Tr).add(ins.add(lum).mul(Tr.oneMinus()));
    // brume de l'air au loin
    const la = L.sub(lw);
    rgb = mix(rgb, vec3(U.haze), float(1).sub(exp(la.div(U.hazeDist).negate())).mul(0.85));
    // (le fond — le ciel — est à l'infini : sa position n'est pas finie, on n'y touche pas)
    return select(L.lessThan(5000), rgb, rgbIn);
  });
  const fogNode = Fn(() => vec4(medium(positionWorld, cameraPosition, output.rgb), output.a))();

  // ── le soleil sous l'eau (pour receivedShadowNode) ──
  // atténuation sur le chemin réfracté jusqu'au point, et caustiques
  const caustic = (P, depth) => {
    const ph = G.phase.mul(4); // (le volume de bruit est périodique : 4 cellules = une boucle)
    const q = vec3(P.x.mul(5.5), P.z.mul(5.5), ph);
    const w1 = NZ(q).w, w2 = NZ(q.mul(1.37).add(vec3(1.7, 3.1, 2.0))).w;
    const lines = smoothstep(0.16, 0.0, w1).add(smoothstep(0.12, 0.0, w2).mul(0.7));
    return float(1).add(lines.mul(1.0).sub(0.25).mul(smoothstep(0.02, 0.25, depth)).mul(smoothstep(3, 0.6, depth)).mul(U.caustic));
  };
  const sunAtten = (P) => {
    const w = level(P.x, P.z, U.t), depth = w.sub(P.y).max(0);
    const sy = U.sunDir.y.max(0.05), cr = sqrt(float(1).sub(float(1).sub(sy.mul(sy)).div(1.77))); // (cos de l'angle réfracté)
    const Tr = exp(vec3(U.ext).mul(depth.div(cr)).negate());
    return mix(vec3(1), Tr.mul(caustic(P, depth)), smoothstep(0.0, 0.01, depth));
  };
  const receivedShadow = (shadow) => shadow.mul(sunAtten(positionWorld));

  return { U, seaT, wetT, fillT, reliefT, profT, sea, level, wetLevel, rockAt, pool, medium, fogNode, sunAtten, receivedShadow, inBox, boxUV, dataTex };
}

// ── La surface ───────────────────────────────────────────────────────────────
// Une grille dense près de la caméra, de plus en plus lâche vers le large et
// le long de la côte ; le vertex shader la pose sur le niveau de l'eau, ou la
// cache sous la roche là où le platier est sec.
export function gridGeometry(xs, zs) {
  const nx = xs.length, nz = zs.length;
  const pos = new Float32Array(nx * nz * 3), nor = new Float32Array(nx * nz * 3);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const k = (j * nx + i) * 3; pos[k] = xs[i]; pos[k + 2] = zs[j]; nor[k + 1] = 1; }
  const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
  let o = 0;
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
    idx[o++] = a; idx[o++] = c; idx[o++] = b; idx[o++] = b; idx[o++] = c; idx[o++] = d;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1e4);
  return geo;
}
// abscisses : pas fin dans [a, b], puis croissance géométrique jusqu'à lo et hi
export function spacing(lo, a, b, hi, step, grow = 1.08) {
  const v = [];
  for (let x = a; x <= b + 1e-9; x += step) v.push(x);
  let s = step, x = a;
  while (x > lo) { s *= grow; x -= s; v.unshift(Math.max(lo, x)); }
  s = step; x = v[v.length - 1];
  while (x < hi) { s *= grow; x += s; v.push(Math.min(hi, x)); }
  return v;
}

export function createSurface(W, skyTex, lite) {
  const { U } = W;
  const geo = gridGeometry(spacing(-160, -4.5, 4.5, 40, lite ? 0.05 : 0.03), spacing(-260, -10, 3.2, 60, lite ? 0.05 : 0.03));
  const mat = new THREE.MeshBasicNodeMaterial();
  mat.transparent = true;
  mat.depthWrite = true;
  mat.fog = false;
  mat.side = THREE.DoubleSide;
  mat.blending = THREE.CustomBlending;
  mat.blendSrc = THREE.OneFactor; mat.blendDst = THREE.OneMinusSrcAlphaFactor;
  mat.blendSrcAlpha = THREE.OneFactor; mat.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;

  // pose : sur l'eau, ou sous la roche (sec)
  const pose = (p, t) => {
    const x = p.x, z = p.z;
    const lv = W.level(x, z, t), rk = W.rockAt(x, z);
    const wet = lv.sub(rk).greaterThan(0.0015);
    return vec3(x, select(wet, lv, rk.sub(0.06)), z);
  };
  mat.positionNode = Fn(() => {
    const p = positionLocal;
    const e = 0.025;
    const c = pose(p, U.t), px = pose(p.add(vec3(e, 0, 0)), U.t), pz = pose(p.add(vec3(0, 0, e)), U.t);
    normalLocal.assign(normalize(vec3(c.y.sub(px.y).div(e), 1, c.y.sub(pz.y).div(e))));
    positionPrevious.assign(pose(p, U.tPrev)); // (vecteurs vitesse : la surface bouge par ses sommets)
    return c;
  })();

  // couleur : vue d'en dessus (reflet de Fresnel, reflet du soleil, écume, ce qui
  // est dessous par transparence) ou d'en dessous (fenêtre de Snell, réflexion
  // totale), puis le milieu traversé depuis le dôme
  const skyT = texture(skyTex);
  const out = Fn(() => {
    const P = positionWorld, C = cameraPosition;
    const v = normalize(C.sub(P));
    const dir = v.negate();
    const O = C.add(dir.mul(U.dome));
    const above = O.y.greaterThan(W.level(O.x, O.z, U.t));
    const sm = W.sea(P.x, P.z, U.t);
    const speed = sm.y.abs();
    // rides : fines ondulations du vent, plus hachées dans le ressaut
    // (motifs entraînés par le courant : deux phases décalées, fondues — « flow map » —
    // de période T/8, donc périodiques sur la boucle)
    const tau = U.T.div(8), ph1 = U.t.div(tau).fract(), ph2 = U.t.div(tau).add(0.5).fract();
    const wFlow = ph1.mul(2).sub(1).abs();
    const fl1 = vec3(P.x.sub(sm.y.mul(ph1).mul(tau).mul(0.7)), P.z, G.phase.mul(8));
    const fl2 = vec3(P.x.sub(sm.y.mul(ph2).mul(tau).mul(0.7)).add(0.37), P.z.add(0.21), G.phase.mul(8));
    const rip = (f) => NZ(f.mul(vec3(3.2, 3.2, 1))).xy.mul(0.6).add(NZ(f.mul(vec3(9, 9, 1)).add(vec3(0.3, 0.7, 0))).xy.mul(0.4));
    const rr = mix(rip(fl1), rip(fl2), wFlow);
    const r1 = rr, r2 = vec2(0);
    const chop = float(0.05).add(speed.mul(0.05)).add(sm.z.mul(0.12));
    let n = normalize(normalWorld.add(vec3(r1.x, 0, r1.y).mul(chop)));
    n = select(above, n, n.negate()).toVar();
    // (au loin, les facettes des vagues regardent plus haut que la normale
    // moyenne : le reflet rasant ne devient jamais un miroir parfait)
    const dist = length(C.sub(P));
    const cosi = dot(n, v).clamp(0, 1).max(select(above, smoothstep(2, 40, dist).mul(0.16).add(0.04), float(0)));
    // Fresnel (Schlick, eau n = 1,33 ; de l'eau vers l'air : réflexion totale au-delà de 48,6°)
    const sinT2 = select(above, float(0), float(1.77).mul(float(1).sub(cosi.mul(cosi))));
    const tir = sinT2.greaterThan(1);
    const cosT = sqrt(float(1).sub(sinT2.min(1)));
    const cc = select(above, cosi, cosT);
    const F = select(tir, float(1), float(0.02).add(float(0.98).mul(float(1).sub(cc).pow(5))));
    const rdir = reflect(dir, n);
    const sky = skyT.sample(equirectUV(rdir)).level(0).rgb;
    // reflet du soleil (GGX, rugosité des rides)
    const L = vec3(U.sunDir), H = normalize(L.add(v));
    const ndh = dot(n, H).clamp(0, 1), a2 = float(0.012).add(chop.mul(0.08)).pow(2);
    const D = a2.div(float(Math.PI).mul(ndh.mul(ndh).mul(a2.sub(1)).add(1).pow(2)));
    const spec = vec3(U.sunE).mul(D).mul(F).mul(dot(n, L).max(0)).mul(0.25).mul(select(above, float(1), float(0)));
    // d'en dessous : la fenêtre de Snell montre le ciel, la réflexion totale l'eau elle-même
    const tdir = normalize(dir.mul(1.33).add(n.mul(float(1.33).mul(cosi).sub(cosT))));
    const window = skyT.sample(equirectUV(tdir)).level(0).rgb.mul(F.oneMinus());
    const deep = vec3(U.tint).mul(vec3(U.sunE).mul(U.sunDir.y.max(0)).add(vec3(U.skyE))).mul(0.55);
    // écume : un tapis de cellules qui suit le courant, plus dense dans le ressaut
    const fcell = (f) => NZ(f.mul(vec3(7, 7, 0.5))).w.add(NZ(f.mul(vec3(16, 16, 0.5)).add(5.1)).w.mul(0.5));
    const cellMix = mix(fcell(fl1), fcell(fl2), wFlow);
    const cell = cellMix, cell2 = float(0);
    const cov = smoothstep(0.12, 0.9, sm.z.mul(U.foamK)).mul(smoothstep(0.02, 0.25, cell.add(cell2.mul(0.5)).add(sm.z.mul(0.25)).sub(0.05)));
    const foamCov = cov.clamp(0, 0.97);
    const lit = vec3(U.sunE).mul(U.sunDir.y.max(0)).mul(0.7).add(vec3(U.skyE).mul(1.1));
    const foam = vec3(0.86, 0.88, 0.88).mul(lit).mul(select(above, float(1), float(0.6)));
    // (au bord de l'eau, la nappe s'amincit : transparente)
    const depth = W.level(P.x, P.z, U.t).sub(W.rockAt(P.x, P.z));
    const thin = smoothstep(0.0, 0.012, depth);
    const glowN = vec3(0.12, 0.5, 1.0).mul(U.glow).mul(sm.z.mul(1.5).add(sm.w));
    // composition prémultipliée : src + dst·(1 − α)
    const reflA = select(above, sky.mul(F).add(spec), mix(window, deep, F));
    const alphaW = select(above, F, float(1)).mul(thin);
    let rgb = mix(reflA.mul(thin), foam, foamCov.mul(thin)).add(glowN.mul(thin));
    let alpha = mix(alphaW, float(1), foamCov.mul(thin));
    // milieu : d'en dessous, le rayon traverse l'eau jusqu'à la surface
    rgb = W.medium(P, C, rgb.div(alpha.max(1e-3))).mul(alpha);
    return vec4(rgb, alpha);
  });
  mat.outputNode = out();
  // vitesse prémultipliée, mélangée comme la couleur (le mélange matériel
  // s'applique à toutes les cibles, chacune avec son propre alpha)
  if (!lite) mat.mrtNode = mrt({ velocity: vec4(velocity.xy.mul(output.a), 0, output.a) });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 10;
  return { mesh, setSky: (t) => { skyT.value = t; } };
}
