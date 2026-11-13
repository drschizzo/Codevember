# Erosion — document de travail

Thème donné : « Erosion », avec une exigence explicite : un rendu cinématographique de grande qualité, donc une manière de traiter le thème qui permette, par la seule génération procédurale, un rendu extrêmement convaincant.

Le projet s'appelle **Erosion** (dossier `erosion/`), sous-titre *un paysage d'une heure* — ce que fabrique une table à érosion de laboratoire : un relief entier (canyons, terrasses, deltas) creusé en une heure dans un bac de sable, puis effacé d'un coup de règle.

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

## e. La piste retenue

### Le geste

Un écoulement qui creuse : l'eau entre dans le sable, s'y fait un chemin, le chemin s'approfondit, se ramifie ou se déplace, et le sable arraché va se déposer plus loin. Puis l'eau se retire, le paysage sèche et se révèle ; un gabarit le repasse et le fait disparaître.

### Le cœur technique

1. **Hydraulique** : modèle des tuyaux virtuels (Mei et al. 2007) sur une grille de 512 × 256 cellules de 2,5 mm (bac utile de 1,28 × 0,64 m), pas de temps borné par la condition CFL ; eau ajoutée par les sources (lèvre de la boîte, rampe de pluie), retirée par le déversoir (vanne de sortie dont la crête fixe le niveau du lac).
2. **Transport** : capacité C = K_c · max(sin α, α_min) · |v| · f(h) (atténuée en eau profonde), érosion ou dépôt vers la capacité, à un taux qui dépend de la **dureté de la strate** atteinte ; sédiment advecté par semi-lagrangien ; MORFAC sur les variations du lit.
3. **Talus** : redistribution du sable au-delà de l'angle de talus, plus raide pour le sable humide (cohésion capillaire) que pour le sable immergé ; c'est ce qui fait les berges nettes et leurs effondrements.
4. **Strates** : le corps de sable est un empilement de couches (épaisseur, couleur, dureté tirées par la graine) ; un point du lit montre la couche de son altitude s'il n'a jamais été plus bas (surface d'origine), un dépôt frais sinon (on garde le minimum atteint, `bmin`).
5. **Enregistrement** : 64 états du relief (b, bmin) à pleine résolution et 128 états de l'eau (surface libre η, turbidité, vitesse) à demi-résolution, dans des textures en tableau sur le GPU ; relecture interpolée.
6. **Gabarit** : la remise à zéro est une fonction fermée de la phase : derrière la lame, la surface initiale ; devant, le relief enregistré plus un bourrelet dont le volume est la matière poussée (intégrale de b − b₀ le long du trajet, lissée en travers de la lame).

Invariants vérifiables : masse d'eau (entrées − sorties − évaporation), masse de sable conservée hors du déversoir, h ≥ 0, pas de NaN, l'état à u = 1 est l'état à u = 0 (le gabarit écrit b₀), la lame touche exactement la surface b₀ (écart nul), les fronts ne reculent pas pendant leur temps (le knickpoint remonte toujours, la brèche ne se referme jamais), la caméra ne passe jamais sous le sable.

### La boucle

Cycle de transformations à un état : sable régalé → (écoulement) → paysage mouillé → (vidange, séchage) → paysage sec → (gabarit) → sable régalé. À u = 0 et à u = 1 : la surface b₀ toute fraîche, sèche, sans eau, le portique garé au bout amont. **La boucle est parfaite par construction** : la simulation part de b₀, et le gabarit réécrit b₀ derrière lui ; à la fin de son passage, tout le bac est b₀.

### Découpage temporel (durée par défaut 48 s)

| u | Temps | Ce que l'œil regarde | Cause visible | Loi | Temps du film |
| --- | --- | --- | --- | --- | --- |
| 0 – 0,05 | le sable neuf | la surface lisse, les fines stries du gabarit, la lumière rasante | — | — | — |
| 0,05 – 0,12 | l'eau arrive | la boîte se remplit et déborde, ou la pluie commence, ou le lac monte | la source (lèvre, rampe, pompe) | Saint-Venant | temps réel |
| 0,12 – 0,62 | l'érosion | le geste de la famille, qui grandit | l'écoulement | transport, talus | relief accéléré (MORFAC), eau en temps réel |
| 0,62 – 0,70 | la vidange | la source se tarit, l'eau se retire dans les chenaux, le lac baisse | vanne qui s'ouvre, source coupée | Saint-Venant | temps réel |
| 0,70 – 0,82 | le séchage | le paysage pâlit des crêtes vers les creux, les strates se lisent | évaporation | — | accéléré |
| 0,82 – 0,97 | le gabarit | la lame descend, le portique roule, le bourrelet pousse le sable, la surface neuve derrière | moteur du portique | conservation de la masse | temps réel |
| 0,97 – 1 | le sable neuf | — | — | — | — |

Le temps fort est au milieu de l'érosion (u ≈ 0,4), et la plus belle image est au séchage (u ≈ 0,78) : le paysage entier, sec, en lumière rasante, avec ses strates.

### Les familles (déclinaison : chacune son mouvement)

1. **Ravines** — une rampe de pluie arrose toute la pente ; des milliers de filets se rejoignent, des rigoles naissent au bas de la pente et **remontent** en se ramifiant : un arbre qui pousse vers l'amont. Les interfluves restent en lames aiguës (badlands).
2. **Delta** — un seul courant entre par la boîte d'alimentation, creuse son chenal et construit un **éventail** dans le lac aval ; l'éventail grandit en lobes, le chenal **bascule** d'un bord à l'autre (avulsion), le panache de turbidité tourne avec lui. Un geste qui s'ouvre et balaie.
3. **Recul** — un courant établi coule vers le lac ; la vanne s'abaisse d'un cran puis d'un autre : à chaque cran, une **marche** naît à l'embouchure et remonte la vallée, laissant des terrasses emboîtées. Un geste qui remonte par saccades.
4. **Brèche** — un lac se remplit derrière un barrage de sable ; il déborde par une échancrure ; le filet entaille le barrage, la brèche **s'élargit en accélérant**, le lac se vide en crue et creuse un canyon à l'aval. Un geste qui se rompt.
5. **Méandre** (rare, une graine sur six) — un faible débit sur une pente douce dans un sable cohésif : le chenal sinue, ses berges concaves reculent, des barres se déposent sur les convexes. Un geste qui serpente.

Épreuve de déclinaison : pluie partout → arbre qui remonte ; un courant → éventail qui balaie ; niveau de base qui baisse → marche qui remonte par crans ; lac qui déborde → rupture qui s'accélère ; faible courant → serpentement latéral. Cinq mouvements différents, cinq silhouettes (arbre, éventail, vallée en gradins, entaille en V puis canyon, ruban sinueux).

### La matrice de variations

| Axe | Valeurs |
| --- | --- |
| Famille | ravines, delta, recul, brèche, méandre |
| Sable (accord des strates) | silice et kaolin (blanc, crème, une couche grise) ; grès rouge (rouge, ocre, blanc, rouille) ; basalte (noir, gris, une couche blanche) ; ocres (jaune, orange, rouge, violet) ; limon (gris beige, brun, sable) ; vert (glauconie et craie) |
| Stratigraphie | régulière fine ; épaisse alternée dure/tendre (corniches) ; une couche dure seule (mesa) ; inclinée (couches pentées) ; uniforme (sable pédagogique) |
| Forme initiale (gabarit) | pente plane ; vallée en V ; plateau et talus ; double pente (dôme) ; bourrelet transversal (barrage) |
| Humeur (décor) | voir ci-dessous |
| Cadrage | vol bas dans l'axe, travelling latéral, plongée haute, rase-mottes à contre-jour |
| Rythme | durée 36–64 s, part de l'érosion, nombre de crans de la vanne, intensité de la pluie |

Soit plus de 5 × 6 × 5 × 5 × 7 × 4 ≈ 21 000 combinaisons de structure, plus les tirages continus.

### Les humeurs (épreuve de variété, sans parler de couleur)

| Humeur | Décor (fond, sol, accessoires) | Lumière | Valeur | Cadrage |
| --- | --- | --- | --- | --- |
| **Laboratoire** | hall d'essais : fond gris moyen, sol de béton, châssis d'aluminium | grandes boîtes à lumière zénithales, douces | moyenne claire | plongée à 55° |
| **Fin de jour** | atelier sombre, une grande fenêtre de côté | soleil bas, dur, rasant, ombres longues | contrastée | vol bas dans l'axe, face au soleil de trois quarts |
| **Lampe rasante** | pièce noire | une lampe dure presque au ras du sable, une seule | très sombre (low key) | travelling latéral |
| **Cyclorama** | cyclorama blanc, table claire | lumière enveloppante d'en haut, ombres douces | très claire (high key) | plongée haute |
| **Verrière** | sous une verrière, ciel couvert | ciel diffus, un peu bleuté, ombres nulles | moyenne | rase-mottes |
| **Contre-jour** | fond noir | une lampe derrière le bac, face à la caméra : l'eau scintille | sombre, hautes lumières sur l'eau | rase-mottes face à la lampe |
| **Midi** | dehors, sous le soleil (bac de jardin d'expérimentation), fond de ciel pâle | soleil haut, dur | très claire | plongée |

Sept phrases qui ne se ressemblent pas : quatre directions de lumière (zénithale, rasante latérale, contre-jour, haute dure), trois valeurs (claire, moyenne, sombre), quatre cadrages.

### Épreuve de crédibilité

| Temps | Cause visible | Loi | Convention |
| --- | --- | --- | --- |
| l'eau arrive | la boîte d'alimentation déborde par sa lèvre (le flotteur du débitmètre monte) ; les gouttes tombent de la rampe ; le lac monte au pied du barrage | Saint-Venant, débit constant | temps réel |
| l'érosion | l'eau qui coule, ses rides, sa turbidité | capacité de transport, Shields, talus | MORFAC (relief accéléré ×40), écrit dans le README |
| le recul | le volant de la vanne tourne, la crête du déversoir descend, le lac baisse | niveau de base | temps réel |
| la vidange | le flotteur retombe, la vanne s'ouvre en grand | Saint-Venant | temps réel |
| le séchage | — (la lumière : le sable pâlit) | évaporation, frange capillaire | accéléré, comme un time-lapse |
| le gabarit | le moteur du portique, la courroie, la lame qui descend et touche le sable | conservation de la masse (le bourrelet) | temps réel |

Rien ne flotte : la table repose sur ses pieds et ses vérins ; la boîte est boulonnée au bout amont ; la rampe de pluie est portée par le portique (elle passe au-dessus de la pente pendant la pluie, garée sinon) ; la vanne coulisse dans ses glissières ; le portique roule sur deux rails ronds, entraîné par une courroie crantée.

### Épreuve d'ambition (construction de l'appareil)

Bac (fond, parois d'acrylique clair qui laissent voir la coupe des strates, cornières d'aluminium, vis), châssis (pieds, entretoises, vérins à vis de basculement avec volant), boîte d'alimentation (caisson inox, chicanes, lèvre en biseau, tuyau, raccord, robinet à volant, rotamètre en verre avec flotteur et graduations), vanne de sortie (glissières, guillotine, crémaillère, volant), déversoir et goulotte, portique (deux rails ronds sur supports, chariots à galets, poutre, moteur, courroie crantée et poulies, lame-gabarit profilée en aluminium anodisé, vérins de descente), rampe de pluie (tube, aiguilles, manomètre). Plus de vingt éléments ; le sable lui-même en porte trois échelles (le relief simulé, les rides, le grain).

### Épreuve d'échelle (règle 15) et références

Références photographiques que tout photographe du sujet ferait :
1. **Une table Emriver vue de trois quarts** : un bac de 1,8 × 0,6 m, sable plastique beige à grains colorés, chenal de 2–5 cm de large et 1–2 cm de profondeur, eau claire presque invisible sauf par ses reflets, delta en éventail de 20–30 cm à l'aval.
2. **Rigoles de plage à marée descendante** : des réseaux dendritiques de 2 à 30 cm, des chenaux de 2–10 mm, des interfluves arrondis, le sable plus sombre où l'eau coule encore, contre-jour qui fait scintiller les filets.
3. **Eurotank / XES vus d'en haut** : deltas en lobes, panaches de turbidité dans le lac, terrasses à chaque baisse du niveau de base.
4. **Badlands des Bardenas en vue aérienne rasante** : lames aiguës entre les ravines, couches dures en corniches, couleur par strates — c'est l'image que le plan du séchage doit rappeler.
5. **Coupe de canyon en fente** (Antelope) : strates fines qui ondulent sur les parois, lumière qui descend.

Ce qu'elles imposent : à l'image, en plan moyen, un champ de 30–50 cm de sable ; les chenaux font de 4 à 40 mm (2 à 16 cellules), les rides 1–2 cm, les grains 0,2–0,5 mm (sous le pixel en plan large : ils deviennent paillettes et micro-relief) ; les berges sont nettes (talus humide raide), les interfluves aigus. Ce qui donne l'échelle : le grain, les paillettes, les bords du bac et ses vis, la lame du gabarit, les gouttes de pluie (2 mm).

Densité : la simulation porte le relief jusqu'à 5 mm ; en dessous, le shader ajoute les rides de courant (orientées par la vitesse enregistrée), la micro-topographie du gabarit (stries), le grain (normales et paillettes). Le maillage du sable est le double de la grille (1 024 × 512), en interpolation bicubique.

### Images clés

1. **Le delta à mi-film** (Fin de jour) : caméra basse à 15° au-dessus du lac, le soleil rasant de trois quarts arrière ; au premier plan l'eau du lac, mate et turbide, où le panache ocre tourne ; au centre l'éventail de sable clair, chaque bras de chenal en fil d'argent ; à l'arrière-plan, flou, la vallée qui s'enfonce et la boîte d'alimentation qui déborde.
2. **Les ravines sèches** (Lampe rasante) : plan large en travelling latéral, une seule lampe au ras du sable : un réseau d'arbres noirs et de crêtes blanches, les strates rouges et blanches lisibles sur chaque flanc, le grain qui scintille sur les crêtes.
3. **Le gabarit** (Laboratoire) : la lame d'aluminium au premier plan, de profil, le bourrelet de sable qui roule devant elle et qui s'effondre dans un canyon pour le combler ; derrière, la surface neuve, mate et striée.

### Risques et parades

- **Eau illisible ou en aplat bleu** : l'eau n'a pas de couleur propre ; on la rend par son absorption (Beer-Lambert sur l'épaisseur), sa turbidité, ses reflets (Fresnel sur l'environnement), la réfraction du fond, ses rides animées par le champ de vitesse ; jamais une teinte bleue.
- **Relief en escaliers ou bruité** (artefacts connus du modèle des tuyaux) : talus, lissage de l'érosion, interpolation bicubique, normales calculées au pixel depuis la carte.
- **Simulation instable** (cellules qui se vident, vitesses infinies) : flux bornés, profondeur minimale pour la vitesse, plafond de vitesse, tests de conservation dans Node.
- **Temps de chargement** : la simulation tourne sur le GPU (~6 000 pas en quelques secondes) ; l'écran de chargement montre la carte du relief qui se creuse.
- **Mémoire** : ~100 Mo de textures enregistrées (ordinateur) ; deux fois moins de résolution et d'états en mobile.
- **Le gabarit qui fait magie** : le bourrelet porte la matière, se gonfle sur les dépôts, se vide dans les creux ; ce qui reste à la fin tombe dans la goulotte amont.
- **Trop de laboratoire, pas assez de paysage** : la caméra passe 80 % du film au ras du sable (le paysage remplit l'image), l'appareil n'apparaît que lorsqu'il agit.

### L'écran de chargement

La carte du relief de cette graine vue d'en haut, ombrée en lumière rasante et colorée par strates, qui se creuse en direct pendant la simulation sur le GPU (des instantanés lus à 128 × 64) : on voit les ravines remonter, le delta s'ouvrir, la brèche se former, avant même que la scène n'apparaisse.

## Révision après les premières images

- **Le méandre est écarté** : le modèle des tuyaux virtuels n'a ni courants secondaires ni cohésion latérale des berges ; un faible courant y fait un chenal droit qui s'élargit, pas un méandre. Quatre familles restent.
- **Les strates suivent le gabarit** : des couches horizontales recoupaient la pente et couvraient la surface neuve de chevrons de couleur avant même que l'eau n'arrive. Le bac est rempli couche par couche, chacune régalée par la même lame.
- **Un chenal pilote et une échancrure** : sans eux, le courant du delta s'étalait en nappe sur toute la vallée et la digue débordait sur toute sa crête. C'est la pratique des tables de laboratoire ; ici, c'est le nez de la lame qui les dessine.
- **La loi de transport** : une capacité en |v|·pente creusait un fossé à fond plat ; la capacité de Meyer-Peter–Müller au-dessus du seuil de Shields, avec le cisaillement de Manning, concentre l'eau en chenaux. Le transport du sédiment par les flux d'eau (et non par advection semi-lagrangienne) conserve le sable.
- **La pluie** : à 0,6 mm/s, tout le plateau s'abaissait en nappe et les ravines semblaient se reboucher (une tendance qui s'inverse) ; à 0,35 mm/s, la lame d'eau du plateau reste sous le seuil et seules les ravines creusent.
- **Ce qui encombrait l'image** : les ombres du portique et des rails en travers du paysage (le châssis ne porte plus d'ombre ; la lame seulement, au contact), la lame garée au bout du sable (le portique se gare au-dessus de la boîte d'alimentation, lame levée de 10 cm), le portique qui traversait la révélation (il roule après), un montant du simulateur de pluie devant l'objectif (la trajectoire de la caméra est écartée des montants, et un test le vérifie).
- **La lumière** : définie par rapport au côté où vole la caméra (de biais arrière ou à contre-jour) ; de face, le relief s'aplatissait.

## Révision de direction artistique : le sable est la vedette

Une planche de sept graines à six instants montrait que la machine prenait l'image : dans quatre plans sur six, rails, profilés et portique occupaient 30 à 50 % du cadre, souvent au premier plan, en diagonale, et c'étaient les lignes les plus contrastées (aluminium clair sur fond noir, portique blanc à contre-jour au fond du plan au ras du sable). Le sable, sujet du film, n'avait qu'une bande.

- **Le bâti est peint au ton du lieu**, mat (une laque de studio, comme un banc de tournage) : éclairé par l'humeur, il rend à peu près la luminance du fond. Il se lit comme un cadre, par sa forme. La lame, qui est un acteur, garde un peu plus de valeur ; la paroi amont, face à la caméra basse, n'est plus une vitre (elle renvoyait la lampe).
- **Les plans larges sont recadrés** : ensemble et séchage en plongée franche (~45°) et plus près, le bac remplit le cadre ; le piétement et le sol sortent du champ, le rail proche longe le bord bas au lieu de barrer l'image. La lame est filmée de trois quarts amont, en plongée : la poutre passe derrière elle, le paysage vient vers nous et disparaît sous le bourrelet.
- **Les humeurs plates retrouvent une direction** : Cyclorama (lampe abaissée, appoint et studio réduits : le basalte sur fond blanc n'avait plus de relief) et Verrière (le ciel couvert vient d'un côté).
- **La lame dans le bac** : sa course allait 3 cm au-delà de chaque bout du sable — dans la paroi amont et la boîte d'alimentation, dans le caisson du déversoir — et, levée, elle traversait la boîte d'alimentation sur la brèche ; ses tiges sortaient de leurs vérins. L'acrylique transparent le cachait ; la paroi peinte l'a montré. Elle reste maintenant entre les deux bouts du sable, est portée à niveau au-dessus de tout, ses tiges coulissent dans leurs vérins, et un test la confronte aux pièces fixes à chaque instant.
- **La lame en panoramique** : une caméra qui l'accompagnait à distance fixe finissait derrière la boîte d'alimentation, face au dos de la machine. Elle se tient haut au-dessus du bout amont et regarde la lame remonter tout le bac ; le raccord vers le plan d'ensemble se fait dans le mouvement, avant que la poutre ne passe sous l'objectif.
- **Le gros plan plutôt que la macro** : à 42 cm et 24°, le cadre couvrait 70 cellules de la simulation : on voyait l'interpolation du relief, floue, pas du sable. À ~35 cm de large (140 cellules), le relief tient.
- **Les dépôts se mêlent à leur lit** : la couleur du dépôt basculait dès 0,6 mm d'épaisseur, et le moindre voile de la brèche dessinait des aplats de camouflage ; le placage passe maintenant progressivement de quelques grains épars à une couverture pleine vers 2,5 mm.

