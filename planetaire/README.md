# Planétaire — *Lignée & Sillons*

Un disque protoplanétaire simulé entièrement sur le GPU (WebGPU + three.js TSL), qui **se souvient**.

- **Lignée** : chaque grain de poussière garde son rayon de naissance et sa composition (roche en deçà de la ligne des glaces, glace au-delà). Les planètes qui se forment empilent ces souvenirs en **strates**. La vue en coupe montre leur histoire : la graine au centre, puis les apports successifs, et les **impacts géants** (fusions) cerclés d'orange.
- **Sillons** : comme un vinyle, le disque est lu par une **tête de lecture fixe**, et c'est la rotation képlérienne qui fait défiler la matière dessous. Les anneaux et les grumeaux « pincent » des cordes, et les lacunes creusées par les planètes se taisent. Chaque planète chante à une fréquence proportionnelle à sa **fréquence orbitale réelle** (repliée par octaves). Deux planètes en résonance 3:2 jouent donc une quinte, et 2:1 une octave.

## Lancer

Ouvrir `index.html` via n'importe quel serveur statique (les modules ES l'exigent) :

```sh
cd planetaire && python3 -m http.server 8000
# → http://localhost:8000
```

Il faut un navigateur **WebGPU** (Chrome / Edge récents, Safari 26+). Il n'y a pas de repli WebGL, c'est volontaire.

Paramètres d'URL :

| paramètre | effet |
|---|---|
| `?n=2097152` | nombre de grains (défaut 1 048 576) |
| `?nobloom` | désactive le bloom (GPU modestes) |
| `?warp=4` | avance rapide (4 pas de simulation par image) |
| `?auto` | saute l'écran d'accueil (sans le son) |

## Commandes

| geste | action |
|---|---|
| glisser / molette | orbiter / zoomer |
| **Maj + glisser** | puits gravitationnel : remuer le disque avec le doigt |
| **double-clic** | semer un embryon de planète |
| clic sur une planète | l'inspecter (coupe stratigraphique) · **A** : retour au choix auto |
| **E** | une étoile vagabonde traverse le système |
| **P** | migration planétaire (type I) on/off |
| **C** | couleurs : provenance / roche-glace / température |
| **+ / −**, Espace, **M**, **H** | vitesse, pause, son, aide |

## Architecture GPU

Tout l'état vit dans des storage buffers, et rien ne transite par le CPU dans la boucle. Seules de petites lectures asynchrones (≈ 40 ko, quelques fois par seconde) alimentent l'interface et le son.

```
par image (4 sous-pas) :
  stepParticles   N threads   gravité étoile + 64 embryons, traînée du gaz (relaxation
                              exponentielle exacte → stable pour tout nombre de Stokes),
                              turbulence, pièges de pression, capture atomique
  embryoForces    64 threads  N-corps exact + amortissement par le gaz + migration
  embryoIntegrate 64 threads
puis :
  embryoAccrete   64 threads  lit/remet à zéro les compteurs atomiques, empile les strates
  embryoMerge     1 thread    fusions (impacts géants), conservation de la quantité de mvt
  clearGrid / depositGrid     histogramme polaire 192×256 (atomicAdd)
  opticalDepth    256 threads profondeur optique cumulée depuis l'étoile → ombre du disque
  readNeedle      192 threads densité sous la tête de lecture → son
```

- **Rendu** : 1 M de sprites instanciés qui lisent directement les buffers de simulation, sans copie. Ils sont ombrés par la profondeur optique (le bord interne projette son ombre, et les grains en surface du disque restent éclairés). Le tout est rendu en HDR avec tone mapping AgX et bloom.
- **Physique** : unités G·M★ = 1, distances en UA. Les grains suivent une distribution de nombres de Stokes (10⁻² à 2), ce qui donne une dérive radiale différenciée. Au-delà de la *masse d'isolation*, une planète crée un maximum de pression juste à l'extérieur de son orbite. Le gaz y devient super-képlérien et les cailloux s'y accumulent en **anneau**, comme dans les images ALMA de HL Tauri. La gravité des embryons est amplifiée (`boost`) pour que la formation se joue en quelques minutes.
- **Mémoire** : chaque planète a 32 strates (masse, fraction de glace, rayon moyen de naissance, type). Quand la pile est pleine, elle est compressée par paires : on garde toute l'histoire, à une résolution plus grossière.

## Pistes pour la suite

- Planètes en 3D raymarchées (SDF), avec une vraie coupe animée dans la scène.
- Gaz explicite (grille hydrodynamique 2D) : spirales, vortex, lacunes de gaz.
- Instabilité de streaming locale (zoom multi-échelle).
- Vue « ALMA » : émission millimétrique synthétique + PSF interférométrique.
- Enregistrement du sillon en fichier audio, ou export d'une « carte de lignée » du système.
