"""Wikidata : les prix d'une personne, et les palmarès (Palme d'or, Oscars…) reliés aux identifiants TMDB."""
import hashlib
import os
import time

import config
from reseau import HorsLigne, requete
from stockage import ecrire_json, lire_json

DOSSIER = os.path.join(config.CACHE, "wikidata")


def _sparql(requete_sparql, ttl=30 * 86400):
    cle = hashlib.sha1(requete_sparql.encode()).hexdigest()
    f = os.path.join(DOSSIER, cle + ".json")
    cache = lire_json(f)
    if cache and time.time() - cache["t"] < ttl:
        return cache["d"]
    try:
        d = requete(config.WIKIDATA, params={"query": requete_sparql, "format": "json"},
                    entetes={"Accept": "application/sparql-results+json"}, delai=40)
    except HorsLigne:
        if cache:
            return cache["d"]
        raise
    lignes = [{k: v.get("value") for k, v in b.items()} for b in d.get("results", {}).get("bindings", [])]
    ecrire_json(f, {"t": time.time(), "d": lignes})
    return lignes


def prix_personne(tmdb_id):
    """[{prix, annee, oeuvre, cle}] : les prix reçus (P166) par la personne de cet identifiant TMDB (P4985)."""
    q = f"""SELECT ?prixLabel ?annee ?oeuvreLabel ?tmdbFilm ?tmdbSerie WHERE {{
  ?p wdt:P4985 "{int(tmdb_id)}" .
  ?p p:P166 ?st . ?st ps:P166 ?prix .
  OPTIONAL {{ ?st pq:P585 ?date . BIND(YEAR(?date) AS ?annee) }}
  OPTIONAL {{ ?st pq:P1686 ?oeuvre . OPTIONAL {{ ?oeuvre wdt:P4947 ?tmdbFilm }} OPTIONAL {{ ?oeuvre wdt:P4983 ?tmdbSerie }} }}
  SERVICE wikibase:label {{ bd:serviceParam wikibase:language "fr,en" . }}
}} ORDER BY ?annee"""
    vus, res = set(), []
    for l in _sparql(q):
        cle = ("m:" + l["tmdbFilm"]) if l.get("tmdbFilm") else ("t:" + l["tmdbSerie"]) if l.get("tmdbSerie") else None
        k = (l.get("prixLabel"), l.get("annee"), cle)
        if k in vus:
            continue
        vus.add(k)
        res.append({"prix": l.get("prixLabel", ""), "annee": int(l["annee"]) if l.get("annee") else None,
                    "oeuvre": l.get("oeuvreLabel", ""), "cle": cle})
    return res


def palmares(code):
    """[{cle, annee, titre}] : les films qui ont reçu ce prix (config.PRIX), avec leur identifiant TMDB."""
    libelle, nom_en = config.PRIX[code]
    nom = nom_en.replace('"', '\\"')
    q = f"""SELECT DISTINCT ?tmdb ?annee ?filmLabel WHERE {{
  ?prix rdfs:label "{nom}"@en .
  ?film p:P166 ?st . ?st ps:P166 ?prix .
  ?film wdt:P4947 ?tmdb .
  OPTIONAL {{ ?st pq:P585 ?date . BIND(YEAR(?date) AS ?annee) }}
  SERVICE wikibase:label {{ bd:serviceParam wikibase:language "fr,en" . }}
}}"""
    res = {}
    for l in _sparql(q):
        cle = "m:" + l["tmdb"]
        a = int(l["annee"]) if l.get("annee") else None
        if cle not in res or (a and (res[cle]["annee"] or 9999) > a):
            res[cle] = {"cle": cle, "annee": a, "titre": l.get("filmLabel", "")}
    return {"code": code, "nom": libelle, "films": sorted(res.values(), key=lambda x: x["annee"] or 0)}


CEREMONIES = [   # (motif sur le nom anglais du prix, nom court affiché)
    (r"Academy Award|Oscar", "Oscars"), (r"C[ée]sar Award|C[ée]sar", "César"),
    (r"Cannes|Palme d|Camera d.Or|Cam[ée]ra d.or", "Cannes"), (r"Venice|Golden Lion|Silver Lion|Volpi", "Venise"),
    (r"Berlin|Golden Bear|Silver Bear", "Berlin"), (r"BAFTA|British Academy", "BAFTA"), (r"Golden Globe", "Golden Globes"),
]


