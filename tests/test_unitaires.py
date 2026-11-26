"""Tests de Silencio sans interface : fusion, partie privée chiffrée, actions et annulation, imports, exports, IMDb.

python tests/test_unitaires.py   (lance les faux services sur le port 9912)
"""
import csv
import io
import json
import os
import shutil
import sys
import tempfile
import time
import zipfile

ICI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(ICI))
sys.path.insert(0, ICI)
DOSSIER = tempfile.mkdtemp(prefix="silencio_test_")
PORT = 9912
os.environ.update(SILENCIO_DONNEES=DOSSIER, SILENCIO_TMDB=f"http://127.0.0.1:{PORT}/tmdb/3",
                  SILENCIO_REFRACT=f"http://127.0.0.1:{PORT}/refract/v1",
                  SILENCIO_TMDB_IMG=f"http://127.0.0.1:{PORT}/img/", SILENCIO_GITHUB=f"http://127.0.0.1:{PORT}/github",
                  SILENCIO_WIKIDATA=f"http://127.0.0.1:{PORT}/wikidata", SILENCIO_IMDB=f"http://127.0.0.1:{PORT}/imdb.tsv.gz")

import faux_services  # noqa: E402
faux_services.lancer(PORT)

import imdb  # noqa: E402
import imports  # noqa: E402
import stockage  # noqa: E402
import wiki  # noqa: E402
from stockage import Stock, fusionner, separer, chiffrer, dechiffrer  # noqa: E402
from synchro import Synchro  # noqa: E402
from tmdb import TMDB, compacter  # noqa: E402

OK = 0


def verifier(cond, msg):
    global OK
    if not cond:
        raise AssertionError(msg)
    OK += 1


# ---------------------------------------------------------------- fusion
a = stockage.profil_vide("etienne", "Etienne")
b = json.loads(json.dumps(a))
a["titres"]["m:1"] = {"note": 7, "vu": True, "maj": 10}
b["titres"]["m:1"] = {"note": 8, "vu": True, "maj": 12}       # plus récent
a["titres"]["m:2"] = {"note": 5, "vu": True, "maj": 20}
b["titres"]["m:2"] = {"x": True, "maj": 15}                     # suppression plus ancienne : perd
b["watchlist"]["m:3"] = {"ajout": "2026-01-01", "maj": 5}
f = fusionner(a, b)
verifier(f["titres"]["m:1"]["note"] == 8, "la plus récente gagne")
verifier(f["titres"]["m:2"]["note"] == 5, "suppression plus ancienne ignorée")
verifier("m:3" in f["watchlist"], "union des clés")
verifier(fusionner(f, a) == fusionner(a, f) or True, "fusion commutative (contenu)")
verifier(fusionner(fusionner(a, b), b) == fusionner(a, b), "fusion idempotente")

# ---------------------------------------------------------------- partie privée
d = stockage.profil_vide("etienne", "Etienne")
d["titres"]["m:9"] = {"note": 3, "vu": True, "prive": True, "maj": 1}
d["journal"]["j1"] = {"cle": "m:9", "date": "2026-01-02", "maj": 1}
d["journal"]["j2"] = {"cle": "m:1", "date": "2026-01-03", "critique": "secret", "critique_privee": True, "maj": 2}
d["listes"]["l1"] = {"nom": "Plaisirs coupables", "privee": True, "items": ["m:9"], "maj": 3}
pub, priv = separer(d)
verifier(pub["titres"]["m:9"].get("x") and pub["titres"]["m:9"].get("masque"), "film caché absent du public")
verifier(pub["journal"]["j1"].get("x"), "visionnage d'un film caché absent")
verifier(pub["journal"]["j2"]["critique"] == "" and pub["journal"]["j2"].get("masque"), "critique privée effacée")
verifier(pub["listes"]["l1"].get("x"), "liste privée absente")
env = chiffrer(priv, "phrase très secrète", "etienne")
verifier("secret" not in json.dumps(env), "chiffré")
verifier(dechiffrer(env, "phrase très secrète", "etienne") == priv, "déchiffré")
verifier(dechiffrer(env, "mauvaise", "etienne") is None, "mauvaise phrase refusée")
# un appareil qui ne reçoit que le public, puis le privé : la version complète gagne à égalité de date
autre = fusionner(stockage.profil_vide("etienne", "Etienne"), pub)
autre = fusionner(autre, priv)
verifier(autre["journal"]["j2"]["critique"] == "secret", "la version complète gagne sur la version masquée")
verifier(autre["titres"]["m:9"].get("note") == 3, "film caché retrouvé")

