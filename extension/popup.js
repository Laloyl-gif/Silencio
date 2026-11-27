"use strict";
const B = globalThis.browser;
const $ = s => document.querySelector(s);
const envoyer = m => B.runtime.sendMessage(m);
const heure = t => new Date(t).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

const NOMS = { lb: "Letterboxd", imdb: "IMDb" };
// construit les éléments sans innerHTML (le texte vient de Silencio et des sites : jamais interprété comme du HTML)
function h(tag, attrs = {}, ...enfants) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") e.className = v; else if (k.startsWith("on")) e[k] = v; else e.setAttribute(k, v);
  }
  for (const x of enfants.flat()) if (x != null && x !== false) e.append(x instanceof Node ? x : String(x));
  return e;
}
function libelle(o, p) {
  const v = o.valeur;
  if (o.action === "retirer") return o.sorte === "vu" ? "Retirer cette entrée du journal" : "Retirer";
  switch (o.sorte) {
    case "vu": return `${o.ref || (o.avant && o.avant.date) ? "Modifier l'entrée du journal" : "Visionnage"} du ${new Date(v.date + "T12:00").toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" })}${v.rewatch ? ", revu" : ""}`;
    case "note": return p === "lb" ? `Note : ${String(v).replace(".", ",")} étoiles` : `Note : ${v}/10`;
    case "like": return "Coup de cœur";
    case "wl": return "Ajouter à la watchlist";
    case "fav": return "Ajouter à la watchlist IMDb";
    case "marque": return "Marquer comme vu";
    case "item": return "Ajouter à une liste";
    case "critique": return "Critique à publier";
    case "liste": return v && v.watchlist ? "Relier ta watchlist IMDb" : `Créer la liste « ${v.nom} »`;
    default: return o.sorte;
  }
}
function lien(o, p) {
  if (p === "lb") return o.tmdb ? `https://letterboxd.com/tmdb/${o.tmdb}/` : "https://letterboxd.com/";
  if (o.sorte === "critique") return `https://www.imdb.com/review/create/?tconst=${o.imdb}`;
  return o.imdb ? `https://www.imdb.com/title/${o.imdb}/` : "https://www.imdb.com/";
}

const ORIGINES = ["https://letterboxd.com/*", "https://www.imdb.com/*", "https://m.imdb.com/*", "https://api.graphql.imdb.com/*"];
async function verifierAutorisations() {
  if (!B.permissions) return;
  const ok = await B.permissions.contains({ origins: ORIGINES }).catch(() => true);
  $("[data-autor]").hidden = ok;
}
$("[data-autoriser]").onclick = async () => {
  // doit être appelé directement depuis le clic (Firefox l'exige)
  const ok = await B.permissions.request({ origins: ORIGINES }).catch(() => false);
  $("[data-autor]").hidden = ok;
};

