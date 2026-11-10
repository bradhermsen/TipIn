import test from "node:test";
import assert from "node:assert/strict";
import { needsLineup } from "../js/ui.js";

test("lineup reminders use the coach's local calendar date, not UTC midnight", () => {
  const previousZone = process.env.TZ;
  process.env.TZ = "America/Chicago";
  try {
    const now = new Date("2026-11-10T03:25:00Z");
    assert.equal(now.getDate(), 9);
    assert.equal(now.getUTCDate(), 10);
    for (const [time, eligible, expected] of [
      ["2026-11-09T08:00:00", true, true],
      ["2026-11-09T21:30:00", true, true],
      ["2026-11-10T18:00:00", true, true],
      ["2026-11-08T23:59:59", true, false],
      ["2026-11-10T18:00:00", false, false],
    ]) {
      assert.equal(needsLineup({ gameDateTime: time, needsLineup: eligible }, now), expected, time);
    }
    assert.equal(needsLineup({ gameDateTime: "2026-11-09T23:59:59", needsLineup: true },
      new Date("2026-11-10T00:00:00")), false);
    assert.throws(() => needsLineup({ gameDateTime: "bad date", needsLineup: true }, now), /invalid game date/);
  } finally {
    if (previousZone === undefined) delete process.env.TZ;
    else process.env.TZ = previousZone;
  }
});
