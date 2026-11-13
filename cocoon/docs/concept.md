# Cocoon — document de conception

Thème donné : « Cocoon » (jour 20). Remarque de l'utilisateur à prendre en compte dès le concept : *les éléments organiques sont toujours compliqués à rendre de manière réaliste, surtout en temps réel ; il faut en tenir compte dans la manière de traiter le thème pour offrir un rendu cinématographique.*

## 0. La contrainte d'abord : ce qui se rend bien, ce qui se rend mal

Avant de chercher une idée, on liste ce qu'un rendu temps réel dans un navigateur sait rendre au niveau d'un film, et ce qu'il rate presque toujours.

| Se rend bien (à 60 i/s, ~2 Mpx) | Se rend mal |
| --- | --- |
| des **fibres** : un fil est une courbe connue, son reflet est une loi connue (Kajiya-Kay, Marschner : deux lobes décalés le long de la fibre) ; c'est ce qui fait le « satin » de la soie | la **chair** : peau, cuticule humide, larve, chenille (diffusion sous-surfacique à plusieurs couches, plis, humidité, poils) |
| la **lumière transmise** par une paroi mince et ses **ombres projetées** (une lanterne, un abat-jour) | le **duvet** (ailes de papillon, papillon de soie velu, bourre floue) : des millions de brins, une transparence ordonnée |
| les **silhouettes** à contre-jour, la brume éclairée par un faisceau | les **mouvements de créature** (reptation, contractions) : l'œil y voit tout de suite le faux |
| les matières dures et usinées : laiton, bois tourné, porcelaine, verre | les surfaces « molles » qui se déforment |

D'où la règle de ce projet : **on ne montre jamais la chair. On montre la soie et la lumière.** Le cocon est fait de fil (rendu exactement, fibre par fibre), ce qu'il enferme est une lumière (rendue exactement, par ce qu'elle projette), et ce qui le file est un appareil dont chaque pièce est dure et lisible. Le côté organique vient de ce que la soie fait d'elle-même : le lustre, la translucidité, le dessin des boucles, les irrégularités du fil.

## a. Le thème en largeur

**La physique et la science**
- Le ver à soie (*Bombyx mori*) file en trois jours un fil continu de 1 000 à 1 500 m, une « bave » de deux brins de fibroïne (≈ 10 µm chacun) collés par la séricine.
- Sa tête balance en **huit** (en S) : il pose des boucles de 3 à 6 mm, puis déplace son corps pour couvrir toute la paroi intérieure ; la coque se forme de l'extérieur vers l'intérieur, couche par couche.
- La coque d'un cocon est un **non-tissé** stratifié : bourre lâche dehors (« blaze »), coque dense, « pelade » fine dedans ; épaisseur 0,3–0,6 mm ; elle est plus dense aux deux bouts.
- La séricine se ramollit dans l'eau chaude (~ 90 °C) : c'est ce qui permet de dévider un cocon (la filature).
- Fils d'araignée : *Nephila* produit une soie dorée ; *Argiope* tisse un cocon d'œufs en forme d'urne ; *Argyroneta* (l'argyronète) construit sous l'eau une cloche d'air renforcée de soie.
- Cocons de papillons sauvages : *Antheraea yamamai* (vert pâle), tussah (miel), *Cricula trifenestrata* (cocons **en filet doré**, ajourés), *Saturnia pyri* (cocon en poire avec une **nasse** de sortie), *Hyalophora cecropia* (double paroi).
- Mécanique du bobinage : une fibre tendue sur une surface de révolution suit une **géodésique** (relation de Clairaut, r·sin α = c) ; avec du frottement, elle peut s'en écarter de μ au plus (enroulement non géodésique).
- Fermeture d'un motif : un enroulement en losanges se referme après p circuits si l'avance par circuit est rationnelle (« nombre de motif » premier avec p) ; les losanges se subdivisent à chaque passe.
- Épaississement aux pôles d'une pièce bobinée : les rubans s'y croisent tous, l'épaisseur y diverge en 1/r jusqu'à l'ouverture polaire.
- La lumière dans une paroi de fibres : transmission par couches (Beer-Lambert par épaisseur), jours entre les fibres (lumière directe), diffusion vers l'avant dans la fibre (la lanterne « luit »).

