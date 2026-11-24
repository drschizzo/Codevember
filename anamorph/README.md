# Anamorph

*le cadran des ombres.* Au-delà du cercle polaire, le soleil de minuit fait le tour de l'horizon sans se coucher. Sur la neige, un tas de ferraille rouillée, sans forme, porte une ombre longue qui tourne avec lui. Vers 21 h, cette ombre devient un renard assis. Le soleil continue sa course, le renard se défait, et vers 3 h la même ombre devient un lièvre dressé.

Le film a trois temps. Au début, les pièces sont éparpillées à plat sur la neige. Elles viennent une à une, montent, passent au-dessus du tas et descendent s'y poser : le tas monte en un amas qui semble aléatoire. Puis le soleil arrive à la première heure, et l'ombre devient la première figure. La caméra la regarde d'en haut, dos au soleil, dans l'axe de l'ombre. Caméra et soleil tournent ensuite jusqu'à la seconde figure. Enfin le tas se démonte, pièce par pièce, et chacune retourne à sa place sur la neige. La figure n'existe qu'à une heure précise, depuis une direction précise du soleil : c'est une anamorphose dont la lumière est le point de vue.

La boucle est parfaite par construction : le soleil fait exactement un tour d'horizon, et le démontage est exactement l'assemblage passé à l'envers, symétrique autour du milieu des deux figures. Au début comme à la fin, toutes les pièces sont à leur place au sol.

<!-- capture : docs/capture.jpg (à prendre au temps fort, la figure entière) -->

Rendu physique en three.js (WebGPU, TSL). La scène est entièrement procédurale : une graine produit une scène. La démarche est dans [docs/concept.md](docs/concept.md) : le thème exploré sous six angles, neuf pistes notées, puis les révisions demandées après les premiers rendus (ombres illisibles, trois figures de trop, bloc qui trahissait la figure, interpénétrations, matières « 3D », netteté des oreilles, sols).

## Utilisation

| Touche | Action |
| --- | --- |
| N | nouvelle scène (nouvelle graine) |
| Espace | pause / lecture |
| ← / → | avancer ou reculer dans la boucle |
| H | masquer l'interface |
| F | plein écran |

Sur écran tactile : une touche met en pause, deux touches tirent une nouvelle scène, un appui long masque l'interface.

Paramètres d'URL : `?seed=…`, `#r=…` (scène retouchée, « Copier le lien »), `?ui=0`, `?panel=1`, `?mobile=1` / `?mobile=0`, `?debug` (outils dans `window.anamorph` : `shot(phase)`, `send(nom)`, `sheet(graines, phases)`, `meter()`, `poster()`, `bench()`, `seam()`, `run()`).

Le panneau règle :
- l'humeur (le décor, une nouvelle scène de la même graine), la durée, la latitude et la date (la hauteur du soleil aux deux heures), la place de la première figure dans la boucle ;
- la caméra (champ, plongée des tenues, plongée et distance de la ronde) ;
- l'objet : les deux figures, la matière (refait l'objet), la couleur de la peinture, la rouille (ou le vert-de-gris, la rouille blanche), le givre ;
- le soleil et le ciel, la brume ;
- le rendu.

Changer une figure, la date ou la latitude refait l'objet (environ 4 s). Export MP4 image par image (éventuellement accumulé) et PNG.

## Principe : l'art des ombres sous un soleil réel

**Le soleil.** À la latitude φ = 78° N et pour la déclinaison δ (la date), la hauteur du soleil à l'angle horaire H vaut sin h = sin φ sin δ + cos φ cos δ cos H. En été, h ne devient jamais négatif. Les deux figures sont placées à H = π ∓ 0,8 (vers 21 h et 3 h), symétriques autour de minuit : le soleil y est bas (6° à 14° selon la date), les ombres font 3 à 9 fois la hauteur de l'objet, et leurs directions font un angle droit.

**La boucle (48 s).** H(u) = H_s + 2π · w(u), avec w(0) = 0 et w(1) = 1 (`src/gen/clock.js`). La vitesse du soleil ρ(u) = w′(u) = 1 − c · Σ bosse(u − u_k) tombe à 14 % de la moyenne autour des deux figures. C'est un accéléré à vitesse variable, une convention de cinéma qui ne touche que l'horloge, et il est strictement croissant : le soleil ne recule jamais. u₂ est trouvé par dichotomie pour que le soleil soit exactement à l'heure de chaque figure pendant sa tenue. La caméra suit des poses clés interpolées par une spline de Catmull-Rom périodique (une tenue en plongée sur chaque figure, une ronde basse autour du tas) et fait un tour d'azimut par boucle. L'assemblage occupe u ∈ [0,02 ; 0,28], la première figure tient à u₁ = 0,36, la seconde à u₂ ≈ 0,65, et le démontage est le miroir de l'assemblage autour de (u₁ + u₂)/2.

