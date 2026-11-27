#!/usr/bin/env python3
"""Publie une nouvelle version de Silencio sur GitHub à partir du .zip reçu.

    python outils/publier_version.py  silencio.zip      (ou : glisser le zip sur publier_version.bat)

Le code du dossier est remplacé par celui du zip (sauf donnees/ et .git), puis git commit + push : le PC (raccourci du
bureau) et les téléphones (application) se mettent à jour tout seuls au prochain lancement. Si le dossier android/ a
changé, GitHub reconstruit aussi l'application, et elle propose d'installer la nouvelle version.
"""
import os
import shutil
import subprocess
import sys
import tempfile
import zipfile

ICI = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
GARDER = {".git", "donnees", "depot.json"}


def git(*args, verifier=True):
    r = subprocess.run(["git", *args], cwd=ICI)
    if verifier and r.returncode:
        raise SystemExit(f"git {' '.join(args)} : échec")
    return r.returncode


def main():
    if len(sys.argv) < 2 or not zipfile.is_zipfile(sys.argv[1]):
        raise SystemExit(__doc__)
    tmp = tempfile.mkdtemp()
    with zipfile.ZipFile(sys.argv[1]) as z:
        z.extractall(tmp)
    racine = tmp
    while len(os.listdir(racine)) == 1 and os.path.isdir(os.path.join(racine, os.listdir(racine)[0])):
        racine = os.path.join(racine, os.listdir(racine)[0])            # le dossier silencio/ du zip
    if not os.path.isfile(os.path.join(racine, "main.py")) or not os.path.isfile(os.path.join(racine, "stockage.py")):
        raise SystemExit("Ce zip ne contient pas Silencio (main.py introuvable).")
    for nom in os.listdir(ICI):
        if nom not in GARDER:
            chemin = os.path.join(ICI, nom)
            shutil.rmtree(chemin) if os.path.isdir(chemin) else os.remove(chemin)
    for nom in os.listdir(racine):
        a, b = os.path.join(racine, nom), os.path.join(ICI, nom)
        if nom in GARDER and os.path.exists(b):
            continue
        shutil.copytree(a, b) if os.path.isdir(a) else shutil.copyfile(a, b)
    shutil.rmtree(tmp, ignore_errors=True)
    git("add", "-A")
    try:
        with open(os.path.join(ICI, "VERSION"), encoding="utf-8") as f:
            version = "version " + f.read().strip()
    except OSError:
        version = "nouvelle version"
    if git("diff", "--cached", "--quiet", verifier=False) == 0:
        print("Code déjà à jour sur ce PC : vérification de l'envoi sur GitHub…")
    else:
        git("commit", "-m", f"Silencio : {version}")
    # on envoie toujours : une version restée sur le PC (envoi raté la fois d'avant) part aussi
    if git("push", verifier=False):
        print("\nL'ENVOI SUR GITHUB A ÉCHOUÉ : le PC a la nouvelle version, pas les téléphones.")
        print("Essai de rattrapage (récupère ce qui est sur GitHub puis renvoie)…")
        if git("pull", "--rebase", "--no-edit", verifier=False) or git("push", verifier=False):
            raise SystemExit("\nToujours impossible d'envoyer. Recopie le message d'erreur ci-dessus (lignes « error » ou "
                             "« fatal ») et envoie-le à Claude.")
    print(f"Publié ({version}) : PC et téléphones se mettront à jour au prochain lancement.")

if __name__ == "__main__":
    main()
