# Burrow — concept (document de travail)

Jour 27 dans l'index (le jour 26 est Anamorph). Contrainte posée par l'utilisateur dès le départ : **le naturel procédural photoréaliste est très difficile** (terre, poil, chair, écorce, herbe). On cherche donc un terrier dont l'image tient sur des matières **dures, usinées, coulées, taillées ou transparentes**, où l'organique n'est que dans la *forme* (calculée par un modèle publié), jamais dans la *texture*.

## a. Le thème en largeur

**Physique et science.** Creuser = déplacer un milieu granulaire (angle de talus ~30–35°, effet de voûte, arches de grains qui tiennent un plafond) ; la ventilation des terriers de chiens de prairie par la différence de vent entre deux buttes (Vogel, effet Bernoulli) ; la nidification des fourmis comme auto-organisation (Buhl et al. 2004 ; Toffin et al., PNAS 2009 : transition de forme d'une chambre ronde vers des galeries ramifiées) ; l'architecture des nids de *Pogonomyrmex badius* (Tschinkel : un puits hélicoïdal, des chambres « en crêpe » lobées, dont l'aire décroît avec la profondeur) ; la sonde de fusion (cryobot, IceMole) qui descend dans la glace et dont le trou regèle derrière elle ; les ichnofossiles (*Thalassinoides*, la spirale de *Zoophycos*) ; les bivalves foreurs (pholade, qui râpe la craie en tournant sa coquille, et qui luit).

**Métiers et objets.** Le tunnelier (roue de coupe, molettes, voussoirs, érecteur, clé de voûte posée en dernier) ; le bouclier de Brunel (Thames Tunnel, 1825 : douze cadres de fonte qui avancent en alternance, inspiré du taret qui perce le bois des navires) ; le forage-minage (jumbo, volée de trous, tir, marinage) ; le mineur et son étai ; le moulage de fourmilière à l'aluminium fondu (Tschinkel, puis des artistes qui en vendent) ; le fondeur, le noyau de sable, la cire perdue.

**Art, photo, cinéma.** Les moulages de Tschinkel photographiés sur fond neutre, comme des lustres ; les écorchés de l'Encyclopédie et les coupes de mines d'Agricola (*De re metallica*) ; la « forteresse de la taupe » de Le Court (1803), un plan mythique recopié pendant un siècle ; Burtynsky (mines, carrières) ; les Becher (typologies frontales) ; Blossfeldt (la forme sculptée sur fond neutre) ; Sugimoto (le temps long).

**Vocabulaire.** Terrier, garenne, galerie, gîte, taupinière, déblai, front de taille, voussoir, clé, marinage, bouclier, molette, tunnelier, puits, chambre, crêpe, moulage, jet de coulée, évent, ichnofossile, bioturbation, regel.

**Cycles et transformations.** Le vide devient plein (le moulage) puis redevient vide (on vidange) ; le trou se referme derrière la sonde (regel) ; le tunnel avance d'un anneau et la scène se répète à un anneau près ; le terrier abandonné se remplit de sédiment d'une autre couleur et devient fossile.

**Lumière.** Le métal en fusion qui éclaire son propre chemin dans le sable ; la glace stratifiée (bulles, cendres, couches annuelles) traversée par une sonde chaude ; la lampe frontale du tunnelier sur le front de taille ; un moulage d'aluminium mat sur fond noir, qui accroche une lampe rasante.

## b. Clichés écartés

1. Le lapin et sa garenne en coupe façon livre d'enfant (organique, mignon, impossible en photoréel).
2. La fourmilière entre deux vitres avec des fourmis qui courent (petits animaux en gros plan : hors budget photoréel).
3. La plongée dans un tunnel sans fin (déjà Hollow).
4. La taupe qui pousse des taupinières sur une pelouse (herbe, terre, poil).
5. Le ver de terre dans un profil de sol.

## c. Les pistes

| # | Piste | Image | Geste et boucle | Cœur technique |
| --- | --- | --- | --- | --- |
| 1 | **Le moulage** (sablier de métal) | Un bloc de sable stratifié coupé net comme une maquette ; dedans, le vide d'une fourmilière : un puits hélicoïdal et des chambres lobées. | Du métal en fusion versé par le haut descend le puits et remplit les chambres une à une en rougeoyant ; il refroidit, gris d'argent, et le terrier se lit enfin. Puis le bloc chauffe par dessous, le métal refond et se vidange par un trou de coulée au pied, dans le creuset qui remonte verser à nouveau : le terrier est un sablier de métal. | Architecture de nid générée par un modèle publié (Tschinkel ; Toffin et al.), remplissage par écoulement sur un graphe de cavités (chaque chambre est un bassin qui déborde), front de solidification, matériau incandescent → solide. |
| 2 | **Le tunnelier** | Un tunnelier en coupe longitudinale dans une tranche de roche sciée, de la roue de coupe aux voussoirs. | La roue tourne, les molettes mordent le front, les vérins poussent d'un anneau ; l'érecteur pose six voussoirs puis la clé ; la machine avance, la caméra la suit. Boucle par translation d'un nombre entier d'anneaux, sur une géologie périodique le long de l'axe. | Cinématique exacte (molettes sur cercles concentriques, pas des vérins), découpe de la roche par CSG cumulée, pose des voussoirs, géologie plissée périodique. |
| 3 | **Les trois boucliers** (variante de 2) | Même tranche de roche, trois familles de creuseurs : tunnelier, bouclier de Brunel à cadres qui marchent, jumbo de forage-minage. | Trois gestes : rotation continue, marche alternée des cadres, forage puis tir puis marinage. | Comme 2 + le cycle de Brunel (planches retirées une à une, cadres alternés). |
| 4 | **La sonde de fusion** | Un bloc de glace claire stratifiée (bulles, lit de cendre, couches annuelles), une sonde de cuivre chaude qui y descend au bout de son câble. | La sonde fond son chemin ; derrière elle le trou regèle depuis les parois, en piégeant une colonne de bulles. Boucle par auto-similarité (la caméra descend avec la sonde, strates périodiques). | Problème de Stefan (fusion/regel), bulles par nucléation, rendu de la glace par lancer de rayons. |
| 5 | **La pierre à terriers** | Une dalle de calcaire poli où des terriers fossiles remblayés d'un autre sédiment dessinent un motif (*Thalassinoides*, spirale de *Zoophycos*). | Une scie avance dans le bloc, chaque tranche polie montre une autre coupe du réseau 3D (méthode de Sollas, 1904). Boucle : le bloc est un tore de pierre, la scie en fait le tour. | Réseau 3D d'ichnofossiles (spreite hélicoïdale à lunules), coupe exacte d'un champ, marbre cuit. |
| 6 | **La pholade lumineuse** | Un banc de craie à marée basse, criblé de trous ; la nuit, chaque trou luit en bleu. | Les coquilles râpent la craie en tournant ; la marée monte et descend. | Coquille paramétrique (Raup), forage par râpe. |
| 7 | **Le vent dans le terrier** | Un terrier en U en coupe entre deux buttes ; une fumée qui le traverse. | Le vent sur la butte haute aspire l'air du terrier (Bernoulli, Vogel) ; la fumée s'y engouffre et ressort. | Écoulement 2D dans le terrier, volume de fumée. |
| 8 | **Le typographe** | Une bûche écorcée où les galeries des scolytes s'écrivent comme une calligraphie. | Galerie maternelle, larves qui rayonnent en s'élargissant, loges de nymphose. | Croissance d'arbre de galeries, gravure du bois. |
| 9 | **La forteresse de la taupe** | Le plan mythique de Le Court construit pour de vrai, en coupe. | La taupe creuse les anneaux concentriques. | Réseau de galeries. |

## d. Notes (1 à 5)

| # | Originalité | Esthétique | Boucle | Cœur technique | Variations | Faisabilité (photoréel) | Regard | Total |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 Le moulage | 5 | 5 | 4 | 4 | 4 | 4 | 5 | **31** |
| 2 Le tunnelier | 4 | 4 | 4 | 4 | 3 | 5 | 3 | 27 |
| 3 Les trois boucliers | 4 | 4 | 4 | 4 | 5 | 3 | 3 | 27 |
| 4 La sonde de fusion | 4 | 5 | 3 | 4 | 3 | 3 | 4 | 26 |
| 5 La pierre à terriers | 4 | 4 | 3 | 4 | 4 | 4 | 4 | 27 |
| 6 La pholade | 5 | 4 | 2 | 3 | 2 | 2 | 4 | 22 |
| 7 Le vent | 4 | 3 | 4 | 3 | 2 | 3 | 2 | 21 |
| 8 Le typographe | 4 | 4 | 2 | 3 | 3 | 2 | 4 | 22 |
| 9 La forteresse | 3 | 3 | 2 | 2 | 2 | 2 | 3 | 17 |

Faisabilité notée face à la contrainte de l'utilisateur : 6, 8 et 9 demandent de la chair, du bois brut ou de la terre en gros plan ; 4 refait une colonne de glace (Melt, premier essai : « n'évoque rien ») et une descente (Hollow).


L'utilisateur a choisi **1, le moulage**.

## Révision avant de coder : le sable devient un gel, le bronze devient du gallium

Pensée jusqu'au bout, la version « sable et métal en fusion » ne tenait pas :
- **On ne voit rien.** Le sable est opaque : le remplissage, qui est le geste, se passe hors de vue. Pour le montrer, il fallait une coupe impossible, qui laisserait le métal s'échapper par la tranche.
- **La boucle exige une machinerie.** Pour retrouver le vide de départ, il faut vider le bac (lit fluidisé), réensabler autour du moulage, refondre le métal à l'aveugle (induction) et remonter le creuset (palan). C'est un banc de fonderie, et l'appareil mange le sujet (règle 24).
- **La gamme est chaude** (incandescence, bronze, sable), alors que la collection en a déjà en excès (règle 25).

Variante proposée et acceptée : **le sablier de gallium**. Le bulbe du haut contient du gallium, qui fond à 29,8 °C. Le bas est un bloc de gel limpide creusé d'un terrier. Le soleil d'une fenêtre fait fondre le gallium, qui coule par le col et remplit le terrier sous nos yeux. Le soir, il fige en une sculpture d'argent cristallisée. On retourne le sablier ; le lendemain, le soleil refond le moulage et le terrier se vide dans le bulbe. Deux demi-tours font un tour.

Ce que l'on garde du moulage : le vide qui devient plein, puis redevient vide ; le terrier qu'on ne voit qu'en le coulant ; un objet de métal digne d'une vitrine.

## e. La piste retenue : *Burrow, le sablier de gallium*

**La liberté :** la terre du terrier est un gel limpide, à l'échelle d'un objet de bureau. Le terrier garde l'architecture qu'il aurait dans le sol (les crêpes de *Pogonomyrmex*, la vis de *Daimonelix*), et tout le reste est exact : le point de fusion du gallium, la gravité, les vases communicants, le soleil qui chauffe, l'air qui reste piégé.

**Le geste :** le terrier se dessine en argent, depuis son fond jusqu'à son entrée, puis s'efface. Une forme invisible (un vide dans un gel) devient une sculpture, puis redevient un vide.

**Le lien avec la collection :** le métal fait le tour du sablier. Il passe d'un lingot à un liquide, puis à un moulage figé, de nouveau à un liquide, puis de nouveau à un lingot, et revient à sa place par l'autre côté.

### Faits physiques qui font le film

| Fait | Valeur | Ce qu'il donne à l'image |
| --- | --- | --- |
| Fusion du gallium | 29,76 °C | un rayon de soleil suffit : la cause est domestique, sans appareil |
| Surfusion du gallium | reste liquide bien en dessous de 29,8 °C tant qu'aucun germe ne l'amorce | le soir, la prise part d'un point (le col, où un germe solide est resté) et court dans le terrier : un **front de cristallisation** visible |
| Dilatation à la solidification | + 3,1 % (comme l'eau) | la surface libre de l'entrée se bombe un peu quand elle prend |
| Masse volumique | 6,1 g/cm³ | le métal coule franchement, ne goutte pas en suspension |
| Gel d'agar | prend vers 35 °C, ne fond qu'à 85 °C (hystérésis) | le gel reste solide quand le gallium fond : le terrier garde sa forme |
| Indice du gel | n ≈ 1,335 | un vide d'air dans le gel se borde d'un liseré argenté par réflexion totale au-delà de 48,5° : on voit le terrier vide, mais transparent |

**Le théorème de la boucle : tout ce qui se remplit se vide.** Au remplissage, sablier droit, un point du terrier reçoit du métal si l'air qui s'y trouve peut s'échapper vers l'entrée, c'est-à-dire s'il existe un chemin de ce point jusqu'à l'entrée **qui ne descend jamais**. Sinon, une bulle reste piégée, et l'image la montre. À la vidange, sablier retourné, le métal d'un point s'écoule si un chemin le mène à l'entrée (désormais en bas) sans jamais remonter dans le repère retourné. C'est le même chemin parcouru dans le même sens du repère du terrier, donc la même condition. L'ensemble rempli et l'ensemble vidé sont identiques : la boucle se referme par la physique, quelle que soit la forme du terrier. Le test l'affirme sur chaque famille.

### Formule de la boucle

Cycle de transformations (loop.md, schéma 6) sur deux jours. L'angle du cadre vaut θ(u) = π·(s(u; 0,44, 0,48) + s(u; 0,92, 0,98)), avec s une rampe lisse de 0 à 1. Il passe de 0 à 2π : un tour entier, donc l'identité. L'état du métal est une fonction de u par morceaux :

lingot au plafond du bulbe → liquide qui descend → terrier rempli jusqu'à la fraction f(u) → figé, d'un front g(u) → retourné → fondu, d'un front m(u) → vidé jusqu'à la fraction d(u) → flaque dans le bulbe → figée → retournée = lingot au plafond du bulbe.

À u = 1, le cadre a fait un tour, le lingot est au plafond du bulbe, le terrier est vide : c'est l'état u = 0. Le soleil fait deux jours (sa course est périodique de fréquence 2).

### Découpage (48 s, deux jours)

| u | Temps | Ce que l'œil regarde |
| --- | --- | --- |
| 0,00–0,05 | Aube, jour 1 | Le sablier droit. Dans le bloc de gel, le terrier vide n'est qu'un dessin de liserés argentés. En haut, un lingot gris cristallin est collé au plafond du bulbe. |
| 0,05–0,10 | La tache de soleil | Le rectangle de la fenêtre glisse sur la table et monte sur le sablier. À l'instant où il touche le bulbe, le lingot devient miroir, s'affaisse et coule. |
| 0,10–0,32 | **Le remplissage** (temps fort 1) | Un filet d'argent descend le col puis le puits. Il trouve le fond, et le niveau monte : vite dans le puits, lentement dans chaque chambre. Selon la famille, des bassins se remplissent l'un après l'autre et débordent, et des bulles d'air restent piégées. Le terrier se dessine en argent, du bas vers le haut. |
| 0,32–0,37 | L'après-midi | Le terrier plein brille. La tache de soleil le quitte. |
| 0,37–0,43 | **La prise** (temps fort 2) | Au crépuscule, un front de cristallisation part du col et parcourt le moulage. Le miroir devient un argent bleuté à facettes, et l'entrée se bombe. |
| 0,43–0,50 | Nuit : **le retournement** (temps fort 3) | Le sablier pivote d'un demi-tour sur ses tourillons. La sculpture passe dans la lumière bleue. |
| 0,50–0,58 | Aube, jour 2 | Le bloc est en haut, le bulbe vide en bas. |
| 0,58–0,64 | La fonte | La tache de soleil atteint le bloc. Le moulage redevient miroir, du côté du soleil vers l'autre. |
| 0,64–0,82 | **La vidange** | Le niveau descend dans le terrier retourné, le métal sort par l'entrée et le col, et la flaque monte dans le bulbe. Le terrier s'efface, de son ancien fond vers son entrée. |
| 0,82–0,90 | Crépuscule | La flaque du bulbe prend. |
| 0,90–1,00 | Nuit : le retournement | Le sablier pivote encore d'un demi-tour, dans le même sens. Le lingot se retrouve au plafond du bulbe. |

Respirations : ralenti (noyau K₇) sur les débordements et sur le front de prise, accéléré pendant la nuit et l'après-midi.

### Le cœur technique

1. **Les terriers**, champs de distance signée tirés de modèles publiés :
   - Tschinkel (*Pogonomyrmex badius*) : un puits en hélice lâche, des chambres en crêpes lobées dont l'aire décroît avec la profondeur et qui s'espacent vers le bas ;
   - *Daimonelix* (terrier fossile de *Palaeocastor*) : une vis de six à huit tours, qui finit sur une chambre en pente ;
   - la garenne : des galeries qui montent et descendent, avec des culs-de-sac, d'où viennent les débordements successifs et les bulles piégées ;
   - le treillis de *Thalassinoides* : des étages de galeries horizontales reliés par des puits, qui se noient d'un coup quand le niveau les atteint.

   Le champ est cuit dans une texture 3D.
2. **Le remplissage calculé** sur la grille de voxels, dans un worker :
   - l'ensemble qui peut se remplir : les voxels atteints depuis l'entrée par un chemin qui ne monte jamais ;
   - l'ordre de remplissage, par un remplissage-débordement à files de priorité. Le métal descend la plus forte pente jusqu'à un minimum, le bassin monte, déborde par son seuil et le filet repart vers le bassin suivant ;
   - la vidange, par le même algorithme dans le repère retourné ;
   - le front de prise, par une distance géodésique depuis le col.

   Chaque voxel reçoit sa fraction de remplissage, sa fraction de vidange, sa distance de prise et la distance au filet avec son intervalle d'activité. La surface libre est l'isosurface de la fraction : horizontale par construction dans un bassin.
3. **Le lancer de rayons dans le gel** : réfraction à l'entrée du bloc, marche dans le champ, réflexion totale ou réfraction sur les parois du vide, métal miroir ou cristallin selon le champ et l'instant, réfraction à la sortie, puis le fond lu à l'écran.

**Invariants testés :**
- ensemble rempli = ensemble vidé ;
- le volume de gallium est le même dans le bulbe et dans le terrier ;
- la fraction de remplissage croît avec la hauteur dans chaque bassin ;
- la fonte commence à l'instant où la tache de soleil touche le métal (écart nul) ;
- l'angle du cadre vaut 2π sur la boucle ;
- aucune pièce du cadre ne traverse une autre pendant le retournement ;
- le raccord à u = 1.

### Matrice de variations

| Axe | Valeurs |
| --- | --- |
| Famille de terrier (le rythme du remplissage) | **Lustre** (en paliers : rapide dans le puits, lent dans chaque crêpe) ; **Vis** (un long filet qui tourne, puis une montée continue qui tourne avec lui) ; **Garenne** (bassins qui débordent l'un dans l'autre, bulles piégées) ; **Treillis** (étages noyés d'un coup) |
| Gel | limpide ; aigue-marine ; vert d'eau ; fumé |
| Monture du sablier | laiton tourné à trois colonnes ; fonte noire à quatre piliers carrés ; acier brossé à deux montants plats ; bois noirci et laqué, tourné |
| Humeur (décor, lumière, valeur) | Rebord, Hiver, Verrière, Cabinet, Midi, Ardoise (voir ci-dessous) |
| Cadrage | trois-quarts à hauteur du bloc ; contre-plongée ; plongée à 55° ; gros plan sur le bloc |
| Paramètres du terrier | profondeur, nombre de chambres, pas de l'hélice, lobes : tirés par famille |

Cela donne 4 × 4 × 4 × 6 × 4 = 1 536 combinaisons de structure, sans compter les paramètres continus.

### Humeurs (épreuve de variété)

| Humeur | Décor | Lumière | Valeur | Cadrage |
| --- | --- | --- | --- | --- |
| **Rebord** (d'après Hammershøi) | mur de plâtre gris perle, rebord laqué blanc cassé | soleil franc par une fenêtre à croisillons, tache nette | claire, grise | trois-quarts, de face, calme |
| **Hiver** | ardoise mate, mur bleu-gris | soleil très bas, rasant, rebond bleu de neige | moyenne, froide | contre-plongée |
| **Verrière** | table de zinc, cyclorama vert-de-gris pâle | lumière zénithale diffuse, soleil voilé | claire, douce | plongée à 55° |
| **Cabinet** | laque noire, fond noir velouté | une lampe chauffante à réflecteur qui s'allume et s'éteint (le jour, c'est elle) | sombre | gros plan |
| **Midi** | terrazzo blanc, mur blanc | soleil haut et dur, ombres courtes et noires | très claire, contrastée | trois-quarts haut |
| **Ardoise** (d'après Hammershøi) | plâtre ocre gris, plancher peint gris | fenêtre au nord, lumière douce et froide | basse, sourde | de face, sur l'axe |

Chaque humeur a sa phrase sans couleur, et aucune ne ressemble à une autre. Au moins deux humeurs sur six suivent le regard choisi.

### Le regard : Vilhelm Hammershøi

- **La valeur** : des gris qui se tiennent, sans noir bouché ni blanc brûlé.
- **La lumière** : le seul événement est la lumière d'une fenêtre, posée en rectangle sur le mur et le plancher.
- **Le cadrage** : frontal et calme, un seul objet, beaucoup d'air autour, et la fenêtre hors champ.

Ici, la tache de la fenêtre est la cause du film. Hammershøi impose de la montrer comme une lumière (un rectangle aux bords francs qui glisse), jamais comme un projecteur.

### Ambition (objet de musée)

- **Le sablier :** deux platines moulurées, des colonnes tournées (baguettes, tores, gorges), des écrous à chapeau, deux tourillons et leurs paliers, un pied à deux montants avec son socle, un bulbe soufflé avec son col et un raccord à bague.
- **La caisse du bloc :** en verre, avec des cornières.
- **Le gel :** il porte un léger ménisque au contact du verre.
- **Le moulage :** miroir quand il est liquide, à facettes quand il est cristallisé, avec ses bulles piégées.
- **Le lingot :** il a la forme du bulbe où il a pris.

Cela fait plus de dix éléments de construction.

### Échelle et références

- **Les moulages de Tschinkel :** des aluminiums de 1 à 3 m, une hélice de puits de 1 à 2 cm de diamètre, des chambres de 5 à 15 cm de large pour 1 à 2 cm de haut. Ici, à l'échelle 1:12 environ, cela donne un puits de 6 à 8 mm et des crêpes de 3 à 5 cm dans un bloc de 15 × 10 × 18 cm.
- **Les fourmilières de gel du commerce :** gel bleu translucide, galeries de 4 à 6 mm, contraste faible. Le liseré de réflexion totale est ce qui les dessine.
- **Le gallium fondu dans la main :** un miroir parfait, une peau d'oxyde qui ride à peine, des gouttes lourdes.
- **Le gallium solide :** des cristaux massifs gris bleuté aux faces planes, d'un éclat moins vif que le liquide.
- **Un sablier de chapelle sur pivot :** platines et colonnes tournées, environ 35 cm de haut.

Dans le plan principal, le bloc occupe 40 à 60 % de l'image (règle 23). Ce qui donne l'échelle : le grain de la table, les colonnes et le soleil d'une fenêtre.

### Images clés

1. **Le remplissage (Rebord).** De face, trois-quarts. Le rectangle de soleil coupe le bloc en diagonale. Un filet d'argent tombe dans le puits, et trois crêpes du bas sont déjà pleines : des disques miroirs qui renvoient la fenêtre. Plus haut, les chambres encore vides ne sont que des liserés.
2. **La prise (Hiver).** En contre-plongée, lumière rasante. Le front de cristallisation est à mi-hauteur : en dessous, le métal miroir ; au-dessus, l'argent bleuté à facettes.
3. **Le retournement (Cabinet).** La lampe éteinte, le sablier à 90°. La sculpture est couchée dans le bloc, son contour seul allumé par un contre-jour, et le bulbe vide brille.

### Risques et parades

| Risque | Parade |
| --- | --- |
| Le terrier vide est invisible dans le gel | liseré de réflexion totale exact, gel légèrement teinté (l'air du vide ne l'est pas), fond moyen derrière le bloc (règle 19) |
| Le lancer de rayons est trop cher | une marche bornée à la boîte du terrier, un pas égal à la distance signée, un nombre de pas plafonné ; demi-résolution en mobile |
| La surface libre crénelée par les voxels | fraction stockée lisse (volume cumulé), interpolation trilinéaire, normale par le gradient |
| La nuit trop sombre | une heure bleue, jamais le noir ; c'est le fond qui fait la nuit, posemètre sur le sujet |
| Le retournement, sans cause visible | une rampe lente, avec anticipation et rebond, d'allure humaine. On ne voit pas la main (règle 24), mais on lit le geste de quelqu'un qui retourne un sablier. |

### Épreuve de crédibilité

| Temps | Cause visible | Loi | Temps du film |
| --- | --- | --- | --- |
| Fonte du lingot | la tache de soleil qui le touche | absorption, 29,8 °C | accéléré |
| Le filet et le remplissage | la gravité ; le col qui limite le débit | écoulement à débit constant, vases communicants, air piégé | accéléré (environ 30 s réelles → 10 s) |
| La prise | le crépuscule, et le germe resté au col | surfusion amorcée, front à vitesse constante | légèrement accéléré |
| Le retournement | la main hors champ (le geste se lit) | rotation lente du cadre sur ses tourillons | temps réel |
| La fonte du moulage | la tache de soleil sur le bloc | conduction, du côté éclairé vers l'autre | accéléré |
| La vidange | la gravité, l'entrée désormais en bas | même calcul, repère retourné | accéléré |

### Écran de chargement

La coupe du terrier de la graine, dessinée de face. Les voxels s'allument dans l'ordre réel du remplissage pendant son calcul : on voit les bassins se noyer, les filets descendre et les bulles d'air rester noires. Le dessin avance avec les étapes réelles (champ, ensemble remplissable, remplissage, vidange, prise).

## Révision 1 : le sablier de gallium est refusé

Premiers rendus montrés à l'utilisateur : « beaucoup d'éléments techniques, mais au final tout ce que voit le spectateur c'est un mini labyrinthe qui change de couleur, le liquide tombe, puis tout devient noir ; ça n'évoque pas le thème, ça n'a rien d'artistique, et on ne comprend pas l'aspect technique ».

Ce qui n'allait pas : le verbe du thème (creuser) n'était jamais montré, seulement le moulage d'un terrier déjà fait ; le sujet (des fils d'argent dans un gel gris) occupait peu de l'image, derrière un cadre et un pied qui la mangeaient ; le calcul (bassins qui débordent, air piégé) n'avait aucune traduction visible. Le prototype est rangé dans `proto/sablier/`.

## Révision 2 : la coupe vivante, validée sur une image

Trois directions proposées (coupe vivante, moulage révélé, radiographie) ; l'utilisateur choisit la coupe vivante, avec une consigne : pas de légende, la scène doit parler par son visuel. Une seule image clé est faite d'abord, sans simulation (`docs/wip/lookdev-coupe-*.jpg`), et validée.

La liberté : des fourmilières en coupe rangées comme des livres sur une étagère, chacune lancée un peu après sa voisine, et une caméra qui avance à la vitesse du temps. Ce qui se lit sans légende : la cause (les fourmis), l'effet (les galeries), la conservation (le tas rayé des couleurs du fond, empilées à l'envers).

La boucle : une pluie qui laverait le tas mélangerait les couleurs et ne rendrait pas les strates. Trois structures sont proposées (sablier de sable, étagère, fondu) ; l'utilisateur choisit l'étagère : trois tranches qui se répètent, une translation de trois pas par boucle.

Le regard : Hammershøi, pour la lumière de fenêtre, les gris qui se tiennent et le rythme des trumeaux sur le mur du fond.
