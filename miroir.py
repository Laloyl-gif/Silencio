"""Silencio est le maître : ce module calcule ce que Letterboxd, IMDb et Refract devraient contenir, le compare à ce
qui y a déjà été envoyé (section « miroirs » du profil) et en tire une liste d'opérations à faire.

Clés (sans le préfixe de plateforme) :
  Letterboxd (lb) — films seulement
    vu|<jid>          entrée du journal (diary) datée  {"date", "rewatch", "note", "like", "critique"}
                      (créée, modifiée et supprimée comme dans Silencio ; « ref » = l'identifiant de l'entrée)
    marque|<cle>      vu sans date exacte              1
    note|<cle>        note en étoiles (0,5 à 5)        3.5
    like|<cle>        coup de cœur                     1
    wl|<cle>          watchlist                        1
    liste|<lid>       une liste                        {"nom", "description", "classee"}
    item|<lid>|<cle>  un film dans une liste           position (1, 2, …)
  IMDb (imdb) — films et séries
    note|<cle>        note entière de 1 à 10           8
    fav|<cle>         watchlist Silencio → watchlist IMDb            1
    liste|<lid>, item|<lid>|<cle>                      comme Letterboxd
    critique|<jid>    critique publique (envoi manuel sur IMDb)     texte
  Refract (rf) — par son API officielle
    vu|<jid>          film vu                           {"date"}
    wl|<cle>          watchlist                         1
    ep|<cle>|<SxE>    épisode vu                        1

Ce qui est caché à tes amis (films cachés, visionnages cachés, listes privées, critiques privées) ne part jamais.
"""
import hashlib
import json
import time

PLATEFORMES = {"lb": "Letterboxd", "imdb": "IMDb", "rf": "Refract"}
FAVORIS = "_favoris"                               # la watchlist IMDb, qui reçoit la watchlist Silencio
# Partout, seuls tes ajouts et changements faits dans Silencio après la liaison partent ; ce qui existait avant est
# considéré comme déjà en place. Sur IMDb, rien n'est jamais retiré (1 000 films dans ta watchlist IMDb restent
# 1 000) ; sur Letterboxd, une entrée de journal que Silencio a créée suit ses modifications et sa suppression.
RETIRABLE = {"lb": {"vu"}, "imdb": set(), "rf": {"wl", "ep"}}
PAUSE_ECHEC = 6 * 3600                             # une opération ratée n'est retentée qu'après ce délai


def _vivants(section):
    return {k: v for k, v in (section or {}).items() if not v.get("x")}


def etoiles(n):
    """Note Silencio sur 10 (demi-points) → étoiles Letterboxd (0,5 à 5 par demi-étoile)."""
    if n is None:
        return None
    return max(0.5, min(5.0, int(float(n) + 0.5) / 2))


def note_imdb(n):
    if n is None:
        return None
    return max(1, min(10, int(float(n) + 0.5)))


