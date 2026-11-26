"""Refract, par son API officielle (https://getrefract.app/developers) : une clé personnelle « rfk_… » créée dans
l'appli Refract suffit, elle ne demande jamais de se reconnecter.

Ce que Silencio envoie (API v1, vérifiée dans https://getrefract.app/v1/openapi.json) : films vus (avec la date),
épisodes vus ou non, watchlist (ajout, retrait), notes des films et des séries (entier de 1 à 10).
Jamais DELETE /v1/library/{id} : il effacerait aussi les visionnages et la note chez Refract.
"""
import hashlib
import time
import urllib.parse

import config
import miroir
from reseau import ErreurHTTP, HorsLigne, requete

AGENT = "Silencio/" + config.VERSION


class Refract:
    def __init__(self, stock, meta):
        self.stock = stock
        self.meta = meta                                   # fonction : clé -> fiche compacte (identifiant IMDb…)
        self.etat = {"erreur": "", "dernier": 0, "en_cours": False}

    @property
    def cle(self):
        return (self.stock.appareil.get("refract") or {}).get("cle", "")

    def _req(self, methode, chemin, corps=None, idem=None, params=None):
        h = {"Authorization": "Bearer " + self.cle, "Accept": "application/json", "User-Agent": AGENT}
        if idem:
            h["Idempotency-Key"] = idem
        for essai in range(3):
            try:
                return requete(config.API_REFRACT.rstrip("/") + "/" + chemin.lstrip("/"), methode, params=params,
                               corps=corps, entetes=h, delai=20)
            except ErreurHTTP as e:
                texte = (e.corps or b"").decode("utf-8", "replace")
                if e.code == 409 and "concurrent_modification" in texte and essai < 2:
                    time.sleep(0.5)
                    continue
                if e.code in (429, 500, 502, 503) and essai < 2:
                    time.sleep(3 * (essai + 1))
                    continue
                raise

    def moi(self):
        return self._req("GET", "me")
        try:
            doc = requete(config.API_REFRACT.rstrip("/") + "/openapi.json", entetes={"User-Agent": AGENT}, delai=20)
        except HorsLigne:
            return caps
        except (ErreurHTTP, ValueError):
            doc = None
        caps = {"verifie": time.time(), "notes": lire_notes(doc) if doc else None}
        app["refract_caps"] = caps
        self.stock.sauver_appareil()
        return caps

    # ---- identifiants Refract (mis en cache sur l'appareil)
    def identifiant(self, cle):
        cache = self.stock.appareil.setdefault("refract_ids", {})
        if cle in cache:
            return cache[cle]
        type_ = "movie" if cle.startswith("m:") else "show"
        essais = [("tmdb", cle[2:])]
        im = (self.meta(cle) or {}).get("im")
        if im:
            essais.append(("imdb", im))
        trouve = None
        for sorte, valeur in essais:
            try:
                r = self._req("GET", f"search/{sorte}/{urllib.parse.quote(str(valeur))}", params={"type": type_})
            except ErreurHTTP as e:
                if e.code == 404:
                    continue
                raise
            data = (r or {}).get("data") or []
            if data:
                ids = data[0].get("ids") or data[0]
                trouve = ids.get("refract")
                if trouve:
                    break
        cache[cle] = trouve
        return trouve

    # ---- lecture (pour le point de départ)
    def watchlist(self):
        titres, curseur = [], None
        for _ in range(50):
            r = self._req("GET", "watchlist", params={"limit": 200, "cursor": curseur})
            for it in (r or {}).get("data") or []:
                ids = it.get("ids") or {}
                if ids.get("tmdb"):
                    t = "t" if it.get("type") == "show" else "m"
                    titres.append((f"{t}:{ids['tmdb']}", ids.get("refract")))
            curseur = r.get("next_cursor") if r.get("has_more") else None
            if not curseur:
                break
        return titres

    # ---- écriture
    def executer(self, op):
        """Exécute une opération du module miroir. Renvoie (état, référence)."""
        s, a = op["sorte"], op["action"]
        cle_titre = op["cle"].split("|")[1] if s in ("wl", "ep") else None
        if s == "vu":
            jid = op["cle"].split("|")[1]
            e = (self.stock.doc.get("journal") or {}).get(jid) or {}
            rid = self.identifiant(e.get("cle", ""))
            if not rid:
                return "introuvable", None
            d = (op["valeur"] or {}).get("date") or ""
            d = (d + "-01-01")[:10] if len(d) == 4 else (d + "-01")[:10] if len(d) == 7 else d
            idem = hashlib.sha1(("silencio" + jid).encode()).hexdigest()
            self._req("POST", "history/movies", {"movie_id": rid, "watched_at": d + "T20:00:00Z"}, idem=idem)
            return "ok", None
        if s == "wl":
            rid = self.identifiant(cle_titre)
            if not rid:
                return "introuvable", None
            try:
                self._req("PUT" if a == "poser" else "DELETE", f"watchlist/{urllib.parse.quote(rid)}")
            except ErreurHTTP as e:
                texte = (e.corps or b"").decode("utf-8", "replace")
                if e.code == 409 and "IN_LIBRARY" in texte:
                    return "deja", None                  # déjà suivi chez Refract avec un autre statut
                if e.code == 404 and a == "retirer":
                    return "deja", None
                raise
            return "ok", None
        if s == "ep":
            rid = self.identifiant(cle_titre)
            if not rid:
                return "introuvable", None
            chemin = f"history/episodes/{urllib.parse.quote(rid)}/{op['saison']}/{op['episode']}"
            if a == "poser":
                self._req("PUT", chemin, {"watched_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())})
            else:
                try:
                    self._req("DELETE", chemin)
                except ErreurHTTP as e:
                    if e.code != 404:
                        raise
            return "ok", None
        if s == "note":
            cle = op["cle"].split("|")[1]
            rid = self.identifiant(cle)
            if not rid:
                return "introuvable", None
            genre = "shows" if cle.startswith("t:") else "movies"
            try:
                self._req("PUT", f"ratings/{genre}/{urllib.parse.quote(rid)}", {"value": int(op["valeur"])})
            except ErreurHTTP as e:
                if e.code in (404, 405, 501):
                    return "attente", None                 # pas (encore) ouvert sur ce compte : on garde la note
                raise
            return "ok", None
        return "attente", None

    def passage(self, limite=80):
        """Envoie ce qui manque chez Refract. Renvoie le bilan."""
        if not self.cle or not self.stock.doc or self.etat["en_cours"]:
            return None
        self.etat["en_cours"] = True
        try:
            echecs = (self.stock.appareil.get("miroir_echecs") or {}).get("rf") or {}
            ops = miroir.operations(self.stock.doc, "rf", self.meta, echecs, limite=limite)["ops"]
            resultats = []
            for op in ops:
                try:
                    etat, ref = self.executer(op)
                except HorsLigne:
                    self.etat["erreur"] = "hors ligne"
                    break
                except ErreurHTTP as e:
                    if e.code in (401, 403):
                        self.etat["erreur"] = "clé Refract refusée : crée-en une nouvelle dans l'appli Refract"
                        break
                    etat, ref = "echec", None
                    op["erreur"] = f"Refract a répondu {e.code}"
                r = {"cle": op["cle"], "id": op["id"], "action": op["action"], "valeur": op["valeur"], "ref": ref,
                     "etat": "ok" if etat in ("ok", "deja") else ("echec" if etat != "attente" else "attente"),
                     "erreur": op.get("erreur") or ("titre introuvable chez Refract" if etat == "introuvable" else ""),
                     "titre": op.get("titre", "")}
                if etat != "attente":
                    resultats.append(r)
                time.sleep(0.25)
            else:
                self.etat["erreur"] = ""
            bilan = miroir.appliquer_resultats(self.stock, "rf", resultats)
            self.etat["dernier"] = time.time()
            return bilan
        finally:
            self.etat["en_cours"] = False

    def point_de_depart(self):
        """Lit la watchlist Refract : ce qui y est déjà est noté présent (et entre dans Silencio s'il n'y est pas)."""
        wl = self.watchlist()
        cache = self.stock.appareil.setdefault("refract_ids", {})
        presence, a_importer = {}, {}
        for cle, rid in wl:
            cache[cle] = rid
            presence[f"wl|{cle}"] = 1
            if not self.stock.titre(cle).get("vu"):
                a_importer[cle] = {"ajout": time.strftime("%Y-%m-%d")}
        self.stock.sauver_appareil()
        return presence, a_importer

