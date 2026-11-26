/* Silencio — éléments d'interface : note (anneau + rangée 1 à 10), sons, couleurs par page, ajout d'un visionnage. */
(function () {
"use strict";
const S = window.Silencio;
const { $, $$, esc, ico, el } = S;

// ------------------------------------------------------------------ couleurs selon la page
const ROUGE = new Set(["profil", "journal", "annee", "mois", "wrapped"]);
S.theme = nom => {
  document.body.dataset.theme = nom === "titre" ? "film" : ROUGE.has(nom) ? "rouge" : "bleu";
  if (nom !== "titre") { document.body.style.removeProperty("--accent-film"); document.body.style.removeProperty("--accent-film-fort"); }
};
// une couleur d'affiche, éclaircie pour rester lisible sur fond sombre
S.accentLisible = ([r, g, b]) => {
  const l = (Math.max(r, g, b) + Math.min(r, g, b)) / 510;
  const f = l < .62 ? .62 / Math.max(l, .05) : 1;
  return [r, g, b].map(v => Math.round(Math.min(255, v * f + (f > 1 ? 18 : 0))));
};

// ------------------------------------------------------------------ sons (synthèse WebAudio, rien à télécharger)
let ctx = null;
const contexte = () => { if (!ctx) { try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { ctx = null; } } if (ctx && ctx.state === "suspended") ctx.resume(); return ctx; };
const actif = () => S.reglage("sons", true) !== false;
function note(freq, debut, duree, volume = .12, type = "sine") {
  const c = contexte(); if (!c) return;
  const t = c.currentTime + debut;
  const o = c.createOscillator(), g = c.createGain(), f = c.createBiquadFilter();
  o.type = type; o.frequency.value = freq;
  f.type = "lowpass"; f.frequency.value = 2400;
  g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(volume, t + .012); g.gain.exponentialRampToValueAtTime(.0008, t + duree);
  o.connect(f); f.connect(g); g.connect(c.destination); o.start(t); o.stop(t + duree + .05);
}
const GAMME = [261.63, 293.66, 329.63, 392, 440, 523.25, 587.33, 659.25, 783.99, 880, 1046.5];   // pentatonique
S.son = (type, valeur) => {
  if (!actif()) return;
  if (type === "note") {                              // un son qui monte avec la note
    const i = Math.max(0, Math.min(10, Math.round(valeur || 0)));
    note(GAMME[i], 0, .5, .11, "triangle"); note(GAMME[i] * 2, .015, .35, .03);
  } else if (type === "ajout") {                      // validation : deux notes
    note(523.25, 0, .4, .1, "triangle"); note(783.99, .09, .6, .1, "triangle"); note(1046.5, .09, .5, .025);
  } else if (type === "carte") {                      // Wrapped : un accord qui change à chaque carte
    const accords = [[261.63, 329.63, 392], [220, 261.63, 329.63], [174.61, 220, 261.63], [196, 246.94, 293.66]];
    const a = accords[(valeur || 0) % accords.length];
    a.forEach((f, k) => { note(f, k * .06, 1.6, .045, "sine"); note(f * 2, .3 + k * .12, .5, .02, "triangle"); });
  } else if (type === "fin") {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, k) => note(f, k * .08, .8, .06, "triangle"));
  }
};

