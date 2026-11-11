// La scène : une cuve d'eau éclairée d'en haut, vue de côté à travers sa vitre.
//
// - la surface de l'eau vient de waves.js (calcul GPU à chaque image) ;
// - le fond de cuve n'est éclairé QUE par la caustique (caustics.js) : la
//   lumière directe n'y arrive qu'à travers la surface ;
// - la surface se rend par un lancer de rayon analytique : vue d'en haut,
//   reflet du studio et de la source, et le fond vu à travers les vagues ;
//   vue d'en dessous (à travers la vitre), miroir de réflexion totale qui
//   renvoie le fond, et la fenêtre de Snell où brille la source ;
// - le volume d'eau, un peu trouble, diffuse la lumière des coupes : rideaux ;
// - les appareils (cuve, bâti, batteur, excitateur, poteau) sont des pièces à
//   trois finitions, éclairées par la lampe de la scène (ombres).
//
// update(ph) ne dépend que de la recette et de la phase. Toutes les lumières
// sont créées une fois, dans un ordre fixe.
import * as THREE from 'three/webgpu';
import {
  Fn, uniform, vec2, vec3, vec4, float, int, positionWorld, positionGeometry, cameraPosition, normalize, dot, max, min, exp, mix,
  smoothstep, clamp, length, reflect, refract, pow, select, attribute, storage, positionLocal, pmremTexture, hash, abs, fract, floor,
  mrt, fwidth, sin, cos, step, varyingProperty, screenCoordinate, uint, Loop, If,
} from 'three/tsl';
import { createWaves, MAX_MODES } from './waves.js';
import { createCaustics } from './caustics.js';
import { buildPieceMaterial, finishUniforms, noise, noise2, fbm, worley, hash33 } from './materials.js';
import { G } from './globals.js';
import { FINISHES } from '../finishes.js';
import { FLOORS, TANKS, kelvinToHex } from '../recipe.js';
import { foyerClock, faradayState, karmanVortices } from '../timeline.js';
import { flatLanding } from '../gen/lens.js';
import { nWater, ABSORB_RGB } from '../optics.js';

const SHADOW = { mobile: 1024, low: 1024, medium: 2048, high: 2048, ultra: 4096 };
const TAU = Math.PI * 2;
const N_W = nWater(545);

function toGeometry(o, extra = {}) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(o.position, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(o.normal, 3));
  g.setAttribute('tangent', new THREE.BufferAttribute(o.tangent, 4));
  g.setAttribute('surf', new THREE.BufferAttribute(o.surf, 4, true));
  for (const [k, [a, n]] of Object.entries(extra)) g.setAttribute(k, new THREE.BufferAttribute(a, n));
  g.setIndex(new THREE.BufferAttribute(o.index, 1));
  g.computeBoundingSphere();
  return g;
}
const fin3 = (k, wear = 0) => { const F = { ...FINISHES[k], preset: k }; return { outer: F, inner: F, edge: F, wear }; };
const finU = (f) => ({ outer: finishUniforms(f.outer), inner: finishUniforms(f.inner), edge: finishUniforms(f.edge), wear: uniform(f.wear) });
const col = (hex) => new THREE.Color(hex);

// Réseaux de Faraday : directions des ondes planes stationnaires
const LATTICE = { square: 2, hex: 3, quasi8: 4, quasi10: 5, quasi12: 6 };
function latticeModes(kind, k, angle, amp) {
  const n = LATTICE[kind];
  const w = amp / Math.sqrt(n);
  return Array.from({ length: n }, (_, i) => { const a = angle + (i * Math.PI) / n; return [k * Math.cos(a), k * Math.sin(a), 0, w / amp]; });
}

