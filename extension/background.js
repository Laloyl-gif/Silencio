/* Silencio Sync : demande à Silencio ce qui a changé, puis le recopie sur Letterboxd et IMDb avec tes sessions
   Firefox déjà ouvertes. Rien ne part vers un autre serveur que Silencio (chez toi), Letterboxd et IMDb. */
"use strict";
const B = globalThis.browser;
const NOM = { lb: "Letterboxd", imdb: "IMDb" };
// pages légères, sans redirection, pour l'onglet discret
const SITE = { lb: "https://letterboxd.com/about/", imdb: "https://www.imdb.com/robots.txt" };
const SCRIPT = { lb: "lb.js", imdb: "im.js" };
const DEFAUT = {
  adresse: "http://127.0.0.1:8642", jeton: "", actif: true, intervalle: 15,
  cacheLb: {}, journal: [], manuels: [], enregistrements: [], enregistreurJusqua: 0, dernier: null,
  // discrétion : pauses après un refus, quota par jour, onglets ouverts rarement, adresses qui marchent
  pauses: {}, quota: {}, dernierOnglet: {}, adresses: {}, essais: {}, prochain: 0,
  sites: { lb: true, imdb: true }, attente: { lb: [], imdb: [] }, modes: { lb: "auto", imdb: "clic" }, vuModif: 0,
  silencioAbsent: true, apresLancement: 0, cloudflare: {}, avisQuota: {}, fondKo: {}
};
const ORIGINES = ["https://letterboxd.com/*", "https://www.imdb.com/*", "https://m.imdb.com/*", "https://api.graphql.imdb.com/*"];
const QUOTA_JOUR = 80;                       // actions par site et par jour, au plus
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

// qui parle (version de l'extension, Firefox ordinateur ou Android) : affiché dans le test de la synchro
let quiSuisJe = null;
async function identite() {
  if (quiSuisJe) return quiSuisJe;
  const pi = B.runtime.getPlatformInfo ? await B.runtime.getPlatformInfo().catch(() => ({})) : {};
  const bi = B.runtime.getBrowserInfo ? await B.runtime.getBrowserInfo().catch(() => ({})) : {};
  let version = "?";
  try { version = B.runtime.getManifest().version; } catch { /* hors de Firefox (tests) */ }
  quiSuisJe = { version, os: pi.os || "?", android: pi.os === "android",
    navigateur: `${bi.name || "Firefox"} ${bi.version || ""} ${pi.os === "android" ? "Android" : pi.os || ""}`.trim() };
  return quiSuisJe;
}

async function silencio(chemin, options = {}) {
  const c = await cfg();
  const moi = await identite();
  let r;
  try {
    r = await fetch(c.adresse.replace(/\/+$/, "") + chemin, {
      ...options, headers: { "X-Silencio-Jeton": c.jeton, "X-Silencio-Ext": `${moi.version}; ${moi.navigateur}`, "Content-Type": "application/json", ...(options.headers || {}) }
    });
  } catch (e) {
    throw new Refus(`Silencio injoignable à ${c.adresse}. Sur PC : lance Silencio. Sur téléphone : ouvre l'appli Silencio.`);
  }
  if (r.status === 403) throw new Refus("Code d'appairage refusé : recopie-le depuis Silencio (Réglages, Letterboxd IMDb Refract).");
  if (!r.ok) throw new Refus(`Silencio a répondu ${r.status}.`);
  return r.json();
}

// ---------------------------------------------------------------- autorisations
// Firefox laisse décocher l'accès aux sites (et l'oublie parfois après une mise à jour) : sans lui, « Missing host
// permission » ou « NetworkError ». La fenêtre de l'extension propose alors de le redonner d'un clic.
async function autorisationsManquantes() {
  if (!B.permissions || !B.permissions.contains) return [];
  const manque = [];
  for (const o of ORIGINES) if (!(await B.permissions.contains({ origins: [o] }).catch(() => true))) manque.push(o);
  return manque;
}

// injecte le script du site puis lui parle (avec quelques essais : la page peut encore se charger)
async function parler(onglet, message) {
  let derniere;
  // la page peut se recharger (redirection vers /fr/, etc.) juste après l'injection : on réinjecte et on recommence
  for (let essai = 0; essai < 3; essai++) {
    await attendreChargement(onglet.id, 30000);
    await new Promise(r => setTimeout(r, 800 + essai * 1500));
    try {
      await B.scripting.executeScript({ target: { tabId: onglet.id }, files: [SCRIPT[message.p]] });
    } catch (e) {
      if (/host permission/i.test(e.message)) {
        if (!(await autorisationsManquantes()).length) { derniere = new Error("la page du site n'était pas chargée (onglet en arrière-plan) : nouvel essai"); if (B.tabs.reload) await B.tabs.reload(onglet.id).catch(() => {}); continue; }
        throw new Error("accès au site refusé par Firefox : ouvre la fenêtre de Silencio Sync et clique « Autoriser l'accès aux sites ».");
      }
      derniere = e; continue;
    }
    try { return await B.tabs.sendMessage(onglet.id, message); } catch (e) { derniere = e; }
  }
  throw new Error(/Receiving end/i.test(derniere?.message || "") ? "la page du site ne répond pas (rechargée pendant l'envoi ?) : nouvel essai au prochain passage." : (derniere?.message || "le script n'a pas répondu"));
}

