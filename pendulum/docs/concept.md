# Concept — thème « pendulum »

Document de travail (protocole d'idéation de la skill codevember-scene) : exploration, pistes, choix, découpage, variations, épreuves.

Demande de l'utilisateur : « ce thème est l'occasion de construire des machines complexes avec des mécaniques impressionnantes, que ce soit techniquement ou artistiquement ».

## a. Exploration du thème

**Physique et science**
- Isochronisme des petites oscillations (Galilée), T = 2π√(L/g) ; l'erreur circulaire : la période s'allonge de θ₀²/16 à grande amplitude.
- Le pendule cycloïdal de Huygens (joues en cycloïde : la tautochrone) ; le pendule réversible de Kater (mesure de g).
- Le pendule de Foucault : le plan d'oscillation tourne de 360°·sin(latitude) par jour ; l'anneau de Charron qui entretient le mouvement.
- Le pendule double et triple : chaos, exposant de Lyapunov, orbites périodiques instables.
- **Le pendule inversé** : équilibre instable, stabilisé par une commande (chariot qui suit la base, comme on tient un balai sur un doigt) ou par une vibration rapide du pivot (Kapitza, 1951 ; Acheson, 1993 : « le tour de la corde indienne », une chaîne de pendules qui tient debout).
- **Le redressement (swing-up)** : un système sous-actionné (un seul moteur, plusieurs articulations libres) pompe l'énergie et amène la chaîne de pendant à debout. Problème aux deux bouts : Graichen, Treuer, Zeitz (2007, double pendule sur chariot) ; Glück, Eder, Kugi (2013, triple pendule sur chariot) ; transitions entre les huit équilibres d'un triple pendule.
- Les familles sous-actionnées classiques : chariot (cart-pole), pendule de Furuta (bras tournant), Acrobot de Spong (moteur au coude seulement, comme un gymnaste à la barre fixe), Pendubot (moteur à l'épaule), pendule à roue d'inertie (Block, Åström, Spong).
- Résonance paramétrique : la balançoire qu'on pompe, le Botafumeiro de Saint-Jacques tiré par huit *tiraboleiros*.
- Pendule élastique (résonance 2:1 entre ressort et balancement), pendule de Wilberforce (échange torsion / allongement), pendules couplés (battements), synchronisation des horloges de Huygens (« sympathie des horloges », 1665).
- Pendule magnétique chaotique (bassins d'attraction fractals), machine d'Atwood oscillante (orbites en fleurs).

**Métiers et objets**
- Horlogerie : régulateurs de précision (Riefler, Shortt), échappements à ancre, à repos de Graham, à sauterelle de Harrison, à gravité de Denison ; balancier compensé à gril (laiton et acier), à mercure.
- Le cabinet de physique (abbé Nollet, XVIIIᵉ) : instruments d'acajou et de laiton, faits pour la démonstration publique.
- Le métronome de Maelzel, le sismographe à pendule horizontal, le gravimètre.
- Le laboratoire d'automatique : chariots sur rail, courroies crantées, chaînes porte-câbles, codeurs, butées amortisseurs ; les bancs de Quanser, le Cubli (ETH).
- La gymnastique : la barre fixe, le grand tour, l'élan du gymnaste qui plie aux hanches pour pomper (l'Acrobot en est le modèle).
- Les automates (Jaquet-Droz), les jouets d'équilibre (l'oiseau en équilibre, le funambule à balancier).

**Histoire de l'art, photographie, cinéma**
- Marey et la chronophotographie (le coureur en noir à bandes blanches sur fond noir, les poses successives sur une même plaque) ; Muybridge.
- Le Panthéon (Foucault, 1851) : la foule autour du sable et des quilles renversées.
- Poe, *Le Puits et le Pendule* ; Hitchcock et les montres d'hypnose (clichés).
- Alexander Calder (mobiles en équilibre), Jean Tinguely (machines qui s'agitent), Fischli & Weiss (*Der Lauf der Dinge*).
- Les harmonographes victoriens et leurs dessins de Lissajous.
- Les vidéos virales du triple pendule redressé (TU Wien / Stuttgart) : une chaîne qui se dresse d'un coup de fouet et reste debout, immobile.

**Vocabulaire**
- Balancier, lentille, verge, suspension à lame, échappement, ancre, palettes, repos, impulsion, isochronisme, amplitude, battement, régulateur.
- Équilibre instable, **renversé**, inversé ; redresser, dresser, pomper, élan, grand tour, appui tendu renversé (le gymnaste), poirier.
- Sous-actionné, commande en boucle ouverte (*feedforward*), problème aux deux bouts, trajectoire de référence, tir multiple.

**Cycles et transformations**
- Le pendule pendant → redressé → replié dans une autre figure → pendant : un cycle d'équilibres. Un triple pendule a 2³ = 8 équilibres (chaque maillon en haut ou en bas) ; on peut passer de n'importe lequel à n'importe quel autre par une manœuvre calculée.
- L'énergie : potentielle → cinétique → potentielle, apportée par le moteur, rendue au moteur à la descente.
- Le gymnaste : suspension → élan → grand tour → appui renversé → descente.
- L'horloge : impulsion, dégagement, chute du poids, remontage.

**Lumière**
- Le laiton poli et l'acier bleui des instruments ; le reflet d'un rail rectifié qui court sur toute la longueur ; la courroie crantée mate.
- L'ombre portée d'un pendule sur un mur, qui double le geste (les théâtres d'ombres).
- Le stroboscope : poses successives figées dans le noir (Marey), le flou d'un rayon de roue qui tourne.
- Le contre-jour qui découpe une silhouette debout, immobile.

## b. Clichés écartés comme idée principale

1. Le berceau de Newton (billes qui s'entrechoquent).
2. La « vague de pendules » (quinze pendules de longueurs étagées qui se réalignent).
3. Le double pendule chaotique et sa traînée lumineuse multicolore.
4. Le pendule de Foucault seul dans une rotonde.
5. La pendule d'horloge qui bat (déjà approchée par Orrery : barillet, ancre, balancier spiral) et la montre d'hypnose.

## c. Pistes

1. **Le redressement** — des machines sous-actionnées (chariot sur rail, bras tournant, acrobate motorisé au coude, roue d'inertie) qui font se dresser une chaîne de pendules et la tiennent debout, immobile, à l'envers ; puis la replient dans une autre figure d'équilibre. Boucle : cycle d'équilibres, chaque transition calculée comme un problème aux deux bouts, qui part et finit au repos. Cœur : commande optimale par tir multiple.
2. **La sympathie des horloges** — cinq régulateurs suspendus à une même poutre sur ressorts ; partis en désordre, ils se synchronisent (Kuramoto) par les infimes mouvements de la poutre. Boucle : un automate arrête et relance une horloge. Cœur : oscillateurs couplés.
3. **Le régulateur éventré** — une grande horloge de précision en coupe : le balancier à gril, l'échappement à sauterelle de Harrison dont les palettes sautent, le rouage, le poids, le remontoir d'égalité. Boucle : nombre entier de battements par tour de la roue d'échappement. Cœur : cinématique exacte des dentures et des palettes.
4. **Le tour de la corde indienne** — une chaîne pendante au bout d'un vibreur ; la vibration rapide du pivot (Kapitza, Acheson) la fait tenir debout, droite, contre la gravité ; on coupe le vibreur, elle s'effondre. Boucle : relevée par un bras, re-vibrée. Cœur : équation de Mathieu, Floquet.
5. **L'harmonographe** — deux pendules amortis et une table oscillante dessinent une figure de Lissajous à l'encre ; le papier avance, la figure suivante commence. Cœur : oscillateurs linéaires amortis (exacts, mais maigres).
6. **Le Botafumeiro** — un encensoir dans une nef, pompé par des hommes qui tirent la corde deux fois par période. Cœur : résonance paramétrique. Décor : une cathédrale (paysage d'accessoires).
7. **Orbites du chaos** — un double pendule sans frottement qui suit une orbite périodique instable trouvée et certifiée (comme les chorégraphies d'Orrery) : un mouvement qui a l'air chaotique et revient exactement. Cœur : tir et Newton ; trop proche d'Orrery, et sans cause visible (rien n'entretient le mouvement).
8. **Le pendule magnétique** — une bille d'acier au-dessus de trois aimants s'arrête au-dessus de l'un d'eux ; la carte des bassins (fractale) se dessine au sol. Boucle : un bras la relance. Geste faible, la carte est le vrai sujet.
9. **La machine d'Atwood oscillante** — deux masses sur une poulie, l'une balance : elle dessine des fleurs fermées pour certains rapports de masses. Machine trop simple pour la demande.

## d. Notes

| Piste | Originalité | Esthétique | Boucle | Cœur | Variations | Faisabilité | Total |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1. Le redressement | 5 | 4 | 5 | 5 | 5 | 3 | **27** |
| 2. Sympathie | 4 | 4 | 2 | 3 | 3 | 4 | 20 |
| 3. Régulateur éventré | 3 | 5 | 4 | 4 | 3 | 3 | 22 |
| 4. Corde indienne | 5 | 3 | 3 | 4 | 2 | 3 | 20 |
| 5. Harmonographe | 2 | 4 | 3 | 2 | 4 | 5 | 20 |
| 6. Botafumeiro | 3 | 4 | 4 | 3 | 2 | 4 | 20 |
| 7. Orbites du chaos | 2 | 3 | 5 | 4 | 3 | 4 | 21 |
| 8. Pendule magnétique | 3 | 3 | 3 | 3 | 3 | 4 | 19 |
| 9. Atwood | 3 | 3 | 4 | 3 | 2 | 5 | 20 |

Retenue : **le redressement**. Elle absorbe la piste 4 (la vibration de Kapitza peut devenir une famille) et la chronophotographie de Marey (une humeur, et l'écran de chargement). La faisabilité (3) a été vérifiée avant d'écrire la suite : un prototype de tir multiple + SQP dans Node redresse un pendule simple sur chariot en 0,6 s, un double en ~2 s, un triple en 3 à 5 s par essai (60 à 80 intervalles de commande, 12 à 16 segments de tir).

Titre : **Pendulum** (le nom du thème). Sous-titre : *l'équilibre renversé*.

## e. La piste retenue

### Le geste

Une chaîne de pendules pend, immobile. La machine qui la porte se met en mouvement — un chariot qui donne des à-coups sur son rail, un bras qui pivote, un coude qui se plie, une roue qui s'emballe — et la chaîne, qui ne reçoit aucun moteur dans ses articulations, se met à balancer, de plus en plus haut, puis se dresse d'un coup de fouet et **reste debout, à l'envers, immobile**. On la regarde tenir. Puis elle se replie dans une autre figure (le maillon du haut retombe et pend du coude, ou le premier redescend en portant le second debout), et revient pendre.

Le geste se lit en une seconde : *ça tient debout alors que ça devrait tomber*, et *c'est le chariot qui le fait*.

### Le cœur technique

- **Dynamique exacte** d'une chaîne plane de n maillons (pendules composés : masse, centre de gravité, inertie) dont **une coordonnée est imposée** (la position du chariot, l'angle du coude, l'angle de la roue, la hauteur du pivot) ; les autres sont libres. Écrite une fois sous la forme θ = A·q + b·s (angles absolus des maillons en fonction des coordonnées libres q et de la coordonnée imposée s), équations projetées Aᵀ(M(θ)θ̈ + C(θ, θ̇) + G(θ) + B(θ)·s̈) = 0 : le travail du moteur disparaît de la projection, il ne reste que ce que la machine impose.
- **Les transitions** entre deux équilibres sont des problèmes aux deux bouts : trouver s̈(t) sur [0, T] tel que la chaîne parte au repos de l'équilibre A et arrive au repos sur l'équilibre B, avec s, ṡ, s̈ nuls aux deux bouts, la course bornée par le rail, l'effort minimal. Résolus par **tir multiple** (12 à 16 segments intégrés en RK4) et **SQP** (pas de Newton sur les contraintes de raccord, coût quadratique ∫s̈² + β∫s²), comme dans Graichen et al. (2007) et Glück et al. (2013), où la commande est l'accélération du chariot.
- **Invariants vérifiables** : sans commande, l'énergie se conserve (contrôle de l'intégrateur) ; chaque transition atteint son équilibre au repos (écart < 10⁻⁸) ; la coordonnée imposée est C² (pas de saut d'accélération) ; la course reste dans le rail ; aucune pièce ne traverse une autre ni le sol à aucun instant ; la boucle se referme exactement (équilibres identiques à 2π près).

### La boucle (cycle de transformations)

La boucle est une suite d'équilibres E₀ → E₁ → … → E_{k−1} → E₀. Chaque transition part au repos et arrive au repos, la machine revenue à son point zéro ; entre deux transitions, une **tenue** (la chaîne immobile). Le temps du film est la somme des durées : u ∈ [0, 1) → (transition ou tenue, temps local). À u = 1, l'état est E₀ au repos, exactement l'état à u = 0 : **la boucle est parfaite par construction** (aucun état intégré d'une image à l'autre : chaque transition est relue depuis sa table enregistrée, interpolée en Hermite C¹ à partir des états et dérivées).

Les angles d'un maillon redressé valent ±π selon le côté par lequel il est monté ; le rendu ne lit que cos et sin, et les tables sont recalées à 2π près aux raccords.

### Les familles (épreuve de déclinaison)

| Famille | Machine | Coordonnée imposée | Mouvement propre |
| --- | --- | --- | --- |
| **Chariot** | banc à rail rectifié, chariot sur douilles à billes, courroie crantée, moteur et réducteur au bout du banc, chaîne porte-câbles qui suit le chariot | position du chariot x(t) | le chariot donne des à-coups d'avant en arrière, la chaîne (2 ou 3 maillons) fouette et se dresse au-dessus de lui |
| **Tourniquet** (Furuta) | colonne en fonte avec moteur et réducteur, bras horizontal en haut, palier au bout du bras, collecteur tournant | angle du bras φ(t) | le bras pivote de grands angles autour de la colonne ; le pendule, dans le plan perpendiculaire au bras, monte sur un cône — un mouvement en trois dimensions |
| **Acrobate** (Acrobot) | portique à barre fixe ; l'épaule tourne librement sur la barre ; le moteur est sur le premier maillon, près de l'épaule, et mène le coude par une courroie | angle du coude α(t) | la chaîne se plie et se déplie au coude comme un gymnaste qui prend son élan ; grand tour, puis appui renversé |
| **Roue** (pendule à roue d'inertie) | potence, pendule au bout duquel tourne un volant à rayons mené par un moteur | angle de la roue ψ(t) | le volant s'emballe et freine ; le pendule part en sens inverse (réaction), monte par à-coups ; les rayons filent |

Quatre mouvements qui ne se ressemblent ni en silhouette (banc horizontal, colonne, portique, potence) ni en mouvement (translation, rotation autour d'une verticale, flexion interne, rotation d'un volant). Variantes : nombre de maillons (Chariot 2–3, Tourniquet 1–2, Acrobate 2, Roue 1–2), longueurs et masses des maillons, lentilles (disques, sphères, barres nues), suite d'équilibres, durées.

### Découpage temporel (exemple : Chariot à deux maillons, boucle de ~30 s)

| u | temps | ce que l'œil regarde |
| --- | --- | --- |
| 0,00–0,08 | tenue « pendant » (DD) | la chaîne immobile, le chariot au centre ; la caméra est de profil, assez large |
| 0,08–0,18 | transition DD → DU | le chariot hésite, puis deux à-coups ; le maillon du bas passe par-dessus le coude et se plante debout au bout du premier, qui pend : « l'équilibriste » |
| 0,18–0,28 | tenue DU | le maillon debout sur le coude, immobile ; la caméra s'approche |
| 0,28–0,46 | transition DU → UU (temps fort, ralenti de caméra rapide ×0,5 pendant la montée) | grand fouet : tout se dresse au-dessus du chariot |
| 0,46–0,62 | tenue UU | la chaîne debout, à l'envers ; le moment le plus long ; lente avancée de la caméra, contre-jour qui découpe la silhouette |
| 0,62–0,74 | transition UU → UD | le maillon du haut tombe et pend du coude, qui reste en l'air : « la lanterne » |
| 0,74–0,82 | tenue UD | |
| 0,82–0,96 | transition UD → DD | le premier maillon redescend en douceur, le chariot accompagne |
| 0,96–1,00 | tenue DD | retour à l'image de départ |

La structure est une **montée** (de l'exploit le plus petit au plus grand), un **sommet** (la tenue debout) et une **résolution** (deux figures qui défont l'exploit), pas une liste.

### Matrice de variations

| Axe | Valeurs |
| --- | --- |
| Famille | Chariot, Tourniquet, Acrobate, Roue |
| Chaîne | 1, 2 ou 3 maillons ; rapports de longueurs (égaux, décroissants, croissants) ; maillons en barre plate ajourée, en tube, en tige ronde à lentille |
| Suite d'équilibres | 2 à 5 étapes tirées parmi les équilibres de la famille, en crescendo (le tout-debout toujours au sommet) ; côté de montée (par la gauche, par la droite, par-dessus) |
| Rythme | durée des transitions (1,4–3 s physiques), tenues (1,5–4 s), ralenti du temps fort (×0,4–0,7 ou aucun) |
| Humeur (décor) | Cabinet, Laboratoire, Chronophotographie, Plein soleil, Atelier, Heure bleue, Laque |
| Accord de matières | 4 à 6 par humeur |
| Caméra | profil serré / plan large / trois-quarts plongeant ; côté ; distance |

4 familles × ~6 chaînes × ~6 suites × 7 humeurs × 5 accords × 3 cadrages : plusieurs dizaines de milliers de combinaisons ; deux graines au hasard ont presque toujours une autre machine **et** un autre décor.

### Images clés

1. **Chariot, Cabinet.** Plan de profil, un peu bas. Un banc d'acajou sur deux tréteaux tournés, rail d'acier poli qui court sur toute la largeur de l'image et renvoie la fenêtre ; le chariot de laiton au centre ; au-dessus, trois maillons de laiton à lentilles debout, alignés, immobiles. Fond vert sombre, lumière douce d'une haute fenêtre à gauche, un filet sur chaque arête de laiton.
2. **Roue, Plein soleil.** Mur blanchi à la chaux, soleil bas et dur : la potence et son pendule à volant portent une ombre nette et grande sur le mur. Le pendule passe l'horizontale ; les rayons de la roue sont flous, leur ombre aussi.
3. **Acrobate, Chronophotographie.** Velours noir, lumière dure de côté. Le portique disparaît presque ; la chaîne, laquée noire à filets blancs, est en appui renversé, et derrière elle s'effacent en gris les douze poses précédentes de son grand tour, comme sur une plaque de Marey.

### Risques et parades

- **Le solveur ne converge pas pour une graine** (chaînes triples, durées courtes) → plusieurs essais en parallèle dans le pool de workers (graines d'initialisation, durées T tirées autour de la valeur nominale), continuation depuis une solution voisine ; échec affiché avec ses issues (autre graine, réessayer). Cache des transitions par spécification.
- **Chargement long** (triple : ~5 s par transition) → les transitions d'une scène se résolvent en parallèle ; l'écran de chargement montre leur convergence (il est fait pour ça).
- **Une machine de laboratoire stérile** → chaque humeur a son atelier : instrument de cabinet de physique (acajou, laiton), fonte et chêne, laque, aluminium anodisé ; pièces usinées à arêtes arrondies, vis, roulements, courroie, chaîne porte-câbles, butées, plaque de constructeur.
- **Mouvements trop rapides pour l'œil** (un fouet de 0,3 s) → ralenti de caméra rapide sur le temps fort, la caméra continue à vitesse normale ; tenues longues.
- **Ça a l'air truqué** (la chaîne tient debout sans raison) → la machine bouge visiblement juste avant, et pendant la tenue la caméra montre le chariot sous la chaîne ; un fin indicateur (galvanomètre du moteur) dévie avec l'effort.
- **Pièces qui se traversent** (maillons repliés l'un sur l'autre, bras contre colonne) → maillons dans des plans décalés (montage en chape alternée, comme sur les vrais triples pendules), contrôle sur toute la boucle par le banc.

## e bis. Les trois épreuves

### Crédibilité

| Temps | Cause visible | Loi | Convention de temps |
| --- | --- | --- | --- |
| Tenue (pendant) | la gravité | équilibre stable | temps réel |
| Transition | le chariot / le bras / le coude / la roue, mené par un moteur et une courroie, un réducteur ou un pignon | équations de Lagrange de la chaîne, coordonnée imposée (la machine est assez puissante pour imposer son mouvement) | temps réel, ralenti ×0,4–0,7 sur le fouet du temps fort (caméra rapide), avec rampe de vitesse en forme fermée |
| Tenue (debout) | la machine immobile sous la chaîne en équilibre exact | équilibre instable ; en vrai, une boucle de rétroaction ferait des corrections de quelques dixièmes de millimètre, invisibles | temps réel |
| La roue | le moteur sur le pendule ; le volant prend la réaction | conservation du moment cinétique (inertie du volant) | temps réel |

Rien ne flotte : le banc repose sur ses tréteaux, la colonne sur son socle, le portique sur ses pieds ; chaque maillon est porté par un roulement dans une chape.

### Variété (les humeurs, sans parler de couleur)

| Humeur | Décor | Lumière | Valeur | Cadrage |
| --- | --- | --- | --- | --- |
| Cabinet | table d'instrument, mur sombre uni | grande fenêtre haute de côté, douce | moyenne-sombre | profil un peu bas |
| Laboratoire | cyclorama blanc continu, sol clair | grande boîte à lumière au-dessus, deux bandes latérales | très claire | trois-quarts face, plan large |
| Chronophotographie | velours noir sans horizon | lumière dure rasante de côté, rien d'autre | très sombre, sujet clair | profil strict, téléobjectif |
| Plein soleil | mur de chaux et sol de terre battue | soleil dur et bas, ciel bleu en remplissage | claire, ombres franches | profil avec le mur en fond, l'ombre du pendule sur le mur |
| Atelier | halle sombre, sol de béton taché | un rai de lumière zénithale d'une verrière, poussière dans le faisceau | sombre avec un faisceau | légère plongée |
| Heure bleue | cyclorama gris froid, brume | ciel froid diffus, contre-jour blanc | moyenne froide | trois-quarts arrière, contre-jour |
| Laque | sol de feutre gris, mur gris moyen | boîte à lumière au-dessus, contre-jour | moyenne | plan serré, frontal |

### Ambition (éléments de construction)

Chariot : banc (poutre, tréteaux tournés ou piétement en fonte), deux barres de guidage rectifiées sur paliers, chariot sur quatre douilles à billes, courroie crantée et ses deux poulies (l'une menée par un moteur à ailettes et un réducteur), tendeur, butées à tampons, chaîne porte-câbles articulée qui se déroule derrière le chariot, codeur, plaque gravée ; maillons en chape alternée, roulements à billes visibles, lentilles réglables par une molette, vis à tête fendue. Tourniquet : socle en fonte nervuré, colonne, moteur, couronne et pignon, collecteur tournant à bagues de cuivre, bras en caisson ajouré, contrepoids, palier. Acrobate : portique (deux montants, entretoises, barre fixe), épaule sur roulement, moteur et poulies, courroie le long du premier maillon, coude. Roue : potence, pendule en caisson, moteur, volant à rayons et jante lourde. Bien plus de cinq éléments par famille.

## e ter. Scénario (film muet, Acrobate, ~32 s)

1. La chaîne de deux maillons pend sous la barre, immobile. Lumière dure de côté.
2. Le coude se plie un peu, se déplie : la chaîne commence à balancer. À chaque passage, le coude se plie au bas de la course et se déplie en montant : l'amplitude grandit.
3. Le grand tour : la chaîne passe au-dessus de la barre, ralentit… et s'arrête debout, droite, en appui renversé (ralenti au passage du sommet).
4. Elle tient. Longtemps. La caméra s'approche du coude.
5. Le second maillon bascule et retombe le long du premier, qui reste debout : une figure en épingle.
6. Le premier redescend en portant le second, le tout se déplie en balançant de moins en moins, et pend. Retour à l'image 1.

## e quater. Références

Photographies que tout photographe du sujet ferait :
1. **Le triple pendule sur chariot de laboratoire** (bancs d'automatique de Vienne et de Stuttgart) : un rail de 1,5 à 2 m sur un profilé, un chariot d'environ 15 × 10 cm, trois maillons d'aluminium de 20 à 40 cm, de quelques centimètres de large, montés en chapes côte à côte (chaque maillon décalé de 2 à 3 cm du précédent en profondeur). Échelle : la chaîne debout fait 0,7 à 1 m, le rail est bien plus long qu'elle.
2. **Le pendule de Furuta** (bancs Quanser) : une colonne de 20–30 cm, un bras de 15–25 cm, un pendule de 30–40 cm ; très petit, il remplit l'image en gros plan.
3. **Le régulateur de précision** (Riefler, Shortt) : pour la facture — laiton poli, acier bleui, vis à tête fendue, rubis ; échelle des détails : 1 à 5 mm.
4. **La chronophotographie de Marey** (le marcheur noir à bandes blanches) : fond noir absolu, figure claire en traits, 10 à 20 poses superposées en gris dégressif.
5. **Le gymnaste au grand tour** : le corps tendu, l'élan pris par le pli des hanches au bas de la course.

Ce qu'elles imposent : un **rapport rail / chaîne** de 1,5 à 2 (le rail est le plus long élément de l'image et donne l'échelle) ; des maillons étroits et nets (rapport longueur / largeur de 10 à 20) ; des détails de quelques millimètres (vis, roulements, dents de courroie) visibles en gros plan ; une seule machine, centrée, sur un fond neutre.

**Échelle** (épreuve) : une scène = une machine de 0,7 à 2 m. Plan large : toute la machine (le rail entier). Gros plan : le chariot et le premier maillon (~30 cm). Ce qui donne l'échelle : la courroie crantée (pas de 5 mm), les vis, les roulements, le grain du bois ou de la fonte. Pas de foule d'éléments : la densité vient des détails usinés, pas du nombre.

## f. Révisions pendant la construction

Ce que les premiers calculs et les premières images ont changé :
- **la chaîne triple ne se redresse pas « de rien »** : partir d'une interpolation des angles ne converge que dans 17 essais sur 128. Une bibliothèque de départs (7 redressements, 6 descentes sur une machine de référence) et une continuation vers les maillons de la graine la rendent sûre (24 sur 24) ; les suites triples se limitent au redressement et à la descente (DDD → UUU → DDD), qui sont aussi les plus spectaculaires ;
- **l'Acrobot calait à 10⁻⁶** : un polissage par pas de Newton de norme minimale, après la SQP, referme les raccords ;
- **le portique de l'acrobate traversait la chaîne** : la barre fixe d'un vrai portique passe devant et derrière ; le second maillon, replié le long du premier, la traversait. Portique derrière la chaîne, axe en porte-à-faux ; le banc des contacts le vérifie ;
- **les machines à un maillon n'avaient que deux temps** (D → U → D) : le « grand tour » (de debout à debout, un tour entier, au ralenti) devient leur temps fort ;
- **la roue à deux maillons** ne se redresse presque jamais (2 transitions sur 8) : la famille Roue garde un seul maillon ; **le tourniquet à deux maillons** ne se dresse pas d'un seul élan (DD → UU) : il passe par une figure intermédiaire ;
- **lumière** : au posemètre, le Cabinet et l'Atelier étaient presque noirs (médiane 0,004 à 0,03), le Plein soleil brûlé (médiane 4, 80 % de l'image) ; lampes redosées par humeur, et la caméra glisse au sommet vers un second cadrage (la chaîne debout entière) au lieu d'un simple rapprochement qui coupait la roue.
