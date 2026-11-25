# Hive

*le rayon qui cherche sa cellule.* Trois cadres d'apiculteur en bois clair, présentés comme des pièces de musée : chacun pend par ses oreilles sur deux fines tiges, au-dessus d'un socle. Les abeilles y ont bâti librement, sans cire gaufrée, et pas en hexagones. Chaque rayon est pavé d'une seule forme répétée (des pentagones en fleur, des hexagones en moulinet, des pentagones du Caire, ou le « chapeau », qui pave sans jamais se répéter), à parois épaisses et bord roulé, et ne remplit qu'une partie de son cadre : il s'arrête sur une lisière de cire fraîche. Une onde descend de la barre du haut. Là où elle passe, les alvéoles se déforment toutes ensemble sans jamais laisser de jour entre elles, deviennent un instant des losanges, des carrés ou des triangles, puis reprennent leur dessin. À la fin de la boucle le rayon est le même, et chaque alvéole a pris la place de sa voisine.

![Un cadre en bois clair suspendu à deux tiges : un rayon de cire y pend de la barre du haut, pavé de « chapeaux », des alvéoles à 13 côtés qui ne dessinent aucun motif répété ; du miel ambré en haut, de la vieille cire au milieu (graine cw1gi9, humeur Cire vierge)](docs/capture.jpg)

Rendu physique en three.js (WebGPU, TSL). La scène est entièrement procédurale : une graine produit une scène. La démarche est dans [docs/concept.md](docs/concept.md).

## Utilisation

| Touche | Action |
| --- | --- |
| N | nouvelle scène (nouvelle graine) |
| Espace | pause / lecture |
| ← / → | avancer ou reculer dans la boucle |
| H | masquer l'interface |
| F | plein écran |

Sur écran tactile : une touche met en pause, deux touches tirent une nouvelle scène, un appui long masque l'interface.

Paramètres d'URL : `?seed=…` (une scène), `?mood=…`, `?family=…` (`moulinet`, `tourniquet`, `rosace`, `chapeau`), `?edges=…` (imposer l'humeur, la famille et les arêtes du rayon de devant), `#r=…` (une scène retouchée, produite par « Copier le lien »), `?ui=0` (sans panneau), `?mobile=1` / `?mobile=0` (version mobile imposée / interdite), `?debug` (outils dans `window.hive` : `shot(phase)`, `send(nom)`, `sheet(graines, phases)`, `film(u0, u1, n)`, `meter()`, `bench(phase, n)`, `seam()`).

Le panneau règle l'humeur et la famille (nouvelle scène de la même graine), la durée de la boucle et le retard de l'onde. Le dossier **Le rayon** règle la taille et la profondeur des alvéoles, la lisière, le niveau du miel, les couleurs de la cire selon son âge, des opercules et du miel, la translucidité et la diffusion. Viennent ensuite la caméra, la lumière et le rendu. L'export produit une boucle MP4 (H.264) rendue image par image, éventuellement accumulée, et une image PNG.

## Principe : un seul sommet libre, deux portes

**La liberté** (la seule chose impossible du film) : la cire ne fige jamais et les abeilles n'ont pas choisi l'hexagone. Le reste est traité au réel : un cadre sans cire gaufrée que les abeilles ont bâti à moitié, des parois jointives, l'aire de chaque alvéole constante (le miel ne monte ni ne déborde), des alvéoles inclinées, du miel creusé par la capillarité, des opercules, de la vieille cire au cœur et de la cire fraîche à la lisière.

### Le pavage

Le groupe de symétrie du pavage est fixe. Ses centres de rotation découpent le plan en triangles de deux sortes, images miroir l'une de l'autre : F et F*. Un point libre P, placé dans les triangles F, est relié aux trois coins de son triangle. Les alvéoles sont les polygones qui entourent les triangles F*. Toutes sont superposables, quelle que soit la position de P, et leur aire vaut exactement deux triangles.

