# Caustic — document de travail

Thème donné : « caustic ». Le mot désigne d'abord un effet de rendu ; il faut en faire un sujet. Le projet s'appelle **Caustic** (dossier `caustic/`), sous-titre *le foyer des ondes* — le foyer est à la fois le point où la lumière se rassemble et l'âtre où l'on brûle : *kaustikos*, « qui brûle ».

## a. Le thème en largeur

**La physique.**
- Une caustique est l'**enveloppe** d'une famille de rayons : là où des rayons voisins se croisent, la densité d'énergie diverge (en optique géométrique), et la diffraction la borne (Airy).
- **Théorie des catastrophes** (Thom, Arnold ; Berry et Upstill, *Catastrophe optics*, 1980) : seules cinq formes stables en 3D — le pli (une ligne brillante), la fronce (cusp : deux plis qui se rejoignent en pointe), la queue d'aronde, l'ombilic elliptique (trois branches en triangle), l'ombilic hyperbolique. Le réseau de lumière au fond d'une piscine n'est fait que de plis et de fronces.
- **Métamorphoses** : quand la surface bouge, deux fronces naissent en « lèvres » (lips), deux branches se touchent « bec à bec » (beak-to-beak), une queue d'aronde se déplie.
- **Condition de focalisation** : une ondulation d'amplitude a et de nombre d'onde k projette des caustiques sur un fond à la profondeur H dès que H·(1 − 1/n)·a·k² ≳ 1 — un dixième de millimètre de ride suffit à 50 cm de profondeur.
- **Dispersion** de l'eau (n = 1,331 dans le rouge, 1,344 dans le violet) : les plis sont bordés de franges colorées au soleil.
- Largeur d'un pli au soleil : le disque solaire fait 0,53°, donc un filet à 50 cm sous l'eau a ~2 mm de large : le soleil est un pinceau fin, une lampe large un pinceau flou.
- Les **ondes de capillarité-gravité** : ω² = (g k + σ k³/ρ) tanh(kH) ; vitesse de groupe minimale 18 cm/s vers λ = 4,4 cm ; les rides courtes vont plus vite que les moyennes, les grandes houles plus vite encore. Amortissement visqueux 2νk².
- **Retournement temporel** (Mathias Fink) : un « miroir à retournement temporel » réémet à l'envers les ondes qu'il a enregistrées, et elles reconvergent vers leur source ; Bacot, Labousse, Eddi, Fink et Fort (*Nature Physics* 12, 2016) l'ont fait sur des ondes d'eau avec un « miroir temporel instantané » : une forme écrite en ondes (une tour Eiffel) se reforme d'elle-même.
- **Conception de caustiques** par transport optimal (Schwartzburg, Testuz, Tagliasacchi, Pauly, *High-contrast computational caustic design*, SIGGRAPH 2014 ; Rayform) : on calcule une surface de verre dont la caustique dessine une image donnée ; équation de Monge-Ampère, maillage qui se déforme jusqu'à ce que chaque cellule reçoive la lumière voulue, puis intégration des normales.
- **Instabilité de Faraday** : un bain secoué verticalement à la fréquence Ω forme des ondes stationnaires à Ω/2 ; selon la viscosité et la fréquence, carrés, hexagones, motifs quasi cristallins à 8, 10 ou 12 branches (Edwards et Fauve, 1994). On les photographie justement par leur caustique (ombroscopie), sous lumière stroboscopique.
- **Tourbillons** : un tourbillon creuse la surface (fossette ∝ −1/r²) ; sa caustique au fond est un disque noir cerclé d'un anneau brillant (les « ombres de tourbillon » au fond d'une piscine quand on y passe la main). Derrière un obstacle, l'allée de Bénard–von Kármán : des tourbillons alternés, émis à la fréquence de Strouhal St ≈ 0,2.
- **Le sillage de Kelvin** : un dièdre de 19,47° dont le bord est lui-même une caustique (de phase stationnaire).
- **Lentilles gravitationnelles** : les astronomes appellent caustiques les courbes de la source où les images naissent par paires ; anneau d'Einstein, croix d'Einstein.
- **L'arc-en-ciel** est la caustique d'une goutte (42°), avec ses arcs surnuméraires.