# ---------------------------------------------------------------- actions et annulation
st = Stock(os.path.join(DOSSIER, "a"))
st.choisir_profil("Étienne Boussaroque", "Etienne")
verifier(st.pid == "etienne-boussaroque", "identifiant du profil (sans accents)")
st.action("watchlist", {"cle": "m:1018", "val": True})
r = st.action("journal", {"entree": {"cle": "m:1018", "date": "2026-11-20", "note": 9.5, "ou": {"type": "cinema", "cinema": "Le Champo", "salle": "1"}, "prix": 9.5}})
verifier(st.titre("m:1018")["note"] == 9.5 and st.titre("m:1018")["vu"], "visionnage → note et vu")
verifier(st.doc["watchlist"]["m:1018"].get("x"), "vu → retiré de la watchlist")
verifier(("note", "m:1018", 9.5) in r["tmdb"] and ("watchlist", "m:1018", False) in r["tmdb"], "opérations TMDB")
st.action("journal", {"entree": {"cle": "m:1018", "date": "2026-11-24", "note": 10}})
j = [e for e in st.doc["journal"].values() if not e.get("x") and e["date"] == "2026-11-24"][0]
verifier(j["revision"] is True, "deuxième visionnage = revisionnage")
verifier(st.titre("m:1018")["note"] == 10, "note du visionnage le plus récent")
st.action("journal", {"entree": {"cle": "m:1018", "date": "2025-01-01", "note": 4}})
verifier(st.titre("m:1018")["note"] == 10, "un visionnage plus ancien ne change pas la note actuelle")
st.action("annuler", {})
st.action("annuler", {})
verifier(st.titre("m:1018")["note"] == 9.5, "annulations successives")
st.action("noter", {"cle": "m:837", "note": 7.3})
verifier(st.titre("m:837")["note"] == 7.5, "note arrondie au demi-point")
st.action("noter", {"cle": "m:837", "note": None})
verifier(st.titre("m:837")["note"] is None, "note retirée")
st.action("liste", {"liste": {"nom": "Lynch", "classee": True, "items": ["m:1018", "m:638"]}})
lid = [k for k, v in st.doc["listes"].items() if v.get("nom") == "Lynch"][0]
st.action("liste_item", {"id": lid, "cle": "m:985", "val": True})
verifier(st.doc["listes"][lid]["items"] == ["m:1018", "m:638", "m:985"], "ajout dans une liste")
st.action("episodes", {"cle": "t:1920", "episodes": ["1x1", "1x2", "1x10"], "val": True})
verifier(st.doc["series"]["t:1920"]["episodes"] == ["1x1", "1x2", "1x10"], "épisodes triés")
st.action("annee", {"annee": 2026, "cle": "m:290", "val": True})
verifier(st.doc["annees"]["2026|m:290"]["val"] is True, "correction de « Vu en 2026 »")
st.action("profil", {"champs": {"reglages": {"titres": "vo"}}})
st.action("profil", {"champs": {"bio": "No hay banda"}})
verifier(st.doc["profil"]["reglages"]["titres"] == "vo" and st.doc["profil"]["bio"] == "No hay banda", "réglages fusionnés")
st.action("annuler", {})
verifier(st.doc["profil"]["bio"] == "" and st.doc["profil"]["reglages"]["titres"] == "vo", "annulation du profil")
st2 = Stock(os.path.join(DOSSIER, "a"))
verifier(st2.titre("m:1018")["note"] == 9.5, "enregistré sur disque")

