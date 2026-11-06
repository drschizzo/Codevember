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
  const eLayers = instancedArray(M * L, 'vec4'); // masse, fraction glace, r moyen, type (0 accr, 1 impact, 2 graine)
  const eAccum = instancedArray(M * 4, 'uint').toAtomic(); // n, nGlace, Σr·64

  const grid = instancedArray(NR * NPHI, 'uint').toAtomic();
  const tau = instancedArray(NR * NPHI, 'float');
  const needle = instancedArray(NR, 'float');

  // ── Uniformes ──────────────────────────────────────────────────────────────
  const U = {
    dt: uniform(0.004),
    frame: uniform(0, 'uint'),
    eta: uniform(0.012),         // déficit de vitesse du gaz (pression)
    boost: uniform(25.0),        // amplification artistique de la gravité des embryons
    fHill: uniform(0.38),        // rayon de capture / rayon de Hill
    soft2: uniform(2.0e-4),
    mp: uniform(0.012 / N),      // masse d'un grain
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
  const gauss = (h1, h2) => sqrt(log(max(h1, 1e-7)).mul(-2)).mul(cos(h2.mul(TAU)));
  const stokesOf = (idx) => pow(10.0, mix(-2.0, 0.3, hash(idx.add(uint(918273)))));
  const isoMassAt = (a) => U.isoMass.mul(pow(a, 0.75));
  // Au-delà de la masse d'isolation, la planète ouvre un piège de pression :
  // elle n'avale presque plus de cailloux (ils s'accumulent en anneau).
  const captureRadius = (a, m) => U.fHill.mul(a).mul(pow(m.mul(U.boost).div(3.0), 1 / 3))
    .mul(mix(1.0, 0.2, smoothstep(1.0, 4.0, m.div(isoMassAt(a)))));

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

    Loop({ start: 0, end: M, type: 'int', name: 'j' }, ({ j }) => {
      const E = ePos.element(j);
      const m = E.w;
      If(m.greaterThan(0.0), () => {
        const d = E.xyz.sub(p);
        const d2 = dot(d, d);
        const d2s = d2.add(U.soft2);
        acc.addAssign(d.mul(m.mul(U.boost).div(d2s.mul(sqrt(d2s)))));
        const rc = eVel.element(j).w;
        If(d2.lessThan(rc.mul(rc)), () => { captured.assign(j); });
        // Piège de pression juste à l'extérieur des planètes massives :
        // le gaz y devient super-képlérien → les grains s'accumulent en anneau.
        const aj = length(E.xz);
        const s = smoothstep(0.35, 1.0, m.div(isoMassAt(aj)));
        const x = R.sub(aj.mul(1.18)).div(aj.mul(0.07));
        etaEff.addAssign(s.mul(U.eta).mul(4.0).mul(x).mul(exp(x.mul(x).negate())));
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
    const seed = idx.mul(8).add(U.frame.mul(1664525));
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

    If(lost, () => {
      // Renaissance : la matière perdue est remplacée, pour moitié par un apport
      // du nuage parent au bord externe, pour moitié dans tout le disque.
      const sseed = idx.mul(4).add(U.frame.mul(747796405)).add(uint(12345));
      const rA = select(hash(sseed.add(7)).lessThan(U.infall), float(R_OUT * 0.82), float(R_IN * 1.2));
      writeParticle(idx, sseed, rA, R_OUT);
    }).Else(() => {
      P.assign(vec4(p, P.w));
      V.assign(vec4(v, V.w));
    });
  })().compute(N, [PARTICLE_WG]);

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
          acc.addAssign(d.mul(F.w.mul(U.boost).div(d2.mul(sqrt(d2)))));
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
      acc.subAssign(tang.mul(E.w.mul(U.boost).mul(U.migK).div(R)));
      eAcc.element(i).assign(vec4(acc, 0));
    });
  })().compute(M, [64]);

  const embryoIntegrate = Fn(() => {
    const i = int(instanceIndex);
    const E = ePos.element(i);
    If(E.w.greaterThan(0.0), () => {
      const Vv = eVel.element(i);
      const v = Vv.xyz.add(eAcc.element(i).xyz.mul(U.dt)).toVar();
      const p = E.xyz.add(v.mul(U.dt)).toVar();
      const r = length(p);
      If(r.lessThan(R_IN * 0.5).or(r.greaterThan(40.0)), () => {
        E.assign(vec4(p, 0.0));
      }).Else(() => {
        E.assign(vec4(p, E.w));
        Vv.assign(vec4(v, Vv.w));
      });
    });
  })().compute(M, [64]);

  // Empile une couche dans la mémoire d'une planète ; si la pile est pleine,
  // elle est compressée par paires (on garde toute l'histoire, en plus grossier).
  function pushLayer(i, layer) {
    const info = eInfo.element(i);
    const n = info.w.toInt().toVar();
    If(n.greaterThanEqual(L), () => {
      Loop({ start: 0, end: L / 2, type: 'int', name: 'q' }, ({ q }) => {
        const a = eLayers.element(i.mul(L).add(q.mul(2))).toVar();
        const b = eLayers.element(i.mul(L).add(q.mul(2).add(1))).toVar();
        const mt = max(a.x.add(b.x), 1e-20);
        eLayers.element(i.mul(L).add(q)).assign(vec4(
          mt,
          a.x.mul(a.y).add(b.x.mul(b.y)).div(mt),
          a.x.mul(a.z).add(b.x.mul(b.z)).div(mt),
          max(a.w, b.w),
        ));
      });
      n.assign(L / 2);
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
      T.z.assign(mix(T.z, dm.div(M_EARTH).div(U.frameDt), 0.04));

      If(U.layerTick.equal(uint(1)).and(info.x.greaterThan(0.0)), () => {
        const lm = info.x.toVar();
        pushLayer(i, vec4(lm, info.y.div(lm), info.z.div(lm), 0.0));
        info.x.assign(0); info.y.assign(0); info.z.assign(0);
      });

      eVel.element(i).w.assign(captureRadius(length(E.xz), m));
    });
  })().compute(M, [64]);

  // ── Embryons : fusions (un seul thread, M² / 2 paires) ─────────────────────
  const embryoMerge = Fn(() => {
    Loop({ start: 0, end: M, type: 'int', name: 'a' }, ({ a }) => {
      Loop({ start: a.add(1), end: int(M), type: 'int', name: 'b', condition: '<' }, ({ b }) => {
        const A = ePos.element(a), B = ePos.element(b);
        If(A.w.greaterThan(0.0).and(B.w.greaterThan(0.0)), () => {
          const d = length(A.xyz.sub(B.xyz));
          const rm = eVel.element(a).w.add(eVel.element(b).w).mul(U.mergeK);
          If(d.lessThan(rm), () => {
            const aHeavy = A.w.greaterThanEqual(B.w);
            const h = select(aHeavy, a, b).toVar();
            const l = select(aHeavy, b, a).toVar();
            const H = ePos.element(h), Lw = ePos.element(l);
            const HV = eVel.element(h), LV = eVel.element(l);
            const mh = H.w.toVar(), ml = Lw.w.toVar();
            const mt = mh.add(ml).toVar();
            const pos = H.xyz.mul(mh).add(Lw.xyz.mul(ml)).div(mt).toVar();
            const vel = HV.xyz.mul(mh).add(LV.xyz.mul(ml)).div(mt).toVar();

            // Fige la couche en cours du survivant puis ajoute la couche « impact »
            const info = eInfo.element(h);
            If(info.x.greaterThan(0.0), () => {
              const lm = info.x.toVar();
              pushLayer(h, vec4(lm, info.y.div(lm), info.z.div(lm), 0.0));
              info.x.assign(0); info.y.assign(0); info.z.assign(0);
            });
            const TL = eTot.element(l);
            pushLayer(h, vec4(ml, TL.x.div(ml), TL.y.div(ml), 1.0));
            const TH = eTot.element(h);
            TH.x.addAssign(TL.x);
            TH.y.addAssign(TL.y);
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
      const rc = U.fHill.value * a * Math.cbrt(m * U.boost.value / 3);
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
    N, U, buffers: { pPos, pVel, ePos, eVel, eInfo, eTot, eLayers, tau, needle, grid },
    substeps: 4,

    async init() {
      seedEmbryos();
      await renderer.computeAsync(initParticles);
      await renderer.computeAsync([clearGrid, depositGrid, opticalDepth, readNeedle]);
    },

    step(layerTick) {
      const list = [];
      for (let s = 0; s < this.substeps; s++) list.push(stepParticles, embryoForces, embryoIntegrate);
      U.layerTick.value = layerTick ? 1 : 0;
      list.push(embryoAccrete, embryoMerge, clearGrid, depositGrid, opticalDepth, readNeedle);
      U.frame.value = ++frame;
      renderer.compute(list);
    },

    spawn(index, pos, mass) {
      U.spawnIdx.value = index;
      U.spawnPos.value.copy(pos);
      U.spawnMass.value = mass;
      renderer.compute(spawnEmbryo);
    },

    // Lectures asynchrones (petites) pour l'UI et le son
    async readEmbryos() {
      const [p, v, t, inf] = await Promise.all([ePos, eVel, eTot, eInfo].map((b) => renderer.getArrayBufferAsync(b.value)));
      return { pos: new Float32Array(p), vel: new Float32Array(v), tot: new Float32Array(t), info: new Float32Array(inf) };
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
