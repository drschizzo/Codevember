# Bolt

*une tempête dans une tasse de thé*

Une tasse de thé fume sur une table. La vapeur monte, s'étale à une certaine hauteur et s'y accumule en un nuage gros comme deux poings, qui fonce. Il pleut dans la tasse pendant que le nuage se charge. Un traceur en sort, descend par bonds en se ramifiant, et la foudre tombe sur la pointe d'un thermoplongeur pincé au bord de la tasse. Une bourrasque vide le nuage, qui se défait ; la chaleur descend la tige, la résistance rougit sous le thé, qui bout, et la colonne de vapeur suivante part déjà de la tasse. La boucle est parfaite par construction : l'eau partie en vapeur revient en pluie, et le niveau du thé retrouve exactement sa marque.

![Bolt](docs/capture.jpg)

La scène prend une seule liberté, l'échelle : un orage entier tient au-dessus d'une tasse. Tout le reste suit ce qu'on sait de la foudre. Le concept et les pistes écartées sont dans [docs/concept.md](docs/concept.md), les défis techniques dans [explainer.html](explainer.html).

## Utilisation

```bash
python3 .claude/serve.py 8210 bolt    # depuis la racine du dépôt
# puis http://localhost:8210/
```

| Touche | Effet |
| --- | --- |
| N | nouvelle scène (nouvelle graine) |
| Espace | pause / lecture |
| ← → | avancer ou reculer d'un pas |
| H | masquer l'interface |
| F | plein écran |

| Paramètre d'URL | Effet |
| --- | --- |
| `?seed=…` | la scène (une graine = une scène) |
| `#r=…` | une scène retouchée, partagée par « Copier le lien » |
| `?mobile=1` / `?mobile=0` | version allégée imposée / interdite |
| `?ui=0` | sans panneau |
| `?debug` | outils dans `window.bolt` (`shot`, `send`, `sheet`, `go`, `film`, `meter`, `poster`, `bench`, `seam`…) |
| `?sink=8123` | port du collecteur d'images (`tools/sink.py`) |

Le panneau règle tout ce que tire la recette : humeur, famille et forme du récipient, matières, nuage, éclair (η, pointes actives, tremblé, instants et intensités des arcs), caméra, lumière. Les retouches qui changent la géométrie ou l'arbre de l'éclair relancent le calcul sous l'écran de chargement.

## Principe

### Le film

Une seule horloge, `src/film.js`. Tout ce que montre la boucle se lit dans `stateAt(film, u)` en fonction de la phase u ∈ [0, 1).