**Les métiers et les objets**
- La **magnanerie** (élevage), la **filature** (bassine, « batteuse », tavelette, croisure, asple hexagonal, va-et-vient), le **moulinage** (torsion), la **soierie** lyonnaise.
- Le **mawata** japonais : un cocon dégommé étiré sur un cadre en un voile.
- Les **lanternes** : chōchin (côte en hélice de bambou sur un moule démontable, washi collé), Akari d'Isamu Noguchi (1951–), lanternes melon chinoises (côtes méridiennes).
- La **Bubble Lamp** de George Nelson (1947) et les lampes Taraxacum / Viscontea des Castiglioni (1960) : armature de fil d'acier, peau projetée de « Cocoon », le plastique en toile qui servait à **mettre sous cocon** les navires de guerre désarmés (« mothballing »).
- Le **bobinage filamentaire** industriel (réservoirs composites, ailettes de rouet, bobinoirs à tourelle qui échangent bobine pleine et bobine vide).
- La **ailette** (flyer) du rouet : un bras en U qui tourne autour de la bobine et y conduit le fil.
- Les **temari** : balles de fil brodées de motifs en grands cercles.
- Le **Silk Pavilion** (Neri Oxman, MIT, 2013) : un robot pose un fil sur une coupole, 6 500 vers à soie la remplissent.
- Les pavillons de fibres de l'ICD Stuttgart (2012–2015) : un robot bobine des fibres de carbone sur une membrane, d'après l'argyronète.

**Histoire de l'art, photographie, cinéma**
- Clichés : le papillon qui sort de sa chrysalide (accéléré), la chenille qui file, le cocon comme métaphore du repli (« cocooning »), le corps enveloppé (momie, *Cocoon* de Ron Howard).
- Hubert Duprat : larves de trichoptères qui bâtissent leur fourreau d'or et de pierres.
- Christo et Jeanne-Claude : objets **empaquetés** (toile et corde).
- Les photographies de cocons à contre-jour sur table lumineuse (la nymphe en ombre chinoise).
- Les lanternes d'Akari photographiées dans la pénombre : la lampe est la seule lumière, le mur porte l'ombre des côtes.
- Ernesto Neto, Chiharu Shiota : installations de fils tendus dans une pièce.

**Le vocabulaire**
bave, grège, frison, blaze, bourre, coque, pelade, magnanerie, filature, bassine, croisure, tavelette, asple, va-et-vient, moulinage, organsin, trame, ailette, flyer, losange, motif, circuit, nappe, ruban, ouverture polaire, cerclage, fuseau, dévidoir, échevette, chrysalide, nymphe, mue, éclosion.

**Les cycles et les transformations**
- Filer (enfermer) puis dévider (libérer) : le même fil dans les deux sens.
- Le dévidage enlève d'abord la dernière couche posée : un cocon se défait **à l'envers** de sa construction (une pile).
- Le transfert d'un fil d'une bobine pleine à une bobine vide (rebobinage) ; la tourelle qui échange les deux.
- Lumière libre → lumière enfermée → lueur ; projections nettes → projections qui se ferment → plus rien.
- Mue, nymphose, émergence (clichés organiques).

**La lumière**
- La soie est un prisme triangulaire : lustre satiné, reflet allongé le long de la fibre (deux lobes, R et TRT), une teinte qui varie avec l'angle.
- Une paroi de fils devant une lampe : jours lumineux entre les rubans, rubans en ombre, croisements plus sombres, paroi pleine qui **luit** de manière diffuse.
- La lampe dans une cage projette sur les murs l'ombre agrandie de tout ce qui l'entoure : chaque ruban posé dessine une bande d'ombre de plusieurs centimètres.
- Dans une brume légère, chaque jour de la paroi devient un **faisceau**.

## b. Les clichés

1. La chenille (ou le ver à soie) qui file sa coque, filmée en accéléré.
2. Le papillon qui sort de sa chrysalide.
3. Le cocon de soie blanc posé sur une feuille de mûrier.
4. Le corps enveloppé (momie, personne emmaillotée, « cocooning » sur un canapé).
5. La nymphe en ombre chinoise dans un cocon à contre-jour.

