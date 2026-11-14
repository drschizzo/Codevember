// Worker de génération (gabarit commun). Melt n'a rien à précalculer : tout se
// calcule à chaque image (cycle.js, scene/tracer.js). Le module reste pour le
// pool de workers commun (shared/gen/client.js).
self.onmessage = ({ data }) => { self.postMessage({ id: data.id, error: `inconnu : ${data.what}` }); };
