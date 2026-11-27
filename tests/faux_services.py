"""Faux TMDB, GitHub, Wikidata, IMDb et fond de carte, pour tester Silencio sans Internet.

python tests/faux_services.py 9911   puis lancer Silencio avec les variables SILENCIO_TMDB=http://127.0.0.1:9911/tmdb/3 …
"""
import base64
import colorsys
import gzip
import hashlib
import io
import json
import re
import sys
import threading
import time
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from PIL import Image, ImageDraw

P = {}  # personnes : id -> (nom, genre, département)


def pers(i, nom, g=2, dept="Acting"):
    P[i] = (nom, g, dept)
    return i


LYNCH = pers(5602, "David Lynch", 2, "Directing")
CRONENBERG = pers(224, "David Cronenberg", 2, "Directing")
WKW = pers(12453, "Wong Kar-wai", 2, "Directing")
INARRITU = pers(223, "Alejandro González Iñárritu", 2, "Directing")
BONG = pers(21684, "Bong Joon-ho", 2, "Directing")
JCOEN = pers(1223, "Joel Coen", 2, "Directing")
ECOEN = pers(1224, "Ethan Coen", 2, "Directing")
VILLENEUVE = pers(137427, "Denis Villeneuve", 2, "Directing")
FROST = pers(16, "Mark Frost", 2, "Writing")
WATTS = pers(3489, "Naomi Watts", 1)
HARRING = pers(5212, "Laura Harring", 1)
THEROUX = pers(15009, "Justin Theroux")
WOODS = pers(4512, "James Woods")
HARRY = pers(45011, "Debbie Harry", 1)
LEONLAI = pers(116462, "Leon Lai")
KANESHIRO = pers(43661, "Takeshi Kaneshiro")
REIS = pers(116463, "Michelle Reis", 1)
KEATON = pers(2232, "Michael Keaton")
STONE = pers(54693, "Emma Stone", 1)
NORTON = pers(819, "Edward Norton")
SONG = pers(20738, "Song Kang-ho")
CHOI = pers(1255881, "Choi Woo-shik")
TURTURRO = pers(1241, "John Turturro")
GOODMAN = pers(1230, "John Goodman")
MACLACHLAN = pers(6677, "Kyle MacLachlan")
ROSSELLINI = pers(6588, "Isabella Rossellini", 1)
HOPPER = pers(2778, "Dennis Hopper")
DERN = pers(4784, "Laura Dern", 1)
PULLMAN = pers(8986, "Bill Pullman")
ARQUETTE = pers(4687, "Patricia Arquette", 1)
NANCE = pers(6718, "Jack Nance")
LEUNG = pers(1337, "Tony Leung Chiu-wai")
CHEUNG = pers(1338, "Maggie Cheung", 1)
FAYE = pers(1339, "Faye Wong", 1)
MCDORMAND = pers(3910, "Frances McDormand", 1)
BARDEM = pers(3810, "Javier Bardem")
BROLIN = pers(16851, "Josh Brolin")
GOLDBLUM = pers(4785, "Jeff Goldblum")
AZABAL = pers(1018947, "Lubna Azabal", 1)
ADAMS = pers(9273, "Amy Adams", 1)
KIMHYE = pers(1072, "Kim Hye-ja", 1)
SHERYL = pers(6719, "Sheryl Lee", 1)
DEMING = pers(5603, "Peter Deming", 2, "Camera")
DOYLE = pers(12454, "Christopher Doyle", 2, "Camera")
LUBEZKI = pers(14341, "Emmanuel Lubezki", 2, "Camera")
HONG = pers(1255882, "Hong Kyung-pyo", 2, "Camera")
DEAKINS = pers(151, "Roger Deakins", 2, "Camera")
ELMES = pers(5604, "Frederick Elmes", 2, "Camera")
IRWIN = pers(4513, "Mark Irwin", 2, "Camera")
BADALAMENTI = pers(5628, "Angelo Badalamenti", 2, "Sound")
SHORE = pers(117, "Howard Shore", 2, "Sound")
CHAN = pers(12455, "Frankie Chan", 2, "Sound")
SANCHEZ = pers(1031121, "Antonio Sánchez", 2, "Sound")
JUNG = pers(1255883, "Jung Jae-il", 2, "Sound")
BURWELL = pers(1704, "Carter Burwell", 2, "Sound")
JOHANNSSON = pers(1194, "Jóhann Jóhannsson", 2, "Sound")

