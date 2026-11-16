# Erosion — document de travail

Thème donné : « Erosion », avec une exigence explicite : un rendu cinématographique de grande qualité, donc une manière de traiter le thème qui permette, par la seule génération procédurale, un rendu extrêmement convaincant.

Le projet s'appelle **Erosion** (dossier `erosion/`), sous-titre *un paysage d'une heure* : ce que fabrique une table à érosion de laboratoire : un relief entier (canyons, terrasses, deltas) creusé en une heure dans un bac de sable, puis effacé d'un coup de règle.

## Pourquoi cette piste répond à l'exigence de rendu

La génération procédurale est la plus convaincante quand le réel lui-même est le produit d'un processus simple et local : une loi d'écoulement et de transport appliquée des milliers de fois donne d'elle-même ce que l'œil reconnaît comme vrai (les réseaux dendritiques, les berges effondrées, les éventails, les terrasses emboîtées). Ce n'est pas une texture qui imite un paysage : c'est le paysage qui se fait. Les logiciels de relief (World Machine, Gaea, Houdini) le savent : sans érosion simulée, un terrain de bruit fractal ne trompe personne ; avec elle, il trompe tout le monde.

Mais un paysage à l'échelle géologique pose deux problèmes : la cause (des millions d'années de pluie) ne se montre pas, et la boucle n'existe pas (l'érosion ne revient jamais en arrière). La **table à érosion** (stream table, flume) les résout tous les deux : la cause est un objet (une boîte d'alimentation, une rampe de pluie, une vanne), le temps est celui d'une expérience (une heure, en accéléré), et le laboratoire **remet le bac à zéro** à la fin, avec un gabarit qui repasse le sable. Elle garde la beauté du paysage (vu de près, un bac de sable creusé ne se distingue pas d'une photographie aérienne : c'est le jeu d'échelle que les photographes de rides de plage connaissent bien) et elle ajoute ce que le paysage n'a pas : une matière qu'on peut filmer en macro (le grain de sable, le film d'eau, la frange humide qui sèche), un appareil de musée, et une remise à zéro physique.

## a. Le thème en largeur

**La physique.**
- **Équations de Saint-Venant** (eaux peu profondes) : l'eau d'une lame mince s'écoule sous la pente de sa surface libre ; le **modèle des tuyaux virtuels** (O'Brien et Hodgins 1995, Mei, Decaudin et Hu 2007, Šťava et al. 2008) les résout sur une grille : chaque cellule échange avec ses quatre voisines un flux accéléré par la différence de hauteur d'eau, borné pour ne jamais vider une cellule plus qu'elle ne contient.
- **Capacité de transport** : une eau qui coule vite et en pente peut porter du sédiment, C = K_c · sin α · |v| ; si elle en porte moins, elle arrache le lit, sinon elle dépose. C'est ce qui creuse à l'amont et construit à l'aval, et fait les deltas : à l'entrée d'un lac, la vitesse tombe, le sable se dépose en éventail.
- **Contrainte de cisaillement critique** (Shields) : un grain ne bouge qu'au-dessus d'un seuil θ_c ≈ 0,05 ; sous lui, rien.
- **Érosion régressive** : une rigole qui commence à se creuser concentre l'eau, ce qui la creuse davantage ; sa tête remonte la pente et se ramifie — les réseaux dendritiques des badlands, les « ravines ».
- **Point d'inflexion** (knickpoint) : quand le niveau de base baisse (la mer, le lac, la vanne), une marche se forme à l'embouchure et remonte la vallée, laissant derrière elle des **terrasses emboîtées** (l'histoire de chaque canyon).
- **Avulsion** : un chenal qui construit son delta s'exhausse au-dessus de la plaine, déborde et saute d'un côté ; le delta grandit en lobes successifs (le Mississippi, le Gange — et chaque table de laboratoire en quelques minutes).
- **Rupture de barrage** : un barrage de sable déversé s'entaille ; la brèche s'approfondit et s'élargit à mesure que le débit grandit, ce qui l'agrandit encore — une croissance exponentielle, puis la vidange (Teton 1976, et toutes les expériences de brèche en canal).
- **Angle de talus** : sable sec ~32–34°, sable humide jusqu'à 60–80° grâce aux ponts capillaires (les châteaux de sable), sable saturé ou immergé moins de 30° ; une berge sapée à son pied s'effondre en blocs (érosion latérale, élargissement des chenaux).
- **Érosion différentielle** : les couches dures (grès cimenté) font des corniches et des falaises, les tendres (argile, limon) des pentes ; d'où les mesas, les cheminées de fée, les terrasses du Grand Canyon.
- **Rides de courant** : sous un écoulement de sable fin, le lit se couvre de rides de 1–2 cm de longueur d'onde, perpendiculaires au courant, qui migrent à l'aval ; elles restent quand l'eau s'en va.
- **Séchage** : un sable mouillé est deux fois plus sombre (l'eau remplit les pores, l'indice change) ; il sèche d'abord sur les crêtes, puis la frange capillaire recule vers l'eau.
- **Facteur d'accélération morphologique** (MORFAC, Lesser et al. 2004, Delft3D) : en modélisation, on multiplie les variations du lit par un facteur pour qu'une heure d'hydraulique fasse des jours de morphologie. C'est exactement notre convention de temps : l'eau coule à sa vitesse, le relief change en accéléré.

**Les métiers et les objets.**
- Les **tables à érosion** pédagogiques (Emriver, Little River Research & Design : un bac de 1,8 m incliné, un sable plastique de couleurs codées par granulométrie, une pompe et une boîte d'alimentation) ; les grands bassins de recherche : XES (eXperimental EarthScape, St Anthony Falls Laboratory, un sol qui s'enfonce), l'Eurotank d'Utrecht (deltas de 6 × 11 m), le Jurassic Tank.
- Leurs pièces : **boîte d'alimentation** (headbox) qui calme l'eau et la déverse par une lèvre ; **débitmètre à flotteur** (rotamètre : un tube de verre, un flotteur qui monte avec le débit) ; **vanne de sortie** à guillotine (un seuil réglable qui fixe le niveau de base) ; **rampe de pluie** (aiguilles calibrées, gouttes de 2 mm) ; **chariot de mesure** sur rails, avec son laser de profil ; **gabarit** (screed) qui remet le sable en forme ; vérins de basculement.
- Les **géomorphologues** de terrain : coupes stratigraphiques, carottes, lames minces ; les photographes aériens (Bernhard Edmaier, Yann Arthus-Bertrand, Edward Burtynsky).
- Les **jardiniers zen** (karesansui, le râteau qui redessine le gravier : un autre gabarit qui efface).

**L'art, la photographie, le cinéma.**
- Les photographies aériennes des deltas (Lena, Betsiboka), des badlands (Bardenas, Dinosaur Park), des canyons en fente (Antelope) — et leurs clichés : le canyon orangé au soleil couchant, le delta en fausses couleurs vu par satellite.
- Les rides de plage (« beach rills ») qui imitent un arbre : l'image virale du « paysage de 20 cm ».
- Les maquettes du cinéma (miniatures filmées à grande vitesse et en tilt-shift : l'échelle trahie par la profondeur de champ).
- Andy Goldsworthy et le temps qui défait les œuvres ; les falaises de Normandie de Monet ; le mandala de sable tibétain balayé à la fin.

**Le vocabulaire.** Ravine, rigole, ravinement, badlands, cheminée de fée, mesa, butte-témoin, corniche, talus, éboulis, terrasse, knickpoint (rupture de pente), niveau de base, cône de déjection, delta, lobe, avulsion, chenal, tresse, méandre, berge, sapement, charge de fond, suspension, turbidité, ride, dune, lit, thalweg, interfluve, bassin versant, crue, brèche, déversoir, **gabarit**, régalage.

**Les cycles et transformations.** La roche → le sable → le delta → la roche (diagenèse) : le grand cycle des sédiments. À l'échelle d'une table : le sable régalé → la pluie ou le courant → les ravines, les deltas → la vidange → le séchage → le gabarit qui remet tout à plat. Le gabarit pousse la matière déposée à l'aval vers l'amont où elle manque : la masse se conserve, c'est elle qui referme la boucle.

**La lumière.** Le sable sec est un diffuseur très clair et presque mat, piqué de **paillettes** (faces de quartz, micas) sous une lumière rasante ; mouillé, il fonce de moitié et prend un film brillant ; l'eau mince est presque invisible sauf par ses reflets et l'ombre de ses rides (caustiques sur le fond), l'eau chargée devient opaque et ocre ; les strates colorées se lisent sur les parois des canyons. La lumière rasante est la lumière du relief : chaque rigole se dessine par son ombre. Au contre-jour, chaque filet d'eau devient un fil d'argent.

## b. Les clichés

1. Le **survol de canyon** orangé au soleil couchant (le terrain fractal de démo, avec de l'eau bleue en aplat).
2. La **falaise qui s'effondre** dans la mer (l'érosion littorale en accéléré).
3. Le **visage ou la statue érodés** (le temps qui efface un monument, par un fondu de bruit).
4. La **goutte qui creuse la pierre** (« la goutte d'eau creuse la roche »).
5. Le **château de sable** emporté par la vague.

## c. Les pistes

1. **La table à érosion.** Un bac de sable stratifié incliné, une source (boîte d'alimentation, rampe de pluie, lac derrière un barrage, vanne de sortie) ; l'eau creuse un paysage en une heure accélérée ; vidange, séchage, puis un gabarit sur portique repasse le sable et rend la surface initiale. Boucle : cycle de transformations dont l'état final est l'état initial par construction (le gabarit écrit la surface de départ derrière lui). Cœur : Saint-Venant par tuyaux virtuels + transport de sédiments + talus, sur GPU, enregistré et relu.
2. **Le grès et le vent.** Une arche de grès sculptée par le sable que porte le vent (abrasion éolienne, tafoni, alvéoles en nid d'abeilles) ; boucle : une arche s'effondre, la suivante se forme plus loin. Géologiquement juste, mais le vent ne se voit pas, et la boucle triche.
3. **La falaise de craie.** Le pied de falaise sapé par les vagues, une encoche, un pan qui tombe, la plage qui se reforme ; cliché 2, et la boucle exige que la falaise repousse.
4. **Le galet.** Un galet roulé dans un tambour de polissage (attrition) avec ses semblables, de l'anguleux au rond ; geste lisible, mais une forme qui ne fait que s'arrondir n'a rien à montrer (règle 20) et le tambour cache tout.
5. **La karstification.** Un bloc de calcaire dissous par l'eau acide : lapiaz, cannelures, une grotte qui s'ouvre ; joli, mais très lent et presque sans eau visible ; la boucle demande de reconstruire la roche.
6. **La sculpture de glace.** Un bloc de glace sculpté par un filet d'eau tiède (érosion thermique, coups de gouge de l'écoulement, « scallops ») ; Melt a déjà fait la fonte.
7. **Le mandala balayé.** Un mandala de sable coloré dessiné grain par grain, puis balayé ; érosion au sens figuré, geste de Fold (un motif qui se construit puis se défait) et peu de physique.
8. **L'éolienne de sable.** Des dunes qui migrent dans un tunnel à vent (barkhanes) ; boucle exacte possible (la dune migre d'une période), mais une seule forme qui glisse — monotone.
9. **Le relief géologique.** Un massif soulevé par la tectonique et érodé à l'équilibre (loi de la puissance du courant, FastScape) ; magnifique en survol, mais cliché 1, cause invisible, et la boucle n'est qu'un régime permanent.

## d. Notes

| Piste | Originalité | Esthétique | Boucle | Cœur | Variations | Faisabilité | Total |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1. Table à érosion | 5 | 5 | 5 | 5 | 5 | 3 | **28** |
| 2. Grès et vent | 4 | 4 | 2 | 3 | 3 | 3 | 19 |
| 3. Falaise de craie | 2 | 4 | 2 | 3 | 3 | 3 | 17 |
| 4. Galet | 3 | 3 | 3 | 3 | 2 | 4 | 18 |
| 5. Karst | 4 | 3 | 2 | 3 | 3 | 3 | 18 |
| 6. Glace sculptée | 3 | 4 | 3 | 3 | 2 | 3 | 18 |
| 7. Mandala | 3 | 4 | 4 | 2 | 3 | 4 | 20 |
| 8. Dunes | 4 | 3 | 5 | 3 | 2 | 4 | 21 |
| 9. Relief géologique | 2 | 5 | 2 | 5 | 3 | 3 | 20 |

Retenue : **la table à érosion**. Elle absorbe le relief géologique (le paysage qu'elle fabrique est le même, à une autre échelle : on ne le distingue pas d'une vue aérienne), le mandala (le geste du gabarit qui efface), et la falaise (les berges sapées qui s'effondrent).

Différence avec les projets du dépôt : aucun ne simule un fluide sur un relief ; Moss propage un champ sur une pierre (Fisher-KPP, une colonie), Rust fait naître une matière sur une pièce et une machine l'enlève. Ici la matière **est** déplacée (la masse se conserve), le geste est un écoulement qui sculpte, la machine (le gabarit) ne nettoie pas : elle repousse le sable là d'où l'eau l'a pris. La grammaire de caméra est un vol bas au-dessus du paysage, pas une révolution ni un plan fixe.

## e. La piste retenue, telle qu'elle est construite

### Le geste

Un écoulement qui creuse : l'eau entre dans le sable, s'y fait un chemin, le chemin s'approfondit, se ramifie ou se déplace, et le sable arraché va se déposer plus loin. Puis l'eau se retire, le paysage sèche et se révèle ; un gabarit le repasse et le fait disparaître.

### Le cœur technique

1. **Hydraulique** : modèle des tuyaux virtuels (Mei et al. 2007) sur une grille de 512 × 256 cellules de 2,5 mm (bac utile de 1,28 × 0,64 m), pas de 1,4 ms ; eau ajoutée par les sources (lèvre de la boîte, simulateur de pluie), retirée par le déversoir (guillotine dont la crête fixe le niveau du lac). Frottement de Manning (n = 0,022).
2. **Transport** : cisaillement de Manning, capacité de Meyer-Peter–Müller au-dessus du seuil de Shields, arrachement vers la capacité à un taux qui dépend de la **dureté de la strate** atteinte, dépôt au taux w_s/d ; le sédiment suit les flux d'eau eux-mêmes (conservatif) ; MORFAC de 30 à 50 sur les variations du lit.
3. **Talus** : redistribution du sable au-delà de l'angle de talus, 62° pour le sable humide (cohésion capillaire), 30° sous l'eau : berges nettes et effondrements.
4. **Strates** : le bac est rempli couche par couche, chacune régalée par le gabarit (épaisseur, ton, dureté tirés par la graine) ; un point du lit montre la couche de sa profondeur sous b₀ s'il n'a jamais été plus bas, un dépôt frais sinon.
5. **Enregistrement** : 480 états du lit (b − b₀ en demi-flottant, 512 × 256), 96 de sa mémoire (humidité, rides) et 192 de l'eau (256 × 128), ~245 Mo sur le GPU ; le lit est préfiltré (moyenne des pas de chaque intervalle) puis lissé passe-bas sans déphasage, et relu en B-spline cubique dans le temps.
6. **Gabarit** : la remise à zéro est une fonction fermée de la position de la lame : derrière elle, la surface initiale ; devant, le relief enregistré plus un bourrelet à 33° dont le volume est la matière poussée (intégrale de b − b₀ le long du trajet, lissée en travers sur 4 cm).

Invariants vérifiés par les tests : masse de sable conservée hors du déversoir, masse d'eau conservée, h ≥ 0, pas de NaN, déterminisme, l'état à u → 1 est l'état à u = 0, le bord bas de la lame est exactement b₀, la lame balaie tout le bac sans revenir en arrière, le séchage ne recule pas, la caméra ne passe jamais sous le sable ni près d'une pièce de l'appareil.

### La boucle

Cycle de transformations à un état : sable régalé → (écoulement) → paysage mouillé → (vidange, séchage) → paysage sec → (gabarit) → sable régalé. À u = 0 et à u → 1 : la surface b₀, sans eau, le portique garé au-dessus de la boîte d'alimentation. **La boucle est parfaite par construction** : la simulation part de b₀, et le gabarit réécrit b₀ derrière lui.

### Découpage temporel (boucle de 44, 48 ou 52 s, `src/timeline.js`)

| u | Temps | Ce que l'œil regarde | Cause visible | Temps du film |
| --- | --- | --- | --- | --- |
| 0 – 0,05 | le sable neuf | la surface lisse, les fines stries du gabarit | — | — |
| 0,05 – 0,68 | l'expérience | l'eau arrive, le geste de la famille grandit, puis la source se tarit et l'eau s'infiltre | la boîte, la pluie, la guillotine, la digue | eau en temps réel (un peu ralentie), relief accéléré (MORFAC) |
| 0,66 – 0,78 | le séchage | le paysage pâlit des crêtes vers les creux | — | accéléré |
| 0,775 – 0,83 | le portique roule vers l'aval et descend sa lame | — | moteur, vérins | temps réel |
| 0,83 – 0,95 | le gabarit | le bourrelet pousse le sable vers l'amont, la surface neuve derrière | la lame | temps réel |
| 0,95 – 1 | la lame se lève, le portique rentre | — | — | — |

Le temps fort est au milieu de l'érosion, et la plus belle image au séchage : le paysage entier, sec, en lumière rasante, avec ses strates.

### Les familles (déclinaison : chacune son mouvement)

1. **Ravines** : le simulateur de pluie arrose un plateau, un escarpement et un glacis ; des rigoles naissent au pied de l'escarpement et **remontent** en se ramifiant. Les interfluves restent en lames.
2. **Delta** : un seul courant entre par la boîte d'alimentation, creuse son chenal pilote et construit un **éventail** dans le lac aval ; le panache de turbidité tourne.
3. **Recul** : un courant établi coule vers le lac ; la guillotine s'abaisse de deux ou trois crans : à chaque cran, une **marche** naît à l'embouchure et remonte la vallée, laissant des terrasses emboîtées.
4. **Brèche** : un lac se remplit derrière une digue de sable ; il déborde par une échancrure, la brèche **s'élargit en accélérant**, le lac se vide en crue et creuse un canyon.

Le méandre, prévu d'abord, est écarté (voir plus bas). Quatre mouvements, quatre silhouettes : arbre qui remonte, éventail, vallée en gradins, entaille puis canyon.

### La matrice de variations

| Axe | Valeurs |
| --- | --- |
| Famille | ravines, delta, recul, brèche |
| Sable (accord des strates) | silice et kaolin, grès rouge, basalte, ocres, limon, glauconie et craie |
| Stratigraphie | lits fins réguliers, bancs durs et tendres (corniches), chapeau dur, sable uniforme |
| Forme initiale (gabarit) | propre à la famille : plateau, escarpement et glacis ; pente, rupture et lac ; cuvette, digue et pente ; chenal pilote ou échancrure au nez de la lame |
| Humeur (décor) | sept, voir ci-dessous ; chacune préfère trois ou quatre sables |
| Cadrage | six plans montés cut (ensemble, ras du sable, gros plan, carte, séchage, lame), côté du bac tiré |
| Rythme | durée 44, 48 ou 52 s, nombre de crans de la guillotine, position de la source |

### Les humeurs (épreuve de variété, sans parler de couleur)

| Humeur | Décor | Lumière | Valeur |
| --- | --- | --- | --- |
| **Laboratoire** | hall d'essais, murs gris moyen | grandes boîtes zénithales, lampe de biais | moyenne |
| **Fin de jour** | atelier sombre, une grande fenêtre | soleil bas et dur, de biais arrière | contrastée |
| **Lampe rasante** | pièce noire | une lampe au ras du sable, de côté | très sombre |
| **Cyclorama** | cyclorama blanc | une lampe assez basse, appoint léger | très claire |
| **Verrière** | sous une verrière, ciel couvert | ciel diffus mais orienté | moyenne |
| **Contre-jour** | fond noir | une lampe derrière le bac, face à la caméra : l'eau scintille | sombre |
| **Midi** | dehors | soleil haut et dur | très claire |

Chaque lampe principale reste à moins de ~55° au-dessus du sable : sous une lumière zénithale, un relief de quelques millimètres disparaît.

### Épreuve de crédibilité

| Temps | Cause visible | Loi | Convention |
| --- | --- | --- | --- |
| l'eau arrive | la boîte d'alimentation déborde par sa lèvre (le flotteur du débitmètre monte) ; les gouttes tombent du simulateur ; le lac monte derrière la digue | Saint-Venant | temps réel |
| l'érosion | l'eau qui coule, ses rides, sa turbidité | Meyer-Peter–Müller, Shields, talus | MORFAC (relief accéléré ×30 à ×50) |
| le recul | la guillotine descend par crans, le lac baisse | niveau de base | temps réel |
| le séchage | — (le sable pâlit) | frange capillaire | accéléré |
| le gabarit | le moteur du portique, la lame qui descend et touche le sable | conservation de la masse (le bourrelet) | temps réel |

Rien ne flotte : la table repose sur ses pieds et ses vérins ; la boîte est au bout amont ; le simulateur de pluie est porté par quatre montants ; la guillotine coulisse dans ses glissières ; le portique roule sur deux rails ronds.

### Épreuve d'ambition (construction de l'appareil)

Bac (fond, parois d'acrylique clair qui laissent voir la coupe des strates, profilés d'aluminium), piétement (pieds réglables, traverses, vérins de basculement à volant), boîte d'alimentation (caisson inox, goulotte en biseau, robinet à volant, débitmètre à flotteur), déversoir (caisson, glissières, guillotine à crémaillère et volant, tuyau de sortie), portique (rails ronds sur supports, chariots à galets, poutre, moteur pas à pas, vérins de descente, lame-gabarit), simulateur de pluie (montants, caisson à aiguilles). Le sable porte trois échelles : le relief simulé, les rides, le grain.

### Épreuve d'échelle et références

Références photographiques que tout photographe du sujet ferait :
1. **Une table Emriver vue de trois quarts** : un bac de 1,8 × 0,6 m, chenal de 2–5 cm de large et 1–2 cm de profondeur, eau claire presque invisible sauf par ses reflets, delta en éventail de 20–30 cm à l'aval.
2. **Rigoles de plage à marée descendante** : des réseaux dendritiques de 2 à 30 cm, des chenaux de 2–10 mm, le sable plus sombre où l'eau coule encore, contre-jour qui fait scintiller les filets.
3. **Eurotank / XES vus d'en haut** : deltas en lobes, panaches de turbidité dans le lac, terrasses à chaque baisse du niveau de base.
4. **Badlands des Bardenas en vue aérienne rasante** : lames aiguës entre les ravines, couches dures en corniches, couleur par strates ; c'est l'image que le plan du séchage doit rappeler.
5. **Coupe de canyon en fente** (Antelope) : strates fines qui ondulent sur les parois.

Ce qu'elles imposent : les chenaux font de 4 à 40 mm (2 à 16 cellules), les rides 1–2 cm, les grains ~0,3 mm ; les berges sont nettes (talus humide raide), les interfluves aigus. Le maillage du sable est le double de la grille (1 024 × 512) ; en dessous de la cellule, le shader ajoute les rides de courant, les stries du gabarit et le grain. Un gros plan ne descend pas sous ~35 cm de cadre (140 cellules) : plus près, on verrait l'interpolation du relief.

### Images clés

1. **Le delta à mi-film** (Fin de jour) : caméra basse au-dessus du lac, le soleil rasant de trois quarts arrière ; l'eau du lac turbide où le panache tourne ; l'éventail de sable clair, chaque bras de chenal en fil d'argent.
2. **Les ravines sèches** (Lampe rasante) : une seule lampe au ras du sable, un réseau d'arbres noirs et de crêtes claires, les strates lisibles sur chaque flanc.
3. **Le gabarit** (Laboratoire) : la lame qui remonte le bac, le bourrelet de sable qui roule devant elle et comble les canyons ; derrière, la surface neuve, striée.

### Risques et parades

- **Eau illisible ou en aplat bleu** : l'eau n'a pas de couleur propre ; absorption (Beer-Lambert), turbidité, reflets, rides advectées ; jamais une teinte bleue.
- **Relief en escaliers ou bruité** : talus, interpolation monotone lissée le long des crêtes, normales en B-spline bicubique.
- **Simulation instable** : flux bornés, profondeur plancher pour la vitesse, tests de conservation dans Node.
- **Temps de chargement** : la simulation tourne sur le GPU (17 500 à 19 000 pas en 4 à 5,5 s) ; l'écran de chargement montre la carte du relief qui se creuse.
- **Le gabarit qui fait magie** : le bourrelet porte la matière, se gonfle sur les dépôts, se vide dans les creux.
- **Trop de laboratoire, pas assez de paysage** : le bâti est laqué dans la valeur du lieu, ne porte pas d'ombre sur le sable, et les plans larges sont cadrés sur le bac.

### L'écran de chargement

La carte du relief de cette graine vue d'en haut, ombrée en lumière rasante et colorée par strates, qui se creuse en direct pendant la simulation sur le GPU (aperçus lus à 128 × 64).

## f. Ce que les essais ont appris

- **Pas de méandre.** Le modèle des tuyaux virtuels n'a ni courants secondaires ni cohésion latérale des berges : un faible courant y fait un chenal droit qui s'élargit.
- **Les strates suivent le gabarit.** Des couches horizontales recoupaient la pente et couvraient la surface neuve de chevrons de couleur avant l'arrivée de l'eau.
- **Un chenal pilote et une échancrure**, dessinés par le nez de la lame : sans eux, le courant du delta s'étale en nappe et la digue déborde sur toute sa crête.
- **La loi de transport.** Une capacité en |v|·pente creusait un fossé à fond plat ; Meyer-Peter–Müller au-dessus de Shields, avec le cisaillement de Manning, concentre l'eau en chenaux. L'advection semi-lagrangienne du sédiment perdait la moitié du sable.
- **La pluie** à 0,6 mm/s abaissait tout le plateau en nappe ; à 0,35 mm/s, seule l'eau concentrée dans les ravines creuse.
- **La lumière** est définie par rapport au côté où vole la caméra (de biais arrière ou à contre-jour) : de face, le relief s'aplatit.
- **Le sable est la vedette.** Une planche de sept graines montrait rails, profilés et portique sur 30 à 50 % du cadre, en lignes les plus contrastées. D'où le bâti laqué au ton du lieu, sans ombre sur le paysage, et les plans larges recadrés sur le bac.
- **Une lame cachée par l'acrylique.** Sa course allait 3 cm au-delà de chaque bout du sable sans que l'image le montre ; un test la confronte maintenant aux pièces fixes à chaque instant.
- **Les dépôts se mêlent à leur lit.** Une couleur de dépôt qui bascule dès 0,6 mm dessinait des aplats de camouflage ; le placage passe progressivement de quelques grains épars à une couverture pleine vers 2,5 mm.
- **Le « stop motion »** venait du lit qui bouillonne sous le MORFAC et d'un minimum lu dans une mémoire à part, pas de l'interpolation : préfiltre, passe-bas sans déphasage et minimum tiré de la courbe affichée (voir le README).
