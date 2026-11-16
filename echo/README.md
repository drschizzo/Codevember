# Echo

*le miroir en retard*

Une pièce dans la pénombre : une nature morte sur une table, une lampe stroboscopique pendue au plafond, un miroir. Sur la douille, un voyant rougit pendant que le condensateur se charge ; il s'allume franchement, l'éclair part, et une caméra impossible, des centaines de millions de fois plus lente que le réel, suit la lumière. Un anneau brillant sort du tube en spirale, passe sur la table et les vases en faisant naître leurs ombres, atteint la glace ; dans le miroir, l'éclair n'apparaît qu'ensuite, et un second anneau, plus faible, revient de la glace : l'écho. Dans la galerie, deux glaces se font face de part et d'autre de la table et se renvoient l'éclair encore et encore : dans la glace, les copies de la lampe s'allument l'une après l'autre, chaque fois plus loin et plus faibles. Avec le miroir ardent, l'écho revient à sa source : la lumière se referme sur l'ampoule et la rallume. Puis le temps réel revient, dans le noir, et le voyant recommence à rougir. La boucle dure 7 à 13 s et elle est parfaite par construction : le film est une fonction de la phase, et à u = 0 comme à u = 1 l'éclair précédent a quitté la pièce, la charge est la même, la caméra à la même pose.

![Echo](docs/capture.jpg)

La scène prend une seule liberté, le temps. Tout le reste suit la propagation de la lumière : elle avance à c, chaque écho a la longueur exacte de son chemin, et un point n'apparaît allumé que lorsque la lumière qu'il renvoie a eu le temps d'atteindre l'objectif, comme dans les femto-photographies de Velten et Raskar. Le concept et les pistes écartées sont dans [docs/concept.md](docs/concept.md), les défis techniques dans [explainer.html](explainer.html).

## Utilisation

```bash
python3 .claude/serve.py 8220 echo    # depuis la racine du dépôt
# puis http://localhost:8220/
```

| Touche | Effet |
| --- | --- |
| N | nouvelle scène (nouvelle graine) |
| Espace | pause / lecture |
| ← → | avancer ou reculer d'un pas |
| H | masquer l'interface |
| F | plein écran |

Sur écran tactile : une touche met en pause, deux touches tirent une nouvelle scène, un appui long masque l'interface.

| Paramètre d'URL | Effet |
| --- | --- |
| `?seed=…` | la scène (une graine = une scène) |
| `#r=…` | une scène retouchée, partagée par « Copier le lien » |
| `?mobile=1` / `?mobile=0` | version allégée imposée / interdite |
| `?ui=0` | sans panneau |
| `?debug` | outils dans `window.echo` (`shot`, `send`, `sheet`, `film`, `meter`, `poster`, `bench`, `seam`…) |

Le panneau règle l'humeur, le réflecteur, la durée de la boucle, la caméra (champ, distance, azimut, hauteur, glissement, avancée), la lampe (forme de l'ampoule, couleur et intensité de l'éclair, douille), le cadre du miroir, la couleur et la surface de chaque vase, les murs, le sol, la table et la fenêtre hors champ. Puis le rendu (qualité, ombres, image, bloom et objectif, occlusion et reflets). L'export produit une boucle MP4 rendue image par image, éventuellement accumulée (8 à 64 passes), et une image PNG.

## Principe

### Le front

`src/film.js` donne la convention de temps. La vitesse du film v(u) vaut 1 en temps réel et 1/K au ralenti ; elle passe de l'une à l'autre par des rampes douces sur log v. Le temps physique est τ(u) = T ∫₀ᵘ v, tabulé en double précision (32 768 pas). Le rayon du front est la longueur de chemin parcourue par la lumière depuis qu'elle a quitté le tube :

```
ρ(u) = c · (τ(u) − τ_éclair)        borné à [−1, 60] m pour les flottants du GPU
```

