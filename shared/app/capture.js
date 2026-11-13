// Export : image PNG, et boucle vidéo MP4 (H.264) rendue image par image,
// hors temps réel : la phase avance exactement de 1 / (durée × cadence) par
// image, donc la vidéo boucle sans couture quelle que soit la vitesse du GPU.
// Encodage WebCodecs, multiplexage mp4-muxer.

const MUXER = 'https://cdn.jsdelivr.net/npm/mp4-muxer@5.1.3/build/mp4-muxer.mjs';

function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

export function exportPNG(canvas, renderNow, name) {
  renderNow(); // (même tâche que la lecture du canevas : l'image est encore là)
  canvas.toBlob((b) => b && download(b, name), 'image/png');
}

// app : { canvas, setSize(w, h) | restore(), renderAt(phase déroulée), duration }
export async function exportLoop(app, { width, height, fps, mbps }, onProgress, name) {
  if (!('VideoEncoder' in window)) throw new Error('WebCodecs indisponible dans ce navigateur.');
  const { Muxer, ArrayBufferTarget } = await import(MUXER);
  const w = width & ~1, h = height & ~1;
  // profil High, niveau choisi selon la taille de l'image
  const level = w * h > 2304 * 1296 ? '33' : w * h > 1920 * 1088 ? '32' : '2a';
  const candidates = [`avc1.6400${level}`, `avc1.4d00${level}`, 'avc1.640033'];
  let codec = null;
  for (const c of candidates) {
    const s = await VideoEncoder.isConfigSupported({ codec: c, width: w, height: h, bitrate: mbps * 1e6, framerate: fps });
    if (s.supported) { codec = c; break; }
  }
  if (!codec) throw new Error(`Encodage H.264 ${w}×${h} non pris en charge.`);

  const muxer = new Muxer({ target: new ArrayBufferTarget(), video: { codec: 'avc', width: w, height: h, frameRate: fps }, fastStart: 'in-memory' });
  let failure = null;
  const encoder = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => { failure = e; } });
  encoder.configure({ codec, width: w, height: h, bitrate: mbps * 1e6, framerate: fps, bitrateMode: 'variable', latencyMode: 'quality' });

  const total = Math.round(app.duration * fps);
  let comp = null;
  app.setSize(w, h);
  try {
    // amorçage : l'anticrénelage temporel et le flou de mouvement ont besoin d'un historique
    if (app.prime !== false) for (let i = -12; i < 0; i++) app.renderAt(i / total); // (phase déroulée : continue avec la suite)
    for (let i = 0; i < total; i++) {
      if (failure) throw failure;
      app.renderAt(i / total, i, total);
      let src = app.canvas;
      if (app.overlay) { // couche 2D composée sur l'image
        comp ??= new OffscreenCanvas(w, h);
        const cx = comp.getContext('2d');
        cx.drawImage(app.canvas, 0, 0, w, h);
        app.overlay(cx, w, h);
        src = comp;
      }
      const frame = new VideoFrame(src, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
      encoder.encode(frame, { keyFrame: i % (fps * 2) === 0 });
      frame.close();
      if (encoder.encodeQueueSize > 6) await new Promise((r) => encoder.addEventListener('dequeue', r, { once: true }));
      if (i % 4 === 0 || app.prime === false) { onProgress?.(i / total); await new Promise((r) => setTimeout(r, 0)); }
    }
    await encoder.flush();
    muxer.finalize();
    download(new Blob([muxer.target.buffer], { type: 'video/mp4' }), name);
    onProgress?.(1);
  } finally {
    encoder.state !== 'closed' && encoder.close();
    app.restore();
  }
}