| u | Temps | Convention |
| --- | --- | --- |
| 0,80 – 0,30 | il pleut (à travers le raccord de la boucle) : le nuage rend 70 % de son eau à la tasse et fonce en se chargeant, mais reste plein et formé jusqu'à l'éclair | temps réel |
| 0,27 – 0,38 | des lueurs traversent le nuage | accéléré |
| 0,385 – 0,50 | le traceur descend en neuf bonds de plus en plus rapides, hésite à 86 % de sa course (l'aigrette monte), puis saute | caméra rapide |
| 0,50 | la jonction : l'arc en retour, l'image brûlée, les étincelles | |
| 0,51 – 0,60 | la bourrasque qui suit l'éclair rend le reste de l'eau et grésille sur le métal chaud ; le nuage vidé se défait en lambeaux (jusqu'à 0,65) ; réamorçages, canal en perles | ralenti léger |
| 0,52 – 0,76 | la chaleur a atteint la résistance (0,5 s) : le thé bout, lâche une bouffée, et la vapeur monte, s'étale et forme le nuage suivant ; vers 0,7 le thé cesse de bouillir, le dernier souffle monte rejoindre le nuage et la colonne disparaît | accéléré ; simulation relue |

Le traceur occupe 2,8 s d'une boucle de 24 s. Le film d'une graine fait 3 à 5 arcs (un par pierre, 2 à 4, pour le fourchu).

Le scénario de la boucle tient en une phrase : la foudre chauffe la machine, la machine fait bouillir le thé, le thé fait la vapeur, la vapeur fait le nuage, le nuage pleut et fait la foudre. Chaque maillon se voit. La pluie tombe avant l'éclair, comme dans un orage, où ce sont les précipitations qui séparent les charges ; une bourrasque le suit (le « rain gush » des orages) et vide le nuage. `heatAt` donne la chaleur laissée par l'arc : elle est à 0,94 quand la vapeur repart, une demi-seconde après la jonction, et s'annule exactement avant la foudre suivante. Le bouillon du choc est le départ de la simulation (une impulsion de chaleur et de traceur à la source), et la vapeur, du thé au nuage, n'est qu'une seule matière.

### Les machines

Ce que la foudre touche a un rôle. Chaque récipient a sa machine à chauffer le thé (`src/gen/vessels.js`) :

| Machine | Récipient | Ce qu'on voit |
| --- | --- | --- |
| **thermoplongeur à paratonnerre** | tasse, verre | un mât à boule de laiton pincé sur la lèvre, une jambe le long de la paroi, une résistance en hélice dans le thé ; son anneau rouge se lit à travers le liquide |
| **réchaud à spirale** | théière boule | un tambour bas sur trois pieds, une spirale d'Archimède au fond, un bras et un mât à côté de la panse ; la spirale éclaire la table |
| **brasero** | tetsubin | une vasque de fonte, un lit de cendre, 34 braises, un trépied ; la foudre tombe sur l'arceau |
| **pierres chaudes** | bol | deux à quatre galets posés au fond, qui dépassent du thé ; un arc par pierre |

Chaque sommet de la machine porte sa place sur le chemin de la chaleur (attribut `heat` : s, nature, grain) : s = 0 à la pointe, 1 au bout de la résistance. Le shader en tire l'émission : le front de chaleur atteint le sommet à `s × 0,85 s` ; le métal mince rougit au passage et refroidit en 0,6 s, la résistance, les braises et les pierres gardent la chaleur du film.

### La boucle

L'eau se conserve. Le cycle de l'eau commence à u = 0,52 (`TIMES.cycle`), quand la vapeur repart ; les courbes se lisent dans la phase du cycle `w`, qui court sur un peu plus d'une boucle : la bourrasque et la fin du nuage d'un cycle tombent pendant que la colonne du suivant monte. Un état est donc la somme du cycle en cours (`w = v = (u − 0,52) mod 1`) et du précédent (`w = v + 1`). Si `up(w)` est l'eau montée (vapeur et nuage), `out(w)` l'eau partie en pluie (70 % avant l'éclair, le reste dans la bourrasque) et `landed(w)` l'eau arrivée dans la tasse (la même courbe que `out`, retardée du temps de chute, 0,42 s), alors, pour chaque cycle,

```
nuage = up − out        pluie en vol = out − landed        niveau du thé = −(nuage + pluie en vol)
```

Les courbes sont des « smootherstep ». Au-delà de w ≈ 1,1, toute l'eau montée par un cycle est retombée : il ne compte plus. Le raccord du film (u = 0) tombe sous la pluie : les gouttes, les ronds sur le thé et le bouillon font chacun un nombre entier de cycles par boucle, et rien ne distingue u = 0 de u = 1.

L'image passe avant la physique : sous la pluie, le nuage rend son eau à la tasse (le niveau du thé le dit) mais ne s'effiloche qu'à peine (à 0,35, l'éclair frappait un nuage réduit à quelques flocons) ; il fonce franchement en se chargeant, ne se défait qu'après l'arc, et son cœur a un plancher de densité (vu d'en haut quand la caméra s'approche, la nappe mince était percée de trous).

Le champ simulé est lu deux fois par le rendu, aux mêmes coordonnées et avec le même bruit : à l'instant du cycle en cours (`sim`, avec sa visibilité `vis`), et sur sa dernière image pour le cycle précédent (`visOld`). Quand la colonne repart, la lecture en cours devient la lecture « précédente » sans changer de valeur, puis son enveloppe baisse et l'érosion la ronge par lambeaux. Le nuage qui se défait et la vapeur qui monte sont une seule matière à deux âges. La dérive du bruit du nuage et la montée de la vapeur font un nombre entier de périodes par boucle. L'arbre de l'éclair est calculé une fois, sa lecture ne dépend que de l'avancement du traceur `a(u)` et du temps `τ(u)` écoulé depuis la jonction.

### L'horloge lente

Le traceur est filmé à la caméra rapide : pendant ce temps, la vapeur et les bourgeons du nuage, qui bougent à l'échelle de la seconde, doivent être presque arrêtés. Ils ne lisent pas la phase u mais `clockAt(u)`, une horloge dont la vitesse vaut `1 − 0,94·B(u)`, où B passe de 0 à 1 à l'entrée du traceur et revient à 0 à la jonction. Son intégrale est en forme fermée et ramenée à 1 sur la boucle. Pendant tout le traceur, la vapeur ne monte que de 1 % d'un tour, à 6 % de sa vitesse normale.

### L'éclair

`src/gen/dbm.js` : le modèle de claquage diélectrique de Niemeyer, Pietronero et Wiesmann (1984), dans la forme rapide de Kim, Sweeney, Shelley et Lin (2007). La décharge est un agrégat de sites d'un réseau cubique. À chaque pas, un site candidat (un voisin de l'agrégat) est tiré avec la probabilité

```
p_i ∝ Φ_i^η        Φ_i = (1 − β)·n(φ_i) + β·n(g_i)        φ_i = Σ_j (1 − R / r_ij)
```

φ est le potentiel que l'agrégat impose au candidat (R : une demi-maille) ; il repousse la croissance loin de ce qui existe déjà, ce qui fait les branches. g est l'attracteur : la distance à la pointe visée, où l'écart horizontal pèse de plus en plus à mesure que le traceur descend (un entonnoir). n(·) ramène chaque potentiel sur [0, 1] parmi les candidats. η va de 2,4 (touffu) à 4,2 (filiforme), β vaut 0,42 à 0,5. Trois règles donnent l'allure d'un traceur plutôt que d'un agrégat : seules les pointes nées dans les 26 à 40 derniers sites poussent ; un traceur ne rebrousse pas chemin (jamais vers le haut s'il descend) ; il ne fait pas plus de deux pas horizontaux d'affilée. Les sites sont décalés par un hachage et chaque arête est subdivisée en trois avec un tremblé de 10 à 17 % de sa longueur.

Quatre familles, une par famille de récipient :

| Éclair | Récipient | Mouvement |
| --- | --- | --- |
| **coup au but** | tasse | un arbre renversé descend de la base du nuage ; une aigrette monte de la pointe du mât ; un seul canal |
| **ascendant** | théière | l'arbre pousse vers le haut depuis la pointe du mât (ou l'arceau du tetsubin) et s'épanouit sous le nuage ; tout l'arbre s'allume |
| **araignée** | verre à thé | la décharge rampe d'abord à l'horizontale dans la base du nuage (130 sites), puis un fil tombe sur le mât |
| **fourchu** | bol | le traceur vise une pierre ; chaque arc suivant emprunte la branche la plus proche d'une autre pierre (1 à 3), prolongée jusqu'à elle par son traceur de réamorçage |

Chaque nœud de l'arbre porte son instant de naissance `tb` (en avancement du traceur : 1 à la jonction), sa distance au sol `s` le long du canal, le masque des arcs dont il fait partie et sa grosseur. `src/scene/lightning.js` en tire la luminosité de chaque segment dans le vertex shader : pointe blanche du traceur qui s'éteint en quelques bonds (elle se rallume à chaque bond), onde de l'arc en retour qui atteint le segment à `t_j + s / v` (v = 11 unités par seconde de film), traceur de réamorçage qui redescend le canal en 0,07 s, branches qui meurent en 0,09 s, rémanence en perles. Le trait a trois couches : un cœur très fin, une gaine violette en exponentielle, une lueur d'air large et faible. Un profil gaussien large saturait en un boudin blanc ; c'est le halo de la chaîne d'image qui dit l'éclat, pas la largeur du trait.

Le choc se lit ailleurs que sur le canal : l'exposition monte de 85 % le temps d'une impulsion puis l'iris se referme de 30 % et se rouvre en une seconde (`expo`) ; le mur, que les lampes n'atteignent pas, prend la couleur de l'éclair ; des étincelles balistiques partent du point touché à chaque arc ; des gouttes jaillissent du thé quand la chaleur atteint la résistance ; le pied de la caméra reçoit un à-coup amorti en un quart de seconde.

### La vapeur et le nuage : un seul fluide simulé

`src/gen/plume.js`. La vapeur et le nuage ne sont pas deux objets : c'est le même traceur, transporté par un écoulement simulé. Un panache chaud axisymétrique (équations de Boussinesq, coordonnées (r, z)) monte de la surface du thé dans un air en deux couches, neutre jusqu'au niveau de condensation (z = 1), stablement stratifié au-dessus (Γ = 22), sous un plafond fermé.

```
∂u/∂t + (u·∇)u = −∇p + b ẑ      ∇·u = 0
∂b/∂t + (u·∇)b = −Γ(z) w         (b : flottabilité)
∂s/∂t + (u·∇)s = 0               (s : la vapeur condensée, ce qu'on voit)
```

Un air chauffé à b s'arrête là où l'air ambiant a sa densité, vers z ≈ 1 + b/Γ. La source chauffe de plus en plus fort (de 0,3 à 2,15 fois sa valeur de base) et bat par bouffées (6 à 10) : les premières s'étalent à la base du nuage, les suivantes plus haut, les dernières sous le plafond. Le nuage est la vapeur accumulée. La source s'éteint aux 70 % de la simulation (`steamSource`, partagée avec la scène : le bouillon du thé cesse avec elle) ; la turbulence qu'elle entretenait retombe alors (mélange et courants amortis), si bien que le nuage formé cesse de s'étaler et de se diluer, et le dernier souffle de la colonne monte le rejoindre. Une colonne qui montait jusqu'au bout donnait l'impression de remplir un nuage déjà formé. Le remplissage occupe 24 % de la boucle (43 % au départ), et la caméra, qui suit la colonne, remonte vers le nuage entre 0,58 et 0,76. À l'enregistrement, au-dessus de la base du nuage, le cœur prend au moins la valeur de l'anneau voisin (le panache coupé finit en tore).

Le schéma est celui de Stam (« stable fluids ») : advection semi-lagrangienne, projection par 36 passes de Gauss-Seidel sur le laplacien cylindrique, et un mélange turbulent (viscosité de tourbillon, 0,2) sans lequel le jet reste laminaire et perce le plafond. La grille fait 64 × 56 à 88 cellules de 0,025 ; 576 pas, enregistrés en 192 images de 8 bits (la racine carrée du traceur). Le calcul prend 1,3 à 1,6 s dans un worker, sous l'écran de chargement.

`src/scene/cloud.js` relit ces images dans une texture 3D (r, z, temps) ; l'interpolation trilinéaire fait l'interpolation dans le temps. Le champ simulé, lisse et axisymétrique, n'est que la **couverture** d'un rendu de nuages temps réel à la manière des moteurs de jeu (Schneider, *The real-time volumetric cloudscapes of Horizon Zero Dawn*, 2015 ; Hillaire, *Physically based sky, atmosphere and cloud rendering in Frostbite*, 2016). Le plan du nuage est lobé (trois harmoniques de l'azimut), son sommet bourgeonne, son cœur lit la couronne et la colonne serpente ; le plafond simulé est lu à travers un toit en dôme (un couvercle plat faisait une dalle), et le cœur du panache s'efface sous ce toit (il perçait le sommet en cheminée).

- **Deux volumes de bruit dédiés** (`src/gen/cloudnoise.js`, calculés une fois par page dans le pool, en parallèle du bruit commun) : une *forme* de 64³ (Perlin-Worley et trois Worley fractals) et un *détail* de 32³ (trois Worley fractals). Le détail fait 128 Ko et tient dans le cache : il se lit à haute fréquence sans coût, alors qu'une lecture fine du volume commun (128³ en demi-flottants) coûtait 6 à 8 ms par image.
- **Densité** : la forme est remappée par la couverture (le bruit découpe d'autant plus que la couverture est faible : des bourgeons au bord, plein au cœur), puis le détail ronge la peau — en mèches à la base et dans la colonne (où il est étiré dans le sens de la montée), en volutes arrondies au sommet — à travers une déformation lente. Un contraste final rend la peau nette : le passage de l'air au nuage tient en quelques centimètres. La colonne garde un gain de densité plus faible : un voile, pas un tuyau.
- **Lumière** : un cône de six prélèvements vers la lampe (profondeur optique), trois octaves de diffusion multiple (chacune moins éteinte, moins anisotrope, plus faible : le cœur reste gris), une phase de Henyey-Greenstein à deux lobes (le liseré à contre-jour), la « poudre » de Beer calculée sur la profondeur vers la lampe (bords de bourgeons sombres, creux clairs, sauf à contre-jour), et une ambiance qui vient d'en haut, atténuée par le nuage au-dessus et autour de soi (les creux entre bourgeons s'assombrissent : c'est ce qui modèle un nuage vu dans son ombre). Les prélèvements sont à distance tramée : à pas fixes, l'ombre dessinait les courbes de niveau du champ.
- **Marche adaptative** : grands pas dans l'air, petits pas (la boîte / 72) dans le nuage, avec un retour d'un grand pas à l'entrée pour ne pas sauter la peau. À pas fixes, un milieu à peau nette se lisait en tranches parallèles.
- Six sources ponctuelles à l'intérieur : le canal de l'éclair et les lueurs de la charge.
- **Une seule matière de la tasse au sommet** : la vapeur est faite des mêmes bourgeons que le nuage (des bouffées arrondies, un peu de mèches) ; seule la densité change, progressivement sur toute la hauteur (gain de 1,5 à 4 entre 0,35 et 1,15 de la montée, condensation sur la même rampe). Une colonne en mèches sous un nuage en bourgeons, ou une frontière nette au niveau de condensation, se lisaient comme deux objets (une boule de coton sur un bâton). La lecture du champ est tramée d'environ une cellule à chaque image : l'interpolation linéaire d'une grille de 88 cellules, passée dans le contraste d'une peau nette, dessinait une crête par cellule (des bandes en pas de vis dans la colonne) ; l'anticrénelage temporel moyenne ce tramage. La marche est plus fine dans la colonne (la boîte / 44), et le recul d'entrée de la marche adaptative s'arrête au bord de la boîte (sinon une tranche comptée deux fois tirait une ligne à la couture des deux domaines).
- **Cadence d'enregistrement** : 192 images de la simulation au lieu de 72 (même calcul, une image tous les 3 pas). L'interpolation temporelle fondait une image dans la suivante ; invisible sur une peau molle, ce fondu « sautait » à la cadence des images sur une peau nette.

**Raccord** : un nœud TSL est émis à sa première lecture, dans la portée de cette lecture. Les coordonnées du champ, lues d'abord dans la branche de l'ancien nuage (`If(visOld > 0)`), changeaient de valeur quand cette branche cessait d'être prise : tout le nuage sautait à u = 0,65 et au passage du raccord. Elles sont désormais des variables posées avant toute branche. Les dérives de bruit font toutes un nombre entier de tuiles par boucle, et le bouillon du thé un nombre entier de battements.

Pour une théière, la source est au bec : l'axe du panache va du bec à l'aplomb du nuage.

## Génération

- `src/recipe.js` : graine → recette JSON. Un flux de hasard par famille de tirages (`vessel`, `accord`, `camera`, `light`, `bolt`, `cloud`, `film`). `layout(R, meta)` place le nuage, la racine et la cible de l'éclair à partir de ce que le récipient construit dit de lui (son point le plus haut, la surface du thé, ses obstacles).
- `src/gen/vessels.js` : dix variantes en quatre familles, chacune avec sa machine. **Tasse** (tulipe, litron, à pied) avec soucoupe, **théière** (boule, tetsubin), **verre à thé** (droit, évasé), **bol** (chawan, à pied, assiette creuse). Un profil externe en Catmull-Rom, une paroi d'épaisseur constante, une lèvre roulée, un pied annulaire ; puis les pièces rapportées, balayées le long d'une courbe de Bézier. L'anse est un ruban (plus large qu'épais) qui s'évase en collerette à chaque attache, comme une patte écrasée à la barbotine : elle quitte la paroi le long de sa normale et s'y raccorde par un congé, au fond d'une gorge s'il y a des godrons. Le bec naît de la panse de la même façon. Les godrons (16 à 32) sont des lobes bombés séparés par des gorges à arête vive (profil |sin|^0,85, douze sommets par lobe, normales prises sur le maillage) ; ils meurent sous un jonc en relief, et la face interne les suit pour que la paroi garde son épaisseur. La soucoupe a un pied, un fond plat, un bassin courbe, une aile et un bord roulé (1,6 cm de haut pour 16 cm). La tasse à pied a un piédouche de 12 % de sa hauteur.
- `src/gen/worker.js` : récipient, éclair, panache et volume de bruit sont calculés dans un worker. Un éclair demande 2 à 30 ms pour 80 à 440 sites (moyennes mesurées sur 300 graines : coup au but 119 sites, ascendant 300, araignée 238, fourchu 83).

## Matériaux

Les matières viennent du catalogue commun (`shared/finishes.js`), retouchées dans `recipe.js`. Chaque humeur a trois ou quatre accords composés à la main `[récipient, métal, support, thé]`, filtrés selon la variante (un verre est en verre, un tetsubin en fonte).

- **Machines** : le métal de l'accord (argent, vermeil, inox, fonte) pour le mât, le réchaud et le brasero ; galet gris et charbon pour ce qui rougit.
- **Récipients** : porcelaine à filet d'or ou de platine (la lèvre est le rôle « tranche »), biscuit, céladon craquelé, tenmoku, bleu céleste, tôle émaillée, céramique noire, fonte, laque vermillon, verre.
- **Métal** : argent, vermeil, inox, fonte.
- **Supports** : sept matières écrites pour eux dans `src/scene/table.js`, dans le repère du monde, chacune avec un relief à plusieurs échelles. **Lin** : armure toile de 2,5 fils au millimètre, fils irréguliers à deux grosseurs (les « flammes », visibles de loin), plis de repassage, ondulations d'une nappe posée. **Velours** : poil couché par endroits, qui change le lustre. **Marbre** (blanc ou noir) : nuages de fond, veines en bruit « en crête » (1 − |n| à la puissance 34 à 60 ; plus larges, on les prenait pour de la fumée sous le nuage) lu à travers une déformation, interrompues par un masque. **Zinc** : oxydation en plaques, brossage, rayures courtes, ronds de verre. **Laque** (rouge ou noire) : peau d'orange, traces de polissage, poussières d'or. **Natte** : joncs de 1,1 mm pincés tous les 15 mm, pincement alterné. **Ardoise** : feuillets en marches, mica. Le volume de bruit commun est périodique (4 cellules) : chaque fil, jonc ou trait de brosse le lit à un décalage tiré de son rang, sinon le motif se répète tous les quatre fils. Chaque détail s'efface avant la fréquence du pixel. La table n'évalue que la lampe et l'éclair, et se relève en gorge loin derrière pour se fondre dans le mur par la brume : pas d'horizon.
- **Thé** : une surface qui ride (`liquidMaterial` dans `src/scene/stage.js`) : un anneau part de chaque impact d'arc à 0,55 unité par seconde, la pluie fait ses ronds sur une grille de cellules, le thé bout autour de la résistance, et ce qui rougit sous lui (l'hélice, les pierres) l'éclaire de l'intérieur.

## Scène

Sept humeurs, chacune un décor :

| Humeur | Support, mur | Lumière | Valeur | Cadrage |
| --- | --- | --- | --- | --- |
| **Cinq heures** | lin, mur gris-bleu | fenêtre de côté, ciel couvert | claire | de face, plongée de 20° |
| **Plaque sensible** | velours noir, pas de mur | contre-jour seul ; noir et blanc, d'après les *Lightning Fields* de Sugimoto | très sombre | frontal, plongée de 17° |
| **Comptoir** | zinc | plafonnier | moyenne | plongée |
| **Céladon** | natte tressée | zénithale diffuse, brouillard | très claire | trois-quarts |
| **Laque** | plateau de laque rouge, mur noir | latérale rasante | sombre | large, plongée de 18° |
| **Heure bleue** | marbre, mur de crépuscule | lueur de ciel froide | moyenne-sombre | frontal, plongée de 19° |
| **Sèvres** | marbre blanc, mur rose | boîte à lumière haute | haute | trois-quarts |

Trois lumières, créées une fois : la lampe de l'humeur (ombres), son contre-jour, et l'éclair. La lueur de la machine n'est pas une lumière (une quatrième coûtait 2 ms sur la table plein écran) : le métal émet, le thé s'éclaire dans son propre shader, et la table évalue à la main la lueur du réchaud, une source ponctuelle sans ombre. L'éclair est un projecteur à ombres placé sur le canal, au tiers bas, toujours au-dessus du récipient : c'est lui qui jette l'ombre de la tasse sur la nappe à la jonction. Sa position est la moyenne des canaux pondérée par leurs impulsions, elle glisse d'un arc à l'autre sans sauter.

La caméra est sur pied (`cameraAt`) et plonge assez pour qu'on voie la surface du thé, où la suite se joue. Elle s'approche de 5 à 9 % pendant la charge et le traceur ; après la jonction elle descend vers la machine (10 à 14 % plus près, la cible abaissée), où la vapeur repart, puis recule pour la suivre jusqu'au nuage, avec un balancement d'une période par boucle.

Deux pièges de three.js rencontrés ici : dans une passe plein écran, `cameraPosition` et `cameraWorldMatrix` désignent la caméra du quad, pas celle de la scène (elle est passée par des uniformes) ; et `getViewPosition` suppose une profondeur OpenGL, ce qui sous-estime la distance de moitié en WebGPU. `src/render/post.js` est une variante locale de la chaîne commune, d'une ligne : la brume reçoit la couleur de la scène et rend la couleur vue à travers le nuage, qui absorbe autant qu'il diffuse.

## Tests

```bash
node --test 'bolt/test/*.test.mjs'    # 34 tests
```

- **Panache** : déterministe ; la tête ne redescend pas pendant la montée et atteint la base en moins d'un tiers du film ; la masse au-dessus du niveau de condensation ne fait que croître et pèse à la fin plus de six fois la colonne ; la colonne a disparu aux 82 % de la simulation, et le nuage garde plus de 85 % de sa masse après l'arrêt de la source.
- **Film** : l'état à u = 1 est l'état à u = 0 ; nuage + pluie en vol + thé = 0 à 1e-12 près sur 2 400 instants ; la colonne ne fait que monter et le nuage précédent que se défaire ; il pleut avant la foudre et dans la bourrasque, jamais pendant le ralenti du traceur, et le nuage frappé tient encore 30 % de son eau ; l'impulsion d'un arc culmine en quelques millisecondes et s'éteint en deux secondes ; la caméra reste sous 25°/s et 1,5 u/s² à 120 i/s ; l'horloge lente ne recule jamais, fait un tour par boucle et reste sous 8 % de sa vitesse normale pendant le traceur ; la relecture du panache ne saute qu'au passage d'un cycle à l'autre, où la lecture en cours devient la précédente sans changer de valeur (4 800 instants) ; la vapeur repart quand la chaleur a atteint la machine, et la chaleur est retombée avant l'arc suivant.
- **Éclair** (80 graines) : un arbre à une racine ; l'écart entre le traceur et l'aigrette est nul à la jonction et positif juste avant ; l'arc touche la vraie géométrie (la pointe du mât, l'arceau, une pierre du bol — jamais deux arcs sur la même pierre) ; aucun point des segments dessinés n'est dans le récipient ni sous la table ; sur un canal, la naissance suit le sens de la marche.
- **Récipients** : ni NaN, ni triangle dégénéré, ni normale non unitaire ; chaque récipient est fait de plusieurs pièces ; chaque récipient a sa machine et la pointe est le point le plus haut ; le chemin de la chaleur part de la pointe (s = 0) et finit dans ce qui rougit, sans passer par le corps du récipient ; tous les sommets de la résistance sont dans le thé, hors de la paroi et au-dessus du fond ; chaque pierre dépasse du thé et tient dans le bol ; le thé est sous la lèvre ; les attaches de l'anse sont dans la paroi et l'anse reste à plus de 1,5 mm de la soucoupe.
- **Recette** : déterminisme, JSON pur, chaque humeur, famille et variante tirée sur 400 graines, humeur et famille imposables, matière compatible avec la variante, accords d'au moins trois familles de matières ; l'or reste un accent (jamais le corps du récipient) ; pas deux humeurs avec le même support, le même studio et la même valeur de mur.