def souhaite(doc, plateforme):
    """{clé: valeur} : ce que la plateforme devrait contenir d'après Silencio."""
    titres, journal = _vivants(doc.get("titres")), _vivants(doc.get("journal"))
    wl, listes, series = _vivants(doc.get("watchlist")), _vivants(doc.get("listes")), _vivants(doc.get("series"))
    caches = {c for c, t in titres.items() if t.get("prive")}
    r = {}
    if plateforme == "lb":
        dates = {}
        for jid, e in journal.items():
            c = e.get("cle", "")
            if not c.startswith("m:") or c in caches or e.get("prive"):
                continue
            d = e.get("date") or ""
            if len(d) == 10 and not e.get("approx"):
                t = titres.get(c) or {}
                n = e.get("note") if e.get("note") is not None else t.get("note")
                r[f"vu|{jid}"] = {"cle": c, "date": d, "rewatch": bool(e.get("revision")), "note": etoiles(n),
                                  "like": bool(e.get("coeur") or t.get("coeur")),
                                  "critique": "" if e.get("critique_privee", True) else (e.get("critique") or "").strip()}
                dates.setdefault(c, []).append(d)
        for c, t in titres.items():
            if not c.startswith("m:") or c in caches:
                continue
            if t.get("vu") and c not in dates:
                r[f"marque|{c}"] = 1
            if t.get("note") is not None:
                r[f"note|{c}"] = etoiles(t["note"])
            if t.get("coeur"):
                r[f"like|{c}"] = 1
        for c in wl:
            if c.startswith("m:") and c not in caches:
                r[f"wl|{c}"] = 1
    elif plateforme == "imdb":
        for c, t in titres.items():
            if c not in caches and t.get("note") is not None:
                r[f"note|{c}"] = note_imdb(t["note"])
        for c in wl:
            if c not in caches:
                r[f"fav|{c}"] = 1
        for jid, e in journal.items():
            c = e.get("cle", "")
            if c in caches or e.get("prive") or e.get("critique_privee", True):
                continue
            if (e.get("critique") or "").strip():
                r[f"critique|{jid}"] = e["critique"].strip()
    elif plateforme == "rf":
        for jid, e in journal.items():
            c = e.get("cle", "")
            if c.startswith("m:") and c not in caches and not e.get("prive") and e.get("date"):
                r[f"vu|{jid}"] = {"date": e["date"]}
        for c in wl:
            if c not in caches:
                r[f"wl|{c}"] = 1
        for c, s in series.items():
            if c in caches:
                continue
            for ep in s.get("episodes") or []:
                r[f"ep|{c}|{ep}"] = 1
        for c, t in titres.items():
            if c not in caches and t.get("note") is not None:
                r[f"note|{c}"] = note_imdb(t["note"])    # Refract : entier de 1 à 10
        return r
    # listes (Letterboxd : films seulement)
    for lid, l in listes.items():
        if l.get("privee"):
            continue
        items = [c for c in l.get("items") or [] if c not in caches and (plateforme != "lb" or c.startswith("m:"))]
        r[f"liste|{lid}"] = {"nom": l.get("nom", ""), "description": l.get("description", ""),
                             "classee": bool(l.get("classee"))}
        for i, c in enumerate(items, 1):
            r[f"item|{lid}|{c}"] = i if l.get("classee") else 1
    return r


def _sans_ref(v):
    if isinstance(v, dict):
        return {k: x for k, x in v.items() if k != "ref"}
    return v


def _pareil(plateforme, cle, avant, voulu):
    if plateforme == "lb" and cle.startswith("vu|") and isinstance(avant, dict) and "note" not in avant:
        # entrée notée avant la v7 (date et revisionnage seulement) : on ne compare que ça
        return {"date": avant.get("date"), "rewatch": avant.get("rewatch")} == \
            {"date": (voulu or {}).get("date"), "rewatch": (voulu or {}).get("rewatch")}
    return _sans_ref(avant) == _sans_ref(voulu)


def miroir(doc, plateforme):
    """{clé: valeur} de ce qui a déjà été envoyé (ou trouvé lors de l'import) sur la plateforme."""
    pre = plateforme + "|"
    return {k[len(pre):]: v.get("v") for k, v in (doc.get("miroirs") or {}).items()
            if k.startswith(pre) and not v.get("x")}


def ident(plateforme, cle, action, valeur):
    return hashlib.sha1(json.dumps([plateforme, cle, action, _sans_ref(valeur)], sort_keys=True,
                                   ensure_ascii=False).encode("utf-8")).hexdigest()[:16]


