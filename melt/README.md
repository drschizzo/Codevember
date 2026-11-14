# Melt

*la colonne sans fin.* Une colonne de glace blanche et bulleuse pend sous la surface d'un lac de montagne. On la voit de dessous : la surface est un plafond d'argent, et la colonne s'y reflète. L'hiver, elle descend sans fin, et son bout s'arrondit. L'été, elle s'arrête, et l'eau l'amincit à la ligne d'eau jusqu'à ce qu'elle s'en détache. Le fuseau libéré bascule, au ralenti, et se couche contre son reflet. La brise l'emporte, et une colonne neuve traverse le miroir.

![Le fuseau libéré bascule contre son reflet, humeur Nuit (graine m91)](docs/capture.jpg)

Rendu en three.js (WebGPU), entièrement procédural : une graine produit une scène. La démarche est dans [docs/concept.md](docs/concept.md). Les neuf prototypes qui ont décidé du concept sont dans `proto/p0` à `proto/p8`, chacun avec son `RESULTS.md`. Les versions abandonnées sont `docs/concept-pinacles.md` (des festons que la simulation ne produit pas) et `docs/concept-fjord.md` (des nappes d'eau de fonte qu'on ne voit pas). La scène précédente, le flocon qui fond en perles, reste dans l'historique git.

## Utilisation

| Touche | Action |
| --- | --- |
| N | nouvelle scène (nouvelle graine) |
| Espace | pause / lecture |
| ← / → | avancer ou reculer dans la boucle |
| H | masquer l'interface |
| F | plein écran |

Sur écran tactile : une touche met en pause, deux touches tirent une nouvelle scène, un appui long masque l'interface.

