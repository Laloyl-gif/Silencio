"""Parcours complet de l'interface dans Chromium (téléphone et PC), avec les faux services.

python tests/test_interface.py [dossier_captures]
"""
import json
import os
import random
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

ICI = os.path.dirname(os.path.abspath(__file__))
RACINE = os.path.dirname(ICI)
sys.path.insert(0, RACINE)
sys.path.insert(0, ICI)
CAPT = sys.argv[1] if len(sys.argv) > 1 else "/tmp/silencio_captures"
os.makedirs(CAPT, exist_ok=True)
PF, PS = 9913, 8700
DONNEES = tempfile.mkdtemp(prefix="silencio_ui_")
ENV = dict(os.environ, SILENCIO_DONNEES=DONNEES, SILENCIO_PORT=str(PS), SILENCIO_SANS_NAVIGATEUR="1",
           SILENCIO_TMDB=f"http://127.0.0.1:{PF}/tmdb/3", SILENCIO_TMDB_IMG=f"http://127.0.0.1:{PF}/img/",
           SILENCIO_GITHUB=f"http://127.0.0.1:{PF}/github", SILENCIO_WIKIDATA=f"http://127.0.0.1:{PF}/wikidata",
           SILENCIO_IMDB=f"http://127.0.0.1:{PF}/imdb.tsv.gz", SILENCIO_REFRACT=f"http://127.0.0.1:{PF}/refract/v1", SILENCIO_MONDE=f"http://127.0.0.1:{PF}/monde.json", SILENCIO_NOMINATIM=f"http://127.0.0.1:{PF}/nominatim")
os.environ.update({k: v for k, v in ENV.items() if k.startswith("SILENCIO_")})
import faux_services  # noqa: E402
faux_services.lancer(PF)
URL = f"http://127.0.0.1:{PS}"


def api(chemin, corps=None, entetes=None):
    req = urllib.request.Request(URL + chemin, data=json.dumps(corps).encode() if corps is not None else None,
                                 headers={"Content-Type": "application/json", **(entetes or {})}, method="POST" if corps is not None else "GET")
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


import atexit  # noqa: E402
import socket  # noqa: E402
with socket.socket() as _s:
    if _s.connect_ex(("127.0.0.1", PS)) == 0:
        sys.exit(f"Le port {PS} est déjà pris (un ancien serveur de test ?)")
