# Mirage

*l'objet qui n'est pas là.* Deux coupes d'argent poli posées l'une sur l'autre ; celle du haut est percée. Au fond, une toupie, une montre de poche, une bougie chauffe-plat, une boussole ou une pile de pièces d'or. On la voit posée dans l'ouverture, en relief, nette : la toupie y tourne, la montre y donne l'heure, la flamme y brûle, l'aiguille y montre le sud. Mais l'objet est au fond, 5 cm plus bas, et ce qu'on voit est une **image réelle**, faite de rayons qui se croisent dans le vide. Une machine soulève le couvercle — crémaillère, trois vis ou poulies : l'image s'enfonce dans la cavité et s'éteint, la caméra descend regarder par le jour entre les coupes et découvre l'objet là où il était. Le couvercle redescend, l'image revient.

![Mirage](docs/capture.jpg)

Rendu physique en three.js (WebGPU, TSL), entièrement procédural : une graine produit une scène. Page technique : [explainer.html](explainer.html). La démarche est dans [docs/concept.md](docs/concept.md), avec ses deux concepts abandonnés : un horizon au très long foyer (une Fata Morgana au soleil de minuit), juste mais illisible, puis un cabinet de physique (une cuve de sirop, une plaque chauffée) où un milieu stratifié complétait une demi-figure — plus lisible, mais la seconde apparence n'était qu'une déformation. Le mirascope tient le thème au pied de la lettre : **on voit un objet, il n'est pas là** ; la cause est un appareil qu'on voit, et le geste qui la révèle est simple — lever le couvercle.

**Rien n'est dessiné qui ressemble à une image.** Chaque pixel suit son rayon entre les deux miroirs ; l'objet flottant sort de la géométrie des rayons, et disparaît de lui-même quand ils s'échappent.

## Utilisation

| Touche | Action |
| --- | --- |
| N | nouvelle scène (nouvelle graine) |
| Espace | pause / lecture |
| ← / → | avancer ou reculer dans la boucle |
| H | masquer l'interface |
| F | plein écran |

Sur écran tactile : une touche met en pause, deux touches tirent une nouvelle scène, un appui long masque l'interface.

Paramètres d'URL : `?seed=…`, `#r=…` (scène retouchée, « Copier le lien »), `?ui=0`, `?mobile=1` / `?mobile=0`, `?debug` (outils dans `window.mirage` : `still(nom, phase, l, h)`, `film([[graine, phases]])` — une graine peut s'écrire `graine:décor:objet` —, `shot`, `send`, `meter()`, `bench()`, `seam()`, `run()` ; `stage.raytrace.U.debug.value = 1` colore chaque pixel selon ce que son rayon a touché).

Le panneau règle l'objet, le décor et la machinerie, la durée ; **le mirascope** (finition des coupes, levée du couvercle, tours de la toupie ou heure de la montre) ; le cadrage ; le rendu. Export MP4 image par image (éventuellement accumulé) et PNG.

## Principe : deux paraboloïdes, chaque sommet au foyer de l'autre

Origine au sommet de la coupe du bas, y vertical, f = 5 cm, L la levée du couvercle :

