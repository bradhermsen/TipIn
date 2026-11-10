const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const source = ts.createSourceFile('App.tsx', fs.readFileSync(path.join(__dirname, '..', 'App.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const functions = new Map();
let summaryMemo;
function collect(node) {
  if (ts.isFunctionDeclaration(node) && node.name) functions.set(node.name.text, node.getText(source));
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'shotsByGoalie') {
    summaryMemo = node.initializer.arguments[0].getText(source);
  }
  ts.forEachChild(node, collect);
}
collect(source);
function load(names, bindings = {}, extra = '') {
  const context = vm.createContext(bindings);
  vm.runInContext(ts.transpileModule(names.map(name => functions.get(name).replace(/^export\s+/, '')).join('\n') + extra, {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText, context);
  return context;
}

const rosters = {
  home: [
    { playerId: 'cam', fullName: 'Cam Johnson', isGoalie: true },
    { playerId: 'backup', fullName: 'Backup Goalie', isGoalie: true },
  ],
  away: [{ playerId: 'landon', fullName: 'Landon Pierce', isGoalie: true }],
};
const starters = { home: ['cam'], away: ['landon'] };
const recoveryHelpers = ['restoreCurrentGoalies', 'normalizeGoalieName', 'parseClockToSeconds'];

test('legacy restart restores both starting goalies instead of leaving shot attribution unknown', () => {
  const c = load(recoveryHelpers);
  const restored = c.restoreCurrentGoalies(undefined, rosters, starters, []);
  assert.equal(restored.home, 'cam');
  assert.equal(restored.away, 'landon');
  assert.equal(c.restoreCurrentGoalies({ home: 'backup', away: null }, rosters, starters, []).home, 'backup');
  assert.equal(c.restoreCurrentGoalies({ home: 'backup', away: null }, rosters, starters, []).away, null);
});

test('legacy recovery replays goalie substitutions but does not replace a pulled goalie with the starter', () => {
  const c = load(recoveryHelpers);
  const change = {
    eventType: 'Goalie', teamId: 'home', period: 2, timeInPeriod: '02:00',
    goalieChangeKind: 'change', goalieOldName: 'Cam Johnson', goalieNewName: 'Backup Goalie',
    createdAtIso: '2026-01-01T00:01:00Z',
  };
  const pulled = { ...change, timeInPeriod: '03:00', goalieChangeKind: 'pulled', createdAtIso: '2026-01-01T00:02:00Z' };
  assert.equal(c.restoreCurrentGoalies(undefined, rosters, starters, [pulled, change]).home, 'backup');
  assert.equal(c.restoreCurrentGoalies(undefined, rosters, starters, [{ ...change, goalieNewName: 'None' }]).home, null);
  assert.equal(c.restoreCurrentGoalies(undefined, rosters, {}, []).home, null);
});

test('full and lightweight snapshots persist goalie identity and pulled flags', async () => {
  const writes = new Map();
  const state = {
    currentGoalieByTeam: { home: 'backup', away: 'landon' },
    officials: [], activeRosterTeam: 'home', rostersByTeam: rosters,
    coachesByTeam: {}, startersByTeam: starters,
    homeShotsByPeriod: {}, awayShotsByPeriod: {}, shotHistory: [], eventFeed: [],
    playerStatsById: {}, teamPenaltyCountById: {}, activePenalties: [],
    homeGoaliePulled: true, awayGoaliePulled: false, penaltyShotActive: false,
    gameStartedAtIso: '2026-01-01', periodController: { state: 'IN_PROGRESS' },
    ACTIVE_GAME_RESUME_KEY: 'lean', ACTIVE_GAME_SNAPSHOT_KEY: 'full',
    storageSetItem: async (key, value) => writes.set(key, JSON.parse(value)),
    markActiveGame: async () => {}, trace() {},
  };
  const c = load(['buildActiveGameSnapshot', 'persistActiveGameSnapshot'], state);
  const snapshot = c.buildActiveGameSnapshot({ userId: 'user', code: 'code' }, { gameId: 'game' });
  await c.persistActiveGameSnapshot(snapshot);
  for (const key of ['lean', 'full']) {
    assert.deepEqual(writes.get(key).currentGoalieByTeam, state.currentGoalieByTeam);
    assert.equal(writes.get(key).homeGoaliePulled, true);
    assert.equal(writes.get(key).awayGoaliePulled, false);
  }
  assert.match(functions.get('restoreActiveGameSnapshot'), /setCurrentGoalieByTeam\(restoreCurrentGoalies/);
  assert.match(functions.get('handleLoginSuccess'), /loadRosterAndCoaches\(resumeSnapshot.nextGame, accessCode, false, resumeSnapshot.currentGoalieByTeam\)/);
});

test('full snapshot recovery restores the saved goalie and pulled state into the running app', () => {
  const state = {};
  const bindings = {
    scoreboardGatewaySettings: { enabled: true }, activeApiBase: 'https://test/api',
    lockSessionGameMode: session => session, normalizeShotsByPeriod: shots => shots,
    periodControllerStateRef: { current: '' },
  };
  for (const key of [
    'Session', 'NextGame', 'ActiveRosterTeam', 'RostersByTeam', 'CoachesByTeam',
    'StartersByTeam', 'HeadCoachSignatures', 'Officials', 'HomeShotsByPeriod', 'AwayShotsByPeriod',
    'ShotHistory', 'EventFeed', 'CurrentGoalieByTeam', 'PlayerStatsById', 'TeamPenaltyCountById',
    'ActivePenalties', 'HomeGoaliePulled', 'AwayGoaliePulled', 'PenaltyShotActive',
    'GameStartedAtIso', 'PeriodController', 'GameHasEnded', 'Stage',
  ]) bindings[`set${key}`] = value => { state[key] = value; };
  const c = load([...recoveryHelpers, 'restorePeriodController', 'restoreActiveGameSnapshot'], bindings);
  c.restoreActiveGameSnapshot({
    session: { period: 2 }, nextGame: {}, rostersByTeam: rosters, startersByTeam: starters,
    eventFeed: [], activePenalties: [], shotHistory: [],
    currentGoalieByTeam: { home: 'backup', away: 'landon' },
    homeGoaliePulled: true, awayGoaliePulled: false,
  }, 'code');
  assert.equal(state.CurrentGoalieByTeam.home, 'backup');
  assert.equal(state.CurrentGoalieByTeam.away, 'landon');
  assert.equal(state.HomeGoaliePulled, true);
  assert.equal(state.AwayGoaliePulled, false);
});

function summaryContext(shots, events = []) {
  return load(['normalizeGoalieName', 'resolveShotGoalieName', 'getAbsoluteElapsedSeconds', 'parseClockToSeconds', 'computeElapsedTime', 'formatSecondsToClock', 'getPeriodLengthMinutes'], {
    session: { homeTeam: 'Riverbend', awayTeam: 'Spring Grove', period: 3, clock: '00:00', periodLength: '17' },
    summaryPeriodLengthSeconds: 1020,
    homeTeamId: 'home', awayTeamId: 'away',
    rostersByTeam: rosters, startingGoalieByTeam: { home: 'cam', away: 'landon' },
    currentGoalieByTeam: {}, safeShotHistory: shots, safeEventFeed: events,
  }, `\nvar summarize = ${summaryMemo};`);
}

test('full-game starters receive all 10 and 14 shots rather than duplicate unknown rows', () => {
  const shots = [];
  for (const [team, totals] of [['home', [5, 4, 1]], ['away', [6, 8, 0]]]) {
    totals.forEach((count, i) => {
      for (let n = 0; n < count; n++) shots.push({
        goalieTeamId: team, goalieTeamName: team === 'home' ? 'Riverbend' : 'Spring Grove',
        goalieId: null, goalieName: 'Unknown Goalie', period: i + 1, delta: 1,
      });
    });
  }
  const c = summaryContext(shots);
  const result = c.summarize();
  assert.equal(result.length, 2);
  const cam = result.find(row => row.goalieName === 'Cam Johnson');
  const landon = result.find(row => row.goalieName === 'Landon Pierce');
  assert.deepEqual(JSON.parse(JSON.stringify(cam.totals)), { 1: 5, 2: 4, 3: 1, OT: 0 });
  assert.deepEqual(JSON.parse(JSON.stringify(landon.totals)), { 1: 6, 2: 8, 3: 0, OT: 0 });
  assert.equal(cam.totalShotsAgainst, 10);
  assert.equal(landon.totalShotsAgainst, 14);
  assert.equal(cam.totalTimeInNetSeconds, 3060);
  assert.equal(landon.totalTimeInNetSeconds, 3060);
});

test('unknown shots stay unresolved with goalie changes or no starter; empty-net shots are never reassigned', () => {
  const c = load(['resolveShotGoalieName', 'normalizeGoalieName']);
  const unknown = { goalieName: 'Unknown Goalie', goalieId: null };
  assert.equal(c.resolveShotGoalieName(unknown, 'Cam Johnson', true), 'Unknown Goalie');
  assert.equal(c.resolveShotGoalieName(unknown, null, false), 'Unknown Goalie');
  assert.equal(c.resolveShotGoalieName({ goalieName: 'Empty Net' }, 'Cam Johnson', false), null);
  assert.equal(c.resolveShotGoalieName({ goalieName: 'Backup Goalie', goalieId: 'backup' }, 'Cam Johnson', false), 'Backup Goalie');
});