Bancs : `tools/try.mjs` (recette → récipient → éclair sur N graines), `tools/bolt-view.mjs`, `tools/vessel-view.mjs` et `tools/plume-view.mjs` (planches de contrôle avec PIL).

## Performances mesurées

Passe « nuages temps réel » (16 novembre), même machine, 1920 × 1080, mesurée dans la même session que la version d'avant : scène d'ouverture 9,9 à 11,8 ms (18,6 à 19,6 ms avant), Plaque sensible 11,7 à 13,3 ms, Laque (le plus grand nuage à l'écran) 12,2 à 15,3 ms. Version mobile : 2,6 ms à 1280 × 720. Le gain vient de ce que le nuage ne lit presque plus le grand volume de bruit commun.

Sur un portable Apple Silicon, panneau de navigateur intégré, qualité Haute, 1920 × 1080 (2 Mpx), à l'instant de l'arc (mesures du 13 novembre) : 11,8 ms (Comptoir, tetsubin), 12,2 ms (Cinq heures, tasse), 13,3 ms (Sèvres, tasse), 14,6 ms (Laque, théière), 15,5 ms (Céladon, bol), 17,0 ms (Plaque sensible, bol). La scène d'ouverture, Heure bleue sur marbre noir, est la plus chère : 18,3 à 20,9 ms sur la boucle depuis les filaments et la turbulence de la colonne (environ 3 ms de plus, mesuré le 14 novembre). La caméra plongeante agrandit le nuage et la table réfléchissante à l'écran. Ne lire le bruit que dans l'enveloppe (un branchement dans la marche) fait gagner 3 à 6 ms malgré la divergence ; l'octave fine des bourgeons reste à sa fréquence, car plus haute elle sature le cache de la texture 3D. Raccord de boucle : écart de pose 1·10⁻⁹ (`seam`). Aucune erreur de pipeline sur neuf scènes.

## Version mobile

`?mobile=1` : nuage en 14 pas sans prélèvement vers la lampe, colonne en 6 pas, 90 gouttes au lieu de 420, une seule échelle de ronds de pluie, carte d'ombre de l'éclair en 1 024, chaîne d'image allégée commune. 5,2 ms par image à 1280 × 720 sur la même machine. Non vérifié sur un téléphone réel.
