import test from "node:test";
import assert from "node:assert/strict";
import { loginPath, loginDestination } from "../js/navigation.js";

test("emailed lineup links survive login and page reloads", () => {
  const path = "/teams/11111111-2222-3333-4444-555555555555/games/aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
  const link = loginPath(path);
  assert.equal(loginDestination(link.slice(link.indexOf("?"))), path);
  for (const suffix of ["", "/roster", "/coaches", "/games"]) {
    const team = "/teams/11111111-2222-3333-4444-555555555555" + suffix;
    assert.equal(loginDestination(loginPath(team).slice(6)), team);
  }
});

test("login return destinations cannot leave the supported coach routes", () => {
  for (const path of ["https://evil.test", "//evil.test", "/login", "/accept#token=secret", "/teams/not-a-guid", "/teams/../login"]) {
    assert.equal(loginPath(path), "/login");
    assert.equal(loginDestination(`?returnTo=${encodeURIComponent(path)}`), "/");
  }
  assert.equal(loginDestination(""), "/");
});
