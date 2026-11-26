/* Silencio — moteur de statistiques, page Stats, labo de graphiques, « Ton année ». */
(function () {
"use strict";
const S = window.Silencio, St = S.stats = {}, G = S.graph;
const { $, $$, esc, ico, el } = S;
const moyenne = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
const mediane = a => { if (!a.length) return null; const b = [...a].sort((x, y) => x - y); const k = b.length >> 1; return b.length % 2 ? b[k] : (b[k - 1] + b[k]) / 2; };

// ------------------------------------------------------------------ lignes de données
/* Pour un profil : T = une ligne par titre vu (note actuelle), V = une ligne par visionnage du journal. */
St.donnees = (pid) => {
  const doc = S.docDe(pid); if (!doc) return { T: [], V: [] };
  const cleCache = `${pid || "moi"}|${S.version}|${Object.keys(S.base?.titres || {}).length}`;
  S.statsCache = S.statsCache || {};
  if (S.statsCache[cleCache]) return S.statsCache[cleCache];
  const metas = S.base?.titres || {};
  const series = S.vivants(doc.series);
  const parTitre = {};
  const V = [];
  for (const [id, e] of Object.entries(S.vivants(doc.journal))) {
    if (!e.cle) continue;
    const m = metas[e.cle]; const t = doc.titres?.[e.cle];
    const v = { id, p: pid, cle: e.cle, m, date: e.date, note: e.note ?? (t && !t.x ? t.note : null), coeur: !!(t && t.coeur), ou: e.ou, prix: e.prix, avec: e.avec || [], revision: !!e.revision, critique: e.critique, approx: !!e.approx };
    V.push(v);
    (parTitre[e.cle] = parTitre[e.cle] || []).push(v);
  }
  V.sort((a, b) => (a.date || "").localeCompare(b.date || ""));
  const T = [];
  for (const [cle, t] of Object.entries(S.vivants(doc.titres))) {
    if (!t.vu && t.note == null) continue;
    const vis = parTitre[cle] || [];
    const m = metas[cle];
    let part = 1;
    if (cle[0] === "t" && series[cle] && m?.ne) part = Math.min(1, Math.max((series[cle].episodes || []).length / m.ne, vis.length ? 1 : 0));
    T.push({ p: pid, cle, m, note: t.note ?? null, coeur: !!t.coeur, dates: vis.map(v => v.date).filter(Boolean), nbVis: Math.max(1, vis.length), revs: vis.filter(v => v.revision).length, premiere: vis.find(v => v.date && !v.approx)?.date || vis[0]?.date || null, part, etiquettes: t.etiquettes || [], detail: t.detail || {} });
  }
  const r = { T, V };
  S.statsCache[cleCache] = r;
  return r;
};

// filtres communs : période, type, format, genre
St.filtrer = (d, f = {}) => {
  const okM = m => {
    if (!m) return !(f.type || f.format || f.genre || f.decennie || f.pays);
    if (f.type && m.ty !== f.type) return false;
    if (f.format && m.fmt !== f.format) return false;
    if (f.genre && !(m.g || []).includes(+f.genre)) return false;
    if (f.decennie && Math.floor((m.a || 0) / 10) * 10 !== +f.decennie) return false;
    if (f.pays && !(m.p || []).includes(f.pays)) return false;
    return true;
  };
  const dansPeriode = date => {
    if (!f.periode || f.periode === "tout") return true;
    if (!date) return false;
    if (f.periode === "12m") { const lim = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10); return date >= lim; }
    return date.startsWith(f.periode);
  };
  const V = d.V.filter(v => okM(v.m) && dansPeriode(v.date) && (f.noteMin == null || (v.note ?? -1) >= f.noteMin));
  const T = d.T.filter(t => okM(t.m) && (!f.periode || f.periode === "tout" || t.dates.some(dansPeriode)) && (f.noteMin == null || (t.note ?? -1) >= f.noteMin));
  return { T, V };
};

// ------------------------------------------------------------------ dimensions et mesures (labo)
const pers = id => S.base?.pers?.[id] || {};
const nomPers = id => pers(id).n || `#${id}`;
const lesPers = (m, role) => !m ? [] : role === "acteur" ? (m.ca || []) : role === "real" ? (m.eq?.real || m.re || []) : role === "tous" ? [...new Set([...(m.re || []), ...(m.ca || []), ...Object.values(m.eq || {}).flat()])] : (m.eq?.[role] || []);
const anneeVue = r => (r.date || r.premiere || "").slice(0, 4) || null;
St.DIMS = {
  annee: { lib: "Année de sortie", num: true, de: r => r.m?.a ?? null },
  decennie: { lib: "Décennie", num: true, de: r => r.m?.a ? Math.floor(r.m.a / 10) * 10 : null, libelle: v => `années ${String(v).slice(2)}` },
  annee_vue: { lib: "Année de visionnage", num: true, vis: true, de: r => anneeVue(r) ? +anneeVue(r) : null },
  mois_vue: { lib: "Mois de visionnage", vis: true, temps: true, de: r => r.date ? r.date.slice(0, 7) : null, libelle: v => S.fmtDate(v, true) },
  mois: { lib: "Mois de l'année", num: true, vis: true, de: r => r.date ? +r.date.slice(5, 7) : null, libelle: v => S.MOIS_C[v - 1] },
  jour: { lib: "Jour de la semaine", num: true, vis: true, de: r => r.date ? (new Date(r.date + "T12:00").getDay() + 6) % 7 : null, libelle: v => S.JOURS[(v + 1) % 7] },
  genre: { lib: "Genre", multi: true, de: r => r.m?.g || [], libelle: v => S.GENRES[v] || v },
  pays: { lib: "Pays", multi: true, de: r => r.m?.p || [], libelle: v => S.pays(v) },
  langue: { lib: "Langue originale", de: r => r.m?.l || null, libelle: v => S.langue(v) },
  format: { lib: "Format", de: r => r.m?.fmt || null, libelle: v => S.FORMATS[v] || v },
  type: { lib: "Film ou série", de: r => r.m?.ty || null, libelle: v => v === "t" ? "Séries" : "Films" },
  real: { lib: "Réalisateur·rice", multi: true, pers: true, de: r => r.m?.eq?.real || r.m?.re || [], libelle: nomPers },
  acteur: { lib: "Acteur·rice", multi: true, pers: true, de: r => r.m?.ca || [], libelle: nomPers },
  image: { lib: "Chef opérateur·rice", multi: true, pers: true, de: r => r.m?.eq?.image || [], libelle: nomPers },
  musique: { lib: "Compositeur·rice", multi: true, pers: true, de: r => r.m?.eq?.musique || [], libelle: nomPers },
  scen: { lib: "Scénariste", multi: true, pers: true, de: r => r.m?.eq?.scen || [], libelle: nomPers },
  montage: { lib: "Monteur·se", multi: true, pers: true, de: r => r.m?.eq?.montage || [], libelle: nomPers },
  studio: { lib: "Studio / société", multi: true, de: r => r.m?.so || [], libelle: v => S.base?.so?.[v]?.n || v },
  motcle: { lib: "Mot-clé", multi: true, de: r => r.m?.mc || [], libelle: v => S.base?.mc?.[v] || v },
  note: { lib: "Ta note", num: true, de: r => r.note, libelle: v => S.fmtNote(v) },
  note_imdb: { lib: "Note IMDb (arrondie)", num: true, de: r => r.m?.ir ? Math.floor(r.m.ir) : null },
  duree: { lib: "Durée (tranches de 30 min)", num: true, de: r => r.m?.r && r.m.ty === "m" ? Math.floor(r.m.r / 30) * 30 : null, libelle: v => `${S.duree(v)}–${S.duree(v + 30)}` },
  ou: { lib: "Où (cinéma, plateforme…)", vis: true, de: r => r.ou?.type || null, libelle: v => ({ cinema: "Cinéma", plateforme: "Plateforme", support: "Support" }[v] || v) },
  plateforme: { lib: "Plateforme ou support", vis: true, de: r => r.ou?.nom || null },
  cinema: { lib: "Cinéma", vis: true, de: r => r.ou?.type === "cinema" ? (r.ou.cinema || "?") : null },
  avec: { lib: "Avec qui", multi: true, vis: true, de: r => r.avec || [], libelle: v => S.amis[v]?.profil?.nom || v },
  etiquette: { lib: "Étiquette", multi: true, de: r => r.etiquettes || [] },
};
const num = f => rows => { const a = rows.map(f).filter(v => v != null && !isNaN(v)); return moyenne(a); };
St.MES = {
  nb: { lib: "Nombre", f: rows => rows.length, entier: true },
  moy_note: { lib: "Ta note moyenne", f: num(r => r.note), note: true },
  med_note: { lib: "Ta note médiane", f: rows => mediane(rows.map(r => r.note).filter(v => v != null)), note: true },
  moy_imdb: { lib: "Note IMDb moyenne", f: num(r => r.m?.ir), note: true },
  moy_tmdb: { lib: "Note TMDB moyenne", f: num(r => r.m?.vt || null), note: true },
  ecart: { lib: "Écart avec IMDb (ta note − IMDb)", f: num(r => r.note != null && r.m?.ir ? r.note - r.m.ir : null) },
  heures: { lib: "Heures passées", f: rows => rows.reduce((s, r) => s + (r.m?.r || 0) * (r.part ?? 1), 0) / 60 },
  duree_moy: { lib: "Durée moyenne (min)", f: num(r => r.m?.ty === "m" ? r.m.r || null : null) },
  annee_moy: { lib: "Année de sortie moyenne", f: num(r => r.m?.a) },
  budget_moy: { lib: "Budget moyen ($)", f: num(r => r.m?.b || null), argent: true },
  recettes_moy: { lib: "Recettes moyennes ($)", f: num(r => r.m?.rc || null), argent: true },
  pct_coeur: { lib: "Part de coups de cœur (%)", f: rows => rows.length ? 100 * rows.filter(r => r.coeur).length / rows.length : null },
  prix_tot: { lib: "Dépenses au cinéma (€)", f: rows => rows.reduce((s, r) => s + (r.prix || 0), 0), vis: true },
};
St.CHAMPS = {
  note: { lib: "Ta note", f: r => r.note },
  imdb: { lib: "Note IMDb", f: r => r.m?.ir ?? null },
  tmdb: { lib: "Note TMDB", f: r => r.m?.vt || null },
  annee: { lib: "Année de sortie", f: r => r.m?.a ?? null },
  duree: { lib: "Durée (min)", f: r => r.m?.ty === "m" ? r.m?.r || null : null },
  budget: { lib: "Budget ($)", f: r => r.m?.b || null },
  recettes: { lib: "Recettes ($)", f: r => r.m?.rc || null },
  rentab: { lib: "Rentabilité (recettes ÷ budget)", f: r => r.m?.b > 1000 && r.m?.rc ? r.m.rc / r.m.b : null },
  votes: { lib: "Votes IMDb", f: r => r.m?.iv || r.m?.nv || null },
  ecart: { lib: "Ta note − IMDb", f: r => r.note != null && r.m?.ir ? r.note - r.m.ir : null },
  date_vue: { lib: "Date de visionnage", f: r => r.premiere ? +new Date(r.premiere) : null, temps: true },
  popularite: { lib: "Popularité TMDB", f: r => r.m?.pop || null },
};

/* Regroupe des lignes selon une dimension : [[valeur, lignes]] trié (numérique : croissant ; sinon : effectif). */
St.grouper = (rows, dimCle, top = 15, min = 1) => {
  const dim = St.DIMS[dimCle]; const g = new Map();
  for (const r of rows) {
    let v = dim.de(r); if (v == null) continue;
    for (const x of (dim.multi ? v : [v])) { if (x == null || x === "") continue; if (!g.has(x)) g.set(x, []); g.get(x).push(r); }
  }
  let e = [...g.entries()].filter(([, l]) => l.length >= min);
  if (dim.num || dim.temps) e.sort((a, b) => (a[0] > b[0] ? 1 : -1));
  else { e.sort((a, b) => b[1].length - a[1].length); if (top) e = e.slice(0, top); }
  return e;
};

// ------------------------------------------------------------------ rendu d'une configuration de graphique (labo, épinglés)
/* cfg = { mode: "agrege"|"nuage"|"personnes", vue: "courbe"|"barres"|"radar"|"carte", dim, mes, series: "aucune"|"profils"|"genre"|"format"|"decennie"|"personnes",
   profils: [pid], personnes: [{id, nom}], role, x, y, imdb, filtres, top, min } */
St.dessiner = (conteneur, cfg) => {
  const profils = (cfg.profils && cfg.profils.length ? cfg.profils : [""]).filter(p => p === "" || S.amis[p]);
  const couleurs = S.COULEURS;
  const nomP = p => p ? S.nomDe(p) : (S.moi?.profil?.nom || "Moi");
  const lignesDe = p => { const d = St.filtrer(St.donnees(p || undefined), cfg.filtres || {}); return d; };
  const zone = el(`<div></div>`); conteneur.innerHTML = ""; conteneur.append(zone);
  const leg = el(`<div></div>`); conteneur.prepend(leg);
  if (cfg.mode === "personnes") {
    const series = [];
    const rolesOk = cfg.role || "tous";
    (cfg.personnes || []).forEach((pp, i) => {
      profils.forEach((p, j) => {
        const { T } = lignesDe(p);
        const films = T.filter(r => r.note != null && lesPers(r.m, rolesOk).includes(+pp.id));
        films.sort((a, b) => (a.m.ds || "").localeCompare(b.m.ds || ""));
        const couleur = couleurs[(i * Math.max(1, profils.length) + j) % couleurs.length];
        const nom = pp.nom + (profils.length > 1 ? ` · ${nomP(p)}` : "");
        const pts = films.map((r, k) => ({ x: cfg.x === "ordre" ? k + 1 : (cfg.x === "date_vue" ? +new Date(r.premiere || r.m.ds) : r.m.a), y: r.note, lib: `${S.nomTitre(r.m)} (${r.m.a || "?"})`, cle: r.cle, info: `<div class="l"><i style="background:${couleur}"></i>${esc(nom)} · ${S.fmtNote(r.note)}${r.m.ir ? ` · IMDb ${S.fmtNote(r.m.ir)}` : ""}</div>` }));
        series.push({ nom, couleur, points: pts, relier: true, lisse: false });
        if (cfg.imdb && j === 0) series.push({ nom: pp.nom + " · IMDb", couleur, pointille: true, relier: true, lisse: false, points: films.filter(r => r.m.ir).map((r, k) => ({ x: cfg.x === "ordre" ? films.indexOf(r) + 1 : (cfg.x === "date_vue" ? +new Date(r.premiere || r.m.ds) : r.m.a), y: r.m.ir, lib: `${S.nomTitre(r.m)} (${r.m.a})`, cle: r.cle, info: `<div class="l">IMDb ${S.fmtNote(r.m.ir)}</div>` })) });
      });
    });
    if (!series.some(s => s.points.length)) { zone.innerHTML = S.vide("Aucun film noté", "Choisis une ou plusieurs personnes dont tu as noté des films."); return; }
    leg.innerHTML = G.legende(series, { toujours: true });
    G.points(zone, { series, x: { type: cfg.x === "date_vue" ? "temps" : "num", titre: cfg.x === "ordre" ? "Ordre dans sa filmographie (films vus)" : cfg.x === "date_vue" ? "Date de visionnage" : "Année de sortie", format: cfg.x === "ordre" || cfg.x === "date_vue" ? null : d3.format("d") }, y: { titre: "Note", domaine: [0, 10] }, hauteur: 340 });
    return;
  }
  if (cfg.mode === "nuage") {
    const cx = St.CHAMPS[cfg.x || "imdb"], cy = St.CHAMPS[cfg.y || "note"];
    const series = [];
    const parSerie = (rows, cle) => {
      if (cfg.series === "genre") return St.grouper(rows, "genre", 6).map(([v, l]) => [S.GENRES[v] || v, l]);
      if (cfg.series === "format") return St.grouper(rows, "format", 6).map(([v, l]) => [S.FORMATS[v] || v, l]);
      if (cfg.series === "decennie") return St.grouper(rows, "decennie").map(([v, l]) => [`années ${String(v).slice(2)}`, l]);
      return [[cle, rows]];
    };
    profils.forEach(p => {
      const { T } = lignesDe(p);
      for (const [nom, rows] of parSerie(T, nomP(p))) {
        const pts = rows.map(r => ({ x: cx.f(r), y: cy.f(r), lib: `${S.nomTitre(r.m)} (${r.m?.a || "?"})`, cle: r.cle, info: `<div class="l">${esc(cx.lib)} : ${cx.temps ? S.fmtDate(r.premiere) : S.fmtNote(cx.f(r))}</div><div class="l">${esc(cy.lib)} : ${S.fmtNote(cy.f(r))}</div>` })).filter(pt => pt.x != null && pt.y != null);
        series.push({ nom: profils.length > 1 && parSerie(T, "").length > 1 ? `${nom} · ${nomP(p)}` : nom, couleur: couleurs[series.length % couleurs.length], points: pts });
      }
    });
    const n = series.reduce((s, x) => s + x.points.length, 0);
    leg.innerHTML = G.legende(series) + `<div class="mini discret">${S.pluriel(n, "titre")}${n > 2 ? " · " + correlation(series.flatMap(s => s.points)) : ""}</div>`;
    G.points(zone, { series, x: { type: cx.temps ? "temps" : "num", titre: cx.lib, format: cx.temps ? null : (v => Math.abs(v) >= 1e6 ? S.argent(v) : d3.format("~r")(v)) }, y: { titre: cy.lib, format: v => Math.abs(v) >= 1e6 ? S.argent(v) : S.fmtNote(v) }, hauteur: 360 });
    return;
  }
  // agrégé : une dimension, une mesure, éventuellement plusieurs séries
  const dim = St.DIMS[cfg.dim || "annee"], mes = St.MES[cfg.mes || "nb"];
  const unite = (dim.vis || mes.vis) ? "V" : "T";
  const groupes = [];
  const ajouterSerie = (nom, rows) => groupes.push({ nom, g: St.grouper(rows, cfg.dim || "annee", cfg.vue === "radar" ? (cfg.top || 8) : (cfg.top || 15), cfg.min || 1) });
  profils.forEach(p => {
    const d = lignesDe(p); const rows = d[unite];
    if (cfg.series === "personnes" && (cfg.personnes || []).length) (cfg.personnes || []).forEach(pp => ajouterSerie(pp.nom + (profils.length > 1 ? " · " + nomP(p) : ""), rows.filter(r => lesPers(r.m, cfg.role || "tous").includes(+pp.id))));
    else if (["genre", "format", "decennie", "type"].includes(cfg.series) && cfg.series !== cfg.dim) St.grouper(rows, cfg.series, 5).forEach(([v, l]) => ajouterSerie((St.DIMS[cfg.series].libelle || (x => x))(v) + (profils.length > 1 ? " · " + nomP(p) : ""), l));
    else ajouterSerie(nomP(p), rows);
  });
  // catégories communes
  let cats = [];
  if (dim.num || dim.temps) {
    cats = [...new Set(groupes.flatMap(s => s.g.map(([v]) => v)))].sort((a, b) => (a > b ? 1 : -1));
    if (dim.num && cats.length && typeof cats[0] === "number" && ["annee", "annee_vue", "decennie"].includes(cfg.dim)) {  // combler les trous
      const pas = cfg.dim === "decennie" ? 10 : 1; const plein = []; for (let v = cats[0]; v <= cats[cats.length - 1]; v += pas) plein.push(v); cats = plein;
    }
    if (cfg.dim === "mois_vue" && cats.length) { const plein = []; let [a, m] = cats[0].split("-").map(Number); const fin = cats[cats.length - 1]; while (true) { const k = `${a}-${String(m).padStart(2, "0")}`; plein.push(k); if (k >= fin) break; m++; if (m > 12) { m = 1; a++; } } cats = plein; }
  } else {
    const total = new Map(); groupes.forEach(s => s.g.forEach(([v, l]) => total.set(v, (total.get(v) || 0) + l.length)));
    cats = [...total.entries()].sort((a, b) => b[1] - a[1]).slice(0, cfg.vue === "radar" ? (cfg.top || 8) : (cfg.top || 15)).map(([v]) => v);
  }
  const lib = dim.libelle || (v => String(v));
  const series = groupes.map((s, i) => { const mp = new Map(s.g); return { nom: s.nom, couleur: couleurs[i % couleurs.length], valeurs: cats.map(c => mp.has(c) ? mes.f(mp.get(c)) : (mes.entier ? 0 : null)), n: cats.map(c => mp.has(c) ? mp.get(c).length : 0) }; });
  const fmtV = mes.argent ? S.argent : (v => v == null ? "–" : mes.entier ? S.fmtNombre(Math.round(v)) : S.fmtNote(v));
  if (!cats.length) { zone.innerHTML = S.vide("Pas assez de données"); return; }
  if (cfg.vue === "carte" && cfg.dim === "pays") {
    G.carte(zone, { valeurs: Object.fromEntries(cats.map((c, i) => [c, series[0].valeurs[i]]).filter(([, v]) => v != null)), titre: mes.lib, format: fmtV, clic: iso => S.aller(`#/stats?pays=${iso}`) });
    return;
  }
  leg.innerHTML = G.legende(series);
  if (cfg.vue === "radar") {
    G.radar(zone, { axes: cats.map(lib), series: series.map(s => ({ ...s, valeurs: s.valeurs.map(v => v ?? 0), bruts: s.valeurs.map((v, i) => `${fmtV(v)} (${s.n[i]})`) })), max: mes.note ? 10 : undefined, min: mes.note ? Math.max(0, Math.floor(Math.min(...series.flatMap(s => s.valeurs.filter(v => v != null))) - 1)) : 0 });
    return;
  }
  if (cfg.vue === "barres" && !(dim.num || dim.temps) && series.length === 1) {
    G.barresH(zone, cats.map((c, i) => ({ lib: lib(c), v: series[0].valeurs[i] ?? 0, txt: fmtV(series[0].valeurs[i]), sous: mes.entier ? "" : `(${series[0].n[i]})`, lien: dim.pers ? `#/personne/${c}` : null })));
    return;
  }
  if (cfg.vue === "courbe" && (dim.num || dim.temps)) {
    const tps = dim.temps;
    G.points(zone, { series: series.map(s => ({ ...s, relier: true, points: cats.map((c, i) => ({ x: tps ? +new Date(c + "-15") : c, y: s.valeurs[i], n: s.n[i] })).filter(p => p.y != null && (mes.entier || p.n > 0)) })), x: { type: tps ? "temps" : "num", titre: dim.lib, format: tps ? null : (dim.libelle ? (v => dim.libelle(v)) : d3.format("d")), libelle: tps ? (v => S.fmtDate(new Date(+v).toISOString().slice(0, 7))) : lib }, y: { titre: mes.lib, domaine: mes.note ? [0, 10] : undefined, format: mes.argent ? S.argent : null }, reperes: true, hauteur: 320 });
    return;
  }
  G.barres(zone, { categories: cats, series, libelle: lib, y: { titre: mes.lib, format: mes.argent ? S.argent : (mes.note ? (v => S.fmtNote(v)) : d3.format("~s")), formatBulle: fmtV, min: 0, max: mes.note ? 10 : undefined }, hauteur: 300, clic: dim.pers ? (c => S.aller(`#/personne/${c}`)) : null });
};
function correlation(pts) {
  const n = pts.length; if (n < 3) return "";
  const mx = moyenne(pts.map(p => p.x)), my = moyenne(pts.map(p => p.y));
  let a = 0, b = 0, c = 0; for (const p of pts) { a += (p.x - mx) * (p.y - my); b += (p.x - mx) ** 2; c += (p.y - my) ** 2; }
  const r = b && c ? a / Math.sqrt(b * c) : 0;
  return `corrélation ${r.toLocaleString("fr-FR", { maximumFractionDigits: 2 })} (${Math.abs(r) > .6 ? "forte" : Math.abs(r) > .3 ? "moyenne" : "faible"})`;
}
St.correlation = correlation;

// ------------------------------------------------------------------ page Stats
const BLOCS = [];
const carte = (id, titre, sous, large) => `<section class="graph-carte ${large ? "large" : ""}" data-bloc="${id}"><div class="flex haut"><div><h3>${titre}</h3></div><span class="espace"></span><span data-act></span></div><div data-outils class="outils"></div><div data-zone></div></section>`;

S.pages.stats = async (vue, args, params) => {
  if (!S.base) { vue.innerHTML = S.chargement(); await S.chargerBase(); }
  const f = S.filtresMemo.stats = S.filtresMemo.stats || { pid: "", periode: "tout", type: "", format: "" };
  if (params.pays) f.pays = params.pays; else delete f.pays;
  const annees = [...new Set(St.donnees().V.map(v => v.date?.slice(0, 4)).filter(Boolean))].sort().reverse();
  const onglet = S.filtresMemo.stats_o = params.o || S.filtresMemo.stats_o || "chiffres";
  const ONGLETS = [["chiffres", "Chiffres"], ["personnes", "Personnes"], ["gouts", "Goûts"], ["temps", "Temps"], ["amis", "Amis"]];
  vue.innerHTML = `
    <div class="entete"><h1>Stats</h1><a class="icone-bouton grand" href="#/labo" aria-label="Labo" style="margin-left:auto">${ico("labo")}</a></div>
    <div class="onglets onglets-stats">${ONGLETS.map(([k, l]) => `<a href="#/stats?o=${k}"><button class="${k === onglet ? "actif" : ""}">${l}</button></a>`).join("")}</div>
    <div class="stats-barre">
      <select class="champ" data-f="pid" style="width:auto;height:36px;font-size:13px"><option value="">${esc(S.moi.profil.nom)}</option>${Object.entries(S.amis).map(([id, a]) => `<option value="${esc(id)}">${esc(a.profil?.nom || id)}</option>`).join("")}</select>
      <select class="champ" data-f="periode" style="width:auto;height:36px;font-size:13px"><option value="tout">Toujours</option><option value="12m">12 mois</option>${annees.map(a => `<option value="${a}">${a}</option>`).join("")}</select>
      <div class="segments" data-f="type"><button data-v="">Tout</button><button data-v="m">Films</button><button data-v="t">Séries</button></div>
      ${f.pays ? `<span class="puce actif">${esc(S.pays(f.pays))} <a class="x" href="#/stats">${ico("x")}</a></span>` : ""}
    </div>
    <div data-epingles class="stats-grille" style="margin-top:14px"></div>
    <div class="stats-grille" style="margin-top:14px" data-grille></div>`;
  $$("[data-f]", vue).forEach(c => {
    const k = c.dataset.f;
    if (c.tagName === "SELECT") { c.value = f[k] || ""; c.onchange = () => { f[k] = c.value; S.rafraichir(true); }; }
    else { $$("button", c).forEach(b => { b.classList.toggle("actif", (f[k] || "") === b.dataset.v); b.onclick = () => { f[k] = b.dataset.v; S.rafraichir(true); }; }); }
  });
  const pid = f.pid || undefined;
  const d = St.filtrer(St.donnees(pid), f);
  const grille = $("[data-grille]", vue);
  const { T, V } = d;
  const notes = T.map(t => t.note).filter(n => n != null);
  const minutes = T.reduce((s, t) => s + (t.m?.r || 0) * (t.part ?? 1), 0);
  const cine = V.filter(v => v.ou?.type === "cinema");
  const chiffres = `<section class="large"><div class="chiffres">
    <div class="chiffre"><b>${S.fmtNombre(T.filter(t => t.m?.ty !== "t").length)}</b><span>films</span></div>
    <div class="chiffre"><b>${S.fmtNombre(T.filter(t => t.m?.ty === "t").length)}</b><span>séries</span></div>
    <div class="chiffre"><b>${S.fmtNombre(Math.round(minutes / 60))}</b><span>heures</span></div>
    <div class="chiffre"><b>${S.fmtNote(moyenne(notes))}</b><span>moyenne</span></div>
    <div class="chiffre"><b>${S.fmtNombre(T.filter(t => t.coeur).length)}</b><span>coups de cœur</span></div>
    <div class="chiffre"><b>${S.fmtNombre(cine.length)}</b><span>séances</span></div>
  </div></section>`;
  const PAR_ONGLET = {
    chiffres: chiffres + carte("distribution", "Tes notes") + carte("severite", "Ta sévérité face à IMDb") + carte("rythme", "Ton rythme", "", true) + carte("revisionnages", "Revisionnages"),
    personnes: carte("personnes", "Personnes", "", true) + carte("decouvertes", "Découvertes") + carte("completion", "Complétion", "", true),
    gouts: carte("genres", "Genres") + carte("radar", "Radar de tes goûts") + carte("decennies", "Décennies") + carte("durees", "Durées") + carte("pays", "Pays", "", true) + carte("budget", "Budget et recettes", "", true),
    temps: `<section class="large"><div class="raccourcis-decouvrir"><a class="carte" href="#/wrapped/${(annees[0] || S.aujourdhui().slice(0, 4))}">${ico("stats")}<b>Ton année</b></a><a class="carte" href="#/wrapped/${S.moisPrecedent()}">${ico("journal")}<b>Ton mois</b></a></div></section>` + carte("cinema", "Au cinéma") + carte("avec", "Avec qui"),
    amis: carte("compat", "Compatibilité", "", true),
  };
  grille.innerHTML = PAR_ONGLET[onglet] || PAR_ONGLET.chiffres;
  // graphiques épinglés
  const ep = onglet === "chiffres" ? Object.entries(S.vivants(S.moi.graphiques)) : [];
  $("[data-epingles]", vue).innerHTML = ep.map(([id, g]) => `<section class="graph-carte ${g.large !== false ? "large" : ""}" data-g="${id}"><div class="flex"><h3>${esc(g.titre || "Graphique")}</h3><span class="espace"></span><a class="icone-bouton" href="#/labo/${id}" title="Modifier">${ico("crayon")}</a></div><div data-zone></div></section>`).join("");
  requestAnimationFrame(() => {
    ep.forEach(([id, g]) => St.dessiner($(`[data-g="${id}"] [data-zone]`, vue), g));
    for (const b of $$("[data-bloc]", grille)) { try { (BLOC[b.dataset.bloc] || (() => {}))(b, d, pid, f); } catch (e) { console.error(e); $("[data-zone]", b).innerHTML = `<div class="vide petit">${esc(e.message)}</div>`; } }
  });
};

const BLOC = {};
const zoneDe = b => $("[data-zone]", b), outilsDe = b => $("[data-outils]", b);
function segments(b, options, valeur, fn) {
  const o = outilsDe(b);
  const s = el(`<div class="segments">${options.map(([v, l]) => `<button data-v="${v}" class="${v === valeur ? "actif" : ""}">${l}</button>`).join("")}</div>`);
  $$("button", s).forEach(x => x.onclick = () => { $$("button", s).forEach(y => y.classList.toggle("actif", y === x)); fn(x.dataset.v); });
  o.append(s); return s;
}
function selectAmis(b, valeur, fn, libVide = "Comparer avec…") {
  if (!Object.keys(S.amis).length) return;
  const s = el(`<select class="champ" style="width:auto;height:32px;font-size:12.5px"><option value="">${libVide}</option>${Object.entries(S.amis).map(([id, a]) => `<option value="${esc(id)}">${esc(a.profil?.nom || id)}</option>`).join("")}</select>`);
  s.value = valeur || ""; s.onchange = () => fn(s.value); outilsDe(b).append(s);
}
const memo = (k, def) => (S.filtresMemo[k] = S.filtresMemo[k] ?? def);

BLOC.distribution = (b, d, pid, f) => {
  let ami = memo("dist_ami", "");
  const dessiner = () => {
    const cats = d3.range(1, 21).map(i => i / 2);
    const compte = rows => cats.map(c => rows.filter(r => r.note === c).length);
    const series = [{ nom: pid ? S.nomDe(pid) : S.moi.profil.nom, couleur: S.COULEURS[0], valeurs: compte(d.T) }];
    if (ami && ami !== pid) {
      const da = St.filtrer(St.donnees(ami), f).T; const tot1 = d.T.filter(r => r.note != null).length || 1, tot2 = da.filter(r => r.note != null).length || 1;
      series[0].valeurs = series[0].valeurs.map(v => 100 * v / tot1);
      series.push({ nom: S.nomDe(ami), couleur: S.COULEURS[1], valeurs: compte(da).map(v => 100 * v / tot2) });
    }
    $("[data-zone]", b).innerHTML = G.legende(series) + `<div data-g></div>`;
    G.barres($("[data-g]", b), { categories: cats, series, libelle: v => Number.isInteger(v) ? String(v) : "", libelleLong: v => `Note ${S.fmtNote(v)}`, y: { titre: series.length > 1 ? "% des notes" : "titres", formatBulle: v => series.length > 1 ? S.fmtNote(v) + " %" : S.fmtNombre(v) }, hauteur: 220 });
  };
  selectAmis(b, ami, v => { ami = S.filtresMemo.dist_ami = v; dessiner(); });
  dessiner();
};
BLOC.severite = (b, d, pid) => {
  const parAn = St.grouper(d.T.filter(t => t.premiere && t.note != null), "annee_vue");
  if (parAn.length < 2) { zoneDe(b).innerHTML = `<div class="vide petit">Il faut au moins deux années de journal.</div>`; return; }
  const moi = { nom: "Ta note", couleur: S.COULEURS[0], relier: true, points: parAn.map(([a, l]) => ({ x: +a, y: moyenne(l.map(r => r.note)), n: l.length })) };
  const im = { nom: "IMDb (mêmes films)", couleur: S.COULEURS[3], relier: true, pointille: true, points: parAn.map(([a, l]) => ({ x: +a, y: moyenne(l.map(r => r.m?.ir).filter(Boolean)), n: l.filter(r => r.m?.ir).length })).filter(p => p.y != null) };
  zoneDe(b).innerHTML = G.legende([moi, im]) + `<div data-g></div>`;
  G.points($("[data-g]", b), { series: [moi, im], x: { type: "cat", domaine: parAn.map(([a]) => +a) }, y: { domaine: [Math.max(0, Math.floor(Math.min(...moi.points.map(p => p.y), ...im.points.map(p => p.y)) - 1)), 10] }, reperes: true, hauteur: 220 });
};
BLOC.rythme = (b, d) => {
  let mode = memo("rythme", "mois");
  const dessiner = () => {
    const z = zoneDe(b);
    if (mode === "jour") { const g = St.grouper(d.V, "jour"); G.barres(z, { categories: d3.range(7), series: [{ nom: "Visionnages", couleur: S.COULEURS[0], valeurs: d3.range(7).map(i => (g.find(([v]) => v === i)?.[1] || []).length) }], libelle: i => S.JOURS[(i + 1) % 7].slice(0, 3), libelleLong: i => S.JOURS[(i + 1) % 7], hauteur: 220 }); return; }
    if (mode === "cumul") {
      let n = 0; const pts = d.V.filter(v => v.date && !v.approx).map(v => ({ x: +new Date(v.date), y: ++n, lib: S.nomTitre(v.m) + " · " + S.fmtDate(v.date), cle: v.cle }));
      G.points(z, { series: [{ nom: "Visionnages cumulés", couleur: S.COULEURS[0], relier: true, aire: true, pointsVisibles: false, points: pts }], x: { type: "temps" }, y: { titre: "visionnages", format: d3.format("~s") }, hauteur: 240 }); return;
    }
    const g = St.grouper(d.V.filter(v => !v.approx), "mois_vue");
    if (!g.length) { z.innerHTML = `<div class="vide petit">Ton journal est vide pour cette période.</div>`; return; }
    let cats = []; let [a, m] = g[0][0].split("-").map(Number); const fin = g[g.length - 1][0];
    while (true) { const k = `${a}-${String(m).padStart(2, "0")}`; cats.push(k); if (k >= fin) break; if (++m > 12) { m = 1; a++; } }
    if (cats.length > 36) cats = cats.slice(-36);
    const mp = new Map(g);
    G.barres(z, { categories: cats, series: [{ nom: "Visionnages", couleur: S.COULEURS[0], valeurs: cats.map(c => (mp.get(c) || []).length) }], libelle: c => c.endsWith("-01") || cats.length < 13 ? S.fmtDate(c, true).replace(/ \d{4}$/, c.endsWith("-01") ? " " + c.slice(2, 4) : "") : "", libelleLong: c => S.fmtDate(c), hauteur: 220, clic: c => S.aller(`#/mois/${c}`) });
  };
  segments(b, [["mois", "Par mois"], ["jour", "Par jour"], ["cumul", "Cumul"]], mode, v => { mode = S.filtresMemo.rythme = v; dessiner(); });
  dessiner();
};

BLOC.personnes = (b, d, pid) => {
  const st = memo("pers", { role: "real", tri: "nb", min: 2, complet: false, format: "" });
  const z = zoneDe(b), o = outilsDe(b);
  o.innerHTML = `<div class="segments" data-role>${[["real", "Réalisation"], ["acteur", "Acteurs"], ["actrice", "Actrices"], ["image", "Image"], ["musique", "Musique"], ["scen", "Scénario"], ["montage", "Montage"]].map(([v, l]) => `<button data-v="${v}">${l}</button>`).join("")}</div>
    <select class="champ" data-tri style="width:auto;height:32px;font-size:12.5px"><option value="nb">Les plus vus</option><option value="chouchous">Mieux notés</option><option value="betes">Moins bien notés</option><option value="imdb">Au-dessus d'IMDb</option></select>
    <label class="flex mini muet">au moins <select class="champ" data-min style="width:auto;height:32px;font-size:12.5px">${[1, 2, 3, 5, 8, 10].map(n => `<option>${n}</option>`).join("")}</select></label>
    <select class="champ" data-format style="width:auto;height:32px;font-size:12.5px"><option value="">Tous formats</option><option value="long">Longs métrages</option><option value="court">Courts métrages</option><option value="docu">Documentaires</option></select>
    <label class="case mini"><input type="checkbox" data-complet> Filmo complète</label>`;
  $$("[data-role] button", o).forEach(x => { x.classList.toggle("actif", x.dataset.v === st.role); x.onclick = () => { st.role = x.dataset.v; BLOC.personnes(b, d, pid); }; });
  $("[data-tri]", o).value = st.tri; $("[data-tri]", o).onchange = e => { st.tri = e.target.value; BLOC.personnes(b, d, pid); };
  $("[data-min]", o).value = st.min; $("[data-min]", o).onchange = e => { st.min = +e.target.value; BLOC.personnes(b, d, pid); };
  $("[data-format]", o).value = st.format; $("[data-format]", o).onchange = e => { st.format = e.target.value; BLOC.personnes(b, d, pid); };
  $("[data-complet]", o).checked = st.complet; $("[data-complet]", o).onchange = e => { st.complet = e.target.checked; BLOC.personnes(b, d, pid); };
  const rows = d.T.filter(r => r.m && (!st.format || r.m.fmt === st.format));
  const role = st.role === "actrice" ? "acteur" : st.role;
  let g = St.grouper(rows, role, 0, st.tri === "nb" ? st.min : Math.max(5, st.min));
  if (st.role === "actrice") g = g.filter(([id]) => pers(id).g === 1);
  else if (st.role === "acteur") g = g.filter(([id]) => pers(id).g !== 1);
  let liste = g.map(([id, l]) => { const n = l.map(r => r.note).filter(x => x != null); const im = l.map(r => r.m.ir).filter(Boolean); return { id, l, nb: l.length, moy: moyenne(n), imdb: moyenne(im), ecart: n.length && im.length ? moyenne(l.filter(r => r.note != null && r.m.ir).map(r => r.note - r.m.ir)) : null }; });
  const tri = { nb: (a, b) => b.nb - a.nb || (b.moy || 0) - (a.moy || 0), chouchous: (a, b) => (b.moy ?? -1) - (a.moy ?? -1) || b.nb - a.nb, betes: (a, b) => (a.moy ?? 99) - (b.moy ?? 99) || b.nb - a.nb, imdb: (a, b) => (b.ecart ?? -99) - (a.ecart ?? -99) };
  liste = liste.filter(x => st.tri === "nb" || st.tri === "imdb" ? true : x.moy != null).sort(tri[st.tri]);
  const afficher = (l, completion) => {
    z.innerHTML = l.length ? `<div class="classement-p">${l.slice(0, 30).map((x, i) => { const p = pers(x.id); const c = completion?.[x.id]; return `<a href="#/personne/${x.id}"><span class="n">${i + 1}</span>${S.portrait(p.ph, p.n)}<span><b style="font-weight:550">${esc(p.n || x.id)}</b><br><span class="mini discret">${S.pluriel(x.nb, "titre")}${c ? ` · ${c.vus}/${c.total} de sa filmo` : ""}</span></span><span class="valeurs"><span class="note-txt">${S.fmtNote(x.moy)}</span><small>IMDb ${S.fmtNote(x.imdb)}</small></span></a>`; }).join("")}</div>` : `<div class="vide petit">Personne avec au moins ${st.min} titre${st.min > 1 ? "s" : ""}.</div>`;
  };
  if (!st.complet) { afficher(liste); return; }
  z.innerHTML = S.chargement();
  const candidats = liste.slice(0, 60);
  S.api("/api/filmos?ids=" + candidats.map(x => x.id).join(",")).then(filmos => {
    const vus = new Set(d.T.map(r => r.cle));
    const auj = S.aujourdhui();
    const comp = {};
    for (const x of candidats) {
      const fl = (filmos[x.id] || []).filter(([cle, roles, fmt, date]) => date && date <= auj && roles.includes(role === "acteur" ? "acteur" : role) && (!st.format || fmt === st.format) && (st.format || fmt !== "court"));
      comp[x.id] = { total: fl.length, vus: fl.filter(([cle]) => vus.has(cle)).length };
    }
    afficher(candidats.filter(x => comp[x.id].total && comp[x.id].vus >= comp[x.id].total), comp);
    if (!z.querySelector("a")) z.innerHTML = `<div class="vide petit">Aucune filmographie complète parmi tes ${candidats.length} premiers (${st.format ? S.FORMATS[st.format].toLowerCase() + "s" : "courts métrages exclus"}).</div>`;
  }).catch(e => z.innerHTML = `<div class="vide petit">${esc(e.horsLigne ? "Hors ligne : la complétion a besoin de TMDB." : e.message)}</div>`);
};

const blocBarres = (dimCle, top = 12) => (b, d) => {
  let mes = memo("mes_" + dimCle, "nb");
  const dessiner = () => {
    const dim = St.DIMS[dimCle];
    const rows = d.T;
    let g = St.grouper(rows, dimCle, top * 3, mes === "nb" ? 1 : 2).map(([v, l]) => ({ v, l, nb: l.length, moy: moyenne(l.map(r => r.note).filter(n => n != null)) }));
    if (mes === "moy") g = g.filter(x => x.moy != null).sort((a, b) => b.moy - a.moy);
    g = g.slice(0, top);
    G.barresH(zoneDe(b), g.map(x => ({ lib: (dim.libelle || String)(x.v), v: mes === "nb" ? x.nb : x.moy, txt: mes === "nb" ? S.fmtNombre(x.nb) : S.fmtNote(x.moy), sous: mes === "nb" ? (x.moy != null ? `moy. ${S.fmtNote(x.moy)}` : "") : `(${x.nb})`, lien: dimCle === "motcle" ? `#/motcle/${x.v}` : dimCle === "pays" ? `#/stats?pays=${x.v}` : null })), { couleur: mes === "nb" ? "var(--c1)" : "var(--c7)" });
  };
  segments(b, [["nb", "Nombre"], ["moy", "Ta moyenne"]], mes, v => { mes = S.filtresMemo["mes_" + dimCle] = v; dessiner(); });
  dessiner();
};
BLOC.genres = blocBarres("genre", 14);
BLOC.langues = blocBarres("langue", 10);
BLOC.motscles = blocBarres("motcle", 15);
BLOC.studios = blocBarres("studio", 12);
BLOC.radar = (b, d, pid, f) => {
  let ami = memo("radar_ami", ""), mes = memo("radar_mes", "moy_note");
  const dessiner = () => {
    const cfg = { mode: "agrege", vue: "radar", dim: "genre", mes, top: 8, profils: [pid || "", ...(ami && ami !== pid ? [ami] : [])], filtres: f, min: 2 };
    if (mes === "nb") cfg.mes = "pct";
    if (mes === "nb") { // part de chaque genre (%), comparable entre profils
      const profs = cfg.profils; const cats = St.grouper(d.T, "genre", 8).map(([v]) => v);
      const series = profs.map((p, i) => { const T = St.filtrer(St.donnees(p || undefined), f).T; const tot = T.length || 1; return { nom: p ? S.nomDe(p) : S.moi.profil.nom, couleur: S.COULEURS[i], valeurs: cats.map(c => 100 * T.filter(r => (r.m?.g || []).includes(c)).length / tot), bruts: cats.map(c => S.fmtNote(100 * T.filter(r => (r.m?.g || []).includes(c)).length / tot) + " %") }; });
      zoneDe(b).innerHTML = G.legende(series) + `<div data-g></div>`;
      G.radar($("[data-g]", b), { axes: cats.map(c => S.GENRES[c] || c), series, hauteur: 320 });
      return;
    }
    St.dessiner(zoneDe(b), cfg);
  };
  segments(b, [["moy_note", "Ta moyenne"], ["nb", "Part des films"]], mes, v => { mes = S.filtresMemo.radar_mes = v; dessiner(); });
  selectAmis(b, ami, v => { ami = S.filtresMemo.radar_ami = v; dessiner(); });
  dessiner();
};
BLOC.decennies = (b, d, pid, f) => St.dessiner(zoneDe(b), { mode: "agrege", vue: "barres", dim: "decennie", mes: "nb", profils: [pid || ""], filtres: f });
BLOC.durees = (b, d, pid, f) => St.dessiner(zoneDe(b), { mode: "agrege", vue: "barres", dim: "duree", mes: "nb", profils: [pid || ""], filtres: Object.assign({}, f, { type: "m" }) });
BLOC.pays = (b, d, pid, f) => {
  let mes = memo("pays_mes", "nb");
  const zone = zoneDe(b);
  zone.innerHTML = `<div data-carte></div><div data-liste style="margin-top:12px"></div>`;
  const dessiner = () => {
    St.dessiner($("[data-carte]", zone), { mode: "agrege", vue: "carte", dim: "pays", mes: mes === "moy" ? "moy_note" : "nb", profils: [pid || ""], filtres: f, top: 300, min: mes === "moy" ? 2 : 1 });
    const g = St.grouper(d.T, "pays", 10).map(([v, l]) => ({ v, nb: l.length, moy: moyenne(l.map(r => r.note).filter(n => n != null)) }));
    G.barresH($("[data-liste]", zone), g.map(x => ({ lib: S.pays(x.v), v: x.nb, sous: x.moy != null ? `moy. ${S.fmtNote(x.moy)}` : "", lien: `#/stats?pays=${x.v}` })));
  };
  segments(b, [["nb", "Nombre"], ["moy", "Ta moyenne"]], mes, v => { mes = S.filtresMemo.pays_mes = v; dessiner(); });
  const nbPays = new Set(d.T.flatMap(r => r.m?.p || [])).size;
  $("[data-act]", b).innerHTML = `<span class="mini discret">${S.pluriel(nbPays, "pays", "pays")}</span>`;
  dessiner();
};
BLOC.budget = (b, d, pid, f) => {
  let y = memo("budget_y", "note");
  const dessiner = () => St.dessiner(zoneDe(b), { mode: "nuage", x: "budget", y, profils: [pid || ""], filtres: Object.assign({}, f, { type: "m" }) });
  segments(b, [["note", "Ta note"], ["recettes", "Recettes"], ["rentab", "Rentabilité"]], y, v => { y = S.filtresMemo.budget_y = v; dessiner(); });
  dessiner();
};
BLOC.decouvertes = (b, d) => {
  const vu = { real: new Map(), acteur: new Map() };
  const evenements = [];
  const ordre = [...d.T].sort((a, b) => (a.premiere || "0000").localeCompare(b.premiere || "0000"));
  for (const r of ordre) {
    for (const [role, ids] of [["real", r.m?.eq?.real || r.m?.re || []], ["acteur", (r.m?.ca || []).slice(0, 5)]]) {
      for (const id of ids) if (!vu[role].has(id)) { vu[role].set(id, r); if (r.premiere) evenements.push({ role, id, r }); }
    }
  }
  const parAn = d3.rollup(evenements, l => ({ real: l.filter(e => e.role === "real").length, acteur: l.filter(e => e.role === "acteur").length }), e => e.r.premiere.slice(0, 4));
  const ans = [...parAn.keys()].sort();
  const z = zoneDe(b);
  z.innerHTML = `<div data-g></div><div class="section-titre" style="margin:14px 0 6px"><h2 style="font-size:14px">Dernières découvertes</h2></div><div class="classement-p">${evenements.filter(e => e.role === "real").slice(-8).reverse().map(e => { const p = pers(e.id); return `<a href="#/personne/${e.id}"><span class="n"></span>${S.portrait(p.ph, p.n)}<span><b style="font-weight:550">${esc(p.n || "")}</b><br><span class="mini discret">avec ${esc(S.nomTitre(e.r.m))} · ${S.fmtDate(e.r.premiere, true)}</span></span><span></span></a>`; }).join("") || `<div class="vide petit">Ajoute des films à ton journal pour voir tes découvertes.</div>`}</div>`;
  if (ans.length) {
    const series = [{ nom: "Réalisateurs", couleur: S.COULEURS[0], valeurs: ans.map(a => parAn.get(a).real) }, { nom: "Acteurs (rôles principaux)", couleur: S.COULEURS[2], valeurs: ans.map(a => parAn.get(a).acteur) }];
    $("[data-g]", z).innerHTML = G.legende(series) + "<div></div>";
    G.barres($("[data-g] > div:last-child", z), { categories: ans, series, hauteur: 200 });
  }
};
BLOC.revisionnages = (b, d) => {
  const l = d.T.filter(r => r.nbVis > 1).sort((a, b) => b.nbVis - a.nbVis).slice(0, 12);
  zoneDe(b).innerHTML = l.length ? `<div class="lignes">${l.map(r => S.ligneTitre(r.cle, { glisse: false, droite: `<span class="mini">${r.nbVis} fois</span>${r.note != null ? `<span class="note-txt">${S.fmtNote(r.note)}</span>` : ""}` })).join("")}</div>` : `<div class="vide petit">Aucun film vu plusieurs fois (dans ton journal).</div>`;
};
St.compat = (pa, pb) => {
  const A = new Map(St.donnees(pa || undefined).T.filter(r => r.note != null).map(r => [r.cle, r]));
  const communs = St.donnees(pb || undefined).T.filter(r => r.note != null && A.has(r.cle)).map(r => ({ cle: r.cle, m: r.m, a: A.get(r.cle).note, b: r.note }));
  if (!communs.length) return { n: 0 };
  const ecart = moyenne(communs.map(c => Math.abs(c.a - c.b)));
  const pts = communs.map(c => ({ x: c.a, y: c.b }));
  const mx = moyenne(pts.map(p => p.x)), my = moyenne(pts.map(p => p.y));
  let s1 = 0, s2 = 0, s3 = 0; for (const p of pts) { s1 += (p.x - mx) * (p.y - my); s2 += (p.x - mx) ** 2; s3 += (p.y - my) ** 2; }
  const r = s2 && s3 ? s1 / Math.sqrt(s2 * s3) : 0;
  const accord = Math.max(0, Math.round(100 - ecart * 12));
  return { n: communs.length, ecart, r, accord, communs, desaccords: [...communs].sort((x, y) => Math.abs(y.a - y.b) - Math.abs(x.a - x.b)).slice(0, 5), coeurs: [...communs].sort((x, y) => (y.a + y.b) - (x.a + x.b)).slice(0, 5) };
};
BLOC.compat = (b, d, pid) => {
  const amis = Object.keys(S.amis).filter(a => a !== pid);
  if (!amis.length) { zoneDe(b).innerHTML = `<div class="vide petit">Tes amis apparaîtront ici dès que la synchro GitHub sera réglée (Réglages).</div>`; return; }
  let ami = memo("compat_ami", amis[0]);
  if (!amis.includes(ami)) ami = amis[0];
  const dessiner = () => {
    const c = St.compat(pid, ami);
    const z = zoneDe(b);
    if (!c.n) { z.innerHTML = `<div class="vide petit">Aucun film noté en commun avec ${esc(S.nomDe(ami))}.</div>`; return; }
    z.innerHTML = `<div class="chiffres"><div class="chiffre"><b>${c.accord} %</b><span>d'accord (écart moyen ${S.fmtNote(c.ecart)} pt)</span></div><div class="chiffre"><b>${S.fmtNombre(c.n)}</b><span>films notés en commun</span></div><div class="chiffre"><b>${c.r.toLocaleString("fr-FR", { maximumFractionDigits: 2 })}</b><span>corrélation de vos notes</span></div></div>
      <div class="grille-2" style="margin-top:12px;gap:14px"><div><div class="mini muet" style="margin:4px 0 6px">Vos plus gros désaccords</div><div class="lignes">${c.desaccords.map(x => S.ligneTitre(x.cle, { glisse: false, droite: `<span class="note-txt">${S.fmtNote(x.a)}</span><span class="discret">/</span><span class="note-txt" style="color:var(--c2)">${S.fmtNote(x.b)}</span>` })).join("")}</div></div>
      <div><div class="mini muet" style="margin:4px 0 6px">Vos coups de cœur communs</div><div class="lignes">${c.coeurs.map(x => S.ligneTitre(x.cle, { glisse: false, droite: `<span class="note-txt">${S.fmtNote(x.a)}</span><span class="discret">/</span><span class="note-txt" style="color:var(--c2)">${S.fmtNote(x.b)}</span>` })).join("")}</div></div></div>
      <div data-g style="margin-top:12px"></div>`;
    const series = [{ nom: `${pid ? S.nomDe(pid) : "Toi"} (x) contre ${S.nomDe(ami)} (y)`, couleur: S.COULEURS[0], points: c.communs.map(x => ({ x: x.a + (Math.random() - .5) * .18, y: x.b + (Math.random() - .5) * .18, lib: S.nomTitre(x.m), cle: x.cle, info: `<div class="l">${esc(pid ? S.nomDe(pid) : "Toi")} ${S.fmtNote(x.a)} · ${esc(S.nomDe(ami))} ${S.fmtNote(x.b)}</div>` })) }];
    G.points($("[data-g]", z), { series, x: { titre: pid ? S.nomDe(pid) : "Ta note", domaine: [0, 10] }, y: { titre: S.nomDe(ami), domaine: [0, 10] }, hauteur: 280 });
  };
  const s = el(`<select class="champ" style="width:auto;height:32px;font-size:12.5px">${amis.map(a => `<option value="${esc(a)}">${esc(S.nomDe(a))}</option>`).join("")}</select>`);
  s.value = ami; s.onchange = () => { ami = S.filtresMemo.compat_ami = s.value; dessiner(); }; outilsDe(b).append(s);
  dessiner();
};
BLOC.completion = (b, d, pid) => {
  const z = zoneDe(b);
  const vus = new Set(d.T.map(r => r.cle));
  const fav = Object.entries(S.vivants(S.docDe(pid)?.favoris));
  z.innerHTML = `<div data-fav></div><div class="section-titre" style="margin:16px 0 8px"><h2 style="font-size:14px">Palmarès</h2></div><div data-prix class="barres-h"></div>`;
  if (fav.length) {
    $("[data-fav]", z).innerHTML = S.chargement();
    S.api("/api/filmos?ids=" + fav.map(([id]) => id).join(",")).then(fl => {
      const auj = S.aujourdhui();
      const lignes = fav.map(([id, p]) => { const l = (fl[id] || []).filter(([, roles, fmt, date]) => date && date <= auj && fmt !== "court" && (roles.includes("real") || roles.includes(p.metier === "acteur" ? "acteur" : "real") || roles.includes(p.metier))); const v = l.filter(([c]) => vus.has(c)).length; return { lib: p.nom, v: l.length ? 100 * v / l.length : 0, txt: `${v}/${l.length}`, lien: `#/personne/${id}` }; }).sort((a, b) => b.v - a.v);
      G.barresH($("[data-fav]", z), lignes);
    }).catch(() => $("[data-fav]", z).innerHTML = `<div class="vide petit">Hors ligne.</div>`);
  } else $("[data-fav]", z).innerHTML = `<div class="vide petit">Ajoute des personnes en favori (cœur sur leur page) pour suivre ta complétion de leur filmographie.</div>`;
  S.api("/api/palmares").then(liste => {
    const cont = $("[data-prix]", z);
    cont.innerHTML = Object.entries(liste).map(([k, nom]) => `<div class="barre-h" data-prix-cle="${k}" style="cursor:pointer"><span class="lib">${esc(nom)}</span><span class="piste"><i style="width:0"></i></span><span class="val mini discret">…</span></div>`).join("");
    for (const [k] of Object.entries(liste)) S.api("/api/palmares/" + k).then(p => {
      const l = $(`[data-prix-cle="${k}"]`, cont); if (!l) return;
      const v = p.films.filter(f => vus.has(f.cle)).length;
      $("i", l).style.width = Math.max(1.5, 100 * v / (p.films.length || 1)) + "%";
      $(".val", l).innerHTML = `${v}/${p.films.length}`;
      l.onclick = () => S.aller(`#/palmares/${k}`);
    }).catch(() => { const l = $(`[data-prix-cle="${k}"] .val`, cont); if (l) l.textContent = "hors ligne"; });
  }).catch(() => {});
};
BLOC.cinema = (b, d) => {
  const c = d.V.filter(v => v.ou?.type === "cinema");
  const z = zoneDe(b);
  if (!c.length) { z.innerHTML = `<div class="vide petit">Indique « Cinéma » dans les détails d'un visionnage pour voir tes séances ici.</div>`; return; }
  const prix = c.filter(v => v.prix);
  z.innerHTML = `<div class="chiffres"><div class="chiffre"><b>${c.length}</b><span>séances</span></div><div class="chiffre"><b>${S.fmtNote(prix.reduce((s, v) => s + v.prix, 0))} €</b><span>dépensés (${prix.length ? S.fmtNote(moyenne(prix.map(v => v.prix))) + " € en moyenne" : "prix non notés"})</span></div><div class="chiffre"><b>${new Set(c.map(v => v.ou.cinema).filter(Boolean)).size}</b><span>cinémas différents</span></div></div><div data-l style="margin-top:12px"></div>`;
  const g = St.grouper(c, "cinema", 10);
  G.barresH($("[data-l]", z), g.map(([v, l]) => ({ lib: v, v: l.length, sous: l.some(x => x.prix) ? `${S.fmtNote(l.reduce((s, x) => s + (x.prix || 0), 0))} €` : "" })));
};
BLOC.avec = (b, d) => {
  const g = St.grouper(d.V, "avec", 12);
  if (!g.length) { zoneDe(b).innerHTML = `<div class="vide petit">Indique avec qui tu as vu un film (détails du visionnage).</div>`; return; }
  G.barresH(zoneDe(b), g.map(([v, l]) => ({ lib: S.amis[v]?.profil?.nom || v, v: l.length, sous: `moy. ${S.fmtNote(moyenne(l.map(x => x.note).filter(n => n != null)))}` })));
};

// ------------------------------------------------------------------ labo
const CFG_DEFAUT = { mode: "personnes", vue: "courbe", dim: "annee", mes: "moy_note", series: "aucune", profils: [""], personnes: [], role: "real", x: "annee", y: "note", imdb: true, filtres: {}, top: 15 };
S.pages.labo = async (vue, args) => {
  if (!S.base) { vue.innerHTML = S.chargement(); await S.chargerBase(); }
  const gid = args[0];
  const existant = gid ? S.vivants(S.moi.graphiques)[gid] : null;
  const cfg = S.filtresMemo.labo = (existant && S.filtresMemo.laboId !== gid) ? JSON.parse(JSON.stringify(existant)) : (S.filtresMemo.labo || JSON.parse(JSON.stringify(CFG_DEFAUT)));
  S.filtresMemo.laboId = gid || null;
  cfg.filtres = cfg.filtres || {};
  const opts = (o, v) => Object.entries(o).map(([k, x]) => `<option value="${k}" ${k === v ? "selected" : ""}>${esc(x.lib || x)}</option>`).join("");
  const profils = [["", S.moi.profil.nom], ...Object.entries(S.amis).map(([id, a]) => [id, a.profil?.nom || id])];
  vue.innerHTML = `<div class="entete"><h1>Labo</h1><span class="espace"></span><button class="bouton petit" data-reinit>Réinitialiser</button></div>
  <div class="labo">
    <div class="carte reglages-g">
      <div class="etapes-labo"><button data-aller="1">1 · Type</button><button data-aller="2">2 · Axes</button><button data-aller="3">3 · Filtres</button></div>
      <div data-etape="1"><div class="segments" data-mode style="margin-bottom:14px;display:flex;flex-wrap:wrap"><button data-v="personnes">Courbes par personne</button><button data-v="agrege">Constructeur libre</button><button data-v="nuage">Nuage de points</button></div></div>
      <div data-etape="2">
      <div data-r-personnes>
        <label class="etiquette">Personnes (jusqu'à 6)</label>
        <input class="champ" data-chercher-p placeholder="Lynch, Villeneuve, Huppert…">
        <div class="res-recherche" data-res-p></div>
        <div class="selection-p" data-sel-p></div>
        <label class="etiquette">Rôle</label>
        <select class="champ" data-c="role"><option value="tous">Tous les rôles</option><option value="real">Réalisation</option><option value="acteur">Interprétation</option><option value="image">Image</option><option value="musique">Musique</option><option value="scen">Scénario</option><option value="montage">Montage</option></select>
        <label class="etiquette">Axe horizontal</label>
        <select class="champ" data-c="x"><option value="annee">Année de sortie</option><option value="ordre">Ordre dans la filmo</option><option value="date_vue">Date de visionnage</option></select>
        <label class="case"><input type="checkbox" data-c="imdb"> Note IMDb en pointillé</label>
      </div>
      <div data-r-agrege>
        <label class="etiquette">Regrouper par (axe horizontal)</label><select class="champ" data-c="dim">${opts(St.DIMS, cfg.dim)}</select>
        <label class="etiquette">Mesure (axe vertical)</label><select class="champ" data-c="mes">${opts(St.MES, cfg.mes)}</select>
        <label class="etiquette">Graphique</label><div class="segments" data-vue><button data-v="courbe">Courbe</button><button data-v="barres">Barres</button><button data-v="radar">Radar</button><button data-v="carte">Carte</button></div>
        <label class="etiquette">Une série par</label><select class="champ" data-c="series"><option value="aucune">— (une seule)</option><option value="personnes">Personne choisie</option><option value="genre">Genre</option><option value="format">Format</option><option value="decennie">Décennie</option><option value="type">Film / série</option></select>
        <div data-pers-agrege class="cache"><label class="etiquette">Personnes</label><input class="champ" data-chercher-p2 placeholder="Chercher une personne…"><div class="res-recherche" data-res-p2></div><div class="selection-p" data-sel-p2></div></div>
        <label class="etiquette">Nombre max. de catégories</label><select class="champ" data-c="top">${[5, 8, 10, 15, 20, 30, 50].map(n => `<option ${n === +cfg.top ? "selected" : ""}>${n}</option>`).join("")}</select>
      </div>
      <div data-r-nuage>
        <label class="etiquette">Axe horizontal</label><select class="champ" data-c="x2">${opts(St.CHAMPS, cfg.x2 || "imdb")}</select>
        <label class="etiquette">Axe vertical</label><select class="champ" data-c="y">${opts(St.CHAMPS, cfg.y)}</select>
        <label class="etiquette">Couleur par</label><select class="champ" data-c="series2"><option value="aucune">— (profil)</option><option value="genre">Genre</option><option value="format">Format</option><option value="decennie">Décennie</option></select>
      </div>
      </div>
      <div data-etape="3">
      <label class="etiquette">Profils comparés</label>
      <div class="puces" data-profils>${profils.map(([id, n]) => `<button class="puce" data-p="${esc(id)}">${esc(n)}</button>`).join("")}</div>
      <label class="etiquette">Filtres</label>
      <div class="grille-2">
        <select class="champ" data-fi="type"><option value="">Films et séries</option><option value="m">Films</option><option value="t">Séries</option></select>
        <select class="champ" data-fi="format"><option value="">Tous formats</option>${Object.entries(S.FORMATS).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select>
        <select class="champ" data-fi="genre" style="margin-top:8px"><option value="">Tous genres</option>${Object.entries(S.GENRES).filter(([k]) => +k < 10759).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select>
        <select class="champ" data-fi="periode" style="margin-top:8px"><option value="tout">Depuis toujours</option><option value="12m">12 derniers mois</option>${[...new Set(St.donnees().V.map(v => v.date?.slice(0, 4)).filter(Boolean))].sort().reverse().map(a => `<option value="${a}">Vus en ${a}</option>`).join("")}</select>
      </div>
      <div class="separateur"></div>
      <input class="champ" data-titre placeholder="Titre du graphique" value="${esc(cfg.titre || "")}">
      <div class="flex" style="margin-top:10px"><button class="bouton principal" data-epingler style="flex:1">${ico("epingle")} ${gid ? "Mettre à jour" : "Épingler"}</button>${gid ? `<button class="bouton danger" data-desepingler title="Retirer">${ico("poubelle")}</button>` : ""}</div>
      </div>
    </div>
    <div class="graph-carte" style="min-height:420px"><h3 data-titre-g></h3><div data-zone></div></div>
  </div>`;
  let etape = S.filtresMemo.labo_etape || "1";
  const montrerEtape = k => { etape = S.filtresMemo.labo_etape = k; $$("[data-etape]", vue).forEach(x => x.classList.toggle("etape-active", x.dataset.etape === k)); $$("[data-aller]", vue).forEach(b => b.classList.toggle("actif", b.dataset.aller === k)); };
  $$("[data-aller]", vue).forEach(b => b.onclick = () => montrerEtape(b.dataset.aller));
  montrerEtape(etape);
  const majVisibles = () => {
    $$("[data-mode] button", vue).forEach(b => b.classList.toggle("actif", b.dataset.v === cfg.mode));
    ["personnes", "agrege", "nuage"].forEach(m => $(`[data-r-${m}]`, vue).classList.toggle("cache", cfg.mode !== m));
    $$("[data-vue] button", vue).forEach(b => b.classList.toggle("actif", b.dataset.v === cfg.vue));
    $("[data-pers-agrege]", vue).classList.toggle("cache", cfg.series !== "personnes");
    $$("[data-p]", vue).forEach(b => b.classList.toggle("actif", (cfg.profils || [""]).includes(b.dataset.p)));
  };
  const titreAuto = () => cfg.mode === "personnes" ? `${(cfg.personnes || []).map(p => p.nom).join(", ") || "Personnes"} : tes notes` : cfg.mode === "nuage" ? `${St.CHAMPS[cfg.x2 || "imdb"].lib} et ${St.CHAMPS[cfg.y].lib}` : `${St.MES[cfg.mes].lib} par ${St.DIMS[cfg.dim].lib.toLowerCase()}`;
  const dessiner = () => {
    majVisibles();
    const c = cfg.mode === "nuage" ? { ...cfg, x: cfg.x2 || "imdb", series: cfg.series2 || "aucune" } : cfg;
    $("[data-titre-g]", vue).textContent = cfg.titre || titreAuto();
    St.dessiner($("[data-zone]", vue), c);
  };
  $$("[data-mode] button", vue).forEach(b => b.onclick = () => { if (matchMedia("(max-width: 899px)").matches) setTimeout(() => montrerEtape("2"), 150); cfg.mode = b.dataset.v; if (cfg.mode === "agrege" && cfg.vue === "courbe" && !St.DIMS[cfg.dim].num && !St.DIMS[cfg.dim].temps) cfg.vue = "barres"; dessiner(); });
  $$("[data-vue] button", vue).forEach(b => b.onclick = () => { cfg.vue = b.dataset.v; if (cfg.vue === "carte") { cfg.dim = "pays"; $("[data-c=dim]", vue).value = "pays"; } dessiner(); });
  $$("[data-c]", vue).forEach(c => {
    const k = c.dataset.c;
    if (c.type === "checkbox") { c.checked = !!cfg[k]; c.onchange = () => { cfg[k] = c.checked; dessiner(); }; }
    else { if (cfg[k] != null) c.value = cfg[k]; c.onchange = () => { cfg[k] = c.value; if (k === "dim" && cfg.vue === "courbe" && !St.DIMS[c.value].num && !St.DIMS[c.value].temps) cfg.vue = "barres"; dessiner(); }; }
  });
  $$("[data-fi]", vue).forEach(c => { c.value = cfg.filtres[c.dataset.fi] || (c.dataset.fi === "periode" ? "tout" : ""); c.onchange = () => { cfg.filtres[c.dataset.fi] = c.value; dessiner(); }; });
  $$("[data-p]", vue).forEach(b => b.onclick = () => { const p = b.dataset.p; cfg.profils = cfg.profils || [""]; cfg.profils = cfg.profils.includes(p) ? cfg.profils.filter(x => x !== p) : [...cfg.profils, p]; if (!cfg.profils.length) cfg.profils = [""]; dessiner(); });
  const choixPersonnes = (champ, res, sel) => {
    const peindreSel = () => { sel.innerHTML = (cfg.personnes || []).map((p, i) => `<span class="puce actif" style="border-color:${S.COULEURS[i % 8]}">${esc(p.nom)} <button class="x" data-i="${i}">${ico("x")}</button></span>`).join(""); $$("button", sel).forEach(x => x.onclick = () => { cfg.personnes.splice(+x.dataset.i, 1); peindreSel(); dessiner(); }); };
    peindreSel();
    champ.oninput = S.debounce(() => {
      const q = champ.value.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
      if (q.length < 2) { res.innerHTML = ""; return; }
      const compte = new Map(); for (const r of St.donnees().T) for (const id of lesPers(r.m, "tous")) compte.set(id, (compte.get(id) || 0) + 1);
      const trouves = Object.entries(S.base.pers).filter(([, p]) => (p.n || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").includes(q)).map(([id, p]) => ({ id: +id, nom: p.n, ph: p.ph, n: compte.get(+id) || 0 })).sort((a, b) => b.n - a.n).slice(0, 6);
      res.innerHTML = trouves.map(p => `<div class="ligne" data-id="${p.id}"><div style="width:34px">${S.portrait(p.ph, p.nom)}</div><div class="corps"><b>${esc(p.nom)}</b><span>${S.pluriel(p.n, "titre vu", "titres vus")}</span></div></div>`).join("") || `<div class="mini discret" style="padding:6px">Personne trouvée dans tes films.</div>`;
      $$(".ligne", res).forEach(l => l.onclick = () => { const p = trouves.find(x => x.id === +l.dataset.id); cfg.personnes = (cfg.personnes || []).filter(x => x.id !== p.id).concat([{ id: p.id, nom: p.nom }]).slice(-6); champ.value = ""; res.innerHTML = ""; peindreSel(); dessiner(); });
    }, 120);
  };
  choixPersonnes($("[data-chercher-p]", vue), $("[data-res-p]", vue), $("[data-sel-p]", vue));
  choixPersonnes($("[data-chercher-p2]", vue), $("[data-res-p2]", vue), $("[data-sel-p2]", vue));
  $("[data-titre]", vue).oninput = e => { cfg.titre = e.target.value; $("[data-titre-g]", vue).textContent = cfg.titre || titreAuto(); };
  $("[data-reinit]", vue).onclick = () => { S.filtresMemo.labo = JSON.parse(JSON.stringify(CFG_DEFAUT)); S.filtresMemo.laboId = null; S.aller("#/labo"); S.rafraichir(); };
  $("[data-epingler]", vue).onclick = async () => { const g = JSON.parse(JSON.stringify(cfg)); g.titre = cfg.titre || titreAuto(); if (gid) g.id = gid; await S.agir("graphique", { graphique: g }, { toast: gid ? "Graphique mis à jour" : "Graphique épinglé sur la page Stats", sansRendu: true }); };
  const des = $("[data-desepingler]", vue); if (des) des.onclick = async () => { await S.agir("suppr_graphique", { id: gid }, { toast: "Graphique retiré", sansRendu: true }); S.aller("#/stats"); };
  dessiner();
};

// ------------------------------------------------------------------ « Ton année » et « Ton mois »
S.pages.annee = async (vue, args) => {
  if (!S.base) { vue.innerHTML = S.chargement(); await S.chargerBase(); }
  const an = args[0] || String(new Date().getFullYear());
  const d = St.donnees();
  const V = d.V.filter(v => v.date?.startsWith(an));
  const corr = S.vivants(S.moi.annees);
  const auto = new Set(V.map(v => v.cle));
  for (const [k, v] of Object.entries(corr)) { const [a, cle] = k.split("|"); if (a !== an) continue; if (v.val) auto.add(cle); else auto.delete(cle); }
  const cles = [...auto];
  const T = cles.map(c => d.T.find(t => t.cle === c)).filter(Boolean);
  const notes = T.map(t => t.note).filter(n => n != null);
  const min = T.reduce((s, t) => s + (t.m?.r || 0) * (t.part ?? 1), 0);
  const top = [...T].filter(t => t.note != null).sort((a, b) => b.note - a.note || (b.coeur - a.coeur)).slice(0, 10);
  const reals = St.grouper(T, "real", 5, 2);
  const acteurs = St.grouper(T, "acteur", 5, 2);
  const nouveaux = T.filter(t => t.m?.a === +an).length;
  const annees = [...new Set(d.V.map(v => v.date?.slice(0, 4)).filter(Boolean))].sort().reverse();
  vue.innerHTML = `<div class="entete"><h1>Ton ${esc(an)}</h1><span class="espace"></span><select class="champ" data-an style="width:auto;height:34px">${annees.map(a => `<option ${a === an ? "selected" : ""}>${a}</option>`).join("")}</select></div>
    <div class="chiffres"><div class="chiffre"><b>${T.length}</b><span>titres vus</span></div><div class="chiffre"><b>${S.fmtNombre(Math.round(min / 60))} h</b><span>devant l'écran</span></div><div class="chiffre"><b>${S.fmtNote((notes.reduce((a, b) => a + b, 0) / (notes.length || 1)) || null)}</b><span>note moyenne</span></div><div class="chiffre"><b>${V.filter(v => v.ou?.type === "cinema").length}</b><span>séances au cinéma</span></div><div class="chiffre"><b>${nouveaux}</b><span>sorties de ${esc(an)}</span></div><div class="chiffre"><b>${V.filter(v => v.revision).length}</b><span>revisionnages</span></div></div>
    <div class="section"><div class="section-titre"><h2>Ton top ${Math.min(10, top.length)}</h2></div><div class="grille">${top.map((t, i) => S.vignette(t.cle, { sous: `n° ${i + 1}` })).join("") || S.vide("Pas encore de notes cette année")}</div></div>
    <div class="stats-grille section">
      <section class="graph-carte"><h3>Mois par mois</h3><div data-mois></div></section>
      <section class="graph-carte"><h3>Les personnes de ton année</h3><div class="mini muet" style="margin:6px 0">Réalisateurs</div><div data-reals></div><div class="mini muet" style="margin:12px 0 6px">Acteurs</div><div data-acteurs></div></section>
    </div>
    <div class="section"><div class="section-titre"><h2>Vu en ${esc(an)}</h2><span class="mini discret">${cles.length} titres · liste automatique, corrigeable</span><button class="lien" data-ajouter style="margin-left:auto;color:var(--accent);font-size:13px">${ico("plus")} Ajouter</button></div>
    <div class="grille" data-liste>${cles.sort((a, b) => (d.V.find(v => v.cle === a)?.date || "").localeCompare(d.V.find(v => v.cle === b)?.date || "")).map(c => `<div style="position:relative">${S.vignette(c)}<button class="icone-bouton" data-retirer="${c}" title="Retirer de cette liste" style="position:absolute;top:4px;right:4px;width:28px;height:28px;background:rgba(13,13,18,.8)">${ico("x")}</button></div>`).join("")}</div></div>`;
  $("[data-an]", vue).onchange = e => S.aller("#/annee/" + e.target.value);
  const g = St.grouper(V, "mois");
  G.barres($("[data-mois]", vue), { categories: d3.range(1, 13), series: [{ nom: "Visionnages", couleur: S.COULEURS[0], valeurs: d3.range(1, 13).map(m => (g.find(([v]) => v === m)?.[1] || []).length) }], libelle: m => S.MOIS_C[m - 1], libelleLong: m => S.MOIS[m - 1] + " " + an, hauteur: 200, clic: m => S.aller(`#/mois/${an}-${String(m).padStart(2, "0")}`) });
  G.barresH($("[data-reals]", vue), reals.map(([id, l]) => ({ lib: nomPers(id), v: l.length, lien: `#/personne/${id}` })));
  G.barresH($("[data-acteurs]", vue), acteurs.map(([id, l]) => ({ lib: nomPers(id), v: l.length, lien: `#/personne/${id}` })), { couleur: "var(--c3)" });
  $$("[data-retirer]", vue).forEach(b => b.onclick = ev => { ev.preventDefault(); S.agir("annee", { annee: an, cle: b.dataset.retirer, val: false }, { toast: `Retiré de « Vu en ${an} »` }); });
  $("[data-ajouter]", vue).onclick = () => S.choisirTitre(cle => S.agir("annee", { annee: an, cle, val: true }, { toast: `Ajouté à « Vu en ${an} »` }));
};
S.pages.mois = async (vue, args) => {
  if (!S.base) { vue.innerHTML = S.chargement(); await S.chargerBase(); }
  const code = args[0] || S.aujourdhui().slice(0, 7);
  const V = St.donnees().V.filter(v => v.date?.startsWith(code)).reverse();
  const notes = V.map(v => v.note).filter(n => n != null);
  vue.innerHTML = `<div class="entete"><h1>${esc(S.fmtDate(code))}</h1></div>
    <div class="chiffres"><div class="chiffre"><b>${V.length}</b><span>visionnages</span></div><div class="chiffre"><b>${S.fmtNote(moyenne(notes))}</b><span>note moyenne</span></div><div class="chiffre"><b>${S.fmtNombre(Math.round(V.reduce((s, v) => s + (v.m?.ty === "m" ? v.m.r || 0 : 0), 0) / 60))} h</b><span>de films</span></div><div class="chiffre"><b>${V.filter(v => v.ou?.type === "cinema").length}</b><span>au cinéma</span></div></div>
    <div class="section"><div class="grille">${V.map(v => S.vignette(v.cle, { note: v.note, sous: S.fmtDate(v.date, true) })).join("") || S.vide("Rien ce mois-ci")}</div></div>`;
};
})();

// ------------------------------------------------------------------ Wrapped (ton année, ton mois), une carte par écran
(function () {
const S = window.Silencio, St = S.stats;
const { $, $$, esc, ico } = S;
const moyenne = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
const nomP = id => S.base?.pers?.[id]?.n || "";
const photoP = id => S.base?.pers?.[id]?.ph;
function periode(code, pid) {
  const d = St.donnees(pid);
  const V = d.V.filter(v => v.date?.startsWith(code) && !v.approx);
  const cles = [...new Set(V.map(v => v.cle))];
  const T = cles.map(c => d.T.find(t => t.cle === c)).filter(Boolean);
  const min = T.reduce((s, t) => s + (t.m?.r || 0) * (t.part ?? 1), 0);
  return { V, T, min, moy: moyenne(V.map(v => v.note).filter(n => n != null)) };
}
S.pages.wrapped = async (vue, args) => {
  if (!S.base) { vue.innerHTML = S.chargement(); await S.chargerBase(); }
  const code = args[0] || S.aujourdhui().slice(0, 4);
  const annee = code.length === 4;
  const nomPeriode = annee ? code : S.fmtDate(code);
  const P = periode(code, undefined);
  const prec = annee ? String(+code - 1) : (() => { const [a, m] = code.split("-").map(Number); return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, "0")}`; })();
  const Pp = periode(prec, undefined);
  const top = [...P.T].filter(t => t.note != null).sort((a, b) => b.note - a.note || (b.coeur - a.coeur)).slice(0, annee ? 10 : 5);
  const plusVu = role => { const g = St.grouper(P.T, role, 1, 1); return g.length ? { id: g[0][0], n: g[0][1].length } : null; };
  const real = plusVu("real");
  const actG = St.grouper(P.T, "acteur", 0, 1).map(([id, l]) => ({ id, n: l.length, g: S.base.pers[id]?.g }));
  const acteur = actG.find(x => x.g !== 1), actrice = actG.find(x => x.g === 1);
  // plus belle découverte : un réalisateur vu pour la première fois sur la période, avec la meilleure note
  const avant = new Set(St.donnees().T.filter(t => t.premiere && t.premiere < code).flatMap(t => t.m?.eq?.real || t.m?.re || []));
  const decouverte = P.T.filter(t => t.note != null).sort((a, b) => b.note - a.note).flatMap(t => (t.m?.eq?.real || t.m?.re || []).filter(id => !avant.has(id)).map(id => ({ id, t })))[0];
  const parJour = d3.rollups(P.V, l => l.length, v => v.date?.slice(0, 10)).filter(([j]) => j?.length === 10).sort((a, b) => b[1] - a[1])[0];
  const parMois = annee ? d3.rollups(P.V, l => l.length, v => v.date?.slice(0, 7)).filter(([m]) => m?.length === 7).sort((a, b) => b[1] - a[1])[0] : null;
  const longs = P.T.filter(t => t.m?.ty === "m" && t.m.r).sort((a, b) => b.m.r - a.m.r);
  const vieux = P.T.filter(t => t.m?.a).sort((a, b) => a.m.a - b.m.a)[0];
  const amis = Object.keys(S.amis).map(id => ({ id, nom: S.nomDe(id), n: periode(code, id).V.length })).sort((a, b) => b.n - a.n);
  const delta = (a, b, f = x => Math.round(x)) => b ? `<span class="delta ${a >= b ? "plus" : "moins"}">${a >= b ? "+" : "−"}${f(Math.abs(a - b))}</span>` : "";
  const fond = top[0]?.m?.af || P.T[0]?.m?.af;
  const cartes = P.V.length ? [
    `<div class="w-carte w-intro"><span class="w-sur">Ton ${annee ? "année" : "mois"}</span><h1 class="w-enorme">${esc(nomPeriode)}</h1><div class="w-gros">${P.T.length}<small>titres</small></div><div class="w-gros">${S.fmtNombre(Math.round(P.min / 60))}<small>heures</small></div></div>`,
    `<div class="w-carte"><span class="w-sur">Ton top ${top.length}</span><div class="w-top">${top.map((t, i) => `<a href="#/titre/${t.cle}" class="w-top-l" style="--i:${i}"><span class="w-rang">${i + 1}</span>${S.affiche(t.m, { taille: "w185" })}<span class="w-top-t"><b>${esc(S.nomTitre(t.m))}</b><em>${S.fmtNote(t.note)}</em></span></a>`).join("") || `<p>Pas encore de notes.</p>`}</div></div>`,
    `<div class="w-carte"><span class="w-sur">Tes personnes</span><div class="w-pers">${[[real, "Réalisateur·rice"], [acteur, "Acteur"], [actrice, "Actrice"]].filter(([x]) => x).map(([x, lib], i) => `<a href="#/personne/${x.id}" class="w-pers-l" style="--i:${i}">${S.portrait(photoP(x.id), nomP(x.id))}<span><em>${lib}</em><b>${esc(nomP(x.id))}</b><small>${S.pluriel(x.n, "titre")}</small></span></a>`).join("")}${decouverte ? `<a href="#/personne/${decouverte.id}" class="w-pers-l w-decouverte" style="--i:3">${S.portrait(photoP(decouverte.id), nomP(decouverte.id))}<span><em>Ta découverte</em><b>${esc(nomP(decouverte.id))}</b><small>${esc(S.nomTitre(decouverte.t.m))}</small></span></a>` : ""}</div></div>`,
    `<div class="w-carte"><span class="w-sur">Records</span><div class="w-records">
      <div style="--i:0"><b>${S.fmtNombre(Math.round(P.min / 60))} h</b><span>devant l'écran</span></div>
      ${parJour && parJour[1] > 1 ? `<div style="--i:1"><b>${parJour[1]} titres</b><span>le ${S.fmtDate(parJour[0])}</span></div>` : ""}
      ${parMois ? `<div style="--i:2"><b>${esc(S.MOIS[+parMois[0].slice(5) - 1])}</b><span>ton mois le plus chargé (${parMois[1]})</span></div>` : ""}
      ${longs[0] ? `<div style="--i:3"><b>${S.duree(longs[0].m.r)}</b><span>${esc(S.nomTitre(longs[0].m))}, le plus long</span></div>` : ""}
      ${vieux ? `<div style="--i:4"><b>${vieux.m.a}</b><span>${esc(S.nomTitre(vieux.m))}, le plus ancien</span></div>` : ""}
    </div></div>`,
    `<div class="w-carte"><span class="w-sur">Et par rapport à ${annee ? prec : "le mois dernier"}</span><div class="w-records">
      <div style="--i:0"><b>${P.T.length} ${delta(P.T.length, Pp.T.length)}</b><span>titres</span></div>
      <div style="--i:1"><b>${S.fmtNombre(Math.round(P.min / 60))} h ${delta(P.min / 60, Pp.min / 60)}</b><span>de visionnage</span></div>
      <div style="--i:2"><b>${S.fmtNote(P.moy)} ${P.moy != null && Pp.moy != null ? delta(P.moy, Pp.moy, x => S.fmtNote(x)) : ""}</b><span>de moyenne</span></div>
    </div>${amis.length ? `<div class="w-amis">${[{ id: "", nom: "Toi", n: P.V.length }, ...amis].sort((a, b) => b.n - a.n).map((a, i) => `<div style="--i:${i + 3}"><span>${i + 1}</span>${S.avatar(a.id || S.etat.appareil.profil, a.nom, 30)}<b>${esc(a.nom)}</b><em>${a.n}</em></div>`).join("")}</div>` : ""}</div>`,
    `<div class="w-carte w-fin"><span class="w-sur">${esc(nomPeriode)}</span><div class="w-gros">${S.fmtNote(P.moy)}<small>ta note moyenne</small></div><a class="bouton principal grand" href="#/${annee ? "annee/" + code : "mois/" + code}">Tous les titres</a><a class="bouton grand" href="#/stats?o=temps">Fermer</a></div>`,
  ] : [`<div class="w-carte w-fin"><span class="w-sur">${esc(nomPeriode)}</span><h1 class="w-enorme">Rien vu</h1><a class="bouton grand" href="#/stats?o=temps">Fermer</a></div>`];
  document.body.classList.add("plein-ecran");
  vue.className = "plein";
  vue.innerHTML = `<div class="wrapped">${fond ? `<img class="w-fond" src="${S.img(fond, "w342")}" alt="">` : ""}<div class="w-barres">${cartes.map(() => `<i><b></b></i>`).join("")}</div><a class="w-fermer icone-bouton" href="#/stats?o=temps" aria-label="Fermer">${ico("x")}</a><div class="w-scene"></div><button class="w-prec" aria-label="Précédent"></button><button class="w-suiv" aria-label="Suivant"></button></div>`;
  let i = 0;
  const montrer = k => {
    i = Math.max(0, Math.min(cartes.length - 1, k));
    $(".w-scene", vue).innerHTML = cartes[i];
    $$(".w-barres i", vue).forEach((b, n) => b.classList.toggle("fait", n < i) || b.classList.toggle("actif", n === i));
    $$(".w-barres i", vue).forEach((b, n) => b.classList.toggle("actif", n === i));
    S.son(i === cartes.length - 1 ? "fin" : "carte", i);
  };
  $(".w-suiv", vue).onclick = () => montrer(i + 1);
  $(".w-prec", vue).onclick = () => montrer(i - 1);
  vue.onkeydown = null;
  montrer(0);
};
const sortir = () => { if (!location.hash.startsWith("#/wrapped")) document.body.classList.remove("plein-ecran"); };
window.addEventListener("hashchange", sortir);
})();
