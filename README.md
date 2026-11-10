# Codevember

Expériences de creative coding, publiées sur [drschizzo.github.io/Codevember](https://drschizzo.github.io/Codevember/).

## [Melt](melt/)

Le dégel d’une étoile. En macro, sur un gant de laine, un velours, une vitre ou une feuille de houx : une perle de glace dressée en pointe, d’où sort un hexagone qui pousse en étoile, en accéléré, dans l’air glacé (givre sur les fibres, poussière de diamant) ; le soleil sort, la surface se mouille et brille, les pointes s’arrondissent en perles qui remontent les branches en les avalant, et toute l’étoile se rassemble en une goutte au centre ; la goutte s’évapore, puis regèle de bas en haut et se dresse en pointe. Croissance par le modèle de Gravner et Griffeath (diffusion de la vapeur, attachement selon la courbure), fonte en perles qui conserve l’eau et suit les branches vers le centre, trois familles (l’étoile qui se rétracte, la plaque qui se resserre en collier, la colonne qui se rompt en chapelet de Plateau-Rayleigh), tricot rendu au niveau des fibres (modèle de fil procédural de Zhao et al., fibres de cœur de Wu et Yuksel), éclairage de Rheinberg calculé par la déviation des rayons, six décors, boucle parfaite exportable en MP4.

[Démo en ligne](https://drschizzo.github.io/Codevember/melt/) · [version légère](https://drschizzo.github.io/Codevember/melt/?mobile=1) · [documentation](melt/README.md) · [concept](melt/docs/concept.md)

[![Melt](melt/docs/capture.jpg)](https://drschizzo.github.io/Codevember/melt/)

## [Moss](moss/)

La reviviscence. Une année de mousse sur sa pierre, en accéléré : à la sécheresse, il n’en reste que des îlots bruns dans les fissures ; les averses passent en bandes, la roche fonce, les îlots reverdissent d’un coup ; pendant les pluies, la mousse se propage en coussins denses (un voile vert de protonéma, puis des dômes de rosettes serrées qui se rejoignent) ; la sécheresse la fait reculer dans ses refuges. Propagation de Fisher-KPP forcée par les saisons et intégrée jusqu’à son orbite périodique, coussins en dômes dont les tiges suivent la normale, roches (granit, calcaire, grès) et écorces procédurales cuites dans un worker et appliquées en déplacement et en normal map, lichens aréolés, quatre familles, six décors, boucle parfaite exportable en MP4.

[Démo en ligne](https://drschizzo.github.io/Codevember/moss/) · [version légère](https://drschizzo.github.io/Codevember/moss/?mobile=1) · [documentation](moss/README.md) · [concept](moss/docs/concept.md)

[![Moss](moss/docs/capture.jpg)](https://drschizzo.github.io/Codevember/moss/)

## [Tangle](tangle/)

Le tour de trop. Un banc d’essai de torsion, pièce de cabinet de physique : un moteur tourne le mandrin, la corde qui pend dessous se tord — sa rayure s’enroule en hélice — puis, au seuil de Greenhill, elle flambe d’un coup en une boucle qui s’enroule sur elle-même en torsade (un plectonème) et remonte le balancier. La came du compte-tours écarte la barre : le balancier, libéré, tourne, la torsade se déroule, la corde revient droite. Trois cycles en crescendo (la rayure seule, une boucle, la torsade), trois familles (le cordon qui se tord en torsade, la paire dont les brins se commettent en hélice, la spirale peu tendue qui se love d’un bout à l’autre). Tiges de Cosserat intégrées par XPBD à petits pas, contacts, enlacement conservé (Lk = Tw + Wr, vérifié par des tests), came calculée d’après le plan, sept décors, scènes procédurales à partir d’une graine, boucle parfaite exportable en MP4.

[Démo en ligne](https://drschizzo.github.io/Codevember/tangle/) · [version légère](https://drschizzo.github.io/Codevember/tangle/?mobile=1) · [documentation](tangle/README.md) · [concept](tangle/docs/concept.md)

[![Tangle](tangle/docs/capture.jpg)](https://drschizzo.github.io/Codevember/tangle/)

## [Fold](fold/)

La feuille qui se replie. Des plantes sensibles au toucher, dans leur pot, sous une cloche, dans une caisse de Ward ou sur une paillasse : une goutte grossit au toit de verre ou au bec d’une burette, tombe et frappe une feuille, et toute la feuille se ferme, la vague partant du point d’impact ; à la fin, un marteau de laboratoire frappe le pot et toute la plante se ferme, de bas en haut ; puis tout se rouvre en accéléré. Quatre familles, quatre plis : la sensitive ferme ses folioles en peigne et laisse tomber ses pétioles, le Biophytum les rabat vers le bas, le trèfle plie ses trois folioles en deux et les laisse retomber comme un parapluie, la dionée claque ses deux lobes ciliés. Propagation du signal sur le graphe vasculaire, pli rigide sans interpénétration vérifié par des tests, contact exact de chaque cause, limbes épais et translucides, sept décors, scènes procédurales à partir d’une graine, boucle parfaite exportable en MP4.

[Démo en ligne](https://drschizzo.github.io/Codevember/fold/) · [version légère](https://drschizzo.github.io/Codevember/fold/?mobile=1) · [documentation](fold/README.md) · [concept](fold/docs/concept.md)

[![Fold](fold/docs/capture.jpg)](https://drschizzo.github.io/Codevember/fold/)

## [Calcin](calcin/)

Le verre brisé, refondu, soufflé, brisé. D’un bain de verre en fusion monte une pièce de verrier (verre à pied, carafe à anse et bouchon, amphore, flacon…), côtelée, torse ou festonnée, parfois filigranée. Elle refroidit, puis une machine la brise : pendule à bille d’acier, haut-parleur, marteau de percussion, chalumeau. La scène est filmée en caméra rapide : les éclats tombent sous une gravité vraie, se couchent sur la sole, puis fondent en bain pour la pièce suivante. Fracture exacte dans une métrique propre à chaque déclencheur, physique analytique dans les shaders, sept décors (atelier et son four, stroboscope, laboratoire, plein soleil, lumière noire, cathédrale, givre), scènes procédurales à partir d’une graine, boucle parfaite exportable en MP4.

[Démo en ligne](https://drschizzo.github.io/Codevember/calcin/) · [version légère](https://drschizzo.github.io/Codevember/calcin/?mobile=1) · [documentation](calcin/README.md) · [concept](calcin/docs/concept.md)

[![Calcin](calcin/docs/capture.jpg)](https://drschizzo.github.io/Codevember/calcin/)

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

## [Orrery](planetaire_v2/) (Planétaire v2)

Un planétaire qui calcule des ciels qui n'existent pas encore. Chaque graine lance, sous les yeux, la recherche de chorégraphies du problème à N corps (N masses égales sur une même courbe, solutions exactes des équations de Newton), conçoit par le calcul les machines qui les tracent (trains d'engrenages aux rapports exacts, étages sans collision, galets dans des sillons gravés, quatre archétypes : horlogerie, planétaire classique, atelier, astrolabe) et la met en abîme : chaque astre est une boule de verre qui contient la même scène, où la caméra plonge sans fin, en boucle parfaite. Le mouvement qui fait tourner le plateau est visible et fonctionnel (barillet, rouage, échappement et balancier, ou machine à vapeur, volant, courroies et régulateur). Six humeurs, rendu physique (three.js WebGPU / TSL), export MP4.

[Démo en ligne](https://drschizzo.github.io/Codevember/planetaire_v2/) · [version légère](https://drschizzo.github.io/Codevember/planetaire_v2/?mobile=1) · [documentation](planetaire_v2/README.md)

## [Planétaire](planetaire/)

La vie d’un système planétaire, du nuage à la supernova, simulée sur GPU (WebGPU, three.js TSL) et présentée comme portée par un planétaire en laiton. Chaque grain de poussière conserve son rayon de naissance, qui détermine sa couleur ; le disque peut être sonifié comme un vinyle.

[Démo en ligne](https://drschizzo.github.io/Codevember/planetaire/) · [documentation](planetaire/README.md)

[![Planétaire](planetaire/docs/capture.jpg)](https://drschizzo.github.io/Codevember/planetaire/)

## Déploiement

Le site est publié par GitHub Actions (`.github/workflows/pages.yml`) à chaque push sur `main`.
