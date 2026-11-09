// L'écran de génération : on regarde le calcul se faire. Les essais en cours
// envoient leur courbe ; la première (par ordre d'indice) est tracée en clair,
// les autres en filigrane : un fil de lumière qui se tortille puis se pose sur
// une solution des équations de Newton.
export function createLoader(el) {
  const canvas = el.querySelector('canvas'), ctx = canvas.getContext('2d');
  const label = el.querySelector('p');
  const txt = el.querySelector('.txt');
  const status = document.createElement('small'); status.className = 'status';
  const bar = document.createElement('div'); bar.className = 'actions';
  txt.append(status, bar);
  const snaps = new Map();
  let raf = 0, on = false;

  function draw() {
    raf = requestAnimationFrame(draw);
    const dpr = Math.min(2, devicePixelRatio || 1);
    const W = Math.round(canvas.clientWidth * dpr), H = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    ctx.clearRect(0, 0, W, H);
    const live = [...snaps.entries()].sort((a, b) => a[0] - b[0]).map(([, s]) => s);
    if (!live.length) return;
    let size = 0;
    const m = live[0].pts;
    for (let i = 0; i < m.length; i += 2) size = Math.max(size, Math.hypot(m[i], m[i + 1]));
    const R = (0.42 * Math.min(W, H)) / (size || 1);
    live.forEach((s, k) => {
      ctx.strokeStyle = k ? 'rgba(233,196,138,0.09)' : 'rgba(255,224,170,0.8)';
      ctx.lineWidth = (k ? 1 : 1.4) * dpr;
      ctx.beginPath();
      const n = s.pts.length / 2;
      for (let i = 0; i <= n; i++) {
        const q = i % n, x = W / 2 + R * s.pts[2 * q], y = H / 2 - R * s.pts[2 * q + 1];
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.stroke();
    });
    const s = live[0];
    if (el.classList.contains('error')) return;
    label.textContent = `recherche d’une orbite · essai ${[...snaps.keys()].sort((a, b) => a - b)[0]} · action ${s.action.toFixed(4)}`;
  }

  return {
    show(text = 'recherche d’une orbite…') {
      snaps.clear(); label.textContent = text;
      el.classList.remove('gone', 'error');
      bar.replaceChildren(); status.textContent = '';
      if (!on) { on = true; draw(); }
    },
    snap(i, s) { snaps.set(i, s); },
    drop(i) { snaps.delete(i); },
    text(t) { snaps.clear(); label.textContent = t; },
    status(t) { status.textContent = t; },
    // un échec : le message, et des boutons pour repartir ({ label, run })
    error(t, actions = []) {
      el.classList.remove('gone');
      el.classList.add('error'); label.textContent = t; status.textContent = 'N : nouvelle graine';
      if (!on) { on = true; draw(); }
      bar.replaceChildren(...actions.map(({ label: l, run }) => {
        const b = document.createElement('button');
        b.textContent = l; b.onclick = () => run();
        return b;
      }));
    },
    hide() { el.classList.add('gone'); on = false; cancelAnimationFrame(raf); snaps.clear(); },
  };
}