#        id     titre FR / original          année date  durée genres  pays  langue réal   acteurs   image musique budget recettes motsclés  compagnie  vote  imdb
FILMS = [
    (1018, "Mulholland Drive", "Mulholland Drive", "2001-10-06", 147, [18, 53, 9648], ["FR", "US"], "en", [LYNCH], [WATTS, HARRING, THEROUX], DEMING, BADALAMENTI, 15e6, 20e6, [(1, "rêve"), (2, "hollywood"), (3, "néo-noir")], (1, "Studiocanal"), 7.9, "tt0166924"),
    (837, "Vidéodrome", "Videodrome", "1983-02-04", 89, [27, 878], ["CA"], "en", [CRONENBERG], [WOODS, HARRY], IRWIN, SHORE, 5.9e6, 2.1e6, [(4, "télévision"), (5, "body horror")], (2, "Filmplan"), 7.2, "tt0086541"),
    (11220, "Les Anges déchus", "墮落天使", "1995-09-06", 99, [80, 18, 10749], ["HK"], "cn", [WKW], [LEONLAI, KANESHIRO, REIS], DOYLE, CHAN, 0, 0, [(6, "nuit"), (7, "tueur à gages")], (3, "Jet Tone"), 7.6, "tt0112913"),
    (194662, "Birdman", "Birdman or (The Unexpected Virtue of Ignorance)", "2014-10-17", 119, [18, 35], ["US"], "en", [INARRITU], [KEATON, STONE, NORTON], LUBEZKI, SANCHEZ, 18e6, 103.2e6, [(2, "hollywood"), (8, "théâtre")], (4, "Fox Searchlight"), 7.5, "tt2562232"),
    (496243, "Parasite", "기생충", "2019-05-30", 133, [35, 53, 18], ["KR"], "ko", [BONG], [SONG, CHOI], HONG, JUNG, 11.4e6, 258e6, [(9, "lutte des classes"), (10, "famille")], (5, "Barunson E&A"), 8.5, "tt6751668"),
    (290, "Barton Fink", "Barton Fink", "1991-08-21", 116, [35, 18], ["US", "GB"], "en", [JCOEN, ECOEN], [TURTURRO, GOODMAN], DEAKINS, BURWELL, 9e6, 6.1e6, [(2, "hollywood"), (11, "écrivain")], (6, "Circle Films"), 7.5, "tt0101410"),
    (638, "Lost Highway", "Lost Highway", "1997-01-15", 134, [9648, 53], ["FR", "US"], "en", [LYNCH], [PULLMAN, ARQUETTE], DEMING, BADALAMENTI, 15e6, 3.8e6, [(1, "rêve"), (3, "néo-noir")], (1, "Studiocanal"), 7.5, "tt0116922"),
    (985, "Eraserhead", "Eraserhead", "1977-03-19", 89, [27, 14], ["US"], "en", [LYNCH], [NANCE], ELMES, None, 0.1e6, 7e6, [(1, "rêve"), (5, "body horror")], (7, "AFI"), 7.3, "tt0074486"),
    (793, "Blue Velvet", "Blue Velvet", "1986-09-19", 120, [80, 9648, 53], ["US"], "en", [LYNCH], [MACLACHLAN, ROSSELLINI, HOPPER, DERN], ELMES, BADALAMENTI, 6e6, 8.6e6, [(3, "néo-noir"), (12, "banlieue")], (8, "De Laurentiis"), 7.7, "tt0090756"),
    (11104, "Chungking Express", "重慶森林", "1994-07-14", 102, [18, 35, 10749], ["HK"], "cn", [WKW], [LEUNG, KANESHIRO, FAYE], DOYLE, CHAN, 0, 0.6e6, [(6, "nuit"), (13, "solitude")], (3, "Jet Tone"), 8.0, "tt0109424"),
    (843, "In the Mood for Love", "花樣年華", "2000-09-29", 98, [18, 10749], ["HK", "FR"], "cn", [WKW], [LEUNG, CHEUNG], DOYLE, None, 0, 14.2e6, [(13, "solitude"), (14, "adultère")], (3, "Jet Tone"), 8.1, "tt0118694"),
    (275, "Fargo", "Fargo", "1996-03-08", 98, [80, 18, 53], ["US", "GB"], "en", [JCOEN, ECOEN], [MCDORMAND], DEAKINS, BURWELL, 7e6, 60.6e6, [(15, "neige"), (16, "enlèvement")], (9, "PolyGram"), 7.9, "tt0116282"),
    (6977, "No Country for Old Men", "No Country for Old Men", "2007-11-09", 122, [80, 18, 53], ["US"], "en", [JCOEN, ECOEN], [BARDEM, BROLIN], DEAKINS, BURWELL, 25e6, 171.6e6, [(17, "désert"), (7, "tueur à gages")], (10, "Miramax"), 7.9, "tt0477348"),
    (9426, "La Mouche", "The Fly", "1986-08-15", 96, [27, 878], ["US"], "en", [CRONENBERG], [GOLDBLUM], IRWIN, SHORE, 15e6, 60.6e6, [(5, "body horror"), (18, "savant fou")], (11, "Brooksfilms"), 7.6, "tt0091064"),
    (11423, "Memories of Murder", "살인의 추억", "2003-05-02", 132, [80, 18, 53], ["KR"], "ko", [BONG], [SONG], HONG, None, 2.8e6, 1.2e6, [(19, "tueur en série"), (20, "enquête")], (12, "CJ"), 8.1, "tt0353969"),
    (30018, "Mother", "마더", "2009-05-28", 129, [80, 18, 53], ["KR"], "ko", [BONG], [KIMHYE], HONG, None, 5e6, 17e6, [(10, "famille"), (20, "enquête")], (12, "CJ"), 7.8, "tt1216496"),
    (46738, "Incendies", "Incendies", "2010-09-17", 131, [18, 9648, 10752], ["CA", "FR"], "fr", [VILLENEUVE], [AZABAL], pers(46739, "André Turpin", 2, "Camera"), None, 6.8e6, 16e6, [(10, "famille"), (21, "guerre")], (13, "micro_scope"), 8.0, "tt1255953"),
    (329865, "Premier Contact", "Arrival", "2016-11-11", 116, [18, 878, 9648], ["US"], "en", [VILLENEUVE], [ADAMS], pers(16588, "Bradford Young", 2, "Camera"), JOHANNSSON, 47e6, 203e6, [(22, "extraterrestre"), (23, "langage")], (14, "FilmNation"), 7.6, "tt2543164"),
    (40000, "Six Men Getting Sick", "Six Men Getting Sick", "1967-01-01", 4, [16], ["US"], "en", [LYNCH], [], None, None, 0, 0, [(24, "expérimental")], (7, "AFI"), 6.0, "tt0062237"),
    (391729, "David Lynch : The Art Life", "David Lynch: The Art Life", "2016-09-01", 88, [99], ["US", "DK"], "en", [pers(1625, "Jon Nguyen", 2, "Directing")], [LYNCH], None, None, 0, 0, [(25, "peinture")], (15, "Duck Diver"), 7.2, "tt4946972"),
    (999001, "Le Prochain Villeneuve", "Untitled Villeneuve", "2027-05-20", 0, [878], ["US"], "en", [VILLENEUVE], [], None, None, 0, 0, [], (14, "FilmNation"), 0, ""),
]
SERIES = [
    (1920, "Twin Peaks", "Twin Peaks", "1990-04-08", 48, [9648, 18, 80], ["US"], "en", [LYNCH, FROST], [MACLACHLAN, SHERYL], [(1, 8, "1990-04-08"), (2, 22, "1990-09-30")], "Ended", 8.4, "tt0098936"),
]
F = {f[0]: f for f in FILMS}
TV = {s[0]: s for s in SERIES}
IMDB_NOTES = {"tt0166924": (7.9, 390000), "tt0086541": (7.2, 100000), "tt0112913": (7.6, 47000), "tt2562232": (7.7, 680000),
              "tt6751668": (8.5, 1000000), "tt0101410": (7.6, 130000), "tt0116922": (7.6, 160000), "tt0074486": (7.3, 120000),
              "tt0090756": (7.7, 220000), "tt0109424": (8.0, 90000), "tt0118694": (8.1, 160000), "tt0116282": (8.1, 730000),
              "tt0477348": (8.2, 1100000), "tt0091064": (7.6, 210000), "tt0353969": (8.1, 220000), "tt1216496": (7.8, 60000),
              "tt1255953": (8.3, 200000), "tt2543164": (7.9, 780000), "tt0062237": (5.9, 3000), "tt4946972": (7.1, 6000),
              "tt0098936": (8.8, 230000)}
