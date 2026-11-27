# Silencio

*No hay banda.* Ton journal de films et de séries, tes listes et tes statistiques, sur ton PC et ton téléphone,
partagés avec tes amis.

## Ce que fait Silencio

- **Journal** : ajoute un visionnage en deux secondes (bouton **+**, ou touche **n** sur PC). Note de 1 à 10 en touchant une case ; deux appuis rapides = le demi-point en dessous (sur PC : 8 puis « . » = 7,5).
  - La note est sur 10, au demi-point : clique sur la moitié gauche d'une étoile pour un demi-point.
  - Tu peux aussi préciser la date, le coup de cœur et s'il s'agit d'un revisionnage (détecté tout seul).
  - « Plus de détails » : où tu l'as vu (cinéma avec salle et prix du billet, plateforme ou support), avec qui, la version, ta critique (privée si tu veux), des notes détaillées, et l'option « film caché ».
- **Page d'un film ou d'une série** :
  - les notes : la tienne, IMDb, TMDB, celles de tes amis, et un lien vers Letterboxd ;
  - où le regarder en France, le casting et l'équipe (cliquables), les détails et les mots-clés ;
  - la saga et des titres « dans le même esprit » ;
  - ton journal pour ce titre, tes citations, tes étiquettes et ta collection (Blu-ray, 4K…) ;
  - pour les séries : les épisodes à cocher, une note par saison et sa courbe, et le prochain épisode à voir.
- **Page d'une personne** :
  - sa filmographie avec ce que tu as vu (longs, courts, documentaires et séries comptés à part) ;
  - la courbe de tes notes au fil de sa carrière ;
  - ton propre classement de ses films, à réordonner en glissant ;
  - ses prix (Wikidata) et ses collaborateurs fréquents ;
  - un bouton pour la mettre en favori.
