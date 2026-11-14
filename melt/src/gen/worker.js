// Worker de génération : la simulation du lac (gen/lake.js), puis la bascule
// du fuseau libéré (gen/body.js), hors du fil principal. L'avancement porte un
// instantané du profil, que l'écran de chargement dessine (app/loaderArt.js).
import { runLake } from './lake.js';
import { simulateBody } from './body.js';

function build({ id, spec, what }) {
  switch (what) {
    case 'lake': {
      let last = 0;
      const S = runLake(spec.sim, (f, snap) => {
        const now = Date.now();
        if (now - last < 120) return;
        last = now;
        self.postMessage({ id, progress: f * 0.97, label: JSON.stringify(snap) });
      });
      const B = S.detach ? simulateBody({ prof: S.detach.prof, dz: S.dx, tilt0: spec.body.tilt0 }) : null;
      return { S, B };
    }
    default: throw new Error(`inconnu : ${what}`);
  }
}

self.onmessage = ({ data }) => {
  try {
    const out = build(data);
    const transfer = [];
    const walk = (o) => { if (!o) return; for (const v of Object.values(o)) { if (ArrayBuffer.isView(v)) transfer.push(v.buffer); else if (v && typeof v === 'object') walk(v); } };
    walk(out);
    self.postMessage({ id: data.id, out }, transfer);
  } catch (e) {
    self.postMessage({ id: data.id, error: `${e.message}\n${e.stack}` });
  }
};