Un point x reçoit la lumière d'un chemin de longueur L(x) (de la lampe à x, directement ou par un réflecteur). La caméra la voit quand elle a aussi parcouru le chemin du point à l'objectif. L'éclair est une impulsion : sa lumière monte sur 2 cm de chemin puis décroît sur 22 cm, si bien que chaque point la voit passer en anneau.

```
g = S(a) · 4 · e^(−a / 0,22 m)        a = ρ − L(x) − |x − œil|, S : rampe de 2 cm
```

Une impulsion plutôt qu'une lampe qui reste allumée : un front qui ne fait qu'allumer se lit comme un disque qui grandit, et l'écho comme un peu plus de lumière. Avec une impulsion, ce qui part et ce qui revient sont deux anneaux distincts.

| u | Temps | Convention |
| --- | --- | --- |
| 0 – 0,10 | nuit ; le voyant de charge rougit puis s'allume | temps réel |
| 0,10 – 0,14 | le film ralentit | rampe |
| 0,14 – 0,86 | l'éclair : l'anneau direct, l'écho de la glace, les échos suivants | ralenti |
| 0,86 – 0,90 | le temps réel revient | rampe |
| 0,90 – 1 | nuit ; le voyant, éteint par l'éclair, recommence à rougir | temps réel |

Le ralenti est variable, comme une rampe de vitesse au montage. `frontRange` dresse la liste des fenêtres où il se passe quelque chose dans le cadre : la lumière directe et le premier écho sur la nature morte, la table et le réflecteur ; puis, dans la galerie, chaque éclair qui reparaît au fond de la glace (|qₙ − œil|, de 0,6 m avant à 0,9 m après). Dans les fenêtres, le front avance à 0,55 m par seconde de film ; entre elles, quand la lumière file vers la glace d'en face, hors du champ, le film va six fois plus vite (`speedFactor`, raccords adoucis sur 35 cm). Le front ne recule jamais. La durée découle de ce chemin pondéré (`weightedSpan`, `durationFor`, bornée à 7 – 16 s) : 7 à 8 s pour les familles à un réflecteur, 10 à 13 s pour la galerie (sur 400 graines). Pendant le ralenti, rien de matériel ne bouge (boule, poussière, charge : ils lisent τ) ; seule la caméra continue de glisser (elle lit u).

### Les échos

`src/gen/optics.js` (pur, testé contre des rayons lancés et réfléchis pas à pas) et sa traduction TSL `src/scene/paths.js`.

| Famille | Réflecteur | Chemin L(x) | Ce qu'on voit |
| --- | --- | --- | --- |
| **Trumeau** | glace au mur, cadre mouluré | \|x − s′\|, s′ symétrique de la lampe, si le segment s′ → x traverse la glace | une seconde sphère sort de la glace et éclaire les revers |
| **Psyché** | glace ovale ou cintrée sur pied, inclinée | idem, la glace orientée sur la bissectrice lampe / œil | idem, de côté ; le reflet de l'ampoule au centre de la glace |
| **Miroir ardent** | grand miroir concave sphérique sur un pied au sol, à côté de la table, dont le centre de courbure est l'ampoule | 2R − \|x − s\| avant de repasser par la lampe, 2R + \|x − s\| après, dans le cône de la calotte | l'écho revient à sa source : une coquille qui se referme sur l'ampoule, la rallume, et ressort de l'autre côté en pinceau |
| **Galerie** | deux grandes glaces parallèles face à face, accrochées aux murs latéraux de part et d'autre de la table, à 1,5 m l'une de l'autre | \|x − qₙ\|, qₙ image de la lampe après n réflexions alternées, si la droite qₙ → x traverse chaque copie dépliée des glaces dans son contour | l'écho revient encore et encore : dans la glace de gauche, les copies de la lampe s'allument l'une après l'autre, chacune plus loin, plus tard et plus faible (0,88ⁿ) |
| **Boule à facettes** | 372 à 614 tesselles planes (14, 16 ou 18 rangées) | \|x − s′ᶠ\|, s′ᶠ image de la lampe dans la facette dont la normale est la bissectrice de (x − B) et (s − B) | des pinceaux et des taches qui arrivent l'une après l'autre |

