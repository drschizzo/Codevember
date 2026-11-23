// Worker de génération : le volume de bruit, la pendaison de référence et les
// morceaux du film (descente, montée), simulés hors du fil principal. Les
// tampons sont transférés sans copie ; les images du film sont quantifiées
// sur 16 bits (pas de 0,04 mm), ce qui divise la mémoire par deux.
import { buildNoiseVolume } from '../../../shared/gen/noisevol.js';
import { simulate } from './cloth.js';
import { buildForm, bakeForm } from './forms.js';
import { quantize } from './quant.js';
import { buildPlinth, buildCyclo } from './plinth.js';


function build({ spec, what }, post) {
  switch (what) {
    case 'noise': return buildNoiseVolume(spec.seed);
    case 'form': { // (sommet de la forme : hauteur de pose de la bague ; et son champ cuit, pour l'étage fin du GPU)
      const f = buildForm(spec);
      const b = bakeForm(f).baked;
      return { top: f.top, box: f.box, offset: f.offset, sdf: { D: b.D, dims: [b.nx, b.ny, b.nz], origin: [b.x0, b.y0, b.z0], h: b.h } };
    }
    case 'show': { // (le modèle détaillé de la statue, pour l'hologramme : volume de 4 mm ; distance sur 8 bits, de −2,5 à +10 cm, codée en racine — d = 0,1 e |e| — pour être fine près de la surface : en linéaire, ses pas de 0,5 mm crénelaient le modelé)
      const b = bakeForm(buildForm(spec, true), 0.004, 0.035).baked;
      const D = new Uint8Array(b.D.length);
      for (let i = 0; i < D.length; i++) { const d = b.D[i], e = Math.sign(d) * Math.sqrt(Math.min(Math.abs(d), 0.1) / 0.1), q = Math.round(((e + 0.5) / 1.5) * 255); D[i] = q < 0 ? 0 : q > 255 ? 255 : q; }
      return { D, dims: [b.nx, b.ny, b.nz], origin: [b.x0, b.y0, b.z0], h: b.h };
    }
    case 'plinth': return buildPlinth(spec);
    case 'cyclo': return buildCyclo(spec);
    case 'cloth': {
      const out = simulate({ ...spec, onProgress: (p) => post(p) });
      return { frames: quantize(out.frames), count: out.count, fps: out.fps, final: out.final, vel: out.vel, n: out.n, N: out.N };
    }
    default: throw new Error(`inconnu : ${what}`);
  }
}

self.onmessage = ({ data }) => {
  try {
    const out = build(data, (p) => self.postMessage({ id: data.id, progress: p }));
    const transfer = [];
    const walk = (o) => { if (!o) return; for (const v of Object.values(o)) { if (ArrayBuffer.isView(v)) transfer.push(v.buffer); else if (v && typeof v === 'object') walk(v); } };
    walk(out);
    self.postMessage({ id: data.id, out }, transfer);
  } catch (e) {
    self.postMessage({ id: data.id, error: `${e.message}\n${e.stack}` });
  }
};
