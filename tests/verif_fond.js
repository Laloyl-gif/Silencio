const fs = require("fs"); const vm = require("vm");
let ecouteEntetes; const ecoutes = [], store = {};
const browser = {
  storage: { local: { get: async d => ({ ...d, ...store }), set: async o => Object.assign(store, o) } },
  alarms: { clear: async () => {}, create() {}, get: async () => null, onAlarm: { addListener() {} } },
  runtime: { onInstalled: { addListener() {} }, onStartup: { addListener() {} }, onMessage: { addListener(f) { ecoutes.push(f); } } },
  tabs: { query: async () => [], create: async () => ({ id: 1 }), get: async () => ({ status: "complete" }), remove: async () => {}, onUpdated: { addListener() {}, removeListener() {} }, sendMessage: async () => ({}) },
  scripting: { executeScript: async () => [] }, permissions: { contains: async () => true },
  cookies: { get: async () => null, getAll: async () => [{ name: "session-id", value: "1" }] },
  webRequest: { onBeforeRequest: { addListener() {} }, onBeforeSendHeaders: { addListener(f) { ecouteEntetes = f; } } },
  action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
};
const ctx = { browser, console, setTimeout, clearTimeout, URL, TextDecoder, location: { origin: "moz-extension://abc", protocol: "moz-extension:" },
  fetch: async (u, o) => ({ status: 200, text: async () => JSON.stringify({ data: { ok: u } }), json: async () => ({}) }), DOMParser: class {} };
ctx.globalThis = ctx; ctx.window = ctx;
vm.createContext(ctx);
const EXT = require("path").join(__dirname, "..", "extension");
for (const f of ["lb.js", "im.js", "background.js"]) vm.runInContext('"use strict";' + fs.readFileSync(require("path").join(EXT, f), "utf8"), ctx, { filename: f });
(async () => {
  const r = await ecoutes.find(Boolean)({ type: "imdb-gql", corps: "{}", entetes: {} });
  console.log("imdb-gql", JSON.stringify(r).slice(0, 80));
  console.log("exec", Object.keys(ctx.__silencioExec || {}));
  const h = await ecouteEntetes({ originUrl: "moz-extension://abc/_generated_background_page.html", url: "https://api.graphql.imdb.com/", method: "POST", requestHeaders: [{ name: "Origin", value: "moz-extension://abc" }] });
  console.log("entetes", JSON.stringify(h));
  const rep = await ctx.__silencioExec.imdb([{ id: "1", cle: "note|m:1", sorte: "note", action: "poser", valeur: 7, imdb: "tt1" }], { rapide: true }, false);
  console.log("imdb fond", JSON.stringify(rep).slice(0, 160));
})().catch(e => { console.error("ERREUR", e); process.exit(1); });
