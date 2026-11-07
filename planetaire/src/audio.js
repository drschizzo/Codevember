// Sonification — « Sillons »
//
// Une seule règle, audible et visible : la TÊTE DE LECTURE (invisible,
// fixe) lit le disque comme un vinyle. Ce qui passe dessous joue.
//
// · Hauteur = distance à l'étoile, sur une même gamme pour tout le disque :
//   près de l'étoile = aigu, bord externe = grave. Un anneau de poussière à
//   3 UA et une planète à 3 UA jouent la même note.
// · Chaque planète sonne quand elle croise la tête. Les planètes internes,
//   rapides, battent vite ; les lointaines, rarement. Deux planètes en
//   résonance 3:2 produisent un motif rythmique 3 contre 2.
//   Timbre et durée suivent la masse : petite rocheuse = clochette sèche,
//   géante gazeuse = cloche grave et longue.
// · Les grumeaux et anneaux de poussière qui passent sous la tête « pincent »
//   doucement leur note ; les lacunes ouvertes par les planètes se taisent.
// · Un bourdon suit la quantité de poussière : il s'assombrit quand le disque
//   s'épuise.
// · Impact géant : grondement, puis pluie de débris aigus.

import { R_IN, R_OUT } from './sim.js';

const SCALE = [0, 2, 4, 7, 9];      // pentatonique majeure : toujours consonante
const BASE = 73.42;                 // ré 1
const STEPS = 17;                   // ~3,5 octaves du bord externe à l'étoile

// Distance → degré de gamme → fréquence (logarithmique en rayon)
function degreeOf(a) {
  const n = Math.log(R_OUT / Math.max(a, R_IN)) / Math.log(R_OUT / R_IN);
  return Math.max(0, Math.min(STEPS, Math.round(n * STEPS)));
}
function freqOfDegree(d, octave = 0) {
  const semi = SCALE[d % 5] + 12 * Math.floor(d / 5) + 12 * octave;
  return BASE * Math.pow(2, semi / 12);
}

export class Sonifier {
  constructor() { this.ctx = null; this.muted = false; this.noises = new Map(); }

  // Tampon de bruit blanc de `dur` secondes, enveloppé par env(t ∈ [0, 1], i),
  // construit une seule fois par clé.
  noise(key, dur, env, channels = 1) {
    let buf = this.noises.get(key);
    if (!buf) {
      const n = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
      buf = this.ctx.createBuffer(channels, n, this.ctx.sampleRate);
      for (let c = 0; c < channels; c++) {
        const d = buf.getChannelData(c);
        for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * env(i / n, i);
      }
      this.noises.set(key, buf);
    }
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    return src;
  }

