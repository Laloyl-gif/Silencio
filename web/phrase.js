/* Silencio : recherche par phrase dans ton journal.
   « vus au cinéma en 2025 notés 8+ », « coups de cœur en VO », « horreur des années 80 », « revus avec Lily »,
   « films de Lynch notés moins de 6 », « séries cette année », « watchlist comédie »… */
(() => {
const S = window.Silencio;
const norm = s => String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/['’]/g, " ");

S.recherchePhrase = (q) => {
  let t = ` ${norm(q)} `;
  const compris = [], tests = [];
  let parVis = false;                          // un critère sur le visionnage lui-même (lieu, date, version…)
  const tj = f => { parVis = true; tests.push(f); };
  let source = "journal", tri = "date";
  const prendre = (re, fn) => { const m = t.match(re); if (!m) return null; t = t.replace(re, " "); return fn ? fn(m) : m; };
  const auj = S.aujourdhui(), an = +auj.slice(0, 4);

  if (prendre(/\b(watchlist|a voir|pas (encore )?vus?)\b/)) { source = "watchlist"; compris.push("dans ta watchlist"); }
  if (prendre(/\b(au |en )?(cinema|cine|en salle)\b/)) { tj(x => x.j && x.j.ou?.type === "cinema"); compris.push("au cinéma"); }
  if (prendre(/\b(en )?(streaming|sur (une )?plateforme)\b/)) { tj(x => x.j && x.j.ou?.type === "plateforme"); compris.push("en streaming"); }
  const plats = [...new Set(Object.values(S.vivants(S.moi.journal)).map(j => j.ou?.nom).filter(Boolean))];
  for (const p of plats) if (t.includes(` ${norm(p)} `)) { t = t.replace(` ${norm(p)} `, " "); tj(x => x.j && x.j.ou?.nom === p); compris.push(`sur ${p}`); }
  if (prendre(/\b(en )?vo(st)?\b|\bversion originale\b/)) { tj(x => x.j && x.j.version === "VO"); compris.push("en VO"); }
  if (prendre(/\b(en )?vf\b|\bversion francaise\b/)) { tj(x => x.j && x.j.version === "VF"); compris.push("en VF"); }
  if (prendre(/\b(revus?|revues?|rewatch\w*|revisionn\w*)\b/)) { tj(x => x.j && x.j.revision); compris.push("revus"); }
  if (prendre(/\b(coups? de c(oe|œ)ur|favoris?|c(oe|œ)urs?)\b/)) { tests.push(x => x.t.coeur || x.j?.coeur); compris.push("coups de cœur"); }
  if (prendre(/\b(avec |sans )?(une )?critiques?\b/)) { tj(x => x.j && (x.j.critique || "").trim()); compris.push("avec ta critique"); }
  if (prendre(/\bseries?\b/)) { tests.push(x => x.cle[0] === "t"); compris.push("séries"); }
  else if (prendre(/\bfilms?\b/)) tests.push(x => x.cle[0] === "m");
  // notes
  const n = s => parseFloat(String(s).replace(",", "."));
  prendre(/\b(?:notes?|notees?|note)?\s*(?:d au moins|au moins|plus de|>=?|minimum)\s*(\d+(?:[.,]5)?)\b|\b(?:notes?|notees?)?\s*(\d+(?:[.,]5)?)\s*(?:\+|et plus|ou plus|minimum)/, m => {
    const v = n(m[1] || m[2]); tests.push(x => (x.note ?? -1) >= v); compris.push(`notés ${S.fmtNote(v)} et plus`); tri = "note"; });
  prendre(/\b(?:notes?|notees?)?\s*(?:moins de|<=?|au plus)\s*(\d+(?:[.,]5)?)\b/, m => {
    const v = n(m[1]); tests.push(x => x.note != null && x.note <= v); compris.push(`notés ${S.fmtNote(v)} ou moins`); });
  prendre(/\b(?:notes?|notees?)\s+(\d+(?:[.,]5)?)\b/, m => { const v = n(m[1]); tests.push(x => x.note === v); compris.push(`notés ${S.fmtNote(v)}`); });
  // dates de sortie
  prendre(/\b(?:des )?annees\s*(19|20)?(\d)0\b/, m => { const d = +(`${m[1] || (+m[2] < 3 ? "20" : "19")}${m[2]}0`); tests.push(x => x.m.a >= d && x.m.a < d + 10); compris.push(`des années ${String(d).slice(2)}`); });
  prendre(/\b(?:sortis?|sorties?|films? de|de)\s+((?:19|20)\d\d)\b/, m => { const a = +m[1]; tests.push(x => x.m.a === a); compris.push(`sortis en ${a}`); });
  // dates de visionnage
  const periode = (debut, fin, lib) => { tj(x => x.j && x.j.date >= debut && x.j.date <= fin); compris.push(lib); };
  if (prendre(/\bcette semaine\b/)) { const d = new Date(); d.setDate(d.getDate() - 6); periode(d.toISOString().slice(0, 10), auj, "cette semaine"); }
  else if (prendre(/\bce mois(-ci| ci)?\b/)) periode(auj.slice(0, 7), auj, "ce mois-ci");
  else if (prendre(/\bcette annee\b/)) periode(`${an}`, auj, "cette année");
  else if (prendre(/\b(l an dernier|l annee derniere)\b/)) periode(`${an - 1}`, `${an - 1}-12-31`, `en ${an - 1}`);
  else prendre(/\b(?:vus? |vues? )?(?:en )?((?:19|20)\d\d)\b/, m => periode(m[1], `${m[1]}-12-31`, `vus en ${m[1]}`));
  // avec un ami
  for (const [id, a] of Object.entries(S.amis || {})) {
    const nom = norm((a.profil?.nom || id).split(" ")[0]);
    if (nom && t.includes(` avec ${nom} `)) { t = t.replace(` avec ${nom} `, " "); tj(x => x.j && (x.j.avec || []).includes(id)); compris.push(`avec ${a.profil?.nom || id}`); }
  }
  // genres
  for (const [id, g] of Object.entries(S.GENRES)) {
    const ng = norm(g);
    if (ng.length > 3 && (t.includes(` ${ng} `) || t.includes(` ${ng}s `))) { t = t.replace(new RegExp(` ${ng}s? `), " "); tests.push(x => (x.m.g || []).includes(+id)); compris.push(g.toLowerCase()); }
  }
  // une personne : « de Lynch », « par Villeneuve », « avec Naomi Watts »
  const pers = S.base?.pers || {};
  prendre(/\b(?:de|par|avec|realises? par)\s+([a-z][a-z-]+(?:\s+[a-z][a-z-]+)?)\b/, m => {
    const mots = m[1].split(/\s+/).filter(w => w.length > 2 && !["les", "des", "une", "plus", "moins"].includes(w));
    if (!mots.length) return;
    const ids = Object.entries(pers).filter(([, p]) => { const np = ` ${norm(p.n)} `; return mots.every(w => np.includes(` ${w} `) || np.includes(` ${w}`)); }).map(([id]) => +id);
    if (!ids.length) return;
    const set = new Set(ids);
    tests.push(x => [...(x.m.re || []), ...(x.m.ca || []), ...Object.values(x.m.eq || {}).flat()].some(i => set.has(i)));
    compris.push(`avec ${pers[ids[0]].n}${ids.length > 1 ? " (et homonymes)" : ""}`);
  });
  if (!compris.length) return null;
  // les titres
  const lignes = [];
  if (source === "watchlist") {
    for (const c of Object.keys(S.vivants(S.moi.watchlist))) lignes.push({ cle: c, j: null, t: S.monTitre(c), m: S.info(c) || {}, note: null });
  } else {
    for (const j of Object.values(S.vivants(S.moi.journal))) {
      const t2 = S.monTitre(j.cle);
      lignes.push({ cle: j.cle, j, t: t2, m: S.info(j.cle) || {}, note: j.note ?? t2.note });
    }
    if (!parVis) {    // sans critère de visionnage : aussi les films vus sans date
      const deja = new Set(lignes.map(l => l.cle));
      for (const [c, t2] of Object.entries(S.vivants(S.moi.titres))) if (t2.vu && !deja.has(c)) lignes.push({ cle: c, j: null, t: t2, m: S.info(c) || {}, note: t2.note });
    }
  }
  const vus = new Map();
  for (const l of lignes) if (tests.every(f => f(l)) && !vus.has(l.cle)) vus.set(l.cle, l);
  const res = [...vus.values()].sort((a, b) => tri === "note" ? (b.note ?? 0) - (a.note ?? 0) : (b.j?.date || "").localeCompare(a.j?.date || ""));
  return { compris, cles: res.map(r => r.cle), notes: Object.fromEntries(res.map(r => [r.cle, r.note])) };
};
})();
