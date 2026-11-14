# Moss

*la reviviscence.* Une année de mousse sur sa pierre, en accéléré : elle se réfugie dans les fissures, reverdit à la première averse, s'étend en coussins sur la roche, puis se retire.

Au début, un plan large : une pierre de granit couverte de lichens, la mousse réduite à quelques îlots bruns dans ses fissures, les seuls endroits où l'eau reste pendant la sécheresse. Les pluies reviennent. On voit les averses passer en bandes, la roche foncer sous elles et les îlots reverdir d'un coup. La caméra avance jusqu'au bord d'un îlot. Pendant toute la saison des pluies, la mousse se propage : un voile vert de protonéma (le premier stade de la mousse, en filaments) avance sur la roche, les coussins s'épaississent derrière lui, leurs rosettes affleurent en étoiles serrées et les coussins finissent par se rejoindre. Puis vient la sécheresse. La roche pâlit, la mousse brunit et se retire dans ses fissures, et la caméra recule pour la voir partir.

![Souche, tortule : le coussin sur sa souche en fin de saison des pluies (graine b88)](docs/capture.jpg)

Rendu physique en three.js (WebGPU, TSL). La scène est entièrement procédurale : une graine produit une scène. La démarche est dans [docs/concept.md](docs/concept.md) : le thème exploré sous six angles, les clichés écartés, dix pistes notées, les épreuves, puis la révision après les premiers rendus (la propagation, l'échelle des coussins, la roche cuite), d'après les retours et les photographies de référence.

## Utilisation

| Touche | Action |
| --- | --- |
| N | nouvelle scène (nouvelle graine) |
| Espace | pause / lecture |
| ← / → | avancer ou reculer dans la boucle |
| H | masquer l'interface |
| F | plein écran |

Sur écran tactile : une touche met en pause, deux touches tirent une nouvelle scène, un appui long masque l'interface.

Paramètres d'URL : `?seed=…`, `#r=…` (scène retouchée, « Copier le lien »), `?mood=…`, `?family=…`, `?ui=0`, `?mobile=1` / `?mobile=0`, `?debug` (outils dans `window.moss` : `shot(phase)`, `send(nom)`, `sheet(graines, phases)` (une graine peut s'écrire `graine:humeur:famille`), `meter()`, `bench()`, `run()`).

Le panneau règle :
- l'humeur et la famille (nouvelle scène de la même graine), la durée, le rayon de la pierre, la part de tiges à capsule ;
- la caméra ;
- les couleurs et la translucidité de la mousse ;
- le soleil, le contre-jour, la lumière du lieu, le ciel, la brume ;
- le rendu.

Export MP4 image par image (éventuellement accumulé) et PNG.

## Principe : une propagation forcée par les saisons

Une équation fait pousser la mousse et la fait mourir selon l'eau. Deux champs vivent sur une grille de 64 × 64 posée sur la pierre (`src/field.js`) : **W**, l'eau de la roche, et **B**, la mousse. Une carte d'habitat **R**, la rétention, dit où l'eau reste. Elle est tirée de la roche elle-même : les fissures, les creux et le côté à l'ombre gardent l'eau.

  dW/dt = pluie(t, x)·(1 − W) − évap(t)·(1,2 − R)·W
  dB/dt = D∇²B + r·W·B·(1 − B/K) − m·(1 − W)·(1 − R)²·B,   B ≥ b₀·refuge(R)

La première ligne remplit la roche sous la pluie et la vide par évaporation. La seconde est l'équation de **Fisher-KPP**, celle d'une population qui croît jusqu'à saturation et se répand de proche en proche. Aux pluies, un front avance depuis les îlots à la vitesse 2√(rD). À la sécheresse, la mousse meurt d'abord là où la roche sèche vite et survit en fragments dans les fissures (le plancher b₀). La pluie passe d'abord en bandes, des averses qui traversent la pierre, puis s'installe. L'évaporation suit la saison. La croissance est forte à la saison des pluies et ne descend jamais sous 15 % de son maximum. Aucune averse ne tombe pendant la sécheresse, si bien que le retrait se fait d'un seul mouvement, du bord vers les fissures.

