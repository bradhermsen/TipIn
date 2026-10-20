const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const source = ts.createSourceFile('App.tsx', fs.readFileSync(path.join(__dirname, '..', 'App.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const functions = new Map();
function collect(node) {
  if (ts.isFunctionDeclaration(node) && node.name) functions.set(node.name.text, node.getText(source));
  ts.forEachChild(node, collect);
}
collect(source);

function load(names, bindings = {}) {
  const context = vm.createContext(bindings);
  const code = names.map(name => {
    assert(functions.has(name), `Missing function: ${name}`);
    return functions.get(name).replace(/^export\s+/, '');
  }).join('\n');
  vm.runInContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText, context);
  return context;
}

const timeHelpers = ['parseClockToSeconds', 'formatSecondsToClock', 'computeElapsedTime', 'basicEventElapsedTime', 'getPeriodLengthMinutes'];
function eventBindings(overrides = {}) {
  const events = [];
  const errors = [];
  const calls = [];
  return {
    events, errors, calls,
    session: { role: 'GM', period: 1, periodLength: '17', clock: '17:00', homeTeam: 'Home', awayTeam: 'Away' },
    nextGame: { gameId: 'test-game' },
    isBasicMode: true,
    homeTeamId: 'home', awayTeamId: 'away',
    homeSkatersOnIce: 5, awaySkatersOnIce: 5,
    activePenalties: [],
    canControlGame: () => true,
    findPlayerName: () => 'Test Player',
    addEventToFeed: event => events.push(event),
    syncGoalEvent: event => calls.push(['goal', event]),
    syncPenaltyEvent: event => calls.push(['penalty', event]),
    syncShotEvent: event => calls.push(['shot', event]),
    setGoalModalError: error => errors.push(error),
    setPenaltyModalError: error => errors.push(error),
    setPlayerStatsById: () => {},
    setTeamPenaltyCountById: () => {},
    setActivePenalties: () => calls.push(['active-penalty']),
    updateScore: () => calls.push(['score']),
    adjustShots: (...args) => calls.push(['adjustShots', ...args]),
    autoReturnPulledGoalieIfNeeded: () => {},
    expireMinorOnPowerPlayGoal: () => calls.push(['expire-penalty']),
    closeGoalModal: () => calls.push(['close-goal']),
    closePenaltyModal: () => calls.push(['close-penalty']),
    normalizePenaltyType: value => value,
    getPenaltyDurationMinutes: () => 2,
    getPenaltyRule: () => ({ suspensionBehavior: 'none' }),
    shouldRequireRefereeNotes: () => false,
    shouldRequireSuspensionReview: () => false,
    ...overrides,
  };
}

test('legacy sessions retain their clock source; explicit modes survive gateway changes', () => {
  const context = load(['resolveGameMode']);
  assert.equal(context.resolveGameMode(undefined, false), 'clock');
  assert.equal(context.resolveGameMode(undefined, true), 'scoreboard');
  assert.equal(context.resolveGameMode('basic', true), 'basic');
  assert.equal(context.resolveGameMode('clock', true), 'clock');
  assert.equal(context.resolveGameMode('scoreboard', false), 'scoreboard');
  assert.equal(context.resolveGameMode('invalid', false), 'clock');
  const restored = JSON.parse(JSON.stringify({ gameMode: 'basic' }));
  assert.equal(context.resolveGameMode(restored.gameMode, true), 'basic');
});

test('Basic timestamps reject invalid values and convert remaining time once', () => {
  const context = load(timeHelpers);
  assert.equal(context.basicEventElapsedTime(17, '12:34'), '04:26');
  assert.equal(context.basicEventElapsedTime(15, '12:34'), '02:26');
  assert.equal(context.basicEventElapsedTime(17, '17:00'), '00:00');
  assert.equal(context.basicEventElapsedTime(17, '00:00'), '17:00');
  for (const value of ['', '1234', '5:69', '12:60', '17:01', '18:00', '-1:00']) {
    assert.equal(context.basicEventElapsedTime(17, value), null);
  }
});

test('Basic clock fields block seconds over 59 without shifting entered minutes', () => {
  const context = load([...timeHelpers, 'updateBasicClockPart']);
  let clock = context.updateBasicClockPart('', 'minutes', '5');
  clock = context.updateBasicClockPart(clock, 'seconds', '6');
  assert.equal(clock, '5:6');
  assert.equal(context.updateBasicClockPart(clock, 'seconds', '69'), '5:6');
  assert.equal(context.basicEventElapsedTime(17, clock), '11:54');
  clock = context.updateBasicClockPart(clock, 'seconds', '59');
  assert.equal(clock, '5:59');
  assert.equal(context.updateBasicClockPart(clock, 'minutes', '12'), '12:59');
  assert.equal(context.updateBasicClockPart(clock, 'seconds', ''), '5:');
  assert.equal(context.basicEventElapsedTime(17, '5:'), null);
  assert.equal(context.updateBasicClockPart(clock, 'seconds', '60'), clock);
});

test('Basic goals require time and use the entered period without penalty expiration', async () => {
  const bindings = eventBindings({
    goalModal: { scoringTeamId: 'home', scoringTeamName: 'Home', period: 2, clockRemaining: '', timeInPeriod: '', scorerId: 'player', assist1Id: '', assist2Id: '', strength: 'Power Play' },
    homeSkatersOnIce: 5, awaySkatersOnIce: 4,
  });
  const context = load([...timeHelpers, 'saveGoalEvent'], bindings);
  await context.saveGoalEvent();
  assert.equal(bindings.events.length, 0);
  assert.equal(bindings.calls.length, 0);
  assert.match(bindings.errors[0], /valid period and clock time/);
  bindings.goalModal.clockRemaining = '12:34';
  await context.saveGoalEvent();
  assert.equal(bindings.events[0].period, 2);
  assert.equal(bindings.events[0].timeInPeriod, '04:26');
  assert.equal(bindings.events[0].strength, 'Power Play');
  assert(!bindings.calls.some(call => call[0] === 'expire-penalty'));
  assert.equal(bindings.calls.find(call => call[0] === 'adjustShots')[4].period, 2);
});

test('Clock Mode goals retain their captured timestamp', async () => {
  const bindings = eventBindings({
    isBasicMode: false,
    goalModal: { scoringTeamId: 'home', scoringTeamName: 'Home', period: 1, clockRemaining: '12:34', timeInPeriod: '04:26', scorerId: 'player', assist1Id: '', assist2Id: '', strength: 'Even Strength' },
  });
  const context = load([...timeHelpers, 'saveGoalEvent'], bindings);
  await context.saveGoalEvent();
  assert.equal(bindings.events[0].timeInPeriod, '04:26');
  assert(bindings.calls.some(call => call[0] === 'goal'));
});

test('Basic penalties save event time without creating an active countdown', async () => {
  const bindings = eventBindings({
    penaltyModal: { penalizedTeamId: 'away', penalizedTeamName: 'Away', playerId: 'player', period: 2, clockRemaining: '', timeInPeriod: '', penaltyType: 'Minor', infraction: 'Tripping' },
  });
  const context = load([...timeHelpers, 'savePenaltyEvent'], bindings);
  await context.savePenaltyEvent();
  assert.equal(bindings.events.length, 0);
  bindings.penaltyModal.clockRemaining = '10:00';
  await context.savePenaltyEvent();
  assert.equal(bindings.events[0].period, 2);
  assert.equal(bindings.events[0].timeInPeriod, '07:00');
  assert.equal(bindings.events[0].durationMinutes, 2);
  assert(!bindings.calls.some(call => call[0] === 'active-penalty'));
});

test('Basic shots update period totals immediately without timed Shot events', () => {
  const emptyShots = () => ({ 1: 0, 2: 0, 3: 0, OT: 0 });
  const bindings = eventBindings({
    homeShotsByPeriod: emptyShots(),
    awayShotsByPeriod: emptyShots(),
    currentGoalieByTeam: {},
    homeGoaliePulled: false,
    awayGoaliePulled: false,
    setHomeShotsByPeriod: value => { context.homeShotsByPeriod = value; },
    setAwayShotsByPeriod: value => { context.awayShotsByPeriod = value; },
    setShotHistory: update => { history = update(history); },
  });
  let history = [];
  const context = load(['normalizeShotsByPeriod', 'transitionShotTotals', 'adjustShots'], bindings);
  context.adjustShots('away', 1);
  assert.equal(context.awayShotsByPeriod[1], 1);
  assert.equal(history.length, 1);
  assert.equal(history[0].period, 1);
  assert.equal(bindings.events.length, 0);
  assert(!bindings.calls.some(call => call[0] === 'shot'));
  context.adjustShots('away', -1);
  assert.equal(context.awayShotsByPeriod[1], 0);
  assert.equal(bindings.events.length, 0);
});

test('Basic Mode ignores expiry and stale gateway payloads', () => {
  const bindings = {
    gameModeRef: { current: 'basic' },
    stageRef: { current: 'gameDashboard' },
    periodExpiryHandledRef: { current: false },
    periodControllerStateRef: { current: 'IN_PROGRESS' },
    setIsClockRunning: () => assert.fail('Basic clock must not run'),
    setShowPeriodOverVerify: () => assert.fail('Basic clock must not expire'),
  };
  const context = load(['handleClockExpired', 'applyGatewayClockPayload'], bindings);
  context.handleClockExpired();
  context.applyGatewayClockPayload({ clock: '12:00', clockRunning: true });
  assert.equal(bindings.periodExpiryHandledRef.current, false);
});

test('only Clock Mode accepts tablet Start/Stop actions', () => {
  const calls = [];
  const bindings = {
    session: { role: 'GM', clock: '17:00', periodLength: '17' },
    gameMode: 'basic',
    canControlGame: () => true,
    isAnyModalOpen: false,
    isClockRunning: false,
    periodController: { state: 'NOT_STARTED' },
    setPeriodController: () => calls.push('period'),
    setIsClockRunning: value => calls.push(value ? 'running' : 'stopped'),
    parseClockDisplayToMs: () => 17 * 60 * 1000,
    penaltyClockPrevRemainingMsRef: { current: null },
    penaltyClockCarryMsRef: { current: 0 },
    gameClock: {
      remainingTimeMs: 17 * 60 * 1000,
      pause: () => calls.push('pause'),
      resume: () => calls.push('resume'),
      setDuration: () => calls.push('duration'),
      syncPausedRemaining: () => calls.push('sync'),
    },
  };
  const context = load(['getPeriodLengthMinutes', 'handleClockToggle'], bindings);
  context.handleClockToggle();
  assert.equal(calls.length, 0);
  context.gameMode = 'scoreboard';
  context.handleClockToggle();
  assert.equal(calls.length, 0);
  context.gameMode = 'clock';
  context.handleClockToggle();
  assert(calls.includes('resume'));
  assert(calls.includes('running'));
  calls.length = 0;
  context.isClockRunning = true;
  context.handleClockToggle();
  assert.deepEqual(calls, ['period', 'pause', 'stopped']);
});

test('start and recovery freeze the selected mode, including legacy sessions', () => {
  const context = load(['resolveGameMode', 'lockSessionGameMode']);
  const locked = context.lockSessionGameMode({ gameMode: 'basic', clock: '17:00' }, true);
  assert.equal(locked.gameMode, 'basic');
  assert.equal(locked.gameModeConfirmed, true);
  assert.equal(locked.gameModeLocked, true);
  assert.equal(context.lockSessionGameMode({ clock: '12:00' }, true).gameMode, 'scoreboard');
  assert.equal(context.lockSessionGameMode({ clock: '12:00' }, false).gameMode, 'clock');
});

test('source recovery requires a pause and never enters or leaves Basic Mode', () => {
  const context = load(['canRecoverClockSource']);
  assert.equal(context.canRecoverClockSource('clock', 'scoreboard', true), true);
  assert.equal(context.canRecoverClockSource('scoreboard', 'clock', true), true);
  assert.equal(context.canRecoverClockSource('clock', 'scoreboard', false), false);
  assert.equal(context.canRecoverClockSource('scoreboard', 'clock', false), false);
  assert.equal(context.canRecoverClockSource('basic', 'clock', true), false);
  assert.equal(context.canRecoverClockSource('clock', 'basic', true), false);
});

test('Verify Game requires selection and locked games reject mode edits', () => {
  const alerts = [];
  const stages = [];
  const patches = [];
  const context = load(['confirmGameVerification', 'selectVerifiedGameMode'], {
    session: { role: 'GM' },
    isGameModeLocked: false,
    Alert: { alert: (...args) => alerts.push(args) },
    setStage: stage => stages.push(stage),
    updateSession: patch => patches.push(patch),
    canEditVerifyGame: () => true,
  });
  context.confirmGameVerification();
  assert.equal(stages.length, 0);
  assert.equal(alerts[0][0], 'Select Game Mode');
  context.selectVerifiedGameMode('basic');
  assert.equal(patches[0].gameMode, 'basic');
  assert.equal(patches[0].gameModeConfirmed, true);
  context.session = { role: 'GM', ...patches[0] };
  context.confirmGameVerification();
  assert.deepEqual(stages, ['rosterVerify']);
  context.isGameModeLocked = true;
  context.selectVerifiedGameMode('clock');
  assert.equal(patches.length, 1);
});

test('start handler blocks an unconfirmed mode before any backend writes', async () => {
  const errors = [];
  const context = load(['handleConfirmStartGame'], {
    session: { role: 'GM' },
    nextGame: { gameId: 'test-game' },
    isGameModeLocked: false,
    setOfficialsError: error => errors.push(error),
    setShowStartConfirm: () => {},
  });
  await context.handleConfirmStartGame();
  assert.match(errors[0], /Select and confirm the Game Mode/);
});

test('saving gateway preferences preserves a locked Basic Mode', async () => {
  const patches = [];
  const stored = [];
  const context = load(['resolveGameMode', 'lockSessionGameMode', 'saveScoreboardSettings'], {
    session: { role: 'GM', gameMode: 'basic', gameModeLocked: true, gameModeConfirmed: true },
    gameMode: 'basic',
    isGameModeLocked: true,
    clockRunningRef: { current: false },
    canControlGame: () => true,
    scoreboardGatewaySettings: { enabled: false },
    scoreboardSettingsDraft: { enabled: true, host: 'gateway.local', port: '80', tokenSecret: 'test-only' },
    normalizeScoreboardHost: value => value,
    normalizeScoreboardPort: value => value,
    updateSession: patch => patches.push(patch),
    setScoreboardGatewaySettings: () => {},
    setScoreboardSettingsDraft: () => {},
    setShowScoreboardSettingsModal: () => {},
    storageSetItem: async (key, value) => stored.push([key, value]),
    SCOREBOARD_GATEWAY_SETTINGS_KEY: 'test-gateway-settings',
    trace: () => {},
  });
  await context.saveScoreboardSettings();
  assert.equal(patches[0].gameMode, 'basic');
  assert.equal(patches[0].gameModeLocked, true);
  assert.equal(stored.length, 1);
});

test('recovery rechecks running state after confirmation and cannot bypass Basic lock', () => {
  const alerts = [];
  const context = load(['canRecoverClockSource', 'requestClockSourceRecovery'], {
    session: { role: 'GM', gameMode: 'scoreboard' },
    nextGame: { gameId: 'test-game' },
    canControlGame: () => true,
    stage: 'gameDashboard',
    stageRef: { current: 'gameDashboard' },
    gameHasEnded: false,
    gameModeRef: { current: 'scoreboard' },
    clockRunningRef: { current: false },
    Alert: { alert: (...args) => alerts.push(args) },
  });
  context.requestClockSourceRecovery();
  assert.equal(alerts[0][0], 'Recover Clock Source?');
  context.clockRunningRef.current = true;
  alerts[0][2][1].onPress();
  assert.equal(alerts[1][0], 'Recovery Cancelled');
  context.clockRunningRef.current = false;
  context.gameModeRef.current = 'basic';
  context.requestClockSourceRecovery();
  assert.equal(alerts[2][0], 'Recovery Unavailable');
});

test('paused source recovery preserves the latest clock and saves a locked session', () => {
  const alerts = [];
  const saved = [];
  const sessions = [];
  const currentSession = { role: 'GM', gameMode: 'scoreboard', clock: '10:25', period: 2, homeScore: 1 };
  const context = load(['resolveGameMode', 'lockSessionGameMode', 'canRecoverClockSource', 'requestClockSourceRecovery'], {
    session: { ...currentSession, clock: '11:00' },
    sessionRef: { current: currentSession },
    nextGame: { gameId: 'test-game' },
    canControlGame: () => true,
    stage: 'gameDashboard',
    stageRef: { current: 'gameDashboard' },
    gameHasEnded: false,
    gameModeRef: { current: 'scoreboard' },
    clockRunningRef: { current: false },
    Alert: { alert: (...args) => alerts.push(args) },
    gameClock: { pause: () => {} },
    setIsClockRunning: () => {},
    clearScheduledScoreboardReconnect: () => {},
    disconnectScoreboardSocket: () => {},
    setSession: session => sessions.push(session),
    setScoreboardGatewaySettings: () => {},
    setShowScoreboardSettingsModal: () => {},
    buildActiveGameSnapshot: (session, game) => ({ session, nextGame: game }),
    persistActiveGameSnapshot: snapshot => saved.push(snapshot),
  });
  context.requestClockSourceRecovery();
  alerts[0][2][1].onPress();
  assert.equal(sessions[0].gameMode, 'clock');
  assert.equal(sessions[0].clock, '10:25');
  assert.equal(sessions[0].period, 2);
  assert.equal(sessions[0].homeScore, 1);
  assert.equal(sessions[0].gameModeLocked, true);
  assert.equal(saved[0].session.gameMode, 'clock');
  assert.equal(saved[0].nextGame.gameId, 'test-game');
});

test('Basic live status publishes period and mode without inferred manpower', async () => {
  const requests = [];
  const context = load(['syncLiveStatus'], {
    session: { period: 2 },
    gameMode: 'basic',
    isBasicMode: true,
    scoreboardConnectionState: 'disconnected',
    activeApiBase: 'https://test.invalid/api',
    fetch: async (url, options) => { requests.push({ url, payload: JSON.parse(options.body) }); return { ok: true }; },
    trace: () => assert.fail('Successful sync should not report failure'),
  });
  await context.syncLiveStatus('test-game', true, false, 5, 4, ['home-player'], ['away-player']);
  const payload = requests[0].payload;
  assert.equal(payload.gameMode, 'basic');
  assert.equal(payload.currentPeriod, 2);
  assert.equal(payload.clockTrackingAvailable, false);
  assert.equal(payload.homeSkatersOnIce, null);
  assert.equal(payload.awaySkatersOnIce, null);
  assert.equal(payload.homeOnPowerPlay, false);
  assert.deepEqual(payload.homeStarterIds, ['home-player']);
});

test('Clock and Scoreboard live status retain existing values and report connection availability', async () => {
  const requests = [];
  const context = load(['syncLiveStatus'], {
    session: { period: 3 }, gameMode: 'clock', isBasicMode: false,
    scoreboardConnectionState: 'disconnected', activeApiBase: 'https://test.invalid/api',
    fetch: async (url, options) => { requests.push(JSON.parse(options.body)); return { ok: true }; },
    trace: () => {},
  });
  await context.syncLiveStatus('test-game', true, false, 5, 4, [], []);
  assert.equal(requests[0].homeOnPowerPlay, true);
  assert.equal(requests[0].awaySkatersOnIce, 4);
  assert.equal(requests[0].clockTrackingAvailable, true);
  context.gameMode = 'scoreboard';
  await context.syncLiveStatus('test-game', false, false, 5, 5, [], []);
  assert.equal(requests[1].clockTrackingAvailable, false);
  context.scoreboardConnectionState = 'connected';
  await context.syncLiveStatus('test-game', false, false, 5, 5, [], []);
  assert.equal(requests[2].clockTrackingAvailable, true);
});

test('failed live-status HTTP responses are traced rather than treated as success', async () => {
  const failures = [];
  const context = load(['syncLiveStatus'], {
    session: { period: 1 }, gameMode: 'basic', isBasicMode: true,
    scoreboardConnectionState: 'disconnected', activeApiBase: 'https://test.invalid/api',
    fetch: async () => ({ ok: false, status: 500 }),
    trace: (name, details) => failures.push({ name, details }),
  });
  await context.syncLiveStatus('test-game', false, false, 5, 5, [], []);
  assert.equal(failures[0].name, 'live-status.sync.failed');
  assert.match(failures[0].details.message, /500/);
});