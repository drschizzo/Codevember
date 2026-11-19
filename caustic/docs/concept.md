# Caustic — document de travail

Thème donné : « caustic ». Le mot désigne d'abord un effet de rendu ; il faut en faire un sujet. Le projet s'appelle **Caustic** (dossier `caustic/`), sous-titre *le foyer des ondes* : le foyer est à la fois le point où la lumière se rassemble et l'âtre où l'on brûle : *kaustikos*, « qui brûle ».

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

## e. La piste retenue, telle qu'elle est construite

**L'image.** Une cuve d'eau claire vue de côté, à travers sa vitre, à hauteur de l'eau ou un peu au-dessus : sous la ligne d'eau, le fond pâle où la lumière dessine son réseau et, en haut, la surface vue d'en dessous, miroir de réflexion totale ; au-dessus, la surface vue d'en haut. Dans l'eau à peine laiteuse, les rideaux de lumière. Sur trois parois (la face vitrée reste dégagée), les plongeurs du batteur trempent dans l'eau.

**Le geste.** La lumière se rassemble. Les plongeurs poussent des ondes ; on les voit au fond comme des anneaux de lumière qui accourent vers le centre en se resserrant ; à l'instant où ils se rejoignent, la surface prend exactement la forme d'une lentille et le réseau **se résout en un dessin** (une diatomée, un oursin, une méduse, une rosace, un capitule, un radiolaire), net, lumineux, une seconde ; puis il se défait en anneaux qui repartent vers les bords, où les plongeurs les absorbent. La caméra rapide étire cette seconde.

### Découpage temporel (famille Foyer ; boucle de 36 s, trois dessins de 12 s)

Pour chaque dessin, en part de son créneau :

| part du créneau | ce qu'on voit | où regarde l'œil |
| --- | --- | --- |
| 0 – 0,15 | eau presque calme, un frisson au fond | la surface et les plongeurs |
| 0,15 – 0,4 | les plongeurs plongent en une vague qui court le long des parois ; des fronts de lumière entrent par les bords et se resserrent | la caméra descend vers le fond |
| 0,4 – 0,6 | caméra rapide (vitesse ramenée de × 0,4 à × 0,006) ; les anneaux se fondent, le dessin **se forme** et tient | le centre du fond |
| 0,6 – 0,85 | le dessin se défait en anneaux qui repartent ; retour à × 0,4 | la caméra remonte |
| 0,85 – 1 | les plongeurs absorbent ; calme | — |

Les trois dessins d'une boucle forment une **série** (trois formes d'une même famille de motifs) dans un ordre de complexité croissante : un crescendo. Faraday boucle en 30 s, Kármán en 24 s.

### La formule de la boucle

Le champ de hauteur de la surface est une somme d'événements :

h(x, t) = h_calme(x, t) + Σⱼ Wⱼ(τⱼ) · Eⱼ(x, τⱼ(t)),  Eⱼ(x, τ) = Re F⁻¹[ Ĥⱼ(k) · cos(ω(k) τ) · e^{−2νk²|τ|} ]

où Ĥⱼ est le spectre de la lentille j (calculée par transport optimal), ω(k) la relation de dispersion exacte des ondes de capillarité-gravité, τⱼ(t) le **temps physique** de l'événement j (une seule horloge dont la vitesse descend autour de chaque dessin, intégrée en forme fermée, `src/timeline.js`), Wⱼ une fenêtre qui s'annule hors de l'événement (les plongeurs absorbent). Comme cos est pair, la convergence (τ < 0) est la dispersion (τ > 0) lue à l'envers : c'est exactement le retournement temporel. h_calme est une ride de fond dont chaque mode a une fréquence multiple entière de 2π/T (arrondie depuis la dispersion : écart < 0,1 %). Chaque τⱼ ne dépend que de (u − uⱼ) mod 1 et Wⱼ est nulle aux bords de son créneau : **h(u + 1) = h(u) exactement**, la caméra est une fonction périodique, la lumière est fixe.

Les plongeurs suivent l'eau : le déplacement de chacun est la hauteur du champ à sa place (lue dans le même tampon que la caustique), si bien que la cause et l'effet coïncident par construction.

