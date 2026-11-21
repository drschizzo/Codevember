// Le champ de lave : la surface exacte des orteils (gen/toes.js), recalculée
// à chaque image dans une carte de hauteur, puis un maillage déplacé et la peau
// de lave (verre noir argenté, irisation d'oxydes, fissures, corps noir).
//
// Passe de champ (une image plein cadre dans une cible 2 048² demi-flottants,
// ~3 mm par texel) : pour chaque texel, les 4 orteils candidats (listes cuites
// dans le worker) donnent l'ancienne nappe R = max z_k et la nouvelle
// S = max(R, n_k(t)) — les mêmes formules que toes.js. Sortie : (S, orteil du
// dessus, nappe, R). Deux cibles en alternance : l'image précédente donne les
// vecteurs vitesse.
import * as THREE from 'three/webgpu';
import {
  Fn, float, int, ivec2, vec2, vec3, vec4, uniform, textureLoad, texture, positionLocal, positionWorld, positionPrevious,
  normalLocal, screenCoordinate, clamp, max, min, mix, smoothstep, sqrt, sin, cos, length, abs, step, select, floor, fract,
  exp, log, pow, normalize, dot, cameraViewMatrix, color, dFdx, dFdy, fwidth, acos, positionViewDirection,
} from 'three/tsl';
import { NZ, perturb, fbm, worley } from '../../../shared/scene/materials.js';
import { G } from '../../../shared/scene/globals.js';
import { STRIDE, WALL, EDGE, COVER_E, FORM0, FORM1, PEN_T, NOSE_R, NOSE_K } from '../gen/toes.js';

const PI = Math.PI;
const GLOW_RES = 256;

// ── Formules d'un orteil, en TSL (miroir exact de toes.js) ───────────────────
const sstepN = (a, b, x) => smoothstep(a, b, x);
const quarterN = (x) => { const t = float(1).sub(clamp(x, 0, 1)); return sqrt(max(float(0), float(1).sub(t.mul(t)))); };

export function toeFns(toeTex) {
  const P = (k) => ({ a: textureLoad(toeTex, ivec2(int(0), k)), b: textureLoad(toeTex, ivec2(int(1), k)), c: textureLoad(toeTex, ivec2(int(2), k)) });
  const hw = (p, s) => p.b.y.mul(p.c.z.add(float(1).sub(p.c.z).mul(sstepN(p.b.x.mul(-0.05), p.b.x.mul(0.5), s))))
    .mul(float(1).add(sin(s.mul(9).add(p.c.w.mul(40))).mul(0.1)).add(sin(s.mul(21).add(p.c.w.mul(17))).mul(0.05)));
  const bumpsN = (s, v, hh) => sin(s.mul(17).sub(v.mul(11)).add(hh.mul(73))).mul(0.16).add(sin(v.mul(23).add(s.mul(5)).add(hh.mul(19))).mul(0.1));
  const local = (p, x, z) => {
    const dx = x.sub(p.a.x), dz = z.sub(p.a.y), c = cos(p.a.z), s = sin(p.a.z);
    const a = dx.mul(c).add(dz.mul(s)), b = dx.mul(s).negate().add(dz.mul(c));
    return [a, b.sub(p.a.w.mul(0.5).mul(a).mul(a))];
  };
  const outline = (p, s, v) => {
    const L = p.b.x, r0 = hw(p, float(0)), r1 = hw(p, L);
    const lo = r0.mul(0.6), sc = clamp(s, lo, max(lo, L.sub(r1)));
    return length(vec2(s.sub(sc), v)).sub(hw(p, sc));
  };
  const toeZ = (p, s, v) => {
    const L = p.b.x, hT = p.b.z, B = p.b.w;
    const e = outline(p, s, v);
    const w = hw(p, clamp(s, 0, L));
    const crown = hT.mul(0.14).mul(float(1).sub(v.div(w).pow2())).mul(sin(clamp(s.div(L), 0, 1).mul(PI)));
    const dome = B.add(hT.mul(sin(clamp(e.negate().div(hT.mul(EDGE)), 0, 1).mul(PI / 2)))).add(max(crown, 0).add(hT.mul(bumpsN(s, v, p.c.w))).mul(smoothstep(0, hT.mul(EDGE), e.negate())));
    const wall = B.sub(e.mul(WALL));
    return mix(dome, wall, step(0, e));
  };
  const Lfront = (p) => p.b.x.add(p.b.y.mul(1.4)).add(p.b.z.mul(EDGE)).add(0.12);
  const frontAt = (p, t) => {
    const x = clamp(t.sub(p.c.x).div(p.c.y), 0, 1);
    const sf = Lfront(p).mul(float(0.5).sub(cos(x.mul(PI)).mul(0.5))).sub(0.02);
    return select(t.greaterThan(p.c.x), sf, float(-1));
  };
  const frontS = (p, s, v) => {
    const sp = max(s, 0), w = hw(p, sp);
    const f = sp.add(w).sub(sqrt(max(float(0), w.mul(w).sub(v.mul(v)))));
    return f.add(max(s.negate(), 0).mul(1.5));
  };
  const passTime = (p, s, v) => {
    const e = clamp(frontS(p, s, v).add(0.02).div(Lfront(p)), 0, 1);
    return p.c.x.add(acos(float(1).sub(e.mul(2))).div(PI).mul(p.c.y));
  };
  // hauteur portée par l'orteil dans la nappe en cours
  return { P, hw, local, outline, toeZ, frontAt, frontS, passTime, Lfront, quarterN };
}