// ------------------------------------------------------------------ la note : rangée 1 à 10 (un appui = la note, deux appuis rapides = moins 0,5)
S.rangee = (valeur, onChange, o = {}) => {
  const w = el(`<div class="rangee-note ${o.grande ? "grande" : ""}" role="radiogroup" aria-label="Ta note">${Array.from({ length: 10 }, (_, i) => `<button type="button" class="case-note" data-n="${i + 1}" aria-label="${i + 1}">${i + 1}</button>`).join("")}<button type="button" class="effacer-note" aria-label="Retirer la note">${ico("x")}</button></div>`);
  let v = valeur ?? null, dernier = { n: 0, t: 0 }, minuteur = null;
  const peindre = () => {
    $$(".case-note", w).forEach(b => { const n = +b.dataset.n; b.classList.toggle("pleine", v != null && n <= v); b.classList.toggle("moitie", v != null && n === Math.ceil(v) && v % 1 !== 0); });
    $(".effacer-note", w).style.visibility = v == null ? "hidden" : "visible";
  };
  const changer = nv => { v = nv; peindre(); S.son("note", v); clearTimeout(minuteur); minuteur = setTimeout(() => onChange && onChange(v), o.delai ?? 380); };
  $$(".case-note", w).forEach(b => b.addEventListener("click", () => {
    const n = +b.dataset.n, t = Date.now();
    const double = dernier.n === n && t - dernier.t < 400;
    dernier = { n, t: double ? 0 : t };
    changer(double ? n - .5 : n);
    b.classList.remove("rebond"); void b.offsetWidth; b.classList.add("rebond");
  }));
  $(".effacer-note", w).onclick = () => { v = null; peindre(); clearTimeout(minuteur); onChange && onChange(null); };
  w.fixer = x => { v = x; peindre(); };
  w.valeur = () => v;
  peindre();
  return w;
};

// ------------------------------------------------------------------ l'anneau (page du film) : toucher → la rangée apparaît
S.anneau = (valeur, onChange, o = {}) => {
  const R = 44, C = 2 * Math.PI * R;
  const w = el(`<div class="anneau-bloc"><button type="button" class="anneau" aria-label="Ta note"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="${R}" class="fond-anneau"/><circle cx="50" cy="50" r="${R}" class="plein-anneau" stroke-dasharray="${C}" stroke-dashoffset="${C}"/></svg><span class="chiffre-anneau"></span><span class="sous-anneau">${o.libelle || "ta note"}</span></button><div class="zone-rangee"></div></div>`);
  let v = valeur ?? null;
  const peindre = (anim = true) => {
    const c = $(".plein-anneau", w); if (!anim) c.style.transition = "none";
    c.style.strokeDashoffset = v == null ? C : C * (1 - v / 10);
    if (!anim) requestAnimationFrame(() => c.style.transition = "");
    $(".chiffre-anneau", w).textContent = v == null ? "–" : S.fmtNote(v);
    w.classList.toggle("vide", v == null && !w.dataset.touche);
  };
  if (o.lecture) { $(".anneau", w).disabled = true; peindre(false); requestAnimationFrame(() => peindre()); return w; }
  const rangee = S.rangee(v, nv => { w.dataset.touche = 1; v = nv; peindre(); onChange && onChange(nv); }, { delai: 450 });
  rangee.addEventListener("click", () => { w.classList.add("ouvert"); v = rangee.valeur(); peindre(); $(".anneau", w).classList.remove("pop"); void w.offsetWidth; $(".anneau", w).classList.add("pop"); });
  $(".zone-rangee", w).append(rangee);
  $(".anneau", w).onclick = () => w.classList.toggle("ouvert");
  w.fixer = x => { v = x; rangee.fixer(x); peindre(); };
  peindre(false); requestAnimationFrame(() => requestAnimationFrame(() => peindre()));
  return w;
};