| Famille | Groupe | Triangle | Alvéole (type de Heesch) | Pavages dégénérés aux coins |
| --- | --- | --- | --- | --- |
| **Moulinet** | p3 | (3, 3, 3) | hexagone C₃C₃C₃C₃C₃C₃ | losanges (cubes en perspective), trois orientations |
| **Tourniquet** | p4 | (2, 4, 4) | pentagone CC₄C₄C₄C₄ (pavage du Caire) | carrés, triangles rectangles isocèles |
| **Rosace** | p6 | (2, 3, 6) | pentagone CC₃C₃C₆C₆ (pavage en fleurons) | cerfs-volants, triangles équilatéraux, triangles isocèles à 120° |

Une quatrième famille n'a pas de groupe : le **chapeau**, la tuile apériodique à 13 côtés de Smith, Myers, Kaplan et Goodman-Strauss (2023), qui pave le plan sans jamais se répéter. Ses arêtes sont de deux sortes, a et b, et il se referme séparément sur chacune : en remplaçant a et b par deux nombres complexes, chaque sommet du pavage reste en A·a + B·b et le pavage reste un pavage. La boucle du chapeau est un lacet fermé dans le plan du rapport b/a (ln|b/a| = r₀ + Δr·cos 2πψ, arg(b/a) = Δφ·sin 2πψ) : l'aller et le retour ne passent pas par les mêmes formes. Dès que b/a n'est pas réel, une tuile retournée (une sur huit) n'est plus le reflet des autres : le pavage a deux formes, le chapeau et l'anti-chapeau. L'aire du chapeau varie alors de moins de 6 % et celle de l'anti-chapeau d'environ 20 % : dans cette famille le miel n'est pas conservé exactement, seule l'aire moyenne vaut 1.

Les arêtes des trois pavages de groupe ne sont pas droites : chaque rayon coin → P suit un profil (droit, en S, à crochet, double vague, à lobe, en dent), le même pour tous les rayons issus d'une même classe de centres. Les alvéoles restent superposables.

### Les portes et le relais

Quand P arrive sur un coin du triangle, toutes les jonctions se rassemblent sur les centres de cette classe : le pavage dégénère en un pavage classique. Ce pavage dégénéré est le même que l'on vienne de F ou de F* : P peut donc ressortir dans l'autre sorte de triangle. C'est une **porte**.

La boucle fait passer P par deux portes différentes : de la porte a à la porte b dans F, puis de b à a dans F*. Le pavage revient à lui-même, et l'alvéole que l'on suit a tourné autour du centre de la troisième classe, d'un angle 2π/k (k : ordre de ce centre). Elle est à la place de sa voisine : 60°, 90°, 120° ou 180° selon la famille et les portes. Le film ne rebrousse jamais chemin.

### La boucle

La phase locale d'un point x du rayon est ψ = u − r·w(x), où w croît de la barre du haut vers la lisière et r est le retard de l'onde (0,3 à 0,6 boucle). L'alvéole de l'instance g montre h^⌊ψ⌋·T(ψ − ⌊ψ⌋), transportée par g, où h est le relais. À u + 1, l'instance g montre ce que montrait g·h à u, et l'ensemble des alvéoles est le même. Le contenu (miel, opercule) se lit au centre de rotation du relais, commun à l'alvéole et à celle qui la remplace. La hauteur des parois et l'âge de la cire ne dépendent que de la position sur le rayon. L'image à u = 1 est donc l'image à u = 0 (`seam()` mesure 2·10⁻⁸ sur la pose).

P s'arrête à chaque porte (son temps est adouci par étape) : le rayon tient un instant sa forme de losanges ou de triangles.

### Le scénario

| u | Ce qu'on voit |
| --- | --- |
| 0 – 0,15 | plan d'ensemble : les trois cadres en échelon sur leur socle, chacun son motif |
| 0,15 – 0,45 | l'onde descend ; derrière elle les alvéoles ont changé de dessin ; la caméra s'approche du cadre de devant, de biais |
| 0,45 – 0,6 | gros plan : les alvéoles remplissent le cadre de l'image, le miel suit les parois et renvoie la fenêtre |
| 0,6 – 1 | la caméra recule en glissant ; le rayon retrouve son dessin, chaque alvéole à la place de sa voisine |

