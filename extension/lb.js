/* Silencio Sync, côté letterboxd.com : exécute les opérations avec la session ouverte dans Firefox, comme si tu
   cliquais toi-même, à un rythme humain (1,5 à 3 s entre deux actions). */
(() => {
  if (window.__silencioLb) return;
  window.__silencioLb = true;
  const B = globalThis.browser;
  // content.fetch : la requête part comme une requête de la page letterboxd.com (même origine, mêmes cookies)
  const F = (typeof content !== "undefined" && content.fetch) ? content.fetch.bind(content) : window.fetch.bind(window);
  let vitesse = 1;                         // 1 en vrai ; les tests accélèrent
  const pause = ms => new Promise(r => setTimeout(r, ms * vitesse));
  const hasard = (a, b) => a + Math.random() * (b - a);
  class Bloque extends Error {}

  let csrf = "", pseudo = "", cache = {}, adresses = {}, essais = {};
  const JOUR = 24 * 3600e3;

  function csrfDeLaPage() {
    const m = document.cookie.match(/com\.xk72\.webparts\.csrf=([^;]+)/);
    if (m) return decodeURIComponent(m[1]);
    const i = document.querySelector('input[name="__csrf"]');
    if (i) return i.value;
    const s = [...document.scripts].map(x => x.textContent).join("\n").match(/supermodelCSRF\s*=\s*['"]([^'"]+)/);
    return s ? s[1] : "";
  }

  function verifier(r) {
    if (r.status === 401) throw new Bloque("session Letterboxd expirée : reconnecte-toi sur letterboxd.com dans Firefox.");
    if (r.status === 403) throw new Bloque("Letterboxd refuse pour l'instant (403) : nouvel essai au prochain passage.");
    if (r.status === 429) throw new Bloque("Letterboxd demande de ralentir : nouvel essai au prochain passage.");
  }

  // ---- la fiche Letterboxd d'un film TMDB : /tmdb/<id>/ redirige vers /film/<slug>/
  async function film(tmdb) {
    if (cache[tmdb]) return cache[tmdb];
    const r = await F(`/tmdb/${tmdb}/`, { credentials: "include" });
    if (r.status === 404) return null;
    verifier(r);
    if (!r.ok) throw new Error(`fiche introuvable (${r.status})`);
    const m = new URL(r.url).pathname.match(/^\/film\/([^/]+)\//);
    const html = await r.text();
    if (/cf-chl|challenge-platform|Just a moment/i.test(html)) throw new Bloque("Letterboxd vérifie le navigateur (Cloudflare).");
    if (!m) return null;
    const doc = new DOMParser().parseFromString(html, "text/html");
    let lid = r.headers.get("x-letterboxd-identifier") || "", filmId = "";
    const el = doc.querySelector(`[data-film-slug="${m[1]}"], [data-item-slug="${m[1]}"], [data-film-id]`) ||
      doc.querySelector("[data-postered-identifier]");
    if (el) {
      filmId = el.getAttribute("data-film-id") || "";
      const porteur = el.hasAttribute("data-postered-identifier") ? el : doc.querySelector("[data-postered-identifier]");
      const pj = porteur?.getAttribute("data-postered-identifier");
      if (pj) {
        try {
          const j = JSON.parse(pj);
          lid = lid || j.lid || "";
          if (!filmId && j.uid) filmId = String(j.uid).split(":").pop();
        } catch { /* format inattendu */ }
      }
    }
    if (!filmId) {
      const mm = html.match(/data-film-id="(\d+)"/) || html.match(/&quot;uid&quot;:&quot;film:(\d+)/) || html.match(/"uid":"film:(\d+)"/);
      if (mm) filmId = mm[1];
    }
    // Letterboxd range aussi des téléfilms et mini-séries : on vérifie que c'est bien ce film TMDB
    if (/themoviedb\.org\/tv\//.test(html) && !/themoviedb\.org\/movie\//.test(html)) return null;
    const f = { slug: m[1], filmId, lid };
    cache[tmdb] = f;
    return f;
  }

  // ---- une action du site (formulaire) : réussie quand la réponse JSON contient "result": true
  async function action(chemin, champs, slug) {
    const corps = new URLSearchParams({ ...champs, __csrf: csrf });
    const r = await F(chemin, {
      method: "POST", credentials: "include", body: corps, referrer: `https://letterboxd.com/film/${slug}/`,
      headers: { "X-Requested-With": "XMLHttpRequest", "Accept": "application/json, text/javascript, */*; q=0.01" }
    });
    verifier(r);
    let j = null;
    try { j = await r.json(); } catch { /* pas du JSON */ }
    if (j && j.csrf) csrf = j.csrf;
    if (r.ok && j && j.result === true) return { ok: true, j };
    const messages = j && Array.isArray(j.messages) ? j.messages.join(" ") : "";
    return { ok: false, statut: r.status, message: messages || (j ? JSON.stringify(j).slice(0, 160) : `réponse ${r.status}`) };
  }

  // Plusieurs adresses possibles (le site change). Celle qui a marché est retenue et utilisée seule ensuite :
  // pas de rafale d'essais. Les autres ne sont essayées qu'une fois par jour au plus.
  async function essayer(sorte, variantes, slug) {
    const connue = adresses[sorte];
    if (connue != null && variantes[connue]) {
      const r = await action(variantes[connue][0], variantes[connue][1], slug);
      if (r.ok) return { etat: "ok" };
      if (r.statut && r.statut !== 404 && r.statut !== 405) return { etat: "echec", erreur: r.message };
    }
    if (Date.now() - (essais[sorte] || 0) < JOUR) return { etat: "echec", erreur: "adresse à retrouver : nouvel essai demain (ou calibre l'action avec l'enregistreur)" };
    essais[sorte] = Date.now();
    let dernier = null;
    for (let i = 0; i < variantes.length; i++) {
      if (i === connue) continue;
      const r = await action(variantes[i][0], variantes[i][1], slug);
      if (r.ok) { adresses[sorte] = i; return { etat: "ok" }; }
      dernier = r;
      await pause(hasard(2000, 4000));
    }
    return { etat: "echec", erreur: (dernier && dernier.message) || "adresse inconnue : calibre cette action avec l'enregistreur" };
  }

  // ---- journal : vérifie d'abord que ce visionnage n'y est pas déjà (PC et téléphone peuvent passer tous les deux)
  async function dejaAuJournal(f, date) {
    if (!pseudo) return false;
    const r = await F(`/${pseudo}/film/${f.slug}/diary/`, { credentials: "include" });
    if (r.status === 404) return false;
    verifier(r);
    if (!r.ok) throw new Error(`journal Letterboxd illisible (${r.status})`);
    const html = await r.text();
    const [a, m, j] = date.split("-");
    return new RegExp(`/for/${a}/${m}/${j}/`).test(html) || new RegExp(`${a}-${m}-${j}`).test(html.replace(/\s+/g, " ").match(/diary-table[\s\S]*$/)?.[0] || "");
  }

  async function journal(op, f) {
    const v = op.valeur || {}, x = op.extra || {};
    if (await dejaAuJournal(f, v.date)) return { etat: "deja" };
    const corps = { diaryDetails: { diaryDate: v.date, rewatch: !!v.rewatch }, tags: [], like: !!x.like };
    if (x.note) corps.rating = x.note;
    if (x.critique) corps.review = { text: x.critique, containsSpoilers: false };
    for (const [chemin, champ] of [["/api/v0/production-log-entries", "lid"], ["/api/v0/log-entries", "filmId"]]) {
      const b = { ...corps };
      if (champ === "lid" && f.lid) b.productionId = f.lid; else b.filmId = f.filmId;
      const r = await F(chemin, {
        method: "POST", credentials: "include", body: JSON.stringify(b), referrer: `https://letterboxd.com/film/${f.slug}/`,
        headers: { "Content-Type": "application/json", "Accept": "application/json", "X-Requested-With": "XMLHttpRequest", "X-CSRF-TOKEN": csrf }
      });
      if (r.status === 404) continue;
      verifier(r);
      if (r.ok) return { etat: "ok" };
      const t = await r.text().catch(() => "");
      return { etat: "echec", erreur: `journal : ${r.status} ${t.replace(/\s+/g, " ").slice(0, 150)}` };
    }
    return { etat: "echec", erreur: "adresse du journal introuvable : calibre l'action avec l'enregistreur" };
  }

  async function executer(ops, ctx, aBlanc) {
    vitesse = ctx.rapide ? 0.005 : 1;
    csrf = ctx.csrf || csrfDeLaPage();
    pseudo = ctx.pseudo || "";
    cache = ctx.cache || {};
    adresses = { ...(ctx.adresses || {}) };
    essais = { ...(ctx.essais || {}) };
    if (!aBlanc) await pause(hasard(2000, 6000));
    const resultats = [];
    let bloque = "";
    for (const op of ops) {
      const base = { id: op.id, cle: op.cle, action: op.action, valeur: op.valeur, titre: op.titre };
      try {
        if (op.sorte === "liste" || op.sorte === "item") {
          // listes : en attente de calibrage (l'adresse d'édition de liste n'est pas encore connue)
          resultats.push({ ...base, etat: "attente" });
          continue;
        }
        const f = op.tmdb ? await film(op.tmdb) : null;
        if (!f || !f.filmId) { resultats.push({ ...base, etat: "echec", erreur: "film introuvable sur Letterboxd" }); continue; }
        if (aBlanc) { resultats.push({ ...base, etat: "blanc", erreur: `/film/${f.slug}/` }); continue; }
        const poser = op.action === "poser";
        let r;
        if (op.sorte === "vu") r = await journal(op, f);
        else if (op.sorte === "note") r = await essayer("note", [[`/s/film:${f.filmId}/rate/`, { rating: poser ? String(Math.round(op.valeur * 2)) : "0" }]], f.slug);
        else if (op.sorte === "like") r = await essayer("like", [[`/s/film:${f.filmId}/like/`, { liked: String(poser) }], [`/film/${f.slug}/like/`, { liked: String(poser) }]], f.slug);
        else if (op.sorte === "wl") r = await essayer(poser ? "wl" : "wl-", poser
          ? [[`/film/${f.slug}/add-to-watchlist/`, {}], [`/s/film:${f.filmId}/watchlist/`, { watchlist: "true" }]]
          : [[`/film/${f.slug}/remove-from-watchlist/`, {}], [`/s/film:${f.filmId}/watchlist/`, { watchlist: "false" }]], f.slug);
        else if (op.sorte === "marque") r = await essayer("marque", [[`/s/film:${f.filmId}/watch/`, { watched: "true" }], [`/film/${f.slug}/mark-as-watched/`, {}]], f.slug);
        else r = { etat: "attente" };
        resultats.push({ ...base, ...r });
      } catch (e) {
        if (e instanceof Bloque) { bloque = e.message; break; }
        resultats.push({ ...base, etat: "echec", erreur: String(e.message || e).slice(0, 200) });
      }
      await pause(aBlanc ? 300 : hasard(5000, 13000));
    }
    return { resultats, cache, bloque, adresses, essais };
  }

  B.runtime.onMessage.addListener(m => {
    if (m && m.type === "silencio-executer") return executer(m.ops, m.ctx || {}, !!m.aBlanc);
  });
})();
