# Labyrinth — concept

Document de travail : le thème « labyrinth » exploré en largeur, les clichés écartés, les pistes notées, puis la piste retenue et ses épreuves.

## a. Le thème en largeur

**Physique et science**
- Les labyrinthes parfaits sont des **arbres couvrants** de la grille des cellules : un seul chemin entre deux cellules, aucune boucle. L'algorithme de **Wilson** (marches aléatoires à boucles effacées) tire un arbre couvrant *uniforme* ; Aldous-Broder aussi, plus lentement ; le retour arrière en profondeur donne de longs couloirs, Kruskal et Prim des culs-de-sac courts.
- Résoudre un labyrinthe : parcours en largeur (un front qui se divise à chaque carrefour, meurt dans chaque impasse), main droite au mur, algorithme de Trémaux (marquer les couloirs parcourus).
- Les labyrinthes de la nature : domaines labyrinthiques d'un film de grenat magnétique, instabilité labyrinthique d'un ferrofluide en cellule de Hele-Shaw, rayures de Turing (Swift-Hohenberg), coraux cerveaux (méandroïdes), végétation tigrée des zones arides, démouillage d'un film mince.
- *Physarum polycephalum* résout un labyrinthe (Nakagaki, 2000) : il remplit tout, puis se rétracte sur le plus court chemin entre deux sources de nourriture (modèle de Tero, 2007).
- Une bille qui roule sans glisser sur un plan incliné accélère de (5/7)·g·sin θ ; contre une paroi, elle rebondit avec une restitution de 0,3 à 0,5 (bois, laiton).
- Un disque vertical qui tourne garde sa bille en bas : la bille roule *par rapport au disque* ; une noria (roue à godets) soulève les billes en les portant dans une poche.
- Le labyrinthe de l'oreille interne (canaux semi-circulaires : la gravité et la rotation lues par un fluide).
- Les labyrinthes « à gravité » : on ne déplace pas la bille, on fait tourner le plan ; l'état est la cellule où la bille s'arrête, le graphe des états se cherche en largeur.

