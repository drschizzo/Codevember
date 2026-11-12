// La caméra (module pur) : un trépied au ras de l'eau, au point du platier
// choisi par gen/scene.js (placeCamera), avec un lent travelling périodique —
// latéral (sway), avant (push), un léger balancement du cap. Même pose à
// u = 0 et à u = 1.
export function cameraPose(C, cam, ph) {
  const a = 2 * Math.PI * ph;
  const x = cam.x + C.sway * Math.sin(a), z = cam.z - C.push * (0.5 - 0.5 * Math.cos(a)), y = cam.y + 0.006 * Math.sin(2 * a);
  const yaw = C.yaw + 0.02 * Math.sin(a + 1), pitch = C.pitch;
  const target = [x - Math.sin(yaw) * Math.cos(pitch), y + Math.sin(pitch), z - Math.cos(yaw) * Math.cos(pitch)];
  return { pos: [x, y, z], target, fov: C.fov };
}