- **Stats** :
  - les chiffres, la distribution de tes notes, l'évolution de ta sévérité face à IMDb, ton rythme ;
  - les personnes les plus vues, tes chouchous et tes bêtes noires (avec le filtre « filmographie complète vue », par format) ;
  - genres, radar de tes goûts, décennies, carte du monde, langues, durées, mots-clés, studios, budget et recettes ;
  - tes découvertes, tes revisionnages, ta compatibilité avec chaque ami, la complétion des filmographies et des palmarès (Palme d'or, Oscars…) ;
  - tes séances de cinéma, et avec qui tu regardes le plus ;
  - « Ton année » et « Ton mois ».
- **Labo** :
  - **Courbes par personne** : jusqu'à 6 réalisateurs ou acteurs sur la même courbe, avec IMDb en pointillé.
  - **Constructeur libre** : n'importe quelle mesure selon n'importe quel axe, en courbe, barres, radar ou carte.
  - **Nuage de points** : ta note contre IMDb, contre la durée, contre le budget…
  - **Comparaison** : avec les profils de tes amis.
  - **Épinglage** : un graphique épinglé s'affiche sur la page Stats et sur l'accueil.
- **Listes** :
  - tes listes, classées ou non, privées ou épinglées dans le menu ;
  - la watchlist ;
  - « Vu en 2026 », qui se remplit toute seule et que tu peux corriger ;
  - la watchlist commune (intersection des profils choisis).
- **Découvrir** :
  - recommandations d'après tes meilleures notes ;
  - « Ce soir entre amis » ;
  - un explorateur (genre, pays, décennie, plateforme…) ;
  - les sorties de tes favoris ;
  - les palmarès ;
  - un tirage au sort.
- **Notifications** : un film de ta watchlist arrive sur une plateforme, une personne favorite sort un film, et le récap de ton mois. Sur Android, ce sont de vraies notifications pendant que l'application tourne.
- **Fluidité** :
  - les affiches de tes films sont gardées sur l'appareil, et tout marche hors ligne ;
  - transitions douces ;
  - dans les listes, **glisser à droite** = vu, **glisser à gauche** = watchlist ;
  - **Annuler** après chaque action (touche **z**), plus l'historique des versions sur GitHub.
- **Raccourcis clavier** : `n` ajouter, `/` recherche, `1`…`0` puis `.` pour la note (7 puis . = 7,5), `Entrée` valider, `h` `j` `s` accueil, journal, stats, `z` annuler.

## Synchronisation

| Service | Ce que fait Silencio |
|---|---|
| **TMDB** | Lecture de toutes les infos, et **écriture** sur ton compte : notes, watchlist, coups de cœur, listes de films. Les modifications attendent le retour du réseau. |
| **Letterboxd** | Par l'extension Firefox **Silencio Sync** (PC et téléphone), avec ta session : journal (diary : ajout, modification, suppression d'une entrée), notes, coups de cœur, watchlist. Rien d'autre n'est jamais retiré. Import de ton export .zip possible. |
| **IMDb** | Par la même extension : notes, watchlist Silencio vers ta watchlist IMDb, listes ; critiques publiques à coller à la main. Jamais de retrait. Par défaut, chaque envoi se fait d'un clic dans la fenêtre de l'extension (IMDb n'autorise pas les robots sans accord écrit). Notes IMDb publiques lues dans les fichiers d'IMDb. |
| **Refract** | Par son **API officielle** (clé personnelle rfk_…) : films vus, épisodes, watchlist et notes, tout seul, quelques secondes après chaque ajout. Seuls tes ajouts faits après la liaison partent ; si Refract demande de ralentir, Silencio attend et reprend tout seul. |
| **Twin Picks** | Import des notes d'un profil Twin Picks (fichier profils.json). |
| **Amis** | Par un dépôt GitHub : chacun écrit son profil avec son propre compte et lit ceux des autres. |

## Compte

Un compte, c'est un **identifiant** et un **mot de passe**. Le mot de passe n'est enregistré nulle part : il sert à
chiffrer la partie privée de ton profil sur GitHub (films cachés, critiques privées) et les réglages du compte (pseudos
Letterboxd et IMDb, clé Refract, jeton GitHub). Un appareil reste connecté jusqu'à « Se déconnecter » (Réglages, Compte).
Sur un nouvel appareil : **Se connecter**, et tout revient. Un nouveau compte n'a aucun lien avec les tiens.

Un profil d'avant les comptes devient un compte dans Réglages, Compte : même identifiant, mêmes films.

Tes **films cachés** et **critiques privées** ne sont jamais lisibles par tes amis.

## Installation

### 1. Les deux dépôts GitHub (une seule fois)

1. **Le code** : un dépôt **public** `silencio` (le téléphone y télécharge les mises à jour).
   - Mets-y ce dossier, puis :

     ```
     git init && git add . && git commit -m "Silencio" && git branch -M main
     git remote add origin https://github.com/TON_COMPTE/silencio.git && git push -u origin main
     ```

   - Mets aussi `TON_COMPTE/silencio` dans `depot.json`.
   - GitHub Actions construit alors l'APK (onglet *Actions*) et le publie dans *Releases* : `silencio.apk`.
2. **Les profils** : un dépôt **privé** `silencio-profils`, créé avec « Add a README ».
   - Dans *Settings → Collaborators*, invite tes amis.
3. **Un jeton par personne** : chaque ami crée son jeton sur github.com → *Settings → Developer settings → Fine-grained tokens*.
   - Dépôt : `silencio-profils`.
   - Permission : *Contents : Read and write*.

### 2. Sur le téléphone

Télécharge `silencio.apk` (Releases du dépôt), ouvre-le et autorise l'installation. Au premier lancement :
**Se connecter** avec ton identifiant et ton mot de passe (ou **Créer un compte**).
L'application se met à jour toute seule ; quand l'application elle-même change, elle propose la nouvelle version.

### 3. Sur le PC (Windows)

Clone le dépôt (`git clone https://github.com/TON_COMPTE/silencio.git`), puis double-clique **installer.bat** : un
raccourci « Silencio » arrive sur le bureau (il met Silencio à jour à chaque lancement). Mac / Linux : `installer.sh`,
ou simplement `python3 main.py`. Seul Python 3.9 ou plus est nécessaire, sans aucun module à installer.

### 4. Publier une nouvelle version

Quand tu reçois un nouveau `silencio.zip` : glisse-le sur **outils\publier_version.bat** (dans l'Explorateur, ouvre
le dossier `silencio`, puis le sous-dossier `outils`). Le code est remplacé (ton dossier `donnees` et `depot.json` sont
gardés), puis envoyé sur GitHub. Le PC se met à jour au prochain lancement du raccourci, et les téléphones au prochain
lancement de l'application. Si le dossier `android/` a changé, GitHub reconstruit l'application, qui propose alors
d'installer la nouvelle version.

### 5. Remplir ton profil

Réglages :

- **Connecter mon compte TMDB** ;
- importer ton export **Letterboxd** (.zip), **IMDb** (.csv), ton compte **TMDB** ou un profil **Twin Picks** ;
- relier **Letterboxd, IMDb, Refract** et installer l'extension Silencio Sync ;
- l'**accueil** montre tes derniers films avec leur état sur Letterboxd, IMDb, Refract et TMDB (envoyé, en attente, erreur), et un bouton **Synchroniser** ; la page d'un film le détaille ;
- la recherche comprend les phrases : « vus au cinéma en 2025 notés 8+ », « coups de cœur en VO », « horreur des années 80 » ;
- les **listes automatiques** (cinéma, VO, VF, revus, coups de cœur…) peuvent devenir de vraies listes, tenues à jour ;
- **Compléter tes films importés** : reprendre un par un les visionnages importés et les films vus sans date (date, cinéma, version…).

## Pour les curieux

- `main.py` : lance le serveur local (127.0.0.1:8642) et ouvre le navigateur.
- `serveur.py` : sert l'interface (`web/`) et l'API.
- `stockage.py` : profils fusionnables, partie privée chiffrée, annulation.
- `synchro.py` : synchronisation GitHub.
- `compte.py` : comptes (identifiant, mot de passe, clé dérivée, réglages chiffrés qui suivent le compte).
- `miroir.py`, `refract.py`, `extension/` : Silencio maître de Letterboxd, IMDb et Refract.
- `tmdb.py` : lecture avec cache, file d'écriture, fiches compactes pour les stats.
- `imdb.py`, `wiki.py` : notes IMDb et Wikidata.
- `imports.py` : imports et exports.
- `miroir.py` : ce qui doit partir vers Letterboxd, IMDb et Refract (Silencio est le maître).
- `refract.py` : l'API officielle de Refract.
- `extension/` : l'extension Firefox Silencio Sync (à faire signer sur addons.mozilla.org, guide dans `web/extension/LISEZMOI.html`).
- `decouverte.py` : recommandations, sorties, notifications.
- `web/` : l'interface, en JavaScript sans framework (+ d3 pour les graphiques).
- `android/` : l'application Android (Chaquopy et WebView).
- `tests/` : `python tests/test_unitaires.py` (fusion, chiffrement, imports, miroirs, Refract…), `python tests/test_extension.py` (scripts de l'extension contre un faux Letterboxd et un faux IMDb) et `python tests/test_interface.py` (parcours complet dans Chromium, avec de faux TMDB, GitHub, IMDb et Wikidata).

Ce produit utilise l'API TMDB sans être approuvé ni certifié par TMDB. Plateformes : JustWatch (via TMDB). Notes IMDb :
datasets.imdbws.com, usage personnel et non commercial.
