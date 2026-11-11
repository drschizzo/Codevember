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

### Le cœur technique

1. **La corrosion atmosphérique calculée sur la géométrie** (`src/gen/corrosion.js`, dans un worker). Des centaines de milliers de points tirés sur toute la surface de la pièce (rivets compris) ; pour chacun :
   - la **concavité** (hauteur moyenne des voisins au-dessus du plan tangent, à deux rayons : 1,5 et 5 cm) — positive dans les angles rentrants et au pied des têtes de rivet (aération différentielle), négative sur les arêtes et le sommet des têtes ;
   - l'**abri** : la part du ciel qui arrose le point (rayons lancés vers le haut dans une grille d'occupation) — un point abrité reçoit moins de pluie mais sèche mal ;
   - la **stagnation** : face tournée vers le haut et concave ;
   - le **temps d'humectation** qui en découle, puis l'**instant d'apparition** de la rouille et sa **vitesse** ;
   - le **ruissellement** : chaque point rouillé envoie des oxydes vers le bas ; la grille propage cette charge en descendant la gravité le long des surfaces occupées (elle s'arrête sur une face horizontale, contourne les têtes).
   Les champs sont écrits dans un **volume 3D** dans le repère de la pièce (~1 cm par voxel, dilaté), lu par le shader.
2. **La loi de dose** dans le shader : épaisseur h = k·(τ − t₀)ⁿ, n = 0,5, τ le temps d'humectation cumulé (qui n'avance que sous les averses : une seule horloge). Les **piqûres** sont des germes (Worley 3D) : une tache naît en chaque germe et s'étend en disque à vitesse proportionnelle à l'humidité locale, les taches se rejoignent ; puis la couche s'épaissit et change de phase (voile orange de lépidocrocite → brun de goethite → noir de magnétite dans les creux), cloque, se fend en écailles qui se soulèvent.
3. **Le décapage en forme fermée** (`src/machines.js`, même formule en JS et en TSL) : pour chaque point de la surface et sa normale, l'instant exact où l'outil l'atteint — balayage en lignes du laser (boustrophédon, ligne de hauteur w), hélice de la buse sur le plateau tournant (un nombre entier de tours), passage du niveau du bain. Le front sur l'image est l'ensemble des points dont l'instant de décapage vaut t.

Invariants vérifiables : la rouille ne recule jamais pendant les averses et ne progresse jamais pendant le décapage ; tout point atteint par l'outil est nu à la fin ; un point n'est atteint qu'une fois, quand l'outil passe devant lui, à l'image exacte où l'outil est à sa hauteur ; le raccord est exact (au début et à la fin, la même pièce nue) ; les points que l'outil n'atteint pas (dessous des têtes, faces cachées) restent rouillés **toute la boucle** (constants, donc sans couture).

### La formule de la boucle

