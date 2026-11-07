# Planétaire — *Lignée & Sillons*

Un système planétaire simulé entièrement sur le GPU (WebGPU + three.js TSL), de sa naissance à sa mort, et qui **se souvient**.

## Le cycle de vie

L'écran d'accueil le montre d'abord en miniature : un petit film de 20 s qui boucle (`src/intro.js`, Canvas 2D, indépendant de WebGPU). On y voit le nuage s'effondrer, l'étoile s'allumer, les planètes creuser leurs sillons, la supergéante, la supernova, puis un nouveau nuage. Les grains y portent déjà leur couleur de provenance. La vraie simulation ne démarre qu'au clic sur « Entrer ».

Une frise dans le panneau suit les phases. Pour chacune, elle indique sa vraie durée, car le film est très accéléré et de façon inégale.

1. **Effondrement du nuage** : une sphère d'un million de grains, en rotation et turbulente, s'effondre. Chaque grain conserve son moment cinétique et rejoint le disque à son rayon centrifuge (modèle d'Ulrich / Cassen-Moosman). Ce rayon devient son « lieu de naissance ». Les grains proches de l'axe tombent sur l'étoile.
2. **Protoétoile** : elle est rouge, ne brille que par sa contraction, et lance deux jets le long de l'axe.
3. **Allumage** puis **formation des planètes** : la fusion démarre (éclair, accord). La luminosité monte, et avec elle la ligne des glaces. Les embryons naissent là où la poussière s'accumule, grossissent, se percutent et captent du gaz. Le gaz se dissipe.
4. **Dissipation du disque** : sans gaz, la lumière souffle les poussières fines (pression de radiation), et les plus grosses spiralent vers l'étoile (Poynting-Robertson). Le disque se vide de l'intérieur vers l'extérieur et laisse une ceinture de débris. Le disque est fini : un grain avalé, tombé ou soufflé est retiré pour de bon.
5. **Maturité**.
6. **Supergéante rouge** : l'étoile enfle, rougit et perd de la masse, si bien que les orbites s'élargissent. Elle engloutit les planètes proches et réchauffe les lointaines : les glaces fondent, les océans s'évaporent.
7. **Supernova** : le cœur s'effondre, un silence, puis l'explosion. Les grains retirés redeviennent des éjecta incandescents en « doigts » de Rayleigh-Taylor. L'onde de choc chauffe et balaie le disque, et le système, devenu non lié, se disperse. Il reste un rémanent animé (filaments Hα et [O III]) et un pulsar. Puis **un nouveau nuage** : le cycle recommence.

Avertissement honnête : une étoile comme le Soleil finit en naine blanche, pas en supernova. Il faut plus de ~8 masses solaires, et une telle étoile vit seulement quelques dizaines de millions d'années. On l'assume ici pour boucler le cycle.

**Rendu « cinéma »** : léger tone mapping Neutral, bloom doux, traînée anamorphique sur les sources intenses, aberration chromatique vers les bords, étalonnage (ombres froides, hautes lumières chaudes), vignettage et grain de pellicule.

## La machine (DA « mécanique »)

Toute la simulation est présentée comme portée par un **planétaire en laiton** (`src/orrery.js`), comme les orreries du XVIIIᵉ siècle, enfermé sous une **cloche de verre**. La machine ne simule rien : elle lit l'état du GPU à chaque image et le rend tangible. Chaque pièce a une fonction, et la chaîne cinématique tient debout :

```
BARILLET (ressort = l'énergie d'un cycle de vie)
  ├─▶ pignon de l'ARBRE DE RENVOI ─▶ pignons ─▶ ROUES des tubes ─▶ BRAS ─▶ planètes
  │      (rapport roue / pignon = rapport des vitesses angulaires : Kepler)
  └─▶ ROUE DE CENTRE ─▶ ROUE D'ÉCHAPPEMENT ⇄ ANCRE ⇄ BALANCIER (régulateur)
```

- **Bras et tubes** : les 12 planètes les plus massives sont tenues par un bras à contrepoids, fixé sur un tube concentrique (la plus proche sur l'arbre le plus fin et le plus haut). Une tige et une coupelle portent la planète. Rien n'apparaît d'un coup : quand une planète est prise en charge, la tringle sort de sa bague puis la tige monte sous la bille ; quand elle disparaît (fusion, éjection, ou trop légère), le bras redescend et rentre en poursuivant son orbite képlérienne. Les roues glissent dans la pile quand l'ordre des rayons change, et des seuils à hystérésis évitent le clignotement autour de la masse limite.
- **Engrenages = Kepler** : l'arbre de renvoi tourne à la vitesse d'une orbite à 2,5 UA ; chaque roue de tube engrène un pignon dont le rapport suit ω ∝ a^−3/2. Toutes les dentures ont le même module : chaque étage roue + pignon totalise 40 dents (entraxe exact), et les dents tombent vraiment dans les creux (phases calées).
- **Pièces usinées** : roues biseautées et alésées là où passe leur arbre, bagues et piliers tournés et chanfreinés, ponts à bouts ronds vissés sur leurs piliers, rubis sur les pivots. Les bras sont des tringles fixées par une bague à vis sur leur tube ; aucun bras ne traverse l'axe.
- **Régulateur** : la roue d'échappement avance par à-coups, retenue par l'ancre que pousse le balancier. Le balancier bat donc d'autant plus vite que le temps s'écoule vite (×¼ … ×8), et s'arrête à la pause.
- **Réserve de marche** : l'aiguille du cadran émaillé suit le ressort qui se détend pendant le cycle ; le cadran est gradué par les phases de la vie du système.
- **Fin de cycle, et boucle** : à la supernova, le ressort est vide. Le **levier d'arrêt** bloque le balancier ; la **trémie** au sommet de la cloche aspire les débris pendant que la **couronne** remonte le barillet par une vis sans fin (le **cliquet** claque sur le **rochet**). Le levier se déclenche, la **vanne** s'ouvre, et les grains se déversent en filet le long de l'axe : ils remplissent le nouveau nuage de bas en haut, et chaque grain n'entre dans la dynamique qu'une fois arrivé à sa place (côté GPU, une « chaleur » négative code son heure de départ). Le premier nuage de la page naît de la même façon.
- **Peigne de boîte à musique** = la tête de lecture, en acier, au-dessus du disque : la tige de chaque planète se prolonge en une **pointe** au-dessus de la bille, qui soulève la lame de son rayon. Les lames sont inclinées, si bien que seule leur pointe accroche, comme le picot d'un cylindre ; des masselottes lestent les lames graves. Le peigne se relève quand l'étoile enfle. Le **curseur de la ligne des glaces** glisse sur sa barre.
- **Galerie des automates**, autour du pied du socle : une couronne de 88 dents, tirée par un **poids moteur** qui descend sur sa chaîne au fil du cycle (il remonte au remontage), entraîne une ronde de stations :
  - **régulateur à boules** (Watt), dont les boules s'écartent avec la vitesse du temps ;
  - **tambour à cames**, qui fait un tour par cycle : ses trois cames (luminosité de l'étoile, gaz du disque, ligne des glaces) poussent des crémaillères qui font tourner les aiguilles de trois cadrans ;
  - **compteur à rouleaux** des orbites à 1 UA, avec le numéro du cycle ;
  - **pompe à soufflet**, embrayée seulement pendant l'aspiration de fin de cycle ; sa conduite remonte le long d'un pied puis d'un arceau jusqu'à la trémie ;
  - **cloche**, frappée par un marteau à chaque impact géant.
- **Éclairage** : un projecteur de musée chaud porte les ombres de la machine sur elle-même ; un second projecteur, froid et rasant, sculpte la galerie ; s'y ajoutent une lumière d'appoint hémisphérique, un contre-jour froid et la lumière de l'étoile. L'acier est poli, l'acier bleui l'est encore plus, le laiton est satiné.
- **Limbe gradué** (0° = tête de lecture), pieds et **arceaux** qui tiennent la cloche. Pour que le nuage initial tienne sous la cloche, il est resserré à 9,6 UA (rotation accélérée : le disque s'étend toujours jusqu'à ~9 UA).
- **Objectif « macro »** : faible profondeur de champ (mise au point sur le centre visé ou sur la planète suivie) et flou de mouvement. La poussière n'écrit ni profondeur ni vitesse, donc l'objectif lui est appliqué grain par grain : hors du plan net, un grain s'étale en disque de bokeh (cercle de confusion ∝ |d − f| / f) ; en mouvement, il s'étire le long de son déplacement à l'écran pendant le temps d'obturation (à ×8, le disque interne file). L'énergie lumineuse est conservée. La machine reçoit une profondeur de champ et un flou de mouvement en post-traitement, mais les planètes et leurs bras n'en ont pas. `?nolens` coupe tout.
- Planètes grossies (×1,7) pour se lire comme des billes sur leurs tiges ; laiton patiné et satiné, pour laisser la vedette au disque.
- L'interface reprend le thème : plaques de laiton vissées, petites capitales gravées.

Touche **O** : ôter / remettre la machine (et revenir à l'ancienne DA). `?nomeca` : démarrer sans.

## Ce qui est simulé

- **Lignée** : chaque grain de poussière garde son rayon de naissance et sa composition (roche en deçà de la ligne des glaces, glace au-delà). Les planètes qui se forment empilent ces souvenirs en **strates**. La coupe annotée montre leur histoire : l'embryon initial au cœur, les apports successifs, les **impacts géants** cerclés d'orange et, pour les géantes, l'**enveloppe de gaz**. Survoler une strate la décrit.
- **Sillons** : comme un vinyle, le disque est lu par une **tête de lecture fixe** (le trait bleu), et c'est la rotation képlérienne qui fait défiler la matière dessous. Ce qui passe sous la tête joue, selon une règle unique : **la hauteur dépend de la distance à l'étoile** (aigu au centre, grave au bord, gamme pentatonique). Chaque planète sonne quand elle croise la tête : les internes battent vite, les lointaines rarement, et deux planètes en résonance 3:2 forment un motif 3 contre 2. Le timbre et la durée suivent la masse. Les anneaux de poussière pincent doucement leur note, et un bourdon s'assombrit à mesure que le disque s'épuise.
- **Budgets de masse** : les solides sont comptés grain par grain (700 M⊕ au départ dans le nuage). Le gaz est un réservoir qui se dissipe après l'allumage. Au-delà de la *masse d'isolation*, une planète n'avale presque plus de cailloux. Au-delà de 10 M⊕, un cœur capte du gaz (emballement limité par l'ouverture d'un sillon) et devient une géante gazeuse. Les rayons affichés suivent la relation masse–rayon de Chen & Kipping (2017). Ils sont exagérés pour rester visibles, mais une Jupiter reste plus petite que l'étoile.
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
| `?nocine` | rendu sans post-traitement « cinéma » |
| `?agx` | ancien tone mapping (AgX) |
| `?sdr` / `?hdr` | force la sortie SDR ou HDR (par défaut : HDR si l’écran le permet) |
| `?peak=4` | pic de luminosité en HDR, en multiples du blanc de l’interface |
| `?exposure=1.45` | exposition globale |
| `?nomeca` | sans la machine (ancienne DA) |
| `?nolens` | sans profondeur de champ ni flou de mouvement |

## Commandes

| geste | action |
|---|---|
| glisser / molette | orbiter / zoomer |
| **Maj + glisser** | puits gravitationnel : remuer le disque avec le doigt |
| **double-clic** | semer un embryon de planète |
| clic sur une planète | l'inspecter (coupe stratigraphique) · **A** : retour au choix auto |
| clic dans la liste | zoomer sur la planète et la suivre sur son orbite · **Échap** : vue d'ensemble |
| clic sur la frise, **[ / ]** | aller à une phase du cycle : avance rapide de la vraie simulation, ou on recommence le cycle |
| **E** | une étoile vagabonde traverse le système |
| **P** | migration planétaire (type I) on/off |
| **C** | couleurs : provenance / roche-glace / température |
| **O** | ôter / remettre la machine en laiton |
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