- coupe du bas : y = r²/4f, pour r ≤ R = √2·f ;
- coupe du haut : y = f + L − r²/4f, pour 0,42·f ≤ r ≤ R (l'ouverture).

Fermées, elles se rejoignent à leur bord (y = f/2) et chaque sommet est au foyer de l'autre. Un point de l'objet, près du sommet du bas, est près du foyer du haut : ses rayons, réfléchis par la coupe du haut, redescendent presque parallèles à l'axe ; la coupe du bas les renvoie vers son foyer — dans l'ouverture. **L'image d'un point à la hauteur h se forme en y ≈ f + h, tournée d'un demi-tour autour de l'axe** ((x, z) → (−x, −z)) : la montre flotte avec son heure décalée de six heures, comme sur un vrai mirascope.

Couvercle levé, le sommet du haut quitte le foyer du bas : l'image descend (54 → 31 mm pour L de 0 à 3 cm) et surtout perd ses rayons (1 299 sur 2 000 fermé, 140 à 2 cm), qui s'échappent par le jour entre les coupes. On n'efface rien : l'image s'éteint parce qu'il n'y a plus de lumière pour la former.

| Objet | Ce qui flotte | Construction |
| --- | --- | --- |
| **Toupie** | une toupie laquée qui tourne en l'air, un peu penchée, sa spirale peinte qui file | pointe d'acier au sommet de la coupe, cône, bourrelet à filets d'or, dôme, tige et bouton de buis |
| **Montre** | le cadran bleu nuit guilloché en soleil, index et aiguilles dorés, chemin de fer ; la petite seconde fait deux tours par boucle | boîtier bombé, lunette moletée, couronne, bélière couchée ; posé sur l'arête de son fond |
| **Chauffe-plat** | une flamme qui brûle dans le vide, au-dessus de l'ouverture | godet d'aluminium cannelé, cire colorée, mèche ; la flamme vacille à des fréquences entières de la boucle |
| **Boussole** | l'aiguille, qui dans l'image montre le **sud** (le demi-tour) ; elle oscille à chaque à-coup du couvercle, et s'amortit | boîtier de laiton, rose des vents à huit pointes, couronne de degrés, pivot, aiguille rouge et acier bleui, anneau |
| **Pièces d'or** | un petit trésor qu'on ne peut pas prendre | quatre pièces décalées, posées à plat l'une sur l'autre : grènetis, filet, perles, soleil rayonnant, tranche cannelée |

**Aucun objet ne dépasse 11,5 mm.** L'image d'un point à la hauteur h flotte en f + h ; vu de 40 à 47° au-dessus de l'horizontale, un point au-delà de ~14 mm ne se voit plus dans l'image — les rayons qui y mèneraient manquent l'ouverture. Une première toupie de 2 cm avait ainsi la tige coupée dans son image : c'est ce que fait un vrai mirascope (ses objets sont des miniatures), mais à l'écran cela se lit comme un défaut. Les objets ont été redessinés plus bas, et un test vérifie qu'ils se voient en entier.

### La machinerie

| Mécanisme | Socle | Ce qui lève le couvercle | Ce qui tourne |
| --- | --- | --- | --- |
| **Crémaillère** | pied de bois tourné, planche de noyer vissée | une potence de laiton porte une crémaillère ; le pignon, monté sur le coulisseau, roule dessus ; le bras à fourche pince le jonc du couvercle | le pignon et sa manivelle, de L/r |
| **Trois vis** | socle de marbre mouluré, colonnette de laiton | trois tiges filetées autour des coupes, entraînées ensemble par une chaîne sur trois pignons au ras du marbre ; un collier pris dans trois écrous embrasse le couvercle | les tiges, de 2π·L/pas (pas de 2 mm : quinze tours), la manivelle au sommet de la première |
| **Poulies** | trépied de laiton à pieds galbés | un mât porte une flèche et une araignée de trois poulies au-dessus de l'axe ; trois cordes montent du bord du couvercle, se réunissent au moyeu et descendent le long du mât jusqu'à un treuil | le tambour, de L/r ; les cordes raccourcissent de L |

La machinerie se place derrière la coupe, de côté, selon le regard de la caméra ; un test vérifie qu'aucune colonne, barre ou corde ne passe entre l'œil et l'image, pour toutes les graines et toute la boucle. Les coupes portent leur ombre par des doublures invisibles (elles ne sont pas des maillages : le quad les trace) ; un plan posé sur la table ne garde que les ombres.

### Le tracé

`src/gen/mirascope.js` (pur, pour les tests, les outils et le chargement) et `src/scene/raytrace.js` (le même calcul en TSL) :

- **Intersection rayon–paraboloïde** : un second degré en t, A = a(d_x² + d_z²), B = 2a(o_x d_x + o_z d_z) − d_y, C = a(o_x² + o_z²) + b − o_y ; forme stable q = −½(B + sgn B·√Δ), t₁ = q/A, t₂ = C/q (sinon, pour un rayon presque vertical, la racine utile se perd dans l'arrondi). Normale par le gradient (2ax, −1, 2az).
- **L'image d'un point** (`imageOf`) : 400 à 2 000 rayons en spirale de Fibonacci sur l'hémisphère ; on garde ceux qui sortent par l'ouverture après exactement deux réflexions, et l'on cherche le point le plus proche de toutes ces droites, (Σ I − d dᵀ) X = Σ (I − d dᵀ) p.
- **Le rendu** : un quad plein écran. Chaque pixel part de l'œil et teste cinq surfaces analytiques — intérieur et extérieur de chaque coupe (une coque de 2,5 mm), la table. Sur l'argent intérieur, il se réfléchit et repart (neuf rebonds au plus) ; sur l'extérieur guilloché, il lit le studio flouté selon la rugosité ; sur la table, sa matière et l'ombre douce de l'appareil. Dans la sphère qui contient l'objet, il avance par *sphere tracing* dans une SDF de révolution (les profils de `src/gen/profiles.js`). La flamme est une émission intégrée le long de chaque segment de rayon, au point le plus proche de son cœur.
- **La machinerie** (`src/scene/machine.js`, cotes dans `src/gen/layout.js`) est faite d'objets ordinaires dessinés par-dessus, avec les joncs polis des coupes et la lèvre de l'ouverture ; boîtes aux arêtes arrondies et cylindres chanfreinés (une arête vive n'accroche pas la lumière), laiton brossé, bois verni. Le quad écrit la profondeur de son premier impact : tout s'emboîte.

### Posés, pas flottants

Un objet à fond plat dans une coupe concave ne touche pas le fond au centre : il repose sur l'arête de son pied, à la hauteur r²/4f du fond à ce rayon. Le godet (r = 9,3 mm) est donc 0,43 mm au-dessus du sommet, le boîtier de la montre (r = 11,8 mm) 0,70 mm, la boussole (r = 10,5 mm) 0,55 mm, la première pièce (r = 9 mm) 0,41 mm, les autres à plat sur elle ; la pointe de la toupie est au sommet.

### L'horloge et la boucle

Une seule horloge (`src/timeline.js`), une boucle de 20 s : fermé (0–0,22), levée (0,22–0,38), ouvert (0,38–0,58), retombée (0,58–0,74), fermé. La caméra tourne lentement autour de la coupe, plonge pendant que le couvercle est levé (de 38–46° à 14–19° d'élévation) et remonte quand il redescend ; chaque temps est une marche douce, monotone. La toupie fait 24, 30 ou 36 tours par boucle, la trotteuse deux, la flamme vacille à des fréquences entières ; l'aiguille de la boussole oscille après chaque à-coup du couvercle (départ, arrivée, départ, retombée), dans une fenêtre bornée, et est exactement au repos au raccord : **la boucle est parfaite par construction** (raccord mesuré : 10⁻⁹).

## Les décors

Un miroir ne montre que ce qui l'entoure : chaque décor est une pièce, pas un fond noir.

| Décor | Pièce | Table | Lampe | Valeur | Finitions |
| --- | --- | --- | --- | --- | --- |
| **Cabinet** | boiseries chaudes, une fenêtre froide | noyer en lames | 3 400 K, de côté | sombre et chaude | argent, vermeil |
| **Atelier d'horloger** | murs gris clair, deux tubes au plafond | chêne en lames aboutées, cernes en flammes, rayé | 5 200 K | moyenne | argent, étain, cuivre |
| **Salon de marbre** | pièce claire, deux hautes fenêtres | marbre veiné, poli | 5 600 K | claire | argent, vermeil, cuivre |
| **Nuit** | presque noire, une fenêtre bleue, une lampe chaude | feutre vert | 4 200 K, faible | très sombre | argent, étain |

Cinq objets × trois machineries × quatre décors × quatre finitions.

## Tests

```bash
node --test 'mirage/test/*.test.mjs'
```

Les coupes se rejoignent à leur bord, chaque sommet au foyer de l'autre ; un rayon parallèle à l'axe repasse par le foyer ; l'image d'un point en f + h, au-dessus de l'ouverture, nette ; demi-tour autour de l'axe ; couvercle levé, l'image descend à chaque cran et garde moins de 15 % de ses rayons pour chaque graine ; un rayon de l'œil visé sur l'image rencontre l'objet après deux réflexions ; les objets reposent exactement sur le fond (aucun sommet ni arête dessous, contact à moins de 10 µm ; pièces à plat l'une sur l'autre ; couronne, bélière et anneau loin du fond) ; aucun ne dépasse 11,5 mm, tout est dans la sphère englobante, et l'image d'un point à 11,5 mm se voit (à 20 mm, non) ; l'aiguille de la boussole au repos au raccord, amortie après chaque à-coup ; boucle refermée (levée, plongée, caméra, objets) ; temps monotones, la caméra ne plonge que couvercle levé ; caméra jamais sous la table ni dans les coupes ; aucune colonne, barre ni corde de la machinerie entre l'œil et l'image ; recette déterministe, JSON pur, catalogue entier tiré (objets, décors, finitions, machineries), décors distincts.

## Performances mesurées

1920 × 1080, panneau de navigateur masqué (20 rendus d'affilée puis `onSubmittedWorkDone`) : **≈ 2,3 à 4,8 ms par image** selon la scène — montre et crémaillère ≈ 2,6 ms, boussole et poulies ≈ 2,3 ms, pièces d'or et trois vis ≈ 4,8 ms (les quatre pièces font une SDF plus chère, et les tiges filetées beaucoup de triangles). Au chargement : le studio HDR (≈ 0,17 s, calculé une fois par décor). Raccord de la boucle (`seam`) : 10⁻⁹. Non vérifié : la fluidité en direct, un téléphone réel, l'export MP4.

## Version mobile

`?mobile=1` : six rebonds au lieu de neuf, 40 pas de sphere tracing au lieu de 64, studio de 512 × 256, chaîne d'image allégée (FXAA), résolution dynamique, cadence plafonnée à 60 i/s.
