// ─────────────────────────────────────────────────────────────────────────────
//  PLANÉTAIRE — simulation GPU (WebGPU / TSL compute)
//
//  Unités : G·M★ = 1, distances en UA, 1 orbite à 1 UA = 2π unités de temps.
//  Le disque est dans le plan XZ (Y = vertical).
//
//  · N grains de poussière « test » : gravité de l'étoile + des embryons,
//    traînée du gaz (relaxation exacte, stable pour tout nombre de Stokes),
//    turbulence, pièges de pression créés par les planètes massives.
//    Chaque grain porte son rayon de naissance (provenance) et sa composition
//    (roche / glace selon la ligne des glaces).
//  · M embryons planétaires : N-corps exact, accrétion atomique des grains,
//    mémoire stratigraphique (L couches par planète), fusions = impacts géants.
//  · Grille polaire (NR × NPHI) reconstruite à chaque frame : profondeur optique
//    depuis l'étoile (ombrage du disque) et « tête de lecture » sonore.
//
//  Aucun aller-retour CPU dans la boucle : seules quelques petites lectures
//  asynchrones (embryons, tête de lecture) alimentent l'UI et le son.
// ─────────────────────────────────────────────────────────────────────────────

import * as THREE from 'three/webgpu';
import {
  Fn, If, Loop, instancedArray, instanceIndex, uniform, float, int, uint,
  vec3, vec4, hash, sqrt, exp, length, dot, normalize, max, min, mix,
  smoothstep, clamp, select, atomicAdd, atomicLoad, atomicStore, atan, cos,
  sin, log, pow, floor, abs,
} from 'three/tsl';

export const M = 64;           // embryons max
export const L = 32;           // couches stratigraphiques par planète
export const NR = 192;         // grille polaire : anneaux radiaux
export const NPHI = 256;       //                  secteurs angulaires
export const R_IN = 0.35;      // bord interne du disque (sublimation)
export const R_OUT = 9.0;      // bord externe
export const R_GRID = 12.0;    // étendue de la grille
export const M_EARTH = 3.0e-6; // masse terrestre en masses solaires
export const TAU = Math.PI * 2;
// Budgets de masse (le disque n'est plus un réservoir infini) :
export const SOLID0 = 700 * M_EARTH;   // solides disponibles au départ
export const GAS0 = 2500 * M_EARTH;    // gaz capturable par les cœurs massifs
export const GAS_TAU = 160 * TAU;      // dissipation du gaz (~160 orbites à 1 UA)
export const NIMP = 8;                 // anneau d'impacts récents

const PARTICLE_WG = 256;

// Hauteur du disque (évasé) — partagé avec le rendu.
export const diskH = (R) => R.mul(0.035).mul(pow(R, 0.25));

// Index de cellule polaire pour une position (plan XZ).
export function cellOf(p) {
  const R = length(p.xz);
  const ir = clamp(floor(R.sub(R_IN).div(R_GRID - R_IN).mul(NR)), 0, NR - 1).toInt();
  const ph = atan(p.z, p.x).div(TAU).add(0.5);
  const ip = clamp(floor(ph.mul(NPHI)), 0, NPHI - 1).toInt();
  return ir.mul(NPHI).add(ip);
}