Les quatre premiers sont interdits comme idée principale, et 1, 2 et 4 sont en plus des sujets organiques que le temps réel rend mal. Le cinquième dit quelque chose d'utile : la silhouette à contre-jour, voilà ce qui rend une scène organique crédible à l'écran.

## c. Les pistes

1. **La lanterne filée (deux cocons sur un fléau).** Deux lanternes-cocons pendent aux bras d'un fléau. Un seul ruban de fil quitte l'une (qui se dévide et libère sa lampe) et s'enroule sur l'autre (qui l'enferme). Quand tout a passé, le fléau fait un demi-tour. Boucle : échange par symétrie (le fil coule toujours dans le même sens). Cœur : enroulement géodésique et non géodésique, dépôt du fil sur une carte de hauteur (aucune interpénétration par construction), transmission de la paroi tracée fil par fil (projections, faisceaux, lueur).
2. **La filature.** Des cocons de soie flottent dans une bassine fumante, tournoient en se dévidant ; leurs fils se réunissent dans une filière et s'enroulent sur un asple. Boucle : phases décalées (un nouveau cocon est jeté dès qu'un autre finit). Cœur : décollement du fil, dynamique d'un flotteur tiré. Risques : eau, vapeur, et la nymphe qui apparaît à la fin de chaque cocon (organique).
3. **L'ombre chinoise.** Un cocon à contre-jour ; on voit l'ombre de la larve qui balance la tête en huit ; la paroi s'épaissit, l'ombre disparaît. Boucle : impossible sans l'émergence (cliché, papillon velu).
4. **Le fourreau d'or (Duprat).** Paillettes d'or, perles et turquoises qui s'assemblent en tube autour d'une larve dans l'eau. Boucle : le fourreau est abandonné, ses pièces retombent. Cœur : empilement par contact. Risques : la larve visible, la scène sous l'eau.
5. **Le pavillon de fibres.** Un bras robot bobine des fibres de carbone sur une membrane gonflée qu'on dégonfle ensuite. Boucle : aller-retour. Ressemble à une démo industrielle.
6. **La momie de Christo.** Un objet est empaqueté par une toile et une corde qui se tendent. Boucle : déballage = film à l'envers. Cœur : simulation de tissu (coûteuse, déjà vue).
7. **Le mawata.** Un cocon dégommé s'ouvre et s'étire sur un cadre en un grand voile translucide ; les voiles s'empilent. Boucle : le voile se replie ? Peu plausible.
8. **Les cocons en filet (Cricula).** Des cocons dorés ajourés suspendus en grappe, qui se tissent par boucles ; lumière qui traverse le filet. Boucle : phases décalées le long d'une branche. Cœur : réseau de boucles. Risque : la chenille.
9. **La cloche de l'argyronète.** Sous l'eau, une bulle d'air se renforce d'une résille de soie. Boucle : la bulle remonte et une autre se forme. Risques : eau, araignée.

## d. Notes

| Piste | Originalité | Esthétique | Boucle | Cœur technique | Variations | Faisabilité | Total |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1. Lanterne filée | 5 | 5 | 4 | 5 | 5 | 3 | **27** |
| 2. Filature | 4 | 4 | 4 | 3 | 3 | 2 | 20 |
| 3. Ombre chinoise | 3 | 4 | 1 | 2 | 2 | 3 | 15 |
| 4. Fourreau d'or | 4 | 4 | 2 | 3 | 3 | 2 | 18 |
| 5. Pavillon de fibres | 3 | 3 | 1 | 4 | 3 | 3 | 17 |
| 6. Empaquetage | 3 | 3 | 1 | 3 | 3 | 2 | 15 |
| 7. Mawata | 4 | 4 | 1 | 2 | 2 | 2 | 15 |
| 8. Cocons en filet | 4 | 4 | 3 | 3 | 3 | 2 | 19 |
| 9. Argyronète | 5 | 4 | 3 | 3 | 2 | 1 | 18 |

