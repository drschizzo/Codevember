# Kelp — revue « changement de niveau » (direction artistique et technical art)

Passe du 14 novembre 2026, après la revue cinéma du 12 novembre (presque entièrement corrigée). Rendus : graine d'ouverture k39 (Couchant, cochayuyo) à dix instants en 960 × 540, puis Ploumanac'h / digitée (p7), Midi / boa (m3) et Étretat / palmier de mer (e5) à 0,15, 0,45 et 0,7. Planche : [revue-niveau.jpg](revue-niveau.jpg) (en haut : k39 à 0,15, 0,65 et 0,75 ; en bas : m3 à 0,7, e5 à 0,45, m3 à 0,15).

## Verdict

Les défauts de la première revue sont réglés : plus de triangles, de néons ni de poutres en l'air, et l'optique du dôme est juste. Ce qui retient maintenant l'image tient à **l'architecture**, plus aux réglages : **le monde est un profil extrudé.** La mer est un calcul 1D décalé par l'obliquité, la roche est ce même profil avec un relief ajouté, et la frange est un semis de 64 plantes. Tout ce qui devrait varier le long de la côte reste donc droit et répété :

1. **Le front de la vague est une règle.** Vu de dessous (m3 à 0,7), c'est un mur rectiligne. Vu de dessus (k39 à 0,65), c'est une dalle grise inclinée avec des taches d'écume. Il n'a ni crête, ni épaisseur, ni embruns.
2. **Le bord du platier est une bordure de trottoir** (e5 à 0,45, m3 à 0,7) : une arête droite au-dessus d'un fond sarcelle plat. Le décor se lit comme une jetée.
3. **La frange est une plantation** : une plante par dalle, à intervalles réguliers, à peine dix dans le champ. Sous l'eau, les lanières du cochayuyo sont des planches parallèles à la tranche dentée (k39 à 0,75), et les palmiers de mer ressemblent à des palmiers miniatures (e5).

Changer de niveau, c'est casser l'extrusion. Ce n'est pas une question de shader de plus.

---

## A. La mer : passer du profil au champ

### A1. Un faisceau de profils plutôt qu'un seul (le plus gros gain)

Une simulation 2D complète sur 16 × 16 m à 4 cm, enregistrée à 60 i/s, ferait des centaines de Mo. Le compromis juste :
- **8 à 12 profils** de Saint-Venant 1D, chacun coupé dans la **roche cuite** à sa propre abscisse z (au lieu du profil moyen), avec la même série au large ;
- entre deux profils, le champ est interpolé **en temps local** (on aligne les fronts avant de mélanger, comme pour l'obliquité aujourd'hui), pas en hauteur, sinon le front se dédouble ;
- à 380 mailles × 30 i/s en demi-flottant RG (η, u ; écume et bulles à part, plus grossières), cela fait ~30 Mo et reste dans la texture x × t actuelle, avec une couche par profil (texture 2D-array).

Effet à l'écran : le front **se courbe** avec la roche. Il arrive plus tôt dans les chenaux, s'arrête sur les bosses, et se dédouble autour d'un rocher. L'écume naît à des endroits différents selon z. Le test devient : la ligne du front vue d'en dessous n'est plus droite (écart à la droite > 20 cm sur 5 m).

Variante plus ambitieuse : une Saint-Venant **2D à 10 cm** en compute shader dans le worker (WebGPU), stockée en **harmoniques temporelles** de l'orbite périodique pour les basses fréquences (le gonflement, le retrait), et les fronts gardés en 1D. C'est à réserver si les profils ne suffisent pas.

### A2. De la dispersion : la vague doit se lever avant de tomber