**Les métiers et les objets.**
- La **cuve à ondes** des cours de physique (Leybold, Phywe) : un bac à fond de verre, une lampe ponctuelle au-dessus, un écran blanc dessous, des excitateurs (pointe, règle, deux pointes) mus par un moteur à excentrique, des obstacles (fentes, réflecteur parabolique, plaque qui fait un haut-fond et réfracte).
- Les **bassins à houle** des laboratoires d'hydrodynamique : batteurs à volets articulés, « serpent » de volets indépendants, plages absorbantes en fibres ; FloWave (Édimbourg), bassin circulaire bordé de 168 volets, capable de faire converger des vagues en un point.
- Les **bassins des carènes** : chariot de remorquage sur rails, maquettes de coque en bois verni.
- Les **miroirs magiques** (makkyō japonais, miroirs « à travers la lumière » chinois des Han) : un bronze poli qui renvoie au mur, dans la tache de soleil, le décor gravé sur son dos.
- Les **miroirs ardents** : Archimède à Syracuse (légende), Buffon et ses 168 glaces (1747), Lavoisier et sa grande lentille de Trudaine (1774), le four solaire d'Odeillo.
- **L'héliographe** de Campbell-Stokes : une sphère de verre qui brûle sa trace dans un carton.
- Les **lentilles de Fresnel** des phares (anneaux dioptriques, prismes catadioptriques).
- Les **verriers** et la verrerie de table : la cardioïde au fond d'une tasse, le pied d'un verre à vin qui projette une étoile.
- Les **piscinistes** : carrelage pâle et joints qui donnent l'échelle des filets.
- Les **opticiens de l'éclairage scénique** : gobos, projecteurs à découpe, « gobos d'eau » (disques de verre ondulé qui tournent devant une lampe).

**L'histoire de l'art, la photographie, le cinéma.**
- David Hockney, *A Bigger Splash*, *Portrait of an Artist* : la piscine et son réseau de lignes blanches (cliché absolu).
- Les photographies sous-marines de rideaux de lumière (« god rays ») dans l'eau claire.
- Olafur Eliasson, *Your welcome reflected* et les installations à reflets d'eau ; les vagues de lumière d'*Ripple* de Paul Cocksedge.
- Jacques-Henri Lartigue, les reflets d'eau sur les coques ; les murs de Venise sous les ponts.
- Photographies de Faraday et de cymatique (Hans Jenny, *Kymatik*) — un cliché à éviter tel quel (sable, plaque de Chladni).
- Les images de Rayform / Mark Pauly : un bloc d'acrylique d'apparence quelconque qui projette un portrait.
- Les infographies d'ombilic et de fronce de Berry ; les catastrophes de Thom dessinées par Zeeman.
- Le rendu 3D : la tasse à café cardioïde (Jensen, photon mapping), la piscine de démo WebGL d'Evan Wallace (2011).

**Le vocabulaire.** Caustique, catacaustique (par réflexion), diacaustique (par réfraction), foyer, focale, enveloppe, pli, fronce, queue d'aronde, ombilic, nappe, filet, lentille, ménisque, houle, clapot, ride, batteur, volet, plage, seiche, ombroscopie, strioscopie, stroboscope, Kármán, Strouhal, Faraday, « foyer » (le point et l'âtre), *ardent*.