export function createSim(renderer, N) {
  // ── Buffers ────────────────────────────────────────────────────────────────
  const pPos = instancedArray(N, 'vec4');   // xyz, w = rayon de naissance
  const pVel = instancedArray(N, 'vec4');   // xyz, w = 1 glace / 0 roche

  const ePos = instancedArray(M, 'vec4');   // xyz, w = masse (0 = inactif)
  const eVel = instancedArray(M, 'vec4');   // xyz, w = rayon de capture
  const eAcc = instancedArray(M, 'vec4');   // accélération (scratch)
  const eInfo = instancedArray(M, 'vec4');  // couche en cours : masse, glace, Σr·m, nbCouches
  const eTot = instancedArray(M, 'vec4');   // totaux : glace, Σr·m, taux d'accrétion, impacts
  const eLayers = instancedArray(M * L, 'vec4'); // masse, fraction glace, r moyen, type (0 accr, 1 impact, 2 graine, 3 gaz)
  const eGas = instancedArray(M, 'vec4');   // gaz : couche en cours, total
  // Impacts récents : [k] = position, w = masse de l'impacteur ;
  //                    [NIMP + k] = n° de série, survivant, éjecta en attente, absorbé
  const imp = instancedArray(NIMP * 2, 'vec4');
  const impPos = { element: (k) => imp.element(k) };
  const impInfo = { element: (k) => imp.element(int(k).add(NIMP)) };
  const impMeta = instancedArray(1 + M, 'vec4'); // [0].x = nombre total d'impacts ; [1+a].x = candidat de fusion de a
  const mergeW = { element: (a) => impMeta.element(int(a).add(1)) };
  const pHeat = instancedArray(N, 'float');     // chaleur des éjecta (rendu)
  const eAccum = instancedArray(M * 4, 'uint').toAtomic(); // n, nGlace, Σr·64
  // Liste compacte des embryons actifs, reconstruite à chaque sous-pas : les
  // grains ne bouclent que sur elle, avec des paramètres déjà calculés.
  //   [2k]   = position xyz, masse gravitationnelle (avec boost)
  //   [2k+1] = centre du piège de pression, amplitude du piège, rayon de capture, index
  //   [2M].x = nombre d'actifs
  const eAct = instancedArray(M * 2 + 1, 'vec4');

  const grid = instancedArray(NR * NPHI, 'uint').toAtomic();
  const tau = instancedArray(NR * NPHI, 'float');
  const needle = instancedArray(NR, 'float');

  // ── Uniformes ──────────────────────────────────────────────────────────────
  const U = {
    dt: uniform(0.008),          // pas des grains
    dtE: uniform(0.004),         // pas des embryons (2 sous-pas par pas de grains)
    frame: uniform(0, 'uint'),
    eta: uniform(0.012),         // déficit de vitesse du gaz (pression)
    boost: uniform(25.0),        // amplification artistique de la gravité des embryons
    fHill: uniform(0.5),         // rayon de capture / rayon de Hill
    soft2: uniform(2.0e-4),
    mp: uniform(SOLID0 / N),     // masse d'un grain (baisse quand le disque s'épuise)
    gasAvail: uniform(1.0),      // fraction du gaz encore disponible (CPU)
    mCrit: uniform(10.0 * M_EARTH), // masse critique du cœur : capture du gaz
    gasK: uniform(0.05),         // taux de capture du gaz (en Ω)
    snow: uniform(2.7),          // ligne des glaces (UA)
    turb: uniform(0.0025),
    isoMass: uniform(6.0 * M_EARTH), // masse d'isolation (création des anneaux)
    wellPos: uniform(new THREE.Vector3()),
    wellMass: uniform(0.0),
    flyPos: uniform(new THREE.Vector3(1e4, 0, 0)),
    flyMass: uniform(0.0),
    tauDamp: uniform(400.0),     // amortissement e/i par le gaz
    migK: uniform(0.0),          // migration de type I (désactivée par défaut)
    mergeK: uniform(0.6),
    kappa: uniform(0.004 * (1 << 20) / N),
    layerTick: uniform(0, 'uint'),
    frameDt: uniform(0.016),
    spawnIdx: uniform(0, 'int'),
    spawnPos: uniform(new THREE.Vector3()),
    spawnMass: uniform(0.05 * M_EARTH),
    infall: uniform(0.5),        // part des grains perdus qui renaissent au bord externe (le reste : partout)
  };

  // ── Outils ─────────────────────────────────────────────────────────────────
  const eSeed = (idx, serial) => idx.mul(13).add(serial.mul(104729.0).toUint()).add(uint(555));
  const gauss = (h1, h2) => sqrt(log(max(h1, 1e-7)).mul(-2)).mul(cos(h2.mul(TAU)));
  const stokesOf = (idx) => pow(10.0, mix(-2.0, 0.3, hash(idx.add(uint(918273)))));
  const isoMassAt = (a) => U.isoMass.mul(pow(a, 0.75));
  // Masse gravitationnelle : le boost artistique (×25) accélère la croissance
  // des petits embryons mais s'efface pour les gros (≈ ×1,2 pour une Jupiter),
  // sinon une géante tirerait comme 20 Jupiter et disperserait tout le système.
  const B_M = 3.0 * M_EARTH;
  const gmass = (m) => m.mul(float(1).add(U.boost.sub(1.0).div(m.div(B_M).add(1.0))));
  const hillR = (a, m) => U.fHill.mul(a).mul(pow(gmass(m).div(3.0), 1 / 3));
  // Au-delà de la masse d'isolation, la planète ouvre un piège de pression :
  // elle n'avale presque plus de cailloux (ils s'accumulent en anneau).
  const captureRadius = (a, m) => hillR(a, m)
    .mul(mix(1.0, 0.04, smoothstep(0.8, 1.6, m.div(isoMassAt(a)))));

  function writeParticle(idx, seed, rA, rB) {
    const h1 = hash(seed), h2 = hash(seed.add(1)), h3 = hash(seed.add(2)), h4 = hash(seed.add(3));
    const r = mix(float(rA), float(rB), h1);
    const ph = h2.mul(TAU);
    const y = gauss(h3, h4).mul(diskH(r)).mul(0.5);
    const c = cos(ph), s = sin(ph);
    const vK = sqrt(float(1).div(r)).mul(float(1).sub(U.eta));
    pPos.element(idx).assign(vec4(r.mul(c), y, r.mul(s), r));
    pVel.element(idx).assign(vec4(s.negate().mul(vK), 0, c.mul(vK), select(r.greaterThan(U.snow), 1.0, 0.0)));
  }

  // ── Initialisation des grains ──────────────────────────────────────────────
  const initParticles = Fn(() => {
    const idx = instanceIndex;
    writeParticle(idx, idx.mul(4), R_IN, R_OUT);
  })().compute(N, [PARTICLE_WG]);

  // ── Pas de temps des grains ────────────────────────────────────────────────
  const stepParticles = Fn(() => {
    const idx = instanceIndex;
    const P = pPos.element(idx);
    const V = pVel.element(idx);
    const p = P.xyz.toVar();
    const v = V.xyz.toVar();

    const r2 = dot(p, p);
    const r = sqrt(r2);
    const R = max(length(p.xz), 1e-3).toVar();
    const acc = p.negate().div(r2.mul(r)).toVar();
    const etaEff = float(U.eta).toVar();
    const captured = int(-1).toVar();

    const nAct = eAct.element(M * 2).x.toInt();
    Loop({ start: int(0), end: nAct, type: 'int', name: 'j', condition: '<' }, ({ j }) => {
      const A0 = eAct.element(j.mul(2));
      const A1 = eAct.element(j.mul(2).add(1));
      const d = A0.xyz.sub(p);
      const d2 = dot(d, d);
      const d2s = d2.add(U.soft2);
      acc.addAssign(d.mul(A0.w.div(d2s.mul(sqrt(d2s)))));
      If(d2.lessThan(A1.z.mul(A1.z)), () => { captured.assign(A1.w.toInt()); });
      // Piège de pression juste à l'extérieur des planètes massives :
      // le gaz y devient super-képlérien → les grains s'accumulent en anneau.
      If(A1.y.greaterThan(0.0), () => {
        const x = R.sub(A1.x).div(A1.x.mul(0.0593));
        If(abs(x).lessThan(3.5), () => {
          etaEff.addAssign(A1.y.mul(x).mul(exp(x.mul(x).negate())));
        });
      });
    });

    // Perturbateurs : puits de l'utilisateur et étoile vagabonde
    const dw = U.wellPos.sub(p);
    const dw2 = dot(dw, dw).add(0.04);
    acc.addAssign(dw.mul(U.wellMass.div(dw2.mul(sqrt(dw2)))));
    const df = U.flyPos.sub(p);
    const df2 = dot(df, df).add(0.02);
    acc.addAssign(df.mul(U.flyMass.div(df2.mul(sqrt(df2)))));

    // Gaz : rotation sub-képlérienne + relaxation exacte (exp) vers sa vitesse
    const Omega = float(1).div(R.mul(sqrt(R)));
    const vK = sqrt(float(1).div(R));
    const tang = vec3(p.z.negate(), 0, p.x).div(R);
    const vGas = tang.mul(vK.mul(float(1).sub(etaEff)));
    const ts = stokesOf(idx).div(Omega);

    v.addAssign(acc.mul(U.dt));
    v.assign(vGas.add(v.sub(vGas).mul(exp(U.dt.div(ts).negate()))));

    // Turbulence (marche aléatoire)
    const seed = idx.mul(8).add(eAct.element(M * 2).y.toUint().mul(1664525));
    const kick = vec3(hash(seed).sub(0.5), hash(seed.add(1)).sub(0.5).mul(0.6), hash(seed.add(2)).sub(0.5));
    v.addAssign(kick.mul(U.turb).mul(vK).mul(sqrt(U.dt.mul(Omega)).mul(3.0)));

    p.addAssign(v.mul(U.dt));

    const rNew = length(p);
    const lost = rNew.lessThan(R_IN * 0.75).or(rNew.greaterThan(R_OUT * 2.5)).or(captured.greaterThanEqual(0));

    If(captured.greaterThanEqual(0), () => {
      const base = captured.mul(4);
      atomicAdd(eAccum.element(base), uint(1));
      atomicAdd(eAccum.element(base.add(1)), V.w.toUint());
      atomicAdd(eAccum.element(base.add(2)), P.w.mul(64.0).toUint());
    });

    // Impact géant récent : une fraction des grains est arrachée et projetée
    // depuis le point d'impact (nuage de débris chauds).
    const eject = int(-1).toVar();
    Loop({ start: 0, end: NIMP, type: 'int', name: 'k' }, ({ k }) => {
      const I = impInfo.element(k);
      If(I.z.greaterThan(0.5), () => {
        const ml = impPos.element(k).w.div(M_EARTH);
        const frac = clamp(ml.mul(0.012), 0.006, 0.03);
        If(hash(idx.add(I.x.mul(7919.0).toUint())).lessThan(frac), () => { eject.assign(k); });
      });
    });

    const H = pHeat.element(idx);
    If(eject.greaterThanEqual(0), () => {
      const I = impInfo.element(eject);
      const IP = impPos.element(eject);
      const s = I.y.toInt();
      const Es = ePos.element(s);
      const es = eSeed(idx, I.x);
      const h1 = hash(es), h2 = hash(es.add(1)), h3 = hash(es.add(2)), h4 = hash(es.add(3));
      const ct = h1.mul(2).sub(1), st = sqrt(max(float(1).sub(ct.mul(ct)), 0)), ph = h2.mul(TAU);
      const dir = normalize(vec3(st.mul(cos(ph)), ct.mul(0.45), st.mul(sin(ph))));
      const a = max(length(IP.xz), R_IN);
      const as = max(length(Es.xz), R_IN);
      const rc = hillR(as, Es.w).mul(0.5);
      const pos = Es.xyz.add(dir.mul(rc.add(h3.mul(0.03))));
      // vitesse orbitale (circulaire) du survivant + vitesse d'éjection
      const vOrb = vec3(Es.z.negate(), 0, Es.x).div(as).mul(sqrt(float(1).div(as)));
      const vej = sqrt(float(1).div(a)).mul(mix(0.05, 0.4, h4.mul(h4)));
      const vel = vOrb.add(dir.mul(vej));
      // (limite de 8 buffers par shader : les débris prennent la provenance du lieu d'impact)
      P.assign(vec4(pos, a));
      V.assign(vec4(vel, select(a.greaterThan(U.snow), 1.0, 0.0)));
      H.assign(mix(0.7, 1.0, h3));
    }).ElseIf(lost, () => {
      H.assign(0);
      // Renaissance : la matière perdue est remplacée, pour moitié par un apport
      // du nuage parent au bord externe, pour moitié dans tout le disque.
      const sseed = idx.mul(4).add(U.frame.mul(747796405)).add(eAct.element(M * 2).y.toUint().mul(2891336453)).add(uint(12345));
      const rA = select(hash(sseed.add(7)).lessThan(U.infall), float(R_OUT * 0.82), float(R_IN * 1.2));
      writeParticle(idx, sseed, rA, R_OUT);
    }).Else(() => {
      P.assign(vec4(p, P.w));
      // En deçà de la ligne des glaces, la glace d'un caillou qui dérive vers
      // l'intérieur se sublime : il n'apporte plus que de la roche.
      // (Il garde son rayon de naissance : la lignée reste visible.)
      V.assign(vec4(v, select(R.lessThan(U.snow.mul(0.95)), 0.0, V.w)));
      If(H.greaterThan(0.0), () => { // la quasi-totalité des grains est froide : pas d'écriture
        H.assign(select(H.greaterThan(0.004), H.mul(exp(U.dt.mul(-0.55))), 0.0));
      });
    });
  })().compute(N, [PARTICLE_WG]);

  // Les éjecta ne sont émis qu'une fois, au premier sous-pas qui suit l'impact.
  const clearEjecta = Fn(() => {
    impInfo.element(instanceIndex).z.assign(0);
  })().compute(NIMP, [NIMP]);

  // ── Liste compacte des embryons actifs (un thread, 64 itérations) ───────────
  const buildActive = Fn(() => {
    const n = int(0).toVar();
    Loop({ start: 0, end: M, type: 'int', name: 'j' }, ({ j }) => {
      const E = ePos.element(j);
      If(E.w.greaterThan(0.0), () => {
        const aj = length(E.xz);
        const amp = smoothstep(0.35, 1.0, E.w.div(isoMassAt(aj))).mul(U.eta).mul(4.0);
        eAct.element(n.mul(2)).assign(vec4(E.xyz, gmass(E.w)));
        eAct.element(n.mul(2).add(1)).assign(vec4(aj.mul(1.18), amp, eVel.element(j).w, j.toFloat()));
        n.addAssign(1);
      });
    });
    // .y : compteur de sous-pas (graine aléatoire différente à chaque sous-pas)
    const sub = eAct.element(M * 2).y;
    eAct.element(M * 2).assign(vec4(n.toFloat(), select(sub.greaterThan(1.0e6), 0.0, sub.add(1.0)), 0, 0));
  })().compute(1, [1]);

  // ── Embryons : forces ──────────────────────────────────────────────────────
  const embryoForces = Fn(() => {
    const i = int(instanceIndex);
    const E = ePos.element(i);
    If(E.w.greaterThan(0.0), () => {
      const p = E.xyz;
      const v = eVel.element(i).xyz;
      const r2 = dot(p, p);
      const r = sqrt(r2);
      const acc = p.negate().div(r2.mul(r)).toVar();
      Loop({ start: 0, end: M, type: 'int', name: 'k' }, ({ k }) => {
        const F = ePos.element(k);
        If(F.w.greaterThan(0.0).and(k.notEqual(i)), () => {
          const d = F.xyz.sub(p);
          const d2 = dot(d, d).add(1.0e-4);
          acc.addAssign(d.mul(gmass(F.w).div(d2.mul(sqrt(d2)))));
        });
      });
      const dw = U.wellPos.sub(p);
      const dw2 = dot(dw, dw).add(0.04);
      acc.addAssign(dw.mul(U.wellMass.div(dw2.mul(sqrt(dw2)))));
      const df = U.flyPos.sub(p);
      const df2 = dot(df, df).add(0.02);
      acc.addAssign(df.mul(U.flyMass.div(df2.mul(sqrt(df2)))));

      // Amortissement par le gaz vers l'orbite circulaire + migration de type I
      const R = max(length(p.xz), 1e-3);
      const tang = vec3(p.z.negate(), 0, p.x).div(R);
      const vCirc = tang.mul(sqrt(float(1).div(R)));
      acc.addAssign(vCirc.sub(v).div(U.tauDamp));
      acc.subAssign(tang.mul(gmass(E.w).mul(U.migK).div(R)));
      eAcc.element(i).assign(vec4(acc, 0));
    });
  })().compute(M, [64]);

  const embryoIntegrate = Fn(() => {
    const i = int(instanceIndex);
    const E = ePos.element(i);
    If(E.w.greaterThan(0.0), () => {
      const Vv = eVel.element(i);
      const v = Vv.xyz.add(eAcc.element(i).xyz.mul(U.dtE)).toVar();
      const p = E.xyz.add(v.mul(U.dtE)).toVar();
      const r = length(p);
      If(r.lessThan(R_IN * 0.5).or(r.greaterThan(40.0)), () => {
        E.assign(vec4(p, 0.0));
      }).Else(() => {
        E.assign(vec4(p, E.w));
        Vv.assign(vec4(v, Vv.w));
      });
    });
  })().compute(M, [64]);

  // Empile une couche dans la mémoire d'une planète (type : 0 accrétion,
  // 2 embryon initial, 3 gaz, ≥ 10 matière d'un impacteur — 10 + n° d'impact,
  // + 0,5 pour son gaz). Si la pile est pleine, on fusionne la paire de
  // couches voisines la plus légère, de préférence de même nature : les gros
  // événements (impacts, enveloppe) restent lisibles, l'embryon initial aussi.
  function pushLayer(i, layer) {
    const info = eInfo.element(i);
    const n = info.w.toInt().toVar();
    If(n.greaterThanEqual(L), () => {
      const best = int(1).toVar();
      const bc = float(1e30).toVar();
      Loop({ start: 1, end: L - 1, type: 'int', name: 'q' }, ({ q }) => {
        const A = eLayers.element(i.mul(L).add(q)), B = eLayers.element(i.mul(L).add(q.add(1)));
        const cost = A.x.add(B.x).mul(select(A.w.equal(B.w), 1.0, 6.0));
        If(cost.lessThan(bc), () => { bc.assign(cost); best.assign(q); });
      });
      const a = eLayers.element(i.mul(L).add(best)).toVar();
      const b = eLayers.element(i.mul(L).add(best.add(1))).toVar();
      const mt = max(a.x.add(b.x), 1e-20);
      const same = a.w.equal(b.w);
      const heavy = select(a.x.greaterThanEqual(b.x), a, b);
      eLayers.element(i.mul(L).add(best)).assign(vec4(
        mt,
        select(same, a.x.mul(a.y).add(b.x.mul(b.y)).div(mt), heavy.y),
        select(same, a.x.mul(a.z).add(b.x.mul(b.z)).div(mt), heavy.z),
        heavy.w,
      ));
      Loop({ start: best.add(1), end: int(L - 1), type: 'int', name: 'q2', condition: '<' }, ({ q2 }) => {
        eLayers.element(i.mul(L).add(q2)).assign(eLayers.element(i.mul(L).add(q2.add(1))));
      });
      n.assign(L - 1);
    });
    eLayers.element(i.mul(L).add(n)).assign(layer);
    info.w.assign(n.add(1).toFloat());
  }

  // ── Embryons : accrétion des grains capturés + stratigraphie ───────────────
  const embryoAccrete = Fn(() => {
    const i = int(instanceIndex);
    const base = i.mul(4);
    const cnt = atomicLoad(eAccum.element(base)).toVar();
    const cIce = atomicLoad(eAccum.element(base.add(1))).toVar();
    const cR = atomicLoad(eAccum.element(base.add(2))).toVar();
    atomicStore(eAccum.element(base), uint(0));
    atomicStore(eAccum.element(base.add(1)), uint(0));
    atomicStore(eAccum.element(base.add(2)), uint(0));

    const E = ePos.element(i);
    If(E.w.greaterThan(0.0), () => {
      const dm = cnt.toFloat().mul(U.mp);
      const dIce = cIce.toFloat().mul(U.mp);
      const dR = cR.toFloat().div(64.0).mul(U.mp);
      const m = E.w.add(dm).toVar();
      E.w.assign(m);

      const info = eInfo.element(i);
      info.x.addAssign(dm);
      info.y.addAssign(dIce);
      info.z.addAssign(dR);

      const T = eTot.element(i);
      T.x.addAssign(dIce);
      T.y.addAssign(dR);
      T.z.assign(mix(T.z, dm.div(M_EARTH).div(max(U.frameDt, 1e-4)), 0.04)); // (jamais ÷ 0 : un NaN ici blanchit l'écran via le bloom)

      If(U.layerTick.equal(uint(1)).and(info.x.greaterThan(0.0)), () => {
        const lm = info.x.toVar();
        pushLayer(i, vec4(lm, info.y.div(lm), info.z.div(lm), 0.0));
        info.x.assign(0); info.y.assign(0); info.z.assign(0);
      });

      // Capture du gaz : au-delà de la masse critique, le cœur s'entoure d'une
      // enveloppe (emballement), limitée par l'ouverture d'un sillon et par
      // le gaz qui reste dans le disque.
      const G = eGas.element(i);
      const a = max(length(E.xz), R_IN);
      // (gaz capté → couche de type 3)
      If(m.greaterThan(U.mCrit).and(U.gasAvail.greaterThan(0.0)), () => {
        const mMax = pow(a, 0.4).mul(260.0 * M_EARTH);
        const Om = pow(a, -1.5);
        const dmg = m.mul(U.gasK).mul(Om).mul(U.frameDt).mul(U.gasAvail)
          .mul(smoothstep(U.mCrit, U.mCrit.mul(2.0), m))
          .mul(clamp(float(1).sub(m.div(mMax)), 0.0, 1.0))
          // disque interne chaud : l'enveloppe se refroidit mal et grossit
          // très lentement → on y garde surtout des planètes rocheuses
          .mul(smoothstep(1.2, U.snow, a).mul(0.985).add(0.015));
        m.addAssign(dmg);
        E.w.assign(m);
        G.x.addAssign(dmg);
        G.y.addAssign(dmg);
      });
      If(U.layerTick.equal(uint(1)).and(G.x.greaterThan(0.0)), () => {
        pushLayer(i, vec4(G.x, 0.0, 0.0, 3.0));
        G.x.assign(0);
      });

      eVel.element(i).w.assign(captureRadius(a, m));
    });
  })().compute(M, [64]);

  // ── Embryons : fusions ─────────────────────────────────────────────────────
  // 1) détection en parallèle (un thread par embryon, il cherche un partenaire
  //    plus loin dans la liste) — c'était 2 016 paires sur UN thread, ~2 ms ;
  // 2) résolution sur un thread, seulement pour les rares candidats.
  // Rayon de fusion : mergeK × somme des rayons de Hill (cf. hillR).
  const mergeDetect = Fn(() => {
    const a = int(instanceIndex);
    const A = ePos.element(a);
    const found = int(-1).toVar();
    If(A.w.greaterThan(0.0), () => {
      const ra = hillR(length(A.xz), A.w).toVar();
      Loop({ start: a.add(1), end: int(M), type: 'int', name: 'b', condition: '<' }, ({ b }) => {
        const B = ePos.element(b);
        If(B.w.greaterThan(0.0).and(found.lessThan(0)), () => {
          const d = length(A.xyz.sub(B.xyz));
          If(d.lessThan(ra.add(hillR(length(B.xz), B.w)).mul(U.mergeK)), () => { found.assign(b); });
        });
      });
    });
    mergeW.element(a).x.assign(found.toFloat());
  })().compute(M, [64]);

  const embryoMerge = Fn(() => {
    Loop({ start: 0, end: M, type: 'int', name: 'a' }, ({ a }) => {
      const bIdx = mergeW.element(a).x.toInt();
      If(bIdx.greaterThanEqual(0), () => {
        const b = bIdx;
        const A = ePos.element(a), B = ePos.element(b);
        If(A.w.greaterThan(0.0).and(B.w.greaterThan(0.0)), () => {
          const d = length(A.xyz.sub(B.xyz));
          // rayon de fusion : fraction des sphères de Hill (indépendant de l'isolation)
          const rm = hillR(length(A.xz), A.w).add(hillR(length(B.xz), B.w)).mul(U.mergeK);
          If(d.lessThan(rm), () => {
            const aHeavy = A.w.greaterThanEqual(B.w);
            const h = select(aHeavy, a, b).toVar();
            const l = select(aHeavy, b, a).toVar();
            const H = ePos.element(h), Lw = ePos.element(l);
            const HV = eVel.element(h), LV = eVel.element(l);
            const mh = H.w.toVar(), ml = Lw.w.toVar();
            // centre de masse et quantité de mouvement conservés (sur la masse totale) ;
            // ~8 % de l'impacteur part ensuite en débris
            const msum = mh.add(ml).toVar();
            const pos = H.xyz.mul(mh).add(Lw.xyz.mul(ml)).div(msum).toVar();
            const vel = HV.xyz.mul(mh).add(LV.xyz.mul(ml)).div(msum).toVar();
            const mt = mh.add(ml.mul(0.92)).toVar();

            // Fige la couche en cours du survivant puis ajoute la couche « impact »
            const info = eInfo.element(h);
            If(info.x.greaterThan(0.0), () => {
              const lm = info.x.toVar();
              pushLayer(h, vec4(lm, info.y.div(lm), info.z.div(lm), 0.0));
              info.x.assign(0); info.y.assign(0); info.z.assign(0);
            });
            const TL = eTot.element(l);
            // L'impacteur apporte toute sa propre histoire : ses couches sont
            // recopiées (du cœur vers la surface) comme un groupe « impact ».
            const meta0 = impMeta.element(0);
            const gid = meta0.x.add(11.0).toVar(); // 10 + n° de cet impact
            const nl = eInfo.element(l).w.toInt().toVar();
            Loop({ start: int(0), end: nl, type: 'int', name: 'c', condition: '<' }, ({ c }) => {
              const Ly = eLayers.element(l.mul(L).add(c)).toVar();
              const isGas = Ly.w.equal(3.0).or(Ly.w.sub(floor(Ly.w)).greaterThan(0.25));
              pushLayer(h, vec4(Ly.x.mul(0.92), Ly.y, Ly.z, select(isGas, gid.add(0.5), gid)));
            });
            // (plus la matière qu'il accrétait au moment du choc)
            const IL = eInfo.element(l);
            If(IL.x.greaterThan(0.0), () => {
              pushLayer(h, vec4(IL.x.mul(0.92), IL.y.div(IL.x), IL.z.div(IL.x), gid));
            });
            const TH = eTot.element(h);
            TH.x.addAssign(TL.x.mul(0.92));
            TH.y.addAssign(TL.y.mul(0.92));
            const GH = eGas.element(h), GL = eGas.element(l);
            GH.y.addAssign(GL.y.mul(0.92));
            GL.assign(vec4(0));

            // Enregistre l'impact (anneau circulaire) pour le rendu et le son
            const meta = impMeta.element(0);
            const serial = meta.x.add(1.0);
            meta.x.assign(serial);
            const slot = serial.sub(floor(serial.div(NIMP)).mul(NIMP)).toInt();
            impPos.element(slot).assign(vec4(pos, ml));
            impInfo.element(slot).assign(vec4(serial, h.toFloat(), 1.0, l.toFloat()));
            TH.z.addAssign(ml.div(M_EARTH).mul(20.0));
            TH.w.addAssign(1.0);

            H.assign(vec4(pos, mt));
            HV.assign(vec4(vel, captureRadius(length(pos.xz), mt)));
            Lw.w.assign(0.0);
          });
        });
      });
    });
  })().compute(1, [1]);

  // ── Semer un embryon (un thread) ───────────────────────────────────────────
  const spawnEmbryo = Fn(() => {
    const i = U.spawnIdx;
    const p = U.spawnPos;
    const R = max(length(p.xz), R_IN);
    const tang = vec3(p.z.negate(), 0, p.x).div(R);
    const m = U.spawnMass;
    const ice = select(R.greaterThan(U.snow), 1.0, 0.0);
    ePos.element(i).assign(vec4(p, m));
    eVel.element(i).assign(vec4(tang.mul(sqrt(float(1).div(R))), captureRadius(R, m)));
    eInfo.element(i).assign(vec4(0, 0, 0, 1));
    eTot.element(i).assign(vec4(ice.mul(m), R.mul(m), 0, 0));
    eGas.element(i).assign(vec4(0));
    eLayers.element(i.mul(L)).assign(vec4(m, ice, R, 2.0));
  })().compute(1, [1]);

  // ── Grille polaire : densité, profondeur optique, tête de lecture ──────────
  const clearGrid = Fn(() => {
    atomicStore(grid.element(instanceIndex), uint(0));
  })().compute(NR * NPHI, [256]);

  const depositGrid = Fn(() => {
    const p = pPos.element(instanceIndex).xyz;
    atomicAdd(grid.element(cellOf(p)), uint(1));
  })().compute(N, [PARTICLE_WG]);

  // Profondeur optique cumulée depuis l'étoile, le long de chaque rayon.
  const opticalDepth = Fn(() => {
    const ip = int(instanceIndex);
    const t = float(0).toVar();
    Loop({ start: 0, end: NR, type: 'int', name: 'r' }, ({ r }) => {
      const c = ip.add(r.mul(NPHI));
      tau.element(c).assign(t);
      const rr = r.toFloat().add(0.5).mul((R_GRID - R_IN) / NR).add(R_IN);
      const n = atomicLoad(grid.element(c)).toVar();
      t.addAssign(n.toFloat().mul(U.kappa).div(pow(rr, 2.25)));
    });
  })().compute(NPHI, [64]);

  // La tête de lecture est fixe (φ = 0) : c'est le disque qui tourne dessous,
  // comme un vinyle. Densité lue sur 5 secteurs, normalisée par la surface.
  const readNeedle = Fn(() => {
    const r = int(instanceIndex);
    const s = float(0).toVar();
    Loop({ start: -2, end: 3, type: 'int', name: 'o' }, ({ o }) => {
      const ip = o.add(NPHI / 2);
      s.addAssign(atomicLoad(grid.element(r.mul(NPHI).add(ip))).toFloat());
    });
    const rr = r.toFloat().add(0.5).mul((R_GRID - R_IN) / NR).add(R_IN);
    needle.element(r).assign(s.div(rr));
  })().compute(NR, [64]);

  // ── Embryons initiaux (CPU, une fois) ──────────────────────────────────────
  function seedEmbryos(count = 40) {
    const P = ePos.value.array, V = eVel.value.array, I = eInfo.value.array;
    const T = eTot.value.array, Ly = eLayers.value.array;
    for (let i = 0; i < count; i++) {
      const a = Math.exp(Math.log(0.55) + (Math.log(7.5) - Math.log(0.55)) * (i + Math.random() * 0.8) / count);
      const ph = Math.random() * TAU;
      const m = M_EARTH * Math.exp(Math.log(0.02) + Math.random() * Math.log(10)); // 0.02–0.2 M⊕
      const ice = a > U.snow.value ? 1 : 0;
      const v = Math.sqrt(1 / a);
      P.set([a * Math.cos(ph), (Math.random() - 0.5) * 0.005, a * Math.sin(ph), m], i * 4);
      const gm = m * (1 + (U.boost.value - 1) / (1 + m / (3 * M_EARTH)));
      const rc = U.fHill.value * a * Math.cbrt(gm / 3);
      V.set([-Math.sin(ph) * v, 0, Math.cos(ph) * v, rc], i * 4);
      I.set([0, 0, 0, 1], i * 4);
      T.set([ice * m, a * m, 0, 0], i * 4);
      Ly.set([m, ice, a, 2], i * L * 4);
    }
    for (const b of [ePos, eVel, eInfo, eTot, eLayers]) b.value.needsUpdate = true;
  }

  // ── API ────────────────────────────────────────────────────────────────────
  let frame = 0;
  const sim = {
    N, U, buffers: { pPos, pVel, pHeat, ePos, eVel, eInfo, eTot, eGas, eLayers, tau, needle, grid },
    // pas maximal des grains (≥ 100 pas par orbite au bord interne du disque)
    maxDtP: 0.011,

    async init() {
      seedEmbryos();
      await renderer.computeAsync(initParticles);
      await renderer.computeAsync([clearGrid, depositGrid, opticalDepth, readNeedle]);
    },

    // Avance la simulation de frameTime (unités de temps) en UNE soumission.
    // Les grains (1 M, coûteux) prennent des pas ≤ maxDtP ; les embryons
    // (64, quasi gratuits) font 2 sous-pas par pas de grains, pour la précision
    // des rencontres proches. Retourne le temps effectivement simulé.
    step(frameTime, layerTick) {
      frameTime = Math.max(0, frameTime);
      const nP = Math.max(1, Math.ceil(frameTime / this.maxDtP - 1e-9));
      U.dt.value = frameTime / nP;
      U.dtE.value = frameTime / nP / 2;
      U.frameDt.value = frameTime;
      const list = [];
      for (let s = 0; s < nP; s++) {
        list.push(buildActive, stepParticles);
        if (s === 0) list.push(clearEjecta);
        list.push(embryoForces, embryoIntegrate, embryoForces, embryoIntegrate);
      }
      U.layerTick.value = layerTick ? 1 : 0;
      list.push(embryoAccrete, mergeDetect, embryoMerge);
      list.push(clearGrid, depositGrid, opticalDepth, readNeedle);
      U.frame.value = ++frame;
      renderer.compute(list);
      return frameTime;
    },

    spawn(index, pos, mass) {
      U.spawnIdx.value = index;
      U.spawnPos.value.copy(pos);
      U.spawnMass.value = mass;
      renderer.compute(spawnEmbryo);
    },

    // Lectures asynchrones (petites) pour l'UI et le son
    async readEmbryos() {
      const bufs = [ePos, eVel, eTot, eInfo, eGas, imp];
      const [p, v, t, inf, g, im] = (await Promise.all(bufs.map((b) => renderer.getArrayBufferAsync(b.value)))).map((b) => new Float32Array(b));
      return { pos: p, vel: v, tot: t, info: inf, gas: g, impPos: im.subarray(0, NIMP * 4), impInfo: im.subarray(NIMP * 4) };
    },
    // Position + vitesse des embryons (2 ko), lue à chaque image pour la caméra
    async readKinematics() {
      const [p, v] = await Promise.all([ePos, eVel].map((b) => renderer.getArrayBufferAsync(b.value)));
      return { pos: new Float32Array(p), vel: new Float32Array(v) };
    },
    async readLayers() {
      return new Float32Array(await renderer.getArrayBufferAsync(eLayers.value));
    },
    async readNeedle() {
      return new Float32Array(await renderer.getArrayBufferAsync(needle.value));
    },
  };
  return sim;
}
