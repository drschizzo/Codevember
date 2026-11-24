// Caméra tenue : les petites imperfections d'un opérateur.
//
// Une caméra posée par une formule est parfaite : visée verrouillée sur le
// centre, trajectoire en sinus purs. Ce module y ajoute ce que ferait un
// opérateur au Steadicam ou à la tête fluide tenue à la main : une dérive lente
// de la visée, un balancement de respiration, un soupçon de roulis, presque
// pas de tremblement. Une caméra tenue tourne bien plus qu'elle ne se déplace :
// l'essentiel du mouvement est angulaire, la translation reste infime.
//
// Le tremblé est périodique en phase : chaque composante est une harmonique
// entière de la boucle (la fréquence voulue en Hz, arrondie à k / durée), avec
// une phase et un poids tirés d'une graine propre au projet. La pose est donc
// la même à 0 et à 1, et l'export reste déterministe. Il ne touche pas au
// hasard de la scène.
//
// Usage, dans renderAt, après avoir placé la caméra et avant lookAt :
//   hand.aim(camera, target, ph, { amp, duration }, aim);   // (aim : un Vector3 du projet)
//   camera.lookAt(aim);           // (et lookAt(aim) aussi après le décalage d'objectif)
// (sans three.js : le module se teste dans Node)
// La visée se déplace à distance constante : la mise au point ne respire pas.
// amp = 0 rend exactement la caméra d'origine (ni la position ni up ne bougent).
import { createRng } from '../rng.js';

const TAU = Math.PI * 2, DEG = Math.PI / 180;

// bandes : [fréquence min, max (Hz), poids, composantes]
// dérive de la visée, respiration et balancement du corps, tremblement des mains
const BANDS = [[0.05, 0.16, 1, 3], [0.18, 0.5, 0.45, 3], [0.9, 2.2, 0.05, 3]];

// écart type (à amp = 1) de chaque axe : lacet, tangage, roulis (degrés) ;
// latéral, vertical, avant (fraction de la distance au sujet)
const SIGMA = { yaw: 0.32, pitch: 0.26, roll: 0.18, x: 0.0025, y: 0.002, z: 0.004 };

function axis(rng) {
  const comps = [];
  let e = 0;
  for (const [lo, hi, w, n] of BANDS) {
    for (let i = 0; i < n; i++) {
      const f = lo * Math.pow(hi / lo, (i + rng.next()) / n); // (réparties en log dans la bande)
      const a = (w * rng.range(0.6, 1.4)) / Math.sqrt(f / lo); // (spectre qui descend avec la fréquence)
      comps.push({ f, a, p: rng.next() * TAU });
      e += a * a / 2;
    }
  }
  const s = 1 / Math.sqrt(e); // (écart type 1)
  for (const c of comps) c.a *= s;
  return comps;
}

function sample(comps, ph, L) {
  let v = 0;
  for (const c of comps) v += c.a * Math.sin(TAU * Math.max(1, Math.round(c.f * L)) * ph + c.p);
  return v;
}

export function createHandheld(key = 'handheld') {
  const rng = createRng(`handheld:${key}`);
  const ax = {};
  for (const k of Object.keys(SIGMA)) ax[k] = axis(rng);

  // (valeurs brutes d'un instant, pour les tests et les planches)
  function at(ph, L) {
    const o = {};
    for (const k of Object.keys(SIGMA)) o[k] = SIGMA[k] * sample(ax[k], ph, L);
    return o;
  }

  // déplace la caméra (position, up) et écrit la visée tremblée dans out ; target n'est pas modifié
  // (move : part de la translation, 0 pour une caméra qui ne doit pas quitter sa hauteur, comme le hublot de Kelp)
  // le roulis s'ajoute à celui de la scène : le haut de référence est camera.up tel que la scène l'a posé
  function aim(camera, target, ph, { amp = 0, duration = 30, fov = camera.fov, ref = 35, move = 1 } = {}, out = target) {
    const P = camera.position, tx = target.x, ty = target.y, tz = target.z;
    out.set(tx, ty, tz);
    if (!(amp > 0)) return out;
    let fx = tx - P.x, fy = ty - P.y, fz = tz - P.z;
    const d = Math.hypot(fx, fy, fz);
    if (d < 1e-6) return out;
    fx /= d; fy /= d; fz /= d;
    // droite = avant × haut de la scène, haut = droite × avant
    const U = camera.up, bl = Math.hypot(U.x, U.y, U.z) || 1, bx = U.x / bl, by = U.y / bl, bz = U.z / bl;
    let rx = fy * bz - fz * by, ry = fz * bx - fx * bz, rz = fx * by - fy * bx;
    const rl = Math.hypot(rx, ry, rz);
    if (rl < 1e-3) return out; // (visée dans l'axe du haut : pas de repère)
    rx /= rl; ry /= rl; rz /= rl;
    const ux = ry * fz - rz * fy, uy = rz * fx - rx * fz, uz = rx * fy - ry * fx;
    const L = Math.max(1, duration), s = at(ph - Math.floor(ph), L);
    // (angles rapportés au champ : même tremblé à l'écran pour un grand-angle ou un téléobjectif)
    const ka = amp * DEG * Math.min(1.6, Math.max(0.4, fov / ref));
    const ty_ = Math.tan(s.yaw * ka), tp = Math.tan(s.pitch * ka), roll = s.roll * ka;
    const km = amp * move * d, kx = s.x * km, ky = s.y * km, kz = s.z * km;
    P.set(P.x + rx * kx + ux * ky + fx * kz, P.y + ry * kx + uy * ky + fy * kz, P.z + rz * kx + uz * ky + fz * kz);
    // visée : même distance au sujet, tournée du lacet et du tangage autour de la caméra
    const dd = Math.hypot(tx - P.x, ty - P.y, tz - P.z);
    const ax_ = fx + rx * ty_ + ux * tp, ay_ = fy + ry * ty_ + uy * tp, az_ = fz + rz * ty_ + uz * tp;
    const al = Math.hypot(ax_, ay_, az_);
    out.set(P.x + (ax_ / al) * dd, P.y + (ay_ / al) * dd, P.z + (az_ / al) * dd);
    const c = Math.cos(roll), sn = Math.sin(roll);
    camera.up.set(bx * c + rx * sn, by * c + ry * sn, bz * c + rz * sn);
    return out;
  }

  return { aim, at };
}
