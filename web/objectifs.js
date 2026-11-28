/* Silencio — filmographies à finir avant la fin d'une année : progression, rythme à tenir, prochain film à voir. */
(function () {
"use strict";
const S = window.Silencio;
const { $, $$, esc } = S;

const auj = () => S.aujourdhui();
// les films qui comptent : longs métrages sortis, réalisés (ou joués) par la personne
S.filmoAFinir = (d, o) => {
  const cr = d.combined_credits || d.credits || {};
  const brut = o.role === "acteur" ? (cr.cast || []).filter(c => !/^(him|her|them)self|^self$/i.test(c.character || "")) : (cr.crew || []).filter(c => c.job === "Director");
  const vus = new Set();
  return brut.filter(c => c.media_type === "movie" && c.release_date && c.release_date <= auj() && (o.tout || (c.vote_count || 0) >= 10))
    .filter(c => !vus.has(c.id) && vus.add(c.id))
    .sort((a, b) => a.release_date.localeCompare(b.release_date))
    .map(c => ({ cle: S.retenir(c, "movie"), date: c.release_date, vt: c.vote_average, nv: c.vote_count }));
};
const estVu = c => !!(S.monTitre(c).vu || S.journalDe(c).length);

S.objectifFilmo = async (p) => {
  const existant = S.vivants(S.moi.objectifs || {})["p" + p.pid];
  const an = +auj().slice(0, 4);
  const m = S.ouvrirModale({ titre: `Finir la filmographie de ${p.nom}`, corps: `
    <label class="etiquette">Avant la fin de</label>
    <div class="segments" data-an>${[an, an + 1, an + 2].map(a => `<button data-v="${a}" class="${(existant?.annee || an) === a ? "actif" : ""}">${a}</button>`).join("")}</div>
    <label class="etiquette">Ce qui compte</label>
    <div class="segments" data-role><button data-v="real" class="${(existant?.role || p.role) === "real" ? "actif" : ""}">Ses réalisations</button><button data-v="acteur" class="${(existant?.role || p.role) === "acteur" ? "actif" : ""}">Ses rôles</button></div>
    <label class="case"><input type="checkbox" data-tout ${existant?.tout ? "checked" : ""}> Compter aussi les courts et les films très confidentiels</label>
    <div class="flex" style="margin-top:14px"><button class="bouton principal" data-ok>${existant ? "Enregistrer" : "C'est parti"}</button>${existant ? `<button class="bouton" data-suppr>Abandonner</button>` : ""}</div>` });
  const choix = k => $(`[data-${k}] .actif`, m)?.dataset.v;
  $$(".segments", m).forEach(g => $$("button", g).forEach(b => b.onclick = () => { $$("button", g).forEach(x => x.classList.toggle("actif", x === b)); }));
  $("[data-ok]", m).onclick = async () => {
    await S.agir("objectif", { pid: p.pid, nom: p.nom, photo: p.photo, role: choix("role") || p.role, annee: +choix("an") || an, tout: $("[data-tout]", m).checked });
    S.fermerModale(); location.hash = "#/objectifs";
  };
  const s = $("[data-suppr]", m); if (s) s.onclick = async () => { await S.agir("objectif", { pid: p.pid, suppr: true }); S.fermerModale(); };
};

// ---- la page : chaque filmographie, ce qu'il reste, le rythme à tenir
S.pages.objectifs = async (vue) => {
  const obj = Object.entries(S.vivants(S.moi.objectifs || {})).sort((a, b) => a[1].annee - b[1].annee);
  vue.innerHTML = `<div class="entete"><h1>Filmographies à finir</h1></div>
    ${obj.length ? obj.map(([id]) => `<section class="carte obj" data-obj="${id}">${S.chargement()}</section>`).join("") : S.vide("Aucune pour l'instant", "Sur la page d'un cinéaste ou d'un acteur, touche « Finir sa filmo » et choisis l'année.")}`;
  for (const [id, o] of obj) {
    const z = $(`[data-obj="${id}"]`, vue);
    let d; try { d = (await S.api(`/api/personne/${o.pid}`)).d; } catch { z.innerHTML = `<b>${esc(o.nom)}</b><p class="mini discret">Indisponible hors ligne.</p>`; continue; }
    const films = S.filmoAFinir(d, o);
    const vus = films.filter(f => estVu(f.cle)), reste = films.filter(f => !estVu(f.cle));
    const fin = new Date(`${o.annee}-12-31T23:59`), mois = Math.max(0.5, (fin - new Date()) / (30.4 * 864e5));
    const parMois = reste.length / mois;
    const prochain = reste.slice().sort((a, b) => (b.vt * Math.log10(10 + b.nv)) - (a.vt * Math.log10(10 + a.nv)))[0];
    const pct = films.length ? Math.round(100 * vus.length / films.length) : 0;
    z.innerHTML = `<div class="obj-tete"><a href="#/personne/${o.pid}">${S.portrait(o.photo, o.nom)}</a><div><b><a href="#/personne/${o.pid}">${esc(o.nom)}</a></b>
        <span>${o.role === "acteur" ? "ses rôles" : "ses réalisations"}, avant la fin de ${o.annee}</span></div><button class="lien" data-modif>Modifier</button></div>
      <div class="duel-prog"><i style="width:${pct}%"></i></div>
      <p class="obj-chiffres">${vus.length} vu${vus.length > 1 ? "s" : ""} sur ${films.length}${reste.length ? `, encore ${reste.length} : environ ${parMois < 1 ? `un tous les ${Math.round(1 / parMois)} mois` : `${S.fmtNote(Math.round(parMois * 10) / 10)} par mois`}` : " : filmographie complète"}</p>
      ${prochain ? `<p class="mini discret" style="margin:0 0 8px">Pour commencer : <a href="#/titre/${prochain.cle}">${esc(S.nomTitre(S.info(prochain.cle) || {}))}</a> (le mieux accueilli de ce qu'il te reste)</p>` : ""}
      <div class="rangee">${reste.map(f => S.vignette(f.cle, { info: f.date.slice(0, 4) })).join("")}</div>`;
    $("[data-modif]", z).onclick = () => S.objectifFilmo({ pid: o.pid, nom: o.nom, photo: o.photo, role: o.role });
  }
};
})();
