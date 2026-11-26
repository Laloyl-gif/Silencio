"""Refract, par son API officielle (https://getrefract.app/developers) : une clé personnelle « rfk_… » créée dans
l'appli Refract suffit, elle ne demande jamais de se reconnecter.

Ce que l'API sait écrire aujourd'hui : films vus (avec la date), épisodes vus ou non, watchlist (ajout, retrait).
Les notes arriveront plus tard chez Refract : Silencio les garde en attente et relit chaque jour la description
officielle de l'API (openapi.json). Dès qu'un envoi de note y apparaît, les notes en attente partent toutes seules.
"""
import hashlib
import re
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

    # ---- ce que l'API sait faire (lu dans sa description officielle, une fois par jour)
    def capacites(self, forcer=False):
        app = self.stock.appareil
        caps = app.get("refract_caps") or {}
        if not forcer and time.time() - caps.get("verifie", 0) < 86400:
            return caps
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
            caps = (self.stock.appareil.get("refract_caps") or {}).get("notes")
            if not caps:
                return "attente", None                     # Refract n'accepte pas encore les notes
            rid = self.identifiant(op["cle"].split("|")[1])
            if not rid:
                return "introuvable", None
            n = float(op["valeur"]) * caps["max"] / 10.0
            n = int(round(n)) if caps.get("entier") else round(n * 2) / 2
            chemin = caps["chemin"].replace("{id}", urllib.parse.quote(rid))
            corps = {caps["champ"]: n}
            if caps.get("champ_id"):
                corps[caps["champ_id"]] = rid
            self._req(caps["methode"], chemin, corps)
            return "ok", None
        return "attente", None

    def passage(self, limite=80):
        """Envoie ce qui manque chez Refract. Renvoie le bilan."""
        if not self.cle or not self.stock.doc or self.etat["en_cours"]:
            return None
        self.etat["en_cours"] = True
        try:
            notes = bool(self.capacites().get("notes"))
            echecs = (self.stock.appareil.get("miroir_echecs") or {}).get("rf") or {}
            ops = miroir.operations(self.stock.doc, "rf", self.meta, echecs, limite=100000)["ops"]
            if not notes:                         # les notes attendent que Refract les accepte
                ops = [o for o in ops if o["sorte"] != "note"]
            ops = ops[:limite]
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


def lire_notes(doc):
    """Cherche dans la description OpenAPI de Refract une façon d'écrire une note : chemin, méthode, champ, échelle."""
    comps = ((doc or {}).get("components") or {}).get("schemas") or {}

    def resoudre(sch, n=0):
        while isinstance(sch, dict) and "$ref" in sch and n < 10:
            sch = comps.get(sch["$ref"].split("/")[-1]) or {}
            n += 1
        return sch or {}
    for chemin, ops in ((doc or {}).get("paths") or {}).items():
        if "rating" not in chemin.lower() or "game" in chemin.lower():
            continue
        for methode in ("put", "post"):
            op = (ops or {}).get(methode)
            if not op:
                continue
            sch = resoudre((((op.get("requestBody") or {}).get("content") or {}).get("application/json") or {})
                           .get("schema") or {})
            props = {k: resoudre(v) for k, v in (sch.get("properties") or {}).items()}
            champ = next((k for k in ("rating", "value", "score", "stars") if k in props), None)
            if not champ or props[champ].get("type") not in ("number", "integer"):
                continue
            maxi = props[champ].get("maximum") or 10
            champ_id = next((k for k in ("title_id", "id", "movie_id", "refract_id") if k in props), None)
            ch = re.sub(r"^/?v1", "", chemin)
            ch = re.sub(r"\{[^}]+\}", "{id}", ch)
            if "{id}" not in ch and not champ_id:
                continue
            return {"chemin": ch, "methode": methode.upper(), "champ": champ, "max": float(maxi),
                    "entier": props[champ].get("type") == "integer", "champ_id": champ_id if "{id}" not in ch else None}
    return None
