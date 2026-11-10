# Du thème au concept

Un thème (« les marées », « le vitrail », « la mue », « l'horlogerie ») n'est pas encore un projet. Le concept tient en trois choses : **un geste qui boucle**, **un cœur technique réel**, **un catalogue** assez riche pour que chaque graine surprenne.

C'est l'étape qui décide de tout. La première idée qui vient est presque toujours celle que tout le monde aurait (pour « shatter » : une vitre qui explose au ralenti, puis le film à l'envers). Prends le temps de penser large avant de choisir, et laisse une trace écrite de ce travail.

## 0. Protocole d'idéation (obligatoire, avant tout code)

Écris tout ce qui suit dans `<projet>/docs/concept.md`. C'est un document de travail : il montre les pistes écartées et pourquoi.

**a. Explorer le thème en largeur.** Au moins cinq angles, une dizaine d'éléments chacun, concrets et précis (pas « la beauté du verre » mais « les lignes de Wallner sur une cassure conchoïdale ») :
- *la physique et la science* : les mécanismes, les lois, les nombres, les instabilités, ce qu'on ne voit qu'au microscope ou à la caméra rapide ;
- *les métiers et les objets* : qui travaille cette matière, avec quels outils, quels gestes, quelles pièces d'exception ;
- *l'histoire de l'art, la photographie, le cinéma* : les images célèbres du thème (et donc les clichés), les artistes qui l'ont traité autrement ;
- *le vocabulaire* : les mots du métier, les mots rares (ils donnent souvent le titre) ;
- *les cycles et les transformations* : d'où vient la chose, ce qu'elle devient, ce qui la ramène à son état initial (c'est là que se cachent les meilleures boucles) ;
- *la lumière* : comment la matière du thème capte, réfracte, diffuse, émet la lumière (c'est là que se joue l'esthétique).

**b. Nommer les clichés.** Liste les trois à cinq traitements évidents du thème. Ils sont interdits comme idée principale (ils peuvent devenir un temps du film).

**c. Produire au moins huit pistes**, de gestes et de schémas de boucle différents (voir loop.md : périodique, plongée, cycle de symétries, cycle de transformations, phases décalées…), chacune en trois lignes : l'image, le geste, la boucle, le cœur technique.

**d. Les noter** de 1 à 5 sur six critères, dans un tableau :
- *originalité* : face aux clichés, et face aux projets du dépôt (trois sur quatre sont déjà des plongées sans fin : une plongée de plus doit être exceptionnelle pour passer) ;
- *esthétique* : potentiel de lumière et de matière (réfraction, émission, diffusion, reflets, contrastes de familles), beauté d'une image fixe prise au hasard ;
- *boucle* : intérêt du schéma (une transformation qui revient par un autre chemin vaut mieux qu'un aller-retour ; un fondu ou une lecture à l'envers vaut 1), et lisibilité du geste sans légende ;
- *cœur technique* : un vrai algorithme, vérifiable, qui produit la variété ;
- *variations* : nombre d'axes indépendants que la graine peut tirer ;
- *faisabilité* : en temps réel à ~2 Mpx, dans un navigateur, dans le temps de la session.
Garde la piste qui a le meilleur total sans note inférieure à 3 ; une piste peut en absorber une autre (un cliché devient un temps du film).

**e. Approfondir la piste retenue :**
- un **découpage temporel** (le film image par image : les temps, leur durée en part de boucle, ce que l'œil regarde à chaque instant, où sont le temps fort, les respirations, le ralenti) ;
- la **formule de la boucle** et la preuve qu'elle se referme ;
- la **matrice de variations** : au moins cinq axes indépendants, chacun avec au moins quatre valeurs nommées et décrites (formes, mécanismes, matières, humeurs, rythmes…), et le nombre de combinaisons ; vérifie que deux graines au hasard donnent deux films qu'on ne confond pas ;
- les **images clés** : décris trois images fixes du film comme des photographies (cadre, lumière, matière) ; si l'une d'elles n'est pas belle, revois le concept ;
- les **risques** (ce qui pourrait être laid, illisible ou trop lent) et leur parade.

**e bis. Les trois épreuves** (voir SKILL.md, exigences 7 à 9) — elles ont manqué au premier essai de la skill (Calcin, « shatter ») : la pièce flottait, les éclats restaient suspendus sans gravité, la poussière remontait seule, la bille et le chant n'avaient pas de source, et les six humeurs n'étaient qu'un même décor sombre teinté autrement. L'utilisateur l'a relevé aussitôt.
- *Crédibilité* : un tableau « temps du film → cause visible → loi physique → convention de temps (temps réel, ralenti, accéléré) ». La convention de temps est le seul endroit où l'on triche, et elle doit se lire comme du cinéma.
- *Variété* : un tableau des humeurs avec, pour chacune, le décor (fond, sol, accessoires), la lumière (nature, direction, dureté), la valeur (claire, sombre, moyenne), le cadrage. Pas deux lignes semblables ; au moins une humeur très claire, une très sombre, une en plein jour.
- *Ambition* : la liste des éléments de construction de l'objet (Calcin, après correction : pied, jambe, bouton, anse, bouchon, côtes optiques, torsade, lobes, bord festonné, filigrane, verre doublé) et des variantes ; viser ce qu'un conservateur de musée trouverait digne d'une vitrine.

**e ter. Deux épreuves de plus** (après Fold, premier essai sous le nom de Sensitive) :
- *Déclinaison* : liste les familles de l'objet principal et, pour chacune, en une phrase, son **mouvement** propre (pas sa taille ni sa couleur). Si deux familles bougent de la même façon, ce sont des variantes, pas des familles : il en faut au moins trois vraiment distinctes.
- *Scénario* : raconte la boucle comme un film muet, plan par plan (« la goutte tombe sur la feuille de gauche ; toute la feuille se ferme de la pointe vers la tige ; elle se rouvre ; … »). Chaque effet est entier et cadré ; aucun plan ne montre un effet partiel qu'on ne sait pas lire. La structure doit avoir une forme (montée, réponse, retour), pas une liste.

**f. Annoncer** le concept retenu à l'utilisateur en quelques lignes (titre, image, boucle, variations) et continuer sans attendre, sauf thème vraiment ambigu.

## 1. Chercher le geste

Liste dix images du thème, puis garde celle qui contient un mouvement **réversible ou auto-similaire** : c'est lui qui fera la boucle. Les quatre projets suivent tous un de ces gestes :

| Geste | Exemple | Pourquoi ça boucle |
| --- | --- | --- |
| Plonger / traverser | Hollow : on traverse chaque coquille par son oculus | auto-similarité : la scène à τ + N est la scène à τ |
| Éclore / déchirer | Membrane : l'armature tend la membrane, qui cède, on plonge vers l'œuf suivant | chaque couche rejoue la même éclosion à sa profondeur relative |
| Plier / tourner | Tesseract : le patron se replie, quart de tour 4D, se déplie | suite de symétries dont le produit est l'identité |
| Graviter / entrer | Orrery : les astres se poursuivent, on entre dans une boule de verre qui contient le monde suivant | orbites périodiques exactes + emboîtement de trois mondes |

Le cycle de transformations est le schéma le moins exploité du dépôt : une matière passe par plusieurs états et revient au premier par un autre chemin (sable → verre → éclats → sable ; eau → glace → fêlure → fonte ; graine → fleur → fruit → graine), chaque passage changeant la forme. Il donne à la fois un geste fort et des variations d'un état à l'autre dans la même boucle.

Autres gestes possibles : croître puis se résorber (cristallisation, réaction-diffusion à phase périodique), tisser / défaire, respirer (dilatation périodique), s'assembler (éclaté → assemblé → éclaté), passer d'une échelle à l'autre (zoom infini), circuler (fluide sur un tore, courants périodiques), se refléter (kaléidoscope dont le groupe tourne d'un cran).

Le geste doit **se lire sans légende** en moins de cinq secondes, et **durer** : une boucle fait 16 à 70 s ; elle a des temps forts (passage, déchirure, rotation) et des respirations (pauses, ralentis).

## 2. Trouver le cœur technique

Chaque projet tient sur un savoir réel, qui produit la variété et la crédibilité, et qui se raconte dans le README avec ses formules et ses mesures :

- **Hollow** — géométrie générative usinée : Voronoï sphérique (enveloppe convexe), cellules de Goldberg, entrelacs de Hankin, surfaces minimales (gyroïde, Schwarz P…) maillées par surface nets, corail de Gray-Scott simulé sur une icosphère, bords de trous en courbes exactes (somme de Minkowski).
- **Membrane** — simulation : XPBD sur GPU (Jacobi pondéré, déterministe, sans atomiques), ruptures, enregistrement 16 bits et relecture Catmull-Rom ; photoélasticité (calcul de Jones sur 12 longueurs d'onde, CIE 1931) ; plis par bruit de phaseurs selon Cerda-Mahadevan ; vaisseaux par colonisation de l'espace.
- **Tesseract** — mathématiques : patrons du tesseract (arbres couvrants), rotations 4D, projection stéréographique et sa jacobienne en forme fermée dans le vertex shader, voyage dans la 3-sphère.
- **Orrery** — physique et mécanique : chorégraphies du problème à N corps (action de Newton, L-BFGS préconditionné, Newton-Krylov, certificat par tirs multiples), épicycles de Fourier, trains d'engrenages aux dents entières, contrôle de collision indépendant.

Pour un nouveau thème, cherche la **discipline** qui le décrit vraiment (cristallographie, optique, hydrodynamique, botanique, textile, horlogerie, architecture…) et un **algorithme** qu'elle utilise et qui tourne en quelques secondes dans un worker ou un shader de calcul. Écris ses **invariants vérifiables** (conservation, étanchéité, absence de collision, périodicité, certificat numérique) : ils deviendront les tests. Mieux vaut un algorithme exact et sobre qu'un effet spectaculaire approximatif.

## 3. Le catalogue

La variété vient d'une graine à l'autre, pas d'une image surchargée. Il faut :

- **6 à 12 archétypes** de l'objet principal, chacun avec ses paramètres (Hollow : alvéoles, Voronoï, fentes, surfaces minimales, géode, moucharabieh, kintsugi, armillaire, écailles, vannerie, radiolaire, corail, vitrail ; Membrane : calice, iris, gousse, ombrelle, couronne, cage, serres ; Tesseract : 18 archétypes de cellule et 16 objets exposés ; Orrery : 4 machines, 5 montures) ;
- **6 à 8 humeurs** (Atelier, Studio, Écrin, Clinique, Nuit, Irisé, Abysses, Sacré, Polariscope…), chacune avec son studio HDR, ses lumières, son fond, son étalonnage, ses accords de matières et ses archétypes favoris ; au moins une claire (Clinique, cyclorama blanc), une froide, une sombre ; une humeur propre au thème quand il en suggère une (Polariscope pour Membrane, Surréaliste pour Tesseract) ;
- des **pièces d'exception** rares (une graine sur trois ou quatre) : cristal massif, vitrail rétroéclairé, kintsugi, gemmes, phosphorescence.

## 4. Les aides et l'écran de chargement

Si le geste est difficile (une rotation 4D), donne au regard des prises, discrètes et masquées par défaut (Tesseract : fantôme, liserés appariés, profondeur en couleur, légendes, analogie 3D). Si le calcul est long et beau (la recherche d'orbites d'Orrery), montre-le sur l'écran de chargement, dessiné dans un worker sur un `OffscreenCanvas`, et fais-le se fondre dans la première image.

## 5. Ce qu'on écrit avant de coder

En tête du README du projet : le titre, une phrase d'image (« Une plongée sans fond. »), le geste en trois ou quatre phrases, et la phrase « la boucle est parfaite par construction » justifiée. Puis la section « Principe » avec la formule de la boucle. Annonce ce concept à l'utilisateur en quelques lignes et continue.

## Choix techniques par défaut

- Échelle : la scène tient dans une sphère de rayon ~2 autour de l'origine, caméra à 4–7 unités ; toutes les longueurs dérivent d'une constante (`D` dans Hollow).
- Durée de boucle : 16–24 s pour un geste simple, 40–70 s pour un voyage ; réglable dans le panneau.
- Graine d'ouverture (`DEFAULT_SEED`) : choisie à la fin, parmi les plus belles, sur une planche.
