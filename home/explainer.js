// Outils communs des pages « défis techniques ».
//
//   import { demo, C, lerp, clamp, smooth, rng } from '../home/explainer.js';
//
//   demo('#id-du-figure', {
//     aspect: 16 / 9,                       // rapport du canvas
//     title: 'Le flambage',                 // bandeau au-dessus (facultatif)
//     controls: [{ key: 'k', label: 'Tours', min: 0, max: 10, step: .1, value: 3, fmt: (v) => v.toFixed(1) }],
//     buttons: [{ label: 'Rejouer', onClick: (d) => d.reset() }, { key: 'sharp', label: 'Arête vive', toggle: true }],
//     animate: true,                        // boucle d'animation (seulement quand la figure est visible)
//     setup(d) {},                          // appelé une fois (et à chaque reset)
//     draw(g, d) {},                        // g : CanvasRenderingContext2D en px CSS ; d.w, d.h, d.t, d.dt, d.s (valeurs), d.state
//     pointer(d, e) {},                     // e : { x, y, down, type } en px CSS
//   });
//
// Les couleurs viennent des variables CSS (C.c1…C.c4, C.ink, C.dim, C.grid, C.bg).
// Les formules en LaTeX entre \( \) ou \[ \] sont rendues par KaTeX si la page le charge.
// Le sommaire (.toc ol vide) est rempli d'après les <section id> et leur <h2>.

const css = getComputedStyle(document.documentElement);
const v = (n) => css.getPropertyValue(n).trim();
export const C = {
  c1: v('--c1'), c2: v('--c2'), c3: v('--c3'), c4: v('--c4'),
  ink: v('--ink'), dim: v('--dim'), faint: v('--faint'), grid: v('--grid'), bg: v('--panel'), line: v('--line-2'),
};

