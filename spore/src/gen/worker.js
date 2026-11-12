// Worker de génération : le bois cuit, le site (plasmodium, réseau, perles,
// spores), le volume de bruit, le studio — hors du fil principal, à partir
// d'une spécification JSON ; tampons transférés sans copie. Les constructeurs
// sont des fonctions pures, importables depuis Node (tests, outils).
import { buildNoiseVolume } from './noisevol.js';
import { bakeWood } from './wood.js';
import { buildSite } from './site.js';
import { envPixels } from './envmap.js';
import { toHalf } from './half.js';

function build({ spec, what }) {
  switch (what) {
    case 'noise': return buildNoiseVolume(spec.seed);
    case 'wood': { const w = bakeWood(spec); return { ...w, relH: toHalf(w.rel), rel: null, smoothH: toHalf(w.smooth), smooth: null }; }
    case 'site': {
      const S = buildSite(spec);
      S.sheet.TH = toHalf(S.sheet.T); S.sheet.T = null;
      S.edges.texH = toHalf(S.edges.tex); S.edges.tex = null;
      // grains : positions en demi-flottants RGBA (une colonne par grain, une ligne par image)
      const G = S.smoke.grains, F = S.smoke.frames, gp = new Float32Array(F * G.n * 4);
      for (let i = 0; i < F * G.n; i++) { gp[i * 4] = G.pos[i * 3] || 0; gp[i * 4 + 1] = G.pos[i * 3 + 1] || 0; gp[i * 4 + 2] = G.pos[i * 3 + 2] || 0; gp[i * 4 + 3] = 1; }
      G.posH = toHalf(gp); G.pos = null;
      S.smoke.depH = toHalf(S.smoke.dep.map((v) => v / S.smoke.depMax)); S.smoke.dep = null;
      return S;
    }
    case 'env': return { data: envPixels(spec.preset, 0, spec.W) };
    default: throw new Error(`inconnu : ${what}`);
  }
}

self.onmessage = ({ data }) => {
  try {
    const out = build(data);
    const transfer = [];
    const walk = (o) => { if (!o) return; for (const v of Object.values(o)) { if (ArrayBuffer.isView(v)) { if (!transfer.includes(v.buffer)) transfer.push(v.buffer); } else if (v && typeof v === 'object') walk(v); } };
    walk(out);
    self.postMessage({ id: data.id, out }, transfer);
  } catch (e) {
    self.postMessage({ id: data.id, error: `${e.message}\n${e.stack}` });
  }
};
