# Feather

*la plume en tuyau.* Une gerbe de plumes pousse au sommet d'une tête couverte de duvet, comme une huppe. Chaque plume sort roulée dans sa gaine. La gaine s'effrite, la plume se déroule comme un livre qu'on ouvre, ses barbes s'agrafent l'une à l'autre et son motif apparaît. Elle se penche à sa place dans la gerbe, s'use, et la suivante la chasse. À chaque instant, l'une d'elles se déplie.

Au centre de la gerbe, des tuyaux bleutés montent, roulés dans un tube de kératine cireux. Autour, des plumes à tous les âges : celles qui viennent de s'ouvrir, presque droites, puis de plus en plus penchées à mesure que leur vexille ouvert prend du poids, jusqu'à la plus usée, aux pointes effrangées. Quand un tuyau pousse sous la plus vieille, il chasse son calamus hors du follicule : elle bascule, se couche sur le duvet et glisse sur la pente du crâne, hors du cadre. Sur chaque tuyau, la gaine sèche et s'effrite de la pointe vers la base. Les barbes libérées s'écartent en pinceau, et les deux moitiés du cylindre s'ouvrent, sans s'étirer, pour devenir les deux vexilles (les deux moitiés plates de la plume, de part et d'autre de l'axe). Les barbes, d'abord séparées par des jours, s'agrafent de proche en proche, et le motif (barres, chevrons, taches, ocelle) se lit en entier.

![Une gerbe de martin-pêcheur au cabinet : des tuyaux au centre, des plumes ouvertes à tous les âges autour (graine 1)](docs/capture.jpg)

Rendu physique en three.js (WebGPU, TSL). La scène est entièrement procédurale : une graine (un code court) produit toujours la même scène. La démarche est dans [docs/concept.md](docs/concept.md) : le thème exploré sous six angles, les clichés écartés, neuf pistes notées, les épreuves (crédibilité, variété, ambition, déclinaison, échelle) et les révisions après les premiers rendus, jusqu'au passage du plumage en tuiles à la gerbe.

## Utilisation

| Touche | Action |
| --- | --- |
| N | nouvelle scène (nouvelle graine) |
| Espace | pause / lecture |
| ← / → | avancer ou reculer dans la boucle |
| H | masquer l'interface |
| F | plein écran |

Sur écran tactile : une touche met en pause, deux touches tirent une nouvelle scène, un appui long masque l'interface.

Paramètres d'URL : `?seed=…`, `#r=…` (scène retouchée, « Copier le lien »), `?ui=0`, `?mobile=1` / `?mobile=0`, `?debug` (outils dans `window.feather` : `shot(phase)`, `send(nom)`, `sheet(graines, phases)` (une graine peut s'écrire `graine:humeur:famille`), `meter()`, `meters()`, `bench()`, `seam()`, `run()`).

Le panneau règle :
- la famille, l'oiseau et l'humeur (nouvelle scène de la même graine), la durée ;
- la caméra ;
- la forme de la plume (longueur, largeur, asymétrie, angle et courbure des barbes, pointe, base duveteuse, densité, courbure du rachis) et le programme du motif ;
- les couleurs, l'irisation, le lustre et la translucidité ;
- les trois lampes, le studio, le fond et la brume ;
- le rendu.

Export MP4 image par image (éventuellement accumulé) et PNG.

## Principe : une plume pousse roulée, puis se déroule

**La croissance dans le collier** (`src/gen/feather.js`, d'après Prum et Williamson 2001, *Theory of the growth and evolution of feather shape*). Une plume se forme au fond du follicule (le petit puits de la peau d'où elle sort), dans le collier, un anneau de cellules. Les crêtes des barbes naissent du côté postérieur de l'anneau et montent en hélice jusqu'au côté antérieur, où elles se soudent au rachis, l'axe central de la plume. La plume sort donc du follicule **roulée en tube**, dans une gaine. La circonférence du tube est la largeur totale du vexille. Déroulé, le tube devient un plan, et les hélices deviennent les barbes droites, à leur angle au rachis.