def operations(doc, plateforme, meta, echecs=None, limite=60, forcer=False):
    """Les opérations à faire, dans un ordre sûr (listes avant leurs films, ajouts avant retraits)."""
    voulu, fait = souhaite(doc, plateforme), miroir(doc, plateforme)
    echecs = echecs or {}
    maintenant = time.time()
    if plateforme == "imdb" and any(k.startswith("fav|") for k in voulu) and f"liste|{FAVORIS}" not in fait:
        # ta watchlist Silencio va dans ta watchlist IMDb : il suffit de retrouver son identifiant (aucune création)
        voulu[f"liste|{FAVORIS}"] = {"nom": "Watchlist", "watchlist": True}
    elif plateforme == "imdb" and f"liste|{FAVORIS}" in fait:
        voulu[f"liste|{FAVORIS}"] = fait[f"liste|{FAVORIS}"]
    journal = doc.get("journal") or {}
    titres = doc.get("titres") or {}
    ops, en_attente = [], 0
    nb_entrees = {}                               # Letterboxd : combien d'entrées de journal Silencio a pour ce film
    if plateforme == "lb":
        for k, v in voulu.items():
            if k.startswith("vu|") and isinstance(v, dict):
                nb_entrees[v.get("cle")] = nb_entrees.get(v.get("cle"), 0) + 1

    def ref_liste(lid):
        v = fait.get(f"liste|{lid}")
        return v.get("ref") if isinstance(v, dict) else None

    def infos(cle_titre):
        m = meta(cle_titre) or {}
        return {"tmdb": int(cle_titre[2:]) if cle_titre[2:].isdigit() else None, "type": cle_titre[0],
                "imdb": m.get("im"), "titre": m.get("t") or "", "vo": m.get("o") or "", "annee": m.get("a")}

    for k, v in voulu.items():
        if _pareil(plateforme, k, fait.get(k), v):
            continue
        sorte = k.split("|")[0]
        op = {"cle": k, "sorte": sorte, "action": "poser", "valeur": v, "avant": fait.get(k)}
        parts = k.split("|")
        if sorte in ("vu", "critique"):
            e = journal.get(parts[1]) or {}
            op.update(infos(e.get("cle", "")))
            if sorte == "vu" and plateforme == "lb":
                op["extra"] = {"note": v.get("note"), "like": v.get("like"), "critique": v.get("critique")}
                op["nb"] = nb_entrees.get(v.get("cle"), 1)
                if isinstance(fait.get(k), dict) and fait[k].get("ref"):
                    op["ref"] = fait[k]["ref"]        # l'entrée existe déjà : on la modifie
        elif sorte == "liste":
            op["liste"] = parts[1]
            if isinstance(fait.get(k), dict) and fait[k].get("ref"):
                op["ref"] = fait[k]["ref"]
        elif sorte in ("item", "fav"):
            lid = FAVORIS if sorte == "fav" else parts[1]
            ref = ref_liste(lid)
            if not ref and sorte == "fav":
                op["watchlist"] = True            # l'extension retrouve elle-même ta watchlist IMDb
            elif not ref:
                en_attente += 1
                continue                          # la liste doit d'abord exister là-bas
            op["liste"], op["ref"] = lid, ref
            op.update(infos(parts[-1]))
        elif sorte == "ep":
            op.update(infos(parts[1]))
            s, _, e = parts[2].partition("x")
            op["saison"], op["episode"] = int(s or 0), int(e or 0)
        else:
            op.update(infos(parts[-1]))
        ops.append(op)
    for k, v in fait.items():
        sorte = k.split("|")[0]
        if k in voulu or sorte not in RETIRABLE.get(plateforme, ()):
            continue
        parts = k.split("|")
        op = {"cle": k, "sorte": sorte, "action": "retirer", "valeur": None, "avant": v}
        if sorte in ("item", "fav"):
            lid = FAVORIS if sorte == "fav" else parts[1]
            if not ref_liste(lid):
                continue
            op["liste"], op["ref"] = lid, ref_liste(lid)
        if sorte == "ep":
            s, _, e = parts[2].partition("x")
            op["saison"], op["episode"] = int(s or 0), int(e or 0)
            op.update(infos(parts[1]))
        elif sorte == "vu":
            film_ = (journal.get(parts[1]) or {}).get("cle") or (v.get("cle") if isinstance(v, dict) else None)
            if not film_:
                continue                          # entrée supprimée avant la v7 : film inconnu, on n'y touche pas
            op.update(infos(film_))
            if isinstance(v, dict) and v.get("ref"):
                op["ref"] = v["ref"]
        else:
            op.update(infos(parts[-1]))
        ops.append(op)
    ordre = {"liste": 0, "vu": 1, "marque": 2, "note": 3, "like": 4, "wl": 5, "fav": 6, "item": 7, "ep": 8,
             "critique": 9}
    ops.sort(key=lambda o: (o["action"] == "retirer", ordre.get(o["sorte"], 9),
                            o["valeur"] if o["sorte"] == "item" and isinstance(o.get("valeur"), int) else 0))
    sortie = []
    for op in ops:
        op["id"] = ident(plateforme, op["cle"], op["action"], op["valeur"])
        ech = echecs.get(op["cle"])
        if ech and not forcer and maintenant - ech.get("quand", 0) < PAUSE_ECHEC and ech.get("id") == op["id"]:
            continue
        if plateforme in ("lb", "imdb") and op["sorte"] not in ("liste", "critique") and \
                not op.get("tmdb") and not op.get("imdb"):
            continue
        if plateforme == "imdb" and op["sorte"] in ("note", "fav", "item", "critique") and not op.get("imdb"):
            continue                              # sans identifiant IMDb (tt…), rien à faire
        sortie.append(op)
    return {"ops": sortie[:limite], "reste": max(0, len(sortie) - limite), "en_attente": en_attente,
            "total": len(sortie)}


