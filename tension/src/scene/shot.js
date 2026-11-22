// La caméra et les lumières suivent la marche : un travelling latéral.
//
// Le repère de la marche (gen/film.js · rig) avance d'un mouvement uniforme
// (translation, ou rotation autour du centre C) ; le centre réel de la
// structure, lui, avance par à-coups (une culbute, une onde, un tour). La
// caméra suit le repère, plus l'écart du centre à ce repère, lissé par un
// noyau gaussien périodique (σ ≈ 0,9 s) : elle accompagne sans sursauter.
// Tout est périodique en u : la pose à u = 1 est celle de u = 0 déplacée par
// le pas (image identique).
const TAU = Math.PI * 2;

export function makeShot(film, { samples = 360, sigma = 0.9 } = {}) {
  const N = film.N, S = samples;
  const dev = new Float64Array(S * 3);
  const P = new Float32Array(N * 3);
  for (let k = 0; k < S; k++) {
    const u = k / S;
    film.pose(u, P);
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < N; i++) { cx += P[i * 3]; cy += P[i * 3 + 1]; cz += P[i * 3 + 2]; }
    cx /= N; cy /= N; cz /= N;
    // (une troupe : le milieu de la formation, pas le centre des nœuds, que la plus grosse sculpture tirerait à elle)
    if (film.focus) [cx, cy, cz] = film.focus(P);
    const r = film.rig(u), c = Math.cos(-r.psi), s = Math.sin(-r.psi);
    const dx = cx - r.x, dz = cz - r.z;
    dev[k * 3] = c * dx - s * dz; dev[k * 3 + 1] = cy; dev[k * 3 + 2] = s * dx + c * dz;
  }
  // lissage gaussien périodique
  const sg = Math.max(1, (sigma / film.dur) * S), W = Math.ceil(sg * 3);
  const sm = new Float64Array(S * 3);
  for (let k = 0; k < S; k++) {
    let a = 0, b = 0, c = 0, ws = 0;
    for (let j = -W; j <= W; j++) {
      const w = Math.exp(-(j * j) / (2 * sg * sg)), q = (((k + j) % S) + S) % S;
      a += w * dev[q * 3]; b += w * dev[q * 3 + 1]; c += w * dev[q * 3 + 2]; ws += w;
    }
    sm[k * 3] = a / ws; sm[k * 3 + 1] = b / ws; sm[k * 3 + 2] = c / ws;
  }
  // Catmull-Rom périodique
  const at = (u) => {
    const f = (u - Math.floor(u)) * S, k = Math.floor(f), t = f - k;
    const g = (q) => (((k + q) % S) + S) % S;
    const out = [0, 0, 0];
    for (let a = 0; a < 3; a++) {
      const p0 = sm[g(-1) * 3 + a], p1 = sm[g(0) * 3 + a], p2 = sm[g(1) * 3 + a], p3 = sm[g(2) * 3 + a];
      out[a] = 0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
    }
    return out;
  };
  // repère : origine, cap, et le centre suivi (monde)
  function frame(u) {
    const ph = u - Math.floor(u);
    const r = film.rig(ph), d = at(ph), c = Math.cos(r.psi), s = Math.sin(r.psi);
    return { x: r.x + c * d[0] - s * d[2], y: d[1], z: r.z + s * d[0] + c * d[2], psi: r.psi, c, s };
  }
  // un vecteur du repère de la marche (x devant, z côté caméra) vers le monde
  const toWorld = (F, x, y, z) => [F.c * x - F.s * z, y, F.s * x + F.c * z];
  return { frame, toWorld, TAU };
}