// ---------------------------------------------------------------- requêtes sans onglet
async function cookiesDu(url) {
  // avec l'isolation des sites de Firefox (protection renforcée), il faut demander tous les cloisonnements
  for (const opts of [{ url, firstPartyDomain: null }, { url }]) {
    try {
      const ks = await B.cookies.getAll(opts);
      if (ks && ks.length) return ks;
    } catch (e) { /* option inconnue de ce Firefox */ }
  }
  return [];
}
// Quand l'extension parle elle-même à Letterboxd ou IMDb, ses requêtes partent comme celles du site : avec ta session
// (les cookies du site, lus par l'API cookies) et l'origine du site. Seules les requêtes de l'extension sont touchées.
let sessionJointe = false;                   // l'écoute qui joint ta session aux requêtes de l'extension est en place
if (B.webRequest && B.webRequest.onBeforeSendHeaders) {
  try {
    B.webRequest.onBeforeSendHeaders.addListener(async d => {
      if (!String(d.originUrl || d.documentUrl || "").startsWith(location.origin)) return {};
      const site = d.url.startsWith("https://letterboxd.com") ? "https://letterboxd.com" : "https://www.imdb.com";
      // la session du site (cookies du site, y compris ceux de connexion) remplace ce que Firefox aurait joint
      const ks = await cookiesDu(d.url);
      const h = d.requestHeaders.filter(x => !/^(origin|referer)$/i.test(x.name) && !(ks.length && /^cookie$/i.test(x.name)));
      if (ks.length) h.push({ name: "Cookie", value: ks.map(k => `${k.name}=${k.value}`).join("; ") });
      h.push({ name: "Referer", value: site + "/" });
      if (d.method !== "GET" && d.method !== "HEAD") h.push({ name: "Origin", value: site });
      return { requestHeaders: h };
    }, { urls: ["https://letterboxd.com/*", "https://www.imdb.com/*", "https://api.graphql.imdb.com/*"] }, ["blocking", "requestHeaders"]);
    sessionJointe = true;
  } catch (e) { /* navigateur sans webRequest bloquant : on passera par un onglet */ }
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
  // juste après un ajout dans Silencio : un onglet discret au plus toutes les 20 à 40 minutes ; sinon toutes les 2 à 4 heures
  const ecart = motif === "ajout" ? 2 * 60e3 : hasard(2, 4) * 3600e3;
  if (motif !== "bouton" && Date.now() - (c.dernierOnglet[p] || 0) < ecart) return null;
  const t = await B.tabs.create({ url: SITE[p], active: false });
  if (B.tabs.hide) await B.tabs.hide(t.id).catch(() => {});      // caché de la barre d'onglets (Firefox ordinateur)
  await attendreChargement(t.id);
  // Firefox Android ne charge pas un onglet ouvert en arrière-plan : on l'affiche une seconde, puis on revient
  const charge = await B.tabs.get(t.id).catch(() => null);
  if (charge && !/^https:\/\//.test(charge.url || "")) {
    const [avant] = await B.tabs.query({ active: true, currentWindow: true }).catch(() => []);
    if (B.tabs.update) await B.tabs.update(t.id, { active: true }).catch(() => {});
    await attendreChargement(t.id);
    await new Promise(r => setTimeout(r, 1500));
    if (avant && avant.id !== t.id && B.tabs.update) await B.tabs.update(avant.id, { active: true }).catch(() => {});
  }
  await poser({ dernierOnglet: { ...c.dernierOnglet, [p]: Date.now() } });
  return { id: t.id, cree: true };
}

// ---------------------------------------------------------------- contexte de chaque site
async function contexte(p, r, c) {
  if (p === "lb") {
    const csrf = await B.cookies.get({ url: "https://letterboxd.com/", name: "com.xk72.webparts.csrf" }).catch(() => null);
    const tous = await cookiesDu("https://letterboxd.com/");
    // les noms des cookies de session ne sont pas publics : on vérifie seulement que le site a déjà été ouvert ;
    // une session expirée est repérée à la première réponse refusée
    const connecte = tous.length > 0;
    return { csrf: csrf?.value || "", pseudo: r.pseudo || "", cache: c.cacheLb || {}, connecte };
  }
  const tous = await cookiesDu("https://www.imdb.com/");
  const session = tous.find(k => k.name === "session-id")?.value || "";
  const connecte = tous.length > 0;
  return { session, connecte, favoris: r.favoris || "" };
}