Paramètres d'URL :
- `?seed=…` ;
- `#r=…` (scène retouchée, « Copier le lien ») ;
- `?ui=0` ;
- `?mobile=1` / `?mobile=0` ;
- `?debug` (outils dans `window.melt` : `shot(u)`, `send(nom)`, `sheet(graines, phases)` (une graine peut s'écrire `graine:humeur`), `meter()`, `bench()`, `seam()`), avec `&sink=port` pour le collecteur d'images.

Le panneau règle :
- l'humeur, la colonne et le lac (nouvelle simulation), la glace, la section du fût, la durée ;
- la bascule : l'inclinaison au détachement (nouvelle simulation), le sens, la brise ;
- la caméra ;
- le rendu.

Export MP4 image par image (éventuellement accumulé) et PNG.

## Principe

La boucle a une seule horloge (`src/timeline.js`).

**La saison.** La température du lac suit T∞(s) = ½(T₀ + T₁) − ½(T₁ − T₀) cos 2πs. La colonne avance pendant la saison froide et s'arrête l'été. La glace est recalculée à chaque instant par la simulation.

**Le film est un accéléré**, environ une heure de fonte en 48 s, sauf autour du détachement. Là, un plateau de ralenti ramène presque au temps réel : une seconde de film vaut environ 1,9 s physique. La phase de la simulation s(u) est l'intégrale de la vitesse du film v(u) = 1 − A·plateau(u), avec A = 0,982. Elle est normalisée pour que s(1) = 1. Le centre du plateau est cherché pour que le détachement tombe en son milieu. Le temps physique depuis le détachement, τ = (s − s_d)·P·11,5, pilote le fuseau.

**La boucle est parfaite par construction.** Toute la glace visible est neuve à chaque période, donc la simulation oublie son départ. Après deux périodes, l'écart d'une période à la suivante est de l'ordre du dixième de millimètre. Avant le détachement, le fuseau n'existe pas. Quand il sort du cadre, il est retiré. Les bulles de la glace sont fixes dans la matière et descendent avec elle. Leur motif est périodique sur l'avance d'une période (un nombre entier de cellules), donc à u = 1 il retombe sur lui-même.

| u (film) | Ce qu'on voit | Cause | Temps |
| --- | --- | --- | --- |
| 0 – 0,2 | l'hiver : une souche courte, au bout arrondi, descend du miroir | (la liberté : la colonne sans fin) | accéléré |
| 0,2 – 0,4 | la colonne s'allonge ; son bout reste arrondi | eau froide : la couche limite monte et ronge le bas | accéléré |
| 0,4 – 0,58 | l'été : la colonne s'arrête, s'effile, et s'amincit à la ligne d'eau | eau chaude : la couche limite descend depuis la surface | accéléré |
| ≈ 0,6 | **le détachement et la bascule** | gravité, poussée d'Archimède | ralenti, presque temps réel |
| 0,62 – 0,85 | le fuseau couché flotte, la brise l'emporte ; la colonne neuve traverse le miroir | la brise | accéléré |

## Génération

**La simulation du lac** (`src/gen/sim.js`, `src/gen/lake.js`, dans un worker).
- Navier-Stokes de Boussinesq en (r, z), avec l'équation d'état de l'eau douce ρ = ρ*[1 − β(T − 4)²] et β = 8·10⁻⁶ °C⁻².
- La glace est traitée par enthalpie, avec la condition de Stefan dans le bilan de chaque maille et une pénalisation de Brinkman.
- La pression est résolue par un V-cycle de multigrille par pas, avec une advection MUSCL.
- Le nombre de Stefan est gonflé ×20, ce qui donne une compression du temps de 11,5. Les pointes y sont insensibles, à 0,1 à 0,5 mm près (prototype P0).
- La grille est de 40 × 160 mailles de 1 mm, sur deux périodes de 400 s simulées. Le calcul prend environ 10 s, et l'écran de chargement le dessine.
- **L'avance** : la glace descend d'une rangée exacte chaque fois qu'elle a avancé d'une maille, sans diffusion numérique.
- **Le lac** : au-delà de a + 8 mm, l'eau est rappelée vers T∞.
- **Le détachement** : la glace qui n'est plus reliée à la surface est retirée, et son profil est relevé pour la bascule.

La simulation a été validée contre Weady, Tong, Zidovska et Ristroph (*PRL* 128, 044502, 2022). Elle donne une pointe vers le bas à 3,5 °C et un cône dressé à 8 °C, et le retrait suit la loi de couche limite en h^(−1/4).

**La bascule** (`src/gen/body.js`). C'est un corps rigide dans le plan de basculement, plus la dérive :
- la poussée d'Archimède est exacte par tranches : chaque disque est coupé par le plan d'eau, et le centre de poussée est le centroïde du segment immergé ;
- la masse et l'inertie ajoutées, la traînée par tranche et l'amortissement par les vagues rayonnées sont pris en compte ;
- le contact avec la souche est modélisé.

Un fuseau élancé se couche avec 8,3 % de son volume émergé (1 − ρ_glace/ρ_eau). Un bloc trapu (D/L > 0,78) reste debout.

**Les colonnes et les lacs** sont des réglages éprouvés (`src/recipe.js`). Chacun donne un détachement par période et moins de 20 % de boucle sans sujet :

| Colonne | Rayon | Lac |
| --- | --- | --- |
| moyenne | 1,4 cm | 1,5 → 9 °C |
| fine | 1,0 cm | 1,5 → 9 °C |
| large | 2,0 cm | 2 → 10 °C |
| moyenne, lac chaud | 1,4 cm | 3 → 11 °C |

Un lac froid (1 → 7 °C) ne détache jamais la colonne, et il est écarté.

**Ce qui n'est pas sorti de la physique** : le concept prévoyait trois familles de bascule (chavirer, pencher, flotter debout). Les fuseaux simulés ont tous un D/L entre 0,08 et 0,26, et ils chavirent tous.

## Rendu

L'image est un **lancer de rayons**, en shader de calcul WebGPU (`src/scene/tracer.js`). Il écrit l'image HDR dans une texture three.js, et la chaîne d'image commune (`shared/render/post.js` : bloom, halation, étalonnage, grain, SMAA) passe ensuite dessus.

Une matière à transmission de three.js ne sait pas rendre de la glace dans l'eau. Ce qui la fait voir pour de vrai est calculé :
- la réfraction d'indice relatif 0,982 ;
- la réflexion totale aux incidences rasantes (un liseré) ;
- la diffusion dans la glace bulleuse : environ 0,5 cm⁻¹, éclairée le long de la corde vers chaque lumière, avec un cœur plus dense. Le prototype P3 a montré que la glace claire est invisible dans l'eau ;
- les chapelets de bulles ;
- le bleu de la glace épaisse.

La surface vue de dessous est la **fenêtre de Snell** (48,6° de demi-angle). Au-delà, c'est un miroir de réflexion totale : chaque forme a son double. Les rides de la bascule et de la brise y sont calculées.

Le profil de la colonne est celui de la simulation, interpolé entre deux relevés, sans jamais mélanger les relevés de part et d'autre du détachement. Le fuseau a le profil relevé au détachement, et garde la matière (les bulles) qu'il avait dans la colonne.

**Les humeurs** sont une eau et une lumière, chacune avec son cadrage :

| Humeur | Image |
| --- | --- |
| Nuit (d'après Sugimoto) | une forme et son double dans le noir, une boîte douce de côté |
| Contre-jour | la colonne en silhouette lumineuse sur une grande boîte à lumière, et son reflet |
| Fenêtre de Snell | vue d'en dessous, la colonne qui sort d'un disque de ciel cerné d'un miroir |
| Lait glaciaire | une forme qui se perd dans une eau turquoise et laiteuse |
| Tourbe | une eau ambrée, des rayons de soleil bas |
| Bassin de pierre | un mur de calcaire, des caustiques de soleil |

La lumière suit la saison : le soleil et le ciel s'ouvrent l'été.

## Ce qui n'est pas montré, et pourquoi

L'eau qui sculpte la glace ne se voit pas à cette échelle.
- En eau douce, l'ombroscopie ne la montre pas (l'indice ne varie que de 2,6·10⁻⁶ par °C, P3).
- Les bulles libérées ne la montrent pas non plus : sous le pixel, ou prises dans la couche limite (P5).
- La turbidité ne la montre pas.
- En eau salée, les nappes d'eau de fonte restent invisibles en lumière naturelle (P7).

Le film montre donc la forme, qui est la trace de l'écoulement, et la saison, qui en est la cause.

## Tests

```bash
node --test melt/test/*.test.mjs
```

Les tests vérifient :
- la recette (déterministe, JSON, toutes les humeurs, colonnes et glaces tirées) ;
- l'horloge : s(0) = 0, s(1) = 1, monotone, détachement au milieu du ralenti, à moins de 2,5 % de la vitesse moyenne ;
- la flottaison : un fuseau couché à 8,3 % émergé, un bloc trapu debout ;
- la dérive, qui part sans à-coup ;
- le lac : un détachement par période pendant l'arrêt, un raccord de moins de 2,5 mm, un état du film identique à u = 0 et u = 1, aucun mélange de relevés au détachement ;
- la caméra, périodique et lente.

## Performances

- **La simulation** : environ 0,5 ms par pas à 1 mm en Node, environ 24 000 pas, soit environ 10 s par scène dans un worker. Le résultat est mis en cache pour la même recette.
- **Le rendu** : environ 3 ms par image en 1280 × 800, mesurées dans le panneau de navigateur de l'application, panneau masqué. Ce n'est pas vérifié sur un écran visible ni sur mobile.

## Version mobile

Imposée par `?mobile=1`, ou choisie d'office sur téléphone. Le lancer de rayons tourne en demi-résolution, avec la résolution dynamique et une cadence plafonnée à 60 i/s. La simulation est la même. Elle n'a pas été vérifiée sur un appareil réel.
