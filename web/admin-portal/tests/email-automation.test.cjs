const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function harness(role = "SuperAdmin", failLoad = false) {
  const ids = ["coach-email-automation", "coach-automation-fields", "automation-save-status",
    "settings-save-automation", "automation-invitations", "automation-rosters", "automation-lineups",
    "automation-deployment-status"];
  const nodes = Object.fromEntries(ids.map((id) => [id, { hidden: true, checked: false, disabled: true, textContent: "" }]));
  let settings = { automaticInvitations: false, rosterReminders: true, lineupReminders: false, deploymentPaused: true };
  const calls = [];
  const context = vm.createContext({
    window: { ROLES: { SuperAdmin: "SuperAdmin", OrgAdmin: "OrgAdmin" }, location: {} },
    document: { getElementById: (id) => nodes[id], addEventListener() {} },
    Auth: { hasRole: (...roles) => roles.includes(role) },
    console: { error() {}, warn() {} },
    Response,
    authFetch: async (url, options = {}) => {
      calls.push({ url, options });
      if (failLoad) return Response.json({ error: "Automation settings unavailable." }, { status: 500 });
      if (options.method === "PUT") settings = { ...JSON.parse(options.body), deploymentPaused: true };
      return Response.json(settings);
    },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../api/email-settings-api.js"), "utf8"), context);
  context.EmailSettingsApi = context.window.EmailSettingsApi;
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../js/settings.js"), "utf8"), context);
  return { context, nodes, calls, settings: () => settings };
}

test("SuperAdmin controls load and persist independent flags without SMTP payloads", async () => {
  const h = harness();
  await h.context.loadCoachEmailAutomation();
  assert.equal(h.nodes["coach-email-automation"].hidden, false);
  assert.equal(h.nodes["coach-automation-fields"].disabled, false);
  assert.equal(h.nodes["automation-rosters"].checked, true);
  assert.match(h.nodes["automation-deployment-status"].textContent, /paused/);
  h.nodes["automation-invitations"].checked = true;
  h.nodes["automation-rosters"].checked = false;
  h.nodes["automation-lineups"].checked = true;
  await h.nodes["settings-save-automation"].onclick();
  assert.deepEqual(h.settings(), {
    automaticInvitations: true, rosterReminders: false, lineupReminders: true, deploymentPaused: true,
  });
  assert.equal(h.calls[1].url, "/email/automation");
  assert.equal(h.nodes["automation-save-status"].textContent, "Automation settings saved.");
  await h.context.loadCoachEmailAutomation();
  assert.equal(h.nodes["automation-rosters"].checked, false);
  assert.equal(h.nodes["automation-lineups"].checked, true);
});

test("OrgAdmin cannot see controls or call the global automation endpoint", async () => {
  const h = harness("OrgAdmin");
  await h.context.loadCoachEmailAutomation();
  assert.equal(h.nodes["coach-email-automation"].hidden, true);
  assert.equal(h.calls.length, 0);
});

test("failed settings load keeps controls disabled and reports the error", async () => {
  const h = harness("SuperAdmin", true);
  await h.context.loadCoachEmailAutomation();
  assert.equal(h.nodes["coach-automation-fields"].disabled, true);
  assert.match(h.nodes["automation-save-status"].textContent, /unavailable/);
});
