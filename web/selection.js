/* Silencio : sélection de plusieurs films dans une liste (appui long sur téléphone, ou bouton « Sélectionner »),
   puis une action sur toute la sélection : retirer de la liste, ajouter à une liste, watchlist, marquer vu… */
(() => {
const S = window.Silencio;
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// zone : l'élément qui contient les vignettes (.vignette[data-cle] ou .ligne[data-cle]) ; o.liste : id d'une vraie liste ;
// o.attr : l'attribut qui identifie un élément (« j » dans le journal : chaque visionnage) ; o.actions : les boutons
S.selectionnable = (zone, o = {}) => {
  let actif = false, appui = null;
  const choisis = new Set();
  const attr = o.attr || "cle", sel = `[data-${attr}]`;
  const id = v => v.dataset[attr];
  const cleDe = k => { const v = zone.querySelector(`[data-${attr}="${CSS.escape(k)}"]`); return v ? v.dataset.cle : k; };
  const actions = o.actions || [...(o.liste ? ["retirer"] : []), "liste", "wl", "vu"];
  const LIB = { retirer: "Retirer de la liste", suppr: "Supprimer", retirer_wl: "Retirer de la watchlist", liste: "Ajouter à une liste", wl: "Watchlist", vu: "Marquer vu" };
  $$(".barre-selection").forEach(b => b.remove());
  const barre = document.body.appendChild(Object.assign(document.createElement("div"), { className: "barre-selection cache" }));
  const peindre = () => {
    zone.classList.toggle("en-selection", actif);
    $$(sel, zone).forEach(v => v.classList.toggle("choisi", choisis.has(id(v))));
    barre.classList.toggle("cache", !actif);
    barre.innerHTML = `<b>${choisis.size} sélectionné${choisis.size > 1 ? "s" : ""}</b>
      ${actions.map(a => `<button data-a="${a}">${LIB[a]}</button>`).join("")}
      <button data-a="tout">Tout</button><button data-a="fin">Terminer</button>`;
    $$("[data-a]", barre).forEach(b => b.onclick = () => agir(b.dataset.a));
  };
  const commencer = cle => { actif = true; if (cle) choisis.add(cle); peindre(); };
  const finir = () => { actif = false; choisis.clear(); peindre(); };
  async function agir(a) {
    const ids = [...choisis], cles = [...new Set(ids.map(cleDe))];
    if (a === "fin") return finir();
    if (a === "tout") { $$(sel, zone).forEach(v => choisis.add(id(v))); return peindre(); }
    if (!ids.length) return S.toast("Touche les films à sélectionner");
    const sans = { toast: false, sansRendu: true, sansAnnuler: true };
    if (a === "retirer") {
      if (!(await S.demander("Retirer de la liste ?", `${cles.length} titre${cles.length > 1 ? "s" : ""} retiré${cles.length > 1 ? "s" : ""} de cette liste (et de ses copies sur tes plateformes).`, "Retirer", "Annuler"))) return;
      for (const c of cles) await S.agir("liste_item", { id: o.liste, cle: c, val: false }, sans);
      S.toast(`${cles.length} retiré${cles.length > 1 ? "s" : ""} de la liste`);
    } else if (a === "suppr") {
      if (!(await S.demander("Supprimer ces visionnages ?", `${ids.length} visionnage${ids.length > 1 ? "s" : ""} supprimé${ids.length > 1 ? "s" : ""} de ton journal, ici et sur tes plateformes. Un film sans autre visionnage quitte ton profil.`, "Supprimer", "Annuler"))) return;
      for (const j of ids) await S.agir("suppr_journal", { id: j }, sans);
      S.toast(`${ids.length} visionnage${ids.length > 1 ? "s" : ""} supprimé${ids.length > 1 ? "s" : ""}`);
    } else if (a === "retirer_wl") {
      for (const c of cles) await S.agir("watchlist", { cle: c, val: false }, sans);
      S.toast(`${cles.length} retiré${cles.length > 1 ? "s" : ""} de ta watchlist`);
    } else if (a === "wl") {
      for (const c of cles) await S.agir("watchlist", { cle: c, val: true }, sans);
      S.toast(`${cles.length} ajouté${cles.length > 1 ? "s" : ""} à ta watchlist`);
    } else if (a === "vu") {
      for (const c of cles) await S.agir("vu", { cle: c, val: true }, sans);
      S.toast(`${cles.length} marqué${cles.length > 1 ? "s" : ""} vu${cles.length > 1 ? "s" : ""}`);
    } else if (a === "liste") {
      const listes = Object.entries(S.vivants(S.moi.listes)).filter(([id]) => id !== o.liste);
      const corps = Object.assign(document.createElement("div"), { innerHTML: `<div class="lignes">${listes.map(([id, l]) => `<button class="ligne" data-l="${id}"><div class="corps"><b>${esc(l.nom)}</b><span>${(l.items || []).length} titres</span></div></button>`).join("") || `<p class="mini discret">Aucune autre liste.</p>`}</div>` });
      S.ouvrirModale({ titre: `Ajouter ${cles.length} titre${cles.length > 1 ? "s" : ""} à…`, corps });
      $$("[data-l]", corps).forEach(b => b.onclick = async () => {
        for (const c of cles) await S.agir("liste_item", { id: b.dataset.l, cle: c, val: true }, sans);
        S.fermerModale(); S.toast("Ajoutés à la liste");
      });
      return;
    }
    finir(); S.rafraichir(true);
  }
  // appui long (téléphone) : entre en sélection avec ce film
  zone.addEventListener("touchstart", e => {
    const v = e.target.closest(sel); if (!v || actif) return;
    appui = setTimeout(() => { appui = "fait"; navigator.vibrate?.(15); commencer(id(v)); }, 480);
  }, { passive: true });
  const annulerAppui = () => { if (appui && appui !== "fait") clearTimeout(appui); };
  zone.addEventListener("touchmove", annulerAppui, { passive: true });
  zone.addEventListener("touchend", e => { if (appui === "fait") e.preventDefault(); annulerAppui(); setTimeout(() => { appui = null; }, 50); });
  zone.addEventListener("contextmenu", e => { if (e.target.closest(sel)) e.preventDefault(); });
  // en sélection, toucher un film le (dé)sélectionne au lieu de l'ouvrir
  zone.addEventListener("click", e => {
    const v = e.target.closest(sel); if (!v) return;
    if (!actif && appui !== "fait") return;
    e.preventDefault(); e.stopPropagation();
    if (appui === "fait") return;
    choisis.has(id(v)) ? choisis.delete(id(v)) : choisis.add(id(v));
    peindre();
  }, true);
  window.addEventListener("hashchange", () => barre.remove(), { once: true });
  return { commencer, finir };
};
})();
