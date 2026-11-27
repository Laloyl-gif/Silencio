"""Séances dans tes cinémas (programmes Allociné) : séances d'un film, films de ta watchlist dans leur dernière
semaine, et ce qui est à l'affiche. Une semaine de cinéma va du mercredi au mardi ; le programme de la semaine
suivante est publié en général le lundi ou le mardi.
"""
import datetime
import json
import os
import re
import time
import unicodedata
import urllib.parse

import config
from reseau import ErreurHTTP, HorsLigne, requete
from stockage import ecrire_json, lire_json

SITE = os.environ.get("SILENCIO_ALLOCINE") or "https://www.allocine.fr"
CINEMAS_DEFAUT = [{"nom": "Pathé Valenciennes", "code": "P0617"},
                  {"nom": "L'Arsenal", "code": "", "recherche": "Arsenal Valenciennes"}]
AGENT = "Mozilla/5.0 (X11; Linux x86_64; rv:140.0) Gecko/20100101 Firefox/140.0"


def normal(t):
    t = unicodedata.normalize("NFD", str(t or "").lower())
    t = "".join(c for c in t if unicodedata.category(c) != "Mn")
    t = re.sub(r"[^a-z0-9]+", " ", t)
    t = re.sub(r"^(the|le|la|les|l|un|une|a|an) ", "", t.strip())
    return t.strip()


def code_depuis(texte):
    """« P0617 » ou une adresse Allociné (…salle_gen_csalle=P0617.html, …/theater-P0617/…) → « P0617 »."""
    m = re.search(r"(?:csalle=|theater-|^)([A-Z]\d{4})\b", (texte or "").strip())
    return m.group(1) if m else ""


def semaine(jour=None):
    """(mercredi, mardi) de la semaine de cinéma qui contient ce jour."""
    j = jour or datetime.date.today()
    mer = j - datetime.timedelta(days=(j.weekday() - 2) % 7)
    return mer, mer + datetime.timedelta(days=6)


