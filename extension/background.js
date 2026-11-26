/* Silencio Sync : demande à Silencio ce qui a changé, puis le recopie sur Letterboxd et IMDb avec tes sessions
   Firefox déjà ouvertes. Rien ne part vers un autre serveur que Silencio (chez toi), Letterboxd et IMDb. */
"use strict";
const B = globalThis.browser;
const NOM = { lb: "Letterboxd", imdb: "IMDb" };
const SITE = { lb: "https://letterboxd.com/", imdb: "https://www.imdb.com/" };
const SCRIPT = { lb: "lb.js", imdb: "im.js" };
const DEFAUT = {
  adresse: "http://127.0.0.1:8642", jeton: "", actif: true, intervalle: 15,
  cacheLb: {}, journal: [], manuels: [], enregistrements: [], enregistreurJusqua: 0, dernier: null,
  // discrétion : pauses après un refus, quota par jour, onglets ouverts rarement, adresses qui marchent
  pauses: {}, quota: {}, dernierOnglet: {}, adresses: {}, essais: {}, prochain: 0,
  sites: { lb: true, imdb: true }
};
const QUOTA_JOUR = 40;                       // actions par site et par jour, au plus
const hasard = (a, b) => a + Math.random() * (b - a);
const aujourdhui = () => new Date().toISOString().slice(0, 10);

const cfg = () => B.storage.local.get(DEFAUT);
const poser = o => B.storage.local.set(o);
async function noter(texte, niveau = "info") {
  const { journal } = await cfg();
  journal.unshift({ t: Date.now(), texte, niveau });
  await poser({ journal: journal.slice(0, 150) });
}

class Refus extends Error {}

async function silencio(chemin, options = {}) {
  const c = await cfg();
  let r;
  try {
    r = await fetch(c.adresse.replace(/\/+$/, "") + chemin, {
      ...options, headers: { "X-Silencio-Jeton": c.jeton, "Content-Type": "application/json", ...(options.headers || {}) }
    });
  } catch (e) {
    throw new Refus(`Silencio injoignable à ${c.adresse}. Sur PC : lance Silencio. Sur téléphone : ouvre l'appli Silencio.`);
  }
  if (r.status === 403) throw new Refus("Code d'appairage refusé : recopie-le depuis Silencio (Réglages, Letterboxd IMDb Refract).");
  if (!r.ok) throw new Refus(`Silencio a répondu ${r.status}.`);
  return r.json();
}

// ---------------------------------------------------------------- onglets
function attendreChargement(id, max = 45000) {
  return new Promise(ok => {
    let fini = false;
    const finir = () => { if (fini) return; fini = true; clearTimeout(minuteur); B.tabs.onUpdated.removeListener(ecoute); ok(); };
    const minuteur = setTimeout(finir, max);
    const ecoute = (tid, info) => { if (tid === id && info.status === "complete") finir(); };
    B.tabs.onUpdated.addListener(ecoute);
    B.tabs.get(id).then(t => { if (t.status === "complete") finir(); }).catch(finir);
  });
}

// Le plus discret : profiter d'un onglet du site que tu as déjà ouvert. Sinon, un onglet en arrière-plan,
// au plus toutes les 2 à 4 heures (ou tout de suite si tu as cliqué « Synchroniser »).
async function ongletPour(p, motif) {
  const ouverts = await B.tabs.query({ url: p === "lb" ? "https://letterboxd.com/*" : "https://www.imdb.com/*" });
  const pret = ouverts.find(t => t.status === "complete" && !t.discarded);
  if (pret) return { id: pret.id, cree: false };
  const c = await cfg();
  if (motif !== "bouton" && Date.now() - (c.dernierOnglet[p] || 0) < hasard(2, 4) * 3600e3) return null;
  const t = await B.tabs.create({ url: SITE[p], active: false });
  await attendreChargement(t.id);
  await poser({ dernierOnglet: { ...c.dernierOnglet, [p]: Date.now() } });
  return { id: t.id, cree: true };
}

// ---------------------------------------------------------------- contexte de chaque site
async function contexte(p, r, c) {
  if (p === "lb") {
    const csrf = await B.cookies.get({ url: "https://letterboxd.com/", name: "com.xk72.webparts.csrf" }).catch(() => null);
    const tous = await B.cookies.getAll({ domain: "letterboxd.com" }).catch(() => []);
    // les noms des cookies de session ne sont pas publics : on vérifie seulement que le site a déjà été ouvert ;
    // une session expirée est repérée à la première réponse refusée
    const connecte = tous.length > 0;
    return { csrf: csrf?.value || "", pseudo: r.pseudo || "", cache: c.cacheLb || {}, connecte };
  }
  const tous = await B.cookies.getAll({ domain: "imdb.com" }).catch(() => []);
  const session = tous.find(k => k.name === "session-id")?.value || "";
  const connecte = tous.length > 0;
  return { session, connecte, favoris: r.favoris || "" };
}

