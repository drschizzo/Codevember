# Rust — document de travail

Thème donné : « Rust », avec une idée de l'utilisateur à prendre comme point de départ, pas comme cahier des charges : une pièce complexe, hérissée de rivets et de boulons, qui rouille de manière réaliste (le rendu de la rouille doit être particulièrement travaillé), puis une machinerie qui se met en place et l'enlève, avec la satisfaction des vidéos de nettoyage ; puis la rouille revient. Être inventif sur les pièces et sur les machines.

Le projet s'appelle **Rust** (dossier `rust/`), sous-titre *la remise à nu* — l'expression des décapeurs (« remettre à nu », « métal blanc », degré Sa 3 de la norme ISO 8501).

## a. Le thème en largeur

**La physique et la chimie.**
- La rouille est une **pile** : à l'anode, Fe → Fe²⁺ + 2e⁻ ; à la cathode, O₂ + 2H₂O + 4e⁻ → 4OH⁻ ; il faut de l'eau (un film de quelques couches moléculaires suffit, au-delà de ~60–80 % d'humidité) et de l'oxygène. Sans eau, l'acier ne rouille pas : la corrosion atmosphérique est réglée par le **temps d'humectation** (norme ISO 9223).
- **Loi de dose** (ISO 9224, Benarie, Feliu) : la perte d'épaisseur suit C = r·tⁿ, n ≈ 0,5–0,6 pour l'acier au carbone — loi parabolique : la couche de rouille freine la diffusion de l'oxygène, la corrosion ralentit. Un acier doux perd ~10–80 µm la première année selon l'atmosphère (C2 rurale → C5 marine).
- **Les phases de la rouille** : lépidocrocite γ-FeOOH (orange vif, la rouille jeune, poudreuse), goethite α-FeOOH (brun jaune, stable), magnétite Fe₃O₄ (noire, contre le métal, dans les creux), akaganéite β-FeOOH (orangé, en présence de chlorures : bord de mer), hématite (rouge sombre, rouille sèche et ancienne). Une couche épaisse est **stratifiée** : noir au fond, brun, orange en surface.
- **Rapport de Pilling-Bedworth** ≈ 2,1 pour le fer : la rouille occupe deux à quatre fois le volume du métal qu'elle consomme. Elle gonfle, se soulève en **cloques**, se fend en **écailles** qui se recourbent ; entre deux tôles, elle les écarte (« pack rust ») jusqu'à faire sauter les rivets.
- **Corrosion caverneuse** (aération différentielle, Evans) : le métal sous un joint, sous une tête de rivet, sous une rondelle manque d'oxygène et devient anode — la rouille commence **autour** des rivets et des boulons, dans les angles rentrants.
- **Piqûres** : la rouille naît en points (inclusions de sulfure de manganèse, défauts de la calamine), qui s'étendent en taches circulaires et se rejoignent.
- **Coulures** : l'eau qui ruisselle emporte des oxydes en suspension et les dépose en traînées verticales sous chaque boulon, chaque arête (« tear streaks »).
- **L'eau stagne** sur les faces horizontales, dans les rebords, au pied des cornières : là, la rouille est la plus épaisse. Les faces sous abri sèchent mal (condensation) ; les arêtes vives perdent leur protection en premier (« edge creep »).
- **Rouille éclair** (flash rust) : sur un acier fraîchement décapé, une voile orange apparaît en quelques heures, **au séchage** de l'eau.
- Couples galvaniques : un boulon de laiton sur une tôle d'acier fait rouiller l'acier autour de lui ; un rivet en fer forgé, plus noble que l'acier moderne, reste quand la tôle s'en va.
- Le **fer forgé** rouille en feuillets (laitier fibreux), la **fonte** en croûte grise et granuleuse (graphitisation), l'**acier patinable** (Corten) en couche dense brun-violet.

**Les métiers et les objets.**
- Les **décapeurs** : sablage et grenaillage (corindon, grenaille d'acier, billes de verre, bicarbonate ; degrés Sa 1 à Sa 3), **laser** à impulsions (fibre de 100 à 2 000 W, tête à miroir galvanométrique qui balaie une ligne, la rouille absorbe et se vaporise, le métal réfléchit et reste), **glace carbonique**, jet d'eau à très haute pression, brosse métallique et disque à lamelles, **électrolyse** (bain de carbonate de sodium, anodes sacrificielles en tôle, l'hydrogène qui pétille sur la pièce), bains d'acide citrique, de mélasse, d'acide phosphorique (convertisseur).
- Les **restaurateurs** sur YouTube : étau, clé à molette, hache, moteur de mobylette — démontage, bain, brosse, peinture, remontage, en accéléré.
- Les **chaudronniers et riveteurs** : rivet chauffé au rouge, lancé, attrapé dans un seau, posé, maté par le marteau pneumatique, la contre-bouterolle ; têtes rondes (bouterolle), fraisées, goutte de suif.
- Les **ouvrages rivetés** : tour Eiffel (2 500 000 rivets), viaduc de Garabit, pont du Forth, coques de navires, chaudières de locomotives, gazomètres, portes étanches, pylônes ; les **nœuds** où des cornières convergent sur un gousset.
- La **robinetterie industrielle** : vannes à opercule, brides à 8–16 boulons, volants à rayons, chapeaux boulonnés, presse-étoupe.
- Le **matériel roulant** : roues motrices à rayons de locomotive, contrepoids en croissant, bandages frettés, manetons, bielles d'accouplement.
- Les **portes étanches** de navire : taquets à coin et à poignée (« dogs »), charnières, hiloires rivetées, volant central.
- Les **chambres de brouillard salin** (ISO 9227) qui vieillissent des éprouvettes en accéléré.

**L'histoire de l'art, la photographie, le cinéma.**
- Les photographies d'épaves (le Titanic et ses « rusticles », stalactites de rouille bactérienne), de cimetières de navires (Nouadhibou), de locomotives abandonnées.
- Richard Serra, *Tilted Arc*, et les sculptures en Corten ; Anselm Kiefer et le plomb, Bernd et Hilla Becher et les machines industrielles en typologies.
- Les vidéos de **décapage laser** (le « ASMR » du métal : une ligne lumineuse qui laisse l'acier gris clair derrière elle) et de restauration (Hand Tool Rescue, my mechanics) : un plan fixe, des mains, un avant/après.
- La « ruin porn » industrielle ; les textures de rouille des jeux vidéo (la même tache orange partout).

**Le vocabulaire.** Rouille, calamine, oxyde, écaille, cloque, piqûre, coulure, voile, rouille éclair, feuilletage, gousset, cornière, bouterolle, contre-rivure, rivure, boulon, écrou, rondelle, bride, chapeau, presse-étoupe, opercule, bandage, contrepoids, maneton, taquet, hiloire ; sablage, grenaillage, décapage, mise à nu, **métal blanc**, Sa 2½, profil d'ancrage, passivation, anode, cathode.

**Les cycles et transformations.** Le minerai (hématite) → le haut-fourneau → le fer → la rouille (hématite à nouveau) : le fer « revient » à son état naturel. À l'échelle d'une pièce : acier nu → voile → taches → croûte → écailles → décapage → acier nu → rouille éclair. Chaque cycle consomme un peu de métal : le décapage n'est pas réversible, il enlève de la matière (profil d'ancrage).

**La lumière.** L'acier décapé est un **métal** (F0 ≈ 0,56 gris neutre) mat à satiné ; la rouille est un **diélectrique** poreux, très rugueux, presque sans reflet, dont l'albédo va de l'orange vif à presque noir ; mouillée, elle fonce de moitié et se lustre. Le contraste métal/rouille se lit par la **spécularité** plus que par la couleur : sous une lumière rasante, l'acier propre étincelle et la rouille reste sourde. Le laser émet un éclair blanc bleuté et une gerbe d'étincelles orange ; le sablage, un nuage de poussière qui diffuse la lumière ; le bain, un miroir sombre et des bulles.

## b. Les clichés

1. La texture de rouille plaquée (la même tache orange partout, comme dans un jeu vidéo), qui « monte » par un fondu.
2. L'épave sous-marine, le navire échoué au coucher du soleil.
3. Le time-lapse de restauration d'étau ou de clé à molette avec des mains.
4. L'objet qui rouille par un fondu enchaîné puis qui se « nettoie » par le même fondu à l'envers.
5. La tôle ondulée et le cadenas rouillé.

## c. Les pistes

1. **La remise à nu** (l'idée de l'utilisateur, creusée). Une pièce rivetée posée dans un décor neutre ; des averses passent en accéléré, la rouille naît dans les creux, autour de chaque rivet, s'étend en taches, coule, s'épaissit en écailles ; une machine arrive (portique laser, sableuse sur plateau tournant, bain d'électrolyse) et la décape en temps réel, front net et satisfaisant ; la rouille éclair revient. Boucle : cycle de transformations dont l'état initial est l'état final (le métal nu). Cœur : corrosion atmosphérique (temps d'humectation, loi de dose, aération différentielle, ruissellement) calculée sur la géométrie ; trajectoires des machines en forme fermée.
2. **Le rivetage à chaud.** La rouille gonfle entre les tôles (pack rust), fait sauter les rivets un à un ; un riveteur automatique chauffe un rivet au rouge, le pose, le mate. Boucle : chaque rivet remplacé. Beau, mais la rouille y est un prétexte, et le geste (un élément après l'autre) refait Fold.
3. **Les rusticles.** Une épave dans le noir des grands fonds, la rouille bactérienne pousse en stalactites (agrégation limitée par diffusion), un ROV les arrache. Cliché 2, cause bactérienne lente, rendu sous-marin déjà fait par Caustic.
4. **La corrosion filiforme.** Sous une laque de carrosserie, des vers de rouille avancent (têtes actives, marche aléatoire biaisée), soulèvent la laque ; une main ponce et repeint. Joli en macro mais un seul objet plat, et la boucle passe par une peinture.
5. **Le fer et son minerai.** Un bloc d'hématite, la coulée, le lingot qui rouille et retourne en poudre rouge qui refait le bloc. Grand cycle, mais trois matières difficiles (fonte en fusion, minerai, poudre) et aucune pièce à admirer.
6. **L'éprouvette.** Une chambre de brouillard salin : des éprouvettes rayées en croix rouillent selon leur revêtement (zinc, peinture, nu), côte à côte. Lisible, scientifique, mais visuellement pauvre (des plaques).
7. **L'anode sacrificielle.** Une coque d'acier et ses anodes de zinc : le zinc se dissout pendant que l'acier reste intact ; quand l'anode est consommée, la coque rouille ; un plongeur change l'anode. Ingénieux mais illisible sans légende.
8. **Le Corten.** Une sculpture d'acier patinable se couvre d'une patine qui se stabilise et protège ; rien ne la nettoie. Pas de boucle (la patine est un état final).
9. **Les ruines au soleil.** Un pont riveté dans un paysage, saisons et rouille ; décor de carton, échelle impossible à tenir.

## d. Notes

| Piste | Originalité | Esthétique | Boucle | Cœur | Variations | Faisabilité | Total |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1. La remise à nu | 4 | 5 | 5 | 4 | 5 | 3 | **26** |
| 2. Rivetage à chaud | 4 | 4 | 3 | 3 | 3 | 3 | 20 |
| 3. Rusticles | 3 | 4 | 3 | 3 | 2 | 3 | 18 |
| 4. Filiforme | 5 | 3 | 3 | 4 | 2 | 4 | 21 |
| 5. Minerai | 4 | 3 | 4 | 2 | 2 | 2 | 17 |
| 6. Éprouvette | 3 | 2 | 4 | 4 | 3 | 5 | 21 |
| 7. Anode | 4 | 2 | 3 | 3 | 2 | 4 | 18 |
| 8. Corten | 3 | 4 | 1 | 3 | 2 | 4 | 17 |
| 9. Ruines | 2 | 3 | 3 | 2 | 3 | 2 | 15 |

Retenue : **la remise à nu**. Elle absorbe des morceaux des autres : les coulures et la stratification (rusticles), la piqûre qui s'étend en tache (filiforme), le brouillard salin comme climat d'une humeur (éprouvette), la rouille éclair qui revient (le retour du cycle).

## e. La piste retenue

### Le geste

Deux mouvements qui s'opposent dans la même boucle, comme une respiration lente et une expiration nette : **la rouille vient** (lente, collective, un champ qui s'étend depuis les creux sous les averses, accéléré de plusieurs mois) et **la rouille part** (rapide, nette, un front géométrique tracé par une machine, en temps réel). La première est organique et sans dessin ; la seconde est un dessin parfait (lignes, spirale, niveau d'eau) qui coupe dans l'organique. C'est ce contraste qui fait la satisfaction des vidéos de décapage : l'**avant/après** se lit **sur la même image**, de part et d'autre du front.

### Le cœur technique (tel qu'il est construit)

1. **La corrosion atmosphérique calculée sur la géométrie** (`src/gen/corrosion.js`, dans un worker). Environ 200 000 points tirés sur toute la surface de la pièce (rivets compris, pas de 4,5 mm) ; pour chacun :
   - la **concavité** (hauteur moyenne des voisins au-dessus du plan tangent, à deux rayons : 1,2 et 4 cm), positive dans les angles rentrants et au pied des têtes de rivet (aération différentielle), négative sur les arêtes et le sommet des têtes ;
   - le **ciel** : la part de 15 directions vers le haut que rien ne masque (rayons dans une grille d'occupation de 2 cm). Un point abrité reçoit moins de pluie mais sèche mal ;
   - la **stagnation** : face tournée vers le haut et concave ;
   - le **temps d'humectation** qui en découle, puis l'**instant d'apparition**, propagé de proche en proche (Dijkstra sur les voxels occupés) pour que les taches s'étendent depuis les creux ;
   - le **ruissellement** : chaque voxel rouillé envoie des oxydes vers le bas, de voxel occupé en voxel occupé.
   Les champs sont écrits dans un **volume 3D** RGBA 8 bits dans le repère de la pièce (~1 cm par voxel, dilaté), lu par le shader.
2. **La loi de dose** dans le shader : épaisseur h = k·(τ − t₀)^½, τ le temps d'humectation cumulé (qui n'avance que sous les averses : une seule horloge). Les **piqûres** sont des germes (Worley 3D) : une tache naît en chaque germe et s'étend en disque, les taches se rejoignent ; puis la couche s'épaissit et change de phase (voile orange de lépidocrocite, brun de goethite, noir de magnétite dans les creux), cloque, se fend en écailles.
3. **Le décapage en forme fermée** (`src/machines.js`, même formule en JS et en TSL) : pour chaque point de la surface et sa normale, l'instant exact où l'outil l'atteint. Balayage en rangées du laser (boustrophédon, ligne de hauteur w), entrée dans le rideau de la rampe de sablage sur le plateau tournant (un nombre entier de tours), passage de la rampe de rinçage à la sortie du bain. Le front sur l'image est l'ensemble des points dont l'instant de décapage vaut u.

Invariants vérifiés par les tests : la rouille ne recule jamais pendant les averses ; un point n'est atteint qu'une fois, quand l'outil passe devant lui ; le raccord est exact ; les points que l'outil n'atteint pas (dessous des têtes, faces cachées) restent rouillés **toute la boucle** (τ effectif constant, donc sans couture).

### La formule de la boucle

Cycle de transformations à deux états (nu, rouillé) : u ∈ [0, 1), horloge unique.
- τ(u) : temps d'humectation cumulé, 0 jusqu'à la première averse, croissant par paliers (une marche par averse, lissée), 1 à la fin des averses, puis constant ;
- c(x, n) : instant de décapage du point x (fonction de la machine), dans la fenêtre du décapage ou +∞ (jamais atteint) ;
- rouille visible : R(x, u) = h(x, τ(u)) si u < c(x, n), 0 sinon ; pour un point jamais atteint, R = h(x, 1) partout.
Les machines partent de leur position de repos et y reviennent (plateau tournant d'un nombre entier de tours).

### Découpage temporel (boucle de 44, 48 ou 52 s)

| u | Temps | Ce que l'œil regarde |
| --- | --- | --- |
| 0,00–0,04 | **Le métal nu** | la pièce décapée, gris clair, qui accroche la lumière ; la machine au garage |
| 0,04–0,36 | **Les averses** (accéléré : une saison) | 3 à 5 averses : la pluie passe, la pièce fonce et luit ; au séchage, voile orange autour des rivets et dans les angles ; à chaque averse, les taches s'étendent, se rejoignent, coulent ; à la dernière, croûte brune, écailles, coulures sous chaque boulon |
| 0,36–0,44 | **La mise en place** (temps réel) | le portique roule sur ses rails, le bras de la sableuse pivote, le couvercle de la fosse roule et le palan prend la charge |
| 0,44–0,86 | **La remise à nu** (temps réel ; 0,45–0,87 pour le bain) | une ligne d'éclair blanc et d'étincelles (laser), un rideau de grenaille et un nuage (sablage), la pièce qui ressort noire de boue puis la rampe de rinçage qui découvre l'acier (bain) ; la caméra suit le front de près |
| 0,86–0,95 | **Le retrait** | la machine repart ; la caméra recule |
| 0,95–1,00 | **Le métal nu** | la pièce nue, entière |

### Crédibilité

| Temps | Cause visible | Loi | Temps du film |
| --- | --- | --- | --- |
| la pièce mouille | la pluie qui tombe (gouttes à contre-jour), le ciel qui se voile | — | accéléré (une averse ≈ 1,5 à 2 s) |
| la rouille naît et s'étend | l'eau qui reste dans les creux, autour des rivets ; le séchage | ISO 9223/9224 : temps d'humectation, C = r·tⁿ ; aération différentielle ; piqûres | accéléré (une saison en 14 à 17 s) |
| les coulures | l'eau qui ruisselle depuis chaque point rouillé | gravité le long de la surface | id. |
| le portique arrive | moteurs sur rails (galets, crémaillère) | cinématique, accélérations bornées | temps réel |
| la rouille part (laser) | la ligne de lumière de la tête galvanométrique, à la distance focale | ablation : la rouille absorbe, le métal réfléchit ; étincelles balistiques | temps réel |
| la rouille part (sablage) | le rideau de grenaille de la rampe de buses | abrasion : une face est décapée quand elle entre dans le rideau avec une incidence utile ; poussière qui naît à l'impact | temps réel |
| la rouille part (bain) | le bain d'électrolyse, les bulles d'hydrogène, puis la rampe de rinçage | réduction cathodique : la croûte devient une boue noire que les jets chassent | accéléré pendant l'immersion (des heures en quelques secondes), temps réel au rinçage |

Rien ne flotte : la pièce est posée sur ses cales, ses sellettes, son coupon de rail ou son pied, ou sur le plateau tournant, ou pend au crochet d'un palan ; les machines ont leurs rails, leurs colonnes, leur socle.

### Catalogue

**Les pièces** (quatre familles, de silhouettes différentes ; le détail construit est dans le README) :
- **Nœud** — un nœud de treillis riveté (le gousset où convergent trois à cinq barres) : gousset découpé, cornières jumelées de part et d'autre, membrure en T, deux rangs de rivets à tête ronde par barre, couvre-joints. Des centaines de rivets. Silhouette en étoile.
- **Vanne** — une vanne à opercule sur sa tuyauterie : corps de fonte bombé, brides à 8–16 boulons (tête, rondelle, écrou, bout de filet), chapeau boulonné, presse-étoupe, arcade, tige filetée, volant à rayons. Silhouette en croix.
- **Roue** — une roue motrice de locomotive : moyeu, rayons de section elliptique effilés, jante, bandage à boudin, contrepoids en croissant fait de plaques rivetées, maneton, bout d'essieu à écrou ; posée sur un coupon de rail. Silhouette ronde.
- **Porte** — une porte étanche de navire dans sa cloison : battant raidi, hiloire en cornière, 6 à 10 taquets à poignée, charnières, plaque de laiton. Silhouette en plaque ornée.

**Les machines** (trois familles de geste) :
- **Laser** — un portique qui roule sur deux rails de derrière la pièce et balaie sa face **en rangées**, de haut en bas. Front : un trait droit, net, une ligne d'éclair et une gerbe d'étincelles. Fini : acier gris clair satiné, stries fines du balayage.
- **Sablage** — la pièce sur un **plateau tournant** ; une rampe de buses, au bout d'un bras sur colonne, descend lentement pendant que la pièce tourne : le front est une **hélice**. Rideau de grenaille, poussière née à l'impact. Fini : gris mat uniforme (métal blanc).
- **Bain** — un palan sur portique descend la pièce dans une fosse d'électrolyse ; bulles ; la pièce remonte noire de boue, et une **rampe de rinçage** descend sur elle : le front est la ligne horizontale de ses buses. Fini : gris sombre, ruisselant.

**Les humeurs** (six décors) : voir la variété plus bas.

**Les climats** : bruine (taches fines, coulures longues), averses (croûte épaisse), embruns (rouille orangée, cloques), brouillard (couverture plus uniforme).

**Les matières** : acier laminé, fonte (corps de la vanne, jante de la roue : rouille plus grise et grenue), laiton et bronze (presse-étoupe, plaque, tige), qui ne rouillent pas mais brunissent. Le fer puddlé du plan initial n'a pas été construit.

### Matrice de variations

| Axe | Valeurs |
| --- | --- |
| Pièce | Nœud (3–5 barres), Vanne (diamètre, 8–16 boulons par bride, volant à 4–6 rayons), Roue (12–18 rayons, contrepoids), Porte (rectangulaire ou ovale, 6–10 taquets) |
| Machine | Laser (portique), Sablage (plateau tournant), Bain (palan et cuve) |
| Humeur | six décors |
| Climat | bruine, averses, embruns, brouillard |
| Balayage | sens des rangées, hauteur de ligne, tours et inclinaison de la rampe, sens de rotation, durée d'immersion |

4 × 3 × 6 × 4 = 288 combinaisons de structure, plus les paramètres continus. Deux graines au hasard diffèrent presque toujours par la pièce ou par la machine, qui changent la silhouette **et** le geste.

### Variété (une phrase par humeur, sans couleur)

| Humeur | Décor | Lumière | Valeur | Cadrage |
| --- | --- | --- | --- | --- |
| **Atelier** | sol de béton lissé, cyclorama gris | grande boîte à lumière au plafond, douce | moyenne | trois-quarts plongeant |
| **Laboratoire** | cyclorama blanc, sol époxy clair | lumière enveloppante, ombres légères | très claire | face, légèrement haut |
| **Cale sèche** | tôle larmée mouillée, fond sombre bleuté | contre-jour dur et lampe froide de côté | sombre | contre-plongée |
| **Plein jour** | dalle claire, fond pâle | soleil dur de midi, ombres nettes | claire | trois-quarts, de côté |
| **Nuit d'usine** | tôle sombre, fond noir | un seul projecteur haut et serré, la machine éclaire | très sombre | proche, bas |
| **Brume** | dalle d'ardoise mouillée, brume grise qui mange le fond | ciel couvert, sans ombre portée nette | moyenne claire, froide | large, de face |

### Ambition (éléments de construction)

Nœud : gousset découpé à congés, cornières à congé de laminage et arêtes arrondies, rivets à tête ronde (bouterolle) avec leur petit bourrelet, fourrures, couvre-joint, membrure en T, tréteaux. Vanne : corps bombé de fonte avec ses nervures de moulage, brides épaisses, boulons à six pans chanfreinés avec rondelle et écrou, filet dépassant, chapeau, presse-étoupe à deux goujons, arcade à deux bras, tige filetée, écrou de manœuvre, volant à jante torique et rayons, selles de tuyauterie. Roue : moyeu, rayons elliptiques effilés à congés, jante, bandage à boudin et bande de roulement conique, contrepoids en croissant à plaques rivetées, maneton, essieu, écrou, coupon de rail et selle. Porte : tôle, raidisseurs en plat, hiloire à cornière rivetée, taquets (axe, coin, poignée), charnières à goujons, volant. Machines : rails à galets, colonnes, crémaillères, chaînes porte-câbles, tête laser à hublot et câble de fibre, gaine d'aspiration ; buse, flexible, plateau tournant à couronne dentée ; cuve à rebord, anodes en tôle, câbles et pinces, palan à chaîne, crochet, élingues.

### Déclinaison (le mouvement de chaque famille de machine)

- **Laser** : un trait lumineux droit qui balaie la pièce en lignes, de haut en bas, de gauche à droite puis de droite à gauche ; la pièce est immobile, la tête se déplace.
- **Sablage** : la pièce tourne sur elle-même ; un rideau de grenaille descend lentement ; le front s'enroule en hélice.
- **Bain** : la pièce descend tout entière dans un liquide, disparaît, remonte noire ; le front est la rampe de rinçage qui la parcourt de haut en bas.
Trois mouvements de nature différente (translation d'un trait, rotation de la pièce, immersion) : pas des variantes.

### Scénario (film muet)

1. La pièce, nue, sur son support ; la lumière y accroche des filets clairs. Le décor est calme.
2. Le ciel se voile : une averse passe, on voit les gouttes tomber à contre-jour ; la pièce fonce, luit, l'eau reste dans les angles. Le ciel revient ; en séchant, un voile orange paraît **là où l'eau est restée** : au pied de chaque rivet, dans les angles des cornières.
3. Deuxième averse : les taches s'étendent depuis ces points, des piqûres naissent sur les plats ; des traînées descendent sous chaque boulon.
4. Troisième, quatrième averse : les taches se rejoignent, la couleur fonce, la croûte cloque, se fend en écailles ; les coulures s'allongent. La pièce est entièrement rouillée, sauf les filets de laiton.
5. La machine entre : le portique roule jusqu'à la pièce (ou la buse pivote, ou le palan reprend la charge et le couvercle de la cuve s'ouvre).
6. Le décapage : la ligne lumineuse part du coin haut ; derrière elle, l'acier nu, net, gris clair ; les étincelles tombent. La caméra s'approche. Ligne après ligne, la pièce se découvre. (Ou : la pièce tourne, le rideau de grenaille descend ; ou : la pièce remonte du bain noire de boue, et la rampe de rinçage la découvre.)
7. La dernière ligne finit la pièce. La machine repart. La pièce nue, entière, comme au début.
Forme : une **montée** lente (accumulation), une **réponse** nette (le décapage), un **retour**.

### Images clés

1. *Atelier, Nœud, fin des averses* : plan trois-quarts plongeant, une étoile de cornières rivetées sur son gousset, toute brune et orange, écailles soulevées sur les plats, coulures sous chaque rangée de rivets, l'eau qui luit encore dans l'angle de la membrure ; boîte à lumière douce, ombres légères sous la pièce.
2. *Nuit d'usine, Vanne, décapage laser* : proche et bas ; la ligne d'éclair blanc à mi-hauteur de la bride ; au-dessus, les boulons nus étincellent, en dessous la croûte brune ; une gerbe d'étincelles orange qui rebondit sur le sol noir ; la tête du laser, son hublot, son câble, dans la lumière de son propre éclair.
3. *Laboratoire, Roue, sablage* : cyclorama blanc, la roue tourne sur le plateau, le cône de grenaille frappe la jante, un nuage gris clair roule autour ; la moitié haute de la roue est grise et mate, la moitié basse brune.

### Risques et parades

- **Une rouille « texture de jeu »** : la parade est le modèle (germes, champ d'humectation, stratification, coulures) et le relief (écailles, cloques, piqûres), jugés sur des planches en gros plan à côté de photographies de référence.
- **Un front qui avance « tout seul »** : la cause est toujours à l'endroit du front (la ligne lumineuse est la tête du laser ; le cône est la buse ; le niveau est le bain) ; même formule pour l'outil et pour le shader, test d'écart nul.
- **La lenteur** : 4 pièces × 3 machines, c'est beaucoup de géométrie ; tout est construit et le champ de corrosion cuit une fois par scène dans un worker.
- **La face cachée** : le laser ne voit qu'une face ; ce qu'il ne voit pas reste rouillé toute la boucle (cohérent, et sans couture), mais la caméra reste du côté décapé.
- **Le bain cache la pièce** : le liquide est opaque (électrolyte trouble), on ne voit pas sous la surface ; le temps fort est la **sortie** et le rinçage.
- **Le sur-chargé** : une pièce par scène, une machine, un décor neutre.

## e quater. Références

Photographies que tout photographe du sujet ferait, et ce qu'elles imposent :
1. **Nœud de pont riveté, rouille ancienne** (viaduc ferroviaire, vue rapprochée) : rivets de 22 mm à têtes rondes, au pas de 70–90 mm en deux rangs ; la rouille est **plus épaisse au pied des têtes** et dans les angles rentrants ; des **coulures** orangées de 5–20 cm sous chaque rangée ; la croûte se soulève en écailles de 1–3 cm aux bords recourbés ; couleur dominante brun moyen, orange vif seulement sur les zones jeunes et les coulures, noir dans les creux.
2. **Tôle décapée au laser, à mi-chemin** : une frontière nette, un gris clair satiné (pas un miroir), de fines stries parallèles au balayage ; la rouille juste à côté est intacte ; quelques points noirs (piqûres) restent dans l'acier nu.
3. **Pièce sablée (Sa 3)** : gris argenté **mat**, uniforme, sans reflet net ; le profil d'ancrage diffuse la lumière ; les piqûres anciennes restent en creux sombres.
4. **Rouille éclair** : un voile orange pâle et poudreux, en taches floues, sur un acier propre, surtout là où l'eau a séché (traces de gouttes).
5. **Vanne de fonte rouillée sur une conduite** : croûte granuleuse plus sombre, boulons plus rouillés que le corps, filets bouchés de rouille.

Échelle : la pièce mesure ~1 m ; un rivet ~2 cm, un boulon M20–M24 ; au plan large (caméra à ~3,5 m), un rivet fait ~6 px de large en 1080p — l'échelle vient des rangées régulières de rivets. Au gros plan (~1,6 m), une écaille fait 10–20 px : le relief doit être là. La rouille se dessine à trois échelles : la tache (5–20 cm, champ d'humectation), la piqûre (5–15 mm, germes), le grain (≤ 1 mm, bruit).

## g. Ce que les essais ont appris

- Une croûte uniforme couverte d'un réseau régulier de fentes (Worley nu) se lit comme du cuir : la rouille a besoin de trois échelles (tache du champ, plaques de ~5 cm, grain millimétrique) et d'écailles seulement dans la croûte épaisse, aux fentes irrégulières.
- Un instant d'apparition purement local fait rouiller toutes les faces dégagées en même temps : la propagation géodésique donne le geste collectif (des taches qui s'étendent et se rejoignent).
- Le laser ne doit pas exiger une face tournée vers lui : sans tolérance qui croît avec l'incidence rasante, les ailes des cornières restaient rouillées toute la boucle.
- Une buse qui vise l'axe est parallèle à toute face qui contient l'axe : une pièce plate ne se décape qu'avec un rideau de buses et un test d'entrée dans le rideau, l'occultation lue dans 32 cartes de profondeur.
- Dans un vrai bain d'électrolyse la croûte devient une boue noire : la pièce ressort noire, et c'est le rinçage qui montre l'acier.
- Machines et cadrage : le portique arrive de derrière la pièce (ses rails barraient le premier plan), la colonne de sablage se place de profil, la fosse affleure le sol (une cuve posée mettait la pièce à 4 m de haut) et son couvercle roule sur le côté.
- Exposition réglée au posemètre par humeur (lampes doublées en Nuit d'usine et Cale sèche, baissées en Laboratoire et Plein jour).
- Une pièce construite par programme accumule des éléments flottants (berceaux, battant, charnières, plaques à quelques millimètres) : l'audit (`src/gen/audit.js`, composantes connexes échantillonnées à 2,5 mm qui doivent rejoindre le sol de proche en proche) est devenu un test. Il ne voit pas les fixations absurdes (pitons vissés dans un chant), remplacées à la relecture par des oreilles de levage percées et une manille.
- La hauteur du crochet est calculée pour qu'aucune élingue ne passe à moins de 3 cm de la pièce ; la roue pend à un palonnier, par deux étrangloirs autour du maneton et de l'essieu. Les maillons d'une chaîne tournent d'un quart de tour l'un sur l'autre.