Chaque écho est une lumière de three.js dont le nœud multiplie la couleur, au point éclairé, par son ouverture et par g (`src/scene/lights.js`) : la glace est un projecteur placé en s′ avec ses ombres ; le foyer et les facettes récrivent la direction et l'atténuation de la lumière (pour le miroir ardent, une source ponctuelle au foyer, la lampe elle-même, dont l'image a la taille du filament : 9 mm au grandissement |f₂M| / |f₁M|, ici 1, plus 4 mm ; un miroir plan par facette). Deux rebonds diffus (la table sous la lampe, le mur au plus près) portent la couleur de leur surface et un chemin |v − s| + |x − v| : dans la Laque, cet écho diffus revient rose.

Dans la galerie, une lumière de plus (`GalleryLight`) somme sept des huit images (quatre réflexions de chaque côté ; la première de la glace de gauche est portée par le projecteur à ombres). Chaque glace voit l'autre, et le reflet de l'autre y est rendu à son tour (`reflector` avec `bounces`, un niveau : la glace qui rend est masquée dans son propre rendu) ; les échos plus profonds (trois réflexions et plus) sont dessinés par leurs images, à leur place, à leur heure (le chemin |qₙ − œil|) et à leur intensité. La caméra est tournée de 10 à 15° vers la glace de gauche, qu'on voit presque de face : c'est là que se lit la file des copies. À 1,5 m l'une de l'autre, les glaces font revenir un écho tous les 3 m de chemin, et la lumière ne quitte presque pas le cadre (une seconde glace derrière la caméra, à 2,9 m, laissait 5 m de chemin hors du champ entre deux échos).

Le reflet n'a besoin de rien de plus. La glace est rendue par `reflector()` depuis la caméra symétrique ; dans ce rendu, `cameraPosition` est cette caméra virtuelle, et |x − œil′| vaut exactement |x − glace| + |glace − œil|. L'ampoule du miroir s'allume donc après la vraie, et s'éteint après elle.

