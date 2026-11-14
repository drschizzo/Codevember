# Bolt — document de concept

Thème : « Bolt » (jour 21). Document de travail : il garde les pistes écartées et pourquoi.

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

Retenue : **la piste 7**. Elle absorbe la piste 1 (le traceur à la caméra rapide devient le temps fort) et la piste 6 (la cuillère est le paratonnerre). Aucune note sous 3.

## e. La piste retenue

**Titre** : Bolt. **Sous-titre** : *une tempête dans une tasse de thé*.

**La liberté** : l'échelle — un orage entier tient au-dessus d'une tasse. Rien d'autre : la vapeur monte parce que le thé est chaud, le nuage a une base plate et une enclume, le traceur descend par bonds en se ramifiant, une aigrette monte de la pointe la plus haute, l'arc en retour remonte le canal, les réamorçages scintillent, et l'eau du nuage revient en pluie dans la tasse.

**Le regard** : Hiroshi Sugimoto, *Lightning Fields*. Ce qu'il impose : (1) l'éclair est une *plante de lumière* dont on regarde la ramification, donc cadrée plein champ, de face, immobile ; (2) la valeur est franche — un blanc qui brûle sur un fond qui ne dispute rien ; (3) hors champ, tout ce qui explique : pas d'appareil, pas d'électrode, seulement la décharge et ce qu'elle touche. L'humeur « Plaque sensible » est faite d'après lui (noir et blanc) ; l'humeur « Heure bleue » en garde le cadrage. Le regard ne cache pas le milieu : le nuage et la tasse restent à l'image.

**L'appareil** : aucun. La cause est domestique (un thé chaud), l'« électrode » est une cuillère.

**Le lien avec la collection** : le cycle de l'eau, rejoué en vingt-quatre secondes ; l'eau partie en vapeur revient en pluie, le niveau du thé retrouve sa marque.

**La collection** : la planche du 13 novembre a 5 captures sépia sur 21 et beaucoup de fonds sombres à lampe chaude. Ouverture choisie : un jour froid gris-bleu, nappe de lin pâle, porcelaine blanche — teinte ~215°, médiane ~0,35.

### Découpage (boucle de 24 s, en parts de boucle)

| u | Temps | Ce que l'œil regarde | Convention |
| --- | --- | --- | --- |
| 0,00–0,24 | **La vapeur** monte du thé, s'accumule, bourgeonne : cumulus, puis tour, puis enclume | le nuage qui change de forme en grandissant | accéléré |
| 0,24–0,34 | **La charge** : le nuage s'assombrit, des lueurs sourdes le traversent de l'intérieur | le nuage ; la caméra commence à s'approcher | accéléré |
| 0,34–0,60 | **Le traceur** descend par bonds, se ramifie ; près de la cuillère, une aigrette monte | les pointes du traceur | caméra rapide (très fort ralenti) |
| 0,60 | **La jonction** : l'arc en retour remonte le canal, toute la scène est éclairée d'en haut, ombres dures | le canal, puis la tasse | le ralenti cesse à la jonction |
| 0,60–0,70 | **Réamorçages** : trois à quatre éclats décroissants dans le même canal ; les branches sont mortes ; le thé ride depuis la cuillère | le canal qui scintille | temps réel |
| 0,70–0,74 | **La rémanence** : le canal se défait en perles | le chapelet | ralenti léger |
| 0,72–0,95 | **L'averse** : il pleut dans la tasse, le nuage blanchit et se vide, le niveau remonte | la pluie, les ronds dans le thé | temps réel |
| 0,95–1,00 | **L'embellie** : dernier lambeau, la vapeur reprend | la tasse | — |

Temps fort : 0,60. Respirations : 0,00–0,15 et 0,90–1,00.

### Formule de la boucle

