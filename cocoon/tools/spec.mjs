export const base = (family, shape = 'ovoid', extra = {}) => ({
  family, cage: { shape, R: 0.13, hub: 0.024, ribs: 18, wire: 0.0016 },
  band: { threads: extra.nb ?? 12, thread: 0.0016, gap: 1.04, width: (extra.nb ?? 12) * 0.0016 * 1.04 },
  wind: { c1: 0.55, n1: 8, c2: 0.3, ribs: 5, mu: 0.85, amp: 0.04, k: 1.15, passes: 2 },
  grid: { ns: 512, np: 1024 }, step: 0.003, ...extra,
});
