// Version mobile : détection, résolution dynamique, cadence, gestes tactiles.
//
// Le mode mobile (« allégé ») est choisi au chargement : il change la façon
// dont les matériaux sont compilés (voir scene/materials.js, setLite), on n'en
// change donc qu'en rechargeant la page. ?mobile=1 l'impose (pour l'essayer sur
// un ordinateur), ?mobile=0 l'interdit ; sans paramètre, il suit l'appareil
// (écran tactile et petit écran) ou le choix mémorisé du panneau.

const KEY = 'codevember.mobile';

export function wantsMobile(params) {
  const q = params.get('mobile');
  if (q != null) return q !== '0';
  try { const s = localStorage.getItem(KEY); if (s != null) return s === '1'; } catch { /* stockage indisponible */ }
  const coarse = matchMedia?.('(pointer: coarse)').matches;
  const small = Math.min(screen.width, screen.height) <= 820;
  return (coarse && small) || /Android|iPhone|iPod|Mobile/i.test(navigator.userAgent);
}

// bascule mémorisée, puis rechargement (les matériaux sont compilés autrement)
export function switchMobile(on) {
  try { localStorage.setItem(KEY, on ? '1' : '0'); } catch { /* stockage indisponible */ }
  const url = new URL(location.href);
  url.searchParams.delete('mobile');
  location.href = url.href;
}

// Résolution dynamique : la taille de rendu suit le temps d'image réel (moyenne
// glissante), entre min et max (fractions de la résolution de base). On
// descend vite (par paliers de 15 %), on remonte lentement (8 %), et un palier
// qui a déjà fait décrocher la cadence devient un plafond pour un moment : pas
// d'oscillation entre deux résolutions. Les cibles de rendu ne sont
// réallouées qu'à chaque changement de palier.
export function createGovernor({ target = 1 / 45, min = 0.55, max = 1, onChange }) {
  let scale = max, ema = target, cool = 2, ceil = max, ceilAge = 0, lastUp = 0;
  const q = (s) => Math.round(s * 20) / 20; // (paliers de 5 %)
  return {
    get scale() { return scale; },
    frame(dt) {
      if (!(dt > 0) || dt > 0.25) return; // (onglet en arrière-plan, chargement)
      ema += (dt - ema) * 0.08;
      if ((ceilAge += dt) > 20) { ceil = max; ceilAge = 0; }
      if ((cool -= dt) > 0) return;
      if (ema > target * 1.18 && scale > min) {
        if (lastUp && scale <= lastUp + 1e-3) { ceil = Math.max(min, scale - 0.05); ceilAge = 0; } // (la dernière remontée a fait décrocher)
        scale = Math.max(min, q(scale * 0.85));
        lastUp = 0; cool = 1.2; ema = target;
        onChange(scale);
      } else if (ema < target * 0.72 && scale < Math.min(max, ceil)) {
        scale = Math.min(max, ceil, q(scale * 1.08 + 0.01));
        lastUp = scale; cool = 3; ema = target;
        onChange(scale);
      }
    },
    reset(s = max) { scale = s; ema = target; cool = 2; ceil = max; lastUp = 0; },
  };
}

// Cadence plafonnée (écrans 90 / 120 Hz : inutile de rendre plus de maxFps
// images par seconde, la batterie et la température en profitent). Renvoie
// vrai si cette image doit être rendue. (getMax : cadence maximale, 0 = libre)
export function createPacer(getMax) {
  let next = 0;
  return (now) => {
    const maxFps = getMax();
    if (!maxFps) return true;
    const step = 1000 / maxFps;
    if (now < next - 2) return false; // (2 ms de tolérance : la cadence de l'écran n'est pas exacte)
    next = Math.max(next + step, now);
    return true;
  };
}

// Gestes : une touche → onTap (pause / lecture), deux touches rapprochées →
// onDoubleTap (nouvelle scène), appui long → onLongPress (masquer l'interface).
export function bindTouch(el, { onTap, onDoubleTap, onLongPress }) {
  let t0 = 0, x0 = 0, y0 = 0, lastTap = 0, tapTimer = 0, longTimer = 0, moved = false, multi = false;
  el.style.touchAction = 'none';
  el.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'touch') return;
    if (!e.isPrimary) { multi = true; clearTimeout(longTimer); return; }
    multi = false; moved = false;
    t0 = performance.now(); x0 = e.clientX; y0 = e.clientY;
    clearTimeout(longTimer);
    longTimer = setTimeout(() => { if (!moved && !multi) { moved = true; onLongPress?.(); } }, 600);
  });
  el.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch' && e.isPrimary && Math.hypot(e.clientX - x0, e.clientY - y0) > 12) { moved = true; clearTimeout(longTimer); }
  });
  el.addEventListener('pointerup', (e) => {
    if (e.pointerType !== 'touch' || !e.isPrimary) return;
    clearTimeout(longTimer);
    if (moved || multi || performance.now() - t0 > 400) return;
    const now = performance.now();
    if (now - lastTap < 320) {
      clearTimeout(tapTimer); lastTap = 0;
      onDoubleTap?.();
    } else {
      lastTap = now;
      tapTimer = setTimeout(() => onTap?.(), 320);
    }
  });
}
