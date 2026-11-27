"""Les données de Silencio : ton profil (fusionnable entre appareils), ceux de tes amis, et cet appareil.

Un profil est un document JSON fait de sections (titres, journal, watchlist…). Chaque section est un dictionnaire
clé -> entrée, et chaque entrée porte sa date de modification « maj ». Deux copies d'un même profil (téléphone et PC)
se fusionnent donc sans conflit : pour chaque clé, l'entrée la plus récente gagne. Une suppression est une entrée
{"x": true} (pierre tombale), pour qu'elle se propage elle aussi.
"""
import base64
import copy
import hashlib
import hmac
import json
import os
import re
import secrets
import threading
import time
import uuid

import config

FORMAT = 1
SECTIONS = ("titres", "journal", "watchlist", "listes", "classements", "favoris", "series", "graphiques", "annees",
            "miroirs", "abonnements", "duels")
PRIVEES = ("miroirs", "abonnements", "duels")          # sections jamais montrées aux amis (pas même leurs clés)
# miroirs : ce que Silencio sait avoir déjà envoyé sur Letterboxd, IMDb et Refract (« lb|note|m:603 » → valeur).
# Toujours dans la partie privée : rien de tout ça n'est montré aux amis.
CHAMPS_TITRE = {"note", "coeur", "vu", "etiquettes", "citations", "detail", "collection", "prive"}
CHAMPS_JOURNAL = {"cle", "date", "note", "revision", "critique", "critique_privee", "ou", "prix", "avec", "version",
                  "prive", "coeur", "approx", "imax"}
CHAMPS_PROFIL = {"nom", "bio", "banniere", "reglages", "accueil", "couleur"}


def maintenant():
    return round(time.time(), 3)


def ecrire_json(chemin, donnees):
    """Écriture atomique (un fichier à moitié écrit ne remplace jamais le bon)."""
    os.makedirs(os.path.dirname(chemin), exist_ok=True)
    tmp = f"{chemin}.{os.getpid()}.{threading.get_ident()}.tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(donnees, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, chemin)