Saint-Venant n'est pas dispersif : la vague se raidit en choc dès le tombant, et elle arrive déjà déferlée. Une vraie série sur un platier **monte, se creuse, pique**, puis casse, et laisse derrière le ressaut un train d'ondulations (*whelps*, ressaut ondulé). Passer aux équations de **Serre-Green-Naghdi** (ou Boussinesq de Madsen-Sørensen) avec un **interrupteur de déferlement** hybride (on repasse en Saint-Venant là où la pente de surface dépasse ~0,6) donne :
- la vague qui se lève au large, lisible avant l'impact (l'anticipation, c'est le suspense) ;
- un instant de déferlement **localisé** (là où naît l'écume), qui pilote A3 ;
- les ondulations derrière le front, qui font « vraie mer ».

Ce n'est que du 1D par profil, donc abordable dans le worker.

### A3. Le déferlement est un objet, pas une texture

Une surface en champ de hauteur ne peut pas rouler. Sans aller à la simulation 3D, on peut construire **la lèvre** :
- par profil, on extrait la crête au moment du déferlement (position, hauteur, vitesse, instant) et on la joint d'un profil à l'autre en une **courbe de crête** ;
- on balaie le long de cette courbe un **ruban de lèvre** dont la section suit un profil de vague plongeante paramétré (de Longuet-Higgins à la volute) par l'âge du déferlement. Le ruban vit ~0,5 s, puis s'effondre dans l'écume ;
- la matière de la lèvre et de la face : **transmission** selon l'épaisseur traversée (Beer-Lambert sur l'épaisseur d'eau le long du rayon : vert-turquoise quand la crête est mince et le soleil derrière, presque noire au pied). C'est le signe le plus lisible d'une vague : aujourd'hui, la face est un aplat gris ;
- des **embruns** : quelques milliers de particules instanciées, nées le long de la crête au déferlement, en trajectoires balistiques avec traînée, de durée de vie bornée et périodiques (âge = (t − t₀) mod T). En contre-jour (Couchant), ils font la moitié de l'image ;
- un voile de **brume d'embruns** au-dessus du ressaut (densité faible, diffusion de Mie vers le soleil).

### A4. L'écume transportée, pas peinte

Aujourd'hui l'écume est un motif de cellules entraîné en deux phases fondues : elle ne garde pas la mémoire de son trajet, d'où les taches de peinture (k39 à 0,65). Le transport existe déjà dans le worker : il suffit de l'**advecter** sur chaque profil en lagrangien (des milliers de « flocons » transportés par u, qui vieillissent, se tassent dans la convergence et s'étirent dans le retrait), puis de les splatter dans une carte d'écume par image. On obtient :
- l'écume **active** (blanche, épaisse, bombée, avec une ombre sur l'eau) dans le ressaut ;
- l'écume **résiduelle** en traînées et en dentelle grise qui dessine le courant du retrait : c'est la meilleure façon de montrer la vitesse de l'eau ;
- les **lignes de bave** laissées sur la roche par le jet de rive, qui sèchent avec l'enveloppe de séchage.

### A5. La mer n'est jamais un miroir

Entre deux vagues de la série, la mer au large est plate : seules des rides de normale (sans relief) l'animent, et l'horizon est une règle. Il faut :
- une **houle de fond** déplacée en géométrie (spectre JONSWAP directionnel, fréquences multiples de 1/T, donc périodique) au-delà de la simulation, avec des crêtes qui se lisent en lignes **convergentes** vers le tombant (réfraction) ;
- la **série visible au large** : des lignes plus sombres qui approchent, qui se gonflent, puis qui blanchissent ;
- un clapot réel (petite amplitude) dans la simulation, pour que le platier ne soit jamais lisse entre deux vagues.

### A6. Sous l'eau : de la structure, pas une brume

Midi et Étretat sous l'eau sont un voile menthe uniforme (m3 à 0,45). L'eau réelle d'un ressac a des **couches** :
- des **nuages de bulles** qui plongent sous le ressaut en panaches tourbillonnants de 1 à 2 m, puis remontent : un volume de densité advecté (le même transport qu'A4), et non un voile qui suit la couverture ;
- des **bouffées de sable** soulevées là où u dépasse le seuil de mise en mouvement, qui dérivent et retombent ;
- la **réflexion totale** au revers de la surface, qui doit montrer la roche et les laminaires en miroir (aujourd'hui, c'est un aplat lumineux), et la **fenêtre de Snell**, nette et déformée par les rides ;
- une extinction plus forte avec la distance : à 4 m dans l'eau de ressac, on ne voit déjà plus rien. C'est ce qui donne la profondeur.

---

## B. Le décor : casser la bordure

- **Le bord du platier** : dans `bakeRock` (`src/gen/rock.js`), H = prof(x) + détail × sst(−4,2, −3,2, x). Le détail s'éteint précisément sur le tombant, si bien que l'arête est le profil seul, **droite par construction**. Elle doit être déchiquetée en plan (des chenaux, des éperons, des blocs détachés). Il suffit de faire varier edgeX selon z par un bruit à grande échelle, puis des blocs éboulés au pied du tombant. Avec A1, chaque profil a son propre tombant, et le front s'y courbe tout seul.
- **Le fond au-delà de la boîte** : aujourd'hui, c'est un plan sarcelle. Il faut un tombant rocheux continu, avec un relief en LOD et des laminaires lointaines (voir C2), qui disparaissent dans l'extinction.
- **L'échelle** : Ploumanac'h se lit en maquette (tilt-shift). Les causes : une profondeur de champ trop forte pour la taille de la scène, des plantes petites et rares, aucun repère d'échelle. Il faut tenir la profondeur de champ à l'ouverture réelle d'un caisson à dôme (f/8 à f/11 en grand-angle : presque tout est net au-delà de 50 cm) et ne garder un flou franc que sur le dôme lui-même (ménisque, gouttes).
- **Le silex d'Étretat** : des taches rondes sombres. Ce devraient être des rognons noirs en saillie, en lits alignés dans la craie, avec un cortex blanc.

---

## C. Les laminaires : du ruban à la forêt

### C1. Des tiges de Cosserat : la torsion, sans quoi une lame reste une planche

Une lanière est une chaîne de nœuds avec un directeur transporté et lissé. Elle plie, mais **ne vrille pas** d'elle-même : dans le courant, toutes les lames restent à plat, parallèles (k39 à 0,75). Une vraie lanière de cochayuyo **roule en hélice**, se tord à la pointe et se retourne : c'est ce qui la fait lire comme vivante.
- **XPBD sur tiges de Cosserat** (Kugelstadt et Schömer, 2016, *Position and Orientation Based Cosserat Rods*) : une orientation (quaternion) par segment, des contraintes de cisaillement et d'étirement, puis de flexion et de torsion. C'est le même solveur, avec un quaternion de plus par nœud.
- La traînée de Morison est alors **anisotrope** (forte sur la face, faible sur la tranche) et produit un **couple** : la lame cherche à se mettre de tranche dans le courant, puis bascule et flotte. C'est le mouvement caractéristique.
- Pour la digitée et le boa, une **lame large** (20 à 40 cm) devrait être une bande de 2 à 3 chaînes couplées en cisaillement (une petite étoffe). Elle peut alors se froisser en travers, se plier en gouttière et se retourner comme un drapeau.

### C2. La densité par clones décalés dans le temps

Le modèle de la mer a une symétrie exacte : le champ en z + Δ est le champ en z retardé de obliq · Δ. Une plante simulée en (x, z) est donc **une solution valide** en (x, z + Δ) avec la phase t − obliq · Δ, si la roche y est semblable.
- On ne simule finement que les ~40 plantes proches (contacts avec le caisson, voisines) ;
- on instancie **5 à 10 clones** de chacune plus loin le long de la côte, avec leur décalage de phase, une rotation et une échelle propres. L'enregistrement est déjà sur la boucle, et une phase décalée ne coûte qu'un uniforme par instance.
- Avec A1, on clone à l'intérieur du même profil.

On passe de 64 plantes à plusieurs centaines, pour presque rien. La frange devient une **canopée** où la roche ne se voit plus qu'entre les vagues, comme sur les références.

Ajouter un **sous-étage** non simulé : croûte rose, *Chondrus*, fucus en touffes, instanciés en cartes ou en petits maillages, animés dans le vertex shader par u(x, t) lu dans la texture de la mer (pas de simulation). Cela retire l'aspect de semis sur dalle nue.

### C3. La forme

- **Le crampon en abat-jour** (k39 et m3 : des dômes brillants, comme des ventouses de débouchoir). Un crampon est mat, sombre, fait de racines, et presque toujours **caché** par les lames couchées et par ses voisins. Il faut le couvrir et le rendre mat.
- **La digitée** est une **main** : une lame large d'un seul tenant, fendue en doigts à mi-longueur. Ce n'est pas un bouquet de rubans qui part d'un stipe. Avec C1, la paume est une étoffe, les doigts sont des chaînes qui en partent.
- **Le palmier de mer** se lit comme un cocotier miniature (e5) : c'est un piège de la référence. Il faut le grouper en **colonies serrées** (des dizaines sur 1 m², stipes de hauteurs différentes), pour qu'il ne soit jamais isolé et ne puisse donc pas se lire comme un palmier.
- **Les dents sur la tranche** des lames du cochayuyo (k39 à 0,75) : probablement l'ondulation de `ruffle` à fréquence fixe (`seg.z · 46`, 21 cycles par boucle), visible de tranche. Il faut une ondulation dont la longueur d'onde dépend de la vitesse relative (flottement de drapeau) et une amplitude nulle pour une lame épaisse.
- **L'usure** : pointes déchirées et pâlies, trous, épiphytes, bord érodé, un dégradé du méristème sombre vers la pointe claire. C'est l'âge qui donne l'échelle.

### C4. La lumière dans la forêt

Sous l'eau, une canopée dense fait des **ombres en mouvement** et des percées de soleil entre les lames. C'est la signature visuelle d'une forêt de laminaires, plus encore que les caustiques. Avec C2, les laminaires (clones compris) doivent porter des ombres dans l'eau, ou au minimum une ombre projetée depuis la surface, lue dans une carte de densité de canopée vue du soleil.

---

## D. Mesures (pour ne pas juger à l'œil seul)

À ajouter à `tools/` :
- **rectitude du front** : écart maximal du front (η − b > 2 cm) à sa droite de régression, le long de z, à chaque instant. Aujourd'hui, il vaut 0 par construction. Cible : > 0,2 m ;
- **couverture de canopée** : part de la roche visible depuis la caméra à travers les lames, à l'air et sous l'eau. Cible : < 40 % pour la digitée et le cochayuyo ;
- **torsion des lames** : angle du directeur entre la base et la pointe, distribution par image. Cible : la médiane > 90° dans le courant ;
- **lisibilité de la vague** : contraste de luminance entre la face et l'eau devant, au moment du déferlement.

---

## Ordre de travail proposé

| Étape | Contenu | Pourquoi d'abord |
|---|---|---|
| 1 | **B (bord du platier) + A1 (faisceau de profils)** | La même cause (l'extrusion) produit la règle du front et la bordure de trottoir. C'est le plus gros gain visible. |
| 2 | **C2 (clones décalés) + C3 (crampons cachés, colonies)** | La frange devient une forêt pour presque rien, et masque la roche nue. |
| 3 | **A3 + A4 (lèvre, transmission, embruns, écume advectée)** | La vague devient un objet. C'est le temps fort du film. |
| 4 | **C1 (Cosserat)** | Le mouvement des lames : vrille, retournement. C'est le plus long à régler (stabilité, raccord de boucle par fondu des orientations). |
| 5 | **A2 (dispersion), A5 (houle), A6 (structure sous l'eau), C4** | Ce qui fait passer de « crédible » à « vrai ». |

Contraintes du projet à garder en tête :
- la boucle reste parfaite : tout ce qui est ajouté est soit enregistré sur l'orbite périodique, soit périodique en T par construction (âge mod T, fréquences multiples de 1/T) ;
- la caméra et l'animation ne bougent pas sans raison ;
- le coût se mesure à chaque étape (budget actuel : ~9 ms à 960 × 540).

---

## Suivi (15 novembre 2026)

| Étape | État | Ce qui a été fait |
|---|---|---|
| B, A1 | fait | Le bord du platier avance et recule le long de la côte (trois ondulations, un chenal, un éperon : la même formule dans la mer, la roche et le shader), l'arête est rompue au mètre, des blocs éboulés cassent le pied du tombant. Faisceau de profils (un tous les 0,9 m) en texture 3D, fondu avec le profil fin de la caméra. Le front se courbe : écart du jet de rive à sa droite, 0 → 0,2 à 0,4 m (`tools/front.mjs`). |
| C2, C3 | fait | Forêt de touffes clonées et décalées dans le temps (100 à 240 touffes, 0,4 ms par image). Palmier de mer en colonies. Crampons mats ; disque du cochayuyo aplati. |
| A3, A4 | fait, en partie | Le déferlement est relevé par profil et par image ; embruns (8 000 grappes périodiques), lèvre (crête poussée vers l'avant), crête à contre-jour traversée par le soleil, écume étirée dans le courant et ombrée. **Non fait** : un vrai ruban de lèvre en volute, et l'écume advectée en lagrangien (elle aurait doublé la mémoire du faisceau). |
| C1 | fait, autrement | Pas de tiges de Cosserat (un quaternion par segment dans le solveur aurait allongé la génération), mais un angle de torsion par nœud, tordu par le courant et propagé le long de la lame : les lames vrillent (médiane en pointe 96° pour le cochayuyo, 39° pour la digitée). **Non fait** : la lame large en étoffe (paume de la digitée). |
| A5, A6 | fait | Houle de fond périodique ; panaches de bulles en colonnes, sable soulevé près du fond ; profondeur de champ plus douce. |
| A2 | **écarté** | Serre-Green-Naghdi demande une résolution tridiagonale à chaque pas : le profil fin de la caméra deviendrait la plus longue pièce du démarrage. Contrainte retenue : le démarrage ne doit pas s'allonger. |
| C4 | non fait | Ombres de la canopée sous l'eau. |
| Démarrage | amélioré | La mer et la roche sont calculées en parallèle sur le pool de workers ; moins de plantes simulées ; paires de contact à l'échelle des lames. k39 17,3 → ~12 s, e5 20,7 → ~15 s, p7 22,5 → ~18,5 s. |

Points à surveiller :
- les embruns ne se voient bien que lorsque la caméra est à l'air et que la vague casse dans le champ ; sur k39, la grande vague casse quand la caméra est déjà sous l'eau ;
- le palmier de mer reste lisible comme un palmier dans les colonies proches ; des colonies plus denses coûteraient en contacts ;
- les clones n'épousent pas exactement la roche de leur nouvelle place (6 cm de tolérance) : au loin, cela ne se voit pas.
