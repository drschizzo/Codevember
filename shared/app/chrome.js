// Interface autour de l'image, commune à toutes les scènes.
//
// - Le panneau de réglages s'ouvre replié : la scène d'abord, les réglages à
//   la demande (?panel=1 l'ouvre, ?export le laisse ouvert pour l'export).
// - L'aide clavier (#hint) reste discrète tant que la souris dort, et passe au
//   premier plan dès qu'on la bouge sur la fenêtre (puis s'efface au repos).

const CSS = `
body.awake:not(.clean):not(.loading):not(.captions) #hint {
  opacity: 1; color: var(--fg); font-size: 12px; padding: 6px 11px; right: 14px; bottom: 12px;
  background: var(--glass, rgba(12, 11, 10, 0.62)); border: 1px solid var(--line, rgba(255, 240, 220, 0.12)); border-radius: 999px;
  backdrop-filter: blur(12px); -webkit-backdrop-filter: blur(12px);
}
body.light.awake #hint { color: #1d1b18; background: rgba(255, 252, 246, 0.6); }
#hint { transition: opacity .4s, color .4s, background-color .4s; }
`;

export function foldPanel(ui, params) {
  if (!ui || params.has('export') || params.get('panel') === '1') return;
  ui.gui.close();
}

export function wakeHint({ idle = 2600 } = {}) {
  if (!document.getElementById('hint')) return;
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  let timer = 0;
  const wake = () => {
    document.body.classList.add('awake');
    clearTimeout(timer);
    timer = setTimeout(() => document.body.classList.remove('awake'), idle);
  };
  addEventListener('pointermove', (e) => { if (e.pointerType !== 'touch') wake(); }, { passive: true });
  document.documentElement.addEventListener('pointerleave', () => { clearTimeout(timer); document.body.classList.remove('awake'); });
}

export function installChrome(ui, params) {
  foldPanel(ui, params);
  wakeHint();
}
