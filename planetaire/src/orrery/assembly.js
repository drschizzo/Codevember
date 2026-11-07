// Tournage : assemblage de la machine, comme par un horloger.
//
// Chaque pièce (enfant direct de la machine) DESCEND à la verticale jusqu'à sa
// place, de bas en haut : une pièce ne traverse que l'espace encore vide
// au-dessus d'elle (les roues s'enfilent sur leurs arbres, les ponts se posent
// sur leurs piliers). Le décalage est posé juste avant le rendu et retiré
// juste après : les pièces animées par update() s'assemblent aussi.
import * as THREE from 'three/webgpu';
import { smoother } from '../util.js';

export function createAssembly(root) {
  let parts = null;
  const saved = [];

  function prepare() {
    parts = [];
    const box = new THREE.Box3();
    for (const o of root.children) {
      if (o.isLight || o.userData.noAssemble) continue;
      box.setFromObject(o);
      if (box.isEmpty()) continue;
      const glass = (o.material && o.material.blending === THREE.AdditiveBlending) || !!o.userData.isHeap; // (le tas arrive avec son globe)
      parts.push({ o, y0: box.min.y, y1: box.max.y, r: Math.hypot((box.min.x + box.max.x) / 2, (box.min.z + box.max.z) / 2), glass });
    }
    // de bas en haut ; à hauteur égale, du centre vers le bord ; le verre en dernier
    parts.sort((a, b) => (a.glass - b.glass) || (a.y0 - b.y0) || (a.r - b.r));
    const solid = parts.filter((p) => !p.glass), n = solid.length;
    solid.forEach((p, i) => {
      p.t0 = 0.72 * Math.pow(i / Math.max(1, n - 1), 1.1); // départs répartis sur 0 → 0,72, par paquets
      p.d = 0.16;
      p.h = 7 + 1.2 * (p.y1 - p.y0);                       // (assez haut pour entrer par le haut du cadre)
    });
    for (const p of parts) if (p.glass) { p.t0 = 0.76; p.d = 0.22; p.h = 13; }
  }

  return {
    // k : avancement de l'assemblage (0 = rien, 1 = machine complète)
    apply(k) {
      if (!parts) prepare();
      saved.length = 0;
      if (k >= 1) return;
      for (const p of parts) {
        const u = Math.min(1, Math.max(0, (k - p.t0) / p.d));
        if (u >= 1) continue;
        const o = p.o;
        saved.push([o, o.position.y, o.visible]);
        if (u <= 0) { o.visible = false; continue; }
        o.position.y += p.h * (1 - smoother(u));
      }
    },
    restore() {
      for (const [o, y, vis] of saved) { o.position.y = y; o.visible = vis; }
      saved.length = 0;
    },
  };
}
