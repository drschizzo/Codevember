import { rtt } from 'three/tsl';

// Une expression passée à un effet qui lit une texture (anticrénelage temporel,
// bloom, flou, aberration, SMAA) est d'abord rendue dans une cible plein écran
// par three.js (convertToTexture), qui lui donne aussi un tampon de profondeur
// inutile pour une passe en plein écran : 8 Mo en 1080p et une écriture de plus
// par image, pour chacune. La conversion est faite ici, sans profondeur ; l'image
// ne change pas.
export const asTexture = (n) => (n.isTextureNode || n.isSampleNode || n.isPassNode ? n : rtt(n, null, null, { depthBuffer: false }));
