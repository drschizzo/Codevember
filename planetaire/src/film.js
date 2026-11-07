// Mode tournage (?film) : un film d'environ 3 minutes, sans texte ni interface.
//
// La boucle a un sens : la poussière d'étoile passe d'un cycle à l'autre.
//   I.   Sous la lampe, sur le velours vide, la machine se pose pièce à pièce ;
//        la trémie arrive la dernière, avec la cloche — pleine de poussière
//        d'étoile qui luit : les débris d'une étoile précédente.
//   II.  La vanne s'ouvre : le nuage, l'effondrement, les jets, l'allumage
//        (la lampe de musée baisse : l'étoile devient la lumière).
//   III. Les planètes : les motifs que les grains dessinent (vue « vinyle »,
//        rasants au téléobjectif), une planète, le peigne qu'elle pince, le
//        mécanisme ; chaque impact géant interrompt le montage, au ralenti.
//   IV.  La géante.
//   V.   La supernova, prisonnière de la cloche ; la trémie aspire les débris
//        et luit à nouveau.
//   VI.  L'horloger range la machine : les pièces remontent dans l'ordre
//        inverse, la trémie pleine part avec la cloche. Le velours vide sous
//        la lampe : la dernière image est la première — le film boucle.
//
// C'est un montage : à l'écran le temps reste à ×1–×2 ; entre deux plans la
// simulation avance hors champ, la coupe cache l'ellipse.
//
// Rendu : chaque image est la moyenne de 4 sous-images (obturateur à 180° :
// vrai flou de mouvement, anticrénelage, grains apaisés), chacune rendue en
// 2× ; tone mapping APRÈS la moyenne (lumière linéaire). Reflets réels (sonde
// cube), matériaux physiques. Encodage WebCodecs : H.264 (SDR) ou VP9 10 bits
// BT.2020 / PQ (&hdr). Le script tools/tournage.mjs écrit le fichier.
//
// Paramètres : &w=1920 &ss=2 &tss=4 &fps=24 &mbps=… &hdr &peak=5 ;
// &stills=12,40 (images fixes seulement, SDR, pour prévisualiser).

import { params as q } from './config.js';
import { ss, clamp as clamp01 } from './util.js';

const ease = (u) => ss(0, 1, u);
const easeOut = (u) => 1 - Math.pow(1 - clamp01(u), 3);

