const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const vm = require("node:vm");
const ts = require("typescript");

const source = ts.createSourceFile("App.tsx", fs.readFileSync(path.join(__dirname, "..", "App.tsx"), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const functions = new Map();
function collect(node) {
  if (ts.isFunctionDeclaration(node) && node.name) functions.set(node.name.text, node.getText(source));
  ts.forEachChild(node, collect);
}
collect(source);
function load(names, bindings) {
  const context = vm.createContext(bindings);
  vm.runInContext(ts.transpileModule(names.map(name => functions.get(name)).join("\n"), {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText, context);
  return context;
}

test("early login preserves the server message and title for HTTP 425 and legacy HTTP 200", async () => {
  const message = "Your access code is valid.\n\nTeam: Winona\nLevel: Varsity\nType: Girls\nOpponent: South Central\nGame time: Saturday, November 14 at 1:00 PM CST\nLogin opens: Saturday, November 14 at 9:00 AM CST";
  for (const status of [425, 200]) {
    const context = load(["fetchNextGameForTeam"], {
      activeApiBase: "https://fixture/api", trace: () => {}, summarizePayload: () => {},
      fetch: async () => ({
        ok: status === 200, status,
        json: async () => ({ error: "login_too_early", message, startTime: "2026-11-14T13:00:00" }),
      }),
      normalizeNextGame: () => { throw new Error("Early-login errors must not be interpreted as game records."); },
    });
    const result = await context.fetchNextGameForTeam("home");
    assert.equal(result.nextGame, null);
    assert.equal(result.closedMessage, message);
    assert.equal(result.closedTitle, "Login Not Open Yet");
  }
});

test("early-login notice reaches the login panel without replacing team and opening-time details", async () => {
  const state = {};
  const setter = key => value => { state[key] = value; };
  const message = "Team: Winona\nLevel: Varsity\nType: Girls\nOpponent: South Central\nLogin opens: Saturday, November 14 at 9:00 AM CST";
  const context = load(["loadNextGame", "handleLoginSuccess"], {
    session: null, activeApiBase: "https://fixture/api", trace: () => {},
    setSession: () => {}, setGameStartedAtIso: () => {}, setGameHasEnded: () => {},
    setStage: setter("stage"), setRestoreStatus: () => {},
    setError: setter("error"), setLoginErrorTitle: setter("title"),
    loadActiveGameSnapshot: async () => null, loadActiveGameResume: async () => null,
    hasActiveGameMarker: async () => false,
    fetchTeamsForUser: async () => [{ teamId: "home" }], getTeamId: team => team.teamId,
    fetchNextGameForTeam: async () => ({ nextGame: null, closedMessage: message, closedTitle: "Login Not Open Yet" }),
    setIsNextGameLoading: () => {}, setIsRefreshingNextGame: () => {},
    setNextGame: () => {}, setIsClosedGameNotice: () => {}, setNextGameMessage: () => {},
  });
  await context.handleLoginSuccess({ userId: "user", role: "GM" }, "GM-FIXTURE");
  assert.equal(state.stage, "login");
  assert.equal(state.title, "Login Not Open Yet");
  assert.equal(state.error, message);
});

test("login displays each notice once and keeps restore diagnostics off the screen", () => {
  let loginView;
  function find(node) {
    if (ts.isJsxElement(node) && node.children.some(child =>
      ts.isJsxExpression(child) && child.expression?.getText(source).startsWith("error ?"))) {
      loginView = node;
    }
    ts.forEachChild(node, find);
  }
  find(source);
  assert.ok(loginView, "Login notice container must exist.");
  const notices = loginView.children
    .filter(child => /loginErrorPanel|nextGameMessage|restoreStatus/.test(child.getText(source)))
    .map(child => child.getText(source)).join("\n");
  const script = ts.transpileModule(`(<>${notices}</>)`, {
    compilerOptions: { jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const message = "Team: Winona\nLevel: Varsity\nType: Girls\nLogin opens: Saturday at 9:00 AM CST";
  for (const [error, nextGameMessage] of [[message, message], [message, ""], ["", message], ["", ""]]) {
    const rendered = vm.runInNewContext(script, {
      React: { createElement: (_type, _props, ...children) => children.filter(child => typeof child === "string").join("") },
      View: "View", Text: "Text", styles: {}, error, nextGameMessage,
      loginErrorTitle: "Login Not Open Yet", restoreStatus: "none",
    });
    assert.equal(rendered.split(message).length - 1, error || nextGameMessage ? 1 : 0);
    assert.doesNotMatch(rendered, /Restore status:/);
    if (error) assert.match(rendered, /Login Not Open Yet/);
  }
});

test("closed games retain their existing notice instead of the early-login title", async () => {
  const context = load(["fetchNextGameForTeam"], {
    activeApiBase: "https://fixture/api", trace: () => {}, summarizePayload: () => {},
    fetch: async () => ({ ok: false, status: 410, json: async () => ({ isClosed: true, message: "This game is closed." }) }),
  });
  const result = await context.fetchNextGameForTeam("home");
  assert.equal(result.closedMessage, "This game is closed.");
  assert.equal(result.closedTitle, undefined);
});

test("saved lineup request uses explicit login code before React session updates", async () => {
  let headers;
  const lineup = { version: 5, locked: true, participantIds: ["a"], starterIds: ["a"], signedBy: "Coach" };
  const context = load(["fetchSavedLineup"], {
    activeApiBase: "https://fixture/api", session: null,
    fetch: async (url, options) => { headers = options.headers; return { ok: true, json: async () => lineup }; },
  });
  const saved = await context.fetchSavedLineup("game", "home", "GM-FIXTURE");
  assert.equal(headers["x-TipIn-access-code"], "GM-FIXTURE");
  assert.equal(saved.locked, true);
  assert.equal(saved.version, 5);
  assert.equal(saved.signedBy, "Coach");
});

test("lineup read errors are explicit instead of appearing unsigned", async () => {
  for (const response of [
    { ok: false, status: 401 }, { ok: false, status: 403 }, { ok: false, status: 500 },
    { ok: true, json: async () => ({ error: "Legacy 200 error" }) },
    { ok: true, json: async () => ({ version: 5, locked: true, participantIds: [], starterIds: [1] }) },
  ]) {
    const context = load(["fetchSavedLineup"], { activeApiBase: "", fetch: async () => response });
    await assert.rejects(() => context.fetchSavedLineup("game", "home", "GM-FIXTURE"), /saved lineup/);
  }
});

function rosterBindings(saved, overrides = {}) {
  const state = {};
  const setter = key => value => { state[key] = value; };
  const roster = [
    { playerId: "A", isActive: true, isGoalie: true },
    { playerId: "B", isActive: true, isGoalie: false },
    { playerId: "C", isActive: true, isGoalie: false },
  ];
  return {
    state, startersByTeam: { home: ["B"] },
    setRosterError: setter("error"), setIsRosterLoading: setter("loading"),
    setIsRosterStatusLoaded: setter("ready"), setRostersByTeam: setter("rosters"),
    setCoachesByTeam: setter("coaches"), setMediaOutletRecipients: setter("media"),
    setStartersByTeam: setter("starters"), setLineupByTeam: setter("lineups"),
    setHeadCoachSignatures: setter("signatures"), setCurrentGoalieByTeam: setter("goalies"),
    fetchRosterForTeam: async () => roster,
    fetchCoachesForTeam: async () => [], fetchMediaOutlets: async () => [],
    fetchSavedLineup: async (game, team, code) => { assert.equal(code, "GM-FIXTURE"); return saved; },
    trace: () => {}, ...overrides,
  };
}

test("initial and refresh loads apply signed participants, starters, signature and lock", async () => {
  for (const refresh of [false, true]) {
    const bindings = rosterBindings({ version: 5, locked: true, participantIds: ["a", "b"], starterIds: ["a"], signedBy: "Coach" });
    const context = load(["loadRosterAndCoaches"], bindings);
    await context.loadRosterAndCoaches({ gameId: "game", homeTeamId: "home", awayTeamId: "away" }, "GM-FIXTURE", refresh);
    const state = bindings.state;
    assert.equal(state.ready, true);
    assert.equal(state.loading, false);
    assert.equal(state.rosters.home[2].isActive, false);
    assert.equal(state.starters.home.join(","), "A");
    assert.equal(state.goalies.home, "A");
    assert.equal(state.signatures.home, "Coach");
    assert.equal(state.lineups.home.locked, true);
    assert.equal(state.lineups.home.version, 5);
  }
});

test("no saved lineup preserves roster defaults and local starter draft on refresh", async () => {
  const bindings = rosterBindings({ version: 0, locked: false, participantIds: [], starterIds: [] });
  const context = load(["loadRosterAndCoaches"], bindings);
  await context.loadRosterAndCoaches({ gameId: "game", homeTeamId: "home", awayTeamId: "away" }, "GM-FIXTURE", true);
  assert.equal(bindings.state.rosters.home.every(p => p.isActive), true);
  assert.equal(bindings.state.starters.home.join(","), "B");
  assert.equal(bindings.state.lineups.home.locked, false);
});

test("lightweight recovery roster load preserves the restored goalie instead of selecting the starter", async () => {
  const bindings = rosterBindings({ version: 5, locked: true, participantIds: ["a", "b"], starterIds: ["a"] });
  const context = load(["loadRosterAndCoaches"], bindings);
  const restored = { home: "backup", away: null };
  await context.loadRosterAndCoaches({ gameId: "game", homeTeamId: "home", awayTeamId: "away" }, "GM-FIXTURE", false, restored);
  assert.equal(bindings.state.goalies, restored);
  assert.equal(bindings.state.goalies.home, "backup");
  assert.equal(bindings.state.goalies.away, null);
});

test("failed refresh cannot mark roster status loaded or replace it with unsigned defaults", async () => {
  const bindings = rosterBindings(null, { fetchSavedLineup: async () => { throw new Error("Unable to load saved lineup (403)."); } });
  const context = load(["loadRosterAndCoaches"], bindings);
  await context.loadRosterAndCoaches({ gameId: "game", homeTeamId: "home", awayTeamId: "away" }, "GM-FIXTURE", true);
  assert.equal(bindings.state.ready, false);
  assert.equal(bindings.state.lineups, undefined);
  assert.match(bindings.state.error, /403/);
});

test("pull-to-refresh reloads authoritative lineup status with the current access code", async () => {
  const calls = [];
  const context = load(["refreshRosterAndCoaches"], {
    nextGame: { gameId: "game" }, session: { code: "GM-FIXTURE" },
    loadRosterAndCoaches: async (...args) => calls.push(args),
    requestAnimationFrame: () => {},
  });
  await context.refreshRosterAndCoaches();
  assert.equal(calls[0][1], "GM-FIXTURE");
  assert.equal(calls[0][2], true);
});

test("login forwards the entered code even though setSession has not updated the render", async () => {
  const calls = [];
  const context = load(["handleLoginSuccess"], {
    session: null, activeApiBase: "https://fixture/api", trace: () => {},
    setSession: () => {}, setGameStartedAtIso: () => {}, setGameHasEnded: () => {},
    setStage: () => {}, setRestoreStatus: () => {}, setError: () => {},
    loadActiveGameSnapshot: async () => null, loadActiveGameResume: async () => null,
    hasActiveGameMarker: async () => false,
    loadNextGame: async (...args) => { calls.push(args); return { status: "games" }; },
  });
  await context.handleLoginSuccess({ userId: "user", role: "GM" }, "GM-FIXTURE");
  assert.equal(calls[0][0], "user");
  assert.equal(calls[0][2], "GM-FIXTURE");
});

test("unknown and locked lineup states cannot be edited or approved on the tablet", async () => {
  for (const ready of [false, true]) {
    const errors = [];
    const context = load(["toggleStarter", "togglePlayerActive", "goToOfficialsFromRoster"], {
      isRosterStatusLoaded: ready, lineupByTeam: { home: { locked: true } },
      setRosterError: e => errors.push(e),
    });
    context.toggleStarter("home", "A");
    context.togglePlayerActive("home", "A");
    assert.equal(errors.length, 2);
    assert(errors.every(e => ready ? /locked/.test(e) : /saved lineup status/.test(e)));
    if (!ready) {
      await context.goToOfficialsFromRoster();
      assert.match(errors[2], /before continuing/);
    }
  }
});
