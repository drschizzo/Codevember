// Mise au point (?debug) : rend une graine à plusieurs phases et envoie les images au collecteur.
//   const m = await import('/tools/shots.js'); await m.shots(['a1:finDeJour:delta'], [0.02, 0.3, 0.5], 'f2')
export async function shots(seeds, phases, prefix = 'shot', scale = 0.5) {
  const E = window.erosion, out = [];
  for (const s of seeds) {
    if (s !== E.R.seed + ':' + E.R.mood + ':' + E.R.family) {
      const [sd, mood, family] = s.split(':');
      E.on.regenerateWith?.(sd, mood, family);
      await E.run();
    }
    for (const ph of phases) { await E.shot(ph); out.push(await E.send(`${prefix}-${s.replace(/:/g, '_')}-${String(Math.round(ph * 100)).padStart(3, '0')}.jpg`, scale)); }
  }
  return out;
}
