const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function harness(role = "SuperAdmin", fetchLog) {
  const ids = ["coach-email-log", "email-log-date", "email-log-refresh", "email-log-previous",
    "email-log-next", "email-log-rows", "email-log-status", "email-log-page"];
  const nodes = Object.fromEntries(ids.map((id) => [id, {
    hidden: true, disabled: true, value: "", innerHTML: "", textContent: "",
    checkValidity() { return /^\d{4}-\d{2}-\d{2}$/.test(this.value); },
    classList: { add() {}, remove() {} },
  }]));
  const calls = [];
  const context = vm.createContext({
    window: { ROLES: { SuperAdmin: "SuperAdmin", OrgAdmin: "OrgAdmin" }, location: {} },
    document: { getElementById: (id) => nodes[id], addEventListener() {} },
    Auth: { hasRole: (...roles) => roles.includes(role) },
    console: { error() {}, warn() {} },
    Response, URLSearchParams, Intl, Date,
    authFetch: async (url, options) => {
      calls.push({ url, options });
      return fetchLog ? fetchLog(url) : Response.json({ page: 1, hasMore: false, items: [] });
    },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../api/email-settings-api.js"), "utf8"), context);
  context.EmailSettingsApi = context.window.EmailSettingsApi;
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../js/settings.js"), "utf8"), context);
  return { context, nodes, calls };
}

const row = {
  claimedAtUtc: "2026-11-11T15:00:00+00:00", sentAtUtc: "2026-11-11T15:00:01+00:00",
  email: "<img src=x onerror=alert(1)>", teamName: "Team <script>", teamId: "team",
  awayTeamName: "Away", homeTeamName: "Home", gameDateTime: "2026-11-11T19:00:00",
  reminderType: "LineupReminder", status: "Sent",
};

test("SuperAdmin log defaults to Central today, supports date selection, paging and refresh using GET only", async () => {
  const h = harness("SuperAdmin", (url) => {
    const page = Number(new URL(url, "https://localhost").searchParams.get("page"));
    return Response.json({ page, hasMore: page === 1, items: [row] });
  });
  await h.context.initCoachEmailLog();
  assert.equal(h.nodes["coach-email-log"].hidden, false);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date());
  const today = ["year", "month", "day"].map(type => parts.find(part => part.type === type).value).join("-");
  assert.equal(h.nodes["email-log-date"].value, today);
  assert.match(h.calls[0].url, new RegExp(`date=${today}&page=1`));
  assert.equal(h.nodes["email-log-previous"].disabled, true);
  assert.equal(h.nodes["email-log-next"].disabled, false);
  await h.nodes["email-log-next"].onclick();
  assert.equal(h.nodes["email-log-page"].textContent, "Page 2");
  assert.equal(h.nodes["email-log-next"].disabled, true);
  await h.nodes["email-log-previous"].onclick();
  assert.equal(h.nodes["email-log-page"].textContent, "Page 1");
  h.nodes["email-log-date"].value = "2026-11-10";
  await h.nodes["email-log-date"].onchange();
  assert.match(h.calls.at(-1).url, /date=2026-11-10&page=1/);
  await h.nodes["email-log-refresh"].onclick();
  assert.ok(h.calls.every(call => !call.options));
});

test("OrgAdmin cannot display or request global email history", async () => {
  const h = harness("OrgAdmin");
  await h.context.initCoachEmailLog();
  assert.equal(h.nodes["coach-email-log"].hidden, true);
  assert.equal(h.calls.length, 0);
});

test("log escapes untrusted fields and distinguishes UTC delivery times from local game time", () => {
  const h = harness();
  const html = h.context.renderCoachEmailLogRow(row);
  assert.doesNotMatch(html, /<img|<script>/);
  assert.match(html, /&lt;img/);
  assert.match(html, /9:00:00 AM CST/);
  assert.match(html, /9:00:01 AM CST/);
  assert.match(html, /2026-11-11 19:00/);
  assert.match(html, /Lineup reminder/);
  assert.match(h.context.renderCoachEmailLogRow({ ...row, status: "NeedsReview", sentAtUtc: null }),
    /Needs review \(delivery uncertain\)/);
});

test("empty, invalid-date, and failure states are explicit and retryable", async () => {
  let fail = false;
  const h = harness("SuperAdmin", () => fail
    ? Response.json({ error: "Log unavailable." }, { status: 500 })
    : Response.json({ page: 1, hasMore: false, items: [] }));
  await h.context.initCoachEmailLog();
  assert.match(h.nodes["email-log-status"].textContent, /No automated email tracking/);
  h.nodes["email-log-date"].value = "";
  await h.nodes["email-log-date"].onchange();
  assert.match(h.nodes["email-log-status"].textContent, /Select a valid date/);
  assert.equal(h.calls.length, 1);
  h.nodes["email-log-date"].value = "2026-11-11";
  fail = true;
  await h.nodes["email-log-refresh"].onclick();
  assert.match(h.nodes["email-log-status"].textContent, /Log unavailable/);
  assert.equal(h.nodes["email-log-rows"].innerHTML, "");
  assert.equal(h.nodes["email-log-refresh"].disabled, false);
  assert.equal(h.nodes["email-log-next"].disabled, true);
  fail = false;
  await h.nodes["email-log-refresh"].onclick();
  assert.match(h.nodes["email-log-status"].textContent, /No automated email tracking/);
});

test("a slower response for an old date cannot replace a newer date", async () => {
  let release;
  const h = harness("SuperAdmin", (url) => {
    if (url.includes("date=2026-11-10")) {
      return new Promise(resolve => { release = () => resolve(Response.json({ page: 1, hasMore: false, items: [row] })); });
    }
    return Response.json({ page: 1, hasMore: false, items: [] });
  });
  await h.context.initCoachEmailLog();
  h.nodes["email-log-date"].value = "2026-11-10";
  const older = h.nodes["email-log-date"].onchange();
  h.nodes["email-log-date"].value = "2026-11-11";
  await h.nodes["email-log-date"].onchange();
  release();
  await older;
  assert.equal(h.nodes["email-log-rows"].innerHTML, "");
  assert.match(h.nodes["email-log-status"].textContent, /No automated email tracking/);
});
