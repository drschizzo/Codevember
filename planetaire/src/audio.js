// Sonification — « Sillons »
//
// · Le disque est lu comme un vinyle : une tête de lecture FIXE mesure la
//   densité de poussière le long d'un rayon ; c'est la rotation képlérienne
//   du disque qui fait défiler la matière dessous. Chaque bande radiale est
//   une voix (gamme pentatonique, aigus au centre) ; les lacunes creusées par
//   les planètes se taisent, les anneaux et les grumeaux « pincent ».
// · Chaque planète chante à une fréquence proportionnelle à sa fréquence
//   orbitale réelle (repliée par octaves) : deux planètes en résonance 3:2
//   jouent littéralement une quinte, 2:1 une octave. Le panoramique suit
//   leur position sur l'orbite.
// · Les impacts géants sonnent comme des gongs.

const PENTA = [0, 3, 5, 7, 10];

export class Sonifier {
  constructor() { this.ctx = null; this.muted = false; this.voices = new Map(); }

  start() {
    if (this.ctx) return;
    const ctx = this.ctx = new AudioContext();
    this.master = ctx.createGain();
    this.master.gain.value = 0.7;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.ratio.value = 4;
    this.master.connect(comp).connect(ctx.destination);

    // Réverbération synthétique (bruit à décroissance exponentielle)
    const len = ctx.sampleRate * 4;
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
    this.verb = ctx.createConvolver();
    this.verb.buffer = ir;
    const wet = ctx.createGain(); wet.gain.value = 0.55;
    this.verb.connect(wet).connect(this.master);
    this.bus = ctx.createGain();
    this.bus.connect(this.master);
    this.bus.connect(this.verb);

    // Voix du disque
    this.NB = 20;
    this.bands = [];
    for (let b = 0; b < this.NB; b++) {
      const step = this.NB - 1 - b; // b = 0 → centre → aigu
      const semi = PENTA[step % 5] + 12 * Math.floor(step / 5);
      const f = 65.41 * Math.pow(2, semi / 12); // à partir de do2
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f;
      const o2 = ctx.createOscillator(); o2.type = 'sine'; o2.frequency.value = f * 2.003;
      const g2 = ctx.createGain(); g2.gain.value = 0.18;
      const g = ctx.createGain(); g.gain.value = 0;
      const pan = ctx.createStereoPanner(); pan.pan.value = (b / (this.NB - 1)) * 0.8 - 0.4;
      o.connect(g); o2.connect(g2).connect(g); g.connect(pan).connect(this.bus);
      o.start(); o2.start();
      this.bands.push({ f, g, avg: 0, last: 0, lastPluck: 0 });
    }
  }

  setMuted(m) {
    this.muted = m;
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.7, this.ctx.currentTime, 0.1);
  }

  // needle : densité par anneau radial (NR valeurs) sous la tête de lecture
  updateDisk(needle, nUsed) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const per = Math.floor(nUsed / this.NB);
    let total = 0;
    const vals = [];
    for (let b = 0; b < this.NB; b++) {
      let s = 0;
      for (let k = 0; k < per; k++) s += needle[b * per + k];
      vals.push(s); total += s;
    }
    const mean = total / this.NB + 1e-6;
    for (let b = 0; b < this.NB; b++) {
      const B = this.bands[b], v = vals[b] / mean;
      B.avg = B.avg === 0 ? v : B.avg * 0.97 + v * 0.03;
      const level = Math.min(2.5, Math.pow(v, 0.8));
      B.g.gain.setTargetAtTime(0.010 * level, t, 0.08);
      // grumeau ou anneau qui passe sous la tête : on pince la corde
      if (v > B.avg * 1.5 && v - B.last > 0.25 && t - B.lastPluck > 0.25) {
        this.pluck(B.f * 2, Math.min(1, (v / B.avg - 1) * 0.5));
        B.lastPluck = t;
      }
      B.last = v;
    }
  }

  pluck(f, amp) {
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.03 * amp, t + 0.005);
    g.gain.exponentialRampToValueAtTime(1e-4, t + 1.2);
    o.connect(g).connect(this.bus);
    o.start(t); o.stop(t + 1.3);
  }

  // planets : [{index, a, x, z, mE}]
  updatePlanets(planets) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const alive = new Set();
    for (const p of planets) {
      if (p.mE < 0.3) continue;
      alive.add(p.index);
      let v = this.voices.get(p.index);
      if (!v) {
        const o = ctx.createOscillator(); o.type = 'triangle';
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 1400; lp.Q.value = 0.7;
        const g = ctx.createGain(); g.gain.value = 0;
        const pan = ctx.createStereoPanner();
        o.connect(lp).connect(g).connect(pan).connect(this.bus);
        o.start();
        v = { o, g, pan };
        this.voices.set(p.index, v);
      }
      // fréquence ∝ fréquence orbitale (Ω ∝ a^-1.5), repliée dans [110, 880[
      let f = 220 * Math.pow(p.a, -1.5);
      while (f < 110) f *= 2;
      while (f >= 880) f /= 2;
      v.o.frequency.setTargetAtTime(f, t, 0.3);
      v.g.gain.setTargetAtTime(Math.min(0.05, 0.01 * Math.cbrt(p.mE)) * (p.selected ? 1.8 : 1), t, 0.3);
      v.pan.pan.setTargetAtTime(Math.max(-1, Math.min(1, p.x / p.a)), t, 0.1);
    }
    for (const [i, v] of this.voices) {
      if (alive.has(i)) continue;
      v.g.gain.setTargetAtTime(0, t, 0.3);
      v.o.stop(t + 2);
      this.voices.delete(i);
    }
  }

  gong(strength = 1) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(38, t + 4);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.25 * strength, t + 0.01);
    g.gain.exponentialRampToValueAtTime(1e-4, t + 5);
    o.connect(g).connect(this.bus);
    o.start(t); o.stop(t + 5.1);
    // bruit d'impact
    const n = ctx.createBufferSource();
    const buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 4);
    n.buffer = buf;
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 400; bp.Q.value = 0.8;
    const ng = ctx.createGain(); ng.gain.value = 0.3 * strength;
    n.connect(bp).connect(ng).connect(this.bus);
    n.start(t);
  }
}