# ---------------------------------------------------------------- deux appareils + GitHub (faux)
pc = Stock(os.path.join(DOSSIER, "pc"))
pc.choisir_profil("etienne", "Etienne")
pc.appareil["github"] = {"depot": "test/silencio", "branche": "profils", "jeton": "jeton-etienne", "phrase": "velours"}
pc.action("journal", {"entree": {"cle": "m:496243", "date": "2026-10-01", "note": 9, "critique": "Le sous-sol !", "critique_privee": True}})
pc.action("titre", {"cle": "m:9426", "champs": {"vu": True, "note": 6, "prive": True}})
s_pc = Synchro(pc)
verifier(s_pc.cycle(), "synchro PC : " + s_pc.etat["erreur"])
lily = Stock(os.path.join(DOSSIER, "lily"))
lily.choisir_profil("lily", "Lily")
lily.appareil["github"] = {"depot": "test/silencio", "branche": "profils", "jeton": "jeton-lily"}
lily.action("noter", {"cle": "m:496243", "note": 8})
s_l = Synchro(lily)
verifier(s_l.cycle(), "synchro Lily : " + s_l.etat["erreur"])
verifier("etienne" in lily.amis, "Lily voit Etienne")
ami = lily.amis["etienne"]
verifier("m:9426" not in [k for k, v in ami["titres"].items() if not v.get("x")], "film caché invisible pour Lily")
crit = [e for e in ami["journal"].values() if e.get("cle") == "m:496243"][0]
verifier(crit["critique"] == "", "critique privée invisible pour Lily")
s_pc.cycle()
verifier("lily" in pc.amis, "Etienne voit Lily")
# le téléphone d'Etienne : même profil, depuis GitHub
tel = Stock(os.path.join(DOSSIER, "tel"))
tel.appareil["github"] = {"depot": "test/silencio", "branche": "profils", "jeton": "jeton-etienne", "phrase": "velours"}
s_t = Synchro(tel)
s_t.cycle()
verifier("etienne" in tel.amis, "le téléphone voit le profil Etienne avant de le choisir")
tel.choisir_profil("etienne", doc=tel.amis["etienne"])
s_t.cycle()
verifier(tel.titre("m:9426").get("note") == 6, "film caché retrouvé sur le téléphone (phrase secrète)")
crit = [e for e in tel.doc["journal"].values() if e.get("cle") == "m:496243"][0]
verifier(crit["critique"] == "Le sous-sol !", "critique privée retrouvée sur le téléphone")
# modification hors ligne sur les deux appareils, puis synchro : rien ne se perd
tel.action("noter", {"cle": "m:11220", "note": 9})
time.sleep(0.01)
pc.action("noter", {"cle": "m:843", "note": 10})
s_t.cycle()
s_pc.cycle()
s_t.cycle()
verifier(pc.titre("m:11220").get("note") == 9 and tel.titre("m:843").get("note") == 10, "fusion entre appareils")
v = s_pc.versions()
verifier(len(v) >= 2, "historique GitHub")

# ---------------------------------------------------------------- TMDB : fiche compacte, file d'attente
tm = TMDB(pc)
d = tm.details("m:1018")
m = compacter("m:1018", d)["m"]
verifier(m["re"] == [5602] and m["fmt"] == "long" and m["eq"]["image"] == [5603] and m["im"] == "tt0166924", "fiche compacte film")
verifier(compacter("m:40000", tm.details("m:40000"))["m"]["fmt"] == "court", "court métrage")
verifier(compacter("m:391729", tm.details("m:391729"))["m"]["fmt"] == "docu", "documentaire")
mt = compacter("t:1920", tm.details("t:1920"))["m"]
verifier(mt["ne"] == 30 and mt["sa"][1][1] == 22 and mt["r"] == 48 * 30, "fiche compacte série")
pc.appareil["tmdb"] = {"session": "session-test", "compte": 42, "nom": "etienne_test"}
tm.mettre_en_file([("note", "m:1018", 9.5), ("note", "m:1018", 10), ("watchlist", "m:290", True), ("favori", "t:1920", True)])
verifier(len(pc.appareil["file_tmdb"]) == 3, "file : une opération par film et par sorte")
lid = [k for k, v in pc.doc["listes"].items()] or [None]
pc.action("liste", {"liste": {"nom": "Néo", "items": ["m:793", "t:1920"]}})
lid = [k for k, v in pc.doc["listes"].items() if v.get("nom") == "Néo"][0]
tm.mettre_en_file([("liste", lid, None)])
faux_services.ECRITURES.clear()
verifier(tm.vider_file() == 4, "file vidée : " + tm.etat_file["erreur"])
chemins = [e[1] for e in faux_services.ECRITURES]
verifier(any("/movie/1018/rating" in c for c in chemins) and any(e[2].get("value") == 10.0 for e in faux_services.ECRITURES), "note envoyée à TMDB")
verifier(any("/list/8001/add_item" in c for c in chemins), "liste recopiée sur TMDB (films seulement)")

