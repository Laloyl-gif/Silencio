/* Silencio — pages : choix du profil, accueil, recherche, film / série, personne. */
(function () {
"use strict";
const S = window.Silencio, P = S.pages, G = S.graph, St = S.stats;
const { $, $$, esc, ico, el } = S;
const moyenne = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;

// ------------------------------------------------------------------ choisir un titre (pour listes, « Vu en … »)
S.choisirTitre = (cb, titre = "Ajouter un titre") => {
  const corps = el(`<div><input class="champ" type="search" placeholder="Titre…" autocomplete="off"><div class="res-recherche" style="margin-top:10px"></div></div>`);
  S.ouvrirModale({ titre, corps });
  const champ = $("input", corps), res = $(".res-recherche", corps);
  const afficher = cles => { res.innerHTML = cles.map(c => { const m = S.info(c) || {}; return `<div class="ligne" data-cle="${c}">${S.affiche(m, { taille: "w154" })}<div class="corps"><b>${esc(S.nomTitre(m))}</b><span>${m.a || ""} · ${c[0] === "t" ? "Série" : "Film"}</span></div></div>`; }).join(""); $$(".ligne", res).forEach(l => l.onclick = () => { S.fermerModale(); cb(l.dataset.cle); }); };
  champ.oninput = S.debounce(async () => {
    const q = champ.value.trim(); if (!q) return afficher([]);
    const loc = S.rechercheLocale(q, 5); afficher(loc);
    try { const r = await S.rechercheTMDB(q); afficher([...new Set([...loc, ...r.map(x => S.retenir(x)).filter(Boolean)])].slice(0, 12)); } catch { /* hors ligne */ }
  }, 160);
  setTimeout(() => champ.focus(), 80);
};

// ------------------------------------------------------------------ premier lancement : qui es-tu ?
P.choixProfil = async (vue) => {
  document.body.classList.add("sans-profil");
  $("#lateral").style.display = "none"; $("#barre-bas").style.display = "none";
  vue.className = "plein";
  vue.innerHTML = `<div class="accueil-profil"><div class="boite"><div class="centre"><img src="icone.svg" alt="" style="width:76px;height:76px;border-radius:20px;margin:0 auto 14px"></div><h1>Silencio</h1><div class="devise">No hay banda. Il n'y a pas d'orchestre.</div><div data-liste>${S.chargement()}</div></div></div>`;
  const d = await S.api("/api/profils").catch(() => ({ locaux: [], github: [], twin_picks: [] }));
  if (S.moi) return;                                   // un profil a été choisi entre-temps
  const g = S.etat?.appareil?.github || {};
  const choix = (liste, source) => liste.map(p => `<button class="choix-profil" data-id="${esc(p.id)}" data-nomp="${esc(p.nom)}" data-source="${source}">${S.avatar(p.id, p.nom)}<span class="espace"><b>${esc(p.nom)}</b><br><span class="mini discret">${source === "github" ? "sur GitHub" : source === "twinpicks" ? "profil Twin Picks" : "sur cet appareil"} · ${S.pluriel(p.nb, "titre")}</span></span>${ico("retour", "")}</button>`).join("");
  const dejaVus = new Set([...d.locaux, ...d.github].map(p => p.id));
  $("[data-liste]", vue).innerHTML = `
    <p class="muet centre" style="margin-top:0">Qui regarde ? Choisis ton profil : cet appareil sera le tien.</p>
    ${choix(d.locaux, "local")}${choix(d.github.filter(p => !d.locaux.some(l => l.id === p.id)), "github")}${choix(d.twin_picks.filter(p => !dejaVus.has(p.id)), "twinpicks")}
    <div class="carte" style="margin-top:14px"><label class="etiquette" style="margin-top:0">Nouveau profil</label><div class="flex"><input class="champ" data-nom placeholder="Ton prénom"><button class="bouton principal" data-creer>Créer</button></div></div>
    <details class="carte" style="margin-top:10px" ${g.jeton ? "" : ""}><summary class="petit muet" style="cursor:pointer">Retrouver les profils de tes amis (GitHub)</summary>
      <label class="etiquette">Dépôt GitHub des profils</label><input class="champ" data-depot placeholder="compte/silencio" value="${esc(g.depot || "")}">
      <label class="etiquette">Ton jeton GitHub (accès au dépôt)</label><input class="champ" data-jeton type="password" placeholder="${g.jeton ? "••••" : "github_pat_…"}">
      <button class="bouton" data-gh style="margin-top:10px">Chercher les profils</button><div class="mini discret" data-gh-etat style="margin-top:8px"></div></details>`;
  $$(".choix-profil", vue).forEach(b => b.onclick = () => choisir({ id: b.dataset.id, nom: b.dataset.nomp, twin_picks: b.dataset.source === "twinpicks" ? b.dataset.id : undefined }));
  $("[data-creer]", vue).onclick = () => { const nom = $("[data-nom]", vue).value.trim(); if (nom) choisir({ id: nom, nom }); };
  $("[data-nom]", vue).onkeydown = e => { if (e.key === "Enter") $("[data-creer]", vue).click(); };
  $("[data-gh]", vue).onclick = async () => {
    const etat = $("[data-gh-etat]", vue); etat.textContent = "Recherche…";
    await S.post("/api/reglages", { github: { depot: $("[data-depot]", vue).value, jeton: $("[data-jeton]", vue).value || null } });
    await S.post("/api/sync");
    for (let i = 0; i < 20; i++) { await new Promise(r => setTimeout(r, 1000)); const e = await S.chargerEtat(); if (!e.sync.en_cours && e.sync.derniere || e.sync.erreur) { if (e.sync.erreur) { etat.textContent = e.sync.erreur; return; } break; } }
    P.choixProfil(vue);
  };
  async function choisir(c) {
    vue.innerHTML = S.chargement();
    await S.post("/api/profil/choisir", c);
    await S.chargerEtat();
    document.body.classList.remove("sans-profil");
    $("#lateral").style.display = ""; $("#barre-bas").style.display = "";
    S.chargerBase(true).then(() => S.rafraichir(true)).catch(() => {});
    location.hash = "#/"; S.rafraichir(false);
  }
};

// ------------------------------------------------------------------ accueil
const bonjour = () => { const h = new Date().getHours(); return h < 5 ? "Bonne nuit" : h < 12 ? "Bonjour" : h < 18 ? "Bon après-midi" : "Bonsoir"; };
S.prochainEpisode = (cle) => {
  const m = S.info(cle); const s = S.moi.series?.[cle];
  if (!m?.sa || !s || s.x) return null;
  const vus = new Set(s.episodes || []);
  const auj = S.aujourdhui();
  for (const [n, nb, date] of m.sa) {
    if (!n) continue;
    for (let e = 1; e <= nb; e++) if (!vus.has(`${n}x${e}`)) {
      if (m.pr && (n > m.pr[0] || (n === m.pr[0] && e >= m.pr[1]))) return { s: n, e, date: m.pr[2], futur: true };
      if (date && date > auj) return { s: n, e, date, futur: true };
      return { s: n, e };
    }
  }
  return m.pr ? { s: m.pr[0], e: m.pr[1], date: m.pr[2], futur: true } : null;
};
P.accueil = async (vue) => {
  const moi = S.moi;
  const journal = Object.entries(S.vivants(moi.journal)).map(([id, e]) => ({ id, ...e })).sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.maj || 0) - (a.maj || 0));
  const auj = S.aujourdhui(), an = auj.slice(0, 4), md = auj.slice(5);
  const ceJour = journal.filter(e => e.date && e.date.length === 10 && e.date.slice(5) === md && !e.date.startsWith(an) && !e.approx);
  const wl = Object.entries(S.vivants(moi.watchlist)).sort((a, b) => (b[1].prio ? 1 : 0) - (a[1].prio ? 1 : 0) || (b[1].ajout || "").localeCompare(a[1].ajout || "") || (b[1].maj || 0) - (a[1].maj || 0)).map(([c]) => c);
  const enCours = Object.entries(S.vivants(moi.series)).filter(([c, s]) => (s.episodes || []).length).sort((a, b) => (b[1].derniere || b[1].maj || 0) - (a[1].derniere || a[1].maj || 0)).map(([c]) => ({ c, p: S.prochainEpisode(c) })).filter(x => x.p).slice(0, 8);
  const e = S.etat;
  const duree = c => { const m = S.info(c) || {}; return m.ty === "t" ? (m.dep ? `${m.dep} min / ép.` : "Série") : S.duree(m.r) || ""; };
  vue.innerHTML = `
    <div class="entete bonjour"><h1>${bonjour()}, <i>${esc(moi.profil.nom.split(" ")[0])}</i></h1><span class="espace"></span>
      <a class="icone-bouton" href="#/notifs" aria-label="Notifications">${ico("cloche")}${e.notifs ? `<span class="badge">${e.notifs}</span>` : ""}</a>
      <a class="icone-bouton" href="#/reglages" aria-label="Réglages" style="margin-left:0">${ico("reglages")}</a></div>
    <div class="recherche-accueil">${ico("recherche")}<input type="search" placeholder="Film, série, personne" autocomplete="off" enterkeyhint="search" data-recherche></div>
    <div data-resultats class="cache"></div>
    <div data-blocs>
    ${journal.length ? `<div class="section"><div class="section-titre"><h2>Derniers vus</h2><a class="lien" href="#/journal">Journal</a></div><div class="rangee">${journal.slice(0, 14).map(j => S.vignette(j.cle, { note: j.note })).join("")}</div></div>`
      : `<div class="carte vide" style="margin-top:20px"><b>Ton journal est vide</b>Le bouton <b>+</b> ajoute ton premier film.</div>`}
    ${enCours.length ? `<div class="section"><div class="section-titre"><h2>Reprendre</h2></div><div class="suivre">${enCours.map(({ c, p }) => { const m = S.info(c) || {}; return `<a class="carte" href="#/titre/${c}">${S.affiche(m, { taille: "w154" })}<div style="min-width:0"><b class="coupe" style="display:block">${esc(S.nomTitre(m))}</b><span class="petit" style="color:${p.futur ? "var(--texte-3)" : "var(--accent)"}">S${p.s} · É${p.e}${p.futur && p.date ? ` · ${S.fmtDate(p.date, true)}` : ""}</span></div></a>`; }).join("")}</div></div>` : ""}
    ${wl.length ? `<div class="section"><div class="section-titre"><h2>À voir ensuite</h2><button class="lien" data-tirage aria-label="Tirage au sort" style="color:var(--accent)">${ico("des")}</button><a class="lien" href="#/watchlist" style="margin-left:14px">Watchlist</a></div><div class="rangee">${wl.slice(0, 14).map(c => S.vignette(c, { info: duree(c) })).join("")}</div></div>` : ""}
    ${ceJour.length ? `<div class="section"><div class="section-titre"><h2>Ce jour-là</h2></div><div class="rangee">${ceJour.map(j => S.vignette(j.cle, { note: j.note, info: j.date.slice(0, 4) })).join("")}</div></div>` : ""}
    <div class="section" data-sorties></div>
    <div class="section" data-anniv></div>
    </div>`;
  const t = $("[data-tirage]", vue); if (t) t.onclick = () => tirage();
  // recherche en haut : les résultats remplacent les blocs pendant qu'on tape
  const champ = $("[data-recherche]", vue), res = $("[data-resultats]", vue), blocs = $("[data-blocs]", vue);
  const chercher = S.debounce(async () => {
    const q = champ.value.trim();
    res.classList.toggle("cache", !q); blocs.classList.toggle("cache", !!q);
    if (!q) return;
    const loc = S.rechercheLocale(q, 4);
    const peindre = (r = []) => {
      const titres = [...new Set([...loc, ...r.filter(x => x.media_type !== "person").map(x => S.retenir(x)).filter(Boolean)])].slice(0, 20);
      const pers = r.filter(x => x.media_type === "person").slice(0, 10);
      res.innerHTML = `${pers.length ? `<div class="rangee" style="margin:14px -16px 6px">${pers.map(p => `<a class="personne-v" href="#/personne/${p.id}">${S.portrait(p.profile_path, p.name)}<b>${esc(p.name)}</b></a>`).join("")}</div>` : ""}<div class="lignes">${titres.map(c => S.ligneTitre(c)).join("")}</div>`;
      S.activerGlisse(res);
    };
    peindre();
    try { peindre(await S.rechercheTMDB(q)); } catch { /* hors ligne : tes films seulement */ }
  }, 180);
  champ.oninput = chercher;
  // sorties des favoris et anniversaires (en arrière-plan)
  if (Object.keys(S.vivants(moi.favoris)).length) {
    const z = $("[data-sorties]", vue);
    const remplir = r => { const l = r.filter(x => !x.vu).slice(0, 14); if (!l.length) return; l.forEach(x => S.infos[x.cle] = S.infos[x.cle] || { k: x.cle, ty: x.cle[0], t: x.t, af: x.af, fd: x.fd, a: x.date ? +x.date.slice(0, 4) : null }); z.innerHTML = `<div class="section-titre"><h2>Sorties de tes favoris</h2><a class="lien" href="#/decouvrir">Tout voir</a></div><div class="rangee">${l.map(x => S.vignette(x.cle, { info: x.date ? S.fmtDate(x.date, true) : "" })).join("")}</div>`; };
    if (S.memo.sorties) remplir(S.memo.sorties); else S.api("/api/sorties").then(d => { S.memo.sorties = d.r; remplir(d.r); }).catch(() => {});
  }
  const remplirAnniv = r => {
    if (!r.length) return;
    $("[data-anniv]", vue).innerHTML = `<div class="section-titre"><h2>Anniversaires</h2></div><div class="rangee">${r.slice(0, 12).map(p => `<a class="personne-v anniv" href="#/personne/${p.id}">${S.portrait(p.photo, p.nom)}<b>${esc(p.nom)}</b><span>${p.dans === 0 ? "aujourd'hui" : p.dans === 1 ? "demain" : `dans ${p.dans} jours`}${p.deces ? "" : ` · ${p.age} ans`}</span></a>`).join("")}</div>`;
  };
  if (S.memo.anniv) remplirAnniv(S.memo.anniv); else S.api("/api/anniversaires").then(d => { S.memo.anniv = d.r; remplirAnniv(d.r); }).catch(() => {});
};