// ------------------------------------------------------------------ logos des plateformes de notes (dessinés, sans texte autour)
S.LOGOS = {
  imdb: `<svg class="logo-plateforme" viewBox="0 0 64 32" aria-label="IMDb"><rect width="64" height="32" rx="5" fill="#f5c518"/><text x="32" y="22.5" text-anchor="middle" font-family="Arial Black, Arial, sans-serif" font-weight="900" font-size="17" fill="#000">IMDb</text></svg>`,
  tmdb: `<svg class="logo-plateforme" viewBox="0 0 64 32" aria-label="TMDB"><defs><linearGradient id="gt" x1="0" x2="1"><stop offset="0" stop-color="#90cea1"/><stop offset=".55" stop-color="#3cbec9"/><stop offset="1" stop-color="#00b3e5"/></linearGradient></defs><rect width="64" height="32" rx="16" fill="#0d253f"/><text x="32" y="21.5" text-anchor="middle" font-family="Arial, sans-serif" font-weight="800" font-size="15" fill="url(#gt)">TMDB</text></svg>`,
  amis: `<svg class="logo-plateforme rond" viewBox="0 0 32 32" aria-label="Amis"><circle cx="16" cy="16" r="16" fill="#3a1d3a"/><circle cx="12" cy="13" r="4" fill="#ffc5e3"/><circle cx="21" cy="14" r="3.2" fill="#ffc5e3" opacity=".7"/><path d="M5 25c1.3-4 4-6 7-6s5.7 2 7 6z" fill="#ffc5e3"/></svg>`,
};

// ------------------------------------------------------------------ les plateformes de streaming : ouvrir le titre directement
const RECHERCHE_PLATEFORMES = {
  8: q => `https://www.netflix.com/search?q=${q}`, 119: q => `https://www.primevideo.com/search/ref=atv_nb_sug?phrase=${q}`,
  337: q => `https://www.disneyplus.com/search?q=${q}`, 381: q => `https://www.canalplus.com/recherche/?q=${q}`,
  11: q => `https://mubi.com/fr/search/films?query=${q}`, 234: q => `https://www.arte.tv/fr/search/?q=${q}`,
  1899: q => `https://play.max.com/search?q=${q}`, 350: q => `https://tv.apple.com/fr/search?term=${q}`,
  531: q => `https://www.paramountplus.com/fr/search/?q=${q}`, 236: q => `https://www.france.tv/recherche/?q=${q}`,
  283: q => `https://www.crunchyroll.com/fr/search?q=${q}`, 2: q => `https://tv.apple.com/fr/search?term=${q}`,
  3: q => `https://play.google.com/store/search?q=${q}&c=movies`, 192: q => `https://www.youtube.com/results?search_query=${q}`,
};
S.lienPlateforme = (id, titre, secours) => (RECHERCHE_PLATEFORMES[id] ? RECHERCHE_PLATEFORMES[id](encodeURIComponent(titre)) : secours);

// ------------------------------------------------------------------ dates partielles (« 2019 », « 2019-03 », « 2019-03-12 »)
S.fmtDateP = (d, court) => !d ? "" : d.length === 4 ? d : d.length === 7 ? S.fmtDate(d, court) : S.fmtDate(d, court);

// ------------------------------------------------------------------ ajout d'un visionnage
S.ouvrirAjout = (cle, ex) => {
  const corps = el(`<div></div>`);
  const m = S.ouvrirModale({ titre: ex ? "Modifier" : "Ajouter", corps, pied: null });
  if (cle) return formulaire(m, corps, cle, ex);
  corps.innerHTML = `<input class="champ champ-grand" type="search" placeholder="Titre d'un film ou d'une série" autocomplete="off" enterkeyhint="search"><div class="res-recherche" style="margin-top:10px"></div>`;
  const champ = $("input", corps), res = $(".res-recherche", corps);
  let sel = 0, cles = [];
  const peindre = () => $$(".ligne", res).forEach((l, i) => l.classList.toggle("sel", i === sel));
  const afficher = liste => {
    cles = liste;
    res.innerHTML = liste.map(c => { const mm = S.info(c) || {}; const t = S.monTitre(c); return `<div class="ligne" data-cle="${c}">${S.affiche(mm, { taille: "w154" })}<div class="corps"><b>${esc(S.nomTitre(mm))}</b><span>${[mm.a, c[0] === "t" ? "Série" : ""].filter(Boolean).join(" · ")}</span></div>${t.note != null ? `<span class="note-txt">${S.fmtNote(t.note)}</span>` : t.vu ? `<span class="discret">${ico("ok")}</span>` : ""}</div>`; }).join("");
    sel = 0; peindre();
    $$(".ligne", res).forEach(l => l.onclick = () => formulaire(m, corps, l.dataset.cle));
  };
  const chercher = S.debounce(async () => {
    const q = champ.value.trim(); if (!q) return afficher([]);
    const locaux = S.rechercheLocale(q, 4); afficher(locaux);
    try { const r = await S.rechercheTMDB(q); afficher([...new Set([...locaux, ...r.map(x => S.retenir(x)).filter(Boolean)])].slice(0, 12)); } catch { /* hors ligne */ }
  }, 160);
  champ.addEventListener("input", chercher);
  champ.addEventListener("keydown", e => {
    if (e.key === "ArrowDown") { sel = Math.min(cles.length - 1, sel + 1); peindre(); e.preventDefault(); }
    if (e.key === "ArrowUp") { sel = Math.max(0, sel - 1); peindre(); e.preventDefault(); }
    if (e.key === "Enter" && cles[sel]) { e.preventDefault(); formulaire(m, corps, cles[sel]); }
  });
  champ.focus({ preventScroll: true }); setTimeout(() => champ.focus({ preventScroll: true }), 80);
};

