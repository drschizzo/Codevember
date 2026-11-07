// Cotes de la machine (unités de la scène : 1 = 1 UA).
import * as THREE from 'three/webgpu';

export const K = 12;                          // bras (planètes portées) au maximum
export const Y_ARM0 = -0.42, DY_ARM = 0.12;   // hauteur des bras sous le plan du disque
export const Y_BASE = -3.3;                   // dessus de la platine
export const Y_GEAR0 = Y_BASE + 0.52, DY_GEAR = 0.07; // pile des roues (au-dessus du régulateur)
export const MODULE = 0.065;                  // module commun de toutes les dentures
export const LAY_N = 40;                      // dents roue + pignon d'un étage (entraxe = 40 × m / 2 = 1,3)
export const LAY_D = (LAY_N * MODULE) / 2;
export const OMEGA_L = 0.25;                  // vitesse de l'arbre de renvoi (rad / unité de temps) = une orbite à 2,5 UA
export const LIMB_R0 = 9.55, LIMB_R1 = 10.35, LIMB_RM = (LIMB_R0 + LIMB_R1) / 2;
export const DOME_H = 10.2;                   // hauteur de la cloche (le nuage initial tient dessous)
export const BELL_R = 9.85;                   // rayon intérieur de la cloche, côté simulation
export const HOPPER = new THREE.Vector3(0, DOME_H - 0.95, 0); // buse de la trémie
// peigne (au-dessus du disque) : barre, lames inclinées, pointes des tiges
export const COMB_Z = 0.34, COMB_BAR_Y = 0.44, TOOTH_ROOT_Y = 0.41, TOOTH_TIP_Y = 0.3, TOOTH_TIP_Z = 0.035, PIN_TOP = 0.312;
export const NTEETH = 44;
// part de chaque phase dans la réserve du ressort (même ordre que PHASES)
export const PHASE_W = [0.06, 0.06, 0.3, 0.14, 0.22, 0.14, 0.08];
export const PHASE_CUM = PHASE_W.reduce((a, w, i) => (a.push((a[i - 1] || 0) + w), a), []); // fin de chaque phase
export const PHASE_SHORT = ['nuage', 'proto', 'planètes', 'dissip.', 'maturité', 'géante', 'nova'];
export const WIND0 = 0.62, WIND1 = 0.93;      // fenêtre d'aspiration / remontage dans la supernova (progression)
export const pitchR = (n) => (n * MODULE) / 2; // rayon primitif d'une roue de n dents
