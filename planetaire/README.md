# Planétaire — *Lignée & Sillons*

Un disque protoplanétaire simulé entièrement sur le GPU (WebGPU + three.js TSL), qui **se souvient**.

- **Lignée** : chaque grain de poussière garde son rayon de naissance et sa composition (roche en deçà de la ligne des glaces, glace au-delà). Les planètes qui se forment empilent ces souvenirs en **strates**. La coupe annotée montre leur histoire : l'embryon initial au cœur, les apports successifs, les **impacts géants** cerclés d'orange et, pour les géantes, l'**enveloppe de gaz**. Survoler une strate la décrit.
- **Sillons** : comme un vinyle, le disque est lu par une **tête de lecture fixe** (le trait bleu), et c'est la rotation képlérienne qui fait défiler la matière dessous. Ce qui passe sous la tête joue, selon une règle unique : **la hauteur dépend de la distance à l'étoile** (aigu au centre, grave au bord, gamme pentatonique). Chaque planète sonne quand elle croise la tête : les internes battent vite, les lointaines rarement, et deux planètes en résonance 3:2 forment un motif 3 contre 2. Le timbre et la durée suivent la masse. Les anneaux de poussière pincent doucement leur note, et un bourdon s'assombrit à mesure que le disque s'épuise.
- **Budgets de masse** : le disque contient 700 M⊕ de solides et un réservoir de gaz qui se dissipe (~160 orbites). Au-delà de la *masse d'isolation*, une planète n'avale presque plus de cailloux. Au-delà de 10 M⊕, un cœur capte du gaz (emballement limité par l'ouverture d'un sillon) et devient une géante gazeuse. Les rayons affichés suivent la relation masse–rayon de Chen & Kipping (2017). Ils sont exagérés pour rester visibles, mais une Jupiter reste plus petite que l'étoile.
- **Impacts géants** : éclair, onde de choc, ralenti, secousse et un nuage de débris incandescents arrachés au point d'impact, qui refroidissent en orbite.

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
| clic dans la liste | zoomer sur la planète et la suivre sur son orbite · **Échap** : vue d'ensemble |
| **E** | une étoile vagabonde traverse le système |
| **P** | migration planétaire (type I) on/off |
| **C** | couleurs : provenance / roche-glace / température |
| **+ / −**, Espace, **M**, **H** | vitesse (×¼ à ×8, boutons dans le panneau ; ×2 par défaut), pause, son, aide |

## Architecture GPU

Tout l'état vit dans des storage buffers, et rien ne transite par le CPU dans la boucle. Seules de petites lectures asynchrones (≈ 40 ko, quelques fois par seconde) alimentent l'interface et le son.

```
par image (4 sous-pas) :
  buildActive     1 thread    liste compacte des embryons actifs + paramètres précalculés
  stepParticles   N threads   gravité étoile + embryons actifs, traînée du gaz (relaxation
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

- **Caméra et effets** : position + vitesse des embryons sont relues à chaque image (2 ko). La lecture arrive avec quelques images de retard, mais elle est datée, et on la propage jusqu'à l'instant présent (2 corps, saute-mouton). L'erreur mesurée est d'environ 10⁻⁵ UA, si bien que la caméra de suivi, les impacts et les notes restent accrochés aux planètes rendues par le GPU.
- **Gravité « boostée »** : le facteur ×25 qui accélère la croissance des embryons s'efface avec la masse (≈ ×1,2 pour une Jupiter). Les fusions conservent le centre de masse et la quantité de mouvement, et leur rayon se base sur les sphères de Hill.
- **Performances** (objectif 120 i/s) :
  - Le temps simulé suit le temps réel. Les grains font des pas ≤ 0,011, et les embryons deux sous-pas par pas de grains, le tout en une seule soumission GPU par image.
  - Le travail par image est plafonné en accéléré, pour éviter la spirale « image lente → plus de pas ».
  - Les fusions sont détectées en parallèle ; c'était 2 016 paires sur un seul thread, soit ~2 ms.
  - Sur écran Retina, les grains sont 0,6× plus petits en unités-monde, avec un éclat compensé : ~2,8× moins de pixels à remplir, poste dominant du rendu.
  - Une résolution adaptative baisse la densité de pixels si l'image dépasse 1/55 s, et la remonte s'il reste de la marge.
  - `?prof` active les requêtes d'horodatage GPU (`window.__prof`) et le temps JS par image (`window.__profJs`).

- **Rendu** : 1 M de sprites instanciés qui lisent directement les buffers de simulation, sans copie. Ils sont ombrés par la profondeur optique (le bord interne projette son ombre, et les grains en surface du disque restent éclairés). Le tout est rendu en HDR avec tone mapping AgX et bloom.
- **Physique** : unités G·M★ = 1, distances en UA. Les grains suivent une distribution de nombres de Stokes (10⁻² à 2), ce qui donne une dérive radiale différenciée. Au-delà de la *masse d'isolation*, une planète crée un maximum de pression juste à l'extérieur de son orbite. Le gaz y devient super-képlérien et les cailloux s'y accumulent en **anneau**, comme dans les images ALMA de HL Tauri. La gravité des embryons est amplifiée (`boost`) pour que la formation se joue en quelques minutes.
- **Mémoire** : chaque planète a 32 strates (masse, fraction de glace, rayon moyen de naissance, type). Quand la pile est pleine, on fusionne la paire de couches voisines la plus légère et de même nature : les gros événements restent distincts. Lors d'un impact géant, les couches de l'impacteur sont recopiées dans le survivant, en un groupe bordé d'orange : on lit l'histoire des deux corps.
- **Évolution des planètes** : une petite sous-simulation par planète pilote l'aspect de sa surface.
  - La chaleur interne vient de l'accrétion et des impacts géants, puis se dissipe d'autant plus lentement que la planète est massive. Chaude, elle porte un océan de magma avec une croûte noire et des fissures incandescentes. Un monde glacé chauffé se resurface plutôt de glace jeune.
  - Les cratères s'accumulent avec l'âge sur les surfaces sans atmosphère, et la fusion les efface.
  - L'eau vient de la matière née au-delà de la ligne des glaces. Selon la température d'équilibre à cette distance, elle donne de la vapeur, des océans et des nuages, ou de la banquise.
  - L'atmosphère n'est retenue qu'au-dessus de ~0,2 M⊕. Elle est fine et bleue si la planète est tempérée, épaisse et jaune (type Vénus) si elle est chaude.
  - Les géantes jeunes luisent faiblement en rouge et ont des bandes floues, qui se contrastent en refroidissant.
  - La couleur de surface suit la composition ; la provenance se lit dans la coupe. La coupe affiche aussi la température d'équilibre, l'âge et le type de surface.
- **Composition** : la glace d'un caillou qui dérive en deçà de la ligne des glaces se sublime, et la capture du gaz est très lente dans le disque interne chaud. Les planètes internes restent donc surtout rocheuses.

## Pistes pour la suite

- Planètes en 3D raymarchées (SDF), avec une vraie coupe animée dans la scène.
- Gaz explicite (grille hydrodynamique 2D) : spirales, vortex, lacunes de gaz.
- Instabilité de streaming locale (zoom multi-échelle).
- Vue « ALMA » : émission millimétrique synthétique + PSF interférométrique.
- Enregistrement du sillon en fichier audio, ou export d'une « carte de lignée » du système.
