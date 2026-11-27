"""Synchronisation des profils par GitHub.

Chaque profil est un fichier du dépôt (branche « profils » par défaut) : profils/<id>.json.gz pour ce que les amis
peuvent lire, et profils/<id>.prive pour ta partie privée, chiffrée avec ta phrase secrète (sans phrase secrète, elle
reste sur l'appareil). Chacun écrit avec son propre compte GitHub (un jeton), et lit les fichiers des autres.
Hors ligne, rien ne se perd : on fusionne au retour du réseau (voir stockage.fusionner).
"""
import base64
import gzip
import hashlib
import json
import os
import re
import subprocess
import threading
import time

import config
from reseau import ErreurHTTP, HorsLigne, requete
from stockage import chiffrer, dechiffrer, fusionner, separer, SECTIONS, maintenant
import compte

DOSSIER = "profils"


def depot_par_defaut():
    """Le dépôt du code (variable SILENCIO_DEPOT sur Android, depot.json, ou l'adresse du clone git)."""
    d = os.environ.get("SILENCIO_DEPOT", "").strip()
    if d:
        return d
    try:
        with open(os.path.join(config.RACINE, "depot.json"), encoding="utf-8") as f:
            d = json.load(f).get("github", "")
        if d and "/" in d and not d.startswith("COMPTE/"):
            return d
    except (OSError, ValueError):
        pass
    try:
        url = subprocess.run(["git", "-C", config.RACINE, "config", "--get", "remote.origin.url"], capture_output=True,
                             text=True, timeout=5, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0)).stdout
        m = re.search(r"github\.com[:/]([\w.-]+/[\w.-]+?)(?:\.git)?\s*$", url.strip())
        return m.group(1) if m else ""
    except (OSError, subprocess.SubprocessError):
        return ""


