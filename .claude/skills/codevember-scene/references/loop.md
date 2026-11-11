# La boucle parfaite, la chorégraphie, la caméra

## L'invariant

`renderAt(u)` ne dépend que de la recette `R` et de la phase `u` (la partie fractionnaire est la phase de la boucle ; la partie entière, le nombre de boucles accomplies, ne sert qu'à garder l'identité des instances). Lecture, pas à pas (← →), export image par image, rendu accumulé, images fixes de mise au point : tout passe par lui. Conséquences :

- aucun état intégré d'une image à l'autre (pas de `x += v·dt`) ; une simulation est précalculée et relue (Membrane enregistre 160 images de sa simulation sur le GPU et les relit en Catmull-Rom) ;
- les particules tirent leur position d'un hachage de leur indice et du temps local (Orrery : poussières, fumée, braises, sans aucun tampon) ;
- l'exposition est fixe (pas d'auto-exposition adaptative) : sinon la boucle ne se referme pas ; le dosage de la lumière se fait dans la recette (voir rendering.md).

Vérifie le raccord : pose de la caméra et matrices de toutes les pièces identiques à u et à u + 1 (`seam()` en `?debug`, écart < 1e-6), et un test Node qui l'affirme sur la partie pure (cinématique, chorégraphie).

## Schémas de boucle

**1. Périodique pur.** Chaque mouvement est une fonction de 2π·k·u avec k entier : rotations d'un nombre entier de tours, oscillations de fréquence entière, polariseurs qui font un nombre entier de demi-tours (Membrane), objets exposés qui tournent d'un nombre entier de tours (Tesseract), dérive de caustiques par deux lectures du volume de bruit sur un cercle. Les tirages de la recette sont des **entiers** (`spin: rng.pick([1, -1, 2])`), et le panneau les règle par pas de 1.

**2. Plongée auto-similaire (Hollow, Membrane).** Une couche d'indice d à la profondeur relative x = d − τ a pour rayon D·kˣ ; la couche d utilise le modèle d mod N. La scène à τ + N est identique à la scène à τ. **Tout ne dépend que de x** : taille, orientation, éclairage, brouillard, niveau de détail, ombres, instant de l'éclosion. Une instance garde sa couche d'une boucle à l'autre (phase déroulée), M emplacements avec M multiple de N.

**3. Cycle de symétries (Tesseract).** Chaque étape applique une symétrie de l'objet ; la séquence est tirée pour que le produit soit l'identité, sans aller-retour ni état répété (recherche en profondeur parmi les mouvements). L'objet revient à son état initial après quelques étapes.

**4. Monde emboîté (Orrery).** Le monde subit la similitude x → (x − tr)/kˢ ; à s = 1, la couche suivante occupe exactement la place de la précédente (vérifié à 1e-14 près). Trois mondes, trois plongées, puis la boucle.

**5. Périodicité physique exacte (Orrery).** Une orbite périodique, trouvée par optimisation et certifiée, est parcourue un nombre entier de fois ; un repère tournant à ω = p/q reste périodique.

**6. Cycle de transformations.** La boucle enchaîne N états (formes, matières) ; l'état k se défait et sa matière (éclats, sable, fluide, particules) refait l'état k + 1 ; l'état N − 1 refait l'état 0. Chaque élément vit dans le temps local de son étape, ramené dans la boucle par `mod(t − k·T_étape, T)` ; une transition qui chevauche la fin de la boucle se lit donc sans couture si T > durée de vie d'un élément. Les transitions (particules) relient une pose calculée de l'état k à une pose calculée de l'état k + 1 : écris ces poses une fois, en JS et en TSL, et teste leur accord.

**7. Phases décalées (zootrope).** N copies d'un même cycle, chacune décalée de 1/N : la boucle est parfaite dès que le cycle l'est, et l'image montre toutes les étapes à la fois.

## Chorégraphie : des respirations qui retombent sur leurs pieds

Déformation du temps autour des temps forts t_k, sans changer la durée totale (Hollow, Orrery) :

τ(t) = t − Σ a·w·K((t − t_k)/w),  K(x) = x − 3x³ + 3x⁵ − x⁷