FOURN = {"m:1018": ["Netflix"], "m:496243": ["Prime Video", "Canal+"], "m:843": ["MUBI"], "m:329865": ["Netflix"], "m:11423": ["MUBI"],
         "t:1920": ["Paramount+"]}
FOURN_IDS = {"Netflix": 8, "Prime Video": 119, "Canal+": 381, "MUBI": 11, "Paramount+": 531}


def chemin(cle):
    return "/" + hashlib.md5(cle.encode()).hexdigest()[:16] + ".jpg"


def credits_film(f):
    fid, _, _, _, _, _, _, _, reals, acteurs, image, musique = f[:12]
    cast = [{"id": a, "name": P[a][0], "gender": P[a][1], "order": i, "character": f"Rôle {i + 1}",
             "profile_path": chemin(f"p{a}")} for i, a in enumerate(acteurs)]
    crew = [{"id": r, "name": P[r][0], "gender": P[r][1], "job": "Director", "department": "Directing",
             "profile_path": chemin(f"p{r}")} for r in reals]
    crew += [{"id": r, "name": P[r][0], "gender": P[r][1], "job": "Screenplay", "department": "Writing", "profile_path": None} for r in reals]
    if image:
        crew.append({"id": image, "name": P[image][0], "gender": 2, "job": "Director of Photography", "department": "Camera", "profile_path": None})
    if musique:
        crew.append({"id": musique, "name": P[musique][0], "gender": 2, "job": "Original Music Composer", "department": "Sound", "profile_path": None})
    return {"cast": cast, "crew": crew}


