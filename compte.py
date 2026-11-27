"""Comptes Silencio : un identifiant et un mot de passe.

Le mot de passe ne quitte jamais l'appareil et n'est jamais enregistré : on en dérive une clé (PBKDF2, 400 000 tours)
qui chiffre la partie privée de ton profil sur GitHub. Cette partie privée contient aussi les réglages de ton compte
(jeton GitHub, clé Refract, pseudos Letterboxd et IMDb) : sur un nouvel appareil, se connecter suffit à tout retrouver.
Un appareil reste connecté jusqu'à ce que tu te déconnectes (seule la clé dérivée y est gardée).
"""
import gzip
import hashlib
import os
import json
import re
import time

from reseau import ErreurHTTP, HorsLigne
from stockage import dechiffrer, fusionner, slug, maintenant

ITERATIONS = 400_000
# réglages du compte qui voyagent (chiffrés) d'un appareil à l'autre
CHAMPS_SECRETS = ("jeton_github", "refract_cle", "letterboxd_pseudo", "imdb_pseudo", "imdb_watchlist")


def deriver(pid, mot_de_passe):
    base = hashlib.pbkdf2_hmac("sha256", mot_de_passe.encode("utf-8"), b"silencio-compte:" + pid.encode("utf-8"),
                               ITERATIONS, 64)
    return "cle:" + base.hex()


def valider_identifiant(ident):
    pid = slug(ident or "")
    if not re.fullmatch(r"[a-z0-9][a-z0-9_-]{2,30}", pid):
        raise ValueError("Identifiant : 3 à 31 lettres minuscules, chiffres, tirets.")
    return pid


def valider_mot_de_passe(mdp):
    if len(mdp or "") < 10:
        raise ValueError("Mot de passe : 10 caractères au moins (il protège aussi tes clés Refract et GitHub).")
    return mdp


def secrets(stock):
    return dict(stock.appareil.get("secrets_compte") or {})


def poser_secrets(stock, valeurs, maj=None):
    """Met à jour les réglages du compte (ils partiront chiffrés à la prochaine synchro)."""
    s = secrets(stock)
    change = False
    for k in CHAMPS_SECRETS:
        if k in valeurs and valeurs[k] is not None and s.get(k) != valeurs[k]:
            s[k] = valeurs[k]
            change = True
    if change or maj:
        s["maj"] = maj or maintenant()
        stock.appareil["secrets_compte"] = s
        appliquer_localement(stock, s)
    return change


def appliquer_localement(stock, s):
    """Les réglages du compte deviennent ceux de cet appareil."""
    app = stock.appareil
    if s.get("jeton_github"):
        g = dict(app.get("github") or {})
        g["jeton"] = s["jeton_github"]
        app["github"] = g
    if s.get("refract_cle"):
        if (app.get("refract") or {}).get("cle") != s["refract_cle"]:
            app["refract"] = {"cle": s["refract_cle"]}
    elif "refract_cle" in s and not s["refract_cle"]:
        app.pop("refract", None)
    if "letterboxd_pseudo" in s:
        app["letterboxd_pseudo"] = s["letterboxd_pseudo"]
    if "imdb_pseudo" in s:
        app["imdb_pseudo"] = s["imdb_pseudo"]
    if "imdb_watchlist" in s:
        app["imdb_watchlist"] = s["imdb_watchlist"]
    stock.sauver_appareil()


def recevoir_secrets(stock, distants):
    """Réglages du compte lus dans la partie privée (un autre appareil a pu les changer) : le plus récent gagne."""
    if not distants:
        return False
    if (distants.get("maj") or 0) <= (secrets(stock).get("maj") or 0):
        return False
    stock.appareil["secrets_compte"] = dict(distants)
    appliquer_localement(stock, distants)
    return True


def connecte(stock):
    c = stock.appareil.get("compte") or {}
    return bool(c.get("cle") and c.get("id") == stock.pid and stock.pid)


# ---------------------------------------------------------------- création, connexion, déconnexion
def _fichiers_en_ligne(synchro):
    """Les fichiers du dossier des profils sur GitHub, ou None hors ligne / sans dépôt."""
    if not synchro.reglages.get("depot"):
        return None
    try:
        return synchro._lister()
    except (HorsLigne, ErreurHTTP):
        return None