class Seances:
    def __init__(self, stock, tmdb):
        self.stock, self.tmdb = stock, tmdb
        self.dossier = os.path.join(config.CACHE, "seances")

    # ------------------------------------------------------------------ réglages
    def cinemas(self):
        r = ((self.stock.doc or {}).get("profil") or {}).get("reglages", {}).get("cinemas")
        return [dict(c) for c in (r if r is not None else CINEMAS_DEFAUT)]

    def _code(self, c):
        if c.get("code"):
            return c["code"]
        memo = self.stock.appareil.setdefault("codes_cinemas", {})
        q = c.get("recherche") or c.get("nom") or ""
        if q in memo and time.time() - memo[q].get("t", 0) < 7 * 86400:
            return memo[q].get("code", "")
        code = ""
        try:
            trouves = self.chercher(q)
            code = trouves[0]["code"] if trouves else ""
        except (HorsLigne, ErreurHTTP, ValueError, KeyError, IndexError):
            pass
        memo[q] = {"code": code, "t": time.time()}
        self.stock.sauver_appareil()
        return code

    def chercher(self, q):
        """Cinémas Allociné dont le nom correspond (pour les réglages)."""
        d = requete(f"{SITE}/_/autocomplete/{urllib.parse.quote(q)}", entetes={"User-Agent": AGENT,
                    "Accept": "application/json"}, delai=15)
        r = []

        def parcourir(x):
            if isinstance(x, dict):
                typ = str(x.get("entity_type") or x.get("type") or x.get("entityType") or "").lower()
                ident = x.get("entity_id") or x.get("id") or x.get("internalId") or ""
                if "theater" in typ or "salle" in typ or re.fullmatch(r"[A-Z]\d{4}", str(ident)):
                    code = code_depuis(str(ident)) or code_depuis(json.dumps(x))
                    if code:
                        r.append({"code": code, "nom": x.get("label") or x.get("name") or x.get("title") or code,
                                  "ville": (x.get("data") or {}).get("city") if isinstance(x.get("data"), dict) else ""})
                for v in x.values():
                    parcourir(v)
            elif isinstance(x, list):
                for v in x:
                    parcourir(v)
        parcourir(d)
        vus, uniq = set(), []
        for c in r:
            if c["code"] not in vus:
                vus.add(c["code"])
                uniq.append(c)
        return uniq[:10]

    # ------------------------------------------------------------------ programme d'une journée
    def jour(self, code, date):
        """[{titre, original, annee, seances: [{h, v, imax}]}] pour un cinéma et une date (AAAA-MM-JJ)."""
        f = os.path.join(self.dossier, f"{code}-{date}.json")
        cache = lire_json(f)
        frais = 3 * 3600 if date <= time.strftime("%Y-%m-%d", time.localtime(time.time() + 86400)) else 12 * 3600
        if cache and time.time() - cache.get("t", 0) < frais:
            return cache["d"]
        films, page = [], 1
        try:
            while page <= 6:
                d = requete(f"{SITE}/_/showtimes/theater-{code}/d-{date}/p-{page}/",
                            entetes={"User-Agent": AGENT, "Accept": "application/json"}, delai=20)
                for res in (d or {}).get("results") or []:
                    films.append(self._film(res))
                pag = (d or {}).get("pagination") or {}
                if page >= int(pag.get("totalPages") or 1):
                    break
                page += 1
        except (HorsLigne, ErreurHTTP, ValueError):
            if cache:
                return cache["d"]
            raise
        os.makedirs(self.dossier, exist_ok=True)
        ecrire_json(f, {"t": time.time(), "d": films})
        return films

    @staticmethod
    def _film(res):
        m = res.get("movie") or res.get("onShow", {}).get("movie") or {}
        annee = None
        for rel in m.get("releases") or []:
            d = ((rel or {}).get("releaseDate") or {}).get("date") or ""
            if d[:4].isdigit():
                annee = int(d[:4])
                break
        st = res.get("showtimes") or {}
        seances = []
        for version, liste in (st.items() if isinstance(st, dict) else []):
            for s in liste or []:
                h = (s.get("startsAt") or s.get("startDate") or "")[11:16]
                if not h:
                    continue
                brut = json.dumps(s).upper()
                v = {"original": "VO", "dubbed": "VF", "local": "VF", "multiple": ""}.get(version, "")
                if "VOST" in brut or "ORIGINAL" in brut:
                    v = "VO"
                seances.append({"h": h, "v": v, "imax": "IMAX" in brut})
        seances.sort(key=lambda x: x["h"])
        return {"titre": m.get("title") or "", "original": m.get("originalTitle") or "", "annee": annee,
                "id": m.get("internalId") or m.get("id"), "seances": seances}

    @staticmethod
    def correspond(film, meta):
        """Le film du programme est-il ce titre TMDB (titre français ou original, année à un an près) ?"""
        if not meta:
            return False
        a = {normal(film["titre"]), normal(film["original"])} - {""}
        b = {normal(meta.get("t")), normal(meta.get("o"))} - {""}
        if not a & b:
            return False
        return not (film.get("annee") and meta.get("a")) or abs(film["annee"] - meta["a"]) <= 1

    # ------------------------------------------------------------------ pour la fiche d'un film
    def du_film(self, meta, jours=7):
        r = []
        for c in self.cinemas():
            code = self._code(c)
            if not code:
                r.append({"nom": c["nom"], "erreur": "cinéma introuvable sur Allociné : indique son adresse Allociné dans Réglages"})
                continue
            js = []
            try:
                for i in range(jours):
                    date = (datetime.date.today() + datetime.timedelta(days=i)).isoformat()
                    for f in self.jour(code, date):
                        if self.correspond(f, meta) and f["seances"]:
                            js.append({"date": date, "seances": f["seances"]})
            except (HorsLigne, ErreurHTTP, ValueError) as e:
                r.append({"nom": c["nom"], "erreur": "programme indisponible" if not isinstance(e, HorsLigne) else "hors ligne"})
                continue
            r.append({"nom": c["nom"], "code": code, "jours": js})
        return r

    # ------------------------------------------------------------------ dernière semaine des films de ta watchlist
    def derniere_semaine(self, metas):
        """{cle: [{cinema, jusqua}]} pour les films (metas : {cle: meta}) qui vivent leur dernière semaine."""
        mer, mar = semaine()
        auj = datetime.date.today()
        r = {}
        for c in self.cinemas():
            code = self._code(c)
            if not code:
                continue
            programme = {}
            try:
                for i in range((mar - auj).days + 1 + 7):
                    d = auj + datetime.timedelta(days=i)
                    programme[d] = self.jour(code, d.isoformat())
            except (HorsLigne, ErreurHTTP, ValueError):
                continue
            # le programme de la semaine suivante est-il publié ? (au moins un film le mercredi suivant)
            suivant = mar + datetime.timedelta(days=1)
            publie = any(f["seances"] for f in programme.get(suivant, []))
            if not publie:
                continue
            for cle, meta in metas.items():
                cette = [d for d, fs in programme.items() if d <= mar and any(self.correspond(f, meta) and f["seances"] for f in fs)]
                apres = [d for d, fs in programme.items() if d > mar and any(self.correspond(f, meta) and f["seances"] for f in fs)]
                if cette and not apres:
                    r.setdefault(cle, []).append({"cinema": c["nom"], "jusqua": max(cette).isoformat()})
        return r