// ---------------------------------------------------------------- une plateforme
// Modes (réglés dans Silencio) : « auto » = discret et automatique ; « clic » = l'extension prépare, tu envoies
// chaque action d'un clic ; « liens » = aucune requête automatique, tu le fais toi-même sur le site ; « coupe ».
async function plateforme(p, aBlanc, motif, modes) {
  const c = await cfg();
  const mode = (modes && modes[p]) || c.modes[p] || "auto";
  if (mode === "coupe") { await poser({ attente: { ...c.attente, [p]: [] } }); return { coupe: true }; }
  if (mode !== "auto" && !aBlanc) {
    const r = await silencio(`/api/ext/ops?p=${p}&n=25`);
    const avant = (c.attente[p] || []).length;
    await poser({ attente: { ...(await cfg()).attente, [p]: r.ops } });
    if (r.ops.length && r.ops.length !== avant)
      await noter(`${NOM[p]} : ${r.ops.length} action(s) attendent ton clic (fenêtre de l'extension, « À reporter »), ou choisis l'envoi automatique dans Silencio.`, "attente");
    return { a_reporter: r.ops.length, mode };
  }
  if ((c.attente[p] || []).length) await poser({ attente: { ...c.attente, [p]: [] } });
  if ((c.pauses[p] || 0) > Date.now() && motif !== "bouton") {
    const ouvert = p === "lb" && ((c.cloudflare || {}).lb || 0) > 0 &&
      (await B.tabs.query({ url: "https://letterboxd.com/*" }).catch(() => [])).some(t => t.status === "complete");
    if (!ouvert) return { pause: c.pauses[p] };
  }
  const q = c.quota[p] && c.quota[p].jour === aujourdhui() ? c.quota[p].n : 0;
  // quota par jour (discrétion) ; ton clic sur « Synchroniser » en accorde un peu plus
  const reste = QUOTA_JOUR + (motif === "bouton" ? 40 : 0) - q;
  if (reste <= 0 && !aBlanc) {
    if ((c.avisQuota || {})[p] !== aujourdhui() || motif === "bouton") {
      await poser({ avisQuota: { ...(c.avisQuota || {}), [p]: aujourdhui() } });
      await noter(`${NOM[p]} : ${q} actions aujourd'hui, le maximum par jour est atteint. Reprise automatique demain${motif === "bouton" ? "" : " (ou clique « Synchroniser » pour en envoyer encore quelques-unes)"}.`, "attente");
    }
    return { quota: true };
  }
  // quelques actions à la fois seulement, jamais le même nombre
  // après un ajout dans Silencio, tout ce qui attend part (jusqu'à 12 à la fois), toujours espacé comme à la main
  const n = aBlanc ? 40 : Math.max(1, Math.min(reste, p === "lb" ? Math.round(hasard(3, 6)) : motif === "ajout" || motif === "bouton" ? 12 : Math.round(hasard(3, 6))));
  const r = await silencio(`/api/ext/ops?p=${p}&n=${n}`);
  if (!r.ops.length) return { rien: true, attente: r.en_attente || 0 };
  if (p === "lb" && !r.pseudo) {
    await noter("Letterboxd : indique ton pseudo Letterboxd dans Silencio (Réglages, Letterboxd IMDb Refract).", "attente");
    return { bloque: "pseudo" };
  }
  const ctx = await contexte(p, r, c);
  if (!ctx.connecte) {
    await noter(`${NOM[p]} : tu n'es pas connecté dans Firefox. Ouvre ${p === "lb" ? "letterboxd.com" : "imdb.com"} et connecte-toi une fois (coche « rester connecté »).`, "erreur");
    return { bloque: "connexion" };
  }
  ctx.adresses = c.adresses[p] || {};
  ctx.essais = c.essais[p] || {};
  const { rep, onglet } = await executerOps(p, r.ops, ctx, aBlanc, motif, c);
  if (!rep) return { attend: true, en_attente: r.ops.length };
  try {
    const c2 = await cfg();
    const maj = { adresses: { ...c2.adresses, [p]: rep.adresses || ctx.adresses }, essais: { ...c2.essais, [p]: rep.essais || ctx.essais } };
    if (p === "lb" && rep.cache) maj.cacheLb = { ...c2.cacheLb, ...rep.cache };
    const faites = (rep.resultats || []).filter(x => ["ok", "deja", "echec"].includes(x.etat)).length;
    if (!aBlanc) maj.quota = { ...c2.quota, [p]: { jour: aujourdhui(), n: q + faites } };
    const cf = /Cloudflare|vérifie le navigateur/i.test(rep.bloque || "");
    const nCf = cf ? ((c2.cloudflare || {})[p] || 0) + 1 : 0;
    maj.cloudflare = { ...(c2.cloudflare || {}), [p]: nCf };
    const pauseMin = cf ? Math.min(10 * 2 ** (nCf - 1), 240) * hasard(1, 1.5) : hasard(30, 60);
    if (rep.bloque) maj.pauses = { ...c2.pauses, [p]: Date.now() + pauseMin * 60e3 };
    await poser(maj);
    const resultats = (rep.resultats || []).filter(x => x.etat !== "attente" && x.etat !== "blanc");
    const manuels = resultats.filter(x => x.etat === "manuel" && x.lien);
    if (manuels.length) {
      const { manuels: liste } = await cfg();
      const ids = new Set(liste.map(m => m.id));
      await poser({ manuels: [...liste, ...manuels.filter(m => !ids.has(m.id)).map(m => ({ ...m, plateforme: p, t: Date.now() }))].slice(-60) });
    }
    // au passage : la note moyenne Letterboxd des films visités, pour la page du film dans Silencio
    const notesLb = p === "lb" ? Object.fromEntries(Object.entries(rep.cache || {}).filter(([, f]) => f && f.note).map(([t, f]) => [t, f.note])) : {};
    if (!aBlanc && (resultats.length || Object.keys(notesLb).length)) await silencio("/api/ext/resultats", { method: "POST", body: JSON.stringify({ plateforme: p, resultats, notes_lb: notesLb }) });
    const n = k => resultats.filter(x => x.etat === k).length;
    if (aBlanc) {
      const trouves = (rep.resultats || []).filter(x => x.etat === "blanc").length;
      await noter(`${NOM[p]} (test à blanc) : ${r.ops.length} opération(s) en attente, ${trouves} film(s) reconnu(s), rien n'a été envoyé.`);
    } else {
      await noter(`${NOM[p]} : ${n("ok") + n("deja")} fait(s), ${n("echec")} échec(s), ${n("manuel")} à faire à la main${r.reste ? `, ${r.reste} au prochain passage` : ""}.`, n("echec") ? "erreur" : "info");
    }
    for (const x of resultats.filter(x => x.etat === "echec").slice(0, 5)) await noter(`${NOM[p]}, ${x.titre || x.cle} : ${x.erreur}`, "erreur");
    if (rep.bloque) await noter(cf
      ? `${NOM[p]} demande une vérification anti-robot. Ouvre letterboxd.com dans Firefox (souvent, rien à faire de plus) : l'extension se sert de cet onglet et réessaie dans ${Math.round(pauseMin)} minutes.`
      : `${NOM[p]} : ${rep.bloque} Nouvel essai dans moins d'une heure.`, "erreur");
    return { fait: n("ok") + n("deja"), echecs: n("echec"), manuels: n("manuel"), bloque: rep.bloque || "" };
  } finally {
    if (onglet && onglet.cree) B.tabs.remove(onglet.id).catch(() => {});
  }
}

