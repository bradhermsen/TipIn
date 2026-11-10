import test from "node:test";
import assert from "node:assert/strict";
import { canManageCoaches } from "../js/coaches.js";

test("only existing authorized admin roles can manage coaches", () => {
  for (const role of ["SuperAdmin", "OrgAdmin"]) assert.equal(canManageCoaches(role), true);
  for (const role of ["Coach", "TeamManager", "Viewer", "OrgOwner", "", null, undefined]) {
    assert.equal(canManageCoaches(role), false);
  }
});
