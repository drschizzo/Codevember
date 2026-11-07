// Son génératif (Web Audio), synchronisé sur la plongée :
//   · une nappe : quelques oscillateurs désaccordés et un souffle filtré, dont le
//     filtre respire avec la phase de la boucle (la boucle sonore est parfaite) ;
//   · une cloche à chaque passage d'oculus (partiels inharmoniques, hauteur tirée
//     de la gamme de l'humeur selon la couche) ;
//   · un cliquetis d'horlogerie quand un diaphragme commence à s'ouvrir ;
//   · une réverbération de nef (réponse impulsionnelle générée).
// Rien ne sonne avant un geste de l'utilisateur (règle des navigateurs).

// gammes : fondamentale (Hz) et intervalles (demi-tons), par humeur
const SCALES = {
  atelier: [110, [0, 3, 5, 7, 10, 12, 15]], luxe: [98, [0, 3, 7, 10, 12, 14, 19]], studio: [123.47, [0, 2, 4, 7, 9, 12, 14]],
  nuit: [73.42, [0, 2, 3, 7, 9, 10, 14]], pastel: [174.61, [0, 2, 4, 6, 7, 11, 12]], 'irisé': [130.81, [0, 4, 6, 7, 11, 14, 18]],
  clinique: [261.63, [0, 2, 4, 7, 9, 12, 16]], abysses: [55, [0, 3, 7, 8, 12, 15, 19]], 'sacré': [82.41, [0, 7, 12, 16, 19, 24, 28]],
};
const hz = (root, semi) => root * 2 ** (semi / 12);

export function createSound() {
  let ctx = null, master = null, wet = null, drone = null, on = false;
  let lastTau = null, mood = '';

  function impulse(seconds = 3.2) {
    const n = Math.round(ctx.sampleRate * seconds), buf = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n) ** 2.6;
    }
    return buf;
  }

  function init() {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(ctx.destination);
    const rev = ctx.createConvolver();
    rev.buffer = impulse();
    wet = ctx.createGain();
    wet.gain.value = 0.55;
    wet.connect(rev).connect(master);
  }

  // nappe de l'humeur (reconstruite quand l'humeur change)
  function buildDrone(key) {
    if (drone) { const old = drone; old.out.gain.setTargetAtTime(0, ctx.currentTime, 0.6); setTimeout(() => old.nodes.forEach((n) => n.stop?.()), 3000); }
    const [root, iv] = SCALES[key] ?? SCALES.atelier;
    const out = ctx.createGain();
    out.gain.value = 0;
    out.gain.setTargetAtTime(0.16, ctx.currentTime, 1.5);
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 600;
    filter.Q.value = 0.7;
    filter.connect(out);
    out.connect(master);
    out.connect(wet);
    const nodes = [];
    for (const [semi, type, g, det] of [[0, 'sawtooth', 0.22, -6], [0, 'sawtooth', 0.22, 7], [iv[3], 'triangle', 0.3, 3], [12, 'sine', 0.25, 0], [-12, 'sine', 0.4, 0]]) {
      const o = ctx.createOscillator(), gn = ctx.createGain();
      o.type = type;
      o.frequency.value = hz(root, semi);
      o.detune.value = det;
      gn.gain.value = g;
      o.connect(gn).connect(filter);
      o.start();
      nodes.push(o);
    }
    // souffle : bruit filtré en bande
    const len = ctx.sampleRate * 4, nb = ctx.createBuffer(1, len, ctx.sampleRate), d = nb.getChannelData(0);
    let b = 0;
    for (let i = 0; i < len; i++) { b = 0.97 * b + 0.03 * (Math.random() * 2 - 1); d[i] = b * 6; }
    const ns = ctx.createBufferSource();
    ns.buffer = nb;
    ns.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900;
    bp.Q.value = 0.6;
    const ng = ctx.createGain();
    ng.gain.value = 0.05;
    ns.connect(bp).connect(ng).connect(out);
    ns.start();
    nodes.push(ns);
    drone = { out, filter, nodes, bp, root, iv };
  }

  function bell(freq, gain = 0.22) {
    const t = ctx.currentTime, out = ctx.createGain();
    out.gain.value = gain;
    out.connect(master);
    out.connect(wet);
    for (const [ratio, amp, dec] of [[1, 1, 3.2], [2.76, 0.5, 1.8], [5.4, 0.25, 1.1], [8.93, 0.12, 0.6], [0.5, 0.35, 4]]) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.value = freq * ratio;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(amp, t + 0.004);
      g.gain.exponentialRampToValueAtTime(1e-4, t + dec);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + dec + 0.1);
    }
  }

  // cliquetis : de courtes impulsions de bruit aigu, de plus en plus serrées
  function ratchet(count = 9) {
    const t0 = ctx.currentTime;
    for (let i = 0; i < count; i++) {
      const t = t0 + 0.55 * (1 - (1 - i / count) ** 1.6), n = ctx.createBufferSource();
      const len = Math.round(ctx.sampleRate * 0.012), buf = ctx.createBuffer(1, len, ctx.sampleRate), d = buf.getChannelData(0);
      for (let k = 0; k < len; k++) d[k] = (Math.random() * 2 - 1) * (1 - k / len) ** 3;
      n.buffer = buf;
      const hp = ctx.createBiquadFilter();
      hp.type = 'bandpass';
      hp.frequency.value = 3200 + Math.random() * 1800;
      hp.Q.value = 4;
      const g = ctx.createGain();
      g.gain.value = 0.35;
      n.connect(hp).connect(g);
      g.connect(master);
      g.connect(wet);
      n.start(t);
    }
  }

  // un événement à chaque fois que τ franchit c (modulo N), en avançant
  const crossed = (a, b, c, N) => b > a && b - a < 1 && Math.floor((b - c) / N) > Math.floor((a - c) / N);

  return {
    get on() { return on; },
    toggle() {
      if (!ctx) init();
      on = !on;
      if (on) ctx.resume();
      master.gain.setTargetAtTime(on ? 0.8 : 0, ctx.currentTime, 0.4);
      return on;
    },
    // s : { tau, phase, N, layers, mood }
    update(s) {
      if (!ctx || !on) { lastTau = s.tau; return; }
      if (s.mood !== mood || !drone) { mood = s.mood; buildDrone(mood); }
      // le filtre de la nappe respire avec la boucle
      const w = Math.sin(s.phase * Math.PI * 2);
      drone.filter.frequency.setTargetAtTime(500 + 450 * (0.5 + 0.5 * w), ctx.currentTime, 0.3);
      drone.bp.frequency.setTargetAtTime(700 + 600 * (0.5 + 0.5 * Math.sin(s.phase * Math.PI * 4)), ctx.currentTime, 0.5);
      const a = lastTau;
      lastTau = s.tau;
      if (a === null) return;
      for (let i = 0; i < s.N; i++) {
        // passage de l'oculus de la couche i (x = 0)
        if (crossed(a, s.tau, i, s.N)) bell(hz(drone.root * 2, drone.iv[i % drone.iv.length]));
        // ouverture du diaphragme (x ≈ 1,2 : début de l'ouverture)
        if (s.layers[i].geo.iris?.blades && crossed(a, s.tau, i - 1.2, s.N)) ratchet(Math.min(14, s.layers[i].geo.iris.blades + 2));
      }
    },
  };
}
