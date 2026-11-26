"""Imports (Letterboxd, IMDb, TMDB, Twin Picks) et exports (Letterboxd / Refract, sauvegarde complète).

Un import produit des « sections » (titres, journal, watchlist, listes) que le stock ajoute sans écraser ce qui est
plus récent. Il tourne en tâche de fond : la page Réglages suit sa progression.
"""
import csv
import io
import json
import os
import threading
import time
import uuid
import zipfile
from concurrent.futures import ThreadPoolExecutor

from reseau import HorsLigne
from tmdb import cle_titre

TACHES = {}


def lancer(nom, fonction, *args):
    """Lance un import en tâche de fond ; renvoie l'identifiant de la tâche."""
    tid = uuid.uuid4().hex[:8]
    t = {"id": tid, "nom": nom, "fait": 0, "total": 0, "fini": False, "erreur": "", "resultat": None,
         "non_trouves": []}
    TACHES[tid] = t

    def courir():
        try:
            t["resultat"] = fonction(t, *args)
        except HorsLigne:
            t["erreur"] = "Pas d'Internet : l'import a besoin de TMDB pour reconnaître les films."
        except Exception as e:  # noqa: BLE001
            t["erreur"] = str(e)[:300]
        finally:
            t["fini"] = True
    threading.Thread(target=courir, daemon=True).start()
    return tid


def _note(x, echelle=1.0):
    try:
        n = float(x) * echelle
    except (TypeError, ValueError):
        return None
    if n <= 0:
        return None
    n = max(0.5, min(10.0, round(n * 2) / 2))
    return int(n) if n == int(n) else n


def _associer(tache, tmdb, elements, cle_fn):
    """Associe en parallèle chaque élément à un titre TMDB : {clé élément: "m:123"}."""
    uniques = list(dict.fromkeys(cle_fn(e) for e in elements))
    tache["total"] = len(uniques)
    res = {}

    def un(k):
        try:
            return k, tmdb_trouver(tmdb, *k)
        except HorsLigne:
            raise
        except Exception:  # noqa: BLE001
            return k, None
        finally:
            tache["fait"] += 1
    with ThreadPoolExecutor(max_workers=8) as ex:
        for k, c in ex.map(un, uniques):
            res[k] = c
            if not c:
                tache["non_trouves"].append(" ".join(str(x) for x in k if x and not str(x).startswith("tt")) or k[0])
    return res


def tmdb_trouver(tmdb, titre, annee=None, imdb_id=None, tv=None):
    if imdb_id:
        c = tmdb.trouver_imdb(imdb_id)
        if c:
            return c
    if not titre:
        return None
    try:
        a = int(annee) if annee else None
    except ValueError:
        a = None
    essais = [(False, a), (False, None)] if not tv else [(True, a), (True, None)]
    if tv is None:
        essais += [(True, a)]
    for est_tv, an in essais:
        r = tmdb.recherche_film(titre, an, tv=est_tv)
        if not r and an:
            r = tmdb.recherche_film(titre, an - 1, tv=est_tv) or tmdb.recherche_film(titre, an + 1, tv=est_tv)
        if r:
            exact = [x for x in r if (x.get("title") or x.get("name") or "").lower() == titre.lower()
                     or (x.get("original_title") or x.get("original_name") or "").lower() == titre.lower()]
            choix = (exact or r)[0]
            return cle_titre("t" if est_tv else "m", choix["id"])
    return None


def _maintenant():
    return time.strftime("%Y-%m-%d")


# ---------------------------------------------------------------- Letterboxd (export .zip)
def _lire_csv(texte):
    return list(csv.DictReader(io.StringIO(texte)))