Retenue : **la lanterne filée** (piste 1). Elle absorbe la 3 (un cocon à contre-jour, une lumière qu'on enferme), la 8 (les rubans ajourés du début, comme un cocon en filet) et la 2 (le dévidage, lu sur la lanterne de gauche). Elle respecte la contrainte de rendu de bout en bout : du fil, de la lumière, des pièces dures.

Face aux projets du dépôt : pas de plongée (Hollow, Mirage), pas d'éclosion (Membrane), pas de pli (Fold), pas de corde qui flambe (Tangle : ici le fil ne travaille qu'en tension), pas de croissance de champ (Moss, Spore). La boucle est un **échange par symétrie** avec un flux toujours dans le même sens, un schéma que le dépôt n'a pas encore. La cause (un appareil à ailettes qui tourne) n'est ni un marteau, ni une goutte, ni un pendule.

## e. La piste retenue

### Le geste

**Le fil passe d'un cocon à l'autre.** À gauche, une lanterne-cocon pleine, qui ne fait que luire, se dévide : le ruban la quitte en courant autour d'elle, et à mesure que ses couches partent, sa lampe reparaît : d'abord des fentes de lumière, puis des losanges, puis la cage nue. Le ruban monte, passe sur le fléau, redescend, et va s'enrouler sur la cage vide de droite, qui se referme sur sa lampe dans l'ordre inverse. Les murs portent les deux histoires à la fois : à gauche, une ombre qui s'ouvre, à droite, une ombre qui se ferme.

### La boucle

Soit L la longueur du fil, f(u) ∈ [0, 1] la part transférée (monotone pendant le transfert). La lanterne de droite porte la portion [0, f·L] du chemin P, celle de gauche la portion [0, (1 − f)·L] **du même chemin P** (le fil, uniforme, ne garde pas la mémoire de son sens). À la fin du transfert, f = 1 : la droite est pleine, la gauche vide. Le fléau tourne alors de π autour de la colonne : la station pleine prend la place de la station de gauche, la vide celle de droite, et la scène est exactement celle du début.

Preuve de fermeture : l'état de la scène est entièrement donné par (θ_fléau mod π, f, angles des ailettes, position des yeux). Un demi-tour échange les deux stations, qui sont identiques par construction. f repart de 0, les ailettes ont rejoint leur angle de repos, l'œil sa position de repos. La forme du cocon ne dépend que de f (même P, même dépôt), donc elle se referme exactement. Caméra et lumière de la pièce : fonctions périodiques de u.

C'est un échange, pas un aller-retour : à chaque instant on voit une lanterne qui se ferme **et** une qui s'ouvre, et le fil va toujours de gauche à droite.

### Le cœur technique

1. **Chemins d'enroulement exacts** sur la surface de révolution de la cage (profil r(σ) en abscisse curviligne) : géodésiques de Clairaut (r·sin α = c), enroulement non géodésique sous frottement (|κ_g / κ_n| ≤ μ), cerclage, enroulement polaire, boucles en huit ; motifs qui se ferment après un nombre entier de circuits.
2. **Dépôt sur une carte de hauteur** : la paroi est une carte (σ, φ) ; chaque fil se pose sur ce qui est déjà là (hauteur = maximum sous son empreinte + demi-épaisseur, lissée le long du fil par dilatation puis gaussienne : le fil enjambe, il ne traverse pas). Aucune interpénétration par construction, épaississement réel aux pôles.
3. **La paroi comme filtre de lumière** : pour chaque direction issue de la lampe, les instants de passage des quatre premiers fils qui la couvrent (texture). La transmission de la paroi à l'instant f, la lumière sur les murs, les faisceaux dans la brume et l'ombre portée d'une lanterne sur l'autre se lisent dans cette seule table.
4. **Cinématique de l'appareil déduite du fil** : l'œil est sur la tangente au fil au point de pose, à la distance qui le tient hors du cocon plein ; l'ailette suit l'azimut de l'œil, le chariot sa hauteur. La cause (l'œil qui conduit le ruban) et l'effet (le ruban posé) coïncident par construction.
5. **Conservation** : longueur posée à droite + longueur restée à gauche + brin libre = L à chaque instant ; un balancier (« danseur ») absorbe les variations du brin libre.

Invariants vérifiables : aucun fil sous la surface ni sous un fil posé avant lui ; fermeture des motifs ; raccord exact u = 0 / u = 1 ; brin libre tangent au point de pose ; conservation de la longueur ; ailettes qui ne touchent jamais le cocon plein ; continuité de la caméra.