## Génération (`src/gen/`, dans des Web Workers)

**Le pavage** (`tiling.js`, module pur). Les faces de référence ont l'aire 1/2 (une alvéole a l'aire 1). `outline()` trace les six arêtes d'une alvéole autour d'une face F* : pour chaque côté, la jonction de la face voisine, puis deux rayons. `track()` suit l'alvéole à travers les portes : à la porte de classe a, elle vaut la face centrale réunie à la voisine opposée au coin a, et cette voisine devient la face centrale. Il en sort le relais h. `elements()` énumère le groupe dans un disque.

**Le chapeau** (`hat.js`, module pur). Le pavage vient de la substitution de l'article : quatre métatuiles H, T, P, F ; à chaque niveau, 29 métatuiles du niveau précédent s'assemblent en une pièce d'où l'on découpe les quatre suivantes. Une métatuile H contient 25, 169, 1 156 puis 7 921 chapeaux ; la scène prend le niveau 4. Les coefficients (A, B) de chaque tuile sont propagés d'arête en arête dans le graphe des sommets, et leur écart de fermeture (nul si le pavage est sans trou) est renvoyé avec eux.

**La cuisson** (`bake.js`). Pour l'alvéole suivie, à 48 instants par étape : le contour (96 points), le contour rentré d'une demi-épaisseur de paroi (chaque point glisse le long du gradient de la distance jusqu'à la ligne de niveau, ce qui arrondit les coins), le centre de gravité, et sur une grille de 96 × 96 la distance signée au contour et le champ de ménisque du miel. Un pavage se cuit en ~0,9 s sur une grille de 64² dans Node (mesuré), davantage en 96².

**Les rayons** (`lobes.js`). Un rayon pend de la barre du haut et occupe de 48 à 100 % de la hauteur de son cadre (74 à 92 % pour le cadre de devant). Son contour est une superellipse en U (exposants 3,4 à 6), à peine ondulée. Un atlas par rayon porte quatre champs : la distance au bord (les parois sont plus basses à la lisière, d'un tiers de leur hauteur au moins), le miel, les opercules, et l'âge de la cire (un cœur ancien au milieu, qui s'efface vers le bord). Une nervure centrale mince, juste derrière le fond des alvéoles, ferme le rayon (sauf celui du chapeau, dont le pavage se déforme en bloc : son contour est fait de chapeaux entiers).

**La recette** (`recipe.js`). Trois cadres, trois familles différentes, et toujours un chapeau parmi elles. Le cadre de devant porte la famille de la scène (le chapeau une fois sur cinq environ). Si le chapeau n'est pas devant, il prend l'un des deux cadres du fond et l'autre garde un pavage de groupe ; s'il est devant, le fond porte deux pavages de groupe. Chaque cadre a ses arêtes et ses portes. Le chemin de chaque pavage est vérifié à la génération : si l'alvéole cesse d'être un polygone simple à un instant de la boucle, l'amplitude des arêtes est réduite.

## Scène (`src/scene/`)

**Une alvéole, des instances** (`comb.js`). Le GPU ne reçoit qu'une alvéole par rayon, dans une texture (une rangée par instant). Chaque instance est son image par un élément du groupe. Le vertex shader lit le contour à la phase ψ du sommet et bâtit la paroi : face intérieure, bord roulé en quart de rond jusqu'à l'axe du mur. L'alvéole voisine fait l'autre moitié. Le fond, le miel et l'opercule sont un rectangle par alvéole, découpé au pixel par la distance signée. Les trois pavages sont empilés dans les mêmes textures : trois matériaux suffisent pour toutes les alvéoles.

- Tous les sommets d'une alvéole lisent la même étape du chemin que son centre : aux portes, les deux étapes décrivent la même forme sans numéroter ses points pareil.
- La position de l'image précédente (vecteurs de mouvement) est lue dans l'étape de l'image courante, et la phase précédente est déroulée au raccord.
- Le chapeau n'a pas d'isométrie fixe par instance : chaque tuile porte sa rotation, sa forme (chapeau ou anti-chapeau) et ses coefficients (A, B) ; le shader lit (a, b) avec le contour et place la tuile en A·a + B·b. Son rayon garde plus de marge dans le cadre, car le pavage se déforme en bloc pendant la boucle, et l'onde y est sans retard.
- Rien ne dépasse au-dessus de la barre du haut : les alvéoles y sont coupées net.
- Une alvéole existe ou non selon sa rosette : la distance au bord du rayon se lit au centre de rotation du relais. Le bord est donc fait d'alvéoles entières, toujours les mêmes, et la nervure dépasse un peu autour d'elles.

**Contenu par rosette** : l'état d'une alvéole (présente ou non, operculée, miel, vide) se lit au centre de rotation du relais, le point fixe de h (pour le chapeau, à la place de la tuile au début de la boucle). Les alvéoles qui tournent autour d'un même centre partagent donc leur état, et celui-ci ne change jamais. Un opercule est entier ou absent.

**Âge de la cire** : chaque rayon a un cœur ancien (brun, opaque, aux alvéoles sombres), de la cire dorée autour, et une lisière fraîche presque blanche et translucide. L'âge passe par une rampe à trois tons, réglée par humeur (`gold`, `old`, `zoning`).

**Cire** : bord roulé poli, flancs mats, fond des alvéoles très sombre (une alvéole est deux fois plus profonde que large). Deux termes de translucidité (`MeshSSSNodeMaterial`) : un terme directionnel, plus fort en haut des parois minces et à la lisière, nul dans la vieille cire ; et un terme ambiant (0,08) qui fait ressortir la lumière teintée par la cire, si bien que ses ombres ne sont jamais grises. Les grains s'effacent avant la fréquence du pixel.

**Miel** : une alvéole est plus étroite que la longueur capillaire, donc toute la surface est creusée. La hauteur vient d'un champ cuit avec l'alvéole : la somme, sur tout le contour, d'un noyau exponentiel de la distance (portée 0,11 alvéole). Ce champ est lisse partout, alors que la distance au contour fait un pli le long de l'axe médian (des facettes en étoile dans le reflet). La normale est son gradient, par différences centrées à 1,5 texel. Le miel renvoie la lampe comme une source étendue (Fresnel de Schlick, indice 1,49) : une tache nette par alvéole. Couleur par absorption : sombre au centre, claire contre la paroi.

**Opercules** : bombés (le champ du ménisque, pente inversée), plissés, par plaques plus sombres là où ils touchent le miel.

**Cadres et supports** (`stage.js`). Un cadre a une barre du haut à oreilles, deux montants et une barre du bas, en bois à arêtes arrondies. Chaque barre est taillée dans un tronc qui lui est propre, dont l'axe suit à peu près sa longueur et passe près d'elle : les cernes sont des cylindres autour de cet axe, inégaux, sinueux, bois de printemps clair et bois d'été sombre. S'y ajoutent des fibres étirées le long du fil, qui s'effacent avant le pixel, et des taches ambrées de cire et de propolis. Chaque oreille repose sur la coupelle d'une tige de métal, chaque tige a son pied sur un socle commun. Les deux cadres du fond sont tournés de quelques degrés vers le centre ; le rayon et son cadre subissent le même cisaillement, dans le shader des alvéoles comme dans la matrice du cadre.

**Décor et lumière** : un sol qui remonte en mur loin derrière (cyclorama), dont seul le sol reçoit les ombres. Trois lumières : une lampe parallèle chaude dont la carte d'ombres (4096²) est cadrée sur les cadres ; un remplissage froid sans ombre, du côté opposé ; un contre-jour qui traverse la cire. Plus un studio HDR calculé, faible. La profondeur de champ est coupée par défaut (elle n'a pas de zone franchement nette et adoucissait le rayon vu de biais) et le flou de mouvement est léger ; les deux se règlent dans le panneau.

**Caméra** (`core.js`) : un seul mouvement périodique, du plan d'ensemble (les trois cadres) au gros plan pris de biais sur la bande de miel du cadre de devant (à 2,5 à 3 unités, le rayon tient encore dans l'image), en échelle logarithmique, avec un glissement latéral ; par-dessus, la caméra tenue commune.

## Familles et humeurs (`src/recipe.js`)

Sept humeurs, chacune un fond, un bois, un métal, une lumière, une valeur et un miel :

- **Cire vierge** : cire ivoire, bois clair, laiton, fond gris clair, jour doux, miel ambré ;
- **Rasante** (d'après Albert Renger-Patzsch) : fond gris moyen, acier noirci, soleil dur presque dans le plan du rayon ;
- **Contre-jour** : fond clair, bois sombre, la lumière derrière les cadres ;
- **Nuit** : fond bleu nuit, acier clair, lumière froide de côté ;
- **Bruyère** : vieille cire brune, miel rouge, bois foncé ;
- **Tilleul** : cire jaune pâle, miel vert, soleil ;
- **Bleu** : cire blanche, bois blanchi, miel bleu, lumière frontale douce.

## Tests

```bash
node --test hive/test/*.test.mjs
```

29 tests. Le pavage : faces d'aire 1/2 et angles π/k ; aire de l'alvéole constante à 10⁻¹² près sur toute la boucle ; alvéole simple ; les images par le groupe pavent le plan sans jour ni recouvrement (160 points, 8 instants, 9 chemins) ; relais exact, d'ordre égal à celui du troisième centre, avec un témoin (sans relais, l'alvéole n'est pas revenue à sa place) ; continuité aux portes et au raccord ; vitesse nulle aux portes ; cuisson. Le chapeau : fermeture séparée en a et en b ; 25, 169 et 1 156 tuiles ; coefficients cohérents à 10⁻⁹ près ; pavage sans jour ni recouvrement au point d'origine et à huit instants du lacet (500 points), avec un témoin (l'anti-chapeau pris pour un simple reflet laisse des jours) ; lacet fermé et sans retour sur ses pas ; aire moyenne égale à 1 ; cuisson et instances. La recette : déterminisme, JSON, tout est tiré, un motif par cadre et trois familles, chemins valides, direction artistique (cire plus claire que le miel, fonds contrastés, lampes ≥ 5000 K, gros plan de biais).

## Performances mesurées

MacBook (Apple Silicon), Chrome, 1920 × 1080, qualité Haute, graine cw1gi9, 20 rendus enchaînés par mesure :

| Instant | Temps par image |
| --- | --- |
| plan d'ensemble (u = 0,03) | 9,5 ms |
| approche (u = 0,3) | 11,5 ms |
| gros plan (u = 0,5) | 12,3 ms |

Aucune pipeline n'est compilée après le chargement.

Répartition mesurée au gros plan : la scène elle-même ~8 ms, l'occlusion ambiante ~3 ms. Trois choix tiennent ce budget :

- **pas de reflets en espace écran** : la cire est mate et le miel a son propre reflet ; ils coûtaient 5 ms sans rien montrer ;
- **la pré-passe de l'occlusion en demi-définition**, comme l'occlusion elle-même ;
- **des rectangles serrés** : le rectangle du fond d'une alvéole couvre sa boîte à cet instant, cuite avec le contour, et non tout le chemin qu'elle parcourt ; et le champ de distance se lit en une fois par point, le filtrage de la texture interpolant entre deux instants.

## Version mobile

`?mobile=1` : contour à 60 points, 32 instants par étape, distance signée en 48 × 48, chaîne d'image allégée, résolution dynamique, 60 i/s plafonnés.

## Ce qui n'est pas fait ou pas vérifié

- La lecture fluide en direct n'a pas été jugée à l'écran : les vérifications sont des images fixes, des séquences d'images et des mesures.
- La version mobile se charge sans erreur ; aucune image n'en a été capturée, et elle n'a pas été essayée sur un téléphone.
- Le jour du relais (`src/day.js`) est inscrit mais n'a pas été comparé à la page (`tools/relay-check.html`).
- Aucun test ne vérifie que le rayon reste à l'intérieur de son cadre ni que les pièces du mobilier ne se traversent ; c'est tenu par construction (le rayon est plus étroit que le cadre) et vu sur les planches.