def _liste_lb(texte):
    """Un fichier de liste Letterboxd : un en-tête de liste, puis « Position,Name,Year,URL,Description »."""
    lignes = texte.splitlines()
    nom, description = "", ""
    entete = csv.reader(io.StringIO("\n".join(lignes[:4])))
    tout = list(entete)
    for i, l in enumerate(tout):
        if l and l[0] == "Date" and i + 1 < len(tout):
            info = dict(zip(l, tout[i + 1]))
            nom, description = info.get("Name", ""), info.get("Description", "")
    debut = next((i for i, l in enumerate(lignes) if l.startswith("Position,") or l.startswith("Name,Year")), None)
    films = _lire_csv("\n".join(lignes[debut:])) if debut is not None else []
    return nom, description, films


def import_letterboxd(tache, tmdb, octets):
    z = zipfile.ZipFile(io.BytesIO(octets))
    fichiers = {os.path.basename(n) if "/lists/" not in n and not n.startswith("lists/") else n: n
                for n in z.namelist()}

    def lire(nom):
        n = fichiers.get(nom)
        return z.read(n).decode("utf-8-sig") if n else ""
    diary, ratings, watched = _lire_csv(lire("diary.csv")), _lire_csv(lire("ratings.csv")), _lire_csv(lire("watched.csv"))
    reviews, watchlist = _lire_csv(lire("reviews.csv")), _lire_csv(lire("watchlist.csv"))
    likes = _lire_csv(z.read(next((n for n in z.namelist() if n.endswith("likes/films.csv")), "")).decode("utf-8-sig")) \
        if any(n.endswith("likes/films.csv") for n in z.namelist()) else []
    listes = [_liste_lb(z.read(n).decode("utf-8-sig")) for n in z.namelist()
              if "lists/" in n and n.endswith(".csv") and not n.endswith("likes/films.csv")]
    tous = diary + ratings + watched + reviews + watchlist + likes + [f for _, _, fs in listes for f in fs]
    if not tous:
        raise ValueError("Ce fichier ne ressemble pas à un export Letterboxd (diary.csv, ratings.csv…).")

    def k(e):
        return (e.get("Name", ""), e.get("Year", ""))
    assoc = _associer(tache, tmdb, tous, k)
    titres, journal, wl, ls = {}, {}, {}, {}
    for e in watched:
        c = assoc.get(k(e))
        if c:
            titres.setdefault(c, {})["vu"] = True
    for e in ratings:
        c = assoc.get(k(e))
        if c and _note(e.get("Rating"), 2):
            titres.setdefault(c, {}).update(vu=True, note=_note(e.get("Rating"), 2))
    for e in likes:
        c = assoc.get(k(e))
        if c:
            titres.setdefault(c, {})["coeur"] = True
    critiques = {}
    for e in reviews:
        critiques[(k(e), e.get("Watched Date") or e.get("Date"))] = e.get("Review", "")
    for e in diary:
        c = assoc.get(k(e))
        if not c:
            continue
        date = e.get("Watched Date") or e.get("Date") or _maintenant()
        jid = "lb" + uuid.uuid5(uuid.NAMESPACE_URL, (e.get("Letterboxd URI") or "") + date + c).hex[:12]
        entree = {"cle": c, "date": date, "note": _note(e.get("Rating"), 2), "revision": e.get("Rewatch") == "Yes",
                  "critique": critiques.pop((k(e), date), "")}
        journal[jid] = entree
        t = titres.setdefault(c, {})
        t["vu"] = True
        tags = [x.strip() for x in (e.get("Tags") or "").split(",") if x.strip()]
        if tags:
            t["etiquettes"] = sorted(set(t.get("etiquettes", []) + tags))
    for (cle_e, date), texte in critiques.items():           # critiques sans entrée de journal
        c = assoc.get(cle_e)
        if c and texte:
            jid = "lb" + uuid.uuid5(uuid.NAMESPACE_URL, c + (date or "")).hex[:12]
            journal[jid] = {"cle": c, "date": date or _maintenant(), "note": titres.get(c, {}).get("note"),
                            "critique": texte, "revision": False}
    for e in watchlist:
        c = assoc.get(k(e))
        if c and not titres.get(c, {}).get("vu"):
            wl[c] = {"ajout": e.get("Date") or _maintenant()}
    for nom, desc, films in listes:
        items = [assoc.get(k(f)) for f in films]
        lid = "lb" + uuid.uuid5(uuid.NAMESPACE_URL, nom).hex[:10]
        ls[lid] = {"nom": nom or "Liste Letterboxd", "description": desc, "items": [i for i in items if i],
                   "classee": any(f.get("Position") for f in films), "privee": False, "cree": _maintenant()}
    return {"titres": titres, "journal": journal, "watchlist": wl, "listes": ls}