K' = (1 − 7x²)(1 − x²)² est d'intégrale nulle : la vitesse vaut 1 − a au passage, remonte à 1 + 0,65·a de part et d'autre, rejoint 1 sans à-coup en ±w, et τ(t_k) = t_k. a > 0 : ralenti ; a < 0 : accélération. Chaque passage a sa propre respiration (a, w tirés), le champ peut s'ouvrir un peu dans les ralentis (`kick`).

Mouvements d'objets : anticipation (on recule un peu avant de partir) et rebond (on dépasse un peu avant de se poser) ; allures variées (douce, franche avec dépassement, par crans, élastique : Membrane) ; pliages échelonnés (les feuilles de l'arbre d'abord : Tesseract) ; pauses entre les gestes. Une même loi de mouvement écrite **une fois** et reproduite à l'identique dans le JS (cinématique, tests), le vertex shader et la simulation.

## Temps physique et conventions de cinéma

Le temps du film n'est pas forcément le temps physique, mais leur rapport doit être celui d'une vraie caméra :
- **ralenti de caméra rapide** pour les événements brefs (une rupture dure quelques millisecondes : une caméra à 1 000 i/s rendue à 60 i/s ralentit ×16). La physique reste exacte dans le temps physique τ_p ; le film lit τ_p(t) = ∫ vitesse(t) dt, avec une vitesse qui descend à 1/k autour de l'événement puis remonte (« speed ramp »). La caméra, elle, peut continuer à bouger à vitesse normale (le temps suspendu) ;
- **accéléré** pour les processus lents (refroidissement, fonte, croissance), assumé comme tel ;
- jamais une « physique lente » (gravité réduite, objets qui flottent) : en ralenti, la gravité est vraie et les éclats tombent, lentement.
La vitesse et son intégrale s'écrivent en forme fermée (montée en smoothstep : ∫ = r·(u³ − u⁴/2)), en JS et en TSL.

## Cause et effet

- **Synchronisation à l'image près** : écris la cinématique des causes (outil, projectile, onde, flamme…) dans un module pur, avec le point de contact calculé sur la vraie géométrie (la surface de l'outil, pas son centre). L'effet commence à cet instant, et le temps physique (ralenti) s'applique à la cause comme à l'effet. Un test vérifie que l'écart est nul à l'instant de l'événement et positif avant.
- **Le ralenti commence au contact, pas avant** : si la vitesse du film descend avant l'événement, l'outil parcourt ses derniers millimètres au ralenti et semble toucher bien avant que l'effet parte. La cause arrive en temps réel (son élan se lit), le ralenti prend le relais dans les centièmes qui suivent.
- **Lisibilité** : montre l'action de la cause (son mouvement, sa montée en puissance, sa chaleur), oriente la scène pour qu'elle se lise de profil, et fais partir l'effet visiblement du point d'action (un front, une onde, une marque qui s'étend). Filme image par image une fenêtre de ± 0,5 s autour de chaque événement, et regarde-la.
- Une cause sans trace visible (un son, un champ, une chaleur) a besoin d'un relais crédible : la vibration de l'objet, la membrane qui bat, le point qui rougit, la poussière qui s'agite.

## Contacts entre éléments qui bougent

Quand des éléments voisins se frôlent (écailles, plumes, pétales, cartes, tuiles qui se recouvrent), les forces de contact locales — un point repoussé, une pièce qui se plie là où elle touche — donnent des mouvements par à-coups, des voisins qui bougent « sans raison » et de nouvelles traversées ailleurs. L'utilisateur les prend pour des bugs. Ce qui marche :

- **Bouger en bloc** : chaque élément garde sa forme et se déplace rigidement autour de son ancrage (pivot, soulèvement), du plus petit mouvement qui supprime la traversée, mesuré par le banc (verification.md). Une dichotomie sur l'amplitude suffit si le critère est monotone.
- **Une pose imposée d'avance ne peut pas éviter un recouvrement en écailles** (le bord qui doit finir dessous arrive par-dessus) : la pose se **résout** (l'objet descend jusqu'à toucher), puis on la rend **monotone** — f(u) = min(f_imposée(u), min sur u' ≥ u de f_permise(u')) : elle se pose et y reste, sans remonter.
- **Une seule solution par élément** : choisis une fois la direction d'écart (celle qui demande le moins à l'instant le plus contraint), puis cherche seulement l'amplitude ; mélanger d'un instant à l'autre deux solutions valides (tourner à gauche, basculer) donne en lissant une pose qui ne l'est pas.
- **Les dépendances par étages** : l'élément écarté soulève ceux qui sont posés sur lui (ordre mesuré au repos) et ne doit pas entrer dans ceux du dessous ; résous niveau par niveau, chacun sur les poses déjà lissées du précédent.
- **Le temps** : dilate (maximum glissant) avant de lisser (gaussienne), sinon le lissage repasse sous la contrainte ; lissage périodique pour que u = 1 soit u = 0. Les voisins s'écartent ainsi un peu avant le contact et se reposent en douceur.
- **Tout est calculé une fois**, dans un worker, sous l'écran de chargement (tables de poses sur 100–200 instants, interpolées à l'image) : quelques secondes de chargement de plus valent mieux qu'une seule traversée visible, tant que l'écran de chargement montre la progression réelle.

