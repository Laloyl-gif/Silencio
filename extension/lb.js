/* Silencio Sync, côté letterboxd.com : exécute les opérations avec la session ouverte dans Firefox, comme si tu
   cliquais toi-même, à un rythme humain (1,5 à 3 s entre deux actions). */
(() => {
  if (window.__silencioLb) return;
  window.__silencioLb = true;
  const B = globalThis.browser;
  // Deux façons de tourner : dans l'extension elle-même (sans onglet : la session Letterboxd est jointe par
  // background.js), ou dans un onglet letterboxd.com (content.fetch : requête de la page, mêmes cookies).
  const FOND = location.protocol === "moz-extension:";
  const F = FOND
    ? (url, o = {}) => { const x = { ...o, credentials: "include" }; delete x.referrer; return fetch(/^https?:/.test(url) ? url : "https://letterboxd.com" + url, x); }
    : (typeof content !== "undefined" && content.fetch) ? content.fetch.bind(content) : window.fetch.bind(window);
  let vitesse = 1;                         // 1 en vrai ; les tests accélèrent
  const pause = ms => new Promise(r => setTimeout(r, ms * vitesse));
  const hasard = (a, b) => a + Math.random() * (b - a);
  // entre deux actions : 20 à 45 s, et environ une fois sur huit une « respiration » d'une à deux minutes
  const rythme = () => hasard(20000, 45000) + (Math.random() < 0.125 ? hasard(60000, 120000) : 0);
  class Bloque extends Error {}

  let csrf = "", pseudo = "", cache = {}, adresses = {}, essais = {};
  const JOUR = 24 * 3600e3;

  // Le jeton anti-falsification (CSRF) de Letterboxd : celui que la page elle-même utilise est le bon.
  const JETON = [/supermodelCSRF\s*=\s*['"]([^'"]+)/, /name="__csrf"\s+value="([^"]+)"/, /value="([^"]+)"\s+name="__csrf"/, /data-csrf="([^"]+)"/];
  function jetonDans(html) {
    for (const re of JETON) { const m = String(html || "").match(re); if (m) return m[1]; }
    return "";
  }
  function csrfDeLaPage() {
    if (FOND) return "";
    const i = document.querySelector('input[name="__csrf"]');
    if (i && i.value) return i.value;
    const s = jetonDans([...document.scripts].map(x => x.textContent).filter(t => !/silencio/i.test(t)).join("\n"));
    if (s) return s;
    const m = document.cookie.match(/com\.xk72\.webparts\.csrf=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : "";
  }
  // jeton refusé (« Invalid CSRF token », « The form on this page had expired ») : on relit une page et on le reprend
  const jetonPerime = t => /csrf|form on this page had expired|expired and could not be accepted/i.test(t || "");
  async function rafraichirCsrf(slug) {
    const r = await F(slug ? `/film/${slug}/` : "/", { credentials: "include" });
    const t = jetonDans(await r.text().catch(() => ""));
    if (t) csrf = t;
    return !!t;
  }

  // Une vraie page de vérification anti-robot : titre « Just a moment… » ou formulaire de défi. Les pages normales de
  // Letterboxd chargent souvent un script /cdn-cgi/challenge-platform/ : ce n'est PAS un blocage.
  const defiCloudflare = html => /<title>\s*Just a moment|id="challenge-form"|cf-chl-widget|cf_chl_opt/i.test(String(html || "").slice(0, 60000));

  function verifier(r, action) {
    if (r.status === 401) throw new Bloque("session Letterboxd expirée : reconnecte-toi sur letterboxd.com dans Firefox.");
    if (r.status === 403 && !action) throw new Bloque("Letterboxd refuse pour l'instant (403) : nouvel essai au prochain passage.");
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
    if (defiCloudflare(html)) throw new Bloque("Letterboxd vérifie le navigateur (Cloudflare).");
    const jeton = jetonDans(html); if (jeton) csrf = jeton;
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
    const nm = html.match(/"ratingValue"\s*:\s*([0-9.]+)/) || html.match(/twitter:data2" content="([0-9.]+) out of 5/);
    const f = { slug: m[1], filmId, lid, ...(nm ? { note: +nm[1] } : {}) };
    cache[tmdb] = f;
    return f;
  }

  // ---- une action du site (formulaire) : réussie quand la réponse JSON contient "result": true
  async function action(chemin, champs, slug) {
    let r = await actionUneFois(chemin, champs, slug);
    if (!r.ok && jetonPerime(r.message) && await rafraichirCsrf(slug)) r = await actionUneFois(chemin, champs, slug);
    return r;
  }
  async function actionUneFois(chemin, champs, slug) {
    const corps = new URLSearchParams({ ...champs, __csrf: csrf });
    const r = await F(chemin, {
      method: "POST", credentials: "include", body: corps, referrer: `https://letterboxd.com/film/${slug}/`,
      headers: { "X-Requested-With": "XMLHttpRequest", "Accept": "application/json, text/javascript, */*; q=0.01" }
    });
    verifier(r, true);
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
      if (r.statut && ![403, 404, 405].includes(r.statut)) return { etat: "echec", erreur: r.message };
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

  // ---- ton journal Letterboxd pour un film (page /<pseudo>/film/<slug>/diary/) : dates et identifiants des entrées
  async function entreesLb(f) {
    if (!pseudo) return null;
    const r = await F(`/${pseudo}/film/${f.slug}/diary/`, { credentials: "include" });
    if (r.status === 404) return [];
    verifier(r);
    if (!r.ok) throw new Error(`journal Letterboxd illisible (${r.status})`);
    const html = await r.text();
    const liste = [];
    for (const bloc of html.split(/diary-entry-row/).slice(1)) {
      const d = bloc.match(/data-viewing-date="(\d{4}-\d{2}-\d{2})"/) || bloc.match(/\/for\/(\d{4})\/(\d{2})\/(\d{2})\//);
      const date = d ? (d.length === 2 ? d[1] : `${d[1]}-${d[2]}-${d[3]}`) : "";
      const id = (bloc.match(/data-(?:viewing-id|log-entry-id|object-id|lid)="([^"]+)"/i) || bloc.match(/viewing:(\w+)/) || [])[1] || "";
      if (date || id) liste.push({ date, id });
    }
    if (!liste.length) {                       // autre présentation : seulement les liens de dates
      for (const m of html.matchAll(/\/for\/(\d{4})\/(\d{2})\/(\d{2})\//g)) liste.push({ date: `${m[1]}-${m[2]}-${m[3]}`, id: "" });
    }
    return liste;
  }
  async function dejaAuJournal(f, date) {
    const l = await entreesLb(f);
    return !!(l && l.some(e => e.date === date));
  }
  async function trouverEntree(f, date) {
    const l = await entreesLb(f);
    const e = l && l.find(x => x.date === date);
    return e ? e.id : "";
  }

  const ENTETES_JSON = () => ({ "Content-Type": "application/json", "Accept": "application/json", "X-Requested-With": "XMLHttpRequest", "X-CSRF-TOKEN": csrf });
  const ADRESSES_JOURNAL = [["/api/v0/production-log-entries", "lid"], ["/api/v0/log-entries", "filmId"]];

  function corpsJournal(op) {
    const v = op.valeur || {}, x = op.extra || {};
    const note = v.note != null ? v.note : x.note, like = v.like != null ? v.like : x.like;
    const critique = v.critique != null ? v.critique : x.critique;
    const corps = { diaryDetails: { diaryDate: v.date, rewatch: !!v.rewatch }, tags: [], like: !!like };
    corps.rating = note || null;
    if (critique) corps.review = { text: critique, containsSpoilers: false };
    return corps;
  }

  async function envoyerJson(methode, chemin, corps, slug) {
    const une = () => F(chemin, {
      method: methode, credentials: "include", body: corps ? JSON.stringify(corps) : undefined,
      referrer: `https://letterboxd.com/film/${slug}/`, headers: ENTETES_JSON()
    });
    let r = await une();
    if ((r.status === 403 || r.status === 400) && jetonPerime(await r.clone().text().catch(() => "")) && await rafraichirCsrf(slug)) r = await une();
    return r;
  }

  const idDe = j => j && (j.id || j.lid || (j.data && (j.data.id || j.data.lid)) || (j.logEntry && (j.logEntry.id || j.logEntry.lid)) ||
    (j.entry && (j.entry.id || j.entry.lid)) || (j.viewing && (j.viewing.id || j.viewing.lid))) || "";

  // créer une entrée (puis garder son identifiant pour la modifier ou la supprimer plus tard)
  async function journal(op, f) {
    const v = op.valeur || {};
    if (op.ref || (op.avant && op.avant.date)) return modifierJournal(op, f);
    const deja = await entreesLb(f);
    const meme = deja && deja.find(e => e.date === v.date);
    if (meme) return { etat: "deja", ref: meme.id || undefined };
    // jamais de doublon : si Letterboxd a déjà autant d'entrées pour ce film que Silencio, on n'en ajoute pas
    if (deja && deja.length >= (op.nb || 1)) return { etat: "deja", ref: deja.length === 1 && deja[0].id ? deja[0].id : undefined };
    const corps = corpsJournal(op);
    if (!corps.rating) delete corps.rating;
    for (const [chemin, champ] of ADRESSES_JOURNAL) {
      const b = { ...corps };
      if (champ === "lid" && f.lid) b.productionId = f.lid; else b.filmId = f.filmId;
      const r = await envoyerJson("POST", chemin, b, f.slug);
      if (r.status === 404) continue;
      verifier(r, true);
      if (r.ok) {
        let j = null;
        try { j = await r.json(); } catch { /* réponse vide */ }
        const ref = idDe(j) || await trouverEntree(f, v.date);
        return { etat: "ok", ref: ref ? String(ref) : undefined };
      }
      const t = await r.text().catch(() => "");
      return { etat: "echec", erreur: `journal : ${r.status} ${t.replace(/\s+/g, " ").slice(0, 150)}` };
    }
    return { etat: "echec", erreur: "adresse du journal introuvable : calibre l'action avec l'enregistreur" };
  }

  // modifier une entrée existante (date, note, like, critique, revisionnage)
  async function modifierJournal(op, f) {
    let ref = op.ref;
    if (!ref) {
      const l = await entreesLb(f) || [];
      const e = l.find(x => x.date === (op.avant && op.avant.date)) || l.find(x => x.date === (op.valeur || {}).date) || (l.length === 1 ? l[0] : null);
      ref = e && e.id;
      if (!ref) {
        // entrée introuvable : on n'en crée pas une deuxième ; si Letterboxd n'en a aucune, on la crée
        if (l.length >= (op.nb || 1)) return { etat: "manuel", erreur: "entrée du journal introuvable : modifie-la toi-même", lien: `https://letterboxd.com/${pseudo}/film/${f.slug}/diary/` };
        return journal({ ...op, ref: undefined, avant: undefined }, f);
      }
    }
    const corps = corpsJournal(op);
    const variantes = ADRESSES_JOURNAL.flatMap(([c]) => [["PATCH", `${c}/${ref}`], ["PUT", `${c}/${ref}`]]);
    let r = await essayerJson("journal-modifier", variantes, corps, f.slug);
    if (r.etat !== "ok") r = await formulaireJournal("modifier", op, f, ref) || r;
    return r.etat === "ok" ? { etat: "ok", ref } : r;
  }

  async function supprimerJournal(op, f) {
    const ref = op.ref || await trouverEntree(f, op.avant && op.avant.date);
    if (!ref) return { etat: "deja" };                 // déjà absente du journal Letterboxd
    const variantes = ADRESSES_JOURNAL.map(([c]) => ["DELETE", `${c}/${ref}`]);
    let r = await essayerJson("journal-supprimer", variantes, null, f.slug, true);
    // refusé (403) : l'identifiant gardé n'est peut-être plus le bon ; on relit ton journal Letterboxd pour ce film
    if (r.etat === "echec" && /\b403\b/.test(r.erreur || "") && op.ref) {
      const l = await entreesLb(f).catch(() => null);
      if (l) {
        const e = l.find(x => x.date === (op.avant && op.avant.date));
        if (!e) return { etat: "deja" };               // plus dans ton journal Letterboxd : rien à supprimer
        if (e.id && e.id !== op.ref) r = await essayerJson("journal-supprimer", ADRESSES_JOURNAL.map(([c]) => ["DELETE", `${c}/${e.id}`]), null, f.slug, true);
      }
    }
    if (r.etat === "echec") r = await formulaireJournal("supprimer", op, f, ref) || r;
    // on vérifie sur ton journal Letterboxd que l'entrée est vraiment partie (une réponse « introuvable » peut mentir)
    if (["ok", "deja"].includes(r.etat) && op.avant && op.avant.date) {
      const l = await entreesLb(f).catch(() => null);
      if (l && l.some(x => x.date === op.avant.date && (!x.id || !ref || x.id === ref || l.filter(y => y.date === op.avant.date).length === 1)))
        return { etat: "echec", erreur: `journal : l'entrée du ${op.avant.date} est toujours sur Letterboxd (${CALIBRER})` };
    }
    return r;
  }

  // Ancienne voie du site (formulaires /s/…), essayée quand l'API refuse ; la bonne adresse est retenue.
  const CALIBRER = "adresse à calibrer : fenêtre de l'extension → Enregistreur → Démarrer, puis modifie et supprime une entrée de ton journal sur letterboxd.com, et envoie le rapport à Claude";
  async function formulaireJournal(quoi, op, f, ref) {
    if (!ref) return null;
    const v = op.valeur || {}, x = op.extra || {};
    const note = v.note != null ? v.note : x.note;
    const champs = quoi === "supprimer" ? { viewingId: ref, logEntryId: ref } : {
      viewingId: ref, logEntryId: ref, filmId: f.filmId, specifiedDate: "true", viewingDateStr: v.date || "",
      review: (v.critique != null ? v.critique : x.critique) || "", tags: "", rating: note ? String(Math.round(note * 2)) : "0",
      liked: String(!!(v.like != null ? v.like : x.like)), rewatch: String(!!v.rewatch), containsSpoilers: "false" };
    const r = await essayer(quoi === "supprimer" ? "journal-supprimer-form" : "journal-modifier-form", quoi === "supprimer"
      ? [["/s/delete-diary-entry", champs], [`/s/viewing:${ref}/delete/`, champs], [`/s/log-entry:${ref}/delete/`, champs]]
      : [["/s/save-diary-entry", champs], [`/s/viewing:${ref}/save/`, champs]], f.slug);
    if (r.etat === "ok") return r;
    return { etat: "echec", erreur: `${quoi === "supprimer" ? "suppression" : "modification"} du journal refusée par Letterboxd (${CALIBRER})` };
  }

  // comme essayer(), pour les adresses JSON : celle qui marche est retenue
  async function essayerJson(sorte, variantes, corps, slug, absentOk) {
    const ordre = adresses[sorte] != null ? [adresses[sorte], ...variantes.keys()].filter((x, i, t) => t.indexOf(x) === i) : [...variantes.keys()];
    const explorer = adresses[sorte] == null || Date.now() - (essais[sorte] || 0) > JOUR;
    let dernier = "";
    for (const i of explorer ? ordre : ordre.slice(0, 1)) {
      const [m, chemin] = variantes[i];
      const r = await envoyerJson(m, chemin, corps, slug);
      verifier(r, true);
      if (r.ok) { adresses[sorte] = i; return { etat: "ok" }; }
      if (r.status === 404 && absentOk && adresses[sorte] === i) return { etat: "deja" };
      dernier = `${r.status} ${(await r.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 120)}`;
      if (![403, 404, 405].includes(r.status)) break;
      await pause(hasard(1500, 3000));
    }
    if (explorer) essais[sorte] = Date.now();
    return { etat: "echec", erreur: `journal : ${dernier || "adresse inconnue"} (calibre l'action avec l'enregistreur)` };
  }

  async function executer(ops, ctx, aBlanc) {
    vitesse = ctx.vitesse || (ctx.rapide ? 0.005 : 1);
    csrf = csrfDeLaPage() || ctx.csrf;
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
        if (op.sorte === "vu") r = poser ? await journal(op, f) : await supprimerJournal(op, f);
        else if (op.sorte === "note") r = await essayer("note", [[`/s/film:${f.filmId}/rate/`, { rating: poser ? String(Math.round(op.valeur * 2)) : "0" }]], f.slug);
        else if (op.sorte === "like") r = await essayer("like", [[`/s/film:${f.filmId}/like/`, { liked: String(poser) }], [`/film/${f.slug}/like/`, { liked: String(poser) }]], f.slug);
        else if (op.sorte === "wl") r = await essayer(poser ? "wl" : "wl-", poser
          ? [[`/film/${f.slug}/add-to-watchlist/`, {}], [`/s/film:${f.filmId}/watchlist/`, { watchlist: "true" }]]
          : [[`/film/${f.slug}/remove-from-watchlist/`, {}], [`/s/film:${f.filmId}/watchlist/`, { watchlist: "false" }]], f.slug);
        else if (op.sorte === "marque") r = await essayer(poser ? "marque" : "marque-", poser
          ? [[`/s/film:${f.filmId}/watch/`, { watched: "true" }], [`/film/${f.slug}/mark-as-watched/`, {}]]
          : [[`/s/film:${f.filmId}/watch/`, { watched: "false" }], [`/film/${f.slug}/mark-as-not-watched/`, {}]], f.slug);
        else r = { etat: "attente" };
        resultats.push({ ...base, ...r });
      } catch (e) {
        if (e instanceof Bloque) { bloque = e.message; break; }
        resultats.push({ ...base, etat: "echec", erreur: String(e.message || e).slice(0, 200) });
      }
      await pause(aBlanc ? 300 : rythme());
    }
    return { resultats, cache, bloque, adresses, essais };
  }

  // ---- test de la synchro (Réglages de Silencio, « Tester la synchro ») : lectures, puis, en test complet,
  // chaque écriture faite puis défaite sur un film témoin absent de ton profil
  async function diagnostic(ctx, t, complet) {
    const etapes = [];
    const E = (etat, texte, detail = "") => etapes.push({ etat, texte, detail: String(detail || "").slice(0, 300) });
    pseudo = ctx.pseudo || ""; csrf = csrfDeLaPage() || ctx.csrf || ""; cache = {};
    adresses = { ...(ctx.adresses || {}) }; essais = {};
    if (!FOND) {
      if (defiCloudflare(document.documentElement.outerHTML)) E("erreur", "La page Letterboxd est bloquée par Cloudflare", "ouvre letterboxd.com dans Firefox et passe la vérification");
      const moi = `/${pseudo.toLowerCase()}/`;
      const lien = pseudo && ([...document.querySelectorAll("a[href]")].some(a => { try { return a.hostname.endsWith("letterboxd.com") && a.pathname.toLowerCase() === moi; } catch { return false; } })
        || new RegExp(`["'/]${pseudo.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'/]`, "i").test(document.documentElement.outerHTML.slice(0, 200000)));
      const connexion = document.querySelector('a[href="/sign-in/"], a[href*="/sign-in"], a[href*="signin"]');
      if (lien) E("ok", `Connecté à Letterboxd en tant que ${pseudo}`);
      else if (connexion) E("erreur", "Pas connecté à Letterboxd dans Firefox", "ouvre letterboxd.com et connecte-toi (coche « rester connecté »)");
      else E("attention", "Connexion Letterboxd non vérifiable sur cette page", `${location.pathname}${pseudo ? ` : aucun lien vers /${pseudo}/` : ""}`);
    }
    E(csrf ? "ok" : "erreur", csrf ? "Jeton anti-falsification (CSRF) trouvé" : "Jeton anti-falsification (CSRF) introuvable", FOND ? "sans onglet" : `page ${location.pathname}`);
    if (!t) return { etapes };
    let f;
    try { f = await film(t.tmdb); } catch (e) {
      E("erreur", "Fiche du film témoin", e.message);
      return { etapes, bloque: e instanceof Bloque ? e.message : "" };
    }
    if (!f || !f.filmId) { E("erreur", "Fiche du film témoin introuvable", f ? `/film/${f.slug}/ sans identifiant de film` : `tmdb ${t.tmdb}`); return { etapes }; }
    E("ok", "Recherche d'un film (TMDB → Letterboxd)", `/film/${f.slug}/, id ${f.filmId}${f.lid ? `, lid ${f.lid}` : ""}${f.note ? `, note moyenne ${f.note}` : ", pas de note moyenne lue"}`);
    let entrees = null;
    if (!pseudo) E("erreur", "Lecture du journal impossible : pseudo Letterboxd absent dans Silencio");
    else {
      try { entrees = await entreesLb(f); E("ok", "Lecture de ton journal Letterboxd", `${entrees.length} entrée(s) pour ce film`); }
      catch (e) { E("erreur", "Lecture de ton journal Letterboxd", e.message); }
    }
    if (!complet) return { etapes, adresses };
    const base = { id: "diag", tmdb: t.tmdb, imdb: t.imdb, titre: t.titre, type: "m" };
    let stop = "";
    const faire = async (texte, op) => {
      if (stop) { E("saute", texte, "test arrêté : " + stop); return null; }
      const r = await executer([{ ...base, ...op }], { ...ctx, csrf, cache, adresses, essais, vitesse: 0.12 }, false);
      cache = r.cache || cache; adresses = r.adresses || adresses; essais = r.essais || essais;
      if (r.bloque) { stop = r.bloque; E("erreur", texte, r.bloque); return null; }
      const x = (r.resultats || [])[0] || {};
      E(["ok", "deja"].includes(x.etat) ? "ok" : x.etat === "manuel" ? "attention" : "erreur", texte,
        x.etat === "deja" ? "déjà dans cet état" : (x.erreur || (x.ref ? `entrée ${x.ref}` : "")));
      return x;
    };
    const ok = x => x && ["ok", "deja"].includes(x.etat);
    const c = t.cle;
    if (ok(await faire("Watchlist : ajout", { cle: `wl|${c}`, sorte: "wl", action: "poser", valeur: 1 })))
      await faire("Watchlist : retrait", { cle: `wl|${c}`, sorte: "wl", action: "retirer", valeur: null });
    const note = await faire("Note : envoi (3,5 étoiles)", { cle: `note|${c}`, sorte: "note", action: "poser", valeur: 3.5 });
    if (ok(await faire("Coup de cœur : ajout", { cle: `like|${c}`, sorte: "like", action: "poser", valeur: 1 })))
      await faire("Coup de cœur : retrait", { cle: `like|${c}`, sorte: "like", action: "retirer", valeur: null });
    if (ok(note)) await faire("Note : retrait", { cle: `note|${c}`, sorte: "note", action: "retirer", valeur: null });
    // journal : il faut un film absent de ton journal Letterboxd ; sinon on essaie les autres films témoins
    let fj = f;
    if (pseudo && entrees && entrees.length) {
      fj = null;
      for (const autre of t.autres || []) {
        try {
          const g = await film(autre.tmdb);
          if (!g || !g.filmId) continue;
          const l = await entreesLb(g);
          if (l && !l.length) { fj = g; E("info", "Journal : film témoin de remplacement (le premier est déjà dans ton journal)", `/film/${g.slug}/`); break; }
        } catch { /* suivant */ }
      }
    }
    if (!fj) E("saute", "Journal : tous les films témoins sont déjà dans ton journal Letterboxd, test sauté pour ne rien perdre");
    else if (!pseudo) E("saute", "Journal : pseudo Letterboxd absent, test sauté");
    else {
      const jour = new Date().toISOString().slice(0, 10);
      const v = { date: jour, rewatch: false, note: null, like: false, critique: "" };
      const bj = fj === f ? {} : { tmdb: Object.keys(cache).find(k => cache[k] === fj) };
      const cj = fj === f ? c : `m:${bj.tmdb}`;
      const cree = await faire("Journal : entrée créée (aujourd'hui)", { ...bj, cle: "vu|diag", sorte: "vu", action: "poser", valeur: v, extra: {}, nb: 1 });
      if (ok(cree)) {
        const ref = cree.ref;
        if (!ref) E("attention", "Journal : identifiant de l'entrée non renvoyé par Letterboxd", "retrouvée ensuite par sa date");
        await faire("Journal : entrée modifiée (note 3 étoiles)", { ...bj, cle: "vu|diag", sorte: "vu", action: "poser", valeur: { ...v, note: 3 }, ref, avant: v, nb: 1 });
        await faire("Journal : entrée supprimée", { ...bj, cle: "vu|diag", sorte: "vu", action: "retirer", valeur: null, ref, avant: v });
        const reste = await entreesLb(fj).catch(() => null);
        if (reste) E(reste.length ? "erreur" : "ok", "Journal : vérification après suppression", reste.length ? `${reste.length} entrée(s) encore là : supprime-la à la main sur /${pseudo}/film/${fj.slug}/diary/` : "plus aucune entrée");
        await faire("Note : retrait (laissée par l'entrée)", { ...bj, cle: `note|${cj}`, sorte: "note", action: "retirer", valeur: null });
      }
      await faire("Vu : marque retirée (nettoyage)", { ...bj, cle: `marque|${cj}`, sorte: "marque", action: "retirer", valeur: null });
    }
    return { etapes, adresses };
  }

  if (FOND) (globalThis.__silencioExec ||= {}).lb = executer;
  else B.runtime.onMessage.addListener(m => {
    if (m && m.type === "silencio-executer") return executer(m.ops, m.ctx || {}, !!m.aBlanc);
    if (m && m.type === "silencio-diagnostic") return diagnostic(m.ctx || {}, m.temoin, !!m.complet).catch(e => ({ etapes: [{ etat: "erreur", texte: "Le test Letterboxd a planté", detail: String(e && e.message || e) }] }));
  });
})();