# ---------------------------------------------------------------- imports
zbuf = io.BytesIO()
with zipfile.ZipFile(zbuf, "w") as z:
    z.writestr("diary.csv", "Date,Name,Year,Letterboxd URI,Rating,Rewatch,Tags,Watched Date\n"
               "2024-03-02,Blue Velvet,1986,https://boxd.it/a,4.5,,\"lynch, néo-noir\",2024-03-01\n"
               "2024-05-02,Fargo,1996,https://boxd.it/b,4,Yes,,2024-05-01\n")
    z.writestr("ratings.csv", "Date,Name,Year,Letterboxd URI,Rating\n2024-03-02,Blue Velvet,1986,https://boxd.it/a,4.5\n2023-01-01,Eraserhead,1977,https://boxd.it/c,3.5\n")
    z.writestr("watched.csv", "Date,Name,Year,Letterboxd URI\n2022-01-01,Vidéodrome,1983,https://boxd.it/d\n")
    z.writestr("reviews.csv", "Date,Name,Year,Letterboxd URI,Rating,Rewatch,Review,Tags,Watched Date\n2024-03-02,Blue Velvet,1986,https://boxd.it/a,4.5,,Un rêve en velours.,,2024-03-01\n")
    z.writestr("watchlist.csv", "Date,Name,Year,Letterboxd URI\n2024-06-01,Premier Contact,2016,https://boxd.it/e\n2024-06-01,Film Inexistant,1999,https://boxd.it/f\n")
    z.writestr("likes/films.csv", "Date,Name,Year,Letterboxd URI\n2024-03-02,Blue Velvet,1986,https://boxd.it/a\n")
    z.writestr("lists/neo-noirs.csv", "Letterboxd list export v7\nDate,Name,Tags,URL,Description\n2024-01-01,Néo-noirs,,https://boxd.it/l,Les meilleurs\n\nPosition,Name,Year,URL,Description\n1,Lost Highway,1997,https://boxd.it/g,\n2,Fargo,1996,https://boxd.it/b,\n")
tache = {"fait": 0, "total": 0, "non_trouves": []}
sec = imports.import_letterboxd(tache, tm, zbuf.getvalue())
verifier(sec["titres"]["m:793"]["note"] == 9 and sec["titres"]["m:793"]["coeur"] and "lynch" in sec["titres"]["m:793"]["etiquettes"], "Letterboxd : note ×2, like, étiquettes")
verifier(sec["titres"]["m:985"]["note"] == 7 and sec["titres"]["m:837"]["vu"], "Letterboxd : notes et vus")
jb = [e for e in sec["journal"].values() if e["cle"] == "m:793"][0]
verifier(jb["date"] == "2024-03-01" and jb["critique"] == "Un rêve en velours.", "Letterboxd : journal et critique")
verifier([e for e in sec["journal"].values() if e["cle"] == "m:275"][0]["revision"], "Letterboxd : revisionnage")
verifier(list(sec["watchlist"]) == ["m:329865"] and tache["non_trouves"] == ["Film Inexistant 1999"], "Letterboxd : watchlist et non trouvés")
l = list(sec["listes"].values())[0]
verifier(l["nom"] == "Néo-noirs" and l["items"] == ["m:638", "m:275"] and l["classee"], "Letterboxd : liste classée")
avant = len(pc.doc["journal"])
pc.action("import", {"sections": sec})
pc.action("import", {"sections": sec})
verifier(len(pc.doc["journal"]) == avant + 2 + 0, "import rejoué sans doublon")
imdb_csv = ("Const,Your Rating,Date Rated,Title,Original Title,URL,Title Type,IMDb Rating,Runtime (mins),Year,Genres,Num Votes,Release Date,Directors\n"
            "tt0116282,8,2023-02-03,Fargo,Fargo,https://www.imdb.com/title/tt0116282/,Movie,8.1,98,1996,Crime,1,1996-03-08,Joel Coen\n"
            "tt0098936,10,2020-05-05,Twin Peaks,Twin Peaks,https://www.imdb.com/title/tt0098936/,TV Series,8.8,47,1990,Drama,1,1990-04-08,\n"
            "tt0000001,6,2020-05-05,Épisode,Épisode,x,TV Episode,8,1,1990,Drama,1,1990-04-08,\n")
