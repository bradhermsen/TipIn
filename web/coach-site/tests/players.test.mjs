import test from "node:test";
import assert from "node:assert/strict";
import { rosterTable, sortRoster } from "../js/players.js";

test("printable roster includes every membership and escapes player fields", () => {
  const rows = [
    { firstName: "<script>", lastName: "Inactive", jerseyNumber: 20, grade: 9, position: "D", isRosterActive: false },
    { firstName: "Sam", lastName: "Active", jerseyNumber: 0, grade: 10, position: "G", isRosterActive: true },
    { firstName: "Jo", lastName: "NoNumber", jerseyNumber: null, grade: null, position: null, isRosterActive: true },
  ];
  const html = rosterTable(rows);
  assert.equal((html.match(/<tr>/g) || []).length, 4);
  assert.match(html, /Inactive/);
  assert.match(html, /Active/);
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /Goalie/);
  assert.match(html, /<td>0<\/td>/);
  assert.ok(html.indexOf("Sam") < html.indexOf("&lt;script&gt;"));
  assert.ok(html.indexOf("Jo") > html.indexOf("&lt;script&gt;"));
  assert.equal(rows[0].jerseyNumber, 20, "rendering does not reorder the input");
});

test("roster sorting uses team jersey then last and first names", () => {
  const rows = [
    { jerseyNumber: 8, firstName: "Z", lastName: "Same" },
    { jerseyNumber: null, firstName: "A", lastName: "First" },
    { jerseyNumber: 8, firstName: "A", lastName: "Same" },
    { jerseyNumber: 2, firstName: "B", lastName: "Other" },
  ].sort(sortRoster);
  assert.deepEqual(rows.map(p => p.firstName), ["B", "A", "Z", "A"]);
});
