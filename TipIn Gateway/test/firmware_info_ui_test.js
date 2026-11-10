const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const page = fs.readFileSync(path.join(__dirname, "..", "data", "admin.html"), "utf8");
const scripts = [...page.matchAll(/<script(?![^>]*src)[^>]*>([\s\S]*?)<\/script>/g)];
assert.equal(scripts.length, 1);
const elements = new Map();
const context = {
  document: {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, {
        textContent: "",
        innerText: "",
        classList: { add() {}, remove() {} },
      });
      return elements.get(id);
    },
  },
  window: {},
};
vm.createContext(context);
vm.runInContext(scripts[0][1], context);

async function refresh(fixture) {
  context.fetch = async (url, options) => {
    assert.equal(url, "/api/state");
    assert.equal(options.credentials, "same-origin");
    return { json: async () => fixture };
  };
  await vm.runInContext("refreshAdmin()", context);
}

(async () => {
  await refresh({
    firmwareVersion: "1.1.0",
    firmwareBuildTimestamp: "2026-10-28T14:40:06Z",
    firmwareGitRevision: "dac84338f651",
    firmwareGitDirty: true,
    deviceMac: "00:11:22:33:44:55",
  });
  assert.equal(elements.get("firmwareVersion").textContent, "1.1.0");
  assert.equal(elements.get("firmwareBuildTimestamp").textContent, "2026-10-28T14:40:06Z");
  assert.equal(elements.has("firmwareGitRevision"), false);
  assert.equal(elements.get("deviceMac").innerText, "00:11:22:33:44:55");
  await refresh({ firmwareGitRevision: "dac84338f651", firmwareGitDirty: false });
  assert.equal(elements.has("firmwareGitRevision"), false);
  assert.equal(elements.get("firmwareVersion").textContent, "Not reported");
  await refresh({});
  assert.equal(elements.has("firmwareGitRevision"), false);
  assert.equal(elements.get("firmwareBuildTimestamp").textContent, "Not reported");
  await refresh({ firmwareVersion: "<img onerror=alert(1)>" });
  assert.equal(elements.get("firmwareVersion").textContent, "<img onerror=alert(1)>");
  for (const id of ["firmwareVersion", "firmwareBuildTimestamp"]) {
    assert(page.includes(`id="${id}"`));
  }
  assert(!page.includes('id="firmwareGitRevision"'));
  assert(!page.includes("Git Revision:"));
  console.log("PASS: version/build UI fields, hidden Git revision, older gateway compatibility and literal text rendering.");
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