function formulaire(modale, corps, cle, ex) {
  const m = S.info(cle) || {};
  const t = S.monTitre(cle);
  const dejaVu = !!(t.vu || S.journalDe(cle).length);
  const e = Object.assign({ cle, date: S.aujourdhui(), note: t.note ?? null, coeur: !!t.coeur, revision: dejaVu, critique: "", critique_privee: false, prive: false, ou: null, prix: null, avec: [], version: "" }, ex || {});
  const detail = Object.assign({}, t.detail || {});
  $("h2", modale).textContent = ex ? "Modifier" : "J'ai vu";
  const mesCinemas = [...new Map(Object.values(S.vivants(S.moi.journal)).filter(j => j.ou?.type === "cinema" && j.ou.cinema).sort((a, b) => (b.date || "").localeCompare(a.date || "")).map(j => [j.ou.cinema, j.ou])).values()].slice(0, 6);
  const precisionInit = e.date.length === 4 ? "annee" : e.date.length === 7 ? "mois" : "jour";
  const moment = e.date === S.aujourdhui() ? "auj" : e.date === S.hier() ? "hier" : "autre";
  let cinema = e.ou?.type === "cinema" ? { nom: e.ou.cinema || "", salle: e.ou.salle || "" } : null;
  corps.innerHTML = `
    <div class="ajout-entete">${S.affiche(m, { taille: "w154" })}<div style="min-width:0"><h3>${esc(S.nomTitre(m))}</h3><div class="muet petit">${m.a || ""}${dejaVu && !ex ? ` · <span style="color:var(--accent)">${ico("revision")} revu</span>` : ""}</div></div><button class="coeur ${e.coeur ? "actif" : ""}" data-coeur aria-label="Coup de cœur">${ico(e.coeur ? "coeur-plein" : "coeur")}</button></div>
    <div class="zone-note" data-note></div>
    <div class="mini discret centre" style="margin-top:4px">deux appuis rapides = demi-point en dessous</div>
    <div class="ligne-champ"><span class="libelle-champ">Quand</span><div class="segments plein-l" data-moment><button data-v="auj">Aujourd'hui</button><button data-v="hier">Hier</button><button data-v="autre">Autre</button></div></div>
    <div class="ligne-champ cache" data-autre><span class="libelle-champ"></span><div style="flex:1"><div class="segments plein-l" data-precision><button data-v="jour">Jour</button><button data-v="mois">Mois</button><button data-v="annee">Année</button></div><div style="margin-top:8px" data-saisie-date></div></div></div>
    <div class="ligne-champ"><span class="libelle-champ">Version</span><div class="segments plein-l" data-version><button data-v="VO">VO</button><button data-v="VF">VF</button></div></div>
    <div class="ligne-champ"><span class="libelle-champ">Au cinéma</span><label class="interrupteur"><input type="checkbox" data-cine ${cinema ? "checked" : ""}><span></span></label></div>
    <div class="bloc-cine ${cinema ? "" : "cache"}" data-bloc-cine>
      <div class="puces" data-mes-cines>${mesCinemas.map(c => `<button class="puce ${cinema?.nom === c.cinema ? "actif" : ""}" data-cine-nom="${esc(c.cinema)}">${esc(c.cinema)}</button>`).join("")}</div>
      <input class="champ" data-cine-recherche placeholder="${mesCinemas.length ? "Un autre cinéma…" : "Nom du cinéma"}" value="${cinema && !mesCinemas.some(c => c.cinema === cinema.nom) ? esc(cinema.nom) : ""}" autocomplete="off" style="margin-top:8px">
      <div class="res-recherche" data-cine-res></div>
      <div class="grille-2" style="margin-top:8px"><label class="champ-prefixe"><span>Salle</span><input class="champ" data-salle value="${esc(cinema?.salle || "")}" inputmode="numeric"></label><label class="champ-prefixe"><span>Prix €</span><input class="champ" data-prix type="number" step="0.1" min="0" inputmode="decimal" value="${e.prix ?? ""}"></label></div>
    </div>
    ${Object.keys(S.amis).length ? `<div class="ligne-champ"><span class="libelle-champ">Avec</span><div class="avatars-choix">${Object.entries(S.amis).map(([id, a]) => `<button class="avatar-choix ${(e.avec || []).includes(id) ? "actif" : ""}" data-ami="${esc(id)}" title="${esc(a.profil?.nom || id)}">${S.avatar(id, a.profil?.nom)}<span>${esc((a.profil?.nom || id).split(" ")[0])}</span></button>`).join("")}</div></div>` : ""}
    <div class="plus-details" data-plus>
      <button type="button">${ico("bas")} Plus</button>
      <div class="cache" data-details>
        <label class="case"><input type="checkbox" data-revision ${e.revision ? "checked" : ""}> ${ico("revision")} Revisionnage</label>
        <textarea class="champ" data-critique placeholder="Ta critique" style="margin-top:6px">${esc(e.critique || "")}</textarea>
        <label class="case"><input type="checkbox" data-critique-privee ${e.critique_privee ? "checked" : ""}> Critique privée</label>
        <label class="case"><input type="checkbox" data-prive ${e.prive ? "checked" : ""}> ${ico("cadenas")} Visionnage caché à tes amis</label>
        <input class="champ" data-avec-libre placeholder="Avec d'autres (séparés par des virgules)" value="${esc((e.avec || []).filter(x => !S.amis[x]).join(", "))}" style="margin-top:6px">
        <div class="mini-notes" style="margin-top:12px">${[["scenario", "Scénario"], ["realisation", "Mise en scène"], ["jeu", "Jeu"], ["image", "Image"], ["musique", "Musique"], ["son", "Son"]].map(([k, lib]) => `<span class="petit muet">${lib}</span><div class="points10" data-detail="${k}">${Array.from({ length: 10 }, (_, i) => `<button class="${(detail[k] || 0) >= i + 1 ? "ok" : ""}" data-v="${i + 1}">${i + 1}</button>`).join("")}</div>`).join("")}</div>
      </div>
    </div>`;
  const pied = el(`<div class="pied-m">${ex ? `<button class="bouton danger" data-suppr aria-label="Supprimer">${ico("poubelle")}</button>` : `<button class="bouton" data-retour aria-label="Retour">${ico("retour")}</button>`}<button class="bouton principal grand" data-ok>${ex ? "Enregistrer" : "Ajouter"}</button></div>`);
  $(".pied-m", modale)?.remove(); modale.append(pied);
  const rangee = S.rangee(e.note, v => { e.note = v; }, { grande: true, delai: 0 });
  $("[data-note]", corps).append(rangee);
  $("[data-coeur]", corps).onclick = ev => { e.coeur = !e.coeur; ev.currentTarget.classList.toggle("actif", e.coeur); ev.currentTarget.innerHTML = ico(e.coeur ? "coeur-plein" : "coeur"); };
  // date : aujourd'hui / hier / autre (jour exact, mois ou année)
  let mo = moment, precision = precisionInit, date = e.date;
  const saisie = () => {
    const z = $("[data-saisie-date]", corps);
    const an = (date || S.aujourdhui()).slice(0, 4), mois = (date.length >= 7 ? date : S.aujourdhui()).slice(0, 7);
    z.innerHTML = precision === "jour" ? `<input class="champ" type="date" value="${date.length === 10 ? date : S.aujourdhui()}" max="${S.aujourdhui()}">`
      : precision === "mois" ? `<input class="champ" type="month" value="${mois}" max="${S.aujourdhui().slice(0, 7)}">`
      : `<input class="champ" type="number" min="1900" max="${S.aujourdhui().slice(0, 4)}" value="${an}" inputmode="numeric">`;
    const i = $("input", z); const lire = () => { date = i.value || date; }; i.oninput = lire; lire();
  };
  const majDate = () => {
    $$("[data-moment] button", corps).forEach(b => b.classList.toggle("actif", b.dataset.v === mo));
    $$("[data-precision] button", corps).forEach(b => b.classList.toggle("actif", b.dataset.v === precision));
    $("[data-autre]", corps).classList.toggle("cache", mo !== "autre");
    if (mo === "auj") date = S.aujourdhui(); else if (mo === "hier") date = S.hier(); else saisie();
  };
  $$("[data-moment] button", corps).forEach(b => b.onclick = () => { mo = b.dataset.v; majDate(); });
  $$("[data-precision] button", corps).forEach(b => b.onclick = () => { precision = b.dataset.v; majDate(); });
  majDate();
  let version = e.version === "VF" ? "VF" : e.version ? "VO" : "";
  const majVersion = () => $$("[data-version] button", corps).forEach(b => b.classList.toggle("actif", b.dataset.v === version));
  $$("[data-version] button", corps).forEach(b => b.onclick = () => { version = version === b.dataset.v ? "" : b.dataset.v; majVersion(); });
  majVersion();
  // cinéma : tes cinémas d'abord, puis la recherche (OpenStreetMap)
  const blocCine = $("[data-bloc-cine]", corps);
  $("[data-cine]", corps).onchange = ev => { blocCine.classList.toggle("cache", !ev.target.checked); cinema = ev.target.checked ? (cinema || { nom: mesCinemas[0]?.cinema || "", salle: "" }) : null; peindreCines(); };
  const peindreCines = () => $$("[data-cine-nom]", corps).forEach(b => b.classList.toggle("actif", cinema?.nom === b.dataset.cineNom));
  $$("[data-cine-nom]", corps).forEach(b => b.onclick = () => { cinema = { nom: b.dataset.cineNom, salle: $("[data-salle]", corps).value }; $("[data-cine-recherche]", corps).value = ""; peindreCines(); });
  const rech = $("[data-cine-recherche]", corps), resC = $("[data-cine-res]", corps);
  rech.oninput = S.debounce(async () => {
    const q = rech.value.trim(); cinema = { nom: q, salle: $("[data-salle]", corps).value }; peindreCines();
    if (q.length < 2) { resC.innerHTML = ""; return; }
    try {
      const r = (await S.api("/api/cinemas?q=" + encodeURIComponent(q))).r;
      resC.innerHTML = r.map(c => `<div class="ligne" data-n="${esc(c.nom)}"><div class="corps"><b>${esc(c.nom)}</b><span>${esc(c.ville)}</span></div></div>`).join("");
      $$(".ligne", resC).forEach(l => l.onclick = () => { cinema = { nom: l.dataset.n, salle: $("[data-salle]", corps).value }; rech.value = l.dataset.n; resC.innerHTML = ""; });
    } catch { resC.innerHTML = ""; }
  }, 350);
  if (cinema && mesCinemas.some(c => c.cinema === cinema.nom)) peindreCines();
  $$("[data-ami]", corps).forEach(b => b.onclick = () => b.classList.toggle("actif"));
  const plus = $("[data-plus]", corps);
  $("button", plus).onclick = () => { plus.classList.toggle("ouvert"); $("[data-details]", plus).classList.toggle("cache"); };
  if (ex && (ex.critique || ex.prive)) $("button", plus).click();
  $$("[data-detail]", corps).forEach(g => $$("button", g).forEach(b => b.onclick = () => { const k = g.dataset.detail; const v = +b.dataset.v; detail[k] = detail[k] === v ? null : v; $$("button", g).forEach(x => x.classList.toggle("ok", detail[k] != null && +x.dataset.v <= detail[k])); }));
  const valider = async () => {
    const ou = cinema && cinema.nom !== undefined && $("[data-cine]", corps).checked ? { type: "cinema", cinema: cinema.nom, salle: $("[data-salle]", corps).value.trim() } : (ex?.ou && ex.ou.type !== "cinema" ? ex.ou : null);
    const avec = [...$$("[data-ami].actif", corps).map(b => b.dataset.ami), ...$("[data-avec-libre]", corps).value.split(",").map(s => s.trim()).filter(Boolean)];
    const prix = ou?.type === "cinema" && $("[data-prix]", corps).value !== "" ? +$("[data-prix]", corps).value : null;
    const entree = { id: ex?.id, cle, date: (mo === "autre" ? date : mo === "hier" ? S.hier() : S.aujourdhui()), note: e.note, coeur: e.coeur, revision: $("[data-revision]", corps).checked, critique: $("[data-critique]", corps).value.trim(), critique_privee: $("[data-critique-privee]", corps).checked, prive: $("[data-prive]", corps).checked, ou, prix, avec, version };
    $("[data-ok]", pied).disabled = true;
    try {
      await S.agir("journal", { entree }, { toast: ex ? "Modifié" : "Ajouté au journal", sansRendu: true });
      const d = Object.fromEntries(Object.entries(detail).filter(([, v]) => v != null));
      if (JSON.stringify(d) !== JSON.stringify(t.detail || {})) await S.agir("titre", { cle, champs: { detail: d } }, { toast: false, sansRendu: true });
      S.son("ajout");
      S.fermerModale(); S.rafraichir(true);
    } catch { $("[data-ok]", pied).disabled = false; }
  };
  $("[data-ok]", pied).onclick = valider;
  const ret = $("[data-retour]", pied); if (ret) ret.onclick = () => { S.fermerModale(); setTimeout(() => S.ouvrirAjout(), 320); };
  const sup = $("[data-suppr]", pied); if (sup) sup.onclick = async () => { await S.agir("suppr_journal", { id: ex.id }, { toast: "Supprimé", sansRendu: true }); S.fermerModale(); S.rafraichir(true); };
  const clavier = ev => {
    if (ev.target.matches("textarea, input:not([type=checkbox])")) { if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey)) valider(); return; }
    if (/^[0-9]$/.test(ev.key)) { e.note = ev.key === "0" ? 10 : +ev.key; rangee.fixer(e.note); S.son("note", e.note); ev.preventDefault(); }
    if (ev.key === "." || ev.key === ",") { if (e.note) { e.note = Math.max(.5, e.note - .5); rangee.fixer(e.note); } ev.preventDefault(); }
    if (ev.key === "Enter") { ev.preventDefault(); valider(); }
  };
  corps.onkeydown = clavier;
  corps.tabIndex = -1; corps.focus({ preventScroll: true });
  modale.clavier = clavier;
}
})();