export const lerp = (a, b, t) => a + (b - a) * t;
export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
export function rng(seed = 1) { let s = seed >>> 0 || 1; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
export const TAU = Math.PI * 2;

/** Couleur avec alpha : alpha('#e9c48a', .3) */
export function alpha(hex, a) {
  const h = hex.replace('#', ''); const n = parseInt(h.length === 3 ? h.replace(/./g, '$&$&') : h, 16);
  return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`;
}

/** Texte de figure dans la police de la page. */
export function label(g, text, x, y, { color = C.dim, size = 12, align = 'left', base = 'alphabetic', font = 'Inter' } = {}) {
  g.save(); g.fillStyle = color; g.font = `400 ${size}px ${font}, system-ui, sans-serif`; g.textAlign = align; g.textBaseline = base; g.fillText(text, x, y); g.restore();
}

/** Flèche de (x0,y0) à (x1,y1). */
export function arrow(g, x0, y0, x1, y1, { color = C.ink, width = 1.25, head = 7 } = {}) {
  const a = Math.atan2(y1 - y0, x1 - x0);
  g.save(); g.strokeStyle = g.fillStyle = color; g.lineWidth = width;
  g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1 - Math.cos(a) * head * .6, y1 - Math.sin(a) * head * .6); g.stroke();
  g.beginPath(); g.moveTo(x1, y1); g.lineTo(x1 - head * Math.cos(a - .38), y1 - head * Math.sin(a - .38)); g.lineTo(x1 - head * Math.cos(a + .38), y1 - head * Math.sin(a + .38)); g.closePath(); g.fill();
  g.restore();
}

export function demo(sel, opt) {
  const fig = typeof sel === 'string' ? document.querySelector(sel) : sel;
  if (!fig) return null;
  const box = document.createElement('div'); box.className = 'demo';
  if (opt.title) {
    const t = document.createElement('div'); t.className = 'title';
    t.innerHTML = `<span></span><span></span>`; t.firstChild.textContent = opt.title; box.append(t);
  }
  const cv = document.createElement('canvas'); cv.style.setProperty('--ar', String(opt.aspect ?? 16 / 9));
  cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', opt.alt ?? opt.title ?? 'Démo');
  box.append(cv);
  const g = cv.getContext('2d');
  const d = { w: 0, h: 0, t: 0, dt: 0, s: {}, state: {}, canvas: cv, g, fig, dirty: true };
  d.status = (html) => { const el = box.querySelector('.title span:last-child'); if (el) el.innerHTML = html; };
  let readout;
  d.readout = (html) => { if (!readout) { readout = document.createElement('div'); readout.className = 'readout'; box.append(readout); } readout.innerHTML = html; };
  d.redraw = () => { d.dirty = true; if (!opt.animate) frame(performance.now()); };
  d.reset = () => { d.t = 0; d.state = {}; opt.setup?.(d); d.redraw(); };

  if (opt.controls?.length || opt.buttons?.length) {
    const ctl = document.createElement('div'); ctl.className = 'ctl';
    for (const c of opt.controls ?? []) {
      d.s[c.key] = c.value;
      const lab = document.createElement('label');
      const name = document.createElement('span'); name.textContent = c.label;
      const out = document.createElement('output');
      const inp = document.createElement('input'); Object.assign(inp, { type: 'range', min: c.min, max: c.max, step: c.step ?? (c.max - c.min) / 100, value: c.value });
      const fmt = c.fmt ?? ((x) => String(+x.toFixed(3)));
      out.textContent = fmt(c.value);
      inp.addEventListener('input', () => { d.s[c.key] = +inp.value; out.textContent = fmt(+inp.value); c.onChange?.(d); d.redraw(); });
      lab.append(name, out, inp); ctl.append(lab);
    }
    if (opt.buttons?.length) {
      const b = document.createElement('div'); b.className = 'btns';
      for (const k of opt.buttons) {
        const btn = document.createElement('button'); btn.type = 'button'; btn.textContent = k.label;
        if (k.toggle) { d.s[k.key] = !!k.value; btn.setAttribute('aria-pressed', String(!!k.value)); }
        btn.addEventListener('click', () => {
          if (k.toggle) { d.s[k.key] = !d.s[k.key]; btn.setAttribute('aria-pressed', String(d.s[k.key])); }
          k.onClick?.(d); d.redraw();
        });
        b.append(btn);
      }
      ctl.append(b);
    }
    box.append(ctl);
  }
  fig.prepend(box);

  const size = () => {
    const r = cv.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1);
    d.w = r.width; d.h = r.height; cv.width = Math.round(r.width * dpr); cv.height = Math.round(r.height * dpr);
    g.setTransform(dpr, 0, 0, dpr, 0, 0); d.dirty = true;
  };
  new ResizeObserver(() => { size(); opt.resize?.(d); if (!opt.animate || !visible) frame(performance.now()); }).observe(cv);

  if (opt.pointer) {
    const pe = (e, type) => { const r = cv.getBoundingClientRect(); opt.pointer(d, { x: e.clientX - r.left, y: e.clientY - r.top, down: e.buttons > 0, type }); d.redraw(); };
    cv.addEventListener('pointerdown', (e) => { cv.setPointerCapture(e.pointerId); pe(e, 'down'); });
    cv.addEventListener('pointermove', (e) => pe(e, 'move'));
    cv.addEventListener('pointerup', (e) => pe(e, 'up'));
  }

  let last = 0, visible = false, raf = 0;
  function frame(now) {
    if (!d.w) return;
    d.dt = last ? Math.min(.05, (now - last) / 1000) : 0; last = now;
    if (opt.animate) d.t += d.dt;
    g.clearRect(0, 0, d.w, d.h);
    opt.draw(g, d); d.dirty = false;
  }
  const loop = (now) => { frame(now); raf = visible && opt.animate ? requestAnimationFrame(loop) : 0; };
  new IntersectionObserver(([e]) => {
    visible = e.isIntersecting; last = 0;
    if (visible && opt.animate && !raf) raf = requestAnimationFrame(loop);
  }, { rootMargin: '80px' }).observe(cv);

  opt.setup?.(d);
  return d;
}

// ── sommaire et formules ──
function toc() {
  const ol = document.querySelector('.toc ol');
  if (!ol || ol.children.length) return;
  document.querySelectorAll('article > section[id]').forEach((s) => {
    const h = s.querySelector('h2'); if (!h) return;
    const li = document.createElement('li'), a = document.createElement('a');
    a.href = `#${s.id}`; a.textContent = [...h.childNodes].filter((n) => !(n.classList?.contains('n'))).map((n) => n.textContent).join('').trim();
    li.append(a); ol.append(li);
  });
}
function maths() {
  if (!window.renderMathInElement) return false;
  window.renderMathInElement(document.querySelector('article') ?? document.body, {
    delimiters: [{ left: '\\[', right: '\\]', display: true }, { left: '\\(', right: '\\)', display: false }],
    throwOnError: false,
  });
  return true;
}
toc();
if (!maths()) addEventListener('load', maths, { once: true });
