# Concept — thème « shatter »

Document de travail (protocole d'idéation de la skill codevember-scene) : exploration, pistes, choix, découpage, variations.

## a. Exploration du thème

**Physique de la rupture**
- Critère de Griffith : la fissure avance quand l'énergie libérée dépasse l'énergie des deux surfaces créées ; le verre casse à quelques pour mille de déformation.
- Vitesse du front de fissure plafonnée vers 1 500 m/s dans le verre (une fraction de la vitesse des ondes de Rayleigh) ; au-delà d'environ 0,6 c_R, le front bifurque (instabilité de Yoffe) : les fissures se ramifient en arbre.
- La surface de cassure raconte la vitesse : *miroir* lisse près de l'origine, puis *brume*, puis *hackle* rugueux ; lignes de Wallner (le front interfère avec les ondes sonores qu'il émet) ; cassure conchoïdale en coquille.
- Impact d'une bille sur une plaque : cône de Hertz sous le point d'impact, fissures radiales en étoile, puis fissures concentriques qui les relient (« toile d'araignée ») ; les éclats sont minuscules près du point d'impact (zone broyée) et grands au loin.
- Verre trempé : surface en compression, cœur en traction ; une fois percé, il se « dé » en petits cubes d'un coup (le front parcourt tout le volume).
- Larme batavique (Prince Rupert) : la tête résiste au marteau, mais un coup de pince sur la queue la pulvérise de la queue à la tête en quelques microsecondes.
- Résonance : un verre à vin vibre en mode (2,0) (le bord s'ovalise), vers 500–900 Hz ; une voix soutenue à la bonne fréquence peut le briser.
- Choc thermique : un gradient de température brutal fait courir des fissures lentes et sinueuses.
- Fragmentation : la distribution des tailles d'éclats suit une loi de puissance (N(> m) ∝ m^−β, β ≈ 0,5–1) : la fragmentation est invariante d'échelle.
- Le verre est un liquide figé (amorphe) : sa viscosité passe de 10³ Pa·s (travail, ~1 000 °C, orange vif) à 10¹² (transition vitreuse) ; la recuisson (*lehr*) efface les contraintes.

**Métiers et objets**
- Souffleur de verre : paraison cueillie au four, marbre, mors, pontil, *glory hole*, arche de recuisson.
- **Calcin** : le verre brisé que l'on refond avec le sable (il abaisse la température de fusion) — le verre se fait avec du verre cassé.
- Cristal au plomb taillé, verre de Murano, *millefiori*, verre dichroïque, verre à l'uranium (fluorescent vert sous lumière noire), vitrail serti de plombs, trencadís de Gaudí (mosaïque d'éclats de céramique), kintsugi, verre de mer (éclats roulés par les vagues).

**Art, photographie, cinéma**
- Harold Edgerton : la bille qui traverse une pomme, l'ampoule qui éclate, au stroboscope (1/1 000 000 s).
- Cornelia Parker, *Cold Dark Matter: An Exploded View* (1991) : une remise dynamitée, ses débris suspendus par des fils autour d'une ampoule.
- Ori Gersht, *Blow Up* : bouquets gelés qui explosent, filmés à très grande vitesse.
- Marcel Duchamp, *Le Grand Verre*, fêlé pendant un transport, et dont il a gardé les fêlures.
- *Zabriskie Point* (le ralenti final), *Matrix* (le temps suspendu).

**Vocabulaire** : éclat, tesson, brisure, esquille, fêlure, craquelure, étoilement, calcin, paraison, recuisson, trempe, larme batavique, conchoïdal, groisil (autre nom du calcin), poussière de verre.

**Cycles et transformations** : sable → fusion → verre → éclats → calcin → refonte (le cycle réel du verre, qui revient par un autre chemin) ; bouteille → éclats → verre de mer → sable ; poussière d'étoile (silicates) → planète.

**Lumière** : réfraction et dispersion (le « feu » du cristal), lignes de fissure brillantes par réflexion totale interne, chants verts du verre (oxyde de fer), caustiques, scintillement des petits éclats, incandescence du verre en fusion (corps noir, 1 400 K jaune-orange → 900 K rouge sombre), fluorescence du verre à l'uranium, irisations du dichroïque.

## b. Clichés écartés comme idée principale

1. La vitre qui explose au ralenti, puis le film à l'envers.
2. Le cube qui tombe et se brise en cellules de Voronoï sur le sol (démo de moteur physique).
3. Le miroir brisé où chaque éclat reflète un visage.
4. Le kintsugi (déjà dans Hollow).

## c–d. Pistes notées (1 à 5)

| # | Piste | Origi. | Esthé. | Boucle | Cœur | Variat. | Faisa. | Total |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | **Ralenti réversible** — une vitre explose, le film repart à l'envers | 1 | 3 | 1 | 2 | 2 | 5 | 14 |
| 2 | **Éclats sans fin** — chaque éclat, vu de près, est un objet entier qui éclate à son tour (fragmentation invariante d'échelle) ; plongée | 3 | 4 | 4 | 4 | 4 | 3 | 22 |
| 3 | **Calcin** — le cycle du verre : un tourbillon de sable incandescent bâtit une forme soufflée, qui refroidit, devient verre clair, éclate au ralenti, reste suspendue en constellation, s'effrite en sable, qui bâtit la forme suivante ; après N formes, la première revient | 4 | 5 | 5 | 4 | 5 | 3 | **26** |
| 4 | **Matière noire** (hommage à Parker) — une explosion gelée autour d'une lampe, que la caméra traverse ; l'explosion respire | 3 | 5 | 2 | 3 | 3 | 4 | 20 |
| 5 | **Trencadís** — des assiettes éclatent, leurs tesselles volent se sertir dans une coupole, dont le motif change à chaque boucle | 4 | 4 | 3 | 3 | 4 | 3 | 21 |
| 6 | **Zootrope stroboscopique** — un plateau tournant de N verres, chacun à une phase de son éclatement, sous l'éclair d'Edgerton | 4 | 4 | 3 | 3 | 3 | 4 | 21 |
| 7 | **Larme batavique** — une goutte de verre tombe dans l'eau, se fige, on brise sa queue : elle se pulvérise de la queue à la tête | 4 | 4 | 2 | 4 | 2 | 3 | 19 |
| 8 | **Verre de mer** — les vagues roulent les éclats d'une bouteille jusqu'à des galets dépolis | 4 | 3 | 3 | 3 | 3 | 3 | 19 |
| 9 | **Kaléidoscope brisé** — un miroir éclate, chaque éclat reflète un morceau de la scène, le groupe de symétrie tourne d'un cran | 3 | 4 | 3 | 3 | 3 | 2 | 18 |
| 10 | **La chanteuse** — un verre à vin vibre en mode (2,0), de plus en plus fort, jusqu'à éclater | 4 | 4 | 2 | 4 | 2 | 4 | 20 |

**Retenue : 3, Calcin.** C'est la seule piste qui revient par un autre chemin (pas de retour en arrière, pas de plongée de plus dans le dépôt), qui réunit les trois lumières du verre (incandescence, transparence, scintillement) dans un même film, et qui change de forme à chaque étape. Elle absorbe les meilleures autres pistes comme temps ou comme variations : le ralenti (1) devient le temps fort de chaque éclatement, la constellation suspendue (4) le temps qui le suit, la larme batavique (7), la chanteuse (10) et le verre trempé deviennent des **mécanismes de rupture**, la loi de puissance de la fragmentation (2) règle la taille des éclats.

## e. La piste retenue : Calcin

> *sable, verre, éclats, sable*

Un tourbillon de sable incandescent monte, se resserre et bâtit, du pied vers le bord, une pièce de verre soufflé qui rougeoie. Elle refroidit en tournant : l'orange passe au rouge sombre, puis s'éteint, et il reste un verre clair, teinté, qui accroche la lumière. Une bille d'acier la traverse (ou le verre se met à chanter, ou il éclate de lui-même, trempé) : le temps ralentit, un front de fissures court sur la paroi, la pièce s'ouvre en éclats qui s'écartent et restent suspendus, une constellation qui tourne et scintille. Puis chaque éclat s'effrite en poussière de verre, et la poussière, prise dans un tourbillon, bâtit la pièce suivante. Après trois ou quatre pièces, c'est la première qui renaît : la boucle est parfaite par construction.

### Découpage d'une étape (durée T_s ≈ 8–10 s ; boucle = N étapes)

| Part de l'étape | Temps | Ce que l'œil regarde |
| --- | --- | --- |
| 0,00 – 0,16 | **Accrétion** | le ruban de sable spirale et se pose ; la paroi pousse du pied vers le bord, blanc-orange (1 400 K) ; sa lueur éclaire le sol |
| 0,16 – 0,40 | **Refroidissement** | l'incandescence glisse vers le rouge sombre, d'abord au pied (formé le premier) ; la pièce tourne ; la transparence apparaît, les chants verdissent |
| 0,40 – 0,50 | **Tension** | verre clair, reflets ; le mécanisme s'annonce : la bille entre dans le champ / le bord s'ovalise / un point de tension scintille |
| 0,50 | **Rupture** (ralenti, noyau K₇) | front de fissures depuis le point d'origine, qui se ramifie ; les fissures s'entrouvrent et brillent |
| 0,50 – 0,78 | **Éclatement** | les éclats s'écartent, freinés, tournent ; petits au point d'impact, grands au loin |
| 0,70 – 0,85 | **Constellation** | presque immobiles, ils dérivent et tournent : les chants verts et les caustiques |
| 0,80 – 0,95 | **Effritement** | chaque éclat se défait en poussière, depuis son bord |
| 0,85 – 1,16 | **Tourbillon** | la poussière spirale autour de l'axe, monte, s'échauffe, et devient l'accrétion de l'étape suivante |

### Formule de la boucle

Temps de boucle t ∈ [0, T), T = N·T_s. La pièce k vit dans son temps local ℓ_k = mod(t − k·T_s, T) (visible pour ℓ_k < T_s) ; la poussière de la transition k → k+1 vit dans ℓ_k aussi (de l'effritement de k à l'accrétion de k + 1, soit jusqu'à 1,16·T_s < T dès que N ≥ 2). La pièce N − 1 nourrit la pièce 0. Le ralenti τ(t) = t − Σ a·w·K((t − t_k)/w) retombe sur t aux instants de rupture et ne change pas T. Mouvements de caméra périodiques en t/T. Tout est fonction analytique du temps : éclats (pivot, vitesse freinée, rotation), poussière (source sur l'éclat, spirale, cible sur la pièce suivante), incandescence, masques ; rien n'est intégré d'une image à l'autre.

### Cœur technique

- **Fracture de coques** : la pièce est une coque de révolution (profil de souffleur) ; un champ d'étiquettes (Voronoï à métrique propre au mécanisme : polaire autour de l'impact, méridienne pour la résonance, uniforme et dense pour la trempe, très gauchie pour le choc thermique) découpe exactement chaque triangle en régions (découpage de Sutherland-Hodgman sur les différences de distances : des lignes de fissure nettes, pas en escalier) ; chaque région devient un éclat **fermé** (paroi externe, paroi interne décalée de l'épaisseur, chants le long des fissures et du bord).
- **Taille des éclats en loi de puissance** : densité de germes décroissante avec la distance à l'origine de la rupture.
- **Front de fissure** : temps d'arrivée par plus court chemin dans le graphe des éclats (vitesse finie, ramification naturelle).
- **Chorégraphie analytique dans le vertex shader** : pour chaque éclat, pivot, vitesse, axe et vitesse de rotation, instants de fissure et d'effritement en attributs ; position x(τ) = c + v·(1 − e^(−kτ))/k, rotation freinée ; pose précédente pour les vecteurs vitesse.
- **Poussière** : des dizaines de milliers d'éclats minuscules instanciés (une seule géométrie, attributs entrelacés), chacun relié à un point d'un éclat de la pièce k et à un point de la pièce k + 1, spirale analytique entre les deux ; mêmes formules en JS (tests) et en TSL.
- **Verre** : transmission physique, dispersion, absorption (teinte), chants plus verts, lignes de Wallner en relief sur les cassures, incandescence de corps noir, ombres colorées.

### Matrice de variations

| Axe | Valeurs |
| --- | --- |
| **Formes** (12) | bulle, bol, coupe, vase à taille, bouteille, fiole, cloche, carafe, tulipe, amphore, gobelet, lentille (dôme épais) — chacune avec ses proportions tirées |
| **Mécanismes** (4) | bille d'acier (étoile + toile d'araignée, cône d'éclats dans la direction du tir), résonance (le bord s'ovalise puis lames méridiennes projetées vers l'extérieur), trempe (dés minuscules d'un coup, explosion isotrope), choc thermique (quelques grandes pièces aux fissures sinueuses, qui se séparent lentement) |
| **Verres** (10) | cristal (dispersion forte), cobalt, ambre, émeraude, fumé, rubis à l'or, uranium (fluorescent), dichroïque (irisé), aigue-marine, obsidienne (noir brillant) |
| **Humeurs** (6) | Verrerie (four, ombres chaudes), Stroboscope (Edgerton : noir, lampe dure), Clinique (cyclorama blanc), Lumière noire (UV, verre à l'uranium), Cathédrale (vitrail : verres colorés, contre-jours saturés), Givre (froid, bleuté) |
| **Rythme** (4) | nombre de pièces par boucle (2, 3, 4), durée d'étape, force du ralenti, tours du tourbillon (1–3, sens) |
| **Fragmentation** | densité de germes, exposant de la loi de puissance, gauchissement des fissures, force et dispersion de l'éclatement |
| **Caméra** (4) | orbite lente, balancement, plongée basse, tour complet par boucle |

Plus de 12³ × 4³ × 10³ × 6 combinaisons ; deux graines au hasard n'ont presque jamais la même humeur, la même suite de formes et les mêmes mécanismes.

### Trois images clés

1. **L'impact** — Stroboscope. Un vase de cobalt sur fond noir, une bille d'acier enfoncée à mi-hauteur ; une étoile de fissures blanches en part, encore fermée au loin, déjà ouverte près de la bille, où de minuscules esquilles s'échappent. Un contre-jour froid dessine le bord du vase ; la lampe pose une ombre bleue sur le sol laqué.
2. **La constellation** — Verrerie. Cent vingt éclats de cristal suspendus en coquille autour de l'endroit où était la coupe, chacun tourne ; leurs chants s'allument en vert ; sur le sol sombre, des caustiques et les ombres colorées des éclats ambrés ; quelques grains déjà s'en détachent.
3. **L'accrétion** — Givre. Un ruban de poussière blanche monte en spirale, s'échauffe en orange en se resserrant, et bâtit le pied d'une bouteille incandescente dont le haut n'existe pas encore ; sa lueur rouge se reflète sur un sol bleu nuit.

### Risques et parades

- *Verre invisible sur fond sombre* → contre-jours, studio HDR à bandes nettes, chants verts, ombres colorées, réglage au posemètre.
- *Coût de milliers d'éclats et de poussière* → un seul maillage par pièce (éclats en attributs), une seule géométrie instanciée par transition, tout calculé dans le vertex shader ; transmission en une passe ; mobile : verre composité, moins de poussière.
- *Poussière « effet de particules » bon marché* → tailles en loi de puissance, éclats (pas de points), scintillement spéculaire, chaleur qui monte en s'approchant de la cible, flou de mouvement.
- *Retour en arrière déguisé* → la pièce suivante est différente (forme, verre, mécanisme), bâtie par le bas, en fusion.
- *Fissures illisibles* → front visible, ouverture progressive, petites esquilles au point d'origine, ralenti.
- *Ensemble chargé* → une seule pièce à la fois, fond calme, une couleur de verre par pièce, accords d'humeur.

---

## Révision après les premiers rendus : les trois épreuves

Retour de l'utilisateur : les scènes se ressemblent (couleur, ambiance), les objets ne sont pas assez ambitieux, et la rupture doit toujours avoir un déclencheur physiquement crédible. Plus largement : même abstrait, tout doit être crédible par la matière, le mouvement et le comportement.

Ce qui ne passait pas : la pièce flottait sans support ; les éclats restaient suspendus, freinés par un « air » imaginaire, sans gravité ; la poussière remontait seule en tourbillon et se changeait en verre ; la bille, le chant, la trempe et la flamme n'avaient pas de source ; six humeurs pour un seul décor sombre teinté ; des coques lisses de révolution.

### Le cycle, revu pour être crédible

Le calcin est justement du verre brisé que l'on **refond**. La pièce n'est plus bâtie par du sable mais **soufflée depuis un bain de verre en fusion**, au centre d'une **sole en cuvette** (le fond d'un four, ou un marbre de verrier), et ses éclats tombent sur cette sole, où ils sont refondus en bain pour la pièce suivante.

| Temps | Ce qu'on voit | Cause visible | Loi | Convention de temps |
| --- | --- | --- | --- | --- |
| 0 – 0,2 | la paraison monte du bain, se gonfle en tournant, prend sa forme ; anse et bouchon sont posés à la fin | souffle et rotation du plateau (la sole tourne) | verre visqueux, incandescent (corps noir) | accéléré |
| 0,2 – 0,42 | la pièce refroidit, du pied vers le bord ; la sole s'éteint ; le plateau ralentit et s'arrête | rayonnement | refroidissement | accéléré |
| 0,42 – 0,5 | le déclencheur s'annonce | pendule lâché par un électro-aimant ; haut-parleur dont la membrane bat de plus en plus fort ; marteau de percussion qui se lève ; chalumeau dont la flamme chauffe un point | pendule (√(g/L)), résonance, levier, conduction | temps réel |
| 0,5 | rupture, front de fissure | choc, résonance, percussion sur verre trempé, gradient thermique | front à vitesse finie | **ralenti ×12 à ×20** (caméra rapide) |
| 0,5 – 0,7 | les éclats partent, tournoient et **tombent** | le choc | balistique, gravité vraie (pas de freinage imaginaire) | ralenti, puis retour au temps réel |
| 0,7 – 0,78 | ils frappent la sole, rebondissent à peine, glissent et se couchent | la sole | choc inélastique, frottement, pente de la cuvette | temps réel |
| 0,78 – 1 | la sole rougeoie, les éclats s'affaissent, coulent vers le centre et forment un bain | la chaleur du four, la pente | verre qui ramollit et coule | accéléré |

La caméra garde sa vitesse pendant le ralenti (le temps suspendu, à la manière d'un plan en caméra rapide).

### Variété : un décor par humeur

| Humeur | Décor | Lumière | Valeur | Cadrage |
| --- | --- | --- | --- | --- |
| Atelier | mur sombre où rougeoie la gueule du four, sole d'acier | lampe d'atelier haute, lueur du four de face | sombre et chaud | plan moyen, face au four |
| Stroboscope | noir absolu, sole de graphite | un seul éclair dur de côté, un contre-jour froid | très sombre, contrasté | gros plan bas |
| Laboratoire | cyclorama blanc, sole de céramique blanche | boîte à lumière au-dessus, ombres douces | très clair | plan moyen frontal |
| Plein soleil | sable clair, ciel pâle | soleil haut et dur, ombres colorées nettes | clair et lumineux | plongée 3/4 |
| Lumière noire | noir violet, sole noire | UV, néons magenta et bleu | sombre, saturé | plan rapproché |
| Cathédrale | pierre sombre, brume | faisceaux colorés venus d'en haut, contre-jour | pénombre colorée | plan large, bas |
| Givre | blanc bleuté mat | soleil levant rasant, froid, de côté | moyen, froid | plan latéral |

### Ambition : des pièces de verrier

Construction : **pied, jambe, bouton (nœud), coupe** (verre à pied, flûte, coupe sur pied, bougeoir), **anse** appliquée (cruche, carafe, pichet), **bouchon** (flacon, carafe), **côtes optiques**, **torsade** (côtes tordues), **lobes** (quadrilobé), **bord festonné ou ondulé**, **filigrane** (fils de verre blanc en spirale dans la paroi, *lattimo*), **verre doublé** (couche colorée sur verre clair, visible dans les cassures). Les pièces sont assemblées (corps, anse, bouchon, pied) et toutes se brisent.