### Les familles (épreuve de déclinaison)

| Famille | Mouvement propre | Ce qu'on voit se fermer |
| --- | --- | --- |
| **Losange** (bobinage géodésique) | l'ailette tourne vite et sans arrêt, l'œil monte et descend d'un pôle à l'autre à chaque demi-tour | des losanges de lumière qui se subdivisent passe après passe, puis se ferment tous ensemble |
| **Cerclage** (côtes puis hélice) | d'abord quelques côtes méridiennes posées lentement (l'œil va d'un pôle à l'autre, l'ailette presque arrêtée), puis l'ailette tourne vite pendant que l'œil grimpe lentement | une fente de lumière horizontale qui remonte la lanterne et se referme au sommet, comme une chōchin qui se construit |
| **Huit** (la bave du ver à soie) | l'œil, monté sur une filière qui frôle la paroi, bat de petites boucles en huit pendant que l'ailette avance lentement | une paroi non tissée qui se couvre par plages, comme un vrai cocon de soie |
| **Méridien** (enroulement polaire) | l'œil passe par-dessus les pôles à chaque circuit pendant que l'ailette avance d'un ruban seulement | un seul quartier de lumière, un faisceau de phare qui se rétrécit en tournant |

Quatre familles, quatre mouvements de l'appareil et quatre façons de se fermer. Chaque famille passe en plus par des **régimes** (règle 20) : une armature de quelques rubans espacés, puis la fermeture, puis une finition (cerclage de taille, renforts polaires).

### Les formes (cages)

Ovoïde (cocon de *Bombyx*), arachide (étranglée à la taille), fuseau (pointu), sphère, poire (*Saturnia*), capsule (chōchin, Akari), double cône (losange), melon. Une cage = profil r(σ), nombre de côtes (12–28), anneaux, moyeux polaires, lampe.

### Matrice de variations

| Axe | Valeurs |
| --- | --- |
| Famille | Losange, Cerclage, Huit, Méridien |
| Forme de cage | ovoïde, arachide, fuseau, sphère, poire, capsule, double cône, melon |
| Fil | soie grège (ivoire), soie dorée (*Nephila*), tussah (miel), yamamai (vert pâle), soie noire, lin écru, fil de cuivre, fibre de verre |
| Ruban | 6 à 16 fils, fil de 1 à 2 mm, jour entre les fils |
| Appareil | laiton et noyer, acier bleui et buis, nickel et ébène, fonte laquée vert et laiton |
| Humeur (décor) | 7 décors (plus bas) |
| Tempo | durée du transfert, respirations sur les régimes, demi-tour franc ou balancé |

4 × 8 × 8 × 4 × 7 ≈ 7 000 combinaisons structurelles avant les réglages continus. Deux graines au hasard diffèrent au moins par la famille ou l'humeur dans 9 cas sur 10.

### Les humeurs (épreuve de variété)

| Humeur | Décor | Lumière | Valeur | Cadrage |
| --- | --- | --- | --- | --- |
| **Magnanerie** | cyclorama de plâtre blanchi à la chaux, sol de tomettes pâles | grand jour latéral d'une fenêtre haute, lampes discrètes | très claire | plan moyen, de face, un peu haut |
| **Chambre noire** | salle noire, brume légère | seulement les deux lampes : faisceaux par les jours, motifs sur un mur gris anthracite | très sombre | contre-plongée légère, plus serré |
| **Heure bleue** | grande baie derrière l'appareil, sol de béton ciré | ciel froid du soir en contre-jour, lampes chaudes | moyenne-sombre, froide | trois quarts, à hauteur des lanternes |
| **Filature** | cyclorama de béton gris | lumière zénithale dure d'une verrière (ombres franches de la machine) | moyenne | plongée de 55° |
| **Shōji** | paravent de papier lumineux derrière l'appareil | contre-jour très doux et large : lanternes en silhouette, lampes faibles | claire derrière, sombre devant | frontal, symétrique |
| **Laque** | fond de laque rouge sombre, sol noir poli mat | douche de lumière étroite par le haut, lampes ambrées | sombre et chaude | gros plan sur la lanterne de droite |
| **Brouillard** | cyclorama gris perle noyé de brume dense | lampes seules, puis lumière diffuse de la brume | moyenne, sans ombres | plan large, lointain |