def compter(doc, plateforme):
    voulu, fait = souhaite(doc, plateforme), miroir(doc, plateforme)
    a_faire = sum(1 for k, v in voulu.items() if not _pareil(plateforme, k, fait.get(k), v))
    a_retirer = sum(1 for k in fait if k not in voulu and k.split("|")[0] in RETIRABLE.get(plateforme, ()))
    a_faire += a_retirer
    return {"a_envoyer": a_faire, "a_retirer": a_retirer, "envoye": sum(1 for k in fait if k in voulu)}


def appliquer_resultats(stock, plateforme, resultats, ops_connues=None):
    """Après un passage : note dans le profil ce qui est fait, et dans l'appareil ce qui a échoué."""
    echecs = stock.appareil.setdefault("miroir_echecs", {}).setdefault(plateforme, {})
    entrees, bilan = {}, {"ok": 0, "echec": 0, "manuel": 0}
    for r in resultats or []:
        cle = r.get("cle")
        if not cle:
            continue
        etat = r.get("etat")
        if etat in ("ok", "deja"):
            if r.get("action") == "retirer":
                entrees[f"{plateforme}|{cle}"] = None
            else:
                v = r.get("valeur")
                if r.get("ref") and isinstance(v, dict):
                    v = dict(v, ref=r["ref"])
                entrees[f"{plateforme}|{cle}"] = v
            echecs.pop(cle, None)
            bilan["ok"] += 1
        else:
            echecs[cle] = {"id": r.get("id"), "erreur": (r.get("erreur") or etat or "")[:300], "quand": time.time(),
                           "etat": etat, "n": (echecs.get(cle) or {}).get("n", 0) + 1,
                           "titre": r.get("titre") or ""}
            bilan["manuel" if etat == "manuel" else "echec"] += 1
    stock.poser_miroirs(entrees)
    passages = stock.appareil.setdefault("miroir_passages", {})
    passages[plateforme] = {"quand": time.time(), **bilan}
    stock.sauver_appareil()
    return bilan


def _source(doc, cle):
    """L'entrée de Silencio d'où vient une clé de miroir (pour savoir quand elle a changé)."""
    sorte, _, reste = cle.partition("|")
    ident = reste.split("|")[0]
    section = {"vu": "journal", "critique": "journal", "wl": "watchlist", "fav": "watchlist", "ep": "series",
               "liste": "listes", "item": "listes"}.get(sorte, "titres")
    return (doc.get(section) or {}).get(ident) or {}


def poser_depart_avant(stock, plateforme, moment, presence=None):
    """Tout ce qui existait dans Silencio avant « moment » est considéré comme déjà en place sur la plateforme :
    seuls les ajouts et changements faits ensuite partiront."""
    voulu = souhaite(stock.doc, plateforme)
    fait = {k: v for k, v in voulu.items() if (_source(stock.doc, k).get("maj") or 0) <= moment}
    fait.update(presence or {})
    return poser_depart(stock, plateforme, fait)


def poser_depart(stock, plateforme, presence):
    """Après l'import d'un export de la plateforme : ce qui y était déjà est noté comme présent."""
    if not presence:
        return 0
    stock.poser_miroirs({f"{plateforme}|{k}": v for k, v in presence.items()})
    return len(presence)
