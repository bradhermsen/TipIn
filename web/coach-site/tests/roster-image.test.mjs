import test from "node:test";
import assert from "node:assert/strict";
import { parseRosterText, validateImportRow } from "../js/roster-image-parser.js";

test("parses printed roster lines but requires editable review", () => {
  const rows = parseRosterText("Jersey Name Position Grade\n12 Alex Smith F 10\n#1 Taylor Jones 11 G\n22 Riley van Buren D\n3 Smith, Sam G 12");
  assert.equal(rows.length, 4);
  assert.deepEqual(rows[0], { source: "12 Alex Smith F 10", firstName: "Alex", lastName: "Smith", jerseyNumber: "12", position: "F", grade: "10" });
  assert.equal(rows[1].position, "G");
  assert.equal(rows[1].grade, "11");
  assert.equal(rows[2].lastName, "van Buren");
  assert.equal(rows[2].grade, "");
  assert.equal(rows[3].firstName, "Sam");
  assert.equal(rows[3].lastName, "Smith");
});

test("supports name-first rows without confusing a low jersey number with grade", () => {
  for (const [source, grade] of [["Alex Smith 5 G", ""], ["Alex Smith #5 G 10", "10"], ["Smith, Alex 5 10 G", "10"]]) {
    const [row] = parseRosterText(source, "name-jersey-position-grade");
    assert.equal(row.firstName, "Alex");
    assert.equal(row.lastName, "Smith");
    assert.equal(row.jerseyNumber, "5");
    assert.equal(row.position, "G");
    assert.equal(row.grade, grade);
  }
});

test("unclear OCR rows are not silently discarded; validation prevents invalid imports", () => {
  const [unclear] = parseRosterText("Team");
  assert.ok(validateImportRow(unclear));
  const [row] = parseRosterText("12 Alex Smith F 10");
  assert.equal(validateImportRow(row), null);
  assert.ok(validateImportRow({ ...row, grade: "13" }));
  assert.ok(validateImportRow({ ...row, jerseyNumber: "100" }));
  assert.ok(validateImportRow({ ...row, jerseyNumber: "2.5" }));
});
