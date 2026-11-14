# P5 : voit-on le courant qui sculpte la glace ?

Le concept comptait montrer le sens de l'écoulement par les bulles libérées à la fonte : elles montent en eau froide, et descendent en eau chaude avant de remonter au large. P3 avait déjà écarté l'ombroscopie du panache en eau douce. P5 teste les bulles, puis un second traceur naturel : l'eau de fonte limpide dans un lac trouble.

## La méthode

1. **`flow.js`** : l'écoulement établi autour de la colonne suspendue, calculé avec le solveur de P0 (F = 20) à 3 °C (t = 100 s) et à 8 °C (t = 70 s). Vitesse maximale : 1,8 mm/s à 3 °C, 8,4 mm/s à 8 °C.
2. **`bubbles.js`** : 6 000 bulles libérées par la surface de la glace au cours des 30 dernières secondes, avec des rayons de 10 à 500 µm (loi en 1/r). Chaque bulle va à la vitesse de l'eau, plus sa vitesse de remontée (Stokes corrigée par Schiller-Naumann), et crève à la surface. On garde le trait parcouru pendant la pose d'une image du film : 1,25 s réelles en accéléré ×75, soit le flou de bougé de l'accéléré.
3. **Rendu** (`../p3/p3.js`) :
   - la colonne prend le profil simulé ;
   - les bulles sont tracées en traits additifs, avec l'énergie réfléchie par une bulle (réflexion totale sur 44 % de sa section) étalée sur le trait ;
   - pour le second traceur, la diffusion de l'eau trouble vaut σs(1 − c), où c = (T∞ − T)/T∞ est la fraction d'eau de fonte tirée du champ de température simulé (un mélange d'eau à 0 °C et d'eau du lac).

## Résultats

**La physique des bulles confirme l'idée** (vitesses propres : 0,3 mm/s à 15 µm, 2,1 mm/s à 40 µm, 11 mm/s à 100 µm, 56 mm/s à 300 µm) :
- à 3 °C, toutes les bulles montent ;
- à 8 °C, **73 % des bulles de 10 à 30 µm descendent** avec la couche limite, 9 % de celles de 30 à 60 µm, et aucune au-delà de 60 µm. Deux populations se croisent donc.

**Mais elles ne se voient pas** (`out/1-bulles-pose-reelle.jpg`). Avec la pose réelle :
- les petites bulles sont sous le pixel (0,1 à 0,3 px) ;
- les grosses filent si vite que leur lumière s'étale sur des centaines de pixels.

Rien n'apparaît.

**Même éclairées trente fois trop** (`out/2-bulles-gain-30.jpg`), elles restent prises dans la couche limite, à 1 ou 2 mm de la glace. Elles dessinent une pluie de traits plaqués sur la paroi, qu'on lit comme une texture de la glace. Le sens montant ou descendant ne se lit pas sur une image fixe.

**L'eau de fonte limpide dans un lac trouble ne se voit pas non plus** (`out/3-eau-trouble-et-ecart.jpg`).
- Entre le rendu avec la fraction d'eau de fonte et le rendu sans, l'écart est d'au plus 6 niveaux sur 255 (2 au 99,9ᵉ centile).
- L'eau de fonte reste une gaine de quelques millimètres, très diluée dès qu'elle quitte la paroi.

Un artefact de rendu a été trouvé et corrigé en chemin : le domaine simulé apparaissait en rectangle, parce que la couleur de la brume dépendait du découpage du rayon.

## Conclusion

**En eau douce, à l'échelle d'une colonne de quelques centimètres, le courant qui sculpte la glace est invisible.** Aucune des trois voies naturelles ne le montre : ni l'ombroscopie (P3), ni les bulles, ni la turbidité. La forme de la glace est la seule trace visible de l'écoulement.

Ce que cela change au concept :
1. Il faut retirer « les bulles changent de sens » comme moment lisible.
2. En eau douce, **la cause visible reste la température du lac**, rendue par la lumière et la saison. Le reste se lit dans la forme : aiguille, cône, col, détachement.
3. Seule **l'eau salée (famille Pagode, P4) montre l'eau de fonte** : les nappes d'intrusion s'y voient pour de vrai.
4. On pourrait tricher en grossissant les bulles ou en colorant l'eau de fonte. Ce serait une seconde liberté, que la règle du dépôt interdit.