// Exécute les opérations : d'abord dans l'extension elle-même, sans aucun onglet (ta session est jointe aux
// requêtes) ; si le site refuse cette voie (Cloudflare, réseau), dans un onglet du site ouvert en arrière-plan.
const reseau = x => /NetworkError|Failed to fetch|injoignable|Cloudflare|vérifie le navigateur/i.test(x || "");
async function executerOps(p, ops, ctx, aBlanc, motif, c) {
  // IMDb : sans onglet (l'API du site accepte la session jointe). Letterboxd : son pare-feu (Cloudflare, nginx)
  // refuse les requêtes qui ne viennent pas d'une vraie page : on passe par un onglet caché, refermé aussitôt.
  const fond = p === "imdb" ? (globalThis.__silencioExec || {})[p] : null;
  const echecFond = (c.fondKo || {})[p] || 0;
  let rep = null, reste = ops;
  if (fond && Date.now() - echecFond > 6 * 3600e3) {
    try { rep = await fond(ops, { ...ctx }, aBlanc); } catch (e) { rep = { resultats: [], bloque: String(e.message || e) }; }
    const bons = (rep.resultats || []).filter(x => !(x.etat === "echec" && reseau(x.erreur)));
    const voieKo = reseau(rep.bloque) || (rep.resultats || []).some(x => x.etat === "echec" && reseau(x.erreur));
    if (!voieKo) return { rep, onglet: null };
    await poser({ fondKo: { ...((await cfg()).fondKo || {}), [p]: Date.now() } });
    const faits = new Set(bons.filter(x => x.etat !== "attente").map(x => x.id));
    reste = ops.filter(o => !faits.has(o.id));
    rep = { ...rep, resultats: bons, bloque: "" };
    if (!reste.length) return { rep, onglet: null };
  }
  const onglet = await ongletPour(p, motif);
  if (!onglet) return { rep: rep && rep.resultats.length ? rep : null, onglet: null };
  const rep2 = await delai(parler(onglet, { type: "silencio-executer", p, ops: reste, ctx, aBlanc }), 8 * 60e3, `${NOM[p]} (onglet)`)
    .catch(e => ({ resultats: [], bloque: e.message }));
  if (!rep) return { rep: rep2, onglet };
  return { rep: { ...rep2, resultats: [...rep.resultats, ...(rep2.resultats || [])], cache: { ...(rep.cache || {}), ...(rep2.cache || {}) } }, onglet };
}

// Une seule synchro à la fois. Si une précédente est restée bloquée (onglet qui ne répond plus, Firefox mis en
// veille…), le verrou est libéré au bout de 10 minutes : la synchro automatique et le bouton remarchent.
let enCoursFlag = false, enCoursDepuis = 0;
const verrou = { get on() { if (enCoursFlag && Date.now() - enCoursDepuis > 10 * 60e3) enCoursFlag = false; return enCoursFlag; },
  set on(v) { enCoursFlag = v; if (v) enCoursDepuis = Date.now(); } };