Pas deux lignes semblables. Une très claire (Magnanerie), une très sombre (Chambre noire), une froide (Heure bleue), un plein jour (Magnanerie, Filature).

### L'objet (épreuve d'ambition)

Éléments de construction de l'appareil : socle tourné en trois gradins, colonne cannelée, chapiteau-palier, fléau en double T à congés, embouts en olive, poulies à gorge sur paliers, balancier « danseur » avec contrepoids, deux stations (moyeu, roulement, axe creux traversant, cage), ailettes en C avec contrepoids et rail, chariot coulissant, œil de porcelaine sur sa filière, cage (côtes en fil, anneaux, rosaces polaires), lampe (ampoule de verre soufflé, filament en boucle, culot). Et le cocon lui-même : rubans de fils ronds, croisements qui enjambent, épaississement aux pôles, lustre satiné et translucidité.

Plus de quinze éléments ; une graine sur trois porte une **pièce d'exception** : fil de cuivre (le cocon devient une lanterne métallique), fibre de verre (un cocon translucide qui garde ses fils en lumière), soie dorée.

### Scénario (film muet, boucle de ~48 s)

1. *(0 → 3 %)* Plan fixe. À gauche, un cocon plein, qui ne fait que luire. À droite, une cage nue autour d'une lampe : le mur porte, agrandie, l'ombre de ses côtes. Le ruban va de l'un à l'autre en passant par le fléau. Les deux ailettes, au repos, font un petit recul.
2. *(3 → 20 %)* **Armature.** Les ailettes partent, lentement d'abord. À droite, quelques rubans espacés se posent : on suit chaque passage de l'œil. Le mur se couvre de grandes bandes d'ombre. À gauche, symétriquement, les dernières couches partent et révèlent en dessous une paroi plus lâche.
3. *(20 → 60 %)* **Fermeture.** L'ailette accélère (accéléré assumé, comme un time-lapse d'atelier). Les jours de la lanterne de droite se resserrent, les faisceaux dans la brume s'amincissent, la lanterne passe de cage lumineuse à lueur. À gauche, c'est l'inverse : les faisceaux naissent.
4. *(60 → 78 %)* **Finition.** Ralenti : derniers rubans (cerclage de taille, renforts polaires), à droite la dernière fente se ferme (temps fort), à gauche la cage se dénude et sa lampe nue éclate sur les murs.
5. *(78 → 82 %)* Les ailettes ralentissent et viennent se ranger à leur angle de repos. Le danseur se stabilise.
6. *(82 → 97 %)* **La relève.** Le fléau tourne d'un demi-tour autour de la colonne : le cocon plein passe au fond, la cage nue vient au premier plan. Leurs ombres balaient les murs ; le fléau dépasse un peu et revient.
7. *(97 → 100 %)* Repos : c'est l'image du début.

Structure : une longue fermeture qui accélère puis ralentit, un temps fort (la dernière fente) et une relève. Le contrepoint (une lanterne s'ouvre pendant que l'autre se ferme) court tout du long.

### Crédibilité

| Temps | Cause visible | Loi | Convention de temps |
| --- | --- | --- | --- |
| armature | l'œil de l'ailette conduit le ruban, qui se pose où sa tangente touche la cage | géodésique / frottement ; fil tendu = droite entre l'œil et le point de pose | temps réel |
| fermeture | même cause, plus vite | dépôt sur ce qui est déjà posé (enjambement) | accéléré (time-lapse) assumé : vitesse ×4 à ×6 |
| finition | l'œil, lent | cerclage : r·sin α ≈ r | ralenti relatif |
| dévidage à gauche | l'œil de gauche tire le ruban | même chemin parcouru à l'envers ; brin libre tangent | idem |
| lumière | la lampe, visible dans la cage | transmission de la paroi (couches), ombre agrandie | instantanée |
| relève | moteur de la colonne (engrenage au pied) | rotation rigide avec dépassement amorti | temps réel |
| brin libre | danseur à contrepoids | longueur conservée | temps réel |

Rien ne flotte : les cages pendent à leur axe, l'axe tient dans un palier, le fléau tient sur la colonne, la colonne sur son socle, le socle sur le sol. Chaque ombre de lampe a sa lampe dans le champ.

