/* Silencio — cœur de l'interface : état, API, navigation, composants communs, ajout rapide. */
(function () {
"use strict";
const S = window.Silencio = {
  etat: null, moi: null, amis: {}, base: null, version: -1, infos: {}, memo: {}, pages: {}, positions: {},
  routeActuelle: null, filtresMemo: {},
};

// ------------------------------------------------------------------ utilitaires
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const ico = (n, cls = "") => `<svg class="${cls}"><use href="#i-${n}"/></svg>`;
function el(html) { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; }
Object.assign(S, { $, $$, esc, ico, el });

const MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août", "septembre", "octobre", "novembre", "décembre"];
const MOIS_C = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
const JOURS = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
S.MOIS = MOIS; S.MOIS_C = MOIS_C; S.JOURS = JOURS;
S.fmtNote = n => n == null || n === "" ? "–" : (Math.round(n * 10) / 10).toLocaleString("fr-FR", { maximumFractionDigits: 1 });
S.fmtNombre = n => (n ?? 0).toLocaleString("fr-FR");
S.fmtDate = (d, court) => { if (!d) return ""; const [a, m, j] = d.split("-").map(Number); if (!m) return String(a); return `${j ? j + " " : ""}${(court ? MOIS_C : MOIS)[m - 1]} ${a}`; };
S.aujourdhui = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
S.moisPrecedent = () => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`; };
S.hier = () => { const d = new Date(Date.now() - 864e5); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
S.duree = min => { if (!min) return ""; const h = Math.floor(min / 60), m = Math.round(min % 60); return h ? `${h} h ${String(m).padStart(2, "0")}` : `${m} min`; };
S.argent = n => !n ? "–" : n >= 1e9 ? (n / 1e9).toLocaleString("fr-FR", { maximumFractionDigits: 2 }) + " Md$" : n >= 1e6 ? Math.round(n / 1e6).toLocaleString("fr-FR") + " M$" : Math.round(n / 1e3) + " k$";
S.pluriel = (n, mot, pl) => `${S.fmtNombre(n)} ${n > 1 ? (pl || mot + "s") : mot}`;
S.img = (p, t = "w342") => p ? `/img/${t}${p}` : "";
const nomsPays = (() => { try { return new Intl.DisplayNames(["fr"], { type: "region" }); } catch { return null; } })();
const nomsLangues = (() => { try { return new Intl.DisplayNames(["fr"], { type: "language" }); } catch { return null; } })();
S.pays = c => { try { return nomsPays ? nomsPays.of(c) : c; } catch { return c; } };
S.langue = c => { if (!c) return ""; try { const n = nomsLangues ? nomsLangues.of(c) : c; return n === c ? c : n; } catch { return c; } };
S.GENRES = { 28: "Action", 12: "Aventure", 16: "Animation", 35: "Comédie", 80: "Crime", 99: "Documentaire", 18: "Drame", 10751: "Familial", 14: "Fantastique", 36: "Histoire", 27: "Horreur", 10402: "Musique", 9648: "Mystère", 10749: "Romance", 878: "Science-fiction", 10770: "Téléfilm", 53: "Thriller", 10752: "Guerre", 37: "Western", 10759: "Action & aventure", 10762: "Jeunesse", 10763: "Actualités", 10764: "Télé-réalité", 10765: "SF & fantastique", 10766: "Feuilleton", 10767: "Talk-show", 10768: "Guerre & politique" };
S.FORMATS = { long: "Long métrage", court: "Court métrage", docu: "Documentaire", telefilm: "Téléfilm", serie: "Série", mini: "Mini-série", docu_serie: "Série documentaire" };
S.METIERS = { real: "Réalisation", scen: "Scénario", image: "Image", musique: "Musique", montage: "Montage", decors: "Décors", costumes: "Costumes", prod: "Production", casting: "Casting", son: "Son", vfx: "Effets visuels", createur: "Création", acteur: "Interprétation" };
S.COULEURS = ["#5b8cff", "#e76624", "#00a888", "#d28e05", "#e24d8b", "#0aac23", "#9887ef", "#eb6263"];
S.couleurProfil = id => { let h = 0; for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) >>> 0; return ["#8796ff", "#f2a65a", "#4fd1b5", "#e98bb5", "#c3a6ff", "#f2c14e", "#7fc8f8", "#ef7d7d"][h % 8]; };
S.initiales = nom => (nom || "?").split(/\s+/).map(m => m[0]).join("").slice(0, 2).toUpperCase();
S.avatar = (id, nom, taille) => `<span class="avatar" style="background:${S.couleurProfil(id)}${taille ? `;width:${taille}px;height:${taille}px;font-size:${taille * .42}px` : ""}">${esc(S.initiales(nom))}</span>`;
S.debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

// ------------------------------------------------------------------ API
async function api(chemin, opts = {}) {
  const r = await fetch(chemin, opts);
  let d = null;
  try { d = await r.json(); } catch { d = null; }
  if (!r.ok) { const e = new Error((d && d.erreur) || `Erreur ${r.status}`); e.horsLigne = d && d.hors_ligne; e.code = r.status; throw e; }
  return d;
}
S.api = api;
S.post = (chemin, corps, brut) => api(chemin, { method: "POST", body: brut ? corps : JSON.stringify(corps || {}), headers: brut ? {} : { "Content-Type": "application/json" } });

// ------------------------------------------------------------------ données
S.vivants = sec => Object.fromEntries(Object.entries(sec || {}).filter(([, v]) => !v.x));
S.docDe = pid => !pid || pid === S.etat?.appareil?.profil ? S.moi : S.amis[pid];
S.nomDe = pid => (S.docDe(pid)?.profil?.nom) || pid;
S.monTitre = cle => { const t = S.moi?.titres?.[cle]; return t && !t.x ? t : {}; };
S.dansWatchlist = (cle, doc = S.moi) => { const w = doc?.watchlist?.[cle]; return !!(w && !w.x); };
S.journalDe = (cle, doc = S.moi) => Object.entries(doc?.journal || {}).filter(([, e]) => !e.x && e.cle === cle).map(([id, e]) => ({ id, ...e })).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
S.reglage = (k, def) => (S.moi?.profil?.reglages || {})[k] ?? def;
S.info = cle => S.base?.titres?.[cle] || S.infos[cle] || null;
S.nomTitre = m => !m ? "…" : (S.reglage("titres", "fr") === "vo" ? (m.o || m.t) : (m.t || m.o)) || "…";
S.autreTitre = m => { if (!m) return ""; const a = S.nomTitre(m), b = S.reglage("titres", "fr") === "vo" ? m.t : m.o; return b && b !== a ? b : ""; };
S.retenir = (r, type) => {  // garde les infos d'un résultat TMDB (recherche, recos…) pour l'afficher avant sa fiche
  const ty = type || r.media_type || (r.title !== undefined ? "movie" : "tv");
  if (ty !== "movie" && ty !== "tv") return null;
  const cle = (ty === "movie" ? "m:" : "t:") + r.id;
  const d = r.release_date || r.first_air_date || "";
  if (!S.base?.titres?.[cle]) S.infos[cle] = { k: cle, ty: cle[0], t: r.title || r.name, o: r.original_title || r.original_name, a: d ? +d.slice(0, 4) : null, ds: d, af: r.poster_path, fd: r.backdrop_path, vt: r.vote_average, g: r.genre_ids || [] };
  return cle;
};

async function chargerEtat() {
  const e = await api("/api/etat");
  S.etat = e; S.moi = e.profil; S.amis = e.amis || {}; S.version = e.version;
  majChrome();
  return e;
}
S.chargerEtat = chargerEtat;
let baseEnCours = null;
S.chargerBase = (forcer) => {
  if (S.base && !forcer) return Promise.resolve(S.base);
  if (!baseEnCours) baseEnCours = api("/api/base").then(b => { S.base = b; baseEnCours = null; S.statsCache = null; setTimeout(() => S.majChrome && S.majChrome(), 0); return b; }).catch(e => { baseEnCours = null; throw e; });
  return baseEnCours;
};

// applique les modifications renvoyées par le serveur à la copie locale
function appliquer(modifs) {
  for (const [sec, cle, entree] of modifs || []) {
    if (sec === "profil") S.moi.profil = entree;
    else { S.moi[sec] = S.moi[sec] || {}; S.moi[sec][cle] = entree; }
  }
  S.statsCache = null;
}
S.agir = async (type, donnees = {}, opts = {}) => {
  try {
    const r = await S.post("/api/action", { type, ...donnees });
    appliquer(r.modifs); S.version = r.version;
    if (opts.toast !== false && r.modifs?.length) toast(opts.toast || r.libelle || "Enregistré", type === "annuler" || opts.sansAnnuler ? null : { texte: "Annuler", fn: () => S.agir("annuler", {}, { toast: "Annulé" }) });
    const nouveaux = (r.modifs || []).map(m => m[0] === "journal" ? m[2]?.cle : (m[0] === "titres" || m[0] === "watchlist") ? m[1] : null).filter(c => c && !S.base?.titres?.[c]);
    if (nouveaux.length) setTimeout(() => S.chargerBase(true).then(() => S.rafraichir(true)), 2500);
    if (!opts.sansRendu) S.rafraichir(true);
    return r;
  } catch (e) { toast(e.message); throw e; }
};

// ------------------------------------------------------------------ composants
S.affiche = (m, o = {}) => {
  const t = S.nomTitre(m);
  const src = m && m.af ? S.img(m.af, o.taille || "w342") : "";
  const marques = [];
  return `<div class="affiche"${o.vt ? ` style="view-transition-name:${o.vt}"` : ""}>${src ? `<img loading="lazy" src="${src}" alt="" onload="this.classList.add('ok')" onerror="this.remove()">` : ""}<div class="sans"${src ? ' style="z-index:-1"' : ""}>${esc(t)}</div>${o.vu ? `<span class="vu-coin">Vu</span>` : ""}${marques.length ? `<div class="marques">${marques.join("")}</div>` : ""}</div>`;
};
S.vignette = (cle, o = {}) => {
  const m = S.info(cle) || { t: "…" };
  const t = S.monTitre(cle);
  const note = o.note !== undefined ? o.note : (o.sansNote ? null : t.note);
  const coeur = o.coeur ?? t.coeur;
  const bas = [note != null ? `<em class="${coeur ? "cc" : ""}">${S.fmtNote(note)}</em>` : "", o.info ? esc(o.info) : ""].filter(Boolean).join(" ");
  return `<a class="vignette" href="#/titre/${cle}" data-cle="${cle}">${S.affiche(m, { vu: o.vu })}${o.legende === false ? "" : `<div class="legende"><b>${esc(S.nomTitre(m))}</b>${bas ? `<span>${bas}</span>` : ""}</div>`}</a>`;
};
S.portrait = (chemin, nom) => `<div class="portrait">${chemin ? `<img loading="lazy" src="${S.img(chemin, "w185")}" alt="" onload="this.classList.add('ok')" onerror="this.remove()">` : ""}<span class="initiales" style="z-index:-1">${esc(S.initiales(nom))}</span></div>`;
S.ligneTitre = (cle, o = {}) => {
  const m = S.info(cle) || { t: "…" };
  const t = S.monTitre(cle);
  const sous = o.sous ?? [m.a, S.FORMATS[m.fmt] && m.fmt !== "long" ? S.FORMATS[m.fmt] : (m.ty === "t" ? "série" : "")].filter(Boolean).join(", ");
  const droite = o.droite ?? (t.note != null ? `<span class="note-txt ${t.coeur ? "cc" : ""}">${S.fmtNote(t.note)}</span>` : S.dansWatchlist(cle) ? `<span class="etat-txt">à voir</span>` : t.vu ? `<span class="etat-txt">vu</span>` : "");
  const ligne = `<a class="ligne" href="#/titre/${cle}" data-cle="${cle}">${o.avant || ""}${S.affiche(m, { taille: "w154" })}<div class="corps"><b>${esc(S.nomTitre(m))}</b><span>${esc(sous)}</span></div><div class="droite">${droite}</div></a>`;
  return o.glisse === false ? ligne : `<div class="glisse"><div class="fond-g">Vu</div><div class="fond-d">À voir</div>${ligne}</div>`;
};
S.vide = (titre, texte = "") => `<div class="vide"><b>${esc(titre)}</b>${texte}</div>`;
S.chargement = () => `<div class="chargement"></div>`;

// note sur 10, cliquable (moitié gauche d'une étoile = demi-point), aperçu au survol sur PC
S.etoiles = (valeur, onChange, o = {}) => {
  const n = 10;
  const w = el(`<div class="etoiles ${o.petites ? "petites" : ""} ${o.compact ? "compact" : ""}" role="slider" aria-valuemin="0" aria-valuemax="10" tabindex="0">${Array.from({ length: n }, (_, i) => `<span class="e" data-i="${i + 1}"><svg><use href="#i-etoile"/></svg><svg class="plein"><use href="#i-etoile"/></svg></span>`).join("")}${o.lecture ? "" : `<span class="valeur"></span><button class="effacer" title="Retirer la note">${ico("x")}</button>`}</div>`);
  let v = valeur ?? null;
  const peindre = x => {
    $$(".e", w).forEach((e, i) => { e.classList.toggle("pleine", x != null && x >= i + 1); e.classList.toggle("moitie", x != null && x >= i + .5 && x < i + 1); });
    const lab = $(".valeur", w); if (lab) lab.textContent = x == null ? "" : S.fmtNote(x);
    const ef = $(".effacer", w); if (ef) ef.style.visibility = v == null ? "hidden" : "visible";
    w.setAttribute("aria-valuenow", x ?? 0);
  };
  const lire = ev => { const e = ev.target.closest(".e"); if (!e) return null; const r = e.getBoundingClientRect(); const i = +e.dataset.i; return (ev.clientX - r.left) < r.width / 2 ? i - .5 : i; };
  if (!o.lecture) {
    w.addEventListener("pointermove", ev => { if (ev.pointerType === "mouse") { const x = lire(ev); if (x != null) peindre(x); } });
    w.addEventListener("pointerleave", () => peindre(v));
    w.addEventListener("click", ev => {
      if (ev.target.closest(".effacer")) { ev.preventDefault(); v = null; peindre(v); onChange && onChange(null); return; }
      const x = lire(ev); if (x == null) return; ev.preventDefault();
      v = x; peindre(v); onChange && onChange(v);
    });
    w.addEventListener("keydown", ev => {
      if (ev.key === "ArrowRight" || ev.key === "ArrowUp") { v = Math.min(10, (v || 0) + .5); peindre(v); onChange && onChange(v); ev.preventDefault(); }
      if (ev.key === "ArrowLeft" || ev.key === "ArrowDown") { v = Math.max(.5, (v || 1) - .5); peindre(v); onChange && onChange(v); ev.preventDefault(); }
    });
  }
  w.fixer = x => { v = x; peindre(v); };
  peindre(v);
  return w;
};

// ------------------------------------------------------------------ toasts, infobulle, modales
function toast(texte, action, duree = 3000) {
  const t = el(`<div class="toast"><span>${esc(texte)}</span>${action ? `<button>${esc(action.texte)}</button>` : ""}</div>`);
  if (action) $("button", t).onclick = () => { t.remove(); action.fn(); };
  $("#toasts").append(t);
  while ($("#toasts").children.length > 3) $("#toasts").firstElementChild.remove();
  setTimeout(() => { t.style.transition = "opacity .3s"; t.style.opacity = 0; setTimeout(() => t.remove(), 320); }, duree);
}
S.toast = toast;

const pile = [];
S.ouvrirModale = ({ titre = "", corps = "", pied = "", large = false, fermer } = {}) => {
  const m = el(`<div class="modale ${large ? "large" : ""}" role="dialog"><div class="poignee-m"></div><div class="tete-m"><h2>${esc(titre)}</h2><span class="espace"></span><button class="fermer-m" data-fermer>Fermer</button></div><div class="corps-m"></div>${pied !== null ? `<div class="pied-m"></div>` : ""}</div>`);
  const c = $(".corps-m", m);
  typeof corps === "string" ? (c.innerHTML = corps) : c.append(corps);
  if (pied && $(".pied-m", m)) typeof pied === "string" ? ($(".pied-m", m).innerHTML = pied) : $(".pied-m", m).append(pied);
  if (!pied && $(".pied-m", m)) $(".pied-m", m).remove();
  $("#modales").append(m);
  $("[data-fermer]", m).onclick = () => S.fermerModale();
  m.fermerCb = fermer;
  pile.push(m);
  history.pushState({ modale: pile.length }, "");
  requestAnimationFrame(() => { m.classList.add("ouverte"); $("#voile").classList.add("ouvert"); });
  // glisser vers le bas pour fermer (téléphone)
  let y0 = null;
  $(".poignee-m", m).addEventListener("pointerdown", e => { y0 = e.clientY; m.style.transition = "none"; m.setPointerCapture(e.pointerId); });
  m.addEventListener("pointermove", e => { if (y0 != null) m.style.transform = `translateY(${Math.max(0, e.clientY - y0)}px)`; });
  m.addEventListener("pointerup", e => { if (y0 == null) return; const dy = e.clientY - y0; y0 = null; m.style.transition = ""; m.style.transform = ""; if (dy > 90) S.fermerModale(); });
  return m;
};
S.fermerModale = (depuisHistorique) => {
  const m = pile.pop(); if (!m) return;
  m.classList.remove("ouverte");
  if (!pile.length) $("#voile").classList.remove("ouvert");
  setTimeout(() => m.remove(), 300);
  m.fermerCb && m.fermerCb();
  if (!depuisHistorique) { ignorerPop = true; history.back(); }
};
// petite question oui / non, par-dessus ce qui est ouvert : renvoie une promesse (true / false)
S.demander = (titre, texte, oui = "Oui", non = "Non") => new Promise(ok => {
  let fini = false;
  const finir = v => { if (fini) return; fini = true; ok(v); };
  const pied = el(`<div class="pied-question"><button class="bouton" data-non>${esc(non)}</button><button class="bouton principal" data-oui>${esc(oui)}</button></div>`);
  const m = S.ouvrirModale({ titre, corps: `<p class="question-texte">${texte}</p>`, pied, fermer: () => finir(false) });
  m.classList.add("question");
  $("[data-oui]", m).onclick = () => { finir(true); S.fermerModale(); };
  $("[data-non]", m).onclick = () => { finir(false); S.fermerModale(); };
});
let ignorerPop = false, navRetour = false;
window.addEventListener("popstate", () => {
  if (ignorerPop) { ignorerPop = false; return; }
  if (pile.length) { S.fermerModale(true); return; }
  navRetour = true;
});
$("#voile").onclick = () => S.fermerModale();

const bulle = $("#infobulle");
S.infobulle = (html, ev) => {
  if (!html) { bulle.classList.remove("visible"); return; }
  bulle.innerHTML = html; bulle.classList.add("visible");
  const x = ev.clientX, y = ev.clientY, w = bulle.offsetWidth, h = bulle.offsetHeight;
  bulle.style.left = Math.min(window.innerWidth - w - 8, Math.max(8, x + 14)) + "px";
  bulle.style.top = (y + h + 24 > window.innerHeight ? y - h - 12 : y + 14) + "px";
};
document.addEventListener("scroll", () => S.infobulle(null), { passive: true });

// les deux couleurs principales d'une affiche (halos de la page du film)
S.couleursAffiche = src => new Promise(ok => {
  const im = new Image(); im.onload = () => {
    try {
      const c = document.createElement("canvas"); c.width = 24; c.height = 36; const x = c.getContext("2d");
      x.drawImage(im, 0, 0, 24, 36); const d = x.getImageData(0, 0, 24, 36).data;
      const seaux = {};
      for (let i = 0; i < d.length; i += 4) {
        const [r, g, b] = [d[i], d[i + 1], d[i + 2]]; const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        const sat = mx ? (mx - mn) / mx : 0; const k = `${r >> 5},${g >> 5},${b >> 5}`;
        const s = seaux[k] = seaux[k] || { n: 0, r: 0, g: 0, b: 0, sat: 0 };
        s.n++; s.r += r; s.g += g; s.b += b; s.sat += sat * (mx > 40 ? 1 : .2);
      }
      const eclaircir = s => { let [r, g, b] = [s.r / s.n, s.g / s.n, s.b / s.n]; const mx = Math.max(r, g, b, 1), f = Math.min(2.2, 190 / mx); return [r * f, g * f, b * f].map(v => Math.round(Math.min(255, v))); };
      const tries = Object.values(seaux).sort((a, b) => b.n * (.3 + b.sat / b.n) - a.n * (.3 + a.sat / a.n));
      const c1 = eclaircir(tries[0]);
      const loin = tries.slice(1).map(eclaircir).find(c2 => Math.hypot(c2[0] - c1[0], c2[1] - c1[1], c2[2] - c1[2]) > 90);
      ok([c1, loin || c1.map(v => Math.round(v * .6))]);
    } catch { ok(null); }
  };
  im.onerror = () => ok(null); im.src = src;
});

// ------------------------------------------------------------------ navigation
function lireRoute() {
  const h = location.hash.replace(/^#\/?/, "");
  const [chemin, qs] = h.split("?");
  const morceaux = chemin.split("/").filter(Boolean).map(decodeURIComponent);
  return { nom: morceaux[0] || "accueil", args: morceaux.slice(1), params: Object.fromEntries(new URLSearchParams(qs || "")), cle: location.hash };
}
let rendus = 0;
async function rendre(garderPosition) {
  if (!S.moi && S.etat) { S.pages.choixProfil($("#vue")); return; }
  const r = lireRoute();
  const page = S.pages[r.nom] || S.pages.accueil;
  const vue = $("#vue");
  const n = ++rendus;
  const y = window.scrollY;
  vue.className = page.plein ? "plein" : "";
  document.body.classList.remove("avec-barre-film");
  S.theme && S.theme(r.nom);
  try {
    const res = page(vue, r.args, r.params, r);
    if (res && res.then) await res;
  } catch (e) {
    console.error(e);
    if (n === rendus) {
      const reseau = e.horsLigne || /NetworkError|Failed to fetch|Load failed/i.test(e.message || "");
      vue.innerHTML = S.vide(reseau ? "Silencio ne répond pas pour l'instant" : "Cette page n'a pas pu s'afficher",
        `<div class="petit">${reseau ? "Nouvel essai dans un instant." : esc(e.message)}</div><button class="bouton" data-reessayer style="margin-top:14px">Réessayer</button>`);
      const b = $("[data-reessayer]", vue); if (b) b.onclick = () => rendre(true);
      if (reseau && !rendre.essai) { rendre.essai = 1; setTimeout(() => { if (n === rendus) rendre(true).finally(() => { rendre.essai = 0; }); }, 2000); }
    }
  }
  if (n !== rendus) return;
  activerGlisse(vue);
  if (garderPosition) window.scrollTo(0, y);
  majNav(r.nom);
}
S.rafraichir = (garder = true) => { if (S.pages.encours) return; rendre(garder); };
window.addEventListener("hashchange", () => {
  const ancien = S.routeActuelle;
  if (ancien) S.positions[ancien] = window.scrollY;
  S.routeActuelle = location.hash;
  const retour = navRetour; navRetour = false;
  const faire = async () => { await rendre(false); window.scrollTo(0, retour ? (S.positions[location.hash] || 0) : 0); };
  if (document.startViewTransition && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
    const t = document.startViewTransition(faire);
    [t.ready, t.finished, t.updateCallbackDone].forEach(p => p && p.catch(() => {}));
  }
  else faire();
});
S.aller = h => { location.hash = h; };

function majNav(nom) {
  $$("[data-nav]").forEach(a => a.classList.toggle("actif", a.dataset.nav === nom || (nom === "recherche" && a.dataset.nav === "accueil" && a.closest("#barre-bas")) || (nom === "wrapped" && a.dataset.nav === "profil")));
}
function majChrome() {
  const e = S.etat; if (!e) return;
  const b = $("[data-badge]"); if (b) { b.textContent = e.notifs; b.classList.toggle("cache", !e.notifs); }
  const pied = $("[data-pied]");
  if (pied) {
    const s = e.sync || {}, f = e.file_tmdb || {};
    const heure = s.derniere ? new Date(s.derniere * 1000).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" }) : "";
    const lignes = [];
    if (e.en_ligne === false) lignes.push(`<span class="alerte">Hors ligne</span>`);
    if (!s.active) lignes.push("Synchro GitHub non réglée");
    else if (s.erreur) lignes.push(`<a class="alerte" href="#/reglages/amis" title="${esc(s.erreur)}">Synchro GitHub : ${esc(s.erreur.length > 60 ? s.erreur.slice(0, 58) + "…" : s.erreur)}</a>`);
    else lignes.push(heure ? `Synchronisé à ${heure}` : "Synchro en attente");
    if (e.appareil?.tmdb?.connecte && f.attente) lignes.push(`${S.pluriel(f.attente, "envoi")} TMDB en attente`);
    const nom = S.moi?.profil?.nom || "";
    pied.innerHTML = `${S.moi ? `<a href="#/profil" class="lat-profil">${S.avatar(e.appareil?.profil || "moi", nom, 32)}<span><b>${esc(nom)}</b><small>${lignes.join("<br>")}</small></span></a>` : `<small>${lignes.join("<br>")}</small>`}`;
  }
  const ep = $("[data-epinglees]");
  if (ep && S.moi) {
    const l = Object.entries(S.vivants(S.moi.listes)).filter(([, v]) => v.epinglee);
    ep.innerHTML = l.map(([id, v]) => { const items = v.items || []; const m = items.map(c => S.info(c)).find(x => x?.af) || {}; return `<a href="#/liste/${id}" class="lat-liste"><span class="lat-vignette">${m.af ? `<img src="${S.img(m.af, "w92")}" alt="">` : ""}</span><span class="coupe"><b class="coupe">${esc(v.nom)}</b><small>${S.pluriel(items.length, "titre")}</small></span></a>`; }).join("");
    $("[data-epinglees-titre]").classList.toggle("cache", !l.length);
  }
}
S.majChrome = majChrome;

// ------------------------------------------------------------------ glisser pour agir (droite : vu, gauche : watchlist)
function activerGlisse(racine) {
  $$(".glisse", racine).forEach(g => {
    if (g.dataset.ok) return; g.dataset.ok = 1;
    const ligne = $(".ligne", g); const cle = ligne?.dataset.cle; if (!cle) return;
    let x0 = null, y0 = 0, dx = 0, actif = false;
    ligne.addEventListener("pointerdown", e => { if (e.pointerType === "mouse") return; x0 = e.clientX; y0 = e.clientY; dx = 0; actif = false; });
    ligne.addEventListener("pointermove", e => {
      if (x0 == null) return;
      const ddx = e.clientX - x0, ddy = e.clientY - y0;
      if (!actif) { if (Math.abs(ddy) > 10 && Math.abs(ddy) > Math.abs(ddx)) { x0 = null; return; } if (Math.abs(ddx) > 12) { actif = true; g.classList.add("tire"); ligne.setPointerCapture(e.pointerId); } }
      if (actif) { dx = ddx; ligne.style.transform = `translateX(${dx}px)`; $(".fond-g", g).style.opacity = dx > 0 ? Math.min(1, dx / 90) : 0; $(".fond-d", g).style.opacity = dx < 0 ? Math.min(1, -dx / 90) : 0; }
    });
    const fin = () => {
      if (x0 == null) return; x0 = null; g.classList.remove("tire"); ligne.style.transform = "";
      if (!actif) return;
      ligne.addEventListener("click", ev => ev.preventDefault(), { once: true, capture: true });
      if (dx > 90) S.ouvrirAjout(cle);
      else if (dx < -90) S.agir("watchlist", { cle, val: !S.dansWatchlist(cle) }, { toast: S.dansWatchlist(cle) ? "Retiré de la watchlist" : "Ajouté à la watchlist" });
    };
    ligne.addEventListener("pointerup", fin); ligne.addEventListener("pointercancel", () => { x0 = null; g.classList.remove("tire"); ligne.style.transform = ""; });
  });
}
S.activerGlisse = activerGlisse;

// ------------------------------------------------------------------ recherche (partagée : page, ajout rapide, listes)
S.rechercheLocale = (q, max = 8) => {
  const n = s => (s || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const qq = n(q); if (!qq) return [];
  const vus = new Set(); const res = [];
  for (const [cle, m] of Object.entries({ ...S.infos, ...(S.base?.titres || {}) })) {
    if (vus.has(cle)) continue;
    if (n(m.t).includes(qq) || n(m.o).includes(qq)) { vus.add(cle); res.push(cle); }
  }
  const score = c => (S.monTitre(c).vu ? 2 : 0) + (S.dansWatchlist(c) ? 1 : 0) + (n(S.info(c)?.t).startsWith(qq) ? 2 : 0);
  return res.sort((a, b) => score(b) - score(a)).slice(0, max);
};
let rechercheCtl = null;
S.rechercheTMDB = async q => {
  if (rechercheCtl) rechercheCtl.abort();
  rechercheCtl = new AbortController();
  const r = await api("/api/recherche?q=" + encodeURIComponent(q), { signal: rechercheCtl.signal });
  return r.r || [];
};

// ------------------------------------------------------------------ ajout rapide d'un visionnage
const PLATEFORMES = ["Netflix", "Prime Video", "Disney+", "Canal+", "MUBI", "Arte", "Max", "Apple TV+", "Paramount+", "France.tv", "OCS", "YouTube"];
const SUPPORTS = ["Blu-ray", "4K UHD", "DVD", "VHS", "Fichier", "Télévision"];
// le formulaire d'ajout est dans ui.js

// ajouter à une liste
S.choisirListe = cle => {
  const listes = Object.entries(S.vivants(S.moi.listes));
  const corps = el(`<div><div class="lignes">${listes.map(([id, l]) => `<label class="case" style="padding:10px 0;border-bottom:1px solid var(--ligne)"><input type="checkbox" data-l="${id}" ${(l.items || []).includes(cle) ? "checked" : ""}> <span class="espace">${esc(l.nom)}</span><span class="mini discret">${(l.items || []).length}</span></label>`).join("") || `<div class="vide petit">Aucune liste pour l'instant.</div>`}</div><div class="flex" style="margin-top:14px"><input class="champ" data-nouvelle placeholder="Nouvelle liste…"><button class="bouton" data-creer>${ico("plus")}</button></div></div>`);
  S.ouvrirModale({ titre: "Ajouter à une liste", corps });
  $$("[data-l]", corps).forEach(c => c.onchange = () => S.agir("liste_item", { id: c.dataset.l, cle, val: c.checked }, { toast: c.checked ? "Ajouté à la liste" : "Retiré de la liste" }));
  $("[data-creer]", corps).onclick = async () => { const nom = $("[data-nouvelle]", corps).value.trim(); if (!nom) return; await S.agir("liste", { liste: { nom, items: [cle] } }, { toast: `Liste « ${nom} » créée` }); S.fermerModale(); };
};

// ------------------------------------------------------------------ raccourcis clavier
document.addEventListener("keydown", e => {
  if (e.target.matches("input, textarea, select, [contenteditable]")) { if (e.key === "Escape") e.target.blur(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === "Escape" && pile.length) { S.fermerModale(); return; }
  if (pile.length) { const m = pile[pile.length - 1]; if (m.clavier && !m.contains(e.target)) m.clavier(e); return; }
  if (e.key === "/") { e.preventDefault(); if (location.hash !== "#/recherche") S.aller("#/recherche"); setTimeout(() => $("#vue input[type=search]")?.focus(), 60); }
  else if (e.key === "n" || e.key === "a") { e.preventDefault(); S.ouvrirAjout(); }
  else if (e.key === "s") S.aller("#/stats");
  else if (e.key === "j") S.aller("#/journal");
  else if (e.key === "h") S.aller("#/");
  else if (e.key === "z") S.agir("annuler", {}, { toast: "Annulé" });
});
$$("[data-ajout]").forEach(b => b.onclick = () => S.ouvrirAjout());
{ const f = $("[data-lat-recherche]"); if (f) f.onsubmit = ev => { ev.preventDefault(); const q = $("input", f).value.trim(); if (q) S.aller("#/recherche?q=" + encodeURIComponent(q)); }; }

// ------------------------------------------------------------------ démarrage et mises à jour
S.demarrer = async () => {
  $("#vue").innerHTML = S.chargement();
  try { await chargerEtat(); } catch (e) { $("#vue").innerHTML = S.vide("Silencio ne répond pas", "Relance l'application."); return; }
  S.routeActuelle = location.hash;
  S._amisConnus = Object.keys(S.amis).sort().join();
  if (S.moi) S.chargerBase().then(() => S.rafraichir(true)).catch(() => {});
  rendre(false);
  setInterval(async () => {
    try {
      const v = await api("/api/version");
      if (v.v !== S.version) {
        await chargerEtat();
        const amis = Object.keys(S.amis).sort().join();
        if (amis !== S._amisConnus) { S._amisConnus = amis; S.chargerBase(true).then(() => S.rafraichir(true)).catch(() => {}); }
        if (S.moi && !pile.length && !document.activeElement?.matches("input, textarea")) S.rafraichir(true);
      } else if (S.etat) { S.etat.notifs = v.notifs; S.etat.sync = Object.assign(S.etat.sync || {}, v.sync); majChrome(); }
    } catch { /* hors ligne */ }
  }, 7000);
  setInterval(() => { if (S.base?.manquants) S.chargerBase(true).then(() => { if (!pile.length) S.rafraichir(true); }).catch(() => {}); }, 15000);
};
})();