# ---------------------------------------------------------------- IMDb (export CSV des notes ou de la watchlist)
def import_imdb(tache, tmdb, octets):
    lignes = _lire_csv(octets.decode("utf-8-sig", errors="replace"))
    if not lignes or "Const" not in lignes[0]:
        raise ValueError("Ce fichier ne ressemble pas à un export IMDb (colonne « Const » absente).")
    notes = "Your Rating" in lignes[0]
    lignes = [l for l in lignes if (l.get("Title Type") or "").lower() not in ("tv episode", "tvepisode", "podcast episode")]

    def k(e):
        return (e.get("Title", ""), e.get("Year", ""), e.get("Const"))
    assoc = _associer(tache, tmdb, lignes, k)
    titres, wl = {}, {}
    for e in lignes:
        c = assoc.get(k(e))
        if not c:
            continue
        if notes:
            n = _note(e.get("Your Rating"))
            titres[c] = {"vu": True, "note": n}
        else:
            wl[c] = {"ajout": (e.get("Created") or _maintenant())[:10]}
    journal = {}
    if notes:                       # la date de la note IMDb sert de date de visionnage (approximative)
        for e in lignes:
            c = assoc.get(k(e))
            d = (e.get("Date Rated") or "")[:10]
            if c and d:
                journal["im" + uuid.uuid5(uuid.NAMESPACE_URL, c + d).hex[:12]] = {
                    "cle": c, "date": d, "note": _note(e.get("Your Rating")), "revision": False, "approx": True}
    return {"titres": titres, "watchlist": wl, "journal": journal}


# ---------------------------------------------------------------- ton compte TMDB
def import_tmdb(tache, tmdb):
    if not tmdb.session:
        raise ValueError("Connecte d'abord ton compte TMDB (Réglages).")
    titres, wl, ls = {}, {}, {}
    etapes = [("rated/movies", "m", "note"), ("rated/tv", "t", "note"), ("watchlist/movies", "m", "wl"),
              ("watchlist/tv", "t", "wl"), ("favorite/movies", "m", "coeur"), ("favorite/tv", "t", "coeur")]
    tache["total"] = len(etapes) + 1
    for chemin, t, sorte in etapes:
        for r in tmdb.compte_pages(chemin):
            c = cle_titre(t, r["id"])
            if sorte == "note":
                titres.setdefault(c, {}).update(vu=True, note=_note(r.get("rating")))
            elif sorte == "coeur":
                titres.setdefault(c, {})["coeur"] = True
            else:
                wl[c] = {"ajout": _maintenant()}
        tache["fait"] += 1
    for l in tmdb.compte_pages("lists"):
        d = tmdb.liste_complete(l["id"]) or {}
        items = [cle_titre("t" if i.get("media_type") == "tv" else "m", i["id"]) for i in d.get("items", [])]
        lid = "tm" + str(l["id"])
        ls[lid] = {"nom": l.get("name", "Liste TMDB"), "description": l.get("description", ""), "items": items,
                   "classee": False, "privee": False, "cree": _maintenant()}
        tmdb.stock.appareil.setdefault("listes_tmdb", {})[lid] = {"id": l["id"], "items": [
            int(i[2:]) for i in items if i.startswith("m:")]}
    tmdb.stock.sauver_appareil()
    tache["fait"] += 1
    for c in list(wl):
        if titres.get(c, {}).get("vu"):
            del wl[c]
    return {"titres": titres, "watchlist": wl, "listes": ls}