async function synchroniser(motif, aBlanc = false) {
  if (verrou.on) { if (motif === "bouton") await noter("Une synchro est déjà en cours : le résultat arrive dans le journal ci-dessous."); return { occupe: true }; }
  const c = await cfg();
  if (!c.actif && motif !== "bouton") return { inactif: true };
  if (!c.jeton) { await noter("Colle d'abord le code d'appairage affiché dans Silencio.", "attente"); return { jeton: false }; }
  const manque = await autorisationsManquantes();
  if (manque.length) {
    await noter("Firefox ne laisse pas l'extension accéder à Letterboxd ou IMDb : ouvre la fenêtre de Silencio Sync et clique « Autoriser l'accès aux sites ».", "erreur");
    return { autorisations: manque };
  }
  verrou.on = true;
  const bilan = {};
  try {
    const b = await silencio("/api/ext/bonjour");
    if (b.modes) await poser({ modes: b.modes });
    for (const p of ["lb", "imdb"]) {
      if (c.sites && c.sites[p] === false) { bilan[p] = { coupe: true }; continue; }
      try { bilan[p] = await plateforme(p, aBlanc, motif, b.modes); } catch (e) {
        bilan[p] = { erreur: e.message };
        await noter(`${NOM[p]} : ${e.message}`, "erreur");
      }
    }
    if (motif === "bouton") {
      const mots = ["lb", "imdb"].map(p => { const b = bilan[p] || {};
        return b.rien ? `${NOM[p]} : rien à envoyer` : b.coupe ? `${NOM[p]} : coupé` : b.pause ? `${NOM[p]} : en pause jusqu'à ${new Date(b.pause).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}` :
          b.a_reporter != null ? `${NOM[p]} : ${b.a_reporter} action(s) attendent ton clic ci-dessous` : b.attend ? `${NOM[p]} : onglet du site indisponible, nouvel essai bientôt` : ""; }).filter(Boolean);
      if (mots.length) await noter(mots.join(" ; ") + ".");
    }
  } catch (e) {
    bilan.silencio = e.message;
    await noter(e.message, "attente");
  } finally {
    verrou.on = false;
    await poser({ dernier: { quand: Date.now(), motif, bilan, aBlanc } });
  }
  // tout est parti : la modification est « vue » ; sinon la veille repassera dans une minute
  try {
    const b2 = await silencio("/api/ext/bonjour");
    const a = b2.a_faire || {}, modes = b2.modes || {};
    badge(a, modes);
    const resteAuto = ["lb", "imdb"].some(p => (modes[p] || "auto") === "auto" && c.sites?.[p] !== false && a[p] > 0 && !bilan[p]?.pause && !bilan[p]?.quota && !bilan[p]?.bloque);
    if (!resteAuto) await poser({ vuModif: b2.modif || 0 });
  } catch { /* Silencio fermé */ }
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
  // mise à jour de l'extension : compteurs du jour et pauses remis à zéro (ils ont pu être gonflés par une erreur)
  if (d.reason === "update") await poser({ quota: {}, pauses: {}, fondKo: {}, cloudflare: {}, avisQuota: {} });
  await planifier(hasard(1, 3));
  if (d.reason === "install") B.runtime.openOptionsPage().catch(() => {});
});
B.runtime.onStartup.addListener(() => { poser({ silencioAbsent: true }); planifier(hasard(2, 4)); });
B.alarms.onAlarm.addListener(async a => {
  if (a.name === "veille") return veille();
  if (a.name !== "silencio") return;
  try { await synchroniser("minuteur"); } finally { await planifier(); }
});

// Toutes les 2 minutes, une question très légère à Silencio (chez toi, rien ne part sur Internet) : « as-tu été
// modifié ? ». Après un ajout, la synchro passe dans les minutes qui suivent au lieu d'attendre le prochain tour.
(B.alarms.get ? B.alarms.get("veille") : Promise.resolve(null)).then(a => { if (!a) B.alarms.create("veille", { periodInMinutes: 1 }); }).catch(() => {});
async function veille() {
  const c = await cfg();
  if (!c.jeton || verrou.on) return;
  let b;
  try { b = await silencio("/api/ext/bonjour"); } catch { if (!c.silencioAbsent) await poser({ silencioAbsent: true }); return; }
  // « Tester la synchro » a été lancé dans Silencio : l'extension fait sa part du test
  if (b.diagnostic && b.diagnostic.id && b.diagnostic.id !== c.diagFait) { await diagnostiquer(b, c); return; }
  if (!c.actif) return;
  // Silencio vient d'être lancé : une synchro 2 minutes après
  if (c.silencioAbsent) { await poser({ silencioAbsent: false, apresLancement: Date.now() + 2 * 60e3 }); return; }
  if (c.apresLancement && Date.now() >= c.apresLancement) { await poser({ apresLancement: 0 }); await synchroniser("ajout"); return; }
  const a = b.a_faire || {};
  const auto = p => (b.modes?.[p] || "auto") === "auto" && c.sites?.[p] !== false && a[p] > 0;
  badge(a, b.modes);
  if (!auto("lb") && !auto("imdb")) return;
  // une modification récente (ou des envois restés en route) : on y va, après 20 s de calme
  const recent = b.modif && b.modif > (c.vuModif || 0);
  if (!recent && Date.now() - (c.dernier?.quand || 0) < 3 * 60e3) return;
  if (b.modif && Date.now() - b.modif * 1000 < 20000) return;
  await synchroniser("ajout");
}
// le nombre d'actions en attente s'affiche sur l'icône de l'extension
function badge(a, modes) {
  if (!B.action || !B.action.setBadgeText) return;
  const n = (a.lb || 0) + (a.imdb || 0);
  B.action.setBadgeText({ text: n ? String(Math.min(n, 99)) : "" }).catch(() => {});
  B.action.setBadgeBackgroundColor?.({ color: (modes?.imdb === "clic" && a.imdb) ? "#f0505f" : "#555" })?.catch?.(() => {});
}

