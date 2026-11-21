# Le relais (méga-scène, prototype)

Les jours de Codevember en un seul plan. Chaque jour joue sa boucle, puis passe
la main au suivant, dans l'ordre du calendrier (la légende affiche le numéro du
jour) ; après le dernier, on revient au premier. Les passages ne dépendent que
du jour qui arrive (`meta.enter`) : l'ordre peut changer sans les retoucher.

Fold → Shatter → Melt → Tangle → Moss → Orrery → Hollow → Tesseract → Membrane →
Caustic → Rust → Feather → Labyrinth → Tension → Mirage → Spore → Kelp →
Pendulum → Erosion → Cocoon → Bolt → Echo → Magma → Fold…

On entre dans un jour par ce qui s'y passe : chaque passage reprend le geste du
jour qui arrive (`meta.enter`, `mega/src/transitions.js`).

| On entre dans | Passage |
| --- | --- |
| Magma | la peau de l'image se fend, les fissures rougeoient, puis les plaques s'ouvrent |
| Shatter | l'image se fêle en éclats aux arêtes de verre, qui glissent et tombent |
| Melt | l'image fond et coule vers le bas en filets, le front luit comme la cire |
| Bolt | un traceur descend, l'éclair frappe, la scène s'ouvre depuis le canal |
| Caustic | des ondes accourent des bords vers un point, réfractent l'image, y dessinent des caustiques |
| Kelp | une vague monte de bas en haut, avec sa ligne d'écume |
| Erosion | l'eau descend en rigoles ramifiées, mouille l'image puis l'emporte |
| Moss | la pierre fonce sous l'averse, des îlots verts naissent et se rejoignent |
| Spore | une poussière de spores se pose, germe en gouttelettes jaunes qui fusionnent, un réseau de plasmode s'étend |
| Feather | une plume s'ouvre depuis son rachis, barbe après barbe |
| Cocoon | des fils de soie s'enroulent et couvrent l'image, chacun portant un peu de lumière |
| Tangle | l'image se tord autour du centre, et la suivante arrive tordue puis se détord |
| Tension | des câbles tendus découpent l'image en panneaux, qui s'ouvrent un à un |
| Rust | la rouille fleurit sur l'image, puis s'écaille en plaques |
| Membrane | une membrane veinée couvre l'image, se tend et se déchire depuis le centre |
| Fold | l'image se plie le long de plis, panneau par panneau |
| Pendulum | un balancier pendu en haut balaie l'image en oscillant |
| Labyrinth | l'ouverture avance dans les couloirs d'un dédale |
| Echo | l'éclair part d'un point, son front avance en anneau |
| Mirage | l'image est aspirée vers l'ouverture du mirascope, où la scène suivante apparaît |
| Hollow | la caméra plonge dans une alvéole qui s'élargit |
| Tesseract | des carrés pivotent sur leurs arêtes, comme le patron d'un cube qui se replie |
| Orrery | trois corps parcourent un huit, leurs traînées ouvrent l'image |

Pendant le passage, la caméra du jour qui part avance vers ce qu'elle regarde,
et celle du jour qui arrive recule depuis le plus près. Pas de version mobile.

```
/mega/                       le relais (vingt-trois jours)
/mega/?days=shatter,melt     un autre ordre, d'autres jours
/mega/?t=5&loops=1&pr=1.5    durée d'un passage (s), boucles par jour, rapport de pixels
/mega/?enter=wave            forcer un passage, pour le régler
/mega/?debug                 window.mega : cur, next, stats, memory(), skip(), step(), run(s),
                             preview(sorte, p) (un passage à l'arrêt), shot(sorte, p, nom)
                             (le même, envoyé au collecteur tools/sink.py)
```

Commandes discrètes, en bas à droite (elles s'effacent quand la souris se
repose) :
- « jours » : le menu des vingt-trois jours. Un jour choisi devient le
  suivant : il se prépare en arrière-plan et prend la main à la fin de la
  boucle en cours, puis l'ordre reprend après lui. Le jour qui se préparait
  est abandonné et libéré (un chargement dépassé par un autre choix est
  libéré à son arrivée) ; pendant un passage, le menu attend.