async function peindre() {
  verifierAutorisations();
  const c = await envoyer({ type: "etat" });
  $("[data-adresse]").value ||= c.adresse;
  if (!$("[data-jeton]").matches(":focus")) $("[data-jeton]").value = c.jeton;
  $("[data-actif]").checked = c.actif;
  document.querySelectorAll("[data-site]").forEach(x => { x.checked = c.sites[x.dataset.site] !== false; });
  $("[data-intervalle]").value = String(c.intervalle);
  $("[data-dernier]").textContent = c.enCours ? "en cours…" : (c.dernier ? heure(c.dernier.quand) : "jamais") + (c.prochain > Date.now() ? `, prochain vers ${new Date(c.prochain).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}` : "");
  $("[data-sync]").disabled = $("[data-blanc]").disabled = c.enCours;
  const lignes = c.journal.slice(0, 40).map(l => h("div", { class: l.niveau }, h("time", {}, heure(l.t)), l.texte));
  $("[data-journal]").replaceChildren(...(lignes.length ? lignes : [h("div", {}, "Rien pour l'instant.")]));
  const items = ["lb", "imdb"].flatMap(p => (c.attente[p] || []).map(o => ({ o, p })));
  $("[data-reporter-bloc]").hidden = !items.length;
  const modes = c.modes || {};
  $("[data-reporter-intro]").textContent = ["lb", "imdb"].filter(p => (c.attente[p] || []).length).map(p =>
    `${NOMS[p]} : ${modes[p] === "liens" ? "fais-le toi-même sur le site, puis « C'est fait »" : "un clic par action"}`).join(". ");
  $("[data-reporter]").replaceChildren(...items.slice(0, 30).map(({ o, p }) => {
    const envoyerUn = async ev => {
      const b = ev.currentTarget; b.disabled = true; b.textContent = "…";
      const r = await envoyer({ type: "executer-un", p, id: o.id });
      if (r.manuel) { if (r.manuel.texte) await navigator.clipboard.writeText(r.manuel.texte).catch(() => {}); B.tabs.create({ url: r.manuel.lien }); }
      if (!r.ok) { b.disabled = false; b.textContent = "Réessayer"; b.title = r.erreur || ""; alert(r.erreur || "Échec"); }
      peindre();
    };
    const ouvrir = async () => { if (o.sorte === "critique" && o.valeur) await navigator.clipboard.writeText(o.valeur).catch(() => {}); B.tabs.create({ url: lien(o, p) }); };
    const fait = async () => { await envoyer({ type: "fait-main", p, id: o.id }); peindre(); };
    return h("div", { class: "manuel" }, h("b", {}, o.titre || o.cle), h("span", {}, `${NOMS[p]}, ${libelle(o, p)}`),
      h("div", { class: "boutons" },
        modes[p] !== "liens" || o.sorte === "liste" ? h("button", { class: "principal", onclick: envoyerUn }, "Envoyer") : null,
        h("button", { onclick: ouvrir }, "Ouvrir"),
        modes[p] === "liens" && o.sorte !== "liste" ? h("button", { onclick: fait }, "C'est fait") : null));
  }));
  $("[data-manuels-bloc]").hidden = !c.manuels.length;
  $("[data-manuels]").replaceChildren(...c.manuels.map(m => h("div", { class: "manuel" }, h("b", {}, m.titre || m.cle),
    h("span", {}, m.plateforme === "imdb" ? "Critique à publier sur IMDb" : (m.erreur || "")),
    h("div", { class: "boutons" },
      h("button", { onclick: async () => { if (m.texte) await navigator.clipboard.writeText(m.texte).catch(() => {}); B.tabs.create({ url: m.lien }); } }, m.texte ? "Copier le texte et ouvrir" : "Ouvrir"),
      h("button", { onclick: async () => { await envoyer({ type: "manuel-fait", id: m.id }); peindre(); } }, "C'est fait")))));
  const enr = c.enregistreurJusqua > Date.now();
  $("[data-rec]").textContent = enr ? `Enregistre jusqu'à ${new Date(c.enregistreurJusqua).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}` : "Démarrer (3 minutes)";
  $("[data-rapport]").textContent = c.enregistrements.length ? JSON.stringify(c.enregistrements, null, 1) : "";
}

async function tester() {
  const r = await envoyer({ type: "tester" });
  $("[data-etat-silencio]").textContent = r.ok ? `relié (profil ${r.profil || "?"})` : "injoignable";
  $("[data-etat-silencio]").title = r.erreur || "";
  return r;
}

$("[data-enregistrer]").onclick = async () => {
  await envoyer({ type: "reglages", valeurs: { adresse: $("[data-adresse]").value.trim() || "http://127.0.0.1:8642", jeton: $("[data-jeton]").value.trim(),
    actif: $("[data-actif]").checked, intervalle: +$("[data-intervalle]").value,
    sites: { lb: $("[data-site=lb]").checked, imdb: $("[data-site=imdb]").checked } } });
  await tester(); peindre();
};
$("[data-tester]").onclick = tester;
$("[data-sync]").onclick = async () => { const p = envoyer({ type: "synchroniser" }); setTimeout(peindre, 300); await p; peindre(); };
$("[data-blanc]").onclick = async () => { const p = envoyer({ type: "synchroniser", aBlanc: true }); setTimeout(peindre, 300); await p; peindre(); };
$("[data-effacer]").onclick = async () => { await envoyer({ type: "effacer-journal" }); peindre(); };
$("[data-rec]").onclick = async () => { await envoyer({ type: "enregistrer", minutes: 3 }); peindre(); };
$("[data-rec-stop]").onclick = async () => { await envoyer({ type: "arreter" }); peindre(); };
$("[data-rec-copier]").onclick = async () => { await navigator.clipboard.writeText($("[data-rapport]").textContent || "(vide)").catch(() => {}); $("[data-rec-copier]").textContent = "Copié"; };
$("[data-ouvrir-film]").onclick = async () => { const r = await envoyer({ type: "ouvrir-film" }); if (!r.ok) alert(r.erreur || "Ouvre d'abord la page d'un film sur IMDb, Letterboxd ou TMDB."); else window.close(); };
peindre(); tester();
setInterval(peindre, 3000);
