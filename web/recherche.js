/* Silencio — recherche avancée dans tes films et ta watchlist : filtres combinés (genre, décennie, pays, durée,
   ta note, note détaillée, vu au cinéma, coup de cœur…). Pour chercher dans tout TMDB : Découvrir → Explorer. */
(function () {
"use strict";
const S = window.Silencio;
const { $, $$, esc } = S;

// un lien IMDb / Letterboxd / TMDB (partagé depuis une autre appli ou l'extension) : la fiche du film
S.pages.ouvrir = async (vue, args, params) => {
  vue.innerHTML = S.chargement();
  try {
    const r = await S.api(`/api/ouvrir?url=${encodeURIComponent(params.url || "")}${params.tmdb ? `&tmdb=${encodeURIComponent(params.tmdb)}` : ""}`);
    location.replace(r.cle ? `#/titre/${r.cle}` : `#/recherche?q=${encodeURIComponent(r.recherche || "")}`);
  } catch (e) { vue.innerHTML = S.vide("Lien illisible", esc(e.message)); }
};

S.pages.avancee = async (vue) => {
  if (!S.base) { vue.innerHTML = S.chargement(); await S.chargerBase(); }
  const f = S.filtresMemo.rech = S.filtresMemo.rech || { portee: "vus", type: "", genre: "", decennie: "", pays: "", duree: "", noteMin: "", noteMax: "", crit: "", critMin: "8", lieu: "", coeur: false, revu: false, tri: "note", q: "" };
  const d = S.stats.donnees();
  const wl = Object.keys(S.vivants(S.moi.watchlist)).map(c => ({ cle: c, m: S.info(c), note: null, detail: {}, wl: true }));
  const cineParFilm = new Map(); for (const v of d.V) if (v.ou?.type === "cinema") cineParFilm.set(v.cle, (cineParFilm.get(v.cle) || 0) + 1);
  const tous = f.portee === "wl" ? wl : d.T;
  const pays = [...new Set(tous.flatMap(r => r.m?.p || []))].sort((a, b) => S.pays(a).localeCompare(S.pays(b)));
  const genres = [...new Set(tous.flatMap(r => r.m?.g || []))].filter(g => S.GENRES[g]).sort((a, b) => S.GENRES[a].localeCompare(S.GENRES[b]));
  const decennies = [...new Set(tous.map(r => r.m?.a ? Math.floor(r.m.a / 10) * 10 : null).filter(Boolean))].sort((a, b) => b - a);
  const sel = (k, opts, vide) => `<select class="champ" data-f="${k}"><option value="">${vide}</option>${opts.map(([v, l]) => `<option value="${v}" ${String(f[k]) === String(v) ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>`;
  vue.innerHTML = `<div class="entete"><h1>Recherche avancée</h1><nav class="liens-tete"><a href="#/decouvrir/explorer">Tout TMDB</a></nav></div>
    <div class="segments" data-portee style="margin-bottom:12px"><button data-v="vus">Mes films vus</button><button data-v="wl">Ma watchlist</button></div>
    <div class="rech-grille">
      <input class="champ" data-f="q" placeholder="Titre, réalisateur…" value="${esc(f.q)}">
      ${sel("type", [["m", "Films"], ["t", "Séries"]], "Films et séries")}
      ${sel("genre", genres.map(g => [g, S.GENRES[g]]), "Tous les genres")}
      ${sel("decennie", decennies.map(x => [x, `Années ${x}`]), "Toutes les décennies")}
      ${sel("pays", pays.map(p => [p, S.pays(p)]), "Tous les pays")}
      ${sel("duree", [["90", "≤ 1 h 30"], ["120", "≤ 2 h"], ["150", "≤ 2 h 30"], ["151", "> 2 h 30"]], "Toutes durées")}
      ${f.portee === "vus" ? `${sel("noteMin", [10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map(n => [n, `Ma note ≥ ${n}`]), "Ma note : toutes")}
      ${sel("noteMax", [9, 8, 7, 6, 5, 4, 3].map(n => [n, `Ma note ≤ ${n}`]), "Pas de note maximale")}
      ${sel("crit", S.CRITERES, "Note détaillée : aucune")}
      ${f.crit ? sel("critMin", [10, 9, 8, 7, 6, 5].map(n => [n, `${S.LIB_CRITERES[f.crit]} ≥ ${n}`]), "≥ 1") : ""}
      ${sel("lieu", [["cinema", "Vu au cinéma"], ["imax", "Vu en IMAX"], ["maison", "Jamais vu au cinéma"]], "Vu n'importe où")}` : ""}
      ${sel("tri", [["note", "Trier par ma note"], ["annee", "Par année"], ["duree", "Par durée"], ["titre", "Par titre"], ["vu", "Par date de visionnage"]], "Tri")}
    </div>
    ${f.portee === "vus" ? `<div class="puces" style="margin:10px 0"><button class="puce ${f.coeur ? "actif" : ""}" data-b="coeur">Coups de cœur</button><button class="puce ${f.revu ? "actif" : ""}" data-b="revu">Revus</button><button class="lien" data-raz style="margin-left:auto">Tout effacer</button></div>` : ""}
    <p class="mini discret" data-n></p><div class="grille" data-g></div>`;
  $$("[data-portee] button", vue).forEach(b => { b.classList.toggle("actif", b.dataset.v === f.portee); b.onclick = () => { f.portee = b.dataset.v; S.rafraichir(true); }; });
  $$("[data-f]", vue).forEach(c => { const k = c.dataset.f; c[c.tagName === "INPUT" ? "oninput" : "onchange"] = () => { f[k] = c.value; if (k === "crit" || k === "portee") S.rafraichir(true); else peindre(); }; });
  $$("[data-b]", vue).forEach(b => b.onclick = () => { f[b.dataset.b] = !f[b.dataset.b]; b.classList.toggle("actif", f[b.dataset.b]); peindre(); });
  const raz = $("[data-raz]", vue); if (raz) raz.onclick = () => { S.filtresMemo.rech = null; S.rafraichir(true); };
  const norm = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  function peindre() {
    const q = norm(f.q);
    let l = tous.filter(r => {
      const m = r.m || {};
      if (f.type && m.ty !== f.type) return false;
      if (f.genre && !(m.g || []).includes(+f.genre)) return false;
      if (f.decennie && Math.floor((m.a || 0) / 10) * 10 !== +f.decennie) return false;
      if (f.pays && !(m.p || []).includes(f.pays)) return false;
      if (f.duree) { const r_ = m.r || 0; if (!r_ || (+f.duree > 150 ? r_ <= 150 : r_ > +f.duree)) return false; }
      if (f.portee === "vus") {
        if (f.noteMin && !(r.note >= +f.noteMin)) return false;
        if (f.noteMax && !(r.note != null && r.note <= +f.noteMax)) return false;
        if (f.crit && !((r.detail || {})[f.crit] >= +(f.critMin || 1))) return false;
        if (f.lieu === "cinema" && !cineParFilm.get(r.cle)) return false;
        if (f.lieu === "maison" && cineParFilm.get(r.cle)) return false;
        if (f.lieu === "imax" && !d.V.some(v => v.cle === r.cle && v.imax)) return false;
        if (f.coeur && !r.coeur) return false;
        if (f.revu && !(r.nbVis > 1)) return false;
      }
      if (q) {
        const noms = [m.t, m.o, ...(m.re || []).map(id => S.base?.pers?.[id]?.n)].map(norm).join(" ");
        if (!noms.includes(q)) return false;
      }
      return true;
    });
    const cmp = { note: (a, b) => (b.note ?? -1) - (a.note ?? -1), annee: (a, b) => (b.m?.a || 0) - (a.m?.a || 0), duree: (a, b) => (b.m?.r || 0) - (a.m?.r || 0),
      titre: (a, b) => S.nomTitre(a.m || {}).localeCompare(S.nomTitre(b.m || {})), vu: (a, b) => ((b.dates || []).slice(-1)[0] || "").localeCompare((a.dates || []).slice(-1)[0] || "") }[f.tri] || (() => 0);
    l.sort(cmp);
    $("[data-n]", vue).textContent = S.pluriel(l.length, "titre");
    $("[data-g]", vue).innerHTML = l.length ? l.slice(0, 300).map(r => S.vignette(r.cle, { note: r.note, info: f.crit && r.detail?.[f.crit] ? `${S.LIB_CRITERES[f.crit]} ${r.detail[f.crit]}` : "" })).join("") : S.vide("Aucun titre", "Assouplis un filtre.");
  }
  peindre();
};
})();