def resume_film(f):
    return {"id": f[0], "media_type": "movie", "title": f[1], "original_title": f[2], "release_date": f[3],
            "poster_path": chemin(f"m{f[0]}"), "backdrop_path": chemin(f"fd{f[0]}"), "vote_average": f[16],
            "vote_count": 1000, "genre_ids": f[5], "popularity": 20 + f[16], "overview": f"Synopsis de {f[1]}."}


def resume_serie(s):
    return {"id": s[0], "media_type": "tv", "name": s[1], "original_name": s[2], "first_air_date": s[3],
            "poster_path": chemin(f"t{s[0]}"), "backdrop_path": chemin(f"fdt{s[0]}"), "vote_average": s[12],
            "vote_count": 3000, "genre_ids": s[5], "popularity": 50, "overview": f"Synopsis de {s[1]}."}


def fournisseurs(cle):
    noms = FOURN.get(cle, [])
    if not noms:
        return {}
    return {"FR": {"link": "https://www.themoviedb.org/", "flatrate": [{"provider_id": FOURN_IDS[n], "provider_name": n,
                                                                        "logo_path": chemin("logo" + n)} for n in noms]}}


def film(fid):
    f = F[fid]
    d = resume_film(f)
    d.pop("media_type")
    d.update(runtime=f[4], genres=[{"id": g, "name": str(g)} for g in f[5]],
             production_countries=[{"iso_3166_1": p} for p in f[6]], original_language=f[7],
             spoken_languages=[{"iso_639_1": f[7]}], budget=int(f[12]), revenue=int(f[13]), imdb_id=f[17],
             production_companies=[{"id": f[15][0], "name": f[15][1], "origin_country": f[6][0], "logo_path": None}],
             tagline="", status="Released", belongs_to_collection=None)
    d["credits"] = credits_film(f)
    d["keywords"] = {"keywords": [{"id": k, "name": n} for k, n in f[14]]}
    d["external_ids"] = {"imdb_id": f[17]}
    d["release_dates"] = {"results": [{"iso_3166_1": "FR", "release_dates": [{"type": 3, "release_date": f[3] + "T00:00:00.000Z"}]}]}
    d["watch/providers"] = {"results": fournisseurs(f"m:{fid}")}
    autres = [resume_film(x) for x in FILMS if x[0] != fid and set(x[5]) & set(f[5])][:8]
    d["recommendations"] = {"results": autres}
    d["similar"] = {"results": autres[:4]}
    d["videos"] = {"results": []}
    return d


def serie(tid):
    s = TV[tid]
    d = resume_serie(s)
    d.pop("media_type")
    d.update(episode_run_time=[s[4]], genres=[{"id": g, "name": str(g)} for g in s[5]], origin_country=s[6],
             production_countries=[{"iso_3166_1": p} for p in s[6]], original_language=s[7],
             created_by=[{"id": r, "name": P[r][0], "gender": 2, "profile_path": chemin(f"p{r}")} for r in s[8]],
             number_of_episodes=sum(n for _, n, _ in s[10]), number_of_seasons=len(s[10]), status=s[11],
             last_air_date="1991-06-10", next_episode_to_air=None, type="Scripted",
             seasons=[{"season_number": n, "episode_count": c, "air_date": a, "name": f"Saison {n}", "poster_path": chemin(f"s{tid}{n}")} for n, c, a in s[10]],
             networks=[{"id": 6, "name": "ABC", "origin_country": "US", "logo_path": None}], production_companies=[])
    d["aggregate_credits"] = {"cast": [{"id": a, "name": P[a][0], "gender": P[a][1], "order": i, "total_episode_count": 30 - i,
                                        "roles": [{"character": f"Rôle {i}"}], "profile_path": chemin(f"p{a}")} for i, a in enumerate(s[9])],
                              "crew": [{"id": LYNCH, "name": "David Lynch", "gender": 2, "jobs": [{"job": "Director"}], "department": "Directing"},
                                       {"id": BADALAMENTI, "name": P[BADALAMENTI][0], "gender": 2, "jobs": [{"job": "Original Music Composer"}], "department": "Sound"}]}
    d["keywords"] = {"results": [{"id": 1, "name": "rêve"}, {"id": 20, "name": "enquête"}]}
    d["external_ids"] = {"imdb_id": s[13]}
    d["watch/providers"] = {"results": fournisseurs(f"t:{tid}")}
    d["recommendations"] = {"results": [resume_film(F[1018])]}
    return d


def saison(tid, n):
    s = TV[tid]
    nb = next(c for k, c, _ in s[10] if k == n)
    return {"season_number": n, "episodes": [{"episode_number": e, "name": f"Épisode {e}", "air_date": f"199{n - 1}-0{min(9, e % 9 + 1)}-10",
                                               "runtime": 48, "vote_average": 8, "vote_count": 50} for e in range(1, nb + 1)]}


