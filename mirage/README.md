# Mirage

*l'objet qui n'est pas là.* Deux coupes d'argent poli posées l'une sur l'autre, celle du haut percée : c'est un mirascope. Ce qu'on met au fond flotte, net et en relief, dans l'ouverture. C'est une **image réelle**, faite de rayons qui se croisent dans le vide. Ici, ce qu'on met au fond est un autre mirascope, vingt fois plus petit, et au fond de celui-ci un plus petit encore.

Une coupe s'ouvre dans le couvercle, face à la caméra, comme sur une maquette de musée. C'est d'abord une fente, puis un éventail jusqu'au quart, aux tranches peintes en rouge, qui se referme ensuite. Tant qu'elle est ouverte, on voit dans le même cadre le vrai petit mirascope posé au fond et son image qui flotte au-dessus de l'ouverture : le même objet deux fois, dont un seul est là.

La boucle est un seul mouvement. Au départ, le couvercle est entier et un petit mirascope flotte. La coupe s'ouvre pendant que la caméra s'approche lentement. Puis la caméra plonge dans l'image, coupée elle aussi, avec le suivant au fond. Les coupes se referment et l'image emplit l'écran comme le grand au début : la boucle recommence, un niveau plus bas. La lumière ne change pas.

![Mirage](docs/capture.jpg)

Rendu physique en three.js (WebGPU, TSL), entièrement procédural : une graine produit une scène. Page technique : [explainer.html](explainer.html). La démarche est dans [docs/concept.md](docs/concept.md), avec ses versions abandonnées :
- un horizon au très long foyer (une Fata Morgana), juste mais illisible ;
- un cabinet de physique où la seconde apparence n'était qu'une déformation ;
- un mirascope à objets dont la boucle était trop simple ;
- une plongée en sept actes, trop compliquée ;
- une plongée seule, où l'on ne voyait plus que c'était un mirage ;
- une aiguille qui traversait l'image, juste mais muette ;
- un quart du couvercle ôté en permanence, qu'on ne comprenait pas.

Aucune image n'est peinte ou copiée. Chaque pixel suit son rayon entre les miroirs, d'un niveau de la chaîne à l'autre, et les mirascopes flottants sortent de la seule géométrie des rayons.

## Utilisation

| Touche | Action |
| --- | --- |
| N | nouvelle scène (nouvelle graine) |
| Espace | pause / lecture |
| ← / → | avancer ou reculer dans la boucle |
| H | masquer l'interface |
| F | plein écran |

Sur écran tactile : une touche met en pause, deux touches tirent une nouvelle scène, un appui long masque l'interface.

Paramètres d'URL : `?seed=…`, `#r=…` (scène retouchée, « Copier le lien »), `?ui=0`, `?mobile=1` / `?mobile=0`, `?debug` (outils dans `window.mirage` : `still(nom, phase, l, h)`, `film([[graine, phases]])` (une graine peut s’écrire `graine:pièce:décor du dôme`), `noSeam(true)` (chaque vue sans le morphing du raccord), `shot`, `send`, `meter()`, `bench()`, `seam()`, `run()` ; `stage.raytrace.U.debug.value = 1` colore chaque pixel selon ce que son rayon a touché, plus sombre à chaque niveau).

Le panneau règle le décor de la pièce, le décor du dôme et la durée d'un niveau, la finition des coupes et le projecteur, le balancement de la caméra et le rendu. Export MP4 image par image (éventuellement accumulé) et PNG.

## Principe : deux paraboloïdes, chaque sommet au foyer de l'autre

Chaque coupe est un miroir parabolique, qui renvoie vers un même point (son foyer) les rayons venus parallèlement à son axe. Origine au sommet de la coupe du bas, y vertical, distance focale f = 5 cm :

