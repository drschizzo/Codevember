// Outils de mise au point d'une scène (?debug), communs aux projets : image
// fixe, envoi au collecteur, planches, posemètre, temps d'image, raccord.
//
//   window[NAME] = { renderer, scene, …, ...createDebugTools({ … }) };
//
// Ils tournent aussi quand le panneau de navigateur est masqué : la boucle est
// alors entraînée à la main (run), les images relues sur le GPU et envoyées à
// tools/sink.py (les captures d'écran d'un panneau masqué sont périmées), et
// les attentes passent par des messages (les minuteries d'une page masquée
// sont ralenties jusqu'à une par minute).
import * as THREE from 'three/webgpu';

// ── Attentes qui ne dépendent pas des minuteries ─────────────────────────────
const channel = new MessageChannel();
const waiters = [];
channel.port1.onmessage = () => waiters.shift()?.();
export const yieldNow = () => new Promise((r) => { waiters.push(r); channel.port2.postMessage(0); });
export async function sleep(ms) {
  const t = performance.now();
  do await yieldNow(); while (performance.now() - t < ms);
}

// ── Partage d'une scène retouchée : JSON compressé dans l'ancre (#r=…) ───────
export async function packRecipe(R) {
  const s = new Blob([JSON.stringify(R)]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  const b = new Uint8Array(await new Response(s).arrayBuffer());
  let bin = '';
  for (const x of b) bin += String.fromCharCode(x);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export async function unpackRecipe(str) {
  const bin = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
  const b = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const s = new Blob([b]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return JSON.parse(await new Response(s).text());
}

// Ce que le projet fournit :
//   renderer, canvas, camera, post       le moteur et la chaîne d'image
//   renderStep(u)                        un rendu complet à la phase u (nodeFrame.update + renderAt)
//   tick(now)                            la boucle du projet (pour run)
//   isLoading()                          vrai tant que l'écran de chargement est là
//   freeze(v)                            gèle ou relâche la boucle
//   resize()                             remet la taille de la fenêtre
//   load(graine, { mood, family })       génère et applique une recette
//   poses()                              objets dont la pose signe la boucle (seam) ; défaut : aucun
//   hiCap()                              plafond des hautes lumières (posemètre : part de « brûlé »)
//   sink                                 adresse du collecteur (défaut : http://127.0.0.1:8099/)
export function createDebugTools({ renderer, canvas, camera, post, renderStep, tick, isLoading, freeze, resize, load, poses = () => [], hiCap = () => 4, sink = 'http://127.0.0.1:8099/' }) {
  const done = () => renderer.backend.device?.queue.onSubmittedWorkDone();
  const split = (s) => { const [seed, mood, family] = String(s).split(':'); return [seed, { ...(mood ? { mood } : {}), ...(family ? { family } : {}) }]; };

  const tools = {
    sleep,
    // fait tourner la boucle à la main jusqu'à la fin du chargement (ou pendant
    // `seconds` de film) : à utiliser quand le panneau est masqué
    async run(seconds = 0) {
      freeze(false); // (une image fixe gèle la boucle : le chargement suivant ne finirait jamais)
      const t0 = performance.now();
      while (isLoading() || performance.now() - t0 < seconds * 1000) {
        renderer._nodes?.nodeFrame?.update();
        tick(performance.now());
        await sleep(16);
      }
    },
    // taille d'image imposée (captures de la documentation, non-régression) ; size() pour revenir
    size(w, h) {
      if (!w) { resize(); return; }
      renderer.setPixelRatio(1); renderer.setSize(w, h, false);
      camera.aspect = w / h; camera.updateProjectionMatrix();
    },
    // image fixe à la phase ph (n images : historique de l'anticrénelage)
    async shot(ph, n = 12) {
      await tools.run(); // (fin du chargement, même panneau masqué)
      freeze(true);
      document.body.classList.add('clean');
      for (let i = 0; i < n; i++) { renderStep(ph); await done(); }
    },
    // l'image de la chaîne complète, relue sur le GPU : ImageData
    async grab() {
      const w = canvas.width, h = canvas.height;
      const rt = new THREE.RenderTarget(w, h, { type: THREE.UnsignedByteType });
      renderer.setRenderTarget(rt); post.render(); renderer.setRenderTarget(null);
      const px = await renderer.readRenderTargetPixelsAsync(rt, 0, 0, w, h);
      rt.dispose();
      const img = new ImageData(w, h), stride = Math.ceil((w * 4) / 256) * 256; // (lignes alignées sur 256 octets)
      for (let y = 0; y < h; y++) img.data.set(px.subarray(y * stride, y * stride + w * 4), y * w * 4);
      return img;
    },
    // image rendue, envoyée au collecteur local (tools/sink.py)
    async send(name, scale = 0.5, url = sink) {
      const img = await tools.grab();
      const c = new OffscreenCanvas(img.width, img.height);
      c.getContext('2d').putImageData(img, 0, 0);
      const sc = new OffscreenCanvas(Math.round(img.width * scale), Math.round(img.height * scale));
      sc.getContext('2d').drawImage(c, 0, 0, sc.width, sc.height);
      const b = await sc.convertToBlob(/\.png$/.test(name) ? { type: 'image/png' } : { type: 'image/jpeg', quality: 0.88 });
      await fetch(url + name, { method: 'POST', body: b });
      return b.size;
    },
    // planche : les graines × les phases, chaque image envoyée au collecteur
    // (une graine peut s'écrire « graine:humeur:famille » : l'humeur et la
    // famille sont alors imposées — pour comparer toutes les humeurs d'un coup)
    async sheet(seeds, phases = [0, 0.2, 0.4, 0.6, 0.8], prefix = 'sheet') {
      for (const s of seeds) {
        load(...split(s));
        await sleep(400);
        for (const ph of phases) { await tools.shot(ph); await tools.send(`${prefix}-${s}-${String(Math.round(ph * 100)).padStart(3, '0')}.jpg`); }
      }
    },
    // film image par image autour d'un temps fort : n images de u0 à u1
    async film(u0, u1, n = 12, prefix = 'film') {
      for (let i = 0; i < n; i++) {
        const u = u0 + ((u1 - u0) * i) / Math.max(1, n - 1);
        await tools.shot(u, i ? 4 : 12);
        await tools.send(`${prefix}-${String(i).padStart(2, '0')}.jpg`);
      }
    },
    // posemètre : luminance de la passe de scène (HDR, avant étalonnage) sur
    // l'image et sur son centre — médiane, centiles, part de noir et de brûlé
    async meter(box = 0.18) {
      const rt = post.nodes.scenePass.renderTarget, w = rt.width, h = rt.height;
      const px = await renderer.readRenderTargetPixelsAsync(rt, 0, 0, w, h, 0);
      const half = px instanceof Uint16Array, val = (i) => (half ? THREE.DataUtils.fromHalfFloat(px[i]) : px[i]);
      const stride = Math.ceil((w * (half ? 8 : 16)) / 256) * 256 / (half ? 2 : 4);
      const all = [], mid = [], b = box * h;
      for (let y = 0; y < h; y += 3) for (let x = 0; x < w; x += 3) {
        const i = y * stride + x * 4, L = 0.2126 * val(i) + 0.7152 * val(i + 1) + 0.0722 * val(i + 2);
        if (!(L >= 0)) continue;
        all.push(L);
        if (Math.abs(x - w / 2) < b && Math.abs(y - h / 2) < b) mid.push(L);
      }
      const cap = hiCap() * 0.5;
      const stat = (a) => { a.sort((p, q) => p - q); const q = (t) => +a[Math.min(a.length - 1, Math.floor(t * a.length))].toFixed(3); return { p50: q(0.5), p90: q(0.9), p99: q(0.99), noir: +(a.filter((v) => v < 0.01).length / a.length).toFixed(2), brule: +(a.filter((v) => v > cap).length / a.length).toFixed(3) }; };
      return { image: stat(all), centre: stat(mid) };
    },
    // posemètre de plusieurs scènes : { graine: [[médiane du centre, médiane de l'image, brûlé] par phase] }
    async meters(seeds, phases = [0.3, 0.6]) {
      const out = {};
      for (const s of seeds) {
        load(...split(s));
        await sleep(400);
        out[s] = [];
        for (const ph of phases) { await tools.shot(ph); const m = await tools.meter(); out[s].push([m.centre.p50, m.image.p50, m.image.brule]); }
      }
      return out;
    },
    // épreuve de l'affiche (SKILL.md, règle 23) sur l'image affichée, après
    // étalonnage : médiane, amplitude des valeurs (p99,5 − p1), part de noir
    async poster() {
      const { data } = await tools.grab(), L = [];
      for (let i = 0; i < data.length; i += 16) L.push((0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]) / 255);
      L.sort((a, b) => a - b);
      const q = (t) => L[Math.min(L.length - 1, Math.floor(t * L.length))];
      return { mediane: +q(0.5).toFixed(3), amplitude: +(q(0.995) - q(0.01)).toFixed(3), noir: +(L.filter((v) => v < 0.02).length / L.length).toFixed(2) };
    },
    // temps GPU moyen d'une image (boucle arrêtée, n rendus d'affilée)
    async bench(ph = 0.3, n = 30) {
      freeze(true);
      renderStep(ph); await done();
      const t0 = performance.now();
      for (let i = 0; i < n; i++) renderStep(ph);
      await done();
      return +((performance.now() - t0) / n).toFixed(2);
    },
    // signature de la boucle : la pose de la caméra et des pièces à u et à u + 1
    // doit être identique (raccord parfait)
    seam(u = 0) {
      const sig = () => { const v = [...camera.matrixWorld.elements]; for (const root of poses()) root.traverse((o) => o.isMesh && v.push(...o.matrixWorld.elements)); return v; };
      renderStep(u); const a = sig();
      renderStep(u + 1 - 1e-9); const b = sig();
      return Math.max(...a.map((x, i) => Math.abs(x - b[i])));
    },
  };
  return tools;
}
