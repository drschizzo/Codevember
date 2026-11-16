# Bolt — document de concept

Thème : « Bolt » (jour 21). Document de travail : il garde les pistes écartées et pourquoi, et décrit la piste retenue telle qu'elle est construite.

## a. Le thème en largeur

**Physique et science**
- le *traceur par bonds* (stepped leader) : il descend du nuage par sauts de ~50 m toutes les ~50 µs, se ramifie, chaque pointe lumineuse le temps d'un bond ;
- le *traceur ascendant* : une aigrette qui monte d'une pointe au sol à la rencontre du traceur ; la *jonction* se fait à quelques dizaines de mètres du sol ;
- l'*arc en retour* : une onde de courant (~30 kA) remonte le canal à c/3, c'est elle qu'on appelle l'éclair ; les branches s'allument puis meurent ;
- les *réamorçages* : 3 à 5 arcs par éclair, précédés d'un traceur continu (dart leader) dans le canal encore chaud — d'où le scintillement ;
- l'éclair *en chapelet* : le canal se défait en perles en refroidissant ;
- l'éclair *ascendant* (depuis une tour), l'éclair *araignée* (anvil crawler, à l'horizontale sous l'enclume), l'éclair *fourchu* (plusieurs points d'impact) ;
- le *modèle de claquage diélectrique* (Niemeyer, Pietronero, Wiesmann, 1984) : croissance ∝ (champ)^η, dimension fractale ~1,7 en 2D pour η = 1 ;
- les *figures de Lichtenberg*, les *fulgurites* (le sable fondu en racine de verre) ;
- le *cycle d'une cellule orageuse* : cumulus → congestus → cumulonimbus à enclume → averse → dissipation (≈ 1 h) ;
- un *boulon* : filet hélicoïdal, pas, angle de 60° ; un *carreau* d'arbalète ; un *verrou* à pêne.

**Métiers et objets**
- paratonnerres à boules de verre, girouettes ; chasseurs d'orages et leurs caméras à 7 000 i/s ;
- la tige filetée, l'écrou borgne, la clé ; l'arbalétrier ;
- le *bolt of cloth* : la pièce de drap enroulée sur sa planche ;
- le service à thé : tasse, soucoupe, cuillère, théière, verre à thé gravé d'or, bol.