La brume (`src/scene/haze.js`, option `haze` de la chaîne d'image commune) marche le long du rayon de vue (16 pas, 8 en mobile) et ajoute en chaque pas la lumière de chaque source à retard. Elle dessine les coquilles qui avancent : celle de la lampe, celle de la glace, le cône qui se referme, les pinceaux, les échos de la galerie. Elle n'a pas d'ombres.

## Génération

- `src/recipe.js` : graine → recette JSON ; un flux de tirage par famille (`mood`, `family`, `camera`, `light`, `mats`, `objects`, `place`). La durée de la boucle est calculée, pas tirée.
- `src/gen/layout.js` : la mise en place. La table (1,15 à 1,4 m), la lampe (44 à 54 cm au-dessus du plateau), la nature morte (4 à 7 vases en grappe serrée, les plus hauts au fond, sans contact, aucun sous la lampe), le réflecteur. Le trumeau est posé là où la droite œil → ampoule image traverse le mur ; la psyché est orientée sur la bissectrice ; le miroir ardent est une calotte sphérique de 0,78 à 0,95 m de rayon (au moins assez pour dégager le bout de la table), centrée sur l'ampoule, sur un pied à côté de la table. Puis la caméra est ajustée (`fitCamera`) : elle garde son azimut et sa hauteur, vise le centre de ce qui doit être à l'image (l'ampoule et sa douille, chaque vase, le réflecteur entier) et recule juste assez pour tout contenir avec 14 % de marge. Trumeau et caméra dépendent l'un de l'autre : trois allers-retours. Les glaces sont tirées plus souvent (galerie 1,8, trumeau 1,3, psyché 1, boule 0,8, ardent 0,6) : c'est là que l'écho se lit le mieux. Pour la galerie, les deux glaces sont accrochées aux murs latéraux, 14 cm au-delà des bouts de la table, du mur du fond sur 1,35 m au plus (et jusqu'à 60 cm de l'œil), 1,4 m de haut ; la caméra est tournée de 0,18 à 0,26 rad vers la glace de gauche.
- `src/gen/build.js` : la géométrie, dans un worker (35 à 67 ms par scène). Vases tournés à paroi épaisse et lèvre en demi-rond (bouteille, cruche à anse et bec, pot à couvercle et bouton, bol, gobelet, vase, flacon ; bouchon de liège), table à ceinture et pieds tournés, fuselés ou en tréteaux, nappe à ourlet et retombée plissée, lambris à tables saillantes et cimaise, douille tournée et le chaton de son voyant, ampoule de verre opalin (poire, globe, tube, flamme), opaque pour qu'elle se voie dans les glaces (un verre transparent sans écriture de profondeur en disparaissait), illuminée de l'intérieur par l'éclair, glace biseautée et cadre à moulure balayée le long du contour, psyché à montants tournés, patins et pivots, calotte d'ellipsoïde avec dos, bague, fourche et pied lesté, boule à tesselles chanfreinées et chaînette.

## Matériaux

`src/scene/surfaces.js` : douze matières écrites pour la pièce, au pixel, dans le repère du monde, à partir du volume de bruit commun. Lambris et badigeon (peau d'orange), plâtre, laque (vernis), velours (lustre), faïence et tomettes (carreaux bombés, joints en creux), bois (fil, cernes, planches et leurs joints ; sur le plateau, des ronds laissés par des verres et des pots), lin (armure de 420 fils au mètre, fils flammés), marbre (fond nuageux, veines « en crête » 1 − |n| à la puissance 44 et 18, lues à travers une déformation et interrompues), métal (laiton, nickel, argent terni), bakélite. Les cadres s'usent aux moulures saillantes : le bol rouge paraît sous la dorure, le bois sous le noir.

**Céramiques.** Un seul matériau pour tous les vases ; la couleur, la rugosité, l'émail et le centre du vase passent par des attributs. Rides de tournage au pas de 4 à 7 mm, d'amplitude variable ; émail dont l'épaisseur fait la couleur (plus sombre et plus saturé où il s'accumule), qui coule en traînées verticales, s'amasse en bourrelet au-dessus du pied, s'amincit sur la lèvre où la terre transparaît, et s'arrête à 1 cm du sol sur une ligne irrégulière : le pied est en terre nue et mate ; piqûres de fer ; craquelure sur un vase émaillé sur trois (Worley du volume de bruit : le Worley exact sur 27 cellules allongeait la compilation de dizaines de secondes). Les vases mats sont une peinture poudrée à la Morandi, marbrée, aux traces de pinceau horizontales, avec un velouté.

**La glace** est ancienne : le tain s'oxyde par plaques sur le dernier dixième du bord et en piqûres éparses, de la poussière s'est déposée sur le verre. Les deux sont éclairées par les lumières à retard : on voit le front passer sur la glace elle-même, et son reflet arriver ensuite.

## Scène

Sept humeurs, chacune un décor :

| Humeur | Murs, table | Lumière de nuit | Valeur | Cadrage |
| --- | --- | --- | --- | --- |
| **Strandgade** (d'après Hammershøi) | lambris gris perle, chêne ou nappe | fenêtre bleue hors champ | moyenne claire | assis, trois-quarts |
| **Lambris** (d'après Hammershøi) | boiseries vert-de-gris, noyer | crépuscule vert-gris ; ampoule à 3 300 K | moyenne sombre | trois-quarts, plongée |
| **Laque** | laque sang-de-bœuf, guéridon noir | nuit ; l'écho diffus est rose | sombre saturée | bas, assis |
| **Cabinet noir** | velours noir, marbre blanc | presque rien ; ampoule froide | très sombre | assis, trois-quarts |
| **Carrelage** | faïence blanche, zinc ou marbre | aube grise | claire | assis, plongée |
| **Atelier blanc** | plâtre blanc, pin brut | jour pâle ; ampoule à 6 500 K | très claire | trois-quarts, plongée |
| **Bleu de Prusse** | badigeon bleu, pin ou nappe | aube rose de l'autre côté | moyenne | assis, bas |

Huit lumières créées une fois dans un ordre fixe : la fenêtre (ombres), la lampe (ombres), la glace (ombres), le foyer, les facettes, deux rebonds, la galerie. Une famille absente éteint les siennes. La caméra (`cameraAt`) est un plan fixe qui glisse sur un arc (± 1,4 à 2,9°) et avance de 3 à 6 % pendant le ralenti.

## Tests

```bash
node --test 'echo/test/*.test.mjs'    # 19 tests
```

- **Optique** : miroir plan, calotte elliptique et boule à facettes : la longueur de chaque chemin égale celle d'un rayon lancé depuis la lampe et réfléchi sur la vraie surface (1e-9 ; 1e-7 pour 500 rayons sur la calotte, avant et après le foyer), et la loi de la réflexion est vérifiée ; galerie : chaque image est le bout d'un rayon réellement réfléchi entre les deux glaces, avec le bon nombre de réflexions et la même longueur (plus de 500 chemins) ; rien derrière la glace ni hors de son contour ; l'impulsion vaut 0 avant le front, culmine sur l'anneau et décroît ensuite.
- **Film** : raccord à u = 1 (front, charge, temps réel) ; le front ne recule jamais pendant le ralenti et a quitté la scène à sa fin ; le temps réel est figé au ralenti ; la charge est pleine juste avant l'éclair, vide juste après, et ne fait que croître entre deux éclairs ; la durée reste entre 7 et 16 s ; le ralenti variable va six fois plus vite entre les fenêtres, sans que le front recule ; la caméra reste sous 25°/s et 0,8 m/s² à 120 i/s.
- **Recette** (400 graines) : déterminisme et aller-retour JSON ; chaque humeur et chaque famille tirées ; au moins trois vases, aucun contact, tous sur la table, aucun sous la lampe ; pour le trumeau et la psyché, le reflet de l'ampoule est dans la glace vu de l'œil ; le miroir ardent est centré sur l'ampoule, la regarde, reste hors de la table, et son écho revient en 2R ; l'étendue des fronts est cohérente.
- **Construction** : chaque famille construit son réflecteur (les deux glaces et le mur avant de la galerie), sans NaN.

Bancs : `tools/curves.mjs` (les courbes du film), `tools/grid.py` (planches), `tools/art.html` (le dessin du chargement hors du worker).

## Performances mesurées

Portable Apple Silicon, panneau de navigateur intégré, qualité Haute, 1920 × 1080, graine d'ouverture (h3, Strandgade, galerie aux glaces latérales) : 21,4 ms au passage de l'éclair (u = 0,36), onglet en arrière-plan : au-dessus du budget de 16 ms. La galerie est la famille la plus chère : ses deux glaces sont visibles et chacune rend la pièce, puis l'autre glace dans son reflet (quatre rendus de la scène à 55 % de la résolution), et les huit images de la lampe passent dans chaque matériau (1,2 ms) ; la brume marche en 16 pas. Les mesures varient de quelques ms d'une session à l'autre sur la même machine. Les réflexions en espace écran coûtent 1,4 ms, l'occlusion ambiante 1,4 ms. Raccord de boucle : écart de pose 1·10⁻¹⁰ (`seam`). 73 à 84 pipelines compilées sous l'écran de chargement ; avec le cache de shaders du navigateur, la scène est prête en 2 s (panneau visible). Les autres familles n'ont pas été chronométrées une à une.

## Version mobile

`?mobile=1` : brume en 8 pas (16 sur ordinateur), 2 000 grains de poussière au lieu de 4 500, glaces rendues à 70 % de leur définition sur ordinateur (65 % de la résolution pour une glace seule, 55 % dans la galerie), chaîne d'image allégée commune. 4,1 ms par image sur la même machine (u = 0,24), sans erreur. Non vérifiée sur un téléphone réel.
