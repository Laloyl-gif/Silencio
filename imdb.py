"""Les notes IMDb, depuis les fichiers publics d'IMDb (datasets.imdbws.com, usage personnel et non commercial).

IMDb n'a pas d'API gratuite et interdit qu'on lise son site automatiquement : on télécharge donc une fois par semaine
le fichier des notes (~8 Mo), on garde les titres d'au moins 30 votes dans un fichier trié, et on y cherche par
dichotomie (pas besoin de tout charger en mémoire, même sur un téléphone).
"""
import gzip
import io
import os
import threading
import time

import config
from reseau import requete

FICHIER = os.path.join(config.CACHE, "imdb_notes.tsv")
_verrou = threading.Lock()
_memo = {}
ETAT = {"en_cours": False, "date": 0, "erreur": "", "nb": 0}


def _numero(tt):
    try:
        return int(tt[2:])
    except (TypeError, ValueError):
        return -1


def a_jour():
    return os.path.exists(FICHIER) and time.time() - os.path.getmtime(FICHIER) < 7 * 86400


def mettre_a_jour(forcer=False):
    """Télécharge et filtre le fichier IMDb (en arrière-plan de préférence)."""
    if ETAT["en_cours"] or (a_jour() and not forcer):
        return False
    ETAT.update(en_cours=True, erreur="")
    try:
        brut = requete(config.IMDB_NOTES, delai=120, brut=True)
        lignes = []
        with gzip.open(io.BytesIO(brut), "rt", encoding="utf-8") as f:
            next(f, None)
            for l in f:
                p = l.rstrip("\n").split("\t")
                if len(p) == 3 and p[2].isdigit() and int(p[2]) >= config.IMDB_VOTES_MIN:
                    lignes.append((_numero(p[0]), f"{p[0]}\t{p[1]}\t{p[2]}\n"))
        lignes.sort()
        os.makedirs(os.path.dirname(FICHIER), exist_ok=True)
        tmp = FICHIER + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            f.writelines(l for _, l in lignes)
        os.replace(tmp, FICHIER)
        with _verrou:
            _memo.clear()
        ETAT.update(nb=len(lignes), date=time.time())
        return True
    except Exception as e:  # noqa: BLE001
        ETAT["erreur"] = str(e)[:200]
        return False
    finally:
        ETAT["en_cours"] = False


def note(tt):
    """(note, votes) pour un identifiant IMDb « tt… », ou None."""
    if not tt or not tt.startswith("tt"):
        return None
    with _verrou:
        if tt in _memo:
            return _memo[tt]
    res = None
    cible = _numero(tt)

    def ligne_apres(f, pos):
        """La première ligne complète qui commence à « pos » ou après."""
        if pos > 0:
            f.seek(pos - 1)
            f.readline()
        else:
            f.seek(0)
        return f.readline()

    try:
        with open(FICHIER, "rb") as f:
            f.seek(0, 2)
            bas, haut = 0, f.tell()
            while bas < haut:
                milieu = (bas + haut) // 2
                ligne = ligne_apres(f, milieu)
                if not ligne or _numero(ligne.split(b"\t", 1)[0].decode()) >= cible:
                    haut = milieu
                else:
                    bas = milieu + 1
            ligne = ligne_apres(f, bas)
            p = ligne.decode("utf-8").rstrip("\n").split("\t")
            if len(p) == 3 and _numero(p[0]) == cible:
                res = (float(p[1]), int(p[2]))
    except OSError:
        return None
    with _verrou:
        if len(_memo) > 20000:
            _memo.clear()
        _memo[tt] = res
    return res


def etat():
    d = dict(ETAT)
    d["present"] = os.path.exists(FICHIER)
    if d["present"]:
        d["date"] = os.path.getmtime(FICHIER)
    return d