| Temps | Cause visible | Loi | Temps du film |
| --- | --- | --- | --- |
| les îlots reverdissent | une averse passe : la bande de pluie, la roche qui fonce | reviviscence : l'ouverture suit l'eau en quelques secondes | accéléré (une année en ~40 s) |
| les coussins s'étendent | la saison des pluies (ciel bas, roche mouillée) | Fisher-KPP : croissance logistique et diffusion | id. |
| la mousse se retire | la sécheresse (soleil haut et dur, roche pâle) | mortalité selon l'exposition, survie dans les fissures | id. |

**La boucle.** Le système est dissipatif : il oublie son état de départ. Sous un forçage de période un an, il converge vers une orbite périodique, une année qui se répète à l'identique. On l'intègre jusqu'à ce que l'état à t + P égale l'état à t (deux à quatre périodes), puis on enregistre une année (30 états par seconde de film). L'image à u = 1 est donc l'image à u = 0. Le soleil suit les saisons (plus haut l'été, voilé aux pluies) mais ne se couche jamais : l'accéléré garde l'heure de la prise de vue.

## Les coussins (`src/gen/colony.js`, `src/gen/build.js`)

- **Le dôme.** Un coussin est un dôme. Son épaisseur pleine est le maximum annuel de la mousse, adouci ; les tiges ne poussent que là où il y aura un coussin.
- **Les tiges** sont plantées dans la roche (sur son relief fin, fissures comprises) et suivent la **normale du dôme** : droites au sommet, couchées vers l'extérieur sur les flancs, où les rosettes débordent. La rosette du sommet porte les feuilles vertes, et des feuilles mortes brunes garnissent le bas de la tige.
- **La densité d'un vrai coussin** : les tiges sont plantées à 0,45 rayon de rosette (jusqu'à 2 650 tiges et 43 000 feuilles), et les rosettes voisines s'imbriquent. Une tige serrée s'ouvre moins (écartement réglé par sa plus proche voisine). Rien n'est peint : le volume est fait de tiges, et la **pénombre de la canopée** (feuilles du bas assombries selon leur rang et le serrement de la tige) donne la profondeur. Une natte sombre de rhizoïdes bouche le fond.
- **Croissance et retrait, tige par tige** : chaque tige s'allonge et raccourcit autour de son pied quand la mousse locale passe son propre **seuil de naissance**, si bien que le front avance tige par tige. Dans les refuges, le seuil est au plancher : ces tiges passent la sécheresse entières.
- **L'état dans la texture du champ** : l'ouverture, la croissance et l'eau de chaque tige ne dépendent que du champ à son pied, que chaque sommet lit dans une texture 64² (B, W, B moyenné, eau de surface). Sans tableau d'uniformes, le nombre de tiges n'a plus de plafond.
- **Trois niveaux de détail** tirés de la trajectoire de la caméra, connue d'avance : chaque feuille prend le gabarit fin, moyen ou lointain selon sa plus grande taille à l'écran sur toute la boucle. Un seul matériau.
- **La feuille** : une lame épaisse à tranche arrondie dont la pose est calculée en forme fermée dans le vertex shader (même formule qu'en JS, `src/pose.js`) ; poil hyalin, nervure, translucidité qui croît avec l'eau, film d'eau brillant.

## La roche et l'écorce (`src/gen/rock.js`)

Un relief de 1 024² texels (0,27 mm) est cuit dans un worker, puis lu deux fois sur le GPU. Il déplace les sommets d'un maillage de 720² dans le vertex shader (WebGPU n'a pas de geometry shader) et sert de normal map au pixel, avec un micro-relief procédural pour le macro, une carte de couleur minérale et de rugosité, et l'occlusion des creux.
- **Granit** : dalles séparées par des diaclases arrondies par l'usure, usure à trois échelles, mosaïque de cristaux (biotite, feldspath, quartz), lichens crustacés aréolés à apothécies noires, algues des creux humides.
- **Calcaire** : cupules de dissolution, cannelures, veines de calcite. **Grès** : lits ondulés, bandes ocre.
- **Écorce** (souches) : plaques en losanges étirés, sillons profonds, fibres, lambeaux arrachés qui montrent le bois.
- **Terre** (tourbière, sous-bois clair) : grumeaux, gravillons.

