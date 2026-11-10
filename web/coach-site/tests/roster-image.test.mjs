import test from "node:test";
import assert from "node:assert/strict";
import { parseRosterText, validateImportRow, ROSTER_COLUMNS, setRosterColumn } from "../js/roster-image-parser.js";

test("parses printed roster lines but requires editable review", () => {
  const rows = parseRosterText("Jersey Name Position Grade\n12 Alex Smith F 10\n#1 Taylor Jones G 11\n22 Riley van Buren D\n3 Smith, Sam G 12");
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
  for (const [source, grade] of [["Alex Smith 5 G", ""], ["Alex Smith #5 G 10", "10"], ["Smith, Alex 5 G 10", "10"]]) {
    const [row] = parseRosterText(source, ["name", "jerseyNumber", "position", "grade"]);
    assert.equal(row.firstName, "Alex");
    assert.equal(row.lastName, "Smith");
    assert.equal(row.jerseyNumber, "5");
    assert.equal(row.position, "G");
    assert.equal(row.grade, grade);
  }
});

function permutations(values) {
  if (!values.length) return [[]];
  return values.flatMap((value) => permutations(values.filter((v) => v !== value)).map((tail) => [value, ...tail]));
}

test("all 24 selected column orders map fields correctly, including multiword names", () => {
  const values = { name: "Alex van Buren", jerseyNumber: "5", position: "G", grade: "10" };
  const orders = permutations(ROSTER_COLUMNS.map(([field]) => field));
  assert.equal(orders.length, 24);
  for (const columns of orders) {
    const source = columns.map((field) => values[field]).join(" ");
    const [row] = parseRosterText(source, columns);
    assert.deepEqual(row, { source, firstName: "Alex", lastName: "van Buren", jerseyNumber: "5", position: "G", grade: "10" }, columns.join(","));
    const commaSource = columns.map((field) => field === "name" ? "van Buren, Alex" : values[field]).join(" ");
    const [commaRow] = parseRosterText(commaSource, columns);
    assert.equal(commaRow.firstName, "Alex");
    assert.equal(commaRow.lastName, "van Buren");
  }
});

test("cascading column changes always retain four distinct fields", () => {
  for (const columns of permutations(ROSTER_COLUMNS.map(([field]) => field))) {
    for (let i = 0; i < 4; i++) {
      for (const value of columns.filter((field) => !columns.slice(0, i).includes(field))) {
        const next = setRosterColumn(columns, i, value);
        assert.deepEqual(next.slice(0, i), columns.slice(0, i));
        assert.equal(next[i], value);
        assert.equal(new Set(next).size, 4);
        assert.deepEqual([...next].sort(), [...columns].sort());
      }
    }
  }
  assert.throws(() => setRosterColumn(["name", "grade", "position", "jerseyNumber"], 1, "name"), /once/);
  assert.throws(() => parseRosterText("5 Alex Smith G 10", ["name", "name", "position", "grade"]), /exactly once/);
});

test("explicit column separators retain empty and invalid values for review", () => {
  const [row] = parseRosterText("10 | Alex Smith | | 5", ["grade", "name", "position", "jerseyNumber"]);
  assert.equal(row.grade, "10");
  assert.equal(row.jerseyNumber, "5");
  assert.equal(row.position, "");
  const [invalid] = parseRosterText("15 | Alex Smith | center | 105", ["grade", "name", "position", "jerseyNumber"]);
  assert.equal(invalid.grade, "15");
  assert.equal(invalid.jerseyNumber, "105");
  assert.ok(validateImportRow(invalid));
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
