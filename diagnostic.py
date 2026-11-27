"""Test de la synchro : vérifie, une par une, toutes les pièces qui envoient tes données ailleurs (GitHub, TMDB,
Refract, et par l'extension Letterboxd et IMDb), puis écrit un rapport à copier.

Deux niveaux :
  rapide  : rien n'est écrit nulle part (lectures seulement)
  complet : sur un « film témoin » absent de ton profil, chaque écriture est faite puis aussitôt défaite
            (watchlist, note, journal…), pour vérifier que l'envoi ET le retrait marchent vraiment.
Les opérations de test ne passent jamais par les miroirs : elles ne changent rien à ce que Silencio croit envoyé.
"""
import os
import platform
import shutil
import sys
import threading
import time
import traceback
import uuid

import config
import miroir
from reseau import ErreurHTTP, HorsLigne, requete

# films témoins : peu connus, présents sur TMDB, IMDb, Letterboxd et Refract ; le premier absent de ton profil sert
TEMOINS = [6, 3, 2, 5]
ATTENTE_EXT = 150                     # secondes laissées à l'extension pour répondre (sa veille passe chaque minute)
SYMBOLE = {"ok": "OK", "attention": "ATTENTION", "erreur": "ERREUR", "info": "info", "saute": "sauté"}


def appareil():
    """PC ou téléphone, et lequel."""
    android = hasattr(sys, "getandroidapilevel") or bool(os.environ.get("ANDROID_ROOT") or os.environ.get("ANDROID_DATA"))
    if android:
        detail = "Android"
        try:
            from java import jclass  # Chaquopy
            b = jclass("android.os.Build")
            detail = f"Android {jclass('android.os.Build$VERSION').RELEASE}, {b.MANUFACTURER} {b.MODEL}"
        except Exception:  # noqa: BLE001
            pass
        return {"type": "telephone", "nom": "Téléphone", "detail": detail}
    s = platform.system()
    nom = {"Windows": "PC (Windows)", "Darwin": "Mac", "Linux": "PC (Linux)"}.get(s, s or "PC")
    return {"type": "pc", "nom": nom, "detail": f"{s} {platform.release()}".strip()}


def _depuis(t):
    if not t:
        return "jamais"
    s = time.time() - t
    if s < 90:
        return "à l'instant"
    if s < 3600:
        return f"il y a {int(s // 60)} min"
    if s < 2 * 86400:
        return f"il y a {int(s // 3600)} h"
    return f"il y a {int(s // 86400)} j"


