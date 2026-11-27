/* Silencio — pages : profil, journal, listes, watchlist, amis, découvrir, palmarès, mots-clés, notifications, réglages. */
(function () {
"use strict";
const S = window.Silencio, P = S.pages, G = S.graph, St = S.stats;
const { $, $$, esc, ico, el } = S;
const moyenne = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
const estMoi = pid => !pid || pid === S.etat.appareil.profil;

// ------------------------------------------------------------------ profil
P.profil = async (vue, args, params) => {
  const pid = args[0] && !estMoi(args[0]) ? args[0] : "";
  const doc = S.docDe(pid);
  if (!doc) { vue.innerHTML = S.vide("Profil inconnu"); return; }
  if (!S.base) S.chargerBase().then(() => S.rafraichir(true)).catch(() => {});
  const onglet = params.o || "films";
  const nom = doc.profil?.nom || pid;
  const d = St.donnees(pid || undefined);
  const T = d.T, V = d.V;
  const heures = Math.round(T.reduce((s, t) => s + (t.m?.r || 0) * (t.part ?? 1), 0) / 60);
  const ban = doc.profil?.banniere;
  const compat = pid ? St.compat("", pid) : null;
  const base = `#/profil${pid ? "/" + encodeURIComponent(pid) : ""}`;
  const ONGLETS = [["films", "Films"], ["journal", "Journal"], ["watchlist", "Watchlist"], ["listes", "Listes"], ["critiques", "Critiques"], ["citations", "Citations"], ["collection", "Collection"], ["seances", "Séances"]];
  vue.innerHTML = `
    <div class="banniere">${ban?.image ? `<img src="${S.img(ban.image, "w1280")}" alt="">` : ""}</div>
    <div class="profil-tete">${S.avatar(pid || S.etat.appareil.profil, nom)}<div class="espace" style="min-width:0"><h1>${esc(nom)}</h1>${doc.profil?.bio ? `<div class="muet petit">${esc(doc.profil.bio)}</div>` : ""}${compat?.n ? `<div class="petit" style="color:var(--accent)">${compat.accord} % d'accord avec toi</div>` : ""}</div>
      ${pid ? "" : `<nav class="liens-tete"><button data-editer>Modifier</button><a href="#/reglages" class="tel">Réglages</a></nav>`}</div>
    <div class="chiffres-ligne"><span><b>${S.fmtNombre(T.filter(t => t.m?.ty !== "t").length)}</b> films</span><span><b>${S.fmtNombre(T.filter(t => t.m?.ty === "t").length)}</b> séries</span><span><b>${S.fmtNombre(heures)}</b> h</span><span><b>${S.fmtNote(moyenne(T.map(t => t.note).filter(n => n != null)))}</b> moy.</span></div>
    ${pid ? "" : `<a class="bouton principal bouton-wrapped" href="#/wrapped/${S.aujourdhui().slice(0, 4)}">Ton année ${S.aujourdhui().slice(0, 4)}</a>`}
    <div class="onglets">${ONGLETS.map(([k, l]) => `<a href="${base}?o=${k}"><button class="${onglet === k ? "actif" : ""}">${l}</button></a>`).join("")}</div>
    <div data-contenu></div>`;
  const z = $("[data-contenu]", vue);
  const ed = $("[data-editer]", vue); if (ed) ed.onclick = editerProfil;
  ({ films: () => ongletFilms(z, pid, T), journal: () => rendreJournal(z, doc, pid), watchlist: () => grilleCles(z, Object.entries(S.vivants(doc.watchlist)).sort((a, b) => (b[1].ajout || "").localeCompare(a[1].ajout || "")).map(([c]) => c), "Watchlist vide"),
    listes: () => cartesListes(z, doc, pid), critiques: () => critiques(z, V), citations: () => citations(z, doc),
    personnes: () => { const f = Object.entries(S.vivants(doc.favoris)); z.innerHTML = f.length ? `<div class="grille">${f.map(([id, p]) => `<a class="personne-v" style="width:auto" href="#/personne/${id}">${S.portrait(p.photo, p.nom)}${esc(p.nom)}<span>${esc(S.METIERS[p.metier] || "")}</span></a>`).join("")}</div>` : S.vide("Aucune personne favorite", "Le cœur sur la page d'un réalisateur, d'un acteur, d'un chef op…"); },
    collection: () => { const c = Object.entries(S.vivants(doc.titres)).filter(([, t]) => t.collection); const fmts = [...new Set(c.map(([, t]) => t.collection.format))]; z.innerHTML = c.length ? `<div class="puces" style="margin-bottom:12px">${fmts.map(f => `<span class="puce">${esc(f)}, ${c.filter(([, t]) => t.collection.format === f).length}</span>`).join("")}</div><div class="grille">${c.map(([k, t]) => S.vignette(k, { sous: [t.collection.format, t.collection.edition].filter(Boolean).join(", ") })).join("")}</div>` : S.vide("Ta collection est vide", "Bouton « Collection » sur la page d'un film (Blu-ray, DVD, 4K…)."); },
    seances: () => seances(z, V), annees: () => annees(z, V),
  }[onglet] || (() => {}))();
};

function editerProfil() {
  const p = S.moi.profil;
  const corps = el(`<div><label class="etiquette" style="margin-top:0">Nom</label><input class="champ" data-nom value="${esc(p.nom)}"><label class="etiquette">Une phrase sur toi</label><input class="champ" data-bio value="${esc(p.bio || "")}" placeholder="« Ceci n'est pas une pipe. »"><label class="etiquette">Bannière</label><div class="mini discret" style="margin-bottom:8px">Une image tirée d'un des films que tu as vus</div><div class="grille" data-bans style="grid-template-columns:repeat(auto-fill,minmax(150px,1fr))"></div></div>`);
  S.ouvrirModale({ titre: "Ton profil", corps, large: true, pied: `<button class="bouton principal" data-ok>Enregistrer</button>` });
  let ban = p.banniere;
  const films = Object.entries(S.vivants(S.moi.titres)).filter(([c, t]) => (t.note ?? 0) >= 7 || t.coeur).map(([c]) => c).filter(c => S.info(c)?.fd).sort((a, b) => (S.monTitre(b).note || 0) - (S.monTitre(a).note || 0)).slice(0, 60);
  $("[data-bans]", corps).innerHTML = films.map(c => `<button data-c="${c}" style="border-radius:8px;overflow:hidden;aspect-ratio:16/9;outline:${ban?.cle === c ? "2px solid var(--accent)" : "none"}"><img src="${S.img(S.info(c).fd, "w300")}" alt="${esc(S.nomTitre(S.info(c)))}" loading="lazy" style="width:100%;height:100%;object-fit:cover"></button>`).join("") || `<div class="mini discret">Note quelques films 7 ou plus pour choisir une bannière.</div>`;
  $$("[data-c]", corps).forEach(b => b.onclick = () => { ban = { cle: b.dataset.c, image: S.info(b.dataset.c).fd }; $$("[data-c]", corps).forEach(x => x.style.outline = x === b ? "2px solid var(--accent)" : "none"); });
  $("[data-ok]", corps.closest(".modale")).onclick = async () => { await S.agir("profil", { champs: { nom: $("[data-nom]", corps).value.trim() || p.nom, bio: $("[data-bio]", corps).value.trim(), banniere: ban } }, { toast: "Profil enregistré", sansRendu: true }); S.fermerModale(); S.rafraichir(true); };
}

// onglet Films : filtres combinés, grille / liste / tableau
function ongletFilms(z, pid, T) {
  const f = S.filtresMemo["films_" + pid] = S.filtresMemo["films_" + pid] || { q: "", genre: "", decennie: "", pays: "", note: "", format: "", type: "", etiquette: "", coeur: false, tri: "vu", vue: "grille", sens: -1 };
  const genres = [...new Set(T.flatMap(t => t.m?.g || []))].sort((a, b) => (S.GENRES[a] || "").localeCompare(S.GENRES[b] || ""));
  const decs = [...new Set(T.map(t => t.m?.a ? Math.floor(t.m.a / 10) * 10 : null).filter(Boolean))].sort().reverse();
  const pays = [...new Set(T.flatMap(t => t.m?.p || []))].map(p => [p, S.pays(p)]).sort((a, b) => a[1].localeCompare(b[1]));
  const etqs = [...new Set(T.flatMap(t => t.etiquettes || []))].sort();
  z.innerHTML = `<div class="filtres">
      <input class="champ recherche-l" data-f="q" placeholder="Titre, personne…" value="${esc(f.q)}">
      <button class="puce ${f.plus ? "actif" : ""}" data-filtres-plus>Filtres</button>
      <div class="filtres-plus ${f.plus ? "" : "cache"}" style="display:contents">
      <select class="champ" data-f="type"><option value="">Films et séries</option><option value="m">Films</option><option value="t">Séries</option></select>
      <select class="champ" data-f="format"><option value="">Formats</option>${Object.entries(S.FORMATS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select>
      <select class="champ" data-f="genre"><option value="">Genres</option>${genres.map(g => `<option value="${g}">${esc(S.GENRES[g] || g)}</option>`).join("")}</select>
      <select class="champ" data-f="decennie"><option value="">Décennies</option>${decs.map(d => `<option value="${d}">années ${String(d).slice(2)}</option>`).join("")}</select>
      <select class="champ" data-f="pays"><option value="">Pays</option>${pays.map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join("")}</select>
      <select class="champ" data-f="note"><option value="">Notes</option><option value="9">9 et plus</option><option value="8">8 et plus</option><option value="7">7 et plus</option><option value="-5">5 et moins</option><option value="sans">Sans note</option></select>
      ${etqs.length ? `<select class="champ" data-f="etiquette"><option value="">Étiquettes</option>${etqs.map(e => `<option>${esc(e)}</option>`).join("")}</select>` : ""}
      <button class="puce ${f.coeur ? "actif" : ""}" data-coeur>Coups de cœur</button>
      </div>
      <span class="espace"></span>
      <select class="champ" data-f="tri"><option value="vu">Vu récemment</option><option value="note">Ta note</option><option value="annee">Année</option><option value="titre">Titre</option><option value="imdb">IMDb</option><option value="ecart">Écart avec IMDb</option><option value="duree">Durée</option></select>
      <div class="segments" data-vue><button data-v="grille">Grille</button><button data-v="liste">Liste</button><button data-v="tableau">Tableau</button></div>
    </div><div class="mini discret" data-compte style="margin-bottom:10px"></div><div data-res></div>`;
  $$("[data-f]", z).forEach(c => { c.value = f[c.dataset.f] ?? ""; c.oninput = c.onchange = () => { f[c.dataset.f] = c.value; peindre(); }; });
  $("[data-filtres-plus]", z).onclick = e => { f.plus = !f.plus; e.currentTarget.classList.toggle("actif", f.plus); $(".filtres-plus", z).classList.toggle("cache", !f.plus); };
  $("[data-coeur]", z).onclick = e => { f.coeur = !f.coeur; e.currentTarget.classList.toggle("actif", f.coeur); peindre(); };
  $$("[data-vue] button", z).forEach(b => b.onclick = () => { f.vue = b.dataset.v; peindre(); });
  const norm = s => (s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const peindre = () => {
    $$("[data-vue] button", z).forEach(b => b.classList.toggle("actif", b.dataset.v === f.vue));
    const q = norm(f.q);
    let l = T.filter(t => {
      const m = t.m || {};
      if (f.type && m.ty !== f.type) return false;
      if (f.format && m.fmt !== f.format) return false;
      if (f.genre && !(m.g || []).includes(+f.genre)) return false;
      if (f.decennie && Math.floor((m.a || 0) / 10) * 10 !== +f.decennie) return false;
      if (f.pays && !(m.p || []).includes(f.pays)) return false;
      if (f.note === "sans" ? t.note != null : f.note && (+f.note > 0 ? (t.note ?? -1) < +f.note : (t.note ?? 99) > -f.note)) return false;
      if (f.etiquette && !(t.etiquettes || []).includes(f.etiquette)) return false;
      if (f.coeur && !t.coeur) return false;
      if (q) { const noms = [m.t, m.o, ...[...(m.re || []), ...(m.ca || []).slice(0, 6), ...Object.values(m.eq || {}).flat()].map(id => S.base?.pers?.[id]?.n)]; if (!noms.some(n => norm(n).includes(q))) return false; }
      return true;
    });
    const cle = { vu: t => t.dates[t.dates.length - 1] || "", note: t => t.note ?? -1, annee: t => t.m?.a || 0, titre: t => norm(S.nomTitre(t.m)), imdb: t => t.m?.ir || 0, ecart: t => t.note != null && t.m?.ir ? t.note - t.m.ir : -99, duree: t => t.m?.r || 0 }[f.tri] || (t => 0);
    const sens = f.tri === "titre" ? 1 : -1;
    l.sort((a, b) => { const x = cle(a), y = cle(b); return (x > y ? 1 : x < y ? -1 : 0) * sens; });
    $("[data-compte]", z).textContent = `${S.pluriel(l.length, "titre")}${l.length !== T.length ? ` sur ${T.length}` : ""}`;
    const r = $("[data-res]", z);
    const max = S.filtresMemo["films_max_" + pid] || 240;
    const plus = l.length > max ? `<div class="centre" style="margin:16px"><button class="bouton" data-plus>Afficher plus (${l.length - max})</button></div>` : "";
    if (f.vue === "grille") r.innerHTML = `<div class="grille">${l.slice(0, max).map(t => S.vignette(t.cle, { note: t.note, coeur: t.coeur, sous: t.m?.a || "" })).join("")}</div>` + plus;
    else if (f.vue === "liste") { r.innerHTML = `<div class="lignes">${l.slice(0, max).map(t => S.ligneTitre(t.cle, { glisse: estMoi(pid), droite: `<span class="note-txt ${t.coeur ? "cc" : ""}">${S.fmtNote(t.note)}</span>` })).join("")}</div>` + plus; S.activerGlisse(r); }
    else {
      const cols = [["titre", "Titre"], ["annee", "Année", 1], ["note", "Note", 1], ["imdb", "IMDb", 1], ["ecart", "Écart", 1], ["duree", "Durée", 1], ["", "Réalisation"], ["vu", "Vu le", 1]];
      r.innerHTML = `<div class="defile-x"><table class="tableau"><thead><tr>${cols.map(([k, lb, n]) => `<th class="${n ? "num" : ""} ${k === f.tri ? "tri" : ""}" data-tri="${k}">${lb}</th>`).join("")}</tr></thead><tbody>${l.slice(0, max).map(t => { const m = t.m || {}; const ec = t.note != null && m.ir ? t.note - m.ir : null; return `<tr><td><a href="#/titre/${t.cle}">${esc(S.nomTitre(m))}</a></td><td class="num">${m.a || ""}</td><td class="num note-txt ${t.coeur ? "cc" : ""}">${S.fmtNote(t.note)}</td><td class="num">${m.ir ? S.fmtNote(m.ir) : "–"}</td><td class="num" style="color:${ec == null ? "" : ec >= 0 ? "var(--vert)" : "var(--c8)"}">${ec == null ? "–" : (ec > 0 ? "+" : "") + S.fmtNote(ec)}</td><td class="num">${m.ty === "m" ? S.duree(m.r) : ""}</td><td>${(m.re || []).slice(0, 2).map(id => `<a href="#/personne/${id}">${esc(S.base?.pers?.[id]?.n || "")}</a>`).join(", ")}</td><td class="num nowrap">${t.dates.length ? S.fmtDate(t.dates[t.dates.length - 1], true) : ""}</td></tr>`; }).join("")}</tbody></table></div>` + plus;
      $$("[data-tri]", r).forEach(th => th.onclick = () => { if (th.dataset.tri) { f.tri = th.dataset.tri; $("[data-f=tri]", z).value = f.tri; peindre(); } });
    }
    const bp = $("[data-plus]", r); if (bp) bp.onclick = () => { S.filtresMemo["films_max_" + pid] = max + 480; peindre(); };
  };
  if (!S.base) { $("[data-res]", z).innerHTML = S.chargement(); return; }
  peindre();
}

function grilleCles(z, cles, vide) { z.innerHTML = cles.length ? `<div class="grille">${cles.map(c => S.vignette(c)).join("")}</div>` : S.vide(vide); }

function critiques(z, V) {
  const l = V.filter(v => v.critique).reverse();
  z.innerHTML = l.length ? l.map(v => `<div class="critique"><a class="flex" href="#/titre/${v.cle}">${S.affiche(S.info(v.cle) || {}, { taille: "w92" }).replace('class="affiche"', 'class="affiche" style="width:36px"')}<span class="espace"><b style="font-weight:550">${esc(S.nomTitre(S.info(v.cle)))}</b><br><span class="mini discret">${S.fmtDate(v.date)}</span></span>${v.note != null ? `<span class="note-txt">${S.fmtNote(v.note)}</span>` : ""}</a><p>${esc(v.critique)}</p></div>`).join("") : S.vide("Aucune critique");
}
function citations(z, doc) {
  const l = Object.entries(S.vivants(doc.titres)).flatMap(([c, t]) => (t.citations || []).map(x => [c, x]));
  z.innerHTML = l.length ? l.map(([c, x]) => `<div class="citation">${esc(x)}<div class="mini" style="font-family:var(--sans);font-style:normal;margin-top:6px"><a href="#/titre/${c}" style="color:var(--texte-2)">— ${esc(S.nomTitre(S.info(c)))}</a></div></div>`).join("") : S.vide("Aucune citation", "Ajoute tes répliques préférées depuis la page d'un film.");
}
function seances(z, V) {
  const l = V.filter(v => v.ou?.type === "cinema").reverse();
  z.innerHTML = l.length ? `<div class="defile-x"><table class="tableau"><thead><tr><th>Date</th><th>Film</th><th>Cinéma</th><th>Salle</th><th class="num">Prix</th><th>Avec</th></tr></thead><tbody>${l.map(v => `<tr><td class="nowrap">${S.fmtDate(v.date, true)}</td><td><a href="#/titre/${v.cle}">${esc(S.nomTitre(v.m || S.info(v.cle)))}</a></td><td>${esc(v.ou.cinema || "")}</td><td>${esc(v.ou.salle || "")}</td><td class="num">${v.prix != null ? S.fmtNote(v.prix) + " €" : ""}</td><td>${esc((v.avec || []).map(a => S.amis[a]?.profil?.nom || a).join(", "))}</td></tr>`).join("")}</tbody></table></div><p class="mini discret">${l.length} séances, ${S.fmtNote(l.reduce((s, v) => s + (v.prix || 0), 0))} € au total</p>` : S.vide("Aucune séance", "Choisis « Cinéma » dans les détails d'un visionnage.");
}
function annees(z, V) {
  const parAn = d3.rollup(V, l => l.length, v => v.date?.slice(0, 4));
  const l = [...parAn.entries()].filter(([a]) => a).sort((a, b) => b[0].localeCompare(a[0]));
  z.innerHTML = l.length ? `<div class="cartes-listes">${l.map(([a, n]) => { const c = [...new Set(V.filter(v => v.date?.startsWith(a)).map(v => v.cle))].slice(-4); return `<a class="carte-liste" href="#/annee/${a}"><div class="collage">${c.map(k => S.affiche(S.info(k) || {}, { taille: "w185" })).join("")}</div><b>Vu en ${a}</b><span>${S.pluriel(n, "visionnage")}</span></a>`; }).join("")}</div>` : S.vide("Ton journal est vide");
}

// ------------------------------------------------------------------ journal
function rendreJournal(z, doc, pid) {
  const f = S.filtresMemo["journal_" + pid] = S.filtresMemo["journal_" + pid] || { an: "", q: "" };
  const l = Object.entries(S.vivants(doc.journal)).map(([id, e]) => ({ id, ...e })).filter(e => e.cle).sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.maj || 0) - (a.maj || 0));
  const ans = [...new Set(l.map(e => e.date?.slice(0, 4)).filter(Boolean))];
  z.innerHTML = `<div class="filtres"><select class="champ" data-an><option value="">Toutes les années</option>${ans.map(a => `<option ${a === f.an ? "selected" : ""}>${a}</option>`).join("")}</select><input class="champ recherche-l" data-q placeholder="Chercher…" value="${esc(f.q)}"></div><div data-l></div>`;
  const peindre = () => {
    const q = f.q.toLowerCase();
    const res = l.filter(e => (!f.an || e.date?.startsWith(f.an)) && (!q || S.nomTitre(S.info(e.cle)).toLowerCase().includes(q)));
    let mois = "", html = "";
    for (const e of res.slice(0, 600)) {
      const mo = e.date?.slice(0, 7) || "";
      if (mo !== mois) { mois = mo; html += `<div class="mois-titre">${esc(S.fmtDate(mo) || "Sans date")}</div>`; }
      const m = S.info(e.cle) || {};
      html += `<div class="glisse"><div class="fond-g">Revu</div><div class="fond-d">À voir</div><a class="ligne" href="#/titre/${e.cle}" data-cle="${e.cle}" data-j="${e.id}"><div class="jour"><b>${+(e.date || "").slice(8, 10) || ""}</b><span>${e.date ? S.JOURS[new Date(e.date + "T12:00").getDay()].slice(0, 3) : ""}</span></div>${S.affiche(m, { taille: "w154" })}<div class="corps"><b>${esc(S.nomTitre(m))}</b><span>${esc([m.a, e.revision ? "revu" : "", e.ou?.type === "cinema" ? (e.ou.cinema ? "au " + e.ou.cinema : "au cinéma") : e.ou?.nom ? "sur " + e.ou.nom : "", e.critique ? "critique" : "", e.prive ? "caché" : ""].filter(Boolean).join(", "))}</span></div><div class="droite">${e.note != null ? `<span class="note-txt ${(doc.titres?.[e.cle] || {}).coeur ? "cc" : ""}">${S.fmtNote(e.note)}</span>` : ""}${estMoi(pid) ? `<button class="modif-j" data-editer="${e.id}">modifier</button>` : ""}</div></a></div>`;
    }
    $("[data-l]", z).innerHTML = html || S.vide("Rien au journal", "Le bouton + ajoute un visionnage en deux secondes.");
    $$("[data-editer]", z).forEach(b => b.onclick = ev => { ev.preventDefault(); const e = l.find(x => x.id === b.dataset.editer); S.ouvrirAjout(e.cle, e); });
    if (estMoi(pid)) S.activerGlisse(z); else $$(".glisse", z).forEach(g => g.dataset.ok = 1);
  };
  $("[data-an]", z).onchange = e => { f.an = e.target.value; peindre(); };
  $("[data-q]", z).oninput = e => { f.q = e.target.value; peindre(); };
  peindre();
}
P.journal = (vue) => {
  vue.innerHTML = `<div class="entete"><h1>Journal</h1><span class="espace"></span><nav class="liens-tete"><button data-selection>Sélectionner</button><button data-ajout2>Ajouter un visionnage</button></nav></div><div data-z></div>`;
  $("[data-ajout2]", vue).onclick = () => S.ouvrirAjout();
  rendreJournal($("[data-z]", vue), S.moi, "");
  const sel = S.selectionnable($("[data-z]", vue), { attr: "j", actions: ["suppr", "liste", "wl"] });
  $("[data-selection]", vue).onclick = () => sel.commencer();
};

// ------------------------------------------------------------------ listes
function collage(cles) { return `<div class="collage">${cles.slice(0, 4).map(c => S.affiche(S.info(c) || {}, { taille: "w185" })).join("")}</div>`; }
function cartesListes(z, doc, pid) {
  const listes = Object.entries(S.vivants(doc.listes)).sort((a, b) => (b[1].maj || 0) - (a[1].maj || 0));
  const wl = Object.keys(S.vivants(doc.watchlist));
  const q = pid ? `?p=${encodeURIComponent(pid)}` : "";
  const ligne = (href, items, nom, prive) => { const vus = items.filter(c => S.monTitre(c).vu).length; return `<a class="ligne ligne-liste" href="${href}">${S.affiche(S.info(items[0]) || {}, { taille: "w92" })}<div class="corps"><b>${esc(nom)}</b><span>${S.pluriel(items.length, "titre")}</span></div>${items.length ? `<div class="part-vue"><b>${Math.round(100 * vus / items.length)} %</b><span>vu</span></div>` : ""}</a>`; };
  z.innerHTML = `<div class="lignes">${ligne(pid ? `#/profil/${encodeURIComponent(pid)}?o=watchlist` : "#/watchlist", wl, "Watchlist")}${listes.map(([id, l]) => ligne(`#/liste/${id}${q}`, l.items || [], l.nom, l.privee)).join("")}</div>`;
}
// listes toujours à jour, calculées depuis ton journal
S.LISTES_AUTO = [
  ["cinema", "Vus au cinéma", j => j.ou?.type === "cinema"],
  ["watchlist", "Watchlist", null],
  ["coeur", "Coups de cœur", null],
  ["vo", "Vus en VO", j => j.version === "VO"],
  ["vf", "Vus en VF", j => j.version === "VF"],
  ["revus", "Revus", j => j.revision],
  ["critiques", "Avec ta critique", j => (j.critique || "").trim()],
  ["plateforme", "Vus en streaming", j => j.ou?.type === "plateforme"],
  ["neuf", "Tes 9 et plus", null],
  ["collection", "Ta collection", null],
];
S.listeAuto = id => {
  const journal = Object.values(S.vivants(S.moi.journal)).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
  const titres = S.vivants(S.moi.titres);
  if (id === "watchlist") return Object.entries(S.vivants(S.moi.watchlist)).sort((a, b) => (b[1].ajout || "").localeCompare(a[1].ajout || "")).map(([c]) => c);
  if (id === "coeur") return [...new Set([...journal.filter(j => titres[j.cle]?.coeur).map(j => j.cle), ...Object.keys(titres).filter(c => titres[c].coeur)])];
  if (id === "neuf") return Object.keys(titres).filter(c => (titres[c].note ?? 0) >= 9).sort((a, b) => titres[b].note - titres[a].note);
  if (id === "collection") return Object.keys(titres).filter(c => titres[c].collection);
  const def = S.LISTES_AUTO.find(x => x[0] === id);
  return def && def[2] ? [...new Set(journal.filter(def[2]).map(j => j.cle))] : [];
};

P.listes = (vue, args = []) => {
  if (args[0] === "auto") {
    const def = S.LISTES_AUTO.find(x => x[0] === args[1]);
    const items = def ? S.listeAuto(def[0]) : [];
    const vraie = Object.entries(S.vivants(S.moi.listes)).find(([, l]) => l.auto === args[1]);
    vue.innerHTML = `<a class="fil" href="#/listes">Listes</a><div class="entete"><div><h1>${esc(def ? def[1] : "Liste")}</h1><div class="mini discret">${S.pluriel(items.length, "titre")}, liste automatique</div></div><span class="espace"></span>
      <button class="lien" data-selection style="margin-right:16px">Sélectionner</button>${vraie ? `<a class="lien" href="#/liste/${vraie[0]}">Voir la vraie liste</a>` : `<button class="lien" data-vraie>En faire une vraie liste</button>`}</div>
      ${vraie ? "" : `<p class="mini discret" style="margin-top:-6px">Une vraie liste part sur tes plateformes (IMDb, TMDB…) et reste à jour toute seule.</p>`}
      ${items.length ? `<div class="grille">${items.map(c => S.vignette(c, { vu: S.monTitre(c).vu })).join("")}</div>` : S.vide("Rien pour l'instant", "Elle se remplit toute seule avec ton journal.")}`;
    const grilleAuto = $(".grille", vue);
    if (grilleAuto) { const sel = S.selectionnable(grilleAuto); $("[data-selection]", vue).onclick = () => sel.commencer(); }
    const bv = $("[data-vraie]", vue);
    if (bv) bv.onclick = async () => { await S.agir("liste", { liste: { nom: def[1], auto: def[0], items, privee: false } }, { toast: "Vraie liste créée : elle suivra ton journal" }); S.rafraichir(true); };
    return;
  }
  const ans = [...new Set(Object.values(S.vivants(S.moi.journal)).map(e => e.date?.slice(0, 4)).filter(Boolean))].sort().reverse();
  vue.innerHTML = `<div class="entete"><h1>Listes</h1><span class="espace"></span><button class="lien" data-nouvelle>Nouvelle liste</button></div>
    <div data-z></div>
    <div class="section"><div class="section-titre"><h2>Tes listes automatiques</h2></div><div class="lignes">${S.LISTES_AUTO.map(([id, nom]) => { const l = S.listeAuto(id); return l.length ? `<a class="ligne ligne-liste" href="#/listes/auto/${id}">${S.affiche(S.info(l[0]) || {}, { taille: "w92" })}<div class="corps"><b>${nom}</b><span>${S.pluriel(l.length, "titre")}</span></div></a>` : ""; }).join("")}</div></div>
    <div class="section"><div class="section-titre"><h2>Par année</h2></div><div class="lignes">${ans.map(a => { const c = [...new Set(Object.values(S.vivants(S.moi.journal)).filter(e => e.date?.startsWith(a)).map(e => e.cle))]; return `<a class="ligne ligne-liste" href="#/annee/${a}">${S.affiche(S.info(c[c.length - 1]) || {}, { taille: "w92" })}<div class="corps"><b>Vu en ${a}</b><span>${S.pluriel(c.length, "titre")}</span></div></a>`; }).join("")}<a class="ligne ligne-liste" href="#/decouvrir/commune"><div class="corps"><b>Watchlist commune</b><span>avec tes amis</span></div></a></div></div>`;
  cartesListes($("[data-z]", vue), S.moi, "");
  $("[data-nouvelle]", vue).onclick = () => editerListe();
};
function editerListe(id) {
  const l = id ? S.vivants(S.moi.listes)[id] : { nom: "", description: "", classee: false, privee: false, epinglee: false };
  const corps = el(`<div><label class="etiquette" style="margin-top:0">Nom</label><input class="champ" data-nom value="${esc(l.nom)}" placeholder="Mes Lynch préférés"><label class="etiquette">Description</label><textarea class="champ" data-desc>${esc(l.description || "")}</textarea><label class="case"><input type="checkbox" data-classee ${l.classee ? "checked" : ""}> Liste classée (ordre qui compte : top 10…)</label><label class="case"><input type="checkbox" data-privee ${l.privee ? "checked" : ""}> Liste privée (visible par toi seul)</label><label class="case"><input type="checkbox" data-epinglee ${l.epinglee ? "checked" : ""}> Épinglée dans le menu</label></div>`);
  S.ouvrirModale({ titre: id ? "Modifier la liste" : "Nouvelle liste", corps, pied: `${id ? `<button class="aj-supprimer" data-suppr>Supprimer</button>` : ""}<button class="bouton principal" data-ok>${id ? "Enregistrer" : "Créer"}</button>` });
  const m = corps.closest(".modale");
  $("[data-nom]", corps).focus();
  $("[data-ok]", m).onclick = async () => {
    const nom = $("[data-nom]", corps).value.trim(); if (!nom) return;
    const r = await S.agir("liste", { liste: { id, nom, description: $("[data-desc]", corps).value.trim(), classee: $("[data-classee]", corps).checked, privee: $("[data-privee]", corps).checked, epinglee: $("[data-epinglee]", corps).checked } }, { toast: id ? "Liste enregistrée" : `Liste « ${nom} » créée`, sansRendu: true });
    S.fermerModale(); S.majChrome();
    if (!id) S.aller("#/liste/" + r.modifs[0][1]); else S.rafraichir(true);
  };
  const s = $("[data-suppr]", m); if (s) s.onclick = async () => { await S.agir("suppr_liste", { id }, { toast: "Liste supprimée", sansRendu: true }); S.fermerModale(); S.majChrome(); S.aller("#/listes"); };
}
P.liste = (vue, args, params) => {
  const id = args[0], pid = params.p || "";
  const doc = S.docDe(pid); const l = S.vivants(doc?.listes)[id];
  if (!l) { vue.innerHTML = S.vide("Liste introuvable"); return; }
  const moi = estMoi(pid);
  const items = (l.items || []);
  const f = S.filtresMemo["liste_" + id] = S.filtresMemo["liste_" + id] || { vue: l.classee ? "liste" : "grille" };
  vue.innerHTML = `<div class="entete"><div style="min-width:0"><h1>${esc(l.nom)}</h1><div class="mini discret">${pid ? `par ${esc(S.nomDe(pid))}, ` : ""}${S.pluriel(items.length, "titre")}${l.classee ? ", classée" : ""}</div></div><span class="espace"></span>${moi ? `<nav class="liens-tete"><button data-selection>Sélectionner</button><button data-ajouter>Ajouter</button><button data-editer>Modifier</button></nav>` : ""}</div>
    ${l.description ? `<p class="synopsis">${esc(l.description)}</p>` : ""}
    <div class="filtres"><div class="segments" data-vue><button data-v="grille">Grille</button><button data-v="liste">Liste</button></div><span class="mini discret">${S.pluriel(items.filter(c => S.monTitre(c).vu).length, "titre vu", "titres vus")} par toi</span></div>
    <div data-items></div>`;
  const peindre = () => {
    $$("[data-vue] button", vue).forEach(b => b.classList.toggle("actif", b.dataset.v === f.vue));
    const z = $("[data-items]", vue);
    if (!items.length) { z.innerHTML = S.vide("Liste vide", moi ? "Ajoute des titres avec + ou depuis la page d'un film." : ""); return; }
    if (f.vue === "grille") { z.innerHTML = `<div class="grille">${items.map((c, i) => S.vignette(c, { vu: S.monTitre(c).vu, sous: l.classee ? `n° ${i + 1}` : (S.info(c)?.a || "") })).join("")}</div>`; return; }
    z.innerHTML = `<div class="lignes ${l.classee && moi ? "classement" : ""}" data-cl>${items.map((c, i) => `<div class="ligne" data-cle="${c}">${l.classee ? `<span class="rang">${i + 1}</span>` : ""}${S.affiche(S.info(c) || {}, { taille: "w92" })}<a class="corps" href="#/titre/${c}"><b>${esc(S.nomTitre(S.info(c)))}</b><span>${S.info(c)?.a || ""}${S.monTitre(c).vu ? ", vu" : ""}</span></a>${S.monTitre(c).note != null ? `<span class="note-txt">${S.fmtNote(S.monTitre(c).note)}</span>` : ""}${moi ? `<button class="retirer-l" data-retirer="${c}">Retirer</button>${l.classee ? `<span class="poignee" aria-label="Déplacer"></span>` : ""}` : ""}</div>`).join("")}</div>`;
    $$("[data-retirer]", z).forEach(b => b.onclick = () => S.agir("liste_item", { id, cle: b.dataset.retirer, val: false }, { toast: "Retiré de la liste" }));
    const cl = $("[data-cl].classement", z);
    if (cl) {
      let tire = null;
      $$(".poignee", cl).forEach(p => p.addEventListener("pointerdown", e => { tire = p.closest(".ligne"); tire.classList.add("saisie"); p.setPointerCapture(e.pointerId); e.preventDefault(); }));
      cl.addEventListener("pointermove", e => { if (!tire) return; const ap = $$(".ligne", cl).filter(x => x !== tire).find(x => { const r = x.getBoundingClientRect(); return e.clientY < r.top + r.height / 2; }); ap ? cl.insertBefore(tire, ap) : cl.append(tire); });
      const fin = () => { if (!tire) return; tire.classList.remove("saisie"); tire = null; S.agir("liste", { liste: { id, items: $$(".ligne", cl).map(x => x.dataset.cle) } }, { toast: "Ordre enregistré" }); };
      cl.addEventListener("pointerup", fin); cl.addEventListener("pointercancel", fin);
    }
  };
  $$("[data-vue] button", vue).forEach(b => b.onclick = () => { f.vue = b.dataset.v; peindre(); });
  if (moi) { $("[data-ajouter]", vue).onclick = () => S.choisirTitre(c => S.agir("liste_item", { id, cle: c, val: true }, { toast: "Ajouté à la liste" }), "Ajouter à « " + l.nom + " »"); $("[data-editer]", vue).onclick = () => editerListe(id); }
  if (moi) { const sel = S.selectionnable($("[data-items]", vue), { liste: id }); $("[data-selection]", vue).onclick = () => sel.commencer(); }
  peindre();
};
P.watchlist = (vue) => {
  const f = S.filtresMemo.wl = S.filtresMemo.wl || { type: "", duree: 0, dispo: false };
  const mesPlat = S.reglage("plateformes", []) || [];
  vue.innerHTML = `<div class="entete"><h1>Watchlist</h1><span class="espace"></span><nav class="liens-tete"><button data-selection>Sélectionner</button><button data-tirage>Au hasard</button></nav></div>
    <div class="filtres defile-x" style="flex-wrap:nowrap">
      <div class="segments" data-type><button data-v="">Tout</button><button data-v="m">Films</button><button data-v="t">Séries</button></div>
      <div class="segments" data-duree><button data-v="0">Toutes durées</button><button data-v="95">≤ 1 h 35</button><button data-v="120">≤ 2 h</button></div>
      <button class="puce ${f.dispo ? "actif" : ""}" data-dispo>Sur mes plateformes</button>
    </div><div data-g></div>`;
  $("[data-tirage]", vue).onclick = () => S.tirage();
  const peindre = () => {
    $$("[data-type] button", vue).forEach(b => b.classList.toggle("actif", b.dataset.v === f.type));
    $$("[data-duree] button", vue).forEach(b => b.classList.toggle("actif", +b.dataset.v === f.duree));
    $("[data-dispo]", vue).classList.toggle("actif", f.dispo);
    const wl = Object.entries(S.vivants(S.moi.watchlist));
    const dispo = S.memo.dispo || {};
    let l = wl.filter(([c]) => { const m = S.info(c) || {}; return (!f.type || c[0] === f.type) && (!f.duree || (m.ty === "m" && m.r && m.r <= f.duree)) && (!f.dispo || (dispo[c] || []).some(id => !mesPlat.length || mesPlat.includes(id))); });
    l.sort((a, b) => (b[1].prio ? 1 : 0) - (a[1].prio ? 1 : 0) || (b[1].ajout || "").localeCompare(a[1].ajout || "") || (b[1].maj || 0) - (a[1].maj || 0));
    const z = $("[data-g]", vue);
    if (f.dispo && !S.memo.dispo) { z.innerHTML = S.chargement(); S.api("/api/dispo").then(d => { S.memo.dispo = d; peindre(); }).catch(() => z.innerHTML = S.vide("Hors ligne")); return; }
    if (f.dispo && !mesPlat.length) z.insertAdjacentHTML("afterbegin", "");
    z.innerHTML = (f.dispo && !mesPlat.length ? `<a class="carte serree" href="#/reglages/affichage" style="display:block;margin-bottom:12px">Choisis tes abonnements dans Réglages → Affichage pour filtrer seulement les tiens.</a>` : "")
      + (l.length ? `<div class="grille">${l.map(([c, e]) => { const m = S.info(c) || {}; const amis = Object.entries(S.amis).filter(([, a]) => S.dansWatchlist(c, a)); return `<div class="carte-wl ${e.prio ? "prio" : ""}">${S.vignette(c, { info: m.ty === "t" ? (m.dep ? `${m.dep} min / ép.` : "Série") : S.duree(m.r) })}<button class="prio-bouton" data-prio="${c}">${e.prio ? "En premier" : "Mettre en premier"}</button>${amis.length ? `<div class="amis-wl">${amis.slice(0, 3).map(([id, a]) => S.avatar(id, a.profil?.nom, 20)).join("")}</div>` : ""}</div>`; }).join("")}</div>` : S.vide("Rien ici"));
    $$("[data-prio]", z).forEach(b => b.onclick = ev => { ev.preventDefault(); const c = b.dataset.prio; const prio = !S.vivants(S.moi.watchlist)[c]?.prio; S.agir("watchlist_prio", { cle: c, val: prio }, { toast: prio ? "En tête de liste" : "Priorité retirée" }); });
  };
  $$("[data-type] button", vue).forEach(b => b.onclick = () => { f.type = b.dataset.v; peindre(); });
  $$("[data-duree] button", vue).forEach(b => b.onclick = () => { f.duree = +b.dataset.v; peindre(); });
  $("[data-dispo]", vue).onclick = () => { f.dispo = !f.dispo; peindre(); };
  peindre();
  const selW = S.selectionnable($("[data-g]", vue), { actions: ["retirer_wl", "vu", "liste"] });
  $("[data-selection]", vue).onclick = () => selW.commencer();
};

// ------------------------------------------------------------------ amis
P.amis = (vue) => {
  const amis = Object.entries(S.amis);
  const act = [];
  for (const [pid, a] of amis) for (const [id, e] of Object.entries(S.vivants(a.journal))) if (e.cle && e.date) act.push({ pid, ...e });
  act.sort((a, b) => (b.date || "").localeCompare(a.date || "") || (b.maj || 0) - (a.maj || 0));
  vue.innerHTML = `<div class="entete"><h1>Amis</h1></div>
    ${amis.length ? `<div class="lignes">${amis.map(([pid, a]) => { const c = St.compat("", pid); const T = St.donnees(pid).T; return `<a class="ligne" href="#/profil/${encodeURIComponent(pid)}">${S.avatar(pid, a.profil?.nom, 44)}<div class="corps"><b>${esc(a.profil?.nom || pid)}</b><span>${S.pluriel(T.length, "titre")}, ${c.n ? `${c.accord} % d'accord sur ${c.n} films` : "aucun film en commun noté"}</span></div></a>`; }).join("")}</div>
      <div class="section"><div class="section-titre"><h2>Activité</h2></div><div class="lignes">${act.slice(0, 80).map(a => S.ligneTitre(a.cle, { glisse: false, avant: S.avatar(a.pid, S.nomDe(a.pid)), sous: `${S.nomDe(a.pid)}, ${S.fmtDate(a.date, true)}${a.revision ? ", revu" : ""}${a.critique ? ", critique" : ""}`, droite: a.note != null ? `<span class="note-txt" style="color:${S.couleurProfil(a.pid)}">${S.fmtNote(a.note)}</span>` : "" })).join("")}</div></div>`
    : `<div class="carte vide"><b>Pas encore d'amis ici</b>Règle la synchronisation GitHub dans les <a href="#/reglages" style="color:var(--accent)">réglages</a> : les profils de tes amis apparaîtront tout seuls.</div>`}`;
};

// ------------------------------------------------------------------ découvrir
P.decouvrir = (vue, args, params) => {
  if (!args[0]) return decouvrirAccueil(vue);
  const onglet = args[0];
  const ONG = [["pourtoi", "Pour toi"], ["soir", "Ce soir entre amis"], ["commune", "Watchlist commune"], ["explorer", "Explorer"], ["sorties", "Sorties"], ["palmares", "Palmarès"]];
  vue.innerHTML = `<div class="entete"><a class="fil" href="#/decouvrir">Découvrir</a><h1>${esc((ONG.find(o => o[0] === onglet) || ["", "Découvrir"])[1])}</h1></div><div data-z></div>`;
  const z = $("[data-z]", vue);
  ({ pourtoi: pourToi, soir: ceSoir, commune: commune, explorer: explorer, sorties: sorties, palmares: palmaresListe }[onglet] || pourToi)(z, params);
};
function decouvrirAccueil(vue) {
  const mesPlat = S.reglage("plateformes", []) || [];
  vue.innerHTML = `<div class="entete"><h1>Découvrir</h1></div>
    <div class="section" data-pourtoi>${S.chargement()}</div>
    <div class="section" data-plateformes></div>
    <div class="section" data-sorties></div>
    <div class="section"><div class="section-titre"><h2>Chercher autrement</h2></div><div class="raccourcis-decouvrir">
      <a href="#/decouvrir/soir"><b>Ce soir entre amis</b><span>Un film qui plaira à tout le monde</span></a>
      <a href="#/decouvrir/commune"><b>Watchlist commune</b><span>Ce que vous voulez voir ensemble</span></a>
      <a href="#/decouvrir/explorer"><b>Explorer</b><span>Par genre, pays, décennie</span></a>
      <a href="#/decouvrir/palmares"><b>Palmarès</b><span>Cannes, Oscars, César, Venise, Berlin</span></a>
    </div></div>
    <div class="section" data-palmares></div>`;
  const rangee = (titre, cles, lien) => `<div class="section-titre"><h2>${titre}</h2>${lien ? `<a class="lien" href="${lien}">Tout voir</a>` : ""}</div><div class="rangee">${cles.map(c => S.vignette(c)).join("")}</div>`;
  const recos = r => { r.forEach(x => S.infos[x.cle] = S.infos[x.cle] || { k: x.cle, ty: x.cle[0], t: x.t, af: x.af, a: x.a ? +x.a : null, vt: x.vt }); $("[data-pourtoi]", vue).innerHTML = r.length ? rangee("Pour toi", r.slice(0, 16).map(x => x.cle), "#/decouvrir/pourtoi") : ""; };
  if (S.memo.recos) recos(S.memo.recos); else S.api("/api/recos").then(d => { S.memo.recos = d.r; recos(d.r); }).catch(() => $("[data-pourtoi]", vue).innerHTML = "");
  if (mesPlat.length) S.api(`/api/decouvrir?type=movie&sort_by=vote_average.desc&vote_count.gte=800&with_watch_providers=${mesPlat.join("|")}`).then(d => {
    const cles = (d.results || []).map(x => S.retenir(x, "movie")).filter(c => c && !S.monTitre(c).vu).slice(0, 16);
    if (cles.length) $("[data-plateformes]", vue).innerHTML = rangee("Sur tes plateformes", cles);
  }).catch(() => {});
  const sorties = r => { const l = r.filter(x => !x.vu).slice(0, 16); l.forEach(x => S.infos[x.cle] = S.infos[x.cle] || { k: x.cle, ty: x.cle[0], t: x.t, af: x.af, fd: x.fd, a: x.date ? +x.date.slice(0, 4) : null }); if (l.length) $("[data-sorties]", vue).innerHTML = rangee("Sorties de tes favoris", l.map(x => x.cle), "#/decouvrir/sorties"); };
  if (Object.keys(S.vivants(S.moi.favoris)).length) { if (S.memo.sorties) sorties(S.memo.sorties); else S.api("/api/sorties").then(d => { S.memo.sorties = d.r; sorties(d.r); }).catch(() => {}); }
  S.api("/api/palmares").then(l => {
    const vus = new Set(St.donnees().T.map(t => t.cle));
    const z = $("[data-palmares]", vue); if (!z) return;
    z.innerHTML = `<div class="section-titre"><h2>Palmarès à compléter</h2></div><div class="barres-h">${Object.entries(l).map(([k, n]) => `<a class="barre-h" href="#/palmares/${k}" data-pk="${k}"><span class="lib">${esc(n)}</span><span class="piste"><i style="width:0"></i></span><span class="val">…</span></a>`).join("")}</div>`;
    for (const k of Object.keys(l)) S.api("/api/palmares/" + k).then(pp => { const b = $(`[data-pk="${k}"]`, z); if (!b) return; const v = pp.films.filter(f => vus.has(f.cle)).length; $("i", b).style.width = Math.max(1.5, 100 * v / (pp.films.length || 1)) + "%"; $(".val", b).textContent = `${v}/${pp.films.length}`; }).catch(() => {});
  }).catch(() => {});
}
function pourToi(z) {
  const peindre = r => {
    if (!r.length) { z.innerHTML = S.vide("Pas encore de recommandations", "Note quelques films 8 ou plus (ou mets des coups de cœur)."); return; }
    r.forEach(x => S.infos[x.cle] = S.infos[x.cle] || { k: x.cle, ty: x.cle[0], t: x.t, af: x.af, a: x.a ? +x.a : null, vt: x.vt });
    z.innerHTML = `<p class="muet petit" style="margin-top:0">D'après les titres que tu as le mieux notés.</p><div class="grille">${r.map(x => S.vignette(x.cle, { sous: `car tu as aimé ${S.nomTitre(S.info(x.parce_que[0]))}` })).join("")}</div>`;
  };
  if (S.memo.recos) return peindre(S.memo.recos);
  z.innerHTML = S.chargement();
  S.api("/api/recos").then(d => { S.memo.recos = d.r; peindre(d.r); }).catch(e => z.innerHTML = S.vide(e.horsLigne ? "Hors ligne" : "Erreur", esc(e.message)));
}
function choixProfils(z, cleMemo, defaut, rappel) {
  const sel = S.filtresMemo[cleMemo] = S.filtresMemo[cleMemo] || defaut;
  const tous = [["", S.moi.profil.nom], ...Object.entries(S.amis).map(([id, a]) => [id, a.profil?.nom || id])];
  const w = el(`<div class="puces" style="margin-bottom:14px">${tous.map(([id, n]) => `<button class="puce ${sel.includes(id) ? "actif" : ""}" data-p="${esc(id)}">${S.avatar(id || S.etat.appareil.profil, n, 20).replace('class="avatar"', 'class="avatar" style="margin-left:-6px"')} ${esc(n)}</button>`).join("")}</div>`);
  $$("[data-p]", w).forEach(b => b.onclick = () => { const p = b.dataset.p; const i = sel.indexOf(p); i >= 0 ? sel.splice(i, 1) : sel.push(p); b.classList.toggle("actif", i < 0); rappel(sel); });
  z.append(w);
  return sel;
}
function ceSoir(z) {
  z.innerHTML = `<p class="muet petit" style="margin-top:0">Qui est là ce soir ? Les titres que vous voulez voir, et qu'aucun de vous n'a vus.</p>`;
  const opts = S.filtresMemo.soir_o = S.filtresMemo.soir_o || { duree: 0, type: "m" };
  const res = el(`<div></div>`);
  const sel = choixProfils(z, "soir", ["", ...Object.keys(S.amis)], () => peindre());
  const o = el(`<div class="filtres"><div class="segments" data-type><button data-v="m">Film</button><button data-v="t">Série</button><button data-v="">Tout</button></div><select class="champ" data-duree><option value="0">Toutes durées</option><option value="100">Moins de 1 h 40</option><option value="120">Moins de 2 h</option><option value="150">Moins de 2 h 30</option></select><button class="bouton petit" data-tirer>Tirer au sort</button></div>`);
  z.append(o, res);
  $("[data-duree]", o).value = opts.duree; $("[data-duree]", o).onchange = e => { opts.duree = +e.target.value; peindre(); };
  $$("[data-type] button", o).forEach(b => b.onclick = () => { opts.type = b.dataset.v; peindre(); });
  let cands = [];
  const peindre = () => {
    $$("[data-type] button", o).forEach(b => b.classList.toggle("actif", b.dataset.v === opts.type));
    const docs = sel.map(p => S.docDe(p)).filter(Boolean);
    const score = new Map();
    docs.forEach(d => Object.keys(S.vivants(d.watchlist)).forEach(c => score.set(c, (score.get(c) || 0) + 1)));
    cands = [...score.entries()].filter(([c]) => !docs.some(d => { const t = d.titres?.[c]; return t && !t.x && t.vu; }))
      .filter(([c]) => { const m = S.info(c) || {}; return (!opts.type || c[0] === opts.type) && (!opts.duree || (m.r && m.r <= opts.duree)); })
      .sort((a, b) => b[1] - a[1] || (S.info(b[0])?.vt || 0) - (S.info(a[0])?.vt || 0));
    res.innerHTML = cands.length ? `<div class="grille">${cands.slice(0, 60).map(([c, n]) => S.vignette(c, { sous: `${n}/${docs.length} le veulent` })).join("")}</div>` : S.vide("Rien en commun", "Ajoutez des titres à vos watchlists.");
  };
  $("[data-tirer]", o).onclick = () => { if (!cands.length) return; const top = cands.filter(([, n]) => n === cands[0][1]); const [c] = top[Math.floor(Math.random() * top.length)]; S.aller("#/titre/" + c); };
  peindre();
}
function commune(z) {
  z.innerHTML = `<p class="muet petit" style="margin-top:0">L'intersection des watchlists des profils choisis.</p>`;
  const res = el(`<div></div>`);
  const sel = choixProfils(z, "commune", ["", ...Object.keys(S.amis).slice(0, 1)], () => peindre());
  z.append(res);
  const peindre = () => {
    const docs = sel.map(p => S.docDe(p)).filter(Boolean);
    if (docs.length < 2) { res.innerHTML = S.vide("Choisis au moins deux profils"); return; }
    const ens = docs.map(d => new Set(Object.keys(S.vivants(d.watchlist))));
    const inter = [...ens[0]].filter(c => ens.every(s => s.has(c)));
    const presque = docs.length > 2 ? [...new Set(ens.flatMap(s => [...s]))].filter(c => !inter.includes(c) && ens.filter(s => s.has(c)).length === docs.length - 1) : [];
    res.innerHTML = `${inter.length ? `<div class="grille">${inter.map(c => S.vignette(c)).join("")}</div>` : S.vide("Aucun titre en commun")}${presque.length ? `<div class="section-titre section"><h2>Presque</h2><span class="mini discret">voulus par ${docs.length - 1} sur ${docs.length}</span></div><div class="grille">${presque.map(c => S.vignette(c)).join("")}</div>` : ""}`;
  };
  peindre();
}
function explorer(z, params) {
  const f = S.filtresMemo.explorer = S.filtresMemo.explorer || { type: "movie", genre: "", de: "", a: "", pays: "", langue: "", note: "", duree: "", plateforme: "", tri: "popularity.desc", page: 1 };
  if (params.genre) { f.genre = params.genre; f.type = params.type || f.type; }
  const pays = ["FR", "US", "GB", "JP", "KR", "IT", "DE", "ES", "HK", "TW", "CN", "IN", "IR", "MX", "BR", "AR", "SE", "DK", "BE", "CA", "AU", "RU", "PL", "TR"];
  z.innerHTML = `<div class="filtres">
    <div class="segments" data-type><button data-v="movie">Films</button><button data-v="tv">Séries</button></div>
    <select class="champ" data-f="genre"><option value="">Tous genres</option>${Object.entries(S.GENRES).filter(([k]) => +k < 10759).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select>
    <select class="champ" data-f="de"><option value="">Depuis…</option>${d3.range(1920, 2030, 10).map(a => `<option value="${a}">${a}</option>`).join("")}</select>
    <select class="champ" data-f="a"><option value="">…jusqu'à</option>${d3.range(1929, 2040, 10).map(a => `<option value="${a}">${a}</option>`).join("")}</select>
    <select class="champ" data-f="pays"><option value="">Tous pays</option>${pays.map(p => `<option value="${p}">${esc(S.pays(p))}</option>`).join("")}</select>
    <select class="champ" data-f="note"><option value="">Toutes notes</option><option value="8">TMDB 8+</option><option value="7.5">7,5+</option><option value="7">7+</option></select>
    <select class="champ" data-f="duree"><option value="">Toutes durées</option><option value="90">≤ 1 h 30</option><option value="120">≤ 2 h</option></select>
    <select class="champ" data-f="plateforme"><option value="">Toutes plateformes</option></select>
    <select class="champ" data-f="tri"><option value="popularity.desc">Populaires</option><option value="vote_average.desc">Mieux notés</option><option value="primary_release_date.desc">Récents</option><option value="revenue.desc">Box-office</option></select>
    <label class="case mini"><input type="checkbox" data-pasvus ${f.pasvus ? "checked" : ""}> pas vus seulement</label>
  </div><div data-res></div>`;
  S.api("/api/fournisseurs_liste").then(d => { const s = $("[data-f=plateforme]", z); if (!s) return; s.innerHTML += (d.results || []).sort((a, b) => (a.display_priorities?.FR ?? 99) - (b.display_priorities?.FR ?? 99)).slice(0, 25).map(p => `<option value="${p.provider_id}">${esc(p.provider_name)}</option>`).join(""); s.value = f.plateforme; }).catch(() => {});
  $$("[data-type] button", z).forEach(b => { b.classList.toggle("actif", b.dataset.v === f.type); b.onclick = () => { f.type = b.dataset.v; f.page = 1; explorer(z, {}); }; });
  $$("[data-f]", z).forEach(c => { c.value = f[c.dataset.f] || ""; c.onchange = () => { f[c.dataset.f] = c.value; f.page = 1; chercher(); }; });
  $("[data-pasvus]", z).onchange = e => { f.pasvus = e.target.checked; chercher(); };
  let res = [];
  const chercher = async (suite) => {
    const tv = f.type === "tv";
    const p = new URLSearchParams({ type: f.type, sort_by: f.tri === "primary_release_date.desc" && tv ? "first_air_date.desc" : f.tri, page: f.page, "vote_count.gte": f.tri === "vote_average.desc" ? 300 : 20 });
    if (f.genre) p.set("with_genres", f.genre);
    if (f.de) p.set(tv ? "first_air_date.gte" : "primary_release_date.gte", `${f.de}-01-01`);
    if (f.a) p.set(tv ? "first_air_date.lte" : "primary_release_date.lte", `${f.a}-12-31`);
    if (f.pays) p.set("with_origin_country", f.pays);
    if (f.note) p.set("vote_average.gte", f.note);
    if (f.duree) p.set("with_runtime.lte", f.duree);
    if (f.plateforme) p.set("with_watch_providers", f.plateforme);
    const r = $("[data-res]", z);
    if (!suite) r.innerHTML = S.chargement();
    try {
      const d = await S.api("/api/decouvrir?" + p);
      const cles = (d.results || []).map(x => S.retenir(x, f.type)).filter(Boolean);
      res = suite ? res.concat(cles) : cles;
      const vis = f.pasvus ? res.filter(c => !S.monTitre(c).vu) : res;
      r.innerHTML = `<div class="grille">${vis.map(c => S.vignette(c, { vu: S.monTitre(c).vu })).join("")}</div>${d.page < d.total_pages ? `<div class="centre" style="margin:18px"><button class="bouton" data-plus>Plus de résultats</button></div>` : ""}`;
      const b = $("[data-plus]", r); if (b) b.onclick = () => { f.page++; chercher(true); };
    } catch (e) { r.innerHTML = S.vide(e.horsLigne ? "Hors ligne" : "Erreur", esc(e.message)); }
  };
  chercher();
}
function sorties(z) {
  const peindre = r => {
    if (!Object.keys(S.vivants(S.moi.favoris)).length) { z.innerHTML = S.vide("Aucune personne favorite", "Mets en favori tes réalisateurs, acteurs, chefs op… : leurs nouveaux films apparaîtront ici (et en notification)."); return; }
    r.forEach(x => S.infos[x.cle] = S.infos[x.cle] || { k: x.cle, ty: x.cle[0], t: x.t, af: x.af, fd: x.fd, a: x.date ? +x.date.slice(0, 4) : null });
    const aVenir = r.filter(x => !x.sortie), sortis = r.filter(x => x.sortie).reverse();
    const v = x => S.vignette(x.cle, { vu: x.vu, sous: `${x.personnes.map(p => p.nom).slice(0, 2).join(", ")}${x.date ? ", " + S.fmtDate(x.date, true) : ""}` });
    z.innerHTML = `${aVenir.length ? `<div class="section-titre"><h2>À venir</h2></div><div class="grille">${aVenir.map(v).join("")}</div>` : ""}${sortis.length ? `<div class="section-titre section"><h2>Sortis récemment</h2></div><div class="grille">${sortis.map(v).join("")}</div>` : ""}` || S.vide("Rien d'annoncé");
  };
  if (S.memo.sorties) return peindre(S.memo.sorties);
  z.innerHTML = S.chargement();
  S.api("/api/sorties").then(d => { S.memo.sorties = d.r; peindre(d.r); }).catch(e => z.innerHTML = S.vide(e.horsLigne ? "Hors ligne" : "Erreur", esc(e.message)));
}
function palmaresListe(z) {
  z.innerHTML = S.chargement();
  S.api("/api/palmares").then(l => { z.innerHTML = `<div class="lignes">${Object.entries(l).map(([k, n]) => `<a class="ligne" href="#/palmares/${k}"><div class="corps"><b>${esc(n)}</b><span data-p="${k}">…</span></div></a>`).join("")}</div>`; const vus = new Set(St.donnees().T.map(t => t.cle)); for (const k of Object.keys(l)) S.api("/api/palmares/" + k).then(p => { const s = $(`[data-p="${k}"]`, z); if (s) s.textContent = `${p.films.filter(f => vus.has(f.cle)).length} vus sur ${p.films.length}`; }).catch(() => {}); }).catch(() => z.innerHTML = S.vide("Hors ligne"));
}
P.palmares = (vue, args) => {
  vue.innerHTML = S.chargement();
  S.api("/api/palmares/" + args[0]).then(p => {
    const vus = new Set(St.donnees().T.map(t => t.cle));
    p.films.forEach(f => { if (!S.info(f.cle)) S.infos[f.cle] = { k: f.cle, ty: "m", t: f.titre, a: f.annee }; });
    const v = p.films.filter(f => vus.has(f.cle)).length;
    vue.innerHTML = `<div class="entete"><h1>${esc(p.nom)}</h1></div><div class="carte" style="margin-bottom:16px"><div class="flex"><b style="font-size:22px">${v}/${p.films.length}</b><span class="muet">films vus</span></div><div class="jauge" style="margin-top:10px"><i style="width:${100 * v / (p.films.length || 1)}%"></i></div></div><div class="filtres"><div class="segments" data-vu><button data-v="tous" class="actif">Tous</button><button data-v="pasvus">Pas vus</button></div></div><div class="grille" data-g></div><p class="mini discret">Source : Wikidata. Les affiches s'affichent quand la fiche du film a été ouverte une fois.</p>`;
    const peindre = mode => { $("[data-g]", vue).innerHTML = [...p.films].reverse().filter(f => mode === "tous" || !vus.has(f.cle)).map(f => S.vignette(f.cle, { vu: vus.has(f.cle), sous: f.annee || "" })).join(""); };
    $$("[data-vu] button", vue).forEach(b => b.onclick = () => { $$("[data-vu] button", vue).forEach(x => x.classList.toggle("actif", x === b)); peindre(b.dataset.v); });
    peindre("tous");
  }).catch(e => vue.innerHTML = S.vide(e.horsLigne ? "Hors ligne" : "Erreur", esc(e.message)));
};
P.motcle = (vue, args) => {
  const id = args[0];
  const nom = S.base?.mc?.[id] || "Mot-clé";
  const miens = St.donnees().T.filter(t => (t.m?.mc || []).includes(+id));
  vue.innerHTML = `<div class="entete"><h1>« ${esc(nom)} »</h1></div>${miens.length ? `<div class="section-titre"><h2>Tes titres</h2><span class="mini discret">moyenne ${S.fmtNote(moyenne(miens.map(t => t.note).filter(n => n != null)))}</span></div><div class="grille">${miens.map(t => S.vignette(t.cle)).join("")}</div>` : ""}<div class="section-titre section"><h2>Les plus connus</h2></div><div data-g>${S.chargement()}</div>`;
  S.api("/api/motcle/" + id).then(d => { $("[data-g]", vue).innerHTML = `<div class="grille">${(d.results || []).map(r => S.vignette(S.retenir(r, "movie"), { vu: S.monTitre("m:" + r.id).vu })).join("")}</div>`; }).catch(() => $("[data-g]", vue).innerHTML = S.vide("Hors ligne"));
};

// ------------------------------------------------------------------ notifications
P.notifs = async (vue) => {
  vue.innerHTML = `<div class="entete"><h1>Notifications</h1><span class="espace"></span><nav class="liens-tete"><button data-verif>Vérifier maintenant</button></nav></div><div data-l>${S.chargement()}</div>`;
  $("[data-verif]", vue).onclick = async () => { await S.post("/api/notifs/verifier"); S.toast("Vérification lancée (sorties, watchlist, récap)"); };
  const d = await S.api("/api/notifs");
  const ICONES = { sortie: "ticket", annonce: "journal", dispo: "play", recap: "stats" };
  $("[data-l]", vue).innerHTML = d.r.length ? `<div class="lignes">${d.r.map(n => `<a class="ligne" href="${esc(n.lien || "#/")}">${n.image ? S.affiche({ af: n.image, t: n.titre }, { taille: "w92" }) : `<span class="notif-sans"></span>`}<div class="corps"><b style="${n.lu ? "" : "color:var(--accent)"}">${esc(n.titre)}</b><span>${esc(n.texte)}, ${new Date(n.date * 1000).toLocaleDateString("fr-FR", { day: "numeric", month: "short" })}</span></div></a>`).join("")}</div>` : S.vide("Rien de neuf", "Tu seras prévenu quand un film de ta watchlist arrive sur une plateforme, quand une personne favorite sort un film, et chaque mois pour ton récap.");
  if (d.r.some(n => !n.lu)) S.post("/api/notifs/lues").then(() => { S.etat.notifs = 0; S.majChrome(); });
};

// ------------------------------------------------------------------ compléter les films importés
// Les visionnages venus d'un import (Letterboxd, IMDb, TMDB, Twin Picks) et les films « vus » sans date : on les
// reprend un par un pour ajouter la vraie date, le cinéma, la version… « Garder tel quel » les retire de la liste.
S.aCompleter = () => {
  const faits = new Set(S.reglage("completes", []) || []);
  const journal = Object.entries(S.vivants(S.moi.journal));
  const avecEntree = new Set(journal.map(([, e]) => e.cle));
  const entrees = journal.filter(([id, e]) => !/^j/.test(id) && !e.ou && !faits.has(id))
    .sort((a, b) => (b[1].date || "").localeCompare(a[1].date || "")).map(([id, e]) => ({ id, cle: e.cle, ex: { ...e, id } }));
  const sansDate = Object.entries(S.vivants(S.moi.titres)).filter(([c, t]) => t.vu && c.startsWith("m:") && !avecEntree.has(c) && !faits.has(c))
    .map(([c]) => ({ id: c, cle: c, ex: null }));
  return [...entrees, ...sansDate];
};
S.completer = (liste, i = 0) => {
  if (i >= liste.length) { S.fermerModale(); S.toast("Tout est complété"); S.rafraichir(true); return; }
  const it = liste[i];
  if (!S.info(it.cle) && !it.charge) {             // fiche pas encore en mémoire : on la charge d'abord (titre, affiche)
    it.charge = true;
    S.api("/api/titre/" + it.cle).then(r => { const d = r && r.d; if (d) S.retenir(d, it.cle[0] === "t" ? "tv" : "movie"); }).catch(() => {}).finally(() => S.completer(liste, i));
    return;
  }
  const suite = async garder => {
    if (garder) await S.agir("profil", { champs: { reglages: { completes: [...new Set([...(S.reglage("completes", []) || []), it.id])] } } }, { toast: false, sansRendu: true, sansAnnuler: true });
    S.fermerModale();
    setTimeout(() => S.completer(liste, i + 1), 260);
  };
  S.ouvrirAjout(it.cle, it.ex, { suite, position: `${i + 1} sur ${liste.length}` });
};
function rubriqueCompleter(z) {
  const l = S.aCompleter();
  const n = l.filter(x => x.ex).length, nd = l.length - n;
  z.innerHTML = l.length ? `<p class="pf-intro">${S.pluriel(n, "visionnage importé", "visionnages importés")} sans lieu ni date précise, et ${S.pluriel(nd, "film vu")} sans date dans ton journal. Reprends-les un par un pour ajouter la date, le cinéma, la version, avec qui… « Garder tel quel » le retire de cette liste.</p>
    <div class="toi-actions" style="margin:12px 0 16px"><button class="bouton principal" data-commencer>Commencer</button></div>
    <div class="lignes">${l.slice(0, 40).map((x, i) => { const m = S.info(x.cle) || {}; return `<div class="ligne" data-i="${i}">${S.affiche(m, { taille: "w92" })}<div class="corps"><b>${esc(S.nomTitre(m))}</b><span>${x.ex ? `${x.ex.date ? S.fmtDate(x.ex.date) : "sans date"}${x.ex.approx ? ", date approximative" : ""}` : "vu, sans date"}</span></div></div>`; }).join("")}</div>
    ${l.length > 40 ? `<p class="mini discret">Et ${l.length - 40} autres.</p>` : ""}` : `<p class="pf-intro">Rien à compléter : tous tes visionnages ont leurs détails.</p>`;
  const c = $("[data-commencer]", z); if (c) c.onclick = () => S.completer(l, 0);
  $$("[data-i]", z).forEach(x => x.onclick = () => S.completer(l, +x.dataset.i));
}

// ------------------------------------------------------------------ réglages
function rubriqueCompte(z, e) {
  const c = e.compte || {};
  const nom = S.moi.profil.nom;
  if (c.connecte) {
    z.innerHTML = `<div class="aj-lignes">
        <div class="aj-ligne"><span>Identifiant</span><b>${esc(c.id)}</b></div>
        <div class="aj-ligne"><span>Nom affiché</span><b>${esc(nom)}</b></div>
        <div class="aj-ligne"><span>Connecté ici depuis</span><b>${c.depuis ? new Date(c.depuis * 1000).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" }) : "–"}</b></div></div>
      <p class="pf-intro" style="margin-top:12px">Tes pseudos Letterboxd et IMDb, ta clé Refract et ton jeton GitHub voyagent avec ton compte, chiffrés par ton mot de passe : sur un nouvel appareil, te connecter suffit.</p>
      <form class="compte-mdp" data-mdp><h4>Changer le mot de passe</h4>
        <label class="etiquette">Mot de passe actuel</label><input class="champ" name="ancien" type="password" autocomplete="current-password" required>
        <label class="etiquette">Nouveau mot de passe</label><input class="champ" name="nouveau" type="password" autocomplete="new-password" minlength="10" required>
        <label class="etiquette">Encore une fois</label><input class="champ" name="nouveau2" type="password" autocomplete="new-password" required>
        <p class="compte-erreur" data-erreur role="alert"></p>
        <button class="bouton" type="submit">Changer le mot de passe</button></form>
      <div class="toi-actions" style="margin-top:18px"><button data-deco>Se déconnecter de cet appareil</button></div>`;
    const f = $("[data-mdp]", z);
    f.onsubmit = async ev => {
      ev.preventDefault();
      const v = Object.fromEntries(new FormData(f).entries()), err = $("[data-erreur]", f);
      if (v.nouveau !== v.nouveau2) { err.textContent = "Les deux mots de passe ne sont pas identiques."; return; }
      try { await S.post("/api/compte/mot_de_passe", { ancien: v.ancien, nouveau: v.nouveau }); f.reset(); err.textContent = ""; S.toast("Mot de passe changé. Reconnecte-toi sur tes autres appareils."); }
      catch (er) { err.textContent = er.message; }
    };
    $("[data-deco]", z).onclick = async () => {
      if (!(await S.demander("Se déconnecter ?", "Tes films restent en ligne. Sur cet appareil, il faudra ton identifiant et ton mot de passe pour les retrouver.", "Se déconnecter", "Annuler"))) return;
      await S.post("/api/compte/deconnexion");
      await S.chargerEtat(); location.hash = "#/"; S.pages.choixProfil($("#vue"));
    };
    return;
  }
  z.innerHTML = `<p class="pf-intro">Ce profil (${esc(nom)}) n'a pas encore de compte : n'importe qui avec cet appareil peut l'ouvrir. Protège-le par un mot de passe pour le retrouver sur tes autres appareils en te connectant. L'identifiant reste <b>${esc(e.appareil.profil)}</b>, tes films ne bougent pas.</p>
    <form data-conv><label class="etiquette">Mot de passe</label><input class="champ" name="mot_de_passe" type="password" autocomplete="new-password" minlength="10" required>
      <label class="etiquette">Encore une fois</label><input class="champ" name="mot_de_passe2" type="password" autocomplete="new-password" required>
      <input type="hidden" name="identifiant" value="${esc(e.appareil.profil)}" autocomplete="username">
      <details class="compte-plus"><summary>Comptes reliés</summary>${S.champsRelies({ letterboxd_pseudo: e.plateformes?.lb?.pseudo, imdb_pseudo: e.plateformes?.imdb?.pseudo, imdb_watchlist: e.plateformes?.imdb?.watchlist })}
        <label class="compte-fichier">Remplir depuis un fichier de compte<input type="file" accept=".json,application/json" data-fichier hidden></label></details>
      <p class="compte-erreur" data-erreur role="alert"></p>
      <button class="bouton principal" type="submit">Créer mon compte</button></form>
    <form class="compte-mdp" data-cx><h4>Tu as déjà un compte ?</h4>
      <p class="pf-intro">Connecte-toi : tes films, tes pseudos Letterboxd et IMDb, ta clé Refract et ton jeton GitHub reviennent sur cet appareil.</p>
      <label class="etiquette">Identifiant</label><input class="champ" name="identifiant" autocomplete="username" autocapitalize="none" spellcheck="false" required>
      <label class="etiquette">Mot de passe</label><input class="champ" name="mot_de_passe" type="password" autocomplete="current-password" required>
      <label class="case"><input type="checkbox" name="garder_local" checked> Ajouter au compte les films de ce profil (${esc(nom)})</label>
      <p class="compte-erreur" data-erreur role="alert"></p>
      <button class="bouton" type="submit">Se connecter</button></form>`;
  const fcx = $("[data-cx]", z);
  fcx.onsubmit = async ev => {
    ev.preventDefault();
    const v = Object.fromEntries(new FormData(fcx).entries()), err = $("[data-erreur]", fcx);
    v.garder_local = !!v.garder_local;
    const b = fcx.querySelector("[type=submit]"); b.disabled = true; b.textContent = "Connexion…";
    try { await S.post("/api/compte/connexion", v); await S.chargerEtat(); S.chargerBase(true); S.toast("Connecté"); location.hash = "#/"; S.rafraichir(true); }
    catch (er) { err.textContent = er.message; b.disabled = false; b.textContent = "Se connecter"; }
  };
  const f = $("[data-conv]", z);
  $("[data-fichier]", f).onchange = ev => S.lireFichierCompte(ev.target, f);
  f.onsubmit = async ev => {
    ev.preventDefault();
    const v = Object.fromEntries(new FormData(f).entries()), err = $("[data-erreur]", f);
    if (v.mot_de_passe !== v.mot_de_passe2) { err.textContent = "Les deux mots de passe ne sont pas identiques."; return; }
    delete v.mot_de_passe2; delete v.identifiant; delete v.nom;
    try { await S.post("/api/compte/creer", { ...v, convertir: true }); S.toast("Compte créé"); S.rafraichir(true); }
    catch (er) { err.textContent = er.message === "inconnu" ? "Silencio a été mis à jour mais tourne encore avec l'ancienne version : ferme-le complètement et relance-le." : er.message; }
  };
}

// Letterboxd, IMDb (par l'extension Firefox) et Refract (par son API) : Silencio est la référence
function plateformes(z, e) {
  const P = e.plateformes || {};
  const quand = t => t ? new Date(t * 1000).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "jamais";
  const bloc = (p, intro, champs) => { const x = P[p] || {}; return `<div class="pf" data-pf="${p}">
      <h4>${x.nom}</h4><p class="pf-intro">${intro}</p>
      <div class="aj-lignes">${champs}
        <div class="aj-ligne"><span>À jour</span><b>${S.fmtNombre(x.envoye || 0)}</b></div>
        <div class="aj-ligne"><span>À envoyer</span><b>${x.depuis || p === "rf" ? S.fmtNombre(x.a_envoyer || 0) : "–"}${x.a_retirer ? `, dont ${x.a_retirer} à retirer` : ""}</b></div>
        <div class="aj-ligne"><span>Dernier passage</span><b>${x.passage ? `${quand(x.passage.quand)}${x.passage.echec ? `, ${x.passage.echec} échec${x.passage.echec > 1 ? "s" : ""}` : ""}` : "jamais"}</b></div>
      </div>
      ${p !== "rf" ? `<p class="pf-intro" style="margin-top:10px">${x.depuis ? `Relié depuis le ${quand(x.depuis)} : ` : "Dès le premier passage de l'extension, "}seuls tes ajouts et tes changements faits dans Silencio partent. Rien n'est jamais retiré de ${x.nom}.</p>` : ""}
      ${(x.a_envoyer || 0) > 0 ? `<details class="pf-echecs" data-attente="${p}"><summary>Voir ce qui attend (${S.fmtNombre(x.a_envoyer)})</summary><div data-attente-l>${S.chargement()}</div>
        <p class="pf-intro">Si ce sont des choses déjà présentes sur ${x.nom}, marque-les comme déjà envoyées : seuls tes ajouts suivants partiront.</p>
        <button class="lien-souligne" data-deja="${p}">Tout considérer comme déjà envoyé</button></details>` : ""}
      ${(x.echecs || []).length ? `<details class="pf-echecs"><summary>${x.echecs.length} opération${x.echecs.length > 1 ? "s" : ""} en échec</summary>${x.echecs.slice(0, 20).map(f => `<div><b>${esc(f.titre || f.cle)}</b><span>${esc(f.erreur || f.etat || "")}</span></div>`).join("")}<button class="lien-souligne" data-reessayer="${p}">Réessayer maintenant</button></details>` : ""}
    </div>`; };
  const rf = P.rf || {}, lb = P.lb || {}, im = P.imdb || {};
  z.innerHTML = `<p class="muet petit" style="margin-top:0">Silencio est la référence : ce que tu ajoutes, notes, retires ou ranges ici est recopié sur tes autres comptes. Les films cachés, les visionnages cachés, les listes privées et les critiques privées ne partent jamais.</p>
    ${bloc("rf", "Par l'API officielle de Refract, avec ta clé, toute seule, toutes les minutes : films vus, épisodes, watchlist et notes (arrondies à l'entier, de 1 à 10).", `
      <div class="aj-ligne"><span>Compte</span><b>${rf.connecte ? esc(rf.nom_compte || "relié") : "pas relié"}</b></div>
      <div class="aj-ligne aj-sous-ligne"><span>Clé personnelle</span><div><input class="aj-champ" data-rf-cle placeholder="${rf.connecte ? "•••• (enregistrée)" : "rfk_…"}" autocomplete="off"><div class="toi-actions" style="margin-top:4px"><button data-rf-ok>${rf.connecte ? "Changer la clé" : "Relier Refract"}</button>${rf.connecte ? `<button data-rf-off>Délier</button>` : ""}</div></div></div>
      ${rf.erreur ? `<p class="pf-alerte">${esc(rf.erreur)}</p>` : ""}`)}
    ${bloc("lb", "Par l'extension Silencio Sync dans Firefox, sur ton PC et ton téléphone, avec ta session Letterboxd déjà ouverte, discrètement : quelques actions à la fois, espacées.", `
      <div class="aj-ligne"><span>Ton pseudo Letterboxd</span><input class="aj-valeur" style="width:160px" data-lb-pseudo value="${esc(lb.pseudo || "")}" placeholder="pseudo"></div>
      <div class="aj-ligne"><span>Envoi</span><select class="aj-valeur" data-mode="lb">${[["auto", "automatique et discret"], ["clic", "un clic par action"], ["liens", "à la main, avec les liens"], ["coupe", "coupé"]].map(([k, l]) => `<option value="${k}" ${(P.modes || {}).lb === k ? "selected" : ""}>${l}</option>`).join("")}</select></div>
      <div class="aj-ligne"><span>Extension vue</span><b>${quand(e.plateformes?.extension_vue?.lb)}</b></div>`)}
    ${bloc("imdb", "Par la même extension, avec ta session IMDb. Ta watchlist Silencio va dans ta watchlist IMDb. IMDb n'autorise pas les robots sans accord écrit (et sa réponse n'en est pas un) : par défaut, l'extension prépare tout et c'est toi qui envoies chaque action d'un clic, depuis sa fenêtre.", `
      <div class="aj-ligne"><span>Ton pseudo IMDb</span><input class="aj-valeur" style="width:160px" data-im-pseudo value="${esc(im.pseudo || "")}" placeholder="pseudo"></div>
      <div class="aj-ligne aj-sous-ligne"><span>Ta watchlist IMDb</span><div><input class="aj-champ" data-im-wl value="${esc(im.watchlist || "")}" placeholder="https://www.imdb.com/user/…/watchlist">${im.watchlist ? `<div class="toi-actions" style="margin-top:4px"><a href="${esc(im.watchlist)}" target="_blank" rel="noopener">Ouvrir</a></div>` : ""}</div></div>
      <div class="aj-ligne"><span>Envoi</span><select class="aj-valeur" data-mode="imdb">${[["auto", "automatique et discret"], ["clic", "un clic par action"], ["liens", "à la main, avec les liens"], ["coupe", "coupé"]].map(([k, l]) => `<option value="${k}" ${(P.modes || {}).imdb === k ? "selected" : ""}>${l}</option>`).join("")}</select></div>
      <div class="aj-ligne"><span>Extension vue</span><b>${quand(e.plateformes?.extension_vue?.imdb)}</b></div>`)}
    <div class="pf" data-pf="tmdb">
      <h4>TMDB</h4><p class="pf-intro">Par l'API officielle de TMDB, tout seul : notes, coups de cœur, watchlist et listes, ajouts comme retraits.</p>
      <div class="aj-lignes">
        <div class="aj-ligne"><span>Compte</span><b>${e.appareil.tmdb.connecte ? esc(e.appareil.tmdb.nom || "relié") : "pas relié"}</b></div>
        <div class="aj-ligne"><span>À envoyer</span><b>${S.fmtNombre(e.file_tmdb?.attente || 0)}</b></div>
      </div>
      ${e.file_tmdb?.erreur ? `<p class="pf-alerte">${esc(e.file_tmdb.erreur)}</p>` : ""}
      <div class="toi-actions"><a href="#/reglages/tmdb">${e.appareil.tmdb.connecte ? "Gérer le compte TMDB" : "Relier TMDB"}</a></div>
    </div>
    <div class="pf">
      <h4>Extension Silencio Sync</h4>
      <p class="pf-intro">Colle ce code d'appairage dans l'extension, une seule fois par appareil.</p>
      <div class="aj-lignes"><div class="aj-ligne"><span>Code</span><b class="pf-jeton" data-jeton>${esc(P.jeton || "")}</b></div>
        <div class="aj-ligne"><span>Adresse de Silencio</span><b>${esc(location.origin)}</b></div></div>
      <div class="toi-actions"><a href="#/envois">Historique des envois</a><button data-copier>Copier le code</button><button data-nouveau-jeton>Nouveau code</button><a href="extension/LISEZMOI.html" target="_blank">Installer l'extension</a></div>
    </div>`;
  const enreg = async (corps, toast) => { try { await S.post("/api/reglages", corps); S.toast(toast); S.rafraichir(true); } catch (er) { S.toast(er.message); } };
  $("[data-rf-ok]", z).onclick = () => { const v = $("[data-rf-cle]", z).value.trim(); if (v) enreg({ refract_cle: v }, "Refract relié"); };
  const off = $("[data-rf-off]", z); if (off) off.onclick = () => { if (confirm("Délier Refract de Silencio ?")) enreg({ refract_cle: "" }, "Refract délié"); };
  $("[data-lb-pseudo]", z).onchange = ev => enreg({ letterboxd_pseudo: ev.target.value }, "Pseudo enregistré");
  $("[data-im-pseudo]", z).onchange = ev => enreg({ imdb_pseudo: ev.target.value }, "Pseudo enregistré");
  $("[data-im-wl]", z).onchange = ev => enreg({ imdb_watchlist: ev.target.value }, "Watchlist enregistrée");
  $$("[data-mode]", z).forEach(x => x.onchange = () => enreg({ modes_ext: { [x.dataset.mode]: x.value } }, "Envoi réglé"));
  $("[data-copier]", z).onclick = () => { navigator.clipboard?.writeText(P.jeton || "").then(() => S.toast("Code copié"), () => S.toast("Sélectionne le code pour le copier")); };
  $("[data-nouveau-jeton]", z).onclick = () => { if (confirm("Créer un nouveau code ? Il faudra le recoller dans l'extension sur chaque appareil.")) enreg({ nouveau_jeton: true }, "Nouveau code créé"); };
  $$("[data-attente]", z).forEach(d => d.addEventListener("toggle", async () => {
    if (!d.open || d.dataset.charge) return; d.dataset.charge = 1;
    try { const r = await S.api("/api/plateformes/attente?p=" + d.dataset.attente); $("[data-attente-l]", d).innerHTML = r.r.map(o => `<div><b>${esc(o.titre)}</b><span>${esc(o.quoi)}</span></div>`).join("") + (r.total > r.r.length ? `<div><span>et ${r.total - r.r.length} autres</span></div>` : ""); }
    catch (er) { $("[data-attente-l]", d).textContent = er.message; }
  }));
  $$("[data-deja]", z).forEach(b => b.onclick = async () => {
    if (!(await S.demander("Tout considérer comme déjà envoyé ?", "Ce qui attend ne partira pas. Seuls tes ajouts et changements faits à partir de maintenant partiront.", "Oui", "Annuler"))) return;
    await S.post("/api/plateformes/depart", { plateforme: b.dataset.deja, vide: false }); S.toast("C'est noté : seuls tes prochains ajouts partiront"); S.rafraichir(true);
  });
  $$("[data-reessayer]", z).forEach(b => b.onclick = async () => { await S.post("/api/plateformes/reessayer", { plateforme: b.dataset.reessayer }); S.toast("Nouvel essai au prochain passage"); S.rafraichir(true); });
}

P.reglages = async (vue, args, params) => {
  const e = await S.chargerEtat();
  const a = e.appareil, g = a.github, s = e.sync || {};
  if (params.tmdb === "ok") setTimeout(() => S.toast("Compte TMDB connecté"), 300);
  const corpsMail = encodeURIComponent(`Bonjour,\n\nJe développe Silencio, une application personnelle (non commerciale) de journal de films pour moi et quelques amis. J'aimerais l'accès à l'API Letterboxd pour synchroniser mon journal, mes notes et ma watchlist avec mon compte Letterboxd.\n\nUsage prévu : lecture et écriture de mon propre journal, de mes notes et de ma watchlist. Volume : quelques dizaines de requêtes par jour.\n\nMerci d'avance,\n${S.moi.profil.nom}`);
  vue.innerHTML = `<div class="entete"><h1>Réglages</h1></div>
  <div class="col" style="gap:14px;max-width:760px">
    <section class="carte" data-rub="compte" data-compte></section>
    <section class="carte" data-rub="affichage"><h3>Affichage</h3>
      <label class="etiquette">Titres affichés</label><div class="segments" data-titres><button data-v="fr">En français</button><button data-v="vo">En version originale</button></div>
      <div class="ligne-champ"><span class="libelle-champ" style="width:auto;flex:1">Sons</span><label class="interrupteur"><input type="checkbox" data-sons ${S.reglage("sons", true) !== false ? "checked" : ""}><span></span></label></div>
      <label class="etiquette">Tes abonnements (filtre « sur mes plateformes »)</label><div class="puces" data-plats>${S.chargement()}</div>
    </section>
    <section class="carte" data-rub="completer" data-completer></section>
    <section class="carte" data-rub="tmdb"><h3>TMDB</h3><p class="muet petit">Tes notes, ta watchlist, tes coups de cœur et tes listes de films sont recopiés sur ton compte TMDB (dès qu'il y a du réseau).</p>
      ${a.tmdb.connecte ? `<div class="flex"><span class="espace">Connecté : <b>${esc(a.tmdb.nom)}</b>${e.file_tmdb.attente ? `, ${e.file_tmdb.attente} modification(s) en attente` : ""}${e.file_tmdb.erreur ? `, <span style="color:var(--rouge)">${esc(e.file_tmdb.erreur)}</span>` : ""}</span><button class="bouton petit" data-tmdb-off>Déconnecter</button></div>` : `<button class="bouton principal" data-tmdb-on>Connecter mon compte TMDB</button>`}
    </section>
    <section class="carte" data-rub="plateformes" data-plateformes></section>
    <section class="carte" data-rub="test" data-test></section>
    <section class="carte" data-rub="importer"><h3>Importer ton historique</h3>
      <label class="etiquette">Letterboxd</label><div class="mini discret" style="margin-bottom:6px">Réglages Letterboxd → Import &amp; Export → Export your data : glisse le fichier .zip ici (journal, notes, critiques, listes, watchlist, likes).</div><input type="file" accept=".zip" data-imp="letterboxd" class="champ" style="padding-top:8px">
      <label class="etiquette">IMDb</label><div class="mini discret" style="margin-bottom:6px">Tes notes (Your ratings → Export) ou ta watchlist, en .csv.</div><input type="file" accept=".csv" data-imp="imdb" class="champ" style="padding-top:8px">
      <div class="flex" style="margin-top:12px;flex-wrap:wrap"><button class="bouton" data-imp-tmdb ${a.tmdb.connecte ? "" : "disabled"}>Importer depuis TMDB</button><button class="bouton" data-imp-tp>Importer un profil Twin Picks</button></div>
      <label class="case"><input type="checkbox" data-vers-tmdb ${a.tmdb.connecte ? "checked" : "disabled"}> Envoyer aussi les notes importées vers TMDB</label>
      <div data-taches></div>
    </section>
    <section class="carte" data-rub="amis"><h3>Synchronisation GitHub (amis et appareils)</h3>
      <p class="muet petit">Ton profil est enregistré dans un dépôt GitHub partagé avec tes amis : chacun écrit son fichier avec son propre compte, et lit ceux des autres. Hors ligne, tout est gardé et envoyé au retour du réseau.</p>
      <div class="flex" style="margin:6px 0"><span class="espace petit">${!s.active ? "Pas encore réglée" : s.erreur ? esc(s.erreur) : `Synchronisée${s.derniere ? " à " + new Date(s.derniere * 1000).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : ""}, ${S.pluriel(s.amis || 0, "ami")}`}</span>${s.active ? `<button class="bouton petit" data-sync>Maintenant</button>` : ""}</div>
      <div class="grille-2"><div><label class="etiquette">Dépôt (compte/nom)</label><input class="champ" data-g="depot" value="${esc(g.depot)}" placeholder="etienne/silencio"></div><div><label class="etiquette">Branche</label><input class="champ" data-g="branche" value="${esc(g.branche || "profils")}"></div></div>
      <label class="etiquette">Ton jeton GitHub (fine-grained, accès « Contents : read and write » à ce dépôt)</label><input class="champ" type="password" data-g="jeton" placeholder="${g.jeton ? "•••• (enregistré)" : "github_pat_…"}">
      ${e.compte?.connecte ? `<p class="mini discret">Tes films cachés et tes critiques privées sont chiffrés par le mot de passe de ton compte.</p><input type="hidden" data-g="phrase" value="">` : `<label class="etiquette">Phrase secrète (chiffre tes films cachés et critiques privées ; la même sur tous tes appareils)</label><input class="champ" type="password" data-g="phrase" placeholder="${g.phrase ? "•••• (enregistrée)" : "facultatif"}">`}
      <div class="flex" style="margin-top:12px"><button class="bouton principal" data-g-ok>Enregistrer</button>${s.active ? `<button class="bouton" data-versions>Historique des versions</button>` : ""}</div>
      <div data-versions-l></div>
    </section>
    <section class="carte" data-rub="historique"><h3>Historique et annulation</h3>
      ${(e.historique || []).length ? `<div class="lignes">${e.historique.slice(0, 12).map((h, i) => `<div class="ligne" style="padding:7px 2px"><div class="corps"><b style="font-weight:500">${esc(h.libelle)}</b><span>${new Date(h.quand * 1000).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span></div>${i === 0 ? `<button class="bouton petit" data-annuler>Annuler</button>` : ""}</div>`).join("")}</div>` : `<p class="mini discret">Rien à annuler depuis le lancement. (Raccourci : <b>z</b>.)</p>`}
      <p class="mini discret">Chaque modification envoyée sur GitHub est aussi gardée dans l'historique du dépôt (bouton « Historique des versions »).</p>
    </section>
    <section class="carte" data-rub="exporter"><h3>Fichiers</h3><div class="flex" style="flex-wrap:wrap"><a class="bouton" href="/api/export/letterboxd.csv" download target="_blank">Journal au format Letterboxd</a><a class="bouton" href="/api/export/watchlist.csv" download target="_blank">Watchlist au format Letterboxd</a><a class="bouton" href="/api/export/silencio.json" download target="_blank">Tout exporter (JSON)</a></div></section>
    <section class="carte" data-rub="avance"><h3>Données</h3>
      <p class="petit muet">Notes IMDb : ${e.imdb.present ? `fichier du ${new Date(e.imdb.date * 1000).toLocaleDateString("fr-FR")}` : e.imdb.en_cours ? "téléchargement en cours…" : "pas encore téléchargé"}${e.imdb.erreur ? `, <span style="color:var(--rouge)">${esc(e.imdb.erreur)}</span>` : ""}</p>
      <button class="bouton petit" data-imdb>Mettre à jour les notes IMDb</button>
      ${/Windows/i.test(navigator.userAgent) ? `<label class="etiquette">Raccourci</label><p class="petit muet" style="margin-top:0">Crée le raccourci « Silencio » sur le bureau et dans le menu Démarrer.</p><button class="bouton petit" data-raccourci>Créer le raccourci</button>` : ""}
      <label class="etiquette">Clé API TMDB personnelle (facultatif)</label><div class="flex"><input class="champ" data-cle placeholder="${a.cle_tmdb ? "•••• (enregistrée)" : "par défaut : la clé de Silencio"}"><button class="bouton" data-cle-ok>OK</button></div>
    </section>
    <section class="carte" data-rub="avance"><h3>Raccourcis clavier</h3><dl class="tableau-infos petit"><dt>n</dt><dd>Ajouter un visionnage</dd><dt>/</dt><dd>Recherche</dd><dt>1 … 0, puis « . »</dt><dd>Note (dans l'ajout) : 8 puis . = 7,5</dd><dt>Entrée</dt><dd>Valider l'ajout</dd><dt>h, j, s</dt><dd>Accueil, Journal, Stats</dd><dt>z</dt><dd>Annuler la dernière action</dd><dt>Échap</dt><dd>Fermer</dd></dl></section>
    <p class="mini discret centre" data-rub="avance">Silencio ${esc(e.app)}, données TMDB (ce produit utilise l'API TMDB sans être approuvé ni certifié par TMDB), notes IMDb : datasets.imdbws.com, prix : Wikidata, plateformes : JustWatch</p>
  </div>`;
  const RUBS = [["compte", e.compte?.connecte ? "Compte" : "Compte : se connecter ou en créer un", "moi"], ["affichage", "Affichage", "reglages"], ["plateformes", "Letterboxd, IMDb, Refract, TMDB", "sync"], ["test", "Tester la synchro", "sync"], ["tmdb", "Compte TMDB", "sync"], ["amis", "Amis et synchro", "amis"], ["importer", "Importer", "plus"], ["completer", "Compléter tes films importés", "plus"], ["exporter", "Exporter", "lien"], ["historique", "Historique", "annuler"], ["avance", "Avancé", "info"]];
  const rub = args[0];
  $$("[data-rub]", vue).forEach(x => x.classList.toggle("cache", x.dataset.rub !== rub));
  if (!rub) $(".col", vue).insertAdjacentHTML("afterbegin", `<div class="lignes menu-reglages">${RUBS.map(([k, l, i]) => `<a class="ligne" href="#/reglages/${k}"><div class="corps"><b>${l}</b></div></a>`).join("")}</div>`);
  else $(".entete h1", vue).insertAdjacentHTML("beforebegin", `<a class="fil" href="#/reglages">Réglages</a>`), $(".entete h1", vue).textContent = RUBS.find(r => r[0] === rub)?.[1] || "Réglages";
  if (rub === "plateformes") plateformes($("[data-plateformes]", vue), e);
  if (rub === "test") rubriqueTest($("[data-test]", vue));
  if (rub === "compte") rubriqueCompte($("[data-compte]", vue), e);
  if (rub === "completer") rubriqueCompleter($("[data-completer]", vue));
  $("[data-sons]", vue).onchange = ev => S.agir("profil", { champs: { reglages: { sons: ev.target.checked } } }, { toast: ev.target.checked ? "Sons activés" : "Sons coupés", sansAnnuler: true });
  if (rub === "affichage") S.api("/api/fournisseurs_liste").then(d => {
    const miennes = new Set(S.reglage("plateformes", []) || []);
    const z = $("[data-plats]", vue);
    z.innerHTML = (d.results || []).sort((a, b) => (a.display_priorities?.FR ?? 99) - (b.display_priorities?.FR ?? 99)).slice(0, 24).map(p => `<button class="puce ${miennes.has(p.provider_id) ? "actif" : ""}" data-plat="${p.provider_id}">${esc(p.provider_name)}</button>`).join("");
    $$("[data-plat]", z).forEach(b => b.onclick = () => { const id = +b.dataset.plat; miennes.has(id) ? miennes.delete(id) : miennes.add(id); b.classList.toggle("actif"); S.memo.dispo = null; S.agir("profil", { champs: { reglages: { plateformes: [...miennes] } } }, { toast: false, sansRendu: true }); });
  }).catch(() => $("[data-plats]", vue).innerHTML = `<span class="mini discret">Hors ligne</span>`);
  $$("[data-titres] button", vue).forEach(b => { b.classList.toggle("actif", S.reglage("titres", "fr") === b.dataset.v); b.onclick = () => S.agir("profil", { champs: { reglages: { titres: b.dataset.v } } }, { toast: b.dataset.v === "vo" ? "Titres en version originale" : "Titres en français" }); });
  const on = $("[data-tmdb-on]", vue); if (on) on.onclick = async () => { try { const r = await S.api("/api/tmdb/connexion"); location.href = r.url; } catch (er) { S.toast(er.horsLigne ? "Hors ligne" : er.message); } };
  const off = $("[data-tmdb-off]", vue); if (off) off.onclick = async () => { await S.post("/api/tmdb/deconnexion"); S.rafraichir(true); };
  $("[data-g-ok]", vue).onclick = async () => { const v = k => $(`[data-g="${k}"]`, vue).value; await S.post("/api/reglages", { github: { depot: v("depot"), branche: v("branche"), jeton: v("jeton") || null, phrase: v("phrase") || null } }); S.toast("Synchro enregistrée"); setTimeout(() => S.rafraichir(true), 2500); };
  const sy = $("[data-sync]", vue); if (sy) sy.onclick = async () => { await S.post("/api/sync"); S.toast("Synchronisation…"); setTimeout(() => S.rafraichir(true), 3000); };
  const ver = $("[data-versions]", vue); if (ver) ver.onclick = async () => {
    const z = $("[data-versions-l]", vue); z.innerHTML = S.chargement();
    try { const r = await S.api("/api/github/versions"); z.innerHTML = `<div class="lignes" style="margin-top:10px">${r.r.map(c => `<div class="ligne" style="padding:6px 2px"><div class="corps"><b style="font-weight:500">${new Date(c.date).toLocaleString("fr-FR", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</b><span>${esc(c.message)}</span></div><button class="bouton petit" data-sha="${c.sha}">Revenir ici</button></div>`).join("")}</div>`; $$("[data-sha]", z).forEach(b => b.onclick = async () => { if (!confirm("Revenir à cette version de ton profil ? (tes films cachés ne sont pas touchés)")) return; await S.post("/api/github/restaurer", { sha: b.dataset.sha }); await S.chargerEtat(); S.chargerBase(true); S.toast("Profil restauré"); S.rafraichir(true); }); }
    catch (er) { z.innerHTML = `<p class="mini" style="color:var(--rouge)">${esc(er.message)}</p>`; }
  };
  const an = $("[data-annuler]", vue); if (an) an.onclick = () => S.agir("annuler", {}, { toast: "Annulé" });
  const rac = $("[data-raccourci]", vue); if (rac) rac.onclick = async () => { try { const r = await S.post("/api/raccourci"); S.toast("Raccourci créé sur le bureau et dans le menu Démarrer"); } catch (er) { S.toast(er.message); } };
  $("[data-imdb]", vue).onclick = async () => { await S.post("/api/imdb/maj"); S.toast("Téléchargement des notes IMDb lancé"); };
  $("[data-cle-ok]", vue).onclick = async () => { await S.post("/api/reglages", { cle_tmdb: $("[data-cle]", vue).value }); S.toast("Clé enregistrée"); };
  // imports
  const suivre = async (tid, nom) => {
    const z = $("[data-taches]", vue);
    const ligne = el(`<div class="carte serree" style="margin-top:10px"><b>${esc(nom)}</b><div class="jauge" style="margin:8px 0"><i style="width:2%"></i></div><div class="mini muet" data-t>Démarrage…</div></div>`); z.prepend(ligne);
    while (true) {
      await new Promise(r => setTimeout(r, 900));
      let t; try { t = await S.api("/api/tache/" + tid); } catch { continue; }
      $("i", ligne).style.width = (t.total ? 100 * t.fait / t.total : 5) + "%";
      $("[data-t]", ligne).textContent = t.erreur || (t.fini ? `Terminé : ${t.resultat ? `${t.resultat.films} titres, ${t.resultat.journal} visionnages, ${t.resultat.watchlist} en watchlist, ${t.resultat.listes} listes` : ""}${t.non_trouves.length ? `, ${t.non_trouves.length} non reconnus : ${t.non_trouves.slice(0, 12).join(", ")}${t.non_trouves.length > 12 ? "…" : ""}` : ""}` : `${t.fait}/${t.total} titres reconnus…`);
      if (t.fini) { if (!t.erreur) { await S.chargerEtat(); S.chargerBase(true).catch(() => {}); } break; }
    }
  };
  const versTmdb = () => $("[data-vers-tmdb]", vue).checked ? "?vers_tmdb=1" : "";
  $$("[data-imp]", vue).forEach(inp => inp.onchange = async () => {
    const f = inp.files[0]; if (!f) return;
    try { const r = await S.post(`/api/import/${inp.dataset.imp}${versTmdb()}`, await f.arrayBuffer(), true); suivre(r.tache, `Import ${inp.dataset.imp === "imdb" ? "IMDb" : "Letterboxd"} (${f.name})`); } catch (er) { S.toast(er.message); }
    inp.value = "";
  });
  $("[data-imp-tmdb]", vue).onclick = async () => { const r = await S.post("/api/import/tmdb", {}); suivre(r.tache, "Import TMDB"); };
  $("[data-imp-tp]", vue).onclick = async () => {
    const d = await S.api("/api/profils");
    const corps = el(`<div>${d.twin_picks.length ? `<p class="muet petit" style="margin-top:0">Profils trouvés dans ${esc(d.chemin_twin_picks)} :</p>${d.twin_picks.map(p => `<button class="choix-profil" data-id="${esc(p.id)}">${S.avatar(p.id, p.nom)}<span class="espace"><b>${esc(p.nom)}</b><br><span class="mini discret">${S.pluriel(p.nb, "film noté", "films notés")}</span></span></button>`).join("")}` : `<p class="muet petit" style="margin-top:0">Fichier profils.json de Twin Picks introuvable à côté de Silencio. Indique son chemin :</p>`}<label class="etiquette">Chemin du fichier profils.json</label><div class="flex"><input class="champ" data-chemin value="${esc(d.chemin_twin_picks || "")}" placeholder="C:\\…\\twin_picks\\profils.json"><button class="bouton" data-ch-ok>OK</button></div></div>`);
    S.ouvrirModale({ titre: "Profils Twin Picks", corps });
    $$("[data-id]", corps).forEach(b => b.onclick = async () => { S.fermerModale(); const r = await S.post("/api/import/twinpicks" + versTmdb(), { id: b.dataset.id, chemin: d.chemin_twin_picks }); suivre(r.tache, "Import Twin Picks"); });
    $("[data-ch-ok]", corps).onclick = async () => { await S.post("/api/reglages", { twin_picks: $("[data-chemin]", corps).value.trim() }); S.fermerModale(); setTimeout(() => $("[data-imp-tp]", vue).click(), 350); };
  };
};
})();

// ------------------------------------------------------------------ historique des envois
(() => {
const S = window.Silencio, P = S.pages;
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const NOMS = { lb: "Letterboxd", imdb: "IMDb", rf: "Refract", tmdb: "TMDB" };
const QUOI = { vu: "visionnage", note: "note", like: "coup de cœur", wl: "watchlist", fav: "watchlist", marque: "vu", critique: "critique", liste: "liste", item: "liste", ep: "épisode" };
P.envois = async (vue, args, params) => {
  const f = params.p || "";
  vue.innerHTML = `<a class="fil" href="#/reglages/plateformes">Réglages</a><div class="entete"><h1>Historique des envois</h1></div>
    <div class="segments" data-filtre style="margin-bottom:14px">${[["", "Tout"], ["lb", "Letterboxd"], ["imdb", "IMDb"], ["rf", "Refract"], ["tmdb", "TMDB"], ["echec", "Erreurs"]].map(([k, l]) => `<button data-v="${k}" class="${k === f ? "actif" : ""}">${l}</button>`).join("")}</div>
    <div data-l>${S.chargement()}</div>`;
  $("[data-filtre]", vue).onclick = e => { const b = e.target.closest("[data-v]"); if (b) location.hash = "#/envois" + (b.dataset.v ? "?p=" + b.dataset.v : ""); };
  let d; try { d = await S.api("/api/envois"); } catch (er) { $("[data-l]", vue).innerHTML = S.vide("Indisponible", esc(er.message)); return; }
  const l = d.r.filter(e => !f || (f === "echec" ? e.etat === "echec" : e.p === f));
  let jour = "", html = "";
  for (const e of l) {
    const j = new Date(e.t * 1000).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" });
    if (j !== jour) { jour = j; html += `<div class="mois-titre">${esc(j)}</div>`; }
    const etat = e.etat === "ok" || e.etat === "deja" ? "ok" : e.etat === "manuel" ? "clic" : "erreur";
    const m = e.film ? S.info(e.film) || {} : {};
    html += `<${e.film ? `a href="#/titre/${e.film}"` : "div"} class="ligne envoi">${S.iconePlateforme ? S.iconePlateforme(e.p, NOMS[e.p] || e.p, etat, e.erreur) : ""}
      <div class="corps"><b>${esc(e.titre || S.nomTitre(m) || e.cle)}</b><span>${e.action === "retirer" ? "retiré" : "envoyé"} : ${esc(QUOI[e.sorte] || e.sorte)}${e.etat === "deja" ? ", déjà là" : ""}${e.erreur ? `, <em class="envoi-err">${esc(e.erreur)}</em>` : ""}</span></div>
      <time>${new Date(e.t * 1000).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}</time></${e.film ? "a" : "div"}>`;
  }
  $("[data-l]", vue).innerHTML = html ? `<div class="lignes">${html}</div>` : S.vide("Rien pour l'instant", "Chaque envoi vers Letterboxd, IMDb, Refract et TMDB apparaîtra ici.");
};
})();

// ------------------------------------------------------------------ tester la synchro
function rubriqueTest(z) {
  const S = window.Silencio;
  const $ = (q, r = document) => r.querySelector(q);
  const esc = x => String(x ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const LIB = { ok: "OK", attention: "À voir", erreur: "Erreur", info: "Info", saute: "Sauté" };
  z.innerHTML = `<p class="petit muet" style="margin-top:0">Vérifie une à une les pièces qui envoient tes films ailleurs : GitHub, TMDB et Refract depuis Silencio, puis Letterboxd et IMDb depuis l'extension dans Firefox. Le rapport se copie en un clic pour être recollé tel quel.</p>
    <p class="petit muet">Chaque appareil a son propre Silencio et sa propre extension : lance le test sur ton PC, puis sur ton téléphone (Firefox ouvert dans les deux cas).</p>
    <div class="flex" style="flex-wrap:wrap;margin-top:10px"><button class="bouton principal" data-lancer="0">Test rapide</button><button class="bouton" data-lancer="1">Test complet</button></div>
    <p class="mini discret" style="margin-top:8px">Rapide : lectures seulement, rien n'est modifié. Complet : sur un film témoin absent de ton profil, chaque envoi (watchlist, note, coup de cœur, journal) est fait puis aussitôt défait, partout.</p>
    <div data-res></div>`;
  let minuteur = null;
  const peindre = r => {
    const res = $("[data-res]", z);
    if (!r) { res.innerHTML = ""; return; }
    const sections = [...r.sections, ...((r.ext && r.ext.sections) || [])];
    const tout = sections.flatMap(s => s.lignes);
    const n = k => tout.filter(l => l.etat === k).length;
    const ext = r.ext ? "" : r.attente_ext === "muette"
      ? `<div class="diag-attente erreur"><b>L'extension n'a pas répondu.</b> Firefox est-il ouvert sur cet appareil, avec Silencio Sync 1.11.0 et le code d'appairage ? Tu peux aussi ouvrir la fenêtre de l'extension : le test démarre à son prochain passage (dans la minute).</div>`
      : `<div class="diag-attente">${r.attente_ext === "recu" ? "L'extension fait sa part du test dans Firefox…" : "En attente de l'extension dans Firefox (elle répond dans la minute)…"}</div>`;
    res.innerHTML = `<div class="diag-tete"><b>${esc(r.appareil.nom)}</b> <span class="muet">${esc(r.appareil.detail)}</span>
        <span class="espace"></span><span class="diag-bilan">${n("ok")} OK, ${n("attention")} à voir, ${n("erreur")} erreur${n("erreur") > 1 ? "s" : ""}</span></div>
      ${r.fini_serveur ? "" : `<div class="diag-attente">Silencio teste ses envois…</div>`}
      ${sections.map(s => `<div class="diag-sec"><h4>${esc(s.nom)}</h4>${s.lignes.map(l => `<div class="diag-l"><span class="diag-e" data-e="${l.etat}">${LIB[l.etat] || l.etat}</span><div><div>${esc(l.texte)}</div>${l.detail ? `<div class="mini discret">${esc(l.detail)}</div>` : ""}</div></div>`).join("")}</div>`).join("")}
      ${ext}
      ${r.fini ? `<label class="etiquette">Rapport à copier</label><textarea class="champ diag-texte" readonly rows="8">${esc(r.texte)}</textarea>
        <div class="flex" style="flex-wrap:wrap;margin-top:8px"><button class="bouton principal" data-copier>Copier le rapport</button>${navigator.share ? `<button class="bouton" data-partager>Partager</button>` : ""}</div>` : ""}`;
    const t = $(".diag-texte", res);
    const copier = $("[data-copier]", res);
    if (copier) copier.onclick = async () => {
      try { await navigator.clipboard.writeText(r.texte); S.toast("Rapport copié"); }
      catch { t.focus(); t.select(); try { document.execCommand("copy"); S.toast("Rapport copié"); } catch { S.toast("Sélectionne le texte et copie-le"); } }
    };
    const part = $("[data-partager]", res);
    if (part) part.onclick = () => navigator.share({ title: "Rapport Silencio", text: r.texte }).catch(() => {});
  };
  const suivre = async () => {
    clearTimeout(minuteur);
    if (!document.body.contains(z)) return;
    let d; try { d = await S.api("/api/diagnostic"); } catch { minuteur = setTimeout(suivre, 4000); return; }
    peindre(d.etat);
    z.querySelectorAll("[data-lancer]").forEach(b => b.disabled = !!(d.etat && !d.etat.fini));
    if (d.etat && !d.etat.fini) minuteur = setTimeout(suivre, 2000);
  };
  z.querySelectorAll("[data-lancer]").forEach(b => b.onclick = async () => {
    const complet = b.dataset.lancer === "1";
    if (complet && !(await S.demander("Lancer le test complet ?", "Pendant une à deux minutes, un film témoin absent de ton profil est ajouté puis retiré de ta watchlist, noté puis dé-noté, et une entrée de journal datée d'aujourd'hui est créée puis supprimée, sur chaque plateforme reliée. Tes amis peuvent l'apercevoir dans ton activité Letterboxd pendant ce court moment.", "Lancer", "Annuler"))) return;
    try { await S.post("/api/diagnostic", { complet }); } catch (x) { S.toast(x.message); return; }
    suivre();
  });
  suivre();
}
