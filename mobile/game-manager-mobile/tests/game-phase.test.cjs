const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const text = fs.readFileSync(path.join(__dirname, '..', 'App.tsx'), 'utf8');
const source = ts.createSourceFile('App.tsx', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const functions = new Map();
function collect(node) {
  if (ts.isFunctionDeclaration(node) && node.name) functions.set(node.name.text, node.getText(source));
  ts.forEachChild(node, collect);
}
collect(source);
function load(names, bindings) {
  const context = vm.createContext(bindings);
  vm.runInContext(ts.transpileModule(names.map(name => functions.get(name)).join('\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText, context);
  return context;
}

test('phase restore preserves pregame, active play, and intermission without inferring from countdowns', () => {
  const c = load(['restorePeriodController'], {});
  for (const state of ['PREGAME', 'IN_PROGRESS', 'INTERMISSION', 'NOT_STARTED']) {
    const restored = c.restorePeriodController({ state, isOvertime: true }, null, 4);
    assert.equal(restored.state, state);
    assert.equal(restored.isOvertime, true);
  }
  assert.equal(c.restorePeriodController(undefined, null, 1).state, 'PREGAME');
  assert.equal(c.restorePeriodController(undefined, '2026-11-10T20:00:00Z', 2).state, 'NOT_STARTED');
});

function gatewayContext(phase) {
  const c = load(['applyGatewayClockPayload', 'handleClockExpired'], {
    stageRef: { current: 'gameDashboard' }, gameModeRef: { current: 'scoreboard' },
    periodControllerStateRef: { current: phase },
    periodExpiryHandledRef: { current: false }, officialClockArmedRef: { current: false },
    sessionPeriodLengthRef: { current: '17' }, gatewayLastClockSecondsRef: { current: null },
    getPeriodLengthMinutes: () => 17,
    buildClockDisplayFromGatewayPayload: p => p.clock,
    parseClockDisplayToMs: s => Number(s.split(':')[0]) * 60000 + Number(s.split(':')[1]) * 1000,
    parseClockToSeconds: s => Number(s.split(':')[0]) * 60 + Number(s.split(':')[1]),
    session: { period: 1, clock: '17:00' }, prompts: 0, adjustments: 0,
    setSession: fn => { c.session = fn(c.session); },
    setIsClockRunning: value => { c.running = value; },
    setShowPeriodOverVerify: () => { c.prompts++; },
    shiftPenaltyTimersForClockAdjustment: () => { c.adjustments++; },
    scoreboardClock: [],
    gameClockControlsRef: { current: {
      setDuration() {}, syncPausedRemaining() {}, resume() {}, pause() {},
    } },
  });
  return c;
}

test('warmup and intermission feeds display clocks but cannot change phase, official period, or expire', () => {
  for (const phase of ['PREGAME', 'INTERMISSION', 'NOT_STARTED']) {
    const c = gatewayContext(phase);
    c.applyGatewayClockPayload({ clock: '01:00', period: 3, clockRunning: true });
    c.applyGatewayClockPayload({ clock: '00:00', period: 4, clockRunning: false });
    assert.equal(c.session.clock, '00:00');
    assert.equal(c.session.period, 1);
    assert.equal(c.periodControllerStateRef.current, phase);
    assert.equal(c.prompts, 0);
    assert.equal(c.adjustments, 0);
  }
});

test('official zero requires a positive official clock sample and only prompts once', () => {
  const c = gatewayContext('IN_PROGRESS');
  c.applyGatewayClockPayload({ clock: '00:00', clockRunning: false });
  assert.equal(c.prompts, 0);
  c.applyGatewayClockPayload({ clock: '00:01', clockRunning: true });
  c.applyGatewayClockPayload({ clock: '00:00', clockRunning: false });
  c.applyGatewayClockPayload({ clock: '00:00', clockRunning: false });
  assert.equal(c.prompts, 1);
});

test('start official game marks backend first, then activates period one; failure retains pregame', async () => {
  const calls = [];
  const c = load(['startOfficialGame'], {
    session: { role: 'GM' }, nextGame: { gameId: 'game' },
    canControlGame: () => true, periodControllerStateRef: { current: 'PREGAME' },
    markGameInProgress: async id => calls.push(['backend', id]),
    setGameStartedAtIso: value => calls.push(['timestamp', value]),
    activateOfficialPeriod: period => calls.push(['period', period]),
    trace() {}, Alert: { alert: () => calls.push(['error']) },
  });
  await c.startOfficialGame();
  assert.deepEqual(calls.map(x => x[0]), ['backend', 'timestamp', 'period']);
  assert.equal(calls[2][1], 1);
  calls.length = 0;
  c.periodControllerStateRef.current = 'PREGAME';
  c.markGameInProgress = async () => { throw Error('offline'); };
  await c.startOfficialGame();
  assert.equal(c.periodControllerStateRef.current, 'PREGAME');
  assert.deepEqual(calls, [['error']]);
});

test('beginning scoreboard periods leaves physical clock alone and explicitly advances once', () => {
  let state;
  let patch;
  const c = load(['activateOfficialPeriod', 'confirmResumeFromIntermission'], {
    session: { period: 1 }, gameMode: 'scoreboard',
    periodController: { state: 'INTERMISSION', isOvertime: false },
    periodExpiryHandledRef: { current: true }, officialClockArmedRef: { current: true },
    periodControllerStateRef: { current: 'INTERMISSION' },
    penaltyClockCarryMsRef: { current: 0 }, penaltyClockPrevRemainingMsRef: { current: null },
    setActivePenalties: fn => assert.equal(fn([{ remainingSeconds: 30 }, { remainingSeconds: 0 }]).length, 1),
    setPeriodController: value => { state = value; },
    setIntermissionSeconds() {}, setShowResumeVerify() {},
    updateSession: value => { patch = value; },
    gameClock: { pause: () => assert.fail('Scoreboard clock must not be changed') },
  });
  c.confirmResumeFromIntermission();
  assert.equal(patch.period, 2);
  assert.equal(Object.hasOwn(patch, 'clock'), false);
  assert.equal(state.state, 'IN_PROGRESS');
  assert.equal(c.officialClockArmedRef.current, false);
  c.session.period = 3;
  c.periodControllerStateRef.current = 'INTERMISSION';
  c.confirmResumeFromIntermission();
  assert.equal(patch.period, 4);
});

test('tablet clock controls cannot run in pregame or intermission', () => {
  const c = load(['handleClockToggle'], {
    session: { role: 'GM' }, gameMode: 'clock', canControlGame: () => true,
    isAnyModalOpen: false, periodController: { state: 'PREGAME' },
  });
  c.handleClockToggle();
  c.periodController.state = 'INTERMISSION';
  c.handleClockToggle();
});

test('opening the dashboard saves pregame without starting the official game', async () => {
  let saved;
  let phase;
  const c = load(['handleConfirmStartGame'], {
    session: { role: 'GM', gameModeConfirmed: true, periodLength: '17' },
    nextGame: { gameId: 'game' }, officials: [{ signatureImageBase64: 'signed' }],
    isGameModeLocked: false, scoreboardGatewaySettings: { enabled: true },
    homeTeamId: 'home', awayTeamId: 'away',
    startersByTeam: {}, rostersByTeam: {},
    lockSessionGameMode: s => s, getPeriodLengthMinutes: () => 17,
    formatSecondsToClock: () => '17:00',
    setOfficialsError() {}, setShowStartConfirm() {}, setIsOfficialsLoading() {},
    setSession() {}, saveOfficialsForGame: async () => {}, markActiveGame: async () => {},
    setGameStartedAtIso: value => assert.equal(value, null),
    setCurrentGoalieByTeam() {}, setGameHasEnded() {}, setIntermissionSeconds() {},
    setStage: stage => assert.equal(stage, 'gameDashboard'),
    periodControllerStateRef: { current: 'NOT_STARTED' },
    setPeriodController: value => { phase = value; },
    gameClock: { syncPausedRemaining() {}, pause() {} },
    buildActiveGameSnapshot: () => ({}),
    persistActiveGameSnapshot: async value => { saved = value; },
    markGameInProgress: () => assert.fail('Opening dashboard must not start official play'),
    trace: (name, info) => assert.fail(`${name}: ${JSON.stringify(info)}`),
  });
  await c.handleConfirmStartGame();
  assert.equal(phase.state, 'PREGAME');
  assert.equal(saved.periodController.state, 'PREGAME');
  assert.equal(saved.gameStartedAtIso, null);
});

test('clock recovery preserves current remaining time while a new period resets only the tablet timer', () => {
  const times = [];
  const c = load(['activateOfficialPeriod'], {
    session: { clock: '08:30', periodLength: '17' }, gameMode: 'clock',
    periodExpiryHandledRef: {}, officialClockArmedRef: {}, periodControllerStateRef: {},
    penaltyClockCarryMsRef: {}, penaltyClockPrevRemainingMsRef: {},
    setActivePenalties() {}, setPeriodController() {}, setIntermissionSeconds() {}, setIsClockRunning() {},
    getPeriodLengthMinutes: () => 17, parseClockDisplayToMs: () => 510000,
    formatSecondsToClock: seconds => String(seconds), updateSession() {},
    gameClock: { pause() {}, syncPausedRemaining: value => times.push(value) },
  });
  c.activateOfficialPeriod(2, true);
  c.activateOfficialPeriod(3);
  assert.deepEqual(times, [510000, 1020000]);
});

test('snapshot and lightweight resume both persist and restore the explicit phase', () => {
  for (const name of ['buildActiveGameSnapshot', 'persistActiveGameSnapshot', 'loadActiveGameResume']) {
    assert.match(functions.get(name), /periodController/);
  }
  assert.match(functions.get('restoreActiveGameSnapshot'), /restorePeriodController\(snapshot.periodController/);
  assert.match(functions.get('handleLoginSuccess'), /restorePeriodController\(resumeSnapshot.periodController/);
  assert.doesNotMatch(functions.get('handleConfirmStartGame'), /markGameInProgress/);
  assert.match(text, /periodController.state !== "IN_PROGRESS"\) return;/);
});
