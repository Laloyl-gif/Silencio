"""Recommandations, sorties des personnes favorites, et notifications (watchlist dispo, sorties, récap du mois)."""
import os
import threading
import time
import uuid
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor

import config
from reseau import HorsLigne
from stockage import ecrire_json, lire_json
from tmdb import cle_titre

MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre",
        "décembre"]


def _vivants(section):
    return {k: v for k, v in (section or {}).items() if not v.get("x")}


def recommandations(stock, tmdb, n=60):
    """Les titres conseillés d'après tes meilleures notes (recommandations TMDB pondérées par ta note)."""
    doc = stock.doc or {}
    titres = _vivants(doc.get("titres"))
    vus = {k for k, v in titres.items() if v.get("vu")}
    wl = set(_vivants(doc.get("watchlist")))
    aimes = sorted([(v.get("note") or (9 if v.get("coeur") else 0), k) for k, v in titres.items()
                    if (v.get("note") or 0) >= 8 or v.get("coeur")], reverse=True)[:40]
    scores, raisons, infos = defaultdict(float), defaultdict(list), {}

    def recos(k):
        try:
            return k, tmdb.recommandations(k)
        except Exception:  # noqa: BLE001
            return k, []
    with ThreadPoolExecutor(max_workers=6) as ex:
        res = list(ex.map(lambda x: recos(x[1]), aimes))
    poids = {k: (n_ - 6.5) for n_, k in aimes}
    for source, liste in res:
        for rang, r in enumerate(liste[:20]):
            c = cle_titre("t" if (r.get("media_type") == "tv" or source.startswith("t:")) and "name" in r else "m", r["id"])
            if c in vus:
                continue
            scores[c] += poids[source] * (1 - rang / 30) * (1 + min(r.get("vote_average", 0), 9) / 20)
            raisons[c].append(source)
            infos[c] = {"cle": c, "t": r.get("title") or r.get("name"), "a": (r.get("release_date") or r.get(
                "first_air_date") or "")[:4], "af": r.get("poster_path"), "vt": r.get("vote_average", 0)}
    meilleurs = sorted(scores, key=scores.get, reverse=True)[:n]
    return [dict(infos[c], score=round(scores[c], 2), parce_que=raisons[c][:3], watchlist=c in wl)
            for c in meilleurs]


LIB_CRITERES = {"scenario": "le scénario", "realisation": "la mise en scène", "jeu": "le jeu", "image": "la photographie",
                "montage": "le montage", "decors": "les décors", "costumes": "les costumes", "musique": "la musique",
                "son": "le son", "originalite": "l'originalité"}
ROLE_CRITERE = {"image": ("image", ("Director of Photography",)), "musique": ("musique", ("Original Music Composer", "Music")),
                "montage": ("montage", ("Editor",)), "decors": ("decors", ("Production Design",)),
                "costumes": ("costumes", ("Costume Design",)), "scenario": ("scen", ("Screenplay", "Writer")),
                "realisation": ("real", ("Director",)), "originalite": ("real", ("Director",))}