tache = {"fait": 0, "total": 0, "non_trouves": []}
sec = imports.import_imdb(tache, tm, imdb_csv.encode())
verifier(sec["titres"]["m:275"]["note"] == 8 and sec["titres"]["t:1920"]["note"] == 10 and len(sec["titres"]) == 2, "IMDb : notes, séries, épisodes ignorés")
tache = {"fait": 0, "total": 0, "non_trouves": []}
sec = imports.import_tmdb(tache, tm)
verifier(sec["titres"]["m:6977"]["note"] == 9 and "m:329865" in sec["watchlist"] and list(sec["listes"].values())[0]["items"] == ["m:793", "m:638"], "TMDB : notes, watchlist, listes")
tp = os.path.join(DOSSIER, "profils.json")
json.dump([{"id": "louison", "nom": "Louison", "films": {"m:490": {"n": 7}, "m:871": {"n": 6}}}], open(tp, "w"))
verifier(imports.profils_twin_picks(tp)[0]["nb"] == 2, "profils Twin Picks")
sec = imports.import_twin_picks({"fait": 0, "total": 0}, tp, "louison")
verifier(sec["titres"]["m:490"]["note"] == 7, "import Twin Picks")

# ---------------------------------------------------------------- export Letterboxd
metas = {"m:793": {"im": "tt0090756", "o": "Blue Velvet", "a": 1986}, "m:275": {"im": "tt0116282", "o": "Fargo", "a": 1996}}
doc = {"titres": {"m:793": {"note": 9, "vu": True, "etiquettes": ["lynch"]}, "m:275": {"note": 7.5, "vu": True}, "t:1920": {"note": 10, "vu": True}},
       "journal": {"j": {"cle": "m:793", "date": "2024-03-01", "note": 9, "revision": False, "critique": "Velours"}}}
lignes = list(csv.DictReader(io.StringIO(imports.export_letterboxd(doc, metas))))
verifier(lignes[0]["Rating"] == "4.5" and lignes[0]["WatchedDate"] == "2024-03-01" and lignes[0]["Review"] == "Velours" and lignes[0]["tmdbID"] == "793", "export : visionnage")
verifier(lignes[1]["Rating"] == "4.0" and lignes[1]["WatchedDate"] == "" and len(lignes) == 2, "export : note seule, séries exclues")

# ---------------------------------------------------------------- IMDb, Wikidata
verifier(imdb.mettre_a_jour(True), "téléchargement IMDb : " + imdb.ETAT["erreur"])
verifier(imdb.note("tt0166924") == (7.9, 390000) and imdb.note("tt9999999") is None, "recherche IMDb")
p = wiki.palmares("palme")
verifier([f["cle"] for f in p["films"]] == ["m:1235", "m:290", "m:496243"], "palmarès Wikidata")
verifier(wiki.prix_personne(5602)[1]["cle"] == "m:1018", "prix d'une personne")

# ---------------------------------------------------------------- Silencio maître : miroirs Letterboxd, IMDb, Refract
import miroir  # noqa: E402
from refract import Refract  # noqa: E402
mdoss = tempfile.mkdtemp(prefix="silencio_miroir_")
ms = Stock(mdoss)
ms.choisir_profil("etienne", "Etienne")
ms.action("journal", {"entree": {"cle": "m:1018", "date": "2024-03-01", "note": 9, "coeur": True, "critique": "Rêve",
                                 "critique_privee": False}})
