# Kelp — revue cinéma (direction artistique et technical art)

Passe du 12 novembre 2026, à partir de la graine d'ouverture k39 (Couchant, cochayuyo), rendue en 1280 × 720 à dix instants de la boucle, et de trois humeurs de plus (Ploumanac'h / digitée, Étretat / palmier de mer, Midi / boa). Planche annotée : [revue-defauts.jpg](revue-defauts.jpg) ; le pire cas, Midi : [revue-midi.jpg](revue-midi.jpg). (Les erreurs WebGPU « texture size 0 » relevées pendant la passe viennent du panneau de navigateur masqué, un canevas de 0 × 0 : elles ne viennent pas du projet.)

## Verdict

Le cœur technique (Saint-Venant, XPBD, dôme, gouttes nées de la mer) est solide, mais **l'image se lit comme une maquette en plastique, pas comme une prise de vue**. Il y a trois causes :

1. **La matière des laminaires** : elles sont caramel, en tubes ouverts, avec des crampons clonés. Le concept lui-même demande un « brun chocolat presque noir, verni ».
2. **L'eau ne se lit pas comme de l'eau** au moment où elle compte : la vague n'a pas de volume, le dessous est un aplat sarcelle, l'écume ressemble à un filet.
3. **L'objectif est trop parfait** : la ligne d'eau, à 9 cm de l'objectif, est nette et en escalier ; les gouttes sont piquées comme des autocollants ; l'exposition est fixe, la caméra immobile. Une vraie image *over-under* tient précisément aux défauts du caisson.

---

## P0 — Les artefacts qui cassent l'illusion

Cette section liste des défauts **observés** sur les rendus. La cause donnée est un diagnostic sur lecture du code ; « probable » veut dire qu'elle reste à confirmer, par exemple avec une vue en fil de fer.

