# Tesseract

Le cabinet replié. Un écrin de huit cubes, couché à plat en patron (la croix du *Corpus Hypercubus* de Dalí, ou une autre forme), se replie dans une direction qui n'existe pas. L'hypercube tourne d'un quart de tour en 4D : le cube intérieur passe à l'extérieur. Puis il se déplie à nouveau. Le patron est le même, mais les cellules ont changé de place. Après quelques étapes, chacune a retrouvé la sienne : la boucle est parfaite par construction.

Puis la caméra entre. L'œil 4D se pose sur l'hypersphère, l'espace se referme sur lui-même, et le cube du centre devient une pièce où l'on se tient. Vue de l'intérieur, chaque rotation 4D de la boucle est un voyage : l'univers glisse, une paroi s'ajoure, et l'on passe dans la pièce voisine. Huit pièces, chacune accolée à six autres ; on en visite quatre, une fois chacune, sans jamais revenir sur ses pas, et l'on se retrouve au point de départ. Avec quatre quarts de tour dans le même plan, on marche tout droit et l'on fait le tour de l'univers.

![Le voyage intérieur : la plongée, une traversée, une halte](docs/voyage.jpg)

Rendu physique en three.js (WebGPU, TSL). La scène est entièrement procédurale : une graine produit une scène, et l'on peut en générer autant que l'on veut.

## Utilisation

| Touche | Action |
| --- | --- |
| N | nouvelle scène (nouvelle graine) |
| Espace | pause / lecture |
| ← / → | avancer ou reculer dans la boucle |
| L | afficher / masquer les légendes des étapes |
| A | afficher / masquer l'analogie 3D |
| H | masquer l'interface |
| F | plein écran |