def suggestions_criteres(stock, tmdb, meta, n=40):
    """Suggestions tirées de tes notes détaillées : les personnes derrière ce que tu notes le plus haut (le chef op
    des films dont tu adores la photographie, le compositeur des musiques que tu notes 9…) et leurs autres films."""
    doc = stock.doc or {}
    titres = _vivants(doc.get("titres"))
    vus = {k for k, v in titres.items() if v.get("vu")}
    wl = set(_vivants(doc.get("watchlist")))
    gens = defaultdict(lambda: {"s": 0.0, "n": 0, "films": []})
    for c, t in titres.items():
        for crit, v in (t.get("detail") or {}).items():
            if not v or crit not in ROLE_CRITERE:
                continue
            role, _ = ROLE_CRITERE[crit]
            m = meta(c) or {}
            ids = (m.get("re") or []) if role == "real" else ((m.get("eq") or {}).get(role) or [])
            for pid in ids[:2]:
                g = gens[(crit, pid)]
                g["s"] += v
                g["n"] += 1
                g["films"].append(c)
    choisis = sorted(((k, g) for k, g in gens.items() if g["n"] >= 1 and g["s"] / g["n"] >= 8),
                     key=lambda x: -(x[1]["s"] / x[1]["n"]) * (1 + 0.3 * min(x[1]["n"], 5)))[:10]
    if not choisis:
        return []
    def credits(pid):
        try:
            return pid, tmdb.credits_personne(pid)
        except Exception:  # noqa: BLE001
            return pid, {"cast": [], "crew": []}
    with ThreadPoolExecutor(max_workers=6) as ex:
        cr = dict(ex.map(credits, list({pid for (_, pid), _ in choisis})))
    scores, raisons, infos = defaultdict(float), {}, {}
    for (crit, pid), g in choisis:
        moy = g["s"] / g["n"]
        _, jobs = ROLE_CRITERE[crit]
        for r in (cr.get(pid) or {}).get("crew") or []:
            if r.get("job") not in jobs or r.get("media_type") != "movie" or (r.get("vote_count") or 0) < 50:
                continue
            c = cle_titre("m", r["id"])
            if c in vus:
                continue
            scores[c] += (moy - 7) * (1 + min(r.get("vote_average", 0), 9) / 10)
            if c not in raisons:
                raisons[c] = {"critere": LIB_CRITERES.get(crit, crit), "personne": pid, "film": g["films"][0], "moy": round(moy, 1)}
            infos[c] = {"cle": c, "t": r.get("title") or "", "a": (r.get("release_date") or "")[:4], "af": r.get("poster_path"),
                        "vt": r.get("vote_average", 0)}
    meilleurs = sorted(scores, key=scores.get, reverse=True)[:n]
    return [dict(infos[c], raison=raisons[c], watchlist=c in wl) for c in meilleurs]


def sorties_favoris(stock, tmdb, jours_avant=30, jours_apres=400):
    """Les films et séries des personnes favorites qui sortent bientôt (ou viennent de sortir)."""
    doc = stock.doc or {}
    fav = _vivants(doc.get("favoris"))
    vus = {k for k, v in _vivants(doc.get("titres")).items() if v.get("vu")}
    auj = time.strftime("%Y-%m-%d")
    debut = time.strftime("%Y-%m-%d", time.localtime(time.time() - jours_avant * 86400))
    fin = time.strftime("%Y-%m-%d", time.localtime(time.time() + jours_apres * 86400))
    res = {}

    def un(pid):
        try:
            return pid, tmdb.credits_personne(pid)
        except Exception:  # noqa: BLE001
            return pid, {"cast": [], "crew": []}
    with ThreadPoolExecutor(max_workers=6) as ex:
        for pid, cr in ex.map(un, list(fav)):
            for role in (cr.get("cast") or []) + (cr.get("crew") or []):
                date = role.get("release_date") or role.get("first_air_date") or ""
                if role.get("media_type") == "tv" and role.get("episode_count", 99) < 3:
                    continue
                sans_date = not date and role.get("media_type") == "movie" and role.get("popularity", 0) > 3
                if not sans_date and not (debut <= date <= fin):
                    continue
                c = cle_titre("t" if role.get("media_type") == "tv" else "m", role["id"])
                e = res.setdefault(c, {"cle": c, "t": role.get("title") or role.get("name"), "date": date,
                                       "af": role.get("poster_path"), "fd": role.get("backdrop_path"),
                                       "personnes": [], "vu": c in vus, "sortie": bool(date and date <= auj)})
                metier = role.get("job") or ("Acteur" if role.get("character") is not None else "")
                if not any(p["id"] == pid for p in e["personnes"]):
                    e["personnes"].append({"id": pid, "nom": fav[pid].get("nom", ""), "metier": metier})
    return sorted(res.values(), key=lambda e: e["date"] or "9999")


