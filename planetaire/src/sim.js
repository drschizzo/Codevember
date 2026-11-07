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
  sin, log, pow, floor, abs, mx_fractal_noise_float,
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

  const grid = instancedArray(NR * NPHI + 1, 'uint').toAtomic(); // + compteur de grains actifs
  const tau = instancedArray(NR * NPHI, 'float');
  const needle = instancedArray(NR + 1, 'float'); // [NR] = nombre de grains actifs

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
    // ── Cycle de vie (piloté par lifecycle.js) ──
    Ms: uniform(1.0),            // masse centrale (G·M) : baisse quand l'étoile perd sa masse
    gasDens: uniform(1.0),       // densité relative du gaz du disque (0 = dissipé)
    clearOn: uniform(0.0),       // dissipation du disque en cours
    clearR: uniform(0.0),        // front de dissipation intérieur (UA), progresse vers l'extérieur
    clearR2: uniform(1.0e3),     // front extérieur, progresse vers l'intérieur (balaye disque externe et restes de l'enveloppe)
    beltLoss: uniform(0.0),      // érosion collisionnelle (fraction retirée par unité de temps)
    starR: uniform(0.0),         // rayon physique de l'étoile (géante rouge : engloutit)
    snA: uniform(0.0),           // onde de choc de supernova : amplitude,
    snR: uniform(0.0),           //   rayon,
    snW: uniform(1.0),           //   épaisseur
    outR: uniform(29.0),         // au-delà, un grain a quitté le système
    snHeat: uniform(0.0),        // le choc chauffe à blanc ce qu'il traverse
    ejV: uniform(2.7),           // vitesse des éjecta de la supernova (UA / unité de temps)
    cycleSeed: uniform(0, 'uint'),
    cloudR: uniform(14.0),       // nuage initial : rayon (UA),
    cloudOmega: uniform(0.0153), //   rotation solide (le bord tombe vers ~9 UA),
    cloudTurb: uniform(0.03),    //   vitesses turbulentes
    // Versement du nuage par la trémie de la machine (DA mécanique) : chaque
    // grain attend son tour (chaleur négative = −heure de départ), vole de la
    // buse jusqu'à sa place (trajectoire dessinée par visuals.js), puis seulement
    // entre dans la dynamique. Le nuage se remplit de bas en haut.
    pourOn: uniform(0.0),
    pourT: uniform(1.0e9),       // temps écoulé depuis le début du versement
    pourDur: uniform(13.0),      // durée d'ouverture de la vanne
    pourFly: uniform(2.4),       // durée du vol buse → place
    hopper: uniform(new THREE.Vector3(0, 9.3, 0)), // buse
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
  const hillR = (a, m) => U.fHill.mul(a).mul(pow(gmass(m).div(U.Ms.mul(3.0)), 1 / 3));
  // Au-delà de la masse d'isolation, la planète ouvre un piège de pression :
  // elle n'avale presque plus de cailloux (ils s'accumulent en anneau).
  const captureRadius = (a, m) => hillR(a, m)
    .mul(mix(1.0, 0.04, smoothstep(0.8, 1.6, m.div(isoMassAt(a)))));

  // ── Nuage initial (effondrement) ───────────────────────────────────────────
  // Sphère en rotation solide, turbulente et grumeleuse. Chaque grain conserve
  // son moment cinétique en tombant : il rejoint le disque à son rayon
  // centrifuge r = Ω² R⊥⁴ / GM (modèle d'Ulrich / Cassen-Moosman), qui devient
  // son « lieu de naissance » (provenance). Les plus proches de l'axe tombent
  // directement sur l'étoile et la nourrissent.
  const initCloud = Fn(() => {
    const idx = instanceIndex;
    const sd = idx.mul(7).add(U.cycleSeed);
    const h1 = hash(sd), h2 = hash(sd.add(1)), h3 = hash(sd.add(2));
    const h4 = hash(sd.add(3)), h5 = hash(sd.add(4));
    // 45 % des grains dans ~400 grumeaux (densités du nuage turbulent)
    const inClump = h4.lessThan(0.45);
    const cid = floor(h5.mul(400.0)).toUint().add(U.cycleSeed.mul(31));
    const cc = vec3(hash(cid.mul(3)).sub(0.5), hash(cid.mul(3).add(1)).sub(0.5), hash(cid.mul(3).add(2)).sub(0.5)).mul(2.0);
    const ct = h2.mul(2).sub(1), stt = sqrt(max(float(1).sub(ct.mul(ct)), 0)), ph = h3.mul(TAU);
    const dirU = vec3(stt.mul(cos(ph)), ct, stt.mul(sin(ph)));
    const uni = dirU.mul(pow(h1, 1 / 3));
    const clump = normalize(cc).mul(pow(clamp(length(cc), 0.0, 1.0), 0.33)).add(dirU.mul(h1.mul(0.12)));
    const q = select(inClump, clump, uni).mul(U.cloudR);
    const Rp = length(q.xz);
    // vitesse : rotation solide + turbulence
    const turbV = vec3(hash(sd.add(9)).sub(0.5), hash(sd.add(10)).sub(0.5), hash(sd.add(11)).sub(0.5)).mul(U.cloudTurb);
    const vel = vec3(q.z.negate(), 0, q.x).mul(U.cloudOmega).add(turbV);
    const rLand = U.cloudOmega.mul(U.cloudOmega).mul(Rp.mul(Rp).mul(Rp.mul(Rp)));
    pPos.element(idx).assign(vec4(q, clamp(rLand, 0.05, R_OUT * 1.4)));
    pVel.element(idx).assign(vec4(vel, 1.0)); // nuage froid : grains glacés
    // heure de départ : du bas vers le haut du nuage, un peu mélangée
    const fill = q.y.div(U.cloudR).mul(0.5).add(0.5).clamp(0.0, 1.0);
    const tGo = U.pourDur.mul(fill.mul(0.8).add(hash(sd.add(12)).mul(0.2)));
    pHeat.element(idx).assign(select(U.pourOn.greaterThan(0.5), tGo.add(1.0e-3).negate(), float(0)));
  })().compute(N, [PARTICLE_WG]);

  // ── Pas de temps des grains ────────────────────────────────────────────────
  // Un grain inactif (avalé par une planète, tombé dans l'étoile, soufflé hors
  // du système) a P.w < 0 : il n'est plus ni simulé ni dessiné. Le disque est
  // fini et se vide pour de bon.
  const stepParticles = Fn(() => {
    const idx = instanceIndex;
    const P = pPos.element(idx);
    const V = pVel.element(idx);
    const H = pHeat.element(idx);

    // Impact géant récent : une fraction des grains (de préférence inactifs,
    // donc recyclés) est projetée depuis le point d'impact.
    const eject = int(-1).toVar();
    Loop({ start: 0, end: NIMP, type: 'int', name: 'k' }, ({ k }) => {
      const I = impInfo.element(k);
      If(I.z.greaterThan(0.5), () => {
        const ml = impPos.element(k).w.div(M_EARTH);
        const frac = clamp(ml.mul(0.012), 0.006, 0.03);
        If(hash(idx.add(I.x.mul(7919.0).toUint())).lessThan(frac), () => { eject.assign(k); });
      });
    });

    // grain encore dans la trémie ou en vol : figé ; arrivé, il est lâché
    If(H.lessThan(0.0).and(U.pourT.greaterThanEqual(H.negate().add(U.pourFly))), () => { H.assign(0); });

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
      const vOrb = vec3(Es.z.negate(), 0, Es.x).div(as).mul(sqrt(U.Ms.div(as)));
      const vej = sqrt(U.Ms.div(a)).mul(mix(0.05, 0.4, h4.mul(h4)));
      // (limite de 8 buffers par shader : les débris prennent la provenance du lieu d'impact)
      P.assign(vec4(pos, a));
      V.assign(vec4(vOrb.add(dir.mul(vej)), select(a.greaterThan(U.snow), 1.0, 0.0)));
      H.assign(mix(0.7, 1.0, h3));
    }).ElseIf(P.w.greaterThanEqual(0.0).and(H.greaterThanEqual(0.0)), () => {
      const p = P.xyz.toVar();
      const v = V.xyz.toVar();

      const r2 = dot(p, p);
      const r = sqrt(r2);
      const R = max(length(p.xz), 1e-3).toVar();
      const acc = p.negate().mul(U.Ms.div(r2.mul(r))).toVar();
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

      const st = stokesOf(idx);
      // Dissipation (après la disparition du gaz), de l'intérieur vers l'extérieur :
      // les petits grains sont soufflés par la pression de radiation (β > ½ :
      // ils ne sont plus liés), les gros spiralent vers l'étoile (Poynting-
      // Robertson). Au-delà du front, il reste une ceinture de débris.
      // Deux fronts se rejoignent sur la ceinture de débris : l'un part de
      // l'étoile, l'autre balaie le disque externe et les restes de l'enveloppe.
      const clrIn = U.clearOn.mul(smoothstep(U.clearR, U.clearR.mul(0.85), R));
      const clrOut = U.clearOn.mul(smoothstep(U.clearR2, U.clearR2.mul(1.15), r));
      If(clrIn.greaterThan(0.0), () => {
        If(st.lessThan(0.2), () => {
          // poussière fine : β ≈ 0,6 → plus liée, elle dérive doucement vers l'extérieur
          acc.addAssign(p.mul(U.Ms.mul(0.6).mul(clrIn).div(r2.mul(r))));
        }).Else(() => {
          // gros grains : frein TANGENTIEL (Poynting-Robertson) → ils spiralent vers l'étoile
          const tg = vec3(p.z.negate(), 0, p.x).div(R);
          v.subAssign(tg.mul(dot(v, tg)).mul(clrIn.mul(U.dt).mul(float(0.05).div(R))));
        });
      });
      If(clrOut.greaterThan(0.0), () => {
        acc.addAssign(p.mul(U.Ms.mul(1.4).mul(clrOut).div(r2.mul(r)))); // nettement non liés : ils s'en vont
      });
      // érosion collisionnelle : broyés en poussière fine, les grains disparaissent
      // (lentement dans la ceinture, plus vite dans les zones déjà balayées)
      const erode = U.beltLoss.add(clrIn.max(clrOut).mul(0.07)).mul(U.dt);
      const eroded = hash(idx.mul(3).add(eAct.element(M * 2).y.toUint().mul(2246822519))).lessThan(erode);
      // Onde de choc de la supernova : coquille qui balaie tout vers l'extérieur
      const xs = r.sub(U.snR).div(U.snW);
      acc.addAssign(p.div(r).mul(U.snA.mul(exp(xs.mul(xs).negate()))));

      // Gaz : rotation sub-képlérienne + relaxation exacte (exp) vers sa vitesse.
      // Le gaz n'est présent qu'au voisinage du plan du disque (dans l'enveloppe
      // en effondrement, les grains tombent en chute libre) et s'évanouit
      // quand le disque se dissipe.
      const Omega = sqrt(U.Ms).div(R.mul(sqrt(R)));
      const vK = sqrt(U.Ms.div(R));
      const tang = vec3(p.z.negate(), 0, p.x).div(R);
      const vGas = tang.mul(vK.mul(float(1).sub(etaEff)));
      const zH = p.y.div(diskH(R).mul(1.5).max(0.01));
      const gasW = U.gasDens.mul(exp(zH.mul(zH).mul(-0.5)));
      const ts = st.div(Omega);

      v.addAssign(acc.mul(U.dt));
      v.assign(vGas.add(v.sub(vGas).mul(exp(U.dt.mul(gasW).div(ts).negate()))));

      // Turbulence du gaz (marche aléatoire)
      const seed = idx.mul(8).add(eAct.element(M * 2).y.toUint().mul(1664525));
      const kick = vec3(hash(seed).sub(0.5), hash(seed.add(1)).sub(0.5).mul(0.6), hash(seed.add(2)).sub(0.5));
      v.addAssign(kick.mul(U.turb).mul(vK).mul(sqrt(U.dt.mul(Omega))).mul(gasW.mul(3.0)));

      p.addAssign(v.mul(U.dt));

      const rNew = length(p);
      If(captured.greaterThanEqual(0), () => {
        const base = captured.mul(4);
        atomicAdd(eAccum.element(base), uint(1));
        atomicAdd(eAccum.element(base.add(1)), V.w.toUint());
        atomicAdd(eAccum.element(base.add(2)), P.w.mul(64.0).toUint());
      });
      const lost = rNew.lessThan(max(float(R_IN * 0.75), U.starR)).or(rNew.greaterThan(U.outR)).or(captured.greaterThanEqual(0)).or(eroded);
      // l'onde de choc de la supernova chauffe à blanc les grains qu'elle traverse
      If(U.snHeat.greaterThan(0.0), () => { H.assign(max(H, exp(xs.mul(xs).negate()).mul(U.snHeat))); });
      If(lost, () => {
        P.assign(vec4(p, -1.0)); // retiré pour de bon
        H.assign(0);
      }).Else(() => {
        P.assign(vec4(p, P.w));
        // En deçà de la ligne des glaces, la glace d'un caillou se sublime
        // (il garde son rayon de naissance : la lignée reste visible).
        V.assign(vec4(v, select(R.lessThan(U.snow.mul(0.95)), 0.0, V.w)));
        If(H.greaterThan(0.0), () => {
          H.assign(select(H.greaterThan(0.004), H.mul(exp(U.dt.mul(-0.55))), 0.0));
        });
      });
    });
  })().compute(N, [PARTICLE_WG]);

  // ── Supernova : les grains retirés (la plupart, à ce stade) sont recyclés
  // en éjecta stellaires, lancés depuis l'étoile dans toutes les directions.
  // La vitesse dépend de la direction (bruit) : la coquille se déchire en
  // « doigts » (instabilités de Rayleigh-Taylor), comme dans les vrais rémanents.
  const snEject = Fn(() => {
    const idx = instanceIndex;
    const P = pPos.element(idx);
    If(P.w.lessThan(0.0), () => {
      const sd = idx.mul(11).add(U.cycleSeed.mul(7)).add(uint(99991));
      const h1 = hash(sd), h2 = hash(sd.add(1)), h3 = hash(sd.add(2)), h4 = hash(sd.add(3));
      If(h4.lessThan(0.85), () => {
        const ct = h1.mul(2).sub(1), stt = sqrt(max(float(1).sub(ct.mul(ct)), 0)), ph = h2.mul(TAU);
        const dir = vec3(stt.mul(cos(ph)), ct, stt.mul(sin(ph)));
        const fingers = mx_fractal_noise_float(dir.mul(3.0).add(vec3(U.cycleSeed.toFloat().mul(0.013))), 3, 2.0, 0.5);
        const speed = U.ejV.mul(fingers.mul(0.45).add(0.8).add(h3.mul(0.12)).max(0.15));
        P.assign(vec4(dir.mul(h3.mul(0.1).add(0.05)), mix(0.36, 0.5, h3)));   // provenance : cœur de l'étoile
        pVel.element(idx).assign(vec4(dir.mul(speed), 0.0));
        pHeat.element(idx).assign(float(1));
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
      const acc = p.negate().mul(U.Ms.div(r2.mul(r))).toVar();
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
      const vCirc = tang.mul(sqrt(U.Ms.div(R)));
      acc.addAssign(vCirc.sub(v).mul(U.gasDens).div(U.tauDamp)); // (pas de gaz → pas d'amortissement)
      const xs = r.sub(U.snR).div(U.snW);
      acc.addAssign(p.div(r).mul(U.snA.mul(0.6).mul(exp(xs.mul(xs).negate())))); // supernova
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
      // tombée dans l'étoile (ou engloutie par la géante rouge), ou éjectée
      If(r.lessThan(max(float(R_IN * 0.5), U.starR)).or(r.greaterThan(40.0)), () => {
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
    eVel.element(i).assign(vec4(tang.mul(sqrt(U.Ms.div(R))), captureRadius(R, m)));
    eInfo.element(i).assign(vec4(0, 0, 0, 1));
    eTot.element(i).assign(vec4(ice.mul(m), R.mul(m), 0, 0));
    eGas.element(i).assign(vec4(0));
    eLayers.element(i.mul(L)).assign(vec4(m, ice, R, 2.0));
  })().compute(1, [1]);

  // ── Grille polaire : densité, profondeur optique, tête de lecture ──────────
  const clearGrid = Fn(() => {
    If(instanceIndex.lessThan(uint(NR * NPHI + 1)), () => { atomicStore(grid.element(instanceIndex), uint(0)); });
  })().compute(NR * NPHI + 1, [256]);

  // Seuls les grains actifs et proches du plan comptent pour l'ombre du disque
  // (pas l'enveloppe du nuage qui s'effondre au-dessus).
  const depositGrid = Fn(() => {
    const P = pPos.element(instanceIndex);
    If(P.w.greaterThanEqual(0.0), () => {
      atomicAdd(grid.element(NR * NPHI), uint(1));
      const R = length(P.xz);
      If(abs(P.y).lessThan(diskH(R).mul(3.0).add(0.05)), () => {
        atomicAdd(grid.element(cellOf(P.xyz)), uint(1));
      });
    });
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
    If(r.equal(0), () => { needle.element(NR).assign(atomicLoad(grid.element(NR * NPHI)).toFloat()); });
  })().compute(NR, [64]);

  // ── Remise à zéro des embryons et des impacts (nouveau cycle) ─────────────
  // Les planètes ne sont plus semées au départ : elles naissent pendant la
  // phase de formation, là où la poussière s'accumule (cf. main.js).
  function clearEmbryos() {
    for (const b of [ePos, eVel, eAcc, eInfo, eTot, eLayers, eGas, imp, impMeta, eAct]) {
      b.value.array.fill(0);
      b.value.needsUpdate = true;
    }
  }

  // ── API ────────────────────────────────────────────────────────────────────
  let frame = 0;
  const sim = {
    N, U, buffers: { pPos, pVel, pHeat, ePos, eVel, eInfo, eTot, eGas, eLayers, tau, needle, grid },
    // pas maximal des grains (≥ 100 pas par orbite au bord interne du disque)
    maxDtP: 0.011,

    async init() {
      await this.reset(0);
    },

    // Nouveau cycle : un nuage tout neuf, plus aucune planète.
    async reset(cycle) {
      clearEmbryos();
      U.cycleSeed.value = (cycle * 2654435761) >>> 0;
      await renderer.computeAsync(initCloud);
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

    supernova() { renderer.compute(snEject); },

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
