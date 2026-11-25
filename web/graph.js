/* Silencio — graphiques (d3) : courbes et nuages de points, barres, radar, carte du monde.
   Règles : marques fines (traits 2 px, points ≥ 8 px), extrémités de barres arrondies, une seule échelle verticale,
   légende dès 2 séries, infobulle au survol sur chaque marque (ou ligne de repère sur les courbes). */
(function () {
"use strict";
const S = window.Silencio, G = S.graph = {};
const esc = S.esc;
const MARGE = { h: 14, d: 14, b: 34, g: 42 };

function cadre(conteneur, hauteur, marge = MARGE) {
  conteneur.innerHTML = "";
  conteneur.classList.add("graph");
  const largeur = Math.max(280, conteneur.clientWidth || conteneur.parentElement?.clientWidth || 600);
  const svg = d3.select(conteneur).append("svg").attr("viewBox", `0 0 ${largeur} ${hauteur}`).attr("height", hauteur);
  return { svg, l: largeur, h: hauteur, m: marge, iw: largeur - marge.g - marge.d, ih: hauteur - marge.h - marge.b };
}
G.legende = (series, opts = {}) => series.length < 2 && !opts.toujours ? "" :
  `<div class="legende-g">${series.map(s => `<span class="${s.pointille ? "pointille" : ""}"><i style="${s.pointille ? `border-color:${s.couleur}` : `background:${s.couleur}`}"></i>${esc(s.nom)}</span>`).join("")}</div>`;
const fmt = v => typeof v === "number" ? (Math.abs(v) >= 1e6 ? S.argent(v) : S.fmtNote(v)) : esc(v);
function barreArrondie(x, y, w, h, r) {   // rectangle arrondi seulement côté valeur (en haut)
  r = Math.min(r, w / 2, Math.abs(h));
  if (h <= 0) return "";
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

// ------------------------------------------------------------------ courbes / nuages de points
/* o = { series: [{nom, couleur, points: [{x, y, lib, cle, info}], relier, pointille, aire}], x: {type: "num"|"temps"|"cat",
   titre, domaine, format}, y: {titre, domaine, format}, hauteur, reperes: true (ligne de repère verticale) } */
G.points = (conteneur, o) => {
  const series = o.series.filter(s => s.points.length);
  if (!series.length) { conteneur.innerHTML = `<div class="vide petit">Pas assez de données</div>`; return; }
  const c = cadre(conteneur, o.hauteur || 300);
  const tous = series.flatMap(s => s.points);
  let x;
  if (o.x?.type === "cat") {
    const cats = o.x.domaine || [...new Set(tous.map(p => p.x))];
    x = d3.scalePoint().domain(cats).range([0, c.iw]).padding(.4);
  } else if (o.x?.type === "temps") {
    x = d3.scaleTime().domain(o.x.domaine || d3.extent(tous, p => p.x)).range([0, c.iw]).nice();
  } else {
    const ext = o.x?.domaine || d3.extent(tous, p => p.x);
    if (ext[0] === ext[1]) { ext[0] -= 1; ext[1] += 1; }
    x = d3.scaleLinear().domain(ext).range([0, c.iw]).nice();
  }
  const ey = o.y?.domaine || d3.extent(tous, p => p.y);
  if (ey[0] === ey[1]) { ey[0] -= 1; ey[1] += 1; }
  const y = d3.scaleLinear().domain(ey).range([c.ih, 0]).nice();
  const g = c.svg.append("g").attr("transform", `translate(${c.m.g},${c.m.h})`);
  const nbTx = Math.max(2, Math.floor(c.iw / 80));
  const ax = o.x?.type === "cat" ? d3.axisBottom(x).tickValues(x.domain().filter((_, i, a) => a.length <= nbTx * 1.5 || i % Math.ceil(a.length / (nbTx * 1.5)) === 0)) :
    d3.axisBottom(x).ticks(nbTx).tickFormat(o.x?.format || (o.x?.type === "temps" ? null : d3.format("~r")));
  g.append("g").attr("class", "axe").attr("transform", `translate(0,${c.ih})`).call(ax.tickSizeOuter(0));
  g.append("g").attr("class", "axe").call(d3.axisLeft(y).ticks(5).tickSize(-c.iw).tickFormat(o.y?.format || (v => S.fmtNote(v)))).call(s => s.select(".domain").remove());
  if (o.x?.titre) g.append("text").attr("class", "titre-axe").attr("x", c.iw).attr("y", c.ih + 30).attr("text-anchor", "end").text(o.x.titre);
  if (o.y?.titre) g.append("text").attr("class", "titre-axe").attr("x", -c.m.g + 2).attr("y", -4).text(o.y.titre);
  const px = p => x(p.x) ?? 0;
  for (const s of series) {
    const pts = o.x?.type === "cat" ? s.points : [...s.points].sort((a, b) => a.x - b.x);
    if (s.aire) g.append("path").datum(pts).attr("fill", s.couleur).attr("opacity", .12).attr("d", d3.area().x(px).y0(c.ih).y1(p => y(p.y)).curve(d3.curveMonotoneX));
    if (s.relier) g.append("path").datum(pts).attr("fill", "none").attr("stroke", s.couleur).attr("stroke-width", 2)
      .attr("stroke-dasharray", s.pointille ? "5 4" : null).attr("opacity", s.pointille ? .75 : 1)
      .attr("d", d3.line().x(px).y(p => y(p.y)).curve(s.lisse === false ? d3.curveLinear : d3.curveMonotoneX));
  }
  const toutes = series.flatMap(s => (s.pointsVisibles === false ? [] : s.points).map(p => ({ ...p, s })));
  const pts = g.append("g").selectAll("circle").data(toutes).join("circle")
    .attr("cx", px).attr("cy", p => y(p.y)).attr("r", p => p.r || (toutes.length > 400 ? 3 : 4.2))
    .attr("fill", p => p.s.pointille ? "var(--carte)" : p.s.couleur).attr("stroke", p => p.s.pointille ? p.s.couleur : "var(--carte)")
    .attr("stroke-width", p => p.s.pointille ? 1.6 : 1.5).attr("opacity", toutes.length > 400 ? .75 : 1)
    .style("cursor", p => p.cle ? "pointer" : "default");
  const texte = p => `<b>${esc(p.lib ?? "")}</b>${p.info || `<div class="l"><i style="background:${p.s.couleur}"></i>${esc(p.s.nom || "")} · ${fmt(p.y)}</div>`}`;
  if (o.reperes && o.x?.type !== "num") {
    // ligne de repère : toutes les séries au même x
    const regle = g.append("line").attr("y1", 0).attr("y2", c.ih).attr("stroke", "var(--ligne-2)").style("display", "none");
    const xs = o.x?.type === "cat" ? x.domain() : [...new Set(toutes.map(p => +p.x))].sort((a, b) => a - b);
    g.append("rect").attr("width", c.iw).attr("height", c.ih).attr("fill", "transparent")
      .on("pointermove", ev => {
        const [mx] = d3.pointer(ev);
        const proche = o.x?.type === "cat" ? xs.reduce((a, b) => Math.abs(x(b) - mx) < Math.abs(x(a) - mx) ? b : a) : xs.reduce((a, b) => Math.abs(x(b) - mx) < Math.abs(x(a) - mx) ? b : a);
        const ici = toutes.filter(p => (o.x?.type === "cat" ? p.x === proche : +p.x === +proche));
        regle.style("display", null).attr("x1", x(proche)).attr("x2", x(proche));
        const lib = o.x?.type === "temps" ? S.fmtDate(new Date(+proche).toISOString().slice(0, 7)) : proche;
        S.infobulle(`<b>${esc(o.x?.libelle ? o.x.libelle(proche) : lib)}</b>${ici.sort((a, b) => b.y - a.y).map(p => `<div class="l"><i style="background:${p.s.couleur}"></i>${esc(p.s.nom || "")}<span class="espace"></span>${fmt(p.y)}${p.n != null ? ` <small class="discret">(${p.n})</small>` : ""}</div>`).join("")}`, ev);
      })
      .on("pointerleave", () => { regle.style("display", "none"); S.infobulle(null); });
  } else {
    pts.on("pointerenter pointermove", (ev, p) => { d3.select(ev.currentTarget).attr("r", 6.5); S.infobulle(texte(p), ev); })
      .on("pointerleave", (ev, p) => { d3.select(ev.currentTarget).attr("r", p.r || 4.2); S.infobulle(null); })
      .on("click", (ev, p) => { if (p.cle) { S.infobulle(null); S.aller("#/titre/" + p.cle); } });
  }
  if (o.etiquettes) {  // étiquettes directes sélectives (fin de chaque courbe)
    for (const s of series) {
      const d = [...s.points].sort((a, b) => (o.x?.type === "cat" ? 0 : a.x - b.x)).pop();
      if (d && !s.pointille) g.append("text").attr("x", Math.min(px(d) + 8, c.iw - 4)).attr("y", y(d.y) - 8).attr("text-anchor", px(d) + 60 > c.iw ? "end" : "start").style("fill", "var(--texte)").style("font-size", "11.5px").text(s.nom);
    }
  }
};

// ------------------------------------------------------------------ barres verticales (une ou plusieurs séries côte à côte)
/* o = { categories: [...], series: [{nom, couleur, valeurs: [...], n: [...]}], y: {titre, format}, hauteur, libelle(cat), clic(cat) } */
G.barres = (conteneur, o) => {
  const cats = o.categories;
  if (!cats.length) { conteneur.innerHTML = `<div class="vide petit">Pas assez de données</div>`; return; }
  const c = cadre(conteneur, o.hauteur || 240);
  const x0 = d3.scaleBand().domain(cats).range([0, c.iw]).paddingInner(o.series.length > 1 ? .22 : .18).paddingOuter(.05);
  const x1 = d3.scaleBand().domain(o.series.map((_, i) => i)).range([0, x0.bandwidth()]).padding(o.series.length > 1 ? .08 : 0);
  const max = d3.max(o.series.flatMap(s => s.valeurs)) || 1;
  const y = d3.scaleLinear().domain([o.y?.min ?? 0, o.y?.max ?? max]).range([c.ih, 0]).nice();
  const g = c.svg.append("g").attr("transform", `translate(${c.m.g},${c.m.h})`);
  const nb = Math.max(2, Math.floor(c.iw / 46));
  g.append("g").attr("class", "axe").attr("transform", `translate(0,${c.ih})`).call(d3.axisBottom(x0).tickSizeOuter(0)
    .tickValues(cats.filter((_, i) => cats.length <= nb || i % Math.ceil(cats.length / nb) === 0)).tickFormat(o.libelle || (v => v)));
  g.append("g").attr("class", "axe").call(d3.axisLeft(y).ticks(5).tickSize(-c.iw).tickFormat(o.y?.format || d3.format("~s"))).call(s => s.select(".domain").remove());
  if (o.y?.titre) g.append("text").attr("class", "titre-axe").attr("x", -c.m.g + 2).attr("y", -4).text(o.y.titre);
  o.series.forEach((s, si) => {
    const w = Math.max(1, x1.bandwidth() - (o.series.length > 1 ? 0 : 2));
    g.append("g").selectAll("path").data(cats.map((cat, i) => ({ cat, v: s.valeurs[i], n: s.n?.[i] }))).join("path")
      .attr("d", d => d.v == null ? "" : barreArrondie(x0(d.cat) + x1(si) + (o.series.length > 1 ? 0 : 1), y(Math.max(d.v, y.domain()[0])), w, y(y.domain()[0]) - y(Math.max(d.v, y.domain()[0])), 4))
      .attr("fill", s.couleur).style("cursor", o.clic ? "pointer" : "default")
      .on("pointerenter pointermove", (ev, d) => { d3.select(ev.currentTarget).attr("opacity", .8); S.infobulle(`<b>${esc(o.libelleLong ? o.libelleLong(d.cat) : (o.libelle ? o.libelle(d.cat) : d.cat))}</b>${o.series.map((ss, k) => `<div class="l"><i style="background:${ss.couleur}"></i>${esc(ss.nom || "")}<span class="espace"></span>${ss.valeurs[cats.indexOf(d.cat)] == null ? "–" : (o.y?.formatBulle || fmt)(ss.valeurs[cats.indexOf(d.cat)])}${ss.n?.[cats.indexOf(d.cat)] != null ? ` <small class="discret">(${ss.n[cats.indexOf(d.cat)]})</small>` : ""}</div>`).join("")}`, ev); })
      .on("pointerleave", ev => { d3.select(ev.currentTarget).attr("opacity", 1); S.infobulle(null); })
      .on("click", (ev, d) => o.clic && o.clic(d.cat));
  });
};

// ------------------------------------------------------------------ barres horizontales en HTML (classements lisibles sur téléphone)
G.barresH = (conteneur, lignes, o = {}) => {
  const max = Math.max(...lignes.map(l => l.v), 1e-9);
  conteneur.innerHTML = `<div class="barres-h">${lignes.map((l, i) => `<div class="barre-h" data-i="${i}" ${l.lien ? 'style="cursor:pointer"' : ""}><span class="lib" title="${esc(l.lib)}">${esc(l.lib)}</span><span class="piste"><i style="width:${Math.max(1.5, 100 * l.v / max)}%;background:${l.couleur || o.couleur || "var(--c1)"}"></i></span><span class="val">${l.txt ?? fmt(l.v)}${l.sous ? ` <small>${esc(l.sous)}</small>` : ""}</span></div>`).join("") || `<div class="vide petit">Pas assez de données</div>`}</div>`;
  S.$$(".barre-h", conteneur).forEach(b => { const l = lignes[+b.dataset.i]; if (l.lien) b.onclick = () => S.aller(l.lien); if (l.bulle) { b.onpointermove = ev => S.infobulle(l.bulle, ev); b.onpointerleave = () => S.infobulle(null); } });
};

// ------------------------------------------------------------------ radar
/* o = { axes: [libellés], series: [{nom, couleur, valeurs: [0..max], bruts: [texte]}], max } */
G.radar = (conteneur, o) => {
  const n = o.axes.length;
  if (n < 3) { conteneur.innerHTML = `<div class="vide petit">Il faut au moins 3 axes</div>`; return; }
  const h = o.hauteur || 340;
  const c = cadre(conteneur, h, { h: 0, d: 0, b: 0, g: 0 });
  const cx = c.l / 2, cy = h / 2, R = Math.min(c.l / 2 - 80, h / 2 - 34);
  const max = o.max || d3.max(o.series.flatMap(s => s.valeurs)) || 1;
  const min = o.min || 0;
  const ang = i => -Math.PI / 2 + i * 2 * Math.PI / n;
  const pt = (i, v) => [cx + Math.cos(ang(i)) * R * (Math.max(0, v - min) / (max - min)), cy + Math.sin(ang(i)) * R * (Math.max(0, v - min) / (max - min))];
  const g = c.svg.append("g");
  for (let k = 1; k <= 4; k++) g.append("polygon").attr("points", d3.range(n).map(i => pt(i, min + (max - min) * k / 4).join(",")).join(" ")).attr("fill", "none").attr("stroke", "rgba(255,255,255,.07)");
  d3.range(n).forEach(i => {
    const [x2, y2] = pt(i, max);
    g.append("line").attr("x1", cx).attr("y1", cy).attr("x2", x2).attr("y2", y2).attr("stroke", "rgba(255,255,255,.07)");
    const [lx, ly] = [cx + Math.cos(ang(i)) * (R + 14), cy + Math.sin(ang(i)) * (R + 14)];
    g.append("text").attr("x", lx).attr("y", ly + 4).attr("text-anchor", Math.abs(Math.cos(ang(i))) < .2 ? "middle" : Math.cos(ang(i)) > 0 ? "start" : "end").text(o.axes[i]);
  });
  o.series.forEach(s => {
    g.append("polygon").attr("points", s.valeurs.map((v, i) => pt(i, v ?? min).join(",")).join(" ")).attr("fill", s.couleur).attr("fill-opacity", .14).attr("stroke", s.couleur).attr("stroke-width", 2);
    g.append("g").selectAll("circle").data(s.valeurs.map((v, i) => ({ v, i }))).join("circle").attr("cx", d => pt(d.i, d.v ?? min)[0]).attr("cy", d => pt(d.i, d.v ?? min)[1]).attr("r", 4).attr("fill", s.couleur).attr("stroke", "var(--carte)").attr("stroke-width", 1.5)
      .on("pointerenter pointermove", (ev, d) => S.infobulle(`<b>${esc(o.axes[d.i])}</b>${o.series.map(ss => `<div class="l"><i style="background:${ss.couleur}"></i>${esc(ss.nom)}<span class="espace"></span>${ss.bruts?.[d.i] ?? fmt(ss.valeurs[d.i])}</div>`).join("")}`, ev))
      .on("pointerleave", () => S.infobulle(null));
  });
};

// ------------------------------------------------------------------ carte du monde (choroplèthe, une teinte)
let monde = null, numeros = null;
function topoVersGeo(topo, nom) {
  const tr = topo.transform;
  const arcs = topo.arcs.map(arc => { let x = 0, y = 0; return arc.map(p => tr ? (x += p[0], y += p[1], [x * tr.scale[0] + tr.translate[0], y * tr.scale[1] + tr.translate[1]]) : p); });
  const arcPts = i => i >= 0 ? arcs[i] : arcs[~i].slice().reverse();
  const anneau = idx => { let pts = []; idx.forEach((i, k) => { const a = arcPts(i); pts = pts.concat(k ? a.slice(1) : a); }); return pts; };
  return topo.objects[nom].geometries.map(gm => ({
    type: "Feature", id: gm.id, properties: gm.properties || {},
    geometry: gm.type === "Polygon" ? { type: "Polygon", coordinates: gm.arcs.map(anneau) } : gm.type === "MultiPolygon" ? { type: "MultiPolygon", coordinates: gm.arcs.map(p => p.map(anneau)) } : null,
  })).filter(f => f.geometry);
}
G.carte = async (conteneur, o) => {
  conteneur.innerHTML = S.chargement();
  try {
    if (!monde) { const [t, n] = await Promise.all([S.api("/api/monde"), fetch("pays.json").then(r => r.json())]); monde = topoVersGeo(t, "countries"); numeros = n; }
  } catch (e) { conteneur.innerHTML = `<div class="vide petit">La carte a besoin d'Internet la première fois (fond de carte à télécharger).</div>`; return; }
  const parNum = {};
  for (const [iso, v] of Object.entries(o.valeurs)) if (numeros[iso]) parNum[numeros[iso]] = { iso, v };
  const h = o.hauteur || Math.min(420, Math.max(220, (conteneur.clientWidth || 600) * .52));
  const c = cadre(conteneur, h, { h: 0, d: 0, b: 0, g: 0 });
  const proj = d3.geoNaturalEarth1().fitSize([c.l, h], { type: "FeatureCollection", features: monde.filter(f => f.id !== "010") });
  const chemin = d3.geoPath(proj);
  const max = d3.max(Object.values(o.valeurs)) || 1, min = o.min ?? 0;
  const echelle = d3.scaleSequentialSqrt().domain([min, max]).interpolator(d3.interpolateRgb("#173a63", "#a9d0fb"));
  c.svg.append("g").selectAll("path").data(monde.filter(f => f.id !== "010")).join("path").attr("d", chemin)
    .attr("fill", f => parNum[f.id] ? echelle(parNum[f.id].v) : "#1d1d27").attr("stroke", "var(--carte)").attr("stroke-width", .6)
    .style("cursor", f => parNum[f.id] && o.clic ? "pointer" : "default")
    .on("pointerenter pointermove", (ev, f) => { const d = parNum[f.id]; S.infobulle(`<b>${esc(d ? S.pays(d.iso) : (f.properties.name || ""))}</b>${d ? `<div class="l">${(o.format || fmt)(d.v)}</div>` : `<div class="l discret">aucun film</div>`}`, ev); })
    .on("pointerleave", () => S.infobulle(null))
    .on("click", (ev, f) => { const d = parNum[f.id]; if (d && o.clic) o.clic(d.iso); });
  const leg = d3.select(conteneur).append("div").attr("class", "legende-g");
  leg.html(`<span>${(o.format || fmt)(min)}</span><span style="flex:0 0 140px;height:8px;border-radius:4px;background:linear-gradient(90deg,${echelle(min)},${echelle(max)})"></span><span>${(o.format || fmt)(max)}</span><span class="discret">${esc(o.titre || "")}</span>`);
};
})();