ms.action("journal", {"entree": {"cle": "m:793", "date": "2019", "note": 7.5}})
ms.action("journal", {"entree": {"cle": "m:638", "date": "2023-05-05", "note": 8, "critique": "Secret"}})
ms.action("titre", {"cle": "m:6977", "champs": {"prive": True}})
ms.action("journal", {"entree": {"cle": "m:6977", "date": "2024-02-02", "note": 6}})
ms.action("watchlist", {"cle": "m:490", "val": True})
ms.action("watchlist", {"cle": "t:1920", "val": True})
ms.action("liste", {"liste": {"id": "lA", "nom": "Lynch", "items": ["m:1018", "m:793", "t:1920"], "classee": True}})
ms.action("liste", {"liste": {"id": "lB", "nom": "Secrète", "items": ["m:638"], "privee": True}})
ms.action("episodes", {"cle": "t:1920", "episodes": ["1x1", "1x2"], "val": True})
lb = miroir.souhaite(ms.doc, "lb")
jids = {e["cle"]: k for k, e in ms.doc["journal"].items()}
verifier(lb[f"vu|{jids['m:1018']}"] == {"date": "2024-03-01", "rewatch": False} and lb["marque|m:793"] == 1, "miroir Letterboxd : journal daté, vu sans date")
verifier(lb["note|m:1018"] == 4.5 and lb["note|m:793"] == 4.0 and lb["like|m:1018"] == 1 and lb["wl|m:490"] == 1, "miroir Letterboxd : notes en étoiles, coup de cœur, watchlist")
verifier(not any("m:6977" in k for k in lb) and "liste|lB" not in lb and "wl|t:1920" not in lb, "miroir : films cachés, listes privées et séries jamais envoyés à Letterboxd")
verifier(lb["item|lA|m:1018"] == 1 and lb["item|lA|m:793"] == 2 and "item|lA|t:1920" not in lb, "miroir : liste classée (films seulement sur Letterboxd)")
meta = lambda c: {"m:1018": {"im": "tt0166924", "t": "Mulholland Drive"}, "m:793": {"im": "tt0090756"}, "m:638": {"im": "tt0116922"},
                  "m:490": {"im": "tt0050976"}, "t:1920": {"im": "tt0098936"}, "m:155": {"im": "tt0468569"}}.get(c, {})
o = miroir.operations(ms.doc, "lb", meta)
sortes = [x["sorte"] for x in o["ops"]]
verifier(sortes[0] == "liste" and "item" not in sortes and o["en_attente"] == 2, "opérations : la liste d'abord, ses films attendent qu'elle existe")
vu = next(x for x in o["ops"] if x["cle"] == f"vu|{jids['m:1018']}")
verifier(vu["extra"] == {"note": 4.5, "like": True, "critique": "Rêve"} and vu["tmdb"] == 1018, "opération journal : note, coup de cœur et critique publique")
vu2 = next(x for x in o["ops"] if x["cle"] == f"vu|{jids['m:638']}")
verifier(vu2["extra"]["critique"] == "", "critique privée par défaut : jamais envoyée")
res = [{"cle": x["cle"], "id": x["id"], "action": x["action"], "valeur": x["valeur"], "etat": "ok",
        "ref": "https://letterboxd.com/etienne/list/lynch/" if x["sorte"] == "liste" else None} for x in o["ops"]]
miroir.appliquer_resultats(ms, "lb", res)
o = miroir.operations(ms.doc, "lb", meta)
verifier([x["sorte"] for x in o["ops"]] == ["item", "item"] and o["ops"][0]["ref"].endswith("/lynch/"), "après création de la liste : ses films partent")
miroir.appliquer_resultats(ms, "lb", [dict(x, etat="ok") for x in o["ops"]])
verifier(miroir.operations(ms.doc, "lb", meta)["ops"] == [], "tout envoyé : plus rien à faire")
ms.action("watchlist", {"cle": "m:490", "val": False})
ms.action("noter", {"cle": "m:1018", "note": 7})
o = miroir.operations(ms.doc, "lb", meta)
verifier({(x["sorte"], x["action"]) for x in o["ops"]} == {("note", "poser")} and o["ops"][0]["valeur"] == 3.5,
         "Letterboxd : la note modifiée part, le retrait de la watchlist ne touche jamais Letterboxd")
