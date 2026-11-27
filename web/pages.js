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
  const afficher = cles => { res.innerHTML = cles.map(c => { const m = S.info(c) || {}; return `<div class="ligne" data-cle="${c}">${S.affiche(m, { taille: "w154" })}<div class="corps"><b>${esc(S.nomTitre(m))}</b><span>${m.a || ""}, ${c[0] === "t" ? "Série" : "Film"}</span></div></div>`; }).join(""); $$(".ligne", res).forEach(l => l.onclick = () => { S.fermerModale(); cb(l.dataset.cle); }); };
  champ.oninput = S.debounce(async () => {
    const q = champ.value.trim(); if (!q) return afficher([]);
    const loc = S.rechercheLocale(q, 5); afficher(loc);
    try { const r = await S.rechercheTMDB(q); afficher([...new Set([...loc, ...r.map(x => S.retenir(x)).filter(Boolean)])].slice(0, 12)); } catch { /* hors ligne */ }
  }, 160);
  setTimeout(() => champ.focus(), 80);
};

// ------------------------------------------------------------------ premier lancement : connexion ou création de compte
// Le mot de passe ne quitte pas l'appareil : il sert à chiffrer ta partie privée (et tes clés) sur GitHub.
const CHAMPS_FICHIER = ["nom", "identifiant", "letterboxd_pseudo", "imdb_pseudo", "imdb_watchlist", "refract_cle", "jeton_github"];
function lireFichierCompte(input, form) {
  const f = input.files && input.files[0]; if (!f) return;
  f.text().then(t => {
    let d; try { d = JSON.parse(t); } catch { S.toast("Ce fichier n'est pas un fichier de compte Silencio"); return; }
    let n = 0;
    for (const k of CHAMPS_FICHIER) { const x = form.querySelector(`[name="${k}"]`); if (x && d[k]) { x.value = d[k]; n++; } }
    const plus = form.querySelector("details"); if (plus) plus.open = true;
    S.toast(n ? `${n} champ${n > 1 ? "s" : ""} rempli${n > 1 ? "s" : ""}` : "Rien à remplir dans ce fichier");
  });
}
S.lireFichierCompte = lireFichierCompte;
S.champsRelies = (v = {}) => `
  <label class="etiquette">Pseudo Letterboxd</label><input class="champ" name="letterboxd_pseudo" value="${esc(v.letterboxd_pseudo || "")}" autocomplete="off" spellcheck="false">
  <label class="etiquette">Pseudo IMDb</label><input class="champ" name="imdb_pseudo" value="${esc(v.imdb_pseudo || "")}" autocomplete="off" spellcheck="false">
  <label class="etiquette">Lien de ta watchlist IMDb</label><input class="champ" name="imdb_watchlist" value="${esc(v.imdb_watchlist || "")}" placeholder="https://www.imdb.com/user/…/watchlist" autocomplete="off" spellcheck="false">
  <label class="etiquette">Clé Refract</label><input class="champ" name="refract_cle" type="password" placeholder="rfk_…" autocomplete="off">
  <label class="etiquette">Jeton GitHub</label><input class="champ" name="jeton_github" type="password" placeholder="${S.etat?.appareil?.github?.jeton ? "déjà enregistré sur cet appareil" : "github_pat_…"}" autocomplete="off">`;

P.choixProfil = async (vue, onglet) => {
  document.body.classList.add("sans-profil");
  $("#lateral").style.display = "none"; $("#barre-bas").style.display = "none";
  vue.className = "plein";
  const d = await S.api("/api/profils").catch(() => ({ locaux: [], github: [], twin_picks: [] }));
  if (S.moi) return;
  onglet = onglet || "connexion";
  const e = S.etat || {};
  const sansDepot = !(e.compte && e.compte.depot);
  vue.innerHTML = `<div class="accueil-profil"><div class="boite compte-boite">
    <h1>Silencio</h1><div class="devise">No hay banda. Il n'y a pas d'orchestre.</div>
    <nav class="compte-onglets"><button data-o="connexion" class="${onglet === "connexion" ? "actif" : ""}">Se connecter</button><button data-o="creer" class="${onglet === "creer" ? "actif" : ""}">Créer un compte</button></nav>
    <form data-form autocomplete="on">${onglet === "connexion" ? `
      <label class="etiquette">Identifiant</label><input class="champ" name="identifiant" autocomplete="username" autocapitalize="none" spellcheck="false" required>
      <label class="etiquette">Mot de passe</label><input class="champ" name="mot_de_passe" type="password" autocomplete="current-password" required>
      <p class="compte-note">Cet appareil restera connecté jusqu'à ce que tu te déconnectes dans Réglages.</p>
      <button class="bouton principal large" type="submit">Se connecter</button>` : `
      <label class="etiquette">Ton prénom</label><input class="champ" name="nom" autocomplete="given-name" required>
      <label class="etiquette">Identifiant</label><input class="champ" name="identifiant" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="lettres, chiffres, tirets" required>
      <label class="etiquette">Mot de passe</label><input class="champ" name="mot_de_passe" type="password" autocomplete="new-password" minlength="10" required>
      <label class="etiquette">Encore une fois</label><input class="champ" name="mot_de_passe2" type="password" autocomplete="new-password" required>
      <p class="compte-note">Garde-le bien : il chiffre ta partie privée et tes clés. Sans lui, personne ne peut les relire, pas même toi.</p>
      <details class="compte-plus"><summary>Comptes reliés (facultatif, modifiables ensuite)</summary>${S.champsRelies()}
        <label class="compte-fichier">Remplir depuis un fichier de compte<input type="file" accept=".json,application/json" data-fichier hidden></label></details>
      <button class="bouton principal large" type="submit">Créer le compte</button>`}
      ${sansDepot ? `<details class="compte-plus"><summary>Dépôt GitHub des profils</summary><input class="champ" name="depot" placeholder="compte/silencio"></details>` : ""}
      <p class="compte-erreur" data-erreur role="alert"></p>
    </form>
    ${d.locaux.length ? `<div class="compte-locaux"><p class="compte-note">Profils sans compte sur cet appareil</p>${d.locaux.map(p => `<button class="choix-profil" data-id="${esc(p.id)}" data-nomp="${esc(p.nom)}">${S.avatar(p.id, p.nom)}<span class="espace"><b>${esc(p.nom)}</b><br><span class="mini discret">${S.pluriel(p.nb, "titre")}</span></span></button>`).join("")}</div>` : ""}
  </div></div>`;
  $$("[data-o]", vue).forEach(b => b.onclick = () => P.choixProfil(vue, b.dataset.o));
  const form = $("[data-form]", vue), err = $("[data-erreur]", vue);
  form.oninput = () => { err.textContent = ""; };
  const fic = $("[data-fichier]", vue); if (fic) fic.onchange = () => lireFichierCompte(fic, form);
  $$(".choix-profil", vue).forEach(b => b.onclick = () => choisir(b.dataset.id, b.dataset.nomp));
  form.onsubmit = async ev => {
    ev.preventDefault();
    const v = Object.fromEntries(new FormData(form).entries());
    err.textContent = "";
    if (onglet === "creer" && v.mot_de_passe !== v.mot_de_passe2) { err.textContent = "Les deux mots de passe ne sont pas identiques."; return; }
    const bouton = form.querySelector("[type=submit]"); bouton.disabled = true; bouton.textContent = onglet === "creer" ? "Création…" : "Connexion…";
    try {
      if (v.depot) await S.post("/api/reglages", { github: { depot: v.depot } });
      delete v.mot_de_passe2; delete v.depot;
      await S.post(onglet === "creer" ? "/api/compte/creer" : "/api/compte/connexion", v);
      entrer();
    } catch (er) {
      err.textContent = er.horsLigne ? "Pas d'Internet : la première connexion sur un appareil en a besoin." : er.message === "inconnu" ? "Silencio a été mis à jour mais tourne encore avec l'ancienne version : ferme-le complètement et relance-le." : er.message;
      bouton.disabled = false; bouton.textContent = onglet === "creer" ? "Créer le compte" : "Se connecter";
    }
  };
  async function choisir(id, nom) {
    try { await S.post("/api/profil/choisir", { id, nom }); entrer(); } catch (er) { err.textContent = er.message; }
  }
  async function entrer() {
    vue.innerHTML = S.chargement();
    await S.chargerEtat();
    document.body.classList.remove("sans-profil");
    $("#lateral").style.display = ""; $("#barre-bas").style.display = "";
    S.chargerBase(true).then(() => S.rafraichir(true)).catch(() => {});
    location.hash = "#/"; S.rafraichir(false);
  }
};