def personne(pid):
    nom, g, dept = P[pid]
    cast, crew = [], []
    for f in FILMS:
        if pid in f[9]:
            cast.append(dict(resume_film(f), character="Rôle"))
        if pid in f[8]:
            crew.append(dict(resume_film(f), job="Director", department="Directing"))
        if pid == f[10]:
            crew.append(dict(resume_film(f), job="Director of Photography", department="Camera"))
        if pid == f[11]:
            crew.append(dict(resume_film(f), job="Original Music Composer", department="Sound"))
    for s in SERIES:
        if pid in s[8]:
            crew.append(dict(resume_serie(s), job="Director", department="Directing", episode_count=18))
        if pid in s[9]:
            cast.append(dict(resume_serie(s), character="Rôle", episode_count=30))
    return {"id": pid, "name": nom, "gender": g, "known_for_department": dept, "birthday": "1946-01-20",
            "deathday": "2025-01-16" if pid == LYNCH else None, "place_of_birth": "Missoula, Montana, USA" if pid == LYNCH else "",
            "profile_path": chemin(f"p{pid}"), "biography": f"Biographie de {nom}. " * 12, "imdb_id": f"nm{pid:07d}",
            "combined_credits": {"cast": cast, "crew": crew}}


def recherche(q):
    q = q.lower()
    r = [resume_film(f) for f in FILMS if q in f[1].lower() or q in f[2].lower()]
    r += [resume_serie(s) for s in SERIES if q in s[1].lower()]
    r += [{"id": i, "media_type": "person", "name": n, "profile_path": chemin(f"p{i}"), "known_for_department": d}
          for i, (n, g, d) in P.items() if q in n.lower()]
    return r


# ---------------------------------------------------------------- faux GitHub
DEPOT = {"branches": {"main": "c0"}, "fichiers": {}, "commits": []}   # fichiers : (branche, chemin) -> (sha, octets)
VERROU = threading.Lock()


def image(cle, taille):
    h = int(hashlib.md5(cle.encode()).hexdigest()[:6], 16)
    r, g, b = colorsys.hsv_to_rgb((h % 360) / 360, .55, .55)
    l, ht = (200, 300) if not cle.startswith("/fd") else (300, 170)
    im = Image.new("RGB", (l, ht), (int(r * 255), int(g * 255), int(b * 255)))
    d = ImageDraw.Draw(im)
    for i in range(0, ht, 18):
        d.line([(0, i), (l, i + 40)], fill=(int(r * 200), int(g * 200), int(b * 230)), width=6)
    o = io.BytesIO()
    im.save(o, "JPEG", quality=70)
    return o.getvalue()


def monde():
    """Un fond de carte jouet : quelques pays en rectangles (identifiants ISO numériques)."""
    rect = {"250": (2, 46, 8, 5), "840": (-100, 40, 30, 12), "410": (127, 36, 3, 3), "392": (138, 36, 6, 6),
            "344": (114, 22, 2, 2), "124": (-100, 58, 40, 10), "826": (-2, 53, 4, 5), "208": (10, 56, 3, 2)}
    arcs, geoms = [], []
    for i, (iso, (x, y, w, h)) in enumerate(rect.items()):
        arcs.append([[x, y], [x, y + h], [x + w, y + h], [x + w, y], [x, y]])
        geoms.append({"type": "Polygon", "arcs": [[i]], "id": iso, "properties": {"name": iso}})
    return {"type": "Topology", "objects": {"countries": {"type": "GeometryCollection", "geometries": geoms}}, "arcs": arcs}


