/* Silencio — fiche film enrichie : séances dans tes cinémas, bande originale, anecdotes, films similaires par
   critère précis, et image à partager. */
(function () {
"use strict";
const S = window.Silencio;
const { $, $$, esc } = S;

S.ficheEnrichie = (vue, cle, d, m, equipe, o) => {
  if (!o.tv) seances($("[data-seances]", vue), cle, o);
  bandeOriginale($("[data-bo]", vue), d, m, equipe);
  anecdotes($("[data-anecdotes]", vue), cle);
  similaires($("[data-similaires]", vue), cle, equipe, o.tv);
  const aff = $(".ff-affiche", vue); if (aff) { aff.title = "Choisir une autre affiche"; aff.style.cursor = "pointer"; aff.onclick = () => choisirAffiche(cle); }
};

// ------------------------------------------------------------------ choisir l'affiche (et le fond) d'un film
S.choisirAffiche = cle => choisirAffiche(cle);
async function choisirAffiche(cle) {
  const m = S.ouvrirModale({ titre: "Choisir l'affiche", large: true, corps: S.chargement() });
  const corps = m.querySelector(".corps-m");
  let r; try { r = await S.api(`/api/images?cle=${encodeURIComponent(cle)}`); } catch { corps.innerHTML = S.vide("Indisponible hors ligne"); return; }
  const t = S.monTitre(cle);
  const peindre = onglet => {
    const l = onglet === "fonds" ? r.fonds : r.affiches;
    const choisi = onglet === "fonds" ? t.fond : t.affiche;
    corps.innerHTML = `<div class="segments" data-o style="margin-bottom:12px"><button data-v="affiches" class="${onglet === "affiches" ? "actif" : ""}">Affiches (${r.affiches.length})</button><button data-v="fonds" class="${onglet === "fonds" ? "actif" : ""}">Fonds (${r.fonds.length})</button></div>
      <div class="choix-images ${onglet}">${l.map(p => `<button data-p="${esc(p)}" class="${p === choisi ? "actif" : ""}"><img loading="lazy" src="${S.img(p, onglet === "fonds" ? "w300" : "w185")}" alt=""></button>`).join("") || `<p class="mini discret">Aucune autre image.</p>`}</div>
      ${choisi ? `<button class="lien" data-origine style="margin-top:12px">Revenir à l'image d'origine</button>` : ""}`;
    $$("[data-o] button", corps).forEach(b => b.onclick = () => peindre(b.dataset.v));
    $$("[data-p]", corps).forEach(b => b.onclick = async () => { await S.agir("titre", { cle, champs: { [onglet === "fonds" ? "fond" : "affiche"]: b.dataset.p } }, { toast: "Image choisie" }); S.fermerModale(); });
    const o = $("[data-origine]", corps); if (o) o.onclick = async () => { await S.agir("titre", { cle, champs: { [onglet === "fonds" ? "fond" : "affiche"]: null } }, { toast: "Image d'origine" }); S.fermerModale(); };
  };
  peindre("affiches");
}

// ------------------------------------------------------------------ prix : résumé, palmarès, statuettes
const COURT = [[/palme d.or/i, "Palme d'or", "Palmes d'or"], [/lion d.or|golden lion/i, "Lion d'or", "Lions d'or"], [/ours d.or|golden bear/i, "Ours d'or", "Ours d'or"]];
S.resumePrix = gagnes => {
  const r = [], parCer = {};
  for (const p of gagnes) {
    const special = COURT.find(([re]) => re.test(p.prix));
    const k = special ? special[1] : p.ceremonie;
    (parCer[k] = parCer[k] || { n: 0, special }).n++;
  }
  const NOMS = { Oscars: ["Oscar", "Oscars"], "César": ["César", "César"], "Golden Globes": ["Golden Globe", "Golden Globes"], BAFTA: ["BAFTA", "BAFTA"],
    Cannes: ["prix à Cannes", "prix à Cannes"], Venise: ["prix à Venise", "prix à Venise"], Berlin: ["prix à Berlin", "prix à Berlin"] };
  for (const [k, { n, special }] of Object.entries(parCer)) {
    const [un, plusieurs] = special ? [special[1], special[2]] : (NOMS[k] || [k, k]);
    r.push(n > 1 ? `${n} ${plusieurs}` : special ? un : `1 ${un}`);
  }
  return r;
};
S.palmaresFilm = r => {
  const groupe = l => { const g = {}; for (const p of l) (g[p.ceremonie] = g[p.ceremonie] || []).push(p); return g; };
  const bloc = (titre, l) => !l.length ? "" : `<h3 class="palm-t">${titre}</h3>${Object.entries(groupe(l)).map(([c, ps]) => `<div class="palm-c"><b>${esc(c)}</b>${ps.map(p => `<div>${esc(p.prix)}${p.annee ? ` <em>${p.annee}</em>` : ""}</div>`).join("")}</div>`).join("")}`;
  const pers = Object.entries(r.personnes || {});
  return bloc("Récompenses", r.gagnes) + bloc("Nominations", r.nominations) + (pers.length ? `<h3 class="palm-t">Pour ce film</h3>${pers.map(([id, e]) => {
    const p = S.base?.pers?.[id]; const nom = p?.n || document.querySelector(`.ff a[href="#/personne/${id}"] b, .ff a[href="#/personne/${id}"]`)?.textContent || "?";
    return `<div class="palm-c"><b><a href="#/personne/${id}">${esc(nom)}</a></b>${e.gagnes.map(x => `<div>${S.ICONE_STATUETTE("gagne")} ${esc(x.prix)}${x.annee ? ` <em>${x.annee}</em>` : ""}</div>`).join("")}${e.nominations.map(x => `<div>${S.ICONE_STATUETTE("nomme")} nommé : ${esc(x.prix)}${x.annee ? ` <em>${x.annee}</em>` : ""}</div>`).join("")}</div>`;
  }).join("")}` : "");
};
S.ICONE_STATUETTE = etat => `<svg class="statuette ${etat}" viewBox="0 0 12 24" aria-hidden="true"><circle cx="6" cy="3" r="2.4"/><path d="M4 6h4l-.6 7h-.8l.4 6H5l.4-6h-.8z"/><rect x="2.5" y="19.5" width="7" height="3" rx=".5"/></svg>`;
// une statuette sur les personnes du casting et de l'équipe primées (dorée) ou nommées (contour) pour ce film
S.statuettes = (vue, personnes) => {
  for (const [id, e] of Object.entries(personnes)) {
    const etat = e.gagnes.length ? "gagne" : e.nominations.length ? "nomme" : ""; if (!etat) continue;
    const texte = [...e.gagnes.map(x => `${x.prix}${x.annee ? " " + x.annee : ""}`), ...e.nominations.map(x => `Nommé : ${x.prix}${x.annee ? " " + x.annee : ""}`)].join("\n");
    for (const a of $$(`.ff-cast a[href="#/personne/${id}"], .ff-equipe a[href="#/personne/${id}"]`, vue)) {
      if (a.querySelector(".statuette-b")) continue;
      const b = document.createElement("span");
      b.className = "statuette-b"; b.title = texte; b.innerHTML = S.ICONE_STATUETTE(etat);
      b.onclick = ev => { ev.preventDefault(); ev.stopPropagation(); S.toast(texte.replace(/\n/g, " · ")); };
      (a.querySelector(".tete-acteur") || a).append(b);
    }
  }
};

// ------------------------------------------------------------------ séances
const JOURS = ["dim.", "lun.", "mar.", "mer.", "jeu.", "ven.", "sam."];
async function seances(z, cle, o) {
  if (!z) return;
  const sortie = o.sortieFR || o.date || "";
  const ecart = sortie ? (Date.now() - new Date(sortie + "T12:00").getTime()) / 864e5 : 9999;
  if (ecart > 400 || ecart < -45) return;                 // ni à l'affiche, ni sur le point de sortir
  let r; try { r = await S.api(`/api/seances?cle=${encodeURIComponent(cle)}`); } catch { return; }
  const avec = r.cinemas.filter(c => (c.jours || []).length);
  if (!avec.length) return;
  z.hidden = false;
  z.innerHTML = `<h2>Séances</h2>${avec.map(c => `<div class="sc-cine"><h3>${esc(c.nom)}</h3>${c.jours.map(j => {
    const dt = new Date(j.date + "T12:00");
    const auj = j.date === S.aujourdhui();
    return `<div class="sc-jour"><span class="sc-date">${auj ? "Aujourd'hui" : `${JOURS[dt.getDay()]} ${dt.getDate()}`}</span><span class="sc-h">${j.seances.map(s => `<b>${esc(s.h)}${s.v || s.imax ? ` <small>${[s.v, s.imax ? "IMAX" : ""].filter(Boolean).join(" ")}</small>` : ""}</b>`).join("")}</span></div>`;
  }).join("")}</div>`).join("")}<p class="mini discret">Programme Allociné, à vérifier auprès du cinéma.</p>`;
}

// ------------------------------------------------------------------ bande originale
function bandeOriginale(z, d, m, equipe) {
  if (!z) return;
  const compo = equipe["Musique"] || [];
  const titre = d.original_title || d.original_name || d.title || d.name || "";
  const an = (d.release_date || d.first_air_date || "").slice(0, 4);
  const q = `${titre} ${an} soundtrack`.trim();
  z.hidden = false;
  z.innerHTML = `<h2>Bande originale</h2>
    ${compo.length ? `<p class="bo-compo">Musique de ${compo.map(p => `<a href="#/personne/${p.id}">${esc(p.nom)}</a>`).join(", ")}</p>` : ""}
    <div class="bo-liens"><a class="bouton" target="_blank" rel="noopener" href="https://music.youtube.com/search?q=${encodeURIComponent(q)}">YouTube Music</a><a class="bouton" target="_blank" rel="noopener" href="https://open.spotify.com/search/${encodeURIComponent(q)}">Spotify</a></div>`;
}

// ------------------------------------------------------------------ anecdotes (IMDb)
async function anecdotes(z, cle) {
  if (!z) return;
  let r; try { r = await S.api(`/api/anecdotes?cle=${encodeURIComponent(cle)}`); } catch { return; }
  if (!r.r.length) return;
  z.hidden = false;
  const peindre = tout => {
    z.innerHTML = `<h2>Anecdotes</h2><ul class="anec">${r.r.slice(0, tout ? 15 : 4).map(a => `<li>${esc(a.texte)}</li>`).join("")}</ul>
      <p class="mini discret">D'après IMDb (en anglais, sans divulgâchage).${r.r.length > 4 && !tout ? ` <button class="lien" data-plus>Voir les ${r.r.length}</button>` : ""}</p>`;
    const b = $("[data-plus]", z); if (b) b.onclick = () => peindre(true);
  };
  peindre(false);
}

// ------------------------------------------------------------------ films similaires, critère par critère
function similaires(z, cle, equipe, tv) {
  if (!z) return;
  const CRIT = [["real", tv ? "Création" : "Réalisation", true], ["image", "Photographie", equipe["Image"]], ["musique", "Musique", equipe["Musique"]],
    ["scen", "Scénario", equipe["Scénario"]], ["montage", "Montage", equipe["Montage"]], ["decors", "Décors", equipe["Décors"]], ["acteurs", "Acteurs", true], ["themes", "Thèmes", true]]
    .filter(([, , ok]) => ok && (ok === true || ok.length));
  let par = S.filtresMemo.sim_par && CRIT.some(c => c[0] === S.filtresMemo.sim_par) ? S.filtresMemo.sim_par : CRIT[0][0];
  z.innerHTML = `<div class="section-titre" style="margin-bottom:8px"><h2>Similaires par…</h2></div><div class="segments defile-x sim-crit">${CRIT.map(([k, l]) => `<button data-v="${k}">${l}</button>`).join("")}</div><div data-sim class="sim-l"></div>`;
  const charger = async () => {
    $$(".sim-crit button", z).forEach(b => b.classList.toggle("actif", b.dataset.v === par));
    const l = $("[data-sim]", z); l.innerHTML = S.chargement();
    let r; try { r = await S.api(`/api/similaires?cle=${encodeURIComponent(cle)}&par=${par}`); } catch { l.innerHTML = `<p class="mini discret">Indisponible hors ligne.</p>`; return; }
    if (!r.r.length) { l.innerHTML = `<p class="mini discret">Rien trouvé${r.qui.length ? ` pour ${esc(r.qui.join(", "))}` : ""}.</p>`; return; }
    const cles = r.r.map(f => S.retenir({ id: +f.cle.slice(2), title: f.t, name: f.t, original_title: f.o, release_date: f.ds, poster_path: f.af, vote_average: f.vt }, f.cle[0] === "t" ? "tv" : "movie"));
    l.innerHTML = `${r.qui.length ? `<p class="mini discret" style="margin:0 0 8px">Avec ${esc(r.qui.join(", "))}</p>` : ""}<div class="prog-rangee">${cles.map((c, i) => S.vignette(c, { info: par === "themes" ? "" : r.r[i].raison })).join("")}</div>`;
  };
  $$(".sim-crit button", z).forEach(b => b.onclick = () => { par = S.filtresMemo.sim_par = b.dataset.v; charger(); });
  // chargé quand la section devient visible (évite des requêtes pour rien)
  const io = new IntersectionObserver(es => { if (es.some(e => e.isIntersecting)) { io.disconnect(); charger(); } });
  io.observe(z);
}

// ------------------------------------------------------------------ image à partager
S.partagerFilm = (cle, d, m, o) => {
  const t = S.monTitre(cle), j = (o.journal || [])[0];
  const critique = (j && j.critique) || "";
  const modale = S.ouvrirModale({ titre: "Partager", corps: `
    <div class="partage-apercu"><canvas data-canvas width="1080" height="1350"></canvas></div>
    <div class="aj-lignes">
      <div class="aj-ligne"><span>Ma note</span><label class="interrupteur"><input type="checkbox" data-o="note" ${t.note != null ? "checked" : "disabled"}><span></span></label></div>
      <div class="aj-ligne"><span>Ma critique</span><label class="interrupteur"><input type="checkbox" data-o="critique" ${critique && !j.critique_privee ? "checked" : ""} ${critique ? "" : "disabled"}><span></span></label></div>
      <div class="aj-ligne"><span>Date et lieu du visionnage</span><label class="interrupteur"><input type="checkbox" data-o="vis" ${j ? "checked" : "disabled"}><span></span></label></div>
    </div>
    <div class="flex" style="margin-top:12px;flex-wrap:wrap"><button class="bouton principal" data-envoyer>Partager</button><button class="bouton" data-enregistrer>Enregistrer l'image</button></div>` });
  const cv = $("[data-canvas]", modale);
  const opts = () => Object.fromEntries($$("[data-o]", modale).map(x => [x.dataset.o, x.checked]));
  const dessiner = () => dessinerCarte(cv, { d, m, t, j, critique, o: opts(), cle });
  $$("[data-o]", modale).forEach(x => x.onchange = dessiner);
  dessiner();
  const fichier = () => new Promise(ok => cv.toBlob(b => ok(new File([b], `silencio-${(d.title || d.name || "film").replace(/[^\w]+/g, "-").toLowerCase()}.png`, { type: "image/png" })), "image/png"));
  $("[data-envoyer]", modale).onclick = async () => {
    const f = await fichier();
    if (navigator.canShare && navigator.canShare({ files: [f] })) { try { await navigator.share({ files: [f], title: d.title || d.name }); } catch { /* annulé */ } }
    else enregistrer(f);
  };
  $("[data-enregistrer]", modale).onclick = async () => enregistrer(await fichier());
  function enregistrer(f) {
    const url = URL.createObjectURL(f);
    const a = Object.assign(document.createElement("a"), { href: url, download: f.name });
    document.body.append(a); a.click(); a.remove();
    S.toast("Image enregistrée (sinon : appui long sur l'aperçu)");
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
};

function chargerImage(src) {
  return new Promise(ok => { if (!src) return ok(null); const i = new Image(); i.onload = () => ok(i); i.onerror = () => ok(null); i.src = src; });
}
function lignes(ctx, texte, largeur, max) {
  const mots = String(texte).split(/\s+/), r = []; let l = "";
  for (const w of mots) { const essai = l ? l + " " + w : w; if (ctx.measureText(essai).width > largeur && l) { r.push(l); l = w; if (r.length === max) break; } else l = essai; }
  if (r.length < max && l) r.push(l);
  if (r.length === max && mots.join(" ").length > r.join(" ").length) r[max - 1] = r[max - 1].replace(/\s*\S*$/, "") + " …";
  return r;
}
async function dessinerCarte(cv, x) {
  const ctx = cv.getContext("2d"), W = cv.width, H = cv.height;
  const police = getComputedStyle(document.documentElement).getPropertyValue("--titre").trim() || "system-ui, sans-serif";
  ctx.fillStyle = "#121212"; ctx.fillRect(0, 0, W, H);
  const fond = await chargerImage((x.t.fond || x.d.backdrop_path) ? S.img(x.t.fond || x.d.backdrop_path, "w780") : null);
  if (fond) { ctx.globalAlpha = .28; const h = W * fond.height / fond.width; ctx.drawImage(fond, 0, 0, W, h); ctx.globalAlpha = 1;
    const g = ctx.createLinearGradient(0, h * .3, 0, h); g.addColorStop(0, "rgba(18,18,18,0)"); g.addColorStop(1, "#121212"); ctx.fillStyle = g; ctx.fillRect(0, 0, W, h); }
  const aff = await chargerImage((x.t.affiche || x.d.poster_path) ? S.img(x.t.affiche || x.d.poster_path, "w500") : null);
  const ax = 72, ay = 120, aw = 400, ah = 600;
  if (aff) ctx.drawImage(aff, ax, ay, aw, ah); else { ctx.fillStyle = "#2a2a2a"; ctx.fillRect(ax, ay, aw, ah); }
  ctx.strokeStyle = "rgba(255,255,255,.12)"; ctx.lineWidth = 2; ctx.strokeRect(ax, ay, aw, ah);
  // titre, année, réalisation
  const tx = ax + aw + 48, tw = W - tx - 72;
  ctx.fillStyle = "#fff"; ctx.font = `700 60px ${police}`;
  const tl = lignes(ctx, S.nomTitre(x.m), tw, 4); tl.forEach((l, i) => ctx.fillText(l, tx, ay + 58 + i * 70));
  let y = ay + 58 + tl.length * 70;
  ctx.fillStyle = "rgba(255,255,255,.65)"; ctx.font = `400 32px ${police}`;
  const an = (x.d.release_date || x.d.first_air_date || "").slice(0, 4);
  const reals = (x.d.credits?.crew || []).filter(c => c.job === "Director").map(c => c.name).slice(0, 2).join(", ") || (x.d.created_by || []).map(c => c.name).slice(0, 2).join(", ");
  ctx.fillText([an, reals].filter(Boolean).join(" · ").slice(0, 60), tx, y + 10); y += 70;
  // note : un anneau
  if (x.o.note && x.t.note != null) {
    const cx = tx + 80, cy = y + 90, R = 74;
    ctx.lineWidth = 12; ctx.strokeStyle = "rgba(255,255,255,.12)"; ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = "#fff"; ctx.beginPath(); ctx.arc(cx, cy, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * x.t.note / 10); ctx.stroke();
    ctx.fillStyle = "#fff"; ctx.font = `700 64px ${police}`; ctx.textAlign = "center"; ctx.fillText(S.fmtNote(x.t.note), cx, cy + 22); ctx.textAlign = "left";
    ctx.fillStyle = "rgba(255,255,255,.6)"; ctx.font = `400 26px ${police}`; ctx.fillText("ma note sur 10", cx + R + 30, cy + 10);
    if (x.t.coeur) { ctx.fillStyle = "#f0505f"; ctx.font = `400 44px ${police}`; ctx.fillText("♥", cx + R + 30, cy - 30); }
    y = cy + R + 40;
  }
  // visionnage
  if (x.o.vis && x.j) {
    ctx.fillStyle = "rgba(255,255,255,.75)"; ctx.font = `400 28px ${police}`;
    const ou = x.j.ou?.type === "cinema" ? `au ${x.j.ou.cinema || "cinéma"}${x.j.imax ? " en IMAX" : ""}` : x.j.ou?.nom ? `sur ${x.j.ou.nom}` : "";
    lignes(ctx, `Vu le ${S.fmtDateP(x.j.date)}${ou ? " " + ou : ""}${x.j.revision ? ", revu" : ""}`, tw, 2).forEach((l, i) => ctx.fillText(l, tx, y + i * 38));
  }
  // critique
  let cy2 = Math.max(ay + ah + 90, y + 90);
  if (x.o.critique && x.critique) {
    ctx.fillStyle = "rgba(255,255,255,.35)"; ctx.font = `700 90px Georgia, serif`; ctx.fillText("“", 60, cy2 + 30);
    ctx.fillStyle = "#fff"; ctx.font = `400 36px ${police}`;
    const max = Math.max(2, Math.floor((H - 120 - cy2) / 50));
    lignes(ctx, x.critique, W - 2 * 110, max).forEach((l, i) => ctx.fillText(l, 110, cy2 + i * 50));
  }
  ctx.fillStyle = "rgba(255,255,255,.4)"; ctx.font = `600 26px ${police}`; ctx.fillText("Silencio", 72, H - 56);
}
})();
