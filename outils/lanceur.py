#!/usr/bin/env python3
"""Lancement depuis le raccourci du bureau : met Silencio à jour (git pull) puis le lance.
Aucune bibliothèque à installer : Silencio n'utilise que Python."""
import os
import subprocess
import sys

ICI = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
os.chdir(ICI)
SANS_FENETRE = getattr(subprocess, "CREATE_NO_WINDOW", 0)


def git(*args):
    try:
        return subprocess.run(["git", *args], cwd=ICI, capture_output=True, text=True, timeout=60,
                              creationflags=SANS_FENETRE).returncode == 0
    except (OSError, subprocess.SubprocessError):
        return False


def mettre_a_jour():
    if not os.path.isdir(os.path.join(ICI, ".git")):
        return
    print("Mise à jour…", flush=True)
    git("config", "remote.origin.fetch", "+refs/heads/main:refs/remotes/origin/main")   # pas la branche des profils
    if not git("pull", "--ff-only", "--quiet", "origin", "main"):
        if git("fetch", "--quiet", "origin", "main"):
            git("reset", "--hard", "--quiet", "origin/main")
        else:
            print("Hors ligne : on garde la version installée.", flush=True)


if __name__ == "__main__":
    if "--sans-maj" not in sys.argv:
        mettre_a_jour()
    os.execv(sys.executable, [sys.executable, os.path.join(ICI, "main.py")])
