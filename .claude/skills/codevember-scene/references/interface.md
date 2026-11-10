# Interface : sobre, complète, silencieuse

## Mise en page (`index.html`, `style.css` commun)

- Fond `#050506`, `color-scheme: dark`, canevas plein écran.
- **Titre** en bas à gauche : nom en Fraunces 300, 40 px ; sous-titre en Fraunces italique, couleur atténuée (`--dim`). **Indice clavier** en bas à droite, 11 px, opacité 0,7. Les deux disparaissent avec `body.clean` (touche H, appui long).
- **Panneau** lil-gui à droite, en verre dépoli (`backdrop-filter: blur(16px)`, fond `rgba(12,11,10,.62)`, liseré `rgba(255,240,220,.12)`, rayon 12 px, nombres en `#e9c48a`), 320 px, replié sauf l'essentiel ; sur téléphone, pleine largeur, 50 % de hauteur, replié au démarrage.
- **Toast** centré en haut (pilule de verre), messages brefs (« Pause », « Lien copié… »).
- **Progression d'export** en bas au centre.
- **Écran de chargement** : nom en Fraunces, une ligne en italique (« assemblage des cellules… », « génération des coquilles… », propre au thème), barre fine dorée de 180 px ; fondu de 1,2 s à la fin ; en cas d'échec, le message (et des issues) à la place de la ligne.

Aucun autre texte à l'écran. Les aides (légendes, encart explicatif) sont masquées par défaut, s'affichent à la demande (touche, case du panneau), sont mémorisées, et sont composées dans l'export quand elles sont affichées.

## Le panneau (`app/ui.js`)

Ordre : en tête **Graine** (champ), **⟳ Nouvelle scène (N)**, **Copier le lien de cette scène**, **Pause / lecture (espace)**, **Images / s** (désactivé : FPS · résolution dynamique · état des workers) ; puis **Export** ; puis la scène du général au particulier — humeur et boucle (durée), chorégraphie (durées des temps, décalages, anticipation, rebond, ralentis), caméra (champ, distance, balancement, roulis, caméra libre), un dossier par élément du thème (archétype, forme, chaque paramètre de génération, matériaux par face avec finition, motif, couleurs et curseurs du modèle physique, mouvement), lumière et fond (lampe, contre-jours, studio HDR, brume, cœur…) ; enfin **Rendu** (qualité, résolution, résolution dynamique, cadence maximale, anticrénelage, ombres, détail, micro-relief, douceur des reflets ; Image ; Bloom et objectif ; Occlusion et reflets ; Réglages par défaut).

- **Tout ce que tire la recette est réglable.** Les libellés sont en français, explicites, avec l'unité (« Durée (s) », « Tours sur l'axe / boucle ») ; les grandeurs entières (tours) ont un pas de 1.
- Une retouche d'aspect est immédiate (uniformes) ; une retouche de forme relance la génération de cet élément seul, l'ancienne version restant affichée jusqu'à l'arrivée de la nouvelle ; changer d'humeur tire une nouvelle scène de la même graine dans cette humeur ; « ⟳ Autre forme », « ⟳ Autres variations » retirent un seul aspect.
- Le panneau ne touche jamais à la scène : il modifie la recette (ou les réglages de rendu) et appelle un rappel `on.*`.
- Les réglages de rendu sont indépendants de la graine et mémorisés (`localStorage`, clé `<nom>.render.v1`, séparée pour le mobile). Les qualités : Mobile (recharge la page), Brouillon, Standard, Haute (défaut), Cinéma.

## Export (`app/capture.js`)

- **MP4 H.264** rendu image par image, hors temps réel (la phase avance exactement de 1 / (durée × cadence) par image : la vidéo boucle quelle que soit la vitesse du GPU), WebCodecs + mp4-muxer, profil High, niveau selon la taille ; amorçage de 12 images (historique TRAA) ; largeur 1280–3840, carré, vertical ; 24–60 i/s ; débit 8–120 Mb/s ; rendu accumulé 8–64 passes.
- **PNG** de l'image courante (éventuellement accumulée).
- Pendant l'export : lecture en pause, panneau inactif, barre de progression, puis retour à l'état précédent.

## Clavier et tactile

N, Espace, ← →, H, F partout ; touches propres au projet annoncées dans l'indice (S son, L légendes, A analogie). Sur écran tactile : une touche = pause, deux touches = nouvelle scène, appui long = masquer l'interface ; un toast l'explique une fois.

## Chargement

Voir performance-mobile.md (sans gel). La scène ne s'affiche que complète : toute la géométrie arrivée, les shaders de tous les moments compilés, quelques images rendues. Si le calcul est le sujet (Orrery), l'écran de chargement le montre en direct, dans un worker sur `OffscreenCanvas` (il reste fluide pendant que le fil principal compile), et se fond dans la première image.

## Son (facultatif)

Web Audio, coupé par défaut (touche S) : nappe de l'humeur dont le filtre respire avec la boucle, événement sonore à chaque temps fort, réverbération ; tout est fonction de la phase (Hollow `app/sound.js`).
