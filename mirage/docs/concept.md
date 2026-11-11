# Mirage — document de travail

Thème donné : « mirage ». Le projet s'appelle **Mirage**, sous-titre *l'objet qui n'est pas là*.

Ce document est le troisième concept. Les deux premiers — un horizon au très long foyer (Fata Morgana au soleil de minuit), puis un cabinet de physique (cuve de sirop, plaque chaude) — sont gardés en annexe, avec les retours qui les ont fait abandonner : le premier était juste mais illisible (la cause invisible, la seconde apparence une simple déformation) ; le second lisible mais resté une démonstration de laboratoire. Ce que le mot doit donner à voir : **une chose qu'on voit nettement, et qui n'est pas là**.

## Le mirascope

Deux miroirs paraboliques concaves, posés l'un sur l'autre, faces argentées en regard ; le sommet de chacun est au foyer de l'autre, et celui du haut est percé d'une ouverture. Un petit objet posé au fond, invisible de l'extérieur, se montre **au-dessus de l'ouverture**, en relief, éclairé, plus vrai que nature — on tend la main et on ne touche rien. L'objet a été inventé et breveté sous le nom de « Mirage » (Elings et Landry, 1972) ; on l'appelle aussi « miroir fantôme ».

Pourquoi c'est la bonne piste :
- **On voit une chose qui n'est pas là**, au sens propre : l'image réelle flotte dans l'air, en trois dimensions, et elle change avec le point de vue comme un vrai objet.
- **La cause est un objet qu'on voit et qu'on manipule** : deux coupes d'argent. Le geste qui révèle le mirage se lit sans légende : **on soulève le couvercle — l'objet qui flottait disparaît, et on le découvre au fond ; on le repose — il remonte à la surface.**
- **Le cœur technique est exact** : un lancer de rayons au pixel dans deux paraboloïdes (deux réflexions), sans aucune approximation de reflet : l'image réelle se forme d'elle-même.
- **Un objet de musée** : coupes d'argent guillochées, pied tourné, couvercle porté par une potence à crémaillère.

## Le geste et la boucle

| u | ce qu'on voit | cause |
| --- | --- | --- |
| 0 – 0,22 | le mirascope fermé ; au-dessus de l'ouverture flotte l'objet (une toupie qui tourne, une montre ouverte, une flamme) ; la caméra tourne lentement autour | — |
| 0,22 – 0,38 | la crémaillère soulève le couvercle : l'image monte avec lui, s'étire, se brouille et s'évanouit | le couvercle qui se lève (le pignon tourne) |
| 0,38 – 0,58 | couvercle levé : la caméra plonge et découvre l'objet au fond de la coupe — le vrai, plus petit, à sa place | — |
| 0,58 – 0,74 | le couvercle redescend : au-dessus de l'ouverture, l'image se reforme, se resserre, se pose | le couvercle qui se pose |
| 0,74 – 1 | fermé, l'objet flotte à nouveau ; la caméra remonte | — |

La boucle est parfaite : la levée du couvercle et la caméra sont des fonctions périodiques de u ; la toupie fait un nombre entier de tours, la trotteuse de la montre deux tours, la flamme vacille à des fréquences entières de la boucle. L'image de la montre est tournée d'un demi-tour : elle flotte avec l'heure décalée de six heures, comme sur un vrai mirascope.

## Familles (le mouvement de l'objet)