### Matrice de variations

| Axe | Valeurs |
| --- | --- |
| **Famille** (le geste) | *Foyer* (convergence et dessin, une scène sur deux), *Faraday* (cristal de lumière stationnaire), *Kármán* (allée de tourbillons) |
| **Série de dessins** (Foyer) | diatomées, oursins, méduses, rosaces, phyllotaxies (capitules de Vogel), radiolaires |
| **Réseau** (Faraday) | deux réseaux successifs parmi carrés, hexagones, quasi-cristal à 8, 10 ou 12 branches ; le second naît sur un bord |
| **Kármán** | un poteau rond ; 10 ou 12 émissions par boucle, rayon, courant, fossettes tirés |
| **Humeur** | sept (voir plus bas), chacune n'accueille que certaines familles |
| **Fond de cuve** | sable blanc, chaux, faïence, travertin, ardoise, émail, papier |
| **Cuve** | bâti d'acier noirci, aquarium à bâti de laiton, bassin de pierre, cuve émaillée |
| **Cadrage** | plongée, rasant, trois-quarts |

Les pièces sont composées par **humeur** (une humeur = un décor, une lumière, une eau, un fond, une cuve), jamais pièce à pièce.

### Images clés

1. **Le dessin.** Cadrage plongeant à travers la vitre ; fond de sable blanc, soleil haut ; au centre, une diatomée de lumière, rayons fins bordés de rouge et de bleu, aréoles en perles brillantes ; autour, l'ombre douce de la lumière qu'elle a prise.
2. **La convergence.** Rasant, chambre noire, lampe à arc : des anneaux concentriques de filets brillants qui se pressent vers le centre, leurs fronces en dents de scie ; dans l'eau, les rideaux de lumière.
3. **Le cristal.** Faraday sous stroboscope : un réseau de points de lumière en quasi-cristal, qui s'étend depuis le centre ; au bord, le front où il naît, encore désordonné.

### Risques et parades

- *Le dessin illisible* : transport optimal sur une cible adoucie (32 % de la lumière reste entre les traits), ralenti assez long, fond de cuve pâle et mat, exposition réglée pour les hautes lumières.
- *Les pentes irréalistes* : la cuve est profonde (45 cm) et la lentille ne déplace la lumière que localement ; un test vérifie que la pente reste < 0,3.
- *L'aspect « démo WebGL »* : le réseau vient d'ondes vraies ; la cuve est un appareil de musée ; rideaux de lumière, surface d'argent, dispersion.
- *Le coût* : FFT 1024² sur GPU, maillage de projection de 262 144 sommets en trois longueurs d'onde, huit coupes 256² pour le volume ; mobile en 512² et une longueur d'onde.
- *Le scintillement* : un pli de largeur nulle crénelle ; le flou du disque de la source (physique) l'élargit, l'anticrénelage temporel fait le reste.

## e bis. Les trois épreuves

### Crédibilité