// ---------------------------------------------------------------- test de la synchro (demandé depuis Silencio)
// Lectures d'abord (connexion, jeton, recherche d'un film, journal) ; en test complet, chaque écriture est faite
// puis défaite sur un film témoin absent de ton profil. Rien n'est noté comme envoyé dans Silencio.
async function diagnostiquer(b, c) {
  const d = b.diagnostic;
  await poser({ diagFait: d.id });
  verrou.on = true;
  const sections = [];
  const sec = nom => { const s = { nom, lignes: [] }; sections.push(s); return s; };
  const L = (s, etat, texte, detail = "") => s.lignes.push({ etat, texte, detail: String(detail || "").slice(0, 400) });
  const moi = await identite();
  try {
    await silencio("/api/ext/diagnostic", { method: "POST", body: JSON.stringify({ id: d.id, recu: true }) }).catch(() => {});
    // --- Firefox et l'extension
    const e = sec("Extension dans Firefox" + (moi.android ? " (Android)" : " (ordinateur)"));
    L(e, "info", `Silencio Sync ${moi.version} sur ${moi.navigateur}`);
    L(e, "ok", `Silencio joignable à ${c.adresse}`, `profil ${b.profil}, Silencio v${b.app}`);
    const manque = await autorisationsManquantes();
    L(e, manque.length ? "erreur" : "ok", manque.length ? "Accès aux sites refusé par Firefox" : "Accès aux sites Letterboxd et IMDb autorisé",
      manque.length ? `manque : ${manque.join(", ")} (fenêtre de l'extension → « Autoriser l'accès aux sites »)` : "");
    L(e, sessionJointe ? "ok" : "erreur", sessionJointe ? "Session des sites jointe aux requêtes de l'extension" : "Impossible de joindre ta session aux requêtes (webRequest bloquant absent)");
    L(e, B.tabs.hide ? "ok" : "info", B.tabs.hide ? "Onglets cachés disponibles" : "Onglets cachés indisponibles",
      B.tabs.hide ? "" : moi.android ? "normal sur Android : l'onglet Letterboxd s'ouvre en arrière-plan quelques secondes" : "l'onglet Letterboxd sera visible pendant l'envoi");
    L(e, c.actif ? "ok" : "attention", c.actif ? "Synchro automatique activée dans l'extension" : "Synchro automatique coupée dans l'extension");
    const modes = b.modes || {};
    for (const p of ["lb", "imdb"]) {
      const m = modes[p] || "auto";
      L(e, c.sites?.[p] === false ? "attention" : "info", `${NOM[p]} : mode « ${m} »${c.sites?.[p] === false ? ", coupé dans l'extension" : ""}`,
        `${(b.a_faire || {})[p] || 0} en attente`);
      if ((c.pauses[p] || 0) > Date.now())
        L(e, "attention", `${NOM[p]} en pause jusqu'à ${new Date(c.pauses[p]).toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" })}`,
          (c.cloudflare || {})[p] ? `vérification anti-robot (Cloudflare) ${(c.cloudflare || {})[p]} fois de suite` : "après un refus du site");
      const q = c.quota[p] && c.quota[p].jour === aujourdhui() ? c.quota[p].n : 0;
      if (q >= QUOTA_JOUR * 0.8) L(e, "attention", `${NOM[p]} : ${q}/${QUOTA_JOUR} actions aujourd'hui (quota presque atteint)`);
      if ((c.fondKo || {})[p] && Date.now() - c.fondKo[p] < 6 * 3600e3) L(e, "attention", `${NOM[p]} : la voie sans onglet a échoué récemment, passage par un onglet`);
    }
    if (c.dernier) L(e, "info", `Dernière synchro de l'extension : ${new Date(c.dernier.quand).toLocaleString("fr-FR")} (${c.dernier.motif})`, JSON.stringify(c.dernier.bilan || {}).slice(0, 300));
    const errs = (c.journal || []).filter(x => x.niveau === "erreur" && Date.now() - x.t < 3 * 86400e3).slice(0, 8);
    for (const x of errs) L(e, "attention", `Erreur récente (${new Date(x.t).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })})`, x.texte);
    // --- Letterboxd
    const lb = sec("Letterboxd (par l'extension)");
    if (c.sites?.lb === false) L(lb, "saute", "Letterboxd coupé dans l'extension");
    else await diagLb(lb, L, d, c, b);
    // --- IMDb
    const im = sec("IMDb (par l'extension)");
    if (c.sites?.imdb === false) L(im, "saute", "IMDb coupé dans l'extension");
    else await diagImdb(im, L, d);
  } catch (x) {
    L(sec("Test de l'extension interrompu"), "erreur", "Le test a planté", x.message || String(x));
  } finally {
    verrou.on = false;
  }
  try {
    await silencio("/api/ext/diagnostic", { method: "POST", body: JSON.stringify({ id: d.id, env: moi, sections }) });
  } catch (x) { await noter("Test de la synchro : résultat non transmis à Silencio (" + x.message + ")", "erreur"); }
  await noter(`Test de la synchro fait (${d.complet ? "complet" : "rapide"}) : le rapport est dans Silencio.`);
}

const delai = (p, ms, quoi) => Promise.race([p, new Promise((_, non) => setTimeout(() => non(new Error(quoi + " : pas de réponse en " + Math.round(ms / 1000) + " s")), ms))]);