- coupe du bas : y = r²/4f, pour r ≤ R = √2·f ;
- coupe du haut : y = f − r²/4f, pour 0,42·f ≤ r ≤ R (l'ouverture).

Fermées, elles se rejoignent à leur bord (y = f/2) et chaque sommet est au foyer de l'autre. Un rayon parti d'un objet au fond se réfléchit sur la coupe du haut, puis sur celle du bas, et ressort par l'ouverture. L'image d'un point à la hauteur h se forme ainsi en y ≈ f + h, tournée d'un demi-tour autour de l'axe.

## La coupe

Le demi-angle de la coupe va de 0 à 45° (u de 0,06 à 0,16), reste ouvert, puis revient à 0 (u de 0,44 à 0,60). Elle est fermée au raccord. Par la coupe, on voit le petit au fond directement, sans miroir. L'image reste entière, car pour un observateur les rayons qui la forment se réfléchissent sur les coupes du côté opposé au sien. La coupe du bas reste entière : par l'entaille, on ne voit que l'intérieur, jamais la table, que le petit n'a pas.

Dans le tracé, une surface du couvercle (dedans, dehors, joncs, perles) n'est retenue que hors de l'entaille. Pour un paraboloïde, on garde la plus proche des deux racines qui convient. Pour un jonc et pour la couronne, le *sphere tracing* marche dans la forme privée du coin, si bien que les perles sont tranchées une à une à mesure que la coupe s'élargit. Les deux tranches sont des demi-plans verticaux par l'axe, gardés dans l'épaisseur du couvercle (2,5 mm). Elles et les tranches des joncs sont peintes en rouge, comme sur les écorchés des musées. (Un signe inversé dans la coupe des joncs gardait la partie ôtée et ôtait le reste : des trous sombres bordaient l'ouverture. Le tore coupé est max(d_tore, c), c positif dans la coupe, −1 couvercle entier.)

## La mise en abyme

`src/gen/abyme.js` (pur : tests, outils, chargement) et `src/scene/raytrace.js` (le même calcul en TSL).

- **Le petit** est le grand réduit de K = 0,05 : 7,6 mm de large, 4,2 mm de haut pied compris, posé au fond sur l'arête de sa base (à moins de 10 µm), **tourné d'un demi-tour**.
- **Un repère par niveau** : x_n = y_mini·ŷ + K·R_π·x_(n+1), et la direction tourne d'un demi-tour avec lui. Son image, tournée d'un demi-tour à son tour, a donc l'orientation du grand. La coupe de chaque niveau fait face à la même caméra, qui n'a pas à tourner (si elle tournait, à mi-chemin l'image se formerait par la coupe et s'éteindrait). Quand un rayon entre dans la sphère qui enveloppe le petit, il passe dans son repère et le même code recommence. Quand il en ressort sans s'y être réfléchi, il revient au parent. Le fond du parent, qui traverse cette sphère, est encore un paraboloïde dans le repère de l'enfant.
- **Par pixel**, à chaque pas : quatre paraboloïdes (dedans et dehors de chaque coupe), la table et le pied, deux tores en *sphere tracing* borné (les joncs du bord, la lèvre de l'ouverture), les deux tranches de la coupe, la couronne (tracée avec la lèvre, par répétition autour de l'axe), deux sphères (entrer, sortir). Dix-huit pas en tout.
- **Deux libertés** rendent la chaîne semblable à elle-même. La salle, la lampe et le projecteur sont les mêmes dans le repère de chaque niveau. Et un rayon qui ressort de la cavité d'un petit après s'y être réfléchi voit la salle, comme s'il sortait du grand.

### Le raccord : l'image diffère d'une copie réduite