// ---------------------------------------------------------------- une plateforme
async function plateforme(p, aBlanc, motif) {
  const c = await cfg();
  if ((c.pauses[p] || 0) > Date.now() && motif !== "bouton") return { pause: c.pauses[p] };
  const q = c.quota[p] && c.quota[p].jour === aujourdhui() ? c.quota[p].n : 0;
  const reste = QUOTA_JOUR - q;
  if (reste <= 0 && !aBlanc) return { quota: true };
  // quelques actions à la fois seulement, jamais le même nombre
  const n = aBlanc ? 40 : Math.max(1, Math.min(reste, Math.round(hasard(3, 6))));
  const r = await silencio(`/api/ext/ops?p=${p}&n=${n}`);
  if (!r.ops.length) return { rien: true, attente: r.en_attente || 0 };
  if (p === "lb" && !r.pseudo) {
    await noter("Letterboxd : indique ton pseudo Letterboxd dans Silencio (Réglages, Letterboxd IMDb Refract).", "attente");
    return { bloque: "pseudo" };
  }
  const ctx = await contexte(p, r, c);
  if (!ctx.connecte) {
    await noter(`${NOM[p]} : tu n'es pas connecté dans Firefox. Ouvre ${SITE[p]} et connecte-toi une fois (coche « rester connecté »).`, "erreur");
    return { bloque: "connexion" };
  }
  const onglet = await ongletPour(p, motif);
  if (!onglet) return { attend: true, en_attente: r.ops.length };
  ctx.adresses = c.adresses[p] || {};
  ctx.essais = c.essais[p] || {};
  try {
    await B.scripting.executeScript({ target: { tabId: onglet.id }, files: [SCRIPT[p]] });
    const rep = await B.tabs.sendMessage(onglet.id, { type: "silencio-executer", ops: r.ops, ctx, aBlanc });
    if (!rep) throw new Error("le script n'a pas répondu");
    const c2 = await cfg();
    const maj = { adresses: { ...c2.adresses, [p]: rep.adresses || ctx.adresses }, essais: { ...c2.essais, [p]: rep.essais || ctx.essais } };
    if (p === "lb" && rep.cache) maj.cacheLb = { ...c2.cacheLb, ...rep.cache };
    const faites = (rep.resultats || []).filter(x => ["ok", "deja", "echec"].includes(x.etat)).length;
    if (!aBlanc) maj.quota = { ...c2.quota, [p]: { jour: aujourdhui(), n: q + faites } };
    if (rep.bloque) maj.pauses = { ...c2.pauses, [p]: Date.now() + hasard(12, 24) * 3600e3 };
    await poser(maj);
    const resultats = (rep.resultats || []).filter(x => x.etat !== "attente" && x.etat !== "blanc");
    const manuels = resultats.filter(x => x.etat === "manuel" && x.lien);
    if (manuels.length) {
      const { manuels: liste } = await cfg();
      const ids = new Set(liste.map(m => m.id));
      await poser({ manuels: [...liste, ...manuels.filter(m => !ids.has(m.id)).map(m => ({ ...m, plateforme: p, t: Date.now() }))].slice(-60) });
    }
    if (!aBlanc && resultats.length) await silencio("/api/ext/resultats", { method: "POST", body: JSON.stringify({ plateforme: p, resultats }) });
    const n = k => resultats.filter(x => x.etat === k).length;
    if (aBlanc) {
      const trouves = (rep.resultats || []).filter(x => x.etat === "blanc").length;
      await noter(`${NOM[p]} (test à blanc) : ${r.ops.length} opération(s) en attente, ${trouves} film(s) reconnu(s), rien n'a été envoyé.`);
    } else {
      await noter(`${NOM[p]} : ${n("ok") + n("deja")} fait(s), ${n("echec")} échec(s), ${n("manuel")} à faire à la main${r.reste ? `, ${r.reste} au prochain passage` : ""}.`, n("echec") ? "erreur" : "info");
    }
    for (const x of resultats.filter(x => x.etat === "echec").slice(0, 5)) await noter(`${NOM[p]}, ${x.titre || x.cle} : ${x.erreur}`, "erreur");
    if (rep.bloque) await noter(`${NOM[p]} : ${rep.bloque} Pause de quelques heures.`, "erreur");
    return { fait: n("ok") + n("deja"), echecs: n("echec"), manuels: n("manuel"), bloque: rep.bloque || "" };
  } finally {
    if (onglet.cree) B.tabs.remove(onglet.id).catch(() => {});
  }
}