  start() {
    if (this.ctx) return;
    const ctx = this.ctx = new AudioContext();
    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 3; comp.attack.value = 0.01;
    this.master.connect(comp).connect(ctx.destination);

    // Réverbération synthétique, longue et sombre
    const len = ctx.sampleRate * 5;
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        lp = lp * 0.6 + (Math.random() * 2 - 1) * 0.4;
        d[i] = lp * Math.pow(1 - i / len, 2.6);
      }
    }
    this.verb = ctx.createConvolver();
    this.verb.buffer = ir;
    const wet = ctx.createGain(); wet.gain.value = 0.7;
    this.verb.connect(wet).connect(this.master);
    this.bus = ctx.createGain();
    this.bus.connect(this.master);
    this.send = ctx.createGain(); this.send.gain.value = 0.6;
    this.bus.connect(this.send).connect(this.verb);

    // Bourdon : quinte à vide (ré–la) en dents de scie filtrées
    this.drone = ctx.createGain(); this.drone.gain.value = 0;
    this.droneLP = ctx.createBiquadFilter(); this.droneLP.type = 'lowpass'; this.droneLP.frequency.value = 300; this.droneLP.Q.value = 0.5;
    for (const [f, det] of [[BASE / 2, -4], [BASE / 2, 5], [BASE * 0.75, 0], [BASE, 2]]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det;
      o.connect(this.droneLP); o.start();
    }
    this.droneLP.connect(this.drone).connect(this.bus);
    this.drone.gain.setTargetAtTime(0.035, ctx.currentTime, 3);

    this.bands = [];
    this.flyNoise = null;
  }

  // temp : coupure temporaire (avance rapide) sans changer le choix de l'utilisateur
  setMuted(m, temp) {
    if (temp === undefined) this.muted = m;
    this.tempMute = !!temp;
    const off = this.muted || this.tempMute;
    if (this.ctx) this.master.gain.setTargetAtTime(off ? 0 : 0.8, this.ctx.currentTime, 0.1);
  }

  // Une planète croise la tête de lecture.
  // a : rayon orbital, mE : masse (M⊕), gas : fraction de gaz, pan ∈ [-1, 1]
  planetNote({ a, mE, gas = 0, selected = false, pan = 0 }) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime + 0.01;
    const f = freqOfDegree(degreeOf(a), 1);
    const heavy = Math.min(1, Math.log10(1 + mE) / 2.5); // 0 (embryon) → 1 (~300 M⊕)
    const dur = 0.5 + 4.5 * heavy;
    const amp = (0.05 + 0.13 * heavy) * (selected ? 1.6 : 1);

    const out = ctx.createGain();
    const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, pan));
    out.connect(p).connect(this.bus);
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(amp, t + 0.004);
    out.gain.exponentialRampToValueAtTime(1e-4, t + dur);

    // FM : rapport inharmonique (cloche) pour les rocheuses, harmonique (doux)
    // pour les géantes gazeuses
    const car = ctx.createOscillator(); car.frequency.value = f;
    const mod = ctx.createOscillator(); mod.frequency.value = f * (gas > 0.3 ? 2.0 : 3.5);
    const idx = ctx.createGain();
    idx.gain.setValueAtTime(f * (1.2 + 2 * (1 - heavy)), t);
    idx.gain.exponentialRampToValueAtTime(f * 0.05, t + dur * 0.5);
    mod.connect(idx).connect(car.frequency);
    car.connect(out);
    const nodes = [car, mod];
    if (heavy > 0.45) { // les grosses planètes ont une octave grave en plus
      const sub = ctx.createOscillator(); sub.frequency.value = f / 2;
      const sg = ctx.createGain(); sg.gain.value = 0.6 * heavy;
      sub.connect(sg).connect(out); nodes.push(sub);
    }
    for (const n of nodes) { n.start(t); n.stop(t + dur + 0.1); }
  }

  // needle : densité par anneau radial sous la tête de lecture
  updateDisk(needle, nUsed, radiusOf, dustFrac) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    // bourdon : plus le disque est riche, plus il est ouvert
    this.droneLP.frequency.setTargetAtTime((140 + 700 * dustFrac) * (this.mood ?? 1), t, 1.5);
    this.drone.gain.setTargetAtTime(this.muted ? 0 : 0.012 + 0.03 * dustFrac, t, 1.5);

    // regroupe les anneaux par degré de gamme
    const vals = (this.vals ||= new Float32Array(STEPS + 1)).fill(0);
    let total = 0;
    for (let i = 0; i < nUsed; i++) { vals[degreeOf(radiusOf(i))] += needle[i]; total += needle[i]; }
    const mean = total / (STEPS + 1) + 1e-6;
    for (let d = 0; d <= STEPS; d++) {
      const B = this.bands[d] ||= { avg: 0, last: 0, lastPluck: 0 };
      const v = vals[d] / mean;
      B.avg = B.avg === 0 ? v : B.avg * 0.96 + v * 0.04;
      // un grumeau ou un anneau passe sous la tête : on pince sa note
      if (v > B.avg * 1.35 && v - B.last > 0.15 && t - B.lastPluck > 0.35 && !this.muted) {
        this.pluck(freqOfDegree(d, 2), Math.min(1, (v / B.avg - 1) * 0.8));
        B.lastPluck = t;
      }
      B.last = v;
    }
  }

  pluck(f, amp, when = 0) {
    const ctx = this.ctx, t = ctx.currentTime + when;
    const o = ctx.createOscillator(); o.type = 'triangle'; o.frequency.value = f;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = f * 3;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.022 * amp, t + 0.003);
    g.gain.exponentialRampToValueAtTime(1e-4, t + 0.9);
    const p = ctx.createStereoPanner(); p.pan.value = Math.random() * 1.2 - 0.6;
    o.connect(lp).connect(g).connect(p).connect(this.bus);
    o.start(t); o.stop(t + 1);
  }

  // Impact géant : grondement + craquement + pluie de débris sur la gamme
  impact(strength, a, pan = 0) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const k = Math.min(1, 0.4 + 0.25 * Math.cbrt(strength));
    const P = ctx.createStereoPanner(); P.pan.value = pan * 0.6; P.connect(this.bus);

    // grondement : sinus qui plonge
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(28, t + 3);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.5 * k, t + 0.008);
    g.gain.exponentialRampToValueAtTime(1e-4, t + 4);
    o.connect(g).connect(P); o.start(t); o.stop(t + 4.1);

    // craquement : bruit dont le filtre se referme
    const n = this.noise('impact', 3, (t) => Math.pow(1 - t, 3));
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 2;
    lp.frequency.setValueAtTime(6000, t);
    lp.frequency.exponentialRampToValueAtTime(80, t + 2.5);
    const ng = ctx.createGain(); ng.gain.value = 0.45 * k;
    n.connect(lp).connect(ng).connect(P); n.start(t);

    // débris : notes aiguës éparses autour du degré de l'impact
    const d0 = degreeOf(a);
    const count = Math.round(6 + 10 * k);
    for (let i = 0; i < count; i++) {
      const dd = Math.max(0, Math.min(STEPS, d0 + Math.round((Math.random() - 0.3) * 6)));
      this.pluck(freqOfDegree(dd, 2), 0.6 + Math.random() * 0.8, 0.4 + Math.pow(Math.random(), 1.6) * 3);
    }
  }

  // Allumage de l'étoile : accord majeur qui s'ouvre lentement + scintillement
  ignition() {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const out = ctx.createGain(); out.connect(this.bus);
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(0.16, t + 2.5);
    out.gain.exponentialRampToValueAtTime(1e-4, t + 12);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 0.8;
    lp.frequency.setValueAtTime(200, t); lp.frequency.exponentialRampToValueAtTime(4000, t + 4);
    lp.connect(out);
    for (const [semi, det] of [[0, -6], [7, 4], [12, 0], [16, 3], [19, -3], [24, 5]]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      o.frequency.value = BASE * Math.pow(2, semi / 12); o.detune.value = det;
      const g = ctx.createGain(); g.gain.value = 0.12;
      o.connect(g).connect(lp); o.start(t); o.stop(t + 12.2);
    }
    for (let i = 0; i < 14; i++) this.pluck(freqOfDegree(10 + Math.floor(Math.random() * 8), 1), 0.7, 1.5 + Math.random() * 5);
    this.drone.gain.setTargetAtTime(0.045, t + 2, 3);
  }

  // Supergéante : le bourdon descend et s'assombrit
  giant() { this.mood = 0.3; }

  // Supernova : effondrement (aspiration), puis déflagration et longue traîne
  supernova() {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    this.impact(60, 1, 0);
    const n = this.noise('supernova', 9, (t) => Math.pow(1 - t, 2), 2);
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 1;
    lp.frequency.setValueAtTime(9000, t); lp.frequency.exponentialRampToValueAtTime(60, t + 8);
    const g = ctx.createGain(); g.gain.value = 0.55;
    n.connect(lp).connect(g).connect(this.bus); n.start(t);
    const o = ctx.createOscillator(); o.frequency.setValueAtTime(55, t); o.frequency.exponentialRampToValueAtTime(18, t + 7);
    const og = ctx.createGain(); og.gain.setValueAtTime(0.6, t); og.gain.exponentialRampToValueAtTime(1e-4, t + 8);
    o.connect(og).connect(this.bus); o.start(t); o.stop(t + 8.2);
    this.drone.gain.setTargetAtTime(0.0, t, 2);
    this.mood = 1;
    this.drone.gain.setTargetAtTime(0.03, t + 12, 4);
  }

  // Pulsar : un « tic » sec à chaque passage du faisceau (les pulsars captés
  // par les radiotélescopes, convertis en son, ressemblent exactement à ça)
  pulsarTick() {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const n = this.noise('tick', 0.04, (t, i) => Math.exp(-i / (ctx.sampleRate * 0.004)));
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2400; bp.Q.value = 1.2;
    const g = ctx.createGain(); g.gain.value = 0.5;
    n.connect(bp).connect(g).connect(this.bus); n.start(t);
    const o = ctx.createOscillator(); o.frequency.setValueAtTime(180, t); o.frequency.exponentialRampToValueAtTime(60, t + 0.08);
    const og = ctx.createGain(); og.gain.setValueAtTime(0.25, t); og.gain.exponentialRampToValueAtTime(1e-4, t + 0.1);
    o.connect(og).connect(this.bus); o.start(t); o.stop(t + 0.12);
  }

  // Mécanique : le cliquet qui retombe dans une dent du rochet (remontage),
  // et le déclic du levier d'arrêt qui libère le balancier (nouveau cycle)
  click() { this._metal(5200, 0.18, 0.0025, 0); }
  clack() { this._metal(1800, 0.55, 0.008, 140); }
  _metal(freq, gain, decay, thump) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const n = this.noise(`metal${decay}`, 0.06, (t, i) => Math.exp(-i / (ctx.sampleRate * decay)));
    const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = freq * (0.9 + Math.random() * 0.2); bp.Q.value = 6;
    const g = ctx.createGain(); g.gain.value = gain;
    n.connect(bp).connect(g).connect(this.bus); n.start(t);
    if (thump) {
      const o = ctx.createOscillator(); o.frequency.setValueAtTime(thump, t); o.frequency.exponentialRampToValueAtTime(thump * 0.4, t + 0.1);
      const og = ctx.createGain(); og.gain.setValueAtTime(0.3, t); og.gain.exponentialRampToValueAtTime(1e-4, t + 0.14);
      o.connect(og).connect(this.bus); o.start(t); o.stop(t + 0.16);
    }
  }

  // Étoile vagabonde : souffle filtré qui suit la distance (effet Doppler grossier)
  flyby(dist, pan, approaching) {
    if (!this.ctx) return;
    const ctx = this.ctx, t = ctx.currentTime;
    if (!this.flyNoise) {
      const n = this.noise('wind', 2, () => 1);
      n.loop = true;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 3;
      const g = ctx.createGain(); g.gain.value = 0;
      const p = ctx.createStereoPanner();
      n.connect(bp).connect(g).connect(p).connect(this.bus); n.start();
      this.flyNoise = { n, bp, g, p };
    }
    const F = this.flyNoise;
    if (dist == null) {
      F.g.gain.setTargetAtTime(0, t, 0.5);
      F.n.stop(t + 3); this.flyNoise = null;
      return;
    }
    const near = 1 / (1 + (dist / 8) ** 2);
    F.g.gain.setTargetAtTime(this.muted ? 0 : 0.25 * near, t, 0.1);
    F.bp.frequency.setTargetAtTime((approaching ? 900 : 500) * (0.5 + near), t, 0.2);
    F.p.pan.setTargetAtTime(Math.max(-1, Math.min(1, pan)), t, 0.1);
  }
}
