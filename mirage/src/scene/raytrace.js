// Le lancer de rayons de la mise en abyme, au pixel (un quadrilatère plein écran).
//
// Chaque pixel suit son rayon : il rencontre les faces extérieures des deux
// coupes (argent guilloché), leurs joncs, la table, ou passe par l'ouverture
// (ou par le jour du couvercle levé) dans la cavité, où il se réfléchit sur
// l'argent poli (même calcul que gen/mirascope.js : intersection d'un rayon et
// d'un paraboloïde, normale par le gradient). Au fond se tient le petit
// mirascope : quand le rayon entre dans la sphère qui l'enveloppe, il passe
// dans le repère du petit (une similitude : x → (x − ŷ·MINI.y) / K, la
// direction ne change pas) et le même calcul recommence, un niveau plus bas —
// gen/abyme.js en est la référence. Quand il en ressort, il revient au parent.
// Les images réelles qui flottent au-dessus des ouvertures ne sont pas
// dessinées : elles se forment.
//
// L'éclairage est le même dans le repère de chaque niveau (la salle, la lampe
// de côté, le projecteur au-dessus de l'axe) : c'est ce qui rend la chaîne
// semblable à elle-même, et le raccord de la boucle possible.
//
// Le fondu du raccord : une seconde caméra (uniformes alt*), tracée seulement
// pendant la demi-seconde où son poids n'est pas nul.
//
// Le quadrilatère écrit la profondeur de son premier impact, pour que le
// mécanisme (potence, bras, pied), dessiné ensuite comme des objets ordinaires,
// s'emboîte avec lui.
import * as THREE from 'three/webgpu';
import {
  Fn, uniform, texture, vec2, vec3, vec4, float, screenUV, mix, clamp, abs, max, min, exp, sin, sqrt, pow, fract, floor, dot,
  select, mrt, smoothstep, cameraProjectionMatrixInverse, cameraProjectionMatrix, cameraViewMatrix, cameraWorldMatrix, cameraPosition,
  positionGeometry, normalize, length, reflect, equirectUV, If, Loop, atan, mx_fractal_noise_float, cos, step, cross,
} from 'three/tsl';
import { BEADS, FOOT, MINI, BOUND, K, JEWELS } from '../gen/abyme.js';
import { G } from './globals.js';

const BIG = 1e6;
const IMG_Y = 0.052; // (hauteur des images flottantes, repère d'un niveau : ≈ f + h)

