"""Teste les scripts de l'extension Silencio Sync (lb.js, im.js) contre un faux Letterboxd et un faux IMDb.

Les vrais sites ne sont pas joignables ici : ce test vérifie la logique (ordre, doublons, en-têtes, conversions),
pas que Letterboxd et IMDb acceptent encore ces adresses. Le calibrage se fait avec l'enregistreur de l'extension.

python tests/test_extension.py
"""
import json
import os
import re
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from playwright.sync_api import sync_playwright

ICI = os.path.dirname(os.path.abspath(__file__))
EXT = os.path.join(os.path.dirname(ICI), "extension")
PORT = 9930
RECU = []

FILM = """<!DOCTYPE html><html><body><div class="film-poster" data-film-slug="{slug}" data-postered-identifier='{{"lid":"{lid}","uid":"film:{fid}","type":"film"}}'></div>
<a href="https://www.themoviedb.org/movie/{tmdb}/">TMDB</a></body></html>"""
FILMS = {"1018": ("mulholland-drive", "2a8i", "51561"), "793": ("blue-velvet", "29xk", "48102"),
         "638": ("lost-highway", "1Xa2", "47788"), "985": ("eraserhead", "2bc4", "49001"), "6977": ("no-country-for-old-men", "1fKz", "40102")}


