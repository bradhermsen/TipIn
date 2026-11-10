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
function load(names, bindings) {
  const context = vm.createContext(bindings);
  vm.runInContext(ts.transpileModule(names.map(name => functions.get(name)).join('\n'), {
    compilerOptions: { target: ts.ScriptTarget.ES2020 },
  }).outputText, context);
  return context;
}

test('event updates send all edited goal and penalty fields, including cleared assists', async () => {
  const requests = [];
  const c = load(['updateEventInBackend'], {
    activeApiBase: 'https://test/api',
    fetch: async (url, options) => { requests.push([url, options]); return { ok: true }; },
  });
  for (const eventType of ['Goal', 'Penalty', 'Shot']) {
    await c.updateEventInBackend({
      gameId: 'game', localId: 'original', eventType,
      teamId: 'away', playerId: 'new-player', assist1Id: '', assist2Id: 'assist2',
      period: 2, timeInPeriod: '10:30', strength: 'Power Play',
      infraction: 'Tripping', durationMinutes: 5, penaltyType: 'Major',
      suspensionBehavior: 'review', requiresRefereeNotes: true, reviewRequired: true,
    });
    const [url, options] = requests.at(-1);
    assert.equal(url, 'https://test/api/games/game/events/original');
    assert.equal(options.method, 'PUT');
    assert.deepEqual(JSON.parse(options.body), {
      eventType, teamId: 'away', playerId: 'new-player', assist1Id: null, assist2Id: 'assist2',
      period: 2, timeInPeriod: '10:30', strength: 'Power Play',
      infraction: 'Tripping', durationMinutes: 5, penaltyType: 'Major',
      suspensionBehavior: 'review', requiresRefereeNotes: true, reviewRequired: true,
    });
  }
  c.fetch = async () => ({ ok: false, status: 404 });
  await assert.rejects(() => c.updateEventInBackend({ gameId: 'game', localId: 'missing' }), /Changes were not saved/);
});

function editor(eventType = 'Penalty', fail = false) {
  const original = {
    localId: 'original', gameId: 'game', eventType, teamId: 'home',
    playerId: 'old-player', period: 1, timeInPeriod: '12:00', durationMinutes: 2,
  };
  const calls = [];
  const c = load(['saveEventEdit'], {
    eventEditModal: {
      event: original, teamId: 'home', playerId: 'new-player',
      period: 1, timeInPeriod: '12:00', penaltyType: 'Minor', infraction: 'Tripping',
      assist1Id: '', assist2Id: '', strength: 'Even Strength',
    },
    eventFeed: [original], session: { periodLength: '17', homeTeam: 'Home', awayTeam: 'Away' },
    homeTeamId: 'home', awayTeamId: 'away',
    getPeriodLengthMinutes: () => 17, formatSecondsToClock: () => '12:00',
    normalizePenaltyType: value => value,
    getPenaltyRule: () => ({ durationMinutes: 2 }), getPenaltyDurationMinutes: () => 2,
    findPlayerName: (_team, id) => id, shouldAffectManpower: () => true,
    updateEventInBackend: async event => {
      calls.push(['backend', event]);
      if (fail) throw Error('Server unavailable');
    },
    setActivePenalties: fn => {
      const penalties = fn([{ ...original, id: 'original', remainingSeconds: 37 }]);
      calls.push(['penalties', penalties]);
    },
    updateDerivedStateFromEvents: events => calls.push(['local', events]),
    setEventEditModalError: message => calls.push(['error', message]),
    closeEventEditModal: () => calls.push(['close']), trace() {},
  });
  return { c, calls };
}

test('player edits persist first, retain event identity and running penalty time, then update local UI', async () => {
  const { c, calls } = editor();
  await c.saveEventEdit();
  assert.equal(calls[0][0], 'backend');
  assert.equal(calls[0][1].playerId, 'new-player');
  assert.equal(calls[0][1].localId, 'original');
  const penalty = calls.find(call => call[0] === 'penalties')[1][0];
  assert.equal(penalty.playerId, 'new-player');
  assert.equal(penalty.remainingSeconds, 37);
  assert.equal(calls.at(-1)[0], 'close');
});

test('failed edits leave local events and penalties untouched and keep the editor open', async () => {
  for (const type of ['Goal', 'Penalty', 'Goalie', 'Shot']) {
    const { c, calls } = editor(type, true);
    await c.saveEventEdit();
    assert.deepEqual(calls.map(call => call[0]), ['backend', 'error']);
    assert.match(calls[1][1], /Server unavailable/);
  }
});

test('goalie edits use the existing complete goalie update rather than timing-only writes', async () => {
  const calls = [];
  const c = load(['updateEventInBackend'], {
    updateGoalieInBackend: async event => calls.push(event),
    fetch: () => assert.fail('Goalie must use its dedicated update'),
  });
  const event = { eventType: 'Goalie', gameId: 'game', localId: 'goalie', goalieNewName: 'New Goalie' };
  await c.updateEventInBackend(event);
  assert.equal(calls[0], event);
});