La caméra C1, qui regarde l'image du petit, doit voir ce que voit au début la caméra P, qui regarde le grand. Or l'image d'un mirascope paraît plus profonde que large, et ce qu'on voit d'elle sous un angle vient de rayons partis sous un autre : vue à 50°, elle ressemble au petit vu à 46,5°. `tools/seamfit.mjs` trace les deux vues pixel à pixel (`traceNested`, couvercle écorché, salle allumée) et cherche P par Nelder–Mead. Avec le cadre qu'exige la coupe (le grand presque entier, l'image en haut, le petit au fond en bas) et couvercles fermés au raccord, il reste 6,9 % de pixels en désaccord (des contours et les coins du cadre) et 1,0 mm d'écart moyen (0,7° sur les reflets). Un **morphing** d'une seconde, juste après le raccord, les efface sans double image. Chaque pixel de la vue du grand vise d'abord le point que montrait la vue d'avant, puis retrouve sa direction. Ce point est le point touché relu un niveau plus haut ou, pour une image plus profonde, l'endroit où son rayon la traversait au-dessus de l'ouverture. Le raccord se fait en mouvement (plongée rapide). L'image du petit a subi deux réflexions de plus, et on la relève de ρ^(−2λ) à mesure qu'elle emplit l'écran.

### La plongée

Le niveau suit une courbe de Hermite monotone : vite au raccord (vitesse 1,6), lent pendant que la coupe est ouverte (0,3), vite de nouveau pour plonger, avec la même vitesse des deux côtés du raccord. La distance est géométrique en λ (×0,062 par niveau) et la visée converge au même rythme vers le point limite de la chaîne. Élévation et champ passent de P à C1 avec une dérivée nulle aux deux bouts. L'azimut se balance de 6 à 12°, une fois par niveau, et ce balancement est nul au raccord.

## Familles et décors

La famille est le **décor du dôme**, ce qui emplit le cadre et se répète d'un niveau à l'autre, avec sa bande et sa couronne :

| Famille | Dôme | Bande | Couronne |
| --- | --- | --- | --- |
| **Argent guilloché** | sillons de 50 µm qui font tourner les reflets (vagues, soleil ou grain d'orge) | émail translucide coulé sur la gravure, points d'or | perles à orient |
| **Cloisonné** | émaux vitreux (turquoise, cobalt, corail, ivoire), teinte inégale, fines bulles, creusés au milieu ; fils d'or en saillie | or | cabochons de deux pierres |
| **Laque et or** | urushi noir sous un vernis profond (un miroir sombre), paillettes d'or inclinées qui scintillent, filets, constellation | or | clous d'or |
| **Cuivre martelé** | cuvettes polies (Voronoï, hauteur au carré de la distance au coup), arêtes mates et oxydées | filet poli | rivets de cuivre |
| **Nacre** | tesselles inclinées, « flamme », irisation de couche mince, poli ; joints de résine | émail bordé d'or | perles noires |

**Les matières** suivent un même modèle (`shadePBR`) : base métal ou diélectrique, rugosité, normale perturbée par le relief, vernis facultatif. S'y ajoutent le reflet de la salle, floutée selon la rugosité et pondéré par Fresnel–Schlick, et le diffus de la salle entière (floue), de la lampe et du projecteur. Sous un vernis, la base diélectrique ne garde que son diffus. La rugosité varie en nuages (traces de doigts, usure). Joncs, lèvre et pied sont dans le métal de la famille.

Les gravures s'effacent quand un pixel couvre un sillon. La taille d'un pixel est prise à la distance de la visée et ramenée à l'échelle du niveau, puisque l'image est réelle et que les miroirs refocalisent.

| Décor | Pièce | Lampe | Finitions |
| --- | --- | --- | --- |
| **Cabinet** | boiseries chaudes, une fenêtre froide | 3 400 K | argent, vermeil |
| **Atelier d'horloger** | murs gris clair, deux tubes au plafond | 5 200 K | argent, étain, cuivre |
| **Salon de marbre** | pièce claire, deux hautes fenêtres | 5 600 K | argent, vermeil, cuivre |
| **Nuit** | presque noire, une fenêtre bleue, une lampe chaude | 4 200 K | argent, étain |

Un projecteur au-dessus de l'axe (3 000 à 3 600 K) tombe droit dans l'ouverture.

## Tests

```bash
node --test 'mirage/test/*.test.mjs'
```

- **Optique** : coupes jointes à leur bord, chaque sommet au foyer de l'autre ; image en f + h, au-dessus de l'ouverture, nette, tournée d'un demi-tour ; couvercle levé, l'image descend et perd ses rayons.
- **Abyme** : le petit repose au fond par l'arête de son pied ; il tient dans sa sphère, et elle dans la cavité sous l'ouverture ; il mesure moins de 11,5 mm ; vu par C1, son image couvre plus de 10 % du cadre et le niveau suivant s'y voit.
- **Coupe** : ouverte, pour chaque graine, le même cadre contient le vrai petit (sans miroir) et son image ; couvercle entier, le petit ne se voit pas directement ; fermée au raccord ; la caméra reste face à la coupe, à son balancement près.
- **Raccord** : moins de 9 % de pixels en désaccord, moins de 1,3 mm d'écart, moins de 1,2° sur les reflets entre C1 et P.
- **Chorégraphie** : distance géométrique ; λ croît sans retour, vite au raccord (même vitesse des deux côtés), lent coupe ouverte ; morphing plein juste après le raccord ; éclat raccordé ; regard sous 25°/s ; caméra jamais dans les coupes.
- **Recette** : déterministe, JSON pur, catalogue entier tiré, décors distincts, balancement d'un côté ou de l'autre.

## Performances mesurées

1920 × 1080, panneau de navigateur masqué (20 rendus d'affilée puis `onSubmittedWorkDone`) : ≈ 5,5 à 8 ms par image, ≈ 10 ms pendant la seconde du morphing (deux tracés ; cuivre martelé, le plus cher). Non vérifié : la fluidité en direct, un téléphone réel, l'export MP4.

## Version mobile

`?mobile=1` : douze pas au lieu de dix-huit, quatorze pas de *sphere tracing* pour les joncs au lieu de vingt-deux, studio de 512 × 256, chaîne d'image allégée (FXAA), résolution dynamique, cadence plafonnée à 60 i/s.
