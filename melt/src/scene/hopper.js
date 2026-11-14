// La trémie en WGSL, partagée par la simulation de la fonte (melt.js) et le
// lancer de rayons (tracer.js) ; même fonction que hopper() de melt/model.js.
//
// Un cube dont les faces sont creusées en gradins vers le centre (les arêtes
// poussent plus vite que le milieu des faces) ; la base, qui a poussé sur la
// croûte, est pleine. Ports : 0 trémie, 1 spirale (chaque gradin tourne d'un
// cran), 2 allongée (le long de x). Rend (distance, numéro du gradin).
export const HOPPER_WGSL = /* wgsl */ `
fn rotY(p: vec3f, a: f32) -> vec3f { let c = cos(a); let s = sin(a); return vec3f(c * p.x + s * p.z, p.y, -s * p.x + c * p.z); }
fn rotX(p: vec3f, a: f32) -> vec3f { let c = cos(a); let s = sin(a); return vec3f(p.x, c * p.y - s * p.z, s * p.y + c * p.z); }
fn hopperK(q0: vec3f, s: f32, habit: f32) -> vec2f {
  let lng = habit > 1.5;
  let f = select(1.0, 0.62, lng);
  var q = q0;
  if (lng) { q = vec3f(q0.x * 0.62, q0.y, q0.z); }
  let b = abs(q) - vec3f(s);
  let dbox = (length(max(b, vec3f(0.0))) + min(max(b.x, max(b.y, b.z)), 0.0)) * f;
  let a = abs(q);
  if (q.y < -max(a.x, a.z)) { return vec2f(dbox, 0.0); } // (la base a poussé sur la croûte : pleine)
  var n = 0.0; var t = vec2f(0.0);
  if (a.x >= a.y && a.x >= a.z) { n = a.x; t = q.yz; } else if (a.y >= a.z) { n = a.y; t = q.xz; } else { n = a.z; t = q.xy; }
  let w = s * 0.11;
  if (habit > 0.5 && habit < 1.5) {
    let k0 = floor((s - max(abs(t.x), abs(t.y))) / w);
    let an = k0 * 0.07; let c = cos(an); let sn = sin(an);
    t = vec2f(c * t.x - sn * t.y, sn * t.x + c * t.y);
  }
  let rim = s - max(abs(t.x), abs(t.y));
  let k = min(floor(rim / w), 7.0);
  // (vraie distance : le fond du gradin, ou la paroi du gradin extérieur, plus
  // haut, à côté — sans elle, la marche traverse les parois)
  var dcav = n - (s - k * w * 0.75);
  if (k > 0.5) { dcav = min(dcav, length(vec2f(rim - k * w, max(n - (s - (k - 1.0) * w * 0.75), 0.0)))); }
  return vec2f(max(dbox, dcav * f), k);
}
`;