Ce même relief porte la mousse (les tiges sont plantées dessus) et fait l'habitat : les fissures sont les refuges, et la propagation en part.

## Les décors

Le fond est neutre, un dégradé uni sans paysage, pour ne mettre en valeur que la pierre ou la souche et sa mousse. Chaque humeur se distingue par son support, sa lumière et sa valeur.

| Humeur | Support | Lumière | Valeur | Cadrage |
| --- | --- | --- | --- | --- |
| Souche | souche couchée, écorce sillonnée | soleil de côté, contre-jour | fond sombre | ras, longue focale |
| Kokedera | granit à lichens | boîte à lumière douce | gris moyen | plongée |
| Lande | bloc de granit à lichens | soleil dur l'été, voilé aux pluies | fond très clair | ras |
| Muret | calcaire ou grès | soleil de midi | fond clair et chaud | contre-plongée |
| Tourbière | motte de tourbe, sphaigne | soleil bas à contre-jour | fond sombre bleuté | contre-jour |
| Rosée | motte de terre, aiguilles de pin | lumière froide | fond sombre et froid | plongée |

**Quatre familles** : la tortule (rosettes vissées au sec, étoiles argentées), le polytric (feuilles raides en ombrelle), la funaire (capsules penchées qui tournent sur leur soie), la sphaigne (capitules qui blanchissent au sec et rougissent mouillés).

**La caméra** : un plan large d'abord (toute la pierre, pour l'échelle), un travelling avant jusqu'au bord d'un îlot quand la pluie revient, le gros plan qui suit le front, puis un recul pendant le retrait. La trajectoire est lissée (noyau gaussien périodique) et pointe sous 25°/s.

## Tests

```bash
node --test moss/test/recipe.test.mjs moss/test/moss.test.mjs
```

Treize tests. La propagation est une orbite périodique et le raccord est exact. La mousse se réfugie à la sécheresse, s'étend aux pluies (le front ne recule jamais pendant les pluies) et se retire ensuite. Les refuges sont les fissures de la roche. Aucune feuille ne touche une feuille d'une autre tige, et les feuilles restent au-dessus de la roche, relief fin compris. La caméra est périodique et lente. Le reste porte sur la recette et les décors : recette déterministe et JSON ; humeurs, familles, eaux tirées ; matières des accords existantes ; humeurs différentes par le décor, la lumière et la valeur ; soleil presque blanc ; gestes des familles distincts.

## Performances

Génération d'une scène : 2 à 5 s pour les coussins et la propagation, 3 à 4,5 s pour la roche (dans Node, deux workers en parallèle pendant l'écran de chargement ; nettement plus lent quand l'onglet est en arrière-plan). Temps d'image mesuré dans le panneau de navigateur de l'application (GPU d'un Mac, panneau masqué), qualité Haute, 1,8 Mpx, graine b88 : 14 ms en pleine saison (coussins étendus). Graine s128 : 15 ms en pleine saison, 13,7 ms à la sécheresse. Les postes les plus lourds : les feuilles (~10 000 instances, pose calculée deux fois par sommet pour les vecteurs vitesse) et le maillage déplacé de la roche (720²). Le coussin dense (30 000 à 43 000 feuilles) coûte environ 1,4 à 1,9 fois plus : graine b88 dans le panneau masqué en 3,1 Mpx, 17 → 31 ms en plan large, 21 → 39 ms au front, 22 → 30 ms en plein coussin.

## Version mobile

Imposée par `?mobile=1`, ou choisie d'office sur téléphone : tiges 1,4 fois plus espacées (environ deux fois moins), sans gabarit fin, environ 1 M de triangles de feuilles, roche cuite en 640² sur un maillage de 360², une lumière de moins, chaîne d'image allégée, résolution dynamique. Non vérifiée sur un appareil réel.