// ------------------------------------------------------------------ tableau de bord : tes derniers films et leur envoi
const PLATS = [["lb", "Letterboxd"], ["imdb", "IMDb"], ["rf", "Refract"], ["tmdb", "TMDB"]];
// l'icône de chaque site (son favicon, chargé depuis le site lui-même) ; sans réseau, ses initiales
const FAVICONS = { lb: "https://letterboxd.com/favicon.ico", imdb: "https://www.imdb.com/favicon.ico", rf: "https://getrefract.app/favicon.ico", tmdb: "https://www.themoviedb.org/favicon.ico" };
const INITIALES = { lb: "LB", imdb: "IM", rf: "RF", tmdb: "TM" };
S.iconePlateforme = (p, nom, e, detail) => `<span class="plo plo-${e}" title="${esc(nom)} : ${ETATS[e] || e}${detail ? " (" + esc(detail) + ")" : ""}"><img src="${FAVICONS[p]}" alt="${esc(nom)}" loading="lazy" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement('b'),{textContent:'${INITIALES[p]}'}))"></span>`;
const ETATS = { ok: "envoyé", attente: "en attente", clic: "attend ton clic", erreur: "erreur", off: "non relié", na: "rien à envoyer" };
S.synchroniser = async () => {
  try { await S.post("/api/synchroniser"); S.toast("Synchronisation lancée : Refract et GitHub tout de suite, Letterboxd et IMDb dans la minute"); }
  catch (er) { S.toast(er.message); }
};
async function tableauDeBord(z) {
  let d;
  try { d = await S.api("/api/tableau"); } catch { return; }
  d.r = d.r.slice(0, 8);
  if (!d.r.length) return;
  z.innerHTML = `<div class="section-titre"><h2>Tes derniers films</h2><a class="lien" href="#/envois" style="margin-right:16px">Historique</a><button class="lien" data-sync-tout>Synchroniser</button></div>
    <div class="tdb">${d.r.map(x => { const m = S.info(x.cle) || {}; return `<a class="tdb-ligne" href="#/titre/${x.cle}">
      ${S.affiche(m, { taille: "w92" })}
      <div class="tdb-corps"><b>${esc(S.nomTitre(m))}</b>
        <div class="tdb-infos">${S.noteJolie(x.note)}${x.coeur ? S.ICONES.coeur : ""}${x.revu ? S.ICONES.revu : ""}${x.critique ? `<span class="ic-crit ${x.critique_privee ? "privee" : "publique"}" title="Critique ${x.critique_privee ? "privée" : "publique"}">${S.ICONES.critique}</span>` : ""}${x.cinema ? S.ICONES.cinema : ""}<span class="tdb-date">${x.date ? esc(S.fmtDate(x.date, true)) : ""}</span></div>
        <div class="tdb-plats">${PLATS.map(([p, nom]) => { const e = x.plateformes[p] || { e: "na" }; return S.iconePlateforme(p, nom, e.e, e.m); }).join("")}</div>
      </div></a>`; }).join("")}</div>
    <p class="tdb-legende"><span class="pl pl-ok">envoyé</span><span class="pl pl-attente">en attente</span><span class="pl pl-erreur">erreur</span><span class="pl pl-na">rien à envoyer ou non relié</span></p>`;
  $("[data-sync-tout]", z).onclick = async ev => { ev.preventDefault(); await S.synchroniser(); setTimeout(() => tableauDeBord(z), 6000); setTimeout(() => tableauDeBord(z), 75000); };
}

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
    <div class="entete bonjour"><h1>${bonjour()}, <i>${esc(moi.profil.nom.split(" ")[0])}</i></h1>
      <nav class="liens-tete tel"><a href="#/notifs">Notifications${e.notifs ? ` <b>${e.notifs}</b>` : ""}</a><a href="#/reglages">Réglages</a></nav></div>
    <div class="recherche-accueil"><input type="search" placeholder="Un film, une personne, ou « vus au cinéma en 2025 notés 8+ »" autocomplete="off" enterkeyhint="search" data-recherche></div>
    <div data-resultats class="cache"></div>
    <div data-blocs>
    ${journal.length ? `<div class="section" data-tableau></div>` : ""}
    ${journal.length ? `<div class="section"><div class="section-titre"><h2>Derniers vus</h2><a class="lien" href="#/journal">Tout le journal</a></div><div class="rangee">${journal.slice(0, 14).map(j => S.vignette(j.cle, { note: j.note })).join("")}</div></div>`
      : `<div class="vide"><b>Ton journal est vide</b>Le bouton + ajoute ton premier film.</div>`}
    ${enCours.length ? `<div class="section"><div class="section-titre"><h2>Reprendre</h2></div><div class="suivre">${enCours.map(({ c, p }) => { const m = S.info(c) || {}; return `<a class="reprise" href="#/titre/${c}">${S.affiche(m, { taille: "w154" })}<div style="min-width:0"><b class="coupe">${esc(S.nomTitre(m))}</b><span class="${p.futur ? "futur" : ""}">Saison ${p.s}, épisode ${p.e}${p.futur && p.date ? `, le ${S.fmtDate(p.date, true)}` : ""}</span></div></a>`; }).join("")}</div></div>` : ""}
    ${wl.length ? `<div class="section"><div class="section-titre"><h2>À voir ensuite</h2><button class="lien" data-tirage>Au hasard</button><a class="lien" href="#/watchlist" style="margin-left:16px">Watchlist</a></div><div class="rangee">${wl.slice(0, 14).map(c => S.vignette(c, { info: duree(c) })).join("")}</div></div>` : ""}
    ${ceJour.length ? `<div class="section"><div class="section-titre"><h2>Ce jour-là</h2></div><div class="rangee">${ceJour.map(j => S.vignette(j.cle, { note: j.note, info: j.date.slice(0, 4) })).join("")}</div></div>` : ""}
    <div class="section" data-sorties></div>
    <div class="section" data-anniv></div>
    </div>`;
  const t = $("[data-tirage]", vue); if (t) t.onclick = () => tirage();
  const tb = $("[data-tableau]", vue); if (tb) tableauDeBord(tb);
  // recherche en haut : les résultats remplacent les blocs pendant qu'on tape
  const champ = $("[data-recherche]", vue), res = $("[data-resultats]", vue), blocs = $("[data-blocs]", vue);
  const chercher = S.debounce(async () => {
    const q = champ.value.trim();
    res.classList.toggle("cache", !q); blocs.classList.toggle("cache", !!q);
    if (!q) return;
    const ph = S.recherchePhrase && S.recherchePhrase(q);
    // une phrase (« vus au cinéma en 2025 notés 8+ ») : ce que Silencio a compris, au-dessus des résultats habituels
    const blocPhrase = ph && ph.cles.length ? `<div class="phrase"><p class="phrase-compris">${ph.compris.map(c => `<span>${esc(c)}</span>`).join("")}<em>${S.pluriel(ph.cles.length, "titre")}</em></p>
        <div class="grille">${ph.cles.slice(0, 120).map(c => S.vignette(c, { note: ph.notes[c] })).join("")}</div></div>` : "";
    const loc = S.rechercheLocale(q, 4);
    const peindre = (r = []) => {
      const titres = [...new Set([...loc, ...r.filter(x => x.media_type !== "person").map(x => S.retenir(x)).filter(Boolean)])].slice(0, 20);
      const pers = r.filter(x => x.media_type === "person").slice(0, 10);
      res.innerHTML = `${blocPhrase}${pers.length ? `<div class="rangee" style="margin:14px -16px 6px">${pers.map(p => `<a class="personne-v" href="#/personne/${p.id}">${S.portrait(p.profile_path, p.name)}<b>${esc(p.name)}</b></a>`).join("")}</div>` : ""}<div class="lignes">${titres.map(c => S.ligneTitre(c)).join("")}</div>`;
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
    const auj = r.filter(p => p.dans === 0);              // seulement ceux dont c'est l'anniversaire aujourd'hui
    if (!auj.length) return;
    $("[data-anniv]", vue).innerHTML = `<div class="section-titre"><h2>Anniversaires du jour</h2></div><div class="rangee rangee-anniv">${auj.slice(0, 12).map(p => `<a class="personne-v anniv" href="#/personne/${p.id}">${S.portrait(p.photo, p.nom)}<b>${esc(p.nom)}</b><span>${p.deces ? `aurait eu ${p.age} ans` : `${p.age} ans`}</span></a>`).join("")}</div>`;
  };
  if (S.memo.anniv) remplirAnniv(S.memo.anniv); else S.api("/api/anniversaires").then(d => { S.memo.anniv = d.r; remplirAnniv(d.r); }).catch(() => {});
};

// tirage au sort dans la watchlist (ou dans des recos)
function tirage() {
  const wl = Object.keys(S.vivants(S.moi.watchlist));
  if (!wl.length) { S.toast("Ta watchlist est vide."); return; }
  const f = { type: "", duree: 0, genre: "" };
  const corps = el(`<div><div class="flex" style="flex-wrap:wrap"><div class="segments" data-type><button data-v="" class="actif">Tout</button><button data-v="m">Film</button><button data-v="t">Série</button></div><select class="champ" data-duree style="width:auto;height:34px"><option value="0">Toutes durées</option><option value="100">Moins de 1 h 40</option><option value="120">Moins de 2 h</option><option value="150">Moins de 2 h 30</option></select><select class="champ" data-genre style="width:auto;height:34px"><option value="">Tous genres</option>${Object.entries(S.GENRES).filter(([k]) => +k < 10759).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></div><div data-res style="margin-top:14px"></div></div>`);
  S.ouvrirModale({ titre: "Tirage au sort", corps, pied: `<button class="bouton principal" data-relancer>Relancer</button>` });
  const tirer = () => {
    const cands = wl.filter(c => { const m = S.info(c) || {}; return (!f.type || m.ty === f.type) && (!f.duree || (m.r && m.r <= f.duree && m.ty === "m")) && (!f.genre || (m.g || []).includes(+f.genre)); });
    const z = $("[data-res]", corps);
    if (!cands.length) { z.innerHTML = S.vide("Aucun titre ne correspond"); return; }
    const c = cands[Math.floor(Math.random() * cands.length)]; const m = S.info(c) || {};
    z.innerHTML = `<a class="tirage" href="#/titre/${c}">${m.fd ? `<img class="fond" src="${S.img(m.fd, "w780")}" alt="">` : ""}<div class="flex haut" style="gap:14px">${S.affiche(m, { taille: "w185" }).replace('class="affiche"', 'class="affiche" style="width:90px"')}<div><div class="mini discret">parmi ${cands.length}</div><h3 class="serif" style="font-size:24px;font-weight:600">${esc(S.nomTitre(m))}</h3><div class="muet petit">${[m.a, S.duree(m.ty === "m" ? m.r : 0), (m.g || []).slice(0, 2).map(g => S.GENRES[g]).join(", ")].filter(Boolean).join(", ")}</div></div></div></a>`;
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
        <div class="section-titre section"><h2>Explorer</h2></div><div class="puces"><a class="puce" href="#/decouvrir/explorer">Explorer par genre, pays, décennie</a><a class="puce" href="#/decouvrir">Pour toi</a><a class="puce" href="#/decouvrir/soir">Ce soir entre amis</a><a class="puce" href="#/decouvrir/palmares">Palmarès</a></div>`;
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
  const duree = tv ? (d.episode_run_time?.[0] ? `${d.episode_run_time[0]} min par épisode` : "") : S.duree(d.runtime);
  const pays = [...new Set((d.production_countries || []).map(p => p.iso_3166_1).concat(tv ? d.origin_country || [] : []))];
  const amis = Object.entries(data.amis || {}).sort((a, b) => (b[1].note ?? -1) - (a[1].note ?? -1));
  const sortieFR = !tv && (d.release_dates?.results || []).find(r => r.iso_3166_1 === "FR")?.release_dates?.find(x => x.type === 3)?.release_date?.slice(0, 10);
  const fourn = data.fournisseurs || {};
  const cast = tv ? (d.aggregate_credits?.cast || []).slice(0, 30) : (d.credits?.cast || []).slice(0, 30);
  const crewBrut = tv ? (d.aggregate_credits?.crew || []).flatMap(c => (c.jobs || []).map(j => ({ ...c, job: j.job }))) : (d.credits?.crew || []);
  const METIERS = [["Screenplay", "Scénario"], ["Writer", "Scénario"], ["Novel", "Roman"], ["Director of Photography", "Image"], ["Original Music Composer", "Musique"], ["Editor", "Montage"], ["Production Design", "Décors"], ["Costume Design", "Costumes"], ["Sound Designer", "Son"], ["Casting", "Casting"], ["Producer", "Production"]];
  const equipe = {};
  for (const [job, lib] of METIERS) for (const c of crewBrut.filter(x => x.job === job)) { const l = equipe[lib] = equipe[lib] || []; if (!l.some(x => x.id === c.id) && l.length < 3) l.push({ id: c.id, nom: c.name }); }
  const recos = (d.recommendations?.results || []).map(r => S.retenir(r, tv ? "tv" : "movie")).filter(c => c && !S.monTitre(c).vu).slice(0, 16);
  const motscles = ((tv ? d.keywords?.results : d.keywords?.keywords) || []).slice(0, 5);
  const ratio = d.budget > 1000 && d.revenue ? d.revenue / d.budget : null;
  const verdict = ratio == null ? null : ratio < 1 ? ["Un échec", "mauvais"] : ratio < 2.5 ? ["Juste rentable", "moyen"] : ratio < 5 ? ["Un succès", "bon"] : ["Un triomphe", "bon"];
  const groupes = [["flatrate", "En abonnement"], ["free", "Gratuit"], ["ads", "Gratuit avec publicité"], ["rent", "En location"], ["buy", "À l'achat"]].filter(([k]) => fourn[k]?.length);
  const titreRecherche = d.title || d.name;
  const vt = "affiche-" + cle.replace(":", "-");
  const annees = date ? date.slice(0, 4) + (tv && d.last_air_date && d.status !== "Returning Series" && d.last_air_date.slice(0, 4) !== date.slice(0, 4) ? "–" + d.last_air_date.slice(0, 4) : "") : "";
  const vuDeja = journal.length || t.vu;
  vue.className = "";
  vue.innerHTML = `<div class="fond-film">${d.poster_path ? `<img src="${S.img(d.poster_path, "w342")}" alt="">` : ""}</div>
  <article class="ff">
    <header class="ff-tete">
      <div class="ff-affiche">${S.affiche(m, { taille: "w500", vt })}</div>
      <div class="ff-titres">
        <h1>${esc(S.nomTitre(m))}</h1>
        ${S.autreTitre(m) ? `<div class="ff-vo">${esc(S.autreTitre(m))}</div>` : ""}
        <div class="ff-ligne">${annees ? `<span>${annees}</span>` : ""}${reals.length ? `<span>${tv ? "créée par " : "de "}${reals.map(r => `<a href="#/personne/${r.id}">${esc(r.name)}</a>`).join(", ")}</span>` : ""}</div>
        <div class="ff-tags">${(d.genres || []).map(g => `<a href="#/decouvrir/explorer?genre=${g.id}&type=${tv ? "tv" : "movie"}">${esc(S.GENRES[g.id] || g.name)}</a>`).join("")}${motscles.map(k => `<a class="mc" href="#/motcle/${k.id}">${esc(k.name)}</a>`).join("")}</div>
        <div class="ff-notes">${data.imdb ? `<span>${S.LOGOS.imdb}<b>${S.fmtNote(data.imdb[0])}</b></span>` : ""}${d.vote_count ? `<span>${S.LOGOS.tmdb}<b>${S.fmtNote(d.vote_average)}</b></span>` : ""}${data.letterboxd ? `<span title="Note moyenne Letterboxd, sur 5">${S.iconePlateforme("lb", "Letterboxd", "brut")}<b>${String(Math.round(data.letterboxd * 10) / 10).replace(".", ",")}</b><small>sur 5</small></span>` : ""}</div>
      </div>
    </header>
    ${d.hors_ligne ? `<p class="ff-hors-ligne">Hors ligne : fiche simplifiée, gardée sur l'appareil. Tout revient avec le réseau.</p>` : ""}
    <div class="ff-prix" data-prix></div>
    <section class="ff-cartes">
      <div class="ff-carte ff-note"><div data-anneau></div>
        <div class="ff-etats"><button data-etat-vu class="${vuDeja ? "actif" : ""}">${vuDeja ? "Vu" : "Pas vu"}</button><button data-coeur class="${t.coeur ? "actif" : ""}">Coup de cœur</button></div></div>
      ${duree ? `<div class="ff-carte"><span>Durée</span><b>${duree}</b></div>` : ""}
      ${tv ? `<div class="ff-carte"><span>Épisodes</span><b>${d.number_of_episodes || "–"}</b><small>${S.pluriel(d.number_of_seasons || 0, "saison")}</small></div>` : ""}
      ${d.budget ? `<div class="ff-carte"><span>Budget</span><b>${S.argent(d.budget)}</b>${ratio != null ? `<div class="ff-jauge ${verdict[1]}" title="Box-office ${S.argent(d.revenue)}"><i style="width:${Math.min(100, ratio / 6 * 100)}%"></i><em style="left:${2.5 / 6 * 100}%"></em></div><small>${verdict[0]}, ${S.fmtNote(ratio)} fois le budget</small>` : `<small>Box-office inconnu</small>`}</div>` : ""}
      ${d.revenue ? `<div class="ff-carte"><span>Box-office</span><b>${S.argent(d.revenue)}</b>${sortieFR ? `<small>Sorti en France le ${S.fmtDate(sortieFR)}</small>` : ""}</div>` : ""}
    </section>
    <div class="ff-boutons"><button data-synopsis>Synopsis</button><button data-infos>Infos</button></div>
    <section class="ff-section" data-envoi></section>
    ${tv ? `<section class="ff-section" data-saisons></section>` : ""}
    ${cast.length ? `<section class="ff-section"><h2>Casting</h2><div class="ff-cast">${cast.map(c => `<a href="#/personne/${c.id}"><div class="tete-acteur">${c.profile_path ? `<img loading="lazy" src="${S.img(c.profile_path, "w185")}" alt="">` : `<span>${esc(S.initiales(c.name))}</span>`}</div><b>${esc(c.name)}</b><em>${esc(tv ? (c.roles || []).map(r => r.character).filter(Boolean)[0] || "" : c.character || "")}</em></a>`).join("")}</div></section>` : ""}
    ${Object.keys(equipe).length ? `<section class="ff-section"><h2>Équipe</h2><div class="ff-equipe">${Object.entries(equipe).map(([lib, l]) => `<div><span>${lib}</span>${l.map(p => `<a href="#/personne/${p.id}">${esc(p.nom)}</a>`).join("")}</div>`).join("")}</div></section>` : ""}
    <section class="ff-section"><div class="ff-onglets"><button data-o="toi" class="actif">Toi</button>${amis.length ? `<button data-o="amis">Amis <span>${amis.length}</span></button>` : ""}</div><div data-onglet-toi></div><div data-onglet-amis class="cache"></div></section>
    ${groupes.length ? `<section class="ff-section"><h2>Regarder</h2><div class="ff-dispo">${groupes.map(([k, l]) => `<div><span>${l}</span><p>${fourn[k].map(p => `<a href="${esc(S.lienPlateforme(p.provider_id, titreRecherche, fourn.link || "#"))}" target="_blank" rel="noopener" title="${esc(p.provider_name)}"><img src="${S.img(p.logo_path, "w92")}" alt="${esc(p.provider_name)}"></a>`).join("")}</p></div>`).join("")}</div></section>` : ""}
    ${data.collection?.parts?.length > 1 ? `<section class="ff-section"><h2>${esc(data.collection.name)}</h2><div class="prog-rangee">${data.collection.parts.sort((a, b) => (a.release_date || "9").localeCompare(b.release_date || "9")).map(p => S.vignette(S.retenir(p, "movie"), { vu: S.monTitre("m:" + p.id).vu })).join("")}</div></section>` : ""}
    ${recos.length ? `<section class="ff-section"><h2>Dans le même esprit</h2><div class="prog-rangee">${recos.map(c => S.vignette(c)).join("")}</div></section>` : ""}
  </article>
  <nav class="barre-film">
    <button class="bouton principal" data-vu>${vuDeja ? "Revu" : "J'ai vu"}</button>
    <button class="texte-action ${wl ? "actif" : ""}" data-wl>${wl ? "Dans ta watchlist" : "Watchlist"}</button>
    <button class="texte-action" data-liste>Liste</button>
    ${!tv ? `<button class="texte-action ${t.collection ? "actif" : ""}" data-collection>Collection</button>` : ""}
  </nav>`;
  document.body.classList.add("avec-barre-film");
  if (d.poster_path) S.couleursAffiche(S.img(d.poster_path, "w92")).then(c => {
    if (!c || !location.hash.includes(cle)) return;
    document.body.style.setProperty("--accent-film", S.accentLisible(c[0]).join(","));
  });
  // ta note : l'anneau, toucher pour noter
  const an = S.anneau(t.note, v => { if (v != null) { const b = $("[data-etat-vu]", vue); if (b) { b.classList.add("actif"); b.textContent = "Vu"; } } S.agir("noter", { cle, note: v }, { toast: v == null ? "Note retirée" : `Noté ${S.fmtNote(v)}`, sansRendu: true }); });
  $("[data-anneau]", vue).append(an);
  $("[data-coeur]", vue).onclick = ev => { const b = ev.currentTarget; const nv = !b.classList.contains("actif"); b.classList.toggle("actif", nv); S.agir("coeur", { cle, val: nv }, { toast: nv ? "Coup de cœur" : "Cœur retiré", sansRendu: true }); };
  $("[data-etat-vu]", vue).onclick = () => S.agir("vu", { cle, val: !vuDeja }, { toast: vuDeja ? "Marqué pas vu" : "Marqué vu" });
  $("[data-vu]", vue).onclick = () => S.ouvrirAjout(cle);
  $("[data-wl]", vue).onclick = () => S.agir("watchlist", { cle, val: !wl }, { toast: wl ? "Retiré de ta watchlist" : "Ajouté à ta watchlist" });
  $("[data-liste]", vue).onclick = () => S.choisirListe(cle);
  const col = $("[data-collection]", vue); if (col) col.onclick = () => collection(cle);
  $("[data-synopsis]", vue).onclick = () => S.ouvrirModale({ titre: "Synopsis", corps: `${d.tagline ? `<p class="ff-accroche">${esc(d.tagline)}</p>` : ""}<p class="ff-synopsis">${esc(d.overview || d.overview_en || "Pas de synopsis.")}</p>` });
  $("[data-infos]", vue).onclick = () => S.ouvrirModale({ titre: "Infos", corps: `<dl class="tableau-infos">
    ${date ? `<dt>${tv ? "Première diffusion" : "Sortie"}</dt><dd>${S.fmtDate(date)}</dd>` : ""}${sortieFR && sortieFR !== date ? `<dt>En France</dt><dd>${S.fmtDate(sortieFR)}</dd>` : ""}
    ${tv && d.status ? `<dt>Statut</dt><dd>${esc({ "Returning Series": "En cours", Ended: "Terminée", Canceled: "Annulée", "In Production": "En production" }[d.status] || d.status)}</dd>` : ""}
    ${pays.length ? `<dt>Pays</dt><dd>${pays.map(p => esc(S.pays(p))).join(", ")}</dd>` : ""}
    ${d.budget ? `<dt>Budget</dt><dd>${S.argent(d.budget)}</dd>` : ""}${d.revenue ? `<dt>Box-office</dt><dd>${S.argent(d.revenue)}</dd>` : ""}
    ${(d.production_companies || []).length ? `<dt>Production</dt><dd>${d.production_companies.slice(0, 6).map(c => esc(c.name)).join(", ")}</dd>` : ""}
    ${tv && (d.networks || []).length ? `<dt>Chaîne</dt><dd>${d.networks.map(n => esc(n.name)).join(", ")}</dd>` : ""}
  </dl>` });
  const toi = $("[data-onglet-toi]", vue), am = $("[data-onglet-amis]", vue);
  monJournal(toi, cle, t, journal);
  am.innerHTML = amis.map(([pid, a]) => `<div class="ami-ligne"><b>${esc(a.nom)}</b>${a.note != null ? `<span class="n">${S.fmtNote(a.note)}</span>` : "<span></span>"}<small>${a.vu ? (a.coeur ? "coup de cœur" : "l'a vu") : a.watchlist ? "veut le voir" : ""}</small>${a.critiques.map(c => `<p>${esc(c.texte)}</p>`).join("")}</div>`).join("");
  $$("[data-o]", vue).forEach(b => b.onclick = () => { $$("[data-o]", vue).forEach(x => x.classList.toggle("actif", x === b)); toi.classList.toggle("cache", b.dataset.o !== "toi"); am.classList.toggle("cache", b.dataset.o !== "amis"); });
  if (tv) saisons($("[data-saisons]", vue), cle, d);
  envoiTitre($("[data-envoi]", vue), cle);
  const pz = $("[data-prix]", vue);
  const peindrePrix = r => {
    if (!r || (!r.gagnes.length && !r.nominations.length)) return;
    pz.innerHTML = `${r.gagnes.map(p => `<span>${esc(p.prix)}${p.annee ? ` <em>${p.annee}</em>` : ""}</span>`).join("")}${r.nominations.length ? `<button class="nomination" data-nom>et ${S.pluriel(r.nominations.length, "nomination")}</button><div class="nominations cache">${r.nominations.map(p => `<div>${esc(p.prix)}${p.annee ? `, ${p.annee}` : ""}</div>`).join("")}</div>` : ""}`;
    const b = $("[data-nom]", pz); if (b) b.onclick = () => { $(".nominations", pz).classList.toggle("cache"); b.remove(); };
  };
  if (S.memo["prix:" + cle]) peindrePrix(S.memo["prix:" + cle]);
  else S.api("/api/prix/titre/" + cle).then(r => { S.memo["prix:" + cle] = r; if (location.hash.includes(cle)) peindrePrix(r); }).catch(() => {});
}

// sur la page d'un film : ce qui est parti sur chaque plateforme, en détail
async function envoiTitre(z, cle) {
  let d; try { d = await S.api("/api/envoi/" + encodeURIComponent(cle)); } catch { return; }
  const ordre = ["lb", "imdb", "rf", "tmdb"].filter(p => d[p] && (d[p].lignes.length || d[p].reliee));
  if (!ordre.some(p => d[p].lignes.length)) return;
  const LIB = { ok: "envoyé", attente: "en attente", clic: "attend ton clic dans l'extension", erreur: "erreur", off: "non relié" };
  const resume = x => !x.reliee ? "off" : x.lignes.some(l => l.e === "erreur") ? "erreur" : x.lignes.some(l => l.e === "clic") ? "clic" : x.lignes.some(l => l.e === "attente") ? "attente" : x.lignes.length ? "ok" : "na";
  const quand = t => t ? new Date(t * 1000).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";
  z.innerHTML = `<div class="ff-envoi-tete"><h2>Sur tes plateformes</h2><button class="lien" data-sync-film>Synchroniser</button></div>
    <div class="ff-envoi">${ordre.map(p => { const x = d[p], r = resume(x); return `<details class="ff-pf" ${r === "erreur" ? "open" : ""}>
      <summary>${S.iconePlateforme(p, x.nom, r === "na" ? "na" : r)}<b class="ff-pf-nom">${esc(x.nom)}</b><em>${r === "na" ? "rien à envoyer" : LIB[r]}</em></summary>
      <ul>${x.lignes.map(l => `<li><span class="pl pl-${l.e}"></span><span>${esc(l.libelle)}${l.m ? `<small>${esc(l.m)}</small>` : ""}</span><em>${LIB[l.e] || ""}</em></li>`).join("") || `<li><span>Rien à envoyer pour ce titre.</span></li>`}</ul>
      <p>${x.passage ? `Dernier passage : ${quand(x.passage.quand)}` : ""}${p === "imdb" && x.mode !== "auto" ? `${x.passage ? ", " : ""}envoi d'un clic depuis l'extension` : ""}${r === "erreur" ? ` <button class="lien" data-reessayer-pf="${p}">Réessayer</button>` : ""}</p></details>`; }).join("")}</div>`;
  $("[data-sync-film]", z).onclick = async () => { await S.synchroniser(); setTimeout(() => envoiTitre(z, cle), 6000); };
  $$("[data-reessayer-pf]", z).forEach(b => b.onclick = async () => { await S.post("/api/plateformes/reessayer", { plateforme: b.dataset.reessayerPf }); await S.synchroniser(); setTimeout(() => envoiTitre(z, cle), 6000); });
}

function monJournal(z, cle, t, journal) {
  const cit = t.citations || [], et = t.etiquettes || [], det = Object.entries(t.detail || {}).filter(([, v]) => v);
  const LIB = { scenario: "Scénario", realisation: "Mise en scène", jeu: "Jeu", image: "Image", musique: "Musique", son: "Son" };
  const ou = j => j.ou?.type === "cinema" ? `au ${esc(j.ou.cinema || "cinéma")}${j.ou.salle ? `, salle ${esc(j.ou.salle)}` : ""}` : j.ou?.nom ? `sur ${esc(j.ou.nom)}` : "";
  z.innerHTML = `${journal.length ? journal.map(j => `<button class="toi-vis" data-j="${j.id}"><span class="toi-date">${esc(S.fmtDateP(j.date))}</span><span class="toi-det">${[j.revision ? "revu" : "", ou(j), j.version, (j.avec || []).length ? "avec " + esc(j.avec.map(a => S.amis[a]?.profil?.nom || a).join(", ")) : ""].filter(Boolean).join(", ")}${!j.ou || j.approx ? `<em class="toi-completer">${j.approx ? "date approximative, " : ""}ajouter le lieu, la version…</em>` : ""}</span>${j.note != null ? `<span class="toi-note">${S.fmtNote(j.note)}</span>` : ""}<span class="toi-modifier">Modifier</span>${j.critique ? `<span class="toi-critique">${esc(j.critique)}</span>` : ""}</button>`).join("")
      : t.vu ? `<button class="toi-vis" data-sans-date><span class="toi-date">Vu</span><span class="toi-det">sans date dans ton journal<em class="toi-completer">ajouter la date, le cinéma, la version…</em></span><span class="toi-modifier">Compléter</span></button>` : `<p class="toi-vide">Pas encore dans ton journal.</p>`}
    ${det.length ? `<dl class="prog-equipe" style="margin-top:14px">${det.map(([k, v]) => `<dt>${LIB[k] || k}</dt><dd>${v} sur 10</dd>`).join("")}</dl>` : ""}
    ${cit.map((c, i) => `<blockquote class="toi-citation">${esc(c)}<button data-cit-suppr="${i}">retirer</button></blockquote>`).join("")}
    ${et.length ? `<p class="toi-etiquettes">${et.map(e => `<span>${esc(e)} <button data-et-suppr="${esc(e)}" aria-label="Retirer">×</button></span>`).join(", ")}</p>` : ""}
    <div class="toi-actions"><button data-cit>Ajouter une réplique</button><button data-et>Ajouter une étiquette</button><button data-prive>${t.prive ? "Montrer ce film à tes amis" : "Cacher ce film à tes amis"}</button>${t.vu || journal.length || t.note != null ? `<button data-suppr-titre>Retirer ce film de ton profil</button>` : ""}</div>`;
  $$("[data-j]", z).forEach(l => l.onclick = () => S.ouvrirAjout(cle, journal.find(j => j.id === l.dataset.j)));
  const sd = $("[data-sans-date]", z); if (sd) sd.onclick = () => S.ouvrirAjout(cle, null, { sansDate: true });
  $$("[data-cit-suppr]", z).forEach(b => b.onclick = () => S.agir("titre", { cle, champs: { citations: cit.filter((_, i) => i !== +b.dataset.citSuppr) } }, { toast: "Réplique retirée" }));
  $$("[data-et-suppr]", z).forEach(b => b.onclick = () => S.agir("titre", { cle, champs: { etiquettes: et.filter(e => e !== b.dataset.etSuppr) } }, { toast: "Étiquette retirée" }));
  $("[data-cit]", z).onclick = () => {
    const c = el(`<div><textarea class="champ" placeholder="No hay banda…"></textarea></div>`);
    S.ouvrirModale({ titre: "Ta réplique", corps: c, pied: `<button class="bouton principal" data-ok>Ajouter</button>` });
    $("textarea", c).focus();
    $("[data-ok]", c.closest(".modale")).onclick = async () => { const v = $("textarea", c).value.trim(); if (!v) return; await S.agir("titre", { cle, champs: { citations: [...cit, v] } }, { toast: "Réplique ajoutée", sansRendu: true }); S.fermerModale(); S.rafraichir(true); };
  };
  $("[data-et]", z).onclick = () => {
    const toutes = [...new Set(Object.values(S.vivants(S.moi.titres)).flatMap(x => x.etiquettes || []))].filter(e => !et.includes(e));
    const c = el(`<div><input class="champ" placeholder="Nouvelle étiquette" list="etq"><datalist id="etq">${toutes.map(e => `<option value="${esc(e)}">`).join("")}</datalist><p class="toi-etiquettes">${toutes.slice(0, 30).map(e => `<button data-v="${esc(e)}">${esc(e)}</button>`).join(", ")}</p></div>`);
    S.ouvrirModale({ titre: "Étiquette", corps: c, pied: `<button class="bouton principal" data-ok>Ajouter</button>` });
    const ajouter = async v => { v = v.trim(); if (!v) return; await S.agir("titre", { cle, champs: { etiquettes: [...et, v] } }, { toast: "Étiquette ajoutée", sansRendu: true }); S.fermerModale(); S.rafraichir(true); };
    $$("[data-v]", c).forEach(b => b.onclick = () => ajouter(b.dataset.v));
    $("[data-ok]", c.closest(".modale")).onclick = () => ajouter($("input", c).value);
    $("input", c).onkeydown = e => { if (e.key === "Enter") ajouter(e.target.value); };
  };
  const st = $("[data-suppr-titre]", z);
  if (st) st.onclick = async () => {
    if (!(await S.demander("Retirer ce film de ton profil ?", "Ses visionnages, ta note et ton coup de cœur sont retirés, ici et sur tes plateformes (Letterboxd, IMDb, Refract, TMDB).", "Retirer", "Annuler"))) return;
    await S.agir("suppr_titre", { cle }, { toast: "Film retiré de ton profil" }); S.rafraichir(true);
  };
  $("[data-prive]", z).onclick = () => S.agir("titre", { cle, champs: { prive: !t.prive } }, { toast: t.prive ? "Film visible par tes amis" : "Film caché à tes amis" });
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
  z.innerHTML = `<div class="section-titre"><h2>Saisons<span class="compte">${liste.filter(x => x.season_number).length}</span></h2><span class="mini discret">${nbVus}/${total} épisodes vus${p ? `, prochain : S${p.s} É${p.e}${p.futur && p.date ? " le " + S.fmtDate(p.date, true) : ""}` : ""}</span></div>
    ${liste.map(x => { const n = x.season_number; const v = Array.from({ length: x.episode_count }, (_, i) => `${n}x${i + 1}`).filter(e => vus.has(e)).length; const note = (s.saisons || {})[n]; return `<div class="saison" data-s="${n}"><div class="tete">${S.affiche({ af: x.poster_path, t: x.name }, { taille: "w92" }).replace('class="affiche"', 'class="affiche" style="width:42px"')}<div class="espace"><b style="font-weight:550">${esc(x.name || "Saison " + n)}</b><div class="mini discret">${v}/${x.episode_count} épisodes${x.air_date ? ", " + x.air_date.slice(0, 4) : ""}${note ? `, ta note ${S.fmtNote(note)}` : ""}</div><div class="barre"><i style="width:${100 * v / x.episode_count}%"></i></div></div><button class="coche ${v === x.episode_count ? "ok" : ""}" data-tout="${n}" data-nb="${x.episode_count}" title="Toute la saison"></button></div><div class="episodes cache"></div></div>`; }).join("")}
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
        eps.innerHTML = `<div class="flex" style="padding:10px 12px;border-bottom:1px solid var(--ligne)"><span class="petit muet">Ta note de la saison</span><span data-note-s></span></div>` + (sa.episodes || []).map(e => `<div class="episode"><span class="num">É${e.episode_number}</span><span class="espace"><span style="${e.air_date > auj ? "color:var(--texte-3)" : ""}">${esc(e.name || "")}</span><br><span class="mini discret">${e.air_date ? S.fmtDate(e.air_date, true) : ""}${e.runtime ? ", " + e.runtime + " min" : ""}${e.vote_count ? ", TMDB " + S.fmtNote(e.vote_average) : ""}</span></span><button class="coche ${vus.has(`${n}x${e.episode_number}`) ? "ok" : ""}" data-ep="${n}x${e.episode_number}"></button></div>`).join("");
        $("[data-note-s]", eps).append(S.rangee((s.saisons || {})[n], v => S.agir("note_saison", { cle, saison: n, note: v }, { toast: `Saison ${n} : ${v == null ? "note retirée" : S.fmtNote(v)}`, sansRendu: true }), { petites: true }));
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
  const notesP = mesNotes.map(x => S.monTitre(x.cle).note);
  const moyP = notesP.length ? Math.round(moyenne(notesP) * 10) / 10 : null;
  const ligneCompte = (lib, c) => c.n ? `<dt>${lib}</dt><dd><b>${c.v}</b> sur ${c.n}</dd>` : "";
  vue.innerHTML = `
    <div class="pers-page">
    <header class="pers-tete">
      <div class="pers-photo">${S.portrait(d.profile_path, d.name)}</div>
      <div style="min-width:0"><h1>${esc(d.name)}</h1>
        <div class="pers-sous">${[DEPT[d.known_for_department] || d.known_for_department || "", d.birthday ? (d.deathday ? d.birthday.slice(0, 4) + "–" + d.deathday.slice(0, 4) : age(d.birthday)) : ""].filter(Boolean).join(", ")}</div></div>
    </header>
    <section class="panneau pers-panneau">
      <div class="pan-etats deux"><button data-fav class="${fav ? "actif" : ""}" style="--c:#f0505f">Favori</button><div class="pan-moy"><span>Ta moyenne</span><b>${moyP == null ? "–" : S.fmtNote(moyP)}</b></div></div>
      ${totN ? `<dl class="pers-compte"><dt>Vus</dt><dd><b>${vusN}</b> sur ${totN}</dd>${ligneCompte("Longs métrages", cLong)}${ligneCompte("Courts métrages", cCourt)}${ligneCompte("Documentaires", cDocu)}${ligneCompte("Séries", cSerie)}</dl>` : ""}
    </section>
    ${d.biography ? `<p class="prog-synopsis" data-bio>${esc(d.biography)}</p>` : ""}
    <div class="onglets onglets-film" style="margin-top:26px">${[["filmo", "Filmographie"], ["classement", "Classement"], ["courbe", "Courbe"], ["prix", "Prix"], ["collab", "Collaborateurs"]].map(([k, l]) => `<button data-op="${k}" class="${ongletP === k ? "actif" : ""}">${l}</button>`).join("")}</div>
    <div data-panneau="filmo"><div class="onglets">${depts.map(dp => `<button data-dept="${esc(dp)}" class="${dp === st.dept ? "actif" : ""}">${esc(DEPT[dp] || dp)}</button>`).join("")}</div>
      <div class="filtres"><div class="segments" data-vu><button data-v="tous">Tous</button><button data-v="vus">Vus</button><button data-v="pasvus">Pas vus</button></div></div>
      <div class="grille" data-filmo></div></div>
    <div data-panneau="classement">${ordre.length ? `<div class="lignes classement" data-classement>${ordre.map((c, i) => `<div class="ligne" data-cle="${c}"><span class="rang">${i + 1}</span>${S.affiche(S.info(c) || {}, { taille: "w92" })}<a class="corps" href="#/titre/${c}"><b>${esc(S.nomTitre(S.info(c)))}</b><span>${S.info(c)?.a || ""}</span></a><span class="note-txt">${S.fmtNote(S.monTitre(c).note)}</span><span class="poignee" aria-label="Déplacer"></span></div>`).join("")}</div>` : S.vide("Aucun titre vu")}</div>
    <div data-panneau="courbe">${mesNotes.length > 1 ? `<div data-courbe></div><a class="lien-souligne" data-labo href="#/labo">Comparer dans le labo</a>` : S.vide("Note au moins deux titres")}</div>
    <div data-panneau="prix"><div data-prix>${S.chargement()}</div></div>
    <div data-panneau="collab"><div data-collab></div></div>
    </div>`;
  const montrerP = k => { S.filtresMemo["pers_o_" + pid] = k; $$("[data-op]", vue).forEach(b => b.classList.toggle("actif", b.dataset.op === k)); $$("[data-panneau]", vue).forEach(x => x.classList.toggle("cache", x.dataset.panneau !== k)); if (k === "courbe") dessinerCourbe(); };
  $$("[data-op]", vue).forEach(b => b.onclick = () => montrerP(b.dataset.op));
  const bio = $("[data-bio]", vue); if (bio) bio.onclick = () => bio.classList.toggle("ouvert");
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
    $("[data-filmo]", vue).innerHTML = l.map(f => S.vignette(f.cle, { vu: vus.has(f.cle), info: f.date ? f.date.slice(0, 4) : "à venir" })).join("") || S.vide("Rien ici");
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
    pz.innerHTML = `<div class="lignes">${l.map(p => `<div class="ligne prix-ligne"><span class="annee-prix">${p.annee || ""}</span><div class="corps"><b style="white-space:normal">${esc(p.prix)}</b>${p.oeuvre ? `<span>${p.cle ? `<a href="#/titre/${p.cle}">${esc(p.oeuvre)}</a>` : esc(p.oeuvre)}</span>` : ""}</div></div>`).join("")}</div>`;
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
  if (tops.length) { $("[data-collab]", vue).innerHTML = `<div class="classement-p">${tops.map(e => { const p = S.base.pers[e.id] || {}; const notes = [...e.films].map(c => S.monTitre(c).note).filter(n => n != null); return `<a href="#/personne/${e.id}"><span class="n"></span>${S.portrait(p.ph, p.n)}<span><b style="font-weight:550">${esc(p.n || "")}</b><br><span class="mini discret">${[...e.roles].map(r => S.METIERS[r]).join(", ")}, ${e.films.size} titres ensemble</span></span><span class="valeurs"><span class="note-txt">${S.fmtNote(moyenne(notes))}</span><small>ta moyenne</small></span></a>`; }).join("")}</div>`; }
};
})();
