"""Le serveur de Silencio : l'interface web (web/), l'API JSON, et l'entretien en arrière-plan
(file TMDB, fiches des films, affiches hors ligne, notes IMDb, notifications, synchro GitHub)."""
import json
import mimetypes
import os
import re
import threading
import time
import traceback
import urllib.parse
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler

import config
import decouverte
import imdb
import imports
import wiki
from reseau import ErreurHTTP, HorsLigne, requete
from stockage import SECTIONS, Stock, lire_json, slug
from synchro import Synchro
from tmdb import TMDB, cle_titre, decouper

TAILLES = {"w92", "w154", "w185", "w300", "w342", "w500", "w780", "w1280", "h632", "original"}
URL_MONDE = os.environ.get("SILENCIO_MONDE") or "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json"
mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("application/manifest+json", ".webmanifest")


def _vivants(section):
    return {k: v for k, v in (section or {}).items() if not v.get("x")}


class App:
    def __init__(self):
        os.makedirs(config.DONNEES, exist_ok=True)
        self.stock = Stock()
        self.tmdb = TMDB(self.stock)
        self.synchro = Synchro(self.stock)
        self.notifs = decouverte.Notifications(self.stock, self.tmdb)
        self.port = config.PORT
        self.memo_meta = {}                      # clé -> (date du fichier, fiche)
        self.pers, self.mc, self.so = {}, {}, {}
        self.img_pool = ThreadPoolExecutor(max_workers=4)
        self.precharge = {"fait": 0, "total": 0}
        self._ancien_profil = self.stock.pid
        self._verrou_osm = threading.Lock()
        self._osm_dernier = 0

    # ---- arrière-plan
    def demarrer(self):
        self.synchro.demarrer()
        threading.Thread(target=self._entretien, daemon=True).start()

    def _entretien(self):
        time.sleep(2)
        tour = 0
        while True:
            try:
                self.tmdb.vider_file()
                self.tmdb.assurer_metas(self.cles_utiles())
                if tour % 5 == 0:
                    self._precharger_affiches()
                if tour % 60 == 0 and not imdb.a_jour():
                    imdb.mettre_a_jour()
                self.notifs.verifier()
            except Exception:  # noqa: BLE001
                traceback.print_exc()
            tour += 1
            time.sleep(30)

    def cles_utiles(self, amis=True):
        """Tous les titres dont on a besoin pour les stats : les tiens, et ceux de tes amis."""
        docs = ([self.stock.doc] if self.stock.doc else []) + (list(self.stock.amis.values()) if amis else [])
        cles = []
        for d in docs:
            cles += list(_vivants(d.get("titres")))
            cles += [e.get("cle") for e in _vivants(d.get("journal")).values() if e.get("cle")]
            cles += list(_vivants(d.get("watchlist")))
            for l in _vivants(d.get("listes")).values():
                cles += l.get("items") or []
            for c in _vivants(d.get("classements")).values():
                cles += c.get("items") or []
            cles += [k.split("|", 1)[1] for k in _vivants(d.get("annees")) if "|" in k]
        return [c for c in dict.fromkeys(cles) if c and c[:2] in ("m:", "t:")]

    def _precharger_affiches(self):
        """Garde sur l'appareil les affiches de tes films et de ta watchlist (tout s'affiche sans réseau)."""
        if not self.tmdb.en_ligne:
            return
        a_faire = []
        for c in self.cles_utiles(amis=False):
            m = self._meta(c)
            if m and m.get("af") and not os.path.exists(self._f_img("w342", m["af"])):
                a_faire.append(m["af"])
        self.precharge["total"] = len(a_faire)
        for af in a_faire[:120]:
            try:
                self.image("w342", af)
            except Exception:  # noqa: BLE001
                break

    # ---- images
    def _f_img(self, taille, chemin):
        return os.path.join(config.CACHE, "img", taille, chemin.strip("/").replace("/", "_"))

    def image(self, taille, chemin):
        f = self._f_img(taille, chemin)
        if os.path.exists(f):
            return f
        octets = requete(config.IMG_TMDB + taille + "/" + chemin.strip("/"), brut=True, delai=20)
        os.makedirs(os.path.dirname(f), exist_ok=True)
        tmp = f + ".tmp"
        with open(tmp, "wb") as g:
            g.write(octets)
        os.replace(tmp, f)
        return f

    # ---- la base pour les stats
    def _meta(self, cle):
        f = self.tmdb._f_meta(cle)
        try:
            mt = os.path.getmtime(f)
        except OSError:
            return None
        memo = self.memo_meta.get(cle)
        if memo and memo[0] == mt:
            return memo[1]
        d = lire_json(f)
        if not d:
            return None
        m = d["m"]
        self.pers.update({str(k): v for k, v in d.get("pers", {}).items()})
        self.mc.update({str(k): v for k, v in d.get("mc", {}).items()})
        self.so.update({str(k): v for k, v in d.get("so", {}).items()})
        self.memo_meta[cle] = (mt, m)
        return m

    def base(self):
        cles = self.cles_utiles()
        self.tmdb.assurer_metas(cles)
        titres, manquants = {}, 0
        for c in cles:
            m = self._meta(c)
            if not m:
                manquants += 1
                continue
            n = imdb.note(m.get("im"))
            if n:
                m = dict(m, ir=n[0], iv=n[1])
            titres[c] = m
        utiles = set()
        for m in titres.values():
            utiles.update(str(p) for p in m.get("ca", []))
            for ids in (m.get("eq") or {}).values():
                utiles.update(str(p) for p in ids)
        return {"titres": titres, "pers": {k: v for k, v in self.pers.items() if k in utiles},
                "mc": self.mc, "so": self.so, "manquants": manquants, "imdb": imdb.etat()}

    # ---- état général pour le navigateur
    def etat(self):
        app = self.stock.appareil
        g = self.synchro.reglages
        return {
            "version": self.stock.version, "app": config.VERSION, "profil": self.stock.doc,
            "amis": self.stock.amis,
            "appareil": {"profil": self.stock.pid, "tmdb": {"connecte": bool(self.tmdb.session),
                                                           "nom": (app.get("tmdb") or {}).get("nom", "")},
                         "github": {"depot": g.get("depot", ""), "branche": g.get("branche"),
                                    "jeton": bool(g.get("jeton")), "phrase": bool(g.get("phrase"))},
                         "cle_tmdb": bool(app.get("cle_tmdb")), "twin_picks": app.get("twin_picks") or
                         imports.chercher_twin_picks()},
            "sync": dict(self.synchro.etat, active=self.synchro.active),
            "file_tmdb": self.tmdb.etat_file, "imdb": imdb.etat(), "en_ligne": self.tmdb.en_ligne,
            "notifs": sum(1 for n in self.notifs.d["liste"] if not n["lu"]),
            "historique": self.stock.journal_recent(),
        }

    # ---- actions
    def action(self, corps):
        type_ = corps.pop("type", "")
        if not re.fullmatch(r"[a-z_]+", type_ or ""):
            raise ValueError("Action inconnue.")
        if type_ != "annuler" and not hasattr(self.stock, "_a_" + type_):
            raise ValueError("Action inconnue : " + type_)
        res = self.stock.action(type_, corps)
        self.tmdb.mettre_en_file(res.get("tmdb") or [])
        nouvelles = [m[1] for m in res.get("modifs", []) if m[0] in ("titres", "watchlist")]
        nouvelles += [m[2].get("cle") for m in res.get("modifs", []) if m[0] == "journal" and m[2]]
        if nouvelles:
            self.tmdb.assurer_metas([c for c in nouvelles if c])
        self.synchro.demander()
        threading.Thread(target=self.tmdb.vider_file, daemon=True).start()
        return {"modifs": res.get("modifs", []), "version": self.stock.version, "libelle": res.get("libelle")}

    def importer(self, sorte, octets=None, params=None):
        params = params or {}

        def faire(tache):
            if sorte == "letterboxd":
                sections = imports.import_letterboxd(tache, self.tmdb, octets)
                libelle = "Import Letterboxd"
            elif sorte == "imdb":
                sections = imports.import_imdb(tache, self.tmdb, octets)
                libelle = "Import IMDb"
            elif sorte == "tmdb":
                sections = imports.import_tmdb(tache, self.tmdb)
                libelle = "Import TMDB"
            elif sorte == "twinpicks":
                sections = imports.import_twin_picks(tache, params.get("chemin") or imports.chercher_twin_picks(),
                                                     params.get("id"))
                libelle = "Import Twin Picks"
            else:
                raise ValueError("Import inconnu.")
            res = self.stock.action("import", {"sections": sections, "libelle": libelle})
            if params.get("vers_tmdb") and sorte != "tmdb":
                ops = []
                for s, k, e in res["modifs"]:
                    if s == "titres" and e and e.get("note"):
                        ops.append(("note", k, e["note"]))
                    if s == "watchlist" and e and not e.get("x"):
                        ops.append(("watchlist", k, True))
                self.tmdb.mettre_en_file(ops)
            self.tmdb.assurer_metas(self.cles_utiles(amis=False))
            self.synchro.demander(3)
            return {"films": len(sections.get("titres", {})), "journal": len(sections.get("journal", {})),
                    "watchlist": len(sections.get("watchlist", {})), "listes": len(sections.get("listes", {})),
                    "modifs": len(res["modifs"])}
        return imports.lancer(sorte, faire)

    def profils_disponibles(self):
        locaux = []
        d = os.path.join(config.DONNEES, "profils")
        if os.path.isdir(d):
            for f in os.listdir(d):
                if f.endswith(".json"):
                    doc = lire_json(os.path.join(d, f)) or {}
                    locaux.append({"id": f[:-5], "nom": (doc.get("profil") or {}).get("nom", f[:-5]),
                                   "nb": len(_vivants(doc.get("titres")))})
        github = [{"id": i, "nom": (d.get("profil") or {}).get("nom", i), "nb": len(_vivants(d.get("titres")))}
                  for i, d in self.stock.amis.items()]
        tp = self.stock.appareil.get("twin_picks") or imports.chercher_twin_picks()
        return {"locaux": locaux, "github": github, "twin_picks": imports.profils_twin_picks(tp) if tp else [],
                "chemin_twin_picks": tp}

    def choisir_profil(self, corps):
        pid = slug(corps.get("id") or corps.get("nom") or "")
        doc = self.stock.amis.get(pid)
        self.stock.choisir_profil(pid, corps.get("nom"), doc=doc)
        mem = self.stock.appareil.setdefault("sync", {})
        mem.pop("sha_pub", None)
        mem.pop("sha_priv", None)
        mem.pop("emp_pub", None)
        mem.pop("emp_priv", None)
        self.stock.sauver_appareil()
        if corps.get("twin_picks"):
            self.importer("twinpicks", params={"id": corps["twin_picks"]})
        self.synchro.demander(1)
        return self.etat()

    def reglages(self, corps):
        app = self.stock.appareil
        if "cle_tmdb" in corps:
            app["cle_tmdb"] = (corps["cle_tmdb"] or "").strip()
        if "github" in corps:
            g = dict(app.get("github") or {})
            for k in ("depot", "branche", "jeton", "phrase"):
                if k in corps["github"] and (corps["github"][k] is not None):
                    v = corps["github"][k].strip()
                    if k == "depot":
                        v = re.sub(r"^https?://github\.com/", "", v).strip("/").removesuffix(".git")
                    if k in ("jeton", "phrase") and v == "••••":
                        continue
                    g[k] = v
            if g.get("depot") != (app.get("github") or {}).get("depot") or \
                    g.get("branche") != (app.get("github") or {}).get("branche"):
                app["sync"] = {}
                self.synchro._branche_ok = False
            app["github"] = g
        if "twin_picks" in corps:
            app["twin_picks"] = corps["twin_picks"] or ""
        self.stock.sauver_appareil()
        self.synchro.demander(1)
        return self.etat()

    # ---- pages
    def titre(self, cle):
        d = self.tmdb.details(cle)
        if d is None:
            return None
        meta = self._meta(cle) or {}
        n = imdb.note(meta.get("im"))
        if not d.get("overview"):
            try:
                d["overview_en"] = self.tmdb.synopsis_anglais(cle)
            except Exception:  # noqa: BLE001
                pass
        col = None
        if (d.get("belongs_to_collection") or {}).get("id"):
            try:
                col = self.tmdb.collection(d["belongs_to_collection"]["id"])
            except Exception:  # noqa: BLE001
                col = None
        amis = {}
        for i, a in self.stock.amis.items():
            t = (a.get("titres") or {}).get(cle)
            j = [e for e in _vivants(a.get("journal")).values() if e.get("cle") == cle]
            w = (a.get("watchlist") or {}).get(cle)
            if (t and not t.get("x")) or j or (w and not w.get("x")):
                amis[i] = {"nom": (a.get("profil") or {}).get("nom", i), "note": (t or {}).get("note"),
                           "coeur": (t or {}).get("coeur"), "vu": bool((t or {}).get("vu") or j),
                           "watchlist": bool(w and not w.get("x")),
                           "critiques": [{"date": e.get("date"), "note": e.get("note"), "texte": e.get("critique")}
                                         for e in sorted(j, key=lambda e: e.get("date", ""), reverse=True)
                                         if e.get("critique")]}
        return {"d": d, "meta": meta, "imdb": n, "collection": col, "amis": amis,
                "fournisseurs": ((d.get("watch/providers") or {}).get("results") or {}).get(config.REGION) or {}}

    def personne(self, pid):
        d = self.tmdb.personne(pid)
        if d is None:
            return None
        credits = d.get("combined_credits") or {}
        pop = {}
        for r in (credits.get("cast") or []) + (credits.get("crew") or []):
            if r.get("media_type") == "movie" or (r.get("media_type") == "tv" and r.get("episode_count", 0) >= 3):
                c = cle_titre("t" if r.get("media_type") == "tv" else "m", r["id"])
                pop[c] = max(pop.get(c, 0), r.get("popularity") or 0)
        cles = list(pop)
        self.tmdb.assurer_metas(sorted(cles, key=lambda c: -pop[c])[:250])
        fmts = {}
        for c in cles:
            m = self._meta(c)
            if m:
                fmts[c] = {"fmt": m.get("fmt"), "r": m.get("r")}
        return {"d": d, "formats": fmts}

    def filmos(self, ids):
        """Pour chaque personne : ses titres (avec leur format si connu), pour la complétion des filmographies."""
        res = {}
        for pid in ids[:80]:
            try:
                cr = self.tmdb.credits_personne(pid)
            except Exception:  # noqa: BLE001
                continue
            titres = {}
            for r in (cr.get("cast") or []):
                if r.get("media_type") == "movie":
                    titres.setdefault(cle_titre("m", r["id"]), set()).add("acteur")
            for r in (cr.get("crew") or []):
                if r.get("media_type") == "movie":
                    k = config.METIERS.get(r.get("job"))
                    if k:
                        titres.setdefault(cle_titre("m", r["id"]), set()).add(k)
            self.tmdb.assurer_metas(list(titres)[:250])
            res[pid] = [[c, sorted(r), (self._meta(c) or {}).get("fmt"), (self._meta(c) or {}).get("ds", "")]
                        for c, r in titres.items()]
        return res

    def cinemas(self, q):
        """Cinémas (OpenStreetMap / Nominatim) dont le nom contient q, en France."""
        q = (q or "").strip()
        if len(q) < 2:
            return []
        cle = q.lower()
        cache = self.stock.appareil.setdefault("cache_cinemas", {})
        if cle in cache:
            return cache[cle]
        with self._verrou_osm:                       # règle d'OpenStreetMap : une requête par seconde au plus
            attente = 1.1 - (time.time() - self._osm_dernier)
            if attente > 0:
                time.sleep(attente)
            self._osm_dernier = time.time()
            d = requete(config.NOMINATIM, params={"q": f"cinéma {q}", "format": "jsonv2", "countrycodes": "fr",
                                                  "limit": 10, "addressdetails": 1}, delai=15)
        res = []
        for x in d:
            if x.get("type") != "cinema" and x.get("category") != "amenity":
                continue
            a = x.get("address") or {}
            nom = x.get("name") or (x.get("display_name") or "").split(",")[0]
            ville = a.get("city") or a.get("town") or a.get("village") or a.get("municipality") or ""
            if nom and {"nom": nom, "ville": ville} not in res:
                res.append({"nom": nom, "ville": ville})
        cache[cle] = res
        if len(cache) > 300:
            cache.pop(next(iter(cache)))
        self.stock.sauver_appareil()
        return res

    def anniversaires(self, jours=7):
        """Les personnes vues dans au moins deux de tes titres (réalisation ou premiers rôles) qui fêtent leur
        anniversaire dans les jours qui viennent."""
        compte = {}
        for c in self.cles_utiles(amis=False):
            t = (self.stock.doc.get("titres") or {}).get(c) or {}
            if t.get("x") or not t.get("vu"):
                continue
            m = self._meta(c) or {}
            for p in set((m.get("re") or []) + (m.get("ca") or [])[:4]):
                compte.setdefault(p, []).append(c)
        candidats = sorted((p for p, l in compte.items() if len(l) >= 2), key=lambda p: -len(compte[p]))[:300]
        auj = time.localtime()
        prochains = {time.strftime("%m-%d", time.localtime(time.time() + i * 86400)): i for i in range(jours)}
        res, manquants = [], []
        for p in candidats:
            d = self.tmdb.get(f"/person/{p}", ttl=120 * 86400) if self._personne_en_cache(p) else None
            if d is None:
                manquants.append(p)
                continue
            b = d.get("birthday") or ""
            if len(b) == 10 and b[5:] in prochains:
                res.append({"id": p, "nom": d.get("name"), "photo": d.get("profile_path"), "dans": prochains[b[5:]],
                            "age": auj.tm_year - int(b[:4]), "deces": d.get("deathday"), "nb": len(compte[p]),
                            "titres": compte[p][:3]})
        if manquants:                                 # fiches téléchargées en arrière-plan, pour la prochaine fois
            self.img_pool.submit(lambda l=manquants[:60]: [self.tmdb.get(f"/person/{x}", ttl=120 * 86400) for x in l])
        return sorted(res, key=lambda x: (x["dans"], -x["nb"]))

    def _personne_en_cache(self, pid):
        import hashlib
        params = {"language": config.LANGUE}
        cle = hashlib.sha1((f"/person/{pid}" + json.dumps(params, sort_keys=True)).encode()).hexdigest()
        return os.path.exists(os.path.join(self.tmdb.dossier, cle[:2], cle + ".json"))

    def dispo(self):
        """Pour chaque titre de ta watchlist : les plateformes d'abonnement (identifiants TMDB) en France."""
        wl = list(_vivants((self.stock.doc or {}).get("watchlist")))[:300]

        def un(c):
            try:
                f = self.tmdb.fournisseurs(c)
                return c, [p["provider_id"] for p in f.get("flatrate") or []]
            except Exception:  # noqa: BLE001
                return c, None
        with ThreadPoolExecutor(max_workers=6) as ex:
            return {c: l for c, l in ex.map(un, wl) if l is not None}

    def monde(self):
        f = os.path.join(config.CACHE, "monde.json")
        if not os.path.exists(f):
            octets = requete(URL_MONDE, brut=True, delai=30)
            json.loads(octets)
            with open(f, "wb") as g:
                g.write(octets)
        return f