class Notifications:
    """Centre de notifications (aussi relayées en notifications Android par l'application)."""

    def __init__(self, stock, tmdb):
        self.stock, self.tmdb = stock, tmdb
        self.f = os.path.join(config.DONNEES, "notifs.json")
        self.d = lire_json(self.f, {"liste": [], "vus": {}, "dispo": {}, "verif": 0, "recap": ""})
        self.verrou = threading.Lock()

    def sauver(self):
        with self.verrou:
            self.d["liste"] = self.d["liste"][-150:]
            ecrire_json(self.f, self.d)

    def ajouter(self, cle_unique, type_, titre, texte, lien, image=None):
        with self.verrou:
            if cle_unique in self.d["vus"]:
                return
            self.d["vus"][cle_unique] = time.time()
            self.d["liste"].append({"id": uuid.uuid4().hex[:8], "type": type_, "titre": titre, "texte": texte,
                                    "lien": lien, "image": image, "date": time.time(), "lu": False})
        self.sauver()

    def liste(self):
        return list(reversed(self.d["liste"]))

    def marquer_lues(self):
        for n in self.d["liste"]:
            n["lu"] = True
        self.sauver()

    def nouvelles(self, depuis):
        return [n for n in self.d["liste"] if n["date"] > depuis]

    def verifier(self, forcer=False):
        """À faire de temps en temps (toutes les 6 h) : récap du mois, sorties des favoris, watchlist dispo."""
        if not self.stock.doc or (not forcer and time.time() - self.d.get("verif", 0) < 6 * 3600):
            return
        self.d["verif"] = time.time()
        self._recap()
        try:
            self._sorties()
            self._dispo()
        except HorsLigne:
            pass
        except Exception:  # noqa: BLE001
            pass
        self.sauver()

    def _recap(self):
        t = time.localtime()
        an, mois = (t.tm_year, t.tm_mon - 1) if t.tm_mon > 1 else (t.tm_year - 1, 12)
        code = f"{an}-{mois:02d}"
        if self.d.get("recap") == code:
            return
        self.d["recap"] = code
        vus = [e for e in _vivants((self.stock.doc or {}).get("journal")).values() if e.get("date", "").startswith(code)]
        if not vus:
            return
        notes = [e["note"] for e in vus if e.get("note")]
        meilleur = max(vus, key=lambda e: e.get("note") or 0)
        m = self.tmdb.meta(meilleur["cle"]) or {}
        texte = f"{len(vus)} visionnage{'s' if len(vus) > 1 else ''}"
        if notes:
            texte += f", moyenne {sum(notes) / len(notes):.1f}"
        if m.get("m"):
            texte += f" · ton préféré : {m['m'].get('t')}"
        self.ajouter("recap:" + code, "recap", f"Ton mois de {MOIS[mois - 1]}", texte, f"#/wrapped/{code}",
                     (m.get("m") or {}).get("fd"))

    def _sorties(self):
        auj = time.strftime("%Y-%m-%d")
        for e in sorties_favoris(self.stock, self.tmdb, jours_avant=14, jours_apres=365):
            if e["vu"]:
                continue
            noms = ", ".join(p["nom"] for p in e["personnes"][:2])
            if e["date"] and e["date"] <= auj:
                self.ajouter("sortie:" + e["cle"], "sortie", e["t"], f"Vient de sortir · {noms}",
                             "#/titre/" + e["cle"], e["af"])
            elif e["date"]:
                self.ajouter("annonce:" + e["cle"], "annonce", e["t"], f"Sortie le {_date_fr(e['date'])} · {noms}",
                             "#/titre/" + e["cle"], e["af"])

    def _dispo(self):
        wl = list(_vivants((self.stock.doc or {}).get("watchlist")))[:250]
        dispo = self.d.setdefault("dispo", {})

        def un(c):
            try:
                return c, self.tmdb.fournisseurs(c)
            except Exception:  # noqa: BLE001
                return c, None
        with ThreadPoolExecutor(max_workers=6) as ex:
            for c, f in ex.map(un, wl):
                if f is None:
                    continue
                miennes = set(((self.stock.doc or {}).get("profil") or {}).get("reglages", {}).get("plateformes") or [])
                noms = sorted({p["provider_name"] for p in f.get("flatrate") or [] if not miennes or p["provider_id"] in miennes})
                avant = dispo.get(c)
                dispo[c] = noms
                nouveaux = [n for n in noms if avant is not None and n not in avant]
                if nouveaux:
                    m = (self.tmdb.meta(c) or {}).get("m") or {}
                    self.ajouter(f"dispo:{c}:{','.join(nouveaux)}", "dispo", m.get("t") or "Un film de ta watchlist",
                                 "Maintenant sur " + ", ".join(nouveaux), "#/titre/" + c, m.get("af"))


def _date_fr(d):
    try:
        a, m, j = d.split("-")
        return f"{int(j)} {MOIS[int(m) - 1]} {a}"
    except ValueError:
        return d