class Faux(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def envoyer(self, code, corps, type_="application/json", entetes=None):
        b = corps if isinstance(corps, bytes) else (json.dumps(corps) if not isinstance(corps, str) else corps).encode()
        self.send_response(code)
        self.send_header("Content-Type", type_)
        self.send_header("Content-Length", str(len(b)))
        for k, v in (entetes or {}).items():
            self.send_header(k, v)
        self.end_headers()
        self.wfile.write(b)

    def do_GET(self):
        p = self.path
        if p == "/":
            return self.envoyer(200, "<html><body>letterboxd</body></html>", "text/html")
        m = re.fullmatch(r"/tmdb/(\d+)/", p)
        if m:
            if m.group(1) not in FILMS:
                return self.envoyer(404, "introuvable", "text/html")
            self.send_response(302)
            self.send_header("Location", f"/film/{FILMS[m.group(1)][0]}/")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return
        m = re.fullmatch(r"/film/([^/]+)/", p)
        if m:
            tmdb, (slug, lid, fid) = next((k, v) for k, v in FILMS.items() if v[0] == m.group(1))
            return self.envoyer(200, FILM.format(slug=slug, lid=lid, fid=fid, tmdb=tmdb), "text/html",
                                {"x-letterboxd-identifier": lid})
        if p == "/etienne/film/blue-velvet/diary/":
            return self.envoyer(200, '<table class="diary-table"><tr class="diary-entry-row" data-viewing-id="v42"><td><a href="/etienne/films/diary/for/2024/03/01/">1</a></td></tr></table>', "text/html")
        if p.startswith("/etienne/film/"):
            return self.envoyer(404, "", "text/html")
        self.envoyer(404, {})

    def do_PATCH(self):
        n = int(self.headers.get("Content-Length") or 0)
        RECU.append(("PATCH " + self.path, dict(self.headers), self.rfile.read(n).decode()))
        if self.path.startswith("/api/v0/production-log-entries/"):
            return self.envoyer(200, {"id": self.path.rsplit("/", 1)[1]})
        self.envoyer(404, {})

    def do_DELETE(self):
        RECU.append(("DELETE " + self.path, dict(self.headers), ""))
        if self.path.startswith("/api/v0/production-log-entries/"):
            return self.send_response(204) or self.end_headers()
        self.envoyer(404, {})

    def do_POST(self):
        n = int(self.headers.get("Content-Length") or 0)
        corps = self.rfile.read(n).decode()
        RECU.append((self.path, dict(self.headers), corps))
        if self.path == "/api/v0/production-log-entries":
            return self.envoyer(201, {"id": "x"})
        if "/like/" in self.path and "48102" in self.path or self.path == "/film/blue-velvet/like/":
            return self.envoyer(403, {"result": False, "messages": ["Forbidden"]})
        if self.path.startswith("/s/film:") or "watchlist" in self.path:
            return self.envoyer(200, {"result": True, "csrf": "csrf-2"})
        self.envoyer(404, {})


def verifier(cond, msg):
    if not cond:
        raise AssertionError(msg)
    print("ok :", msg)


SHIM = "globalThis.browser = { runtime: { onMessage: { addListener(f) { (window.__ecoutes ||= []).push(f); } } } };"


def main():
    s = ThreadingHTTPServer(("127.0.0.1", PORT), Faux)
    threading.Thread(target=s.serve_forever, daemon=True).start()
    with sync_playwright() as pw:
        nav = pw.chromium.launch()
        pg = nav.new_page()
        pg.add_init_script(SHIM)
        pg.goto(f"http://127.0.0.1:{PORT}/")
        pg.add_script_tag(path=os.path.join(EXT, "lb.js"))
        ops = [
            {"id": "a", "cle": "vu|j1", "sorte": "vu", "action": "poser", "valeur": {"date": "2024-03-01", "rewatch": True},
             "tmdb": 1018, "titre": "Mulholland Drive", "extra": {"note": 4.5, "like": True, "critique": "Rêve"}},
            {"id": "b", "cle": "vu|j2", "sorte": "vu", "action": "poser", "valeur": {"date": "2024-03-01", "rewatch": False},
             "tmdb": 793, "titre": "Blue Velvet", "extra": {"note": 4, "like": False, "critique": ""}},
            {"id": "c", "cle": "note|m:1018", "sorte": "note", "action": "poser", "valeur": 3.5, "tmdb": 1018},
            {"id": "d", "cle": "wl|m:1018", "sorte": "wl", "action": "retirer", "valeur": None, "tmdb": 1018},
            {"id": "e", "cle": "note|m:999999", "sorte": "note", "action": "poser", "valeur": 3, "tmdb": 999999},
            {"id": "f", "cle": "item|lA|m:1018", "sorte": "item", "action": "poser", "valeur": 1, "tmdb": 1018},
        ]
        rep = pg.evaluate("""async ops => await window.__ecoutes[0]({ type: "silencio-executer", ops, ctx: { csrf: "csrf-1", pseudo: "etienne", rapide: true } })""", ops)
        etats = {r["id"]: r["etat"] for r in rep["resultats"]}
        verifier(etats == {"a": "ok", "b": "deja", "c": "ok", "d": "ok", "e": "echec", "f": "attente"},
                 f"Letterboxd : journal, doublon évité, note, retrait de watchlist, film absent, liste en attente ({etats})")
        refs = {r["id"]: r.get("ref") for r in rep["resultats"]}
        verifier(refs["a"] == "x" and refs["b"] == "v42", "journal : l'identifiant de l'entrée revient à Silencio (créée ou déjà là)")
        journal = [r for r in RECU if r[0] == "/api/v0/production-log-entries"]
        verifier(len(journal) == 1, "un seul visionnage posté (le second était déjà au journal)")
        corps = json.loads(journal[0][2])
        verifier(corps == {"diaryDetails": {"diaryDate": "2024-03-01", "rewatch": True}, "tags": [], "like": True, "rating": 4.5,
                           "review": {"text": "Rêve", "containsSpoilers": False}, "productionId": "2a8i"},
                 "journal : date, revisionnage, note, coup de cœur, critique, identifiant du film")
        verifier(journal[0][1].get("X-CSRF-TOKEN") == "csrf-1" and journal[0][1].get("X-Requested-With") == "XMLHttpRequest",
                 "journal : jeton CSRF de la session")
        note = next(r for r in RECU if r[0] == "/s/film:51561/rate/")
        verifier("rating=7" in note[2] and "__csrf=csrf-1" in note[2], "note : 3,5 étoiles envoyées sur l'échelle 0-10 du site")
        wl = next(r for r in RECU if "remove-from-watchlist" in r[0])
        verifier("__csrf=csrf-2" in wl[2], "le nouveau jeton CSRF renvoyé par le site est réutilisé")
        verifier(rep["cache"]["1018"] == {"slug": "mulholland-drive", "filmId": "51561", "lid": "2a8i"}, "fiches mises en cache")
        verifier(rep["adresses"] == {"note": 0, "wl-": 0}, "les adresses qui marchent sont retenues (pas de rafale d'essais ensuite)")
        # jamais de doublon : Blue Velvet a déjà une entrée sur Letterboxd (autre date), Silencio n'en a qu'une
        avant = len([r for r in RECU if r[0] == "/api/v0/production-log-entries"])
        rep = pg.evaluate("""async ops => await window.__ecoutes[0]({ type: "silencio-executer", ops, ctx: { csrf: "c", pseudo: "etienne", rapide: true } })""", [
            {"id": "d1", "cle": "vu|jd1", "sorte": "vu", "action": "poser", "tmdb": 793, "nb": 1,
             "valeur": {"cle": "m:793", "date": "2026-11-20", "rewatch": True, "note": 4, "like": False, "critique": ""}},
            {"id": "d2", "cle": "vu|jd2", "sorte": "vu", "action": "poser", "tmdb": 793, "nb": 2,
             "valeur": {"cle": "m:793", "date": "2026-11-21", "rewatch": True, "note": 4, "like": False, "critique": ""}}])
        et = {r["id"]: r["etat"] for r in rep["resultats"]}
        nouveaux = len([r for r in RECU if r[0] == "/api/v0/production-log-entries"]) - avant
        verifier(et == {"d1": "deja", "d2": "ok"} and nouveaux == 1, "Letterboxd : pas de doublon d'un film déjà au journal ; une vraie deuxième vision passe")
        # plusieurs films ajoutés d'un coup : chacun a son entrée de journal
        avant = len([r for r in RECU if r[0] == "/api/v0/production-log-entries"])
        rep = pg.evaluate("""async ops => await window.__ecoutes[0]({ type: "silencio-executer", ops, ctx: { csrf: "c", pseudo: "etienne", rapide: true } })""", [
            {"id": f"p{i}", "cle": f"vu|jp{i}", "sorte": "vu", "action": "poser", "tmdb": int(t), "titre": t,
             "valeur": {"cle": f"m:{t}", "date": "2026-11-2" + str(i), "rewatch": False, "note": 4, "like": False, "critique": ""}}
            for i, t in enumerate(("638", "985", "6977"))])
        posts = [json.loads(r[2]) for r in RECU if r[0] == "/api/v0/production-log-entries"][avant:]
        verifier(all(x["etat"] == "ok" for x in rep["resultats"]) and sorted(p["productionId"] for p in posts) == sorted(["1Xa2", "2bc4", "1fKz"]),
                 "plusieurs films d'un coup : trois entrées de journal, chacune pour le bon film")
        # un refus (403) sur une action ne bloque pas les suivantes
        rep = pg.evaluate("""async ops => await window.__ecoutes[0]({ type: "silencio-executer", ops, ctx: { csrf: "c", pseudo: "etienne", rapide: true } })""", [
            {"id": "l1", "cle": "like|m:793", "sorte": "like", "action": "poser", "valeur": 1, "tmdb": 793},
            {"id": "n1", "cle": "note|m:793", "sorte": "note", "action": "poser", "valeur": 4, "tmdb": 793}])
        et = {r["id"]: r["etat"] for r in rep["resultats"]}
        verifier(et == {"l1": "echec", "n1": "ok"} and not rep["bloque"], "Letterboxd : un 403 sur une action n'arrête pas les autres")
        # modifier puis supprimer une entrée du journal
        rep = pg.evaluate("""async ops => await window.__ecoutes[0]({ type: "silencio-executer", ops, ctx: { csrf: "c", pseudo: "etienne", rapide: true } })""", [
            {"id": "m", "cle": "vu|j1", "sorte": "vu", "action": "poser", "ref": "x", "tmdb": 1018,
             "valeur": {"cle": "m:1018", "date": "2024-03-02", "rewatch": False, "note": 3, "like": False, "critique": ""}, "avant": {"date": "2024-03-01"}},
            {"id": "s", "cle": "vu|j2", "sorte": "vu", "action": "retirer", "tmdb": 793, "valeur": None, "avant": {"date": "2024-03-01"}}])
        et = {r["id"]: r for r in rep["resultats"]}
        patch = next(r for r in RECU if r[0] == "PATCH /api/v0/production-log-entries/x")
        verifier(et["m"]["etat"] == "ok" and json.loads(patch[2])["rating"] == 3 and json.loads(patch[2])["diaryDetails"]["diaryDate"] == "2024-03-02",
                 "journal : entrée modifiée (date, note)")
        verifier(et["s"]["etat"] == "ok" and any(r[0] == "DELETE /api/v0/production-log-entries/v42" for r in RECU),
                 "journal : entrée supprimée (retrouvée sur la page du journal)")
        # une adresse inconnue n'est réessayée qu'une fois par jour
        n_avant = len(RECU)
        rep = pg.evaluate("""async ops => await window.__ecoutes[0]({ type: "silencio-executer", ops, ctx: { csrf: "c", pseudo: "etienne", rapide: true,
            adresses: {}, essais: { like: Date.now() } } })""", [{"id": "g", "cle": "like|m:1018", "sorte": "like", "action": "poser", "valeur": 1, "tmdb": 1018}])
        verifier(rep["resultats"][0]["etat"] == "echec" and "demain" in rep["resultats"][0]["erreur"] and
                 not any("/like/" in r[0] for r in RECU[n_avant:]), "exploration d'adresses limitée à une fois par jour")

        # ---- IMDb
        gql = []

        def repondre(route):
            b = json.loads(route.request.post_data)
            gql.append((b, route.request.headers))
            op = b["operationName"]
            if op == "Watchlist":
                return route.fulfill(json={"data": {"predefinedList": {"id": "ls0777", "__typename": "List"}}})
            if op == "CreateList":
                return route.fulfill(json={"data": {"createList": {"listId": "ls0001"}}})
            if op == "AddItemToList" and b["variables"]["input"]["item"]["itemElementId"] == "tt0090756":
                return route.fulfill(json={"errors": [{"message": "Item already exists in list"}]})
            return route.fulfill(json={"data": {"ok": True}})
        pg2 = nav.new_page()
        pg2.add_init_script(SHIM)
        pg2.route("https://api.graphql.imdb.com/**", repondre)
        pg2.goto(f"http://127.0.0.1:{PORT}/")
        pg2.add_script_tag(path=os.path.join(EXT, "im.js"))
        ops = [
            {"id": "1", "cle": "liste|_favoris", "sorte": "liste", "action": "poser", "valeur": {"nom": "Favoris", "description": "x"}},
            {"id": "2", "cle": "note|m:1018", "sorte": "note", "action": "poser", "valeur": 9, "imdb": "tt0166924"},
            {"id": "3", "cle": "fav|m:793", "sorte": "fav", "action": "poser", "valeur": 1, "imdb": "tt0090756", "ref": "ls0001"},
            {"id": "5", "cle": "liste|_favoris", "sorte": "liste", "action": "poser", "valeur": {"nom": "Watchlist", "watchlist": True}},
            {"id": "4", "cle": "critique|j1", "sorte": "critique", "action": "poser", "valeur": "Rêve", "imdb": "tt0166924"},
        ]
        rep = pg2.evaluate("""async ops => await window.__ecoutes[0]({ type: "silencio-executer", ops, ctx: { session: "123-456", rapide: true } })""", ops)
        r = {x["id"]: x for x in rep["resultats"]}
        verifier(r["1"]["etat"] == "ok" and r["1"]["ref"] == "ls0001", "IMDb : liste Favoris créée, son identifiant revient à Silencio")
        verifier(r["2"]["etat"] == "ok" and gql[1][0]["variables"] == {"rating": 9, "titleId": "tt0166924"}, "IMDb : note entière")
        verifier(r["3"]["etat"] == "deja", "IMDb : film déjà dans la liste accepté")
        verifier(r["4"]["etat"] == "manuel" and r["4"]["lien"].endswith("tconst=tt0166924") and r["4"]["texte"] == "Rêve",
                 "IMDb : critique préparée pour une publication à la main")
        rep2 = pg2.evaluate("""async ops => await window.__ecoutes[0]({ type: "silencio-executer", ops, ctx: { session: "s", rapide: true } })""",
                            [{"id": "w1", "cle": "fav|m:1018", "sorte": "fav", "action": "poser", "valeur": 1, "imdb": "tt0166924", "ref": None, "watchlist": True},
                             {"id": "w2", "cle": "fav|m:793", "sorte": "fav", "action": "poser", "valeur": 1, "imdb": "tt0090756", "ref": None, "watchlist": True}])
        rr = {x["id"]: x for x in rep2["resultats"]}
        ajouts = [g[0]["variables"]["input"] for g in gql if g[0]["operationName"] == "AddItemToList"][-2:]
        verifier(rr["watchlist"]["ref"] == "ls0777" and rr["watchlist"]["cle"] == "liste|_favoris" and all(a["listId"] == "ls0777" for a in ajouts) and
                 sum(1 for g in gql if g[0]["operationName"] == "Watchlist") <= 2, "IMDb : ajout à la watchlist sans étape préalable (watchlist retrouvée une fois)")
        verifier(r["5"]["etat"] == "ok" and r["5"]["ref"] == "ls0777" and not any(g[0]["operationName"] == "CreateList" and g is gql[-1] for g in gql),
                 "IMDb : ta watchlist IMDb est retrouvée, sans rien créer")
        # Firefox refuse l'appel depuis la page (NetworkError) : l'extension le refait elle-même
        pg3 = nav.new_page()
        pg3.add_init_script(SHIM + """
          globalThis.__fond = [];
          browser.runtime.sendMessage = async m => { __fond.push(m); return { status: 200, texte: JSON.stringify({ data: { rateTitle: { rating: { value: 7 } } } }) }; };""")
        pg3.route("https://api.graphql.imdb.com/**", lambda route: route.abort())
        pg3.goto(f"http://127.0.0.1:{PORT}/")
        pg3.add_script_tag(path=os.path.join(EXT, "im.js"))
        rep3 = pg3.evaluate("""async ops => await window.__ecoutes[0]({ type: "silencio-executer", ops, ctx: { session: "1", rapide: true } })""",
                            [{"id": "n", "cle": "note|m:1", "sorte": "note", "action": "poser", "valeur": 7, "imdb": "tt0116996"},
                             {"id": "m", "cle": "note|m:2", "sorte": "note", "action": "poser", "valeur": 6, "imdb": "tt0116997"}])
        fond = pg3.evaluate("__fond")
        verifier(all(x["etat"] == "ok" for x in rep3["resultats"]) and len(fond) == 2 and fond[0]["type"] == "imdb-gql",
                 "IMDb : NetworkError dans la page, l'extension fait l'appel elle-même")
        verifier(gql[0][1].get("x-amzn-sessionid") == "123-456", "IMDb : identifiant de session transmis")
        nav.close()
    s.shutdown()
    # les scripts chargés dans l'extension elle-même (sans onglet) : pas de variable oubliée, session jointe
    import subprocess
    sortie = subprocess.run(["node", os.path.join(ICI, "verif_fond.js")], capture_output=True, text=True, timeout=60)
    verifier(sortie.returncode == 0 and '"etat":"ok"' in sortie.stdout and "session-id=1" in sortie.stdout,
             "sans onglet : scripts chargés dans l'extension, session et origine du site jointes" + (sortie.stderr[-300:] if sortie.returncode else ""))
    print("Extension OK")


if __name__ == "__main__":
    main()