export async function startFilm(ctx) {
  const { THREE, renderer, camera, controls, state, life, vis, orrery, pred, frame } = ctx;
  const TSL = await import('three/tsl');
  const FPS = Number(q.get('fps') || 24);
  const W = Number(q.get('w') || 1920), H = Math.round((W * 9) / 16);
  const SS = Number(q.get('ss') || 2);
  const K = Math.max(1, Number(q.get('tss') || 4)); // sous-images par image
  const SHUTTER = 0.5;                              // obturateur à 180°
  const HDR = q.has('hdr');
  const STILLS = q.get('stills') ? q.get('stills').split(',').map(Number) : null;
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const O = V3(0, 0, 0), UP = V3(0, 1, 0);
  const orbit = (c, r, h, a) => V3(c.x + Math.cos(a) * r, h, c.z + Math.sin(a) * r);
  const lerp = (a, b, e) => a.clone().lerp(b, e);

  // ── État de la simulation ────────────────────────────────────────────────
  const P = () => life.phase;
  const at = (ph, t) => () => life.cycle > 0 || P() > ph || (P() === ph && (ph === 2 ? life.tIgn : life.t) >= t);
  const novaT = () => (P() === 6 ? life.t / 0.96 : -1); // secondes de supernova (à ×1)

  // ── Planète suivie / planète qui va pincer le peigne ─────────────────────
  let hero = -1, heroInit = false;
  const heroCam = V3(0, 0, 0), heroTgt = V3(0, 0, 0);
  const coFrame = (x) => { const rad = V3(x[0], 0, x[2]).normalize(); return { rad, tan: V3(-rad.z, 0, rad.x) }; };
  function heroShot(u) {
    if (hero < 0 || !pred.has(hero)) {
      const c = state.planets.filter((p) => pred.has(p.index) && p.a > 2.4 && p.a < 6.5).sort((a, b) => b.mE - a.mE);
      hero = c.length ? c[0].index : -1; heroInit = false;
    }
    const x = hero >= 0 ? pred.get(hero) : null;
    if (!x) return { p: orbit(O, 6, 2.5, 2 + 0.2 * u), t: O.clone() };
    const pl = V3(x[0], x[1], x[2]), { rad, tan } = coFrame(x);
    const s = 1.05 - 0.2 * ease(u);
    const want = pl.clone().addScaledVector(rad, 0.85 * s).addScaledVector(tan, -0.6 * s).add(V3(0, 0.3 * s, 0));
    const wantT = pl.clone().lerp(O, 0.12);
    if (!heroInit) { heroCam.copy(want); heroTgt.copy(wantT); heroInit = true; }
    heroCam.lerp(want, 0.3); heroTgt.lerp(wantT, 0.4);
    return { p: heroCam.clone(), t: heroTgt.clone() };
  }
  let combA = 4;
  const combReady = () => {
    if (life.cycle > 0 || P() > 2) return true;
    if (P() < 2 || life.tIgn < 260) return false;
    for (const p of state.planets) {
      const x = pred.get(p.index);
      if (!x || p.a < 3 || p.a > 6.5 || p.mE < 0.5) continue;
      const ang = Math.atan2(x[2], x[0]);
      if (ang > -0.42 && ang < -0.3) { combA = Math.hypot(x[0], x[2]); return true; }
    }
    return false;
  };

  // ── Impacts géants : le montage s'interrompt pour eux ────────────────────
  const events = [];
  const visImpact = vis.impact;
  const allImpacts = (window.__impacts = []);
  vis.impact = (index, pos, strength) => { events.push({ index, pos: pos.slice(), strength }); allImpacts.push([P(), +(P() === 2 ? life.tIgn : life.t).toFixed(0), +strength.toFixed(2)]); return visImpact(index, pos, strength); };
  let inserts = 0, lastInsert = -99;
  const IMPACT_MIN = 0.25; // M⊕ (masse de l'impacteur)
  const takeImpact = () => {
    const e = events.filter((x) => x.strength >= IMPACT_MIN).pop();
    events.length = 0;
    if (!e || inserts >= 3 || tFilm - lastInsert < 9) return null;
    inserts++; lastInsert = tFilm;
    return e;
  };
  function impactShot(e) {
    let init = false;
    const cam = V3(0, 0, 0), tgt = V3(0, 0, 0);
    return {
      d: 4.5, fov: 24, rate: 1.4, insert: true,
      cam: (u) => {
        const x = pred.get(e.index) || e.pos;
        const pl = V3(x[0], x[1], x[2]), { rad, tan } = coFrame(x);
        const s = 1.3 - 0.25 * easeOut(u);
        // côté étoile : la planète est éclairée de face, le disque extérieur en fond
        const want = pl.clone().addScaledVector(rad, -0.9 * s).addScaledVector(tan, 0.45 * s).add(V3(0, 0.5 * s, 0));
        if (!init) { cam.copy(want); tgt.copy(pl); init = true; }
        cam.lerp(want, 0.35); tgt.lerp(pl, 0.5);
        return { p: cam.clone(), t: tgt.clone() };
      },
    };
  }

  // ── Découpage ────────────────────────────────────────────────────────────
  // { d (s), fov, rate (unités/s à l'écran ; 1,92 = ×2 interactif) ou rateFn,
  //   hold (simulation à l'arrêt), skip (état à atteindre hors champ),
  //   impacts (le montage peut s'interrompre), still (caméra sans souffle),
  //   cam(u) → { p, t, up? } }
  const LOOP_CAM = { still: true, fov: 26, cam: () => ({ p: V3(7.6, -4.15, 9.6), t: V3(0, -3.85, 0) }) };
  const TREMIE = { fov: 22, cam: (u) => ({ p: lerp(V3(8.6, 10.6, 9.6), V3(8.3, 9.6, 9.3), ease(u)), t: lerp(V3(0, 9.6, 0), V3(0, 8.0, 0), ease(u)) }) };
  const holdAfterCollect = () => (novaT() >= 16.2 ? 0 : 0.96);
  const shots = [
    // I. L'assemblage (18 s)
    { d: 5, hold: true, ...LOOP_CAM },
    { d: 6, fov: 30, hold: true, cam: (u) => ({ p: lerp(V3(5.6, 1.4, 6.6), V3(4.8, 0.4, 5.8), ease(u)), t: V3(0, -3.3, 0) }) },
    { d: 7, fov: 30, hold: true, cam: (u) => ({ p: lerp(V3(3.5, -1.6, 23), V3(9.5, 5.5, 22), ease(u)), t: lerp(V3(0, -1.5, 0), V3(0, 2.4, 0), ease(u)) }) },
    // II. La genèse
    { d: 7, rate: 1.6, ...TREMIE },
    { d: 7, rate: 2.2, fov: 34, cam: (u) => ({ p: orbit(O, 23 - 2 * u, 8.5 - 2 * ease(u), -0.3 + 0.45 * ease(u)), t: V3(0, 1.0, 0) }) },
    { d: 6, rate: 1.6, fov: 32, skip: at(0, 36), cam: (u) => ({ p: lerp(V3(7.4, 2.8, 8.2), V3(6.2, 1.8, 7.0), ease(u)), t: V3(0, 0.1, 0) }) },
    { d: 6, rate: 1.6, fov: 30, skip: at(1, 22), cam: (u) => ({ p: orbit(O, 8.8 - 1.2 * ease(u), 0.85 + 0.4 * ease(u), 2.15 + 0.35 * ease(u)), t: V3(0, 0.75, 0) }) },
    { d: 9, rate: 1.2, fov: 38, skip: at(1, 36.6), cam: (u) => { const e = ease(ss(0.38, 1, u)); return { p: lerp(V3(-0.6, 0.3, -1.4), V3(-3.9, 2.2, -8.6), e), t: lerp(O, V3(0, -0.35, 0), e) }; } },
    // III. Les planètes
    { d: 7, rate: 2, fov: 26, skip: at(2, 60), impacts: true, cam: (u) => ({ p: lerp(V3(-7.6, 0.4, -2.2), V3(-7.3, 0.45, 1.2), ease(u)), t: V3(0, -0.45, 0) }) },
    { d: 8, rate: 3, fov: 15, skip: at(2, 120), impacts: true, cam: (u) => ({ p: orbit(O, 13, 1.25 - 0.15 * ease(u), 3.62 + 0.12 * ease(u)), t: V3(0, -0.1, 0) }) },
    { d: 9, rate: 3, fov: 34, skip: at(2, 190), impacts: true, cam: (u) => ({ p: orbit(O, 10.5 - 1.0 * u, 6.4 - 1.0 * ease(u), 0.95 + 0.55 * ease(u)), t: V3(0, -0.6, 0) }) },
    { d: 10, rate: 1.2, fov: 18, skip: at(2, 250), impacts: true, cam: (u) => heroShot(u) },
    { d: 6, rate: 1.0, fov: 24, skip: combReady, cam: (u) => ({ p: lerp(V3(combA + 1.6, 0.66, 1.8), V3(combA + 1.25, 0.58, 1.45), ease(u)), t: V3(combA, 0.36, 0.25) }) },
    { d: 8, rate: 1.6, fov: 28, cam: (u) => ({ p: orbit(O, 3.3 - 0.2 * u, -2.35 + 0.3 * ease(u), 3.5 + 0.55 * ease(u)), t: lerp(V3(0, -2.05, 0), V3(0, -1.7, 0), ease(u)) }) },
    { d: 7, rate: 4, fov: 28, skip: at(3, 70), cam: (u) => ({ p: orbit(O, 12.6 - 1.0 * u, 0.7 + 0.45 * ease(u), 4.95 + 0.45 * ease(u)), t: V3(0, -0.1, 0) }) },
    { d: 8, rate: 1.6, fov: 30, skip: at(4, 40), cam: (u) => ({ p: lerp(V3(-7.2, -2.9, 8.2), V3(-6.1, -2.45, 6.9), ease(u)), t: lerp(V3(0, -1.9, 0), V3(0, -1.55, 0), ease(u)) }) },
    // IV. La géante
    { d: 8, rate: 3, fov: 32, skip: at(5, 30), cam: (u) => ({ p: orbit(O, 17, 6.5 - 1 * ease(u), 0.25 + 0.4 * ease(u)), t: V3(0, -0.4, 0) }) },
    { d: 8, rate: 2.5, fov: 34, skip: at(5, 95), cam: (u) => ({ p: lerp(V3(5.8, 0.7, 6.3), V3(4.3, 0.95, 4.8), ease(u)), t: V3(0, 0.3, 0) }) },
    { d: 6, rate: 2.4, fov: 32, skip: at(5, 124), cam: (u) => ({ p: lerp(V3(-11, 8, 12), V3(-9.2, 6.2, 10.2), ease(u)), t: V3(0, -1.5, 0) }) },
    // V. La supernova, prisonnière de la cloche (à ×1)
    { d: 3.8, rate: 0.96, fov: 30, skip: at(5, 139.2), cam: (u) => ({ p: lerp(V3(3.4, 0.8, 3.8), V3(2.8, 0.65, 3.1), ease(u)), t: O.clone() }) },
    { d: 7.4, rate: 0.96, fov: 40, cam: (u) => { const e = easeOut(u / 0.85); return { p: lerp(V3(2.8, 0.65, 3.1), V3(13, 6, 19), e), t: lerp(O, V3(0, 1.5, 0), e) }; } },
    { d: 6.8, rateFn: holdAfterCollect, fov: 34, cam: (u) => ({ p: lerp(V3(9.0, 2.0, 12.5), V3(7.6, 3.4, 11.0), ease(u)), t: lerp(V3(0, 5.0, 0), V3(0, 7.6, 0), ease(u)) }) },
    { d: 3.5, rateFn: holdAfterCollect, fov: 22, cam: (u) => ({ p: lerp(V3(5.2, 10.4, 6.0), V3(4.6, 10.1, 5.3), ease(u)), t: V3(0, 9.6, 0) }) },
    // VI. L'horloger range la machine (la boucle)
    { d: 10, hold: true, disassemble: true, fov: 30, cam: (u) => ({ p: lerp(V3(9.5, 5.5, 22), V3(3.5, -1.6, 23), ease(u)), t: lerp(V3(0, 2.4, 0), V3(0, -1.5, 0), ease(u)) }) },
    { d: 6, hold: true, disassemble: true, ...LOOP_CAM },
  ];
  const T_ASM = [0.4, 16.8]; // assemblage (temps du film)
  const T_GO = 18;           // la vanne s'ouvre
  let tDis0 = -1;            // début du démontage (temps du film)
  const DIS_LEN = 14.5;

  function breathe(p, t, dist) {
    const a = 0.0035 * dist;
    p.x += Math.sin(t * 0.71) * a; p.y += Math.sin(t * 0.53 + 1.3) * a * 0.7; p.z += Math.sin(t * 0.61 + 2.1) * a;
    return p;
  }

  // ── Rendu ────────────────────────────────────────────────────────────────
  renderer.setPixelRatio(1);
  renderer.setSize(W * SS, H * SS, false);
  camera.aspect = W / H; camera.updateProjectionMatrix();
  state.autoSelect = false; state.selected = -1; vis.V.selected.value = -1; state.follow = -1;
  vis.V.grainK.value = 0;
  orrery.glassK.value = 0.35;
  vis.pipeline.outputColorTransform = false; vis.pipeline.needsUpdate = true; // (tone mapping après la moyenne)
  let scene = vis.star; while (scene.parent) scene = scene.parent;
  const env = orrery.liveEnv();
  camera.layers.set(0); // (les panneaux de studio n'existent que dans les reflets)
  const rtFull = new THREE.RenderTarget(W * SS, H * SS, { type: THREE.HalfFloatType, depthBuffer: false });
  const rtAcc = new THREE.RenderTarget(W, H, { type: THREE.HalfFloatType, depthBuffer: false });
  const rtOut = new THREE.RenderTarget(W, H, { type: THREE.HalfFloatType, depthBuffer: false });
  const { texture, uv, vec3, vec4, float, pow, max, dot, renderOutput, uniform } = TSL;
  const accW = uniform(1 / K);
  const accMat = new THREE.NodeMaterial();
  accMat.fragmentNode = vec4(texture(rtFull.texture, uv()).rgb.mul(accW), float(1)); // (filtrage linéaire : réduction 2×2)
  accMat.blending = THREE.AdditiveBlending; accMat.transparent = true; accMat.depthWrite = false; accMat.depthTest = false;
  const acc = new THREE.QuadMesh(accMat);
  const convMat = new THREE.NodeMaterial();
  {
    let col = texture(rtAcc.texture, uv()).rgb;
    if (HDR) {
      // Rec.709 linéaire → BT.2020 → nits (blanc SDR = 203, BT.2408) → PQ (ST 2084)
      const r = dot(col, vec3(0.6274, 0.3293, 0.0433)), g = dot(col, vec3(0.0691, 0.9195, 0.0114)), b = dot(col, vec3(0.0164, 0.0880, 0.8956));
      const Lm = max(vec3(r, g, b), vec3(0)).mul(203 / 10000).min(1.0);
      const m1 = 0.1593017578125, m2 = 78.84375, c1 = 0.8359375, c2 = 18.8515625, c3 = 18.6875;
      const Ym = pow(Lm, vec3(m1));
      col = pow(Ym.mul(c2).add(c1).div(Ym.mul(c3).add(1.0)), vec3(m2));
    } else {
      col = renderOutput(vec4(col, 1), THREE.NeutralToneMapping, THREE.SRGBColorSpace).rgb;
    }
    convMat.fragmentNode = vec4(col, float(1));
  }
  const conv = new THREE.QuadMesh(convMat);
  const hooks = window.__filmHooks;
  let sub = 0;
  hooks.render = () => {
    const tm = renderer.toneMapping, ac = renderer.autoClear;
    if (sub === 0) env.update();
    renderer.setRenderTarget(rtFull);
    vis.pipeline.render();
    renderer.toneMapping = THREE.NoToneMapping;
    renderer.setRenderTarget(rtAcc);
    if (sub === 0) renderer.clear();
    renderer.autoClear = false;
    acc.render(renderer);
    renderer.autoClear = ac;
    if (sub === K - 1) { renderer.setRenderTarget(rtOut); conv.render(renderer); }
    renderer.setRenderTarget(null);
    renderer.toneMapping = tm;
  };

  const HALF = new Float32Array(65536);
  for (let h = 0; h < 65536; h++) {
    const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 31, m = h & 1023;
    HALF[h] = e === 0 ? s * m * 2 ** -24 : e === 31 ? (m ? NaN : s * Infinity) : s * (1 + m / 1024) * 2 ** (e - 15);
  }
  const rgbx = new Uint8ClampedArray(W * H * 4);
  const yuv = new Uint16Array((W * H * 3) / 2);
  async function readFrame() {
    const px = await renderer.readRenderTargetPixelsAsync(rtOut, 0, 0, W, H);
    const h16 = px instanceof Uint16Array ? px : new Uint16Array(px.buffer, px.byteOffset, px.byteLength / 2);
    if (!HDR || STILLS) {
      for (let i = 0; i < W * H * 4; i += 4) {
        rgbx[i] = HALF[h16[i]] * 255 + 0.5; rgbx[i + 1] = HALF[h16[i + 1]] * 255 + 0.5; rgbx[i + 2] = HALF[h16[i + 2]] * 255 + 0.5; rgbx[i + 3] = 255;
      }
    }
    if (HDR && !STILLS) {
      const Yp = yuv.subarray(0, W * H), Up = yuv.subarray(W * H, (W * H * 5) / 4), Vp = yuv.subarray((W * H * 5) / 4);
      for (let y = 0; y < H; y += 2) {
        for (let x = 0; x < W; x += 2) {
          let cb = 0, cr = 0;
          for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
            const o = ((y + dy) * W + x + dx) * 4;
            const R = HALF[h16[o]], G = HALF[h16[o + 1]], B = HALF[h16[o + 2]];
            const Y = 0.2627 * R + 0.678 * G + 0.0593 * B;
            Yp[(y + dy) * W + x + dx] = Math.min(940, Math.max(64, Math.round(64 + 876 * Y)));
            cb += (B - Y) / 1.8814; cr += (R - Y) / 1.4746;
          }
          const ci = (y >> 1) * (W >> 1) + (x >> 1);
          Up[ci] = Math.min(960, Math.max(64, Math.round(512 + (896 * cb) / 4)));
          Vp[ci] = Math.min(960, Math.max(64, Math.round(512 + (896 * cr) / 4)));
        }
      }
    }
  }

  // ── Réalisation : caméra, lumières, assemblage, visibilités ──────────────
  let shot = null, u = 0, tFilm = 0, tSub = 0;
  hooks.camera = () => {
    if (!shot) return;
    const { p, t: tg, up } = shot.cam(u);
    if (!shot.still) breathe(p, tSub, p.distanceTo(tg));
    camera.up.copy(up || UP);
    camera.position.copy(p); controls.target.copy(tg); camera.lookAt(tg);
    if (camera.fov !== shot.fov) { camera.fov = shot.fov; camera.updateProjectionMatrix(); }
  };
  hooks.before = () => {
    const t = tSub;
    // lampe : pleine au début et à la fin (boucle) ; baisse quand l'étoile
    // s'allume ; remonte quand l'étoile est morte et que l'horloger range
    const ign = life.cycle === 0 && P() >= 2 ? ss(0, 20, P() === 2 ? life.tIgn : 99) : 0;
    let lamp = 1 - 0.5 * ign;
    if (P() === 6) lamp = 0.5 + 0.5 * ss(10, 16, novaT());
    const dis = tDis0 >= 0;
    if (dis) lamp = 1;
    orrery.setLightLevel(lamp, t < T_GO || dis ? 0 : ss(T_GO, T_GO + 3, t));
    // assemblage, puis démontage (le même mouvement, à rebours)
    const k = dis ? 1 - clamp01((t - tDis0 - 0.3) / DIS_LEN) : clamp01((t - T_ASM[0]) / (T_ASM[1] - T_ASM[0]));
    orrery.assemblyApply(k);
    const sky = t >= T_GO && !dis;
    vis.star.visible = sky;
    if (!sky) { vis.pulsar.visible = false; vis.shell.visible = false; }
    if (vis.dust) vis.dust.visible = sky && !(P() === 6 && novaT() > 15.9);
    if (vis.planets) vis.planets.visible = sky;
    // (le vrai flou de mouvement vient des sous-images)
    vis.V.shutter.value = 0; vis.V.blurK.value = 0; vis.V.camVel.value.set(0, 0, 0);
  };
  hooks.after = () => { orrery.assemblyRestore(); };

  // ── Encodage ─────────────────────────────────────────────────────────────
  let encoder = null, muxer = null;
  if (!STILLS) {
    const { Muxer, StreamTarget } = await import('https://cdn.jsdelivr.net/npm/mp4-muxer@5.1.3/+esm');
    muxer = new Muxer({
      target: new StreamTarget({ onData: (data, position) => window.__filmWrite(position, b64(data)), chunked: true, chunkSize: 8 * 1024 * 1024 }),
      video: { codec: HDR ? 'vp9' : 'avc', width: W, height: H, frameRate: FPS },
      fastStart: false,
    });
    encoder = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => { console.error(e); window.__filmError = String(e); } });
    encoder.configure({
      codec: HDR ? 'vp09.02.40.10' : 'avc1.640028', width: W, height: H, framerate: FPS,
      bitrate: Number(q.get('mbps') || 40) * 1e6, latencyMode: 'quality',
      ...(HDR ? {} : { avc: { format: 'avc' } }),
    });
  }
  function b64(u8) {
    let s = '';
    for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
    return btoa(s);
  }
  const outCanvas = STILLS ? new OffscreenCanvas(W, H) : null;
  const HDR_CS = { primaries: 'bt2020', transfer: 'pq', matrix: 'bt2020-ncl', fullRange: false };

  // ── Boucle ───────────────────────────────────────────────────────────────
  const device = renderer.backend.device;
  let now = 1000, nFrame = 0;
  const call = async (dtFrac, render) => {
    hooks.skipRender = !render;
    frame((now += (1000 / FPS) * dtFrac));
    await device.queue.onSubmittedWorkDone();
    await new Promise((r) => setTimeout(r, 0)); // (laisse aboutir les relectures GPU → CPU)
  };
  const log = [];
  const lastStill = STILLS ? Math.max(...STILLS) : Infinity;
  const rateOf = (sh) => (sh.hold ? 0 : sh.rateFn ? sh.rateFn() : sh.rate);

  async function playShot(sh, si) {
    shot = sh; if (!sh.insert) hero = -1;
    if (sh.disassemble && tDis0 < 0) tDis0 = tFilm;
    log.push([tFilm.toFixed(1), sh.insert ? 'impact' : si + 1, life.cycle, P(), +(P() === 2 ? life.tIgn : life.t).toFixed(0)]);
    const n = Math.round(sh.d * FPS);
    for (let f = 0; f < n; f++) {
      const r = rateOf(sh);
      state.paused = r === 0;
      for (sub = 0; sub < K; sub++) {
        const frac = ((sub + 1) / K) * SHUTTER;
        u = (f + frac) / n; tSub = tFilm + frac / FPS;
        hooks.dtSim = (r / FPS) * (SHUTTER / K);
        await call(SHUTTER / K, true);
      }
      hooks.dtSim = (r / FPS) * (1 - SHUTTER);
      await call(1 - SHUTTER, false);
      if (STILLS) {
        const hit = STILLS.find((s) => Math.abs(s - tFilm) < 0.5 / FPS);
        if (hit !== undefined) {
          await readFrame();
          outCanvas.getContext('2d').putImageData(new ImageData(rgbx, W, H), 0, 0);
          const blob = await outCanvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
          await window.__filmStill(hit, b64(new Uint8Array(await blob.arrayBuffer())));
        }
      } else {
        await readFrame();
        const ts = Math.round((nFrame * 1e6) / FPS), dur = Math.round(1e6 / FPS);
        const vf = HDR
          ? new VideoFrame(yuv, { format: 'I420P10', codedWidth: W, codedHeight: H, timestamp: ts, duration: dur, colorSpace: HDR_CS })
          : new VideoFrame(rgbx, { format: 'RGBX', codedWidth: W, codedHeight: H, timestamp: ts, duration: dur });
        encoder.encode(vf, { keyFrame: nFrame % (FPS * 2) === 0 });
        vf.close();
        while (encoder.encodeQueueSize > 2) await new Promise((r) => setTimeout(r, 1));
      }
      nFrame++; tFilm = nFrame / FPS; tSub = tFilm;
      window.__filmProgress = { frame: nFrame, t: +tFilm.toFixed(2), shot: si + 1, phase: P(), cycle: life.cycle, inserts };
      // un impact géant pendant un plan qui le permet : on coupe dessus
      if (sh.impacts && !sh.insert) { const e = takeImpact(); if (e) { await playShot(impactShot(e), si); return; } }
      if (tFilm > lastStill) return;
    }
  }

  for (let si = 0; si < shots.length && tFilm <= lastStill; si++) {
    shot = null;
    const sh = shots[si];
    events.length = 0;
    if (sh.skip && !sh.skip()) {
      // ellipse : la simulation avance hors champ (un impact géant l'interrompt)
      hooks.maxDtP = 0.03; state.paused = false;
      for (let g = 0; g < 20000 && !sh.skip(); g++) {
        hooks.dtSim = 0.6; await call(1, false);
        if (sh.impacts && P() === 2) {
          const e = takeImpact();
          if (e) { hooks.maxDtP = 0; state.burst = 0; state.shake = 0; await playShot(impactShot(e), si); hooks.maxDtP = 0.03; state.paused = false; }
        } else events.length = 0;
      }
      hooks.maxDtP = 0;
      state.burst = 0; state.shake = 0; state.slow = 0; // (ni éclair ni secousse hérités de l'ellipse)
    }
    await playShot(sh, si);
  }
  if (encoder) { await encoder.flush(); muxer.finalize(); }
  window.__filmLog = log;
  window.__filmDone = true;
}