// tirage au sort dans la watchlist (ou dans des recos)
function tirage() {
  const wl = Object.keys(S.vivants(S.moi.watchlist));
  if (!wl.length) { S.toast("Ta watchlist est vide."); return; }
  const f = { type: "", duree: 0, genre: "" };
  const corps = el(`<div><div class="flex" style="flex-wrap:wrap"><div class="segments" data-type><button data-v="" class="actif">Tout</button><button data-v="m">Film</button><button data-v="t">Série</button></div><select class="champ" data-duree style="width:auto;height:34px"><option value="0">Toutes durées</option><option value="100">Moins de 1 h 40</option><option value="120">Moins de 2 h</option><option value="150">Moins de 2 h 30</option></select><select class="champ" data-genre style="width:auto;height:34px"><option value="">Tous genres</option>${Object.entries(S.GENRES).filter(([k]) => +k < 10759).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></div><div data-res style="margin-top:14px"></div></div>`);
  S.ouvrirModale({ titre: "Tirage au sort", corps, pied: `<button class="bouton principal" data-relancer>${ico("des")} Relancer</button>` });
  const tirer = () => {
    const cands = wl.filter(c => { const m = S.info(c) || {}; return (!f.type || m.ty === f.type) && (!f.duree || (m.r && m.r <= f.duree && m.ty === "m")) && (!f.genre || (m.g || []).includes(+f.genre)); });
    const z = $("[data-res]", corps);
    if (!cands.length) { z.innerHTML = S.vide("Aucun titre ne correspond"); return; }
    const c = cands[Math.floor(Math.random() * cands.length)]; const m = S.info(c) || {};
    z.innerHTML = `<a class="tirage" href="#/titre/${c}">${m.fd ? `<img class="fond" src="${S.img(m.fd, "w780")}" alt="">` : ""}<div class="flex haut" style="gap:14px">${S.affiche(m, { taille: "w185" }).replace('class="affiche"', 'class="affiche" style="width:90px"')}<div><div class="mini discret">parmi ${cands.length}</div><h3 class="serif" style="font-size:24px;font-weight:600">${esc(S.nomTitre(m))}</h3><div class="muet petit">${[m.a, S.duree(m.ty === "m" ? m.r : 0), (m.g || []).slice(0, 2).map(g => S.GENRES[g]).join(", ")].filter(Boolean).join(" · ")}</div></div></div></a>`;
    $("a", z).onclick = () => S.fermerModale(true);
  };
  $$("[data-type] button", corps).forEach(b => b.onclick = () => { f.type = b.dataset.v; $$("[data-type] button", corps).forEach(x => x.classList.toggle("actif", x === b)); tirer(); });
  $("[data-duree]", corps).onchange = e => { f.duree = +e.target.value; tirer(); };
  $("[data-genre]", corps).onchange = e => { f.genre = e.target.value; tirer(); };
  $("[data-relancer]", corps.closest(".modale")).onclick = tirer;
  tirer();
}
S.tirage = tirage;

