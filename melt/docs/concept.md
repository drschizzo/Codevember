# Melt — document de travail

Thème : **« melt »**. Sous-titre : *la refonte*.

## Historique

C'est la sixième version du concept. Les précédentes sont gardées pour la trace :
- **le flocon** qui fond en perles : l'historique git avant le 14 novembre ;
- **les pinacles** (`concept-pinacles.md`), **le fjord** (`concept-fjord.md`), **eau douce et bascule** (`concept-eau-douce.md`) ;
- **la colonne de glace** (`concept-colonne.md`), réalisée puis abandonnée : juste physiquement, mais « n'évoque rien » ;
- **le bain de bismuth** (`concept-bismuth.md`), réalisé puis abandonné le 18 novembre : « trop technique, pas assez esthétique ». Sur la planche de cinq graines, l'image était celle de cubes gigognes posés sur une grille, dans un vide gris, avec un tiers de la boucle sans sujet à l'écran.

**Ce que ces abandons ont appris.** On fait l'image d'abord, la physique ensuite. Et le sujet doit être la fonte elle-même, vue de près, pas un procédé dont la fonte est une étape.

## La piste retenue (proposée par l'utilisateur)

**Une mini-usine qui refond sans fin la même cire.** Un objet de cire fond sous une source de chaleur ; la cire coule dans un moule, d'où sort un autre objet, qui part fondre à son tour. La boucle se referme d'elle-même : fondre, couler, mouler, démouler, refondre.

**L'exigence qui porte tout le projet** (utilisateur) : la fonte doit être soignée. On ne doit pas avoir l'impression que l'objet « s'aplatit » : on doit voir des coulées, l'objet qui se déforme. D'où une vraie simulation de matière chauffée (`src/sim/mpm.js`), essayée seule avant toute machine (`proto/h0`), puis dans une première machine (`proto/h1`).

**Ce que l'utilisateur a retenu des essais** : les veines de la cire, qui se déforment avec l'écoulement. Elles sont devenues un élément de chaque cire (une masse et des veines).

**Écarté** : un sablier (l'objet fond en haut, le moule est en bas, on retourne). L'utilisateur voulait une machine « type mini-usine, avec des tapis roulants ».

**Demandé en cours de route** : chaque graine construit une usine différente.

## La machine

Un circuit vertical : une ligne haute et une ligne basse, reliées par deux ascenseurs (ou un ascenseur et une rampe). Deux plateaux y tournent. Un plateau est une cuvette en entonnoir percée d'une buse, qui porte une assiette sur trois colonnettes.

- **En haut**, sous la source de chaleur, l'objet fond sur son assiette. La cire tombe du bord de l'assiette dans la cuvette, tenue chaude, et sort par la buse.
- **En bas**, à l'aplomb, un moule est posé sur l'assiette de l'autre plateau. Le filet de cire y entre par son entonnoir.
- **Le moule s'ouvre comme un livre** : l'objet suivant est né. Les deux plateaux échangent leurs places ; le moule se lève, se referme, le barillet pivote et pose le moule de l'objet d'après.

**Le moule a la forme de l'objet** (demandé par l'utilisateur, à la place de cloches toutes pareilles) : une coque en deux moitiés qui suit la figurine, avec une bride au plan de joint et un entonnoir dans l'axe du filet. Les moitiés sont articulées sur une charnière, derrière l'objet, pour ne rien cacher à l'ouverture.

Un seul mât porte le barillet et la source de chaleur. Les pieds des lignes sont aux bouts seulement, parce que les moules balaient le milieu.

**L'allure.** Une première machine en caissons peints et montants noirs était « massive ». L'utilisateur l'a voulue plus élégante, avec des finitions soignées (chanfreins, raccords cohérents) : elle est faite de tubes fins, de bagues et de pieds tournés, comme un instrument de laboratoire.

**Les chariots.** Chaque ascenseur et la rampe ont le leur, à demeure : il attend, emporte le plateau, revient à vide. Un premier jet le faisait apparaître et disparaître avec le plateau, ce qui « cassait la magie » (utilisateur).

**La liberté (une seule) : le temps.** Une cire met des minutes à fondre et des heures à prendre ; ici la fonte dure vingt secondes et la prise quelques-unes.

## Variations (une graine = une usine)

| Axe | Valeurs |
| --- | --- |
| Lieu | atelier, laboratoire, équipe de nuit |
| Cire (masse et veines) | rose et ivoire, bleu canard et crème, miel et lait, sauge et craie, prune et abricot, réglisse et menthe |
| Source de chaleur | lampe infrarouge par le haut, rampe de brûleurs de biais, ceinture chauffante qui descend le long de l'objet |
| Circuit | deux ascenseurs, un ascenseur et une rampe |
| Objets (deux par boucle) | lapin, canard, ourson, chouette, quille |
| Proportions, sens du circuit, peinture, métal des pièces et des plateaux | tirés |

La source de chaleur change la façon de fondre : par le haut, les oreilles ploient d'abord ; de biais, un flanc coule avant l'autre ; la ceinture, elle, descend lentement et fait fondre l'objet tranche par tranche. (Une première ceinture fixe, à mi-hauteur, laissait le haut de l'objet suspendu : l'appui d'un morceau froid se soutenait lui-même.)

**La durée.** 25 secondes par objet, deux objets : une boucle de 50 secondes. Une première version à 34 secondes et jusqu'à trois objets était « un peu trop longue » (utilisateur).

## Ce qui reste à faire

Voir le README (« État »).
