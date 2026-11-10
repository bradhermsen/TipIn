const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const page = fs.readFileSync(path.join(__dirname, "..", "data", "admin.html"), "utf8");
const scripts = [...page.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g)];
assert.equal(scripts.length, 1);
function element() {
  return {
    children: [], _text: "", className: "",
    classList: {
      values: new Set(),
      remove(value) { this.values.delete(value); },
      toggle(value, enabled) { enabled ? this.values.add(value) : this.values.delete(value); },
    },
    set textContent(value) { this._text = String(value); this.children = []; },
    get textContent() { return this._text + this.children.map((c) => c.textContent).join(""); },
    appendChild(child) { this.children.push(child); },
    replaceChildren() { this.children = []; this._text = ""; },
  };
}
const elements = new Map();
let fetchImpl;
let calls = 0;
const context = {
  document: {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, element());
      return elements.get(id);
    },
    createElement: element,
  },
  window: {}, AbortController, setTimeout, clearTimeout,
  fetch: async (url, options) => {
    calls++;
    assert.equal(url, "/api/clients");
    assert.equal(options.credentials, "same-origin");
    assert.equal(options.cache, "no-store");
    return fetchImpl();
  },
};
vm.createContext(context);
vm.runInContext(scripts[0][1], context);
const refresh = () => vm.runInContext("refreshClients()", context);
const evil = '<img src=x onerror="alert(1)">';
const fixture = {
  uptimeMs: 120000, capacity: 20, retention: "ram_until_restart",
  clients: [
    { ip: "192.168.68.69", transport: "http + websocket", clientNames: ["Admin / authenticated API", "admin-ui", evil],
      activeConnections: 2, status: "connected", lastSeenAgeMs: 8000, connectedAgeMs: 90000, lastSeenBasis: "websocket_pong" },
    { ip: "192.168.68.67", transport: "websocket", clientNames: ["TipIn Clock Display"],
      activeConnections: 1, status: "pending", lastSeenAgeMs: null, connectedAgeMs: 1000, lastSeenBasis: "none" },
    { ip: evil, transport: "http", clientNames: ["Admin / authenticated API"],
      activeConnections: 0, status: "recent", lastSeenAgeMs: 0, connectedAgeMs: null, lastSeenBasis: "authenticated_request" },
  ],
};

(async () => {
  fetchImpl = async () => ({ ok: true, json: async () => fixture });
  await refresh();
  const rows = elements.get("clientsBody").children;
  assert.equal(rows.length, 3);
  const cells = (row) => row.children.map((cell) => cell.textContent);
  assert.deepEqual(cells(rows[0]), [
    "192.168.68.69", "http + websocket / Admin / authenticated API, admin-ui, " + evil,
    "connected", "2", "<1 min (8 s ago)", "1.5 min", "WebSocket pong (authenticated)",
  ]);
  assert.equal(cells(rows[1])[4], "Never");
  assert.equal(cells(rows[2])[0], evil);
  assert.equal(cells(rows[2])[3], "0");
  assert.equal(cells(rows[2])[5], "--");
  assert(elements.get("clientsMeta").textContent.includes("3 of 20 IP addresses"));
  fetchImpl = async () => ({ ok: false, status: 503 });
  await refresh();
  assert.equal(elements.get("clientsBody").children, rows);
  assert(elements.get("clientsWrap").classList.values.has("stale"));
  assert(elements.get("clientsState").textContent.includes("STALE"));

  let release;
  const before = calls;
  fetchImpl = () => new Promise((resolve) => { release = () => resolve({ ok: true, json: async () => fixture }); });
  const first = refresh();
  await refresh();
  assert.equal(calls, before + 1);
  release();
  await first;
  assert(!elements.get("clientsWrap").classList.values.has("stale"));

  fetchImpl = async () => ({ ok: true, json: async () => ({ ...fixture, clients: [] }) });
  await refresh();
  assert.equal(elements.get("clientsBody").children[0].children[0].colSpan, 7);
  assert(page.includes('colspan="7"'));
  console.log("PASS: grouped IP names, active counts, safe text, ages, stale rows, polling overlap and empty table.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
