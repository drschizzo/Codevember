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
  normalWorld, mrt, velocity, positionPrevious, textureLoad, ivec2, int, floor,
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
    seaX0: uniform(-9), seaW: uniform(19), nx: uniform(760), fps: uniform(60), nf: uniform(1920),
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
    for (const k of [0]) { // (les vagues sont loin des bords de la boucle : une seule copie suffit)
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
  const profAt = (x) => profT.sample(vec2(x.sub(U.seaX0).div(U.seaW), 0.5)).level(0).x;
  const pool = (x, z) => mix(float(-9), fillT.sample(boxUV(x, z)).level(0).x, inBox(x, z).step(0.999));
  const level = (x, z, t) => max(sea(x, z, t).x, pool(x, z));
  // (sans le champ lointain : pour ce qui est dans le domaine de la simulation)
  const levelNear = (x, z, t) => max(seaT.sample(fieldUV(x, localT(z, t))).level(0).x, pool(x, z));
  // Le niveau au dôme, interpolé à la main en pleine précision : le dôme fait
  // 9 cm, et 0,1 mm de niveau y déplace la ligne d'eau de plusieurs pixels —
  // les poids du filtrage matériel (8 bits) la dessinaient en escalier.
  const seaExact = (x, tl) => {
    const fx = x.sub(U.seaX0).div(U.seaW).mul(U.nx).sub(0.5).clamp(0, U.nx.sub(1.001)), fy = tl.mul(U.fps);
    const i0 = floor(fx), j0 = floor(fy), wx = fx.sub(i0), wy = fy.sub(j0);
    const jm = (j) => j.sub(floor(j.div(U.nf)).mul(U.nf));
    const ja = int(jm(j0)), jb = int(jm(j0.add(1))), ia = int(i0), ib = int(i0.add(1));
    const L = (i, j) => textureLoad(seaT, ivec2(i, j)).x;
    return mix(mix(L(ia, ja), L(ib, ja), wx), mix(L(ia, jb), L(ib, jb), wx), wy);
  };
  const levelDome = (x, z, t) => max(seaExact(x, localT(z, t)), pool(x, z));
  // enveloppe de séchage : la roche sous ce niveau est encore mouillée
  // (rock : la hauteur de la roche au point ; une flaque mouille son bord sur 2 cm)
  const wetLevel = (x, z, t, rock) => { const pl = pool(x, z); return max(wetT.sample(fieldUV(x, localT(z, t))).level(0).x, select(pl.sub(rock).greaterThan(0.0015), pl.add(0.02), float(-9))); };

  // ── le soleil sous l'eau (pour receivedShadowNode) ──
  // atténuation sur le chemin réfracté jusqu'au point, et caustiques
  const caustic = (P, depth) => {
    const ph = G.phase.mul(4); // (le volume de bruit est périodique : 4 cellules = une boucle)
    const q = vec3(P.x.mul(5.5), P.z.mul(5.5), ph);
    const w1 = NZ(q).w, w2 = NZ(q.mul(1.37).add(vec3(1.7, 3.1, 2.0))).w;
    const lines = smoothstep(0.16, 0.0, w1).add(smoothstep(0.12, 0.0, w2).mul(0.7));
    return float(1).add(lines.mul(1.0).sub(0.25).mul(smoothstep(0.02, 0.25, depth)).mul(smoothstep(3, 0.6, depth)).mul(U.caustic));
  };
  // la direction d'où vient le soleil sous l'eau (réfractée : plus haute), et
  // la part qui entre (Fresnel à l'incidence du soleil)
  const sunIn = () => {
    const sd = vec3(U.sunDir), sy = sd.y.max(0.05);
    const h = vec2(sd.x, sd.z).div(1.33);
    const Lw = normalize(vec3(h.x, sqrt(float(1).sub(dot(h, h)).max(0.01)), h.y));
    const Tf = float(1).sub(float(0.02).add(float(0.98).mul(float(1).sub(sy).pow(5))));
    return { Lw, Tf };
  };
  // Lumière diffusée vers l'œil dans l'eau : le ciel, isotrope, et le soleil
  // réfracté, surtout vers l'avant (Henyey-Greenstein, g = 0,55 : l'eau
  // s'éclaire du côté du soleil), découpé en rayons par les rides de la
  // surface (les caustiques projetées le long du rayon de soleil, moyennées en
  // deux points du segment immergé). Sans cela, l'eau était un aplat.
  const inscatter = (O, P, sA, sB, dir, M, depthM, aer) => {
    const { Lw } = sunIn();
    let shafts = float(0);
    for (const f of [0.25, 0.75]) {
      const Q = O.add(P.sub(O).mul(mix(sA, sB, f)));
      const dq = levelNear(Q.x, Q.z, U.t).sub(Q.y).max(0);
      const S = Q.add(Lw.mul(dq.div(Lw.y))); // (où ce rayon de soleil a traversé la surface)
      shafts = shafts.add(caustic(vec3(S.x, 0, S.z), float(0.5)).sub(1).mul(1.6).add(1).max(0.15));
    }
    shafts = shafts.mul(0.5); // (deux points : l'anticrénelage temporel lisse le reste)
    return waterGlow(dir, depthM, aer, shafts);
  };
  // la couleur de l'eau vue dans la direction dir, à la profondeur depthM
  function waterGlow(dir, depthM, aer, shafts = float(1)) {
    const { Lw, Tf } = sunIn();
    const g = 0.55, ct = dot(dir, Lw);
    const hg = float(1 - g * g).div(float(1 + g * g).sub(ct.mul(2 * g)).max(1e-3).pow(1.5));
    const down = exp(vec3(U.ext).mul(depthM).negate());
    const tintW = mix(vec3(U.tint).mul(0.5), vec3(0.5, 0.56, 0.55), aer.div(aer.add(0.6)).mul(0.8));
    const sunL = vec3(U.sunE).mul(Tf).mul(hg.mul(0.22)).mul(shafts).mul(exp(vec3(U.ext).mul(depthM.div(Lw.y)).negate()));
    return tintW.mul(vec3(U.skyE).mul(down).add(vec3(U.sunE).mul(U.sunDir.y.max(0)).mul(down).mul(0.5)).add(sunL));
  }

  // ── le milieu : brouillard d'eau sur la partie immergée du rayon ──
  // (le rayon part du hublot-dôme, à `dome` devant le centre optique ; le
  // niveau de l'eau le long du rayon est pris linéaire entre ses deux bouts)
  const medium = Fn(([P, C, rgbIn]) => {
    const d = P.sub(C), L = length(d).max(1e-4), dir = d.div(L);
    const O = C.add(dir.mul(U.dome));
    const segL = L.sub(U.dome).max(0);
    // (le dôme est près de la caméra, dans le domaine simulé : pas de champ lointain)
    const a = O.y.sub(levelDome(O.x, O.z, U.t)).toVar(), b = P.y.sub(level(P.x, P.z, U.t)).toVar();
    const lwV = float(0).toVar();
    const rgbW = vec3(rgbIn).toVar();
    // (le calcul de l'eau n'est fait que si le rayon en traverse : à l'air, la
    // plupart des pixels s'en passent)
    If(a.lessThan(0).or(b.lessThan(0)), () => {
      const s0 = a.div(a.sub(b).add(select(a.sub(b).greaterThanEqual(0), 1e-6, -1e-6))).clamp(0, 1);
      const aIn = a.lessThan(0), bIn = b.lessThan(0);
      const frac = select(aIn, select(bIn, float(1), s0), select(bIn, s0.oneMinus(), float(0)));
      const lw = segL.mul(frac);
      const sA = select(aIn, float(0), s0), sB = select(bIn, float(1), s0);
      const M = O.add(P.sub(O).mul(sA.add(sB).mul(0.5)));
      const sm = sea(M.x, M.z, U.t);
      // (les bulles forment des nuages, pas un voile uniforme)
      const cloud = NZ(M.mul(1.6).add(vec3(0, 0, G.phase.mul(8)))).x.mul(0.8).add(0.6).clamp(0.15, 1.4);
      const aer = sm.w.mul(cloud).clamp(0, 1.2);
      const depthM = sm.x.max(pool(M.x, M.z)).sub(M.y).max(0);
      // l'eau aérée diffuse fort et blanc
      const sig = vec3(U.ext).add(aer.mul(2.5));
      const Tr = exp(sig.mul(lw).negate());
      const ins = inscatter(O, P, sA, sB, dir, M, depthM, aer);
      // la nuit : l'eau agitée s'allume (noctiluques)
      // (en étincelles : chaque noctiluque est un point, pas un voile)
      const spark = smoothstep(0.16, 0.0, NZ(M.mul(34).add(vec3(0, 0, G.phase.mul(16)))).z).mul(2.6).add(0.15);
      const lum = vec3(0.15, 0.55, 1.0).mul(U.glow).mul(aer.mul(2.2).add(sm.z.mul(0.6))).mul(spark);
      rgbW.assign(rgbW.mul(Tr).add(ins.add(lum).mul(Tr.oneMinus())));
      lwV.assign(lw);
    });
    let rgb = rgbW;
    // brume de l'air au loin
    const la = L.sub(lwV);
    rgb = mix(rgb, vec3(U.haze), float(1).sub(exp(la.div(U.hazeDist).negate())).mul(0.85));
    // (le fond — le ciel — est à l'infini : sa position n'est pas finie, on n'y touche pas)
    return select(L.lessThan(5000), rgb, rgbIn);
  });
  const fogNode = Fn(() => vec4(medium(positionWorld, cameraPosition, output.rgb), output.a))();

  const sunAtten = (P) => {
    const w = level(P.x, P.z, U.t), depth = w.sub(P.y).max(0);
    const sy = U.sunDir.y.max(0.05), cr = sqrt(float(1).sub(float(1).sub(sy.mul(sy)).div(1.77))); // (cos de l'angle réfracté)
    const Tr = exp(vec3(U.ext).mul(depth.div(cr)).negate());
    // (la part du soleil qui entre dans l'eau : Fresnel à l'incidence du soleil
    // — au couchant, plus de la moitié est réfléchie par la surface)
    const Tf = float(1).sub(float(0.02).add(float(0.98).mul(float(1).sub(sy).pow(5))));
    return mix(vec3(1), Tr.mul(Tf).mul(caustic(P, depth)), smoothstep(0.0, 0.01, depth));
  };
  const receivedShadow = (shadow) => shadow.mul(sunAtten(positionWorld));

  return { U, seaT, wetT, fillT, reliefT, profT, profAt, sea, level, levelNear, levelDome, wetLevel, rockAt, pool, medium, fogNode, sunAtten, receivedShadow, waterGlow, inBox, boxUV, dataTex };
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
  const geo = gridGeometry(spacing(-160, -4.5, 4.5, 40, lite ? 0.06 : 0.04, 1.1), spacing(-260, -10, 3.2, 60, lite ? 0.06 : 0.04, 1.1));
  const mat = new THREE.MeshBasicNodeMaterial();
  mat.transparent = true;
  mat.depthWrite = true;
  mat.fog = false;
  mat.side = THREE.DoubleSide;
  mat.blending = THREE.CustomBlending;
  mat.blendSrc = THREE.OneFactor; mat.blendDst = THREE.OneMinusSrcAlphaFactor;
  mat.blendSrcAlpha = THREE.OneFactor; mat.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;

  // pose : sur l'eau, ou posée sur la roche là où elle est sèche (et
  // transparente : voir « thin ») — le bord de l'eau suit ainsi le contour
  // mouillé ; un sommet sec envoyé sous la roche dessinait un front en dents
  // de scie, hérissé d'écume
  // La surface est un plan d'eau à son niveau partout où la mer (ou une
  // flaque) est là, et c'est le test de profondeur contre la roche qui
  // dessine le bord de l'eau : il suit alors la roche au pixel près. Posée sur
  // la roche ou envoyée dessous là où elle était sèche, la surface faisait
  // des triangles inclinés qui sortaient en dents de scie sur les pentes
  // raides (les feuillets d'ardoise). Là où la mer n'est pas (le front du jet
  // de rive), elle plonge sous la roche ; ce rideau est retiré par maskNode.
  // Les sommets restent TOUS au niveau de l'eau (sur le sec, le niveau est le
  // fond du profil) : plonger les sommets secs sous la roche faisait, dans la
  // grille lâche du loin, des triangles mi-eau mi-rideau dont le masque
  // laissait passer des coins (des dents vues de dessous, la ligne d'eau en
  // escalier, des pans verticaux sur les gradins). Le mouillé et le sec sont
  // décidés au pixel, dans maskNode.
  const pose = (p, t) => {
    const x = p.x, z = p.z;
    return vec3(x, max(W.sea(x, z, t).x, W.pool(x, z)), z);
  };
  mat.positionNode = Fn(() => {
    const p = positionLocal;
    const e = 0.025;
    const c = pose(p, U.t), px = pose(p.add(vec3(e, 0, 0)), U.t), pz = pose(p.add(vec3(0, 0, e)), U.t);
    normalLocal.assign(normalize(vec3(c.y.sub(px.y).div(e), 1, c.y.sub(pz.y).div(e))));
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
    const above = O.y.greaterThan(W.levelDome(O.x, O.z, U.t));
    const sm = W.sea(P.x, P.z, U.t);
    const speed = sm.y.abs();
    // rides : fines ondulations du vent, plus hachées dans le ressaut
    // (motifs entraînés par le courant : deux phases décalées, fondues — « flow map » —
    // de période T/8, donc périodiques sur la boucle)
    const tau = U.T.div(8), ph1 = U.t.div(tau).fract(), ph2 = U.t.div(tau).add(0.5).fract();
    const wFlow = ph1.mul(2).sub(1).abs();
    // (la hauteur entre dans les coordonnées : sur la face raide d'un ressaut,
    // x et z ne varient presque plus et le motif s'étirait en aiguilles)
    const fl1 = vec3(P.x.sub(sm.y.mul(ph1).mul(tau).mul(0.7)).add(P.y.mul(0.8)), P.z.add(P.y.mul(0.6)), G.phase.mul(8));
    const fl2 = vec3(P.x.sub(sm.y.mul(ph2).mul(tau).mul(0.7)).add(0.37).add(P.y.mul(0.8)), P.z.add(0.21).add(P.y.mul(0.6)), G.phase.mul(8));
    // rides à trois échelles (vagues de vent, clapot, capillaires) ; les plus
    // fines s'effacent au loin avant la fréquence du pixel
    const dCam = length(C.sub(P));
    const fine = smoothstep(6, 1, dCam), mid = smoothstep(30, 4, dCam);
    const rip = (f) => NZ(f.mul(vec3(1.3, 2.2, 1))).xy.mul(0.5).add(NZ(f.mul(vec3(4.5, 6, 1)).add(vec3(0.3, 0.7, 0))).xy.mul(mid.mul(0.45))).add(NZ(f.mul(vec3(16, 19, 1)).add(vec3(2.1, 0.4, 0))).xy.mul(fine.mul(0.35)));
    const rr = mix(rip(fl1), rip(fl2), wFlow);
    const r1 = rr, r2 = vec2(0);
    const chop = float(0.14).add(speed.mul(0.09)).add(sm.z.mul(0.25));
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
    // écume : des plaques déchirées qui suivent le courant, trouées de bulles —
    // un bruit déformé seuillé selon la quantité d'écume (les bords des
    // cellules de Worley, d'épaisseur constante, se lisaient comme un filet)
    const lace = (f) => {
      const wp = f.mul(vec3(1.6, 3.2, 0.5));
      const warp = vec3(NZ(wp).x, NZ(wp.add(4.7)).y, 0).mul(0.35);
      const q = f.add(warp);
      const d = NZ(q.mul(vec3(2.4, 4.8, 0.5))).x.mul(0.55).add(NZ(q.mul(vec3(7, 12, 0.5)).add(3.3)).y.mul(0.28)).add(NZ(q.mul(vec3(19, 26, 0.5)).add(7.7)).x.mul(0.12)).add(0.5);
      // (bulles : petits trous ronds dans la mousse)
      const holes = smoothstep(0.16, 0.06, NZ(q.mul(vec3(38, 44, 0.5)).add(1.9)).z).mul(0.35);
      return d.sub(holes);
    };
    const laceM = mix(lace(fl1), lace(fl2), wFlow);
    const fo = sm.z.mul(U.foamK);
    const thr = float(0.95).sub(fo.clamp(0, 1.5).mul(0.42));
    const cov = smoothstep(thr, thr.add(0.08), laceM).mul(smoothstep(0.03, 0.12, fo)).max(smoothstep(0.9, 1.4, fo).mul(0.9));
    const foamCov = cov.clamp(0, 0.97);
    const lit = vec3(U.sunE).mul(U.sunDir.y.max(0)).mul(0.7).add(vec3(U.skyE).mul(1.1));
    const foam = vec3(0.86, 0.88, 0.88).mul(lit).mul(select(above, float(1), float(0.6)));
    // (au bord de l'eau, la nappe s'amincit : transparente)
    const depth = W.level(P.x, P.z, U.t).sub(W.rockAt(P.x, P.z));
    const thin = smoothstep(0.006, 0.02, depth);
    const glowN = vec3(0.12, 0.5, 1.0).mul(U.glow).mul(sm.z.mul(1.5).add(sm.w));
    // Le corps de l'eau, vu d'en dessus : le rayon réfracté descend dans l'eau
    // et n'en ressort pas — ce qu'on voit à travers une crête n'est jamais le
    // ciel de derrière, mais l'eau, de plus en plus opaque avec la profondeur
    // (la lumière du soleil la traverse vers l'avant : une crête à contre-jour
    // s'allume)
    const cosTi = sqrt(float(1).sub(float(1).sub(cosi.mul(cosi)).div(1.77)));
    const tdirA = normalize(dir.div(1.33).add(n.mul(cosi.div(1.33).sub(cosTi)))); // (rayon réfracté, de l'air vers l'eau)
    // (opacité selon la limpidité de l'eau : une eau claire, Étretat, laisse voir plus loin)
    const kBody = dot(vec3(U.ext), vec3(1 / 3)).mul(2.5).add(0.8);
    const body = float(1).sub(exp(depth.max(0).mul(kBody).negate().div(cosTi.max(0.25)))).mul(F.oneMinus()).mul(smoothstep(0.03, 0.2, depth)); // (une nappe mince laisse voir la roche)
    const bodyCol = W.waterGlow(tdirA, depth.max(0).mul(0.5), sm.w.clamp(0, 1.2)).mul(body);
    // composition prémultipliée : src + dst·(1 − α)
    const reflA = select(above, sky.mul(F).add(spec).add(bodyCol), mix(window, deep, F));
    const alphaW = select(above, F.add(body), float(1)).mul(thin);
    let rgb = mix(reflA.mul(thin), foam, foamCov.mul(thin)).add(glowN.mul(thin));
    let alpha = mix(alphaW, float(1), foamCov.mul(thin));
    // milieu : d'en dessous, le rayon traverse l'eau jusqu'à la surface
    rgb = W.medium(P, C, rgb.div(alpha.max(1e-3))).mul(alpha);
    return vec4(rgb, alpha);
  });
  mat.outputNode = out();
  // (ce qui est entre le centre optique et le dôme n'est pas dessiné : sans
  // cela, la surface passée juste au-dessus de l'objectif se voyait en aplat)
  // (ni les parties sèches, posées sur la roche : rien à dessiner, et pas de profondeur à écrire)
  // mouillé au pixel : la mer couvre le profil (ou une flaque est pleine), et
  // l'eau est au-dessus de la roche dessinée
  const Pm = positionWorld, rkF = W.rockAt(Pm.x, Pm.z), plF = W.pool(Pm.x, Pm.z);
  const etaF = W.sea(Pm.x, Pm.z, U.t).x, lvF = max(etaF, plF);
  const wetF = etaF.sub(W.profAt(Pm.x)).greaterThan(0.001).or(plF.sub(rkF).greaterThan(0.0015));
  mat.maskNode = length(Pm.sub(cameraPosition)).greaterThan(U.dome).and(wetF).and(lvF.sub(rkF).greaterThan(0.004));
  // vitesses : la surface n'en écrit pas (alpha nul : la cible garde celle
  // de ce qui est dessous). Ses sommets passent d'un coup de la roche à
  // l'eau au bord mouillé-sec : leurs vitesses démesurées étiraient le flou
  // de mouvement en copies répétées des reflets.
  if (!lite) mat.mrtNode = mrt({ velocity: vec4(0) });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 10;
  return { mesh, setSky: (t) => { skyT.value = t; } };
}