export function createRaytrace({ lite = false } = {}) {
  const v3 = (x = 0, y = 0, z = 0) => uniform(new THREE.Vector3(x, y, z));
  const col = (h) => uniform(new THREE.Color(h));
  const m4 = () => uniform(new THREE.Matrix4());
  const U = {
    f: uniform(0.05), lift: uniform(0), holeR: uniform(0.021), rimR: uniform(0.0707), shell: uniform(0.0025),
    tableY: uniform(-0.03), inner: col('#f2f0ea'), outer: col('#e8e4dc'), outerRough: uniform(0.18), engrave: uniform(1), pattern: uniform(0), style: uniform(0), jewel: uniform(0), jewelCol: col('#efe9de'), jewelCol2: col('#efe9de'), trim: col('#ece9e2'),
    table: col('#3a2a22'), tableRough: uniform(0.7), tableKind: uniform(0), envI: uniform(1),
    keyDir: v3(0.4, 0.8, 0.3), keyCol: v3(2, 1.9, 1.8), ambient: v3(0.25, 0.25, 0.27),
    // la salle (0 éteinte, 1 allumée) ; le projecteur au-dessus de l'axe
    room: uniform(1), spotCol: v3(30, 28, 26), spotSheen: uniform(0.6), spotH: uniform(0.55), lampR: uniform(0.03), spotIn: uniform(0.081), spotOut: uniform(0.14),
    // compensation de l'argent (vue courante, vue du fondu) ; le fondu
    // taille d'un pixel à la distance de la visée (par caméra) : la gravure
    // s'efface quand un pixel couvre un sillon
    pixFoot: uniform(0.00005), altPixFoot: uniform(0.00005),
    comp: v3(1, 1, 1), altComp: v3(1, 1, 1), altW: uniform(0), altPos: v3(0, 0, 0), altWorld: m4(), altProjInv: m4(),
    // l'entaille du couvercle (repère du niveau) : direction de son milieu, cos
    // du demi-angle, ses deux bords (directions) ; l'émail de la bande gravée
    cutC: v3(0, 0, 1), cutCos: uniform(1), cutE1: v3(1, 0, 0), cutE2: v3(1, 0, 0), cutOn: uniform(0), section: col('#a3301f'), enamel: col('#1c2b5e'),
    debug: uniform(0), // (1 : couleur = où s'arrête le rayon — salle rouge, dôme jaune, jonc blanc, pied orange, table bleu, épuisé magenta ; plus sombre à chaque niveau)
  };
  const empty = new THREE.DataTexture(new Uint16Array(4 * 4), 2, 1, THREE.RGBAFormat, THREE.HalfFloatType);
  const T = { env: texture(empty) };

  const env = (d, rough = float(0)) => T.env.sample(equirectUV(d)).level(rough.mul(7)).rgb.mul(U.envI);
  const hash = (p) => fract(sin(dot(p, vec2(12.9898, 78.233))).mul(43758.5453));

  // intersection avec y = a·r² + b, la plus proche au-delà de eps, r ∈ [rMin, rMax]
  // (forme stable : q = −½(B + sgn B·√D), t₁ = q/A, t₂ = C/q)
  // hors de l'entaille du couvercle
  const notCut = (p) => dot(p.xz, U.cutC.xz).lessThanEqual(length(p.xz).mul(U.cutCos)).or(U.cutOn.lessThan(0.5));
  const parab = (o, d, a, b, rMin, rMax, cut = false) => {
    const A = a.mul(d.x.mul(d.x).add(d.z.mul(d.z)));
    const B = a.mul(o.x.mul(d.x).add(o.z.mul(d.z))).mul(2).sub(d.y);
    const C = a.mul(o.x.mul(o.x).add(o.z.mul(o.z))).add(b).sub(o.y);
    const D = B.mul(B).sub(A.mul(C).mul(4));
    const sD = sqrt(max(D, 0));
    const q = B.add(select(B.greaterThanEqual(0), sD, sD.negate())).mul(-0.5);
    const t1 = q.div(select(abs(A).lessThan(1e-12), float(1e-12), A)), t2 = C.div(select(abs(q).lessThan(1e-12), float(1e-12), q));
    const tl = min(t1, t2), th = max(t1, t2);
    const ok = (t) => {
      const p = o.add(d.mul(t)), r = length(p.xz);
      const k = t.greaterThan(1e-6).and(r.greaterThanEqual(rMin)).and(r.lessThanEqual(rMax)).and(D.greaterThanEqual(0));
      return cut ? k.and(notCut(p)) : k;
    };
    return select(ok(tl), tl, select(ok(th), th, float(BIG)));
  };
  const nParab = (p, a) => normalize(vec3(p.x.mul(a).mul(2), -1, p.z.mul(a).mul(2)));
  // sphère : [t entrée, t sortie] (BIG, BIG si manquée)
  const sphere = (o, d, c, r) => {
    const oc = o.sub(c), b = dot(oc, d), cc = dot(oc, oc).sub(typeof r === 'number' ? r * r : r.mul(r)), D = b.mul(b).sub(cc), s = sqrt(max(D, 0));
    return [select(D.greaterThan(0), b.negate().sub(s), float(BIG)), select(D.greaterThan(0), b.negate().add(s), float(-BIG))];
  };
  // cylindre d'axe y (paroi entre y0 et y1, disque du haut)
  const cylY = (o, d, r, y0, y1) => {
    const A = d.x.mul(d.x).add(d.z.mul(d.z)), B = o.x.mul(d.x).add(o.z.mul(d.z)).mul(2), C = o.x.mul(o.x).add(o.z.mul(o.z)).sub(r * r);
    const D = B.mul(B).sub(A.mul(C).mul(4));
    const ts = B.negate().sub(sqrt(max(D, 0))).div(max(A.mul(2), 1e-12));
    const ys = o.y.add(d.y.mul(ts));
    const side = select(D.greaterThan(0).and(ts.greaterThan(1e-7)).and(ys.greaterThanEqual(y0)).and(ys.lessThanEqual(y1)), ts, float(BIG));
    const tc = float(y1).sub(o.y).div(select(abs(d.y).lessThan(1e-9), float(1e-9), d.y));
    const pc = o.add(d.mul(tc));
    const cap = select(tc.greaterThan(1e-7).and(length(pc.xz).lessThanEqual(r)), tc, float(BIG));
    return min(side, cap);
  };
  // boule : t d'entrée, BIG sinon
  const ballT = (o, d, c, r) => { const [t0] = sphere(o, d, c, r); return select(t0.greaterThan(1e-7), t0, float(BIG)); };
  const JSTEP = (Math.PI * 2) / JEWELS.n;
  const jewelC = (p, yJ) => { const a = floor(atan(p.z, p.x).div(JSTEP).add(0.5)).mul(JSTEP); return vec3(cos(a).mul(JEWELS.R), yJ, sin(a).mul(JEWELS.R)); };

  // tores couchés d'axe y (les joncs) : sphere tracing, borné à la tranche
  // |y − yc| < r et à la sphère englobante. (Sans Break : un Break dans une
  // boucle imbriquée interrompt aussi la boucle des rebonds.)
  // l'entaille comme demi-espaces : positive dedans (les deux bords voient le
  // point du même côté), −1 couvercle entier ; le tore coupé : max(tore, cutTerm)
  const cutTerm = (p) => select(U.cutOn.greaterThan(0.5), min(dot(p.xz, vec2(U.cutE1.z, U.cutE1.x.negate())), dot(p.xz, vec2(U.cutE2.z.negate(), U.cutE2.x))), float(-1));
  const sdTorus = (p, yc, Rm, rm) => length(vec2(length(p.xz).sub(Rm), p.y.sub(yc))).sub(rm);
  // la couronne de perles : répétition angulaire (la perle la plus proche)
  const sdPearls = (p, yc) => length(p.sub(jewelC(p, yc))).sub(JEWELS.r);
  const traceTori = (o, d, tori, tMax, steps, name) => {
    // tranche commune : de la plus basse à la plus haute
    const yLo = tori.reduce((m, T) => min(m, T.y.sub(T.r)), float(BIG)), yHi = tori.reduce((m, T) => max(m, T.y.add(T.r)), float(-BIG));
    const iy = float(1).div(select(abs(d.y).lessThan(1e-9), float(1e-9), d.y));
    const ta = yLo.sub(o.y).mul(iy), tb = yHi.sub(o.y).mul(iy);
    const Rx = tori.reduce((m, T) => max(m, float(T.R + T.r)), float(0));
    const [s0, s1] = sphere(o, d, vec3(0, yLo.add(yHi).mul(0.5), 0), Rx.add(yHi.sub(yLo).mul(0.5)));
    const t0 = max(max(min(ta, tb), s0), 0), t1 = min(min(max(ta, tb), s1), tMax);
    // (un jonc du couvercle est privé du coin de l'entaille : dans l'entaille,
    // les deux bords voient le point du même côté)
    const base = (p, T) => (T.pearls ? sdPearls(p, T.y) : sdTorus(p, T.y, T.R, T.r));
    const one = (p, T) => (T.cut ? max(base(p, T), cutTerm(p)) : base(p, T));
    const sd = (p) => tori.reduce((m, T) => (m === null ? one(p, T) : min(m, one(p, T))), null);
    const tt = t0.toVar(), hit = float(BIG).toVar(), going = select(t0.lessThan(t1), float(1), float(0)).toVar();
    Loop({ start: 0, end: steps, name }, () => {
      If(going.greaterThan(0.5), () => {
        const ds = sd(o.add(d.mul(tt)));
        If(ds.lessThan(2e-6), () => { hit.assign(tt); going.assign(0); }).Else(() => {
          tt.addAssign(max(ds, 1e-6));
          If(tt.greaterThan(t1), () => { going.assign(0); });
        });
      });
    });
    return hit;
  };

  // ── l'éclairage (repère du niveau) ──
  // le projecteur : une lampe ronde de rayon lampR à la hauteur spotH sur
  // l'axe, en cône (pleine intensité sous spotIn, nulle au-delà de spotOut,
  // en tangente de l'angle). Sur un métal : son reflet, élargi par la
  // rugosité ; la gravure en diffuse un peu partout (lueur).
  const spotLight = (p, n, v, rough) => {
    const Lv = vec3(0, U.spotH, 0).sub(p), dist = length(Lv), L = Lv.div(dist);
    const tanA = length(p.xz).div(max(U.spotH.sub(p.y), 1e-4));
    const cone = smoothstep(U.spotOut, U.spotIn, tanA);
    const R = reflect(v, n), c = dot(R, L);
    const al = U.lampR.div(dist), w = al.add(rough.mul(0.9));
    const lobe = exp(float(1).sub(c).mul(-2).div(w.mul(w))).mul(al.mul(al).div(w.mul(w)));
    const sheen = max(dot(n, L), 0).mul(rough).mul(U.spotSheen);
    return U.spotCol.mul(cone).mul(lobe.add(sheen));
  };
  // diffus du projecteur (émail, perles)
  const spotDiffuse = (p, n) => {
    const Lv = vec3(0, U.spotH, 0).sub(p), L = normalize(Lv);
    const cone = smoothstep(U.spotOut, U.spotIn, length(p.xz).div(max(U.spotH.sub(p.y), 1e-4)));
    return U.spotCol.mul(cone).mul(max(dot(n, L), 0)).mul(0.004);
  };
  // l'argent guilloché de l'extérieur : cercles concentriques gravés
  // ── les matières (repère du niveau) ──
  // Un seul modèle : une base (couleur, métal ou non, rugosité), une normale
  // perturbée par le relief, et un vernis facultatif (émail, laque, nacre
  // polie). Spéculaire : la salle floutée selon la rugosité, pondérée par
  // Fresnel–Schlick (F0 = 0,04 pour un diélectrique, la couleur pour un métal,
  // atténué aux rugosités fortes) ; diffus : la salle entière, floue
  // (irradiance), la lumière ambiante, la lampe, le projecteur.
  const shadePBR = (p, n, d, base, metal, rough, cc = float(0), ccRough = float(0.03), nCC = n) => {
    const V = d.negate(), NdV = max(dot(n, V), 1e-3);
    const R = reflect(d, n);
    const F0 = mix(vec3(0.04), base, metal);
    const F = F0.add(max(vec3(float(1).sub(rough)), F0).sub(F0).mul(pow(float(1).sub(NdV), 5)));
    // (sous un vernis, une base diélectrique ne garde que son diffus : son reflet
    // est celui du vernis)
    const spec = env(R, rough).mul(U.room).add(spotLight(p, n, d, rough)).mul(F).mul(float(1).sub(cc.mul(float(1).sub(metal))));
    const lam = max(dot(n, normalize(U.keyDir)), 0);
    const irr = env(n, float(1)).mul(0.6).add(U.ambient).add(U.keyCol.mul(lam).mul(0.5)).mul(U.room).add(spotDiffuse(p, n));
    const diff = base.mul(float(1).sub(metal)).mul(irr).mul(vec3(1).sub(F));
    const NdVc = max(dot(nCC, V), 1e-3), Fc = float(0.04).add(float(0.96).mul(pow(float(1).sub(NdVc), 5))).mul(cc);
    const coat = env(reflect(d, nCC), ccRough).mul(U.room).add(spotLight(p, nCC, d, ccRough));
    return diff.add(spec).mul(float(1).sub(Fc)).add(coat.mul(Fc));
  };
  const hash2 = (q) => fract(sin(dot(q, vec2(127.1, 311.7))).mul(43758.5453));
  const SILVER = vec3(0.97, 0.96, 0.92), GOLD = vec3(1.0, 0.77, 0.34), COPPER = vec3(0.95, 0.62, 0.5);
  // traces de doigts et usure : la rugosité varie un peu, en nuages
  const smudge = (p) => mx_fractal_noise_float(p.mul(160), 3, 2, 0.5).mul(0.5).add(0.5);

  const GUIL = 3600; // (sillons : 1,7 mm)
  // la phase de la gravure guillochée : 0 vagues, 1 soleil, 2 grain d'orge
  const guilPhase = (r, th) => select(U.pattern.lessThan(0.5), r.mul(GUIL).add(sin(th.mul(48)).mul(0.7)),
    select(U.pattern.lessThan(1.5), th.mul(180).add(sin(r.mul(GUIL * 0.25)).mul(0.6)), r.mul(GUIL).add(th.mul(24))));
  // cloisonné : la cellule (anneau, secteur) et la position dans la cellule
  const cloCell = (r, th) => {
    const ring = floor(r.sub(0.0215).div(0.0062)), ns = ring.mul(6).add(12), a = th.div(Math.PI * 2).add(0.5).mul(ns);
    return { ring, ns, a, fr: fract(r.sub(0.0215).div(0.0062)), fa: fract(a), cell: vec2(ring, floor(a)) };
  };
  // fils d'or : un bourrelet de 0,12 mm, arrondi, aux bords de la cellule ; l'émail
  // se creuse un peu au milieu (il s'est rétracté en cuisant)
  const cloHeight = (r, th) => {
    const C = cloCell(r, th);
    const ew = min(min(C.fr, float(1).sub(C.fr)).mul(0.0062), min(C.fa, float(1).sub(C.fa)).mul(float(Math.PI * 2).div(C.ns)).mul(r));
    const wire = smoothstep(0.00045, 0.0001, ew).mul(0.00012);
    const dip = smoothstep(0.0003, 0.0022, ew).mul(-0.00003);
    return wire.add(dip);
  };
  // cuivre martelé : chaque coup est une cuvette ; la hauteur est le carré de la
  // distance au centre du coup le plus proche (Voronoï), en arêtes douces
  const hammer = (r, th) => {
    const g = vec2(th.mul(r), r).div(0.0034), c0 = floor(g);
    const best = float(9).toVar(), best2 = float(9).toVar(), cid = vec2(0).toVar();
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) {
      const c = c0.add(vec2(i, j)), o2 = vec2(hash2(c), hash2(c.add(5.7))).mul(0.8).add(0.1), dd = length(g.sub(c).sub(o2));
      // (sans If imbriqué : une chaîne If/ElseIf ouverte ici, dans une branche
      // du décor, détachait les branches suivantes de la leur)
      const closer = dd.lessThan(best);
      best2.assign(select(closer, best, min(best2, dd))); cid.assign(select(closer, c, cid)); best.assign(min(best, dd));
    }
    return vec3(best, best2, hash2(cid));
  };
  const hammerHeight = (r, th) => { const h = hammer(r, th); return h.x.mul(h.x).mul(0.00011); };

  // la normale perturbée par un relief h(r, θ) (différences finies le long du
  // dôme : radialement, et autour de l'axe)
  const bump = (n, p, r, th, H) => {
    const tT = normalize(vec3(p.z.negate(), 0, p.x)), tR = normalize(cross(n, tT));
    const er = 0.00005, h0 = H(r, th), hr = H(r.add(er), th), ht = H(r, th.add(float(er).div(r)));
    return normalize(n.sub(tR.mul(hr.sub(h0).div(er))).sub(tT.mul(ht.sub(h0).div(er))));
  };

  // le dôme, dehors (et la coupe du bas) : le décor de la famille
  const outerColor = (p0, n0, d0, foot0) => {
    // (figés à l'entrée : TSL déclare ses variables en tête de fonction et ne les
    // remplit qu'à leur première lecture — lue d'abord dans la branche du
    // premier décor, la normale restait nulle dans les autres)
    const p = vec3(p0).toVar(), n = vec3(n0).toVar(), d = vec3(d0).toVar(), foot = float(foot0).toVar();
    const r = length(p.xz).toVar(), th = atan(p.z, p.x).toVar();
    const sm = smudge(p).toVar();
    const out = vec3(0).toVar();
    // la bande (27 à 31,5 mm de l'axe), ses bords, ses points
    const band = smoothstep(0.0268, 0.0272, r).mul(float(1).sub(smoothstep(0.0313, 0.0317, r))).toVar();
    const edge = float(1).sub(smoothstep(0.0272, 0.0276, r).mul(float(1).sub(smoothstep(0.0309, 0.0313, r)))).toVar();
    const dots = step(length(vec2(r.sub(0.02925), fract(th.mul(36 / (Math.PI * 2))).sub(0.5).mul(r).mul((Math.PI * 2) / 36))), 0.00055).toVar();
    // (la gravure s'efface quand un pixel couvre un sillon)
    const fade = float(1).sub(smoothstep((Math.PI * 2) / GUIL * 0.2, (Math.PI * 2) / GUIL * 0.55, foot)).toVar();
    If(U.style.lessThan(0.5), () => {
      // argent guilloché : des sillons de 50 µm (ils font courir la lumière en
      // reflets qui tournent) ; sur la bande, un émail translucide coulé sur la
      // gravure, qui la laisse voir — l'émail guilloché des montres
      const H = (rr, tt) => sin(guilPhase(rr, tt)).mul(0.00005).mul(fade).mul(U.engrave);
      const nb = bump(n, p, r, th, H);
      const metalC = shadePBR(p, nb, d, U.outer, float(1), U.outerRough.mul(0.6).add(sm.mul(0.06)));
      const enamel = shadePBR(p, nb, d, U.outer.mul(U.enamel).mul(1.6), float(1), float(0.12), float(1), float(0.02), n);
      const goldD = shadePBR(p, n, d, GOLD, float(1), float(0.1));
      out.assign(mix(metalC, mix(enamel, goldD, dots), band));
    }).ElseIf(U.style.lessThan(1.5), () => {
      // cloisonné : émaux vitreux, chaque cellule un peu inégale (la cuisson),
      // semée de fines bulles ; fils d'or en relief ; une pastille au cœur
      const C = cloCell(r, th), nb = bump(n, p, r, th, cloHeight);
      const ew = min(min(C.fr, float(1).sub(C.fr)).mul(0.0062), min(C.fa, float(1).sub(C.fa)).mul(float(Math.PI * 2).div(C.ns)).mul(r));
      const wire = smoothstep(0.0003, 0.0002, ew);
      const hc = hash2(C.cell);
      const pal = (h) => select(h.lessThan(0.25), vec3(0.02, 0.32, 0.33), select(h.lessThan(0.5), vec3(0.02, 0.08, 0.38), select(h.lessThan(0.75), vec3(0.6, 0.12, 0.05), vec3(0.82, 0.76, 0.6))));
      const dotC = step(length(vec2(C.fr.sub(0.5), C.fa.sub(0.5).mul(float(Math.PI * 2).div(C.ns)).mul(r).div(0.0062))), 0.2);
      const tone = mx_fractal_noise_float(vec3(p.xz.mul(900), hc.mul(9)), 2, 2, 0.5).mul(0.25).add(1);
      const bubble = smoothstep(0.62, 0.7, mx_fractal_noise_float(vec3(p.xz.mul(6000), 1.3), 1, 2, 0.5)).mul(0.35);
      const enC = mix(pal(hc), pal(fract(hc.add(0.37))), dotC).mul(tone).mul(float(1).sub(bubble));
      const enamel = shadePBR(p, nb, d, enC, float(0), float(0.25), float(1), float(0.015).add(sm.mul(0.03)), nb);
      const goldW = shadePBR(p, nb, d, GOLD, float(1), float(0.12).add(sm.mul(0.1)));
      const dome = mix(enamel, goldW, wire);
      out.assign(mix(dome, shadePBR(p, n, d, GOLD, float(1), float(0.1).add(sm.mul(0.08))), band));
    }).ElseIf(U.style.lessThan(2.5), () => {
      // laque noire (urushi) sous un vernis profond ; poudre d'or (nashiji) :
      // des paillettes d'or, chacune inclinée au hasard, qui scintillent sous la
      // laque ; filets et constellation d'or (maki-e) en léger relief
      const g = vec2(th.mul(r).div(0.0016), r.div(0.0016)), cid = floor(g), hp = hash2(cid);
      const flake = step(length(fract(g).sub(vec2(hash2(cid.add(9.3)), hp).mul(0.4).add(0.3))), 0.24).mul(step(hp, smoothstep(0.025, 0.07, r).mul(0.6)));
      const fn = normalize(n.add(vec3(hash2(cid.add(1.7)), hash2(cid.add(2.9)).mul(0.3), hash2(cid.add(4.1))).sub(vec3(0.5, 0.15, 0.5)).mul(0.9)));
      const lines = step(abs(r.sub(0.0335)), 0.00035).add(step(abs(r.sub(0.0358)), 0.0002)).add(step(abs(r.sub(0.058)), 0.0003)).min(1);
      const g2 = vec2(th.mul(r).div(0.004), r.div(0.004)), c2 = floor(g2), h2 = hash2(c2.add(7.1));
      const star = step(length(fract(g2).sub(vec2(hash2(c2.add(3.3)), h2).mul(0.6).add(0.2))), 0.1).mul(step(0.84, h2)).mul(step(0.036, r));
      const urushi = vec3(0.012, 0.008, 0.006).mul(mx_fractal_noise_float(vec3(p.xz.mul(300), 2.2), 2, 2, 0.5).mul(0.3).add(1));
      const lac = shadePBR(p, n, d, urushi, float(0), float(0.3), float(1), float(0.015).add(sm.mul(0.025)));
      const flakeC = shadePBR(p, fn, d, GOLD, float(1), float(0.08), float(1), float(0.015), n);
      const goldM = shadePBR(p, n, d, GOLD, float(1), float(0.18).add(sm.mul(0.1)));
      const dome = mix(mix(lac, flakeC, flake), goldM, min(lines.add(star), 1));
      out.assign(mix(dome, goldM, band));
    }).ElseIf(U.style.lessThan(3.5), () => {
      // cuivre martelé : cuvettes polies par le marteau, arêtes plus mates et
      // plus sombres (l'oxyde s'y loge) ; un filet poli sur la bande
      const h = hammer(r, th), ridge = smoothstep(0.15, 0.0, h.y.sub(h.x));
      const nb = bump(n, p, r, th, hammerHeight);
      const tone = h.z.mul(0.12).add(0.94);
      const base = mix(COPPER.mul(tone), vec3(0.42, 0.2, 0.13), ridge.mul(0.55).add(sm.mul(0.15)));
      const cu = shadePBR(p, nb, d, base, float(1), mix(float(0.07), float(0.32), ridge).add(sm.mul(0.08)));
      out.assign(mix(cu, shadePBR(p, n, d, COPPER, float(1), float(0.05)), band.mul(edge)));
    }).Else(() => {
      // nacre : tesselles taillées dans la coquille, chacune un peu inclinée, sa
      // « flamme » propre (les couches de nacre), irisée selon l'angle de vue
      // (interférence en couche mince), polie sous un vernis ; joints de résine
      const ring = floor(r.sub(0.0215).div(0.0048)), ns = ring.mul(4).add(16);
      const a = th.div(Math.PI * 2).add(0.5).mul(ns), cell = vec2(ring, floor(a));
      const fr = fract(r.sub(0.0215).div(0.0048)), fa = fract(a);
      const seam = float(1).sub(step(0.035, fr).mul(step(fr, 0.965)).mul(step(0.025, fa).mul(step(fa, 0.975))));
      const hc = hash2(cell), tT = normalize(vec3(p.z.negate(), 0, p.x)), tR = normalize(cross(n, tT));
      const nt = normalize(n.add(tR.mul(hash2(cell.add(2.3)).sub(0.5).mul(0.12))).add(tT.mul(hash2(cell.add(8.1)).sub(0.5).mul(0.12))));
      const flame = mx_fractal_noise_float(vec3(fr.mul(3), fa.mul(5), hc.mul(13)), 3, 2, 0.5);
      const V = d.negate(), cosT = max(dot(nt, V), 0);
      // (couche mince : l'épaisseur optique varie avec la flamme ; la couleur suit
      // la différence de marche 2·n·e·cos θ')
      const opd = flame.mul(0.35).add(hc.mul(0.4)).add(0.55).mul(float(1).add(cosT.mul(0.6)));
      const irid = vec3(0.5).add(vec3(cos(opd.mul(6.283)), cos(opd.mul(6.283).sub(2.1)), cos(opd.mul(6.283).sub(4.2))).mul(0.5));
      const body = mix(vec3(0.86, 0.85, 0.83), irid, 0.35).mul(flame.mul(0.1).add(0.95));
      const nacre = shadePBR(p, nt, d, body, float(0), float(0.2), float(1), float(0.02).add(sm.mul(0.02)), nt);
      const resin = shadePBR(p, n, d, vec3(0.03, 0.025, 0.02), float(0), float(0.4));
      const dome = mix(nacre, resin, seam);
      const bandC = mix(shadePBR(p, n, d, U.enamel, float(0), float(0.2), float(1), float(0.02)), shadePBR(p, n, d, GOLD, float(1), float(0.1)), edge);
      out.assign(mix(dome, bandC, band));
    });
    return out;
  };
  // les tranches de la coupe : peintes en rouge, comme sur les maquettes
  // écorchées des musées (une peinture satinée)
  const section = (p, n, d) => shadePBR(p, n, d, U.section, float(0), float(0.45));
  // la couronne : 0 perles, 1 cabochons (deux pierres alternées), 2 clous d'or,
  // 3 rivets de cuivre, 4 perles noires
  const pearl = (p, n, d) => {
    const k = floor(atan(p.z, p.x).div((Math.PI * 2) / JEWELS.n).add(0.5)).mod(2);
    const stone = mix(U.jewelCol, U.jewelCol2, k);
    const V = d.negate(), cosT = max(dot(n, V), 0);
    // perle : orient (une irisation douce, plus forte sur les bords), lustre sous vernis
    const orient = vec3(0.5).add(vec3(cos(cosT.mul(9)), cos(cosT.mul(9).sub(2.1)), cos(cosT.mul(9).sub(4.2))).mul(0.5));
    const nacre = shadePBR(p, n, d, mix(stone, orient.mul(stone.add(0.2)), float(1).sub(cosT).mul(0.35)), float(0), float(0.25), float(1), float(0.06));
    // cabochon : une pierre polie — la lumière y entre et revient colorée, plus
    // claire au cœur (le fond de la pierre)
    const cab = shadePBR(p, n, d, stone.mul(cosT.mul(0.8).add(0.4)), float(0), float(0.05), float(1), float(0.01));
    const metal = shadePBR(p, n, d, stone, float(1), float(0.12));
    return select(U.jewel.lessThan(0.5).or(U.jewel.greaterThan(3.5)), nacre, select(U.jewel.lessThan(1.5), cab, metal));
  };
  // la garniture (joncs, lèvre, pied du petit) : le métal de la famille, poli
  const polished = (p, n, d) => shadePBR(p, n, d, U.trim, float(1), float(0.04).add(smudge(p).mul(0.05)));
  // la table (niveau 0) : matière de l'humeur, éclairée par la salle seule
  // (le projecteur, au-dessus de l'axe, n'y touche que dans l'ombre des coupes)
  const tableColor = (p, d) => {
    const r = length(p.xz);
    const occ = smoothstep(U.rimR.mul(0.3), U.rimR.mul(1.25), r).mul(0.7).add(0.3);
    const lam = max(normalize(U.keyDir).y, 0);
    // la matière : 0 noyer en lames, 1 chêne d'établi, 2 marbre veiné, 3 feutre
    const tk = U.tableKind;
    // bois : lames de 8,5 cm, aboutées en quinconce ; chaque lame a sa teinte
    // et son morceau de grume — cernes coupés en biais (dessin en flammes),
    // bois d'été plus sombre, fibres et pores fins dans le fil, joints creux
    const BW = 0.085, BL = 0.62;
    const row = floor(p.z.div(BW)), v = p.z.sub(row.mul(BW));
    const xs = p.x.add(hash(vec2(row, 3.7)).mul(BL));
    const board = floor(xs.div(BL)), uu = xs.sub(board.mul(BL));
    const sB = hash(vec2(row, board)), sB2 = hash(vec2(board.add(11.3), row));
    const drift = mx_fractal_noise_float(vec3(uu.mul(2.2), sB.mul(17), 0.3), 3, 2, 0.5).mul(0.03);
    const wob = mx_fractal_noise_float(vec3(uu.mul(9), v.mul(40), sB2.mul(9)), 2, 2, 0.5).mul(0.0025);
    const rr = length(vec2(v.sub(BW * 0.5).sub(sB.sub(0.5).mul(BW * 1.4)).add(drift), sB2.mul(0.05).add(0.012))).add(wob);
    const phase = fract(rr.mul(sB.mul(260).add(480)));
    const late = smoothstep(0.7, 0.92, phase).mul(float(1).sub(smoothstep(0.96, 1.0, phase)));
    const fiber = mx_fractal_noise_float(vec3(uu.mul(40), v.mul(1800), sB.mul(31)), 4, 2, 0.6).mul(0.26);
    const pores = smoothstep(0.55, 0.85, mx_fractal_noise_float(vec3(uu.mul(240), v.mul(5200), sB2.mul(13)), 1, 2, 0.5)).mul(late.mul(0.5).add(0.2)).mul(0.25);
    const seam = float(1).sub(smoothstep(0.0, 0.0007, min(v, float(BW).sub(v)))).add(float(1).sub(smoothstep(0.0, 0.0006, min(uu, float(BL).sub(uu))))).min(1);
    const tint = vec3(1, 0.97, 0.93).mul(sB.mul(0.32).add(0.84)).add(vec3(0.05, 0.0, -0.04).mul(sB2.sub(0.5)));
    const figure = mx_fractal_noise_float(vec3(uu.mul(6), v.mul(90), sB2.mul(5)), 3, 2, 0.5).mul(0.1); // (nuages du fil)
    const wood = tint.mul(mix(float(1.08), float(0.8), late).add(fiber).add(figure).sub(pores)).mul(float(1).sub(seam.mul(0.5)));
    const grainW = fiber.mul(6);
    const scratch = smoothstep(0.985, 1.0, sin(p.x.mul(900).add(p.z.mul(310)).add(grainW.mul(40))).mul(0.5).add(0.5)).mul(0.25);
    // marbre : veines fines sur un fond nuageux, le long d'un domaine déformé
    const wq = p.xz.mul(9).add(vec2(mx_fractal_noise_float(vec3(p.xz.mul(5), 1.7), 4, 2, 0.5), mx_fractal_noise_float(vec3(p.xz.mul(5), 4.2), 4, 2, 0.5)).mul(1.1));
    const mn = mx_fractal_noise_float(vec3(wq, 3.1), 5, 2, 0.5);
    const cloud = mx_fractal_noise_float(vec3(p.xz.mul(22), 0.7), 4, 2, 0.55);
    const marble = float(1).sub(smoothstep(0.03, 0.0, abs(mn)).mul(0.28)).sub(smoothstep(0.16, 0.0, abs(mn)).mul(0.08)).add(cloud.mul(0.05));
    const felt = hash(floor(p.xz.mul(9000))).mul(0.12).add(0.94).mul(mx_fractal_noise_float(vec3(p.xz.mul(160), 1.3), 2, 2, 0.5).mul(0.1).add(1));
    const tex = select(tk.lessThan(1.5), wood.add(scratch.mul(tk)), vec3(select(tk.lessThan(2.5), marble, felt)));
    const c = U.table.mul(tex).mul(U.ambient.mul(occ).add(U.keyCol.mul(lam).mul(0.6)));
    const fresT = float(0.04).add(float(0.96).mul(pow(float(1).sub(max(d.y.negate(), 0)), 5)));
    const gloss = select(tk.lessThan(2.5), select(tk.greaterThan(1.5), float(0.6), float(0.3).mul(float(1).sub(seam)).mul(late.mul(0.4).add(0.8))), float(0.0));
    return c.add(env(reflect(d, vec3(0, 1, 0)), U.tableRough).mul(fresT).mul(gloss.mul(occ))).mul(U.room);
  };

  // ── un rayon, à travers les niveaux ──
  const NIT = lite ? 12 : 18, TSTEPS = lite ? 14 : 22;
  // (une fonction JavaScript, appelée dans le Fn du résultat : elle rend aussi
  // le point touché — pour le morphing du raccord)
  const trace = (o0, d0, fs) => {
    const o = vec3(o0).toVar(), d = vec3(d0).toVar();
    const hitP = vec3(0).toVar(), hitLv = float(0).toVar(), hitOk = float(0).toVar();
    // (le rayon à son entrée dans le niveau 1 : point et direction, dans son repère)
    const entP = vec3(0).toVar(), entD = vec3(0, -1, 0).toVar(), entOk = float(0).toVar();
    const thr = vec3(1).toVar(), out = vec3(0).toVar(), firstT = float(BIG).toVar();
    const done = float(0).toVar(), dbg = vec3(1, 0, 1).toVar(), lv = float(0).toVar();
    // une pile de drapeaux, un bit par niveau (le bit 0 : le niveau courant) :
    // le rayon s'est-il réfléchi dans l'argent de ce niveau ? Ressorti de la
    // cavité d'un petit après s'y être réfléchi, il voit la salle — comme s'il
    // sortait du grand : la chaîne reste semblable à elle-même, et le raccord
    // exact pour ces rayons.
    const flags = float(0).toVar();
    const f = U.f, a = float(1).div(f.mul(4)), t = U.shell;
    const cMini = vec3(0, MINI.y + BOUND.y * K, 0);
    Loop({ start: 0, end: NIT }, ({ i }) => {
      If(done.lessThan(0.5), () => {
        const child = lv.greaterThan(0.5);
        const L = select(child, float(0), U.lift);
        // surfaces du niveau : intérieur bas (miroir), extérieur bas, intérieur haut (miroir), extérieur haut
        const tInLo = parab(o, d, a, float(0), float(0), U.rimR).toVar();
        const tOutLo = parab(o, d, a, t.negate(), float(0), U.rimR.add(t)).toVar();
        const tInHi = parab(o, d, a.negate(), f.add(L), U.holeR, U.rimR, true).toVar();
        const tOutHi = parab(o, d, a.negate(), f.add(L).add(t), U.holeR, U.rimR.add(t), true).toVar();
        // la table (niveau 0) ; le pied ; le fond du parent (niveaux > 0)
        const tTab = select(child.not().and(d.y.lessThan(-1e-5)), U.tableY.sub(o.y).div(d.y), float(BIG)).toVar();
        const tFoot = min(cylY(o, d, FOOT.base.r, FOOT.base.y0, FOOT.base.y1), cylY(o, d, FOOT.stem.r, FOOT.stem.y0, FOOT.stem.y1)).toVar(); // (le pied, à chaque niveau)
        const tPar = select(child, parab(o, d, a.mul(K), float(-MINI.y / K), float(0), float(BOUND.r * 1.2)), float(BIG)).toVar();
        const tS = min(min(min(tInLo, tOutLo), min(tInHi, tOutHi)), min(min(tTab, tFoot), tPar)).toVar();
        // les joncs (bornés par ce qu'on a déjà trouvé)
        const bLo = { y: float(BEADS.lo.y), R: BEADS.lo.R, r: BEADS.lo.r }, bHi = { y: L.add(BEADS.hi.y), R: BEADS.hi.R, r: BEADS.hi.r, cut: true }, bLip = { y: L.add(BEADS.lip.y), R: BEADS.lip.R, r: BEADS.lip.r, cut: true };
        const tRim = traceTori(o, d, [bLo, bHi], tS, TSTEPS, 'tr').toVar();
        // la lèvre et la couronne de perles, coupées avec le couvercle
        const yJ = L.add(JEWELS.y);
        const tLip = traceTori(o, d, [bLip, { y: yJ, R: JEWELS.R, r: JEWELS.r, cut: true, pearls: true }], min(tS, tRim), TSTEPS, 'tl').toVar();
        const tBead = min(tRim, tLip).toVar();
        // l'aiguille (cinq pièces) et la couronne de perles (les trois plus
        // proches du point où le rayon traverse leur plan)
        // les tranches de l'entaille (deux demi-plans verticaux par l'axe, dans
        // l'épaisseur du couvercle)
        const face = (e) => {
          const nr = vec3(e.z.negate(), 0, e.x), den = dot(d, nr);
          const tc = dot(o, nr).negate().div(select(abs(den).lessThan(1e-12), float(1e-12), den));
          const q = o.add(d.mul(tc)), r = dot(q.xz, e.xz), r2 = r.mul(r).mul(a);
          const okF = tc.greaterThan(1e-7).and(r.greaterThanEqual(U.holeR)).and(r.lessThanEqual(U.rimR.add(t)))
            .and(q.y.greaterThanEqual(f.add(L).sub(r2))).and(q.y.lessThanEqual(f.add(L).add(t).sub(r2)));
          return select(okF, tc, float(BIG));
        };
        const tF1 = face(U.cutE1).toVar(), tF2 = face(U.cutE2).toVar();
        const tCut = select(U.cutOn.greaterThan(0.5), min(tF1, tF2), float(BIG)).toVar();
        const tN = min(min(tS, tBead), tCut).toVar();
        // le petit : entrée dans sa sphère ; sa propre sphère : la sortie
        const [ci0] = sphere(o, d, cMini, BOUND.r * K);
        const tIn = select(ci0.greaterThan(1e-7), ci0, float(BIG)).toVar();
        const [, co1] = sphere(o, d, vec3(0, BOUND.y, 0), BOUND.r);
        const tOut = select(child, select(co1.greaterThan(0), co1, float(0)), float(BIG)).toVar();
        If(i.equal(0), () => { firstT.assign(min(tN, tIn)); });
        If(tIn.lessThan(tN).and(tIn.lessThan(tOut)), () => {
          // un niveau plus bas
          // (le petit est posé tourné d'un demi-tour : x, z → −x, −z)
          const q = o.add(d.mul(tIn)).sub(vec3(0, MINI.y, 0)).div(K);
          o.assign(vec3(q.x.negate(), q.y, q.z.negate()));
          d.assign(vec3(d.x.negate(), d.y, d.z.negate()));
          flags.assign(flags.mul(2));
          lv.addAssign(1);
          If(lv.equal(1).and(entOk.lessThan(0.5)), () => { entP.assign(o); entD.assign(d); entOk.assign(1); });
        }).ElseIf(tOut.lessThan(tN).and(flags.mod(2).greaterThan(0.5)), () => {
          // ressorti de la cavité du petit : la salle
          out.addAssign(thr.mul(env(d)).mul(U.room));
          dbg.assign(vec3(1, 0, 0));
          done.assign(1);
        }).ElseIf(tOut.lessThan(tN), () => {
          // un niveau plus haut
          const q = o.add(d.mul(tOut)).mul(K);
          o.assign(vec3(q.x.negate(), q.y.add(MINI.y), q.z.negate()));
          d.assign(vec3(d.x.negate(), d.y, d.z.negate()));
          flags.assign(floor(flags.mul(0.5)));
          lv.subAssign(1);
        }).ElseIf(tN.greaterThanEqual(BIG * 0.5), () => {
          // la salle
          out.addAssign(thr.mul(env(d)).mul(U.room));
          dbg.assign(vec3(1, 0, 0));
          done.assign(1);
        }).Else(() => {
          const p = o.add(d.mul(tN)).toVar();
          // (le point touché, s'il n'est pas un miroir : effacé plus bas sinon)
          hitP.assign(p); hitLv.assign(lv); hitOk.assign(1);
          If(tCut.lessThanEqual(tN), () => {
            const e = select(tF1.lessThanEqual(tF2), U.cutE1, U.cutE2), nr = vec3(e.z.negate(), 0, e.x);
            out.addAssign(thr.mul(section(p, select(dot(d, nr).greaterThan(0), nr.negate(), nr), d)));
            dbg.assign(vec3(1, 0.4, 0.3));
            done.assign(1);
          }).ElseIf(tBead.lessThanEqual(tS), () => {
            // jonc : normale depuis le cercle du tore le plus proche
            const isLip = tLip.lessThanEqual(tRim);
            const yc = select(isLip, bLip.y, select(abs(p.y.sub(bLo.y)).lessThan(abs(p.y.sub(bHi.y))), bLo.y, bHi.y));
            const Rm = select(isLip, float(BEADS.lip.R), float(BEADS.lo.R));
            const hz = normalize(p.xz).mul(Rm), cp = vec3(hz.x, yc, hz.y);
            // (lèvre ou perle : la plus proche)
            const isPearl = isLip.and(sdPearls(p, yJ).lessThan(sdTorus(p, bLip.y, BEADS.lip.R, BEADS.lip.r)));
            const n = select(isPearl, normalize(p.sub(jewelC(p, yJ))), normalize(p.sub(cp)));
            // la tranche d'un jonc du couvercle (là où le plan de coupe borde le tore)
            const isHiBead = isLip.or(abs(p.y.sub(bHi.y)).lessThan(abs(p.y.sub(bLo.y))));
            const inner = select(isPearl, sdPearls(p, yJ), sdTorus(p, yc, Rm, float(BEADS.lo.r)));
            const onCap = isHiBead.and(abs(cutTerm(p)).lessThan(4e-5)).and(inner.lessThan(-2e-5));
            const e = select(abs(dot(p.xz, vec2(U.cutE1.z, U.cutE1.x.negate()))).lessThan(abs(dot(p.xz, vec2(U.cutE2.z.negate(), U.cutE2.x)))), U.cutE1, U.cutE2);
            const nr = vec3(e.z.negate(), 0, e.x), nc = select(dot(d, nr).greaterThan(0), nr.negate(), nr);
            out.addAssign(thr.mul(select(onCap, section(p, nc, d), select(isPearl, pearl(p, n, d), polished(p, n, d)))));
            dbg.assign(vec3(1, 1, 1));
            done.assign(1);
          }).ElseIf(tTab.lessThanEqual(tS), () => {
            out.addAssign(thr.mul(tableColor(p, d)));
            dbg.assign(vec3(0, 0, 1));
            done.assign(1);
          }).ElseIf(tFoot.lessThanEqual(tS), () => {
            const onCap = abs(p.y.sub(FOOT.base.y1)).lessThan(1e-5).or(abs(p.y.sub(FOOT.stem.y1)).lessThan(1e-5));
            const n = select(onCap, vec3(0, 1, 0), normalize(vec3(p.x, 0, p.z)));
            out.addAssign(thr.mul(polished(p, n, d)));
            dbg.assign(vec3(1, 0.5, 0));
            done.assign(1);
          }).ElseIf(tOutLo.lessThanEqual(tS).or(tOutHi.lessThanEqual(tS)), () => {
            const lo = tOutLo.lessThanEqual(tOutHi);
            const n = select(lo, nParab(p.sub(vec3(0, t.negate(), 0)), a), nParab(p.sub(vec3(0, f.add(L).add(t), 0)), a.negate()).negate());
            out.addAssign(thr.mul(outerColor(p, n, d, fs.mul(pow(float(1 / K), lv)))));
            dbg.assign(vec3(1, 1, 0));
            done.assign(1);
          }).Else(() => {
            // argent poli de l'intérieur (le sien, ou le fond du parent) : on se réfléchit et on continue
            const n = select(tPar.lessThanEqual(tS), nParab(p.sub(vec3(0, -MINI.y / K, 0)), a.mul(K)),
              select(tInLo.lessThanEqual(tInHi), nParab(p, a), nParab(p.sub(vec3(0, f.add(L), 0)), a.negate()).negate()));
            thr.mulAssign(U.inner);
            hitOk.assign(0);
            // (le fond du parent marque le parent ; sinon, le niveau courant)
            const bit = select(tPar.lessThanEqual(tS), float(2), float(1));
            If(floor(flags.div(bit)).mod(2).lessThan(0.5), () => { flags.addAssign(bit); });
            // (le rayon réfléchi repart un peu devant la paroi, du côté où il va)
            d.assign(reflect(d, n));
            o.assign(p.add(d.mul(2e-5)));
          });
        });
      });
    });
    // (rayon encore piégé après tous les rebonds : on lui donne la salle)
    If(done.lessThan(0.5), () => { out.addAssign(thr.mul(env(d)).mul(U.room)); });
    const shade = pow(float(0.6), lv);
    return { col: mix(out, dbg.mul(shade), U.debug), firstT, hitP, hitLv, hitOk, entP, entD, entOk };
  };
  // (la taille d'un pixel n'est pas le chemin parcouru : l'image est réelle,
  // les miroirs refocalisent — à la visée, un pixel couvre fs, et K fois plus
  // dans le repère du niveau suivant)
  // (pas de setLayout : dans une fonction WGSL à part, les uniformes du
  // matériau n'étaient plus trouvés après une recompilation — le corps est
  // donc écrit deux fois, une par caméra)

  const rayDir = (projInv, world) => {
    const ndc = vec4(screenUV.x.mul(2).sub(1), screenUV.y.oneMinus().mul(2).sub(1), 1, 1);
    const vv = projInv.mul(ndc);
    return normalize(world.mul(vec4(vv.xyz.div(vv.w), 0)).xyz);
  };
  // Le raccord : juste après lui, la caméra (le grand, niveau λ) et la caméra
  // de l'autre niveau (l'image du petit, λ + 1) voient presque la même chose —
  // à la déformation de l'image près. Un morphing l'efface : chaque pixel de la
  // vue du grand vise d'abord le point même que montrait la vue de l'image
  // (son point touché au niveau n ≥ 1, relu au niveau n − 1 — le même point du
  // repère local, un niveau plus haut), puis retrouve peu à peu sa direction
  // (poids altW, de 1 à 0). Les pixels de l'image qui voyaient la salle, ou le
  // grand lui-même, gardent la leur.
  const result = Fn(() => {
    const dB = rayDir(cameraProjectionMatrixInverse, cameraWorldMatrix).toVar();
    If(U.altW.greaterThan(0), () => {
      const A = trace(U.altPos, rayDir(U.altProjInv, U.altWorld), U.altPixFoot);
      // le point que B doit viser, dans son repère (celui du niveau 0) : celui
      // que A montrait, relu un niveau plus haut — le même point du repère
      // local. Au niveau 1, c'est le point touché (B le voit sans miroir) ;
      // plus bas, A voyait une image formée par les miroirs du petit : B doit
      // passer par la même image, au-dessus de l'ouverture — le point de la
      // droite d'entrée de A dans le niveau 1 le plus proche de l'axe, à la
      // hauteur des images (f + h).
      const axisP = vec3(0, IMG_Y, 0), w0 = A.entP.sub(axisP);
      const onLine = A.entP.sub(A.entD.mul(dot(w0, A.entD)));
      const q = select(A.hitLv.lessThan(1.5), A.hitP, onLine);
      const ok = A.hitOk.mul(A.entOk).mul(step(0.5, A.hitLv));
      dB.assign(normalize(mix(dB, normalize(q.sub(cameraPosition)), U.altW.mul(ok))));
    });
    const R = trace(cameraPosition, dB, U.pixFoot);
    return vec4(R.col.mul(U.comp), R.firstT);
  });

  const R = result();
  const material = new THREE.MeshBasicNodeMaterial();
  material.colorNode = vec4(R.rgb, 1);
  // profondeur du premier impact (pour que le mécanisme dessiné ensuite s'emboîte)
  const d0 = rayDir(cameraProjectionMatrixInverse, cameraWorldMatrix);
  const hitW = cameraPosition.add(d0.mul(min(R.w, 50)));
  const clip = cameraProjectionMatrix.mul(cameraViewMatrix.mul(vec4(hitW, 1)));
  material.depthNode = clamp(clip.z.div(clip.w), 0, 1);
  material.depthWrite = true;
  material.depthTest = false;
  material.fog = false;
  material.toneMapped = false;
  if (!lite) material.mrtNode = mrt({ velocity: vec4(0) });
  material.vertexNode = vec4(positionGeometry.xy, 0.5, 1);
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  quad.renderOrder = -10;
  void G;
  return { quad, material, U, T };
}
