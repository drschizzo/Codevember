// Interface HTML : vitesse, frise des phases, liste des planètes, fiche,
// aide, messages. Ce module ne connaît que le DOM ; les actions sont
// transmises à main.js par des fonctions de rappel.
import { css } from '../palette.js';
import { nameOf, fmtMass, kindOf, surfaceOf, MIN_PLANET } from './planets.js';

const $ = (s) => document.querySelector(s);
const MAX_ROWS = 8;
export const fmtSpeed = (v) => ({ 0.25: '¼', 0.5: '½' })[v] || String(v);

export function createUI({ speeds, phases, onSpeed, onPause, onSeek, onFocus, onAuto, onOverview, onSound }) {
  const el = {
    speed: $('#speed'), phases: $('#phases'), cyc: $('#cyc'), prev: $('#phPrev'), next: $('#phNext'),
    phaseName: $('#phaseName'), phaseDesc: $('#phaseDesc'), list: $('#list'), info: $('#pinfo'),
    auto: $('#auto'), overview: $('#overview'), sound: $('#sound'), help: $('#help'), toast: $('#toast'), intro: $('#intro'),
  };

  // ── Vitesse ──
  el.speed.innerHTML = `<button data-v="pause" title="Pause (Espace)">❚❚</button>` +
    speeds.map((v) => `<button data-v="${v}">×${fmtSpeed(v)}</button>`).join('');
  el.speed.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.v === 'pause') onPause(); else onSpeed(Number(b.dataset.v));
  });

  // ── Frise des phases ──
  el.phases.innerHTML = phases.map((ph, i) => `<div data-i="${i}" title="${ph.name}"><span><u></u></span></div>`).join('');
  const phaseCells = [...el.phases.children];
  el.phases.addEventListener('click', (e) => { const d = e.target.closest('[data-i]'); if (d) onSeek(Number(d.dataset.i)); });
  el.prev.addEventListener('click', () => onSeek(-1, true));
  el.next.addEventListener('click', () => onSeek(1, true));

  // ── Planètes ──
  el.list.addEventListener('click', (e) => { const li = e.target.closest('li'); if (li) onFocus(Number(li.dataset.i)); });
  el.auto.addEventListener('click', onAuto);
  el.overview.addEventListener('click', onOverview);
  el.sound.addEventListener('click', onSound);
  $('#enter').addEventListener('click', () => el.intro.classList.add('gone'));

  // Liste stable : on ne change sa composition (et son ordre) que si une
  // planète naît, disparaît ou en dépasse nettement une autre ; sinon on met
  // seulement à jour les chiffres. Les lignes ne bougent pas sous la souris.
  let members = [];
  const rows = new Map(); // index → { li, dot, a, m, chip }
  function row(i) {
    let r = rows.get(i);
    if (!r) {
      const li = document.createElement('li');
      li.dataset.i = i;
      li.innerHTML = '<span class="dot"></span><span class="nm"></span><span class="num a"></span><span class="num m"></span><span class="chips"><i></i></span>';
      li.querySelector('.nm').textContent = nameOf(i);
      r = { li, dot: li.querySelector('.dot'), a: li.querySelector('.a'), m: li.querySelector('.m'), chip: li.querySelector('.chips i') };
      rows.set(i, r);
    }
    return r;
  }

  let toastTimer;
  const setHTML = (node, html) => { if (node.innerHTML !== html) node.innerHTML = html; };

  return {
    get introGone() { return el.intro.classList.contains('gone'); },
    closeIntro() { el.intro.classList.add('gone'); },

    toast(msg) {
      el.toast.textContent = msg; el.toast.classList.add('on');
      clearTimeout(toastTimer); toastTimer = setTimeout(() => el.toast.classList.remove('on'), 2400);
    },
    hideToast() { el.toast.classList.remove('on'); },
    toggleHelp() { el.help.classList.toggle('hidden'); },
    setSound(on) { el.sound.classList.toggle('on', on); },
    setOverview(on) { el.overview.hidden = !on; },
    setSeeking(on) { document.body.classList.toggle('seeking', on); },

    syncSpeed(speed, paused) {
      for (const b of el.speed.children) b.classList.toggle('on', b.dataset.v === 'pause' ? paused : !paused && Number(b.dataset.v) === speed);
    },

    renderLife(life, seek) {
      const now = life.phase, ph = phases[now];
      el.cyc.textContent = `cycle ${life.cycle + 1}`;
      phaseCells.forEach((cell, i) => {
        cell.className = i < now ? 'done' : i === now ? 'now' : i === seek ? 'target' : '';
        cell.title = i < now ? `${phases[i].name} — revenir en arrière recommence le cycle depuis le nuage`
          : i === now ? `${phases[i].name} (en cours)` : `Avancer jusqu’à : ${phases[i].name}`;
        cell.firstChild.firstChild.style.width = i === now ? `${Math.min(100, life.p.progress * 100).toFixed(1)}%` : '';
      });
      el.prev.disabled = now === 0 || now === 6;
      el.next.disabled = now >= 5 || seek >= 0;
      const head = `<b>${ph.name}</b> <span class="dim">· en réalité ${ph.real}</span>`;
      if (el.phaseName.innerHTML !== head) { el.phaseName.innerHTML = head; el.phaseDesc.textContent = ph.desc; }
    },

    renderPlanets(planets, selected, autoSelect) {
      const byIdx = new Map(planets.map((p) => [p.index, p]));
      const next = members.filter((i) => byIdx.has(i) && (byIdx.get(i).mE >= MIN_PLANET || i === selected));
      const cands = planets.filter((p) => p.mE >= MIN_PLANET && !next.includes(p.index)).sort((a, b) => b.m - a.m);
      for (const c of cands) {
        if (next.length < MAX_ROWS) { next.push(c.index); continue; }
        const weakest = next.filter((i) => i !== selected).reduce((a, b) => (byIdx.get(b).m < byIdx.get(a).m ? b : a));
        if (c.m > byIdx.get(weakest).m * 1.6) next[next.indexOf(weakest)] = c.index;
      }
      if (byIdx.has(selected) && !next.includes(selected)) next.push(selected);
      if (next.length !== members.length || next.some((i) => !members.includes(i))) {
        members = next.sort((a, b) => byIdx.get(a).a - byIdx.get(b).a);
        el.list.replaceChildren(...members.map((i) => row(i).li));
        for (const i of rows.keys()) if (!members.includes(i)) rows.delete(i);
      }
      for (const i of members) {
        const p = byIdx.get(i), r = rows.get(i);
        r.li.classList.toggle('sel', i === selected);
        r.dot.style.background = css(p.color);
        r.a.textContent = `${p.a.toFixed(2)} UA`;
        r.m.innerHTML = fmtMass(p.mE);
        const kind = kindOf(p);
        if (r.chip.textContent !== kind) r.chip.textContent = kind;
      }
      el.auto.classList.toggle('on', autoSelect);
      // fiche de la planète sélectionnée : une ligne, sous la liste
      const p = byIdx.get(selected);
      setHTML(el.info, p ? `<b>${nameOf(p.index)}</b> · ${kindOf(p)} · ${fmtMass(p.mE)} · ${p.a.toFixed(2)} UA${p.evo && p.mE >= MIN_PLANET ? ` · ${surfaceOf(p)}, ≈ ${p.evo.Teq.toFixed(0)} K` : ''}`
        : 'Cliquez une planète pour la suivre.');
    },

    // une planète sonne : son repère dans la liste clignote
    ping(i) {
      const dot = rows.get(i)?.dot;
      if (dot) { dot.classList.remove('ping'); void dot.offsetWidth; dot.classList.add('ping'); }
    },
  };
}