serveur = subprocess.Popen([sys.executable, os.path.join(RACINE, "main.py")], env=ENV, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
atexit.register(lambda: serveur.poll() is None and serveur.kill())
for _ in range(50):
    try:
        api("/api/version")
        break
    except Exception:  # noqa: BLE001
        time.sleep(0.2)

# Lily, sur un autre appareil, écrit son profil dans le (faux) dépôt GitHub
from stockage import Stock  # noqa: E402
from synchro import Synchro  # noqa: E402
lily = Stock(os.path.join(DONNEES, "_lily"))
lily.choisir_profil("lily", "Lily")
lily.appareil["github"] = {"depot": "test/silencio", "branche": "profils", "jeton": "jeton-lily"}
random.seed(4)
for cle, note in [("m:1018", 8), ("m:496243", 9.5), ("m:843", 9), ("m:290", 6), ("m:275", 8.5), ("m:837", 5), ("m:194662", 7), ("m:11104", 8)]:
    lily.action("journal", {"entree": {"cle": cle, "date": f"2026-{random.randint(1, 11):02d}-{random.randint(1, 28):02d}", "note": note, "critique": "Superbe." if note > 8.5 else ""}})
for c in ("m:329865", "m:11423", "m:30018", "m:46738"):
    lily.action("watchlist", {"cle": c, "val": True})
Synchro(lily).cycle()

erreurs = []
from playwright.sync_api import sync_playwright  # noqa: E402

TEL = {"viewport": {"width": 390, "height": 844}, "device_scale_factor": 2, "is_mobile": True, "has_touch": True}
PC = {"viewport": {"width": 1440, "height": 900}}


def capture(page, nom, plein=False):
    page.wait_for_timeout(450)
    page.screenshot(path=os.path.join(CAPT, nom + ".png"), full_page=plein)


with sync_playwright() as p:
    nav = p.chromium.launch()
    tel = nav.new_context(**TEL)
    ICONE = open(os.path.join(RACINE, "extension", "icone-48.png"), "rb").read()
    tel.route("**/favicon.ico", lambda r: r.fulfill(status=200, content_type="image/png", body=ICONE))
    pg = tel.new_page()
    pg.on("console", lambda m: erreurs.append(("tel", m.text)) if m.type == "error" else None)
    pg.on("pageerror", lambda e: erreurs.append(("tel", str(e))))
    pg.goto(URL)
    pg.wait_for_selector(".accueil-profil")
    # écran de connexion, puis création du compte (avec un fichier de compte pour les comptes reliés)
    capture(pg, "01_tel_connexion")
    pg.click("[data-o=creer]")
    pg.wait_for_selector("input[name=mot_de_passe2]")
    pg.fill("input[name=nom]", "Etienne")
    pg.fill("input[name=identifiant]", "etienne")
    pg.fill("input[name=mot_de_passe]", "silencio-test-1")
    pg.fill("input[name=mot_de_passe2]", "silencio-test-2")
    pg.click("[type=submit]")
    pg.wait_for_selector("[data-erreur]:not(:empty)")
    pg.fill("input[name=mot_de_passe2]", "silencio-test-1")
    fichier = os.path.join(CAPT, "compte-test.json")
    with open(fichier, "w", encoding="utf-8") as f:
        json.dump({"letterboxd_pseudo": "Haikazan", "imdb_pseudo": "Haika", "imdb_watchlist": "https://www.imdb.com/user/p.x/watchlist", "jeton_github": "jeton-etienne"}, f)
    pg.locator("details.compte-plus summary").first.click()
    pg.set_input_files("[data-fichier]", fichier)
    pg.wait_for_function("document.querySelector('input[name=letterboxd_pseudo]').value === 'Haikazan'")
    os.remove(fichier)
    for d in pg.locator("details.compte-plus").all():
        d.evaluate("x => x.open = true")
    if pg.locator("input[name=depot]").count():
        pg.fill("input[name=depot]", "test/silencio")
    capture(pg, "01b_tel_creer_compte", plein=True)
    pg.click("[type=submit]")
    try:
        pg.wait_for_selector(".bonjour", timeout=8000)
    except Exception:
        print(erreurs, pg.evaluate("[location.hash, !!Silencio.moi, document.querySelector('#vue').innerHTML.slice(0, 300)]"))
        raise
    capture(pg, "02_tel_accueil_vide")

    # un historique réaliste par l'API
    journal = [("m:1018", "2026-11-20", 10, {"type": "cinema", "cinema": "Le Champo", "salle": "1"}, 9.5, ["lily"], True),
               ("m:837", "2026-11-02", 7.5, {"type": "support", "nom": "Blu-ray"}, None, [], False),
               ("m:11220", "2026-10-18", 9, {"type": "plateforme", "nom": "MUBI"}, None, [], True),
               ("m:194662", "2026-09-30", 7, {"type": "plateforme", "nom": "Netflix"}, None, [], False),
               ("m:496243", "2026-07-14", 9.5, {"type": "cinema", "cinema": "MK2 Bibliothèque", "salle": "4"}, 11.9, ["lily", "Louison"], True),
               ("m:290", "2026-05-03", 8, None, None, [], False), ("m:638", "2026-04-11", 9, None, None, [], False),
               ("m:985", "2025-12-24", 7, None, None, [], False), ("m:793", "2025-11-25", 8.5, {"type": "cinema", "cinema": "Le Champo"}, 8, [], False),
               ("m:11104", "2025-10-02", 8.5, None, None, [], False), ("m:843", "2025-06-12", 10, {"type": "cinema", "cinema": "Le Champo"}, 8, ["lily"], True),
               ("m:275", "2025-03-08", 8, None, None, [], False), ("m:6977", "2024-11-25", 9, None, None, [], False),
               ("m:9426", "2024-08-01", 6.5, None, None, [], False), ("m:11423", "2024-05-20", 9, None, None, [], False),
               ("m:46738", "2024-02-14", 8, None, None, [], False), ("m:329865", "2023-12-01", 7.5, None, None, [], False),
               ("m:40000", "2023-06-01", 5, None, None, [], False), ("m:391729", "2023-02-11", 7, None, None, [], False),
               ("m:1018", "2023-01-05", 9.5, None, None, [], False)]
    for cle, date, note, ou, prix, avec, coeur in journal:
        api("/api/action", {"type": "journal", "entree": {"cle": cle, "date": date, "note": note, "ou": ou, "prix": prix, "avec": avec, "coeur": coeur,
                                                           "critique": "Le plus beau rêve d'Hollywood." if cle == "m:1018" and date.startswith("2026") else ""}})
    api("/api/action", {"type": "titre", "cle": "m:1018", "champs": {"citations": ["No hay banda. Il n'y a pas d'orchestre."], "etiquettes": ["lynch", "rêve"], "collection": {"format": "4K UHD", "edition": "Criterion"}, "detail": {"scenario": 9, "image": 10, "musique": 10}}})
    for c in ("m:30018", "m:999001", "t:1920"):
        api("/api/action", {"type": "watchlist", "cle": c, "val": True})
    api("/api/action", {"type": "episodes", "cle": "t:1920", "episodes": [f"1x{i}" for i in range(1, 9)] + ["2x1", "2x2"], "val": True})
    api("/api/action", {"type": "note_saison", "cle": "t:1920", "saison": 1, "note": 9.5})
    api("/api/action", {"type": "note_saison", "cle": "t:1920", "saison": 2, "note": 8})
    for pid, nom, metier in ((5602, "David Lynch", "real"), (137427, "Denis Villeneuve", "real"), (12453, "Wong Kar-wai", "real")):
        api("/api/action", {"type": "favori", "personne": {"id": pid, "nom": nom, "photo": faux_services.chemin(f"p{pid}"), "metier": metier}, "val": True})
    api("/api/action", {"type": "liste", "liste": {"nom": "Lynch, du meilleur au pire", "classee": True, "epinglee": True, "items": ["m:1018", "m:638", "m:793", "m:985"]}})
    api("/api/action", {"type": "liste", "liste": {"nom": "Nuits de Hong Kong", "items": ["m:11220", "m:11104", "m:843"]}})
    api("/api/action", {"type": "profil", "champs": {"bio": "No hay banda.", "banniere": {"cle": "m:1018", "image": faux_services.chemin("fd1018")}}})
    api("/api/action", {"type": "graphique", "graphique": {"titre": "Lynch contre Cronenberg", "mode": "personnes", "personnes": [{"id": 5602, "nom": "David Lynch"}, {"id": 224, "nom": "David Cronenberg"}], "role": "real", "x": "annee", "imdb": True, "profils": [""], "filtres": {}}})
    api("/api/sync", {})
    for _ in range(60):
        b = api("/api/base")
        if not b["manquants"] and b["titres"] and api("/api/etat")["imdb"]["present"]:
            break
        time.sleep(0.5)
    pg.reload()
    pg.wait_for_selector(".bonjour")
    pg.wait_for_selector(".tdb-ligne")
    pg.wait_for_timeout(1200)
    capture(pg, "03_tel_accueil", plein=True)
    tdb = api("/api/tableau")["r"]
    assert tdb and set(tdb[0]["plateformes"]) == {"lb", "imdb", "rf", "tmdb"}, tdb[:1]
    # recherche par phrase
    pg.fill("[data-recherche]", "vus au cinéma notés 9+")
    pg.wait_for_selector(".phrase-compris span")
    compris = pg.locator(".phrase-compris span").all_inner_texts()
    assert "au cinéma" in compris and any("9" in c for c in compris), compris
    assert pg.locator(".phrase .vignette[data-cle='m:1018']").count() == 1, "Mulholland Drive vu au cinéma, noté 10"
    capture(pg, "03b_tel_recherche_phrase")
    pg.fill("[data-recherche]", "")

    # ajout rapide : recherche, choix, note par clavier, détails
    pg.click("#barre-bas .plus")
    pg.fill(".modale input[type=search]", "anges")
    pg.wait_for_selector(".modale .res-recherche .ligne")
    capture(pg, "04_tel_ajout_recherche")
    pg.click(".modale .res-recherche .ligne")
    pg.wait_for_selector(".modale .case-note")
    pg.locator(".modale .case-note").nth(7).dblclick()                    # deux appuis rapides = 7,5
    pg.click(".modale .interrupteur")
    pg.fill(".modale [data-cine-recherche]", "Champo")
    pg.wait_for_selector(".modale [data-cine-res] .ligne")
    pg.click(".modale [data-cine-res] .ligne")
    pg.fill(".modale [data-salle]", "1")
    pg.fill(".modale [data-prix]", "9")
    pg.click(".modale [data-version] button[data-v=VO]")
    capture(pg, "05_tel_ajout_formulaire")
    pg.click(".modale .aj-plus")
    pg.evaluate("document.querySelector('.modale .corps-m').scrollTop = 99999")
    pg.wait_for_timeout(300)
    capture(pg, "05b_tel_ajout_plus")
    pg.click(".modale [data-ok]")
    pg.wait_for_timeout(600)
    e = api("/api/etat")
    j = [x for x in e["profil"]["journal"].values() if x.get("cle") == "m:11220" and x.get("date") == time.strftime("%Y-%m-%d")]
    assert j and j[0]["note"] == 7.5 and j[0]["ou"]["cinema"] == "Le Champo" and j[0]["ou"]["salle"] == "1" and j[0]["prix"] == 9 and j[0]["version"] == "VO", j
    assert j[0]["revision"] is True, "revisionnage détecté"
    capture(pg, "06_tel_toast")

    # page film (téléphone), série, personne
    pg.goto(URL + "/#/titre/m:1018")
    pg.wait_for_selector(".ff-tete")
    pg.wait_for_selector(".ff-prix span")
    pg.wait_for_timeout(900)
    capture(pg, "07_tel_film")
    pg.evaluate("document.head.insertAdjacentHTML('beforeend', '<style id=sans-toast>#toasts{display:none}</style>')")
    capture(pg, "07_tel_film")
    for i, y in enumerate((560, 1270, 1980)):
        pg.evaluate(f"window.scrollTo(0, {y})")
        pg.wait_for_timeout(350)
        capture(pg, f"07{'bcd'[i]}_tel_film")
    pg.evaluate("window.scrollTo(0, 0); document.getElementById('sans-toast').remove()")
    pg.goto(URL + "/#/titre/t:1920")
    pg.wait_for_selector(".saison")
    pg.click(".saison[data-s='2'] .tete")
    pg.wait_for_selector(".episode")
    pg.locator(".episode .coche").nth(2).click()
    pg.wait_for_timeout(400)
    assert "2x3" in api("/api/etat")["profil"]["series"]["t:1920"]["episodes"]
    pg.locator(".saison[data-s='2']").scroll_into_view_if_needed()
    capture(pg, "08_tel_serie")
    # glisser vers la gauche dans le journal : watchlist
    pg.goto(URL + "/#/journal")
    pg.wait_for_selector(".glisse .ligne")
    l = pg.locator(".glisse .ligne").nth(3)
    b = l.bounding_box()
    cle_glisse = l.get_attribute("data-cle")
    y = b["y"] + b["height"] / 2
    l.dispatch_event("pointerdown", {"pointerType": "touch", "clientX": b["x"] + 300, "clientY": y, "pointerId": 1, "isPrimary": True})
    for dx in range(0, 160, 20):
        l.dispatch_event("pointermove", {"pointerType": "touch", "clientX": b["x"] + 300 - dx, "clientY": y, "pointerId": 1, "isPrimary": True})
    l.dispatch_event("pointerup", {"pointerType": "touch", "clientX": b["x"] + 140, "clientY": y, "pointerId": 1, "isPrimary": True})
    pg.wait_for_timeout(600)
    wl = api("/api/etat")["profil"]["watchlist"].get(cle_glisse, {})
    assert wl and not wl.get("x"), ("glisser à gauche → watchlist", cle_glisse, wl)
    capture(pg, "09_tel_journal")
    # sélection multiple dans le journal : supprimer deux visionnages d'un coup
    avant_j = len([1 for v in api("/api/etat")["profil"]["journal"].values() if not v.get("x")])
    pg.click("[data-selection]")
    lignes_j = pg.locator(".ligne[data-j]:not([data-cle='m:1018'])")
    lignes_j.nth(-1).click(); lignes_j.nth(-2).click()
    capture(pg, "09b_tel_journal_selection")
    pg.click(".barre-selection [data-a=suppr]")
    pg.click(".modale [data-oui]")
    pg.wait_for_timeout(1200)
    apres_j = len([1 for v in api("/api/etat")["profil"]["journal"].values() if not v.get("x")])
    assert apres_j == avant_j - 2, (avant_j, apres_j)
    pg.goto(URL + "/#/envois")
    pg.wait_for_selector(".entete h1")
    pg.wait_for_timeout(500)
    capture(pg, "09c_tel_envois")
    pg.goto(URL + "/#/stats")
    pg.wait_for_selector("[data-bloc=distribution] svg")
    pg.wait_for_timeout(900)
    capture(pg, "10_tel_stats")
    pg.goto(URL + "/#/decouvrir/soir")
    pg.wait_for_selector(".grille")
    capture(pg, "11_tel_ce_soir")
    pg.goto(URL + "/#/reglages")
    pg.wait_for_selector(".menu-reglages")
    capture(pg, "12_tel_reglages")
    pg.goto(URL + "/#/reglages/affichage")
    pg.wait_for_selector("[data-plat]")
    pg.click("[data-plat='8']")
    pg.wait_for_timeout(400)
    assert 8 in api("/api/etat")["profil"]["profil"]["reglages"]["plateformes"]
    capture(pg, "12b_tel_reglages_affichage")
    # Letterboxd, IMDb, Refract : Silencio maître
    ec = api("/api/etat")
    assert ec["compte"]["connecte"] and ec["compte"]["id"] == "etienne" and ec["plateformes"]["lb"]["pseudo"] == "Haikazan" \
        and ec["plateformes"]["imdb"]["pseudo"] == "Haika", ec["compte"]
    pg.goto(URL + "/#/reglages/compte")
    pg.wait_for_selector("[data-mdp]")
    capture(pg, "12d_tel_compte", plein=True)
    # compléter les films importés
    api("/api/action", {"type": "import", "sections": {"journal": {"lbimport0001": {"cle": "m:275", "date": "2015-06-01", "note": 8, "revision": False},
                                                                   "imimport0002": {"cle": "m:837", "date": "2019-03-04", "note": 7, "revision": False, "approx": True}},
                                                       "titres": {"m:30018": {"vu": True}}}, "libelle": "Import test"})
    pg.goto(URL + "/#/reglages/completer")
    pg.wait_for_selector("[data-commencer]")
    capture(pg, "12e_tel_completer")
    pg.click("[data-commencer]")
    pg.wait_for_selector(".modale [data-garder]")
    titre_m = pg.inner_text(".modale h2")
    assert titre_m.startswith("Compléter, 1 sur"), titre_m
    capture(pg, "12f_tel_completer_film")
    pg.click(".modale [data-garder]")
    pg.wait_for_function("document.querySelector('.modale h2') && document.querySelector('.modale h2').textContent.startsWith('Compléter, 2 sur')")
    pg.click(".modale [data-cine]")
    pg.fill(".modale [data-cine-recherche]", "Le Champo")
    pg.wait_for_timeout(500)
    pg.click(".modale [data-ok]")
    pg.wait_for_function("!document.querySelector('.modale h2') || document.querySelector('.modale h2').textContent.startsWith('Compléter, 3 sur')")
    ent = api("/api/etat")["profil"]
    assert ent["profil"]["reglages"].get("completes") and any(v.get("ou", {}) and v.get("ou", {}).get("cinema") == "Le Champo" and k.startswith("lb") for k, v in ent["journal"].items()), "complété"
    pg.keyboard.press("Escape")
    pg.wait_for_timeout(400)
    pg.goto(URL + "/#/reglages/plateformes")
    pg.wait_for_selector("[data-lb-pseudo]")
    pg.fill("[data-lb-pseudo]", "etienne")
    pg.press("[data-lb-pseudo]", "Tab")
    pg.wait_for_timeout(1200)
    pg.fill("[data-rf-cle]", "rfk_test")
    pg.click("[data-rf-ok]")
    pg.wait_for_timeout(2500)
    e = api("/api/etat")["plateformes"]
    assert e["rf"]["connecte"] and e["rf"]["nom_compte"] == "etienne" and e["lb"]["pseudo"] == "etienne", e["rf"]
    for _ in range(30):
        if api("/api/etat")["plateformes"]["rf"]["envoye"] > 3:
            break
        time.sleep(0.5)
    assert api("/api/etat")["plateformes"]["rf"]["envoye"] > 3, "Refract : envois"
    pg.goto(URL + "/#/reglages/plateformes")
    pg.wait_for_selector("[data-pf=rf]")
    capture(pg, "12c_tel_plateformes", plein=True)
    try:
        api("/api/ext/ops?p=lb")
        raise AssertionError("sans code d'appairage, l'extension doit être refusée")
    except urllib.error.HTTPError as er:
        assert er.code == 403
    jeton = api("/api/etat")["plateformes"]["jeton"]
    api("/api/plateformes/depart", {"plateforme": "lb", "vide": True})
    api("/api/plateformes/depart", {"plateforme": "imdb", "vide": True})
    # l'extension (background.js) avec une fausse API Firefox : elle lit les opérations et rend ses résultats
    pe = tel.new_page()
    pe.goto(URL + "/extension/LISEZMOI.html")
    pe.evaluate("""() => {
      const store = {}, ecoutes = [];
      globalThis.browser = {
        storage: { local: { get: async d => ({ ...d, ...JSON.parse(JSON.stringify(store)) }), set: async o => { Object.assign(store, o); } } },
        alarms: { clear: async () => {}, create() {}, onAlarm: { addListener() {} } },
        runtime: { onInstalled: { addListener() {} }, onStartup: { addListener() {} }, onMessage: { addListener(f) { ecoutes.push(f); } }, openOptionsPage: async () => {},
                   getManifest: () => ({ version: "1.11.0" }), getPlatformInfo: async () => ({ os: "android" }), getBrowserInfo: async () => ({ name: "Firefox", version: "145.0" }) },
        tabs: { query: async () => [{ id: 1, status: "complete" }], create: async () => ({ id: 2 }), get: async () => ({ status: "complete" }), remove: async () => {},
                onUpdated: { addListener() {}, removeListener() {} },
                sendMessage: async (id, m) => ({ cache: {}, bloque: "", resultats: m.ops.map(o => ({ id: o.id, cle: o.cle, action: o.action, valeur: o.valeur, titre: o.titre,
                  etat: o.sorte === "critique" ? "manuel" : "ok", lien: o.sorte === "critique" ? "https://www.imdb.com/review/create/?tconst=" + o.imdb : undefined,
                  ref: o.sorte === "liste" ? "ls9" : undefined })) }) },
        scripting: { executeScript: async () => [] },
        cookies: { get: async () => ({ value: "tok" }), getAll: async () => [{ name: "x" }] },
        webRequest: { onBeforeRequest: { addListener() {} } }
      };
      window.__msg = m => ecoutes[0](m);
      // IMDb tourne dans l'extension (sans onglet) ; Letterboxd passe par un onglet caché
      window.__onglets = [];
      globalThis.__silencioExec = {
        lb: async ops => ({ resultats: ops.map(o => ({ id: o.id, cle: o.cle, action: o.action, valeur: o.valeur, titre: o.titre, etat: "ok" })), cache: {} }),
        imdb: async ops => ({ resultats: ops.map(o => ({ id: o.id, cle: o.cle, action: o.action, valeur: o.valeur, titre: o.titre, etat: "ok" })) })
      };
      const envoi = browser.tabs.sendMessage;
      browser.tabs.sendMessage = async (id, m) => {
        if (m.type === "silencio-diagnostic") return { etapes: [{ etat: "ok", texte: "Connecté à Letterboxd en tant que " + m.ctx.pseudo }, { etat: m.complet ? "ok" : "info", texte: "Watchlist : ajout" }] };
        window.__onglets.push(m.p); return envoi(id, m); };
    }""")
    pe.add_script_tag(path=os.path.join(RACINE, "extension", "background.js"))
    pe.evaluate("async j => await window.__msg({ type: 'reglages', valeurs: { adresse: location.origin, jeton: j } })", jeton)
    # IMDb par défaut « un clic par action » : rien ne part tout seul, la fenêtre de l'extension liste les actions
    bilan = pe.evaluate("async () => await window.__msg({ type: 'synchroniser' })")
    assert bilan["imdb"].get("a_reporter", 0) > 0 and not bilan["imdb"].get("fait") and bilan["imdb"]["mode"] == "clic", bilan["imdb"]
    etat_ext = pe.evaluate("async () => await window.__msg({ type: 'etat' })")
    un = etat_ext["attente"]["imdb"][0]
    r1 = pe.evaluate("async id => await window.__msg({ type: 'executer-un', p: 'imdb', id })", un["id"])
    assert r1["ok"], r1
    etat_ext = pe.evaluate("async () => await window.__msg({ type: 'etat' })")
    assert un["id"] not in [o["id"] for o in etat_ext["attente"]["imdb"]], "action envoyée d'un clic"
    api("/api/reglages", {"modes_ext": {"imdb": "auto"}})
    for _ in range(4):
        bilan = pe.evaluate("async () => await window.__msg({ type: 'synchroniser' })")
        assert 1 <= bilan["lb"].get("fait", 0) <= 12 and bilan["imdb"].get("fait", 0) <= 12, bilan
    pl = api("/api/etat")["plateformes"]
    assert pl["lb"]["envoye"] >= 4 and pl["imdb"]["envoye"] >= 4 and pl["extension_vue"].get("lb"), pl["lb"]
    onglets = pe.evaluate("window.__onglets")
    assert "imdb" not in onglets and "lb" in onglets, f"IMDb sans onglet, Letterboxd par un onglet caché : {onglets}"
    etat_ext = pe.evaluate("async () => await window.__msg({ type: 'etat' })")
    assert etat_ext["quota"]["lb"]["n"] >= 4, etat_ext["quota"]
    # un film ajouté dans Silencio : la veille de l'extension le voit et l'envoie sans attendre le prochain tour
    for _ in range(6):
        pe.evaluate("async () => await window.__msg({ type: 'synchroniser' })")
    assert api("/api/ext/bonjour", entetes={"X-Silencio-Jeton": jeton})["a_faire"]["lb"] == 0
    api("/api/action", {"type": "journal", "entree": {"cle": "m:40000", "date": "2026-11-25", "note": 6}})
    api("/api/action", {"type": "journal", "entree": {"cle": "m:391729", "date": "2026-11-25", "note": 7}})
    assert api("/api/ext/bonjour", entetes={"X-Silencio-Jeton": jeton})["a_faire"]["lb"] >= 2
    time.sleep(21)
    pe.evaluate("async () => await window.__msg({ type: 'veille' })")     # la 1re fois : Silencio vient d'apparaître
    etat_v = pe.evaluate("async () => await window.__msg({ type: 'etat' })")
    assert etat_v["apresLancement"] > 0 and not etat_v["silencioAbsent"], "synchro prévue 2 minutes après le lancement de Silencio"
    pe.evaluate("async () => await window.__msg({ type: 'veille' })")
    assert api("/api/ext/bonjour", entetes={"X-Silencio-Jeton": jeton})["a_faire"]["lb"] == 0, "envoi juste après l'ajout"
    etat_ext = pe.evaluate("async () => await window.__msg({ type: 'etat' })")
    assert etat_ext["journal"] and etat_ext["dernier"]["bilan"]["lb"], etat_ext["journal"][:3]
    # Tester la synchro (test complet) : Silencio teste TMDB, Refract, GitHub ; l'extension, Letterboxd et IMDb
    miroirs_avant = {p: api("/api/etat")["plateformes"][p]["envoye"] for p in ("lb", "imdb", "rf")}
    n_rf = len(faux_services.REFRACT)
    pg.goto(URL + "/#/reglages/test")
    pg.wait_for_selector("[data-lancer]")
    pg.click("[data-lancer='1']")
    pg.click(".modale [data-oui]")
    for _ in range(60):
        d = api("/api/diagnostic")["etat"]
        if d and d["fini_serveur"]:
            break
        time.sleep(0.5)
    assert api("/api/ext/bonjour", entetes={"X-Silencio-Jeton": jeton})["diagnostic"]["complet"], "l'extension reçoit la demande"
    pe.evaluate("async () => await window.__msg({ type: 'veille' })")
    d = api("/api/diagnostic")["etat"]
    assert d["fini"] and d["ext"] and d["ext"]["env"]["android"], d.get("attente_ext")
    txt = d["texte"]
    print(txt)
    for attendu in ("RAPPORT SILENCIO", "Refract (par son API)", "TMDB (ton compte)", "Letterboxd (par l'extension)", "IMDb (par l'extension)",
                    "Compte TMDB pas relié", "[OK] Note : retrait", "[OK] Jeton GitHub accepté", "Android", "[OK] Journal : visionnage supprimé"):
        assert attendu in txt, attendu
    assert not api("/api/ext/bonjour", entetes={"X-Silencio-Jeton": jeton}).get("diagnostic"), "demande retirée après la réponse"
    assert {p: api("/api/etat")["plateformes"][p]["envoye"] for p in ("lb", "imdb", "rf")} == miroirs_avant, "le test ne touche pas aux envois"
    rf_test = [x for x in faux_services.REFRACT[n_rf:] if x[0] != "GET"]
    assert ("PUT", "/watchlist/rf-m-6", {}, None) in [(a, b, c, None) for a, b, c, _ in rf_test] and any(x[0] == "DELETE" and x[1] == "/history/movies/play-1" for x in rf_test), rf_test
    pg.wait_for_selector("[data-copier]")
    capture(pg, "12d_tel_test_synchro", plein=True)
    pe.close()
    pg.goto(URL + "/#/profil")
    pg.wait_for_selector(".profil-tete")
    pg.wait_for_timeout(600)
    capture(pg, "13_tel_profil")
    pg.goto(URL + "/#/watchlist")
    pg.wait_for_selector(".carte-wl")
    pg.locator(".prio-bouton").nth(1).click()
    pg.wait_for_timeout(500)
    assert any(v.get("prio") for v in api("/api/etat")["profil"]["watchlist"].values()), "priorité"
    capture(pg, "14_tel_watchlist")
    pg.click("[data-dispo]")
    pg.wait_for_timeout(800)
    pg.goto(URL + "/#/listes")
    pg.wait_for_selector(".ligne-liste")
    capture(pg, "15_tel_listes")
    pg.goto(URL + "/#/listes/auto/cinema")
    pg.wait_for_selector(".grille .vignette")
    capture(pg, "15b_tel_liste_cinema")
    pg.click("[data-vraie]")
    pg.wait_for_timeout(700)
    vraies = [l for l in api("/api/etat")["profil"]["listes"].values() if l.get("auto") == "cinema"]
    assert vraies and "m:1018" in vraies[0]["items"], vraies
    assert api("/api/synchroniser", {})["ok"]
    pg.goto(URL + "/#/decouvrir")
    pg.wait_for_selector(".raccourcis-decouvrir")
    pg.wait_for_timeout(900)
    capture(pg, "16_tel_decouvrir", plein=True)
    pg.goto(URL + "/#/personne/5602")
    pg.wait_for_selector(".pers-tete")
    pg.wait_for_timeout(700)
    capture(pg, "17_tel_personne")
    pg.goto(URL + "/#/wrapped/2026")
    pg.wait_for_selector(".w-carte")
    for k in range(5):
        pg.wait_for_timeout(900)
        capture(pg, f"18_tel_wrapped_{k}")
        pg.mouse.click(378, 830)
    pg.goto(URL + "/#/stats?o=personnes")
    pg.wait_for_selector("[data-bloc=personnes]")
    pg.wait_for_timeout(700)
    capture(pg, "19_tel_stats_personnes")

    # ---------------------------------------------------------------- PC
    pc = nav.new_context(**PC)
    pc.route("**/favicon.ico", lambda r: r.fulfill(status=200, content_type="image/png", body=ICONE))
    pp = pc.new_page()
    pp.on("console", lambda m: erreurs.append(("pc", m.text)) if m.type == "error" else None)
    pp.on("pageerror", lambda e: erreurs.append(("pc", str(e))))
    pp.goto(URL + "/#/")
    pp.wait_for_selector(".bonjour")
    pp.wait_for_selector(".tdb-ligne")
    pp.wait_for_timeout(1500)
    capture(pp, "20_pc_accueil")
    pp.goto(URL + "/#/titre/m:1018")
    pp.wait_for_selector(".ff-tete")
    pp.wait_for_selector("[data-envoi] .ff-pf")
    pp.wait_for_timeout(1200)
    capture(pp, "21_pc_film")
    pp.locator("[data-envoi]").scroll_into_view_if_needed()
    pp.evaluate("document.querySelectorAll('.ff-pf').forEach(d => d.open = true)")
    pp.wait_for_timeout(300)
    capture(pp, "21b_pc_film_envoi")
    # anneau : toucher, puis la rangée ; annulation au clavier
    pp.click(".ff-note .anneau")
    pp.locator(".ff-note .case-note").nth(8).click()
    pp.wait_for_timeout(900)
    assert api("/api/etat")["profil"]["titres"]["m:1018"]["note"] == 9
    pp.keyboard.press("z")
    pp.wait_for_timeout(500)
    assert api("/api/etat")["profil"]["titres"]["m:1018"]["note"] == 10, "annulation"
    pp.goto(URL + "/#/personne/5602")
    pp.wait_for_selector(".pers-tete")
    pp.wait_for_timeout(1500)
    capture(pp, "22_pc_personne")
    pp.screenshot(path=os.path.join(CAPT, "22b_pc_personne_long.png"), full_page=True)
    pp.goto(URL + "/#/stats?o=gouts")
    pp.wait_for_selector("[data-bloc=pays] svg")
    pp.wait_for_timeout(1500)
    capture(pp, "23_pc_stats")
    pp.screenshot(path=os.path.join(CAPT, "23b_pc_stats_long.png"), full_page=True)
    pp.goto(URL + "/#/labo")
    pp.wait_for_selector(".labo")
    pp.fill("[data-chercher-p]", "lynch")
    pp.click("[data-res-p] .ligne")
    pp.fill("[data-chercher-p]", "coen")
    pp.locator("[data-res-p] .ligne").first.click()
    pp.wait_for_timeout(800)
    capture(pp, "24_pc_labo_personnes")
    pp.click("[data-mode] button[data-v=agrege]")
    pp.select_option("[data-c=dim]", "decennie")
    pp.select_option("[data-c=mes]", "moy_note")
    pp.click("[data-vue] button[data-v=courbe]")
    pp.click("[data-profils] [data-p=lily]")
    pp.wait_for_timeout(700)
    capture(pp, "25_pc_labo_comparaison")
    pp.click("[data-mode] button[data-v=nuage]")
    pp.wait_for_timeout(700)
    capture(pp, "26_pc_labo_nuage")
    pp.goto(URL + "/#/profil?o=films")
    pp.wait_for_selector(".profil-tete")
    pp.click("[data-vue] button[data-v=tableau]")
    pp.wait_for_timeout(500)
    capture(pp, "27_pc_profil_tableau")
    pp.goto(URL + "/#/liste/" + [k for k, v in api("/api/etat")["profil"]["listes"].items() if v.get("nom", "").startswith("Lynch")][0])
    pp.wait_for_selector(".classement .ligne")
    capture(pp, "28_pc_liste_classee")
    pp.goto(URL + "/#/annee/2026")
    pp.wait_for_selector(".chiffres")
    pp.wait_for_timeout(600)
    capture(pp, "29_pc_annee")
    pp.goto(URL + "/#/decouvrir/commune")
    pp.wait_for_selector(".puces")
    capture(pp, "30_pc_commune")
    pp.goto(URL + "/#/amis")
    pp.wait_for_selector(".entete")
    capture(pp, "31_pc_amis")
    pp.keyboard.press("n")
    try:
        pp.wait_for_selector(".modale.ouverte input[type=search]", timeout=5000)
    except Exception:
        print(erreurs, pp.evaluate("[document.activeElement.outerHTML.slice(0,120), document.querySelectorAll('.modale').length, location.hash]"))
        raise
    pp.keyboard.type("parasite")
    pp.wait_for_selector(".modale .res-recherche .ligne")
    pp.keyboard.press("Enter")
    pp.wait_for_selector(".modale .case-note")
    pp.keyboard.press("8")
    pp.keyboard.press(".")
    capture(pp, "32_pc_ajout_clavier")
    pp.keyboard.press("Enter")
    pp.wait_for_timeout(600)
    assert any(x.get("cle") == "m:496243" and x.get("note") == 7.5 and x.get("date") == time.strftime("%Y-%m-%d") for x in api("/api/etat")["profil"]["journal"].values()), "ajout au clavier"
    pp.goto(URL + "/#/notifs")
    pp.wait_for_selector(".entete")
    capture(pp, "33_pc_notifs")
    nav.close()

serveur.terminate()
sortie = serveur.communicate(timeout=10)[0].decode(errors="replace")
tracebacks = [l for l in sortie.splitlines() if "Traceback" in l or "Error" in l]
print("Erreurs navigateur :", erreurs or "aucune")
print("Erreurs serveur :", "\n".join(sortie.splitlines()[-30:]) if tracebacks else "aucune")
shutil.rmtree(DONNEES, ignore_errors=True)
if erreurs or tracebacks:
    sys.exit(1)
print("Parcours complet OK")