async function diagLb(s, L, d, c, b) {
  const pseudo = d.pseudo || b.pseudo || "";
  if (!pseudo) L(s, "erreur", "Pseudo Letterboxd absent dans Silencio", "Réglages → Plateformes → Letterboxd");
  const ks = await cookiesDu("https://letterboxd.com/");
  L(s, ks.length ? "ok" : "erreur", ks.length ? `Cookies Letterboxd présents (${ks.length})` : "Aucun cookie Letterboxd : jamais ouvert ou pas connecté dans ce Firefox");
  if (!ks.length) return;
  let onglet = null;
  try {
    onglet = await delai(ongletPour("lb", "bouton"), 60000, "ouverture de l'onglet Letterboxd");
    L(s, "ok", onglet.cree ? "Onglet Letterboxd ouvert en arrière-plan" : "Onglet Letterboxd déjà ouvert réutilisé");
    const ctx = await contexte("lb", { pseudo }, c);
    ctx.adresses = c.adresses.lb || {};
    const r = await delai(parler(onglet, { type: "silencio-diagnostic", p: "lb", ctx, temoin: d.temoin, complet: d.complet }), 240000, "test Letterboxd");
    for (const x of (r && r.etapes) || []) L(s, x.etat, x.texte, x.detail);
    if (r && r.bloque) L(s, "erreur", "Letterboxd a bloqué le test", r.bloque);
    // Letterboxd répond normalement : une pause (anti-robot ou refus) encore en cours est levée, la synchro reprend
    const marche = ((r && r.etapes) || []).some(x => x.texte.startsWith("Recherche d'un film") && x.etat === "ok") && !(r && r.bloque);
    const c2 = await cfg();
    if (marche && ((c2.pauses.lb || 0) > Date.now() || (c2.cloudflare || {}).lb)) {
      await poser({ pauses: { ...c2.pauses, lb: 0 }, cloudflare: { ...(c2.cloudflare || {}), lb: 0 } });
      L(s, "info", "Pause Letterboxd levée : le site répond normalement, la synchro reprend");
    }
  } catch (x) {
    L(s, "erreur", "Test Letterboxd impossible", x.message || String(x));
  } finally {
    if (onglet && onglet.cree) B.tabs.remove(onglet.id).catch(() => {});
  }
}

async function diagImdb(s, L, d) {
  const ks = await cookiesDu("https://www.imdb.com/");
  const connecte = ks.some(k => k.name === "at-main" || k.name === "sess-at-main");
  L(s, connecte ? "ok" : ks.length ? "erreur" : "erreur", connecte ? "Cookie de connexion IMDb présent" : ks.length ? "Pas connecté à IMDb dans ce Firefox (cookies sans connexion)" : "Aucun cookie IMDb : jamais ouvert dans ce Firefox",
    `${ks.length} cookie(s)`);
  const exec = (globalThis.__silencioExec || {}).imdb;
  if (!exec) { L(s, "erreur", "Module IMDb de l'extension non chargé"); return; }
  const ctx = { session: (ks.find(k => k.name === "session-id") || {}).value || "", vitesse: 0.15 };
  const t = d.temoin;
  const un = async (texte, op) => {
    const r = await delai(exec([{ id: "diag", tmdb: t?.tmdb, imdb: t?.imdb, titre: t?.titre, type: "m", ...op }], ctx, false), 60000, texte);
    if (r.bloque) { L(s, "erreur", texte, r.bloque); return null; }
    const x = (r.resultats || []).find(y => y.id === "diag") || {};
    L(s, ["ok", "deja"].includes(x.etat) ? "ok" : x.etat === "manuel" ? "attention" : "erreur", texte, x.etat === "deja" ? "déjà dans cet état" : (x.erreur || (x.ref ? `id ${x.ref}` : "")));
    return x;
  };
  let wl;
  try { wl = await un("Requête à IMDb sans onglet (lecture de ta watchlist)", { cle: "liste|_favoris", sorte: "liste", action: "poser", valeur: { nom: "Watchlist", watchlist: true } }); }
  catch (x) { L(s, "erreur", "Requête à IMDb impossible", x.message); return; }
  if (!d.complet || !t) return;
  if (!t.imdb) { L(s, "saute", "Film témoin sans identifiant IMDb : écritures non testées"); return; }
  try {
    const n = await un("Note : envoi (7/10)", { cle: `note|${t.cle}`, sorte: "note", action: "poser", valeur: 7 });
    if (n && n.etat === "ok") await un("Note : retrait", { cle: `note|${t.cle}`, sorte: "note", action: "retirer", valeur: null });
    if (wl && wl.ref) {
      const a = await un("Watchlist : ajout", { cle: `fav|${t.cle}`, sorte: "fav", action: "poser", valeur: 1, liste: "_favoris", ref: wl.ref });
      if (a && a.etat === "ok") await un("Watchlist : retrait", { cle: `fav|${t.cle}`, sorte: "fav", action: "retirer", valeur: null, liste: "_favoris", ref: wl.ref });
    }
  } catch (x) { L(s, "erreur", "Écritures IMDb interrompues", x.message); }
}

