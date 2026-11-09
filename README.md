# Codevember

Expériences de creative coding, publiées sur [drschizzo.github.io/Codevember](https://drschizzo.github.io/Codevember/).

## [Membrane](membrane/)

L’éclosion sans fin : un solide géométrique dort dans une membrane translucide et vascularisée. Son armature se déploie (sépales, lames, mâchoires, baleines, épingles, polyèdre), tend la membrane jusqu’à la déchirure, simulée et non animée à la main : lèvres qui s’enroulent, filaments qui claquent, lambeaux qui se retroussent. La caméra plonge vers l’œuf suivant. Diffusion sous la surface, scènes procédurales à partir d’une graine, matériaux physiques (three.js WebGPU / TSL), boucle parfaite exportable en MP4.

[Démo en ligne](https://drschizzo.github.io/Codevember/membrane/) · [version légère](https://drschizzo.github.io/Codevember/membrane/?mobile=1) (appareils peu puissants : téléphones, tablettes, portables modestes) · [documentation](membrane/README.md)

[![Membrane](membrane/docs/capture.jpg)](https://drschizzo.github.io/Codevember/membrane/)

## [Tesseract](tesseract/)

Le cabinet replié : un écrin de huit cubes posé à plat en patron se replie dans une quatrième direction pour former un hypercube. Puis la caméra y entre : l’œil 4D se pose sur l’hypersphère, le cube du centre devient une pièce, et chaque rotation 4D devient un voyage d’une pièce à la suivante, à travers des parois qui s’ajourent, jusqu’à revenir au point de départ. Scènes procédurales à partir d’une graine, matériaux physiques (three.js WebGPU / TSL), boucle parfaite exportable en MP4, et des aides pour suivre le pliage : fantôme de la forme pliée, liserés des faces appariées, profondeur 4D en couleur, analogie 3D.

[Démo en ligne](https://drschizzo.github.io/Codevember/tesseract/) · [version légère](https://drschizzo.github.io/Codevember/tesseract/?mobile=1) (appareils peu puissants : téléphones, tablettes, portables modestes) · [documentation](tesseract/README.md)

[![Tesseract](tesseract/docs/capture.jpg)](https://drschizzo.github.io/Codevember/tesseract/)

## [Hollow](hollow/)

Une plongée sans fond : des coquilles creuses emboîtées — alvéoles, fentes, surfaces minimales, géode — générées de façon procédurale à partir d’une graine, rendues en matériaux physiques (three.js WebGPU / TSL) et animées en boucle parfaite, exportable en MP4.

[Démo en ligne](https://drschizzo.github.io/Codevember/hollow/) · [version légère](https://drschizzo.github.io/Codevember/hollow/?mobile=1) (appareils peu puissants : téléphones, tablettes, portables modestes) · [documentation](hollow/README.md)

[![Hollow](hollow/docs/capture.jpg)](https://drschizzo.github.io/Codevember/hollow/)

## [Chorégraphies](planetaire_v2/) (Planétaire v2)

Un planétaire qui calcule des ciels qui n'existent pas encore. Chaque graine lance, sous les yeux, la recherche d'une chorégraphie du problème à N corps : N masses égales qui se poursuivent sur une même courbe, solution exacte des équations de Newton, souvent inédite. La machine qui la trace est conçue par le calcul (trains d'engrenages aux rapports exacts, dents calées, étages sans collision, étoile sur galets dans des sillons gravés) ; le plateau tourne à une vitesse rationnelle, d'où une boucle parfaite. Ralentis rythmés sur les passages serrés, plans de caméra, six humeurs, trois montures (three.js WebGPU / TSL), export MP4.

[Démo en ligne](https://drschizzo.github.io/Codevember/planetaire_v2/) · [version légère](https://drschizzo.github.io/Codevember/planetaire_v2/?mobile=1) · [documentation](planetaire_v2/README.md)

## [Planétaire](planetaire/)

La vie d’un système planétaire, du nuage à la supernova, simulée sur GPU (WebGPU, three.js TSL) et présentée comme portée par un planétaire en laiton. Chaque grain de poussière conserve son rayon de naissance, qui détermine sa couleur ; le disque peut être sonifié comme un vinyle.

[Démo en ligne](https://drschizzo.github.io/Codevember/planetaire/) · [documentation](planetaire/README.md)

[![Planétaire](planetaire/docs/capture.jpg)](https://drschizzo.github.io/Codevember/planetaire/)

## Déploiement

Le site est publié par GitHub Actions (`.github/workflows/pages.yml`) à chaque push sur `main`.
