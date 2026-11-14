// La trémie en WGSL, partagée par la simulation de la fonte (melt.js) et le
// lancer de rayons (tracer.js) ; même fonction que hopper() de melt/model.js.
//
// Un cube dont les faces sont creusées en gradins vers le centre (les arêtes
// poussent plus vite que le milieu des faces) ; la base, qui a poussé sur la
// croûte, est pleine. Ports : 0 trémie, 1 spirale (chaque gradin tourne d'un
// cran), 2 allongée (le long de x).
//
// Le solide est l'intersection de la boîte et, pour chaque face creusée, de
// « sous le fond de son gradin » : un max de distances, continu partout (le
// choix de la face par l'axe dominant faisait des coutures sur les plans
// diagonaux, des fenêtres noires au milieu des faces). Les gradins ne sont pas
// réguliers : leur largeur varie d'un gradin à l'autre (une déformation
// monotone de la distance au bord), comme sur un cristal qui a poussé par
// à-coups. Neuf gradins au plus, peu profonds : le cristal reste plein au
// centre, ce n'est pas une cage de cadres.
//
// Rend (distance, gradin + part de la terrasse) : la partie entière est le
// numéro du gradin, la partie fractionnaire la position sur la terrasse (0 à
// son bord extérieur, l'arête, 1 au pied du gradin suivant).
export const HOPPER = { w: 0.075, dstep: 0.6, kmax: 9, lng: 1.6, a1: 0.2, f1: 2.6, a2: 0.06, f2: 5.3, slope: 1.84 };

export const HOPPER_WGSL = /* wgsl */ `
fn rotY(p: vec3f, a: f32) -> vec3f { let c = cos(a); let s = sin(a); return vec3f(c * p.x + s * p.z, p.y, -s * p.x + c * p.z); }
fn rotX(p: vec3f, a: f32) -> vec3f { let c = cos(a); let s = sin(a); return vec3f(p.x, c * p.y - s * p.z, s * p.y + c * p.z); }
// une face creusée : n, hauteur au-dessus du centre le long de sa normale ;
// t, position dans son plan ; ext, demi-étendues de la face ; ea, demi-étendue
// le long de la normale
fn faceCav(n: f32, t0: vec2f, ext: vec2f, ea: f32, w: f32, sd: f32, spiral: bool) -> vec2f {
  var t = t0;
  if (spiral) {
    let k0 = floor(max(min(ext.x - abs(t.x), ext.y - abs(t.y)), 0.0) / w);
    let an = k0 * 0.07; let c = cos(an); let sn = sin(an);
    t = vec2f(c * t.x - sn * t.y, sn * t.x + c * t.y);
  }
  let r = max(min(ext.x - abs(t.x), ext.y - abs(t.y)), 0.0) / w;
  let x = r + ${HOPPER.a1} * sin(${HOPPER.f1} * r + sd) + ${HOPPER.a2} * sin(${HOPPER.f2} * r + 1.7 * sd);
  let k = clamp(floor(x), 0.0, ${HOPPER.kmax.toFixed(1)});
  let fr = x - k;
  let dep = w * ${HOPPER.dstep};
  var d = n - (ea - k * dep);
  // (vraie distance : le fond du gradin, ou la contremarche du gradin extérieur,
  // plus haut, à côté — sans elle, la marche traverse les parois)
  if (k > 0.5) { d = min(d, length(vec2f(fr * w / ${HOPPER.slope}, max(n - (ea - (k - 1.0) * dep), 0.0)))); }
  return vec2f(d, k + min(fr, 0.999));
}
fn hopperK(q: vec3f, s: f32, habit: f32) -> vec2f {
  let e = select(vec3f(s), vec3f(s * ${HOPPER.lng}, s, s), habit > 1.5);
  let b = abs(q) - e;
  var d = length(max(b, vec3f(0.0))) + min(max(b.x, max(b.y, b.z)), 0.0);
  var kk = 0.0;
  let w = s * ${HOPPER.w};
  let maxD = ${HOPPER.kmax.toFixed(1)} * w * ${HOPPER.dstep};
  let sp = habit > 0.5 && habit < 1.5;
  let sd = s * 37.0;
  // (une face ne compte que si son gradin le plus profond peut l'emporter ;
  // les creux des faces opposées ne se rejoignent pas : seule la face du côté
  // du point compte, avec sa propre graine — trois faces au lieu de cinq, la
  // moitié du temps de rendu)
  if (abs(q.x) - e.x + maxD > d) { let c = faceCav(abs(q.x), q.yz, e.yz, e.x, w, sd + select(0.0, 1.3, q.x < 0.0), sp); if (c.x > d) { d = c.x; kk = c.y; } }
  if (q.y - e.y + maxD > d) { let c = faceCav(q.y, q.xz, e.xz, e.y, w, sd + 2.6, sp); if (c.x > d) { d = c.x; kk = c.y; } }
  if (abs(q.z) - e.z + maxD > d) { let c = faceCav(abs(q.z), q.xy, e.xy, e.z, w, sd + select(3.9, 5.2, q.z < 0.0), sp); if (c.x > d) { d = c.x; kk = c.y; } }
  return vec2f(d, kk);
}
`;
