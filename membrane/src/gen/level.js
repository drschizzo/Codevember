// Une couche complète : armature, motif de déchirure qui en découle, et
// simulation de l'éclosion de sa membrane.
import { buildArmature, cageFaces } from './armature.js';
import { prepareMembrane } from './prep.js';

const rad = (d) => (d * Math.PI) / 180;

export function tearPattern(A, arm, M) {
  const base = {
    warp: M.warp, warpScale: M.warpScale, branch: M.branch, branchReach: 3, branchStrength: M.branchStrength ?? 1.5,
    seed: `${M.seed}:${A.seed}`, end: rad(A.hinge - 16), twist: 0, phi0: arm.phi0, n: A.n,
  };
  switch (A.kind) {
    case 'iris': return { ...base, kind: 'star', twist: A.twist };
    case 'calyx': case 'pod': case 'ribs': case 'claws': return { ...base, kind: 'star' };
    case 'crown': return { ...base, kind: 'sites', sites: arm.sites, sectors: M.sectors ?? 4, pole: rad(13), end: rad(A.spread + 14) };
    case 'cage': return { ...base, kind: 'faces', faces: cageFaces(A, arm.parts[0]), end: Math.PI };
    default: return { ...base, kind: 'star' };
  }
}

export function buildLevel({ arm: A, mem: M, sim: Q, inner }) {
  const arm = buildArmature({ ...A, inner });
  const S = {
    ...M, ...Q, inner,
    anchor: A.kind === 'cage' ? 150 : Math.min(170, A.hinge + 12),
    // (couronne : aucune épingle au pôle — la calotte doit céder d'elle-même)
    init: A.kind === 'crown' ? Math.max(M.init, 0.85) : M.init,
    // (cage : la membrane gonfle jusqu'à céder)
    // (les à-coups de pression accompagnent les assauts ; la cage, elle, gonfle)
    inflate: A.kind === 'cage' ? (A.inflate ?? 2) : (A.surge ?? 0.4),
    pattern: tearPattern(A, arm, M),
  };
  const t0 = performance.now();
  const prep = prepareMembrane(S, arm);
  prep.info.prepMs = Math.round(performance.now() - t0);
  // paramètres de la simulation (lus par le GPU)
  prep.params = S;
  delete prep.params.pattern;
  return { armature: arm.mesh, accent: arm.accent, prep };
}