- le bouton du jour suivant : son nom et un filet de préparation ; prêt, il
  lance le passage tout de suite ; pressé avant, il le lance dès que le jour
  est prêt (un second appui annule).

Espace : pause · → : comme le bouton du jour suivant · Échap : fermer le menu ·
H : masquer le titre et les commandes · F : plein écran.

## Streaming

Un seul moteur, un seul canvas, et jamais plus de deux jours en mémoire.

1. Le premier jour se prépare sous l'écran d'ouverture.
2. Dès qu'il joue, le suivant est créé : ses workers génèrent sa scène, puis
   ses shaders sont compilés à raison d'un dessin par image (`warmScene` avec
   `yieldFn` = « attendre l'image suivante », budget de 6 ms de construction
   par dessin), dans sa propre cible, sans voler l'image du jour qui joue.
3. Quand le jour courant arrive à la fin de sa boucle et que le suivant est
   prêt, le passage commence ; il se termine sur le raccord de la boucle, si
   bien que le jour sortant ne repasse jamais par son début (Melt y recharge
   sa figurine). S'il n'est pas prêt, le jour courant fait un tour de plus.
   → lance le passage tout de suite, d'où en est la boucle : jamais de saut
   de phase, après lequel la simulation de Melt rattraperait le temps sauté
   (jusqu'à 48 pas par image : le passage tombait à 4 images par seconde).
4. Après le passage, le jour sorti est libéré, et le jour d'après se prépare.

L'hôte possède deux emplacements (des cibles à la taille du canvas) ; un jour
dessine dans celui de sa parité, si bien que le jour qui joue et celui qui se
prépare n'en partagent jamais un. La composition lit toujours ces deux mêmes
textures : changer la texture d'un nœud TSL d'une image à l'autre laissait la
première image de chaque passage noire (three.js ne relit la valeur qu'à
l'image suivante).

La libération passe par un registre (`mega/src/kit.js`) : chaque texture et
chaque tampon créés sur le GPU sont rattachés au projet dont le code est sur la
pile d'appel. Ce qu'on ne retrouve pas en parcourant la scène (cartes d'ombre,
cibles de la chaîne d'image, studio préfiltré, tampons de calcul des particules
de Melt) est ainsi rendu aussi : après libération, il reste 0 Mo d'un jour.
Le registre note aussi quels jours se servent de chaque ressource : three.js
crée des globales pendant le dessin d'un jour (la table DFG_LUT des matériaux
physiques, la cible de travail du générateur PMREM…), qui ne sont jamais
rendues. Une globale dont un seul jour se sert échappe à ce test : la
géométrie que three.js partage entre tous les sprites, créée par Orrery (le
seul jour à en avoir), lui était rattachée et rendue avec lui ; au tour
suivant, Orrery reprenait un tampon détruit et le moteur refusait chaque
image (animation figée). Les géométries partagées de three.js (sprites,
passes plein écran) sont donc exclues du registre (`SHARED`, `kit.js`).

## Une seule source pour la page et le relais

Chaque projet a trois modules : `src/core.js`, le cœur (la scène,
l'application de la recette, le rendu d'une phase : caméra du film, lumière,
studio, brouillard, chaîne d'image, mise au point) ; `src/main.js`, la page
(écran de chargement, panneau, URL, export, caméra libre, outils `?debug`) ; et
`src/day.js`, le jour du relais (réglages par défaut, cible du jour, passage
d'entrée). La page et le relais appellent le même `renderAt` du cœur : une
retouche de caméra, de lumière ou de chaîne d'image faite dans `core.js` vaut
pour les deux, sans rien recopier. Ce qui vit dans les modules du projet
(`scene/`, `gen/`, `recipe.js`, `app/settings.js`) suit aussi tout seul.

Ce qui ne suit pas seul : un nouveau projet. La skill `codevember-scene` pose
`core.js` et `day.js` à l'échafaudage ; au livrable, il reste à régler la
graine et le passage d'entrée (`meta`), et à inscrire le jour dans l'ordre du
relais (`DAYS`, `mega/src/main.js`).

Deux contrôles :
- `npm run check` : chaque projet a son `day.js` et son `core.js`, importé par
  la page et par le relais ; la graine du jour est celle de la page ; son
  passage d'entrée existe ; les jours de l'ordre du relais existent (les
  projets d'avant le relais qui n'y sont pas encore ne font qu'une remarque) ;
- `tools/relay-check.html` : chaque jour du relais, préparé derrière son
  prédécesseur, est comparé à sa propre page, à la même taille et aux mêmes
  phases (blocs de 8 × 8 pixels ; écart attendu : moins de 1,5 en moyenne ;
  la page reçoit la graine du jour, lue dans son day.js). Membrane dépasse
  (≈ 3) : son froissé dépend des images déjà rendues, et la page et le relais
  n'arrivent pas à la phase par le même chemin ; les deux images sont
  identiques à l'œil, l'écart est un grain fin sur toute la membrane.
  C'est ainsi qu'on a trouvé le studio mal préfiltré : en arrière-plan, le
  découpage de `warmScene` (6 ms par dessin) sautait une partie du
  préfiltrage ; le kit le refait à la fin de la préparation, découpage coupé.

## Ajouter un jour

Un jour est un module `<projet>/src/day.js` qui exporte `meta` et
`createDay({ renderer, pipes, width, height, nextFrame })`, construit avec `makeDay` du
kit autour du cœur du projet (`createCore` de `src/core.js`, voir plus haut) ;
il dessine dans sa cible, jamais dans le canvas. `renderAt(u, { push })` du
cœur avance la caméra vers ce qu'elle regarde. `meta.enter` choisit le passage
par lequel on y entre.

Points à surveiller en ajoutant un jour :
- l'état global des modules communs : `G` de `shared/scene/globals.js` est
  partagé par les jours qui l'importent (chaque jour remet sa propre phase
  précédente avant de dessiner) ; `setNoiseVolume` et `setLite` de
  `shared/scene/materials.js` sont lus à la construction des matériaux : deux
  jours qui ont chacun leur volume de bruit doivent le poser juste avant de
  construire les leurs ;
- un jour ne doit rien lire de la page (`location`, `innerWidth`, le canvas) ;
  il ne dessine jamais dans le canvas : pendant son dessin, le kit redirige
  `setRenderTarget(null)` vers sa cible (le champ de lave de Magma y revenait,
  d'où un écran noir et des images de Magma surgissant pendant Melt) ;
- tout calcul lourd de la génération va dans le worker du jour : sous un écran
  de chargement une seconde de fil principal passe inaperçue, dans le relais
  elle fige le jour qui joue (les figurines de Melt, déplacées dans
  `melt/src/gen/shape.js`) ;
- un calcul GPU long de la génération (la simulation d'Erosion : 17 455 pas)
  doit pouvoir s'étaler : `nextFrame` attend l'image suivante de l'hôte, et
  Erosion n'envoie plus qu'un lot de 32 pas par image au lieu de 256, sans attendre la fin du GPU entre deux lots (prêt en 11 s environ derrière Pendulum) ;
- ce qu'un jour crée directement sur le device WebGPU, hors de three.js,
  échappe au registre : il le rend par `extraDispose` (les tampons de la
  simulation d'Erosion, ≈ 270 Mo ; ceux des ondes de Caustic, ≈ 48 Mo) ;
- une chaîne d'image qui change un réglage commun du moteur
  (`renderer.toneMapping` chez Kelp) : le kit le remet après chaque dessin ;
- limite connue : Orrery construit chacune de ses trois machines sur le fil
  principal (`planetaire_v2/src/scene/machine.js`, 360 à 490 ms par monde,
  dont le mouvement seul, `mech/drive.js`, 160 à 240 ms) : préparé derrière
  Moss, il fige son image trois fois environ une demi-seconde. Le
  remède est de construire la géométrie des machines dans un worker ;
- un module qui garde une ressource GPU au niveau du module (la sonde de
  Tesseract, les roues dentées et la fumée d'Orrery) l'oublie à la libération
  du jour (`releaseProbeTarget`, `releaseGearCache`, `releaseSmokeTexture`),
  sinon le passage suivant du même jour la réutilise après que le registre
  l'a rendue. Un défaut de ce genre n'apparaît qu'au deuxième tour : pour le
  chercher, `?days=hollow,planetaire_v2` fait revenir un jour toutes les deux
  places ;
- deux jours du même projet ne peuvent pas être en mémoire en même temps (le
  registre ne sait pas les séparer).

