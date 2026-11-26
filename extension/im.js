/* Silencio Sync, côté imdb.com : notes, watchlist (ta watchlist Silencio) et tes listes, par l'API
   qu'utilise le site lui-même, avec ta session ouverte dans Firefox. Les critiques se publient à la main :
   l'extension prépare le texte et ouvre la bonne page. */
(() => {
  if (window.__silencioIm) return;
  window.__silencioIm = true;
  const B = globalThis.browser;
  const F = (typeof content !== "undefined" && content.fetch) ? content.fetch.bind(content) : window.fetch.bind(window);
  const GQL = "https://api.graphql.imdb.com/";
  let vitesse = 1;                         // 1 en vrai ; les tests accélèrent
  const pause = ms => new Promise(r => setTimeout(r, ms * vitesse));
  const hasard = (a, b) => a + Math.random() * (b - a);
  class Bloque extends Error {}
  let session = "";

  async function gql(query, variables, operationName) {
    const h = { "content-type": "application/json", "accept": "application/graphql+json, application/json" };
    if (session) h["x-amzn-sessionid"] = session;
    const r = await F(GQL, { method: "POST", credentials: "include", headers: h, body: JSON.stringify({ query, operationName, variables }) });
    if (r.status === 401 || r.status === 403) throw new Bloque("session IMDb refusée : reconnecte-toi sur imdb.com dans Firefox.");
    if (r.status === 429) throw new Bloque("IMDb demande de ralentir : nouvel essai au prochain passage.");
    const j = await r.json().catch(() => null);
    if (!j) throw new Error(`IMDb a répondu ${r.status}`);
    if (j.errors && j.errors.length) {
      const msg = j.errors.map(e => e.message || "").join(" ");
      if (/authenticat|sign.?in|unauthori/i.test(msg)) throw new Bloque("session IMDb expirée : reconnecte-toi sur imdb.com dans Firefox.");
      return { erreur: msg.slice(0, 200) };
    }
    return { data: j.data };
  }

  const NOTER = "mutation UpdateTitleRating($rating: Int!, $titleId: ID!) { rateTitle(input: {rating: $rating, titleId: $titleId}) { rating { value __typename } __typename } }";
  const DENOTER = "mutation DeleteTitleRating($titleId: ID!) { deleteTitleRating(input: {titleId: $titleId}) { date __typename } }";
  const WATCHLIST = "query Watchlist { predefinedList(classType: WATCH_LIST) { id __typename } }";
  const CREER = "mutation CreateList($input: CreateListInput!) { createList(input: $input) { listId __typename } }";
  const AJOUTER = "mutation AddItemToList($input: AddItemToListInput!) { addItemToList(input: $input) { listId __typename } }";
  const RETIRER = [
    ["RemoveItemFromList", "mutation RemoveItemFromList($input: RemoveItemFromListInput!) { removeItemFromList(input: $input) { listId __typename } }", (l, t) => ({ input: { listId: l, itemElementId: t } })],
    ["RemoveElementFromList", "mutation RemoveElementFromList($input: RemoveElementFromListInput!) { removeElementFromList(input: $input) { listId __typename } }", (l, t) => ({ input: { listId: l, itemElementId: t } })]
  ];

  const deja = msg => /already|exist|duplicate|déjà/i.test(msg || "");

  async function executer(ops, ctx, aBlanc) {
    session = ctx.session || "";
    vitesse = ctx.rapide ? 0.005 : 1;
    if (!aBlanc) await pause(hasard(2000, 6000));
    const resultats = [];
    let bloque = "";
    for (const op of ops) {
      const base = { id: op.id, cle: op.cle, action: op.action, valeur: op.valeur, titre: op.titre };
      const poser = op.action === "poser";
      try {
        if (aBlanc) { resultats.push({ ...base, etat: "blanc" }); continue; }
        let r;
        if (op.sorte === "note") {
          const x = poser ? await gql(NOTER, { rating: op.valeur, titleId: op.imdb }, "UpdateTitleRating")
            : await gql(DENOTER, { titleId: op.imdb }, "DeleteTitleRating");
          r = x.erreur ? { etat: "echec", erreur: x.erreur } : { etat: "ok" };
        } else if (op.sorte === "liste") {
          if (op.ref) r = { etat: "deja", ref: op.ref };
          else if (op.valeur && op.valeur.watchlist) {
            // ta watchlist IMDb existe déjà : on retrouve seulement son identifiant
            const x = await gql(WATCHLIST, {}, "Watchlist");
            const lid = x.data && x.data.predefinedList && x.data.predefinedList.id;
            r = lid ? { etat: "ok", ref: lid } : { etat: "echec", erreur: x.erreur || "watchlist IMDb introuvable" };
          } else {
            const x = await gql(CREER, { input: { name: op.valeur.nom || "Liste Silencio", listDescription: op.valeur.description || "",
              allowDuplicates: false, listType: "TITLES", visibility: "PRIVATE" } }, "CreateList");
            const lid = x.data && x.data.createList && x.data.createList.listId;
            r = lid ? { etat: "ok", ref: lid } : { etat: "echec", erreur: x.erreur || "liste non créée" };
          }
        } else if (op.sorte === "item" || op.sorte === "fav") {
          if (poser) {
            const x = await gql(AJOUTER, { input: { listId: op.ref, item: { itemElementId: op.imdb } } }, "AddItemToList");
            r = !x.erreur ? { etat: "ok" } : deja(x.erreur) ? { etat: "deja" } : { etat: "echec", erreur: x.erreur };
          } else {
            r = { etat: "echec", erreur: "retrait d'une liste IMDb : calibre cette action avec l'enregistreur" };
            for (const [nom, q, vars] of RETIRER) {
              const x = await gql(q, vars(op.ref, op.imdb), nom);
              if (!x.erreur) { r = { etat: "ok" }; break; }
              if (/not.?found|n'existe/i.test(x.erreur)) { r = { etat: "deja" }; break; }
            }
          }
        } else if (op.sorte === "critique") {
          r = { etat: "manuel", erreur: "à publier à la main", lien: `https://www.imdb.com/review/create/?tconst=${op.imdb}`, texte: op.valeur };
        } else r = { etat: "attente" };
        resultats.push({ ...base, ...r });
      } catch (e) {
        if (e instanceof Bloque) { bloque = e.message; break; }
        resultats.push({ ...base, etat: "echec", erreur: String(e.message || e).slice(0, 200) });
      }
      await pause(aBlanc ? 200 : hasard(4000, 10000));
    }
    return { resultats, bloque };
  }

  B.runtime.onMessage.addListener(m => {
    if (m && m.type === "silencio-executer") return executer(m.ops, m.ctx || {}, !!m.aBlanc);
  });
})();
