"""TMDB : lecture (avec cache disque, pour l'hors ligne), fiches compactes pour les stats, et écriture sur ton compte
(notes, watchlist, coups de cœur, listes) par une file d'attente qui se vide dès qu'il y a du réseau."""
import hashlib
import json
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor

import config
from reseau import ErreurHTTP, HorsLigne, requete
from stockage import ecrire_json, lire_json

JOUR = 86400
TYPES = {"m": "movie", "t": "tv"}


def cle_titre(type_, id_):
    return ("m:" if type_ in ("movie", "m") else "t:") + str(int(id_))


def decouper(cle):
    t, i = cle.split(":")
    return TYPES[t], int(i)


class TMDB:
    def __init__(self, stock):
        self.stock = stock
        self.dossier = os.path.join(config.CACHE, "tmdb")
        self.d_meta = os.path.join(config.CACHE, "meta")
        self.verrou = threading.Lock()
        self.en_ligne = True
        self._dernier_echec = 0
        self.pool = ThreadPoolExecutor(max_workers=6)
        self.meta_en_cours = set()
        self.etat_file = {"attente": 0, "erreur": ""}

    # ------------------------------------------------------------ lecture
    @property
    def cle_api(self):
        return (self.stock.appareil.get("cle_tmdb") or config.CLE_TMDB).strip()

    def _auth(self, params):
        if self.cle_api.startswith("eyJ"):
            return {"Authorization": "Bearer " + self.cle_api}
        params["api_key"] = self.cle_api
        return {}

    def get(self, chemin, ttl=7 * JOUR, langue=True, **params):
        """GET avec cache disque. Hors ligne : la dernière réponse connue, même périmée."""
        if langue:
            params.setdefault("language", config.LANGUE)
        cle = hashlib.sha1((chemin + json.dumps(params, sort_keys=True)).encode()).hexdigest()
        f = os.path.join(self.dossier, cle[:2], cle + ".json")
        cache = lire_json(f)
        if cache and time.time() - cache.get("t", 0) < ttl:
            return cache["d"]
        if not self.en_ligne and time.time() - self._dernier_echec < 30 and cache:
            return cache["d"]
        p = dict(params)
        h = self._auth(p)
        try:
            d = requete(config.API_TMDB + chemin, params=p, entetes=h)
            self.en_ligne = True
        except HorsLigne:
            self.en_ligne, self._dernier_echec = False, time.time()
            if cache:
                return cache["d"]
            raise
        except ErreurHTTP as e:
            if e.code == 404:
                ecrire_json(f, {"t": time.time(), "d": None})
                return None
            if cache:
                return cache["d"]
            raise
        ecrire_json(f, {"t": time.time(), "d": d})
        return d

    def details(self, cle, ttl=3 * JOUR):
        type_, id_ = decouper(cle)
        if type_ == "movie":
            ajout = "credits,keywords,external_ids,release_dates,watch/providers,recommendations,similar,videos"
        else:
            ajout = "aggregate_credits,keywords,external_ids,content_ratings,watch/providers,recommendations,similar"
        d = self.get(f"/{type_}/{id_}", ttl=ttl, append_to_response=ajout, include_video_language="fr,en,null")
        if d is not None:
            self._enregistrer_meta(cle, d)
        return d

    def synopsis_anglais(self, cle):
        type_, id_ = decouper(cle)
        d = self.get(f"/{type_}/{id_}", ttl=30 * JOUR, language="en-US")
        return (d or {}).get("overview", "")

    def saison(self, tv_id, n):
        return self.get(f"/tv/{int(tv_id)}/season/{int(n)}", ttl=2 * JOUR)

    def personne(self, pid):
        return self.get(f"/person/{int(pid)}", ttl=7 * JOUR, append_to_response="combined_credits,external_ids,images")

    def credits_personne(self, pid):
        d = self.get(f"/person/{int(pid)}/combined_credits", ttl=3 * JOUR)
        return d or {"cast": [], "crew": []}

    def recherche(self, q, page=1):
        d = self.get("/search/multi", ttl=JOUR, query=q, page=page, include_adult="false")
        return (d or {}).get("results", [])

    def recherche_film(self, titre, annee=None, tv=False):
        chemin = "/search/tv" if tv else "/search/movie"
        p = {"query": titre, "include_adult": "false"}
        if annee:
            p["first_air_date_year" if tv else "primary_release_year"] = annee
        return (self.get(chemin, ttl=30 * JOUR, **p) or {}).get("results", [])

    def trouver_imdb(self, tt):
        d = self.get(f"/find/{tt}", ttl=60 * JOUR, external_source="imdb_id") or {}
        for k, t in (("movie_results", "m"), ("tv_results", "t")):
            if d.get(k):
                return cle_titre(t, d[k][0]["id"])
        return None

    def fournisseurs(self, cle):
        type_, id_ = decouper(cle)
        d = self.get(f"/{type_}/{id_}/watch/providers", ttl=JOUR, langue=False) or {}
        return (d.get("results") or {}).get(config.REGION) or {}

    def decouvrir(self, type_, **params):
        return self.get(f"/discover/{'tv' if type_ == 'tv' else 'movie'}", ttl=JOUR, **params) or {}

    def recommandations(self, cle):
        type_, id_ = decouper(cle)
        return (self.get(f"/{type_}/{id_}/recommendations", ttl=14 * JOUR) or {}).get("results", [])

    def collection(self, cid):
        return self.get(f"/collection/{int(cid)}", ttl=14 * JOUR)

    def mot_cle(self, kid, page=1):
        return self.get("/discover/movie", ttl=3 * JOUR, with_keywords=str(kid), page=page,
                        sort_by="vote_count.desc") or {}

    # ------------------------------------------------------------ fiches compactes (stats)
    def _f_meta(self, cle):
        return os.path.join(self.d_meta, cle.replace(":", "_") + ".json")

    def meta(self, cle):
        return lire_json(self._f_meta(cle))

    def _enregistrer_meta(self, cle, d):
        ecrire_json(self._f_meta(cle), compacter(cle, d))

    def assurer_metas(self, cles, attendre=False):
        """Télécharge en arrière-plan les fiches qui manquent (ou trop vieilles : 45 jours)."""
        manquantes = []
        for c in cles:
            f = self._f_meta(c)
            if c in self.meta_en_cours:
                continue
            if not os.path.exists(f) or (time.time() - os.path.getmtime(f) > 45 * JOUR):
                manquantes.append(c)
        if not manquantes:
            return 0
        with self.verrou:
            manquantes = [c for c in manquantes if c not in self.meta_en_cours]
            self.meta_en_cours.update(manquantes)

        def une(c):
            try:
                self.details(c, ttl=45 * JOUR)
            except Exception:  # noqa: BLE001  (hors ligne : on réessaiera)
                pass
            finally:
                with self.verrou:
                    self.meta_en_cours.discard(c)
        futurs = [self.pool.submit(une, c) for c in manquantes]
        if attendre:
            for f in futurs:
                f.result()
        return len(manquantes)

    # ------------------------------------------------------------ ton compte TMDB
    @property
    def session(self):
        return (self.stock.appareil.get("tmdb") or {}).get("session", "")

    def connexion_debut(self, retour):
        jeton = requete(config.API_TMDB + "/authentication/token/new", params={"api_key": self.cle_api}
                        if not self.cle_api.startswith("eyJ") else None,
                        entetes=self._auth({}) if self.cle_api.startswith("eyJ") else None)["request_token"]
        from urllib.parse import quote
        return f"{config.SITE_TMDB}/authenticate/{jeton}?redirect_to={quote(retour, safe='')}"

    def connexion_fin(self, jeton):
        p = {}
        h = self._auth(p)
        s = requete(config.API_TMDB + "/authentication/session/new", "POST", params=p, entetes=h,
                    corps={"request_token": jeton})
        session = s["session_id"]
        p = {"session_id": session}
        h = self._auth(p)
        compte = requete(config.API_TMDB + "/account", params=p, entetes=h)
        self.stock.appareil["tmdb"] = {"session": session, "compte": compte.get("id"),
                                       "nom": compte.get("username", "")}
        self.stock.sauver_appareil()
        return self.stock.appareil["tmdb"]

    def deconnexion(self):
        self.stock.appareil.pop("tmdb", None)
        self.stock.appareil["file_tmdb"] = []
        self.stock.sauver_appareil()

    def _ecrire(self, methode, chemin, corps=None):
        p = {"session_id": self.session}
        h = self._auth(p)
        return requete(config.API_TMDB + chemin, methode, params=p, entetes=h, corps=corps)

    def compte_pages(self, chemin):
        """Toutes les pages d'une liste du compte (notes, watchlist, favoris…)."""
        tmdb = self.stock.appareil.get("tmdb") or {}
        res, page = [], 1
        while True:
            p = {"session_id": self.session, "page": page, "language": config.LANGUE, "sort_by": "created_at.asc"}
            h = self._auth(p)
            d = requete(config.API_TMDB + f"/account/{tmdb.get('compte')}/{chemin}", params=p, entetes=h)
            res += d.get("results", [])
            if page >= d.get("total_pages", 1) or page > 200:
                return res
            page += 1

    def liste_complete(self, lid):
        res, page = None, 1
        while True:
            d = self.get(f"/list/{lid}", ttl=0, page=page)
            if not d:
                return res
            if res is None:
                res = d
            else:
                res["items"] += d.get("items", [])
            if page >= d.get("total_pages", 1):
                return res
            page += 1

    # ---- file d'attente (une écriture par film et par sorte, la dernière gagne)
    def mettre_en_file(self, operations):
        if not self.session or not operations:
            return
        with self.stock.verrou:
            file_ = self.stock.appareil.setdefault("file_tmdb", [])
            for sorte, cle, val in operations:
                file_[:] = [o for o in file_ if not (o[0] == sorte and o[1] == cle)]
                file_.append([sorte, cle, val])
            self.stock.sauver_appareil()
        self.etat_file["attente"] = len(self.stock.appareil.get("file_tmdb", []))

    def _noter(self, op, etat, erreur=""):
        sorte, cle, val = op
        quoi = {"note": "note", "watchlist": "wl", "favori": "like", "liste": "liste"}.get(sorte, sorte)
        retirer = val is None or val is False
        h = self.stock.appareil.setdefault("historique_envois", [])
        h.append({"t": time.time(), "p": "tmdb", "cle": f"{quoi}|{cle}", "titre": "", "action": "retirer" if retirer else "poser",
                  "etat": etat, "erreur": erreur})
        del h[:-800]

    def vider_file(self):
        """Envoie les modifications en attente. Renvoie le nombre envoyé."""
        if not self.session:
            return 0
        envoyes = 0
        while True:
            with self.stock.verrou:
                file_ = self.stock.appareil.get("file_tmdb") or []
                if not file_:
                    break
                op = list(file_[0])
            try:
                self._envoyer(*op)
                self.etat_file["erreur"] = ""
                self._noter(op, "ok")
            except HorsLigne:
                self.etat_file["erreur"] = "hors ligne"
                break
            except ErreurHTTP as e:
                if e.code in (401, 403):
                    self.etat_file["erreur"] = "connexion TMDB expirée : reconnecte-toi dans Réglages"
                    break
                if e.code == 429:
                    time.sleep(2)
                    continue
                self.etat_file["erreur"] = f"TMDB a refusé une modification ({e.code})"
                self._noter(op, "echec", f"TMDB a répondu {e.code}")
            with self.stock.verrou:
                f = self.stock.appareil.get("file_tmdb") or []
                if f and list(f[0]) == op:
                    f.pop(0)
                self.stock.sauver_appareil()
            envoyes += 1
        self.etat_file["attente"] = len(self.stock.appareil.get("file_tmdb") or [])
        return envoyes

    def _envoyer(self, sorte, cle, val):
        compte = (self.stock.appareil.get("tmdb") or {}).get("compte")
        if sorte == "liste":
            return self._envoyer_liste(cle)
        type_, id_ = decouper(cle)
        if sorte == "note":
            if val is None:
                try:
                    self._ecrire("DELETE", f"/{type_}/{id_}/rating")
                except ErreurHTTP as e:
                    if e.code != 404:
                        raise
            else:
                self._ecrire("POST", f"/{type_}/{id_}/rating", {"value": float(val)})
        elif sorte == "watchlist":
            self._ecrire("POST", f"/account/{compte}/watchlist", {"media_type": type_, "media_id": id_,
                                                                  "watchlist": bool(val)})
        elif sorte == "favori":
            self._ecrire("POST", f"/account/{compte}/favorite", {"media_type": type_, "media_id": id_,
                                                                 "favorite": bool(val)})

    def _envoyer_liste(self, lid):
        """Recopie une liste Silencio sur TMDB (films seulement : les listes TMDB v3 ne prennent pas les séries)."""
        doc = self.stock.doc or {}
        l = (doc.get("listes") or {}).get(lid)
        liens = self.stock.appareil.setdefault("listes_tmdb", {})
        lien = liens.get(lid) or {}
        if not l or l.get("x"):
            if lien.get("id"):
                try:
                    self._ecrire("DELETE", f"/list/{lien['id']}")
                except ErreurHTTP as e:
                    if e.code not in (404, 500):
                        raise
            liens.pop(lid, None)
            return
        if not lien.get("id"):
            r = self._ecrire("POST", "/list", {"name": l.get("nom", "Liste")[:60] or "Liste",
                                               "description": l.get("description", ""), "language": "fr"})
            lien = {"id": r.get("list_id"), "items": []}
            liens[lid] = lien
            self.stock.sauver_appareil()
        voulus = [int(c[2:]) for c in l.get("items", []) if c.startswith("m:")]
        presents = set(lien.get("items", []))
        for i in voulus:
            if i not in presents:
                try:
                    self._ecrire("POST", f"/list/{lien['id']}/add_item", {"media_id": i})
                except ErreurHTTP as e:
                    if e.code not in (403, 409):
                        raise
        for i in presents - set(voulus):
            try:
                self._ecrire("POST", f"/list/{lien['id']}/remove_item", {"media_id": i})
            except ErreurHTTP as e:
                if e.code not in (403, 404):
                    raise
        lien["items"] = voulus
        self.stock.sauver_appareil()