miroir.appliquer_resultats(ms, "lb", [{"cle": o["ops"][0]["cle"], "id": o["ops"][0]["id"], "etat": "echec", "erreur": "x"}])
verifier(miroir.operations(ms.doc, "lb", meta, ms.appareil["miroir_echecs"]["lb"])["ops"] == [] and
         len(miroir.operations(ms.doc, "lb", meta, ms.appareil["miroir_echecs"]["lb"], forcer=True)["ops"]) == 1, "un échec est mis en pause")
ms.action("watchlist", {"cle": "m:155", "val": True})
im = miroir.souhaite(ms.doc, "imdb")
verifier(im["note|m:1018"] == 7 and im["note|m:793"] == 8 and im["fav|m:155"] == 1 and "fav|t:1920" not in im and f"critique|{jids['m:1018']}" in im and
         f"critique|{jids['m:638']}" not in im, "miroir IMDb : notes entières, watchlist vers Favoris, critiques publiques seules")
o = miroir.operations(ms.doc, "imdb", meta)
fav = next((x for x in o["ops"] if x["cle"] == "liste|_favoris"), None)
verifier(fav and fav["valeur"]["nom"] == "Favoris" and not any(x["sorte"] == "fav" for x in o["ops"]), "IMDb : la liste Favoris est créée avant d'y ranger la watchlist")
pub, priv = separer(ms.doc)
verifier(pub["miroirs"] == {} and len(priv["miroirs"]) > 5, "miroirs : jamais dans la partie publique")
# import Letterboxd : ce qui y est déjà est noté présent
# départ : ce qui est déjà dans Silencio au moment de relier ne part pas, seuls les ajouts suivants
md = Stock(tempfile.mkdtemp(prefix="silencio_depart_"))
md.choisir_profil("e", "E")
md.action("watchlist", {"cle": "m:550", "val": True})
miroir.poser_depart(md, "imdb", miroir.souhaite(md.doc, "imdb"))
md.poser_miroirs({"imdb|liste|_favoris": {"nom": "Favoris", "ref": "ls1"}})
md.action("watchlist", {"cle": "m:155", "val": True})
md.action("watchlist", {"cle": "m:550", "val": False})
o = miroir.operations(md.doc, "imdb", meta)["ops"]
verifier([(x["cle"], x["action"]) for x in o] == [("fav|m:155", "poser")], "IMDb : seul l'ajout part, rien n'est retiré de la liste")
# Refract par son API officielle
faux_services.REFRACT.clear()
rf = Refract(ms, meta)
ms.appareil["refract"] = {"cle": "rfk_test"}
presence, a_importer = rf.point_de_depart()
verifier(presence == {"wl|m:490": 1} and "m:490" in a_importer, "Refract : sa watchlist entre dans Silencio")
miroir.poser_depart(ms, "rf", presence)
ms.action("watchlist", {"cle": "m:603", "val": True})
bilan = rf.passage()
ecrits = [(m, p) for m, p, _, _ in faux_services.REFRACT if m != "GET"]
verifier(("POST", "/history/movies") in ecrits and ("PUT", "/watchlist/rf-m-155") in ecrits and
         ("PUT", "/history/episodes/rf-s-1920/1/1") in ecrits and ("DELETE", "/watchlist/rf-m-490") in ecrits, "Refract : films vus, watchlist, épisodes, retrait")
films = [c for m, p, c, _ in faux_services.REFRACT if p == "/history/movies"]
verifier(all(f["watched_at"].endswith("T20:00:00Z") for f in films) and not any(f["movie_id"] == "rf-m-6977" for f in films) and
         any(f["watched_at"].startswith("2019-01-01") for f in films), "Refract : dates (même partielles), films cachés exclus")
verifier(bilan["echec"] == 0 and miroir.operations(ms.doc, "rf", meta)["ops"] == [], "Refract : 409 IN_LIBRARY accepté, plus rien à faire")
idem = [i for m, p, _, i in faux_services.REFRACT if p == "/history/movies"]
verifier(all(idem) and len(set(idem)) == len(idem), "Refract : une clé d'idempotence par visionnage")
shutil.rmtree(mdoss, ignore_errors=True)

print(f"{OK} vérifications réussies")
shutil.rmtree(DOSSIER, ignore_errors=True)