def creer(app, corps):
    """Nouveau compte. Avec « convertir », le profil déjà utilisé sur cet appareil devient un compte (même identifiant,
    mêmes données) : c'est le chemin pour ton profil actuel."""
    stock, synchro = app.stock, app.synchro
    convertir = bool(corps.get("convertir") and stock.doc and not connecte(stock))
    pid = stock.pid if convertir else valider_identifiant(corps.get("identifiant"))
    mdp = valider_mot_de_passe(corps.get("mot_de_passe"))
    nom = (corps.get("nom") or "").strip()[:60] or ((stock.doc or {}).get("profil") or {}).get("nom") or pid
    if corps.get("jeton_github"):
        g = dict(stock.appareil.get("github") or {})
        g["jeton"] = corps["jeton_github"].strip()
        stock.appareil["github"] = g
    fichiers = _fichiers_en_ligne(synchro) or {}
    if not convertir and (f"{pid}.json.gz" in fichiers or f"{pid}.prive" in fichiers or pid in stock.amis):
        raise ValueError("Cet identifiant est déjà pris.")
    garder = None
    if convertir or (corps.get("garder_local") and stock.doc):
        garder = json.loads(json.dumps(stock.doc))
        garder["id"] = pid
    stock.choisir_profil(pid, nom, doc=garder)
    stock.doc["profil"]["nom"] = nom
    stock.doc["profil"]["compte"] = True
    stock.doc["profil"]["maj"] = maintenant()
    stock.sauver()
    stock.appareil["compte"] = {"id": pid, "cle": deriver(pid, mdp), "depuis": time.time()}
    # l'ancienne partie privée (chiffrée par une phrase secrète) est déjà fusionnée ici : on la réécrit avec la clé
    stock.appareil["sync"] = {"sha_priv": fichiers.get(f"{pid}.prive")} if convertir else {}
    g = dict(stock.appareil.get("github") or {})
    g.pop("phrase", None)
    stock.appareil["github"] = g
    if not convertir:
        for k in ("secrets_compte", "miroir_depart", "miroir_echecs", "miroir_passages", "refract_ids", "refract"):
            stock.appareil.pop(k, None)
    valeurs = {k: (corps.get(k) or "").strip() for k in CHAMPS_SECRETS if k != "jeton_github"}
    valeurs["jeton_github"] = (stock.appareil.get("github") or {}).get("jeton", "")
    valeurs["letterboxd_pseudo"] = re.sub(r"[^A-Za-z0-9_]", "", valeurs.get("letterboxd_pseudo", ""))[:40]
    poser_secrets(stock, valeurs, maj=maintenant())
    stock.sauver_appareil()
    synchro.demander(1)
    return pid


def connexion(app, corps):
    stock, synchro = app.stock, app.synchro
    pid = valider_identifiant(corps.get("identifiant"))
    mdp = corps.get("mot_de_passe") or ""
    if not synchro.reglages.get("depot"):
        raise ValueError("Dépôt GitHub inconnu sur cet appareil.")
    try:
        fichiers = synchro._lister()
        if f"{pid}.prive" not in fichiers:
            raise ValueError("Aucun compte avec cet identifiant (ou il n'a pas encore été enregistré en ligne).")
        env = json.loads(gzip.decompress(synchro._lire(f"{pid}.prive")).decode("utf-8"))
        pub = json.loads(gzip.decompress(synchro._lire(f"{pid}.json.gz")).decode("utf-8")) \
            if f"{pid}.json.gz" in fichiers else None
    except HorsLigne:
        raise ValueError("Pas d'Internet : la première connexion sur un appareil en a besoin.") from None
    cle = deriver(pid, mdp)
    priv = dechiffrer(env, cle, pid)
    if priv is None:
        time.sleep(1.5)                            # ralentit les essais au hasard
        raise ValueError("Identifiant ou mot de passe incorrect.")
    distants = priv.pop("compte", None)
    doc = fusionner(pub or {}, priv) if pub else priv
    if corps.get("garder_local") and stock.doc and stock.pid != pid:
        # les films de ce profil sans compte rejoignent le compte (le plus récent gagne, rien n'est perdu)
        local = json.loads(json.dumps(stock.doc))
        local.pop("miroirs", None)
        local.pop("profil", None)
        local["id"] = pid
        doc = fusionner(doc, local)
    doc["id"] = pid
    stock.choisir_profil(pid, (doc.get("profil") or {}).get("nom") or pid, doc=doc)
    stock.appareil["compte"] = {"id": pid, "cle": cle, "depuis": time.time()}
    stock.appareil["sync"] = {}
    for k in ("secrets_compte", "miroir_echecs", "miroir_passages", "refract_ids"):
        stock.appareil.pop(k, None)
    recevoir_secrets(stock, distants)
    stock.sauver_appareil()
    synchro.demander(1)
    return pid


def deconnexion(app):
    """Oublie le compte sur cet appareil. Ses données restent sur GitHub ; la copie locale n'est effacée que si tout
    est déjà en ligne (sinon elle reste, protégée : seule une connexion avec le mot de passe la rouvre)."""
    stock = app.stock
    if app.synchro.active:
        app.synchro.cycle()
    with stock.verrou:
        memo = stock.appareil.get("sync") or {}
        if stock.doc and memo.get("emp_pub") and memo.get("emp_priv") and not app.synchro.etat.get("erreur"):
            try:
                os.remove(stock._f_profil())
            except OSError:
                pass
        for k in ("compte", "secrets_compte", "refract", "refract_ids", "letterboxd_pseudo", "imdb_pseudo",
                  "imdb_watchlist", "imdb_favoris", "miroir_echecs", "miroir_passages", "miroir_depart", "jeton_ext",
                  "file_tmdb", "tmdb"):
            stock.appareil.pop(k, None)
        g = dict(stock.appareil.get("github") or {})
        g.pop("jeton", None)
        g.pop("phrase", None)
        stock.appareil["github"] = g
        stock.appareil["sync"] = {}
        stock.appareil["profil"] = ""
        stock.doc = None
        stock.historique = []
        stock.version += 1
        stock.sauver_appareil()


def changer_mot_de_passe(app, corps):
    stock = app.stock
    if not connecte(stock):
        raise ValueError("Pas de compte connecté.")
    if deriver(stock.pid, corps.get("ancien") or "") != stock.appareil["compte"]["cle"]:
        raise ValueError("Ancien mot de passe incorrect.")
    nouveau = valider_mot_de_passe(corps.get("nouveau"))
    stock.appareil["compte"]["cle"] = deriver(stock.pid, nouveau)
    (stock.appareil.get("sync") or {}).pop("emp_priv", None)      # la partie privée sera réécrite avec la nouvelle clé
    stock.sauver_appareil()
    app.synchro.demander(1)