def prix_film(cle):
    """{gagnes: [{prix, ceremonie, annee}], nominations: [...]} pour les 7 grandes cérémonies (Wikidata)."""
    import re as _re
    prop = "P4947" if cle.startswith("m:") else "P4983"
    q = f"""SELECT ?type ?prixFr ?prixEn ?annee WHERE {{
  ?f wdt:{prop} "{int(cle[2:])}" .
  {{ ?f p:P166 ?st . ?st ps:P166 ?prix . BIND("gagne" AS ?type) }} UNION {{ ?f p:P1411 ?st . ?st ps:P1411 ?prix . BIND("nomme" AS ?type) }}
  OPTIONAL {{ ?st pq:P585 ?date . BIND(YEAR(?date) AS ?annee) }}
  OPTIONAL {{ ?prix rdfs:label ?prixFr . FILTER(LANG(?prixFr) = "fr") }}
  OPTIONAL {{ ?prix rdfs:label ?prixEn . FILTER(LANG(?prixEn) = "en") }}
}}"""
    res = {"gagnes": [], "nominations": []}
    vus = set()
    for l in _sparql(q):
        en = l.get("prixEn") or l.get("prixFr") or ""
        cer = next((nom for motif, nom in CEREMONIES if _re.search(motif, en, _re.I)), None)
        if not cer:
            continue
        nom = l.get("prixFr") or en
        k = (l["type"], nom)
        if k in vus:
            continue
        vus.add(k)
        res["gagnes" if l["type"] == "gagne" else "nominations"].append(
            {"prix": nom, "ceremonie": cer, "annee": int(l["annee"]) if l.get("annee") else None})
    gagnes = {p["prix"] for p in res["gagnes"]}
    res["nominations"] = [p for p in res["nominations"] if p["prix"] not in gagnes]
    return res


def prix_personnes_film(cle):
    """{id TMDB de la personne: {gagnes: [...], nominations: [...]}} : qui a été primé ou nommé POUR ce film
    (Wikidata : prix reçu P166 / nomination P1411, avec le qualificatif « pour l'œuvre » P1686)."""
    import re as _re
    prop = "P4947" if cle.startswith("m:") else "P4983"
    q = f"""SELECT ?type ?pid ?prixFr ?prixEn ?annee WHERE {{
  ?f wdt:{prop} "{int(cle[2:])}" .
  {{ ?p p:P166 ?st . ?st ps:P166 ?prix ; pq:P1686 ?f . BIND("gagne" AS ?type) }}
  UNION {{ ?p p:P1411 ?st . ?st ps:P1411 ?prix ; pq:P1686 ?f . BIND("nomme" AS ?type) }}
  ?p wdt:P4985 ?pid .
  OPTIONAL {{ ?st pq:P585 ?date . BIND(YEAR(?date) AS ?annee) }}
  OPTIONAL {{ ?prix rdfs:label ?prixFr . FILTER(LANG(?prixFr) = "fr") }}
  OPTIONAL {{ ?prix rdfs:label ?prixEn . FILTER(LANG(?prixEn) = "en") }}
}}"""
    r = {}
    for l in _sparql(q):
        en = l.get("prixEn") or l.get("prixFr") or ""
        cer = next((nom for motif, nom in CEREMONIES if _re.search(motif, en, _re.I)), None)
        if not cer or not (l.get("pid") or "").isdigit():
            continue
        e = r.setdefault(l["pid"], {"gagnes": [], "nominations": []})
        p = {"prix": l.get("prixFr") or en, "ceremonie": cer, "annee": int(l["annee"]) if l.get("annee") else None}
        liste = e["gagnes" if l["type"] == "gagne" else "nominations"]
        if p not in liste:
            liste.append(p)
    for e in r.values():
        g = {p["prix"] for p in e["gagnes"]}
        e["nominations"] = [p for p in e["nominations"] if p["prix"] not in g]
    return r
