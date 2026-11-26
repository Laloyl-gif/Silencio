"use strict";
const B = globalThis.browser;
const $ = s => document.querySelector(s);
const envoyer = m => B.runtime.sendMessage(m);
const heure = t => new Date(t).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

async function peindre() {
  const c = await envoyer({ type: "etat" });
  $("[data-adresse]").value ||= c.adresse;
  if (!$("[data-jeton]").matches(":focus")) $("[data-jeton]").value = c.jeton;
  $("[data-actif]").checked = c.actif;
  document.querySelectorAll("[data-site]").forEach(x => { x.checked = c.sites[x.dataset.site] !== false; });
  $("[data-intervalle]").value = String(c.intervalle);
  $("[data-dernier]").textContent = c.enCours ? "en cours…" : (c.dernier ? heure(c.dernier.quand) : "jamais") + (c.prochain > Date.now() ? `, prochain vers ${new Date(c.prochain).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}` : "");
  $("[data-sync]").disabled = $("[data-blanc]").disabled = c.enCours;
  $("[data-journal]").innerHTML = c.journal.slice(0, 40).map(l => `<div class="${l.niveau}"><time>${heure(l.t)}</time>${esc(l.texte)}</div>`).join("") || "<div>Rien pour l'instant.</div>";
  $("[data-manuels-bloc]").hidden = !c.manuels.length;
  $("[data-manuels]").innerHTML = c.manuels.map(m => `<div class="manuel"><b>${esc(m.titre || m.cle)}</b><span>${m.plateforme === "imdb" ? "Critique à publier sur IMDb" : esc(m.erreur)}</span>
    <div class="boutons"><button data-ouvrir="${esc(m.id)}">Copier le texte et ouvrir</button><button data-fait="${esc(m.id)}">C'est fait</button></div></div>`).join("");
  document.querySelectorAll("[data-ouvrir]").forEach(b => b.onclick = async () => {
    const m = c.manuels.find(x => x.id === b.dataset.ouvrir);
    if (m.texte) await navigator.clipboard.writeText(m.texte).catch(() => {});
    B.tabs.create({ url: m.lien });
  });
  document.querySelectorAll("[data-fait]").forEach(b => b.onclick = async () => { await envoyer({ type: "manuel-fait", id: b.dataset.fait }); peindre(); });
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
peindre(); tester();
setInterval(peindre, 3000);