export function createStage(scene, gen, { lite = false, renderer } = {}) {
  const N = lite ? 512 : 1024;
  const waves = createWaves(renderer, { N, L: 1.2, H: 0.45 });
  const field = storage(waves.fieldAttr, 'vec4', N * N).toReadOnly();

  // ── Lumière : une seule source à ombres (soleil lointain ou lampe), fixe ──
  const key = new THREE.SpotLight(0xffffff, 1, 0, 0.3, 0.4, 0);
  key.castShadow = true;
  key.shadow.bias = -0.0002;
  key.shadow.normalBias = 0.004;
  key.shadow.radius = 4;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 0.1; key.shadow.camera.far = 12;
  scene.add(key); scene.add(key.target);

  // ── Uniformes de la scène ──
  const U = {
    lux: uniform(3), sunCol: uniform(new THREE.Color(1, 1, 1)), amb: uniform(0.3), ambCol: uniform(new THREE.Color(0.8, 0.9, 1)),
    sunDir: uniform(new THREE.Vector3(0, -1, 0)), lampPos: uniform(new THREE.Vector3(0, 1, 0)), lampMode: uniform(0),
    sigma: uniform(0.1), extinct: uniform(new THREE.Vector3(0.3, 0.06, 0.02)),
    floorA: uniform(new THREE.Color(1, 1, 1)), floorB: uniform(new THREE.Color(0.8, 0.8, 0.8)),
    wallC: uniform(new THREE.Color(0.2, 0.2, 0.2)), floorMean: uniform(1),
    bg0: uniform(new THREE.Color(0, 0, 0)), bg1: uniform(new THREE.Color(0, 0, 0)),
    W: uniform(0.6), D: uniform(0.6), H: uniform(0.45), rim: uniform(0.05),
    gain: uniform(1.6), angular: uniform(0.005), glint: uniform(1), envRefl: uniform(1),
  };

  // ── Fond (cyclorama sombre ou clair, en dégradé) ──
  const backdrop = new THREE.Mesh(new THREE.SphereGeometry(14, 48, 24), new THREE.MeshBasicNodeMaterial({ side: THREE.BackSide }));
  backdrop.material.fog = false;
  backdrop.material.colorNode = Fn(() => {
    const d = normalize(positionLocal);
    const t = smoothstep(-0.25, 0.7, d.y);
    // une lueur douce derrière la cuve (à l'opposé de la caméra) : fond « clair »
    const glow = smoothstep(0.2, 1, dot(d, vec3(0, 0.15, -1).normalize()).max(0)).mul(0.35);
    return vec4(mix(U.bg1, U.bg0, t).mul(glow.add(1)), 1);
  })();
  scene.add(backdrop);

  const group = new THREE.Group();
  scene.add(group);
  let R = null, version = 0, pending = 0, total = 1;
  let caustics = null, clock = null, env = null;
  let meshes = [];
  const progressCb = { fn: null };

  // ── Fonctions de rendu partagées (dépendent de la recette : construites
  //    avec les matériaux, recompilées à chaque scène) ──
  function shaders() {
    const T = R.tank, fl = FLOORS[T.floor];
    const W = T.W, D = T.D, H = T.H;
    // albédo du fond de cuve (x, z en m) : le grain à l'échelle du sujet
    // (fw : empreinte du pixel sur le fond, en m — donnée par l'appelant : les
    // dérivées écran ne valent rien le long d'un rayon réfracté ni dans une branche)
    const albedo = Fn(([xz, fw]) => {
      const p3 = vec3(xz.x, 0, xz.y);
      const aa = (f) => smoothstep(0.45, 0.12, fw.mul(f)); // motif de fréquence f (1/m) estompé avant le pixel
      let a = vec3(U.floorA);
      switch (T.floor) {
        case 'sand': {
          const n = fbm(p3.mul(18), 3).mul(0.5).add(0.5);
          const w = worley(p3.mul(1400));
          const grain = smoothstep(0.55, 0.15, w.x).mul(aa(1400));
          const dark = step(0.86, hash33(floor(p3.mul(1400))).x).mul(grain);
          a = mix(U.floorA, U.floorB, n.mul(0.6)).mul(grain.mul(0.12).add(0.94)).mul(float(1).sub(dark.mul(0.35)));
          break;
        }
        case 'plaster': {
          const n = fbm(p3.mul(14), 4).mul(0.5).add(0.5);
          const t = noise2(vec3(xz.x.mul(40), xz.y.mul(9), 0)).mul(0.5).add(0.5);
          const pore = smoothstep(0.08, 0.02, worley(p3.mul(700)).x).mul(aa(700));
          a = mix(U.floorA, U.floorB, n.mul(0.5).add(t.mul(0.25))).mul(float(1).sub(pore.mul(0.25)));
          break;
        }
        case 'tiles': {
          const ts = 0.03, g = 0.0018;
          const q = xz.div(ts), c = floor(q), f = fract(q);
          const e = min(min(f.x, float(1).sub(f.x)), min(f.y, float(1).sub(f.y))).mul(ts);
          const grout = smoothstep(g * 0.9, g * 0.4, e);
          const hv = hash33(vec3(c, 1.7)).x;
          const glaze = fbm(p3.mul(90), 2).mul(0.04);
          const tile = mix(U.floorA, U.floorA.mul(0.9), hv.mul(0.6)).add(glaze);
          a = mix(tile, U.floorB.mul(0.75), grout);
          break;
        }
        case 'travertine': {
          const n = fbm(p3.mul(9), 4);
          const band = sin(xz.y.mul(55).add(n.mul(5))).mul(0.5).add(0.5);
          const pores = smoothstep(0.16, 0.05, worley(vec3(xz.x.mul(260), xz.y.mul(520), 0)).x).mul(aa(520));
          a = mix(U.floorA, U.floorB, band.mul(0.45).add(n.mul(0.2))).mul(float(1).sub(pores.mul(0.4)));
          break;
        }
        case 'slate': {
          const n = fbm(vec3(xz.x.mul(6), xz.y.mul(30), 0), 4).mul(0.5).add(0.5);
          const mica = smoothstep(0.1, 0.02, worley(p3.mul(900)).x).mul(aa(900)).mul(step(0.7, hash33(floor(p3.mul(900))).y));
          a = mix(U.floorB, U.floorA, n).add(vec3(mica.mul(0.5)));
          break;
        }
        case 'enamel': {
          const n = fbm(p3.mul(220), 2).mul(0.012);
          a = vec3(U.floorA).add(n);
          break;
        }
        case 'paper': {
          const fib = noise(vec3(xz.x.mul(300), xz.y.mul(1300), 0)).mul(0.5).add(0.5);
          a = mix(U.floorA, U.floorB, fib.mul(0.3).mul(aa(1300)).add(fbm(p3.mul(25), 3).mul(0.08)));
          break;
        }
        default: break;
      }
      return a;
    });
    // transmission de l'eau sur un trajet de longueur l
    const trans = (l) => exp(U.extinct.mul(l).negate());
    // longueur du trajet du regard dans l'eau, de la caméra au point P (dans la cuve)
    const viewLen = (P) => {
      const C = cameraPosition, d = P.sub(C);
      const ty = select(C.y.greaterThan(0), C.y.negate().div(d.y.min(-1e-6)), float(0));
      const tz = select(C.z.greaterThan(D / 2), float(D / 2).sub(C.z).div(d.z.min(-1e-6)), float(0));
      const tin = clamp(max(ty, tz), 0, 1);
      return length(d).mul(float(1).sub(tin));
    };
    // éclairement du fond par la caustique (relatif) × lumière de la source
    const lightAt = (xz) => caustics.floorAt(xz).mul(U.lux).mul(U.sunCol);
    // radiance du fond en (x, z)
    const floorRadWith = (light, plain = false) => Fn(([xz, fw]) => {
      const a = plain ? vec3(U.floorA) : albedo(xz, fw);
      // les coins reçoivent moins de ciel
      const e = min(min(float(W / 2).sub(abs(xz.x)), float(D / 2).sub(abs(xz.y))), 0.2);
      const ao = smoothstep(-0.005, 0.08, e).mul(0.6).add(0.4);
      return a.mul(light(xz).div(Math.PI).add(U.ambCol.mul(U.amb).mul(ao)));
    });
    const floorRad = floorRadWith(lightAt);
    // vu à travers les vagues : la dernière coupe (même lumière, plus douce) —
    // la caustique fine, lue à des points qui sautent d'un pixel à l'autre,
    // fourmillerait
    const floorRadSoft = floorRadWith((xz) => caustics.sliceAt(vec3(xz.x, -H + 1e-4, xz.y)).mul(U.lux).mul(U.sunCol), true);
    // albédo d'une paroi intérieure (selon la cuve) au point p
    const wallAlbedo = Fn(([p]) => {
      const q = vec3(p.x.add(p.z), p.y, 0);
      let a = vec3(U.wallC);
      switch (T.style) {
        case 'stone': { // moellons de travertin à joints
          const bw = 0.12, bh = 0.06;
          const row = floor(p.y.div(bh)), u = p.x.add(p.z).div(bw).add(row.mul(0.5));
          const f = vec2(fract(u), fract(p.y.div(bh)));
          const e = min(min(f.x, float(1).sub(f.x)).mul(bw), min(f.y, float(1).sub(f.y)).mul(bh));
          const joint = smoothstep(0.003, 0.0012, e);
          const n = fbm(q.mul(14), 3).mul(0.5).add(0.5);
          const hv = hash33(vec3(floor(u), row, 3.1)).x;
          a = mix(U.wallC.mul(n.mul(0.25).add(0.85)).mul(hv.mul(0.12).add(0.94)), U.wallC.mul(0.55), joint);
          break;
        }
        case 'brass': { // ardoise verte
          const n = fbm(vec3(q.x.mul(6), q.y.mul(26), 0), 3).mul(0.5).add(0.5);
          a = U.wallC.mul(n.mul(0.4).add(0.8));
          break;
        }
        case 'steel': { // tôle peinte, mate
          a = U.wallC.mul(fbm(q.mul(20), 2).mul(0.12).add(1));
          break;
        }
        default: { // émail
          a = vec3(U.wallC).add(fbm(q.mul(160), 2).mul(0.01));
        }
      }
      return a;
    });
    // radiance d'une paroi intérieure au point p (y < 0 sous l'eau)
    // - rebond : le fond éclairé est une grande source diffuse ; on lit sa
    //   vraie lumière (dernière coupe : la caustique au fond, adoucie) en cinq
    //   points devant la paroi, à des distances proportionnelles à la hauteur
    //   du point au-dessus du fond (facteur de forme d'un sol vu par un mur :
    //   au plus la moitié de l'hémisphère) — le bas de la paroi s'allume face
    //   à la tache de soleil, pas face à l'ombre ;
    // - caustique : la lumière réfractée qui frappe la paroi de biais ;
    //   éclairement sur la paroi = éclairement horizontal de la coupe à cette
    //   profondeur × |t·n| / |t_y| (t : direction du rayon dans l'eau) ;
    // - studio à travers la surface.
    const floorLightAt = (x, z) => caustics.floorSoftAt(x, z);
    const wallRadWith = (plain) => Fn(([p]) => {
      const hgt = p.y.add(H).max(0.004);
      // normale de la paroi (vers l'intérieur) et tangente horizontale
      const side = abs(p.x).greaterThan(float(W / 2 - 0.002));
      const nw = select(side, vec3(p.x.sign().negate(), 0, 0), vec3(0, 0, 1));
      const tg = vec3(nw.z, 0, nw.x.negate());
      const smp = (d, l, w) => {
        const q = p.add(nw.mul(hgt.mul(d))).add(tg.mul(hgt.mul(l)));
        const qx = clamp(q.x, -W / 2 + 0.005, W / 2 - 0.005), qz = clamp(q.z, -D / 2 + 0.005, D / 2 - 0.005);
        return floorLightAt(qx, qz).mul(w);
      };
      const Ef = smp(0.35, 0, 0.3).add(smp(0.9, 0, 0.25)).add(smp(1.8, 0, 0.15)).add(smp(0.9, 0.9, 0.15)).add(smp(0.9, -0.9, 0.15));
      const bounce = U.floorA.mul(Ef).mul(U.lux).mul(U.sunCol).mul(0.5);  // (Ef : vec3)
      // la lumière directe, réfractée, qui frappe la paroi
      const Lw = normalize(mix(U.sunDir, p.sub(U.lampPos), U.lampMode));
      const tw = vec3(Lw.x.div(N_W), Lw.y, Lw.z.div(N_W)).normalize();
      const graze = max(dot(tw, nw).negate(), 0).div(max(tw.y.negate(), 0.15));
      const caus = caustics.sliceAt(p).mul(graze).mul(U.lux).mul(U.sunCol);
      const E = bounce.add(caus).add(U.ambCol.mul(U.amb).mul(0.7));
      return (plain ? vec3(U.wallC) : wallAlbedo(p)).mul(E).div(Math.PI);
    });
    const wallRad = wallRadWith(false);
    // (vue à travers les vagues : paroi unie, son motif fourmillerait)
    const wallRadSoft = wallRadWith(true);
    // un rayon qui part de Q (dans l'eau) dans la direction d (vers le bas ou
    // de côté) : le fond, ou une paroi ; renvoie la radiance au départ du rayon
    const traceDown = Fn(([Q, d]) => {
      const big = float(1e3);
      const tf = select(d.y.lessThan(-1e-5), float(-H).sub(Q.y).div(d.y), big);
      const tx = select(abs(d.x).greaterThan(1e-5), float(W / 2).mul(d.x.sign()).sub(Q.x).div(d.x), big);
      const tb = select(d.z.lessThan(-1e-5), float(-D / 2).sub(Q.z).div(d.z), big);
      const tw = min(tx, tb);
      const t = min(tf, tw);
      const P = Q.add(d.mul(t));
      // (vu à travers les vagues : empreinte large ; fond et paroi fondus sur
      // un centimètre autour de leur arête, qui sinon fourmille)
      const Pf = Q.add(d.mul(tf)), Pw = Q.add(d.mul(tw));
      const kf = smoothstep(-0.01, 0.01, tw.sub(tf).mul(d.length()));
      const rad = mix(wallRadSoft(Pw), floorRadSoft(Pf.xz, float(0.004).add(t.mul(0.004))), kf);
      return rad.mul(trans(t));
    });
    return { albedo, floorRad, wallRad, wallAlbedo, traceDown, trans, viewLen, lightAt };
  }

  // ── Matériaux ──
  // (les matériaux faits main calculent toute leur lumière : ils écrivent leur
  // sortie directement — outputNode —, sans modèle d'éclairage ni occlusion
  // ambiante d'écran, qui assombrirait au hasard la surface vue en rasance)
  // le fond de cuve
  function floorMaterial(S) {
    const m = new THREE.MeshBasicNodeMaterial();
    m.outputNode = Fn(() => {
      const P = positionWorld;
      const fw = fwidth(P.x).add(fwidth(P.z)).max(1e-6);
      return vec4(S.floorRad(P.xz, fw).mul(S.trans(S.viewLen(P))), 1);
    })();
    m.mrtNode = mrt({ velocity: vec4(0) });
    return m;
  }
  // les parois intérieures
  function wallMaterial(S) {
    const m = new THREE.MeshBasicNodeMaterial();
    m.outputNode = Fn(() => {
      const P = positionWorld;
      const under = S.wallRad(P).mul(S.trans(S.viewLen(P)));
      // au-dessus de l'eau : la lampe et le studio
      const over = S.wallAlbedo(P).mul(U.lux.mul(0.35).add(U.amb)).div(Math.PI);
      return vec4(select(P.y.lessThan(0), under, over), 1);
    })();
    m.mrtNode = mrt({ velocity: vec4(0) });
    return m;
  }
  // la surface de l'eau (grille de la cuve, un point sur deux de la grille des ondes)
  function surfaceMaterial(S) {
    const m = new THREE.MeshBasicNodeMaterial({ side: THREE.DoubleSide });
    const vS = varyingProperty('vec2', 'vSlope');
    const L = R.tank.L, dx = L / N;
    m.positionNode = Fn(() => {
      const I = int(positionGeometry.x), J = int(positionGeometry.y);
      const f = field.element(J.mul(N).add(I));
      // pentes moyennées sur 5 × 5 cellules (6 mm) : les rides capillaires de
      // quelques millimètres, plus fines que le pixel, fourmilleraient dans
      // les reflets et dans le fond vu au travers (la caustique garde tout)
      const acc = vec3(0).toVar();
      for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
        const w = Math.exp(-(di * di + dj * dj) / 4);
        acc.addAssign(field.element(J.add(dj).mul(N).add(I.add(di))).xyz.mul(w));
      }
      let wsum = 0;
      for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) wsum += Math.exp(-(di * di + dj * dj) / 4);
      const fs = acc.div(wsum);
      vS.assign(fs.yz);
      // (la hauteur aussi : des triangles plus petits que le pixel, déplacés de
      // quelques millimètres, scintilleraient en rasance sous la gigue du TRAA)
      return vec3(positionGeometry.x.add(0.5).mul(dx).sub(L / 2), fs.x, positionGeometry.y.add(0.5).mul(dx).sub(L / 2));
    })();
    const envTex = scene.environment;
    m.outputNode = Fn(() => {
      const P = positionWorld, C = cameraPosition;
      const V = normalize(P.sub(C));
      // niveau de détail des normales : là où les rides varient plus vite que
      // le pixel (surface lointaine, en rasance), leur pente moyenne tend vers
      // zéro — sinon le fond et les parois vus au travers fourmillent
      const lod = float(1).div(length(fwidth(vS)).mul(20).add(1));
      const n = normalize(vec3(vS.x.negate().mul(lod), 1, vS.y.negate().mul(lod)));
      const L2s = normalize(mix(U.sunDir.negate(), U.lampPos.sub(P), U.lampMode));
      // largeur du reflet de la source : sa taille angulaire, élargie par la
      // variation de la normale dans le pixel (dérivées hors des branches) ;
      // énergie conservée (pic E/(π s²))
      const sw = U.angular.mul(2).add(length(fwidth(n)).mul(1.5)).max(0.02);
      const lobe = (dir) => exp(dot(dir, L2s).sub(1).div(sw.mul(sw))).div(sw.mul(sw).mul(Math.PI)).mul(U.lux).mul(U.sunCol).mul(U.glint.mul(0.6));
      const out = vec3(0).toVar();
      If(C.y.greaterThan(P.y), () => {
        // vue d'en haut
        const c = dot(V.negate(), n).clamp(0, 1);
        const F = float(0.02).add(float(0.98).mul(pow(float(1).sub(c), 5)));
        const r = reflect(V, n);
        const sky = envTex ? pmremTexture(envTex, r, float(0.02)).rgb.mul(G.envI).mul(U.envRefl) : vec3(0.1);
        const glint = lobe(r);
        const t = refract(V, n, 1 / N_W);
        const below = S.traceDown(P, t);
        out.assign(sky.add(glint).mul(F).add(below.mul(float(1).sub(F))));
      }).Else(() => {
        // vue d'en dessous : réflexion totale au-delà de 48,6°
        const nd = n.negate();
        const c = dot(V.negate(), nd).clamp(0, 1);
        const s2 = float(1).sub(c.mul(c)).mul(N_W * N_W);
        const tir = s2.greaterThan(1);
        const ct = float(1).sub(s2).max(0).sqrt();
        const rs = c.mul(N_W).sub(ct).div(c.mul(N_W).add(ct)), rp = ct.mul(N_W).sub(c).div(ct.mul(N_W).add(c));
        const F = select(tir, float(1), rs.mul(rs).add(rp.mul(rp)).mul(0.5));
        const r = reflect(V, nd);
        const refl = S.traceDown(P, r);
        const t = refract(V, nd, N_W);
        const sky = envTex ? pmremTexture(envTex, t, float(0.05)).rgb.mul(G.envI) : vec3(0.1);
        const sun = lobe(t);
        out.assign(refl.mul(F).add(sky.add(sun).mul(float(1).sub(F))));
      });
      return vec4(out, 1);
    })();
    m.mrtNode = mrt({ velocity: vec4(0) });
    return m;
  }
  // le volume d'eau (face avant, derrière la vitre) : diffusion simple de la
  // lumière des coupes, marche de 24 pas avec un décalage tramé (TRAA)
  function volumeMaterial() {
    const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
    m.blending = THREE.CustomBlending;
    m.blendEquation = THREE.AddEquation; m.blendSrc = THREE.OneFactor; m.blendDst = THREE.OneFactor;
    m.blendEquationAlpha = THREE.AddEquation; m.blendSrcAlpha = THREE.ZeroFactor; m.blendDstAlpha = THREE.OneFactor;
    const T = R.tank, W = T.W, D = T.D, H = T.H;
    const steps = lite ? 12 : 24;
    m.outputNode = Fn(() => {
      const E = positionWorld, C = cameraPosition;
      const d = normalize(E.sub(C));
      const big = float(1e3);
      const tf = select(d.y.lessThan(-1e-5), float(-H).sub(E.y).div(d.y), big);
      const ts = select(d.y.greaterThan(1e-5), E.y.negate().div(d.y), big);
      const tx = select(abs(d.x).greaterThan(1e-5), float(W / 2).mul(d.x.sign()).sub(E.x).div(d.x), big);
      const tb = select(d.z.lessThan(-1e-5), float(-D / 2).sub(E.z).div(d.z), big);
      const tEnd = min(min(tf, ts), min(tx, tb)).max(0);
      const ds = tEnd.div(steps);
      const j = hash(screenCoordinate.x.toUint().add(screenCoordinate.y.toUint().mul(uint(7919))).add(G.frame.toUint().mul(uint(104729))));
      const acc = vec3(0).toVar();
      Loop(steps, ({ i }) => {
        const s = float(i).add(j).mul(ds);
        const p = E.add(d.mul(s));
        const Ld = normalize(mix(U.sunDir.negate(), U.lampPos.sub(p), U.lampMode));
        // fonction de phase de Henyey-Greenstein (g = 0,45 : vers l'avant)
        const cth = dot(d.negate(), Ld);
        const g = 0.45, ph = float((1 - g * g) / (4 * Math.PI)).div(pow(float(1 + g * g).sub(cth.mul(2 * g)), 1.5));
        const Ein = caustics.sliceAt(p);
        acc.addAssign(vec3(Ein).mul(ph).mul(exp(U.extinct.mul(s).negate())));
      });
      const L = acc.mul(ds).mul(U.sigma).mul(U.lux).mul(U.sunCol).mul(4);
      return vec4(L, 0);
    })();
    m.mrtNode = mrt({ velocity: vec4(0) });
    return m;
  }
  // la vitre : reflets du studio pondérés par Fresnel, chants verts
  function glassMaterial() {
    const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
    const envTex = scene.environment;
    m.outputNode = Fn(() => {
      const V = normalize(positionWorld.sub(cameraPosition));
      const nrm = normalize(attribute('normal', 'vec3'));
      const c = dot(V.negate(), nrm).abs().clamp(0, 1);
      const F = float(0.04).add(float(0.96).mul(pow(float(1).sub(c), 5)));
      const edge = attribute('surf', 'vec4').z;
      const r = reflect(V, nrm);
      const sky = envTex ? pmremTexture(envTex, r, float(0.03)).rgb.mul(G.envI) : vec3(0.1);
      const green = vec3(0.12, 0.2, 0.17).mul(U.lux.mul(0.15).add(U.amb));
      const a = mix(F.mul(0.9), float(0.85), edge);
      return vec4(mix(sky, green, edge).mul(a), a);
    })();
    m.premultipliedAlpha = true;
    m.blending = THREE.CustomBlending;
    m.blendEquation = THREE.AddEquation; m.blendSrc = THREE.OneFactor; m.blendDst = THREE.OneMinusSrcAlphaFactor;
    m.mrtNode = mrt({ velocity: vec4(0) });
    return m;
  }
  // une pièce d'appareil (trois finitions), éventuellement animée
  function pieceMaterial(f, rig = null) {
    const Mu = { seedOff: uniform(new THREE.Vector3(3.1, 1.7, 0.4)) };
    if (rig) Mu.rig = rig;
    return buildPieceMaterial(f, finU(f), Mu);
  }
  // plongeurs : chaque sommet suit la hauteur de l'eau sous son coin
  function plungerRig() {
    return (full) => Fn(() => {
      const foot = attribute('foot', 'float');
      const f = field.element(int(foot));
      return positionLocal.add(vec3(0, f.x.mul(U.gain).mul(10), 0));
    })();
  }

  function clear() {
    for (const m of meshes) { group.remove(m); m.geometry.dispose(); m.material?.dispose?.(); }
    meshes = [];
  }

  function surfaceGrid(T) {
    const L = T.L, dx = L / N, step = lite ? 2 : 2;
    const i0 = Math.round((L / 2 - T.W / 2) / dx), nI = Math.round(T.W / dx);
    const j0 = Math.round((L / 2 - T.D / 2) / dx), nJ = Math.round(T.D / dx);
    const nx = Math.floor((nI - 1) / step) + 1, nz = Math.floor((nJ - 1) / step) + 1;
    const pos = new Float32Array(nx * nz * 3);
    for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const k = (j * nx + i) * 3; pos[k] = i0 + i * step; pos[k + 1] = j0 + j * step; }
    const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
    let p = 0;
    for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
      const a = j * nx + i, b = a + 1, c = a + nx, d = c + 1;
      idx[p++] = a; idx[p++] = b; idx[p++] = c; idx[p++] = b; idx[p++] = d; idx[p++] = c;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 2);
    return g;
  }

  function setRecipe(recipe) {
    R = recipe;
    const v = ++version;
    clear();
    caustics?.dispose();
    const T = R.tank;
    waves.L = T.L; waves.H = T.H;
    caustics = createCaustics(renderer, waves, { W: T.W, D: T.D, rim: T.rim, slices: lite ? 4 : 8, res: lite ? 512 : 1024, lite });
    clock = R.family === 'foyer' ? foyerClock(R) : null;
    U.W.value = T.W; U.D.value = T.D; U.H.value = T.H; U.rim.value = T.rim;
    const jobs = [];
    // spectres des dessins (transport optimal, dans les workers)
    if (R.family === 'foyer') {
      const light = R.light;
      // la lentille et son dessin, symétriques de part et d'autre du centre
      const L0 = flatLanding(light, [0, 0, 0], T.H, N_W);
      const imageCenter = [L0[0] / 2, L0[2] / 2];
      const side = Math.min(R.foyer.side, T.W - 2 * Math.max(Math.abs(L0[0]), Math.abs(L0[2])) * 0.5 - 0.04);
      waves.setEventCount(R.foyer.events.length);
      R.foyer.events.forEach((e, j) => {
        jobs.push(gen.request({ index: j, series: R.foyer.series, level: e.level, seed: R.seed, N, L: T.L, H: T.H, light, side, imageCenter, rotation: e.rotation }, 'event', {
          noCache: true,
          onProgress: (p) => progressCb.fn?.(p),
        }).then((o) => { if (v === version) { waves.setEvent(j, o.inter); progressCb.done?.(j, o); } return o; }));
      });
    } else waves.setEventCount(0);
    jobs.push(gen.request({ seed: R.seed, N, L: T.L, k0: R.water.ambientK, spread: R.water.ambientSpread, dir: R.water.ambientDir }, 'ambient', { noCache: true })
      .then((o) => { if (v === version) waves.setAmbient(o.inter); }));
    jobs.push(gen.request({ family: R.family, W: T.W, D: T.D, H: T.H, rim: T.rim, style: T.style, N, L: T.L, plungers: R.foyer?.plungers ?? 0, karman: R.karman ?? null }, 'apparatus')
      .then((o) => { if (v === version) build(o); }));
    total = jobs.length; pending = total;
    for (const j of jobs) j.then(() => { if (v === version) pending--; }, (e) => { console.error(e); if (v === version) pending--; });
  }

  // construction des maillages, une fois la géométrie arrivée
  function build(o) {
    const T = R.tank, ts = TANKS[T.style];
    const S = shaders();
    const add = (mesh, { shadow = true, receive = true } = {}) => { mesh.castShadow = shadow; mesh.receiveShadow = receive; group.add(mesh); meshes.push(mesh); return mesh; };
    const piece = (geo, f, rig = null, extra = {}) => {
      const m = new THREE.Mesh(toGeometry(geo, extra), pieceMaterial(f, rig));
      m.scale.setScalar(0.1);
      return add(m);
    };
    const shellFin = T.style === 'stone' ? fin3('bisque') : T.style === 'enamel' ? fin3('whiteCeramic') : fin3('carbonMatte');
    piece(o.shell, shellFin);
    piece(o.frame, fin3(ts.frame, T.style === 'brass' ? 0.1 : 0));
    if (o.rig.position.length) piece(o.rig, T.style === 'stone' ? fin3('bronzeDark') : fin3('blackenedSteel'));
    if (o.extra.position.length) piece(o.extra, R.family === 'karman' ? fin3('chrome') : fin3('brushedSteel'));
    if (o.movers) piece(o.movers, fin3(T.style === 'brass' ? 'polishedBrass' : 'brushedSteel'), plungerRig(), { foot: [o.movers.foot, 1] });
    // parois intérieures
    const inner = new THREE.Mesh(toGeometry(o.inner), wallMaterial(S));
    inner.scale.setScalar(0.1);
    add(inner, { shadow: false });
    // fond
    const fg = new THREE.PlaneGeometry(T.W, T.D, 1, 1).rotateX(-Math.PI / 2);
    const floor = new THREE.Mesh(fg, floorMaterial(S));
    floor.position.y = -T.H;
    add(floor, { shadow: false });
    // surface
    const surf = new THREE.Mesh(surfaceGrid(T), surfaceMaterial(S));
    surf.frustumCulled = false;
    add(surf, { shadow: false, receive: false });
    // volume (face avant, juste derrière la vitre)
    const vg = new THREE.PlaneGeometry(T.W, T.H, 1, 1);
    const vol = new THREE.Mesh(vg, volumeMaterial());
    vol.position.set(0, -T.H / 2, T.D / 2 - 0.0005);
    vol.renderOrder = 1;
    add(vol, { shadow: false, receive: false });
    // vitre
    const gl = new THREE.Mesh(toGeometry(o.glass), glassMaterial());
    gl.scale.setScalar(0.1);
    gl.renderOrder = 2;
    add(gl, { shadow: false, receive: false });
    // dosage : éclairement moyen du fond (pour le rebond sur les parois)
    U.floorMean.value = 0.9;
  }

  // ── Mise à jour d'une image ──
  function update(ph) {
    if (!R || !caustics) return;
    const T = R.tank, Li = R.light;
    // lumière
    const sun = Li.kind === 'sun';
    U.lampMode.value = sun ? 0 : 1;
    if (sun) U.sunDir.value.set(...Li.dir).normalize(); else U.lampPos.value.set(...Li.pos);
    U.lux.value = Li.lux;
    U.sunCol.value.set(kelvinToHex(Li.K));
    if (sun) {
      const d = U.sunDir.value;
      key.position.set(-d.x * 6, -d.y * 6, -d.z * 6);
      key.decay = 0; key.angle = 0.16; key.penumbra = 0.3;
      key.intensity = Li.lux / Math.max(0.1, -d.y);
    } else {
      key.position.set(...Li.pos);
      key.decay = 2; key.angle = 1.0; key.penumbra = 0.6;
      key.intensity = Li.lux * Li.pos[1] * Li.pos[1];
    }
    key.target.position.set(0, -T.H * 0.5, 0);
    key.color.copy(U.sunCol.value);
    // fond, eau
    U.bg0.value.set(R.bg[0]); U.bg1.value.set(R.bg[1]);
    U.floorA.value.set(FLOORS[T.floor].albedo); U.floorB.value.set(FLOORS[T.floor].albedo2);
    U.wallC.value.set(TANKS[T.style].wall);
    U.amb.value = R.env.intensity * 0.6;
    const tint = R.water.tint;
    U.sigma.value = R.water.turbid;
    U.extinct.value.set(ABSORB_RGB[0] / tint[0] + R.water.turbid, ABSORB_RGB[1] / tint[1] + R.water.turbid, ABSORB_RGB[2] / tint[2] + R.water.turbid);
    caustics.setLight(Li, Li.angular);
    U.angular.value = Li.angular;

    // les ondes
    const s = { family: 0, events: [], tAmb: 0, ambAmp: R.water.ambient, dOmega: 1 };
    if (R.family === 'foyer') {
      s.events = clock.events(ph);
      s.tAmb = clock.phys(ph); s.dOmega = TAU / clock.total;
    } else {
      const Tp = R.loop.duration * 0.5; // (temps physique : la ride va à demi-vitesse)
      s.tAmb = ph * Tp; s.dOmega = TAU / Tp;
    }
    if (R.family === 'faraday') {
      const F = R.faraday, st = faradayState(R, ph);
      s.family = 1;
      s.faraday = {
        amp: F.amp * st.drive, osc: st.beat,
        modes1: latticeModes(F.first, F.k, F.angle, 1), modes2: latticeModes(F.second, F.k, F.angle + 0.3, 1),
        front1: [0, 0, st.r1, 0.03], front2: [F.origin2[0], F.origin2[1], st.r2, 0.035],
      };
    } else if (R.family === 'karman') {
      s.family = 2;
      s.karman = { vortices: karmanVortices(R, ph) };
      caustics.U.post.value.set(R.karman.post[0], R.karman.post[1], R.karman.radius, 1);
    }
    if (R.family !== 'karman') caustics.U.post.value.set(0, 0, 0, 0);
    U.gain.value = R.foyer?.gain ?? 0;
    waves.update(s);
    caustics.render();
  }

  function setShadowQuality(q) {
    const s = SHADOW[q] ?? 2048;
    if (key.shadow.mapSize.x !== s) { key.shadow.mapSize.set(s, s); key.shadow.map?.dispose(); key.shadow.map = null; }
  }

  return {
    setRecipe, update, setShadowQuality, group, key, waves, U,
    get caustics() { return caustics; },
    syncFinishes() {},
    onProgress(fn, done) { progressCb.fn = fn; progressCb.done = done; },
    ready: () => pending === 0,
    progress: () => (total ? 1 - pending / total : 1),
  };
}
