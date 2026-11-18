# Melt — document de travail

Thème : **« melt »**. Sous-titre : *le bain de bismuth*.

## Historique

C'est la cinquième version du concept. Les précédentes sont gardées pour la trace :
- **le flocon** qui fond en perles : l'historique git avant le 14 novembre ;
- **les pinacles** (`concept-pinacles.md`) ;
- **le fjord** (`concept-fjord.md`) ;
- **eau douce et bascule** (`concept-eau-douce.md`), puis **la colonne de glace** (`concept-colonne.md`), réalisée puis abandonnée : juste physiquement, mais « n'évoque rien », avec dix secondes de calcul pour une image pauvre.

**La leçon retenue** : on fait l'image d'abord, la physique ensuite. Cette version est partie d'un essai d'image (`proto/b0`), validé par l'utilisateur à chaque étape (cristaux, couleurs, fonte), avant toute construction.

## Le thème en largeur (ce qui a décidé du bismuth)

- **Le bismuth fond à 271 °C.** Refroidi lentement, il donne des **cristaux en trémie** : des cubes dont les faces sont creusées en escaliers, parce que les arêtes et les coins poussent plus vite que le milieu des faces. La diffusion y empêche mieux l'accumulation qui freine la croissance (Scientific Reports, 2023).
- **Ses couleurs viennent d'une couche mince d'oxyde** (Bi₂O₃, quelques dizaines à quelques centaines de nanomètres), qui fait interférer la lumière : or, magenta, bleu, vert. C'est la même physique que les couleurs de revenu de l'acier.
- **Le métal fondu est un miroir**, couvert d'une peau d'oxyde grise que l'on écume. Les cristaux refondus perdent leur peau.
- **Le bismuth solide est moins dense que le liquide** (il se dilate en gelant, comme l'eau).

## La piste retenue

**L'image.** Un bain de bismuth fondu, noir et lisse comme un miroir, dans une marmite de fonte posée sur un brûleur. Des trémies irisées en sortent sur la grille d'un panier et s'y reflètent, chaque cristal et son double formant une figure.

**La liberté (une seule) : les durées.** Le métal ne quitte jamais la marmite. On lève le panier pour récolter la grappe, puis on la replonge par crans dans le bain chauffé, et la fonte est calculée. La récolte et la fonte tiennent dans une boucle de 40 s.

**Le cycle** (`src/cycle.js`, une seule horloge, durée 40 s ; la boucle affichée commence à t = 0,26, grappe suspendue) :

| t | Ce qu'on voit | Cause | Loi |
| --- | --- | --- | --- |
| 0 – 0,01 | le miroir couvert d'une peau d'oxyde dorée ; la grappe a repoussé au fond | le bain refroidit | croissance en trémie |
| 0,01 – 0,20 | la grille déchire la peau et sort la grappe, le haut d'abord ; le métal neuf s'oxyde aussitôt | on lève le panier | oxyde en racine du temps passé à l'air |
| 0,20 – 0,32 | la grappe suspendue ; les couleurs mûrissent (or, magenta, bleu) | l'air chaud ; on allume le brûleur | couche mince d'Airy |
| 0,32 – 0,94 | **la fonte** : la grappe redescend par quatre crans et, immobile à chaque arrêt, fond à sa ligne de flottaison ; les parois minces et les arêtes d'abord ; une encoche se creuse, la partie haute bascule dans le bain, qui se ride | le brûleur chauffe le bain | problème de Stefan (simulé) |
| 0,94 – 1 | la grille vide regagne le fond ; les peaux d'oxyde des cristaux engloutis s'étalent et se défont ; le bain se couvre d'une nouvelle peau | on éteint le brûleur | |

Les paliers montrés s'arrêtent quand le dernier cristal a disparu sous le bain (`meltEndOf`) : une grappe qui fond vite occupe moins de crans, chacun plus long.

**La boucle se referme par construction.** À t = 0 et à t = 1, le bain couvre tout, et la grappe a repoussé sous le miroir. Un test vérifie, pour 200 graines, qu'aucun coin de cristal ne dépasse.

**Le regard** : la photographie de minéraux de musée. Un studio sombre, des boîtes de lumière, l'objet qui tranche sur le fond, et le reflet comme second sujet.

## Variations

| Axe | Valeurs |
| --- | --- |
| Humeur (le studio que le métal reflète) | Studio (dôme clair au zénith, fond noir), Forge (lueur orangée sous l'horizon), Tente claire (high key), Heure bleue |
| Port des cristaux | trémie, trémie en spirale, allongée |
| Gamme d'oxyde (vitesse d'oxydation) | or et magenta, arc-en-ciel, bleus et verts, presque argent |
| Grappe | grappe, druse dense, un grand cristal et ses satellites |
| Cadrage | plan large, au ras du bain, gros plan, plongée, le creuset sur le feu (vu du dehors, environ une graine sur sept) |

4 × 3 × 4 × 3 × 5 = 720 combinaisons, plus la graine de chaque grappe.

## Ce que les essais ont appris

- **Seule une planche de graines révèle certains défauts** (faces noires, bain vide pendant la fonte, caméra sous le métal) : aucune image isolée ne les montrait.
- **Une distance juste dans les gradins** : ignorer la paroi du gradin voisin fait traverser la marche et rend des faces noires piquées de points ; un rayon pris dans les gradins au dernier rebond doit voir le studio, pas le noir.
- **La fonte se calcule** (`proto/s0`, puis `src/melt/model.js` et `src/scene/melt.js`) : une fonte dessinée à la main (arrondi des gradins, affaissement tiré au hasard) ne tenait pas, et c'est le thème. On ne garde que l'instant τ où chaque cellule fond, rendu par φ = (u − τ)·v.
- **Le repère** : la chaleur se calcule dans le repère du cristal, où le bain monte ; montré ainsi, on voit « le sol qui monte ». L'image garde le bain fixe et fait descendre la grappe, ce qui donne le même champ τ.
- **Le critère d'appui** compare la section au ras du bain à la section d'origine à la même hauteur : une trémie creuse a une petite section à bien des hauteurs sans que rien n'ait fondu.
- **Le panache d'air chaud** reste tiède à la ligne (0,45 de la chaleur du bain) : plus chaud, les petits cristaux fondaient entiers dans l'air avant de descendre.
- **Les derniers restes** (une ou deux cellules d'épaisseur) fondent au même pas, d'une image à l'autre : sous 20 % du solide qui a été hors du bain, la simulation les fait s'effondrer dans le bain.
- **Les peaux d'oxyde** doivent rapetisser jusqu'à rien avant la fin de leur vie, sinon une grande plaque disparaît d'une image à l'autre ; l'écoulement du bain du centre vers les bords donne une cause à leur dérive.
- **Les arrêts de la grappe** : une descente continue se lit comme des cristaux qui coulent ; immobile, la grappe est rongée sous nos yeux. Vider le bain puis le remplir à la louche ne tenait pas (les cristaux refondus ne peuvent pas le faire remonter).

## Ce qui reste perfectible

- **Le tassement et l'effondrement** regardent le cristal entier, pas ses morceaux détachés un à un.
- **Les franges** des gradins latéraux, très régulières sur les grands cristaux, font parfois des peignes.
- **Les peaux d'oxyde** restent dessinées : la surface du bain n'est pas simulée (une simulation 2D en hauteur porterait la peau et les rides).
- **Non vérifié :** mobile, et autres GPU que celui de cette machine.
