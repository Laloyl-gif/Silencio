"""Démarrage de Silencio sur Android (appelé par MainActivity).

1. Mise à jour : la dernière version de Silencio est téléchargée depuis le dépôt GitHub si elle a changé (hors ligne,
   on garde la dernière version téléchargée).
2. Le serveur de Silencio démarre sur le téléphone (127.0.0.1) ; l'application l'affiche en plein écran.
Ton profil, les caches et les affiches sont dans donnees/ : une mise à jour ne les efface jamais.
"""
import io
import json
import os
import shutil
import sys
import urllib.parse
import urllib.request
import zipfile

MESSAGE = "Démarrage…"
_URL = None
_APP = None


def message():
    return MESSAGE


def _dire(m):
    global MESSAGE
    MESSAGE = m


def _lire(url, delai):
    req = urllib.request.Request(url, headers={"User-Agent": "Silencio-Android"})
    with urllib.request.urlopen(req, timeout=delai) as r:
        return r.read()


def _derniere_version(depot):
    """Identifiant de la dernière version en ligne (le commit de main), ou None hors ligne."""
    try:
        return json.loads(_lire(f"https://api.github.com/repos/{depot}/commits/main", 8))["sha"]
    except Exception:  # noqa: BLE001
        pass
    try:
        return "v:" + _lire(f"https://raw.githubusercontent.com/{depot}/main/VERSION", 8).decode().strip()
    except Exception:  # noqa: BLE001
        return None


def mettre_a_jour(base, depot):
    code = os.path.join(base, "code")
    fichier = os.path.join(base, "version.json")
    try:
        with open(fichier, encoding="utf-8") as f:
            actuelle = json.load(f).get("version")
    except (OSError, ValueError):
        actuelle = None
    present = os.path.isfile(os.path.join(code, "main.py"))
    if not depot:
        if present:
            return code
        raise RuntimeError("Application construite sans adresse de dépôt : reconstruis-la avec GitHub Actions.")
    _dire("Recherche de la dernière version…")
    version = _derniere_version(depot)
    if version is None:
        if present:
            _dire("Hors ligne : dernière version téléchargée")
            return code
        raise RuntimeError("Pas d'Internet : la première ouverture a besoin d'Internet pour télécharger Silencio.")
    if present and version == actuelle:
        return code
    _dire("Téléchargement de la dernière version…")
    ref = version if not version.startswith("v:") else "refs/heads/main"
    data = _lire(f"https://codeload.github.com/{depot}/zip/{ref}", 90)
    _dire("Installation…")
    tmp = code + ".nouveau"
    shutil.rmtree(tmp, ignore_errors=True)
    with zipfile.ZipFile(io.BytesIO(data)) as z:
        z.extractall(tmp)
    dossiers = [d for d in os.listdir(tmp) if os.path.isdir(os.path.join(tmp, d))]
    racine = os.path.join(tmp, dossiers[0]) if len(dossiers) == 1 else tmp
    shutil.rmtree(code, ignore_errors=True)
    shutil.move(racine, code)
    shutil.rmtree(tmp, ignore_errors=True)
    with open(fichier, "w", encoding="utf-8") as f:
        json.dump({"version": version}, f)
    return code


def nouvelle_appli(depot, numero):
    """L'adresse de la nouvelle application (APK) si GitHub en a construit une plus récente, sinon « »."""
    if not depot:
        return ""
    base = f"https://github.com/{depot}/releases/download/application"
    try:
        en_ligne = int(_lire(f"{base}/version.txt", 6).decode().strip())
    except Exception:  # noqa: BLE001
        return ""
    return f"{base}/silencio.apk" if en_ligne > int(numero) else ""


def demarrer(base, depot):
    """L'adresse de la page à afficher (le serveur de Silencio sur ce téléphone)."""
    global _URL, _APP
    if _URL:
        return _URL
    os.environ["SILENCIO_DONNEES"] = os.path.join(base, "donnees")
    os.environ["SILENCIO_DEPOT"] = depot or ""
    code = mettre_a_jour(base, depot)
    if code not in sys.path:
        sys.path.insert(0, code)
    os.chdir(code)
    _dire("Ouverture de Silencio…")
    import main
    res = main.demarrer_serveur()
    if res is None:
        raise RuntimeError("Impossible d'ouvrir Silencio (port local occupé).")
    _APP, port, _ = res
    _URL = f"http://127.0.0.1:{port}/"
    return _URL


def notifications(depuis):
    """Les notifications apparues depuis « depuis » (secondes), en JSON : [{titre, texte, lien, date}]."""
    if _APP is None:
        return "[]"
    try:
        return json.dumps([{k: n.get(k) for k in ("titre", "texte", "lien", "date")}
                           for n in _APP.notifs.nouvelles(float(depuis or 0))], ensure_ascii=False)
    except Exception:  # noqa: BLE001
        return "[]"


def lien_partage(texte):
    """Un lien IMDb, Letterboxd ou TMDB partagé vers Silencio : la page à ouvrir (« #/titre/m:123 »), ou « »."""
    import re
    texte = texte or ""
    m = re.search(r"themoviedb\.org/(movie|tv)/(\d+)", texte)
    if m:
        return f"#/titre/{'m' if m.group(1) == 'movie' else 't'}:{m.group(2)}"
    m = re.search(r"(tt\d{6,9})", texte)
    if m and _APP is not None:
        try:
            c = _APP.tmdb.trouver_imdb(m.group(1))
            if c:
                return "#/titre/" + c
        except Exception:  # noqa: BLE001
            pass
    m = re.search(r"letterboxd\.com/film/([\w-]+)", texte)
    if m:
        return "#/recherche?q=" + urllib.parse.quote(m.group(1).replace("-", " "))
    return ""
