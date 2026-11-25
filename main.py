#!/usr/bin/env python3
"""Silencio : ton journal de films et de séries, tes stats, tes listes. Lance le serveur et ouvre le navigateur.

Lancement : python main.py      (aucune bibliothèque à installer : Python 3.9 ou plus suffit)
"""
import os
import sys
import threading
import time
import webbrowser
from http.server import ThreadingHTTPServer

import config
from serveur import App, fabriquer_handler


def demarrer_serveur():
    """Ouvre le serveur (sans bloquer) : (app, port, serveur) ou None si aucun port n'est libre."""
    app = App()
    serveur = None
    for port in range(config.PORT, config.PORT + 20):
        try:
            serveur = ThreadingHTTPServer(("127.0.0.1", port), fabriquer_handler(app))
            break
        except OSError:
            continue
    if serveur is None:
        return None
    serveur.daemon_threads = True
    app.port = port
    threading.Thread(target=serveur.serve_forever, daemon=True).start()
    app.demarrer()
    return app, port, serveur


def main():
    res = demarrer_serveur()
    if res is None:
        print("Impossible d'ouvrir un port local.")
        sys.exit(1)
    app, port, serveur = res
    url = f"http://127.0.0.1:{port}/"
    print("Silencio  —  No hay banda.")
    print("  " + url)
    print("  (Ctrl+C ou fermer cette fenetre pour quitter)")
    if not os.environ.get("SILENCIO_SANS_NAVIGATEUR"):
        threading.Timer(0.6, webbrowser.open, args=(url,)).start()
    try:
        while True:
            time.sleep(1)
    except KeyboardInterrupt:
        pass
    finally:
        serveur.shutdown()
        serveur.server_close()


if __name__ == "__main__":
    main()