| # | Défaut (planche) | Où | Cause | Correction |
|---|---|---|---|---|
| 8 | **Grands triangles gris sous la ligne d'eau**, vus de dessous (k39 à 0,7) | `water.js`, `createSurface`, `pose` + `maskNode` | Probable : les sommets secs plongent à `rockAt − 0,3`. Au large, la grille grossit (×1,1 par maille au-delà de ±4,5 m), donc un même triangle relie un sommet mouillé à un sommet plongé. Le masque (`y > lvF − 0,01`) ne retire que ce qui est sous le niveau au pixel, et le haut des triangles passe. | Ne plus plonger les sommets : surface à `max(eta, rock − ε)` partout et `discard` au pixel là où la hauteur d'eau est < 4 mm, plutôt que sur la hauteur du sommet. Ou bien une grille fine sur toute la bande où court le front. |
| 5 | **Ligne d'eau en escalier**, avec un aplat sarcelle uni juste dessous (k39 à 0,2 ; Étretat à 0,75) | même maillage, vu par la tranche | Probable : les facettes de la grille lâche au loin, vues exactement de profil. | Même correction, plus le ménisque du dôme (voir P2) : dans un vrai caisson, cette ligne est floue de toute façon. |
| 6 | **Lames immergées en traits lumineux** jaunes, comme des néons (k39 à 0,2, à 0,4 et à 0,7) | `scene/kelp.js`, translucidité du `MeshSSSNodeMaterial` | Probable : le terme de transmission (`thicknessColor…`) ne passe pas par `receivedShadowNode`. Sous l'eau, il reçoit le soleil plein, sans l'atténuation de l'eau. | Multiplier `thicknessColorNode` par `W.sunAtten(positionWorld)`. Le liseré clair de *clearcoat* doit aussi tomber à 0 dans l'eau (c'est déjà le cas) : vérifier qu'il ne reste que la transmission. |
| 7 | **Flou de mouvement en copies distinctes** sur les lames proches (k39 à 0,2 et à 0,4 ; Étretat) | `post.js`, `blur` / `blurAt` | 10 prises régulières, avec un déplacement plafonné à 0,25 de l'écran : sur une lame à 20 cm, l'écart entre deux prises dépasse le pixel. | Décaler les prises par un bruit entrelacé (*interleaved gradient noise*) que l'anticrénelage temporel lisse, et plafonner la longueur à ~3 % de l'écran. Mieux : un flou par tuiles (vitesse max par tuile de 16 px). |
| 1 | **Le stipe est un tube ouvert** : un trou noir au sommet, et les lames qui partent du bord du cylindre | `gen/scene.js` / `strapGeometry` | La section circulaire du stipe n'est pas fermée et ne s'aplatit pas avant de devenir lame. | Fermer le bout, puis faire passer la section du cercle à l'ellipse sur les 2 à 3 derniers centimètres (le stipe s'aplatit en paume ou en « main ») avant la naissance des lames. |
| 2 | **Crampons clonés** en presse-agrume : rayons réguliers, tous identiques, alignés (toutes les familles) | `holdfastGeometry` | 14 tubes radiaux répartis à pas constant (`k/14`), même taille d'une plante à l'autre. | Des haptères ramifiés (2 à 3 bifurcations), en nombre et en longueur irréguliers, à moitié noyés dans la roche, des crampons qui se chevauchent, de la croûte rose et des balanes dessus. Taille × 0,6 à 1,5 selon l'âge. |
| 9 | **Lames rigides en poutres** horizontales dans l'air (k39 à 0,5, à 0,6 et à 0,9) | simulation `gen/kelp.js` | Mesuré à 0,5 : 10 nœuds à plus de 12 cm au-dessus de la roche **et** de l'eau, jusqu'à 26 cm. Une lanière de cochayuyo ne tient pas 1 m en porte-à-faux. Causes possibles : la raideur des lames (EI 0,007), le directeur figé, une lame posée sur une autre et prise pour un support. | Mesurer la flèche des lames à l'air dans `tools/coherence.mjs`. Pour une lame, la flexion à l'air doit céder sous son poids en moins d'une seconde. |
| 3 | **Flaque à bord droit**, avec une texture de roche étirée en stries (k39 à 0,1) | `fill` (inondation prioritaire) + carte de couleur | Probable : la flaque atteint le bord de la boîte de roche ou une diaclase rectiligne ; la carte vue de dessus s'étire sur la pente. | Interdire les flaques à moins de 0,5 m du bord de la boîte, et appliquer la couleur 3D des pentes au fond des flaques. |
| 10 | **Écume en filet** de Worley, en mailles blanches régulières (Étretat à 0,5), et **écailles** sous la surface (k39 à 0,7 et à 0,8) | `water.js`, `lace` | Bords de cellules d'épaisseur constante, à deux échelles seulement, blanc pur. | Seuiller un bruit (fbm) déformé par le courant au lieu des bords de Worley ; donner à l'écume une épaisseur (ombre portée sur l'eau) ; des bulles grosses et petites ; vue de dessous, la remplacer par un voile laiteux qui suit la couverture. |
| 11 | **Roche en pâte à modeler** : pas d'ombre propre sous un soleil rasant ; « granit en boules », « basalte en dalles » et « craie » ne se reconnaissent pas, le silex fait une tache ronde | `terrain.js` | `mesh.castShadow = false` : les bosses ne s'ombrent pas entre elles, il ne reste que l'occlusion ambiante. Le relief cuit fait 1,6 cm par texel : au premier plan (à 30 cm), c'est flou. | Faire porter des ombres à la roche (au moins dans la boîte de l'ombre du soleil) ; ajouter un relief de détail cuit à part (2 m × 2 m en 1024², soit 2 mm) devant l'objectif ; garder la couleur 3D des pentes partout où l'arête est raide. |
| 13 | **Midi (grès en gradins), la scène la plus abîmée** : des liserés bleu clair en zigzag le long des marches, et des pans verticaux étirés comme des rideaux (m3 à 0,15) | `water.js` (surface sur les marches) + `terrain.js` | Probable : même mécanisme que le n° 8, aggravé par les marches. Une pellicule d'eau de quelques millimètres reflète le ciel en aplat ; les pans sont la surface plongée sous la roche, vue à travers. | Corriger d'abord le n° 8, puis faire disparaître la pellicule (alpha → 0 sous ~5 mm) au lieu de la montrer en miroir. Tester systématiquement l'humeur Midi : c'est le pire cas. |
| 14 | **Boa en fermeture éclair** : la frange de lamelles se lit comme des dents régulières (m3 à 0,5 et à 0,75) | `scene/kelp.js`, `fringe` | Le peigne `sin(seg.z·520)` découpe des dents identiques et équidistantes. | Des lamelles de longueur et d'espacement irréguliers, avec quelques flotteurs (pneumatocystes) en relief plutôt qu'en masque. |
| 12 | Ombre du soleil limitée à ±3,5 m autour d'un point fixe | `stage.js` | La caméra d'ombre fait 7 m de côté : au-delà, les laminaires ne portent plus d'ombre. | Deux cascades (proche 3 m en 2048², lointaine 20 m). Une seule boîte décentrée vers la direction de visée suffit peut-être. |

---

## P1 — Rendu, lumière, matière

**Les laminaires**
- **Albédo** : `KELP_COLORS` est écrit en sRGB (`#6a5220`, lu par `THREE.Color`), d'où des lames caramel clair. Il faut viser un albédo linéaire de 0,02 à 0,05, brun olive presque noir. La lame se lit par son **reflet**, pas par sa couleur.
- **Spéculaire** : mouillée, une lame donne des filets de lumière le long de sa longueur. Il faut donc un spéculaire **anisotrope** orienté par la tangente T (`anisotropy` du `MeshPhysicalNodeMaterial`), rugosité 0,15 à 0,25 à l'air, plus une rugosité qui varie par plaques (mucilage, sable collé).
- **Translucidité** : seulement à contre-jour et seulement là où la lame est mince (pointes, marges), en ambre-olive. Aujourd'hui, toute la lame s'allume.
- **Stries** : `hStri` à 260 cycles par lame donne un aspect de tissu ou de velours côtelé (k39 à 0,1). Il faut les supprimer, ou les garder très basses et les estomper avec la distance. La nervure et les bulles du *Durvillaea* (tissu alvéolé) parlent davantage.
- **Variation** : chaque plante a un âge (taille × 0,5 à 1,5, pointes déchirées, trous, épiphytes) ; les plantes vivent en touffes serrées, crampons contre crampons. Aujourd'hui elles sont espacées en semis régulier, et le platier nu se voit entre elles : on dirait une plantation.

**L'eau, héroïne du film**
- **La vague ne se lit pas** : la face du ressaut est une paroi grise étirée (Ploumanac'h à 0,15). Il lui faut une **épaisseur** (lumière turquoise transmise à travers la crête quand le soleil est derrière, plus sombre au pied), de l'écume qui roule sur le front, et des **embruns** en particules au déferlement (quelques milliers de sprites, nés là où `sm.z` est fort).
- **Sous l'eau, un aplat sarcelle** : le milieu n'a pas de diffusion anisotrope vers le soleil, ni de rayons, ni de particules. Les correctifs, par ordre d'effet :
  1. une fonction de phase de Henyey-Greenstein (g ≈ 0,8) vers le soleil réfracté, qui éclaircit l'eau du côté du soleil ;
  2. des **rayons de lumière** sous la surface (marche de rayons courte, modulée par les caustiques de la surface, 16 pas sur ~2 m) ;
  3. des **particules en suspension** et des bulles près du dôme, floues, qui accrochent la lumière : c'est le signe le plus sûr qu'on est sous l'eau ;
  4. dans le ressac, une eau plus verte et plus trouble que bleue.
- **La fenêtre de Snell**, vue d'en dessous, doit être la zone la plus claire de l'image ; aujourd'hui elle est éteinte (k39 à 0,4 et à 0,7).

**Le ciel**, qui occupe 40 à 50 % du cadre à l'air : un dégradé sans structure. Il lui faut des nuages qui ont du volume au couchant (bords allumés, cirrus étirés), et le soleil avec un halo de diffusion de Mie plus large dans la brume d'embruns.

---

## P2 — L'optique et la caméra (ce qui fait « cinéma »)

- **Une profondeur de champ du dôme** : la ligne d'eau et les gouttes sont **sur le dôme**, à 9 cm. Avec une mise au point à 1 m, elles sont floues. C'est la signature des images de Doubilet : une ligne d'eau douce, épaisse, qui grossit un bandeau d'image, et des gouttes en taches de bokeh qui déforment ce qui est derrière. À faire :
  - flouter le voisinage du ménisque et des gouttes, en lisant l'image à plusieurs décalages ;
  - grossir ce qu'on voit dans le bandeau d'eau juste au-dessus de la ligne (la lame d'eau est une lentille cylindrique) ;
  - pas de contour noir net sur les gouttes, mais un bord sombre doux.
- **Une profondeur de champ de la scène** (désactivée aujourd'hui) : mise au point sur une plante héroïne à 0,6–1 m, ouverture modérée. Puis une **bascule de point** : à l'arrivée de la troisième vague, le point passe de la plante au front qui arrive, et revient. La bascule est périodique, donc compatible avec la boucle.
- **L'exposition qui s'adapte** : sous l'eau, l'image perd 2 à 3 diaphs. Un opérateur (ou l'exposition automatique) corrige en ~0,7 s, et c'est ce retard qui donne la sensation de plonger. Il suffit de précalculer la luminance par image de la boucle (sur une version basse résolution), puis de la filtrer de façon circulaire pour que la boucle reste parfaite.
- **Le caisson est frappé** : quand la troisième vague recouvre la caméra, rien ne bouge. Il faudrait un choc (2 à 4 cm, une oscillation amortie de ~0,6 s, un peu de roulis), entraîné par la force de l'eau sur le caisson. La simulation la connaît déjà : la vitesse de l'eau au dôme. On a ainsi une cause physique visible et une caméra qui « vit ». Hors des chocs, ajouter une micro-respiration d'opérateur (1 à 2 mm, bruit périodique).
- **Le cadrage** :
  - Aujourd'hui l'horizon est presque toujours au centre, et le premier plan (20 à 40 cm) est encombré de lames floues qui coupent le cadre (k39 à 0,2 et à 0,8).
  - Règle proposée : à l'air, horizon au tiers haut ; ligne d'eau au centre seulement pendant les moments *over-under* ; une plante héroïne sur un tiers, à 0,6–1 m ; rien à moins de 40 cm, sauf un élément de premier plan voulu.
  - Orienter le cap pour que **la vague soit visible quand elle se lève au large**, car l'anticipation fait le suspense. Aujourd'hui elle naît hors champ ou dans un coin.
- **Le dôme face au soleil** (Couchant) : ajouter des images fantômes du dôme, de petits disques colorés sur l'axe soleil-centre, plus utiles ici que les traînées anamorphiques.

---

## P3 — L'animation

- **Un mouvement secondaire** : dans le courant, une lame ondule (battement de la marge, ondes qui courent vers la pointe). `ruffle` est un sinus figé. Il faudrait le faire avancer dans le shader, avec une amplitude réglée sur la vitesse relative à l'eau (déjà connue de la simulation) et une phase périodique sur T.
- **La raideur apparente** : plus de nœuds par lame (`ds` de 9 cm → 5 cm pour le cochayuyo), sinon la Catmull-Rom entre des nœuds espacés donne des arcs trop réguliers.
- **Le rythme** : le crescendo en trois vagues est bon. Pour le marquer à l'image, ajouter une respiration avant la troisième (la mer qui se retire très loin, le silence) et un **temps mort** après (la forêt qui flotte, rien d'autre). Le flou de mouvement et le choc de caméra soulignent le pic ; l'exposition et la mise au point soulignent l'après.

## P4 — Le décor

Le platier est trop propre. Il manque de quoi donner l'échelle et la vie :
- des balanes, des patelles et des moules en colonies dans les fissures ;
- d'autres algues (fucus, *Chondrus*, croûte rose sur les arêtes basses) ;
- du sable mouillé dans les creux ;
- des débris de laminaires arrachées dans les flaques ;
- de l'écume qui reste en traînées sur la roche après le retrait.

---

## Ordre de travail proposé

1. **P0 n° 8, 13, 5, 6 et 7** : ce sont les défauts que tout spectateur voit en 5 secondes.
2. **P0 n° 1, 2 et 9** et **P1 albédo et spéculaire des lames** : la laminaire devient crédible.
3. **P2 ménisque et gouttes flous, profondeur de champ, exposition** : le « look » *over-under*.
4. **P1 eau** (épaisseur de la vague, rayons, particules), **P2 choc du caisson et cadrage**.
5. **P3, P4**.
