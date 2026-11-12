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
      ["2026-11-19T23:59:59", true, true],
      ["2026-11-20T00:00:00", true, false],
      ["2026-12-01T18:00:00", true, false],
      ["2026-11-08T23:59:59", true, false],
      ["2026-11-10T18:00:00", false, false],
    ]) {
      assert.equal(needsLineup({ gameDateTime: time, needsLineup: eligible, isTipInManaged: true }, now), expected, time);
    }
    assert.equal(needsLineup({ gameDateTime: "2026-11-09T23:59:59", needsLineup: true, isTipInManaged: true },
      new Date("2026-11-10T00:00:00")), false);
    assert.throws(() => needsLineup({ gameDateTime: "bad date", needsLineup: true, isTipInManaged: true }, now), /invalid game date/);
    assert.equal(needsLineup({ gameDateTime: "bad date", needsLineup: true, isTipInManaged: false }, now), false);
  } finally {
    if (previousZone === undefined) delete process.env.TZ;
    else process.env.TZ = previousZone;
  }
});

test("ten-day reminder window follows local calendar days across daylight saving and month boundaries", () => {
  const previousZone = process.env.TZ;
  process.env.TZ = "America/Chicago";
  try {
    for (const [now, lastDay, nextDay] of [
      ["2026-03-01T12:00:00", "2026-03-11T23:59:59", "2026-03-12T00:00:00"],
      ["2026-10-25T12:00:00", "2026-11-04T23:59:59", "2026-11-05T00:00:00"],
      ["2026-12-25T12:00:00", "2027-01-04T23:59:59", "2027-01-05T00:00:00"],
    ]) {
      assert.equal(needsLineup({ gameDateTime: lastDay, needsLineup: true, isTipInManaged: true }, new Date(now)), true, lastDay);
      assert.equal(needsLineup({ gameDateTime: nextDay, needsLineup: true, isTipInManaged: true }, new Date(now)), false, nextDay);
    }
  } finally {
    if (previousZone === undefined) delete process.env.TZ;
    else process.env.TZ = previousZone;
  }
});

test("games without a TipIn-managed home team never request lineups", () => {
  for (const isTipInManaged of [false, undefined, null]) {
    assert.equal(needsLineup({ gameDateTime: "2026-11-11T19:00:00", needsLineup: true, isTipInManaged }), false);
  }
});
