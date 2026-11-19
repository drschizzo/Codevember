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
  smoothstep, clamp, length, reflect, refract, pow, select, bumpMap, attribute, storage, positionLocal, pmremTexture, hash, abs, fract, floor,
  mrt, fwidth, sin, cos, step, varyingProperty, screenCoordinate, uint, Loop, If, instancedBufferAttribute, uv,
} from 'three/tsl';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { createWaves, MAX_MODES } from './waves.js';
import { createCaustics } from './caustics.js';
import { buildPieceMaterial, finishUniforms, noise, noise2, fbm, worley, hash33 } from './materials.js';
import { G } from './globals.js';
import { FINISHES } from '../finishes.js';
import { FLOORS, TANKS, STONES, kelvinToHex } from '../recipe.js';
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
  // (la flamme d'une lanterne : créée une fois, éteinte quand la scène n'en a pas)
  const candle = new THREE.PointLight(0xffa860, 0, 2.5, 2);
  scene.add(candle);

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
    shaft: uniform(0), // rayons dans l'eau : diffusion vers l'œil, par mètre de trajet
    shadeOn: uniform(0), shadeDir: uniform(new THREE.Vector2(1, 0)), // l'ombre d'un feuillage hors champ, et de quel côté il est
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

  // ── L'ombre d'un feuillage hors champ ──
  // Un arbre qu'on ne voit pas découpe le soleil. Le point est remonté le long du rayon jusqu'à la hauteur des
  // branches ; là, un bruit à deux échelles fait les masses de feuilles et leurs trouées. Le bord des taches est
  // doux (le soleil a une taille), le feuillage bouge à peine, d'un mouvement qui boucle avec le film, et il ne
  // couvre qu'un côté de la scène. Renvoie la part de soleil qui passe (1 : plein soleil).
  const leafShade = Fn(([P]) => {
    const sd = U.sunDir, q = P.xz.sub(sd.xz.mul(float(2.4).sub(P.y).div(sd.y.negate().max(0.2))));
    const sway = vec2(sin(G.phase.mul(TAU)), cos(G.phase.mul(TAU * 2))).mul(0.018);
    // (masses de feuillage, puis le détail des feuilles : des trouées de quelques centimètres)
    const n = fbm(vec3(q.add(sway).mul(2.1), 0.3), 3).mul(0.5).add(0.5).add(noise(vec3(q.sub(sway).mul(9), 1.7)).mul(0.2)).add(noise(vec3(q.add(sway.mul(2)).mul(21), 4.1)).mul(0.1));
    const side = smoothstep(-0.9, 0.7, dot(q, U.shadeDir));
    return mix(float(1), mix(float(1), float(0.1), smoothstep(0.5, 0.57, n)), side.mul(U.shadeOn));
  });

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
        case 'zellige': {
          // étoiles à huit branches (deux carrés croisés) serties de croix : trois émaux, joints de chaux
          const ts = 0.045, q = xz.div(ts), c = floor(q.add(0.5)), f = q.sub(c);
          const ax = abs(f.x), ay = abs(f.y);
          const dStar = min(max(ax, ay).sub(0.27), ax.add(ay).mul(0.7071).sub(0.27)); // < 0 dans l'étoile
          const dCross = max(ax, ay).sub(0.5).negate().min(float(0.5).sub(ax.add(ay).mul(0.7071)).negate().add(0.21)); // (reste : croix entre les étoiles)
          const hv = hash33(vec3(c, 2.3));
          const glaze = fbm(p3.mul(60), 2).mul(0.06);
          const star = mix(vec3(0.07, 0.2, 0.62), vec3(0.1, 0.3, 0.72), hv.x).add(glaze); // cobalt
          const field = mix(U.floorA, U.floorA.mul(0.82), hv.y).add(glaze);
          const dot8 = smoothstep(0.1, 0.07, length(f)); // un cabochon blanc au cœur de l'étoile
          let t = mix(field, star, smoothstep(0.015, -0.015, dStar));
          t = mix(t, U.floorB, dot8);
          const joint = smoothstep(0.03, 0.012, abs(dStar)).mul(aa(1 / 0.003)).max(smoothstep(0.035, 0.015, min(float(0.5).sub(ax), float(0.5).sub(ay))).mul(aa(1 / 0.003)));
          a = mix(t, U.floorB.mul(0.82), joint.mul(0.9));
          break;
        }
        case 'mosaicNoir':
        case 'mosaicNuit':
        case 'mosaic': {
          // pâte de verre : tesselles de 2 cm à coins doux, chacune sa nuance, posées par plaques (un rien de travers)
          const ts = 0.0125, q = xz.div(ts), c = floor(q), f = fract(q).sub(0.5);
          const hv = hash33(vec3(c, 5.1));
          // (carré arrondi : la tesselle ; le reste : le joint, à peine plus clair — c'est la lumière qu'on doit lire, pas le quadrillage)
          const dq = max(abs(f.x), abs(f.y)), dr = length(max(abs(f).sub(0.34), 0)).add(min(dq.sub(0.34), 0)).sub(0.09);
          const k = aa(1 / 0.009), tess = smoothstep(0.03, -0.03, dr).mul(k).add(float(1).sub(k).mul(0.8));
          const tone = mix(U.floorA, U.floorB, smoothstep(0.7, 1.0, hv.x).mul(0.55)).mul(hv.y.mul(0.14).add(0.9));
          const cloud = fbm(p3.mul(7), 3).mul(0.08).add(1); // (lots de teinte légèrement différents)
          a = mix(mix(vec3(0.74, 0.8, 0.78), U.floorA, 0.45), tone.mul(cloud), tess);
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
    // Une feuille posée sur l'eau : au fond, son ombre, cernée d'un liseré clair (le ménisque autour d'elle fait lentille).
    // Leur place ne change pas : l'ombre se calcule en remontant du fond vers la surface le long du rayon de lumière.
    const LEAVES = R.light.kind === 'sun' ? (R.decor?.leafList ?? []) : [], LK = R.decor?.leaves === 'petale' ? 0.78 : 0.4;
    const floatShadow = (xz) => {
      if (!LEAVES.length) return float(1);
      const sd = R.light.dir, lx = sd[0] / N_W, lz = sd[2] / N_W, ln = Math.hypot(lx, sd[1], lz), kx = (lx / ln) * (H / (-sd[1] / ln)), kz = (lz / ln) * (H / (-sd[1] / ln));
      let f = float(1);
      for (const [x, z, a, len] of LEAVES) {
        const q = xz.sub(vec2(x + kx, z + kz)), c = Math.cos(a), sn = Math.sin(a);
        const lc = vec2(q.x.mul(c).add(q.y.mul(sn)).div(len / 2), q.x.mul(-sn).add(q.y.mul(c)).div((len / 2) * LK)), dd = length(lc);
        f = f.mul(float(1).sub(smoothstep(1.15, 0.8, dd).mul(0.85))).add(exp(dd.sub(1.3).div(0.16).pow2().negate()).mul(0.55));
      }
      return f;
    };
    const lightAt = (xz) => caustics.floorAt(xz).mul(U.lux).mul(U.sunCol).mul(leafShade(vec3(xz.x, -H, xz.y))).mul(floatShadow(xz));
    // radiance du fond en (x, z)
    const floorRadWith = (light, plain = false) => Fn(([xz, fw]) => {
      const a = plain ? vec3(U.floorA) : albedo(xz, fw);
      // les coins reçoivent moins de ciel
      const e = min(min(float(W / 2).sub(abs(xz.x)), float(D / 2).sub(abs(xz.y))), 0.2);
      const ao = smoothstep(-0.005, 0.08, e).mul(0.6).add(0.4);
      return a.mul(light(xz).div(Math.PI).add(U.ambCol.mul(U.amb).mul(ao).mul(T.style === 'bassin' ? 0.45 : 1)));
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
        case 'bassin': { // le revêtement du fond remonte sur les parois
          a = albedo(vec2(p.x.add(p.z), p.y), float(0.002));
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
      const caus = caustics.sliceAt(p).mul(graze).mul(U.lux).mul(U.sunCol).mul(leafShade(p));
      // (bassin à ciel ouvert : les parois voient le ciel, pas le plafond d'un atelier)
      const E = bounce.add(caus).add(U.ambCol.mul(U.amb).mul(T.style === 'bassin' ? 2.2 : 0.7));
      return (plain ? vec3(U.wallC) : wallAlbedo(p)).mul(E).div(Math.PI);
    });
    const wallRad = wallRadWith(false);
    // (vue à travers les vagues : paroi unie, son motif fourmillerait)
    const wallRadSoft = wallRadWith(true);
    // un rayon qui part de Q (dans l'eau) dans la direction d (vers le bas ou
    // de côté) : le fond, ou une paroi ; renvoie la radiance au départ du rayon
    const traceDown = Fn(([Q, d, fwS]) => {
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
      // (bassin vu d'en haut : le fond est le sujet — son décor et la caustique fine, lus avec
      //  l'empreinte du pixel ; derrière une vitre, de côté, ils fourmillaient : version unie et douce)
      const rad = mix(T.style === 'bassin' ? wallRad(Pw) : wallRadSoft(Pw), T.style === 'bassin' ? floorRad(Pf.xz, fwS.add(t.mul(0.002))) : floorRadSoft(Pf.xz, float(0.004).add(t.mul(0.004))), kf);
      // Les rayons dans l'eau (bassin) : l'eau, à peine trouble, renvoie vers l'œil un peu de la lumière
      // qui la traverse. Cette lumière est déjà connue à huit profondeurs (les coupes de caustics.js) :
      // on la relit en huit points du trajet du regard, décalés d'une image à l'autre par un tramage que
      // l'anticrénelage temporel lisse. Ni marche longue, ni passe de plus.
      if (T.style !== 'bassin') return rad.mul(trans(t));
      // Le cylindre de Kármán, sous l'eau : un métal poli, qui renvoie le fond du bassin. Rencontre du rayon
      // et d'un cylindre vertical (une équation du second degré dans le plan), puis un seul rebond vers le fond.
      let tE = t, radE = rad;
      if (R.family === 'karman') {
        const c = vec2(R.karman.post[0], R.karman.post[1]), rr = R.karman.radius;
        const o2 = Q.xz.sub(c), a2 = dot(d.xz, d.xz).max(1e-8), b2 = dot(o2, d.xz), disc = b2.mul(b2).sub(a2.mul(dot(o2, o2).sub(rr * rr)));
        const tc = b2.negate().sub(disc.max(0).sqrt()).div(a2);
        const hit = disc.greaterThan(0).and(tc.greaterThan(0)).and(tc.lessThan(t));
        const Pc = Q.add(d.mul(tc)), nc = vec3(Pc.x.sub(c.x).div(rr), 0, Pc.z.sub(c.y).div(rr));
        const rf = reflect(d, nc), tr = float(-H).sub(Pc.y).div(rf.y.min(-0.05));
        const Pr = Pc.add(rf.mul(tr));
        const seen = floorRad(vec2(clamp(Pr.x, -W / 2 + 0.01, W / 2 - 0.01), clamp(Pr.z, -D / 2 + 0.01, D / 2 - 0.01)), fwS.add(0.004)).mul(trans(tr));
        // (vers le haut : le dessous de la surface, miroir sombre ; une arête claire là où le métal regarde la lumière)
        const up = smoothstep(-0.25, 0.05, rf.y), edge = pow(max(dot(nc, normalize(mix(U.sunDir.negate(), U.lampPos.sub(Pc), U.lampMode))), 0), 6);
        const metal = mix(seen, U.ambCol.mul(U.amb).mul(0.5), up).mul(0.82).add(U.sunCol.mul(U.lux).mul(edge).mul(0.06));
        tE = select(hit, tc, t); radE = select(hit, metal, rad);
      }
      // Les rayons dans l'eau. Un faisceau est la trace, dans le volume, d'un trait brillant du fond : chaque
      // point du regard relit donc la caustique du fond (nette, 1 mm par texel) au pied du rayon de lumière
      // qui le traverse. Les rayons sont des lames fines qui aboutissent exactement sur la figure ; ils
      // s'estompent en remontant, où la lumière n'est pas encore rassemblée. (Lire les coupes floues de
      // l'eau donnait un nuage laiteux au-dessus de la figure.)
      const NS = lite ? 6 : 12;
      const jit = hash(screenCoordinate.x.toUint().add(screenCoordinate.y.toUint().mul(uint(7919))).add(G.frame.toUint().mul(uint(104729))));
      const Lw = normalize(mix(U.sunDir, Q.sub(U.lampPos), U.lampMode)), lw = vec3(Lw.x.div(N_W), Lw.y, Lw.z.div(N_W)).normalize();
      const acc = vec3(0).toVar();
      Loop(NS, ({ i }) => {
        const sq = float(i).add(jit).div(NS).mul(tE), p = Q.add(d.mul(sq)), hgt = p.y.add(H).max(0);
        const foot = p.xz.add(lw.xz.mul(hgt.div(lw.y.negate().max(0.2))));
        const e = caustics.floorAt(vec2(clamp(foot.x, -W / 2 + 0.002, W / 2 - 0.002), clamp(foot.y, -D / 2 + 0.002, D / 2 - 0.002)));
        // (bien au-dessus de l'éclairement d'une eau plane : un trait de la figure ; en luminance — les franges colorées,
        //  relues point par point, donnaient un fourmillement de couleurs)
        // (comprimé : un trait dix fois plus brillant que l'eau calme ne donne pas un rayon dix fois plus fort —
        //  sinon le contour de la figure se dresse comme un tube de verre)
        const b0 = max(dot(e, vec3(0.2126, 0.7152, 0.0722)).sub(1.15), 0), beam = b0.div(b0.mul(0.9).add(1));
        acc.addAssign(trans(sq).mul(beam).mul(exp(hgt.mul(-6))));
      });
      const shafts = acc.mul(tE.div(NS)).mul(U.shaft).mul(U.lux).mul(U.sunCol).mul(leafShade(Q));
      return radE.mul(trans(tE)).add(shafts);
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
      const over = S.wallAlbedo(P).mul(U.lux.mul(R.tank.style === 'bassin' ? 0.6 : 0.35).add(U.amb.mul(R.tank.style === 'bassin' ? 2.5 : 1))).div(Math.PI);
      // la ligne d'eau : un ménisque qui accroche le ciel, et au-dessus une bande mouillée, plus sombre
      const wet = smoothstep(0.03, 0.004, P.y).mul(0.3), line = smoothstep(0.0035, 0.0005, P.y.abs());
      // Hors de l'eau, le revêtement est une matière brillante : chaque tesselle, posée un rien de travers, renvoie le
      // ciel selon son propre angle (Fresnel), et celles qui regardent le soleil s'allument.
      const tsw = 0.0125, tid = vec3(floor(P.x.add(P.z).div(tsw)), floor(P.y.div(tsw)), 2.9), th = hash33(tid);
      const sideW = abs(P.x).greaterThan(float(R.tank.W / 2 - 0.002)), nW0 = select(sideW, vec3(P.x.sign().negate(), 0, 0), vec3(0, 0, 1));
      const nT = normalize(nW0.add(vec3(th.x.sub(0.5), th.y.sub(0.5), th.z.sub(0.5)).mul(0.16)));
      const Vw = normalize(P.sub(cameraPosition)), rW = reflect(Vw, nT), cW = dot(Vw.negate(), nT).clamp(0, 1);
      const Fw = float(0.045).add(float(0.955).mul(pow(float(1).sub(cW), 5)));
      const skyW = scene.environment ? pmremTexture(scene.environment, rW, float(0.12)).rgb.mul(G.envI) : vec3(0.1);
      const sunW = pow(max(dot(rW, normalize(mix(U.sunDir.negate(), U.lampPos.sub(P), U.lampMode))), 0), 220).mul(U.lux).mul(U.sunCol).mul(2.5);
      const gloss = skyW.mul(Fw).add(sunW.mul(Fw.add(0.04))).mul(leafShade(P).mul(0.7).add(0.3));
      const overW = R.tank.style === 'bassin' ? over.mul(float(1).sub(wet)).add(gloss).add(U.ambCol.mul(U.amb).mul(line).mul(1.2)) : over;
      return vec4(select(P.y.lessThan(0), under, overW), 1);
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
      const fwP = fwidth(P.x).add(fwidth(P.z)).max(1e-6); // (empreinte du pixel sur la surface : dérivées hors des branches)
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
        const below = S.traceDown(P, t, fwP);
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
        const refl = S.traceDown(P, r, fwP);
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

  // Le patio : un sol de terre cuite au soleil, percé du bassin, et sa margelle de pierre claire.
  function patio(add) {
    const T = R.tank, W = T.W, D = T.D, top = T.rim, cw = 0.075, ch = 0.022, far = 7;
    // Une seule pierre pour le sol et la margelle : un calcaire beige adouci. Sa matière, du plus grand au plus fin :
    // des nuages de teinte, de rares veines plus claires, des éclats de coquille, des pores qui retiennent l'ombre.
    const SP = STONES[T.stone] ?? STONES.calcaire, DC = R.decor ?? {};
    const shaded = (m) => { m.receivedShadowNode = Fn(([sh]) => sh.mul(leafShade(positionWorld))); return m; };
    // La pierre mouillée : des flaques et des éclaboussures au bord du bassin, plus sombres et brillantes que la pierre sèche.
    const wetAt = (P) => {
      const dB = max(abs(P.x).sub(W / 2), abs(P.z).sub(D / 2)).max(0), near = smoothstep(0.2, 0.01, dB);
      const pud = smoothstep(float(0.8).sub(near.mul(0.3)), float(0.84).sub(near.mul(0.3)), fbm(vec3(P.x, 0, P.z).mul(13).add(5.1), 3).mul(0.5).add(0.5));
      // (les gouttes isolées faisaient des pois : seules les flaques, de forme libre, sont gardées)
      return pud.mul(smoothstep(0.26, 0.1, dB));
    };
    // Une seule pierre pour le sol et la margelle (ou, pour le sol, des tomettes ou un platelage de teck). Sa matière,
    // du plus grand au plus fin : des nuages de teinte, des éclats de coquille, des pores qui retiennent l'ombre.
    const lime = (kind, polish) => {
      const m = new THREE.MeshPhysicalNodeMaterial();
      const P = positionWorld, p3 = vec3(P.x, P.y.mul(0.5), P.z);
      const fw = fwidth(P.x).add(fwidth(P.z)).add(fwidth(P.y)).max(1e-6), aa = (f) => smoothstep(0.7, 0.2, fw.mul(f));
      const cloud = fbm(p3.mul(5), 3).mul(0.5).add(0.5);
      const wet = wetAt(P);
      if (kind === 'teck') {
        // platelage : lames de 8 cm, longues, décalées d'un rang à l'autre ; fil du bois, gris argenté par endroits
        const pw = 0.08, row = floor(P.z.div(pw)), u = P.x.add(row.mul(0.37)).div(1.1), f = vec2(fract(u), fract(P.z.div(pw)));
        const gap = smoothstep(0.045, 0.02, min(f.y, float(1).sub(f.y))).max(smoothstep(0.004, 0.0015, min(f.x, float(1).sub(f.x))));
        const hv = hash33(vec3(row, floor(u), 4.4)), grain = fbm(vec3(P.x.mul(4), row, P.z.mul(90)), 3).mul(0.5).add(0.5);
        const wood = mix(vec3(0.4, 0.25, 0.13), vec3(0.27, 0.16, 0.08), grain.mul(0.7).add(hv.x.mul(0.3))).mul(mix(float(1), float(1.25), cloud.mul(hv.y)));
        m.colorNode = mix(wood, vec3(0.04, 0.03, 0.02), gap).mul(float(1).sub(wet.mul(0.45)));
        // le bois huilé : un fil en relief, des lames à peine bombées, un satiné qui varie d'une lame à l'autre ;
        // mouillé, un film d'eau le vernit
        const crown = smoothstep(0, 0.22, min(f.y, float(1).sub(f.y)));
        m.roughnessNode = mix(float(0.5).add(grain.mul(0.22)).add(hv.z.mul(0.12)), float(0.06), wet);
        m.clearcoatNode = max(wet, hv.y.mul(0.22).mul(float(1).sub(gap)));
        m.clearcoatRoughnessNode = mix(float(0.35), float(0.03), wet);
        m.normalNode = bumpMap(gap.mul(-2).add(crown.mul(0.5)).add(grain.mul(0.35).mul(float(1).sub(wet.mul(0.8)))), 0.004);
        return shaded(m);
      }
      const sc = p3.mul(90), sh = hash33(floor(sc)), shell = smoothstep(0.3, 0.14, length(fract(sc).sub(0.5).sub(sh.sub(0.5).mul(0.5)))).mul(step(0.8, sh.z)).mul(aa(90));
      // (pores : un simple tirage par cellule de 2 mm — un bruit cellulaire coûtait 2 ms par image pour des points d'un pixel)
      const pc = p3.mul(520), ph = hash33(floor(pc)), pore = smoothstep(0.42, 0.2, length(fract(pc).sub(0.5).sub(ph.sub(0.5).mul(0.4)))).mul(step(0.72, ph.z)).mul(aa(520));
      let joint = float(0), tone = float(1), edge = float(0), tileC = null, bevel = float(1), tilt = float(0);
      if (kind === 'dalles' || kind === 'tomette') { // dalles de 30 cm à joints croisés, ou tomettes de 11 cm
        const ts = kind === 'tomette' ? 0.11 : 0.3, jw = kind === 'tomette' ? 0.003 : 0.0035;
        const q = vec2(P.x.add(floor(P.z.div(ts)).mul(0.5 * ts)), P.z).div(ts), c = floor(q), f = fract(q);
        const e = min(min(f.x, float(1).sub(f.x)), min(f.y, float(1).sub(f.y))).mul(ts);
        joint = smoothstep(jw, jw * 0.3, e);
        // (arête adoucie : le carreau descend vers son joint sur quelques millimètres ; et chaque carreau est posé un rien de travers)
        bevel = smoothstep(0, kind === 'tomette' ? 0.009 : 0.006, e);
        tilt = dot(f.sub(0.5), hash33(vec3(c, 3.9)).xy.sub(0.5)).mul(kind === 'tomette' ? 0.8 : 0.25);
        edge = smoothstep(0.02, 0.003, e); // (le long des joints : la matière se patine)
        tileC = hash33(vec3(c, 9.3));
        tone = tileC.x.mul(kind === 'tomette' ? 0.3 : 0.1).add(kind === 'tomette' ? 0.85 : 0.95);
      }
      const mott = fbm(p3.mul(34), 2).mul(0.5).add(0.5); // (marbrure à l'échelle du centimètre)
      // (tomette : la terre cuite, du rouge brique à l'orangé selon la cuisson de chaque carreau)
      const A = kind === 'tomette' ? mix(vec3(0.5, 0.2, 0.11), vec3(0.62, 0.3, 0.15), tileC.y) : vec3(...SP.a), B = kind === 'tomette' ? vec3(0.36, 0.14, 0.08) : vec3(...SP.b);
      const base = mix(A, B, cloud.mul(0.6).add(mott.mul(0.35))).mul(tone);
      // (de larges taches à peine plus sombres : l'eau a séché là)
      const stain = smoothstep(0.1, 0.6, fbm(p3.mul(1.6).add(11.3), 3)).mul(0.14);
      const col = mix(base, kind === 'tomette' ? base.mul(1.25) : vec3(...SP.light), shell.mul(0.22)).mul(float(1).sub(stain)).mul(float(1).sub(edge.mul(0.1))).mul(float(1).sub(pore.mul(0.5)));
      m.colorNode = mix(col, kind === 'tomette' ? vec3(0.42, 0.36, 0.3) : vec3(...SP.joint), joint).mul(float(1).sub(wet.mul(0.15)));
      // rugosité : la pierre adoucie, polie par endroits (là où l'on marche), mate dans ses pores et ses joints
      const worn = fbm(p3.mul(2.3).add(7.7), 3).mul(0.5).add(0.5);
      const rough = float(polish ? 0.36 : kind === 'tomette' ? 0.5 : 0.66).add(pore.mul(0.3)).add(cloud.mul(0.1)).sub(worn.mul(0.16)).add(joint.mul(0.3)).sub(stain.mul(0.5));
      m.roughnessNode = mix(rough.clamp(0.12, 1), float(0.05), wet);
      // vernis : le film d'eau des flaques ; la cire des tomettes, inégale d'un carreau à l'autre ; le poli de la margelle
      const wax = kind === 'tomette' ? tileC.z.mul(0.45).add(0.15).mul(float(1).sub(joint)) : float(polish ? 0.3 : 0.06).mul(worn);
      m.clearcoatNode = max(wet, wax);
      m.clearcoatRoughnessNode = mix(float(kind === 'tomette' ? 0.22 : 0.3).add(mott.mul(0.15)), float(0.025), wet);
      m.specularIntensityNode = float(1).sub(joint.mul(0.7));
      // relief : pores et joints en creux, arêtes adoucies, carreaux à peine inclinés, une ondulation large de la surface ;
      // sous une flaque, l'eau lisse tout
      const h = pore.mul(-0.6).add(joint.mul(-2)).add(bevel.mul(1.6)).add(tilt).add(fbm(p3.mul(11), 2).mul(0.5)).add(mott.mul(0.12).mul(aa(34)));
      m.normalNode = bumpMap(h.mul(float(1).sub(wet.mul(0.85))), 0.0025);
      return shaded(m);
    };
    const ground = lime(DC.ground === 'teck' ? 'teck' : DC.ground === 'tomette' ? 'tomette' : 'dalles', false), stone = lime('bloc', true);
    // Le mur du fond : un enduit à la chaux teinté, passé à la taloche, qui ferme l'image et renvoie sa couleur.
    if (DC.wall) {
      const wm = new THREE.MeshPhysicalNodeMaterial();
      const P = positionWorld, t1 = fbm(vec3(P.x.mul(1.3), P.y.mul(2.2), 3.3), 4).mul(0.5).add(0.5), t2 = fbm(vec3(P.x.mul(9), P.y.mul(14), 8.1), 2);
      const wc = new THREE.Color(DC.wall);
      // (plus sombre et sali vers le bas, où l'eau rejaillit)
      wm.colorNode = vec3(wc.r, wc.g, wc.b).mul(t1.mul(0.22).add(0.86)).mul(t2.mul(0.05).add(1)).mul(mix(float(0.8), float(1), smoothstep(0, 0.35, P.y.sub(top))));
      // (chaux ferrée : lissée par endroits, où elle prend un satiné, râpeuse ailleurs)
      wm.roughnessNode = float(0.9).sub(smoothstep(0.45, 0.75, t1).mul(0.3));
      wm.sheen = 0.25; wm.sheenRoughness = 0.6; wm.sheenColor = wc.clone().lerp(new THREE.Color('#ffffff'), 0.5);
      wm.normalNode = bumpMap(t1.mul(1.2).add(t2.mul(0.5)).add(fbm(vec3(P.x.mul(40), P.y.mul(40), 2.2), 2).mul(0.15)), 0.004);
      const wz = -D / 2 - cw - 0.95, wall = new THREE.Mesh(new THREE.PlaneGeometry(14, 4), shaded(wm));
      wall.position.set(0, top + 2, wz);
      add(wall);
      // sa plinthe de pierre
      const pl = new THREE.Mesh(new RoundedBoxGeometry(14, 0.09, 0.025, 2, 0.005), stone); pl.position.set(0, top + 0.045, wz + 0.0125); add(pl);
    }
    // Les feuilles sur l'eau : une lame mince, un peu creusée, qui monte et descend avec l'eau sous elle.
    if (R.light.kind === 'sun') for (const [x, z, a, len] of (DC.leafList ?? [])) {
      const petal = DC.leaves === 'petale', wid = len * (petal ? 0.78 : 0.4), nS = 20, pos = [0, 0, 0], uvs = [0.5, 0.5], idx = [];
      for (let i = 0; i < nS; i++) {
        const t = (i / nS) * Math.PI * 2, cx = Math.cos(t), sz = Math.sin(t);
        // (contour en amande : pointu aux deux bouts pour une feuille, rond et échancré pour un pétale)
        const px = (len / 2) * cx, pz = (wid / 2) * sz * (petal ? 1 - 0.18 * Math.max(0, cx) ** 6 : Math.sqrt(Math.abs(Math.sin(t))) || 0);
        pos.push(px, len * (petal ? 0.9 : 0.3) * ((px / len) ** 2 + (pz / len) ** 2) + (petal ? 0.06 * len * Math.sin(3 * t) : 0), pz); uvs.push(0.5 + cx / 2, 0.5 + sz / 2);
        idx.push(0, 1 + ((i + 1) % nS), 1 + i);
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); g.setIndex(idx); g.computeVertexNormals();
      const lm = new THREE.MeshPhysicalNodeMaterial({ side: THREE.DoubleSide });
      // (feuille : cuticule cirée ; pétale : velouté, un peu translucide)
      if (petal) { lm.sheen = 0.9; lm.sheenRoughness = 0.5; lm.sheenColor = new THREE.Color('#ffd0e4'); } else { lm.clearcoat = 0.55; lm.clearcoatRoughness = 0.18; }
      const dxw = T.L / N, cell = Math.round((z + T.L / 2) / dxw - 0.5) * N + Math.round((x + T.L / 2) / dxw - 0.5);
      lm.positionNode = positionLocal.add(vec3(0, field.element(int(cell)).x.add(0.0012), 0));
      const u2 = attribute('uv', 'vec2'), rib = smoothstep(0.035, 0.008, abs(u2.y.sub(0.5))).mul(petal ? 0.15 : 0.45), hv = hash33(vec3(x * 91, z * 57, 1.3));
      const rad2 = length(u2.sub(0.5)).mul(2); // (0 au cœur, 1 au bord)
      const tint = DC.leaves === 'petale' ? mix(vec3(0.95, 0.8, 0.84), mix(vec3(0.72, 0.05, 0.3), vec3(0.88, 0.16, 0.46), u2.y), smoothstep(0.05, 0.75, rad2)).mul(mix(float(1), float(1.25), smoothstep(0.8, 1, rad2))) : R.mood === 'doree' ? mix(vec3(0.62, 0.42, 0.08), vec3(0.5, 0.2, 0.05), u2.x) : mix(vec3(0.16, 0.3, 0.08), vec3(0.3, 0.4, 0.1), u2.x);
      lm.colorNode = tint.mul(hv.x.mul(0.3).add(0.85)).mul(float(1).sub(rib));
      lm.roughnessNode = float(petal ? 0.6 : 0.42);
      const leaf = new THREE.Mesh(g, shaded(lm));
      leaf.position.set(x, 0, z); leaf.rotation.y = -a; leaf.frustumCulled = false;
      add(leaf); leaf.castShadow = false;
    }
    // ── Un objet par scène, posé du côté opposé à la caméra ──
    const sideX = DC.side ?? 1, put = (g, m, x, y, z) => { const b = new THREE.Mesh(g, m); b.position.set(x, y, z); return add(b); };
    const lathe = (pts, seg = 40) => new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), seg);
    candle.intensity = 0;
    if (DC.prop === 'serviette') {
      // deux serviettes de coton pliées, l'une sur l'autre : éponge épaisse (un velouté, un grain serré), liteaux tissés
      const cloth = (band) => {
        const m = new THREE.MeshPhysicalNodeMaterial({ roughness: 0.95 });
        m.sheen = 1; m.sheenRoughness = 0.55; m.sheenColor = new THREE.Color('#fff6ea');
        const P = positionLocal, loop = noise(P.mul(vec3(900, 900, 900))).mul(0.5).add(noise(P.mul(260)).mul(0.5));
        // (liteaux : trois bandes en travers, près d'un bord)
        const u = P.x.div(0.165).add(0.5), st = smoothstep(0.02, 0.0, abs(u.sub(0.16))).add(smoothstep(0.008, 0.0, abs(u.sub(0.21)))).add(smoothstep(0.008, 0.0, abs(u.sub(0.11)))).min(1);
        m.colorNode = mix(vec3(0.86, 0.83, 0.77), vec3(...band), st).mul(loop.mul(0.1).add(0.95));
        m.normalNode = bumpMap(loop.mul(float(1).sub(st.mul(0.6))), 0.0012);
        return shaded(m);
      };
      const band = { patio: [0.72, 0.2, 0.12], lagon: [0.12, 0.3, 0.55], thermes: [0.45, 0.38, 0.22], atelier: [0.25, 0.3, 0.33] }[R.mood] ?? [0.2, 0.3, 0.5];
      const tx = sideX * (W / 2 + cw + 0.14), tz = -D * 0.22;
      const t1 = put(new RoundedBoxGeometry(0.165, 0.024, 0.1, 5, 0.008), cloth(band), tx, top + 0.012, tz); t1.rotation.y = 0.18 * sideX;
      const t2 = put(new RoundedBoxGeometry(0.158, 0.022, 0.095, 5, 0.008), cloth(band), tx + 0.004, top + 0.035, tz - 0.003); t2.rotation.y = 0.06 * sideX;
    } else if (DC.prop === 'lanterne') {
      // Une lanterne de laiton patiné sur la margelle. Chaque pièce a son profil : socle mouluré sur quatre petits
      // pieds, montants en cornière, traverses haute et basse, toit en pavillon débordant, lanterneau ajouré, anse.
      const bz = new THREE.MeshPhysicalNodeMaterial({ metalness: 1 });
      { const P = positionWorld, pat = fbm(P.mul(55), 3).mul(0.5).add(0.5);
        bz.colorNode = mix(vec3(0.5, 0.36, 0.16), vec3(0.2, 0.15, 0.08), smoothstep(0.45, 0.8, pat)); // (laiton bruni, plus sombre dans les creux)
        bz.roughnessNode = float(0.3).add(pat.mul(0.3)); }
      bz.envMapIntensity = 3;
      const lx = sideX * (W / 2 + cw / 2), lz = -D / 2 - cw / 2, hw = 0.027, hh = 0.082, ct = top + ch, y1 = ct + 0.015; // (ct : le dessus de la margelle, où elle repose)
      for (const [ax, az] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        put(new THREE.SphereGeometry(0.0045, 12, 8), bz, lx + ax * (hw - 0.002), ct + 0.0045, lz + az * (hw - 0.002));
        // montant en cornière : deux ailes de 6 mm
        put(new THREE.BoxGeometry(0.0065, hh, 0.0015), bz, lx + ax * (hw - 0.0032), y1 + hh / 2, lz + az * hw);
        put(new THREE.BoxGeometry(0.0015, hh, 0.0065), bz, lx + ax * hw, y1 + hh / 2, lz + az * (hw - 0.0032));
      }
      put(new RoundedBoxGeometry(hw * 2 + 0.014, 0.006, hw * 2 + 0.014, 3, 0.0025), bz, lx, ct + 0.012, lz);
      for (const yy of [y1 + 0.004, y1 + hh - 0.004]) for (const [ax, az] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) put(new THREE.BoxGeometry(ax ? 0.0015 : hw * 2, 0.007, ax ? hw * 2 : 0.0015), bz, lx + ax * hw, yy, lz + az * hw);
      // le toit : un pavillon à quatre pans qui déborde, puis un lanterneau et son chapeau
      const roof = put(lathe([[hw * 1.62, 0], [hw * 1.62, 0.002], [hw * 0.5, 0.026], [hw * 0.5, 0.036], [hw * 0.62, 0.037], [hw * 0.62, 0.039], [0.004, 0.05], [0.004, 0.056], [0, 0.056]], 4), bz, lx, y1 + hh, lz); roof.rotation.y = Math.PI / 4;
      put(new THREE.TorusGeometry(0.0095, 0.0014, 8, 28), bz, lx, y1 + hh + 0.064, lz);
      // la bougie : un cylindre de cire au sommet creusé, une mèche, une flamme en larme
      const wax = new THREE.MeshPhysicalNodeMaterial({ color: '#efe4cc', roughness: 0.45 });
      wax.emissiveNode = vec3(1, 0.5, 0.18).mul(smoothstep(-0.03, 0.02, positionLocal.y).mul(0.55)); // (la cire s'allume sous la flamme)
      put(lathe([[0, 0], [0.0125, 0], [0.013, 0.001], [0.013, 0.036], [0.0115, 0.038], [0.006, 0.0355], [0, 0.034]], 28), wax, lx, y1 + 0.001, lz);
      put(new THREE.CylinderGeometry(0.0004, 0.0004, 0.006, 6), new THREE.MeshStandardNodeMaterial({ color: '#1a1410', roughness: 0.9 }), lx, y1 + 0.038, lz);
      const fl = new THREE.MeshBasicNodeMaterial();
      const flick = sin(G.phase.mul(TAU * 23)).mul(0.1).add(sin(G.phase.mul(TAU * 37)).mul(0.07)).add(1);
      // (flamme : cœur presque blanc, bords orangés, base bleutée et sombre autour de la mèche)
      fl.outputNode = Fn(() => {
        const hN = positionLocal.y.div(0.02).clamp(0, 1), rim = dot(normalize(attribute('normal', 'vec3')), normalize(cameraPosition.sub(positionWorld))).abs();
        const c = mix(vec3(1, 0.45, 0.1), vec3(1, 0.9, 0.62), rim.pow(1.5)).mul(mix(float(0.25), float(1), smoothstep(0.0, 0.3, hN)));
        return vec4(c.mul(14).mul(flick), 1);
      })();
      fl.mrtNode = mrt({ velocity: vec4(0) });
      const flame = put(lathe([[0, 0], [0.0022, 0.002], [0.0032, 0.006], [0.0026, 0.011], [0.0012, 0.016], [0, 0.02]], 16), fl, lx, y1 + 0.04, lz); flame.castShadow = false;
      // les vitres : un reflet du ciel, presque rien d'autre
      const gm = new THREE.MeshPhysicalNodeMaterial({ color: '#ffffff', roughness: 0.02, metalness: 0, transparent: true, opacity: 0.12, side: THREE.DoubleSide }); gm.envMapIntensity = 3;
      for (const [ax, az] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const g = put(new THREE.PlaneGeometry(hw * 2 - 0.003, hh - 0.01), gm, lx + ax * (hw - 0.001), y1 + hh / 2, lz + az * (hw - 0.001)); g.rotation.y = ax ? Math.PI / 2 : 0; g.castShadow = false; }
      candle.position.set(lx, y1 + 0.05, lz); candle.userData.base = 0.35; candle.intensity = 0.35; candle.distance = 1.6;
    }
    // ── Le bec de fontaine : un col de cygne en laiton, scellé au milieu de la margelle du fond ──
    // (à sec : un filet d'eau aurait dû troubler la lumière au fond, et le calcul des ondes ne le connaît pas)
    if (DC.spout) {
      const br = new THREE.MeshPhysicalNodeMaterial({ metalness: 1 });
      { const P = positionWorld, pat = fbm(P.mul(70), 3).mul(0.5).add(0.5);
        br.colorNode = mix(vec3(0.95, 0.76, 0.42), vec3(0.72, 0.54, 0.27), smoothstep(0.4, 0.8, pat)); // (laiton poli, à peine terni par endroits)
        // (satiné plutôt que miroir : un miroir ne renvoyait que le sol sombre du ciel de studio, et le laiton virait au bronze noir)
        br.roughnessNode = float(0.3).add(pat.mul(0.18)); }
      br.envMapIntensity = R.light.kind === 'lamp' ? 5 : 3.2;
      const sx = 0, sz = -D / 2 - cw / 2, y0 = top + ch; // (au centre de la margelle, en largeur comme en longueur)
      // le scellement : un joint sombre dans la pierre, une rosace à gorge vissée dessus, un écrou à six pans
      put(new THREE.CylinderGeometry(0.0285, 0.0285, 0.0012, 48), new THREE.MeshStandardNodeMaterial({ color: '#1c1a17', roughness: 0.9 }), sx, y0 + 0.0003, sz);
      put(lathe([[0, 0], [0.027, 0], [0.0275, 0.0015], [0.0275, 0.004], [0.025, 0.006], [0.02, 0.0065], [0.018, 0.009], [0.0125, 0.0105], [0.0125, 0.012], [0, 0.012]], 56), br, sx, y0 + 0.0008, sz);
      put(lathe([[0, 0], [0.0118, 0], [0.0128, 0.001], [0.0128, 0.008], [0.0118, 0.009], [0, 0.009]], 6), br, sx, y0 + 0.0125, sz);
      // Le corps du bec, d'une seule pièce du pied à l'embouchure (des pièces mises bout à bout laissaient voir leurs
      // raccords) : un tube balayé le long d'une courbe, dont le rayon varie continûment — colonne fuselée, deux
      // bagues en léger renflement, col de cygne, pavillon évasé au bout.
      const reach = cw / 2 + 0.04;
      const curve = new THREE.CatmullRomCurve3([[0.02, 0], [0.05, 0], [0.085, 0], [0.118, 0.003], [0.146, 0.02], [0.158, reach * 0.5], [0.148, reach * 0.88], [0.126, reach], [0.104, reach]].map(([yy, zz]) => new THREE.Vector3(sx, y0 + yy, sz + zz)), false, 'centripetal');
      const NSEG = 160, NR = 28, fr = curve.computeFrenetFrames(NSEG, false), bump = (t, c, w) => Math.exp(-(((t - c) / w) ** 2));
      const rad = (t) => 0.0088 - 0.0014 * Math.min(1, t / 0.6) + 0.0016 * bump(t, 0.035, 0.012) + 0.0013 * bump(t, 0.3, 0.012) + 0.003 * Math.max(0, (t - 0.94) / 0.06) ** 2;
      const pos = [], idx = [];
      for (let i = 0; i <= NSEG; i++) {
        const t = i / NSEG, c = curve.getPointAt(t), n = fr.normals[i], bn = fr.binormals[i], r = rad(t);
        for (let j = 0; j <= NR; j++) { const a2 = (j / NR) * Math.PI * 2, cx = Math.cos(a2) * r, sy = Math.sin(a2) * r; pos.push(c.x + n.x * cx + bn.x * sy, c.y + n.y * cx + bn.y * sy, c.z + n.z * cx + bn.z * sy); }
      }
      for (let i = 0; i < NSEG; i++) for (let j = 0; j < NR; j++) { const a2 = i * (NR + 1) + j, b2 = a2 + NR + 1; idx.push(a2, b2, a2 + 1, a2 + 1, b2, b2 + 1); }
      // (le bord roulé de l'embouchure, puis l'intérieur du tube sur un centimètre : on ne voit pas de tranche)
      const tEnd = fr.tangents[NSEG], cE = curve.getPointAt(1), nE = fr.normals[NSEG], bE = fr.binormals[NSEG], r1 = rad(1);
      const lip = [[r1, 0], [r1 - 0.0006, 0.0009], [r1 - 0.0016, 0.0011], [r1 - 0.0024, 0.0006], [r1 - 0.0028, -0.002], [r1 - 0.0031, -0.012]];
      const base = pos.length / 3;
      lip.forEach(([r, d]) => { for (let j = 0; j <= NR; j++) { const a2 = (j / NR) * Math.PI * 2, cx = Math.cos(a2) * r, sy = Math.sin(a2) * r; pos.push(cE.x + nE.x * cx + bE.x * sy + tEnd.x * d, cE.y + nE.y * cx + bE.y * sy + tEnd.y * d, cE.z + nE.z * cx + bE.z * sy + tEnd.z * d); } });
      for (let k = 0; k < lip.length - 1; k++) for (let j = 0; j < NR; j++) { const a2 = base + k * (NR + 1) + j, b2 = a2 + NR + 1; idx.push(a2, b2, a2 + 1, a2 + 1, b2, b2 + 1); }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
      // (normales lissées sur les sommets confondus : la couture du tube et le départ du bord roulé ne se voient pas)
      const gs = mergeVertices(g, 1e-6); gs.computeVertexNormals();
      add(new THREE.Mesh(gs, br));
    }
    // ── L'air ──
    if (DC.air === 'poussiere' && !lite) {
      // Des poussières en suspension, qu'on ne voit que lorsqu'elles traversent un rai de soleil : quelques dizaines de
      // points très petits, qui dérivent lentement sur des orbites fermées (le film boucle).
      const NM = 90, base = new Float32Array(NM * 3), ph = new Float32Array(NM * 3);
      for (let i = 0; i < NM; i++) {
        const h1 = Math.abs(Math.sin(i * 12.9898 + 4.1) * 43758.5453) % 1, h2 = Math.abs(Math.sin(i * 78.233 + 1.7) * 43758.5453) % 1, h3 = Math.abs(Math.sin(i * 39.425 + 9.2) * 43758.5453) % 1;
        base.set([(h1 - 0.5) * (W + 1.4), top + 0.04 + h2 * 0.55, (h3 - 0.5) * (D + 1.2) + 0.2], i * 3);
        ph.set([h2 * 6.283, h3 * 6.283, h1 * 6.283], i * 3);
      }
      const b = instancedBufferAttribute(new THREE.InstancedBufferAttribute(base, 3)), q = instancedBufferAttribute(new THREE.InstancedBufferAttribute(ph, 3));
      const t = G.phase.mul(TAU), ctr = b.add(vec3(sin(t.add(q.x)).mul(0.07), sin(t.mul(2).add(q.y)).mul(0.035), cos(t.add(q.z)).mul(0.07)));
      const sm = new THREE.SpriteNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
      sm.positionNode = ctr;
      sm.scaleNode = float(0.0055).add(q.z.mul(0.0006));
      const disc = smoothstep(0.5, 0.1, length(uv().sub(0.5)));
      // (dans l'ombre du feuillage : presque rien ; dans un rai : un point de lumière)
      sm.colorNode = vec3(U.sunCol).mul(U.lux).mul(0.2).mul(leafShade(ctr).sub(0.1).max(0)).mul(disc);
      sm.opacityNode = disc;
      sm.mrtNode = mrt({ velocity: vec4(0) });
      const motes = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), sm);
      motes.count = NM; motes.frustumCulled = false; motes.renderOrder = 4;
      add(motes); motes.castShadow = false; motes.receiveShadow = false;
    } else if (DC.air === 'vapeur' || DC.air === 'brume') {
      // Une vapeur au ras de l'eau (thermes), ou une brume basse (la nuit) : trois nappes très fines, l'une au-dessus de
      // l'autre, dont les volutes glissent en rond et reviennent à leur place à la fin du film.
      const steam = DC.air === 'vapeur';
      // (deux nappes et un seul bruit chacune : trois nappes à deux bruits doublaient le temps d'image)
      [0.015, 0.05].forEach((hh, k) => {
        const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
        m.blending = THREE.CustomBlending; m.blendEquation = THREE.AddEquation; m.blendSrc = THREE.OneFactor; m.blendDst = THREE.OneMinusSrcAlphaFactor;
        m.outputNode = Fn(() => {
          const P = positionWorld, t = G.phase.mul(TAU), off = vec2(cos(t), sin(t)).mul(0.22 + 0.08 * k);
          const n1 = fbm(vec3(P.xz.mul(2.6 - 0.5 * k).add(off), 0.4 + k), 3).mul(0.5).add(0.5);
          // (plus dense au-dessus de l'eau, elle déborde à peine sur la margelle)
          const over = smoothstep(0.16, -0.05, max(abs(P.x).sub(W / 2), abs(P.z).sub(D / 2)));
          const a = smoothstep(0.4, 0.75, n1).mul(over).mul((steam ? 0.26 : 0.13) / (1 + k * 0.7));
          const lit = U.sunCol.mul(U.lux).mul(steam ? 0.26 : 0.12).add(U.ambCol.mul(U.amb).mul(0.6));
          return vec4(lit.mul(a), a);
        })();
        m.mrtNode = mrt({ velocity: vec4(0) });
        const pl = new THREE.Mesh(new THREE.PlaneGeometry(W + 0.5, D + 0.5, 1, 1).rotateX(-Math.PI / 2), m);
        pl.position.y = hh; pl.renderOrder = 3 + k; add(pl); pl.castShadow = false; pl.receiveShadow = false;
      });
    }
    const box = (w, h, d, x, y, z, m, r = 0) => { const g = r ? new RoundedBoxGeometry(w, h, d, 3, r) : new THREE.BoxGeometry(w, h, d); const b = new THREE.Mesh(g, m); b.position.set(x, y, z); return add(b); };
    // le sol, autour du bassin et de sa margelle
    const iw = W / 2 + cw, id = D / 2 + cw;
    box(far, 0.2, far, 0, top - 0.1, -id - far / 2, ground); box(far, 0.2, far, 0, top - 0.1, id + far / 2, ground);
    box(far, 0.2, 2 * id, -iw - far / 2, top - 0.1, 0, ground); box(far, 0.2, 2 * id, iw + far / 2, top - 0.1, 0, ground);
    // la margelle : quatre dalles à arêtes adoucies, un peu au-dessus du sol
    box(W + 2 * cw, ch + 0.04, cw, 0, top + ch / 2 - 0.02, -D / 2 - cw / 2, stone, 0.004); box(W + 2 * cw, ch + 0.04, cw, 0, top + ch / 2 - 0.02, D / 2 + cw / 2, stone, 0.004);
    box(cw, ch + 0.04, D, -W / 2 - cw / 2, top + ch / 2 - 0.02, 0, stone, 0.004); box(cw, ch + 0.04, D, W / 2 + cw / 2, top + ch / 2 - 0.02, 0, stone, 0.004);
    // la paroi de devant, vue seulement par sa tranche
    box(W, T.H + top, 0.02, 0, (top - T.H) / 2, D / 2 + 0.01, stone);
  }

  // L'appareil de Kármán au bord d'un bassin : un cylindre poli tenu dans le courant par un pont fin.
  // Peu de pièces, chacune finie : pieds tournés posés sur la margelle, colonnettes, tube, bague à vis, bouchon.
  function karmanRig(add) {
    const T = R.tank, K = R.karman, [px, pz] = K.post, r = K.radius, cw = 0.075, top = T.rim + 0.022;
    const yb = top + 0.075, z0 = -T.D / 2 - cw / 2, z1 = T.D / 2 + cw / 2;
    const lamp = R.light.kind === 'lamp';
    const brass = new THREE.MeshStandardNodeMaterial({ color: '#b8904a', metalness: 1, roughness: 0.3 });
    // (acier satiné : un poli miroir, hors de l'eau, ne renvoyait que le noir du plafond)
    const steel = new THREE.MeshStandardNodeMaterial({ color: '#eceef0', metalness: 1, roughness: 0.34 });
    brass.envMapIntensity = lamp ? 4 : 1.6; steel.envMapIntensity = lamp ? 9 : 2; // (sous une lampe, le studio est sombre : le métal ne doit pas virer au noir)
    const lathe = (pts, seg = 48) => new THREE.LatheGeometry(pts.map(([x, y]) => new THREE.Vector2(x, y)), seg);
    const put = (g, m, x, y, z, rx = 0) => { const b = new THREE.Mesh(g, m); b.position.set(x, y, z); b.rotation.x = rx; return add(b); };
    // le pont : un tube, d'une margelle à l'autre, bouts arrondis
    put(new THREE.CapsuleGeometry(0.006, z1 - z0 + 0.03, 8, 24), brass, px, yb, (z0 + z1) / 2, Math.PI / 2);
    for (const z of [z0, z1]) {
      // pied tourné : semelle à chanfrein, gorge, colonnette, noix qui serre le tube
      put(lathe([[0, 0], [0.024, 0], [0.026, 0.002], [0.026, 0.005], [0.02, 0.008], [0.011, 0.011], [0.0075, 0.016], [0.0075, yb - top - 0.014], [0.0105, yb - top - 0.011], [0.0105, yb - top - 0.004], [0, yb - top - 0.004]]), brass, px, top, z);
      put(new THREE.SphereGeometry(0.0115, 24, 16), brass, px, yb, z);
    }
    // la bague au milieu du pont, sa vis moletée, et le cylindre qui descend dans l'eau
    put(lathe([[0, -0.016], [r + 0.006, -0.016], [r + 0.008, -0.013], [r + 0.008, 0.013], [r + 0.006, 0.016], [0, 0.016]]), brass, px, yb, pz);
    put(new THREE.CylinderGeometry(0.004, 0.004, 0.022, 16), brass, px + r + 0.014, yb, pz).rotation.z = Math.PI / 2;
    put(new THREE.CylinderGeometry(0.0075, 0.0075, 0.006, 20), brass, px + r + 0.027, yb, pz).rotation.z = Math.PI / 2;
    put(lathe([[0, -T.H], [r, -T.H], [r, yb + 0.03], [r - 0.002, yb + 0.034], [0, yb + 0.036]], 40), steel, px, 0, pz);
    // le ménisque : l'eau remonte d'un millimètre le long du métal et accroche la lumière
    const men = new THREE.MeshStandardNodeMaterial({ color: '#dfe9ee', metalness: 0, roughness: 0.06 });
    men.envMapIntensity = lamp ? 6 : 2;
    put(new THREE.TorusGeometry(r + 0.0012, 0.0016, 10, 48), men, px, 0.0006, pz, Math.PI / 2);
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
    // (bassin : douze coupes, plus fines — ce sont elles qu'on voit, en rayons)
    caustics = createCaustics(renderer, waves, { W: T.W, D: T.D, rim: T.rim, slices: lite ? 4 : T.style === 'bassin' ? 12 : 8, sliceRes: !lite && T.style === 'bassin' ? 320 : 256, res: lite ? 512 : 1024, lite });
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
          onProgress: (p) => { if (v === version) progressCb.fn?.(p); },
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
    const pool = T.style === 'bassin';
    const shellFin = T.style === 'stone' ? fin3('bisque') : T.style === 'enamel' ? fin3('whiteCeramic') : fin3('carbonMatte');
    if (pool) patio(add); else {
      piece(o.shell, shellFin);
      piece(o.frame, fin3(ts.frame, T.style === 'brass' ? 0.1 : 0));
    }
    if (!pool && o.rig.position.length) piece(o.rig, T.style === 'stone' ? fin3('bronzeDark') : fin3('blackenedSteel'));
    if (pool && R.family === 'karman') karmanRig(add);
    else if (o.extra.position.length) piece(o.extra, R.family === 'karman' ? fin3('chrome') : fin3('brushedSteel'));
    if (o.movers && !pool) piece(o.movers, (() => { const m = fin3(T.style === 'brass' ? 'polishedBrass' : 'brushedSteel'); return { ...m, inner: { ...FINISHES.vermilion, preset: 'vermilion' } }; })(), plungerRig(), { foot: [o.movers.foot, 1] });
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
    if (pool) { U.floorMean.value = 0.9; return; }
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
      // (bassin : le soleil éclaire tout le sol, sans bord de faisceau dans le cadre)
      key.decay = 0; key.angle = T.style === 'bassin' ? 0.5 : 0.16; key.penumbra = 0.3;
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
    // (Faraday : des centaines de petites lentilles — leurs faisceaux, à pleine force, cacheraient le réseau)
    if (candle.intensity > 0) candle.intensity = (candle.userData.base ?? 0.09) * (1 + 0.12 * Math.sin(ph * TAU * 23) + 0.08 * Math.sin(ph * TAU * 37));
    U.shadeOn.value = sun && R.decor?.shade ? 1 : 0;
    { const a = R.decor?.turn ?? 0; U.shadeDir.value.set(Math.cos(a), Math.sin(a)); }
    U.shaft.value = (R.water.shafts ?? 0) * (R.family === 'faraday' ? 0.12 : R.family === 'karman' ? 0.6 : 1);
    // (deep : l'eau d'un bassin se colore comme celle d'un bassin plus profond — le nôtre n'a que 45 cm)
    const dk = R.water.deep ?? 1;
    U.extinct.value.set((ABSORB_RGB[0] / tint[0]) * dk + R.water.turbid, (ABSORB_RGB[1] / tint[1]) * dk + R.water.turbid, (ABSORB_RGB[2] / tint[2]) * dk + R.water.turbid);
    U.glint.value = T.style === 'bassin' ? 0.25 : 1; // (à ciel ouvert, le reflet de la source ne doit pas faire une tache)
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