**Les cycles et transformations.** Une surface calme (lumière unie) → des ondes qui arrivent (réseau) → une focalisation (dessin net) → la dispersion (réseau qui s'éparpille) → le calme. La lumière s'assemble et se défait ; l'énergie part en ondes et revient. Le retournement temporel est un cycle par construction (la même onde, lue dans les deux sens). Les ondes stationnaires naissent d'une instabilité et meurent quand le forçage cesse. Les tourbillons naissent derrière un obstacle, dérivent, s'éteignent.

**La lumière.** Une caustique n'existe que sur un **écran** : un fond pâle (sable, chaux, faïence), un mur. Elle se voit aussi **dans le volume** quand l'eau est un peu trouble : des rideaux, des nappes qui descendent. La surface vue d'en dessous est un miroir ondulant (réflexion totale au-delà de 48,6°) percé d'une fenêtre (cône de Snell) où brille la lampe. Un pli est d'autant plus fin que la source est petite : soleil = filets nets aux franges colorées, lampe dépolie = réseau doux, stroboscope = image figée.

## b. Les clichés (interdits comme idée principale)

1. Le fond de piscine qui ondule au hasard (Hockney, démo WebGL) — il deviendra le **fond sonore** du film, pas son sujet.
2. La cardioïde dans la tasse de café / l'anneau de lumière d'un verre de vin sur une nappe.
3. Le cristal à facettes qui tourne et jette des arcs-en-ciel sur les murs.
4. Les rayons de lumière sous l'eau avec des poissons.
5. La plaque de Chladni et son sable (cymatique).

## c. Les pistes

1. **Le foyer des ondes** — une cuve d'eau éclairée d'en haut ; des volets sur les bords poussent des ondes qui convergent ; à l'instant où elles se rejoignent, la surface est exactement la lentille calculée par transport optimal et la caustique au fond **dessine une image nette** ; puis les ondes repartent et l'image se défait en réseau. Boucle : plusieurs dessins par boucle, chaque convergence est la lecture symétrique d'une même onde (retournement temporel). Cœur : transport optimal (Monge-Ampère), ondes de capillarité-gravité exactes par FFT sur GPU, caustiques par déformation de maillage.
2. **Le miroir magique** — un makkyō de bronze tourne sur son pied vers le soleil ; la tache de lumière balaie le mur et, quand elle s'y pose, le décor du dos apparaît. Boucle : un tour entier. Cœur : relief de polissage (quelques centaines de nm) calculé à partir du décor, catacaustique.
3. **Le miroir ardent** — un miroir parabolique fait de centaines de glaces orientables : les taches éparses sur un écran se rassemblent en un point qui fait rougir une plaque. Boucle : les glaces se détournent au coucher. Cœur : orientation des héliostats, caustique de réflexion.
4. **La journée d'un verre** — une verrerie sur une table au soleil ; la caustique s'étire, se resserre en cardioïde à midi, s'allonge au soir. Boucle : une journée. Cœur : tracé de photons sur GPU, dispersion.
5. **Le phare** — une lentille de Fresnel de premier ordre tourne ; ses faisceaux balaient la brume ; la caustique des anneaux sur la lanterne. Boucle : un nombre entier de tours. Cœur : optique des prismes catadioptriques.
6. **L'anneau d'Einstein** — une galaxie passe derrière un amas : ses images se dédoublent, s'étirent en arcs, ferment un anneau ; la caustique de la lentille est dessinée en filigrane. Boucle : un passage périodique. Cœur : équation des lentilles (SIE + halos), tir de rayons au pixel.
7. **Le bain de Faraday** — une coupelle secouée : de l'eau calme naît un cristal de lumière (carrés, hexagones, quasi-cristal à 12 branches), qui change de réseau puis se dissout. Boucle : rampe de forçage. Cœur : équations d'amplitude, sélection de motif.
8. **L'allée de tourbillons** — dans un canal, l'eau passe autour d'un poteau ; des tourbillons alternés s'en détachent et projettent au fond des disques noirs cerclés de lumière qui défilent. Boucle : un nombre entier d'émissions. Cœur : tourbillons de Lamb-Oseen, allée de von Kármán.
9. **L'héliographe** — la sphère de Campbell-Stokes brûle la trace du soleil sur un carton au fil d'une journée ; les nuages l'interrompent. Boucle : impossible sans changer de carton (fondu).
10. **Le sillage** — une maquette de coque remorquée dans un bassin des carènes ; le dièdre de Kelvin projette au fond un chevron de lumière. Boucle : va-et-vient du chariot. Cœur : sillage linéaire stationnaire par FFT.

## d. Notes

| Piste | Originalité | Esthétique | Boucle | Cœur | Variations | Faisabilité | Total |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1. Foyer des ondes | 5 | 5 | 5 | 5 | 5 | 3 | **28** |
| 2. Miroir magique | 5 | 4 | 3 | 4 | 3 | 4 | 23 |
| 3. Miroir ardent | 4 | 3 | 3 | 3 | 3 | 4 | 20 |
| 4. Journée d'un verre | 2 | 4 | 3 | 3 | 4 | 4 | 20 |
| 5. Phare | 3 | 4 | 4 | 3 | 2 | 4 | 20 |
| 6. Anneau d'Einstein | 4 | 3 | 4 | 4 | 3 | 5 | 23 |
| 7. Bain de Faraday | 3 | 4 | 4 | 4 | 3 | 5 | 23 |
| 8. Allée de tourbillons | 4 | 4 | 5 | 3 | 3 | 5 | 24 |
| 9. Héliographe | 4 | 3 | 1 | 2 | 2 | 4 | 16 |
| 10. Sillage | 4 | 4 | 2 | 4 | 2 | 3 | 19 |

**Retenue : 1, le foyer des ondes**, qui absorbe 7 et 8 comme **familles** (trois façons pour l'eau de dessiner avec la lumière) et le cliché 1 comme fond : le réseau de piscine est l'état « bruité » d'où le dessin sort et où il retourne. La piste 6 est écartée parce que la caustique n'y est pas visible comme lumière ; la 2, parce que son geste (un balayage) est pauvre et sa boucle un simple tour.

Pourquoi la 1 : la caustique y est **à la fois l'effet et le sujet**. On ne regarde pas un objet éclairé, on regarde la lumière s'organiser. Le geste se lit sans légende (des anneaux de lumière accourent des bords, se rejoignent, et pendant une seconde la lumière dessine), il est spectaculaire, et il repose sur trois savoirs exacts — transport optimal, ondes dispersives, optique des caustiques — qui sont le spectacle au lieu de le décorer.

## e. La piste retenue

**L'image.** Une cuve d'eau claire vue de côté, à travers sa vitre, un peu sous la ligne d'eau. En haut, la surface vue d'en dessous, miroir d'argent ondulant ; en bas, le fond pâle de la cuve où la lumière de la lampe (ou du soleil) dessine son réseau ; entre les deux, dans l'eau à peine laiteuse, les rideaux de lumière qui descendent de la surface au fond. Sur les bords, les volets du batteur trempent dans l'eau.

**Le geste.** La lumière se rassemble. Des volets, sur le pourtour, poussent des ondes ; on les voit au fond comme des anneaux de lumière qui accourent vers le centre en se resserrant ; à l'instant où ils se rejoignent, la surface prend exactement la forme d'une lentille et le réseau **se résout en un dessin** — une diatomée, un oursin, une méduse, une rosace — net, lumineux, une seconde ; puis il se défait en anneaux qui repartent vers les bords, où les volets les absorbent. La caméra rapide étire cette seconde.

### Découpage temporel (famille Foyer ; boucle de 36 s, trois dessins)

| u | ce qu'on voit | où regarde l'œil |
| --- | --- | --- |
| 0,00 – 0,05 | eau presque calme, un réseau ténu qui frémit ; les volets au repos | la surface, le fond uni |
| 0,05 – 0,14 | les volets se mettent en marche ; des fronts de lumière entrent par les bords et se resserrent | les anneaux qui convergent |
| 0,14 – 0,22 | ralenti de caméra rapide (× 60) ; les anneaux se fondent, le dessin **se forme** et tient | le centre du fond |
| 0,22 – 0,30 | le dessin se défait en anneaux qui repartent ; vitesse normale | les fronts qui partent |
| 0,30 – 0,33 | les volets absorbent ; calme | — |
| 0,33 – 0,66 | deuxième dessin, plus riche (même structure) | |
| 0,66 – 1,00 | troisième dessin, le plus fin, avec ses franges colorées | |

Les trois dessins d'une boucle forment une **série** (trois formes d'une même famille de motifs : trois diatomées, trois rosaces…) dans un ordre de complexité croissante : un crescendo.

### La formule de la boucle

Le champ de hauteur de la surface est une somme d'événements :

h(x, t) = h_calme(x, t) + Σⱼ Wⱼ(τⱼ) · Eⱼ(x, τⱼ(t)),  Eⱼ(x, τ) = Re F⁻¹[ Ĥⱼ(k) · cos(ω(k) τ) · e^{−2νk²|τ|} ]

où Ĥⱼ est le spectre de la lentille j (calculée par transport optimal), ω(k) la relation de dispersion exacte des ondes de capillarité-gravité, τⱼ(t) le **temps physique** de l'événement j (la caméra rapide : vitesse ramenée à 1/60 autour de τ = 0, en forme fermée), Wⱼ une fenêtre qui s'annule hors de l'événement (les volets absorbent). Comme cos est pair, la convergence (τ < 0) est la dispersion (τ > 0) lue à l'envers : c'est exactement le retournement temporel. h_calme est une ride de fond dont chaque mode a une fréquence multiple entière de 2π/T (arrondie depuis la dispersion : écart < 0,1 %). Chaque τⱼ ne dépend que de (u − uⱼ) mod 1 et Wⱼ est nulle aux bords de son créneau : **h(u + 1) = h(u) exactement**, la caméra est une fonction périodique lissée, la lumière est fixe.

Les volets suivent l'eau : le déplacement de chacun est la hauteur du champ à sa place (lue dans le même tampon par le vertex shader), si bien que la cause (les volets) et l'effet (les fronts) coïncident par construction.

### Matrice de variations

| Axe | Valeurs |
| --- | --- |
| **Famille** (le geste) | *Foyer* (convergence et dessin), *Faraday* (cristal de lumière stationnaire), *Kármán* (allée de tourbillons) |
| **Série de dessins** (Foyer) | diatomées (disques rayonnants, aréoles), oursins (tests à cinq ambulacres de perles), méduses (cloche, bras, tentacules), rosaces (entrelacs à 6–12 lobes), phyllotaxies (spirales de Vogel en points), coquilles (spirales logarithmiques cloisonnées), radiolaires (treillis concentriques et épines) |
| **Réseau** (Faraday) | carrés, hexagones, quasi-cristal à 8, 10 ou 12 branches ; nucléation au centre ou sur un bord |
| **Obstacle** (Kármán) | poteau rond, plat, deux poteaux côte à côte (rues jumelles), aile inclinée |
| **Lumière** | soleil (filets fins, franges), lampe à arc ponctuelle (réseau grossi, très contrasté), stroboscope, lune, verrière diffuse (réseau doux) |
| **Fond de cuve** | sable blanc, chaux, faïence à joints, travertin, ardoise, cuivre, papier (écran) |
| **Cuve** | aquarium à bâti de laiton, bassin de pierre à hublot, cuve de laboratoire à bâti d'acier, bac de verre sans cadre |
| **Eau** | limpide, légèrement laiteuse (rideaux de lumière), teintée (thé, eau de lagon) |
| **Cadrage** | rasant sous la ligne d'eau, plongeant à travers la vitre, trois-quarts sur une arête |

3 × 7 (ou 5 ou 4) × 5 × 7 × 4 × 3 × 3 : plusieurs dizaines de milliers de combinaisons, mais composées par **humeur** (une humeur = un décor, une lumière, une eau, un fond, une cuve), jamais pièce à pièce.

### Images clés

1. **Le dessin.** Cadrage plongeant à 35° à travers la vitre ; fond de sable blanc, lumière de soleil haute ; au centre, une diatomée de lumière de 30 cm, rayons fins bordés de rouge et de bleu, aréoles en perles brillantes ; autour, l'ombre douce de la lumière qu'elle a prise ; en haut, la surface d'en dessous, lisse comme un miroir au centre et plissée sur les bords, où les volets trempent.
2. **La convergence.** Rasant, chambre noire, lampe à arc : trois anneaux concentriques de filets brillants qui se pressent vers le centre, leurs fronces en dents de scie ; dans l'eau, les rideaux de lumière forment une corolle qui se referme.
3. **Le cristal.** Faraday sous stroboscope, fond d'ardoise : un réseau de points de lumière en quasi-cristal à douze branches, qui s'étend depuis le centre ; au bord du domaine, le front où il naît, encore désordonné.

### Risques et parades

- *Le dessin illisible* (trop de bruit, trop peu de contraste) : transport optimal sur une cible adoucie (plancher de 25 % de lumière, traits épais), ralenti assez long, fond de cuve pâle et mat, cadrage plongeant qui ne l'écrase pas.
- *Les pentes irréalistes* : la cuve est profonde (45 cm) et la lentille ne déplace la lumière que localement ; on vérifie que la pente reste < 0,3.
- *L'aspect « démo WebGL »* : le réseau n'est pas un bruit, il vient d'ondes vraies ; la cuve est un appareil de musée (volets, bielles, bâti) ; rideaux de lumière, surface d'argent, dispersion.
- *Le coût* : FFT 512² sur GPU (< 0,5 ms), maillage de projection 512² en trois longueurs d'onde (~1,5 ms), coupes pour le volume en 256² ; mobile en 256² et une longueur d'onde.
- *Le scintillement* : un pli de largeur nulle crénelle ; le flou du disque de la source (physique) l'élargit à 1–2 texels, le TRAA fait le reste.

## e bis. Les trois épreuves

### Crédibilité

| Temps du film | Cause visible | Loi | Convention de temps |
| --- | --- | --- | --- |
| Les fronts entrent | les volets du batteur, qui bougent avec l'eau à leur place | ondes linéaires de capillarité-gravité, dispersion exacte | temps réel (× 0,5) |
| Le dessin se forme | la rencontre des fronts | retournement temporel (même onde, à l'envers) ; réfraction de Snell | caméra rapide, ralenti × 60 au plus |
| Le dessin se défait | la propagation | idem, amortissement visqueux 2νk² | retour au temps réel |
| Le calme | les volets absorbent (absorption active) | — | temps réel |
| La lumière | la lampe, visible dans la fenêtre de Snell et son reflet | source étendue → largeur des plis | — |
| Faraday : le cristal naît | l'excitateur sous la cuve (bielle, volant) et le stroboscope | instabilité paramétrique, onde à Ω/2, équations d'amplitude | stroboscope : la vibration à 10 Hz paraît lente (repliement) |
| Kármán : les tourbillons | le courant (la pompe, le déversoir) et le poteau | décollement, Strouhal St ≈ 0,2, fossettes de Lamb-Oseen | temps réel |

### Variété (une humeur = un décor)

| Humeur | Décor | Lumière | Valeur | Cadrage |
| --- | --- | --- | --- | --- |
| **Lagon** | bac de verre sans cadre, sable blanc, eau à peine bleutée, fond en dégradé clair | soleil haut, net, franges colorées | très claire | plongeant |
| **Chambre noire** | cuve de laboratoire à bâti d'acier noir, fond de chaux, pièce noire | lampe à arc ponctuelle au-dessus, rien d'autre | très sombre, contrastée | rasant sous la ligne d'eau |
| **Thermes** | bassin de pierre à hublot, fond de faïence à joints | verrière diffuse + soleil voilé | moyenne, douce | trois-quarts sur l'arête |
| **Heure dorée** | aquarium à bâti de laiton, fond de travertin | soleil bas et rasant par une fenêtre, filets étirés | moyenne-chaude, contre-jour | rasant |
| **Nocturne** | bac sans cadre, fond d'ardoise, eau limpide | lune et lampe froide | sombre, froide | plongeant |
| **Atelier** | cuve à bâti d'acier, fond de cuivre poli patiné | projecteur à découpe | moyenne, métal | trois-quarts |
| **Stroboscope** (Faraday) | cuve de verre sur l'excitateur, fond de papier | stroboscope blanc | sombre, image figée | plongeant |

### Ambition (éléments de construction)

- **La cuve** : bâti (cornières de laiton ou d'acier à congés, ou pierre taillée), vitres épaisses à chants verts, joints de mastic, fond (sable, chaux, faïence, travertin, ardoise, cuivre), pieds ou socle.
- **Le batteur** : volets de bois verni ou d'acier, tiges, glissières, bielles, arbre à cames ; plages absorbantes en fibres dans les coins.
- **L'excitateur** (Faraday) : plateau sur ressorts, bielle, volant, moteur.
- **Le canal** (Kármán) : déversoir, grille de tranquillisation, poteau poli.
- **La lampe** : boîtier, réflecteur, diaphragme (ou le soleil par une fenêtre).
- **L'eau** : surface d'argent vue d'en dessous, ménisque contre la vitre, rideaux dans le volume, particules en suspension qui scintillent.

## e ter. Déclinaison et scénario

### Déclinaison (le mouvement de chaque famille)

- **Foyer** : des anneaux de lumière **convergent** des bords vers le centre, s'y résolvent en un dessin, puis **divergent** — un mouvement radial, en respiration (aspiration, éclat, expiration).
- **Faraday** : rien ne voyage ; un réseau **stationnaire** naît d'un point et s'étend comme un cristal qui croît, change de maille (carrés → hexagones → quasi-cristal), bat lentement sous le stroboscope, puis s'éteint d'un bloc — une croissance.
- **Kármán** : des disques noirs cerclés de lumière **défilent** en quinconce d'un bord à l'autre, émis un à un par le poteau — un cortège.

### Scénario (Foyer, film muet)

1. L'eau est presque immobile ; au fond, une lumière unie que traverse un frisson. Les volets attendent.
2. Les volets plongent, d'abord ceux du fond, puis tous, en une vague qui fait le tour de la cuve ; au fond, des fronts de lumière entrent par les quatre côtés.
3. Les fronts se resserrent ; leurs fronces se croisent ; dans l'eau, les rideaux de lumière se penchent vers le centre.
4. Le temps ralentit. Les anneaux se fondent ; au centre, la lumière se rassemble en un dessin : une diatomée. Elle tient, presque immobile.
5. Elle se défait en anneaux qui repartent, le temps reprend sa vitesse ; les volets les reçoivent.
6. Calme. Puis un deuxième dessin, plus riche ; puis un troisième, le plus fin, bordé de couleurs. Calme : la boucle.

## e quater. Les références

1. *Fond de piscine au soleil* (photographie de surface, 1–2 m d'eau) : un réseau de cellules de 10–30 cm, filets de 3–5 mm, nœuds plus brillants aux jonctions, franges orange et bleues sur les filets les plus fins ; la lumière entre les filets est à ~30 % du maximum.
2. *Cuve à ondes de laboratoire* (projection sur papier) : fronts concentriques nets, contraste fort, lampe ponctuelle : filets fins sans couleur, image agrandie de ~1,5×.
3. *Vagues de Faraday en ombroscopie* : points brillants en réseau de 1–2 cm, contraste très fort, fond noir, image figée par le stroboscope.
4. *Rayform / caustique conçue* : un dessin lisible, doux, avec des traits plus brillants que le fond d'un facteur 5–10 ; le reste de la lumière forme un halo.
5. *Aquarium vu de côté* : la surface d'en dessous en miroir argenté, la fenêtre de Snell, les rideaux de lumière qui descendent en éventail, le fond.

Ce qu'elles imposent : **l'échelle** — dans la cuve de 60 cm, des ondes de 1 à 4 cm et des cellules de réseau de 2 à 5 cm, filets de 1–2 mm ; **la densité** — 150 à 300 cellules visibles au fond dans le plan large ; **la lumière** — un fond pâle et mat (≥ 0,6 d'albédo) pour que les filets se lisent, l'éclairement direct n'arrive au fond **que** par la surface (rien d'autre ne l'éclaire), et le reste de la pièce est sombre ou neutre.

**Échelle à l'image** : plan large — le fond entier (60 × 60 cm) ; le dessin en occupe la moitié. Gros plan : impossible sans casser la boucle de lecture ; la caméra respire légèrement (5–10 %) vers le dessin pendant le ralenti. Le grain du fond (sable de 0,3 mm, joints de faïence de 2 cm, veines du travertin) donne l'échelle.

## g. Révision après les premiers rendus (mise au point)

- **La ride de fond noyait le dessin** : à 7·10⁻⁵ m, de petites ondes capillaires suffisent à focaliser à 45 cm sous l'eau (H·¼·a·k² > 1) : le fond était un réseau de piscine où le dessin se perdait. Ramenée à 6–9·10⁻⁶ m : un frisson, et le dessin se lit.
- **La surface trop lumineuse, les traits sans éclat** : on expose maintenant pour les hautes lumières (exposition fixe par humeur, réglée au posemètre : un fond éclairé uniformément vers 0,2, les traits du dessin quatre à cinq fois plus lumineux, en bloom).
- **La cause hors du cadre** : la caméra ne montrait que le fond. Elle regarde désormais la surface et les plongeurs entre deux dessins, et descend vers le fond quand les ondes convergent (une seule horloge : la gaussienne de l'instant du dessin) ; la rangée de plongeurs de la face vitrée a été retirée (elle bouchait la vue).
- **Les rideaux de lumière en brouillard** : une lampe qui éclaire toute la surface diffuse uniformément dans une eau trouble ; turbidité ramenée à 0,03–0,08 m⁻¹, les rideaux restent un accent.
- **Les tourbillons sans anneau** : l'anneau de la caustique d'une fossette est un pli plus fin qu'un pixel ; fossettes élargies (cœur de 14–17 mm) d'après un banc d'essai sur le processeur.
- **Faraday invisible** : amplitude sous le seuil de focalisation (relevée à 0,22–0,30 mm), et un nom de champ en double dans la recette (le second réseau était écrasé par son horaire).
- **Du bruit dans la surface vue en rasance** : quatre causes, isolées une à une — l'albédo fin du fond et des parois lu le long de rayons réfractés (version unie pour ces vues), les rides plus fines que le pixel (pentes et hauteur moyennées sur 6 mm pour le rendu de la surface seulement), un niveau de mip implicite lu dans une branche (niveau 0 explicite) et surtout **l'occlusion ambiante d'écran** appliquée à des matériaux qui calculent toute leur lumière (ils écrivent maintenant leur sortie directement).

## h. Deuxième révision (retour de l'utilisateur) : les parois

« Est-ce normal que les murs ne soient pas du tout éclairés par la lumière qui crée la caustique au fond ? » En partie seulement : sous le soleil de l'Heure dorée, la paroi du fond tourne le dos à la lumière réfractée ; mais la tache de soleil au fond est une grande source diffuse, et la paroi qui fait face au soleil reçoit la lumière de biais. Trois corrections : le rebond se calcule à partir de la vraie lumière du fond (adoucie : lue en quelques points nets, elle recopiait le dessin sur la paroi comme un reflet), la caustique directe des parois est dosée physiquement, et les parois des cuves sombres (ardoise, tôle) ont été éclaircies pour pouvoir montrer cette lumière. La turbidité de l'Heure dorée a été baissée (le voile noyait la paroi).