| Temps du film | Cause visible | Loi | Convention de temps |
| --- | --- | --- | --- |
| Les fronts entrent | les plongeurs, qui bougent avec l'eau à leur place | ondes linéaires de capillarité-gravité, dispersion exacte | réel × 0,4 |
| Le dessin se forme | la rencontre des fronts | retournement temporel (même onde, à l'envers) ; réfraction de Snell | caméra rapide, jusqu'à × 0,006 |
| Le dessin se défait | la propagation | idem, amortissement visqueux 2νk² | retour à × 0,4 |
| Le calme | les plongeurs absorbent | — | — |
| La lumière | la source, visible dans la fenêtre de Snell et son reflet | source étendue → largeur des plis | — |
| Faraday : le cristal naît | l'excitateur sous la cuve (volant à excentrique, ressorts) et le stroboscope | instabilité paramétrique, onde à Ω/2 | stroboscope désaccordé : un nombre entier de battements lents par boucle |
| Kármán : les tourbillons | le courant et le poteau | allée de von Kármán, fossettes de Lamb-Oseen | temps réel, un nombre entier d'émissions par boucle |

### Variété (une humeur = un décor)

| Humeur | Décor | Lumière | Valeur | Cadrage |
| --- | --- | --- | --- | --- |
| **Lagon** | cuve émaillée, sable blanc | soleil haut, filets nets et frangés | très claire | plongée |
| **Chambre noire** | cuve à bâti d'acier noirci, fond de chaux, pièce noire | lampe à arc ponctuelle au-dessus | très sombre, contrastée | rasant |
| **Thermes** | bassin de moellons de travertin, fond de faïence | soleil d'une verrière, un peu diffusé | moyenne, douce | trois-quarts |
| **Heure dorée** | aquarium à bâti de laiton, fond de travertin | soleil bas et chaud, ombre du rebord | chaude, contre-jour | rasant |
| **Nocturne** | cuve d'acier, fond d'ardoise | lune froide | sombre, froide | plongée |
| **Atelier** | cuve émaillée sous un projecteur | lampe proche | moyenne | trois-quarts |
| **Stroboscope** (Faraday) | cuve d'acier sur l'excitateur, fond de papier | stroboscope blanc | sombre, image figée | plongée |

### Ambition (éléments de construction)

- **La cuve** : bâti (cornières d'acier noirci, de laiton ou d'acier brossé, ou pierre), vitre de 12 mm à chants verts, fond (sable, chaux, faïence, travertin, ardoise, émail, papier), parois intérieures (moellons, ardoise, tôle peinte, émail).
- **Le batteur** : plongeurs, vérins, collier vermillon.
- **L'excitateur** (Faraday) : volant à excentrique, ressorts, moteur.
- **Le canal** (Kármán) : poteau chromé qui porte son ombre.
- **L'eau** : surface d'argent vue d'en dessous, fenêtre de Snell, rideaux dans le volume.

## e ter. Déclinaison et scénario

### Déclinaison (le mouvement de chaque famille)

- **Foyer** : des anneaux de lumière **convergent** des bords vers le centre, s'y résolvent en un dessin, puis **divergent** : un mouvement radial, en respiration.
- **Faraday** : rien ne voyage ; un réseau **stationnaire** naît au centre et s'étend comme un cristal qui croît, un second réseau naît sur un bord et l'envahit, le tout bat lentement sous le stroboscope, puis s'éteint : une croissance.
- **Kármán** : des disques noirs cerclés de lumière **défilent** en quinconce vers le déversoir, émis un à un par le poteau : un cortège.

### Scénario (Foyer, film muet)

1. L'eau est presque immobile ; au fond, une lumière unie que traverse un frisson. La caméra regarde la surface et les plongeurs.
2. Les plongeurs plongent, en une vague qui court le long des parois ; au fond, des fronts de lumière entrent par les bords. La caméra descend vers le fond.
3. Les fronts se resserrent ; leurs fronces se croisent.
4. Le temps ralentit. Les anneaux se fondent ; au centre, la lumière se rassemble en un dessin. Il tient, presque immobile.
5. Il se défait en anneaux qui repartent, le temps reprend sa vitesse ; les plongeurs les reçoivent. La caméra remonte.
6. Calme. Puis un deuxième dessin, plus riche ; puis un troisième, le plus fin. Calme : la boucle.

## e quater. Les références

1. *Fond de piscine au soleil* (photographie de surface, 1–2 m d'eau) : un réseau de cellules de 10–30 cm, filets de 3–5 mm, nœuds plus brillants aux jonctions, franges orange et bleues sur les filets les plus fins ; la lumière entre les filets est à ~30 % du maximum.
2. *Cuve à ondes de laboratoire* (projection sur papier) : fronts concentriques nets, contraste fort, lampe ponctuelle : filets fins sans couleur, image agrandie de ~1,5×.
3. *Vagues de Faraday en ombroscopie* : points brillants en réseau de 1–2 cm, contraste très fort, fond noir, image figée par le stroboscope.
4. *Rayform / caustique conçue* : un dessin lisible, doux, avec des traits plus brillants que le fond d'un facteur 5–10 ; le reste de la lumière forme un halo.
5. *Aquarium vu de côté* : la surface d'en dessous en miroir argenté, la fenêtre de Snell, les rideaux de lumière qui descendent en éventail, le fond.

Ce qu'elles imposent : **l'échelle** (dans la cuve de 60 cm, des ondes de 1 à 4 cm, des filets de 1–2 mm) ; **la lumière** (un fond pâle et mat pour que les filets se lisent, l'éclairement direct n'arrive au fond **que** par la surface, le reste de la pièce sombre ou neutre). Le grain du fond (sable, joints de faïence, lits du travertin) donne l'échelle.

## f. Ce que les essais ont appris

- **La ride de fond noyait le dessin.** À 7·10⁻⁵ m, de petites ondes capillaires focalisent déjà à 45 cm sous l'eau (H·¼·a·k² > 1) ; ramenée à 6–9·10⁻⁶ m, c'est un frisson et le dessin se lit.
- **Exposer pour les hautes lumières** : exposition fixe par humeur, réglée au posemètre (un fond uniforme vers 0,2, les traits quatre à cinq fois plus lumineux, en bloom).
- **Montrer la cause.** Une caméra qui ne montre que le fond perd les plongeurs ; elle regarde la surface entre deux dessins et descend quand les ondes convergent. Pas de plongeurs sur la face vitrée (ils bouchaient la vue). Une humeur vue d'en haut à longue focale (« Planche ») a été retirée : on n'y voyait plus que c'est de l'eau.
- **Rideaux sans brouillard** : turbidité de 0,03 à 0,06 m⁻¹.
- **Les tourbillons sans anneau** : l'anneau de la caustique d'une fossette était un pli plus fin qu'un pixel ; cœur de 14 à 17 mm.
- **Faraday invisible** sous le seuil de focalisation : amplitude relevée à 0,22–0,30 mm.
- **Le bruit de la surface en rasance** avait quatre causes : l'albédo fin du fond lu le long de rayons réfractés (version unie pour ces vues), les rides plus fines que le pixel (pentes moyennées pour le rendu de la surface), un niveau de mip implicite lu dans une branche (niveau 0 explicite), et surtout l'occlusion ambiante d'écran appliquée à des matériaux qui calculent toute leur lumière (ils écrivent leur sortie directement).
- **Les parois reçoivent la lumière du fond.** Le rebond se calcule à partir de la vraie lumière du fond, adoucie (lue en quelques points nets, elle recopiait le dessin comme un reflet), et la caustique directe des parois est dosée physiquement.


## Refonte : le bassin au soleil

La cuve de laboratoire vue de côté, avec son batteur de plongeurs, a été jugée trop technique et froide : une maquette grise dans le noir, une eau qu'on ne voyait pas, un dessin de lumière petit et terne. L'idée propre à la scène est gardée (des ondes convergent et la lumière dessine une figure), la mise en scène est refaite.

Ce qui a guidé la refonte, dans l'ordre des retours de l'auteur :

1. **Un bassin au soleil**, choisi parmi trois directions (les deux autres : une nature morte de verre, une vue sous l'eau).
2. **Rester simple et de grande qualité** plutôt que complexe et sans photoréalisme : un fond de pâte de verre plutôt qu'un zellige à étoiles, peu d'objets, chacun fini.
3. **Des rayons dans l'eau**, pour comprendre comment la caustique se forme, à faible coût. Deux versions refusées (un nuage laiteux, puis des traits trop marqués) avant une lueur fine et courte.
4. **Pas de pause** quand le dessin se forme, seulement un léger ralentissement.
5. **Une ambiance moins clinique** : l'ombre d'un feuillage, des pétales sur l'eau, la pierre mouillée, un mur de chaux, des sols de tomettes et de teck, une serviette ou une lanterne, un bec de fontaine.
6. **Des matières au modèle physique complet**, et tout ajout tenu au photoréalisme : le bec de fontaine a été refait d'une seule pièce, sans filet d'eau (le calcul des ondes ne le connaît pas, la caustique l'aurait trahi).

Le prix : le bassin n'a plus de batteur, donc les ondes du Foyer n'ont plus de cause visible à l'écran.