**Métiers et objets**
- Le jeu de labyrinthe à bascule (plateau de bois sur cardan, deux molettes, bille d'acier), connu depuis le XIXᵉ siècle ; les boîtes à énigme à labyrinthe cylindrique ; les « roues labyrinthes » de bois à disque vertical.
- Les automates de Jaquet-Droz : un programme gravé sur des cames, lu par des palpeurs.
- Marqueterie (noyer, érable, filets de laiton), marbre de Carrare creusé (labyrinthes « à doigt » des cathédrales en pierre), laque urushi, céramique céladon craquelée, ardoise, béton banché.
- Labyrinthes de pavement : Chartres (onze circuits), mosaïques romaines, labyrinthes de gazon (turf mazes), labyrinthes de buis.
- Les robots qui résolvent un labyrinthe à bascule (deux servomoteurs, une caméra) : bielles et manivelles sous le plateau.

**Histoire de l'art, photographie, cinéma**
- Dédale et le Minotaure, le fil d'Ariane ; Borges (*Le jardin aux sentiers qui bifurquent*) ; Piranèse (*Prisons*) ; Escher (*Relativité*) ; le labyrinthe de buis enneigé de *Shining* ; *House of Leaves* ; le labyrinthe de *Pan*.
- La photographie de jouets anciens : gros plan rasant sur une bille d'acier qui reflète la pièce.

**Vocabulaire**
- dédale, méandre, circonvolution, impasse, carrefour, unicursal / multicursal, fil d'Ariane, grecque, entrelacs, sente, chicane, noria, palpeur, bielle, cardan, rigole, gorge, ressaut, butée.

**Cycles et transformations**
- La bille entre, se perd dans une impasse, revient, trouve la sortie, tombe dans la rigole qui la ramène au départ : une boucle naturelle, comme le jeu qu'on recommence.
- La noria : la bille sortie est remontée et rendue à l'entrée.
- Physarum : exploration puis rétraction, puis nouvelle exploration quand la nourriture change de place.
- Ferrofluide : une goutte ronde qui s'ouvre en labyrinthe sous le champ et se referme quand il tombe.

**La lumière**
- Une bille polie est un miroir sphérique : elle montre toute la pièce, la lampe, le plateau.
- Les parois des couloirs portent des ombres en peigne sous une lumière rasante : le labyrinthe se dessine par ses ombres.
- Le marbre blanc creusé : la lumière diffuse dans la pierre, les gorges s'adoucissent.
- La laque : des reflets profonds et nets ; le céladon : un vernis épais, craquelé, translucide.

## b. Les clichés

1. Le labyrinthe vu de dessus, résolu par un trait qui avance (une démo d'algorithme).
2. La course à la première personne dans des couloirs (de pierre, de buis).
3. Le labyrinthe de buis du film d'horreur, le Minotaure.
4. Les escaliers impossibles d'Escher.
5. Le labyrinthe de Chartres dessiné au sol, parcouru par une lumière.

Le premier peut devenir un temps du film (l'écran de chargement montre justement le calcul du labyrinthe et de sa solution) ; aucun n'est l'idée principale.

## c. Les pistes

| # | Piste | Image | Geste | Boucle | Cœur technique |
| --- | --- | --- | --- | --- | --- |
| A | **Le dédale qu'on retourne** | un automate de bois et de laiton incline ou fait pivoter un plateau-labyrinthe ; une bille d'acier y roule | la gravité conduit la bille ; on ne bouge pas la bille, on tourne le labyrinthe | la bille sort, une rigole et une noria la rendent à l'entrée, le plateau revient à sa pose : état identique | arbres couvrants uniformes (Wilson) sur trois topologies, physique de la bille qui roule (contacts, rebonds), planification par simulation (recherche en largeur dans le graphe des états de gravité, suivi de chemin), bielles et courroie calculées |
| B | Physarum | un plasmode jaune dans un labyrinthe d'agar | remplir puis se rétracter sur le plus court chemin | la nourriture change de place, cycle de paires qui revient | modèle de Tero (renforcement par le débit), agents de Jones |
| C | L'eau qui explore | un labyrinthe creusé dans une dalle, l'eau versée à l'entrée | un front qui se divise à chaque carrefour | vidange, évaporation | écoulement en eaux peu profondes sur un relief |
| D | Domaines labyrinthiques | une goutte de ferrofluide entre deux vitres, un électroaimant dessous | la goutte s'ouvre en labyrinthe, se referme | courant périodique de la bobine | Swift-Hohenberg conservé à terme dipolaire |
| E | Le fil d'Ariane | une bobine déroule un fil rouge dans un dédale de pierre | dérouler, enrouler | le fil revient sur la bobine | corde XPBD dans des couloirs |
| F | Le labyrinthe qui se recompose | des murs qui montent et descendent | un mur s'ouvre, un autre se ferme | suite d'échanges d'arêtes dont le produit est l'identité | marche aléatoire sur les arbres couvrants |
| G | Le labyrinthe unicursal | un pavement de marqueterie, onze circuits | le chemin se pose comme un fil | il se défait par l'autre bout | construction de Chartres depuis la graine crétoise |
| H | Le corail cerveau | un dôme de corail aux vallées en labyrinthe | les crêtes poussent sur le dôme | blanchiment, repousse | Swift-Hohenberg sur la sphère |
| I | La boîte à énigme | un manchon et un cylindre à rainure | le manchon tourne et glisse, son ergot suit la rainure | le manchon revient | labyrinthe sur un cylindre, contraintes d'un ergot |

## d. Les notes

| Piste | Originalité | Esthétique | Boucle | Cœur | Variations | Faisabilité | Total |
| --- | --- | --- | --- | --- | --- | --- | --- |
| A — le dédale qu'on retourne | 4 | 4 | 5 | 5 | 4 | 3 | **25** |
| B — Physarum | 3 | 4 | 3 | 5 | 3 | 4 | 22 |
| C — l'eau qui explore | 3 | 4 | 3 | 3 | 3 | 3 | 19 |
| D — domaines labyrinthiques | 5 | 4 | 2 | 4 | 3 | 4 | 22 |
| E — fil d'Ariane | 3 | 3 | 3 | 3 | 3 | 3 | 18 |
| F — le labyrinthe qui se recompose | 4 | 3 | 4 | 4 | 3 | 3 | 21 |
| G — unicursal | 2 | 4 | 3 | 3 | 3 | 4 | 19 |
| H — corail cerveau | 4 | 4 | 2 | 4 | 3 | 3 | 20 |
| I — boîte à énigme | 4 | 4 | 4 | 3 | 2 | 4 | 21 |

B et D sont des **fronts qui avancent puis reculent** : la structure de mouvement de Moss et de Rust, refusée d'avance (règle 18). A est un geste neuf dans le dépôt : un objet qui roule, guidé par un appareil dont le mouvement *est* la cause. Elle absorbe I (le manchon devient un mécanisme), et le cliché 1 (le calcul du labyrinthe et de sa solution) devient l'écran de chargement.

## e. La piste retenue : *le dédale qu'on retourne*

### Le geste

On ne marche pas dans ce labyrinthe : on le **tourne**. Un automate incline un plateau, ou fait pivoter un disque dressé ; la gravité fait le reste. La bille roule, bute, hésite au bord d'une impasse, repart, tombe d'un couloir à l'autre, trouve la sortie. Une rigole (ou une noria) la rend à l'entrée ; le plateau revient à sa pose ; tout recommence.

### Trois familles, trois mouvements

| Famille | Appareil | Mouvement |
| --- | --- | --- |
| **Plateau** | plateau horizontal sur cardan, incliné de quelques degrés par deux bielles et deux manivelles | **la bille roule** : elle glisse en longues courbes douces le long des couloirs, freine avant les coudes, s'enfonce dans une impasse et en ressort |
| **Cadran** | plateau carré dressé, qui pivote dans son plan par quarts de tour, entraîné par une courroie | **la bille tombe** : à chaque quart de tour, elle chute d'un trait le long d'un couloir et rebondit sur la paroi d'en bas ; le cadran la retourne, elle chute ailleurs |
| **Roue** | disque dressé à labyrinthe circulaire (anneaux et cloisons), qui tourne lentement dans un sens puis dans l'autre | **la bille reste en bas** pendant que le disque tourne sous elle ; elle saute d'anneau en anneau quand une brèche passe sous elle ; une poche la remonte au sommet comme une noria et la lâche vers le centre |

Trois gestes que l'on ne confond pas : rouler, chuter, rester en bas pendant que le monde tourne.

### La boucle

Pour chaque famille, le film est la simulation d'un trajet complet, enregistrée puis relue :

1. **Plateau** : la bille part au repos de la cellule d'entrée, le plateau à plat ; elle suit le chemin (avec une ou plusieurs impasses visitées), sort par la porte de sortie dans la **rigole** qui fait le tour du plateau, en fait le tour et rentre par la porte d'entrée, où elle s'arrête, plateau à plat.
2. **Cadran** et **Roue** : la bille est au repos dans la cellule d'arrivée de l'entrée, le disque à son angle de départ ; une suite de rotations (trouvée par recherche en largeur dans le graphe des états) la conduit jusqu'à la porte de sortie, d'où elle tombe dans la rigole ; le disque tourne alors dans un seul sens : une **poche** de la rigole la soulève, au sommet la bille retombe par la porte d'entrée, et le disque s'arrête à son angle de départ (modulo un tour).

Formule : u ∈ [0, 1), t = u·T, avec T la durée du trajet simulé. L'état final (bille au repos à la même place, appareil à la même pose, à un nombre entier de tours près) est l'état initial ; l'écart résiduel de la simulation (≪ 0,1 mm) est absorbé dans la dernière demi-seconde, à l'arrêt. La boucle est parfaite par construction : u = 1 est u = 0.

### Le cœur technique

- **Labyrinthes** (`src/gen/maze.js`) : arbre couvrant uniforme tiré par l'algorithme de Wilson sur trois topologies (grille rectangulaire, grille polaire à anneaux subdivisés, grille hexagonale) ; portes d'entrée et de sortie ; la liste des parois (segments et arcs) sert à la fois au rendu, à la physique et aux tests. Invariant : un arbre (cellules − 1 passages, connexe, sans cycle).
- **Physique** (`src/gen/physics.js`) : bille qui roule sans glisser dans le plan de l'appareil, gravité projetée, forces d'inertie du disque qui tourne, contacts contre des capsules et des arcs (restitution, frottement), résistance au roulement ; pas de 1 ms. Invariant : la bille n'entre jamais dans une paroi (distance ≥ rayon − 0,05 mm).
- **Planification** (`src/gen/plan.js`) : pour le Plateau, un pilote qui suit le chemin (vitesse visée, freinage avant les coudes, butée au fond des impasses) et commande l'inclinaison sous une vitesse angulaire bornée (servomoteur) ; pour le Cadran et la Roue, une recherche en largeur sur les états *simulés* (cellule d'arrêt et angle), chaque transition étant une rotation simulée en entier ; le film est la suite exacte des transitions retenues.
- **Mécanique** (`src/kin.js`) : bielles et manivelles résolues exactement (longueur des bielles constante), courroie tangente aux deux poulies (sans glissement : rapport des rayons), cardan.

### La matrice de variations

| Axe | Valeurs |
| --- | --- |
| Famille | Plateau, Cadran, Roue |
| Topologie | grille carrée, hexagonale (Plateau), polaire (Plateau rond, Roue) |
| Taille | 7 à 15 cellules de côté ; 4 à 7 anneaux |
| Style des parois | filets rapportés (parois droites à chant arrondi), taille directe (gorges creusées dans la masse), murets à congé |
| Bille | acier poli, agate rubanée, porcelaine, obsidienne, bronze |
| Humeur (décor) | Cabinet, Carrare, Laque, Ardoise, Béton, Céladon |
| Récit | 0 à 3 impasses visitées, sens de la rigole, portes |

3 familles × 3 topologies (là où elles s'appliquent) × 5 billes × 6 humeurs × tailles et récits : plusieurs milliers de films, et deux graines au hasard ont presque toujours une autre famille ou une autre humeur.

### Trois images clés

1. **Cabinet, Plateau, plan 3/4 bas** : un plateau de noyer aux filets de laiton, à peine incliné ; la lampe de bureau, de côté, couche les ombres des parois en peigne ; au premier plan, la bielle de laiton sort de l'ombre du socle ; la bille d'acier, en plein couloir, reflète la lampe en un point blanc et le plateau entier en miniature.
2. **Carrare, Roue, de face** : un disque de marbre blanc dressé sur deux colonnes, des gorges concentriques taillées dans la masse ; lumière zénithale douce, cyclorama blanc ; une bille d'obsidienne noire tout en bas d'un anneau, le disque tourne lentement au-dessus d'elle ; la courroie de cuir passe sur la gorge du disque.
3. **Laque, Cadran, plan rasant** : un carré de laque noire aux parois vermillon, dressé, à mi-quart de tour ; lumière rasante dure d'un seul côté ; la bille de porcelaine, en pleine chute dans un long couloir, découpée en blanc sur le noir.

### Les risques

- **Physique instable** (bille qui traverse une paroi lors d'une chute rapide) : pas de 1 ms, vitesse de chute ≤ 2 m/s (2 mm par pas, rayon 6 mm), test sur toute la boucle.
- **Pilote qui échoue** (la bille se coince, dépasse un coude) : vérifié sur 200 graines dans Node ; repli sur une autre graine de labyrinthe si le trajet échoue.
- **Illisible** (la bille trop petite dans l'image) : cadrage qui suit la bille (lissage gaussien), bille ≥ 50 px dans le plan.
- **Trop « jouet »** : objets de musée (marqueterie, marbre taillé, laque), mécanismes vrais et visibles, lumière de photographe.
- **Coût** : plateau en carte de hauteur cuite (une seule texture de distance aux parois, lue en déplacement et en normale), une seule lampe ombrée, la bille en sphère fine.

## e bis. Les épreuves

### Crédibilité

| Temps du film | Cause visible | Loi | Convention de temps |
| --- | --- | --- | --- |
| le plateau s'incline | les manivelles tournent, les bielles poussent le bord | cinématique d'une bielle-manivelle | temps réel |
| la bille roule, freine | l'inclinaison du plateau | roulement sans glissement : a = (5/7)·g·sin θ, résistance au roulement | temps réel |
| la bille bute, rebondit | la paroi | choc à restitution 0,35, frottement | temps réel |
| le cadran / la roue tourne | la poulie du moteur et la courroie | courroie sans glissement, rapport des rayons | temps réel |
| la bille chute d'un couloir à l'autre | la gravité dans le plan du disque | chute roulante (5/7)·g·cos 10° | temps réel |
| la bille est remontée | la poche de la rigole la porte | contact contre la poche, la bille roule sur la rigole | temps réel |
| la bille rentre au départ | gravité au sommet du disque | id. | temps réel |

Rien ne flotte : le plateau est porté par son cardan sur sa colonne, la colonne par le socle ; le disque dressé tourne sur un axe porté par deux paliers ; la bille est toujours au contact du fond (le disque est incliné de 10° vers l'arrière, une vitre la retient devant).

### Variété (une phrase par humeur, sans couleur)

| Humeur | Décor | Lumière | Valeur | Cadrage |
| --- | --- | --- | --- | --- |
| Cabinet | sur un sous-main de cuir, fond de pièce sombre | lampe de bureau de côté, dure, ombres longues | basse | 3/4 bas, proche |
| Carrare | sur un socle de pierre, cyclorama blanc | boîte à lumière au zénith, très douce | très haute | plongée ou face |
| Laque | sur un plateau de laque, fond noir | lumière rasante dure d'un seul côté, contre-jour fin | très basse | rasant |
| Ardoise | sur une table de chêne, fond gris de pièce | fenêtre au nord, douce et froide | moyenne | plongée |
| Béton | sur un bloc de béton, ciel couvert | ciel diffus et un soleil voilé | moyenne, froide | plan large |
| Céladon | sur une table claire, fond crème | soleil dur par une croisée (ombres de fenêtre) | haute, contrastée | 3/4 |

### Ambition (éléments de construction)

Plateau : dalle à chant mouluré, parois (filets à chant arrondi ou murets taillés à congé), poteaux aux carrefours, rigole périphérique, portes à seuil, rosette d'arrivée, cardan (chape, croisillon, axes), colonne tournée, socle, deux moteurs (carter, flasques, pattes), manivelles, bielles à rotules, chapes sous le plateau, bille. Cadran et Roue : disque ou carré dressé, gorge de courroie, moyeu, axe, deux paliers sur colonnes, socle, moteur, poulie, courroie de cuir, vitre de façade, poche de noria. Bien plus de cinq.

## e ter. Déclinaison et scénario

**Déclinaison** : le Plateau roule (deux axes, continu), le Cadran fait chuter (un axe, par quarts de tour, chutes franches et rebonds), la Roue garde la bille en bas pendant qu'elle tourne (un axe, continu, sauts d'anneau, noria). Trois mouvements distincts.

**Scénario (Plateau)** : le plateau est à plat, la bille au repos à l'entrée. Le plateau s'incline, la bille part dans le premier couloir, freine, tourne. Au carrefour, elle s'engage dans une impasse, bute au fond, le plateau se redresse et la ramène. Elle repart, accélère dans une longue ligne droite, serpente. Elle passe la porte de sortie et tombe dans la rigole ; le plateau s'incline franchement, la bille fait le tour du plateau à vive allure et rentre par la porte d'entrée, où elle s'arrête. Le plateau revient à plat. Pause.

**Scénario (Cadran)** : le cadran est immobile, la bille au fond d'un couloir. Un quart de tour : la bille glisse, puis chute d'un trait et rebondit. Pause. Un demi-tour : elle traverse tout le cadran. Une hésitation (un quart de tour dans l'autre sens). Elle atteint la porte, tombe dans la rigole, le cadran tourne d'un seul mouvement : la poche soulève la bille, au sommet elle retombe par l'entrée. Le cadran s'arrête à sa pose de départ.

**Scénario (Roue)** : la bille au repos en bas d'un anneau ; la roue tourne lentement, la bille reste en bas ; une brèche passe sous elle, elle tombe dans l'anneau suivant ; la roue repart dans l'autre sens ; anneau après anneau, la bille gagne le bord. Elle tombe dans la rigole, la poche la remonte, elle redescend vers le centre et s'arrête. La roue s'arrête.

## e quater. Références

1. **Jeu de labyrinthe à bascule en bois** (photographie de catalogue, 3/4 haut) : plateau de 28 × 23 cm, bille d'acier de 12 mm, parois de 10 mm de haut et 4 mm d'épaisseur, couloirs d'environ 20 mm ; les parois occupent ~25 % de la surface ; la bille fait les deux tiers de la largeur d'un couloir. Lumière de studio douce, ombres courtes.
2. **Labyrinthe « à doigt » taillé dans le marbre** (pierre de 30 cm) : gorges de 8 à 10 mm de large et 6 mm de profondeur, arêtes adoucies, poli satiné dans les gorges, plus mat sur les crêtes.
3. **Roue labyrinthe de bois** (jouet d'éveil) : disque de 25 cm sur un pied, couvert d'une vitre, labyrinthe à anneaux concentriques, bille de 10 mm.
4. **Robot qui résout un labyrinthe à bascule** : deux servomoteurs sous le plateau, palonniers et tringles à rotules, cardan au centre ; on voit le plateau s'incliner de quelques degrés à peine — la bille, elle, file.
5. **Bille d'acier en macro** : un miroir sphérique, la lampe en point dur, le décor courbé, l'ombre de contact très noire et très petite.

Ce qu'elles imposent : échelle d'un objet de table (25 à 35 cm), bille de 10 à 14 mm qui fait 60 à 70 % de la largeur du couloir, parois de 6 à 10 mm de haut, inclinaisons de quelques degrés (≤ 6°) ; l'ombre de contact de la bille et l'ombre des parois sont ce qui pose tout. Le grain du support à l'échelle : fil du noyer, cristaux du marbre, pores du béton, de l'ordre du demi-millimètre au millimètre.

**Échelle à l'image** : plan d'ensemble, l'appareil remplit 70 à 80 % de la largeur ; la bille fait 40 à 70 px à 1080p ; 50 à 220 cellules à l'image ; ce qui donne l'échelle : la bille et le grain de la matière.