**Deux figures, pas trois.** Un point de l'objet à la hauteur y projette son ombre à y · cot h du pied. Avec trois figures, chaque point doit tomber dans trois cibles à la fois. Les détails qui font reconnaître l'animal (oreilles, museau) sont justement ceux qui disparaissent : 64 à 78 % de couverture dans les prototypes, contre 97 à 100 % avec deux figures à angle droit.

## Génération (`src/gen/`, dans un Web Worker)

1. **Les cibles** (`silhouettes.js`). Des silhouettes dessinées à la main en polygones, lissées par Chaikin en gardant les angles vifs. Chaque figure est posée au sol dans le repère de son ombre (a du pied vers le bout, b en travers), droite pour la caméra qui la regarde, dos au soleil.
2. **Le placement et la coque** (`shadowart.js`, d'après Mitra et Pauly, *Shadow Art*, 2009). La coque est l'ensemble des points dont l'ombre tombe dans les deux cibles à la fois. Tout ce qui est dedans fait une ombre qui ne déborde jamais. Une recherche aléatoire locale (160 essais sur une coque en voxels 56² × 40) place les deux figures, chacune pouvant commencer derrière le pied de l'objet, pour maximiser la plus petite des deux couvertures. La coque devient ensuite une distance signée : pour chaque figure, une transformée de distance euclidienne exacte de sa silhouette (Felzenszwalb et Huttenlocher), ramenée à la paroi oblique par le facteur sin h / √(1 − n_b² cos² h), puis un max lissé.
3. **La ferraille** (`pieces.js`). Une couverture gloutonne, du gros au fin. Neuf pièces de structure posées au sol, puis jusqu'à 170 moyennes, puis jusqu'à 300 petites. Ce sont des profilés réels (tube creux, rond à béton, fer carré, méplat, cornière), éventuellement cintrés ou écrasés. Chaque candidate est soudée bout contre flanc sur la vraie surface d'une pièce posée (fonction support de sa section), ou repose sur le sol. Elle doit rester dans la coque et à distance de toutes les autres pièces. On garde celle qui couvre le plus de cible nue, en ne comptant que l'**ombre pleine** : la pénombre d'un point à la hauteur y fait 2 · 0,267° · y / sin h, donc une pièce haute doit avoir au moins ~2 cm de rayon pour compter. Le contour et les parties fines de la figure pèsent jusqu'à 5 fois plus que son milieu, que la pénombre comble. Un tiers des candidates visent un pixel nu du contour, remonté le long du rayon de soleil dans la coque. Résultat : 230 à 480 pièces, 74 à 86 % d'ombre pleine par figure.
4. **Le maillage** (`forge.js`). Chaque section est balayée le long de son axe (Bézier quadratique s'il est cintré, ovalisation près d'un bout écrasé), avec chanfreins, coupes droites (l'alésage des tubes visible), et un cordon de soudure à chaque jonction. Rôles de surface : peau, arêtes et coupes, soudure.
5. **L'assemblage** (`assembly.js`). Chaque pièce reçoit une place au sol : à plat, cap tiré, dans un anneau autour du tas, sans en toucher une autre. L'ordre de montage est calculé à rebours, comme un démontage. On retire d'abord, tant qu'il en reste, les pièces sans fille dont un couloir de sortie (de la verticale à 78° d'inclinaison, jusqu'à l'altitude de passage) ne rencontre aucune autre pièce restante. L'assemblage est ce démontage à l'envers : chaque mère est posée avant ses filles, et chaque pièce descend par un couloir libre parmi les pièces déjà posées. 84 à 89 % des pièces ont un tel couloir ; les autres, enchevêtrées, prennent le couloir le moins encombré. Le vol d'une pièce : montée verticale, traversée à une altitude étagée (1,25 à 1,6 m) en prenant son orientation, puis descente le long de son couloir, ralentie à la fin. La pose de chaque pièce est calculée sur le processeur à chaque image et passée au vertex shader (`src/scene/motion.js`), avec la pose de l'image précédente pour les vecteurs vitesse.
6. **La congère** (`drift.js`). Contre chaque pièce basse, la neige monte jusqu'à ~45 % de la section, s'étire sous le vent et comble le pied du tas. C'est un champ de hauteur 320².

Le worker envoie son avancement et l'ombre de chaque pièce posée à l'écran de chargement, qui les dessine sur les deux silhouettes (`src/app/loaderArt.js`).

Durée de génération (Node, Apple Silicon) : 4,1 à 5,6 s selon la graine (sur quatre graines, 306 à 479 pièces), dont environ 1 s de placement, 2 à 3 s de ferraille et 0,3 à 0,5 s pour le plan d'assemblage.

## Matériaux

L'objet a cinq **accords de matières**, tirés par la graine et pondérés par l'humeur : ferraille rouillée, bois flotté, plomberie de cuivre, acier peint écaillé (une couleur industrielle par graine), acier galvanisé. Chacun a ses pièces, ses déformations et ses jonctions : branches amincies aux bouts usés sans soudure pour le bois, brasures pour le cuivre, soudures nues pour l'acier peint (`ACCORDS`, `src/gen/pieces.js` ; `src/scene/objectMaterials.js`).

- **Le fer** (`src/scene/iron.js`) est une croûte et non une teinte. La rouille est brun sombre et compacte, avec des efflorescences orangées, des piqûres noires et des cloques de 2 à 4 mm en relief. La calamine est noir bleuté, à peine métallique, satinée. Les coupes et les arêtes montrent un acier terni, les soudures sont sombres et grumeleuses. Le givre en poudre ne tient que sur les faces tournées vers le ciel. Une même rouille tirée par pièce fait varier l'avancement d'une barre à l'autre.
- **Les sols** (`src/scene/ground.js`) : six surfaces dures, aucune faite de brins ni de translucidité. Leur relief a deux échelles, calculées par la même fonction. La grosse échelle déplace réellement un carré de 400² sommets autour du tas (dans le shader de sommets) et entre aussi dans le bumpMap. La fine échelle n'est que dans le bumpMap. Sous le tas, la grosse échelle s'aplatit sur les sols où l'objet doit porter.

## Scène

- **Humeurs** (`MOODS`, `src/recipe.js`) : six décors, chacun avec sa date (hauteur du soleil), sa plongée, sa brume, sa rouille, son givre et son étalonnage.
  - **Kertész** (ouverture, d'après le regard d'André Kertész) : neige tassée par le vent, paillettes de givre, congère au pied du tas ; plongée 72–80°, l'ombre est le seul noir de l'image.
  - **Moraine** : gneiss clair poli par un glacier, bandes sombres adoucies, stries ; fin de saison, soleil plus bas.
  - **Marée** : sable humide, rides de 14 cm, film d'eau dans les creux ; plongée basse, horizon dans la brume.
  - **Quai** : dalle de béton à joints, granulats ; plein solstice, plongée presque verticale, cadrage graphique.
  - **Ponton** : planches grisées, jours, bouts décalés.
  - **Basalte** : lave cordée noire, plis polis, vésicules ; ciel bas et exposition poussée.
- **Lumière** : un soleil directionnel (rougi près de l'horizon par la masse d'air) dont la caméra d'ombre cadre l'objet et toute son ombre à chaque image, et un ciel polaire en studio HDR (`src/scene/sky.js`) dont l'auréole tourne avec le soleil. Il n'y a aucune autre lampe : les ombres sont bleues parce qu'elles ne reçoivent que le ciel.
- **Post-traitement** : la chaîne commune (`shared/render/post.js`) : GTAO, SSR, TRAA, bloom, étalonnage par humeur.

## Tests

```bash
node --test 'anamorph/test/*.test.mjs'
```

- la recette : déterminisme, JSON pur, chaque humeur tirée, chaque sol distinct ;
- la boucle : le soleil fait exactement un tour, ne recule jamais, et est à l'heure exacte de chaque figure pendant sa tenue ;
- la caméra : raccord exact, mouvement continu, moins de 25°/s à 120 i/s ;
- le cœur : pour trois paires de figures, couverture de la coque ≥ 95 % et aucun voxel de la coque dont l'ombre sorte d'une cible ;
- l'assemblage (deux graines) : toutes les pièces au sol au raccord, toutes posées pendant les deux figures, chaque mère posée avant sa fille, démontage égal à l'assemblage renversé, places au sol sans contact et à plat, plus de 80 % de couloirs d'approche libres ;
- la ferraille (sur la sortie du worker, deux graines) : aucune paire de pièces ne se traverse (cintrage et écrasement compris), aucune n'entre dans la neige, chacune est posée au sol ou soudée à une mère posée avant elle, et l'ombre pleine dépasse 74 % sur chaque figure.

## Performances

Mesuré avec `bench()` dans le navigateur intégré, sur un portable Apple Silicon, graine a1 (humeur Quai) :

| Qualité | Image | Tenue sur le renard (u = 0,16) | Ronde au ras du tas (u = 0,66) |
| --- | --- | --- | --- |
| Haute | 1,76 Mpx | 9,8 ms | 15,5 ms |
| Mobile (`?mobile=1`) | | 4,5 ms (tenue sur le lièvre) | |

La ronde est la plus chère : le tas remplit l'image (~130 000 sommets de ferraille à matériau procédural) et le carré de sol déplacé est au premier plan. Elle reste sous le budget de 16 ms, de justesse.

## Version mobile

Le carré de sol déplacé passe de 400² à 200² sommets, la carte d'ombre de 4096² à 2048², et le post-traitement suit les réglages mobiles communs (sans GTAO ni SSR). L'objet et les ombres sont les mêmes.
