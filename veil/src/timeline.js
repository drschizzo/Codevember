// Le programme du film : une suite de morceaux simulés, chacun relu dans le
// temps du film. Module pur (ni three, ni DOM) : la scène, les workers et les
// tests le lisent.
//
// Pour N formes, le film est :
//   descente 0 (depuis la pose) → montée 0 → descente 1 → montée 1 → … →
//   montée N−1 → descente 0 (jusqu'à la pose)
// La descente k part de H (le voile pendu, calculé une fois) et finit sur le
// drapé Dₖ, vent compris ; la montée k part de Dₖ (positions ET vitesses de la
// fin de la descente) et finit exactement sur H. Chaque raccord est donc
// exact, et le film à u = 1 est le film à u = 0.
//
// u = 0 tombe au moment où la bague se pose sur la première forme : la
// première image montre déjà un drapé.

export const descDuration = (T) => T.pre + T.lower + T.settle + (T.fall ?? 0);
export const riseDuration = (T) => T.tug + T.lift + T.hang;

// R.timing = { desc: { pre, lower, settle, fall }, rise: { tug, lift, hang } } ; N formes
export function buildTimeline(R) {
  const { desc, rise } = R.timing;
  const N = R.forms.length;
  const Td = descDuration(desc), Tr = riseDuration(rise);
  const land = desc.pre + desc.lower; // (la bague touche la forme)
  const total = N * (Td + Tr);
  const segs = [];
  let t = -land; // la descente 0 commence avant l'origine
  for (let k = 0; k < N; k++) {
    segs.push({ kind: 'desc', k, t0: t, dur: Td });
    t += Td;
    segs.push({ kind: 'rise', k, t0: t, dur: Tr });
    t += Tr;
  }
  return { segs, total, Td, Tr, land, N };
}

// temps du film (en secondes, [0, total)) → { seg, local } ; la descente 0
// apparaît deux fois (fin de boucle, début de boucle) : on la retrouve par
// le modulo
export function locate(TL, tf) {
  const T = TL.total, t = ((tf % T) + T) % T;
  for (const s of TL.segs) {
    // (temps local ramené dans [0, T) : la descente 0 commence avant l'origine
    // et finit après la fin de la boucle)
    const l = (((t - s.t0) % T) + T) % T;
    if (l < s.dur) return { seg: s, local: l };
  }
  // (dernier recours, ne doit pas arriver : la suite couvre toute la boucle)
  const s = TL.segs[TL.segs.length - 1];
  return { seg: s, local: s.dur };
}

// Ce qui se passe, en clair (courbes du film, légendes de mise au point)
export function phaseName(TL, R, tf) {
  const { seg, local } = locate(TL, tf);
  if (seg.kind === 'desc') {
    const T = R.timing.desc;
    if (local < T.pre) return 'pendu';
    if (local < T.pre + T.lower) return 'descente';
    return 'repos';
  }
  const T = R.timing.rise;
  if (local < T.tug) return 'tension';
  if (local < T.tug + T.lift) return 'montée';
  return 'pendu';
}
