import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

async function moduleUrl(relative, replacements = {}) {
  let source = ts.transpileModule(await readFile(new URL(relative, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  for (const [from, to] of Object.entries(replacements)) source = source.replaceAll(`"${from}"`, JSON.stringify(to));
  return "data:text/javascript;base64," + Buffer.from(source).toString("base64");
}

const calendarUrl = await moduleUrl("../services/gameCalendar.ts");
const { centralDayKey, isScheduledToday } = await import(calendarUrl);
const apiStub = "data:text/javascript;base64," + Buffer.from(`
  export const getGameSummaryMobile=async()=>({goals:[]});
  export const getGameById=async()=>null, getGames=async()=>[], getOrganizations=async()=>[],
    getSeasons=async()=>[], getTeamNextGame=async()=>null, getTeams=async()=>[], getTeamsByOrganization=async()=>[];
`).toString("base64");
const serviceUrl = await moduleUrl("../services/gameViewService.ts", {
  "../api/gameViewApi": apiStub, "./gameCalendar": calendarUrl,
});
const { fetchTodaysGames, fetchNextGamesByTeam } = await import(serviceUrl);

test("today follows Central midnight, not the fan's timezone or UTC midnight", () => {
  assert.equal(centralDayKey(new Date("2026-11-11T05:59:59Z")), "2026-11-10");
  assert.equal(centralDayKey(new Date("2026-11-11T06:00:00Z")), "2026-11-11");
  assert.equal(centralDayKey("2026-11-10T23:30:00"), "2026-11-10");
  assert.equal(centralDayKey("2026-11-11T00:30:00Z"), "2026-11-10");
  assert.equal(centralDayKey(new Date("2026-03-09T04:59:59Z")), "2026-03-08");
  assert.equal(centralDayKey(new Date("2026-03-09T05:00:00Z")), "2026-03-09");
  assert.throws(() => centralDayKey("bad date"), /Invalid game calendar date/);
});

test("today includes scheduled games only, even when scheduled start time has passed", () => {
  const now = new Date("2026-11-10T22:00:00Z");
  for (const status of ["Scheduled", " SCHEDULED "])
    assert.equal(isScheduledToday({ status, gameDateTime: "2026-11-10T09:00:00" }, now), true);
  for (const status of ["In Progress", "Live", "Final", "Cancelled", "Canceled", "Postponed", "PPD", "Closed", "Completed"])
    assert.equal(isScheduledToday({ status, gameDateTime: "2026-11-10T19:00:00" }, now), false);
  for (const date of ["2026-11-09T19:00:00", "2026-11-11T19:00:00"])
    assert.equal(isScheduledToday({ status: "Scheduled", gameDateTime: date }, now), false);
});

const filters = { seasonId: "season", organizationId: "", leagueId: "", teamLevel: "", teamType: "" };
const now = new Date("2026-11-10T22:00:00Z");
function snapshot() {
  return {
    seasonId: "season", organizations: [], seasons: [],
    teams: [
      { teamId: "home", name: "Home", seasonId: "season", levelName: "Varsity", teamType: "Boys", leagueId: "league" },
      { teamId: "away", name: "Away", seasonId: "season", levelName: "Varsity", teamType: "Boys", leagueId: "league" },
      { teamId: "girls", name: "Girls", seasonId: "season", levelName: "JV", teamType: "Girls" },
    ],
    games: [
      { gameId: "late", homeTeamId: "home", awayTeamId: "away", homeTeamName: "Home", awayTeamName: "Away", status: "Scheduled", gameDateTime: "2026-11-10T19:00:00", isTipInManaged: true },
      { gameId: "early", homeTeamId: "home", awayTeamId: "away", homeTeamName: "Home", awayTeamName: "Away", status: "Scheduled", gameDateTime: "2026-11-10T09:00:00", isTipInManaged: false },
      { gameId: "girls-game", homeTeamId: "girls", awayTeamId: "other", homeTeamName: "Girls", awayTeamName: "Other", status: "Scheduled", gameDateTime: "2026-11-10T18:00:00" },
    ],
  };
}

test("today uses existing clickable card model, once per game and in scheduled-time order", async () => {
  const cards = await fetchTodaysGames(filters, snapshot(), now);
  assert.deepEqual(cards.map((g) => g.gameId), ["early", "girls-game", "late"]);
  assert.ok(cards.every((g) => !g.isLive && g.homeScore === undefined && g.awayScore === undefined));
  assert.equal(cards.find((g) => g.gameId === "late").isTipInManaged, true);
  assert.equal(cards.find((g) => g.gameId === "early").isTipInManaged, false);
});

test("today respects the same season, level, league and type filters", async () => {
  for (const extra of [{ teamType: "Boys" }, { teamLevel: "Varsity" }, { leagueId: "league" }]) {
    assert.deepEqual((await fetchTodaysGames({ ...filters, ...extra }, snapshot(), now)).map((g) => g.gameId), ["early", "late"]);
  }
  const scoped = snapshot();
  scoped.teams = scoped.teams.filter((t) => t.teamId === "girls");
  assert.deepEqual((await fetchTodaysGames(filters, scoped, now)).map((g) => g.gameId), ["girls-game"]);
});

test("status transitions move a game from today to live and then out of both sections", async () => {
  const data = snapshot();
  data.games = [data.games[0]];
  assert.equal((await fetchTodaysGames(filters, data, now)).length, 1);
  assert.equal((await fetchNextGamesByTeam(filters, data)).length, 0);
  data.games[0].status = "In Progress";
  assert.equal((await fetchTodaysGames(filters, data, now)).length, 0);
  assert.equal((await fetchNextGamesByTeam(filters, data)).length, 1);
  data.games[0].status = "Final";
  assert.equal((await fetchTodaysGames(filters, data, now)).length, 0);
  assert.equal((await fetchNextGamesByTeam(filters, data)).length, 0);
});