// ── Le champ ─────────────────────────────────────────────────────────────────
export function createField(scene, renderer, { lite = false } = {}) {
  const RES = lite ? 1024 : 2048;
  const U = {
    t: uniform(0), tPrev: uniform(0), h: uniform(0.11), F: uniform(3.2), period: uniform(10800),
    shift: uniform(0), shiftPrev: uniform(0), // (descente d'une nappe par boucle, voir stage.js)
    off: uniform(new THREE.Vector2()), offPrev: uniform(new THREE.Vector2()), // (glissement du champ : monde = champ − off)
    delta: uniform(new THREE.Vector2()), // (l'ancienne nappe est le champ lu en x + Δ)
    meshC: uniform(new THREE.Vector2()), // (centre du maillage : la cible de la caméra)
    src: uniform(new THREE.Vector2()), srcDir: uniform(new THREE.Vector2(0, 1)), // (les percées)
    src2: uniform(new THREE.Vector2(99, 99)), srcDir2: uniform(new THREE.Vector2(0, 1)), srcT2: uniform(1e6),
    listRes: uniform(1024), ageMax: uniform(21600), coolN: uniform(256),
    lavaScale: uniform(1), // (dosage de l'émission : 1 = physique)
    glowGain: uniform(1),
    ropes: uniform(0), plates: uniform(0), wet: uniform(0), sulfur: uniform(0), // (famille, humeur)
    albedo: uniform(new THREE.Color(0.024, 0.024, 0.025)), albedoOld: uniform(new THREE.Color(0.042, 0.043, 0.046)),
    iridMix: uniform(0.1), rough: uniform(0.3), roughOld: uniform(0.55),
  };
  // textures de données (remplacées à chaque scène)
  const blank = (w, h, type = THREE.FloatType) => { const t = new THREE.DataTexture(new (type === THREE.FloatType ? Float32Array : Uint16Array)(w * h * 4), w, h, THREE.RGBAFormat, type); t.needsUpdate = true; return t; };
  const T = { toe: blank(3, 4), list: blank(4, 4), cool: blank(256, 1, THREE.HalfFloatType), emit: blank(256, 1, THREE.HalfFloatType) };
  for (const t of [T.cool, T.emit]) { t.minFilter = t.magFilter = THREE.LinearFilter; }
  // (nœuds de texture dont on change la valeur : jamais de recompilation)
  T.blur = blank(4, 4, THREE.HalfFloatType); T.blur.minFilter = T.blur.magFilter = THREE.LinearFilter;
  const toeT = texture(T.toe), listT = texture(T.list), coolT = texture(T.cool), emitT = texture(T.emit), blurT = texture(T.blur);

  // ── Passe de champ ──
  const mkRT = () => {
    const rt = new THREE.RenderTarget(RES, RES, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false });
    rt.texture.minFilter = rt.texture.magFilter = THREE.LinearFilter;
    rt.texture.generateMipmaps = false;
    return rt;
  };
  const rts = [mkRT(), mkRT()];
  const glowRT = new THREE.RenderTarget(GLOW_RES, GLOW_RES, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: false });
  glowRT.texture.generateMipmaps = true;
  glowRT.texture.minFilter = THREE.LinearMipmapLinearFilter; glowRT.texture.magFilter = THREE.LinearFilter;
  const glowT = texture(glowRT.texture);
  let cur = 0;
  const fieldT = texture(rts[0].texture), prevT = texture(rts[1].texture);

  const tf = toeFns(toeT);
  const BULGE = 0.06, BULGE_R = 0.28;
  const bulge1 = (x, z, t, c) => {
    const d2 = x.sub(c.x).pow2().add(z.sub(c.y).pow2());
    return exp(d2.div(-BULGE_R * BULGE_R)).mul(BULGE).mul(smoothstep(-22, -3, t)).mul(float(1).sub(smoothstep(20, 110, t)));
  };
  const bulgeAt = (x, z, t) => bulge1(x, z, t, U.src).add(bulge1(x, z, t.sub(U.srcT2), U.src2));
  // candidats d'un point, relief, orteil du dessus, premier passage (toes.js)
  const listAt = (xx, zz, n) => {
    const li = clamp(int(floor(xx.add(U.F).div(U.F.mul(2)).mul(U.listRes))), int(0), int(U.listRes.sub(1)));
    const lj = clamp(int(floor(zz.add(U.F).div(U.F.mul(2)).mul(U.listRes))), int(0), int(U.listRes.sub(1)));
    const a = textureLoad(listT, ivec2(li.mul(2), lj));
    if (n === 4) return [a.x, a.y, a.z, a.w];
    const b = textureLoad(listT, ivec2(li.mul(2).add(1), lj));
    return [a.x, a.y, a.z, a.w, b.x, b.y, b.z, b.w];
  };
  // pour chaque candidat : dôme final, part latérale, instant de passage
  const cands = (ids, xx, zz) => ids.map((id) => {
    const k = int(max(id.sub(1), 0));
    const p = tf.P(k);
    const [s, v] = tf.local(p, xx, zz);
    const ok = id.greaterThan(0.5);
    const zf = select(ok, tf.toeZ(p, s, v), float(-1e9)).toVar();
    const lat = select(ok, float(1).sub(smoothstep(0.06, COVER_E, tf.outline(p, s, v))), float(0)).toVar();
    // (instant de passage pénalisé vers le bord de l'orteil : toes.js, penal)
    const pt = select(lat.greaterThan(0), tf.passTime(p, s, v).add(float(PEN_T).mul(float(1).sub(lat)).div(max(lat, 1e-4))), float(1e9)).toVar();
    return { id, p, s, v, zf, lat, pt };
  });
  const reduce = (cs) => {
    let R = cs[0].zf;
    for (const c of cs.slice(1)) R = max(R, c.zf);
    R = R.toVar();
    const top = float(-1).toVar(), ta = float(1e9).toVar();
    for (const c of cs) {
      top.assign(select(c.zf.greaterThanEqual(R).and(c.id.greaterThan(0.5)).and(top.lessThan(0)), c.id.sub(1), top));
      ta.assign(min(ta, c.pt));
    }
    return { R, top, ta };
  };

  const passMat = new THREE.MeshBasicNodeMaterial();
  passMat.outputNode = Fn(() => {
    const cell = U.F.mul(2).div(RES);
    const x = U.F.negate().add(screenCoordinate.x.mul(cell)), z = U.F.negate().add(screenCoordinate.y.mul(cell));
    // l'ancienne nappe : le même champ, lu en x + Δ (relief et premier passage)
    // l'ancienne nappe est le même champ (relief R, orteil du dessus, premier
    // passage d'il y a une période) ; la nappe en cours (toes.js,
    // surfaceFromLists) : derrière le front de chaque orteil, une nappe lisse
    // (relief flouté + h) qui remplit les creux, puis se bombe en lobes jusqu'à
    // R + h ; amincie vers le bord de l'orteil ; la nappe est le plus haut des
    // dépôts. L'âge et la couleur viennent du premier passage.
    const cs = cands(listAt(x, z, 8), x, z);
    const C = reduce(cs);
    // la percée : avant la première lave, le sol se bombe au-dessus du tube
    // (la pression monte sous la croûte), puis se dégonfle quand la lave s'échappe
    const Rold = C.R.add(bulgeAt(x, z, U.t)).toVar();
    const bl = blurT.sample(vec2(x.add(U.F).div(U.F.mul(2)), z.add(U.F).div(U.F.mul(2)))).level(0).x;
    const age = U.t.sub(C.ta);
    const target = bl.add(U.h).add(C.R.sub(bl).mul(smoothstep(FORM0, FORM1, age)));
    const th = max(target.sub(Rold), 0).toVar(), rn = th.mul(NOSE_K).add(NOSE_R);
    const Cn = float(0).toVar();
    for (const c of cs) {
      const d = tf.frontAt(c.p, U.t).sub(tf.frontS(c.p, c.s, c.v));
      Cn.assign(max(Cn, select(d.greaterThan(0), sin(clamp(d.div(rn), 0, 1).mul(PI / 2)).mul(c.lat), float(0))));
    }
    const S = Rold.add(th.mul(Cn));
    // (z : temps depuis le passage du front, continu — l'âge de la nappe en
    // cours, et celui de l'ancienne une période plus tard ; w : épaisseur de lave
    // neuve, continue — sa courbe de niveau donne la limite de la lave à une
    // fraction de texel près, sans marches)
    // (un point que nul front n'atteint est froid : jamais un âge nul)
    return vec4(S, C.top, select(C.ta.lessThan(1e8), clamp(age, -1000, 30000), float(20000).sub(U.period)), S.sub(Rold));
  })();
  const quad = new THREE.QuadMesh(passMat);
  // Instant de passage du front, en pleine précision (flottants 32 bits), une
  // fois par scène : il ne dépend pas du temps. Les cordes en sont les courbes
  // de niveau ; lues dans la carte en demi-flottants (âge = t − t_a), elles
  // sautaient d'une image à l'autre vers une heure d'âge (précision de 2 s pour
  // une corde de 4 s).
  const TA_RES = lite ? 512 : 1024;
  const taRT = new THREE.RenderTarget(TA_RES, TA_RES, { type: THREE.FloatType, format: THREE.RGBAFormat, depthBuffer: false });
  taRT.texture.minFilter = taRT.texture.magFilter = THREE.NearestFilter; taRT.texture.generateMipmaps = false;
  const taMat = new THREE.MeshBasicNodeMaterial();
  taMat.outputNode = Fn(() => {
    const cell = U.F.mul(2).div(TA_RES);
    const x = U.F.negate().add(screenCoordinate.x.mul(cell)), z = U.F.negate().add(screenCoordinate.y.mul(cell));
    const C = reduce(cands(listAt(x, z, 8), x, z));
    return vec4(C.ta.min(1e5), 0, 0, 1);
  })();
  const taQuad = new THREE.QuadMesh(taMat);
  const taT = texture(taRT.texture);
  let taDirty = true;
  let dirty = true, lastT = -1;

  function updatePass() {
    if (taDirty) { renderer.setRenderTarget(taRT); taQuad.render(renderer); renderer.setRenderTarget(null); taDirty = false; }
    if (!dirty && U.t.value === lastT) { prevT.value = rts[cur].texture; return; } // (immobile : aucune vitesse)
    cur ^= 1;
    renderer.setRenderTarget(rts[cur]);
    quad.render(renderer);
    renderer.setRenderTarget(null);
    fieldT.value = rts[cur].texture;
    prevT.value = rts[cur ^ 1].texture;
    lastT = U.t.value; dirty = false;
    // carte de lueur (ce que la lave rayonne, vue de dessus), puis ses mips
    renderer.setRenderTarget(glowRT);
    glowQuad.render(renderer);
    renderer.setRenderTarget(null);
  }

  // ── Maillage déplacé ──
  // Le maillage est fixe sous la caméra (il ne glisse pas avec le champ) et
  // resserré au centre : x = c + W (a u + (1 − a) u⁵), u ∈ [−1, 1] — environ
  // 3,5 mm entre deux sommets au centre de l'image, de plus en plus large vers
  // le lointain. Un maillage régulier de 11 mm dessinait des triangles au pied
  // des coulées. Comme il ne bouge pas, le raccord de boucle reste exact ; la
  // position précédente d'un sommet est celle de la matière qu'il montre
  // (le champ a glissé dessous), d'où des vecteurs vitesse justes.
  const N = lite ? 512 : 896, WARP_A = lite ? 0.5 : 0.35, WARP_W = 4.5;
  const geo = new THREE.PlaneGeometry(1, 1, N, N).rotateX(-PI / 2);
  const mat = new THREE.MeshPhysicalNodeMaterial();
  const uvOf = (x, z) => vec2(x.add(U.F).div(U.F.mul(2)), z.add(U.F).div(U.F.mul(2)));
  const Sat = (tex, x, z) => tex.sample(uvOf(x, z)).level(0).x;
  const warp = (u) => u.mul(WARP_A).add(u.pow2().pow2().mul(u).mul(1 - WARP_A)).mul(WARP_W);
  mat.positionNode = Fn(() => {
    const q = positionLocal.mul(2);
    const xw = U.meshC.x.add(warp(q.x)), zw = U.meshC.y.add(warp(q.z));
    const x = xw.add(U.off.x), z = zw.add(U.off.y), e = U.F.mul(2).div(RES).mul(1.5);
    const S = Sat(fieldT, x, z);
    const gx = Sat(fieldT, x.add(e), z).sub(Sat(fieldT, x.sub(e), z)).div(e.mul(2));
    const gz = Sat(fieldT, x, z.add(e)).sub(Sat(fieldT, x, z.sub(e))).div(e.mul(2));
    normalLocal.assign(normalize(vec3(gx.negate(), 1, gz.negate())));
    positionPrevious.assign(vec3(x.sub(U.offPrev.x), Sat(prevT, x, z).add(U.shiftPrev), z.sub(U.offPrev.y)));
    return vec3(xw, S.add(U.shift), zw);
  })();

  // ── La peau ──
  const P = positionWorld;
  const fx = P.x.add(U.off.x), fz = P.z.add(U.off.y); // (coordonnées du champ)
  const texel = (x, z) => ivec2(int(clamp(floor(x.add(U.F).div(U.F.mul(2)).mul(RES)), 0, RES - 1)), int(clamp(floor(z.add(U.F).div(U.F.mul(2)).mul(RES)), 0, RES - 1)));
  // Nappe du pixel : la carte la donne (bilinéaire : la frontière est lisse,
  // un choix au texel le plus proche dessinait des dents). L'orteil et l'âge :
  // ceux du texel voisin (2 × 2) de la même nappe.
  const FB = fieldT.sample(uvOf(fx, fz)).level(0);
  const layerB = FB.w; // (épaisseur de lave neuve, bilinéaire)
  const isNewH = layerB.greaterThan(0.0015);
  const tc = vec2(fx.add(U.F).div(U.F.mul(2)).mul(RES).sub(0.5), fz.add(U.F).div(U.F.mul(2)).mul(RES).sub(0.5));
  const t00 = ivec2(int(clamp(floor(tc.x), 0, RES - 2)), int(clamp(floor(tc.y), 0, RES - 2)));
  const pick = Fn(() => {
    const topF = float(-1).toVar(), ag = float(0).toVar();
    for (const [a, b] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const q = textureLoad(fieldT, t00.add(ivec2(a, b)));
      const take = q.w.greaterThan(0.0015).equal(isNewH).and(topF.lessThan(0));
      ag.assign(select(take, q.z, ag));
      topF.assign(select(take, q.y, topF));
    }
    const F0 = textureLoad(fieldT, texel(fx, fz));
    const found = topF.greaterThanEqual(0);
    return vec3(select(found, select(isNewH, float(1), float(0)), select(F0.w.greaterThan(0.0015), float(1), float(0))), select(found, topF, F0.y), select(found, ag, F0.z));
  })();
  const isNew = pick.x.greaterThan(0.5).toVar('isNew');
  const topId = int(max(pick.y, 0)).toVar('topId');
  const tp = tf.P(topId);
  // (l'ancienne nappe se lit en x + Δ)
  const ex = select(isNew, fx, fx.add(U.delta.x)), ez = select(isNew, fz, fz.add(U.delta.y));
  const [ls, lv] = tf.local(tp, ex, ez);
  const sL = ls.toVar('sL'), vL = lv.toVar('vL');
  // âge de la surface (s) depuis le passage du premier front (carte de champ)
  // (côté neuf, l'âge bilinéaire est continu jusqu'au front)
  // (côté neuf, l'âge bilinéaire, continu jusqu'au front ; côté ancien, une période de plus)
  const age = max(select(isNew, FB.z, pick.z.add(U.period)), 0.05).toVar('age');
  const ci = clamp(log(age.div(0.05)).div(log(U.ageMax.div(0.05))), 0, 1).mul(U.coolN.sub(1)).add(0.5).div(U.coolN);
  const cool = coolT.sample(vec2(ci, 0.5)).level(0); // (surface, croûte, −2 mm, −6 mm) en K, m
  const emitOf = (TK) => emitT.sample(vec2(clamp(TK.sub(700).div(800), 0, 1).mul(255 / 256).add(0.5 / 256), 0.5)).level(0).rgb.mul(smoothstep(690, 760, TK));

  // normale : différences centrées dans la carte (bilinéaire), plus le micro-relief
  const e = U.F.mul(2).div(RES);
  const gx = Sat(fieldT, fx.add(e), fz).sub(Sat(fieldT, fx.sub(e), fz)).div(e.mul(2));
  const gz = Sat(fieldT, fx, fz.add(e)).sub(Sat(fieldT, fx, fz.sub(e))).div(e.mul(2));
  const nW = normalize(vec3(gx.negate(), 1, gz.negate()));
  const nV = normalize(cameraViewMatrix.mul(vec4(nW, 0)).xyz);

  // coordonnées de matière : le long de l'orteil (s), en travers (v), tirage propre
  const hashK = float(0.5); // (un même tirage pour toute la nappe : pas de couture d’un orteil à l’autre)
  // La peau d'un orteil qui pousse s'étire du col vers le nez : ses motifs
  // (plaques, rides) sont lus dans une coordonnée qui s'allonge avec le front,
  // et redevient l'abscisse au repos quand l'orteil est achevé (raccord exact).
  const sfNow = tf.frontAt(tp, U.t), Lf = tf.Lfront(tp).sub(0.02);
  const stretch = select(isNew, clamp(Lf.div(max(sfNow, 0.05)), 1, 3), float(1));
  const sMat = sL.mul(stretch.sub(1).mul(0.6).add(1));
  // (les motifs se lisent dans les coordonnées du sol : continus sur toute la
  // nappe — dans celles de chaque orteil, ils dessinaient une couture à chaque
  // frontière, et la lave paraissait faite de plusieurs objets)
  void sMat;
  const mp = vec3(ex, ez, 0.37);
  // fraîcheur : 1 sur une peau neuve, 0 sur une vieille nappe (heures)
  const fresh = smoothstep(40000, 1000, age);
  const glassy = smoothstep(40000, 4000, age); // (la peau vitreuse se ternit en quelques heures)
  // ─ micro-relief (m) ─
  // Une peau de pāhoehoe vue de près : des bourrelets (cm), une peau
  // d'éléphant étirée le long de l'orteil (mm), des cordes près du nez sur
  // certains orteils, et, une fois froide, des fissures de retrait (un réseau
  // fin et sinueux, de 8 à 15 cm). Rien de périodique : des lignes de niveau
  // de bruit déformé, étirées selon l'écoulement.
  const L = tp.b.x, Wd = tp.b.y;
  const rel = sL.div(L), side = abs(vL).div(Wd);
  const flank = smoothstep(0.35, 0.95, side).add(smoothstep(0.3, 0, rel).mul(0.8)).min(1);
  const foot = fwidth(ex).add(fwidth(ez));
  const fadeFine = smoothstep(0.004, 0.0015, foot), fadeMid = smoothstep(0.012, 0.004, foot);
  const lumps = fbm(vec3(ex, ez, hashK).mul(7), 3).mul(0.006);
  const warpS = vec3(NZ(mp.mul(2.2)).x, NZ(mp.mul(2.2).add(4.4)).y, 0).mul(0.25);
  const skin = abs(NZ(mp.mul(vec3(26, 26, 1)).add(warpS)).x).oneMinus().pow(5).mul(0.0009).mul(fadeMid).mul(smoothstep(0.95, 0.4, side));
  const stri = NZ(vec3(sL.mul(5), vL.mul(40), hashK.mul(9))).x.mul(0.0003).mul(flank).mul(fadeFine);
  const ropeK = NZ(vec3(sL.mul(2), vL.mul(3), hashK.mul(5).add(2))).y;
  const ropes = abs(NZ(vec3(sMat.mul(17).add(vL.mul(vL).mul(8).div(Wd)), vL.mul(2.5), hashK.mul(3))).y).oneMinus().pow(3).mul(0.0018)
    .mul(smoothstep(0.5, 0.95, rel)).mul(smoothstep(0.95, 0.3, side)).mul(smoothstep(0.15, 0.55, ropeK.add(0.5))).mul(fadeMid);
  const gr1 = NZ(vec3(ex, ez, hashK).mul(140)).x.mul(0.00012).mul(fadeFine);
  // fissures de retrait : elles s'ouvrent en refroidissant (heures)
  const cq = vec3(ex, ez, 0.7).add(vec3(NZ(vec3(ex, ez, 2.1).mul(2.5)).x, NZ(vec3(ex, ez, 5.3).mul(2.5)).y, 0).mul(0.12));
  const cn = abs(NZ(cq.mul(vec3(5, 5, 1))).x);
  const cOpen = smoothstep(400, 6000, age).mul(smoothstep(-0.2, 0.2, NZ(cq.mul(3)).z));
  const cpx = fwidth(cn).max(1e-4);
  const coolCrack = smoothstep(cOpen.mul(0.02).add(cpx), cpx.negate(), cn).mul(cOpen).mul(smoothstep(0.3, 1.2, cOpen.mul(0.02).div(cpx))).mul(0); // (retirées : elles se lisaient comme des traits dessinés)
  // plis de la peau encore molle, en travers de l'écoulement (ils suivent l'étirement)
  const folds = abs(NZ(mp.mul(vec3(26, 6, 1)).add(vec3(NZ(mp.mul(3)).x.mul(0.6), 0, 0))).x).oneMinus().pow(4).mul(0.0014)
    .mul(smoothstep(60, 3, age)).mul(select(isNew, float(1), float(0)));
  // ─ familles ─
  // Cordée : la peau, freinée au front, se plisse en cordes parallèles au front.
  // Les lignes d'égal instant de passage sont les positions successives du
  // front : les cordes en sont les courbes de niveau (une tous les 2,5 s de
  // front, ~3 cm), arquées vers l'aval comme sur les vraies cordes, et elles se
  // creusent en quelques dizaines de secondes, quand la peau se comprime.
  const taAt = (px, pz) => Fn(() => {
    const g = vec2(px.add(U.F).div(U.F.mul(2)).mul(TA_RES).sub(0.5), pz.add(U.F).div(U.F.mul(2)).mul(TA_RES).sub(0.5));
    const i0 = ivec2(int(clamp(floor(g.x), 0, TA_RES - 2)), int(clamp(floor(g.y), 0, TA_RES - 2)));
    const f = clamp(g.sub(floor(g)), 0, 1);
    const a = textureLoad(taT, i0).x, b = textureLoad(taT, i0.add(ivec2(1, 0))).x;
    const c = textureLoad(taT, i0.add(ivec2(0, 1))).x, d = textureLoad(taT, i0.add(ivec2(1, 1))).x;
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  })();
  const taF = taAt(fx, fz);
  // (des cordes par paquets, de pas inégal, interrompues : jamais un réseau
  // de courbes de niveau régulier)
  const ph = taF.mul((2 * PI) / 4.5).add(NZ(vec3(ex, ez, 1.3).mul(3)).x.mul(4)).add(NZ(vec3(ex, ez, 7.7).mul(9)).y.mul(0.9));
  const phFade = smoothstep(1.6, 0.5, fwidth(ph));
  const ropeMask = smoothstep(-0.05, 0.35, NZ(vec3(ex, ez, 3.3).mul(1.6)).z).mul(smoothstep(-0.3, 0.1, NZ(vec3(ex, ez, 5.1).mul(7)).x));
  const rope = abs(sin(ph)).oneMinus().pow(2).mul(phFade).mul(ropeMask);
  const ropeAmp = U.ropes.mul(smoothstep(3, 50, age)).mul(0.0018);
  // Dalles : la croûte étirée se rompt en plaques de 20 à 40 cm ; les rifts
  // s'ouvrent pendant les deux premières minutes, montrent la lave dessous, puis
  // se figent.
  // (plaques : les coutures d'un pavage cellulaire déformé, à bords dentelés)
  const pq = vec3(ex, ez, 2.9).add(vec3(NZ(vec3(ex, ez, 0.4).mul(1.3)).x, NZ(vec3(ex, ez, 6.1).mul(1.3)).y, 0).mul(0.12));
  const pw = worley(pq.add(vec3(NZ(pq.mul(14)).x, NZ(pq.mul(14).add(2.2)).y, 0).mul(0.012)).mul(vec3(3.4, 3.4, 1)));
  const plN = pw.y.sub(pw.x).mul(0.5).add(smoothstep(-0.25, 0.15, NZ(pq.mul(2.5).add(5.5)).z).oneMinus().mul(0.4));
  const plW = U.plates.mul(smoothstep(4, 120, age)).mul(mix(float(0.11), float(0.05), smoothstep(600, 3000, age)));
  const plPx = fwidth(plN).max(1e-4);
  const rift = smoothstep(plW.add(plPx), plW.mul(0.3), plN).mul(smoothstep(0.3, 1.2, plW.div(plPx)));
  // (les plaques s'inclinent un peu, chacune à sa façon : la rupture se lit au relief)
  const tilt = NZ(vec3(ex, ez, 9.4).mul(2.2)).x.mul(0.012).mul(U.plates).mul(smoothstep(10, 200, age));
  // (refroidis, les rifts se referment à moitié : un creux discret, pas un trait noir)
  const Hfam = rope.mul(ropeAmp).sub(rift.mul(mix(float(0.012), float(0.003), smoothstep(600, 3000, age)))).add(tilt);
  const Hm = folds.add(lumps).add(skin).add(gr1).add(Hfam).sub(coolCrack.mul(0.002))
    .mul(G.microDetail).mul(smoothstep(0.45, 0.8, nW.y).mul(0.8).add(0.2));
  mat.normalNode = perturb(Hm, nV);

  // ─ couleur, rugosité, irisation, occlusion ─
  // Le verre de surface (la « peau ») n'est pas uniforme : des plaques
  // vitreuses très lisses, à reflets nets et irisés, alternent avec une
  // croûte plus mate ; les creux et les fissures s'assombrissent, et les
  // fissures anciennes rougissent (oxydes de fer).
  const tint = NZ(vec3(ex, ez, 0.5).mul(1.3)).y.mul(0.5).add(0.5);
  const glassPatch = smoothstep(-0.05, 0.35, NZ(vec3(ex, ez, hashK).mul(2.6)).x.add(NZ(mp.mul(6)).y.mul(0.3)));
  const base = mix(U.albedoOld.mul(tint.mul(0.4).add(0.8)), U.albedo, fresh).mul(mix(float(1.15), float(0.85), glassPatch));
  // creux du relief (cavité) : la surface comparée à sa moyenne sur 4 cm
  const ce = 0.04;
  const Smean = Sat(fieldT, fx.add(ce), fz).add(Sat(fieldT, fx.sub(ce), fz)).add(Sat(fieldT, fx, fz.add(ce))).add(Sat(fieldT, fx, fz.sub(ce))).mul(0.25);
  const cav = clamp(Sat(fieldT, fx, fz).sub(Smean).mul(7).add(1), 0.6, 1);
  const oxide = coolCrack.mul(smoothstep(3000, 9000, age));
  // humeurs : la pluie mouille la croûte froide (plus sombre, en miroir) ;
  // les sulfates poudrent de jaune et de blanc les creux des vieilles croûtes
  const coldK = smoothstep(1500, 200, age).oneMinus();
  const wetK = U.wet.mul(coldK);
  const sulfN = smoothstep(0.45, 0.75, NZ(vec3(ex, ez, 4.2).mul(4.5)).x.add(nW.y.oneMinus().mul(1.6)).add(NZ(vec3(ex, ez, 8.8).mul(14)).y.mul(0.3)).sub(0.15)).mul(0.75);
  // (les sulfates se déposent sur les croûtes de plus de trois quarts d'heure : la
  // coulée neuve reste noire, les dépôts reviennent pendant l'accéléré)
  const sulfK = U.sulfur.mul(sulfN).mul(smoothstep(2600, 3400, age));
  const sulfC = mix(vec3(0.42, 0.37, 0.15), vec3(0.4, 0.4, 0.37), NZ(vec3(ex, ez, 2).mul(7)).z.mul(0.5).add(0.5));
  mat.colorNode = mix(mix(base, vec3(0.05, 0.022, 0.012), oxide.mul(0.35)).mul(coolCrack.mul(-0.15).add(1)).mul(wetK.mul(-0.45).add(1)), sulfC, sulfK);
  void cav; // (occlusion des creux retirée : elle dessinait des taches noires en escalier dans les plis ; la GTAO suffit)
  const roughSkin = mix(mix(float(0.48), float(0.14), glassPatch), U.roughOld, glassy.oneMinus().mul(0.5))
    .add(NZ(mp.mul(7)).x.mul(0.06)).add(coolCrack.mul(0.3)).clamp(0.1, 0.85);
  mat.metalnessNode = float(0);
  mat.iridescence = 1;
  mat.iridescenceNode = glassPatch.mul(smoothstep(0.2, 0.6, NZ(vec3(ex, ez, hashK).mul(1.7)).z)).mul(U.iridMix).mul(glassy);
  mat.iridescenceIORNode = float(2.1);
  mat.iridescenceThicknessNode = NZ(mp.mul(4)).y.mul(160).add(520);
  mat.ior = 1.55;

  // ─ émission : corps noir à la température de surface ─
  // Une peau neuve est d'abord liquide. Des plaques de croûte y naissent et
  // grandissent (en une trentaine de secondes, elles se rejoignent) : entre
  // elles, la lave encore à nu, à la température d'un ou deux millimètres sous
  // la surface. Quand l'orteil gonfle, certaines coutures se rouvrent en
  // déchirures inégales ; elles se ressoudent en refroidissant.
  const Ts = cool.x, Td = cool.z, Tdd = cool.w;
  // Le dessin des fissures n'est pas un pavage : ce sont les lignes de niveau
  // d'un bruit déformé, étirées en travers de l'écoulement (une peau tendue se
  // fend perpendiculairement à l'étirement), à deux échelles, interrompues —
  // des lignes sinueuses, inégales, qui se ramifient et s'arrêtent.
  // La croûte est portée par la lave : elle dérive de quelques centimètres dans
  // le sens de l'écoulement (déduit du champ des instants de passage), puis
  // s'arrête en refroidissant ; ses fissures s'ouvrent, se déforment et se
  // referment avec l'âge (la troisième coordonnée du bruit avance avec lui,
  // puis se fige). Tout dépend de l'âge : la boucle reste exacte.
  const ge = 0.015;
  // (gradient lu dans la carte précise des instants de passage : dans l'âge en
  // demi-flottants, il devenait du bruit vers une heure et la croûte tremblait)
  const zx = taAt(fx.sub(ge), fz).sub(taAt(fx.add(ge), fz));
  const zz = taAt(fx, fz.sub(ge)).sub(taAt(fx, fz.add(ge)));
  const gl = length(vec2(zx, zz));
  const fdir = vec2(zx, zz).negate().div(max(gl, 1e-3)).mul(smoothstep(0.05, 0.6, gl));
  const drift = float(1).sub(exp(age.div(-45))).mul(0.09);
  const evo = min(age, 300).mul(0.004);
  const mpA = vec3(ex.sub(fdir.x.mul(drift)), ez.sub(fdir.y.mul(drift)), evo.add(0.37));
  const q = mpA.add(vec3(NZ(mpA.mul(1.3)).x, NZ(mpA.mul(1.3).add(5.7)).y, 0).mul(0.35));
  // (fissures : des lignes de niveau, déformées à deux échelles — la plus fine
  // donne des bords dentelés —, de largeur et de température inégales le long
  // de leur tracé, effilées à leurs bouts)
  const qj = q.add(vec3(NZ(q.mul(19)).x, NZ(q.mul(19).add(3.1)).y, 0).mul(0.03));
  // Une croûte qui refroidit se fend en plaques irrégulières (4 à 10 cm), aux
  // bords anguleux et dentelés : les coutures d'un pavage cellulaire déformé,
  // dont une partie seulement s'ouvre, de largeur inégale le long du tracé.
  // (Des lignes de niveau de bruit, lisses et sinueuses, faisaient des « vers »
  // lumineux.)
  const wc = worley(qj.mul(vec3(11, 11, 1)));
  const r1 = wc.y.sub(wc.x).mul(0.55);
  const brk = smoothstep(-0.2, 0.2, NZ(q.mul(vec3(6, 6, 1)).add(9.2)).z); // (les coutures s'ouvrent par endroits)
  const along = NZ(q.mul(vec3(14, 14, 1)).add(4.4)).x.mul(0.5).add(0.5); // (largeur le long du tracé)
  const edgeD = r1.div(along.mul(0.9).add(0.35)).add(brk.oneMinus().mul(0.35));
  // (la peau grise se forme en quelques secondes : l'orange ne reste qu'au nez
  // qui avance et dans les déchirures)
  const cover = smoothstep(0.4, 9, age.mul(NZ(mpA.mul(4)).y.mul(0.5).add(1)));
  const gap = float(1).sub(cover).mul(0.6);
  const open = smoothstep(-0.1, 0.35, NZ(mpA.mul(vec3(5, 5, 1)).add(3.3)).x.add(0.25));
  const tear = smoothstep(8, 40, age).mul(smoothstep(1500, 150, age)).mul(open).mul(NZ(mp.mul(9)).z.mul(0.05).add(0.07));
  const crackW = gap.add(tear).mul(0.8);
  // (une fissure plus fine que le pixel s'efface : sinon elle scintille en points)
  const px = fwidth(r1).max(1e-4);
  // (sur un flanc raide, le motif vu de dessus s'étirerait en stries verticales :
  // le nez qui avance montre plutôt une bande de lave à nu, uniforme, qui se
  // couvre en refroidissant)
  const steep = smoothstep(0.8, 0.45, nW.y);
  const crack0 = mix(smoothstep(crackW.add(px), crackW.mul(0.2).sub(px), edgeD).mul(smoothstep(0.3, 1.5, crackW.div(px))),
    smoothstep(25, 2, age).mul(0.9), steep);
  // (familles : les creux entre cordes et les rifts entre dalles laissent voir
  // la lave, tant qu'elle est jeune)
  const famGlow = max(rope.oneMinus().pow(6).mul(U.ropes).mul(smoothstep(240, 20, age)).mul(0.7), rift.mul(smoothstep(900, 60, age)));
  const crack = max(crack0, famGlow).mul(select(isNew, float(1), float(0)));
  const deep = smoothstep(crackW.mul(0.7), 0, edgeD);
  // (le bord d'une plaque est plus mince, donc plus chaud que son centre)
  const rim = smoothstep(crackW.add(0.12), crackW, edgeD).mul(cover.oneMinus().mul(0.5).add(0.15)).mul(select(isNew, float(1), float(0)));
  const Tplate = mix(Ts, Td, rim);
  // (la lave à nu n'est pas uniforme : plus ou moins de peau, de 1 à 6 mm)
  // (la peau de la lave à nu varie d'épaisseur : ±40 K, soit ±40 % de lumière)
  const flowN = NZ(mpA.mul(vec3(9, 9, 1))).x.add(NZ(mpA.mul(vec3(22, 22, 1)).add(4.1)).y.mul(0.5));
  // veines de la lave à nu (étirées selon l'écoulement) et voiles de peau
  // sombre qui se forment par plaques et dérivent avec elle
  const vein = abs(NZ(mpA.mul(vec3(14, 14, 1)).add(warpS.mul(2))).x).oneMinus().pow(6);
  const veil = smoothstep(0.05, 0.35, NZ(mpA.mul(vec3(6, 6, 1)).add(1.9)).y).mul(smoothstep(1.5, 12, age));
  // (le long d'une fissure, la lave vue au fond est plus ou moins profonde : ±50 K)
  const Tgap = mix(mix(Td, Tdd, deep.mul(0.6).clamp(0, 1)).add(flowN.mul(55)).add(vein.mul(60)).add(along.sub(0.5).mul(100)), Ts.add(40), veil.mul(0.75));
  const Tvis0 = mix(Tplate, Tgap, crack);
  // la fente de la percée : elle s'ouvre sur le dos bombé avant que la lave sorte
  const slitOf = (c, dir, tt) => {
    const rel2 = vec2(fx.sub(c.x), fz.sub(c.y));
    const along = dot(rel2, vec2(dir.y, dir.x.negate())), across = dot(rel2, dir);
    const wob = NZ(vec3(along.mul(9), 0.3, 1.7)).x.mul(0.025);
    const openK = smoothstep(-16, 0, tt).mul(float(1).sub(smoothstep(60, 140, tt)));
    const slitW = openK.mul(0.014).mul(smoothstep(0.24, 0.05, abs(along)));
    return smoothstep(slitW, slitW.mul(0.25), abs(across.sub(wob)));
  };
  const slit = max(slitOf(U.src, U.srcDir, U.t), slitOf(U.src2, U.srcDir2, U.t.sub(U.srcT2))).mul(select(isNew, float(0), float(1)));
  const Tvis = max(Tvis0, mix(float(300), float(1130 + 273), slit));
  // la lave à nu est lisse et luisante ; la croûte, terne
  const molten = crack.mul(smoothstep(900 + 273, 1000 + 273, Tvis));

  // ─ la lave éclaire ses voisines ─
  // Carte de lueur (256², ~2,5 cm) : la radiance émise par la surface, vue de
  // dessus, filtrée par ses mips. Une surface reçoit ce que rayonne la lave à
  // quelques centimètres (mip fin) et à quelques décimètres (mip large), d'autant
  // plus qu'elle se tourne vers le côté chaud (gradient de la carte).
  const guv = uvOf(fx, fz);
  const g1 = glowT.sample(guv).level(2).rgb, g2 = glowT.sample(guv).level(4).rgb;
  const gs = 1 / GLOW_RES * 8;
  const lum = (c) => dot(c, vec3(0.2126, 0.7152, 0.0722));
  const gdx = lum(glowT.sample(guv.add(vec2(gs, 0))).level(3).rgb).sub(lum(glowT.sample(guv.sub(vec2(gs, 0))).level(3).rgb));
  const gdz = lum(glowT.sample(guv.add(vec2(0, gs))).level(3).rgb).sub(lum(glowT.sample(guv.sub(vec2(0, gs))).level(3).rgb));
  const toward = vec3(gdx, 0, gdz).div(max(length(vec2(gdx, gdz)), 1e-4));
  const facing = clamp(dot(nW, toward).mul(0.8).add(nW.y.mul(0.25)).add(0.15), 0, 1);
  const irr = g1.mul(0.35).add(g2.mul(0.45)).mul(facing).mul(U.glowGain);
  // diffus (sur une roche noire, faible) + reflet flou dans la peau vitreuse
  const spec = irr.mul(mix(float(0.05), float(0.12), glassy));
  // émissivité directionnelle : vue en biais, une surface chaude émet moins
  // (Fresnel) — c'est ce qui donne du modelé à une lave à nu
  const cosV = clamp(dot(nV, positionViewDirection), 0, 1);
  const emissivity = float(1).sub(float(0.04).add(float(0.96).mul(pow(float(1).sub(cosV), 5)))).div(0.96);
  // (la limite de la lave neuve, lue en bilinéaire, adoucit le bord incandescent : sinon des marches de texel)
  const edgeFade = select(isNew, smoothstep(0.0015, 0.008, layerB), float(1));
  mat.emissiveNode = emitOf(Tvis).mul(U.lavaScale).mul(emissivity).mul(edgeFade).add(irr.mul(mat.colorNode)).add(spec);
  // (mouillée, la croûte fonce et lustre un peu ; un miroir la rendait en plastique)
  mat.roughnessNode = mix(mix(mix(roughSkin, roughSkin.mul(0.7).max(0.18), wetK), float(0.85), sulfK), float(0.08), molten);

  // passe de la carte de lueur : même calcul de l'âge que la peau, au centre du texel
  const glowMat = new THREE.MeshBasicNodeMaterial();
  glowMat.outputNode = Fn(() => {
    const cell = U.F.mul(2).div(GLOW_RES);
    const x = U.F.negate().add(screenCoordinate.x.mul(cell)), z = U.F.negate().add(screenCoordinate.y.mul(cell));
    const F1 = textureLoad(fieldT, texel(x, z));
    const nw = F1.w.greaterThan(0.0015), ag = max(select(nw, F1.z, F1.z.add(U.period)), 0.05);
    const i = clamp(log(ag.div(0.05)).div(log(U.ageMax.div(0.05))), 0, 1).mul(U.coolN.sub(1)).add(0.5).div(U.coolN);
    const c = coolT.sample(vec2(i, 0.5)).level(0);
    // (les déchirures, en moyenne : un cinquième de la surface d'une peau jeune)
    const tr = smoothstep(1, 10, ag).mul(smoothstep(1500, 150, ag)).mul(select(nw, float(0.3), float(0)));
    return vec4(emitOf(mix(c.x, c.z, tr)).mul(U.lavaScale), 1);
  })();
  const glowQuad = new THREE.QuadMesh(glowMat);

  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.castShadow = mesh.receiveShadow = true;
  scene.add(mesh);

  // ── Données d'une scène ──
  function setData({ T: toes, n, lists, listRes, cool, coolN, ageMax, emit, F, h, period, delta, src, src2, blur }) {
    const pad = new Float32Array(Math.max(1, n) * STRIDE);
    pad.set(toes);
    const tt = new THREE.DataTexture(pad, 3, Math.max(1, n), THREE.RGBAFormat, THREE.FloatType); tt.needsUpdate = true;
    // (8 candidats par texel : deux texels RGBA côte à côte)
    const lt = new THREE.DataTexture(lists, listRes * 2, listRes, THREE.RGBAFormat, THREE.FloatType); lt.needsUpdate = true;
    const toHalf = (a) => Uint16Array.from(a, (v) => THREE.DataUtils.toHalfFloat(v));
    const ct = new THREE.DataTexture(toHalf(cool), coolN, 1, THREE.RGBAFormat, THREE.HalfFloatType);
    const et = new THREE.DataTexture(toHalf(emit), emit.length / 4, 1, THREE.RGBAFormat, THREE.HalfFloatType);
    for (const t of [ct, et]) { t.minFilter = t.magFilter = THREE.LinearFilter; t.needsUpdate = true; }
    // relief flouté (la nappe lisse), demi-flottants filtrables
    const bh = new Uint16Array(blur.res * blur.res * 4);
    for (let i = 0; i < blur.res * blur.res; i++) { bh[i * 4] = THREE.DataUtils.toHalfFloat(blur.B[i]); bh[i * 4 + 3] = 15360; }
    const bt = new THREE.DataTexture(bh, blur.res, blur.res, THREE.RGBAFormat, THREE.HalfFloatType);
    bt.minFilter = bt.magFilter = THREE.LinearFilter; bt.needsUpdate = true;
    for (const [node, key, t] of [[toeT, 'toe', tt], [listT, 'list', lt], [coolT, 'cool', ct], [emitT, 'emit', et], [blurT, 'blur', bt]]) { T[key].dispose(); T[key] = t; node.value = t; }
    U.listRes.value = listRes; U.coolN.value = coolN; U.ageMax.value = ageMax;
    U.F.value = F; U.h.value = h; U.period.value = period; U.delta.value.set(delta[0], delta[1]);
    U.src.value.set(src.x, src.z); U.srcDir.value.set(Math.cos(src.heading), Math.sin(src.heading));
    if (src2) { U.src2.value.set(src2.x, src2.z); U.srcDir2.value.set(Math.cos(src2.heading), Math.sin(src2.heading)); U.srcT2.value = src2.t; } else U.srcT2.value = 1e6;
    dirty = true; taDirty = true;
  }

  // lueur au sol sous (x, z), mip lvl (pour les fumées)
  // (xz en coordonnées du monde)
  const glowAt = (xz, lvl) => glowT.sample(uvOf(xz.x.add(U.off.x), xz.y.add(U.off.y))).level(lvl).rgb;
  // (l'image précédente compte pour immobile : vitesses nulles)
  function still() {
    prevT.value = rts[cur].texture;
    U.offPrev.value.copy(U.off.value); U.shiftPrev.value = U.shift.value;
  }
  return { mesh, U, setData, updatePass, glowAt, still, get fieldTexture() { return rts[cur].texture; }, RES };
}