def _gz(donnees):
    return gzip.compress(json.dumps(donnees, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
                         .encode("utf-8"), mtime=0)


def _empreinte(donnees):
    return hashlib.sha1(json.dumps(donnees, sort_keys=True, ensure_ascii=False).encode("utf-8")).hexdigest()


class Synchro:
    def __init__(self, stock):
        self.stock = stock
        self.verrou = threading.Lock()
        self.reveil = threading.Event()
        self.etat = {"en_cours": False, "derniere": 0, "erreur": "", "amis": 0, "envoye": 0}
        self._minuteur = None
        self._branche_ok = False

    # ---- réglages
    @property
    def reglages(self):
        g = dict(self.stock.appareil.get("github") or {})
        g.setdefault("depot", depot_par_defaut())
        g.setdefault("branche", "profils")
        return g

    @property
    def active(self):
        g = self.reglages
        return bool(g.get("depot") and g.get("jeton"))

    def _memo(self):
        return self.stock.appareil.setdefault("sync", {})

    def _api(self, methode, chemin, corps=None, brut=False, params=None, accept=None):
        g = self.reglages
        h = {"Accept": accept or "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}
        if g.get("jeton"):
            h["Authorization"] = "Bearer " + g["jeton"].strip()
        return requete(config.API_GITHUB + chemin, methode, params=params, corps=corps, entetes=h, brut=brut, delai=30)

    # ---- fichiers du dépôt
    def _assurer_branche(self):
        if self._branche_ok:
            return
        g = self.reglages
        try:
            self._api("GET", f"/repos/{g['depot']}/branches/{g['branche']}")
        except ErreurHTTP as e:
            if e.code != 404:
                raise
            info = self._api("GET", f"/repos/{g['depot']}")
            base = self._api("GET", f"/repos/{g['depot']}/git/ref/heads/{info.get('default_branch', 'main')}")
            self._api("POST", f"/repos/{g['depot']}/git/refs",
                      {"ref": f"refs/heads/{g['branche']}", "sha": base["object"]["sha"]})
        self._branche_ok = True

    def _lister(self):
        g = self.reglages
        try:
            r = self._api("GET", f"/repos/{g['depot']}/contents/{DOSSIER}", params={"ref": g["branche"]})
        except ErreurHTTP as e:
            if e.code == 404:
                return {}
            raise
        return {f["name"]: f["sha"] for f in r if f.get("type") == "file"}

    def _lire(self, nom, ref=None):
        g = self.reglages
        return self._api("GET", f"/repos/{g['depot']}/contents/{DOSSIER}/{nom}", brut=True,
                         params={"ref": ref or g["branche"]}, accept="application/vnd.github.raw+json")

    def _ecrire(self, nom, octets, sha, message):
        g = self.reglages
        corps = {"message": message, "content": base64.b64encode(octets).decode("ascii"), "branch": g["branche"]}
        if sha:
            corps["sha"] = sha
        r = self._api("PUT", f"/repos/{g['depot']}/contents/{DOSSIER}/{nom}", corps)
        return r["content"]["sha"]

    # ---- un cycle complet
    def cycle(self):
        """Lit les profils des amis, fusionne les modifications de tes autres appareils, puis envoie les tiennes."""
        if not self.active:
            return False
        with self.verrou:
            self.etat.update(en_cours=True, erreur="")
            try:
                for _ in range(3):
                    if self._un_cycle():
                        break
                self.etat["derniere"] = time.time()
                return True
            except HorsLigne:
                self.etat["erreur"] = "hors ligne : synchro au retour du réseau"
            except ErreurHTTP as e:
                self.etat["erreur"] = {401: "jeton GitHub refusé (expiré ou régénéré) : colle le nouveau dans Réglages, Amis et synchro",
                                       403: "le jeton GitHub n'a pas le droit d'écrire dans ce dépôt (Contents : Read and write)",
                                       404: "dépôt introuvable (ou jeton sans accès)"}.get(e.code, f"GitHub : {e}")
            except Exception as e:  # noqa: BLE001
                self.etat["erreur"] = f"synchro : {e}"[:200]
            finally:
                self.etat["en_cours"] = False
                self.stock.sauver_appareil()
            return False

    def _un_cycle(self):
        self._assurer_branche()
        memo = self._memo()
        pid = self.stock.pid
        g = self.reglages
        fichiers = self._lister()
        shas_amis = memo.setdefault("amis", {})
        for nom, sha in fichiers.items():
            if not nom.endswith(".json.gz"):
                continue
            ident = nom[:-8]
            if ident == pid or shas_amis.get(ident) == sha:
                continue
            try:
                d = json.loads(gzip.decompress(self._lire(nom)).decode("utf-8"))
            except (ValueError, OSError):
                continue
            d["id"] = ident
            self.stock.enregistrer_ami(d)
            shas_amis[ident] = sha
        self.etat["amis"] = len([n for n in fichiers if n.endswith(".json.gz") and n[:-8] != pid])
        if not pid or not self.stock.doc:
            return True
        f_pub, f_priv = f"{pid}.json.gz", f"{pid}.prive"
        sha_pub, sha_priv = fichiers.get(f_pub), fichiers.get(f_priv)
        if sha_pub and sha_pub != memo.get("sha_pub"):                    # un autre appareil a écrit
            distant = json.loads(gzip.decompress(self._lire(f_pub)).decode("utf-8"))
            self.stock.integrer(distant)
            memo["sha_pub"] = sha_pub
        cpt = self.stock.appareil.get("compte") or {}
        phrase = cpt.get("cle") if cpt.get("id") == pid else (g.get("phrase") or "")
        if phrase and sha_priv and sha_priv != memo.get("sha_priv"):
            env = json.loads(gzip.decompress(self._lire(f_priv)).decode("utf-8"))
            priv = dechiffrer(env, phrase, pid)
            if priv is None:
                self.etat["erreur"] = ("mot de passe changé sur un autre appareil : reconnecte-toi" if cpt.get("cle")
                                       else "phrase secrète différente de celle de tes autres appareils")
                return True                       # surtout ne rien réécrire par-dessus
            compte.recevoir_secrets(self.stock, priv.pop("compte", None))
            self.stock.integrer(priv)
            memo["sha_priv"] = sha_priv
        with self.stock.verrou:
            pub, priv = separer(self.stock.doc)
        if cpt.get("cle") and cpt.get("id") == pid:
            priv["compte"] = compte.secrets(self.stock)          # réglages du compte, chiffrés avec le reste
        nom_aff = (self.stock.doc.get("profil") or {}).get("nom", pid)
        try:
            if _empreinte(pub) != memo.get("emp_pub") or not sha_pub:
                memo["sha_pub"] = self._ecrire(f_pub, _gz(pub), sha_pub, f"{nom_aff} : mise à jour")
                memo["emp_pub"] = _empreinte(pub)
                self.etat["envoye"] = time.time()
            if phrase and (_empreinte(priv) != memo.get("emp_priv") or not sha_priv):
                memo["sha_priv"] = self._ecrire(f_priv, _gz(chiffrer(priv, phrase, pid)), sha_priv,
                                                f"{nom_aff} : partie privée")
                memo["emp_priv"] = _empreinte(priv)
        except ErreurHTTP as e:
            if e.code in (409, 422):                     # quelqu'un a écrit entre-temps : on recommence
                memo.pop("sha_pub", None)
                return False
            raise
        return True

    # ---- boucle de fond
    def demarrer(self):
        threading.Thread(target=self._boucle, daemon=True).start()

    def _boucle(self):
        time.sleep(1.5)
        while True:
            if self.active:
                self.cycle()
            self.reveil.wait(300)
            self.reveil.clear()

    def demander(self, delai=12):
        """Une synchro dans « delai » secondes (les modifications rapprochées partent ensemble)."""
        if self._minuteur:
            self._minuteur.cancel()
        self._minuteur = threading.Timer(delai, self.reveil.set)
        self._minuteur.daemon = True
        self._minuteur.start()

    # ---- historique GitHub
    def versions(self):
        g = self.reglages
        pid = self.stock.pid
        r = self._api("GET", f"/repos/{g['depot']}/commits",
                      params={"path": f"{DOSSIER}/{pid}.json.gz", "sha": g["branche"], "per_page": 40})
        return [{"sha": c["sha"], "date": c["commit"]["committer"]["date"], "message": c["commit"]["message"]}
                for c in r]

    def restaurer(self, sha):
        """Revient à une ancienne version de ton profil (partie publique) : elle devient la plus récente."""
        ancien = json.loads(gzip.decompress(self._lire(f"{self.stock.pid}.json.gz", ref=sha)).decode("utf-8"))
        with self.stock.verrou:
            doc = self.stock.doc
            t = maintenant() + 1
            for s in SECTIONS:
                a = ancien.get(s) or {}
                for k, v in list(doc[s].items()):
                    if k not in a and not v.get("x") and not v.get("prive") and not v.get("privee"):
                        doc[s][k] = {"x": True, "maj": t}
                for k, v in a.items():
                    if v.get("masque"):
                        continue
                    doc[s][k] = dict(v, maj=t)
            doc["profil"] = dict(ancien.get("profil") or doc["profil"], maj=t)
            self.stock.historique = []
            self.stock.sauver()
            self.stock.version += 1
        self.demander(1)
        return True


__all__ = ["Synchro", "depot_par_defaut", "fusionner"]