# ---------------------------------------------------------------- Twin Picks (profils.json)
def profils_twin_picks(chemin):
    """Les profils trouvés dans le fichier profils.json de Twin Picks : [{id, nom, nb}]."""
    try:
        with open(chemin, encoding="utf-8") as f:
            d = json.load(f)
    except (OSError, ValueError):
        return []
    return [{"id": p.get("id"), "nom": p.get("nom") or p.get("id"), "nb": len(p.get("films") or {})}
            for p in d if isinstance(p, dict) and p.get("id")]


def import_twin_picks(tache, chemin, pid):
    with open(chemin, encoding="utf-8") as f:
        d = json.load(f)
    p = next((x for x in d if x.get("id") == pid), None)
    if not p:
        raise ValueError("Profil Twin Picks introuvable.")
    titres = {}
    films = p.get("films") or {}
    tache["total"] = len(films)
    for c, f in films.items():
        if c[:2] in ("m:", "t:") and f.get("n"):
            titres[c] = {"vu": True, "note": _note(f.get("n"))}
        tache["fait"] += 1
    return {"titres": titres}


def chercher_twin_picks():
    """Le fichier profils.json de Twin Picks s'il est à côté de Silencio."""
    import config
    for c in (os.path.join(config.RACINE, "..", "twin_picks", "profils.json"),
              os.path.join(config.RACINE, "..", "twin-picks", "profils.json"),
              os.path.join(config.RACINE, "..", "Twin Picks", "profils.json")):
        if os.path.isfile(c):
            return os.path.abspath(c)
    return ""


# ---------------------------------------------------------------- exports
def export_letterboxd(doc, metas):
    """CSV au format d'import Letterboxd (accepté aussi par Refract, qui importe depuis Letterboxd)."""
    sortie = io.StringIO()
    w = csv.writer(sortie)
    w.writerow(["tmdbID", "imdbID", "Title", "Year", "WatchedDate", "Rating", "Rewatch", "Tags", "Review"])
    deja = set()
    titres = doc.get("titres") or {}

    def ligne(cle, date, note, revision, critique):
        m = (metas.get(cle) or {})
        t = titres.get(cle) or {}
        etoiles = "" if note is None else str(max(0.5, min(5.0, int(float(note) + 0.5) / 2)))
        w.writerow([cle[2:], m.get("im") or "", m.get("o") or m.get("t") or "", m.get("a") or "", date if date and len(date) == 10 else "",
                    etoiles, "true" if revision else "", ", ".join(t.get("etiquettes") or []), critique or ""])
    for jid, e in sorted((doc.get("journal") or {}).items(), key=lambda x: x[1].get("date", "")):
        if e.get("x") or not e.get("cle", "").startswith("m:"):
            continue
        ligne(e["cle"], e.get("date"), e.get("note"), e.get("revision"), e.get("critique"))
        deja.add(e["cle"])
    for cle, t in titres.items():
        if t.get("x") or cle in deja or not cle.startswith("m:") or not t.get("vu"):
            continue
        ligne(cle, "", t.get("note"), False, "")
    return sortie.getvalue()


def export_watchlist_letterboxd(doc, metas):
    sortie = io.StringIO()
    w = csv.writer(sortie)
    w.writerow(["tmdbID", "imdbID", "Title", "Year"])
    for cle, e in (doc.get("watchlist") or {}).items():
        if e.get("x") or not cle.startswith("m:"):
            continue
        m = metas.get(cle) or {}
        w.writerow([cle[2:], m.get("im") or "", m.get("o") or m.get("t") or "", m.get("a") or ""])
    return sortie.getvalue()