def lire_json(chemin, defaut=None):
    try:
        with open(chemin, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return copy.deepcopy(defaut)


def slug(nom):
    s = nom.lower()
    for a, b in (("àâä", "a"), ("éèêë", "e"), ("îï", "i"), ("ôö", "o"), ("ùûü", "u"), ("ç", "c")):
        for c in a:
            s = s.replace(c, b)
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s or "profil"


def profil_vide(pid, nom):
    d = {"format": FORMAT, "id": pid, "profil": {"nom": nom, "bio": "", "banniere": None, "reglages": {},
                                                  "accueil": None, "maj": maintenant()}}
    for s in SECTIONS:
        d[s] = {}
    return d


# ---------------------------------------------------------------- fusion
def _plus_recente(a, b):
    """L'entrée qui gagne entre deux versions de la même clé."""
    if a is None:
        return b
    if b is None:
        return a
    ma, mb = a.get("maj", 0), b.get("maj", 0)
    if ma != mb:
        return a if ma > mb else b
    if a.get("masque") != b.get("masque"):          # à égalité, la version complète (non expurgée) gagne
        return b if a.get("masque") else a
    return a if json.dumps(a, sort_keys=True) >= json.dumps(b, sort_keys=True) else b


def fusionner(a, b):
    """Fusionne deux copies d'un même profil (aucune n'est modifiée)."""
    if not b:
        return copy.deepcopy(a)
    if not a:
        return copy.deepcopy(b)
    r = copy.deepcopy(a)
    r["profil"] = copy.deepcopy(_plus_recente(a.get("profil"), b.get("profil")))
    for s in SECTIONS:
        sa, sb = r.setdefault(s, {}), b.get(s) or {}
        for k, v in sb.items():
            avant = sa.get(k)
            g = _plus_recente(avant, v)
            if g is v:
                sa[k] = copy.deepcopy(v)
            if s == "titres":
                sa[k] = _completer_titre(sa[k], v if g is avant else avant)
    return r


def _completer_titre(gagnant, autre):
    """Un film : la version la plus récente gagne, mais une information qu'elle ne connaît pas du tout (clé absente,
    par exemple un coup de cœur venu d'un import que l'autre appareil n'a pas fait) est reprise de l'autre version.
    Une valeur posée exprès (coup de cœur retiré = False) reste telle quelle."""
    if not gagnant or not autre or gagnant.get("x") or autre.get("x") or gagnant.get("masque") or autre.get("masque"):
        return gagnant
    manque = {c: v for c, v in autre.items() if c not in gagnant and c not in ("maj", "x")}
    return dict(gagnant, **copy.deepcopy(manque)) if manque else gagnant


# ---------------------------------------------------------------- partie privée
def _est_cache(doc, s, k, v):
    if s in PRIVEES:
        return True
    if v.get("x"):
        return False
    if s == "titres":
        return bool(v.get("prive"))
    if s == "journal":
        t = (doc.get("titres") or {}).get(v.get("cle")) or {}
        return bool(v.get("prive") or t.get("prive"))
    if s == "listes":
        return bool(v.get("privee"))
    return False


def separer(doc):
    """(public, prive) : ce que tes amis peuvent lire, et ce qui reste à toi (films cachés, critiques privées…)."""
    pub = {k: copy.deepcopy(v) for k, v in doc.items() if k not in SECTIONS}
    priv = {"format": FORMAT, "id": doc.get("id")}
    for s in SECTIONS:
        pub[s], priv[s] = {}, {}
        if s in PRIVEES:                        # rien dans la partie publique, pas même les clés
            priv[s] = copy.deepcopy(doc.get(s) or {})
            continue
        for k, v in (doc.get(s) or {}).items():
            if _est_cache(doc, s, k, v):
                priv[s][k] = v
                pub[s][k] = {"x": True, "masque": True, "maj": v.get("maj", 0)}
            elif s == "journal" and v.get("critique_privee") and v.get("critique"):
                priv[s][k] = v
                e = dict(v, critique="", masque=True)
                pub[s][k] = e
            else:
                pub[s][k] = v
    return pub, priv


def _cles(phrase, pid):
    if phrase.startswith("cle:"):                 # clé déjà dérivée d'un mot de passe de compte (voir compte.py)
        base = bytes.fromhex(phrase[4:])
        return base[:32], base[32:]
    base = hashlib.pbkdf2_hmac("sha256", phrase.encode("utf-8"), b"silencio:" + pid.encode("utf-8"), 120_000, 64)
    return base[:32], base[32:]


def _flux(cle, nonce, n):
    sortie, i = bytearray(), 0
    while len(sortie) < n:
        sortie += hmac.new(cle, nonce + i.to_bytes(8, "big"), hashlib.sha256).digest()
        i += 1
    return bytes(sortie[:n])


def chiffrer(donnees, phrase, pid):
    """Chiffre la partie privée avec ta phrase secrète (HMAC-SHA256 en mode compteur + authentification)."""
    k_chif, k_auth = _cles(phrase, pid)
    clair = json.dumps(donnees, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    nonce = secrets.token_bytes(16)
    chif = bytes(a ^ b for a, b in zip(clair, _flux(k_chif, nonce, len(clair))))
    tag = hmac.new(k_auth, nonce + chif, hashlib.sha256).digest()
    return {"format": FORMAT, "chiffre": base64.b64encode(nonce + tag + chif).decode("ascii")}


def dechiffrer(enveloppe, phrase, pid):
    """La partie privée en clair, ou None (mauvaise phrase secrète, fichier abîmé)."""
    try:
        brut = base64.b64decode(enveloppe["chiffre"])
    except (KeyError, TypeError, ValueError):
        return None
    nonce, tag, chif = brut[:16], brut[16:48], brut[48:]
    k_chif, k_auth = _cles(phrase, pid)
    if not hmac.compare_digest(tag, hmac.new(k_auth, nonce + chif, hashlib.sha256).digest()):
        return None
    clair = bytes(a ^ b for a, b in zip(chif, _flux(k_chif, nonce, len(chif))))
    try:
        return json.loads(clair.decode("utf-8"))
    except ValueError:
        return None


# ---------------------------------------------------------------- le stock
class Stock:
    """Ton profil, celui de tes amis et les réglages de cet appareil. Toutes les modifications passent par action()."""

    def __init__(self, dossier=None):
        self.dossier = dossier or config.DONNEES
        self.verrou = threading.RLock()
        self.f_appareil = os.path.join(self.dossier, "appareil.json")
        self.appareil = lire_json(self.f_appareil, {}) or {}
        if not self.appareil.get("app"):
            self.appareil["app"] = uuid.uuid4().hex[:10]
            self.sauver_appareil()
        self.doc = None
        self.amis = {}
        self.historique = []                     # [(libellé, [(section, clé, ancienne entrée)]), …]
        self.ecoutes = []                         # fonctions appelées après chaque modification (synchro…)
        self.version = 0                          # augmente à chaque modification (le navigateur se met à jour)
        self.charger()

    # ---- fichiers
    @property
    def pid(self):
        return self.appareil.get("profil") or ""

    def _f_profil(self, pid=None):
        return os.path.join(self.dossier, "profils", f"{pid or self.pid}.json")

    def sauver_appareil(self):
        with self.verrou:
            ecrire_json(self.f_appareil, self.appareil)

    def charger(self):
        with self.verrou:
            self.doc = lire_json(self._f_profil()) if self.pid else None
            if self.doc:
                for s in SECTIONS:
                    self.doc.setdefault(s, {})
            self.amis = {}
            dossier = os.path.join(self.dossier, "amis")
            if os.path.isdir(dossier):
                for f in sorted(os.listdir(dossier)):
                    if f.endswith(".json") and f[:-5] != self.pid:
                        d = lire_json(os.path.join(dossier, f))
                        if d and d.get("id"):
                            self.amis[d["id"]] = d
            self.version += 1

    def sauver(self):
        with self.verrou:
            if self.doc:
                ecrire_json(self._f_profil(), self.doc)

    def choisir_profil(self, pid, nom=None, doc=None):
        """Ce téléphone / cet ordinateur devient celui de ce profil (existant, venu de GitHub, ou nouveau)."""
        with self.verrou:
            pid = slug(pid)
            self.appareil["profil"] = pid
            self.sauver_appareil()
            existant = lire_json(self._f_profil(pid))
            base = existant or doc or self.amis.get(pid) or profil_vide(pid, nom or pid)
            if doc and existant:
                base = fusionner(existant, doc)
            base["id"] = pid
            for s in SECTIONS:
                base.setdefault(s, {})
            if nom and not existant and not doc:
                base["profil"]["nom"] = nom
            self.doc = base
            self.amis.pop(pid, None)
            self.historique = []
            self.sauver()
            self.version += 1
            return self.doc

    def enregistrer_ami(self, doc):
        with self.verrou:
            if not doc or not doc.get("id") or doc["id"] == self.pid:
                return
            self.amis[doc["id"]] = doc
            ecrire_json(os.path.join(self.dossier, "amis", f"{doc['id']}.json"), doc)
            self.version += 1

    def integrer(self, autre):
        """Fusionne une autre copie de ton propre profil (venue de GitHub, d'un import…)."""
        with self.verrou:
            if not self.doc or not autre:
                return False
            avant = json.dumps(self.doc, sort_keys=True)
            self.doc = fusionner(self.doc, autre)
            self.doc["id"] = self.pid
            if json.dumps(self.doc, sort_keys=True) == avant:
                return False
            self.sauver()
            self.version += 1
            return True

    # ---- modifications
    def _poser(self, trace, section, cle, entree):
        ancien = self.doc[section].get(cle)
        trace.append((section, cle, copy.deepcopy(ancien)))
        entree = dict(entree)
        entree["maj"] = max(maintenant(), (ancien or {}).get("maj", 0) + 0.001)
        entree.pop("masque", None)
        self.doc[section][cle] = entree
        return entree

    def _supprimer(self, trace, section, cle):
        if cle in self.doc[section] and not self.doc[section][cle].get("x"):
            self._poser(trace, section, cle, {"x": True})

    def titre(self, cle):
        t = self.doc["titres"].get(cle)
        return {} if not t or t.get("x") else dict(t)

    def action(self, type_, d):
        """Applique une action du navigateur. Renvoie {"modifs": [[section, clé, entrée]], "tmdb": [...]}."""
        with self.verrou:
            if not self.doc:
                raise ValueError("Aucun profil choisi sur cet appareil.")
            if type_ == "annuler":
                return self.annuler()
            trace, tmdb = [], []
            libelle = getattr(self, "_a_" + type_)(trace, tmdb, d)
            if not trace:
                return {"modifs": [], "tmdb": []}
            if type_ not in ("duels",):                  # la progression des duels ne s'« annule » pas
                self.historique.append((libelle or type_, trace, time.time()))
                del self.historique[:-60]
            self.sauver()
            self.version += 1
            return {"modifs": [[s, k, self.doc[s].get(k) if s != "profil" else self.doc["profil"]]
                               for s, k, _ in trace], "tmdb": tmdb}

    def annuler(self):
        if not self.historique:
            return {"modifs": [], "tmdb": [], "libelle": ""}
        libelle, trace, _ = self.historique.pop()
        modifs, tmdb = [], []
        for s, k, ancien in reversed(trace):
            if s == "profil":
                self.doc["profil"] = dict(ancien, maj=maintenant())
                modifs.append([s, k, self.doc["profil"]])
                continue
            entree = dict(ancien) if ancien else {"x": True}
            entree["maj"] = max(maintenant(), self.doc[s].get(k, {}).get("maj", 0) + 0.001)
            self.doc[s][k] = entree
            modifs.append([s, k, entree])
            if s == "titres":
                tmdb += [("note", k, entree.get("note") if not entree.get("x") else None),
                         ("favori", k, bool(entree.get("coeur")))]
            elif s == "watchlist":
                tmdb.append(("watchlist", k, not entree.get("x")))
        self.sauver()
        self.version += 1
        return {"modifs": modifs, "tmdb": tmdb, "libelle": libelle}

    def poser_miroirs(self, entrees):
        """Note ce qui est désormais présent (valeur) ou absent (None) sur une plateforme. Hors historique d'annulation."""
        with self.verrou:
            if not self.doc or not entrees:
                return
            m = self.doc.setdefault("miroirs", {})
            t = maintenant()
            for k, v in entrees.items():
                ancien = m.get(k) or {}
                maj = max(t, ancien.get("maj", 0) + 0.001)
                m[k] = {"x": True, "maj": maj} if v is None else {"v": v, "maj": maj}
            self.sauver()

    def journal_recent(self):
        return [{"libelle": l, "quand": q, "n": len(t)} for l, t, q in reversed(self.historique[-30:])]

    # ---- les actions (une méthode par type)
    def _maj_titre(self, trace, cle, **champs):
        t = self.titre(cle)
        t.update(champs)
        return self._poser(trace, "titres", cle, t)

    def _a_noter(self, trace, tmdb, d):
        cle, note = d["cle"], _note(d.get("note"))
        champs = {"note": note}
        if note is not None:
            champs["vu"] = True
        self._maj_titre(trace, cle, **champs)
        tmdb.append(("note", cle, note))
        if note is not None and self._dans_watchlist(cle):
            self._supprimer(trace, "watchlist", cle)
            tmdb.append(("watchlist", cle, False))
        return "Note" if note is not None else "Note retirée"

    def _a_coeur(self, trace, tmdb, d):
        self._maj_titre(trace, d["cle"], coeur=bool(d.get("val")))
        tmdb.append(("favori", d["cle"], bool(d.get("val"))))
        return "Coup de cœur"

    def _a_vu(self, trace, tmdb, d):
        cle, val = d["cle"], bool(d.get("val", True))
        if val:
            self._maj_titre(trace, cle, vu=True)
            if self._dans_watchlist(cle):
                self._supprimer(trace, "watchlist", cle)
                tmdb.append(("watchlist", cle, False))
        else:
            self._maj_titre(trace, cle, vu=False, note=None)
            tmdb.append(("note", cle, None))
        return "Marqué vu" if val else "Marqué pas vu"

    def _a_titre(self, trace, tmdb, d):
        champs = {k: v for k, v in (d.get("champs") or {}).items() if k in CHAMPS_TITRE}
        if "note" in champs:
            champs["note"] = _note(champs["note"])
            tmdb.append(("note", d["cle"], champs["note"]))
        if "coeur" in champs:
            tmdb.append(("favori", d["cle"], bool(champs["coeur"])))
        self._maj_titre(trace, d["cle"], **champs)
        return "Fiche du film"

    def _dans_watchlist(self, cle):
        w = self.doc["watchlist"].get(cle)
        return bool(w and not w.get("x"))

    def _a_journal(self, trace, tmdb, d):
        e = {k: v for k, v in (d.get("entree") or {}).items() if k in CHAMPS_JOURNAL}
        cle = e.get("cle")
        if not cle:
            raise ValueError("Visionnage sans film.")
        jid = (d.get("entree") or {}).get("id") or ("j" + uuid.uuid4().hex[:12])
        ancien = self.doc["journal"].get(jid)
        nouveau = jid not in self.doc["journal"] or (ancien or {}).get("x")
        e["note"] = _note(e.get("note"))
        e["date"] = (e.get("date") or time.strftime("%Y-%m-%d"))[:10]
        if "revision" not in e:
            e["revision"] = self._deja_vu(cle, jid, e["date"])
        if ancien and not ancien.get("x"):
            e = dict({k: v for k, v in ancien.items() if k not in ("maj",)}, **e)
        self._poser(trace, "journal", jid, e)
        champs = {"vu": True}
        if e["note"] is not None and self._derniere_date(cle, jid) <= e["date"]:
            champs["note"] = e["note"]
            tmdb.append(("note", cle, e["note"]))
        # coup de cœur : posé par le visionnage ; retiré seulement si tu l'as décoché toi-même dans le formulaire
        # (un visionnage modifié ne retire plus le cœur d'un film aimé ailleurs)
        choisi = (d.get("entree") or {}).get("coeur_choisi")
        if e.get("coeur") and not self.titre(cle).get("coeur"):
            champs["coeur"] = True
            tmdb.append(("favori", cle, True))
        elif e.get("coeur") is False and self.titre(cle).get("coeur") and (choisi or (ancien or {}).get("coeur")):
            champs["coeur"] = False
            tmdb.append(("favori", cle, False))
        self._maj_titre(trace, cle, **champs)
        if self._dans_watchlist(cle):
            self._supprimer(trace, "watchlist", cle)
            tmdb.append(("watchlist", cle, False))
        return "Visionnage ajouté" if nouveau else "Visionnage modifié"

    def _deja_vu(self, cle, sauf, date):
        if self.titre(cle).get("vu"):
            return True
        return any(v.get("cle") == cle and not v.get("x") and k != sauf and v.get("date", "") <= date
                   for k, v in self.doc["journal"].items())

    def _derniere_date(self, cle, sauf):
        dates = [v.get("date", "") for k, v in self.doc["journal"].items()
                 if v.get("cle") == cle and not v.get("x") and k != sauf]
        return max(dates) if dates else ""

    def _a_suppr_journal(self, trace, tmdb, d):
        e = self.doc["journal"].get(d["id"]) or {}
        self._supprimer(trace, "journal", d["id"])
        cle = e.get("cle")
        if cle and not any(v.get("cle") == cle and not v.get("x") for v in self.doc["journal"].values()):
            # plus aucun visionnage : le film quitte ton profil (et donc tes plateformes)
            self._retirer_titre(trace, tmdb, cle, garder_watchlist=True)
            return "Visionnage supprimé, film retiré de ton profil"
        return "Visionnage supprimé"

    def _retirer_titre(self, trace, tmdb, cle, garder_watchlist=False):
        t = self.doc["titres"].get(cle)
        if t and not t.get("x"):
            if t.get("note") is not None:
                tmdb.append(("note", cle, None))
            if t.get("coeur"):
                tmdb.append(("favori", cle, False))
            garder = {k: v for k, v in t.items() if k in ("collection",) and v}
            if garder:
                # sa place dans ta collection reste ; note, cœur et « vu » sont effacés explicitement (pour les retraits)
                self._poser(trace, "titres", cle, dict(garder, note=None, coeur=False, vu=False))
            else:
                self._supprimer(trace, "titres", cle)
        if not garder_watchlist and self._dans_watchlist(cle):
            self._supprimer(trace, "watchlist", cle)
            tmdb.append(("watchlist", cle, False))

    def _a_suppr_titre(self, trace, tmdb, d):
        """Retire un film de ton profil : tous ses visionnages, sa note, son coup de cœur, sa watchlist."""
        cle = d["cle"]
        for k, v in list(self.doc["journal"].items()):
            if v.get("cle") == cle and not v.get("x"):
                self._supprimer(trace, "journal", k)
        self._retirer_titre(trace, tmdb, cle)
        if cle in (self.doc.get("series") or {}) and not self.doc["series"][cle].get("x"):
            self._supprimer(trace, "series", cle)
        return "Film retiré de ton profil"

    def _a_watchlist(self, trace, tmdb, d):
        cle = d["cle"]
        if d.get("val", True):
            ancien = self.doc["watchlist"].get(cle) or {}
            if ancien and not ancien.get("x"):
                return ""
            self._poser(trace, "watchlist", cle, {"ajout": time.strftime("%Y-%m-%d"), "note": d.get("note", "")})
        else:
            self._supprimer(trace, "watchlist", cle)
        tmdb.append(("watchlist", cle, bool(d.get("val", True))))
        return "Watchlist"

    def _a_watchlist_prio(self, trace, tmdb, d):
        """Marque un titre de la watchlist « à voir en premier » (toujours en tête)."""
        w = self.doc["watchlist"].get(d["cle"])
        if not w or w.get("x"):
            return ""
        self._poser(trace, "watchlist", d["cle"], dict({k: v for k, v in w.items() if k != "maj"}, prio=bool(d.get("val"))))
        return "Priorité"

    def _a_liste(self, trace, tmdb, d):
        l = dict(d.get("liste") or {})
        lid = l.get("id") or ("l" + uuid.uuid4().hex[:10])
        ancien = self.doc["listes"].get(lid) or {}
        e = {"nom": l.get("nom", ancien.get("nom", "Nouvelle liste"))[:120],
             "description": l.get("description", ancien.get("description", ""))[:2000],
             "classee": bool(l.get("classee", ancien.get("classee", False))),
             "privee": bool(l.get("privee", ancien.get("privee", False))),
             "items": list(dict.fromkeys(l.get("items", ancien.get("items", [])))),
             "cree": ancien.get("cree") or time.strftime("%Y-%m-%d"),
             "epinglee": bool(l.get("epinglee", ancien.get("epinglee", False)))}
        auto = l.get("auto", ancien.get("auto"))
        if auto:
            e["auto"] = auto                      # liste automatique (cinéma, VO…) tenue à jour par Silencio
        self._poser(trace, "listes", lid, e)
        tmdb.append(("liste", lid, None))
        return "Liste « " + e["nom"] + " »"

    def _a_liste_item(self, trace, tmdb, d):
        lid, cle = d["id"], d["cle"]
        l = self.doc["listes"].get(lid)
        if not l or l.get("x"):
            raise ValueError("Liste introuvable.")
        items = [i for i in l.get("items", []) if i != cle]
        if d.get("val", True):
            items.append(cle)
        self._poser(trace, "listes", lid, dict(l, items=items))
        tmdb.append(("liste", lid, None))
        return "Liste « " + l.get("nom", "") + " »"

    def _a_suppr_liste(self, trace, tmdb, d):
        self._supprimer(trace, "listes", d["id"])
        tmdb.append(("liste", d["id"], None))
        return "Liste supprimée"

    def _a_classement(self, trace, tmdb, d):
        self._poser(trace, "classements", str(d["pid"]), {"items": list(dict.fromkeys(d.get("items") or []))})
        return "Classement"

    def _a_favori(self, trace, tmdb, d):
        p = d.get("personne") or {}
        pid = str(p.get("id") or d.get("pid"))
        if d.get("val", True):
            self._poser(trace, "favoris", pid, {"nom": p.get("nom", ""), "photo": p.get("photo"),
                                                "metier": p.get("metier", ""), "ajout": time.strftime("%Y-%m-%d")})
        else:
            self._supprimer(trace, "favoris", pid)
        return "Personne favorite"

    def _serie(self, cle):
        s = self.doc["series"].get(cle)
        return {"episodes": [], "saisons": {}} if not s or s.get("x") else copy.deepcopy(s)

    def _a_episodes(self, trace, tmdb, d):
        """Coche / décoche des épisodes : d = {cle, episodes: ["1x3", …], val}."""
        s = self._serie(d["cle"])
        vus = set(s.get("episodes", []))
        for ep in d.get("episodes") or []:
            (vus.add if d.get("val", True) else vus.discard)(ep)
        s["episodes"] = sorted(vus, key=_ordre_episode)
        s["derniere"] = maintenant()
        self._poser(trace, "series", d["cle"], s)
        if d.get("val", True):
            self._maj_titre(trace, d["cle"], vu=True)
            if self._dans_watchlist(d["cle"]):
                self._supprimer(trace, "watchlist", d["cle"])
                tmdb.append(("watchlist", d["cle"], False))
        return "Épisodes"

    def _a_note_saison(self, trace, tmdb, d):
        s = self._serie(d["cle"])
        s.setdefault("saisons", {})[str(d["saison"])] = _note(d.get("note"))
        self._poser(trace, "series", d["cle"], s)
        return "Note de saison"

    def _a_profil(self, trace, tmdb, d):
        champs = {k: v for k, v in (d.get("champs") or {}).items() if k in CHAMPS_PROFIL}
        ancien = copy.deepcopy(self.doc["profil"])
        trace.append(("profil", "", ancien))
        p = dict(ancien, **champs)
        if "reglages" in champs:
            p["reglages"] = dict(ancien.get("reglages") or {}, **(champs["reglages"] or {}))
        p["maj"] = max(maintenant(), ancien.get("maj", 0) + 0.001)
        self.doc["profil"] = p
        return "Profil"

    def _a_abonnement(self, trace, tmdb, d):
        """Abonnement cinéma (Pathé, UGC…) : prix par mois, premier et dernier mois payés, mois non payés."""
        aid = d.get("id") or ("a" + uuid.uuid4().hex[:8])
        if d.get("suppr"):
            self._supprimer(trace, "abonnements", aid)
            return "Abonnement retiré"
        a = d.get("abonnement") or {}
        self._poser(trace, "abonnements", aid, {"nom": str(a.get("nom") or "Abonnement")[:60], "prix": float(a.get("prix") or 0),
                                                "debut": str(a.get("debut") or "")[:7], "fin": str(a.get("fin") or "")[:7],
                                                "sauf": [m for m in a.get("sauf") or [] if isinstance(m, str)][:240]})
        return "Abonnement enregistré"

    def _a_duels(self, trace, tmdb, d):
        """Progression du classement par duels d'une liste (comparaisons faites), reprise à tout moment."""
        lid = d["liste"]
        if d.get("suppr"):
            self._supprimer(trace, "duels", lid)
            return "Duels effacés"
        self._poser(trace, "duels", lid, {"c": [list(x)[:3] for x in (d.get("comparaisons") or [])][-3000:]})
        return "Duels"

    def _a_graphique(self, trace, tmdb, d):
        g = dict(d.get("graphique") or {})
        gid = g.pop("id", None) or ("g" + uuid.uuid4().hex[:10])
        self._poser(trace, "graphiques", gid, g)
        return "Graphique épinglé"

    def _a_suppr_graphique(self, trace, tmdb, d):
        self._supprimer(trace, "graphiques", d["id"])
        return "Graphique retiré"

    def _a_annee(self, trace, tmdb, d):
        """Corrige la liste automatique « Vu en … » : ajoute (val=True) ou retire (val=False) un film."""
        k = f"{int(d['annee'])}|{d['cle']}"
        if d.get("val") is None:
            self._supprimer(trace, "annees", k)
        else:
            self._poser(trace, "annees", k, {"val": bool(d["val"])})
        return f"Vu en {d['annee']}"

    def _a_import(self, trace, tmdb, d):
        """Ajoute en bloc des entrées importées (Letterboxd, IMDb, TMDB, Twin Picks) sans écraser plus récent."""
        for s, entrees in (d.get("sections") or {}).items():
            if s not in SECTIONS:
                continue
            for k, e in entrees.items():
                ancien = self.doc[s].get(k)
                if ancien and not ancien.get("x"):
                    if s == "titres":
                        fusion = dict(e, **{c: v for c, v in ancien.items() if v not in (None, [], "", False)})
                        if fusion != {c: v for c, v in ancien.items() if c != "maj"}:
                            self._poser(trace, s, k, {c: v for c, v in fusion.items() if c != "maj"})
                    elif s == "listes":
                        items = list(dict.fromkeys(ancien.get("items", []) + e.get("items", [])))
                        self._poser(trace, s, k, dict({c: v for c, v in ancien.items() if c != "maj"}, items=items))
                    continue
                self._poser(trace, s, k, e)
        return d.get("libelle") or "Import"


def _note(n):
    if n in (None, "", 0):
        return None
    n = float(n)
    n = max(0.5, min(10.0, round(n * 2) / 2))
    return int(n) if n == int(n) else n


def _ordre_episode(ep):
    try:
        s, e = ep.split("x")
        return int(s), int(e)
    except ValueError:
        return 9999, 0