// Pose de la caméra à la phase u (recette R.camera, encombrement film.ext) :
// travelling latéral, distance réglée sur la taille de la structure, léger
// balancement périodique d'azimut et de hauteur. Rend { pos, tgt, tw, F }.
export const FAMILY_CAM = { culbute: { az: 0, el: 0, d: 1 }, icosa: { az: 0, el: 0, d: 1 }, chenille: { az: 0.55, el: 0.14, d: 0.78 }, cerceau: { az: 0, el: 0, d: 1 } };
export function cameraAt(shot, film, C, u, aspect) {
  const ph = u - Math.floor(u);
  const F = shot ? shot.frame(u) : { x: 0, y: 1, z: 0, psi: 0, c: 1, s: 0 };
  const tw = (x, y, z) => [F.c * x - F.s * z, y, F.s * x + F.c * z];
  // (largeur : ~62 % du cadre pour une structure longue ; hauteur : ~48 %)
  const ext = film?.ext ?? [3, 3, 3], th = Math.tan((C.fov * Math.PI) / 360);
  const trp = !!film?.T?.troupe;
  const base = trp ? Math.max(ext[1] / (0.8 * th), Math.hypot(ext[0], ext[2]) / (1.5 * th * Math.max(1, aspect))) * C.dist + ext[1] * 0.5
    : (Math.max(ext[1] / (0.96 * th), ext[0] / (1.24 * th * Math.max(1, aspect))) + ext[2] * 0.5) * C.dist;
  // (une structure longue se regarde de trois quarts avant et d'un peu plus haut :
  //  de profil, la Chenille n'est qu'un trait)
  const FB = FAMILY_CAM[film?.T?.family] ?? FAMILY_CAM.culbute;
  const lead = tw(C.lead * base * 0.25, 0, 0);
  const tgt = [F.x + lead[0], F.y * 0.85, F.z + lead[2]];
  // (une troupe se regarde de trois quarts et d'un peu haut : de profil ou de face, ses couloirs se cachent l'un l'autre)
  const tr = trp, az0 = tr ? Math.sign(C.az || 1) * Math.min(0.8, Math.max(0.38, Math.abs(C.az))) : C.az + FB.az, el0 = tr ? Math.max(0.27, C.el + 0.06) : C.el + FB.el;
  const az = az0 + C.sway * Math.sin(TAU * ph), el = el0 + 0.35 * C.sway * Math.sin(TAU * ph + 1.3);
  const fd = tr ? 0.82 : FB.d;
  const o = tw(Math.sin(az) * Math.cos(el) * base * fd, Math.sin(el) * base * fd, Math.cos(az) * Math.cos(el) * base * fd);
  const pos = [tgt[0] + o[0], Math.max(0.25, tgt[1] + o[1]), tgt[2] + o[2]];
  return { pos, tgt, tw, F, ext };
}