Paramètres d'URL :
- `?seed=…` : une scène (par défaut `atl45i`) ;
- `#r=…` : une scène retouchée, produite par « Copier le lien » ;
- `?ui=0` : sans panneau ;
- `?debug` : outils dans `window.tess`, dont `shot(phase)` (une image fixe à une phase donnée), `at('travel', 1, 0.5)` (la phase d'un moment du voyage), `send(nom)` (l'image rendue, envoyée à un collecteur local sur le port 8099), `sendAccum(nom, phase, passes)` (la même, en rendu accumulé) et `meter()` (posemètre : luminance de la passe de scène, médiane et centiles, part de noir et de brûlé, sur l'image et sur son centre).

Le panneau règle tout :
- **Voyage intérieur** : activé ou non, durées (plongée, halte dans chaque pièce, traversée, remontée), écart de la caméra à l'axe de la traversée, rayon de son tour autour de l'objet, champ, projecteur de la pièce, ajourage des parois vues de l'intérieur, taille des objets, brouillard.
- **Scène** : humeur, durée, patron, séquence de rotations 4D.
- **Chorégraphie** : durée de chaque temps, décalage entre cellules, anticipation et rebond.
- **Projection 4D** : distance de l'œil 4D, gonflement stéréographique, écart entre cellules, ajourage, cadrage, inclinaison.
- **Caméra**.
- **Ossature** : profil, épaisseur, chanfrein, nœuds, matériaux.
- **Chaque cellule** : archétype, nature de chaque face, perforations, persiennes, grille, matériaux des trois faces, verre, objet exposé.
- **Lumière et plateau**.
- **Rendu**.

L'export produit une boucle MP4 (H.264) rendue image par image, et une image PNG. **Rendu accumulé** (`src/render/accum.js`, réglage « Rendu accumulé » du dossier Export : 8 à 64 passes) : chaque image est la moyenne de N rendus complets, décalés d'un rien dans le temps (vrai flou de mouvement, obturateur à 180°), sur la lentille (vraie profondeur de champ, discrète), dans le pixel (anticrénelage) et sur le projecteur (vraie pénombre). L'anticrénelage temporel et le flou de mouvement calculé sont alors coupés. L'export est N fois plus long, le temps réel ne change pas.

## Principe

**Les cellules.** Le tesseract est [-1, 1]⁴. Ses huit cellules sont des cubes, repérés par leur normale ±eₖ. Chaque pièce (ossature, panneaux, verre, objet) est construite une fois, en coordonnées locales de sa cellule. Une matrice 4D propre au maillage, recalculée à chaque image, l'emmène dans l'espace à quatre dimensions. Cette matrice compose le plongement de la cellule dans son hyperplan, le dépliage, la rotation 4D et la rotation de l'objet exposé.

**La projection** (`src/scene/project.js`, dans le vertex shader) :
1. un gonflement facultatif vers la 3-sphère, qui courbe les arêtes en arcs ;
2. une perspective depuis l'œil 4D (0, 0, 0, d).

La normale est transportée par la jacobienne de la projection (n' = cof(J)·n), calculée en forme fermée. Une cellule vue « de l'autre côté » en 4D se projette en miroir. Ses triangles changent alors de sens, et le sens de la face (matériaux double face) retourne la normale une seconde fois : elle sort toujours de la matière. Le même calcul, avec les paramètres de l'image précédente, donne les vecteurs vitesse (flou de mouvement, anticrénelage temporel). La carte d'ombre reçoit la même déformation.

**Le patron** (`src/math4.js`). Un patron est un arbre couvrant des cellules, de racine −W. Chaque cellule pivote autour du carré qu'elle partage avec son parent, dans le plan de leurs deux normales. À π/2, toutes sont couchées dans l'hyperplan w = −1. Un patron tiré au hasard est vérifié : deux cellules n'y tombent jamais au même endroit. Il existe 261 patrons du tesseract à symétrie près.

**La boucle.** Chaque étape fait un quart de tour dans un plan contenant w, éventuellement doublé d'un quart de tour dans le plan orthogonal (rotation isocline). C'est une symétrie de l'hypercube. La séquence est tirée de façon que le produit des mouvements soit l'identité, sans aller-retour ni retour à un état déjà vu. Par défaut, elle visite quatre pièces : quatre mouvements qui font passer le cube intérieur par quatre cellules distinctes, une fois chacune, avant de revenir à la première (recherche en profondeur parmi les mouvements ; environ une fois sur deux, c'est une ligne droite). On peut aussi choisir le tour complet (huit mouvements, les huit cellules), un seul plan (quatre quarts de tour) ou des plans mêlés (trois ou quatre mouvements). Chaque étape suit le même déroulé :
1. pause dépliée ;
2. pliage échelonné, les feuilles de l'arbre d'abord ;
3. pause ;
4. rotation ;
5. pause ;
6. dépliage.

Les courbes ont de l'anticipation et du rebond (le mouvement recule un peu avant de partir, et dépasse un peu avant de se poser).

**L'ajourage** (`src/scene/reveal.js`). Plié, le tesseract est enveloppé par sa cellule extérieure et par les faces des cellules latérales qui la touchent : elles cacheraient tout. Les panneaux se percent de trous ronds, sur une trame à 45°, qui grandissent avec la coordonnée w du centre de leur face ; une tôle perforée s'ajoure par ses propres trous, qui s'agrandissent (une seconde trame dessinerait du moiré). Le bord des trous est tramé sur un pixel, autrement à chaque image : l'anticrénelage temporel le lisse. La coque tournée vers l'œil 4D s'efface, les faces latérales s'ajourent à moitié et le cube intérieur reste plein. Tout se referme quand les cellules reviennent se coucher dans le patron. L'ouverture de chaque face (coque, coupe côté caméra, passages et portes du voyage) est calculée en JS une fois par image, 48 valeurs que le vertex shader lit. L'objet exposé de la cellule extérieure se rétracte : projeté, il se superposerait à celui de la cellule intérieure.

**Lisibilité** (`src/scene/guides.js`, `src/app/overlay.js`). Une rotation dans un plan qui contient une quatrième direction ne se représente pas : on donne au regard des prises.
- **Le fantôme** (désactivé par défaut) : la silhouette du tesseract plié, en arêtes fines et lumineuses, à l'endroit exact où les cellules vont se poser. Déplié, on voit déjà la destination.
- **Les liserés appariés**, comme les languettes d'une maquette en papier : chaque face porte un cadre lumineux de la couleur de la face qu'elle rejoindra (une couleur par paire, 24 paires). Il s'avive à mesure que la distance 4D entre les deux faces diminue, et s'éteint au contact. Les faces jointes par une charnière du patron ne s'allument jamais.
- **La profondeur 4D en couleur** : froid loin de l'œil 4D, chaud tout près, sur le fantôme et (discrètement, pendant le quart de tour) sur l'ossature.
- **Les légendes** de chaque mouvement (« Le repli », « Quart de tour dans le plan y–w », « Le dépliage »). Chacune apparaît quand le mouvement commence et s'efface à la fin de la pause qui le suit : le texte ne change jamais sur une image immobile.
- **L'analogie 3D**, en encart : la même histoire une dimension plus bas. Une croix de six carrés se replie en cube, que l'on voit de face (un carré dans un carré, comme le tesseract est un cube dans un cube). Le cube fait un quart de tour : le carré du fond passe devant.

Légendes et encart sont masqués par défaut et s'affichent à la demande (touches L et A, ou le dossier « Lisibilité et intérieur »). Ce choix est mémorisé et ne change pas d'une scène à l'autre. Quand ils sont affichés, ils sont aussi composés sur chaque image de la vidéo exportée.

**Vue sur l'intérieur.**
- **Coupe côté caméra** : les panneaux tournés vers la caméra s'ajourent aussi (même trame de trous ; la carte d'ombre voit la même coupe).
- **Lumières d'écrin** (`src/scene/practicals.js`) : une petite source sous le plafond de chaque cellule, au-dessus de l'objet, éclaire la doublure, fait briller l'objet et filtre par les ajours. Au centre, elle serait dans l'objet, qui ne recevrait rien. Elle s'éteint quand la cellule passe à l'extérieur.
- **Rapprochement** : la caméra s'approche quand le tesseract est plié.

**Le cadrage.** L'objet reste centré, à une taille qui ne suit qu'en partie l'étendue du patron (déplié, il est bien plus grand que plié). Il est soulevé au besoin pour ne jamais traverser le sol.

## Le voyage intérieur (`src/scene/voyage.js`)

**L'idée.** Gonflé jusqu'au bout, le tesseract devient la 3-sphère de rayon 2, pavée par ses huit cellules. Quand l'œil 4D se pose sur cette sphère (d = 2), la perspective devient une projection stéréographique. Celle-ci envoie le pôle opposé à l'œil (le centre du cube intérieur) à l'origine, et les grands cercles qui y passent sur des droites. Une caméra placée à l'origine voit donc chaque point de l'hypersphère dans sa vraie direction : c'est la vue d'un habitant de cet univers. La projection et le reste du rendu ne changent pas ; seuls deux réglages bougent (gonflement 1, distance 2).

**Une rotation est un voyage.** Un quart de tour dans un plan qui contient w déplace l'univers le long d'un grand cercle passant par la caméra. Vue du centre, la pièce voisine arrive par une droite, traverse la paroi commune et vient se poser autour de la caméra : on a changé de pièce. Une rotation double y ajoute un roulis autour de la direction du voyage (un tire-bouchon). La séquence de mouvements a pour produit l'identité, donc le voyage revient à la première pièce, après en avoir visité quatre (par défaut) ou les huit (tour complet). En mode « un seul plan », on traverse quatre pièces en ligne droite avant de revenir au point de départ.

**La boucle.**
1. pause dépliée, pliage, pause ;
2. la plongée : la caméra entre d'abord dans le tesseract plié (un cube dans un cube, lisible) jusqu'au cube du centre ; puis, de l'intérieur, l'œil 4D se pose sur la sphère et l'univers se referme autour de la pièce (vu du dehors, ce gonflement n'était qu'une boule bosselée et percée, illisible) ;
3. pour chaque mouvement, une halte puis une traversée ;
4. une dernière halte dans la première pièce, la remontée (l'espace se déplie d'abord autour de la pièce, puis la caméra ressort), le dépliage.

La durée de la boucle suit : environ 48 s pour quatre pièces, 70 s pour le tour des huit.

**La caméra.** Pendant une traversée, elle se tient à l'écart de l'axe, sur une diagonale de la porte (le plus loin possible des barres de l'ossature), tirée au hasard. Chaque traversée a son allure, jamais deux fois la même de suite, et sa durée :
- *avant* : droit devant, l'objet de la pièce suivante arrive et passe sous la caméra ;
- *arrière* : on regarde s'éloigner la pièce que l'on quitte, l'objet suivant entre dans le champ par derrière ;
- *côté* : le regard sur l'axe, l'objet suivant traverse le champ en frôlant la caméra ;
- *tonneau* : un demi-tour autour de l'axe ;
- *spirale* : un quart de tour autour de l'axe, regard plongeant. La diagonale et l'allure de chaque traversée se choisissent pour commencer près de là où la précédente a fini (et, pour la première et la dernière, près du regard de l'entrée et de la sortie) : la halte entre deux traversées n'a jamais à faire volte-face. Le roulis est porté d'une traversée à l'autre (il n'y a pas de haut dans l'hypersphère) et ne se défait qu'une fois, avant la remontée. Pendant une halte, elle tourne un peu autour de l'objet de la pièce (sens et ampleur propres à chaque halte) : son repère passe de celui de la traversée précédente à celui de la suivante (interpolation sphérique), et son regard va de la porte d'arrivée à l'objet, puis à la porte de départ. **Un mouvement fluide.** Les gestes d'une halte (regarder l'objet, en faire un peu le tour, se tourner vers la porte suivante) s'étalent et se chevauchent sur toute sa durée, et la première et la dernière halte, qui raccordent l'entrée et la sortie, durent un peu plus. Par-dessus, la pose est lissée dans le temps : pendant les haltes et les traversées, c'est la moyenne (noyau gaussien, σ ≈ 0,3 s) des poses voisines sur la trajectoire, calculée sur la trajectoire elle-même (la boucle se referme, l'export rend la même chose). L'univers glisse sans recul ni dépassement marqués. Le regard tourne en moyenne à moins de 30°/s dans les pièces (il dépassait 80°/s, avec des pointes à 220°/s).

**Entrer sans rien traverser.** La projection ne fait que multiplier (x, y, z) par un nombre positif : la direction d'un point du tesseract, vue de l'origine, ne dépend que de lui. Or toutes les arêtes ont deux coordonnées de même valeur absolue, et chaque objet exposé est sur un axe. Un rayon issu de l'origine dans la direction (1 ; 0,38 ; 0,38), ou l'une de ses images par symétrie, ne croise donc aucune barre, quelle que soit la projection, et il passe loin des objets. Pour entrer, la caméra rejoint ce rayon en glissant sur une sphère qui englobe tout, puis elle le suit jusqu'au cube du centre en regardant son objet. Elle ressort de la même façon. Les parois qu'elle franchit sont percées d'un passage : un trou rond et net, centré sur ce rayon (un peu plus large au loin, où les pièces sont projetées plus grandes), qui s'ouvre devant elle et se referme derrière, comme une porte. Le champ s'élargit à l'intérieur, et chaque pièce a désormais son objet.

**Les portes.** La paroi entre la pièce où l'on se tient et la suivante s'ouvre à la fin de la halte par un iris : un octogone qui s'ouvre en tournant, comme un diaphragme, bordé d'une lisière lumineuse (`src/scene/project.js`, `revealMask`). On voit déjà où l'on va. Il reste ouvert pendant la traversée, s'élargit jusqu'à avaler la paroi quand la caméra le franchit, et se referme derrière elle. Ses deux panneaux dos à dos sont percés ensemble, la carte d'ombre et la sonde de pièce voient la même ouverture, et tout se lit dans la position projetée (aucun varying de plus, pas de trigonométrie). Auparavant la paroi se dissolvait par une trame de trous : cela se lisait comme un effet, pas comme une porte. **L'enfilade.** Un tour en ligne droite (quatre pièces sur un grand cercle, environ une graine sur deux) aligne ses quatre portes : à la dernière halte, revenu dans la première pièce, elles s'ouvrent l'une après l'autre et l'on regarde le long du cercle entier. De l'intérieur, il n'y a plus de coque à effacer : les parois de la pièce restent pleines, celles des pièces voisines aussi, et seules les parois lointaines s'ajourent, par des trous assez grands pour se lire (de tout petits trous sur les parois proches ne laissaient rien voir et semaient un pointillé derrière chaque motif).

**La lumière.** Il n'y a pas de sol dans l'hypersphère : le plateau s'éloigne et les contre-jours s'éteignent.
- **Le plafond.** Il n'y a pas de haut non plus : c'est la caméra qui le désigne. Le plafond de chaque pièce visitée est celle de ses six faces qui est le plus en haut pour la caméra au milieu de la halte (`voyage.js`, `ups`).
- **Le projecteur.** Le seul à porter une ombre : il quitte le plateau pour le plafond de la pièce où l'on se tient, décalé vers la caméra. Une douche, qui modèle l'objet et pose son ombre sur le mur du fond. (Il était porté par la caméra : un flash, sans modelé ni ombre visible.) Pendant une traversée il glisse d'un plafond à l'autre.
- **La gorge lumineuse.** Un filet de lumière au pourtour du plafond : c'est d'elle que la lumière semble venir, et elle dessine la courbure de l'espace. La lumière d'écrin (sans ombre) devient l'appoint de la pièce ; les pièces voisines gardent la leur : on les voit éclairées avant d'y entrer.
- **Le dosage** (`src/scene/dose.js`). Une même lampe brûlait une pièce de marbre blanc (parois à 4–7 pour un blanc à 1, au posemètre) et laissait une pièce de laque sombre dans le noir. Chaque pièce a donc sa puissance, réglée sur la clarté de sa doublure, et la lumière de vedette se règle sur la clarté de l'objet. L'exposition de l'image, elle, ne bouge pas : le film reste une boucle exacte.
- **La sonde de pièce** (`src/scene/probe.js`). Une carte cubique de 128 pixels rendue depuis le centre de la pièce, une face toutes les deux images. Son niveau de mipmap le plus flou, lu dans la direction de la normale, est l'éclairement diffus : la couleur des murs sur l'objet, et d'un mur sur celui d'en face. Les autres, lus dans la direction du reflet selon la rugosité, sont le reflet de la pièce sur les métaux, les vernis, les pierres et les cristaux (le studio, lui, ne se reflète presque plus). Elle ne voit pas les vrais matériaux des parois mais des doublures unies, éclairées par les mêmes lumières : un seul rebond, sans boucle.
- **Les caustiques.** Une pierre ou un cristal jette sur les murs, à l'opposé de la lampe, un réseau de filets de lumière à sa teinte, qui dérive en boucle parfaite (deux lectures du volume de bruit).
- Le brouillard se resserre à l'échelle des pièces. Le fond et le brouillard prennent une version très sombre de la teinte de la scène : un fond clair (humeur Clinique), vu par tous les ajours, noyait sinon l'image dans un voile laiteux. Halo, poussière sur la lentille et flou de mouvement sont atténués dans les pièces.

## Géométrie (`src/gen/`, dans des Web Workers)

- **Ossature** : barres profilées balayées le long des arêtes, subdivisées pour que la projection gonflée puisse les courber. Cinq profils :
  - carré chanfreiné ou à congés polis ;
  - rond ;
  - tube à bagues ;
  - cornière, dont les ailes portent les panneaux ;
  - profilé d'aluminium rainuré.

  Nœuds d'angle en boîte arrondie, sphère ou pommeau, affleurants (ils ne débordent jamais sur la cellule voisine du patron). Sans nœuds, les barres s'assemblent bout à bout.

  **Une seule ossature une fois plié.** Plié, chaque arête de l'hypercube est partagée par trois cellules et chaque sommet par quatre : huit ossatures complètes s'y empileraient. À la fin du pliage, seule la cellule extérieure (face à l'œil 4D, projetée en cube sans déformation) garde la sienne : elle dessine le contour de l'hypercube. Les autres se rétractent dans leurs axes. Pendant un quart de tour, l'ossature de l'ancienne cellule extérieure s'efface pendant que celle de la nouvelle apparaît. Dans l'hypersphère, il n'y a plus d'ossature du tout : les parois des pièces se rejoignent directement.
- **Panneaux** : plaques (faces externe et interne, chant), verre teinté, persiennes inclinées, grille de joncs tissés dessus-dessous, pointes de diamant, clous ou caissons, tôle ondulée, vitrail serti de plombs (losanges ou carreaux), barreaux à traverse, cible d'anneaux concentriques, tôle perforée, et six motifs qui ne portent chacun qu'une idée : le pli Miura (l'origami des panneaux solaires, en chevrons à arêtes vives), l'onde (des cercles concentriques autour d'une source, d'un coin ou de deux sources qui interfèrent, qui s'éteignent au bord), la rosace (un oculus à chanfrein poli, ses rayons, son moyeu, parfois un cercle de remplage), les écailles (des disques de métal bombés à ourlet poli, inclinés et superposés rang par rang comme des tuiles ou une armure, sur les deux faces d'une plaque doublée ; chacune a sa nuance), le nid d'abeille (des alvéoles profondes : de face on voit au travers, de biais elles font écran) et les lames vrillées (des ailettes tordues sur leur longueur, en dégradé d'une ailette à l'autre). La tôle perforée a des trous en superellipse (rond, carré, losange, étoile, fente) ou hexagonaux, à chanfrein poli et paroi usinée. Leur taille suit un motif : centre, bord, diagonale, vague ou hasard. Les carreaux voisins partagent exactement leurs points de bord.
- **Objets exposés** (un par cellule) : perle, pierre taille brillant, gyroscope à trois anneaux, cube, Saturne, nœud de trèfle, icosaèdre, dodécaèdre, pile de jetons, petit cube d'ossature en mise en abyme, ruban de Möbius (une seule face, un seul bord poli), hypercube filaire (le tesseract dans l'une de ses propres cellules), ammonite (spirale logarithmique à côtes, nacrée à l'intérieur), œuf résille et oursin dont les pointes suivent l'angle d'or. Chaque humeur a ses objets favoris, et une scène évite de montrer deux fois le même. Chacun tourne d'un nombre entier de tours par boucle.

## Matériaux (`src/scene/materials.js`)

Ce sont ceux de Hollow : une quarantaine de finitions et vingt-neuf jeux (dont trois jeux unis ajoutés pour porter les motifs : laque unie, biscuit, acier brossé doublé de gris perle). On y trouve des métaux au F0 mesuré, de l'émail grand feu guilloché, de l'acier damassé, des marbres, de la laque urushi saupoudrée d'or, de la nacre, du titane bleui au feu, du film de savon, du velours et du carbone sergé.

Chaque pièce porte trois finitions (externe, interne, tranche). Les motifs sont calculés dans le repère de la pièce et restent attachés à la matière pendant le pliage 4D : chaque face a son propre veinage, et chaque barre ou latte sa nuance. Les parois portent en plus une patine qui ne dessine rien : elles s'encrassent un peu aux jonctions avec l'ossature et dans les coins des pièces (plus sombres, plus mates, irrégulièrement), leur teinte varie de quelques pour cent à grande échelle, et leur rugosité n'est jamais uniforme (réglage « Patine des parois »). Les traits fins (veines du marbre, craquelures de l'émail) s'effacent sur les pièces plus fines qu'eux : sur un barreau, une veine coupée de biais se lisait comme un cheveu. Le modèle physique est exploité en entier : vernis, lustre, irisation, anisotropie, transmission avec dispersion et absorption, usure. Le verre et les pierres projettent des ombres colorées.

**Reflets et réfraction à l'intérieur des cellules.** Un objet exposé est enfermé : il ne voit du studio que ce que laissent passer les parois de sa cellule. Son reflet de l'environnement (et sa lumière indirecte) suit donc l'ouverture réelle de la cellule, à chaque image : la nature de chaque face (pleine, perforée, vitrée, ouverte) et son ajourage, de « Studio vu d'une cellule fermée » à tout le studio. Ce qu'il reflète vraiment, ce sont les parois de sa cellule, ses voisins et le plateau, grâce aux réflexions en espace écran (post-traitement) :
- le reflet est un miroir sans bruit, adouci par un flou selon la rugosité, et laissé à l'environnement au-delà d'une rugosité moyenne ;
- son intensité suit le Fresnel de chaque surface (fort pour un métal, rasant pour un diélectrique) ;
- il prend la couleur du métal : l'or reflète doré.

Les cristaux massifs (cristal, saphir, quartz fumé) sont tirés pour environ un objet sur trois, indépendamment du reste de la scène. Ils ont une épaisseur optique à leur taille : ils réfractent, inversée et teintée, la paroi qui se trouve derrière eux.

Le sol est procédural : laque satinée anthracite (reflets adoucis), béton ciré, damier de marbre, parquet de chêne verni, velours ou cyclorama.

## Scène

- **Humeurs** : chacune favorise ses jeux de matériaux, ses archétypes de cellules, son sol et sa lumière.
  - Atelier ;
  - Studio ;
  - Écrin (or, guilloché, pierres) ;
  - Clinique (céramique blanche sur cyclorama) ;
  - Nuit ;
  - Surréaliste (damier de marbre, patron de Dalí) ;
  - Irisé.
- **Archétypes de cellule** : vitrine (sur un socle de matière), écrin, moucharabieh, persiennes, grille tissée, squelette, cage à barreaux, vitrail, pointes de diamant, tôle ondulée, cible, origami, chapelle (rosaces), onde, écailles, ruche, façade cinétique, et cabinet composite (un des motifs de la scène, sur une à trois faces posées librement).
- **Direction artistique** (`src/recipe.js`). Une image ne montre qu'une chose à la fois, et aucune pièce n'est vide :
  - **un motif signature par scène**, parfois un contrepoint de nature opposée (un écran qui laisse voir contre un relief plein), et pas d'autre ; tous les panneaux d'un motif ont le même dessin (mêmes trous, même pas) ; la variété vient d'une graine à l'autre ;
  - **une pièce, une idée** : soit un motif, sur un axe (deux parois qui se répondent) ou deux (une ceinture), dans un jeu uni, le reste en doublure ; soit une matière riche (marbre, émail guilloché, laque, damas, vert-de-gris…), sans motif, dont la pièce est tapissée dedans comme dehors. Jamais les deux, jamais ni l'un ni l'autre ;
  - **une paroi, un motif** : chacun des 24 carrés de l'hypercube est porté par deux panneaux, dos à dos (un par cellule). Quand les deux sont ornés, la pièce la plus ornée cède le sien : des barreaux devant une tôle perforée devant une cible faisaient un moiré illisible ;
  - environ une pièce sur deux porte un motif (onze faces ornées sur 48 en moyenne, au lieu de vingt-deux), et le voyage fait alterner pièces à motif et pièces de matière ;
  - **des accords de matières composés à la main**, cinq par humeur : `[ossature, motif, contrepoint, [matières riches], [objets]]`. Le motif signature et son contrepoint portent deux jeux unis de valeurs opposées, les pièces sans motif les matières riches, et une scène n'a qu'une couleur d'accent (anodisation, laque) et qu'une teinte de verre. Au moins trois familles de matières par scène, l'or (laiton, bronze, cuivre) en accent, jamais à la fois sur l'ossature et sur le motif. Les matières n'étaient pas composées mais tirées pièce par pièce : on obtenait huit cellules de nacre, ou sept de laiton autour d'objets dorés ;
  - **l'objet tranche sur les murs de sa pièce** : pas de nacre dans la nacre, d'or devant le laiton, ni de noir dans le noir ;
  - **le verre est clair** (teinté, jamais dépoli, presque sans traces) : une vitrine ou un vitrail dépoli noyait toutes les pièces voisines dans un flou ;
  - les lampes des humeurs chaudes sont à peine chaudes : sous une lampe orangée, l'acier et la porcelaine se lisaient comme du laiton ;
  - dans le voyage, les parois de la pièce où l'on se tient restent pleines (seules les portes s'ouvrent), celles des pièces voisines aussi (seules les parois lointaines s'ajourent), et les réflexions en espace écran y sont atténuées : des parois polies qui se reflètent l'une l'autre font une galerie des glaces.
- **Étalonnage par humeur** (`grade` dans `recipe.js`) : contraste, saturation, teinte des ombres et des hautes lumières (ombres froides et lumières chaudes à l'Atelier, ombres bleues la Nuit, aubergine dans l'Écrin…), par-dessus les réglages du panneau.
- **Lumière** : un projecteur avec ombres douces et deux contre-jours, fixes dans le monde (la caméra tourne, les ombres restent), et un studio HDR pour les reflets. Éclairage sélectif : chaque cellule ne reçoit que ces trois lumières et sa propre lumière d'écrin (les lumières d'écrin, sans ombre, traversaient sinon les parois pleines), et le sol que les trois lumières du plateau. Chaque objet exposé a en plus sa lumière de vedette, placée du côté de la caméra et au-dessus, qui le détache de sa doublure sans éclairer celle-ci.
- **Post-traitement** (repris de Hollow) :
  - réflexions en espace écran ;
  - occlusion ambiante, calculée sur une pré-passe de profondeur et de normales et appliquée dans les matériaux à l'éclairage indirect seulement (elle n'assombrit ni la lumière directe ni les reflets) ;
  - anticrénelage temporel, puis flou de mouvement (l'historique reste net) ;
  - profondeur de champ ;
  - bloom, halation, traînées anamorphiques ;
  - poussière sur la lentille ;
  - aberration chromatique, grain.

## Tests

Les invariants de la géométrie se vérifient sans navigateur (Node 22 ou plus récent) :

```bash
node --test 'tesseract/test/*.test.mjs'
```

Ils couvrent les charnières et les patrons (arbres couvrants sans chevauchement), la boucle courte (quatre pièces distinctes) et le tour complet, les mouvements (symétries de l'hypercube dont la suite se referme), la boucle (la fin rejoint le début, avec ou sans voyage), la jacobienne du vertex shader (comparée aux différences finies de la projection), l'accord entre l'ajourage et la géométrie (ancrage et trame de chaque face), et la mise en lumière (`test/staging.test.mjs` : dosage, étalonnage, iris et enfilade, décalages du rendu accumulé) et la direction artistique (`test/accords.test.mjs`) : chaque accord (jeux unis pour les motifs, matières riches pour les autres pièces, trois familles, l'or en accent) et, sur 400 graines, deux motifs au plus, un par pièce et par paroi, aucune matière sur plus de quatre pièces, un objet qui tranche sur ses murs.

## Performances

Mesuré à 1,9 Mpx en qualité Haute (anticrénelage temporel, réflexions en espace écran, occlusion ambiante, ombres), graine `k3v9pa` : environ 9,7 ms par image dehors, 10,8 ms pendant une traversée et 12,6 ms pendant une halte (avant l'éclairage sélectif et l'élimination des cellules hors champ : 13,9, 16,7 et 23,2 ms). L'image est limitée par les fragments : le nombre de lumières évaluées par pixel compte bien plus que le nombre de sommets. La tôle perforée est plafonnée à dix-huit faces par scène.

Après la mise en lumière des pièces (projecteur au plafond, sonde de pièce, caustiques, iris), mesuré à 2,1 Mpx sur la graine `da14` : environ 8,4 ms dehors (7,9 avant), 14,0 ms pendant une halte (13,6) et 15,5 ms au milieu d'une traversée (11,7). Les caustiques comptent pour 0,7 ms, la sonde pour 0,3, la lisière des portes pour 0,2 ; le reste du surcoût des traversées (environ 3 ms pendant une seconde) n'est pas isolé. Ces chiffres datent d'avant l'allègement de la sonde (une face une image sur deux, mipmaps refaits une fois par tour des six faces) et n'ont pas été repris depuis.

Les shaders qui ne servent que pendant le voyage (sonde de pièce et ses doublures, gorges lumineuses) sont compilés sous l'écran de chargement, par quelques images d'amorçage (`warmUp`) : sans cela, la première image de la plongée gelait la page une demi-seconde.

Au chargement d'une scène, la génération des shaders gèle la page une à quatre secondes, sous l'écran de chargement (`renderer.compileAsync` a été essayé : il ne supprime pas ce gel).

## Version mobile

Choisie d’office sur un téléphone ou une tablette (écran tactile et petit écran), imposée par `?mobile=1` (interdite par `?mobile=0`), ou par la qualité « Mobile » du panneau (la page se recharge : les matériaux sont compilés autrement). Elle a ses propres réglages mémorisés. Sur écran tactile : une touche met en pause, deux touches tirent une nouvelle scène, un appui long masque l’interface. Mesuré en rendu logiciel sur un écran de téléphone (390 × 844 à 3 ×) : environ 3,8 fois moins de temps par image qu’en qualité « Haute », avant même la résolution dynamique.

- **Résolution** : base 1,25 × CSS, puis résolution dynamique (cible ≈ 45 i/s, entre 50 et 100 % de cette base, par paliers, sans oscillation) ; cadence plafonnée à 60 i/s.
- **Chaîne d’image** : plus de pré-passe de profondeur et de normales (la scène n’est rendue qu’une fois), ni GTAO, ni réflexions en espace écran, ni anticrénelage temporel, flou de mouvement, aberration chromatique, traînées ou poussière sur la lentille ; une seule cible de scène ; bloom en quart de résolution ; FXAA. Étalonnage, halation et grain restent.
- **Projection 4D** : sans vecteurs vitesse, plus de seconde projection par sommet (celle de l’image précédente) ; la jacobienne en forme fermée est conservée (normales exactes).
- **Occlusion imitée** : sur les parois, la lumière indirecte s’éteint aux jonctions avec l’ossature et dans les coins, d’après la distance au bord déjà calculée pour la patine (presque gratuit).
- **Motifs** : patine des parois en deux lectures du volume de bruit au lieu de six, fBm à deux octaves, Worley sur 2 × 2 × 2 cellules au lieu de 27 (germes resserrés : arêtes toujours nettes de près).
- **Verre** : plus de transmission physique (copie de l’image et mipmaps, pièces double face rendues deux fois) mais un verre composité en une passe, dont l’opacité imite l’absorption de sa teinte et croît de biais (Fresnel) ; l’ombre colorée est conservée. Pierres taillées en cabochons opaques vernis à feu irisé.
- **Lumières** : le second contre-jour, le plus faible, est retiré (une lumière de moins par pixel), le premier renforcé ; carte d’ombre du projecteur en 1024 ; studio HDR en 512 de large ; deux à trois workers.

Différences visibles : sans réflexions en espace écran, les objets polis ne reflètent plus que le studio ; le verre ne réfracte plus ; le bord des trous d’ajourage, tranché net puis lissé par le FXAA, peut scintiller un peu en mouvement.