- **Toupie** — elle tourne et précesse : l'image tourne en l'air.
- **Montre** — une montre de gousset ouverte, ses aiguilles avancent : l'image donne l'heure.
- **Flamme** — une bougie chauffe-plat (godet d'aluminium, cire colorée) : la flamme brûle dans le vide au-dessus de l'ouverture. (D'abord une bougie haute : l'image de sa flamme, 1,8 cm au-dessus du fond, sortait du champ que l'ouverture laisse voir, et sa lueur blanche se perdait sur la cire blanche.)

## Décors

Cabinet de curiosités (velours sombre, lampe chaude), atelier d'horloger (établi, lumière de fenêtre), salon (marbre, lumière douce), nuit (la flamme seule, ou une lampe de poche).

## Références

Les photographies du mirascope (Optigone) : la coupe de 15 cm, l'ouverture de 5 cm, le cochon ou la grenouille en plastique qui semble posé sur l'ouverture ; l'image se voit sous un cône d'environ 30 à 60° au-dessus de l'horizontale ; de profil, l'ouverture est vide.

---

# Annexe : les deux premiers concepts

# Mirage — document de travail

Thème donné : « mirage ». Le projet s'appelle **Mirage** (dossier `mirage/`), sous-titre *l'horizon replié* : un mirage n'ajoute rien au monde, il **replie** l'horizon — la fonction qui envoie la hauteur vraie d'un point sur sa hauteur apparente se plie, et là où elle se plie, une même chose se voit deux, trois, cinq fois.

## a. Le thème en largeur

**La physique.**
- L'indice de l'air dépend de sa densité : (n − 1)·10⁶ = N ≈ 77,6 P/T (P en hPa, T en K ; Smith-Weintraub, Edlén). Au niveau de la mer, N ≈ 290 à 0 °C, 250 à 40 °C : un degré de plus, ΔN ≈ −1.
- Un rayon presque horizontal se courbe vers l'air le plus dense : sa courbure vaut −dn/dz. L'atmosphère standard (dN/dz ≈ −40 /km) courbe les rayons au quart de la courbure de la Terre (coefficient de réfraction k ≈ 0,13–0,17) : on voit un peu au-delà de l'horizon géométrique.
- **Mirage inférieur** : un sol chaud (asphalte, sel, sable) fait un gradient de −0,1 à −1 K/cm dans les premiers décimètres ; les rayons qui rasent le sol s'y retournent vers le haut et l'œil voit le **ciel sous l'horizon** — le « lac ». Angle maximal de la déviation : √(2ΔN·10⁻⁶) ≈ 0,25° pour ΔN = 10. Les objets lointains se doublent d'une image renversée au-dessous ; leur pied « se noie ». La **ligne d'évanouissement** sépare ce qui se reflète de ce qui ne se reflète pas.
- **Mirage supérieur** : de l'air chaud au-dessus d'une mer froide (inversion) ; les rayons se courbent vers le bas plus que la Terre : **conduit** (duct) dès que dN/dz < −157 /km, soit une inversion d'environ +0,11 à +0,15 K/m. Les objets sont soulevés (*looming*), étirés (*towering*), écrasés (*stooping*), et derrière le conduit, des terres cachées sous l'horizon apparaissent (*hillingar*, effet Novaïa Zemlia).
- **Fata Morgana** : une inversion élevée, l'œil au voisinage de sa base ; la fonction de transfert (hauteur apparente ↔ hauteur vraie) devient non monotone : images droites et renversées empilées, bords de glace et coques étirés en murailles et en tours. Les « châteaux » viennent de petits reliefs de l'horizon étirés verticalement.
- **Caustique** : là où la fonction de transfert a une tangente horizontale, le grossissement vertical diverge ; c'est le pli entre une image droite et une image renversée (Lehn, 1985 ; Young).
- **Le soleil couchant** à travers une inversion : soleil en Ω, en vase étrusque, en piles de crêpes tranchées ; le **rayon vert** vient de la dispersion (N rouge ≈ 288, N vert ≈ 291, N bleu ≈ 294) amplifiée par le mirage.
- Réfraction astronomique à l'horizon : 34′ (plus de 40′ par air froid) : on voit le soleil alors qu'il est géométriquement sous l'horizon.
- La température suit le soleil avec retard : c'est le **second problème de Stokes** (une onde thermique amortie qui pénètre dans l'air avec un déphasage) ; un sol de faible inertie (croûte de sel) répond en une à deux minutes à l'ombre d'un nuage.
- **Miroitement** : la turbulence thermique fait danser et brouille l'image (scintillation, *seeing*) ; une inversion est stable et calme (images nettes), un sol chauffé est convectif (image qui bout).
- Le rayon reste dans le plan vertical de son départ si l'air est stratifié horizontalement : le mirage ne touche que la **hauteur** apparente, jamais l'azimut.

**Les métiers et les objets.**
- Les marins de l'Arctique et les baleiniers : terres « vues » qui n'existaient pas (Crocker Land, Peary 1906 ; la « terre de Sannikov ») ; Barents et l'effet Novaïa Zemlia (1597 : le soleil revu deux semaines trop tôt).
- Les navires pris dans les glaces (Fram, Endurance) : trois-mâts goélettes, coques arrondies pour être soulevées par la banquise.
- Les phares sur les écueils de la Baltique et de la mer Blanche ; les icebergs tabulaires.
- Les géodésiens et les arpenteurs (nivellement réciproque, coefficient de réfraction), les tireurs de précision (mirage dans la lunette).
- Les caravanes du sel sur les sebkhas et les salars ; les chotts de Tunisie, le salar d'Uyuni, le lac Eyre ; les lignes télégraphiques qui « se noient ».
- Les astronomes (seeing, réfraction), les photographes du rayon vert (télescopes, 2 000 mm).
- Les physiciens de la démonstration : plaque chauffante, cuve de sucre à gradient (Vollmer, *Mirrors in the air*, 2009).
- La strioscopie de Toepler et l'ombroscopie, qui rendent visibles les gradients d'air.

**L'histoire de l'art, la photographie, le cinéma.**
- Les photographies de Fata Morgana de Pekka Parviainen (navires et îles en tours au-dessus de la Baltique), les séries de navires « en lévitation » de la presse.
- Les photographies du rayon vert et du soleil tranché (Andrew T. Young, *An Introduction to Mirages* et *Green flash*, page de référence) ; Jules Verne, *Le Rayon vert*.
- Hiroshi Sugimoto, *Seascapes* : l'horizon seul, une ligne, au long foyer ; la sobriété qui convient au sujet.
- Le désert au téléobjectif dans *Lawrence d'Arabie* (Omar Sharif qui sort du mirage) : le cliché absolu.
- Le palais de la fée Morgane dans le détroit de Messine (Minasi, 1773), les gravures des « châteaux dans l'air ».
- Dalí et les mirages peints : l'hallucination, l'illusion (cliché).

**Le vocabulaire.** Mirage inférieur, supérieur ; Fata Morgana ; exhaussement (*looming*), allongement (*towering*), tassement (*stooping*), abaissement (*sinking*) ; hillingar (islandais), hafgerdingar ; conduit, inversion, ligne d'évanouissement, fonction de transfert, caustique ; réfractivité ; miroitement ; soleil en Ω, vase étrusque ; rayon vert ; Novaïa Zemlia ; strioscopie ; *l'horizon replié*.

**Les cycles et transformations.** Le jour réchauffe l'air au-dessus de la mer froide : l'inversion se forme, les images se soulèvent, s'étirent, se replient, puis la fraîcheur les rend à l'horizon. Un nuage passe devant le soleil : le sel refroidit en une minute, le lac se vide ; le soleil revient, le lac se remplit. Le soleil de minuit tourne autour de l'horizon sans se coucher : une horloge exacte de 24 h. La même chose (un navire) traverse les régimes : normal, soulevé, en tours, renversé, normal.

**La lumière.** Le mirage ne crée pas de lumière, il la déplace : le lac est le ciel (sa couleur est celle de l'horizon), une tour est le même pixel de coque étiré ; tout se lit par contraste de valeur sur un horizon presque uni. Lumière rasante du soleil de minuit (contre-jour doré, ombres immenses sur la glace), soleil haut et dur sur le sel (high key), brume de chaleur (perspective aérienne qui bleuit le lointain), dispersion au bord du soleil (franges rouges et vertes).

## b. Les clichés (interdits comme idée principale)

1. L'oasis et ses palmiers au milieu des dunes ; le voyageur assoiffé.
2. La route droite qui « mouille » au loin, une voiture qui sort de l'eau (*Lawrence d'Arabie*).
3. Le « heat haze » en post-traitement : une image qui ondule au hasard.
4. L'illusion, l'hallucination, le décor qui se dissout (Dalí).
5. Le bateau qui « vole » dans une photo isolée — devient ici un **temps** du film (le navire soulevé), pas son sujet : le sujet est la transformation continue, calculée.

## c. Les pistes

1. **Le soleil de minuit** — au téléobjectif, un navire pris dans la banquise à 15 km ; en une journée polaire en accéléré, l'inversion se forme, le navire s'élève, s'étire en tours, se replie en images empilées, et à minuit le soleil passe derrière lui, tranché en crêpes, frangé de vert ; puis tout retombe. Boucle : 24 h exactes. Cœur : tracé de rayons dans un profil de température, fonction de transfert par pixel.
2. **Le lac qui recule** — on avance sur une route droite vers un lac qui recule toujours ; les objets sortent de l'eau en approchant. Boucle : déplacement d'une période du décor. Cœur : idem, distance variable.
3. **Le salar aux nuages** — sur un salar blanc à midi, des îles flottent sur un lac de ciel ; l'ombre d'un nuage arrive, boit le lac, passe ; le soleil revient et le lac se remplit. Boucle : un train de nuages périodique. Cœur : profil dépendant de la distance, inertie thermique de la croûte.
4. **Le strioscope** — un banc de Toepler en laiton et acajou ; des objets chauds (fer à souder, théière, flamme) dressent devant le miroir des panaches qui s'impriment en couleur sur l'écran. Boucle : bouffées périodiques de la flamme. Cœur : panache de Boussinesq, strioscopie couleur.
5. **La cuve de sucre** — une cuve de verre à gradient de sucre ; un laser y décrit un arc, une figurine vue au travers se dédouble ; on verse, la diffusion lisse, on remue. Boucle : versement, diffusion, brassage. Cœur : équation des rayons dans un profil erf.
6. **Le soleil tranché** — un coucher de soleil sur la mer à travers des inversions : Ω, vase étrusque, crêpes, rayon vert. Boucle : impossible sans lever (un soleil qui se couche ne revient pas) — sauf soleil de minuit (absorbée par 1).
7. **Le mirascope** — deux miroirs paraboliques : une image réelle flotte au-dessus de l'ouverture. Boucle : un tour de l'objet. Cœur : optique des miroirs. (Le mot « mirage » y est commercial, pas physique.)
8. **La plaque de Vollmer** — un banc de laboratoire, une longue plaque chauffée par une rampe de brûleurs ; au ras de la plaque, une statuette se reflète dans un lac d'air. Boucle : brûleurs allumés, éteints. Cœur : couche limite thermique.
9. **Les lentilles d'indice** — une lentille de Luneburg, un œil de poisson de Maxwell, des barreaux à gradient d'indice : des objets de verre qui courbent la lumière. Boucle : rotation. Cœur : rayons dans un milieu à gradient.
10. **La forge** — une pièce rougeoyante, l'air qui bout au-dessus déforme l'atelier. (Cliché 3.)

## d. Notes

| Piste | Originalité | Esthétique | Boucle | Cœur | Variations | Faisabilité | Total |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1. Soleil de minuit | 4 | 5 | 4 | 5 | 4 | 3 | **25** |
| 2. Lac qui recule | 2 | 4 | 4 | 4 | 3 | 3 | 20 |
| 3. Salar aux nuages | 4 | 5 | 4 | 4 | 3 | 4 | 24 |
| 4. Strioscope | 5 | 4 | 3 | 4 | 3 | 3 | 22 |
| 5. Cuve de sucre | 4 | 3 | 3 | 4 | 2 | 4 | 20 |
| 6. Soleil tranché | 4 | 5 | 1 | 4 | 2 | 4 | 20 |
| 7. Mirascope | 3 | 3 | 3 | 3 | 2 | 4 | 18 |
| 8. Plaque de Vollmer | 3 | 2 | 3 | 4 | 2 | 4 | 18 |
| 9. Lentilles d'indice | 3 | 3 | 3 | 3 | 2 | 4 | 18 |
| 10. Forge | 1 | 3 | 3 | 2 | 3 | 4 | 16 |

**Retenue : 1, le soleil de minuit**, qui absorbe 3 et 6 : trois **familles** qui sont trois régimes du même phénomène, chacune avec son geste et son horloge (voir e ter), et le soleil tranché comme **temps fort** de la famille Morgane. La 4 (strioscope) est belle mais montre l'air chaud, pas le mirage ; la 2 refait le cliché 2.

Pourquoi la 1 : c'est le seul traitement où **le mirage est calculé, pas imité**. Chaque pixel suit son rayon courbé dans un profil de température réaliste ; les images multiples, les tours, le lac, le soleil tranché ne sont pas dessinés : ils sortent de la géométrie des rayons. Le geste (une chose réelle qui se replie en châteaux puis redevient elle-même) se lit sans légende ; la sobriété de l'horizon (Sugimoto) donne le fond neutre ; et aucun projet du dépôt n'est un paysage, ni un rendu par rayons courbes.

## e. La piste retenue

**L'image.** Un horizon au très long foyer (champ vertical de 0,5 à 1,5° : l'équivalent d'un 1 500 à 3 000 mm). En bas, la mer froide entre les plaques de banquise, ou le sel blanc, qui file vers l'horizon en lignes serrées ; au milieu, à 10–25 km, un sujet — un trois-mâts pris dans les glaces, un phare sur son écueil, un iceberg tabulaire — ou, plus loin, une côte de montagnes ; au-dessus, le ciel. Rien d'autre.

**Le geste.** L'horizon se replie. Le sujet se soulève, se double d'une image renversée, s'étire en tours et en murailles, s'empile, puis redevient lui-même ; ou une terre invisible monte de la mer ; ou le lac de ciel se remplit, puis se vide sous l'ombre d'un nuage.

### Découpage temporel (famille Morgane ; boucle de 60 s ; u = 0 à midi solaire)

| u | heure | ce qu'on voit | où regarde l'œil |
| --- | --- | --- | --- |
| 0,00 – 0,12 | 12 h → 17 h | soleil haut dans le dos (au sud), lumière franche sur le navire et la glace ; le navire est lui-même, à peine soulevé ; les ombres des plaques tournent | le navire |
| 0,12 – 0,32 | 17 h → 22 h | l'air se réchauffe au-dessus de la mer froide : le navire monte, une image renversée naît au-dessus de lui et s'étire ; le bord de la banquise se dresse en murailles | la coque qui se dédouble |
| 0,32 – 0,50 | 22 h → 23 h 50 | ralenti du temps-lapse ; le soleil, bas, entre dans le cadre par la gauche ; contre-jour doré ; les tours atteignent leur plus grande hauteur | les tours, la lumière qui tourne |
| 0,50 – 0,64 | 23 h 50 → 0 h 10 | ralenti profond : le soleil frôle l'horizon **derrière** le navire, tranché en crêpes par l'inversion, frangé de vert en haut et de rouge en bas ; les mâts se découpent dans son disque | le soleil |
| 0,64 – 0,80 | 0 h 10 → 4 h | le soleil sort du cadre à droite en remontant ; l'inversion faiblit, les tours se tassent, l'image renversée rejoint la coque | la retombée |
| 0,80 – 1,00 | 4 h → 12 h | lumière de matin, puis de midi ; le navire redevenu lui-même ; la glace scintille | calme |

Le temps fort est au milieu (le soleil derrière les châteaux), précédé d'une montée et suivi d'une retombée : **monter, culminer, retomber** — chaque grandeur du film (force de l'inversion, hauteur des tours) est monotone dans chaque temps.

### La formule de la boucle

Le temps solaire t ∈ [0, 24 h) est une fonction de la phase u : t = 24 h · τ(u), avec τ(u) = ∫₀ᵘ s / ∫₀¹ s, où s(u) > 0 est une vitesse périodique (deux creux : le ralenti des heures dorées, et un creux profond pendant le passage du soleil). τ(0) = 0, τ(1) = 1, τ strictement croissante.

Tout ne dépend que de t, avec des fonctions de période 24 h :
- le soleil : élévation et azimut par la sphère céleste (latitude φ, déclinaison δ, angle horaire 2π t / 24 h) ;
- le profil de température : T(z, t) = T_mer + Θ(z) + A(z)·cos(2π t / 24 h − ψ(z)), réponse harmonique du second problème de Stokes (amplitude décroissante et déphasage croissants avec la hauteur) ;
- la caméra : pose fixe (trépied), ou une lente dérive périodique en u.

**La boucle est parfaite par construction** : t(u + 1) = t(u) + 24 h et tout est 24 h-périodique.

Famille Lac : t = T_boucle · u (accéléré × 15 à 25) ; le champ de nuages défile d'une période L = v·T par boucle ; la température de la croûte est la réponse périodique (série de Fourier exacte) d'un premier ordre à l'ensoleillement ; idem.

### Le cœur technique

1. **Le profil** (`gen/atmosphere.js`) : T(r, z, t) selon la famille (inversion élevée, conduit de surface, couche chaude de sol), pression hydrostatique, réfractivité de Smith-Weintraub (N = 77,6 P/T) avec la dispersion d'Edlén pour trois longueurs d'onde ; la courbure de la Terre est portée par l'indice modifié M = N + 10⁶ z / R (terre plate équivalente : les objets sont posés sur z = 0).
2. **Le tracé** (`gen/rays.js`) : un éventail de 2 048 rayons par instant, de l'œil vers l'horizon, intégré en distance (RK4, pas adaptatif) dans le plan (r, z) — le rayon reste dans son plan vertical. Sur 128 instants de la boucle, dans les workers. Pour chaque rayon : la hauteur à laquelle il passe à la distance de chaque sujet ; s'il touche la surface, à quelle distance et sous quel angle (et le trajet réfléchi qui en repart) ; s'il s'échappe, son élévation de sortie.
3. **Le rendu** (`scene/mirage.js`) : chaque pixel connaît son élévation apparente α et son azimut ; il lit dans les tables, à l'instant de l'image, où son rayon arrive. Les sujets sont rendus normalement (three.js, lumières, ombres) dans des **cartes** posées à leur distance ; le pixel lit la carte à la hauteur où son rayon la traverse. Les images multiples sont **automatiques** : plusieurs α mènent à la même hauteur. Le ciel (diffusion simple, soleil, réfraction astronomique de Bennett par canal → rayon vert), la mer et la glace (Fresnel, rugosité de pose longue), le sel (croûte en polygones), la perspective aérienne, le miroitement (déplacement de α selon l'instabilité du profil) se calculent au pixel.
4. **Les invariants** (tests) : invariant de Snell n(z)·cos θ conservé le long d'un rayon (milieu stratifié) ; réversibilité ; coefficient de réfraction de l'atmosphère standard ≈ 0,13–0,17 ; conduit seulement au-delà du seuil ; fonction de transfert monotone sans inversion, repliée avec ; tables identiques à u = 0 et u = 1 ; force de l'inversion monotone dans chaque temps ; lac qui se vide sous l'ombre et pas ailleurs.

### Matrice de variations

| Axe | Valeurs |
| --- | --- |
| **Famille** (le régime et le geste) | *Morgane* (Fata Morgana : le sujet s'élève en châteaux), *Hillingar* (une côte cachée monte de la mer en bande), *Lac* (mirage inférieur : le lac de ciel se remplit et se vide) |
| **Sujet** (Morgane) | trois-mâts goélette pris dans les glaces, phare sur écueil avec maison de gardien, iceberg tabulaire à arches, vapeur baleinier à cheminée, île-falaise avec hameau |
| **Côte** (Hillingar) | chaîne de montagnes à glaciers, plateau basaltique en gradins, archipel d'îles rondes, falaise de glace (front de glacier) |
| **Sujet** (Lac) | inselbergs de grès, île de cactus cierges (Incahuasi), ksar à tours de terre, ligne télégraphique, caravane du sel |
| **Surface** | mer d'huile entre plaques de banquise, mer froide ridée, glace de mer tassée, sel en polygones, sebkha argileuse, playa craquelée |
| **Profil** | hauteur et force de l'inversion, épaisseur de la couche chaude, hauteur de l'œil (1,5 à 25 m) — tirés pour que le régime se produise |
| **Lumière** | soleil de minuit rasant, soleil haut et dur, ciel voilé, ombres de nuages, heure bleue |
| **Cadrage** | champ (0,5 à 2,5°), azimut du soleil de minuit par rapport au sujet, dérive lente |

Les humeurs composent surface, lumière, ciel et cadrage ; le sujet, la famille et le profil se tirent à part. Deux graines au hasard donnent deux films qu'on ne confond pas : une silhouette différente, un régime différent, une valeur différente.

### Images clés

1. **Les châteaux.** Champ de 0,7°. Ciel orangé, très pâle au ras de l'horizon ; un trois-mâts noir à contre-jour, ses mâts et ses vergues nets ; au-dessus, son image renversée qui le rejoint par la coque, et entre les deux une muraille verticale de coque étirée ; à gauche et à droite, le bord de la banquise dressé en colonnades. Au premier plan, une mer d'huile qui reflète le tout, coupée de plaques de glace bleutées.
2. **Le soleil tranché.** Le disque du soleil (0,53°, la moitié de l'image) posé sur l'horizon, découpé en trois crêpes séparées par des bandes de ciel, la plus haute bordée de vert ; les mâts du navire en ombre chinoise sur la crêpe du milieu ; la mer, en dessous, une colonne de lumière.
3. **Le lac.** Salar blanc à midi, champ de 1,2° ; à 8 km, trois inselbergs de grès rouge posés sur un lac de ciel bleu pâle qui les reflète renversés ; leur pied a disparu ; au premier plan, les polygones de sel en lignes serrées ; sur la gauche, l'ombre d'un nuage avance, et là où elle est, le lac a disparu.

### Risques et parades

- *Le plat du téléobjectif* : la profondeur vient de la perspective aérienne (le lointain bleuit et pâlit), de la surface (plaques, polygones qui se resserrent vers l'horizon), de l'étagement de plans (glace proche, navire, banquise lointaine).
- *Le sujet trop petit* : cadrages calculés depuis la taille apparente du sujet (sa hauteur vraie et le champ) ; le sujet occupe un tiers à la moitié de la largeur.
- *La mer en accéléré* : à × 1 400, des vagues seraient un bruit ; on rend la mer comme en pose longue (miroir à rugosité statistique, colonne de soleil adoucie), seules les grandes plaques de glace et les nappes lisses (« slicks ») restent nettes.
- *Le coût* : un passage plein écran (quelques lectures de tables), trois cartes de sujet rendues par three.js ; < 8 ms visés.
- *Le crénelage des plis* : au voisinage d'une caustique, un pixel couvre une grande hauteur vraie ; les cartes sont rendues à une résolution verticale adaptée au grossissement maximal, le TRAA fait le reste.
- *La lisibilité* : un profil qui ne fait rien d'intéressant ; le profil est tiré **pour** que le régime de la famille se produise (recherche sur ses paramètres, mesurée par le nombre d'images et le grossissement), et un test le vérifie sur 200 graines.

## e bis. Les trois épreuves

### Crédibilité

| Temps du film | Cause visible | Loi | Convention de temps |
| --- | --- | --- | --- |
| Le navire s'élève, se dédouble, s'étire | le soleil qui tourne et réchauffe l'air au-dessus de la mer froide (lumière qui change de direction et de couleur) | équation des rayons, réfractivité de Smith-Weintraub, conduit au-delà de 0,11 K/m ; onde thermique de Stokes | accéléré × 1 400 (24 h en 60 s) |
| Le soleil tranché, le rayon vert | le soleil lui-même, au ras de l'horizon | la même inversion ; dispersion d'Edlén ; réfraction astronomique | ralenti du temps-lapse (× 60 environ) : on le lit comme un accéléré qui ralentit |
| Les tours retombent | le soleil remonte, l'air se mélange | idem | accéléré |
| Hillingar : la côte monte | idem (soleil de minuit) | conduit de surface, rayons piégés | accéléré |
| Lac : le lac se vide | l'ombre du nuage qui avance sur le sel (on la voit arriver) | la croûte refroidit en ~1 min (réponse du premier ordre) ; couche limite exponentielle | accéléré × 20 |
| Lac : le lac se remplit | le soleil revient, la croûte rechauffe ; miroitement qui reprend | idem ; le sol chauffé est convectif (l'image bout) | accéléré |
| Le miroitement | le sol chaud (lac) ; absent en inversion (stable) | turbulence de convection | — |

Rien ne flotte : le navire est pris dans la banquise, le phare sur son écueil, l'iceberg dans la mer, les rochers sur le sel ; chacun porte son ombre sur la surface. Le seul « flottement » est celui que fait le mirage — et il se lit comme tel parce que le sujet, lui, ne bouge pas.

### Variété (une humeur = un décor)

| Humeur | Décor | Lumière | Valeur | Cadrage |
| --- | --- | --- | --- | --- |
| **Banquise** | plaques de glace serrées, chenaux d'eau noire | soleil de minuit rasant, contre-jour doré au temps fort | moyenne, chaude sur froid | 0,7°, œil à 3 m |
| **Mer d'huile** | mer ouverte lisse, quelques plaques éparses | ciel rose et lavande, soleil voilé | claire, pastel, faible contraste | 1°, œil à 8 m (pont) |
| **Glace de mer** | banquise côtière tassée, crêtes de pression, neige | ciel blanc-bleu, lumière d'en haut | très claire (high key) | 1,5°, œil à 2 m |
| **Nuit blanche** | eau sombre, glace rare | soleil sous l'horizon, heure bleue prolongée, ciel indigo | sombre, froide | 1,2°, œil à 15 m (falaise) |
| **Salar** | croûte de sel blanche en polygones | soleil haut et dur, ciel d'altitude bleu profond | très claire | 1,2°, œil à 1,6 m |
| **Sebkha** | argile ocre lustrée, sel en efflorescences | soleil voilé de poussière, brume chaude | moyenne, chaude | 1,8°, œil à 2 m |
| **Orage sec** | playa craquelée sombre | cumulus noirs, éclaircies et ombres qui balaient | sombre et contrastée | 2°, œil à 1,8 m |

Pas deux lignes semblables : quatre surfaces, cinq lumières, du très clair au sombre, cinq hauteurs d'œil.

### Ambition (éléments de construction)

- **Trois-mâts goélette** : coque à tonture et bouge, étrave, quille, safran, bordé en virures, préceinte, pavois, beaupré et bâton de foc, trois mâts avec mâts de hune, vergues (mât de misaine), voiles carguées sur les vergues, haubans et étais, cheminée de la machine auxiliaire, roof, embarcations sous bossoirs ; la banquise tassée contre la coque.
- **Phare** : écueil en granite, soubassement, fût conique en assises, bandeau, galerie à garde-corps, lanterne vitrée à montants, coupole, maison de gardien à toit, mât de signaux.
- **Iceberg tabulaire** : falaises à strates, arche, crevasses, pied de glace bleue, éboulis.
- **Côte de montagnes** (Hillingar) : relief par érosion (arêtes, cirques), névés et glaciers, falaises côtières.
- **Inselbergs, ksar, île de cactus** : grès stratifié, tours de terre, murailles crénelées, cierges.

## e ter. Déclinaison et scénario

### Déclinaison (le mouvement de chaque famille)

- **Morgane** — **vertical** : le sujet reste à sa place, ses images montent, s'empilent et s'étirent en tours, puis se tassent ; le mouvement est une croissance verticale.
- **Hillingar** — **apparition** : une côte qu'on ne voyait pas monte au-dessus de l'horizon comme un plateau aplati, s'étale sur toute la largeur, puis s'enfonce ; le mouvement est une émersion.
- **Lac** — **horizontal** : un lac de ciel s'étend et se retire sur le sol, ses rives avancent et reculent, les sujets y perdent puis y retrouvent leur pied ; le mouvement est une marée de lumière, conduite par l'ombre d'un nuage qui balaie le sol.

Trois mouvements distincts : monter, émerger, inonder.

### Scénario (Morgane, film muet)

1. Midi. Un trois-mâts pris dans les glaces, seul sur l'horizon, éclairé de face. La mer d'huile le reflète. Les ombres des plaques de glace tournent lentement.
2. L'après-midi passe en accéléré. La lumière vient de côté, le navire se soulève à peine, sa coque se décolle de l'horizon.
3. Une image renversée de la coque naît juste au-dessus d'elle et monte ; les deux coques se rejoignent par une bande étirée ; la banquise lointaine se dresse en murailles.
4. Le temps ralentit. Le soleil entre dans le cadre, bas, à gauche ; tout passe au contre-jour doré. Les tours sont à leur plus haut.
5. Le soleil glisse derrière le navire, tranché en trois crêpes ; la plus haute se borde de vert. Les mâts se découpent dans le disque.
6. Le soleil sort à droite en remontant. Le temps reprend. Les tours se tassent, l'image renversée redescend et se fond dans la coque.
7. Matin, puis midi : le navire est redevenu lui-même. La boucle reprend.

(Lac) Un salar blanc, des inselbergs posés sur un lac de ciel qui frémit. Une ombre de nuage arrive du fond : sous elle, le lac s'éteint, les rochers retrouvent leur pied. L'ombre avance jusqu'à nous, tout devient gris et net. Elle passe ; le soleil revient d'abord au fond, le sel blanchit, le lac revient en frémissant, les rochers se soulèvent à nouveau sur leur reflet.

## e quater. Les références

Photographies que tout photographe du sujet ferait (et que les premiers rendus devront rejoindre) :

1. **Fata Morgana de navire** (Baltique, Parviainen ; Arctique, expéditions) : focale 600–2 000 mm ; le navire occupe un tiers de la largeur ; l'horizon est une bande de 0,1–0,3° de haut ; le ciel juste au-dessus est très pâle (plus clair que la mer), la mer gris-bleu sombre et lisse ; les images étirées sont des aplats verticaux à bords nets, sans flou ; le contraste est faible (perspective aérienne : le sujet à 15 km est gris-bleu, pas noir), sauf à contre-jour.
2. **Soleil tranché et rayon vert** (Young ; observatoires) : le soleil plein cadre ou presque, découpé en bandes horizontales séparées par des fentes de ciel ; couleur orange-rouge saturée en bas, jaune au milieu, franges vertes de quelques secondes d'arc au bord supérieur ; le ciel autour est rouge orangé sombre.
3. **Mirage inférieur sur salar** (Uyuni, lac Eyre, chotts) : focale 200–600 mm ; une bande de « lac » bleu pâle (la couleur du ciel à l'horizon) entre le sol blanc et les objets ; les objets lointains coupés à mi-hauteur, leur reflet renversé et un peu écrasé ; miroitement qui brouille les bords en dents ; le sol en polygones de sel de 1 à 2 m, qui deviennent des lignes horizontales serrées au téléobjectif.
4. **Hillingar** (Islande, Spitzberg) : une côte basse et plate qui n'est qu'une bande d'un ou deux dixièmes de degré de haut, étirée en falaises verticales régulières, comme un plateau tabulaire.

Échelle et densité : la bande utile (tout ce qui se passe) tient en 0,1 à 0,5° ; c'est elle qui doit remplir l'image, donc des champs de 0,5 à 2,5°. Le sujet à 10–25 km fait 0,05 à 0,2° de haut : il remplit un dixième à un tiers de la hauteur de l'image, et ses images en tours jusqu'à la moitié. La surface donne l'échelle : plaques de glace de 5 à 50 m, polygones de sel de 1,5 m, qui deviennent au téléobjectif des lignes de plus en plus serrées jusqu'à l'horizon.

## g. Révision après le premier rendu (retour de l'utilisateur)

> « Le concept est intéressant et la simulation des rayons sûrement correcte, mais le résultat final est trop compliqué : un rendu abstrait, pas forcément très esthétique, avec par moments l'impression qu'il y a des bugs. On ne comprend pas du tout ce qui se passe. »

Ce que les planches montraient, relues avec ce regard :

1. **Tout changeait en même temps.** La journée de 24 h en 60 s faisait passer le ciel du blanc à l'orange, tournait la lumière, réglait l'exposition, faisait traverser le soleil, et le mirage se formait par-dessus. L'œil ne savait pas quoi suivre ; la cause (l'air qui se réchauffe) restait invisible.
2. **Le régime extrême se lit comme un défaut.** Les murailles, la bande de mer soulevée, la banquise lointaine étirée en code-barres, le soleil en colonne à bords droits : physiquement justes, mais personne ne les reconnaît. Le réel du lecteur, c'est le « navire volant » — un navire surmonté de sa copie renversée.
3. **Pas de référence.** On ne voyait jamais assez longtemps le sujet net et tel quel.

Ce qui a changé :

- **Une seule chose bouge : le mirage.** Le soleil est fixe pendant la boucle, bas et de côté, hors du cadre (une lumière par humeur). L'inversion respire en quatre temps : calme (le sujet net), montée, tenue, retombée.
- **Le pli passe au-dessus du sujet.** Un premier essai (inversion faible juste au-dessus de l'œil) mettait encore le pli dans la coque du vapeur et la falaise de l'iceberg : murs et moiré. Le pli se forme à la hauteur de l'inversion ; elle est donc posée au-dessus de la partie massive du sujet (coque, roche, corps de l'iceberg), plus forte à mesure qu'elle est plus haute. Seuls les mâts et le haut d'une tour la traversent. Au plus fort, l'image renversée descend du ciel jusqu'à mi-hauteur du sujet : un geste qu'on suit. Un test le garde à f = 0,6, 0,8 et 1, et le profil du premier essai, témoin, le fait échouer.
- **Plus de lointain étiré** : la banquise lointaine est retirée (c'est elle qui faisait les « codes-barres ») ; autour des coques, seulement quelques plaques basses (leur image renversée faisait une barre blanche).
- **Le sujet est plus grand** (9–11,5 km, champ de 0,5–0,7°) et cadré pour laisser la place à son image au-dessus de lui.
- **Les défauts de rendu qui ressemblaient à des bugs** : falaises de l'iceberg striées par la grille (falaise adoucie, contour en super-ellipse), grain de la colonne de lumière (trois tirages par pixel).

Le Lac (cause visible : l'ombre du nuage) et le Hillingar gardent leur geste ; ils passent eux aussi au soleil fixe.

## h. Deuxième révision : le cabinet des mirages

> « Le problème principal, c'est que le spectateur n'a pas d'indice visuel de ce qui fait se transformer les rayons. Plutôt qu'un paysage ensoleillé, des scènes plus réduites, avec un objet qui a une certaine apparence mais qui, vu à travers quelque chose qui déforme les rayons, prend une autre apparence — et il faudrait que ces deux apparences aient un sens. »

Le paysage au long foyer avait deux défauts que nulle retouche ne corrigeait : la cause (l'air chaud) est invisible et agit à 10 km ; la seconde apparence (une copie renversée) n'est qu'une déformation, pas une autre chose. On garde le cœur — des rayons courbés dans un indice qui varie, tracés au pixel — et on le change d'échelle : un **cabinet de physique**, sur une table, où **le milieu qui courbe la lumière est un appareil qu'on voit agir**.

### Ce que la physique permet au sens

Dans un milieu stratifié, un rayon reste dans son plan vertical : le mirage ne fait que **réordonner verticalement** chaque colonne de l'image. Deux manières d'en tirer une seconde apparence :

1. **Le reflet qui complète** (mirage inférieur, au-dessus d'une surface chaude) : sous l'objet naît un miroir ; l'objet et son reflet forment une figure nouvelle. Une arche devient un anneau, le haut d'un sablier un sablier entier, un soleil à demi levé un soleil plein.
2. **L'anamorphose** (gradient d'indice dans une cuve) : si la fonction de transfert reste monotone, toute figure B peut s'obtenir d'un objet A = B ∘ z⁻¹ : il suffit de calculer l'objet à l'envers. Une **ruine** (des tours écrasées, des murs bas) devient, à travers le sirop stratifié, le **château intact** — c'est littéralement la légende de la Fata Morgana, la fée qui bâtit des châteaux dans l'air. Une pile de soucoupes devient une pagode.

### Deux familles, deux appareils, deux causes visibles

| Famille | Appareil | Cause qu'on voit | Ce qui change | Boucle |
| --- | --- | --- | --- | --- |
| **Cuve** | une cuve de verre à cornières de laiton, un entonnoir à long tube, un robinet de vidange, un petit laser | le sirop ambré qui glisse au fond sous l'eau et s'y diffuse ; **le faisceau vert qui se courbe** dans la cuve | la ruine, vue au travers, se redresse en château | remplissage par le fond, diffusion, vidange |
| **Plaque** | une longue plaque de fonte sur ses pieds, un thermomètre à cadran | la plaque qui **rougit** (rayonnement du corps noir, au-delà de 500 °C) et le miroitement | un lac de reflet naît au ras de la plaque et complète l'objet | chauffe, palier, refroidissement |

### Scénarios (films muets)

**Cuve.** Une cuve d'eau claire sur sa table ; derrière elle, une ruine sur un socle, vue au travers, nette. Le laser traverse la cuve en ligne droite. Le robinet de l'entonnoir s'ouvre : un sirop ambré glisse au fond, la couche monte ; le faisceau vert commence à se courber vers le bas. En accéléré, l'interface se diffuse ; le faisceau décrit un arc ; derrière, la ruine s'étire, ses tours se redressent, et le château apparaît. Il tient. Le robinet de vidange s'ouvre, l'ambre descend, le faisceau se redresse, le château redevient ruine.

**Plaque.** Dans la pénombre, une plaque de fonte noire file vers une arche de pierre posée à son extrémité. La plaque chauffe : elle vire au rouge sombre de la braise ; au ras de sa surface, l'air se met à trembler, puis un lac de lumière s'étend sous l'arche et la reflète : elle devient anneau. La plaque refroidit, noircit, le lac se retire.

### Variantes (une graine tire un appareil, une paire, un décor)

- Cuve : ruine → château ; pile de soucoupes → pagode ; tas de galets → phare.
- Plaque : arche → anneau ; haut de sablier → sablier ; soleil levant → soleil plein.
- Décors : cabinet (boiseries sombres, lampe chaude), laboratoire (papier quadrillé clair), atelier (établi, lumière de fenêtre), nuit (le laser ou la braise seuls, une lampe de poche).

### Ce que la cuve a imposé (mise au point)

- **Une ruine ne devient pas un château.** Le premier essai voulait une anamorphose (la ruine calculée à l'envers). Le tracé a montré qu'un sirop au fond *écrase* la bande qu'il traverse (×0,3 à ×0,7) au lieu de l'étirer : une ruine ne se redresserait jamais. La seule seconde apparence nette est le miroir — d'où, dans les deux appareils, des objets qui sont la moitié basse d'une figure symétrique.
- **L'objet derrière la cuve se reflète mal.** Posé derrière, l'objet n'avait qu'une image renversée comprimée et minuscule : les rayons qui vont chercher sa base dans le miroir dépassent l'angle critique, ou se réfléchissent avant la vitre. L'objet est donc au fond de la cuve, l'œil bas contre la vitre, et l'interface nette fait plafond-miroir (réflexion totale, 15° pour Δn = 0,05) : le reflet est à l'échelle 1 et couvre tout l'objet. Le coquetier a été écarté (le miroir aurait donné un œuf entre deux coquetiers) ; restent la souche (→ arbre) et la pointe de quartz (→ cristal biterminé).
- **Deux miroirs.** La surface libre de l'eau, vue d'en dessous, réfléchit aussi : l'eau est assez haute pour que ce reflet sorte du cadre.
- **La plaque** demande une couche chaude mince (1–1,3 mm) et l'œil au-dessus d'elle, sinon aucun reflet ; ses objets sont des miniatures de 8 mm sur pieds de 5,5 mm, au macro.
