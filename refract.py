"""Refract, par son API officielle (https://getrefract.app/developers) : une clé personnelle « rfk_… » créée dans
l'appli Refract suffit, elle ne demande jamais de se reconnecter.

Ce que Silencio envoie (API v1, vérifiée dans https://getrefract.app/v1/openapi.json) : films vus (avec la date),
épisodes vus ou non, watchlist (ajout, retrait), notes des films et des séries (entier de 1 à 10).
Jamais DELETE /v1/library/{id} : il effacerait aussi les visionnages et la note chez Refract.
"""
import hashlib
import re
import json
import time
import urllib.parse

import config
import miroir
from reseau import ErreurHTTP, HorsLigne, requete

AGENT = "Silencio/" + config.VERSION


class Ralentir(ErreurHTTP):
    """Refract demande d'attendre (429) : on s'arrête là, rien n'est compté comme raté."""

    def __init__(self, secondes):
        super().__init__(429, f"Refract demande d'attendre {secondes} s")
        self.secondes = secondes


ENTRE_DEUX = 1.2                                       # secondes entre deux requêtes (rythme tranquille)
PAR_PASSAGE = 25                                       # opérations au plus par passage (un passage par minute)


class Refract:
    def __init__(self, stock, meta):
        self.stock = stock
        self.meta = meta                                   # fonction : clé -> fiche compacte (identifiant IMDb…)
        self.etat = {"erreur": "", "dernier": 0, "en_cours": False, "pause_jusqua": 0}

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
                if e.code == 429:
                    try:
                        attente = int(float((getattr(e, "entetes", None) or {}).get("retry-after") or 0))
                    except ValueError:
                        attente = 0
                    raise Ralentir(max(60, min(attente or 300, 3600))) from None
                if e.code in (500, 502, 503) and essai < 2:
                    time.sleep(3 * (essai + 1))
                    continue
                raise
            finally:
                time.sleep(ENTRE_DEUX * (0 if methode == "GET" and chemin == "me" else 1))

    def moi(self):
        return self._req("GET", "me")

    # ---- coups de cœur et critiques : envoyés seulement si la description officielle de l'API les propose
    def capacites(self, forcer=False):
        app = self.stock.appareil
        caps = app.get("refract_caps2") or {}
        if forcer or time.time() - caps.get("verifie", 0) > 86400:
            try:
                doc = requete(config.API_REFRACT.rstrip("/") + "/openapi.json", entetes={"User-Agent": AGENT}, delai=20)
                caps = dict(lire_capacites(doc), verifie=time.time())
            except (HorsLigne, ErreurHTTP, ValueError):
                caps = dict(caps, verifie=time.time() - 86400 + 3600)        # nouvel essai dans une heure
            avant = set(k for k in ("favori", "critique") if (app.get("refract_caps2") or {}).get(k))
            app["refract_caps2"] = caps
            nouveaux = [k for k in ("favori", "critique") if caps.get(k) and k not in avant]
            miroir.CAPS_RF.update({k: caps.get(k) for k in ("favori", "critique")})
            if nouveaux and (app.get("miroir_depart") or {}).get("rf") and self.stock.doc:
                # ce qui existait avant la liaison avec Refract ne part pas : seulement tes ajouts suivants
                miroir.poser_depart_avant(self.stock, "rf", app["miroir_depart"]["rf"])
            self.stock.sauver_appareil()
        else:
            miroir.CAPS_RF.update({k: caps.get(k) for k in ("favori", "critique")})
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
            film = e.get("cle") or (op.get("avant") or {}).get("cle") or (f"m:{op['tmdb']}" if op.get("tmdb") else "")
            rid = self.identifiant(film)
            if not rid:
                return "introuvable", None
            d = (op["valeur"] or {}).get("date") or ""
            d = (d + "-01-01")[:10] if len(d) == 4 else (d + "-01")[:10] if len(d) == 7 else d
            if a == "retirer":
                return self._retirer_visionnage(rid, (op.get("avant") or {}), op.get("ref"))
            idem = hashlib.sha1(("silencio" + jid).encode()).hexdigest()
            rep = self._req("POST", "history/movies", {"movie_id": rid, "watched_at": d + "T20:00:00Z"}, idem=idem) or {}
            donnees = rep.get("data") if isinstance(rep.get("data"), dict) else rep
            return "ok", str(donnees.get("id") or "") or None
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
        if s in ("like", "critique"):
            c = miroir.CAPS_RF.get("favori" if s == "like" else "critique")
            if not c:
                return "attente", None
            if s == "like":
                cle = op["cle"].split("|")[1]
            else:
                cle = ((self.stock.doc.get("journal") or {}).get(op["cle"].split("|")[1]) or {}).get("cle", "")
            rid = self.identifiant(cle)
            if not rid:
                return "introuvable", None
            chemin = c["chemin"].replace("{genre}", "shows" if cle.startswith("t:") else "movies").replace("{id}", urllib.parse.quote(rid))
            corps = None
            if s == "critique":
                corps = {c["champ"]: op["valeur"]}
                if c.get("spoiler"):
                    corps[c["spoiler"]] = False
            self._req(c["methode"] if op["action"] == "poser" else "DELETE", chemin, corps if op["action"] == "poser" else None,
                      idem=hashlib.sha1(("silencio" + op["cle"] + str(op["valeur"])).encode()).hexdigest() if c["methode"] == "POST" else None)
            return "ok", None
        if s == "note":
            cle = op["cle"].split("|")[1]
            rid = self.identifiant(cle)
            if not rid:
                return "introuvable", None
            genre = "shows" if cle.startswith("t:") else "movies"
            if a == "retirer":
                self._req("DELETE", f"ratings/{genre}/{urllib.parse.quote(rid)}")
                return "ok", None
            try:
                self._req("PUT", f"ratings/{genre}/{urllib.parse.quote(rid)}", {"value": int(op["valeur"])})
            except ErreurHTTP as e:
                if e.code in (404, 405, 501):
                    return "attente", None                 # pas (encore) ouvert sur ce compte : on garde la note
                raise
            return "ok", None
        return "attente", None

    def _retirer_visionnage(self, rid, avant, ref):
        """Retire un visionnage de l'historique Refract : par son identifiant, sinon retrouvé par film et date."""
        if not ref:
            date = (avant.get("date") or "")[:10]
            curseur = None
            for _ in range(10):
                r = self._req("GET", "history/movies", params={"limit": 200, "cursor": curseur}) or {}
                for it in r.get("data") or []:
                    texte = json.dumps(it)
                    if f'"{rid}"' in texte and (not date or date in str(it.get("watched_at") or texte)):
                        ref = str(it.get("id") or "")
                        break
                if ref or not r.get("has_more"):
                    break
                curseur = r.get("next_cursor")
        if not ref:
            return "deja", None                    # plus dans l'historique Refract
        try:
            self._req("DELETE", f"history/movies/{urllib.parse.quote(ref)}")
        except ErreurHTTP as e:
            texte = (e.corps or b"").decode("utf-8", "replace")
            if e.code == 409 and "remove_rewatches_first" in texte:
                return "deja", None                 # Refract garde la 1re vision tant qu'il y a des revisionnages
            if e.code != 404:
                raise
        return "ok", None

    def passage(self, limite=PAR_PASSAGE):
        """Envoie ce qui manque chez Refract. Renvoie le bilan."""
        if not self.cle or not self.stock.doc or self.etat["en_cours"] or time.time() < self.etat["pause_jusqua"]:
            return None
        self.etat["en_cours"] = True
        try:
            self.capacites()
            echecs = (self.stock.appareil.get("miroir_echecs") or {}).get("rf") or {}
            ops = miroir.operations(self.stock.doc, "rf", self.meta, echecs, limite=limite)["ops"]
            resultats = []
            for op in ops:
                try:
                    etat, ref = self.executer(op)
                except HorsLigne:
                    self.etat["erreur"] = "hors ligne"
                    break
                except Ralentir as r:
                    self.etat["pause_jusqua"] = time.time() + r.secondes
                    self.etat["erreur"] = ""          # normal : on reprend tout seul un peu plus tard
                    break
                except ErreurHTTP as e:
                    if e.code == 401:
                        self.etat["erreur"] = "clé Refract refusée : crée-en une nouvelle dans l'appli Refract"
                        break
                    if e.code == 403:
                        self.etat["erreur"] = ("ta clé Refract n'a pas le droit d'écrire : recrée-la dans Refract (Accès et "
                                               "applications connectées) en cochant l'écriture de l'historique, de la "
                                               "bibliothèque et des notes, puis colle-la dans Silencio")
                        break
                    etat, ref = "echec", None
                    detail = ""
                    try:
                        j = json.loads((e.corps or b"{}").decode("utf-8", "replace"))
                        detail = " ".join(str(j.get(k) or "") for k in ("code", "detail", "title") if j.get(k))
                    except ValueError:
                        pass
                    op["erreur"] = f"Refract a répondu {e.code}" + (f" ({detail[:120]})" if detail else "")
                r = {"cle": op["cle"], "id": op["id"], "action": op["action"], "valeur": op["valeur"], "ref": ref,
                     "etat": "ok" if etat in ("ok", "deja") else ("echec" if etat != "attente" else "attente"),
                     "erreur": op.get("erreur") or ("titre introuvable chez Refract" if etat == "introuvable" else ""),
                     "titre": op.get("titre", "")}
                if etat != "attente":
                    resultats.append(r)
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