**Le déroulement est une isométrie** : la plume change de forme sans s'étirer ni se froisser, comme une feuille de papier qu'on déroule. Une tranche du tube est un arc de longueur σ et de courbure κ = (1 − λ)/ρ, λ passant de 0 (roulé) à 1 (plan) :

  x = côté · sin(κσ)/κ,   z = −(1 − cos κσ)/κ + ρ(1 − λ)

La courbure change, la longueur d'arc non : chaque barbe se déroule sur un cylindre de courbure unique (son λ, lu à mi-hauteur) et garde sa longueur (vérifié à 0,2 % près par un test, la différence venant de l'échantillonnage). Le second terme centre le tube roulé sur l'axe du follicule. Le rachis est sur sa génératrice dorsale et revient sur l'axe en s'ouvrant.

**Le motif est déposé pendant la croissance** (`src/gen/pattern.js`, d'après Prum et Williamson 2002, *Reaction-diffusion models of within-feather pigmentation patterning*). Deux substances simulées sur l'anneau du collier, un activateur de la production de pigment et un inhibiteur qui diffuse plus vite, forment des motifs (réaction-diffusion de Gierer-Meinhardt avec saturation, sur l'anneau périodique). Chaque instant dépose une rangée du plan déroulé, de la pointe vers la base : ce qui se succède dans le temps s'inscrit le long de la plume. Une oscillation homogène dépose des **barres**. Un collier oblique (le rachis sort plus tard que le bord) les plie en **chevrons**. Une instabilité de Turing sur l'anneau, à production pulsée, donne des **rangées de taches**, un Turing fin qui dérive des **stries**, une source au rachis une **flammèche**. L'ocelle du paon, qui ne se lit qu'en deux dimensions, est un champ d'anneaux concentriques en forme fermée autour d'un centre sur le rachis.

**Le calendrier.** Une seule horloge règle la vie d'une plume (`SCHED`). Chaque plume de la gerbe la vit à son tour (voir plus bas) :

| Âge (part de boucle) | Ce qu'on voit | Cause visible | Loi | Temps du film |
| --- | --- | --- | --- | --- |
| 0 – 0,05 | le tuyau sort et chasse le calamus de l'ancienne plume hors du follicule : elle glisse le long de son axe | la croissance | la mue : la nouvelle plume chasse l'ancienne | accéléré |
| 0,05 – 0,18 | libérée, elle bascule, se couche sur le duvet et glisse sur la pente du crâne, de plus en plus vite, puis le long du flanc, hors du cadre | son poids, la pente | bascule puis glissement accéléré le long du méridien | ralenti ×8 (caméra rapide) |
| 0,1 – 0,22 | le tuyau finit de monter, roulé dans sa gaine, presque droit | la croissance au collier | ~5 mm par jour | accéléré (semaines) |
| 0,18 – 0,42 | la gaine s'effrite, la plume se déroule de la pointe vers la base | la gaine sèche, les barbes reprennent leur forme plane | isométrie, rebond élastique | accéléré |
| 0,2 – 0,5 | les barbes s'agrafent, du rachis vers le bord | crochets des barbules | front qui ne recule jamais | accéléré |
| 0,18 – 0,66 | la plume se penche vers l'extérieur et son rachis fléchit | le poids du vexille ouvert | inclinaison monotone | accéléré |
| 0,66 – 1 | elle se penche encore, pâlit et s'effrange | le soleil, le frottement, le rachis qui se fatigue | abrasion des pointes, barbes décrochées | accéléré (mois) |

**La boucle.** Chaque follicule a deux instances : la plume courante et l'ancienne qu'elle chasse. L'ancienne part exactement de la pose de la courante à la fin de sa vie, et la courante d'âge 0 est entièrement dans le follicule. Au raccord d'un follicule, rien ne saute, par construction.

## Les familles : quatre façons de sortir de sa gaine

| Famille | Mouvement | Oiseaux |
| --- | --- | --- |
| Vexille | le tube s'ouvre en livre, puis les barbes s'agrafent en surface continue | pigeon, effraie, geai, faisan, perdrix, corbeau, martin-pêcheur |
| Ocelle | un long tuyau, dont les fils libres du bas s'écartent en fontaine et pendent, le disque de l'œil se déplie en haut | paon |
| Duvet | sans rachis : la gaine éclate, les barbes s'épanouissent en étoile tout autour et frisent en houppe (une grappe de houppes) | eider, cygne |
| Plume | barbes très longues, sans crochets : elles ne s'agrafent jamais et retombent en cascade | autruche, aigrette |

## La plume (`src/gen/feather.js`, `src/scene/feather.js`)

- **La gaine** (une par follicule, instanciée) s'effrite derrière le front de déroulement : elle est retirée de la géométrie elle-même (et donc de la carte d'ombre) au-delà de son bord tramé. Un masque de fragment ne suffit pas : la passe d'ombre de three.js le réutilise sans les variables qu'il lit (la gaine y restait entière, puis disparaissait d'un bloc).
- **Construction** : calamus translucide (qui reste aux trois quarts dans le follicule), rachis effilé, deux vexilles asymétriques dont la base est duveteuse (barbes libres et frisées), barbes à arête (le ramus) bordées d'une frange de barbules, gaine de kératine cireuse aux crêtes hélicoïdales et à la pulpe sombre, pointe usée, motif déposé pendant la croissance, irisation.
- **Rubans à arête** : chaque barbe est un gabarit de 22 segments sur 3 sommets, instancié pour toutes les plumes de la gerbe (quatre vec4 par instance dans un tampon entrelacé) et posé dans le vertex shader par la même formule qu'en JS (`barbPose`). La normale s'incline en travers (l'arête du ramus accroche un filet de lumière). La frange des barbules est un peigne tramé (lissé par l'anticrénelage temporel).
- **Libres puis agrafées** : une barbe libérée s'écarte de quelques degrés et ondule (des jours s'ouvrent entre les barbes), puis le front d'agrafage la ramène dans le plan. Les barbes sans crochets s'affaissent sous leur poids.
- **Matière** : couleur du motif lue dans le plan déroulé, lustre de velours des barbules, translucidité (à contre-jour, le vexille s'allume et son motif se lit en ombre chinoise).
- **Couleur structurale** (paon, faisan, corbeau, pigeon, martin-pêcheur) : les barbules portent un empilement régulier de bâtonnets de mélanine qui réfléchit une longueur d'onde selon la loi de Bragg, λ = λ₀ √(1 − sin²θ / n²) avec n ≈ 2. La couleur est dans le reflet (couleur spéculaire et lustre), sur un fond pigmentaire sombre, et glisse vers le bleu quand on regarde en biais. λ₀ par oiseau (450 nm pour le corbeau, 535 pour le paon, 560 pour le faisan), par anneau dans l'œil du paon (452 au centre, 478, 505, 595 pour l'anneau bronze), et seulement sur les marques noires du faisan.

## La gerbe (`src/gen/bouquet.js`)

**Un zootrope à l'angle d'or.** Sept à onze follicules sur une petite couronne au sommet du socle. Le follicule i est à l'azimut i × 137,5°, et sa plume a l'âge a = frac(φ + i/N), φ étant la phase de la boucle. Deux plumes nées l'une après l'autre sont donc à 137,5° l'une de l'autre. Deux voisines sur la couronne ont des indices qui diffèrent de 3, 5 ou 8, donc des âges très différents, et comme l'inclinaison ne fait que croître avec l'âge, elles sont sur deux cônes emboîtés plutôt que croisés. La boucle se referme par construction, et à chaque instant une plume au moins se déplie.

**Le socle.** Le sommet arrondi d'une tête (une calotte prolongée par un cylindre qui sort du cadre), couvert de houppes de duvet gonflées, semées sans trame et cuites une fois en un maillage statique. Deux essais l'ont précédé : une petite pelote, qui se lisait comme une boule flottante, et un champ de duvet presque plat, où la plume chassée tombait sans plus avoir de raison de quitter le cadre.

**Les réglages par famille** (`GERBE`) :

| Famille | Plumes | Calotte | Couronne | Inclinaison (tuyau → ouverte → usée) | Courbure du rachis |
| --- | --- | --- | --- | --- | --- |
| Vexille | 11 | 0,9 L | 0,12 L | 0,02 → 0,34 → 0,6 rad, plus le follicule (0,3) | 0,42 / L |
| Ocelle | 8 | 0,55 L | 0,06 L | 0,02 → 0,3 → 0,56, plus 0,26 | 0,22 / L |
| Duvet | 6 | 1,8 L | 0,75 L (une grappe de houppes) | 0,06 → 0,4 → 0,62, plus 0,3 | — |
| Plume | 7 | 0,6 L | 0,09 L | 0,02 → 0,22 → 0,42, plus 0,2 (une fontaine) | 0,36 / L |

L'inclinaison du follicule ne s'applique qu'à 30 % tant que la plume est un tuyau, puis entièrement une fois ouverte : un tuyau penché passait sous la base large des plumes les plus vieilles.

**Les traversées : un banc** (`src/gen/collide.js`). Le banc mesure ce que l'on voit. À un instant u, il prend toutes les plumes de la gerbe à leur place réelle (`bouquetState`, la fonction qui remplit aussi les uniformes du GPU). Chaque barbe et chaque rachis y sont des lignes brisées, posées par la même formule que le vertex shader, et la surface pleine de chaque plume (barbes agrafées, rachis) une carte de hauteur dans son propre repère. Un segment dont les deux extrémités sont de part et d'autre d'une surface, de plus de 0,15 mm, la traverse. Les barbes libres (les fils du paon, l'autruche) se mêlent comme des cheveux : elles ne font pas surface. Au pied de la gerbe (sur 0,1 L), les bases duveteuses et le duvet du socle se mêlent de même, et on n'y compte pas les traversées. `node feather/tools/crossings.mjs 1 7 g1:vexille` donne le pire instant de chaque graine.

Il n'y a plus de solveur. Le plumage en tuiles en demandait un (3 à 8 s au chargement), qui écartait les voisines pas à pas, des mouvements sans cause visible. Dans la gerbe, l'ordre suffit. Mesuré sur huit graines et 100 instants : 0,6 mm au plus pour les vexilles, le duvet et le paon. Pour l'autruche, dont seuls les rachis sont pleins, deux rachis se frôlent encore pendant un ou deux centièmes de boucle (jusqu'à 5 mm).

## Les décors

Le fond est neutre (un dégradé, une lueur à l'opposé de la caméra). Chaque humeur se distingue par sa lumière, sa valeur et son cadrage. Les humeurs dont le fond a la valeur du plumage sont écartées pour chaque oiseau (la plume tranche sur son fond).

| Humeur | Fond | Lumière | Valeur | Cadrage |
| --- | --- | --- | --- | --- |
| Cabinet | crème | grande source douce au-dessus | très claire | plongée de trois quarts |
| Contre-jour | brun très sombre | soleil bas derrière la plume | sombre, liserés | ras |
| Fenêtre nord | gris bleuté | fenêtre latérale froide, douce | moyenne, froide | latéral |
| Plein soleil | ciel pâle | soleil haut et dur | claire, contrastée | plongée |
| Brume | gris perle | diffuse, sans direction | claire, faible contraste | moyen |
| Lanterne | noir chaud | petite source chaude, basse, de côté ; contre-jour froid | très sombre | rapproché, bas |
| Studio noir | noir | bande au-dessus, liseré | sombre, irisée | rapproché |

**La caméra** cadre la gerbe entière, presque à hauteur, le socle en bas du cadre. Un seul mouvement, lent : un balancement d'azimut sur la boucle et une respiration de distance. La mise au point glisse vers la plume qui se déplie (moyenne de leurs distances, pondérée par une cloche sur la fenêtre du déroulement : une autre prend le relais sans saut). Trajectoire lissée (noyau gaussien périodique, σ = 0,9 s), pointe sous 12°/s.

## Écran de chargement

L'écran dessine le calcul en cours. Le motif de la plume de cette graine se dépose dans le collier, rangée après rangée, sur le vexille déroulé dont le contour et les barbes se dessinent, et une bande lumineuse (le collier) descend avec lui.

## Tests

```bash
node --test feather/test/*.test.mjs
```

Dix-sept tests (3 s) : le déroulement est une isométrie ; le calendrier est monotone (croissance, front de déroulement, agrafage, courbure, inclinaison, usure) ; la boucle se referme ; la gerbe est à l'angle d'or (deux plumes nées l'une après l'autre sont loin l'une de l'autre, une plume au moins se déplie à chaque instant, l'inclinaison ne revient jamais en arrière) ; au raccord d'un follicule, l'ancienne prend exactement la pose de la courante ; la chute de l'ancienne glisse le long de son axe sur au plus la longueur du calamus, ne remonte jamais, ne saute pas et sort du cadre ; rien ne traverse rien sur toute la boucle (le banc, huit graines) et rien n'entre dans le socle ; à 60 i/s, aucune partie pleine ne saute de plus de 2 mm ; la caméra est périodique, lente, sans à-coup ; le motif du collier est déterministe, non trivial et respecte sa couverture ; les quatre familles ont des gestes distincts ; recette déterministe et JSON ; familles, oiseaux et humeurs tirés ; humeurs différentes par la lumière et la valeur ; lampes presque blanches ; la plume tranche sur son fond.

## Performances

Génération d'une scène : 10 à 90 ms pour le motif du collier (réaction-diffusion 128 × 192), moins de 5 ms pour la table de barbes, 50 à 150 ms pour le duvet du socle (dans des workers), 10 à 30 ms pour la trajectoire de caméra. Plus de scène à résoudre : le chargement ne dure plus que le temps de compiler les shaders. Temps d'image mesuré dans le panneau de navigateur de l'application (GPU d'un Mac), qualité Haute, 1 983 × 1 597 (3,2 Mpx), boucle arrêtée, 20 rendus :

| Graine | Famille, humeur | u = 0,3 | u = 0,6 |
| --- | --- | --- | --- |
| 1 | vexille (martin-pêcheur), cabinet | 6,5 ms | 6,3 ms |
| 7 | ocelle (paon), fenêtre nord | 5,7 ms | 5,5 ms |
| 0 | plume (aigrette), contre-jour | 5,9 ms | 5,9 ms |
| 2 | duvet (cygne), studio noir | 6,6 ms | 6,6 ms |

Deux fois moins qu'avec le plumage en tuiles (11 à 17 ms) : les deux cents voisines en gabarit grossier ont disparu. Mobile (`?mobile=1`) : 1,7 ms. Raccord de la boucle (`seam()`) sous 10⁻⁷.

## Version mobile

Imposée par `?mobile=1`, ou choisie d'office sur téléphone : 30 % de barbes en moins par plume, un quart de plumes en moins dans la gerbe, rubans de 12 segments, duvet du socle plus clairsemé, motif en 96 × 144, une lumière de moins, chaîne d'image allégée (ni occlusion, ni anticrénelage temporel, ni flou de mouvement), résolution dynamique. Vérifiée dans le navigateur de l'application (console propre, 1,7 ms), pas sur un appareil réel.
