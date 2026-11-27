/* Silencio — classer une liste par duels : « lequel tu préfères ? ». Le classement est estimé à partir de TOUS les
   duels (modèle de Bradley-Terry) : perdre un duel n'élimine pas un film, un film battu une fois peut finir devant
   s'il gagne ailleurs. Les duels suivants sont choisis là où l'ordre est le plus incertain. La progression est
   gardée dans ton profil : tu peux t'arrêter, quitter l'appli, reprendre plus tard (même sur un autre appareil). */
(function () {
"use strict";
const S = window.Silencio;
const { $, $$, esc } = S;

// ---- le modèle : force de chaque film d'après les duels [gagnant, perdant, égalité?]
S.duels = {};
S.duels.forces = (items, comps) => {
  const n = items.length, idx = new Map(items.map((c, i) => [c, i]));
  const victoires = new Float64Array(n), matchs = new Map();
  const cleP = (i, j) => i < j ? i * n + j : j * n + i;
  for (const [a, b, eg] of comps) {
    const i = idx.get(a), j = idx.get(b); if (i == null || j == null || i === j) continue;
    if (eg) { victoires[i] += .5; victoires[j] += .5; } else victoires[i] += 1;
    matchs.set(cleP(i, j), (matchs.get(cleP(i, j)) || 0) + 1);
  }
  // a priori : chaque film a fait match nul contre un film « moyen » fictif (forces toujours finies)
  let w = new Float64Array(n).fill(1);
  const paires = [...matchs.entries()].map(([k, m]) => [Math.floor(k / n), k % n, m]);
  for (let it = 0; it < 80; it++) {
    const den = new Float64Array(n).fill(0);
    for (let i = 0; i < n; i++) den[i] = 1 / (w[i] + 1);                 // le film fictif (force 1)
    for (const [i, j, m] of paires) { const s = m / (w[i] + w[j]); den[i] += s; den[j] += s; }
    const nw = new Float64Array(n);
    let somme = 0;
    for (let i = 0; i < n; i++) { nw[i] = (victoires[i] + .5) / den[i]; somme += Math.log(nw[i]); }
    const moy = Math.exp(somme / n);
    for (let i = 0; i < n; i++) nw[i] /= moy;
    w = nw;
  }
  const vus = new Float64Array(n);
  for (const [i, j, m] of paires) { vus[i] += m; vus[j] += m; }
  return { w, vus, deja: matchs, cleP };
};
S.duels.classement = (items, comps) => {
  const { w } = S.duels.forces(items, comps);
  return items.map((c, i) => [c, w[i]]).sort((a, b) => b[1] - a[1]).map(x => x[0]);
};
// le prochain duel : deux films proches dans le classement, peu comparés entre eux et peu comparés au total
S.duels.suivant = (items, comps, eviter) => {
  const n = items.length; if (n < 2) return null;
  const { w, vus, deja, cleP } = S.duels.forces(items, comps);
  const ordre = [...items.keys()].sort((a, b) => w[b] - w[a]);
  const moyVus = vus.reduce((s, x) => s + x, 0) / n || 1;
  let meilleur = null, score = Infinity;
  for (let k = 0; k < n; k++) for (let d = 1; d <= 3 && k + d < n; d++) {
    const i = ordre[k], j = ordre[k + d];
    const fois = deja.get(cleP(i, j)) || 0;
    const s = Math.abs(Math.log(w[i]) - Math.log(w[j])) + .35 * (vus[i] + vus[j]) / (2 * moyVus) + 1.5 * fois + (d - 1) * .15 + Math.random() * .25
      + (eviter && (items[i] === eviter[0] || items[i] === eviter[1] || items[j] === eviter[0] || items[j] === eviter[1]) ? .6 : 0);
    if (s < score) { score = s; meilleur = [items[i], items[j]]; }
  }
  // un film encore jamais comparé passe en priorité
  const neuf = [...items.keys()].filter(i => !vus[i]);
  if (neuf.length && Math.random() < .7) { const i = neuf[Math.floor(Math.random() * neuf.length)]; const j = ordre[Math.floor(n / 2)] === i ? ordre[0] : ordre[Math.floor(n / 2)]; meilleur = [items[i], items[j]]; }
  return Math.random() < .5 ? meilleur : [meilleur[1], meilleur[0]];
};
// progression : environ n·log2(n) duels donnent un classement fiable
S.duels.objectif = n => Math.max(1, Math.round(n * Math.log2(Math.max(2, n)) * .9));

// ---- la page
S.pages.duels = (vue, args) => {
  const id = args[0];
  const l = S.vivants(S.moi.listes)[id];
  if (!l) { vue.innerHTML = S.vide("Liste introuvable"); return; }
  const items = [...new Set(l.items || [])];
  let comps = ((S.moi.duels || {})[id]?.c || []).filter(x => items.includes(x[0]) && items.includes(x[1]));
  let nonEnvoyes = 0, dernier = null, paire = null;
  const enregistrer = async (force) => {
    if (!nonEnvoyes && !force) return;
    nonEnvoyes = 0;
    await S.agir("duels", { liste: id, comparaisons: comps }, { toast: false, sansRendu: true, sansAnnuler: true }).catch(() => {});
  };
  vue.innerHTML = `<a class="fil" href="#/liste/${id}">${esc(l.nom)}</a><div class="entete"><h1>Classer par duels</h1></div>
    <p class="petit muet" style="margin-top:-6px">Lequel tu préfères ? Touche l'affiche. Arrête quand tu veux : ta progression est gardée.</p>
    <div class="duel-prog"><i data-barre></i></div><p class="mini discret" data-prog></p>
    <div class="duel" data-duel></div>
    <div class="flex duel-actions"><button class="bouton" data-egal>Égalité</button><button class="bouton" data-passer>Passer</button><button class="bouton" data-annuler>Annuler le dernier</button></div>
    <div class="flex" style="margin-top:18px;flex-wrap:wrap"><button class="bouton principal" data-appliquer>Appliquer ce classement à la liste</button><button class="bouton" data-voir>Voir le classement</button><button class="lien" data-effacer>Recommencer à zéro</button></div>
    <div data-classement></div>`;
  const objectif = S.duels.objectif(items.length);
  const peindre = () => {
    const pct = Math.min(100, Math.round(100 * comps.length / objectif));
    $("[data-barre]", vue).style.width = pct + "%";
    $("[data-prog]", vue).textContent = `${comps.length} duel${comps.length > 1 ? "s" : ""} sur environ ${objectif} pour un classement fiable${pct >= 100 ? " : c'est bon, tu peux appliquer (ou continuer pour affiner)" : ""}.`;
    paire = S.duels.suivant(items, comps, dernier);
    if (!paire) { $("[data-duel]", vue).innerHTML = S.vide("Il faut au moins deux films dans la liste"); return; }
    $("[data-duel]", vue).innerHTML = paire.map((c, k) => { const m = S.info(c) || {}; return `<button class="duel-film" data-choix="${k}">${S.affiche(m, { taille: "w342" })}<b>${esc(S.nomTitre(m))}</b><span>${m.a || ""}</span></button>`; }).join(`<span class="duel-ou">ou</span>`);
    $$("[data-choix]", vue).forEach(b => b.onclick = () => jouer(+b.dataset.choix));
  };
  const jouer = (k, egal) => {
    if (!paire) return;
    const [a, b] = k === 1 ? [paire[1], paire[0]] : paire;
    comps.push(egal ? [a, b, 1] : [a, b]); dernier = paire; nonEnvoyes++;
    if (nonEnvoyes >= 5) enregistrer();
    peindre();
  };
  $("[data-egal]", vue).onclick = () => jouer(0, true);
  $("[data-passer]", vue).onclick = () => { dernier = paire; peindre(); };
  $("[data-annuler]", vue).onclick = () => { if (comps.length) { comps.pop(); nonEnvoyes++; peindre(); } };
  $("[data-voir]", vue).onclick = () => {
    const ordre = S.duels.classement(items, comps);
    $("[data-classement]", vue).innerHTML = `<h3 style="margin:18px 0 8px">Classement actuel</h3><ol class="duel-classement">${ordre.map(c => `<li>${esc(S.nomTitre(S.info(c) || {}))}</li>`).join("")}</ol>`;
  };
  $("[data-appliquer]", vue).onclick = async () => {
    await enregistrer(true);
    await S.agir("liste", { liste: { id, items: S.duels.classement(items, comps), classee: true } }, { toast: "Liste classée d'après tes duels" });
    location.hash = `#/liste/${id}`;
  };
  $("[data-effacer]", vue).onclick = async () => {
    if (!(await S.demander("Recommencer à zéro ?", "Tous les duels de cette liste sont oubliés.", "Recommencer", "Annuler"))) return;
    comps = []; dernier = null; await S.agir("duels", { liste: id, suppr: true }, { toast: false, sansRendu: true, sansAnnuler: true }); peindre();
  };
  // en quittant la page (ou l'appli) : les derniers duels sont enregistrés
  const quitter = () => { enregistrer(); window.removeEventListener("hashchange", quitter); document.removeEventListener("visibilitychange", cache); };
  const cache = () => { if (document.visibilityState === "hidden") enregistrer(); };
  window.addEventListener("hashchange", quitter);
  document.addEventListener("visibilitychange", cache);
  peindre();
};
})();