class H(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def envoyer(self, code, corps, type_="application/json"):
        if not isinstance(corps, bytes):
            corps = json.dumps(corps).encode()
        self.send_response(code)
        self.send_header("Content-Type", type_)
        self.send_header("Content-Length", str(len(corps)))
        self.end_headers()
        self.wfile.write(corps)

    def corps(self):
        n = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(n) or b"{}") if n else {}

    def refract(self, methode, p, q):
        """Faux Refract (API v1) : clé « rfk_test »."""
        if p == "/openapi.json":
            chemins = {"/v1/watchlist/{id}": {"put": {}}}
            if REFRACT_CAPS:
                chemins["/v1/favorites/movies/{id}"] = {"put": {}, "delete": {}}
                chemins["/v1/reviews/movies/{id}"] = {"put": {"requestBody": {"content": {"application/json": {
                    "schema": {"properties": {"text": {"type": "string"}, "spoiler": {"type": "boolean"}}}}}}}}
            return self.envoyer(200, {"openapi": "3.1.0", "paths": chemins})
        if self.headers.get("Authorization") != "Bearer rfk_test":
            return self.envoyer(401, {"type": "about:blank", "code": "unauthorized"})
        n = int(self.headers.get("Content-Length") or 0)
        corps = json.loads(self.rfile.read(n) or b"{}") if n else {}
        REFRACT.append((methode, p, corps, self.headers.get("Idempotency-Key")))
        if p == "/me":
            return self.envoyer(200, {"data": {"username": "etienne"}})
        m = re.fullmatch(r"/search/(tmdb|imdb)/([^/]+)", p)
        if m:
            if m.group(2) in ("999999",):
                return self.envoyer(200, {"data": []})
            t = "s" if q.get("type") == "show" else "m"
            return self.envoyer(200, {"data": [{"ids": {"refract": f"rf-{t}-{m.group(2)}", "tmdb": m.group(2)}}]})
        if p.startswith("/ratings/") and methode == "GET":
            return self.envoyer(404, {"code": "not_found"})
        if p == "/history/movies" and methode == "POST":
            return self.envoyer(201, {"data": {"id": "play-1"}})
        if p == "/watchlist" and methode == "GET":
            return self.envoyer(200, {"data": [{"ids": {"refract": "rf-m-490", "tmdb": 490}, "type": "movie"}],
                                      "has_more": False})
        if re.fullmatch(r"/watchlist/[^/]+", p) and methode == "PUT" and p.endswith("rf-m-603"):
            return self.envoyer(409, {"code": "IN_LIBRARY"})
        return self.envoyer(200 if methode != "POST" else 201, {"ok": True})

    def do_GET(self):
        u = urllib.parse.urlsplit(self.path)
        q = dict(urllib.parse.parse_qsl(u.query))
        p = u.path
        if p.startswith("/refract/v1"):
            return self.refract("GET", p[11:], q)
        time.sleep(0.01)
        if p.startswith("/img/"):
            return self.envoyer(200, image("/" + p.split("/", 3)[3], p.split("/")[2]), "image/jpeg")
        if p == "/imdb.tsv.gz":
            lignes = "tconst\taverageRating\tnumVotes\n" + "".join(f"{k}\t{v[0]}\t{v[1]}\n" for k, v in sorted(IMDB_NOTES.items()))
            return self.envoyer(200, gzip.compress(lignes.encode()), "application/gzip")
        if p == "/nominatim":
            noms = [("Le Champo", "Paris"), ("Champollion", "Grenoble")] if "champ" in q.get("q", "").lower() else [("MK2 Bibliothèque", "Paris")]
            return self.envoyer(200, [{"type": "cinema", "category": "amenity", "name": n, "address": {"city": v}} for n, v in noms])
        if p == "/monde.json":
            return self.envoyer(200, monde())
        if p == "/wikidata":
            qq = q.get("query", "")
            if "P1411" in qq and '"496243"' in qq:
                b = [{"type": {"value": "gagne"}, "prixFr": {"value": "Palme d'or"}, "prixEn": {"value": "Palme d'Or"}, "annee": {"value": "2019"}},
                     {"type": {"value": "gagne"}, "prixFr": {"value": "Oscar du meilleur film"}, "prixEn": {"value": "Academy Award for Best Picture"}, "annee": {"value": "2020"}},
                     {"type": {"value": "gagne"}, "prixFr": {"value": "Oscar du meilleur réalisateur"}, "prixEn": {"value": "Academy Award for Best Director"}, "annee": {"value": "2020"}},
                     {"type": {"value": "nomme"}, "prixFr": {"value": "BAFTA du meilleur film"}, "prixEn": {"value": "BAFTA Award for Best Film"}, "annee": {"value": "2020"}},
                     {"type": {"value": "nomme"}, "prixFr": {"value": "Golden Globe du meilleur réalisateur"}, "prixEn": {"value": "Golden Globe Award for Best Director"}, "annee": {"value": "2020"}},
                     {"type": {"value": "gagne"}, "prixFr": {"value": "Prix du public"}, "prixEn": {"value": "Audience Award"}, "annee": {"value": "2019"}}]
            elif "P1411" in qq and '"1018"' in qq:
                b = [{"type": {"value": "gagne"}, "prixFr": {"value": "Prix de la mise en scène"}, "prixEn": {"value": "Cannes Best Director Award"}, "annee": {"value": "2001"}},
                     {"type": {"value": "nomme"}, "prixFr": {"value": "Oscar du meilleur réalisateur"}, "prixEn": {"value": "Academy Award for Best Director"}, "annee": {"value": "2002"}},
                     {"type": {"value": "gagne"}, "prixFr": {"value": "César du meilleur film étranger"}, "prixEn": {"value": "César Award for Best Foreign Film"}, "annee": {"value": "2002"}}]
            elif "P4985" in qq and '"5602"' in qq:
                b = [{"prixLabel": {"value": "Palme d'or"}, "annee": {"value": "1990"}, "oeuvreLabel": {"value": "Sailor et Lula"}},
                     {"prixLabel": {"value": "Prix de la mise en scène du Festival de Cannes"}, "annee": {"value": "2001"}, "oeuvreLabel": {"value": "Mulholland Drive"}, "tmdbFilm": {"value": "1018"}},
                     {"prixLabel": {"value": "Oscar d'honneur"}, "annee": {"value": "2019"}}]
            elif "Palme d'Or" in qq:
                b = [{"tmdb": {"value": "496243"}, "annee": {"value": "2019"}, "filmLabel": {"value": "Parasite"}},
                     {"tmdb": {"value": "290"}, "annee": {"value": "1991"}, "filmLabel": {"value": "Barton Fink"}},
                     {"tmdb": {"value": "1235"}, "annee": {"value": "1990"}, "filmLabel": {"value": "Sailor et Lula"}}]
            elif "Best Picture" in qq:
                b = [{"tmdb": {"value": "496243"}, "annee": {"value": "2020"}, "filmLabel": {"value": "Parasite"}},
                     {"tmdb": {"value": "194662"}, "annee": {"value": "2015"}, "filmLabel": {"value": "Birdman"}},
                     {"tmdb": {"value": "6977"}, "annee": {"value": "2008"}, "filmLabel": {"value": "No Country for Old Men"}}]
            else:
                b = []
            return self.envoyer(200, {"results": {"bindings": b}})
        if p.startswith("/github"):
            return self.github("GET", p[7:], q)
        if not p.startswith("/tmdb/3"):
            return self.envoyer(404, {})
        p = p[7:]
        m = re.fullmatch(r"/movie/(\d+)", p)
        if m:
            return self.envoyer(200, film(int(m.group(1)))) if int(m.group(1)) in F else self.envoyer(404, {})
        m = re.fullmatch(r"/tv/(\d+)", p)
        if m:
            return self.envoyer(200, serie(int(m.group(1)))) if int(m.group(1)) in TV else self.envoyer(404, {})
        m = re.fullmatch(r"/tv/(\d+)/season/(\d+)", p)
        if m:
            return self.envoyer(200, saison(int(m.group(1)), int(m.group(2))))
        m = re.fullmatch(r"/(movie|tv)/(\d+)/watch/providers", p)
        if m:
            return self.envoyer(200, {"results": fournisseurs(("m:" if m.group(1) == "movie" else "t:") + m.group(2))})
        m = re.fullmatch(r"/(movie|tv)/(\d+)/recommendations", p)
        if m:
            d = film(int(m.group(2))) if m.group(1) == "movie" and int(m.group(2)) in F else {"recommendations": {"results": []}}
            return self.envoyer(200, {"results": d.get("recommendations", {}).get("results", [])})
        m = re.fullmatch(r"/person/(\d+)", p)
        if m:
            return self.envoyer(200, personne(int(m.group(1)))) if int(m.group(1)) in P else self.envoyer(404, {})
        m = re.fullmatch(r"/person/(\d+)/combined_credits", p)
        if m:
            return self.envoyer(200, personne(int(m.group(1)))["combined_credits"])
        if p == "/search/multi":
            return self.envoyer(200, {"results": recherche(q.get("query", "")), "page": 1, "total_pages": 1})
        if p in ("/search/movie", "/search/tv"):
            r = [x for x in recherche(q.get("query", "")) if x["media_type"] == ("movie" if p.endswith("movie") else "tv")]
            return self.envoyer(200, {"results": r})
        m = re.fullmatch(r"/find/(tt\d+)", p)
        if m:
            fm = [resume_film(f) for f in FILMS if f[17] == m.group(1)]
            tv = [resume_serie(s) for s in SERIES if s[13] == m.group(1)]
            return self.envoyer(200, {"movie_results": fm, "tv_results": tv})
        if p.startswith("/discover/"):
            r = [resume_film(f) for f in FILMS if (not q.get("with_genres") or int(q["with_genres"]) in f[5])]
            return self.envoyer(200, {"results": r, "page": 1, "total_pages": 1})
        if p == "/watch/providers/movie":
            return self.envoyer(200, {"results": [{"provider_id": v, "provider_name": k, "display_priorities": {"FR": i}} for i, (k, v) in enumerate(FOURN_IDS.items())]})
        if p == "/authentication/token/new":
            return self.envoyer(200, {"request_token": "jeton-test"})
        if p == "/account":
            return self.envoyer(200, {"id": 42, "username": "etienne_test"})
        if re.fullmatch(r"/movie/\d+/account_states", p):
            return self.envoyer(200, {"watchlist": False, "rated": False, "favorite": False})
        m = re.fullmatch(r"/account/42/(\w+)/(movies|tv)|/account/42/lists", p)
        if m:
            if p.endswith("rated/movies"):
                r = [dict(resume_film(F[275]), rating=8.0), dict(resume_film(F[6977]), rating=9.0)]
            elif p.endswith("watchlist/movies"):
                r = [resume_film(F[329865])]
            elif p.endswith("lists"):
                r = [{"id": 7001, "name": "Néo-noirs", "description": ""}]
            else:
                r = []
            return self.envoyer(200, {"results": r, "page": 1, "total_pages": 1})
        m = re.fullmatch(r"/list/(\d+)", p)
        if m:
            return self.envoyer(200, {"items": [resume_film(F[793]), resume_film(F[638])], "page": 1, "total_pages": 1})
        self.envoyer(404, {"status_message": "inconnu " + p})

    def do_POST(self):
        u = urllib.parse.urlsplit(self.path)
        if u.path.startswith("/refract/v1"):
            return self.refract("POST", u.path[11:], {})
        if u.path.startswith("/github"):
            return self.github("POST", u.path[7:], {})
        corps = self.corps()
        ECRITURES.append(("POST", u.path, corps))
        if u.path.endswith("/authentication/session/new"):
            return self.envoyer(200, {"success": True, "session_id": "session-test"})
        if u.path.endswith("/list"):
            return self.envoyer(201, {"list_id": 8001})
        self.envoyer(201, {"success": True})

    def do_DELETE(self):
        if self.path.startswith("/refract/v1"):
            return self.refract("DELETE", urllib.parse.urlsplit(self.path).path[11:], {})
        ECRITURES.append(("DELETE", self.path, {}))
        self.envoyer(200, {"success": True})

    def do_PUT(self):
        u = urllib.parse.urlsplit(self.path)
        if u.path.startswith("/refract/v1"):
            return self.refract("PUT", u.path[11:], {})
        return self.github("PUT", u.path[7:], {})

    def github(self, methode, p, q):
        auth = self.headers.get("Authorization") or ""
        if (auth or methode != "GET") and auth not in ("Bearer jeton-etienne", "Bearer jeton-lily"):   # dépôt public
            return self.envoyer(401, {"message": "Bad credentials"})
        with VERROU:
            m = re.fullmatch(r"/repos/test/silencio(.*)", p)
            if not m:
                return self.envoyer(404, {"message": "Not Found"})
            r = m.group(1)
            if r == "":
                return self.envoyer(200, {"default_branch": "main", "permissions": {"pull": True, "push": bool(auth)}})
            mm = re.fullmatch(r"/branches/(\w+)", r)
            if mm:
                return self.envoyer(200 if mm.group(1) in DEPOT["branches"] else 404, {})
            if r == "/git/ref/heads/main":
                return self.envoyer(200, {"object": {"sha": DEPOT["branches"]["main"]}})
            if r == "/git/refs" and methode == "POST":
                c = self.corps()
                DEPOT["branches"][c["ref"].split("/")[-1]] = c["sha"]
                return self.envoyer(201, {})
            if r == "/contents/profils" and methode == "GET":
                b = q.get("ref", "main")
                l = [{"name": k[1].split("/")[-1], "sha": v[0], "type": "file"} for k, v in DEPOT["fichiers"].items() if k[0] == b and k[1].startswith("profils/")]
                return self.envoyer(200 if l else 404, l)
            mm = re.fullmatch(r"/contents/(profils/[\w.-]+)", r)
            if mm:
                chem = mm.group(1)
                if methode == "GET":
                    ref = q.get("ref", "main")
                    if ref in DEPOT["branches"]:
                        v = DEPOT["fichiers"].get((ref, chem))
                    else:   # un commit
                        v = next(((s, o) for c in DEPOT["commits"] if c["sha"] == ref for (s, o) in [c["fichier"]]), None)
                    return self.envoyer(200, v[1], "application/octet-stream") if v else self.envoyer(404, {})
                c = self.corps()
                b = c.get("branch", "main")
                actuel = DEPOT["fichiers"].get((b, chem))
                if actuel and c.get("sha") != actuel[0]:
                    return self.envoyer(409, {"message": "sha mismatch"})
                if not actuel and c.get("sha"):
                    return self.envoyer(422, {"message": "sha given for new file"})
                octets = base64.b64decode(c["content"])
                sha = hashlib.sha1(octets + str(time.time()).encode()).hexdigest()
                DEPOT["fichiers"][(b, chem)] = (sha, octets)
                DEPOT["commits"].insert(0, {"sha": "c" + sha[:12], "chemin": chem, "fichier": (sha, octets), "message": c["message"],
                                            "date": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())})
                return self.envoyer(200, {"content": {"sha": sha}})
            if r == "/commits":
                chem = q.get("path")
                return self.envoyer(200, [{"sha": c["sha"], "commit": {"message": c["message"], "committer": {"date": c["date"]}}}
                                          for c in DEPOT["commits"] if c["chemin"] == chem][:40])
        return self.envoyer(404, {"message": "Not Found"})


ECRITURES = []
REFRACT = []
REFRACT_CAPS = False


def lancer(port):
    s = ThreadingHTTPServer(("127.0.0.1", port), H)
    threading.Thread(target=s.serve_forever, daemon=True).start()
    return s


if __name__ == "__main__":
    lancer(int(sys.argv[1]) if len(sys.argv) > 1 else 9911)
    print("faux services prêts")
    while True:
        time.sleep(3600)
