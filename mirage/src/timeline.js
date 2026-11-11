// La chorégraphie : une seule horloge, la phase u ∈ [0, 1). Module pur.
//
// Le couvercle se lève (la crémaillère), reste levé, se repose ; la caméra
// tourne lentement et, couvercle levé, descend regarder par le jour entre les
// deux coupes : elle découvre l'objet au fond, puis remonte voir l'image se
// reformer. Chaque temps est monotone, raccordé en douceur ; l'état à u = 1 est
// l'état à u = 0.
export const CHORE = { up: [0.22, 0.38], down: [0.58, 0.74], dive: [0.26, 0.44], rise: [0.56, 0.78] };
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const frac = (u) => u - Math.floor(u);

// levée du couvercle, de 0 (fermé) à 1 (levé)
export const liftAt = (u) => { const v = frac(u); return sstep(...CHORE.up, v) * (1 - sstep(...CHORE.down, v)); };
// plongée du regard, de 0 (au-dessus : l'image) à 1 (au ras du jour : l'objet au fond)
export const diveAt = (u) => { const v = frac(u); return sstep(...CHORE.dive, v) * (1 - sstep(...CHORE.rise, v)); };

// pose de la caméra : azimut (balancement périodique), élévation, cible
export function cameraAt(R, u) {
  const C = R.camera, f = R.mirascope.f, k = diveAt(u), v = frac(u);
  const az = ((C.az + C.sway * Math.sin(2 * Math.PI * v)) * Math.PI) / 180;
  const el = ((C.elevHigh + (C.elevLow - C.elevHigh) * k) * Math.PI) / 180;
  const dist = C.dist * (1 - 0.12 * k);
  // cible : l'image au-dessus de l'ouverture, puis le jour entre les coupes
  const ty = f + 0.006 + (0.03 - f - 0.006) * k; // (ouvert : le couvercle levé reste dans le champ)
  const tgt = [0, ty, 0];
  const pos = [Math.sin(az) * Math.cos(el) * dist, ty + Math.sin(el) * dist, Math.cos(az) * Math.cos(el) * dist];
  return { pos, tgt, fov: C.fov };
}

// ce qui bouge dans l'objet
export function objectAt(R, u) {
  const v = frac(u), O = R.object;
  return {
    spin: 2 * Math.PI * O.spinTurns * v,
    hands: [((O.hour % 12) / 12) * 2 * Math.PI, ((O.hour % 1) * 2 * Math.PI), 2 * Math.PI * O.secondTurns * v],
    time: 2 * Math.PI * 30 * v, // (la flamme vacille à des fréquences entières de la boucle)
  };
}