// ------------------------------------------------------------------ recherche
P.recherche = (vue, args, params) => {
  const etat = S.filtresMemo.recherche = S.filtresMemo.recherche || { q: "", onglet: "tout", res: [] };
  if (params.q && params.q !== etat.q) { etat.q = params.q; etat.res = []; setTimeout(() => $("input", vue)?.dispatchEvent(new Event("input")), 0); }
  vue.innerHTML = `<div class="entete"><h1>Recherche</h1></div>
    <input class="champ" type="search" placeholder="Film, série, personne…" value="${esc(etat.q)}" autocomplete="off" enterkeyhint="search" style="height:48px;font-size:16px">
    <div class="onglets" data-onglets>${[["tout", "Tout"], ["movie", "Films"], ["tv", "Séries"], ["person", "Personnes"]].map(([k, l]) => `<button data-v="${k}" class="${etat.onglet === k ? "actif" : ""}">${l}</button>`).join("")}</div>
    <div data-res></div>`;
  const champ = $("input", vue), zone = $("[data-res]", vue);
  const peindre = () => {
    const res = etat.res.filter(r => etat.onglet === "tout" || r.media_type === etat.onglet);
    if (!etat.q) {
      const reals = new Map(); const doc = S.moi;
      for (const [c] of Object.entries(S.vivants(doc.titres))) for (const id of (S.info(c)?.re || [])) reals.set(id, (reals.get(id) || 0) + 1);
      const fav = Object.entries(S.vivants(doc.favoris));
      zone.innerHTML = `${fav.length ? `<div class="section-titre"><h2>Tes personnes favorites</h2></div><div class="rangee">${fav.map(([id, p]) => `<a class="personne-v" href="#/personne/${id}">${S.portrait(p.photo, p.nom)}${esc(p.nom)}</a>`).join("")}</div>` : ""}
        <div class="section-titre section"><h2>Explorer</h2></div><div class="puces"><a class="puce" href="#/decouvrir/explorer">${ico("decouvrir")} Explorer par genre, pays, décennie…</a><a class="puce" href="#/decouvrir">Pour toi</a><a class="puce" href="#/decouvrir/soir">Ce soir entre amis</a><a class="puce" href="#/decouvrir/palmares">Palmarès</a></div>`;
      return;
    }
    const loc = etat.onglet === "person" ? [] : S.rechercheLocale(etat.q, 4).filter(c => etat.onglet === "tout" || (etat.onglet === "movie" ? c[0] === "m" : c[0] === "t"));
    const titres = res.filter(r => r.media_type !== "person").map(r => S.retenir(r)).filter(c => c && !loc.includes(c));
    const personnes = res.filter(r => r.media_type === "person");
    zone.innerHTML = `${personnes.length && etat.onglet !== "movie" && etat.onglet !== "tv" ? `<div class="rangee" style="margin-bottom:10px">${personnes.slice(0, 12).map(p => `<a class="personne-v" href="#/personne/${p.id}">${S.portrait(p.profile_path, p.name)}${esc(p.name)}<span>${esc({ Directing: "Réalisation", Acting: "Interprétation", Writing: "Scénario", Camera: "Image", Sound: "Musique", Editing: "Montage" }[p.known_for_department] || p.known_for_department || "")}</span></a>`).join("")}</div>` : ""}
      <div class="lignes">${[...loc, ...titres].map(c => S.ligneTitre(c)).join("") || (etat.charge ? S.chargement() : S.vide("Rien trouvé", "Essaie le titre original."))}</div>`;
    S.activerGlisse(zone);
  };
  const chercher = S.debounce(async () => {
    etat.q = champ.value.trim();
    if (!etat.q) { etat.res = []; peindre(); return; }
    etat.charge = true; peindre();
    try { etat.res = await S.rechercheTMDB(etat.q); } catch (e) { if (e.name === "AbortError") return; etat.res = []; if (e.horsLigne) S.toast("Hors ligne : recherche dans tes films seulement"); }
    etat.charge = false; peindre();
  }, 180);
  champ.oninput = chercher;
  $$("[data-onglets] button", vue).forEach(b => b.onclick = () => { etat.onglet = b.dataset.v; $$("[data-onglets] button", vue).forEach(x => x.classList.toggle("actif", x === b)); peindre(); });
  peindre();
  if (matchMedia("(min-width: 900px)").matches || !etat.q) setTimeout(() => champ.focus({ preventScroll: true }), 50);
};

// ------------------------------------------------------------------ page d'un film ou d'une série
P.titre = async (vue, args) => {
  const cle = args[0];
  if (!/^[mt]:\d+$/.test(cle || "")) { vue.innerHTML = S.vide("Titre inconnu"); return; }
  const m0 = S.info(cle) || {};
  const memo = S.memo["titre:" + cle];
  if (!memo) {
    vue.innerHTML = `<div class="titre-page"><div class="fiche"><div class="fiche-fond">${m0.fd ? `<img src="${S.img(m0.fd, "w1280")}" alt="">` : ""}</div><div class="fiche-grille"><div class="cover">${S.affiche(m0, { vt: "affiche-" + cle.replace(":", "-") })}</div><div><span class="pastille-type">${cle[0] === "t" ? "Série" : "Film"}</span><h1>${esc(S.nomTitre(m0))}</h1><div class="vo">${m0.a || ""}</div></div></div></div><div class="titre-corps">${S.chargement()}</div></div>`;
    try {
      S.memo["titre:" + cle] = await S.api("/api/titre/" + cle);
    } catch (e) {
      vue.querySelector(".titre-corps").innerHTML = S.vide(e.horsLigne ? "Hors ligne" : "Impossible de charger ce titre", e.horsLigne ? "Cette fiche n'a jamais été ouverte : il faut Internet la première fois." : esc(e.message));
      return;
    }
    if (location.hash !== "#/titre/" + cle) return;
  }
  rendreTitre(vue, cle, S.memo["titre:" + cle]);
};