// ---------------------------------------------------------------- « Ouvrir dans Silencio » (clic droit sur un lien ou une page de film)
const SITES_FILMS = ["https://www.imdb.com/title/*", "https://m.imdb.com/title/*", "https://letterboxd.com/*film/*", "https://boxd.it/*", "https://www.themoviedb.org/movie/*", "https://www.themoviedb.org/tv/*"];
async function ouvrirDansSilencio(url, tabId) {
  const c = await cfg();
  let tmdb = "";
  // sur une page Letterboxd, le lien TMDB est dans la page : pas besoin de la redemander
  if (tabId != null && /letterboxd\.com\/(?:[\w.-]+\/)?film\//.test(url)) {
    try {
      const [r] = await B.scripting.executeScript({ target: { tabId }, func: () => (document.documentElement.innerHTML.match(/themoviedb\.org\/movie\/(\d+)/) || [])[1] || "" });
      tmdb = (r && r.result) || "";
    } catch { /* page non lisible : Silencio cherchera lui-même */ }
  }
  await B.tabs.create({ url: `${c.adresse.replace(/\/+$/, "")}/#/ouvrir?url=${encodeURIComponent(url)}${tmdb ? `&tmdb=${tmdb}` : ""}` });
}
if (B.menus && B.menus.create) {
  const creerMenus = () => {
    B.menus.removeAll().catch(() => {}).finally(() => {
      B.menus.create({ id: "silencio-lien", title: "Ouvrir dans Silencio", contexts: ["link"], targetUrlPatterns: SITES_FILMS });
      B.menus.create({ id: "silencio-page", title: "Ouvrir ce film dans Silencio", contexts: ["page"], documentUrlPatterns: SITES_FILMS });
    });
  };
  B.runtime.onInstalled.addListener(creerMenus);
  B.runtime.onStartup.addListener(creerMenus);
  B.menus.onClicked.addListener((info, tab) => {
    if (info.menuItemId === "silencio-lien") ouvrirDansSilencio(info.linkUrl, null);
    if (info.menuItemId === "silencio-page") ouvrirDansSilencio(info.pageUrl || tab.url, tab && tab.id);
  });
}

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
  if (details.method === "GET" || verrou.on) return;
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

// une seule action, demandée d'un clic dans la fenêtre de l'extension
async function executerUn(p, id) {
  if (verrou.on) return { ok: false, erreur: "une synchro est en cours, réessaie dans un instant" };
  const c = await cfg();
  const op = (c.attente[p] || []).find(o => o.id === id);
  if (!op) return { ok: false, erreur: "déjà fait" };
  verrou.on = true;
  try {
    const r = await silencio(`/api/ext/ops?p=${p}&n=1`);
    const ctx = await contexte(p, r, c);
    ctx.adresses = c.adresses[p] || {};
    ctx.essais = {};
    ctx.rapide = true;                        // c'est toi qui cliques : pas d'attente artificielle
    const { rep, onglet } = await executerOps(p, [op], ctx, false, "bouton", c);
    try {
      const tous = (rep && rep.resultats || []).filter(x => x.etat !== "attente");
      const res = tous.find(x => x.id === id);
      if (!res) return { ok: false, erreur: "pas encore possible pour ce type d'action" };
      await silencio("/api/ext/resultats", { method: "POST", body: JSON.stringify({ plateforme: p, resultats: tous }) });
      const c2 = await cfg();
      await poser({ attente: { ...c2.attente, [p]: c2.attente[p].filter(o => o.id !== id) },
        adresses: { ...c2.adresses, [p]: rep.adresses || ctx.adresses } });
      if (res.etat === "manuel") return { ok: true, manuel: res };
      return res.etat === "echec" ? { ok: false, erreur: res.erreur } : { ok: true };
    } finally {
      if (onglet && onglet.cree) B.tabs.remove(onglet.id).catch(() => {});
    }
  } catch (e) {
    return { ok: false, erreur: e.message };
  } finally {
    verrou.on = false;
  }
}

// ---------------------------------------------------------------- la fenêtre de l'extension
B.runtime.onMessage.addListener(async m => {
  if (m?.type === "etat") return { ...(await cfg()), enCours: verrou.on };
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
  if (m?.type === "executer-un") return executerUn(m.p, m.id);
  if (m?.type === "veille") { await veille(); return { ok: true }; }
  if (m?.type === "ouvrir-film") {
    const [t] = await B.tabs.query({ active: true, currentWindow: true });
    if (!t || !/imdb\.com\/title\/|letterboxd\.com\/(?:[\w.-]+\/)?film\/|boxd\.it\/|themoviedb\.org\/(movie|tv)\//.test(t.url || "")) return { ok: false };
    await ouvrirDansSilencio(t.url, t.id); return { ok: true };
  }
  if (m?.type === "diagnostic") {
    try { const c = await cfg(); const b = await silencio("/api/ext/bonjour"); if (b.diagnostic) { await diagnostiquer(b, c); return { ok: true }; } return { ok: false, erreur: "aucun test demandé dans Silencio" }; }
    catch (e) { return { ok: false, erreur: e.message }; }
  }
  if (m?.type === "imdb-gql") {
    try {
      const r = await fetch("https://api.graphql.imdb.com/", { method: "POST", credentials: "include", headers: m.entetes || {}, body: m.corps });
      return { status: r.status, texte: await r.text() };
    } catch (e) { return { erreur: "IMDb injoignable (" + e.message + ")" }; }
  }
  if (m?.type === "fait-main") {
    const c = await cfg();
    const op = (c.attente[m.p] || []).find(o => o.id === m.id);
    if (!op) return { ok: false };
    try {
      await silencio("/api/ext/resultats", { method: "POST", body: JSON.stringify({ plateforme: m.p, resultats: [{ id: op.id, cle: op.cle, action: op.action, valeur: op.valeur, titre: op.titre, etat: "ok" }] }) });
    } catch (e) { return { ok: false, erreur: e.message }; }
    await poser({ attente: { ...c.attente, [m.p]: c.attente[m.p].filter(o => o.id !== m.id) } });
    return { ok: true };
  }
});
