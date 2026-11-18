// Le cycle de l'usine : une seule horloge, des fonctions pures de la phase.
//
// La boucle enchaîne autant de DEMI-CYCLES que l'usine a d'objets. Un
// demi-cycle (durée R.loop.half secondes) commence quand la cloche du moule se
// lève sur l'objet qui vient de naître :
//
//   0 … lift      le moule s'ouvre : l'objet neuf est là, sur le plateau du bas
//   lift … move   les deux plateaux échangent leurs places (l'objet monte sous
//                 la source de chaleur, le plateau vide descend sous le moule),
//                 le bras du moule pivote et pose l'autre cloche
//   move … lower  la cloche descend sur le plateau vide
//   heat … melt   la chaleur : l'objet fond, la cire coule dans la cloche
//   melt … 1      la chaleur est coupée, les dernières gouttes ; la cire prend
//
// La cire que l'on voit pendant le demi-cycle k est donc toujours un seul
// objet, né à l'instant 0 : la simulation de fonte ne dépend que du temps écoulé
// depuis le début du demi-cycle.
export const TL = { lift: 1.8, move: 6.8, lower: 8, heat: 8.2, melt: 22.6, half: 25, back0: 9.5, back1: 13.5 };

export const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
// (accélération et arrivée douces, vitesse de croisière constante)
export const ease = (t) => { t = Math.min(1, Math.max(0, t)); return t * t * t * (t * (6 * t - 15) + 10); };

// ── Le circuit : deux demi-chemins (de la chaleur au moule, du moule à la chaleur) ──
// Chaque demi-chemin est une ligne brisée [x, y] ; les plateaux restent à plat.
// F : la partie « usine » de la recette (half, y0, y1, dir, circuit, ramp).
export function circuit(F) {
  const D = F.dir, X = F.half, a = [0, F.y1], b = [0, F.y0];
  const down = [a, [D * X, F.y1], [D * X, F.y0], b]; // ligne haute, descente, ligne basse
  let up;
  if (F.circuit === 'rampe') {
    // retour par un plan incliné : la ligne basse file loin, la rampe remonte vers la ligne haute
    const run = (F.y1 - F.y0) / Math.tan(F.ramp), x1 = F.half * 0.36;
    up = [b, [-D * (x1 + run), F.y0], [-D * x1, F.y1], a];
  } else up = [b, [-D * X, F.y0], [-D * X, F.y1], a];
  return { down, up };
}
const segLen = (p, q) => Math.hypot(q[0] - p[0], q[1] - p[1]);
// point d'une ligne brisée à la fraction u : un arrêt à chaque coude (transfert)
export function along(poly, u) {
  const L = []; let tot = 0;
  for (let i = 0; i + 1 < poly.length; i++) { L.push(segLen(poly[i], poly[i + 1])); tot += L[i]; }
  let d = Math.min(1, Math.max(0, u)) * tot;
  for (let i = 0; i < L.length; i++) {
    if (d <= L[i] || i === L.length - 1) {
      const t = ease(d / L[i]);
      return [poly[i][0] + (poly[i + 1][0] - poly[i][0]) * t, poly[i][1] + (poly[i + 1][1] - poly[i][1]) * t, i];
    }
    d -= L[i];
  }
  return [...poly[poly.length - 1], L.length - 1];
}

// Les chariots : chaque tronçon qui n'est pas une ligne (ascenseur, rampe) a
// le sien, à demeure. Il attend au départ du tronçon, emporte le plateau, le
// dépose à l'arrivée, puis revient à vide pendant la fonte (de back0 à back1).
// Rend, pour chaque tronçon : { p, q (ses bouts), pos, load (porte un plateau) }.
export function carriers(C, mv, t) {
  const out = [];
  for (const poly of [C.down, C.up]) {
    const L = []; let tot = 0;
    for (let i = 0; i + 1 < poly.length; i++) { L.push(segLen(poly[i], poly[i + 1])); tot += L[i]; }
    let d0 = 0;
    for (let i = 0; i < L.length; i++) {
      const p = poly[i], q = poly[i + 1];
      if (Math.abs(q[1] - p[1]) > 1e-6) {
        const d = mv * tot;
        let f = d <= d0 ? 0 : d >= d0 + L[i] ? 1 : ease((d - d0) / L[i]);
        const load = d > d0 && d < d0 + L[i];
        if (t >= TL.back0) f = 1 - ease((t - TL.back0) / (TL.back1 - TL.back0)); // (retour à vide)
        out.push({ p, q, pos: [p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f], load });
      }
      d0 += L[i];
    }
  }
  return out;
}

// La ceinture chauffante : sa hauteur, rapportée à celle de l'objet (0 : l'assiette, 1 : le sommet).
// Garée au-dessus, elle descend lentement le long de l'objet pendant la fonte, puis remonte.
export function beltAt(t) {
  const down = smooth(TL.heat - 1, TL.heat + 0.4, t), run = smooth(TL.heat + 0.4, TL.melt - 2.5, t), up = smooth(TL.melt + 0.4, TL.melt + 2, t);
  const sweep = 1.06 - 1.0 * (0.25 * run + 0.75 * Math.min(1, Math.max(0, (t - TL.heat - 0.4) / (TL.melt - 2.5 - TL.heat - 0.4)))); // (départ et arrivée doux, descente régulière)
  return 1.5 + (sweep - 1.5) * down * (1 - up);
}

// ── L'état de l'usine à la phase ph ∈ [0, 1) ──
// R.objects : les objets de la boucle ; rend { k, t, pallets, wax, bell, arm, heat, cool }
export function stateAt(R, ph) {
  const n = R.objects.length, H = R.loop.half;
  const T = (ph - Math.floor(ph)) * n * H, k = Math.min(n - 1, Math.floor(T / H)), t = T - k * H;
  const C = circuit(R.factory);
  const mv = Math.min(1, Math.max(0, (t - TL.lift) / (TL.move - TL.lift)));
  // deux plateaux : l'un monte avec l'objet (du moule à la chaleur), l'autre descend à vide
  const pUp = along(C.up, mv), pDown = along(C.down, mv);
  const pallets = k % 2 === 0 ? [pUp, pDown] : [pDown, pUp];
  const wax = k % 2 === 0 ? 0 : 1; // (le plateau qui porte la cire)
  // le moule : il s'ouvre comme un livre sur l'objet neuf ; une fois le plateau parti, il se
  // lève, se referme, le barillet pivote, et le moule suivant redescend fermé sur le plateau vide
  const open = smooth(0.1, TL.lift - 0.15, t) * (1 - smooth(TL.lift + 1.7, TL.lift + 2.7, t));
  const up = smooth(TL.lift + 0.5, TL.lift + 1.6, t) * (1 - smooth(TL.move, TL.lower, t));
  const arm = k + ease((t - TL.lift - 1.7) / (TL.move - TL.lift - 1.9));
  const heat = smooth(TL.heat, TL.heat + 1.4, t) * (1 - smooth(TL.melt, TL.melt + 1.2, t));
  return { k, t, n, pallets, wax, bell: up, open, arm, heat, carriers: carriers(C, mv, t), object: R.objects[k], next: R.objects[(k + 1) % n] };
}