def lire_capacites(doc):
    """Cherche dans la description OpenAPI de Refract l'envoi d'un coup de cœur et d'une critique."""
    comps = ((doc or {}).get("components") or {}).get("schemas") or {}

    def resoudre(sch, n=0):
        while isinstance(sch, dict) and "$ref" in sch and n < 10:
            sch = comps.get(sch["$ref"].split("/")[-1]) or {}
            n += 1
        return sch or {}
    r = {}
    for chemin, ops in ((doc or {}).get("paths") or {}).items():
        bas = chemin.lower()
        ch = re.sub(r"^/?v1", "", chemin)
        ch = re.sub(r"\{[^}]+\}", "{id}", ch)
        ch = re.sub(r"/(movies|shows)/", "/{genre}/", ch)
        if "{id}" not in ch or "episode" in bas or "game" in bas:
            continue
        if not r.get("favori") and re.search(r"favou?rite|/likes?/|heart", bas) and "put" in (ops or {}):
            r["favori"] = {"chemin": ch, "methode": "PUT"}
        if not r.get("critique") and "review" in bas:
            for m in ("put", "post"):
                op = (ops or {}).get(m)
                if not op:
                    continue
                sch = resoudre((((op.get("requestBody") or {}).get("content") or {}).get("application/json") or {})
                               .get("schema") or {})
                props = sch.get("properties") or {}
                champ = next((k for k in ("text", "body", "content", "review") if k in props), None)
                if champ:
                    r["critique"] = {"chemin": ch, "methode": m.upper(), "champ": champ,
                                     "spoiler": next((k for k in ("spoiler", "contains_spoilers", "spoilers") if k in props), None)}
                    break
    return r
