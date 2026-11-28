"""Sauvegarde automatique : une copie complète de ton profil chaque semaine sur l'appareil (chiffrée avec la clé de
ton compte quand tu en as un), les 8 dernières gardées, restaurables en un clic."""
import gzip
import json
import os
import time

import config
from stockage import SECTIONS, chiffrer, dechiffrer, maintenant

DOSSIER = os.path.join(config.DONNEES, "sauvegardes")
SEMAINE = 7 * 86400


def _cle(stock):
    c = stock.appareil.get("compte") or {}
    return c.get("cle") or ""


def faire(stock, forcer=False):
    if not stock.doc or not stock.pid:
        return None
    os.makedirs(DOSSIER, exist_ok=True)
    derniere = stock.appareil.get("sauvegarde_t", 0)
    if not forcer and time.time() - derniere < SEMAINE:
        return None
    with stock.verrou:
        doc = json.loads(json.dumps(stock.doc))
    cle = _cle(stock)
    contenu = {"pid": stock.pid, "t": time.time(), "version": config.VERSION,
               **({"chiffre": chiffrer(doc, cle, stock.pid)} if cle else {"doc": doc})}
    nom = time.strftime("%Y-%m-%d-%H%M") + f"-{stock.pid}.json.gz"
    with gzip.open(os.path.join(DOSSIER, nom), "wt", encoding="utf-8") as f:
        json.dump(contenu, f, ensure_ascii=False)
    stock.appareil["sauvegarde_t"] = time.time()
    stock.sauver_appareil()
    for vieux in liste(stock)[8:]:
        try:
            os.remove(os.path.join(DOSSIER, vieux["nom"]))
        except OSError:
            pass
    return nom


def liste(stock):
    if not os.path.isdir(DOSSIER):
        return []
    r = []
    for n in sorted(os.listdir(DOSSIER), reverse=True):
        if n.endswith(f"-{stock.pid}.json.gz"):
            p = os.path.join(DOSSIER, n)
            r.append({"nom": n, "t": os.path.getmtime(p), "taille": os.path.getsize(p)})
    return r


def lire(stock, nom):
    if "/" in nom or "\\" in nom or not nom.endswith(f"-{stock.pid}.json.gz"):
        raise ValueError("Sauvegarde inconnue.")
    with gzip.open(os.path.join(DOSSIER, nom), "rt", encoding="utf-8") as f:
        c = json.load(f)
    if "doc" in c:
        return c["doc"]
    doc = dechiffrer(c["chiffre"], _cle(stock), stock.pid)
    if doc is None:
        raise ValueError("Cette sauvegarde a été chiffrée avec un autre mot de passe : impossible de la relire ici.")
    return doc


def restaurer(stock, nom):
    """Remet le profil dans l'état de la sauvegarde. Tout est daté de maintenant, pour que ce retour en arrière
    gagne aussi sur tes autres appareils (sinon leurs versions plus récentes reviendraient à la synchro).
    Les « miroirs » (ce qui a déjà été envoyé sur Letterboxd, IMDb, Refract) restent ceux d'aujourd'hui."""
    doc = lire(stock, nom)
    faire(stock, forcer=True)                       # on garde l'état actuel au cas où
    t = maintenant()
    with stock.verrou:
        for s in SECTIONS:
            if s == "miroirs":
                continue
            cur, b = stock.doc.setdefault(s, {}), doc.get(s) or {}
            for k in list(cur):
                if k not in b and not cur[k].get("x"):
                    cur[k] = {"x": True, "maj": t}
            for k, v in b.items():
                cur[k] = dict(v, maj=t)
        if doc.get("profil"):
            stock.doc["profil"] = dict(doc["profil"], maj=t)
        stock.sauver()
        stock.version += 1
    return True