Cycle de transformations à deux états (nu, rouillé) : u ∈ [0, 1), horloge unique.
- τ(u) : temps d'humectation cumulé, 0 jusqu'à la première averse, croissant par paliers (une marche par averse, lissée), 1 à la fin des averses, puis constant ;
- c(x, n) : instant de décapage du point x (fonction de la machine), dans [u_D0, u_D1] ou +∞ (jamais atteint) ;
- rouille visible : R(x, u) = h(x, τ(u)) si u < c(x, n), 0 sinon ; pour un point jamais atteint, R = h(x, 1) partout.
À u = 0 comme à u = 1, τ = 0 pour les points atteints (rouille nulle, finition du décapage) et h(x, 1) pour les autres : même image. Les machines partent de leur position de repos et y reviennent (trajectoires périodiques, plateau tournant d'un nombre entier de tours).

### Découpage temporel (boucle de 48 s par défaut)

| u | Temps | Ce que l'œil regarde |
| --- | --- | --- |
| 0,00–0,05 | **Le métal nu** | la pièce décapée, gris clair, qui accroche la lumière ; la machine est repliée ou hors champ |
| 0,05–0,47 | **Les averses** (accéléré : une saison) | 4 à 6 averses : la pluie passe (gouttes à contre-jour), la pièce fonce et luit ; au séchage, voile orange autour des rivets et dans les angles ; à chaque averse, les taches s'étendent, se rejoignent, coulent ; à la dernière, croûte brune, écailles, coulures sous chaque boulon |
| 0,47–0,55 | **La mise en place** (temps réel) | la machine arrive : le portique roule sur ses rails, le bras de la sableuse pivote, le couvercle du bain s'ouvre et le palan prend la charge |
| 0,55–0,90 | **La remise à nu** (temps réel) | le front avance : une ligne d'éclair blanc et d'étincelles (laser), un cône de grenaille et un nuage (sablage), le niveau du bain qui découvre l'acier ruisselant (électrolyse) ; la caméra suit le front de près |
| 0,90–1,00 | **Le retrait** | la machine repart ; la pièce nue, entière ; la caméra recule |

Respirations : un ralenti n'a pas de sens pour le laser (le geste est déjà lent) ; la vitesse du front ralentit sur les zones denses en rivets (la machine passe plus de temps où il y a plus à faire, ce qui se lit). La dernière ligne est celle qui finit la pièce : la caméra est là.

### Crédibilité

| Temps | Cause visible | Loi | Temps du film |
| --- | --- | --- | --- |
| la pièce mouille | la pluie qui tombe (gouttes à contre-jour), le ciel qui se voile | — | accéléré (une averse ≈ 1,5 s) |
| la rouille naît et s'étend | l'eau qui reste dans les creux, autour des rivets ; le séchage | ISO 9223/9224 : temps d'humectation, C = r·tⁿ ; aération différentielle ; piqûres | accéléré (une saison en 20 s) |
| les coulures | l'eau qui ruisselle depuis chaque point rouillé | gravité le long de la surface | id. |
| le portique arrive | moteurs sur rails (galets, crémaillère) | cinématique, accélérations bornées | temps réel |
| la rouille part (laser) | la ligne de lumière de la tête galvanométrique, à la distance focale | ablation : la rouille absorbe, le métal réfléchit ; étincelles balistiques | temps réel |
| la rouille part (sablage) | le cône de grenaille de la buse | abrasion : dose cumulée sous l'empreinte gaussienne ; poussière qui retombe | temps réel |
| la rouille part (bain) | le bain d'électrolyse, les bulles d'hydrogène sur la pièce, les câbles | réduction cathodique ; la croûte se détache ; la pièce ressort ruisselante | accéléré pendant l'immersion (des heures en quelques secondes), temps réel à la sortie |

Rien ne flotte : la pièce est posée sur ses tréteaux ou ses selles, ou sur le plateau tournant, ou pend au crochet d'un palan par deux élingues ; les machines ont leurs rails, leurs colonnes, leur socle.

### Catalogue

**Les pièces** (quatre familles, de silhouettes différentes) :
- **Nœud** — un nœud de treillis riveté (le gousset où convergent trois à cinq barres) : gousset découpé, cornières jumelées de part et d'autre, membrure en T, deux rangs de rivets à tête ronde par barre, couvre-joints. Des centaines de rivets. Silhouette en étoile.
- **Vanne** — une vanne à opercule sur sa tuyauterie : corps de fonte bombé, brides à 8–16 boulons (tête, rondelle, écrou, bout de filet), chapeau boulonné, presse-étoupe, arcade, tige filetée, volant à rayons. Silhouette en croix.
- **Roue** — une roue motrice de locomotive : moyeu, rayons de section elliptique effilés, jante, bandage à boudin, contrepoids en croissant fait de plaques rivetées, maneton, bout d'essieu à écrou ; posée sur un coupon de rail. Silhouette ronde.
- **Porte** — une porte étanche de navire dans son cadre : tôle à raidisseurs, hiloire rivetée, taquets à coin et à poignée, charnières, volant central. Silhouette en plaque ornée.

**Les machines** (trois familles de geste) :
- **Laser** — un portique (deux colonnes, une traverse qui monte et descend, un chariot) qui balaie la face de la pièce **en lignes**, de haut en bas. Front : un trait droit, net, une ligne d'éclair et une gerbe d'étincelles. Fini : acier gris clair satiné, stries fines du balayage.
- **Sablage** — la pièce sur un **plateau tournant** ; la buse, au bout d'un bras sur colonne, descend lentement pendant que la pièce tourne : le front est une **hélice**. Cône de grenaille, nuage de poussière qui roule, retombe. Fini : gris mat uniforme (métal blanc).
- **Bain** — un palan sur portique descend la pièce dans une cuve d'électrolyte ; bulles ; la pièce remonte : le front est le **niveau du liquide**, horizontal, qui descend sur elle. Fini : gris sombre, ruisselant, qui sèche.

**Les humeurs** (six décors) : voir la variété plus bas.

**Les climats** : bruine continentale (taches fines, coulures longues), averses franches (croûte épaisse, stagnation), embruns salins (akaganéite orangée, cloques, piqûres profondes).

**Les aciers** : acier doux (rouille brun orangé, écailles), fer puddlé (feuilletage, rivets plus clairs), fonte (croûte granuleuse grise et brune) — la vanne a un corps de fonte, la roue un bandage d'acier dur ; les boulons de laiton (rares) ne rouillent pas mais brunissent.

### Matrice de variations

| Axe | Valeurs |
| --- | --- |
| Pièce | Nœud (3–5 barres, simple ou double gousset), Vanne (DN, 8–16 boulons, volant à 4–6 rayons), Roue (12–18 rayons, contrepoids), Porte (rectangulaire ou ovale, 6–10 taquets) |
| Machine | Laser (portique), Sablage (plateau tournant), Bain (palan et cuve) |
| Humeur | six décors |
| Climat | bruine, averses, embruns, brouillard |
| Acier | doux, puddlé, fonte (selon la pièce) |
| Balayage | sens des lignes, largeur de ligne, pas de l'hélice, sens de rotation, profondeur d'immersion |

4 × 3 × 6 × 4 × 3 = 864 combinaisons de structure, plus les paramètres continus. Deux graines au hasard diffèrent presque toujours par la pièce ou par la machine, qui changent la silhouette **et** le geste.

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
- **Sablage** : la pièce tourne sur elle-même ; un cône de poussière immobile descend lentement ; le front s'enroule en hélice.
- **Bain** : la pièce descend tout entière dans un liquide, disparaît, remonte ; le front est un plan horizontal qui la parcourt de haut en bas à la sortie.
Trois mouvements de nature différente (translation d'un trait, rotation de la pièce, immersion) : pas des variantes.

### Scénario (film muet)

1. La pièce, nue, sur son support ; la lumière y accroche des filets clairs. Le décor est calme.
2. Le ciel se voile : une averse passe, on voit les gouttes tomber à contre-jour ; la pièce fonce, luit, l'eau reste dans les angles. Le ciel revient ; en séchant, un voile orange paraît **là où l'eau est restée** : au pied de chaque rivet, dans les angles des cornières.
3. Deuxième averse : les taches s'étendent depuis ces points, des piqûres naissent sur les plats ; des traînées descendent sous chaque boulon.
4. Troisième, quatrième averse : les taches se rejoignent, la couleur fonce, la croûte cloque, se fend en écailles ; les coulures s'allongent. La pièce est entièrement rouillée, sauf les filets de laiton.
5. La machine entre : le portique roule jusqu'à la pièce (ou la buse pivote, ou le palan reprend la charge et le couvercle de la cuve s'ouvre).
6. Le décapage : la ligne lumineuse part du coin haut ; derrière elle, l'acier nu, net, gris clair ; les étincelles tombent. La caméra s'approche. Ligne après ligne, la pièce se découvre. (Ou : la pièce tourne, le cône descend ; ou : la pièce remonte du bain, ruisselante, nue.)
7. La dernière ligne finit la pièce. La machine repart. La pièce nue, entière, comme au début.
Forme : une **montée** lente (accumulation), une **réponse** nette (le décapage), un **retour**.

### Images clés

1. *Atelier, Nœud, fin des averses* : plan trois-quarts plongeant, une étoile de cornières rivetées sur son gousset, toute brune et orange, écailles soulevées sur les plats, coulures sous chaque rangée de rivets, l'eau qui luit encore dans l'angle de la membrure ; boîte à lumière douce, ombres légères sous la pièce.
2. *Nuit d'usine, Vanne, décapage laser* : proche et bas ; la ligne d'éclair blanc à mi-hauteur de la bride ; au-dessus, les boulons nus étincellent, en dessous la croûte brune ; une gerbe d'étincelles orange qui rebondit sur le sol noir ; la tête du laser, son hublot, son câble, dans la lumière de son propre éclair.
3. *Laboratoire, Roue, sablage* : cyclorama blanc, la roue tourne sur le plateau, le cône de grenaille frappe la jante, un nuage gris clair roule autour ; la moitié haute de la roue est grise et mate, la moitié basse brune.

### Risques et parades

- **Une rouille « texture de jeu »** : la parade est le modèle (germes, champ d'humectation, stratification, coulures) et le relief (écailles, cloques, piqûres), jugés sur des planches en gros plan à côté de photographies de référence.
- **Un front qui avance « tout seul »** : la cause est toujours à l'endroit du front (la ligne lumineuse est la tête du laser ; le cône est la buse ; le niveau est le bain) ; même formule pour l'outil et pour le shader, test d'écart nul.
- **La lenteur** : 4 pièces × 3 machines, c'est beaucoup de géométrie. Les rivets et boulons sont des instances (une géométrie, un shader) ; les champs de corrosion sont cuits une fois par pièce dans un worker.
- **La face cachée** : le laser ne voit qu'une face ; ce qu'il ne voit pas reste rouillé toute la boucle (cohérent, et sans couture), mais la caméra reste du côté décapé.
- **Le bain cache la pièce** : le liquide est opaque (électrolyte trouble), on ne voit pas sous la surface ; le temps fort est la **sortie**.
- **Le sur-chargé** : une pièce par scène, une machine, un décor neutre.

## e quater. Références

Photographies que tout photographe du sujet ferait, et ce qu'elles imposent :
1. **Nœud de pont riveté, rouille ancienne** (viaduc ferroviaire, vue rapprochée) : rivets de 22 mm à têtes rondes, au pas de 70–90 mm en deux rangs ; la rouille est **plus épaisse au pied des têtes** et dans les angles rentrants ; des **coulures** orangées de 5–20 cm sous chaque rangée ; la croûte se soulève en écailles de 1–3 cm aux bords recourbés ; couleur dominante brun moyen, orange vif seulement sur les zones jeunes et les coulures, noir dans les creux.
2. **Tôle décapée au laser, à mi-chemin** : une frontière nette, un gris clair satiné (pas un miroir), de fines stries parallèles au balayage ; la rouille juste à côté est intacte ; quelques points noirs (piqûres) restent dans l'acier nu.
3. **Pièce sablée (Sa 3)** : gris argenté **mat**, uniforme, sans reflet net ; le profil d'ancrage diffuse la lumière ; les piqûres anciennes restent en creux sombres.
4. **Rouille éclair** : un voile orange pâle et poudreux, en taches floues, sur un acier propre, surtout là où l'eau a séché (traces de gouttes).
5. **Vanne de fonte rouillée sur une conduite** : croûte granuleuse plus sombre, boulons plus rouillés que le corps, filets bouchés de rouille.

Échelle : la pièce mesure ~1 m ; un rivet ~2 cm, un boulon M20–M24 ; au plan large (caméra à ~3,5 m), un rivet fait ~6 px de large en 1080p — l'échelle vient des rangées régulières de rivets. Au gros plan (~1,6 m), une écaille fait 10–20 px : le relief doit être là. La rouille se dessine à trois échelles : la tache (5–20 cm, champ d'humectation), la piqûre (5–15 mm, germes), le grain (≤ 1 mm, bruit).

## g. Mise au point (pendant la construction)

Ce que les premières planches ont fait changer :

- **La rouille d'un seul tenant n'était pas assez travaillée** : une croûte uniforme orange-brun, couverte d'un réseau régulier de fentes (Worley nu), se lisait comme du cuir. Elle a maintenant trois échelles (la tache du champ, des plaques de ~5 cm plus orangées ou brun-noir, le grain millimétrique), des écailles seulement dans la croûte épaisse et par plaques, aux fentes irrégulières (coordonnées déformées) et aux bords relevés plus orangés, de la poudre de rouille tombée sur les faces tournées vers le haut, et des gouttes perlées quand la pièce est mouillée.
- **Le front de rouille** : l'instant d'apparition purement local faisait rouiller toutes les faces dégagées en même temps ; la propagation géodésique (la rouille gagne de proche en proche depuis les rivets et les creux) donne le geste collectif attendu — des taches qui s'étendent et se rejoignent.
- **Le laser n'atteignait que les faces tournées vers lui** : les ailes des cornières restaient rouillées toute la boucle, et la pièce paraissait rouillée dès le début. La profondeur tolérée croît maintenant avec l'incidence rasante (la tête balaie aussi un peu de biais).
- **Les rails du portique barraient le premier plan** : le portique arrive maintenant de derrière la pièce, sur deux rails latéraux, tête relevée par-dessus, puis la tête descend.
- **La colonne de sablage masquait la pièce** : elle se place de profil par rapport à la caméra (on voit le jet de côté, règle de la cause lisible).
- **Le sablage ne voyait pas les grandes faces d'une pièce plate** : une buse qui vise l'axe est toujours parallèle à une face qui contient l'axe. Une face est maintenant décapée quand elle se tourne vers la buse, et l'occultation se lit dans 32 cartes de profondeur horizontales.
- **Le bain** : une cuve posée au sol mettait la pièce à 4 m de haut ; c'est une fosse dont le rebord affleure le sol. Ses battants pivotants traversaient la pièce suspendue : un couvercle unique roule sur le côté.
- **Exposition** : le posemètre a demandé de doubler la lampe de la Nuit d'usine et de la Cale sèche (médiane du sujet 0,007 et 0,03), et de baisser le Laboratoire et le Plein jour (20 à 30 % de pixels brûlés).

## h. Retours de l'utilisateur

- **La pluie était trop longue** : les averses passent de 42 % à 32 % de la boucle (u de 0,04 à 0,36), en 3 à 5 averses au lieu de 4 à 6 ; le décapage gagne le temps.
- **La roue avait des pièces détachées** : les plaques du contrepoids flottaient à 6 mm des rayons (elles les serrent maintenant, avec un remplissage coulé entre elles) ; le maneton tombait entre deux rayons (il est porté par un rayon) ; les pitons, vissés dans le bord de la jante, faisaient passer les élingues à travers le bandage (ils sont en haut du bandage).
- **Les chaînes n'étaient pas des chaînes** : la chaîne de levage empilait des anneaux horizontaux, et les élingues laissaient des jours entre les maillons. Chaque maillon tourne maintenant d'un quart de tour sur le précédent et passe dans lui, au pas de sa longueur intérieure.

## i. Audit de cohérence des pièces

À la demande de l'utilisateur (« des anneaux qui ne semblent attachés à rien »), un audit systématique (`src/gen/audit.js`, devenu un test) : le maillage de chaque pièce est séparé en éléments (composantes connexes après soudure des sommets), échantillonné à 2,5 mm, et chaque élément doit toucher le sol de proche en proche. Il a trouvé : la vanne entière posée sur des berceaux qui ne touchaient ni le tuyau ni leur semelle ; le battant de la porte à 4 mm de l'hiloire ; les nœuds de charnière reliés à rien. La relecture a ajouté ce que l'audit ne voit pas : pitons vissés hors du bord des brides ou dans le chant d'une tôle de 10 mm (remplacés par des oreilles de levage percées et rivetées, une manille dans le trou), bras des taquets à 3 mm du battant, plaque de laiton décollée, goujons du presse-étoupe qui ne descendaient dans rien, cloison pleine derrière la porte (vue de dos sur le plateau tournant : une porte qui ouvre sur un mur — la cloison est maintenant percée), poignée du taquet du bas dans la cornière du pied, roue levée par des trous taraudés dans la bande de roulement (elle pend maintenant à un palonnier, par deux étrangloirs autour du maneton et de l'essieu), et élingues qui traversaient la pièce (la hauteur du crochet est calculée pour qu'aucune chaîne ne passe à moins de 3 cm de la pièce).