## Caméra

- Périodique en u, lisse, lente : pointes < 25°/s (Tesseract mesurait 80°/s avec des pointes à 220°/s avant lissage ; Fold tourne à ~10°/s). La grammaire (caméra immobile, travelling, plongée, révolution, suivi d'un objet…) se choisit pour chaque film. Lisser la pose par un noyau gaussien (σ de l'ordre d'une demi-seconde à une seconde) calculé sur la trajectoire échantillonnée elle-même (la boucle se referme, l'export rend la même chose), interpoler en Catmull-Rom, et tester l'accélération image par image à 120 i/s.
- Les obstacles (cloche, caisse, pot, table) : une distance minimale exacte, calculée sur la trajectoire échantillonnée (définie partout, donc continue), appliquée comme plancher par un maximum adouci ; jamais un recul par paliers image par image (Fold, c2p3j5 : la caméra sautait d'avant en arrière au bord de la cloche).
- Un azimut qui va d'une couche à l'autre choisit son sens **une fois** pour tout le trajet (choisi à chaque instant, il change de sens en route).
- Une cible qui grossit glisse d'abord vers le centre de l'image tant qu'elle est petite, puis y reste fixée (Orrery).
- Jamais de coupe franche ni d'insert : l'utilisateur les a refusés (« animation complètement erratique »). Une fois la caméra réglée et validée, **ne plus y toucher** sans demande ; vérifier par une signature de pose (somme des positions / quaternions / fov sur la boucle) qu'elle n'a pas bougé.
- **Pas de grands écarts de cadrage** entre deux plans (Fold, premier essai : du macro à 12 cm au plan large à 6 u en quelques secondes, azimuts qui sautent d'un événement à l'autre → « mouvements un peu erratiques ») : pas de saut de distance brutal (Fold : rapport ≤ 2,5 d'un plan à l'autre), pas de changement de sens erratique (Fold a choisi une lente révolution dans un seul sens ; d'autres grammaires conviennent si elles restent continues), des transitions de quelques secondes ; un test borne la vitesse angulaire de pointe et l'accélération.
- Caméra libre (OrbitControls) en option dans le panneau ; la caméra du film reprend quand on la décoche.

## Rien n'apparaît, rien ne disparaît, rien ne saute

- Une pièce naît cachée : derrière la caméra, dans le cœur lumineux qui la masque, au loin dans le brouillard, ou en fondu **tramé** (seuil aléatoire renouvelé à chaque image, lissé par le TRAA) — son ombre s'efface avec elle (`maskShadowNode`).
- Une géométrie ne change jamais à l'écran : tous les niveaux de détail d'une pièce arrivent ensemble et elle bascule d'un coup, sous l'écran de chargement ; les niveaux de détail affichés sont tous biseautés.
- Les ombres ne sautent pas : une lumière ne change jamais de côté par rapport à un objet (Hollow : la lampe frontale franchit les oculus avec la caméra) ; une pièce qui commence à porter ombre « pousse » dans la carte d'ombre.
- Une instance qui réapparaît a un vecteur vitesse nul à sa première image (sinon flou et TRAA produisent un éclair) ; un saut dans la boucle (← →, fin de boucle) ne compte pas comme un mouvement.
- La luminance moyenne mesurée sur toute une boucle varie sans marche.
- Les textes (légendes) ne changent jamais sur une image immobile.