let enCours = false;
async function synchroniser(motif, aBlanc = false) {
  if (enCours) return { occupe: true };
  const c = await cfg();
  if (!c.actif && motif !== "bouton") return { inactif: true };
  if (!c.jeton) { await noter("Colle d'abord le code d'appairage affiché dans Silencio.", "attente"); return { jeton: false }; }
  enCours = true;
  const bilan = {};
  try {
    await silencio("/api/ext/bonjour");
    for (const p of ["lb", "imdb"]) {
      if (c.sites && c.sites[p] === false) { bilan[p] = { coupe: true }; continue; }
      try { bilan[p] = await plateforme(p, aBlanc, motif); } catch (e) {
        bilan[p] = { erreur: e.message };
        await noter(`${NOM[p]} : ${e.message}`, "erreur");
      }
    }
  } catch (e) {
    bilan.silencio = e.message;
    await noter(e.message, "attente");
  } finally {
    enCours = false;
    await poser({ dernier: { quand: Date.now(), motif, bilan, aBlanc } });
  }
  return bilan;
}

// ---------------------------------------------------------------- calendrier : au démarrage de Firefox, puis à intervalles
// irréguliers (jamais à heure fixe) tant qu'il est ouvert
async function planifier(minutes) {
  const c = await cfg();
  const base = Math.max(8, +c.intervalle || 15);
  const delai = minutes ?? hasard(base * 0.7, base * 1.5);
  await B.alarms.clear("silencio");
  B.alarms.create("silencio", { delayInMinutes: delai });
  await poser({ prochain: Date.now() + delai * 60000 });
}
B.runtime.onInstalled.addListener(async d => {
  await planifier(hasard(1, 3));
  if (d.reason === "install") B.runtime.openOptionsPage().catch(() => {});
});
B.runtime.onStartup.addListener(() => planifier(hasard(1, 4)));
B.alarms.onAlarm.addListener(async a => {
  if (a.name !== "silencio") return;
  try { await synchroniser("minuteur"); } finally { await planifier(); }
});

// ---------------------------------------------------------------- enregistreur : pour calibrer une action inconnue
function masquer(v) {
  const s = String(v ?? "");
  return s.length > 80 ? s.slice(0, 40) + "…(" + s.length + ")" : s;
}
function nettoyerJson(o, profondeur = 0) {
  if (profondeur > 4 || o == null) return o;
  if (Array.isArray(o)) return o.slice(0, 5).map(x => nettoyerJson(x, profondeur + 1));
  if (typeof o === "object") return Object.fromEntries(Object.entries(o).map(([k, v]) =>
    [k, /csrf|token|password|cookie/i.test(k) ? "•" : k === "query" ? String(v).slice(0, 700) : nettoyerJson(v, profondeur + 1)]));
  return typeof o === "string" ? masquer(o) : o;
}
B.webRequest.onBeforeRequest.addListener(details => {
  if (details.method === "GET" || enCours) return;
  cfg().then(c => {
    if (Date.now() > c.enregistreurJusqua) return;
    const e = { t: Date.now(), methode: details.method, url: details.url.replace(/^https:\/\//, "") };
    const rb = details.requestBody;
    if (rb?.formData) e.formulaire = Object.fromEntries(Object.entries(rb.formData).map(([k, v]) => [k, /csrf|token|password/i.test(k) ? "•" : masquer(v[0])]));
    else if (rb?.raw?.[0]?.bytes) {
      const texte = new TextDecoder().decode(rb.raw[0].bytes);
      try { e.json = nettoyerJson(JSON.parse(texte)); } catch { e.texte = masquer(texte); }
    }
    if (/\/(ajax|api|s|graphql)|graphql|watchlist|list|rate|like|diary|log/i.test(e.url) || e.formulaire || e.json)
      poser({ enregistrements: [...c.enregistrements, e].slice(-40) });
  });
}, { urls: ["https://letterboxd.com/*", "https://*.imdb.com/*", "https://api.graphql.imdb.com/*"] }, ["requestBody"]);

// ---------------------------------------------------------------- la fenêtre de l'extension
B.runtime.onMessage.addListener(async m => {
  if (m?.type === "etat") return { ...(await cfg()), enCours };
  if (m?.type === "reglages") { await poser(m.valeurs); await planifier(); return { ok: true }; }
  if (m?.type === "synchroniser") return synchroniser("bouton", !!m.aBlanc);
  if (m?.type === "tester") {
    try { const b = await silencio("/api/ext/bonjour"); return { ok: true, ...b }; } catch (e) { return { ok: false, erreur: e.message }; }
  }
  if (m?.type === "enregistrer") { await poser({ enregistreurJusqua: Date.now() + (m.minutes || 3) * 60000, enregistrements: [] }); return { ok: true }; }
  if (m?.type === "arreter") { await poser({ enregistreurJusqua: 0 }); return { ok: true }; }
  if (m?.type === "manuel-fait") {
    const { manuels } = await cfg();
    const x = manuels.find(v => v.id === m.id);
    if (x) {
      try { await silencio("/api/ext/resultats", { method: "POST", body: JSON.stringify({ plateforme: x.plateforme, resultats: [{ ...x, etat: "ok" }] }) }); } catch (e) { return { ok: false, erreur: e.message }; }
    }
    await poser({ manuels: manuels.filter(v => v.id !== m.id) });
    return { ok: true };
  }
  if (m?.type === "effacer-journal") { await poser({ journal: [] }); return { ok: true }; }
});
