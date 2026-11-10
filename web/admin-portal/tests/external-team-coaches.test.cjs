const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function harness({ external = false, organizationType, editing = true, failSave = false } = {}) {
  const calls = [];
  const nodes = { "team-org": { value: "org" } };
  for (let n = 1; n <= 4; n++) {
    nodes[`team-asst${n}-email`] = { value: `assistant${n}@example.test` };
    nodes[`team-asst${n}-has-login`] = { checked: true, disabled: false };
  }
  const payload = {
    teamType: "Boys", organizationId: "org", isExternal: external,
    headCoachName: "Head Coach", headCoachEmail: "head@example.test",
  };
  for (let n = 1; n <= 4; n++) {
    payload[`assistantCoach${n}Name`] = `Assistant ${n}`;
    payload[`assistantCoach${n}Email`] = `assistant${n}@example.test`;
    payload[`assistantCoach${n}HasLogin`] = true;
  }
  const context = vm.createContext({
    window: { addEventListener() {} },
    document: { getElementById: id => nodes[id], addEventListener() {} },
    console,
    Auth: { canManageTeams: () => true },
    AdminPage: {
      editingId: editing ? "existing-team" : null,
      config: { collectFormData: () => ({ ...payload }) },
      closeModal: () => calls.push(["close"]),
      loadData: () => calls.push(["reload"]),
    },
    TeamApi: {
      update: async (id, body) => {
        calls.push(["update", id, body]);
        if (failSave) throw Error("Team save failed");
      },
      create: async body => { calls.push(["create", body]); return "new-team"; },
    },
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../js/teams.js"), "utf8"), context);
  context.ensureCoachUser = async (...args) => calls.push(["account", ...args]);
  vm.runInContext(`teamOrganizationState.byId.set("org", { organizationType: ${JSON.stringify(organizationType || (external ? "External" : "Managed"))} });`, context);
  return { context, calls, nodes, payload };
}

test("external team create/update saves coach contacts without any portal account requests", async () => {
  for (const editing of [false, true]) {
    const h = harness({ external: true, editing });
    await h.context.saveTeam();
    assert.equal(h.calls.some(call => call[0] === "account"), false);
    const saved = h.calls[0].at(-1);
    assert.equal(saved.headCoachEmail, "head@example.test");
    for (let n = 1; n <= 4; n++) {
      assert.equal(saved[`assistantCoach${n}Email`], `assistant${n}@example.test`);
      assert.equal(saved[`assistantCoach${n}HasLogin`], false);
    }
    assert.deepEqual(h.calls.slice(-2).map(call => call[0]), ["close", "reload"]);
  }
});

test("external organization metadata prevents account creation even with a stale team flag", async () => {
  const h = harness({ external: false, organizationType: "External" });
  await h.context.saveTeam();
  assert.equal(h.calls.some(call => call[0] === "account"), false);
});

test("managed teams retain head-coach and selected assistant account provisioning", async () => {
  const h = harness();
  h.payload.assistantCoach2HasLogin = false;
  await h.context.saveTeam();
  const accounts = h.calls.filter(call => call[0] === "account");
  assert.equal(accounts.length, 4);
  assert.equal(accounts[0][2], "head@example.test");
  assert.equal(accounts.some(call => call[2] === "assistant2@example.test"), false);
});

test("failed team writes report the error without attempting accounts or closing the editor", async () => {
  const h = harness({ external: true, failSave: true });
  h.context.window.showMessage = message => h.calls.push(["error", message]);
  await assert.rejects(() => h.context.saveTeam(), /Team save failed/);
  assert.deepEqual(h.calls.map(call => call[0]), ["update", "error"]);
});

test("external login switches remain disabled after email edits and refresh on organization changes", () => {
  const h = harness({ external: true });
  h.context.wireAssistantCoachLoginToggles();
  const toggle = h.nodes["team-asst1-has-login"];
  assert.equal(toggle.checked, false);
  assert.equal(toggle.disabled, true);
  assert.match(toggle.title, /roster access is granted through invitations/);
  h.nodes["team-asst1-email"].oninput();
  assert.equal(toggle.disabled, true);
  vm.runInContext('teamOrganizationState.byId.set("org", { organizationType: "Managed" });', h.context);
  h.context.wireAssistantCoachLoginToggles();
  assert.equal(toggle.disabled, false);
  assert.equal(toggle.checked, false);
  h.nodes["team-asst1-email"].value = "";
  toggle.checked = true;
  h.nodes["team-asst1-email"].oninput();
  assert.equal(toggle.disabled, true);
  assert.equal(toggle.checked, false);
});