### Références visuelles (épreuve des références)

1. **Cocons de *Bombyx* sur table lumineuse** : 3,5 × 2 cm, ivoire, satinés ; la bourre montre des boucles en huit de 3 à 6 mm ; la coque est translucide, plus sombre aux bouts.
2. **Bubble Lamp de George Nelson allumée** (40–60 cm) : la côte en hélice (pas ~2 cm) se lit en traits plus sombres sur une peau qui luit uniformément ; aucun point chaud.
3. **Réservoirs bobinés en carbone ou en verre** : rubans de 1 à 3 cm en losanges réguliers, croisements en relief, calottes polaires plus épaisses et plus denses.
4. **Akari de Noguchi dans la pénombre** : la lampe est la seule lumière ; le mur et le sol portent l'ombre agrandie et nette des côtes.
5. **Temari** : bandes de fils parallèles très serrés (0,5 mm), lustre de soie qui glisse quand on tourne la balle.

Ce qu'elles imposent : une lanterne de **28 à 36 cm** ; des fils de **1,2 à 2 mm**, en rubans de 6 à 16 fils **jointifs** (le ruban se lit comme une bande, le fil seulement de près) ; des jours qui se ferment en **40 à 80 circuits** ; une paroi pleine qui luit **sans point chaud** (la lampe ne se devine que par un halo) ; des ombres projetées **agrandies ×10 à ×20** sur des murs proches (1,5 à 3 m). Densité au plan moyen : la lanterne fait 35 à 45 % de la hauteur de l'image, un ruban fait 5 à 15 px ; au gros plan, un fil fait 3 à 6 px.

### Images clés

1. **Chambre noire, 45 %.** Plan à hauteur des lanternes. À droite, au premier plan, une lanterne à moitié fermée : losanges de lumière entre des rubans ivoire, qui accrochent un liseré satiné. Dans la brume, une vingtaine de faisceaux fins partent des jours vers le mur, où le motif se lit agrandi. À gauche, flou, le cocon de gauche à moitié dévidé, ses propres faisceaux en éventail.
2. **Magnanerie, 70 %.** Grand jour latéral sur du plâtre blanc. La lanterne de droite est presque pleine, ses rubans de soie dorée lisent le jour comme un satin ; seule une fente de lumière reste à sa taille. L'ombre de la machine se découpe sur le cyclorama.
3. **Heure bleue, 88 %.** Pendant la relève : le cocon plein, une lueur ambrée, passe devant la baie bleue. Le fléau est en diagonale, la cage nue arrive au premier plan et sa lampe nue jette sur le sol l'ombre étoilée de ses côtes.

### Risques et parades

- **Trop de fils** (perf.) : rubans dessinés comme des rubans face à la caméra à normale cylindrique (comme des cheveux), deux triangles par segment ; ~250 k segments par cocon ; ombres portées par la lumière de la pièce seulement ; lampes éclairées par la table de transmission, sans carte d'ombre de fils.
- **Le fil qui traverse le fil** : dépôt sur carte de hauteur, test sur tous les segments.
- **Une ailette qui touche le cocon plein** : rail calculé sur l'enveloppe du cocon plein + jeu, test.
- **Lanterne pleine qui ne luit pas** (trop dense) : transmission par fil τ réglée par humeur et par fil, posemètre.
- **Lecture du geste** (on ne comprend pas que le fil passe) : le ruban est visible de bout en bout, cadré dans le plan ; le contrepoint gauche / droite est symétrique et simultané ; l'ombre projetée double tout.
- **Accéléré illisible** (ailette floue) : vitesse plafonnée (~2 tours/s), et la phase de fermeture est celle où l'on regarde la lumière plutôt que l'œil.
- **Organique raté** : il n'y en a pas, par construction.

### Écran de chargement

La carte dépliée (σ, φ) de la paroi, calculée depuis la vraie graine : on voit le chemin du ruban se poser circuit après circuit, les losanges (ou les côtes, les huit, les quartiers) se fermer, en soie claire sur fond sombre, et une lueur de lampe qui baisse derrière à mesure que la carte se couvre. C'est le calcul réel (le même module que le worker).