**Art, photographie, cinéma**
- Hiroshi Sugimoto, *Lightning Fields* : 400 000 V déchargés à même le film, des fougères blanches sur noir ;
- Berndnaut Smilde, *Nimbus* : un vrai nuage, seul, dans une pièce vide ;
- Walter De Maria, *The Lightning Field* ; William N. Jennings (première photographie d'un éclair, 1882) ;
- les clichés : le ciel violet zébré, le château de Frankenstein, le logo « haute tension », Zeus.

**Vocabulaire**
- traceur, aigrette, précurseur, arc en retour, coup de foudre, foudre en boule, fulgurite, kéraunique, enclume, *bolt from the blue* ;
- et l'expression : **« une tempête dans une tasse de thé »** (*storm in a teacup*), « une tempête dans un verre d'eau ».

**Cycles et transformations**
- le cycle de l'eau : évaporation → condensation → charge → décharge → pluie → retour à l'eau ;
- l'oscillateur à relaxation : la charge monte lentement, se vide d'un coup, recommence ;
- sable → fulgurite → sable.

**Lumière**
- le canal : ~30 000 K, blanc bleuté, bordé de violet (azote) ; les traceurs sont cent fois moins lumineux que l'arc ;
- le nuage éclairé de l'intérieur (diffusion multiple : un abat-jour) ; les ombres dures portées par l'éclair, qui tournent d'un réamorçage à l'autre ;
- la porcelaine fine, translucide à contre-jour ; l'or d'un filet ; le reflet du canal dans le thé.

## b. Les clichés (interdits comme idée principale)

1. Le ciel d'orage zébré au-dessus d'un paysage (ou d'une ville) la nuit.
2. La bobine Tesla / le globe à plasma / l'arc entre deux électrodes (encore un appareil de laboratoire).
3. Le boulon et l'écrou qui se vissent en gros plan métallique.
4. La figure de Lichtenberg gravée dans un bloc d'acrylique.
5. Le pictogramme de l'éclair en zigzag.

## c. Huit pistes

| # | Image | Geste | Boucle | Cœur technique |
| --- | --- | --- | --- | --- |
| 1 | Paysage nocturne, traceur filmé à la caméra rapide | l'éclair descend | relaxation : charge, décharge | DBM 3D |
| 2 | Bloc d'acrylique, arbre de Lichtenberg | l'arbre pousse d'un coup de pointe | l'arbre se « résorbe » (impossible) | DBM 3D + réfraction |
| 3 | Fulgurite : la foudre vitrifie une dune, le vent la dégage | frappe, puis érosion | sable → verre → sable | DBM + transport éolien |
| 4 | Boulon de musée : filets, écrou, rondelles qui se vissent en cascade | visser | nombres entiers de tours | hélicoïdes exacts |
| 5 | Pièce de drap (*bolt of cloth*) qui se déroule et se réenroule | dérouler | aller par un chemin, retour par l'autre | tissu XPBD |
| 6 | Paratonnerre à boules de verre sur un faîtage | l'éclair choisit la pointe | relaxation | DBM + verre |
| 7 | **Un orage dans une tasse de thé** : la vapeur fait un cumulonimbus, la foudre tombe sur la cuillère, il pleut dans la tasse | cycle de l'eau, avec l'éclair pour temps fort | vapeur → nuage → éclair → pluie → thé | DBM 3D + nuage volumique + conservation de l'eau |
| 8 | Laitue qui « monte en graine » (*to bolt*) en accéléré | la hampe jaillit | pousse puis ressème | L-système |

## d. Notation

| # | originalité | esthétique | boucle | cœur | variations | faisabilité | regard | total |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 2 | 4 | 3 | 4 | 3 | 5 | 1 | 22 |
| 2 | 3 | 4 | 1 | 4 | 3 | 3 | 2 | 20 |
| 3 | 4 | 4 | 4 | 4 | 3 | 2 | 4 | 25 |
| 4 | 2 | 3 | 3 | 3 | 4 | 5 | 1 | 21 |
| 5 | 2 | 3 | 3 | 3 | 3 | 3 | 2 | 19 (trop près de Cocoon) |
| 6 | 3 | 4 | 3 | 4 | 4 | 4 | 3 | 25 |
| **7** | **5** | **5** | **5** | **4** | **5** | **3** | **5** | **32** |
| 8 | 3 | 3 | 3 | 3 | 3 | 4 | 2 | 21 (trop près de Fold) |

Retenue : **la piste 7**. Elle absorbe la piste 1 (le traceur à la caméra rapide devient le temps fort) et la piste 6 (le paratonnerre, devenu le mât de la machine qui chauffe le thé). Aucune note sous 3.

## e. La piste retenue, telle qu'elle est construite

**Titre** : Bolt. **Sous-titre** : *une tempête dans une tasse de thé*.

**La liberté** : l'échelle. Un orage entier tient au-dessus d'une tasse. Rien d'autre : la vapeur monte parce que le thé est chaud, le nuage a une base plate, il pleut avant l'éclair (dans un orage, ce sont les précipitations qui séparent les charges), le traceur descend par bonds en se ramifiant, une aigrette monte de la pointe la plus haute, l'arc en retour remonte le canal, les réamorçages scintillent, une bourrasque de pluie suit l'éclair, et l'eau du nuage revient dans la tasse.

**Le regard** : Hiroshi Sugimoto, *Lightning Fields*. Ce qu'il impose : (1) l'éclair est une *plante de lumière* dont on regarde la ramification, cadrée de face, immobile ; (2) la valeur est franche, un blanc qui brûle sur un fond qui ne dispute rien ; (3) pas d'appareil de laboratoire. L'humeur « Plaque sensible » est faite d'après lui (noir et blanc). Le nuage et la tasse restent à l'image.

**Ce que la foudre touche a un rôle.** Chaque famille de récipient a sa machine domestique à chauffer le thé, sur laquelle tombe la foudre : thermoplongeur à paratonnerre (tasse, verre), réchaud à spirale et son mât (théière boule), brasero (tetsubin, la foudre tombe sur l'arceau), pierres chaudes (bol, un arc par pierre). La chaleur descend le métal depuis la pointe, la résistance rougit, le thé bout, et le bouillon lance la colonne de vapeur suivante. Le cliché n° 2 (l'appareil de laboratoire) reste interdit.

**Le lien avec la collection** : le cycle de l'eau, rejoué en vingt-quatre secondes. L'eau partie en vapeur revient en pluie, le niveau du thé retrouve sa marque.

### Découpage (boucle de 24 s, en parts de boucle ; `src/film.js`)

| u | Temps | Ce que l'œil regarde | Convention |
| --- | --- | --- | --- |
| 0,03 – 0,36 | **La pluie** : le nuage rend 70 % de son eau à la tasse et fonce | la pluie, les ronds dans le thé | temps réel |
| 0,27 – 0,38 | **La charge** : des lueurs traversent le nuage | le nuage ; la caméra s'approche | accéléré |
| 0,385 – 0,50 | **Le traceur** descend en neuf bonds, hésite à 86 % de sa course pendant que l'aigrette monte, puis saute | les pointes du traceur | caméra rapide |
| 0,50 | **La jonction** : l'arc en retour, l'image brûlée, l'ombre dure de la tasse, les étincelles | le canal, puis la machine | |
| 0,51 – 0,60 | **La bourrasque** rend le reste de l'eau ; réamorçages, canal en perles ; le nuage vidé se défait jusqu'à 0,65 | le canal, puis la machine qui rougit | ralenti léger |
| 0,52 – 0,95 | **La vapeur** : la chaleur a atteint la résistance, le thé bout, la colonne monte, s'étale et remplit le nuage suivant | le nuage qui grandit | accéléré |

Temps fort : 0,50. Le raccord (u = 0) tombe sur le nuage plein, juste avant la pluie.

### Formule de la boucle

Tout est fonction de la phase u. L'eau se conserve à chaque instant : nuage + pluie en vol + thé = constante, donc le niveau revient exactement à sa marque. Un état est la somme du cycle de l'eau en cours et du précédent (le nuage d'un cycle se défait pendant que la colonne du suivant monte), tous deux lus dans le même champ simulé. Les mouvements lents lisent une horloge presque arrêtée pendant le traceur et font un nombre entier de périodes. L'éclair est un arbre calculé une fois : sa lecture ne dépend que de l'avancement du traceur et du temps écoulé depuis la jonction. Le détail est dans le [README](../README.md#la-boucle).

### Matrice de variations

| Axe | Valeurs |
| --- | --- |
| **Récipient** (famille) et sa machine | tasse et soucoupe, thermoplongeur · théière, réchaud ou brasero · verre à thé, thermoplongeur · bol, pierres chaudes |
| **Éclair** (famille, liée au récipient) | *coup au but* sur le mât · *ascendant* depuis le mât ou l'arceau · *araignée* sous la base puis chute sur le mât · *fourchu*, un arc par pierre |
| **Forme** (variante) | tasse tulipe / litron / à pied ; théière boule / tetsubin ; verre droit / évasé ; bol chawan / à pied / assiette creuse |
| **Décor** | godrons (16 à 32) ou non, évasement de la lèvre, mât à une ou deux boules, anse ou bec tourné |
| **Humeur** | Cinq heures · Plaque sensible · Comptoir · Céladon · Laque · Heure bleue · Sèvres, chacune avec trois ou quatre accords de matières |
| **Nuage** | bourgeonnant · tour · enclume · nappe |
| **Caractère du traceur** | η de 2,4 à 4,2 (touffu → filiforme), 26 à 40 pointes actives, tremblé, 3 à 5 arcs (1 à 3 pierres pour le fourchu) |
| **Cadrage** | un plan de base par humeur (plongée de 17° pour Plaque sensible à 36° pour Comptoir), retouché par la graine |

### Trois images clés

1. **u ≈ 0,2** : jour gris. Une tasse blanche à filet d'or sur du lin ; au-dessus, un nuage gros comme deux poings, base plate, qui pleut dans la tasse.
2. **u ≈ 0,47** : le nuage est d'ardoise. Un arbre de lumière violette pend sous sa base, ses pointes blanches à deux doigts du mât, d'où monte une aigrette.
3. **u = 0,50** : un trait blanc relie le nuage au mât. Le nuage est une lanterne ; la tasse projette une ombre dure sur la nappe ; le filet d'or et le thé renvoient le canal.

### Risques et parades

- *Le nuage en « boule de coton »* : base plate, plan lobé, bourgeons de Worley érodés, éclairage par gradient de densité.
- *L'éclair en fil de fer* : cœur HDR très fin, gaine violette, lueur d'air, tortuosité à trois échelles, branches plus fines et plus pâles que le canal.
- *Le traceur sur réseau (escaliers)* : sites décalés par un hachage, puis subdivision avec tremblé.
- *Coût du nuage* : bruit lu seulement dans l'enveloppe, peu de pas en mobile.
- *L'image bouchée entre les éclats* : la lampe de l'humeur éclaire toujours le sujet ; l'éclair s'ajoute.

## e bis. Les trois épreuves

**Crédibilité**

| Temps | Cause visible | Loi | Temps |
| --- | --- | --- | --- |
| vapeur | le thé bout sur la machine rougie | panache de Boussinesq, condensation au niveau de base | accéléré |
| nuage | la vapeur l'alimente par dessous | panache qui s'étale sous son plafond | accéléré |
| pluie | le nuage fonce et se vide | chute ; l'eau se conserve | temps réel |
| charge | lueurs dans le nuage | décharges intra-nuage | accéléré |
| traceur | il part de la base du nuage | claquage diélectrique : p ∝ Φ^η | caméra rapide |
| aigrette | la pointe la plus haute (mât, arceau, pierre) | effet de pointe | caméra rapide |
| arc en retour | la jonction | onde qui remonte depuis le sol | temps réel |
| ombres | le canal est la source | lumière ponctuelle | — |
| chaleur | la pointe frappée | front qui descend le métal, la résistance rougit | — |

Rien ne flotte sauf le nuage. La tasse est dans le creux de la soucoupe, le couvercle sur sa gorge, la résistance dans le thé, les pierres au fond du bol.

**Variété** : une humeur est un décor (support, mur, lumière, valeur, cadrage), voir le tableau du [README](../README.md#scène).

**Ambition** (éléments de construction) : paroi tournée d'épaisseur constante, lèvre roulée, filet d'or, pied annulaire, godrons à arête vive sous un jonc, anse en ruban à collerette, soucoupe à bassin et aile, piédouche, couvercle à gorge et bouton, bec en col de cygne, anse mobile de tetsubin, et les quatre machines.

## e ter. Déclinaison et scénario

**Déclinaison** (le mouvement, pas la forme)
- *Tasse, coup au but* : un arbre renversé descend, hésite, une seule pointe gagne ; l'aigrette monte du mât.
- *Théière, ascendant* : l'arbre pousse **vers le haut** depuis la pointe du mât (ou l'arceau du tetsubin) et s'épanouit sous le nuage.
- *Verre, araignée* : la décharge **rampe à l'horizontale** dans la base du nuage, puis un seul fil tombe sur le mât.
- *Bol, fourchu* : chaque arc touche une pierre différente.

**Scénario** (film muet, la tasse)
1. Un petit nuage plein flotte au-dessus d'une tasse. Il se met à pleuvoir dans la tasse ; le nuage fonce.
2. Des lueurs le traversent. La caméra s'approche.
3. Sous la base, un fil violet naît et descend par à-coups ; il se divise, les branches cherchent. Tout est très lent.
4. Une branche approche du mât. De sa boule monte une aigrette.
5. Elles se touchent : un trait blanc. La tasse jette son ombre sur la nappe. Une bourrasque de pluie tombe.
6. Le trait bat encore, plus faible, puis se défait en perles. La caméra descend vers la machine : la chaleur descend la tige, la résistance rougit sous le thé.
7. Le thé bout. La vapeur monte, s'étale, et le nuage vidé se défait pendant que le suivant se forme.

## e quater. Références

1. *Cumulonimbus capillatus incus vu de loin* : base plate et sombre, tour à bourgeons nets côté soleil, enclume fibreuse plus large que la tour ; rapport hauteur/base ~1,2.
2. *Traceur à 7 000 i/s (ZT Research, Tom Warner)* : 10 à 30 branches simultanées, toutes dirigées vers le bas dans un cône de ~60°, pointes plus brillantes que les canaux, canaux violets très fins.
3. *Arc en retour photographié de près* : un canal principal tortueux à trois échelles (grands coudes, zigzags, tremblé), surexposé avec halo ; branches trois à dix fois moins lumineuses.
4. *Nimbus de Smilde* : le nuage occupe ~1/4 de la largeur de l'image, à mi-hauteur, bords nets d'un côté, effilochés de l'autre.
5. *Nature morte à la tasse (porcelaine fine sur lin)* : fil du lin ≈ 0,4 mm, lisible ; paroi translucide au bord ; ombre de contact sous la soucoupe.

Ce que cela impose : nuage ≈ 2 × la largeur de la tasse et ≈ 1/3 de la hauteur du cadre ; éclair ≈ 1 à 1,3 × la hauteur de la tasse, de 15 à 40 branches ; le support porte un grain au demi-millimètre.

## Modèles publiés

- L. Niemeyer, L. Pietronero, H. J. Wiesmann, *Fractal dimension of dielectric breakdown*, Phys. Rev. Lett. 52 (1984) : p ∝ φ^η.
- T. Kim, J. Sweeney, C. Shelley, M. Lin, *Fast simulation of Laplacian growth*, IEEE CG&A 27 (2007) : le potentiel des sites candidats se met à jour par sommes de charges ponctuelles, φᵢ = Σⱼ (1 − R/rᵢⱼ), sans résoudre Laplace sur une grille ; un attracteur de signe opposé oriente la décharge.
- A. Schneider, *The real-time volumetric cloudscapes of Horizon Zero Dawn* (2015) : densité = enveloppe érodée par un bruit de Perlin-Worley, loi « Beer-poudre ».

## Ce que les essais ont appris

- **Quand une chose doit en devenir une autre, calculer la transformation plutôt que raccorder deux modèles.** Tant que la vapeur et le nuage étaient deux fonctions, on voyait deux objets. Ils sont un seul fluide simulé (`gen/plume.js`). Des bouffées en sprites ajoutées ensuite (autre source, autre rendu, autre bruit) ont recréé le même défaut ; le bouillon du choc est devenu une impulsion au départ de la simulation, et le nuage qui se défait est lu dans le même champ.
- **Le ralenti doit valoir pour tout ce qui bouge** : la vapeur et les bourgeons lisent une horloge lente (`clockAt`), presque arrêtée pendant le traceur. La pluie, qui finit avant, lit la phase.
- **La boucle a besoin d'une cause qui relance la vapeur** : la foudre chauffe la machine, qui fait bouillir le thé.
- **L'histoire doit se jouer où regarde la caméra** : un bouton de cuillère suspendu à côté de la tasse ne disait rien. La foudre tombe sur une machine qui a un rôle, et la caméra plonge assez pour voir la surface du thé.
- **Un traceur de 6,2 s est trop long pour un trait fin** : il dure 2,8 s, en neuf bonds de plus en plus rapides avec une retenue avant le dernier.
- **Un éclair en profil gaussien large sature en boudin blanc** : cœur fin, gaine violette, lueur d'air, et le halo de la chaîne d'image dit l'éclat.
- **Deux domaines de marche avec deux coefficients d'extinction font une ligne à la couture** : même coefficient, la légèreté de la colonne passe dans la densité.
- **Des finitions communes recolorées ne font pas un support** : sept shaders propres au projet (`scene/table.js`). Des veines de marbre trop larges se lisaient comme de la fumée sous le nuage.
- **Une anse doit quitter la paroi le long de sa normale**, les bouts noyés dans l'épaisseur, sinon elle sort de la matière au creux des godrons.
- **Coût** : lire le bruit seulement dans l'enveloppe (un branchement dans la marche) fait gagner 3 à 6 ms malgré la divergence ; monter la fréquence de l'octave fine sature le cache de la texture 3D (2 ms de plus pour un grain que le flou et l'anticrénelage effacent).
- **Écartés** : le samovar (une cinquième famille entière), des filaments strictement verticaux (ils se lisaient comme une pluie).