class Diagnostic:
    def __init__(self, app):
        self.app = app
        self.etat = None
        self.verrou = threading.Lock()

    # ------------------------------------------------------------------ cycle de vie
    def lancer(self, complet=False):
        with self.verrou:
            if self.etat and not self.etat["fini_serveur"]:
                return self.lire()
            self.etat = {"id": uuid.uuid4().hex[:10], "debut": time.time(), "complet": bool(complet),
                         "appareil": appareil(), "version": config.VERSION, "temoin": None, "sections": [],
                         "fini_serveur": False, "ext": None, "ext_recu": 0, "ext_demande": None}
        threading.Thread(target=self._tourner, daemon=True).start()
        return self.lire()

    def demande_ext(self):
        """Ce que l'extension doit tester (renvoyé dans /api/ext/bonjour), tant qu'elle n'a pas répondu."""
        e = self.etat
        if not e or e["ext"] is not None or not e["ext_demande"] or time.time() - e["debut"] > 900:
            return None
        return e["ext_demande"]

    def resultat_ext(self, corps):
        e = self.etat
        if not e or corps.get("id") != e["id"]:
            return {"ok": False}
        if corps.get("recu"):
            e["ext_recu"] = time.time()
        else:
            e["ext"] = {"env": corps.get("env") or {}, "sections": corps.get("sections") or [], "t": time.time()}
        return {"ok": True}

    def lire(self):
        e = self.etat
        if not e:
            return {"etat": None}
        attente = None
        if e["ext"] is None:
            ecoule = time.time() - e["debut"]
            attente = "recu" if e["ext_recu"] else ("attente" if ecoule < ATTENTE_EXT else "muette")
        fini = e["fini_serveur"] and (e["ext"] is not None or attente == "muette")
        r = dict(e, attente_ext=attente, fini=fini)
        r["texte"] = self.texte(r)
        return {"etat": r}

    # ------------------------------------------------------------------ outils
    def _section(self, sid, nom):
        s = {"id": sid, "nom": nom, "lignes": []}
        self.etat["sections"].append(s)
        return s

    @staticmethod
    def _ligne(s, etat, texte, detail=""):
        s["lignes"].append({"etat": etat, "texte": texte, "detail": str(detail or "")[:400]})

    @staticmethod
    def _erreur(e):
        if isinstance(e, HorsLigne):
            return "pas de réseau"
        if isinstance(e, ErreurHTTP):
            corps = (getattr(e, "corps", b"") or b"")[:200].decode("utf-8", "replace").replace("\n", " ")
            return f"réponse {e.code}" + (f" : {corps}" if corps else "")
        return f"{type(e).__name__} : {e}"[:300]

    def _etape(self, s, texte, fn, attendu=("ok", "deja")):
        """Une écriture de test : fn() renvoie un état ; la ligne dit si ça a marché."""
        try:
            r = fn()
            etat = r[0] if isinstance(r, tuple) else r
            ref = r[1] if isinstance(r, tuple) and len(r) > 1 else None
            if etat in attendu:
                self._ligne(s, "ok", texte, "déjà dans cet état" if etat == "deja" else "")
            elif etat == "attente":
                self._ligne(s, "info", texte, "pas proposé par ce service (en attente)")
            else:
                self._ligne(s, "erreur", texte, f"état : {etat}")
            return etat, ref
        except Exception as e:  # noqa: BLE001
            self._ligne(s, "erreur", texte, self._erreur(e))
            return "echec", None

    def _choisir_temoin(self):
        doc = self.app.stock.doc or {}
        pris = set()
        for sec in ("titres", "watchlist"):
            pris |= set((doc.get(sec) or {}).keys())
        pris |= {e.get("cle") for e in (doc.get("journal") or {}).values()}
        for n in TEMOINS:
            c = f"m:{n}"
            if c in pris:
                continue
            try:
                self.app.tmdb.assurer_metas([c], attendre=True)
            except Exception:  # noqa: BLE001
                pass
            m = self.app._meta(c) or {}
            return {"cle": c, "tmdb": n, "imdb": m.get("im") or "", "titre": m.get("t") or "", "vo": m.get("o") or "",
                    "annee": m.get("a")}
        return None

    # ------------------------------------------------------------------ le test
    def _tourner(self):
        e = self.etat
        try:
            e["temoin"] = self._choisir_temoin()
            app = self.app.stock.appareil
            e["ext_demande"] = {"id": e["id"], "complet": e["complet"], "temoin": e["temoin"],
                                "pseudo": app.get("letterboxd_pseudo", "")}
            for f in (self._appareil, self._reseau, self._github, self._plateformes, self._tmdb, self._refract,
                      self._extension_vue):
                try:
                    f()
                except Exception as x:  # noqa: BLE001
                    traceback.print_exc()
                    s = self._section("plantage", f"Test interrompu ({f.__name__})")
                    self._ligne(s, "erreur", "le test lui-même a planté", self._erreur(x))
        finally:
            e["fini_serveur"] = True
            e["fin_serveur"] = time.time()

    def _appareil(self):
        e = self.etat
        s = self._section("appareil", "Appareil")
        a = e["appareil"]
        self._ligne(s, "info", f"{a['nom']} : {a['detail']}")
        self._ligne(s, "info", f"Silencio v{config.VERSION}, Python {platform.python_version()}")
        try:
            essai = os.path.join(config.DONNEES, ".test_ecriture")
            with open(essai, "w", encoding="utf-8") as f:
                f.write("ok")
            os.remove(essai)
            libre = shutil.disk_usage(config.DONNEES).free / 1e9
            self._ligne(s, "ok" if libre > 0.3 else "attention", "Dossier des données : écriture possible",
                        f"{libre:.1f} Go libres")
        except OSError as x:
            self._ligne(s, "erreur", "Dossier des données : écriture impossible", str(x))
        st = self.app.stock
        self._ligne(s, "ok" if st.doc else "erreur", "Profil chargé" if st.doc else "Aucun profil chargé",
                    f"profil {st.pid}" if st.pid else "")
        cpt = st.appareil.get("compte") or {}
        self._ligne(s, "ok" if cpt else "attention", "Compte Silencio : relié" if cpt else "Compte Silencio : pas relié",
                    f"identifiant {cpt.get('id')}" if cpt.get("id") else "")
        t = e["temoin"]
        if t:
            self._ligne(s, "info", f"Film témoin : {t['titre'] or t['cle']} ({t['annee'] or '?'})",
                        f"TMDB {t['tmdb']}, IMDb {t['imdb'] or 'inconnu'}" +
                        (" ; écrit puis effacé partout" if e["complet"] else " ; lecture seulement"))
        else:
            self._ligne(s, "attention", "Aucun film témoin libre : tests d'écriture sautés")

    def _reseau(self):
        s = self._section("reseau", "Réseau (depuis Silencio)")
        cibles = [("TMDB", config.API_TMDB + "/configuration", {"api_key": self.app.tmdb.cle_api}),
                  ("GitHub", config.API_GITHUB + "/rate_limit", None),
                  ("Refract", config.API_REFRACT.rstrip("/") + "/openapi.json", None)]
        for nom, url, params in cibles:
            t0 = time.time()
            try:
                requete(url, params=params if not self.app.tmdb.cle_api.startswith("eyJ") or nom != "TMDB" else None,
                        entetes=self.app.tmdb._auth({}) if nom == "TMDB" and self.app.tmdb.cle_api.startswith("eyJ") else None,
                        delai=15)
                self._ligne(s, "ok", f"{nom} joignable", f"{int((time.time() - t0) * 1000)} ms")
            except ErreurHTTP as x:
                if x.code in (401, 403) and nom == "TMDB":
                    self._ligne(s, "erreur", "TMDB refuse la clé API", self._erreur(x))
                elif x.code >= 500:
                    self._ligne(s, "attention", f"{nom} joignable mais en panne", self._erreur(x))
                else:
                    self._ligne(s, "ok", f"{nom} joignable", f"réponse {x.code}")
            except Exception as x:  # noqa: BLE001
                self._ligne(s, "erreur", f"{nom} injoignable", self._erreur(x))

    def _github(self):
        s = self._section("github", "Synchro GitHub (profil, amis, autres appareils)")
        sy = self.app.synchro
        g = sy.reglages
        if not sy.active:
            self._ligne(s, "attention", "Synchro GitHub non configurée", "dépôt ou jeton manquant")
            return
        self._ligne(s, "info", f"Dépôt {g.get('depot')}, branche {g.get('branche')}")
        try:
            r = sy._api("GET", f"/repos/{g['depot']}")
            droits = (r or {}).get("permissions") or {}
            self._ligne(s, "ok" if droits.get("push") else "erreur", "Jeton GitHub accepté",
                        "écriture autorisée" if droits.get("push") else f"pas le droit d'écrire ({droits})")
        except Exception as x:  # noqa: BLE001
            self._ligne(s, "erreur", "Jeton GitHub refusé ou dépôt introuvable", self._erreur(x))
        et = sy.etat
        self._ligne(s, "erreur" if et.get("erreur") else "ok",
                    f"Dernière synchro : {_depuis(et.get('derniere'))}", et.get("erreur") or "")
        self._ligne(s, "info", f"Dernier envoi de ton profil : {_depuis(et.get('envoye'))}, {et.get('amis', 0)} ami(s) lus")

    def _plateformes(self):
        s = self._section("miroirs", "File d'envoi par plateforme")
        doc = self.app.stock.doc
        if not doc:
            return
        app = self.app.stock.appareil
        passages = app.get("miroir_passages") or {}
        departs = app.get("miroir_depart") or {}
        hist = app.get("historique_envois") or []
        for p, nom in miroir.PLATEFORMES.items():
            echecs = (app.get("miroir_echecs") or {}).get(p) or {}
            try:
                o = miroir.operations(doc, p, self.app._meta, echecs, limite=0)
                total = o["total"]
            except Exception as x:  # noqa: BLE001
                self._ligne(s, "erreur", f"{nom} : calcul de la file impossible", self._erreur(x))
                continue
            if not departs.get(p):
                self._ligne(s, "info", f"{nom} : jamais relié (aucun envoi encore)")
                continue
            etat = "ok" if total < 30 else "attention"
            self._ligne(s, etat, f"{nom} : {total} envoi(s) en attente, {len(echecs)} en échec",
                        f"dernier passage {_depuis((passages.get(p) or {}).get('quand'))}")
            ech = [h for h in hist if h.get("p") == p and h.get("etat") == "echec"][-3:]
            for h in ech:
                self._ligne(s, "attention", f"   échec récent ({_depuis(h['t'])}) : {h.get('cle')}", h.get("erreur", ""))
        n = len(app.get("file_tmdb") or [])
        self._ligne(s, "ok" if n < 30 else "attention", f"TMDB : {n} envoi(s) en attente",
                    self.app.tmdb.etat_file.get("erreur") or "")

    def _tmdb(self):
        e = self.etat
        s = self._section("tmdb", "TMDB (ton compte)")
        tm = self.app.tmdb
        if not tm.session:
            self._ligne(s, "saute", "Compte TMDB pas relié", "Réglages → Plateformes → TMDB")
            return
        try:
            p = {"session_id": tm.session}
            h = tm._auth(p)
            compte = requete(config.API_TMDB + "/account", params=p, entetes=h, delai=15)
            self._ligne(s, "ok", f"Session TMDB valide ({compte.get('username', '?')})")
        except Exception as x:  # noqa: BLE001
            self._ligne(s, "erreur", "Session TMDB refusée", self._erreur(x))
            return
        t = e["temoin"]
        if not e["complet"] or not t:
            return
        try:
            p = {"session_id": tm.session}
            h = tm._auth(p)
            st = requete(config.API_TMDB + f"/movie/{t['tmdb']}/account_states", params=p, entetes=h, delai=15)
        except Exception as x:  # noqa: BLE001
            self._ligne(s, "erreur", "Lecture de l'état du film témoin impossible", self._erreur(x))
            return
        if st.get("watchlist"):
            self._ligne(s, "saute", "Watchlist : le film témoin y est déjà, test sauté pour ne rien perdre")
        else:
            self._etape(s, "Watchlist : ajout", lambda: (tm._envoyer("watchlist", t["cle"], True), "ok")[1])
            self._etape(s, "Watchlist : retrait", lambda: (tm._envoyer("watchlist", t["cle"], False), "ok")[1])
        if st.get("rated"):
            self._ligne(s, "saute", "Note : le film témoin est déjà noté, test sauté")
        else:
            self._etape(s, "Note : envoi (7/10)", lambda: (tm._envoyer("note", t["cle"], 7), "ok")[1])
            self._etape(s, "Note : retrait", lambda: (tm._envoyer("note", t["cle"], None), "ok")[1])
        if st.get("favorite"):
            self._ligne(s, "saute", "Favori : déjà en favori, test sauté")
        else:
            self._etape(s, "Coup de cœur (favori) : ajout", lambda: (tm._envoyer("favori", t["cle"], True), "ok")[1])
            self._etape(s, "Coup de cœur (favori) : retrait", lambda: (tm._envoyer("favori", t["cle"], False), "ok")[1])

    def _refract(self):
        e = self.etat
        s = self._section("rf", "Refract (par son API)")
        rf = self.app.refract
        if not rf.cle:
            self._ligne(s, "saute", "Clé Refract absente", "Réglages → Plateformes → Refract")
            return
        if time.time() < rf.etat.get("pause_jusqua", 0):
            self._ligne(s, "attention", "Refract a demandé une pause (trop de requêtes)",
                        f"reprise {time.strftime('%H:%M', time.localtime(rf.etat['pause_jusqua']))}")
        if rf.etat.get("erreur"):
            self._ligne(s, "erreur", "Dernière erreur de la synchro Refract", rf.etat["erreur"])
        try:
            moi = rf.moi() or {}
            d = moi.get("data") or moi
            self._ligne(s, "ok", f"Clé acceptée ({d.get('username') or d.get('name') or '?'})")
        except Exception as x:  # noqa: BLE001
            self._ligne(s, "erreur", "Clé Refract refusée", self._erreur(x))
            return
        try:
            caps = rf.capacites(forcer=True)
            self._ligne(s, "info", "Coups de cœur : " + ("acceptés par l'API" if caps.get("favori") else "pas encore proposés par l'API") +
                        " ; critiques : " + ("acceptées" if caps.get("critique") else "pas encore proposées"))
        except Exception as x:  # noqa: BLE001
            self._ligne(s, "attention", "Description de l'API illisible", self._erreur(x))
        t = e["temoin"]
        if not t:
            return
        try:
            rid = rf.identifiant(t["cle"])
        except Exception as x:  # noqa: BLE001
            self._ligne(s, "erreur", "Recherche du film témoin impossible", self._erreur(x))
            return
        if not rid:
            self._ligne(s, "attention", "Film témoin introuvable chez Refract (recherche par TMDB et IMDb)")
            return
        self._ligne(s, "ok", "Recherche d'un film (TMDB → Refract)", f"id {rid}")
        if not e["complet"]:
            return
        if rf.etat.get("en_cours"):
            time.sleep(3)
        try:
            dans_wl = any(c == t["cle"] for c, _ in rf.watchlist())
        except Exception as x:  # noqa: BLE001
            dans_wl = None
            self._ligne(s, "erreur", "Lecture de la watchlist Refract impossible", self._erreur(x))
        base = {"tmdb": t["tmdb"], "imdb": t["imdb"], "titre": t["titre"], "type": "m"}
        if dans_wl is False:
            self._etape(s, "Watchlist : ajout", lambda: rf.executer(dict(base, cle=f"wl|{t['cle']}", sorte="wl", action="poser", valeur=1)))
            self._etape(s, "Watchlist : retrait", lambda: rf.executer(dict(base, cle=f"wl|{t['cle']}", sorte="wl", action="retirer", valeur=None)))
        elif dans_wl:
            self._ligne(s, "saute", "Watchlist : le film témoin y est déjà, test sauté")
        note_avant = None
        try:
            lu = rf._req("GET", f"ratings/movies/{rid}") or {}
            lu = lu.get("data", lu) if isinstance(lu, dict) else {}
            note_avant = (lu or {}).get("value") if isinstance(lu, dict) else None
        except ErreurHTTP as x:
            if x.code not in (404, 405):
                note_avant = "?"
        except Exception:  # noqa: BLE001
            note_avant = "?"
        if note_avant:
            self._ligne(s, "saute", "Note : le film témoin a peut-être déjà une note, test sauté")
        else:
            self._etape(s, "Note : envoi (7/10)", lambda: rf.executer(dict(base, cle=f"note|{t['cle']}", sorte="note", action="poser", valeur=7)))
            self._etape(s, "Note : retrait", lambda: rf.executer(dict(base, cle=f"note|{t['cle']}", sorte="note", action="retirer", valeur=None)))
        jour = time.strftime("%Y-%m-%d")
        cle_vu = f"vu|diag{e['id']}"
        _, ref = self._etape(s, "Journal : visionnage ajouté (aujourd'hui)",
                             lambda: rf.executer(dict(base, cle=cle_vu, sorte="vu", action="poser", valeur={"date": jour, "cle": t["cle"]})))
        if ref:
            self._etape(s, "Journal : visionnage supprimé",
                        lambda: rf.executer(dict(base, cle=cle_vu, sorte="vu", action="retirer", valeur=None,
                                                 avant={"date": jour, "cle": t["cle"]}, ref=ref)))
        elif not any(l["texte"].startswith("Journal : visionnage ajouté") and l["etat"] == "erreur" for l in s["lignes"]):
            self._ligne(s, "attention", "Journal : Refract n'a pas renvoyé l'identifiant du visionnage",
                        "suppression faite par recherche dans l'historique")
            self._etape(s, "Journal : visionnage supprimé (par recherche)",
                        lambda: rf.executer(dict(base, cle=cle_vu, sorte="vu", action="retirer", valeur=None,
                                                 avant={"date": jour, "cle": t["cle"]}, ref=None)))
        if miroir.CAPS_RF.get("favori"):
            self._etape(s, "Coup de cœur : ajout", lambda: rf.executer(dict(base, cle=f"like|{t['cle']}", sorte="like", action="poser", valeur=1)))
            self._etape(s, "Coup de cœur : retrait", lambda: rf.executer(dict(base, cle=f"like|{t['cle']}", sorte="like", action="retirer", valeur=None)))

    def _extension_vue(self):
        s = self._section("ext_contact", "Extension Silencio Sync (vue depuis Silencio)")
        app = self.app.stock.appareil
        vue = app.get("extension_vue") or {}
        info = app.get("extension_info") or {}
        modes = app.get("modes_ext") or {"lb": "auto", "imdb": "clic"}
        if not vue and not info:
            self._ligne(s, "erreur", "L'extension n'a jamais contacté Silencio sur cet appareil",
                        "installe-la dans Firefox et colle le code d'appairage (Réglages → Plateformes)")
            return
        if info:
            self._ligne(s, "info", f"Dernier contact : {_depuis(info.get('t'))}, Silencio Sync {info.get('version', '?')}",
                        info.get("navigateur", ""))
        for p, nom in (("lb", "Letterboxd"), ("imdb", "IMDb")):
            self._ligne(s, "info", f"{nom} : mode « {modes.get(p, 'auto')} », dernier passage {_depuis(vue.get(p))}")
        if not app.get("letterboxd_pseudo"):
            self._ligne(s, "erreur", "Pseudo Letterboxd absent dans Silencio", "Réglages → Plateformes → Letterboxd")

    # ------------------------------------------------------------------ le rapport en texte
    def texte(self, r):
        a = r["appareil"]
        lignes = [f"RAPPORT SILENCIO — {a['nom']} ({a['detail']})",
                  f"Silencio v{r['version']} — {time.strftime('%d/%m/%Y %H:%M', time.localtime(r['debut']))} — "
                  f"test {'complet (écritures faites puis défaites)' if r['complet'] else 'rapide (lecture seulement)'}"]
        t = r.get("temoin")
        if t:
            lignes.append(f"Film témoin : {t.get('titre') or 'sans titre connu'} ({t.get('annee') or '?'}) tmdb={t.get('tmdb')} imdb={t.get('imdb') or 'inconnu'}")
        sections = list(r["sections"])
        if r.get("ext"):
            env = r["ext"].get("env") or {}
            lignes.append(f"Extension : Silencio Sync {env.get('version', '?')} sur {env.get('navigateur', '?')} "
                          f"({env.get('os', '?')})")
            sections += r["ext"].get("sections") or []
        elif r.get("attente_ext") == "muette":
            sections.append({"nom": "Extension (test dans Firefox)", "lignes": [{
                "etat": "erreur", "texte": "L'extension n'a pas répondu",
                "detail": "Firefox fermé sur cet appareil, extension pas à jour (1.11.0 nécessaire pour ce test), "
                          "code d'appairage absent ou mauvaise adresse de Silencio dans l'extension"}]})
        for s in sections:
            lignes.append("")
            lignes.append(f"## {s['nom']}")
            for l in s["lignes"]:
                lignes.append(f"[{SYMBOLE.get(l['etat'], l['etat'])}] {l['texte']}" + (f" — {l['detail']}" if l.get("detail") else ""))
        tout = [l for s in sections for l in s["lignes"]]
        lignes.insert(2, f"Bilan : {sum(1 for l in tout if l['etat'] == 'ok')} OK, "
                         f"{sum(1 for l in tout if l['etat'] == 'attention')} attention, "
                         f"{sum(1 for l in tout if l['etat'] == 'erreur')} erreur(s)")
        return "\n".join(lignes)
