const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(path.join(__dirname, "..", "src", "scoreboard.cpp"), "utf8");

function mapping(field) {
  const expression = new RegExp(
    `${field} = clampInt\\(parseFixedInt\\(frame, (\\d+), (\\d+), ${field}\\), (\\d+), (\\d+)\\);`,
  );
  const match = source.match(expression);
  assert.ok(match, `Missing fixed-frame mapping for ${field}`);
  return match.slice(1).map(Number);
}

const fields = ["homeScore", "awayScore", "homeShots", "awayShots", "currentPeriod"];
const mappings = Object.fromEntries(fields.map((field) => [field, mapping(field)]));
assert.deepEqual(mappings.homeShots, [14, 2, 0, 199]);
assert.deepEqual(mappings.awayShots, [16, 2, 0, 199]);

// Exercise production offsets with the digit-filtering behavior of parseFixedInt.
function decode(frame, field, fallback = 0) {
  const [start, width, minimum, maximum] = mappings[field];
  assert.ok(frame.length >= start + width);
  const digits = frame.slice(start, start + width).replace(/[^0-9]/g, "");
  const value = digits.length ? Number(digits) : fallback;
  return Math.min(maximum, Math.max(minimum, value));
}

const captured = "15:29  s 3 21110 91" + " ".repeat(29) + "50";
assert.equal(captured.slice(13, 16), "110");
assert.deepEqual(
  Object.fromEntries(fields.map((field) => [field, decode(captured, field)])),
  { homeScore: 3, awayScore: 2, homeShots: 10, awayShots: 9, currentPeriod: 1 },
);

for (const adjacent of [" ", "0", "1", "9"]) {
  for (const shots of [" 0", " 9", "10", "19", "90", "99"]) {
    const frame = captured.slice(0, 13) + adjacent + shots + captured.slice(16);
    assert.equal(decode(frame, "homeShots"), Number(shots));
    assert.equal(decode(frame, "awayShots"), 9);
    assert.equal(decode(frame, "currentPeriod"), 1);
  }
}

const blank = captured.slice(0, 14) + "  " + captured.slice(16);
assert.equal(decode(blank, "homeShots", 10), 10);
console.log("Scoreboard shots mapping regression tests passed.");
