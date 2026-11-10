import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig, publicApi, ApiError } from "../js/api.js";

test("API client preserves validation, conflict, and server errors", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async () => Response.json({ apiBase: "https://api.example.test" });
    await loadConfig();
    for (const [status, message, code] of [
      [400, "Goalie selection required. Select a goalie as a starter.", null],
      [400, "Varsity lineups need exactly 6 starters.", null],
      [400, "Every participant must be on the team's active roster.", null],
      [409, "The lineup was changed by someone else.", "STALE_VERSION"],
      [409, "The lineup is signed and locked.", "LINEUP_LOCKED"],
      [500, "Could not save lineup.", null],
      [200, "Goalie selection required. Select a goalie as a starter.", null],
    ]) {
      globalThis.fetch = async () => Response.json({ error: message, details: { code } }, { status });
      await assert.rejects(publicApi("/lineup", {}), (err) =>
        err instanceof ApiError && err.status === status && err.message === message && err.code === code);
    }
    globalThis.fetch = async () => Response.json({ version: 1, participantIds: ["p"], starterIds: ["p"] });
    assert.deepEqual(await publicApi("/lineup", {}), { version: 1, participantIds: ["p"], starterIds: ["p"] });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