function rendreTitre(vue, cle, data) {
  const d = data.d, meta = data.meta || {}, tv = cle[0] === "t";
  const m = Object.assign({}, S.info(cle) || {}, meta, { t: d.title || d.name, o: d.original_title || d.original_name, af: d.poster_path, fd: d.backdrop_path });
  if (!S.base?.titres?.[cle]) S.infos[cle] = Object.assign(S.infos[cle] || {}, m);
  const t = S.monTitre(cle), journal = S.journalDe(cle), wl = S.dansWatchlist(cle);
  const date = d.release_date || d.first_air_date || "";
  const reals = tv ? (d.created_by || []) : (d.credits?.crew || []).filter(c => c.job === "Director");
  const duree = tv ? (d.episode_run_time?.[0] ? `${d.episode_run_time[0]} min` : "") : S.duree(d.runtime);
  const pays = [...new Set((d.production_countries || []).map(p => p.iso_3166_1).concat(tv ? d.origin_country || [] : []))];
  const amis = Object.entries(data.amis || {}).sort((a, b) => (b[1].note ?? -1) - (a[1].note ?? -1));
  const sortieFR = !tv && (d.release_dates?.results || []).find(r => r.iso_3166_1 === "FR")?.release_dates?.find(x => x.type === 3)?.release_date?.slice(0, 10);
  const fourn = data.fournisseurs || {};
  const cast = tv ? (d.aggregate_credits?.cast || []).slice(0, 30) : (d.credits?.cast || []).slice(0, 30);
  const crewBrut = tv ? (d.aggregate_credits?.crew || []).flatMap(c => (c.jobs || []).map(j => ({ ...c, job: j.job }))) : (d.credits?.crew || []);
  const METIERS = [["Screenplay", "Scénario"], ["Writer", "Scénario"], ["Novel", "Roman"], ["Director of Photography", "Image"], ["Original Music Composer", "Musique"], ["Editor", "Montage"], ["Production Design", "Décors"], ["Costume Design", "Costumes"], ["Sound Designer", "Son"], ["Casting", "Casting"], ["Visual Effects Supervisor", "Effets visuels"], ["Producer", "Production"]];
  const equipe = {};
  for (const [job, lib] of METIERS) for (const c of crewBrut.filter(x => x.job === job)) { const l = equipe[lib] = equipe[lib] || []; if (!l.some(x => x.id === c.id) && l.length < 3) l.push({ id: c.id, nom: c.name }); }
  const recos = (d.recommendations?.results || []).map(r => S.retenir(r, tv ? "tv" : "movie")).filter(c => c && !S.monTitre(c).vu).slice(0, 16);
  const motscles = ((tv ? d.keywords?.results : d.keywords?.keywords) || []).slice(0, 5);
  const ratio = d.budget > 1000 && d.revenue ? d.revenue / d.budget : null;
  const verdict = ratio == null ? null : ratio < 1 ? ["Bide", "mauvais"] : ratio < 2.5 ? ["Juste rentable", "moyen"] : ratio < 5 ? ["Succès", "bon"] : ["Triomphe", "bon"];
  const groupes = [["flatrate", "Abonnement"], ["free", "Gratuit"], ["ads", "Gratuit avec pub"], ["rent", "Location"], ["buy", "Achat"]].filter(([k]) => fourn[k]?.length);
  const titreRecherche = d.title || d.name;
  const vt = "affiche-" + cle.replace(":", "-");
  vue.className = "";
  vue.innerHTML = `<div class="fond-film">${d.poster_path ? `<img src="${S.img(d.poster_path, "w342")}" alt="">` : ""}</div>
  <div class="page-film">
    <header class="film-tete apparait">
      <div class="film-affiche">${S.affiche(m, { taille: "w500", vt })}</div>
      <div class="film-titres">
        <h1>${esc(S.nomTitre(m))}</h1>
        ${S.autreTitre(m) ? `<div class="vo">${esc(S.autreTitre(m))}</div>` : ""}
        <div class="film-ligne">${date ? `<span>${date.slice(0, 4)}${tv && d.last_air_date && d.status !== "Returning Series" && d.last_air_date.slice(0, 4) !== date.slice(0, 4) ? "–" + d.last_air_date.slice(0, 4) : ""}</span>` : ""}${reals.map(r => `<a href="#/personne/${r.id}">${esc(r.name)}</a>`).join("")}</div>
        <div class="tags">${(d.genres || []).map(g => `<a class="tag" href="#/decouvrir/explorer?genre=${g.id}&type=${tv ? "tv" : "movie"}">${esc(S.GENRES[g.id] || g.name)}</a>`).join("")}${motscles.map(k => `<a class="tag tag-mc" href="#/motcle/${k.id}">${esc(k.name)}</a>`).join("")}</div>
        <div class="notes-logos">${data.imdb ? `<span class="note-logo">${S.LOGOS.imdb}<b>${S.fmtNote(data.imdb[0])}</b></span>` : ""}${d.vote_count ? `<span class="note-logo">${S.LOGOS.tmdb}<b>${S.fmtNote(d.vote_average)}</b></span>` : ""}</div>
      </div>
    </header>
    <div data-prix class="prix-film"></div>
    <section class="film-note apparait" style="--i:1">
      <div data-anneau></div>
      <div class="cartes-film">
        ${duree ? `<div class="carte-stat"><span>Durée</span><b>${duree}</b></div>` : ""}
        ${tv ? `<div class="carte-stat"><span>Épisodes</span><b>${d.number_of_episodes || "–"}</b><small>${S.pluriel(d.number_of_seasons || 0, "saison")}</small></div>` : ""}
        ${d.budget ? `<div class="carte-stat"><span>Budget</span><b>${S.argent(d.budget)}</b>${ratio != null ? `<div class="jauge-bide ${verdict[1]}" title="Recettes ${S.argent(d.revenue)}"><i style="width:${Math.min(100, ratio / 6 * 100)}%"></i><em style="left:${2.5 / 6 * 100}%"></em></div><small>${verdict[0]} · ×${S.fmtNote(ratio)}</small>` : `<small>recettes inconnues</small>`}</div>` : ""}
      </div>
    </section>
    <div class="boutons-film apparait" style="--i:2"><button class="bouton" data-synopsis>${ico("texte")} Synopsis</button><button class="bouton" data-infos>${ico("info")} Infos</button></div>
    ${tv ? `<section class="bloc" data-saisons></section>` : ""}
    ${cast.length ? `<section class="section-film"><h2>Casting</h2><div class="rangee rangee-cast">${cast.map(c => `<a class="personne-v" href="#/personne/${c.id}">${S.portrait(c.profile_path, c.name)}<b>${esc(c.name)}</b><span>${esc(tv ? (c.roles || []).map(r => r.character).filter(Boolean)[0] || "" : c.character || "")}</span></a>`).join("")}</div></section>` : ""}
    ${Object.keys(equipe).length ? `<section class="section-film"><h2>Équipe</h2><div class="grille-equipe">${Object.entries(equipe).map(([lib, l]) => `<div><span>${lib}</span>${l.map(p => `<a href="#/personne/${p.id}">${esc(p.nom)}</a>`).join("")}</div>`).join("")}</div></section>` : ""}
    <section class="section-film"><div class="onglets onglets-film"><button data-o="toi" class="actif">Toi</button>${amis.length ? `<button data-o="amis">Amis <span class="discret">${amis.length}</span></button>` : ""}</div><div data-onglet-toi></div><div data-onglet-amis class="cache"></div></section>
    ${groupes.length ? `<section class="section-film"><h2>Regarder</h2>${groupes.map(([k, l]) => `<div class="groupe-dispo"><span>${l}</span><div class="logos-dispo">${fourn[k].map(p => `<a href="${esc(S.lienPlateforme(p.provider_id, titreRecherche, fourn.link || "#"))}" target="_blank" rel="noopener" title="${esc(p.provider_name)}"><img src="${S.img(p.logo_path, "w92")}" alt="${esc(p.provider_name)}"></a>`).join("")}</div></div>`).join("")}</section>` : ""}
    ${data.collection?.parts?.length > 1 ? `<section class="section-film"><h2>${esc(data.collection.name)}</h2><div class="rangee">${data.collection.parts.sort((a, b) => (a.release_date || "9").localeCompare(b.release_date || "9")).map(p => S.vignette(S.retenir(p, "movie"), { vu: S.monTitre("m:" + p.id).vu })).join("")}</div></section>` : ""}
    ${recos.length ? `<section class="section-film"><h2>Dans le même esprit</h2><div class="rangee">${recos.map(c => S.vignette(c)).join("")}</div></section>` : ""}
  </div>
  <nav class="barre-film">
    <button class="bouton principal" data-vu>${ico("oeil")} ${journal.length || t.vu ? "Revu" : "J'ai vu"}</button>
    <button class="icone-bouton grand ${wl ? "actif" : ""}" data-wl aria-label="Watchlist">${ico(wl ? "watchlist-plein" : "watchlist")}</button>
    <button class="icone-bouton grand" data-liste aria-label="Ajouter à une liste">${ico("listes")}</button>
    ${!tv ? `<button class="icone-bouton grand ${t.collection ? "actif" : ""}" data-collection aria-label="Collection">${ico("boite")}</button>` : ""}
  </nav>`;
  // couleurs de l'affiche : fond, halos, couleur d'accent de la page
  if (d.poster_path) S.couleursAffiche(S.img(d.poster_path, "w92")).then(c => {
    if (!c || !location.hash.includes(cle)) return;
    const a = S.accentLisible(c[0]);
    document.body.style.setProperty("--accent-film", a.join(","));
    document.body.style.setProperty("--accent-film-2", S.accentLisible(c[1]).join(","));
  });
  // ta note : l'anneau, toucher pour noter
  const an = S.anneau(t.note, v => S.agir("noter", { cle, note: v }, { toast: v == null ? "Note retirée" : `Noté ${S.fmtNote(v)}`, sansRendu: true }));
  an.insertAdjacentHTML("beforeend", `<button class="coeur ${t.coeur ? "actif" : ""}" data-coeur aria-label="Coup de cœur">${ico(t.coeur ? "coeur-plein" : "coeur")}</button>`);
  $("[data-anneau]", vue).append(an);
  $("[data-coeur]", vue).onclick = ev => { const b = ev.currentTarget; const nv = !b.classList.contains("actif"); b.classList.toggle("actif", nv); b.innerHTML = ico(nv ? "coeur-plein" : "coeur"); b.classList.remove("rebond"); void b.offsetWidth; b.classList.add("rebond"); S.agir("coeur", { cle, val: nv }, { toast: nv ? "Coup de cœur" : "Cœur retiré", sansRendu: true }); };
  $("[data-vu]", vue).onclick = () => S.ouvrirAjout(cle);
  $("[data-wl]", vue).onclick = () => S.agir("watchlist", { cle, val: !wl }, { toast: wl ? "Retiré de la watchlist" : "Dans ta watchlist" });
  $("[data-liste]", vue).onclick = () => S.choisirListe(cle);
  const col = $("[data-collection]", vue); if (col) col.onclick = () => collection(cle);
  $("[data-synopsis]", vue).onclick = () => S.ouvrirModale({ titre: "Synopsis", corps: `${d.tagline ? `<p class="serif" style="font-style:italic;color:var(--texte-2);font-size:17px;margin-top:0">${esc(d.tagline)}</p>` : ""}<p class="synopsis" style="font-size:16px">${esc(d.overview || d.overview_en || "Pas de synopsis.")}</p>` });
  $("[data-infos]", vue).onclick = () => S.ouvrirModale({ titre: "Infos", corps: `<dl class="tableau-infos">
    ${date ? `<dt>${tv ? "Première diffusion" : "Sortie"}</dt><dd>${S.fmtDate(date)}</dd>` : ""}${sortieFR && sortieFR !== date ? `<dt>En France</dt><dd>${S.fmtDate(sortieFR)}</dd>` : ""}
    ${tv && d.status ? `<dt>Statut</dt><dd>${esc({ "Returning Series": "En cours", Ended: "Terminée", Canceled: "Annulée", "In Production": "En production" }[d.status] || d.status)}</dd>` : ""}
    ${pays.length ? `<dt>Pays</dt><dd>${pays.map(p => esc(S.pays(p))).join(", ")}</dd>` : ""}
    ${d.revenue ? `<dt>Recettes</dt><dd>${S.argent(d.revenue)}</dd>` : ""}
    ${(d.production_companies || []).length ? `<dt>Production</dt><dd>${d.production_companies.slice(0, 6).map(c => esc(c.name)).join(", ")}</dd>` : ""}
    ${tv && (d.networks || []).length ? `<dt>Chaîne</dt><dd>${d.networks.map(n => esc(n.name)).join(", ")}</dd>` : ""}
  </dl>` });
  // onglets Toi / Amis
  const toi = $("[data-onglet-toi]", vue), am = $("[data-onglet-amis]", vue);
  monJournal(toi, cle, t, journal);
  am.innerHTML = amis.map(([pid, a]) => { const ec = a.note != null && t.note != null ? a.note - t.note : null; return `<div class="ami-note"><a href="#/profil/${encodeURIComponent(pid)}">${S.avatar(pid, a.nom)}</a><span class="espace"><b>${esc(a.nom)}</b>${a.coeur ? ` <span style="color:var(--rouge)">${ico("coeur-plein")}</span>` : ""}${!a.vu && a.watchlist ? `<br><span class="mini discret">veut le voir</span>` : ""}</span>${a.note != null ? `<span class="note-ami">${S.fmtNote(a.note)}</span>` : ""}</div>${a.critiques.map(c => `<div class="critique" style="padding-left:42px"><p>${esc(c.texte)}</p></div>`).join("")}`; }).join("");
  $$(".onglets-film button", vue).forEach(b => b.onclick = () => { $$(".onglets-film button", vue).forEach(x => x.classList.toggle("actif", x === b)); toi.classList.toggle("cache", b.dataset.o !== "toi"); am.classList.toggle("cache", b.dataset.o !== "amis"); });
  if (tv) saisons($("[data-saisons]", vue), cle, d);
  // récompenses (Wikidata), sans bloquer la page
  const pz = $("[data-prix]", vue);
  const peindrePrix = r => {
    if (!r || (!r.gagnes.length && !r.nominations.length)) return;
    pz.innerHTML = `${r.gagnes.map(p => `<span class="badge-prix">${ico("trophee")}${esc(p.prix)}${p.annee ? ` <em>${p.annee}</em>` : ""}</span>`).join("")}${r.nominations.length ? `<button class="badge-prix nomination" data-nom>+ ${S.pluriel(r.nominations.length, "nomination")}</button><div class="cache liste-nominations">${r.nominations.map(p => `<span>${esc(p.prix)}${p.annee ? ` · ${p.annee}` : ""}</span>`).join("")}</div>` : ""}`;
    const b = $("[data-nom]", pz); if (b) b.onclick = () => $(".liste-nominations", pz).classList.toggle("cache");
  };
  if (S.memo["prix:" + cle]) peindrePrix(S.memo["prix:" + cle]);
  else S.api("/api/prix/titre/" + cle).then(r => { S.memo["prix:" + cle] = r; if (location.hash.includes(cle)) peindrePrix(r); }).catch(() => {});
}

function monJournal(z, cle, t, journal) {
  const cit = t.citations || [], et = t.etiquettes || [], det = Object.entries(t.detail || {}).filter(([, v]) => v);
  const LIB = { scenario: "Scénario", realisation: "Mise en scène", jeu: "Jeu", image: "Image", musique: "Musique", son: "Son" };
  z.innerHTML = `${journal.length ? `<div class="lignes">${journal.map(j => `<div class="ligne" data-j="${j.id}" style="cursor:pointer"><div class="jour"><b>${+j.date.slice(8, 10) || ""}</b><span>${S.MOIS_C[+j.date.slice(5, 7) - 1] || ""} ${j.date.slice(2, 4)}</span></div><div class="corps"><span class="icones-ligne">${j.revision ? ico("revision") : ""}${j.ou?.type === "cinema" ? ico("ticket") + `<span class="mini">${esc(j.ou.cinema || "")}${j.ou.salle ? " · " + esc(j.ou.salle) : ""}</span>` : j.ou?.nom ? ico(j.ou.type === "support" ? "disque" : "play") + `<span class="mini">${esc(j.ou.nom)}</span>` : ""}${j.version ? `<span class="mini">${esc(j.version)}</span>` : ""}${(j.avec || []).length ? `<span class="mini">avec ${esc(j.avec.map(a => S.amis[a]?.profil?.nom || a).join(", "))}</span>` : ""}${j.prive ? ico("cadenas") : ""}</span>${j.critique ? `<div class="petit" style="color:#d6d4df;white-space:pre-wrap;margin-top:4px">${esc(j.critique)}${j.critique_privee ? ` <span class="discret">${ico("cadenas")}</span>` : ""}</div>` : ""}</div><div class="droite">${j.note != null ? `<span class="note-txt">${S.fmtNote(j.note)}</span>` : ""}${ico("crayon")}</div></div>`).join("")}</div>` : `<div class="mini discret" style="padding:6px 0">Pas encore dans ton journal.</div>`}
    ${det.length ? `<div class="mini-notes" style="margin-top:14px">${det.map(([k, v]) => `<span class="petit muet">${LIB[k] || k}</span><div class="flex"><div class="jauge" style="width:140px"><i style="width:${v * 10}%"></i></div><span class="mini">${v}/10</span></div>`).join("")}</div>` : ""}
    <div style="margin-top:14px">${cit.map((c, i) => `<div class="citation flex haut"><span class="espace">${esc(c)}</span><button class="discret" data-cit-suppr="${i}">${ico("x")}</button></div>`).join("")}</div>
    <div class="puces" style="margin-top:10px">${et.map(e => `<span class="puce actif">${esc(e)} <button class="x" data-et-suppr="${esc(e)}">${ico("x")}</button></span>`).join("")}<button class="puce" data-cit>${ico("citation")} Citation</button><button class="puce" data-et>${ico("plus")} Étiquette</button>${t.prive ? `<button class="puce actif" data-prive>${ico("cadenas")} Film caché</button>` : `<button class="puce" data-prive>${ico("cadenas")} Cacher ce film</button>`}</div>`;
  $$("[data-j]", z).forEach(l => l.onclick = () => S.ouvrirAjout(cle, journal.find(j => j.id === l.dataset.j)));
  $$("[data-cit-suppr]", z).forEach(b => b.onclick = () => S.agir("titre", { cle, champs: { citations: cit.filter((_, i) => i !== +b.dataset.citSuppr) } }, { toast: "Citation retirée" }));
  $$("[data-et-suppr]", z).forEach(b => b.onclick = () => S.agir("titre", { cle, champs: { etiquettes: et.filter(e => e !== b.dataset.etSuppr) } }, { toast: "Étiquette retirée" }));
  $("[data-cit]", z).onclick = () => {
    const c = el(`<div><textarea class="champ" placeholder="« No hay banda… »"></textarea></div>`);
    S.ouvrirModale({ titre: "Ta réplique préférée", corps: c, pied: `<button class="bouton principal" data-ok>Ajouter</button>` });
    $("textarea", c).focus();
    $("[data-ok]", c.closest(".modale")).onclick = async () => { const v = $("textarea", c).value.trim(); if (!v) return; await S.agir("titre", { cle, champs: { citations: [...cit, v] } }, { toast: "Citation ajoutée", sansRendu: true }); S.fermerModale(); S.rafraichir(true); };
  };
  $("[data-et]", z).onclick = () => {
    const toutes = [...new Set(Object.values(S.vivants(S.moi.titres)).flatMap(x => x.etiquettes || []))].filter(e => !et.includes(e));
    const c = el(`<div><input class="champ" placeholder="Nouvelle étiquette" list="etq"><datalist id="etq">${toutes.map(e => `<option value="${esc(e)}">`).join("")}</datalist><div class="puces" style="margin-top:10px">${toutes.slice(0, 30).map(e => `<button class="puce" data-v="${esc(e)}">${esc(e)}</button>`).join("")}</div></div>`);
    S.ouvrirModale({ titre: "Étiquette", corps: c, pied: `<button class="bouton principal" data-ok>Ajouter</button>` });
    const ajouter = async v => { v = v.trim(); if (!v) return; await S.agir("titre", { cle, champs: { etiquettes: [...et, v] } }, { toast: `Étiquette « ${v} »`, sansRendu: true }); S.fermerModale(); S.rafraichir(true); };
    $$("[data-v]", c).forEach(b => b.onclick = () => ajouter(b.dataset.v));
    $("[data-ok]", c.closest(".modale")).onclick = () => ajouter($("input", c).value);
    $("input", c).onkeydown = e => { if (e.key === "Enter") ajouter(e.target.value); };
  };
  $("[data-prive]", z).onclick = () => S.agir("titre", { cle, champs: { prive: !t.prive } }, { toast: t.prive ? "Film visible par tes amis" : "Film caché à tes amis (il compte dans tes stats)" });
}

function collection(cle) {
  const t = S.monTitre(cle), c = t.collection || {};
  const corps = el(`<div><label class="etiquette" style="margin-top:0">Format</label><div class="puces" data-f>${["Blu-ray", "4K UHD", "DVD", "VHS", "Coffret", "Laserdisc", "Numérique"].map(f => `<button class="puce ${c.format === f ? "actif" : ""}" data-v="${f}">${f}</button>`).join("")}</div><label class="etiquette">Édition</label><input class="champ" data-ed placeholder="Criterion, Carlotta, steelbook…" value="${esc(c.edition || "")}"><label class="etiquette">Rangement / note</label><input class="champ" data-note placeholder="Étagère du salon" value="${esc(c.note || "")}"></div>`);
  let f = c.format || "";
  S.ouvrirModale({ titre: "Ta collection", corps, pied: `${t.collection ? `<button class="bouton danger" data-retirer>Retirer</button>` : ""}<button class="bouton principal" data-ok>Enregistrer</button>` });
  $$("[data-f] button", corps).forEach(b => b.onclick = () => { f = b.dataset.v; $$("[data-f] button", corps).forEach(x => x.classList.toggle("actif", x === b)); });
  const m = corps.closest(".modale");
  $("[data-ok]", m).onclick = async () => { await S.agir("titre", { cle, champs: { collection: { format: f || "Blu-ray", edition: $("[data-ed]", corps).value.trim(), note: $("[data-note]", corps).value.trim(), ajout: c.ajout || S.aujourdhui() } } }, { toast: "Ajouté à ta collection", sansRendu: true }); S.fermerModale(); S.rafraichir(true); };
  const r = $("[data-retirer]", m); if (r) r.onclick = async () => { await S.agir("titre", { cle, champs: { collection: null } }, { toast: "Retiré de ta collection", sansRendu: true }); S.fermerModale(); S.rafraichir(true); };
}

function saisons(z, cle, d) {
  const s = S.moi.series?.[cle] && !S.moi.series[cle].x ? S.moi.series[cle] : { episodes: [], saisons: {} };
  const vus = new Set(s.episodes || []);
  const liste = (d.seasons || []).filter(x => x.episode_count).sort((a, b) => (a.season_number || 99) - (b.season_number || 99));
  const total = liste.filter(x => x.season_number).reduce((n, x) => n + x.episode_count, 0);
  const nbVus = [...vus].filter(e => !e.startsWith("0x")).length;
  const p = S.prochainEpisode(cle);
  z.innerHTML = `<div class="section-titre"><h2>Saisons<span class="compte">${liste.filter(x => x.season_number).length}</span></h2><span class="mini discret">${nbVus}/${total} épisodes vus${p ? ` · prochain : S${p.s} É${p.e}${p.futur && p.date ? " le " + S.fmtDate(p.date, true) : ""}` : ""}</span></div>
    ${liste.map(x => { const n = x.season_number; const v = Array.from({ length: x.episode_count }, (_, i) => `${n}x${i + 1}`).filter(e => vus.has(e)).length; const note = (s.saisons || {})[n]; return `<div class="saison" data-s="${n}"><div class="tete">${S.affiche({ af: x.poster_path, t: x.name }, { taille: "w92" }).replace('class="affiche"', 'class="affiche" style="width:42px"')}<div class="espace"><b style="font-weight:550">${esc(x.name || "Saison " + n)}</b><div class="mini discret">${v}/${x.episode_count} épisodes${x.air_date ? " · " + x.air_date.slice(0, 4) : ""}${note ? ` · ta note ${S.fmtNote(note)}` : ""}</div><div class="barre"><i style="width:${100 * v / x.episode_count}%"></i></div></div><button class="coche ${v === x.episode_count ? "ok" : ""}" data-tout="${n}" data-nb="${x.episode_count}" title="Toute la saison">${ico("ok")}</button></div><div class="episodes cache"></div></div>`; }).join("")}
    <div data-courbe style="margin-top:12px"></div>`;
  $$(".saison", z).forEach(b => {
    const n = +b.dataset.s;
    $(".tete", b).onclick = async ev => {
      if (ev.target.closest("[data-tout]")) return;
      const eps = $(".episodes", b);
      if (!eps.classList.contains("cache")) { eps.classList.add("cache"); return; }
      eps.classList.remove("cache"); eps.innerHTML = S.chargement();
      try {
        const sa = S.memo[`saison:${cle}:${n}`] = S.memo[`saison:${cle}:${n}`] || await S.api(`/api/saison/${d.id}/${n}`);
        const auj = S.aujourdhui();
        eps.innerHTML = `<div class="flex" style="padding:10px 12px;border-bottom:1px solid var(--ligne)"><span class="petit muet">Ta note de la saison</span><span data-note-s></span></div>` + (sa.episodes || []).map(e => `<div class="episode"><span class="num">É${e.episode_number}</span><span class="espace"><span style="${e.air_date > auj ? "color:var(--texte-3)" : ""}">${esc(e.name || "")}</span><br><span class="mini discret">${e.air_date ? S.fmtDate(e.air_date, true) : ""}${e.runtime ? " · " + e.runtime + " min" : ""}${e.vote_count ? " · TMDB " + S.fmtNote(e.vote_average) : ""}</span></span><button class="coche ${vus.has(`${n}x${e.episode_number}`) ? "ok" : ""}" data-ep="${n}x${e.episode_number}">${ico("ok")}</button></div>`).join("");
        $("[data-note-s]", eps).append(S.etoiles((s.saisons || {})[n], v => S.agir("note_saison", { cle, saison: n, note: v }, { toast: `Saison ${n} : ${v == null ? "note retirée" : S.fmtNote(v)}`, sansRendu: true }), { petites: true }));
        $$("[data-ep]", eps).forEach(c => c.onclick = () => { const ok = !c.classList.contains("ok"); c.classList.toggle("ok", ok); ok ? vus.add(c.dataset.ep) : vus.delete(c.dataset.ep); S.agir("episodes", { cle, episodes: [c.dataset.ep], val: ok }, { toast: false, sansRendu: true }); });
      } catch (e) { eps.innerHTML = `<div class="vide petit">${esc(e.horsLigne ? "Hors ligne" : e.message)}</div>`; }
    };
  });
  $$("[data-tout]", z).forEach(c => c.onclick = () => { const n = c.dataset.tout, nb = +c.dataset.nb; const ok = !c.classList.contains("ok"); S.agir("episodes", { cle, episodes: Array.from({ length: nb }, (_, i) => `${n}x${i + 1}`), val: ok }, { toast: ok ? `Saison ${n} vue` : `Saison ${n} décochée` }); });
  const notesS = Object.entries(s.saisons || {}).filter(([, v]) => v != null).map(([k, v]) => ({ x: +k, y: v }));
  if (notesS.length > 1) G.points($("[data-courbe]", z), { series: [{ nom: "Tes notes par saison", couleur: S.COULEURS[0], relier: true, points: notesS.map(p => ({ ...p, lib: "Saison " + p.x })) }], x: { type: "cat", domaine: liste.filter(x => x.season_number).map(x => x.season_number), titre: "Saison" }, y: { domaine: [0, 10] }, hauteur: 180 });
}

// ------------------------------------------------------------------ page d'une personne
P.personne = async (vue, args) => {
  const pid = +args[0];
  if (!S.memo["pers:" + pid]) {
    vue.innerHTML = S.chargement();
    try { S.memo["pers:" + pid] = await S.api("/api/personne/" + pid); } catch (e) { vue.innerHTML = S.vide(e.horsLigne ? "Hors ligne" : "Introuvable", e.horsLigne ? "Cette page n'a jamais été ouverte : il faut Internet la première fois." : ""); return; }
    if (location.hash !== "#/personne/" + pid) return;
    setTimeout(() => S.api("/api/personne/" + pid).then(r => { S.memo["pers:" + pid] = r; }).catch(() => {}), 6000);  // formats complétés en arrière-plan
  }
  const { d, formats } = S.memo["pers:" + pid];
  const cr = d.combined_credits || { cast: [], crew: [] };
  const DEPT = { Directing: "Réalisation", Acting: "Interprétation", Writing: "Scénario", Camera: "Image", Sound: "Musique", Editing: "Montage", Production: "Production", Art: "Décors", "Costume & Make-Up": "Costumes", Crew: "Équipe", "Visual Effects": "Effets visuels", Lighting: "Lumière" };
  // filmographie par département
  const parDept = {};
  const ajout = (dept, r, role) => {
    if (r.media_type === "tv" && (r.episode_count || 0) < 3 && dept !== "Directing" && dept !== "Writing") return;
    if (r.media_type === "tv" && /talk|news|reality/i.test((r.genre_ids || []).join(",")) ) return;
    const c = S.retenir(r); if (!c) return;
    const l = parDept[dept] = parDept[dept] || new Map();
    const e = l.get(c) || { cle: c, roles: new Set(), date: r.release_date || r.first_air_date || "", pop: r.popularity || 0, votes: r.vote_count || 0 };
    if (role) e.roles.add(role); l.set(c, e);
  };
  cr.cast.forEach(r => { if (![10767, 10763, 10764].some(g => (r.genre_ids || []).includes(g))) ajout("Acting", r, r.character); });
  cr.crew.forEach(r => ajout(r.department, r, r.job));
  const depts = Object.keys(parDept).sort((a, b) => (a === d.known_for_department ? -1 : b === d.known_for_department ? 1 : parDept[b].size - parDept[a].size));
  const st = S.filtresMemo["pers_" + pid] = S.filtresMemo["pers_" + pid] || { dept: depts[0], vu: "tous", tri: "date" };
  if (!parDept[st.dept]) st.dept = depts[0];
  const vus = new Set(Object.entries(S.vivants(S.moi.titres)).filter(([, t]) => t.vu || t.note != null).map(([c]) => c));
  const auj = S.aujourdhui();
  const filmo = [...(parDept[st.dept]?.values() || [])].sort((a, b) => (b.date || "9999").localeCompare(a.date || "9999"));
  const sortis = filmo.filter(f => f.date && f.date <= auj);
  const fmtDe = c => formats?.[c]?.fmt || S.info(c)?.fmt || (c[0] === "t" ? "serie" : null);
  const compte = f => { const l = sortis.filter(x => (f === "long" ? ["long", null, undefined].includes(fmtDe(x.cle)) && x.cle[0] === "m" : fmtDe(x.cle) === f)); return { n: l.length, v: l.filter(x => vus.has(x.cle)).length }; };
  const cLong = compte("long"), cCourt = compte("court"), cDocu = compte("docu"), cSerie = { n: sortis.filter(x => x.cle[0] === "t").length, v: sortis.filter(x => x.cle[0] === "t" && vus.has(x.cle)).length };
  const mesNotes = sortis.filter(x => S.monTitre(x.cle).note != null);
  const fav = S.vivants(S.moi.favoris)[pid];
  const classement = (S.moi.classements?.[pid] && !S.moi.classements[pid].x ? S.moi.classements[pid].items : []).filter(c => vus.has(c));
  const tousVus = [...new Set(depts.flatMap(dp => [...parDept[dp].values()]).map(f => f.cle).filter(c => vus.has(c)))];
  const ordre = [...classement, ...tousVus.filter(c => !classement.includes(c)).sort((a, b) => (S.monTitre(b).note ?? -1) - (S.monTitre(a).note ?? -1))];
  const age = (n, m) => { if (!n) return ""; const f = m ? new Date(m) : new Date(); const a = f.getFullYear() - +n.slice(0, 4) - ((f.getMonth() + 1) * 100 + f.getDate() < +n.slice(5, 7) * 100 + +n.slice(8, 10) ? 1 : 0); return `${a} ans`; };
  const ongletP = S.filtresMemo["pers_o_" + pid] = S.filtresMemo["pers_o_" + pid] || "filmo";
  const vusN = cLong.v + cDocu.v + cSerie.v, totN = cLong.n + cDocu.n + cSerie.n;
  vue.innerHTML = `
    <div class="page-film" style="padding-bottom:40px">
    <header class="film-tete apparait">
      <div class="film-affiche">${S.portrait(d.profile_path, d.name)}</div>
      <div class="film-titres">
        <h1>${esc(d.name)}</h1>
        <div class="film-ligne"><span>${esc(DEPT[d.known_for_department] || d.known_for_department || "")}</span>${d.birthday ? `<span>${d.deathday ? d.birthday.slice(0, 4) + "–" + d.deathday.slice(0, 4) : age(d.birthday)}</span>` : ""}</div>
        <div class="flex" style="margin-top:12px"><button class="bouton ${fav ? "actif" : ""}" data-fav>${ico(fav ? "coeur-plein" : "coeur")} ${fav ? "Favori" : "Favori ?"}</button></div>
      </div>
    </header>
    <section class="film-note apparait" style="--i:1">
      <div data-anneau-p></div>
      <div class="cartes-film">
        ${totN ? `<div class="carte-stat"><span>Vus</span><b>${vusN}/${totN}</b><div class="jauge" style="margin-top:8px;height:5px"><i style="width:${100 * vusN / totN}%"></i></div></div>` : ""}
        ${cLong.n ? `<div class="carte-stat"><span>Longs</span><b>${cLong.v}/${cLong.n}</b></div>` : ""}
        ${cCourt.n ? `<div class="carte-stat"><span>Courts</span><b>${cCourt.v}/${cCourt.n}</b></div>` : ""}
        ${cDocu.n ? `<div class="carte-stat"><span>Documentaires</span><b>${cDocu.v}/${cDocu.n}</b></div>` : ""}
        ${cSerie.n ? `<div class="carte-stat"><span>Séries</span><b>${cSerie.v}/${cSerie.n}</b></div>` : ""}
      </div>
    </section>
    <div class="onglets onglets-film" style="margin-top:22px">${[["filmo", "Filmo"], ["classement", "Classement"], ["courbe", "Courbe"], ["prix", "Prix"], ["collab", "Collaborateurs"]].map(([k, l]) => `<button data-op="${k}" class="${ongletP === k ? "actif" : ""}">${l}</button>`).join("")}</div>
    <div data-panneau="filmo"><div class="onglets">${depts.map(dp => `<button data-dept="${esc(dp)}" class="${dp === st.dept ? "actif" : ""}">${esc(DEPT[dp] || dp)}</button>`).join("")}</div>
      <div class="filtres"><div class="segments" data-vu><button data-v="tous">Tous</button><button data-v="vus">Vus</button><button data-v="pasvus">Pas vus</button></div></div>
      <div class="grille" data-filmo></div>
      ${d.biography ? `<button class="bouton" data-bio-ouvrir style="margin-top:18px;width:100%">${ico("texte")} Biographie</button>` : ""}</div>
    <div data-panneau="classement">${ordre.length ? `<div class="lignes classement" data-classement>${ordre.map((c, i) => `<div class="ligne" data-cle="${c}"><span class="rang">${i + 1}</span>${S.affiche(S.info(c) || {}, { taille: "w92" })}<a class="corps" href="#/titre/${c}"><b>${esc(S.nomTitre(S.info(c)))}</b><span>${S.info(c)?.a || ""}</span></a><span class="note-txt">${S.fmtNote(S.monTitre(c).note)}</span><span class="poignee">${ico("poignee")}</span></div>`).join("")}</div><p class="mini discret">Glisse les poignées pour réordonner.</p>` : S.vide("Aucun titre vu")}</div>
    <div data-panneau="courbe">${mesNotes.length > 1 ? `<div data-courbe></div><a class="bouton" data-labo href="#/labo" style="margin-top:12px">${ico("labo")} Comparer dans le labo</a>` : S.vide("Note au moins deux titres")}</div>
    <div data-panneau="prix"><div data-prix>${S.chargement()}</div></div>
    <div data-panneau="collab"><div data-collab></div></div>
    </div>`;
  const montrerP = k => { S.filtresMemo["pers_o_" + pid] = k; $$("[data-op]", vue).forEach(b => b.classList.toggle("actif", b.dataset.op === k)); $$("[data-panneau]", vue).forEach(x => x.classList.toggle("cache", x.dataset.panneau !== k)); if (k === "courbe") dessinerCourbe(); };
  $$("[data-op]", vue).forEach(b => b.onclick = () => montrerP(b.dataset.op));
  const notesP = mesNotes.map(x => S.monTitre(x.cle).note);
  $("[data-anneau-p]", vue).append(S.anneau(notesP.length ? Math.round(moyenne(notesP) * 10) / 10 : null, null, { lecture: true, libelle: "ta moyenne" }));
  const bo = $("[data-bio-ouvrir]", vue); if (bo) bo.onclick = () => S.ouvrirModale({ titre: d.name, corps: `<p class="synopsis" style="font-size:15.5px">${esc(d.biography)}</p>` });
  let courbeFaite = false;
  const dessinerCourbe = () => {
    const cz = $("[data-courbe]", vue); if (!cz || courbeFaite) return; courbeFaite = true;
    const pts = mesNotes.map(x => { const m = S.info(x.cle) || {}; return { x: +(x.date || "0").slice(0, 4), y: S.monTitre(x.cle).note, ir: m.ir, lib: `${S.nomTitre(m)} (${(x.date || "").slice(0, 4)})`, cle: x.cle }; }).sort((a, b) => a.x - b.x);
    const series = [{ nom: "Ta note", couleur: S.COULEURS[0], relier: true, lisse: false, points: pts }, { nom: "IMDb", couleur: S.COULEURS[3], pointille: true, relier: true, lisse: false, points: pts.filter(p => p.ir).map(p => ({ ...p, y: p.ir })) }];
    cz.innerHTML = G.legende(series) + "<div></div>";
    requestAnimationFrame(() => G.points(cz.lastElementChild, { series, x: { format: d3.format("d") }, y: { domaine: [0, 10] }, hauteur: 260 }));
  };
  const remplirFilmo = () => {
    const l = filmo.filter(f => st.vu === "tous" || (st.vu === "vus" ? vus.has(f.cle) : !vus.has(f.cle)));
    $("[data-filmo]", vue).innerHTML = l.map(f => S.vignette(f.cle, { vu: vus.has(f.cle), sous: [f.date ? f.date.slice(0, 4) : "à venir", [...f.roles][0] && st.dept === "Acting" ? [...f.roles][0] : ""].filter(Boolean).join(" · ") })).join("") || S.vide("Rien ici");
    $$("[data-vu] button", vue).forEach(b => b.classList.toggle("actif", b.dataset.v === st.vu));
  };
  $$("[data-vu] button", vue).forEach(b => b.onclick = () => { st.vu = b.dataset.v; remplirFilmo(); });
  $$("[data-dept]", vue).forEach(b => b.onclick = () => { st.dept = b.dataset.dept; S.rafraichir(true); });
  remplirFilmo();
  $("[data-fav]", vue).onclick = () => S.agir("favori", { personne: { id: pid, nom: d.name, photo: d.profile_path, metier: { Directing: "real", Acting: "acteur", Camera: "image", Sound: "musique", Writing: "scen", Editing: "montage" }[d.known_for_department] || "" }, val: !fav }, { toast: fav ? "Retiré des favoris" : `${d.name} ajouté à tes favoris` });
  const lab = $("[data-labo]", vue); if (lab) lab.onclick = () => { S.filtresMemo.labo = { mode: "personnes", vue: "courbe", dim: "annee", mes: "moy_note", series: "aucune", profils: [""], personnes: [{ id: pid, nom: d.name }], role: st.dept === "Acting" ? "acteur" : st.dept === "Directing" ? "real" : "tous", x: "annee", y: "note", imdb: true, filtres: {}, top: 15 }; S.filtresMemo.laboId = null; };
  montrerP(ongletP);
  // classement : glisser-déposer par la poignée
  const cl = $("[data-classement]", vue);
  if (cl) {
    let tire = null, y0 = 0;
    $$(".poignee", cl).forEach(p => p.addEventListener("pointerdown", e => { tire = p.closest(".ligne"); y0 = e.clientY; tire.classList.add("saisie"); p.setPointerCapture(e.pointerId); e.preventDefault(); }));
    cl.addEventListener("pointermove", e => {
      if (!tire) return;
      const lignes = $$(".ligne", cl).filter(l => l !== tire);
      const apres = lignes.find(l => { const r = l.getBoundingClientRect(); return e.clientY < r.top + r.height / 2; });
      apres ? cl.insertBefore(tire, apres) : cl.append(tire);
    });
    const fin = () => { if (!tire) return; tire.classList.remove("saisie"); tire = null; $$(".rang", cl).forEach((r, i) => r.textContent = i + 1); S.agir("classement", { pid, items: $$(".ligne", cl).map(l => l.dataset.cle) }, { toast: "Classement enregistré", sansRendu: true }); };
    cl.addEventListener("pointerup", fin); cl.addEventListener("pointercancel", fin);
  }
  // prix (Wikidata)
  const pz = $("[data-prix]", vue);
  S.api("/api/prix/personne/" + pid).then(r => {
    if (!r.prix.length) { pz.innerHTML = S.vide("Aucun prix connu"); return; }
    const grands = r.prix.filter(p => /oscar|academy award|palme|césar|cesar|lion d|ours d|golden|bafta|prix d'interprétation|grand prix|goya|emmy/i.test(p.prix));
    const l = (grands.length ? grands : r.prix).slice(0, 30);
    pz.innerHTML = `<div class="lignes">${l.map(p => `<div class="ligne" style="padding:7px 2px"><span class="jour"><b style="font-size:14px">${p.annee || ""}</b></span><div class="corps"><b style="white-space:normal">${esc(p.prix)}</b>${p.oeuvre ? `<span>${p.cle ? `<a href="#/titre/${p.cle}" style="color:var(--accent)">${esc(p.oeuvre)}</a>` : esc(p.oeuvre)}</span>` : ""}</div></div>`).join("")}</div>`;
  }).catch(() => { pz.innerHTML = S.vide("Hors ligne"); });
  // collaborateurs (d'après les films vus)
  const collab = new Map();
  for (const c of tousVus) {
    const m = S.base?.titres?.[c]; if (!m) continue;
    const roles = [["real", m.eq?.real || m.re || []], ["acteur", (m.ca || []).slice(0, 8)], ["image", m.eq?.image || []], ["musique", m.eq?.musique || []], ["montage", m.eq?.montage || []], ["scen", m.eq?.scen || []]];
    for (const [role, ids] of roles) for (const id of ids) { if (id === pid) continue; const k = id; const e = collab.get(k) || { id, roles: new Set(), films: new Set() }; e.roles.add(role); e.films.add(c); collab.set(k, e); }
  }
  const tops = [...collab.values()].filter(e => e.films.size >= 2).sort((a, b) => b.films.size - a.films.size).slice(0, 12);
  $("[data-collab]", vue).innerHTML = S.vide("Pas encore assez de titres vus");
  if (tops.length) { $("[data-collab]", vue).innerHTML = `<div class="classement-p">${tops.map(e => { const p = S.base.pers[e.id] || {}; const notes = [...e.films].map(c => S.monTitre(c).note).filter(n => n != null); return `<a href="#/personne/${e.id}"><span class="n"></span>${S.portrait(p.ph, p.n)}<span><b style="font-weight:550">${esc(p.n || "")}</b><br><span class="mini discret">${[...e.roles].map(r => S.METIERS[r]).join(", ")} · ${e.films.size} titres ensemble</span></span><span class="valeurs"><span class="note-txt">${S.fmtNote(moyenne(notes))}</span><small>ta moyenne</small></span></a>`; }).join("")}</div>`; }
};
})();
