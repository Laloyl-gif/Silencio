/* Silencio — rangement de l'interface : rien ne défile sur le côté. Les rangées d'affiches deviennent des grilles de
   deux lignes (« Afficher plus » pour le reste), le casting une grille, et sur téléphone un menu réunit les pages. */
(function () {
"use strict";
const S = window.Silencio;
const { $, $$, esc } = S;

// ---- grilles limitées à deux lignes
const LIMITES = [[".rangee", 2], [".prog-rangee", 2], [".suivre", 2], [".ff-cast", 2], [".prog-cast", 2]];
function colonnes(g) {
  const t = getComputedStyle(g).gridTemplateColumns;
  return t && t !== "none" ? t.split(" ").filter(Boolean).length : 1;
}
function ranger(racine) {
  for (const [sel, lignes] of LIMITES) {
    for (const g of $$(sel, racine)) {
      if (g.dataset.tout === "1") continue;
      const enfants = [...g.children].filter(x => !x.classList.contains("plus-grille"));
      const max = colonnes(g) * lignes;
      enfants.forEach((x, i) => { x.hidden = i >= max; });
      let b = g.nextElementSibling && g.nextElementSibling.classList.contains("plus-grille-b") ? g.nextElementSibling : null;
      const caches = enfants.length - max;
      if (caches > 0) {
        if (!b) { b = Object.assign(document.createElement("button"), { className: "lien plus-grille-b" }); g.after(b); }
        b.textContent = `Afficher plus (${caches})`;
        b.onclick = () => { g.dataset.tout = "1"; enfants.forEach(x => { x.hidden = false; }); b.remove(); };
      } else if (b) b.remove();
    }
  }
}
let attente = null;
const plusTard = () => { clearTimeout(attente); attente = setTimeout(() => ranger(document), 40); };
new MutationObserver(plusTard).observe(document.body, { childList: true, subtree: true });
window.addEventListener("resize", plusTard);
S.ranger = ranger;

// ---- le menu (téléphone)
const ENTREES = [["#/profil", "Profil"], ["#/journal", "Journal"], ["#/watchlist", "Watchlist"], ["#/listes", "Listes"], ["#/objectifs", "Filmographies à finir"], ["#/avancee", "Recherche avancée"],
  ["#/labo", "Labo"], ["#/amis", "Amis"], ["#/envois", "Historique des envois"], ["#/notifs", "Notifications"], ["#/reglages", "Réglages"]];
document.addEventListener("click", ev => {
  const b = ev.target.closest("[data-menu]"); if (!b) return;
  const m = S.ouvrirModale({ titre: "Menu", corps: `<nav class="menu-tel">${ENTREES.map(([h, l]) => `<a href="${h}">${esc(l)}${h === "#/notifs" && S.etat?.notifs ? ` <b>${S.etat.notifs}</b>` : ""}</a>`).join("")}</nav>` });
  // la modale se referme (retour d'historique) avant d'aller à la page choisie
  $$("a", m).forEach(a => a.addEventListener("click", ev => {
    ev.preventDefault(); const h = a.getAttribute("href");
    let fait = false; const aller = () => { if (fait) return; fait = true; location.hash = h; };
    window.addEventListener("popstate", () => setTimeout(aller, 0), { once: true });
    S.fermerModale(); setTimeout(aller, 400);
  }));
});

// ---- transitions douces : l'affiche touchée s'agrandit jusqu'à la fiche du film (navigateurs qui savent le faire),
// sinon la nouvelle page apparaît en fondu
const vt = !!document.startViewTransition && !matchMedia("(prefers-reduced-motion: reduce)").matches;
document.addEventListener("click", ev => {
  const a = ev.target.closest('a[href^="#/titre/"]'); if (!a || !vt) return;
  const aff = a.querySelector(".affiche"); if (!aff) return;
  $$(".affiche[style*='view-transition-name']").forEach(x => { if (!x.closest(".ff-affiche")) x.style.viewTransitionName = ""; });
  aff.style.viewTransitionName = "affiche-" + a.getAttribute("href").slice(8).replace(":", "-");
}, true);
if (!vt) window.addEventListener("hashchange", () => {
  const v = $("#vue"); if (!v) return;
  v.classList.remove("entree"); void v.offsetWidth; v.classList.add("entree");
});
})();