Tout est fonction de la phase u ∈ [0, 1) : `état(u) = (vapeur V(u), eau du nuage W(u), charge Q(u), avancement du traceur a(u), temps après jonction τ(u), pluie P(u), niveau N(u))`. Chaque fonction est un produit de `smoothstep` à support dans ]0, 1[ : W(0) = W(1) = 0, P(0) = P(1) = 0, a et τ ne comptent que dans leur fenêtre. Le niveau n'est pas libre : **N(u) = N₀ − k·(W(u) + R(u))**, où R est l'eau en vol (pluie en chute) — l'eau se conserve à chaque instant, donc N(1) = N(0) exactement. Les mouvements lents (dérive du bruit du nuage, balancement de la caméra) font un nombre entier de périodes. L'éclair est un arbre calculé une fois : sa lecture ne dépend que de a(u) et τ(u).

### Matrice de variations

| Axe | Valeurs |
| --- | --- |
| **Récipient** (famille) | tasse et soucoupe avec cuillère · théière · verre à thé · bol |
| **Éclair** (famille, liée au récipient) | *coup au but* descendant sur la cuillère · *ascendant* depuis le bouton du couvercle · *araignée* sous la base puis chute sur le bord · *fourchu* à plusieurs impacts sur le liquide |
| **Forme** (variante) | tasse tulipe / litron / à pied ; théière boule / tetsubin ; verre droit / évasé ; bol chawan / à pied / creux |
| **Décor** | côtes, filet d'or, anse en oreille / en point d'interrogation, bouton en gland / en boule |
| **Humeur** | Cinq heures · Plaque sensible · Comptoir · Céladon · Laque · Heure bleue · Sèvres |
| **Nuage** | cumulus bourgeonnant · tour étroite · enclume large · nappe basse |
| **Caractère du traceur** | η de 2 à 5 (touffu → filiforme), tortuosité, nombre de réamorçages (2–5), nombre de branches |
| **Cadrage** | de face bas · plongée 50° · trois-quarts serré · large frontal |

4 × 3 × 7 × 4 × 4 × 4 ≈ 5 000 combinaisons avant les tirages continus et l'arbre lui-même (unique par graine).

### Trois images clés

1. **u = 0,20** — Jour gris. Une tasse blanche à filet d'or sur du lin ; au-dessus, un cumulus gros comme deux poings, base plate, sommet en chou-fleur éclairé de côté, relié à la tasse par un fil de vapeur.
2. **u = 0,55** — Le nuage est d'ardoise. Un arbre de lumière violette pend sous sa base, ses pointes blanches à deux doigts de la cuillère, d'où monte une aigrette. La porcelaine reçoit une lueur froide par le haut.
3. **u = 0,60** — Un trait blanc relie le nuage à la cuillère. Le nuage est une lanterne ; la tasse projette une ombre dure et rayonnante sur la nappe ; le filet d'or et le thé renvoient le canal.

### Risques et parades

- *Le nuage en « boule de coton »* : base plate, bourgeons de Worley érodés, éclairage par gradient de densité, enclume ; comparaison aux références.
- *L'éclair en fil de fer* : cœur HDR très fin + halo, tortuosité à trois échelles, branches plus fines et plus pâles que le canal, bloom.
- *Le traceur sur réseau (escaliers)* : sites décalés par un hachage, puis subdivision fractale.
- *Coût du nuage* : marche bornée à l'enveloppe, tramage temporel, 40 pas (16 en mobile).
- *L'image bouchée entre les éclats* : la lampe de l'humeur éclaire toujours le sujet (médiane ≥ 0,1) ; l'éclair s'ajoute.
- *Le flash brûlé* : exposition fixe, épaule des hautes lumières, intensité dosée au posemètre à u = 0,60.

## e bis. Les trois épreuves

**Crédibilité**

| Temps | Cause visible | Loi | Temps |
| --- | --- | --- | --- |
| vapeur | le thé fume | convection, condensation au niveau de base | accéléré |
| nuage | la vapeur l'alimente par dessous | panache qui s'étale sous son plafond (enclume) | accéléré |
| charge | lueurs dans le nuage | décharges intra-nuage | accéléré |
| traceur | il part de la base du nuage | claquage diélectrique : p ∝ φ^η | caméra rapide |
| aigrette | la pointe la plus haute (cuillère, bouton, bord) | effet de pointe | caméra rapide |
| arc en retour | la jonction | onde qui remonte depuis le sol | temps réel |
| ombres | le canal est la source | lumière ponctuelle | — |
| rides | l'impact, puis chaque goutte | ondes capillaires amorties | temps réel |
| pluie | le nuage se vide | chute ; l'eau se conserve | temps réel |

Rien ne flotte sauf le nuage (qui est un nuage). La cuillère repose sur le fond et sur le bord de la tasse ; la tasse dans le creux de la soucoupe ; le couvercle sur sa gorge.

**Variété** (une phrase par humeur, sans couleur)

| Humeur | Décor | Lumière | Valeur | Cadrage |
| --- | --- | --- | --- | --- |
| Cinq heures | nappe de lin, mur lointain | fenêtre de côté, douce | claire | de face, bas |
| Plaque sensible | velours, fond absent | contre-jour seul, puis l'éclair | très sombre, noir et blanc | frontal, l'éclair plein cadre |
| Comptoir | zinc brossé qui renvoie l'éclair | plafonnier dur | moyenne, contrastée | plongée 50° |
| Céladon | natte tressée | zénithale très diffuse | très claire | trois-quarts serré |
| Laque | plateau laqué, théière de fonte | latérale rasante | sombre | bas, large |
| Heure bleue | marbre, mur de crépuscule | lueur de ciel, froide | moyenne-sombre | frontal large |
| Sèvres | marbre blanc | boîte à lumière haute | haute | trois-quarts |

**Ambition** — éléments de construction : paraison tournée à paroi épaisse, lèvre roulée, filet d'or, pied annulaire non émaillé, côtes, anse (oreille, attaches épaissies), soucoupe à cuvette et marli, cuillère (cuilleron, tige, spatule, bouton), couvercle à gorge et bouton, bec en col de cygne, anse mobile de tetsubin et ses oreilles, picots de fonte, jambe et pied du bol.

## e ter. Déclinaison et scénario

**Déclinaison** (le mouvement, pas la forme)
- *Tasse — coup au but* : un arbre renversé descend, hésite, une seule pointe gagne ; l'aigrette monte de la cuillère ; un trait.
- *Théière — ascendant* : l'arbre pousse **vers le haut** depuis le bouton du couvercle et s'épanouit en couronne sous le nuage.
- *Verre — araignée* : la décharge **rampe à l'horizontale** sous la base du nuage, en étoile, puis un seul fil tombe sur le bord du verre.
- *Bol — fourchu* : le traceur se divise tôt en **trois canaux** qui touchent le liquide l'un après l'autre ; trois arcs, trois trains de rides qui interfèrent.

**Scénario** (film muet, la tasse)
1. Une tasse de thé fume sur une nappe. La vapeur monte droit.
2. La vapeur s'accumule en un petit nuage rond qui bourgeonne, s'élève en tour, s'étale en enclume. Le niveau du thé a baissé d'un cheveu.
3. Le nuage fonce. Des lueurs le traversent. La caméra s'approche.
4. Sous la base, un fil violet naît et descend par à-coups ; il se divise, les branches cherchent. Tout est très lent.
5. Une branche approche de la cuillère. De son bouton monte une aigrette.
6. Elles se touchent : un trait blanc, de bas en haut. La tasse jette son ombre sur la nappe. Les branches s'éteignent.
7. Le trait bat trois fois, de plus en plus faible. Le thé ride autour de la cuillère.
8. Le trait se défait en perles et disparaît.
9. Il pleut dans la tasse. Le nuage pâlit, s'effiloche. Le niveau remonte.
10. Il ne reste que la tasse, qui fume.

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

## Révisions (13 novembre, après les premiers rendus)

Trois retours de l'utilisateur, dans l'ordre, et ce qu'ils ont changé.

1. **« La fumée devrait être ralentie lorsque l'éclair descend au ralenti. »** Tout ce qui bouge à l'échelle de la seconde lit maintenant une horloge lente (`clockAt`), presque arrêtée pendant le traceur.
2. **« La transition entre la fumée et le nuage n'est pas réaliste », puis « on sent encore trop que la fumée et le nuage sont deux objets séparés ».** Deux essais d'ajustement (panache évasé qui entre dans l'enveloppe du nuage ; densité liée au débit, front qui monte) ont été refusés l'un après l'autre : tant que la vapeur et le nuage étaient deux fonctions, on voyait deux objets. Ils sont devenus un seul fluide simulé (`gen/plume.js` : panache de Boussinesq axisymétrique dans un air stratifié, enregistré puis relu), dont le traceur est tout ce qu'on voit. Leçon : quand une chose doit en devenir une autre, calculer la transformation plutôt que raccorder deux modèles.
3. **« Il faudrait un scénario qui justifie que la fumée réapparaît dans la boucle. »** La cause est la foudre : elle réchauffe le thé. La cuillère en reste rouge, le thé frémit, et quand l'averse cesse la vapeur repart. Le cycle de l'eau commence donc à u = 0,96, et la boucle se lit : la foudre réchauffe le thé, le thé fait la vapeur, la vapeur fait le nuage, le nuage fait la foudre.
4. **« Les géométries des objets ne sont pas parfaites, par exemple la partie basse de l'anse. »** L'anse arrivait de biais sur la paroi et sortait de la matière au creux des côtes. Elle quitte maintenant la paroi le long de sa normale, les bouts noyés dans l'épaisseur. La soucoupe a perdu ses côtes, qui la rendaient polygonale.
5. **« Une ligne de démarcation au milieu de la fumée, juste sous le nuage. »** La couture des deux domaines de marche (extinction différente de part et d'autre). Même coefficient des deux côtés, la légèreté de la colonne passée dans la densité.
6. **« Les matières, particulièrement les sols, pourraient être plus travaillées. »** Les supports utilisaient les finitions communes (un sergé de carbone recoloré pour le lin, un motif de marbre en cellules). Sept shaders propres au projet (`scene/table.js`), chacun avec ce qui fait reconnaître la matière.

## Passe de direction artistique (13 novembre, soir)

Diagnostic : l'histoire se jouait là où la caméra ne regardait pas. Le thé était une ellipse de quelques pixels, la foudre tombait sur un bouton de cuillère suspendu à côté de la tasse, et rien ne disait ce qu'elle y faisait. Les trois remarques de l'utilisateur (ralenti trop long, éclair sans impact ni sens, géométries mal proportionnées et mal assemblées) en découlaient. Ce qui précède dans ce document décrit la version d'avant : la cuillère, les temps (0,34 – 0,60 pour le traceur, 0,96 pour la reprise) et la mention « L'appareil : aucun » ne valent plus.

1. **Ce que la foudre touche a un rôle.** Quatre machines à chauffer le thé, une par famille de récipient, pour varier les scènes : thermoplongeur à paratonnerre (tasse, verre), réchaud à spirale et son mât (théière boule), brasero (tetsubin, la foudre tombe sur l'arceau), pierres chaudes (bol, un arc par pierre). Elles restent domestiques : l'interdit du cliché n° 2 (l'appareil de laboratoire) tient toujours. La chaleur descend le métal depuis la pointe, la résistance rougit, le thé bout, la pluie grésille sur le métal chaud, et ces bouffées deviennent la colonne suivante.
2. **Le temps.** Traceur de 6,2 s à 2,8 s, en neuf bonds de plus en plus rapides, avec une retenue avant le dernier saut. Le temps gagné va à l'après-coup.
3. **L'impact.** Image brûlée puis iris qui se referme, mur qui prend l'éclair, étincelles, gouttes, bouffée, à-coup de la caméra ; canal à cœur fin, gaine violette et lueur d'air au lieu d'un boudin blanc.
4. **La caméra** plonge de 17 à 24° selon l'humeur et descend vers la machine après la jonction.
5. **Les géométries.** Anses en ruban à collerette, bec raccordé, godrons à arête vive sous un jonc, soucoupe à bassin et aile, piédouche de 12 %.
6. **Le nuage** n'est plus un palet (plan lobé, sommet bourgeonnant, colonne qui serpente) ; **la pluie** se voit (420 gouttes, éclat à l'impact).
7. **Les supports.** Veines du marbre affinées (on les prenait pour de la fumée), oxydation du zinc calmée.

Écartés : le samovar (une cinquième famille entière, à faire pour elle-même) ; la cuillère posée sur la soucoupe (elle n'a plus de rôle).

## Passe « une seule fumée » (14 novembre)

Remarque de l'utilisateur : « un manque de cohérence entre la fumée générée par la vapeur et la fumée qui forme ensuite le nuage ». Puis sa proposition : revoir le scénario, faire tomber la pluie après la formation du nuage et avant l'éclair, se passer de la vapeur séparée, et détailler davantage la fumée et le nuage.

Diagnostic (captures de toute la boucle, graine f9) : les bouffées n'avaient rien en commun avec la colonne simulée. Autre source (la résistance, décalée de 0,17 du centre de la tasse), autre rendu (images tournées vers la caméra, couleur unie, sans ombre, contre un volume éclairé par la lampe), autre bruit (lu dans le plan de chaque image : des boules de coton), autre mouvement (elles montaient d'un tiers de tasse puis flottaient), et un trou entre u = 0,93 et 1,0 où elles s'éteignaient avant que la colonne ne devienne visible.

1. **Le scénario.** Pluie (0,03 – 0,36, 70 % de l'eau) pendant que le nuage fonce, charge, traceur, foudre ; une bourrasque (0,51 – 0,60) rend le reste ; le nuage vidé se défait (jusqu'à 0,65) pendant que la colonne suivante part du thé, dès que la chaleur atteint la résistance (0,52). C'est plus juste que l'ordre précédent : dans un orage, les précipitations séparent les charges, et la bourrasque qui suit l'éclair existe. La pluie finit avant le ralenti du traceur (elle ne lit pas l'horloge lente). Le grésillement sur le métal chaud est gardé, par la bourrasque.
2. **Une seule matière.** Plus de sprites : le bouillon du choc est une impulsion de chaleur et de traceur au départ de la simulation, et le nuage qui se défait est lu dans le même champ (dernière image du cycle précédent, enveloppe qui baisse, érosion par lambeaux).
3. **Le détail.** La colonne était un tuyau lisse : une deuxième déformation turbulente, des filaments (Worley étiré dans le sens de la montée, lu à travers cette déformation) et une rampe de densité plus longue en font un voile filandreux. L'octave fine des bourgeons pèse un peu plus sur les bords du nuage. Environ 3 ms de plus en 1920 × 1080 (voir le README).

Écarté : monter la fréquence de l'octave fine (6,1 → 8,3) : plus de grain, mais 2 ms de plus pour un gain que le flou de profondeur et l'anticrénelage effacent en partie. Des filaments strictement verticaux : ils se lisaient comme une pluie.