# ---------------------------------------------------------------- fiche compacte
def _format(type_, d, duree, genres):
    if type_ == "tv":
        if (d.get("type") or "") == "Miniseries":
            return "mini"
        if 99 in genres:
            return "docu_serie"
        return "serie"
    if 99 in genres:
        return "docu"
    if 10770 in genres:
        return "telefilm"
    if duree and duree < 40:
        return "court"
    return "long"


def compacter(cle, d):
    """Garde d'une fiche TMDB complète ce qui sert aux stats : ~1 Ko par film."""
    type_ = "tv" if cle.startswith("t:") else "movie"
    genres = [g["id"] for g in d.get("genres") or []]
    pers, motscles, societes = {}, {}, {}

    def personne(p):
        pers[p["id"]] = {"n": p.get("name", ""), "ph": p.get("profile_path"), "g": p.get("gender", 0)}
        return p["id"]

    if type_ == "movie":
        cr = d.get("credits") or {}
        cast = sorted(cr.get("cast") or [], key=lambda c: c.get("order", 999))[:config.NB_ACTEURS]
        equipe = cr.get("crew") or []
        date = d.get("release_date") or ""
        duree = d.get("runtime") or 0
        reals = [personne(c) for c in equipe if c.get("job") == "Director"]
        pays = [c["iso_3166_1"] for c in d.get("production_countries") or []] or list(d.get("origin_country") or [])
        mc = (d.get("keywords") or {}).get("keywords") or []
    else:
        cr = d.get("aggregate_credits") or {}
        cast = sorted(cr.get("cast") or [], key=lambda c: (-c.get("total_episode_count", 0), c.get("order", 999)))
        cast = cast[:config.NB_ACTEURS]
        equipe = []
        for c in cr.get("crew") or []:
            for j in c.get("jobs") or []:
                equipe.append(dict(c, job=j.get("job")))
        date = d.get("first_air_date") or ""
        ep = d.get("episode_run_time") or []
        nb_ep = d.get("number_of_episodes") or 0
        duree = round((sum(ep) / len(ep) if ep else 0) * nb_ep) or (45 * nb_ep if nb_ep else 0)
        reals = [personne(c) for c in d.get("created_by") or []]
        pays = list(d.get("origin_country") or []) or [c["iso_3166_1"] for c in d.get("production_countries") or []]
        mc = (d.get("keywords") or {}).get("results") or []
    eq = {}
    for c in equipe:
        k = config.METIERS.get(c.get("job"))
        if k and c["id"] not in eq.get(k, []):
            eq.setdefault(k, []).append(personne(c))
    if type_ == "movie":
        eq["real"] = reals
    else:
        eq.setdefault("createur", reals)
    for k in mc:
        motscles[k["id"]] = k.get("name", "")
    for s in d.get("production_companies") or []:
        societes[s["id"]] = {"n": s.get("name", ""), "logo": s.get("logo_path"), "p": s.get("origin_country", "")}
    for s in d.get("networks") or []:
        societes[s["id"]] = {"n": s.get("name", ""), "logo": s.get("logo_path"), "p": s.get("origin_country", "")}
    ext = d.get("external_ids") or {}
    m = {
        "k": cle, "ty": cle[0], "t": d.get("title") or d.get("name") or "",
        "o": d.get("original_title") or d.get("original_name") or "",
        "a": int(date[:4]) if date[:4].isdigit() else None, "ds": date, "r": duree, "g": genres,
        "p": pays, "l": d.get("original_language") or "",
        "lg": [x.get("iso_639_1") for x in d.get("spoken_languages") or [] if x.get("iso_639_1")],
        "re": reals, "ca": [personne(c) for c in cast], "eq": eq,
        "b": d.get("budget") or 0, "rc": d.get("revenue") or 0,
        "mc": [k["id"] for k in mc][:40], "so": [s["id"] for s in (d.get("production_companies") or [])][:8],
        "af": d.get("poster_path"), "fd": d.get("backdrop_path"), "im": ext.get("imdb_id") or d.get("imdb_id"),
        "vt": d.get("vote_average") or 0, "nv": d.get("vote_count") or 0, "pop": round(d.get("popularity") or 0, 1),
        "col": (d.get("belongs_to_collection") or {}).get("id"),
        "fmt": _format(type_, d, duree, genres),
    }
    if type_ == "tv":
        m["so"] = [s["id"] for s in (d.get("networks") or [])][:4] + m["so"][:4]
        m["sa"] = [[s.get("season_number"), s.get("episode_count", 0), s.get("air_date") or "", s.get("name", ""),
                    s.get("poster_path")] for s in d.get("seasons") or []]
        m["ne"] = d.get("number_of_episodes") or 0
        m["st"] = d.get("status") or ""
        m["fin"] = d.get("last_air_date") or ""
        n = d.get("next_episode_to_air") or {}
        m["pr"] = [n.get("season_number"), n.get("episode_number"), n.get("air_date"), n.get("name")] if n else None
        m["dep"] = round(sum(ep) / len(ep)) if ep else 0
    return {"m": m, "pers": pers, "mc": motscles, "so": societes, "t": time.time()}