# ------------------------------------------------------------------------------------------------ HTTP
def fabriquer_handler(app):
    class H(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def log_message(self, *a):
            pass

        # -- réponses
        def _envoyer(self, code, corps, type_="application/json; charset=utf-8", entetes=None):
            if isinstance(corps, (dict, list)):
                corps = json.dumps(corps, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
            elif isinstance(corps, str):
                corps = corps.encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", type_)
            self.send_header("Content-Length", str(len(corps)))
            for k, v in (entetes or {}).items():
                self.send_header(k, v)
            if "Cache-Control" not in (entetes or {}):
                self.send_header("Cache-Control", "no-store")
            self.end_headers()
            if self.command != "HEAD":
                self.wfile.write(corps)

        def _fichier(self, chemin, cache="no-cache"):
            try:
                with open(chemin, "rb") as f:
                    corps = f.read()
            except OSError:
                return self._envoyer(404, {"erreur": "introuvable"})
            type_ = mimetypes.guess_type(chemin)[0] or "application/octet-stream"
            if type_.startswith("text/") or type_ in ("application/javascript", "application/json"):
                type_ += "; charset=utf-8"
            self._envoyer(200, corps, type_, {"Cache-Control": cache})

        def _corps(self):
            """Le contenu de la requête, lu une seule fois (toujours lu : sinon il pollue la requête suivante)."""
            if getattr(self, "_lu", None) is None:
                n = int(self.headers.get("Content-Length") or 0)
                self._lu = self.rfile.read(n) if n else b""
            return self._lu

        def _json(self):
            b = self._corps()
            return json.loads(b.decode("utf-8")) if b else {}

        # -- routes
        def do_HEAD(self):
            self.do_GET()

        def do_GET(self):
            u = urllib.parse.urlsplit(self.path)
            q = dict(urllib.parse.parse_qsl(u.query))
            p = u.path
            try:
                if p.startswith("/api/"):
                    return self._api_get(p[5:], q)
                if p.startswith("/img/"):
                    return self._image(p[5:])
                if p == "/tmdb/retour":
                    return self._retour_tmdb(q)
                if p in ("/", "/index.html"):
                    return self._fichier(os.path.join(config.WEB, "index.html"))
                chemin = os.path.normpath(os.path.join(config.WEB, p.lstrip("/")))
                if chemin.startswith(config.WEB) and os.path.isfile(chemin):
                    return self._fichier(chemin)
                return self._fichier(os.path.join(config.WEB, "index.html"))
            except HorsLigne:
                self._envoyer(503, {"erreur": "hors ligne", "hors_ligne": True})
            except ErreurHTTP as e:
                self._envoyer(502, {"erreur": str(e)})
            except (BrokenPipeError, ConnectionResetError):
                pass
            except Exception as e:  # noqa: BLE001
                traceback.print_exc()
                self._envoyer(500, {"erreur": str(e)})

        def do_POST(self):
            u = urllib.parse.urlsplit(self.path)
            q = dict(urllib.parse.parse_qsl(u.query))
            self._lu = None
            self._corps()
            try:
                return self._api_post(u.path[5:] if u.path.startswith("/api/") else "", q)
            except ValueError as e:
                self._envoyer(400, {"erreur": str(e)})
            except HorsLigne:
                self._envoyer(503, {"erreur": "hors ligne", "hors_ligne": True})
            except ErreurHTTP as e:
                self._envoyer(502, {"erreur": str(e)})
            except Exception as e:  # noqa: BLE001
                traceback.print_exc()
                self._envoyer(500, {"erreur": str(e)})

        def _image(self, reste):
            taille, _, chemin = reste.partition("/")
            if taille not in TAILLES or not re.fullmatch(r"[\w.-]+\.(jpg|png|svg|jpeg|webp)", chemin):
                return self._envoyer(404, {"erreur": "image"})
            try:
                f = app.image(taille, chemin)
            except (HorsLigne, ErreurHTTP):
                return self._envoyer(404, {"erreur": "image indisponible"})
            self._fichier(f, "public, max-age=2592000, immutable")

        def _retour_tmdb(self, q):
            if q.get("approved") == "true" and q.get("request_token"):
                try:
                    app.tmdb.connexion_fin(q["request_token"])
                    threading.Thread(target=app.tmdb.vider_file, daemon=True).start()
                    cible = "/#/reglages/tmdb?tmdb=ok"
                except Exception:  # noqa: BLE001
                    cible = "/#/reglages/tmdb?tmdb=erreur"
            else:
                cible = "/#/reglages/tmdb?tmdb=refus"
            self.send_response(302)
            self.send_header("Location", cible)
            self.send_header("Content-Length", "0")
            self.end_headers()

        def _api_get(self, r, q):
            if r == "etat":
                return self._envoyer(200, app.etat())
            if r == "version":
                return self._envoyer(200, {"v": app.stock.version, "sync": app.synchro.etat,
                                           "notifs": sum(1 for n in app.notifs.d["liste"] if not n["lu"])})
            if r == "base":
                return self._envoyer(200, app.base())
            if r == "recherche":
                return self._envoyer(200, {"r": app.tmdb.recherche(q.get("q", ""), int(q.get("page", 1)))})
            m = re.fullmatch(r"titre/([mt]:\d+)", r)
            if m:
                d = app.titre(m.group(1))
                return self._envoyer(200 if d else 404, d or {"erreur": "introuvable"})
            m = re.fullmatch(r"saison/(\d+)/(\d+)", r)
            if m:
                return self._envoyer(200, app.tmdb.saison(m.group(1), m.group(2)) or {})
            m = re.fullmatch(r"personne/(\d+)", r)
            if m:
                d = app.personne(int(m.group(1)))
                return self._envoyer(200 if d else 404, d or {"erreur": "introuvable"})
            m = re.fullmatch(r"prix/personne/(\d+)", r)
            if m:
                return self._envoyer(200, {"prix": wiki.prix_personne(int(m.group(1)))})
            m = re.fullmatch(r"prix/titre/([mt]:\d+)", r)
            if m:
                return self._envoyer(200, wiki.prix_film(m.group(1)))
            if r == "cinemas":
                return self._envoyer(200, {"r": app.cinemas(q.get("q", ""))})
            if r == "anniversaires":
                return self._envoyer(200, {"r": app.anniversaires()})
            if r == "dispo":
                return self._envoyer(200, app.dispo())
            m = re.fullmatch(r"palmares/(\w+)", r)
            if m and m.group(1) in config.PRIX:
                return self._envoyer(200, wiki.palmares(m.group(1)))
            if r == "palmares":
                return self._envoyer(200, {k: v[0] for k, v in config.PRIX.items()})
            if r == "filmos":
                ids = [int(x) for x in q.get("ids", "").split(",") if x.isdigit()]
                return self._envoyer(200, app.filmos(ids))
            m = re.fullmatch(r"fournisseurs/([mt]:\d+)", r)
            if m:
                return self._envoyer(200, app.tmdb.fournisseurs(m.group(1)))
            if r == "decouvrir":
                autorises = {"with_genres", "without_genres", "primary_release_date.gte", "primary_release_date.lte",
                             "first_air_date.gte", "first_air_date.lte", "with_origin_country",
                             "with_original_language", "vote_average.gte", "vote_count.gte", "with_runtime.gte",
                             "with_runtime.lte", "with_watch_providers", "with_keywords", "sort_by", "page",
                             "with_people", "with_companies"}
                params = {k: v for k, v in q.items() if k in autorises}
                if "with_watch_providers" in params:
                    params["watch_region"] = config.REGION
                    params["with_watch_monetization_types"] = "flatrate"
                return self._envoyer(200, app.tmdb.decouvrir(q.get("type", "movie"), **params))
            if r == "recos":
                return self._envoyer(200, {"r": decouverte.recommandations(app.stock, app.tmdb)})
            if r == "sorties":
                return self._envoyer(200, {"r": decouverte.sorties_favoris(app.stock, app.tmdb)})
            m = re.fullmatch(r"collection/(\d+)", r)
            if m:
                return self._envoyer(200, app.tmdb.collection(int(m.group(1))) or {})
            m = re.fullmatch(r"motcle/(\d+)", r)
            if m:
                return self._envoyer(200, app.tmdb.mot_cle(int(m.group(1)), int(q.get("page", 1))))
            if r == "fournisseurs_liste":
                d = app.tmdb.get("/watch/providers/movie", ttl=30 * 86400, watch_region=config.REGION) or {}
                return self._envoyer(200, d)
            if r == "profils":
                return self._envoyer(200, app.profils_disponibles())
            if r == "notifs":
                return self._envoyer(200, {"r": app.notifs.liste()})
            if r == "notifs/nouvelles":
                return self._envoyer(200, {"r": app.notifs.nouvelles(float(q.get("depuis") or 0)),
                                           "maintenant": time.time()})
            m = re.fullmatch(r"tache/(\w+)", r)
            if m:
                t = imports.TACHES.get(m.group(1))
                return self._envoyer(200 if t else 404, dict(t, non_trouves=t["non_trouves"][:200]) if t else {})
            if r == "tmdb/connexion":
                url = app.tmdb.connexion_debut(f"http://127.0.0.1:{app.port}/tmdb/retour")
                return self._envoyer(200, {"url": url})
            if r == "github/versions":
                return self._envoyer(200, {"r": app.synchro.versions()})
            if r == "monde":
                return self._fichier(app.monde(), "public, max-age=2592000")
            if r.startswith("export/"):
                return self._export(r[7:])
            return self._envoyer(404, {"erreur": "inconnu"})

        def _export(self, nom):
            doc = app.stock.doc or {}
            metas = {c: (app._meta(c) or {}) for c in app.cles_utiles(amis=False)}
            date = time.strftime("%Y-%m-%d")
            if nom == "letterboxd.csv":
                corps, type_, fichier = imports.export_letterboxd(doc, metas), "text/csv", f"silencio-letterboxd-{date}.csv"
            elif nom == "watchlist.csv":
                corps, type_, fichier = imports.export_watchlist_letterboxd(doc, metas), "text/csv", \
                    f"silencio-watchlist-{date}.csv"
            elif nom == "silencio.json":
                corps, type_, fichier = json.dumps(doc, ensure_ascii=False, indent=1), "application/json", \
                    f"silencio-{app.stock.pid}-{date}.json"
            else:
                return self._envoyer(404, {"erreur": "export inconnu"})
            self._envoyer(200, corps, type_ + "; charset=utf-8",
                          {"Content-Disposition": f'attachment; filename="{fichier}"'})

        def _api_post(self, r, q):
            if r == "action":
                return self._envoyer(200, app.action(self._json()))
            if r == "profil/choisir":
                return self._envoyer(200, app.choisir_profil(self._json()))
            if r == "reglages":
                return self._envoyer(200, app.reglages(self._json()))
            if r == "sync":
                threading.Thread(target=app.synchro.cycle, daemon=True).start()
                return self._envoyer(200, {"ok": True})
            if r == "github/restaurer":
                app.synchro.restaurer(self._json()["sha"])
                return self._envoyer(200, app.etat())
            if r == "tmdb/deconnexion":
                app.tmdb.deconnexion()
                return self._envoyer(200, app.etat())
            if r == "notifs/lues":
                app.notifs.marquer_lues()
                return self._envoyer(200, {"ok": True})
            if r == "notifs/verifier":
                threading.Thread(target=app.notifs.verifier, args=(True,), daemon=True).start()
                return self._envoyer(200, {"ok": True})
            if r == "imdb/maj":
                threading.Thread(target=imdb.mettre_a_jour, args=(True,), daemon=True).start()
                return self._envoyer(200, {"ok": True})
            m = re.fullmatch(r"import/(\w+)", r)
            if m:
                sorte = m.group(1)
                if sorte in ("letterboxd", "imdb"):
                    octets = self._corps()
                    if not octets:
                        raise ValueError("Fichier vide.")
                    return self._envoyer(200, {"tache": app.importer(sorte, octets, q)})
                return self._envoyer(200, {"tache": app.importer(sorte, None, dict(q, **self._json()))})
            return self._envoyer(404, {"erreur": "inconnu"})
    return H


__all__ = ["App", "fabriquer_handler", "SECTIONS", "decouper"]