// ── Le montage d'une troupe ──────────────────────────────────────────────────
// De loin, on voit la troupe mais plus les pièces. La boucle est donc montée
// comme un petit film : un plan large (qui porte le raccord de la boucle), puis
// des plans rapprochés, coupés net, sur la sculpture qui bouge le plus à ce
// moment-là, et un très gros plan sur le treuil qui enroule le plus de corde
// (ou sur le moyeu d'une roue). Tout est fonction de la phase : rien n'est tiré.
// Rend at(u, aspect) → null (plan large) ou { pos, tgt, shot, kind }.
export function makeMontage(film, C, { samples = 480, shotLen = 6.5 } = {}) {
  const T = film.T;
  if (!T?.troupe) return null;
  const S = samples, MB = T.members, NM = MB.length, P = new Float32Array(film.N * 3), R = new Float32Array(film.NC);
  const n = Math.max(3, Math.min(6, Math.round(film.dur / shotLen)));
  const KINDS = [['wide', 'close', 'close'], ['wide', 'close', 'macro', 'close'], ['wide', 'close', 'macro', 'close', 'close'], ['wide', 'close', 'macro', 'close', 'close', 'macro']][n - 3];
  // par membre et par échantillon : centre, activité (déplacement moyen des nœuds, rapporté à la taille) ; par câble : longueur au repos
  const cen = MB.map(() => new Float32Array(S * 3)), act = MB.map(() => new Float32Array(S)), rest = new Float32Array(S * film.NC), mid = new Float32Array(S * film.NC * 3);
  const prev = new Float32Array(film.N * 3), count = MB.map((m) => m.T.nodes.length), rad = new Float32Array(NM), top = new Float32Array(NM);
  for (let k = 0; k < S; k++) {
    const u = (k / S) * 0.999999;
    film.pose(u, P); film.rests(u, R);
    rest.set(R.subarray(0, film.NC), k * film.NC);
    T.cables.forEach((c, q) => { for (let a = 0; a < 3; a++) mid[(k * film.NC + q) * 3 + a] = (P[c.i * 3 + a] + P[c.j * 3 + a]) / 2; });
    MB.forEach((m, j) => {
      let cx = 0, cy = 0, cz = 0, d = 0;
      for (let i = m.n0; i < m.n0 + count[j]; i++) { cx += P[i * 3]; cy += P[i * 3 + 1]; cz += P[i * 3 + 2]; if (k) d += Math.hypot(P[i * 3] - prev[i * 3], P[i * 3 + 1] - prev[i * 3 + 1], P[i * 3 + 2] - prev[i * 3 + 2]); }
      cx /= count[j]; cy /= count[j]; cz /= count[j];
      cen[j].set([cx, cy, cz], k * 3); act[j][k] = d / count[j] / m.scale;
      for (let i = m.n0; i < m.n0 + count[j]; i++) { rad[j] = Math.max(rad[j], Math.hypot(P[i * 3] - cx, P[i * 3 + 1] - cy, P[i * 3 + 2] - cz)); top[j] = Math.max(top[j], P[i * 3 + 1]); }
    });
    prev.set(P);
  }
  // les plans : le large à cheval sur le raccord, les autres à la suite
  const w = 1 / n, w2 = (1 - w) / (n - 1), shots = [];
  const hash = (j, s) => { const x = Math.sin(j * 127.1 + s * 311.7) * 43758.5453; return x - Math.floor(x); };
  // (Les compagnes d'une même espèce rejouent le même film, plus petites et décalées en phase : un plan
  //  rapproché, réglé sur la taille du sujet, les montre identiques. Couper de l'une à l'autre — ou de la
  //  sculpture à elle-même — ne se lit pas comme un nouveau plan mais comme un saut de l'animation. Deux
  //  plans qui se suivent montrent donc deux espèces différentes quand la troupe en a deux, sinon au moins
  //  une autre sculpture, et l'angle change franchement : règle des 30°, plus bas.)
  const famOf = (m) => MB[m].family;
  const species = new Set(MB.map((m) => m.family)).size;
  const like = (m, p) => (!p ? 1 : m === p.m ? 0.02 : species > 1 && famOf(m) === famOf(p.m) ? 0.06 : 1);
  let before = null;
  for (let j = 1; j < n; j++) {
    const u0 = w / 2 + (j - 1) * w2, u1 = u0 + w2, k0 = Math.ceil(u0 * S), k1 = Math.min(S - 1, Math.floor(u1 * S));
    let kind = KINDS[j];
    if (kind === 'close') {
      let best = null;
      for (let m = 0; m < NM; m++) { let a = 0; for (let k = k0; k <= k1; k++) a += act[m][k]; a *= like(m, before); if (!best || a > best.a) best = { m, a }; }
      if (before?.kind === 'close' && famOf(best.m) === famOf(before.m)) {
        // (seule bouge une sculpture de la même espèce : un très gros plan change d'échelle, ce qui se lit comme
        //  un nouveau plan ; sinon, pas de coupe — le plan précédent continue)
        if (KINDS[j + 1] !== 'macro') kind = 'macro';
        else { before.u1 = u1; before.k1 = k1; continue; }
      } else {
        shots.push({ kind: 'close', u0, u1, k0, k1, m: best.m });
        before = shots[shots.length - 1];
        continue;
      }
    }
    if (kind === 'macro') {
      // le câble qui s'enroule le plus pendant le plan
      let best = null;
      for (let q = 0; q < film.NC; q++) {
        let lo = 1e9, hi = -1e9; for (let k = k0; k <= k1; k++) { const v = rest[k * film.NC + q]; if (v < lo) lo = v; if (v > hi) hi = v; }
        const m = T.cables[q].mem ?? 0, sc = ((hi - lo) / MB[m].scale) * (T.cables[q].kind === 'spoke' ? 0.4 : 1) * Math.max(0.3, like(m, before)); // (un treuil qui tourne se lit mieux qu'un rayon ; le très gros plan change déjà d'échelle, il tolère la même espèce)
        if (!best || sc > best.sc) best = { q, sc, m };
      }
      // (une roue n'a pas de treuil sur ses rayons : on regarde son moyeu, là où les rayons s'enroulent)
      shots.push({ kind: 'macro', u0, u1, k0, k1, m: best.m, q: best.q, hub: T.cables[best.q].kind === 'spoke' });
      before = shots[shots.length - 1];
    }
  }
  // la trajectoire lissée du point visé, plan par plan (noyau gaussien, bords tenus)
  for (const s of shots) {
    const len = s.k1 - s.k0 + 1, raw = new Float32Array(len * 3), sg = Math.max(1, ((s.kind === 'macro' ? 0.4 : 0.9) / film.dur) * S), W = Math.ceil(sg * 3);
    for (let k = 0; k < len; k++) for (let a = 0; a < 3; a++) {
      if (s.kind === 'macro' && !s.hub) raw[k * 3 + a] = mid[((s.k0 + k) * film.NC + s.q) * 3 + a];
      else if (s.kind === 'macro') raw[k * 3 + a] = 0;
      else raw[k * 3 + a] = cen[s.m][(s.k0 + k) * 3 + a];
    }
    if (s.kind === 'macro' && s.hub) for (let k = 0; k < len; k++) for (let a = 0; a < 3; a++) raw[k * 3 + a] = cen[s.m][(s.k0 + k) * 3 + a]; // (le moyeu est au centre de la roue, à peu près)
    s.len = len; s.path = new Float32Array(len * 3);
    for (let k = 0; k < len; k++) {
      let ws = 0; const o = [0, 0, 0];
      for (let j = -W; j <= W; j++) { const q = Math.max(0, Math.min(len - 1, k + j)), g = Math.exp(-(j * j) / (2 * sg * sg)); ws += g; for (let a = 0; a < 3; a++) o[a] += g * raw[q * 3 + a]; }
      for (let a = 0; a < 3; a++) s.path[k * 3 + a] = o[a] / ws;
    }
  }
  const side = Math.sign(C.az) || 1;
  // distance entre deux segments (p→q et a→b)
  const segDist = (p, q, a, b) => {
    const d1 = [q[0] - p[0], q[1] - p[1], q[2] - p[2]], d2 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], r = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
    const A = d1[0] * d1[0] + d1[1] * d1[1] + d1[2] * d1[2], E = d2[0] * d2[0] + d2[1] * d2[1] + d2[2] * d2[2], F = d2[0] * r[0] + d2[1] * r[1] + d2[2] * r[2];
    const Cc = d1[0] * r[0] + d1[1] * r[1] + d1[2] * r[2], Bb = d1[0] * d2[0] + d1[1] * d2[1] + d1[2] * d2[2], den = A * E - Bb * Bb;
    let sN = den > 1e-9 ? Math.max(0, Math.min(1, (Bb * F - Cc * E) / den)) : 0, tN = Math.max(0, Math.min(1, (Bb * sN + F) / E));
    sN = Math.max(0, Math.min(1, (Bb * tN - Cc) / A));
    return Math.hypot(r[0] + d1[0] * sN - d2[0] * tN, r[1] + d1[1] * sN - d2[1] * tN, r[2] + d1[2] * sN - d2[2] * tN);
  };
  // l'angle de chaque plan : parmi quelques azimuts et hauteurs, celui d'où le sujet est le moins caché — par les
  // tubes de sa propre structure pour un très gros plan, par les autres sculptures pour un plan rapproché
  const th0 = Math.tan((C.fov * Math.PI) / 360);
  shots.forEach((s, j) => {
    const sc = MB[s.m].scale, macro = s.kind === 'macro';
    s.dist = macro ? (s.hub ? 3.0 : 2.3) * sc * (0.2679 / th0) : (2 * rad[s.m]) / (1.55 * th0);
    const cands = [];
    for (const a of macro ? [0.55, 0.95, 0.2, 1.35, -0.45, -0.9] : [0.42 + 0.4 * hash(j + 1, 1), 0.3, 0.95, -0.35]) for (const e of macro ? [0.2, 0.42, 0.08, 0.7] : [0.12 + 0.12 * hash(j + 1, 2), 0.3]) cands.push([side * a, e]);
    const times = [0.15, 0.4, 0.65, 0.9].map((x) => s.k0 + Math.round(x * (s.len - 1)));
    const poses = times.map((k) => film.pose((k / S) * 0.999999, new Float32Array(film.N * 3)));
    let best = null;
    for (const [az, el] of cands) {
      let hit = 0;
      times.forEach((k, q) => {
        const o = (k - s.k0) * 3, tg = [s.path[o], s.path[o + 1], s.path[o + 2]], Q = poses[q];
        const cam = [tg[0] + Math.sin(az) * Math.cos(el) * s.dist, tg[1] + Math.sin(el) * s.dist, tg[2] + Math.cos(az) * Math.cos(el) * s.dist];
        // (le rayon s'arrête un peu avant le sujet : la pièce visée ne se cache pas elle-même)
        const stop = macro ? 0.86 : 1 - Math.min(0.9, (rad[s.m] * 1.1) / s.dist), end = [0, 1, 2].map((a) => cam[a] + (tg[a] - cam[a]) * stop);
        for (const b of T.bars) {
          const own = (b.mem ?? 0) === s.m;
          if (macro ? !own : own) continue;
          const bs = MB[b.mem ?? 0].scale;
          if (segDist(cam, end, [Q[b.i * 3], Q[b.i * 3 + 1], Q[b.i * 3 + 2]], [Q[b.j * 3], Q[b.j * 3 + 1], Q[b.j * 3 + 2]]) < (macro ? 0.14 * sc : 0.35 * bs) + b.r * bs) hit++;
        }
      });
      // (règle des 30° : après un plan sur la même espèce, l'angle doit changer franchement)
      const p = shots[j - 1], same = p && famOf(p.m) === famOf(s.m);
      const score = hit + (same && Math.hypot(az - p.az, 0.7 * (el - p.el)) < 0.6 ? 40 : 0);
      if (!best || score < best.score) best = { hit, score, az, el };
    }
    s.az = best.az; s.el = best.el; s.hidden = best.hit;
  });
  function at(u, aspect) {
    const ph = u - Math.floor(u), j = shots.findIndex((s) => ph >= s.u0 && ph < s.u1);
    if (j < 0) return null;
    const s = shots[j], f = Math.max(0, Math.min(s.len - 1.001, ph * S - s.k0)), k = Math.floor(f), t = f - k, tgt = [0, 0, 0];
    for (let a = 0; a < 3; a++) tgt[a] = s.path[k * 3 + a] * (1 - t) + s.path[(k + 1) * 3 + a] * t;
    const x = (ph - s.u0) / (s.u1 - s.u0), th = th0, sc = MB[s.m].scale;
    // (un lent glissement d'azimut ; le plan rapproché avance un peu)
    const az = s.az + 0.1 * (x - 0.5), el = s.el;
    let dist = s.dist;
    if (s.kind === 'close') { dist = Math.max(dist, (2 * rad[s.m]) / (2.0 * th * Math.max(1, aspect))) * (1.04 - 0.06 * x); tgt[1] = Math.max(tgt[1] * 0.92, top[s.m] * 0.42); }
    const pos = [tgt[0] + Math.sin(az) * Math.cos(el) * dist, Math.max(0.12 * sc + 0.05, tgt[1] + Math.sin(el) * dist), tgt[2] + Math.cos(az) * Math.cos(el) * dist];
    return { pos, tgt, shot: j + 1, kind: s.kind, member: s.m };
  }
  return { at, shots: [{ kind: 'wide', u0: 1 - w / 2, u1: w / 2 }, ...shots.map((s) => ({ kind: s.kind, u0: s.u0, u1: s.u1, member: s.m, cable: s.q ?? null, hub: !!s.hub, hidden: s.hidden }))] };
}
