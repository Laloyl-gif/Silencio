"""Silencio : réglages fixes et emplacements des fichiers.

Tout ce qui t'appartient (profil, caches, réglages de cet appareil) est dans donnees/ : une mise à jour du code ne
l'efface jamais. Sur Android, l'application donne ce dossier par la variable SILENCIO_DONNEES.
"""
import os

VERSION = open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "VERSION"), encoding="utf-8").read().strip()
RACINE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.join(RACINE, "web")
DONNEES = os.environ.get("SILENCIO_DONNEES") or os.path.join(RACINE, "donnees")
CACHE = os.path.join(DONNEES, "cache")
PORT = int(os.environ.get("SILENCIO_PORT") or 8642)

# Clé TMDB (la même que Twin Picks) ; on peut mettre la sienne dans Réglages.
CLE_TMDB = "86ed8f1a7ba89d86b9736b6f0b765375"
# Adresses des services (remplaçables pour les tests hors ligne).
API_TMDB = os.environ.get("SILENCIO_TMDB") or "https://api.themoviedb.org/3"
IMG_TMDB = os.environ.get("SILENCIO_TMDB_IMG") or "https://image.tmdb.org/t/p/"
SITE_TMDB = "https://www.themoviedb.org"
API_GITHUB = os.environ.get("SILENCIO_GITHUB") or "https://api.github.com"
WIKIDATA = os.environ.get("SILENCIO_WIKIDATA") or "https://query.wikidata.org/sparql"
IMDB_NOTES = os.environ.get("SILENCIO_IMDB") or "https://datasets.imdbws.com/title.ratings.tsv.gz"
IMDB_VOTES_MIN = 30                    # on garde les notes IMDb des titres d'au moins 30 votes
NOMINATIM = os.environ.get("SILENCIO_NOMINATIM") or "https://nominatim.openstreetmap.org/search"
REGION = "FR"                           # « où le regarder » et dates de sortie
LANGUE = "fr-FR"

# Métiers retenus pour les stats (TMDB « job ») : clé courte -> libellé
METIERS = {
    "Director": "real", "Screenplay": "scen", "Writer": "scen", "Story": "scen", "Novel": "scen",
    "Director of Photography": "image", "Original Music Composer": "musique", "Music": "musique",
    "Editor": "montage", "Production Design": "decors", "Costume Design": "costumes", "Producer": "prod",
    "Casting": "casting", "Sound Designer": "son", "Visual Effects Supervisor": "vfx",
}
NB_ACTEURS = 15                         # acteurs gardés par film pour les stats

# Prix suivis (Wikidata, par leur nom anglais) : clé -> (libellé, nom Wikidata)
PRIX = {
    "palme": ("Palme d'or", "Palme d'Or"),
    "oscar": ("Oscar du meilleur film", "Academy Award for Best Picture"),
    "lion": ("Lion d'or", "Golden Lion"),
    "ours": ("Ours d'or", "Golden Bear"),
    "cesar": ("César du meilleur film", "César Award for Best Film"),
    "bafta": ("BAFTA du meilleur film", "BAFTA Award for Best Film"),
    "oscar_inter": ("Oscar du film international", "Academy Award for Best International Feature Film"),
}
