import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decodeSnapshot, isVisible } from '../src/decoder';
import { fixture } from './fixtures';

test('whole seconds use numerical fields, including below one minute and stopped zero', () => {
  assert.equal(decodeSnapshot(fixture({ clockMin: 0, clockSec: 45, clockFormatted: '45.9' }))?.clock, '00:45');
  assert.equal(decodeSnapshot(fixture({ clockMin: 0, clockSec: 0, clockRunning: false }))?.clock, '00:00');
  assert.equal(decodeSnapshot(fixture({ clockMin: 999 }))?.clock, '999:34');
});
test('malformed clocks and non-full snapshots are rejected', () => {
  for (const bad of [null, [], {}, fixture({ schema: 'other' }), fixture({ clockSec: 60 }), fixture({ clockMin: '12' }), fixture({ clockMin: -1 })]) assert.equal(decodeSnapshot(bad), null);
});
test('real zeros remain visible; only active penalties appear; two slots preserved', () => {
  const decoded = decodeSnapshot(fixture())!;
  assert.equal(decoded.goals[0], 0);
  assert.equal(isVisible(decoded, 'goals', 'auto'), true);
  assert.equal(decoded.penalties[0]?.length, 1);
  assert.equal(decoded.penalties[1]?.length, 2);
});
test('existing gateways show supplied fields in Auto while diagnostics remain unknown', () => {
  const decoded = decodeSnapshot(fixture({ displayMetadata: undefined, emulator: true }))!;
  assert.equal(decoded.source.state, 'unknown');
  assert.equal(decoded.demo, true);
  for (const section of ['goals', 'shots', 'period', 'penalties'] as const) {
    assert.equal(isVisible(decoded, section, 'auto'), true);
    assert.equal(isVisible(decoded, section, 'hide'), false);
  }
  assert.equal(isVisible(decoded, 'goals', 'show'), true);
  assert.equal(decoded.goals[0], 0);
  const missing = decodeSnapshot(fixture({ displayMetadata: undefined, homeShots: undefined }))!;
  assert.equal(isVisible(missing, 'shots', 'auto'), false);
});
test('Show does not override validity; unsupported and missing values are dashes', () => {
  const data = fixture();
  data.displayMetadata.valid.shots = false;
  data.displayMetadata.support.goals = 'unsupported';
  const decoded = decodeSnapshot(data)!;
  assert.deepEqual(decoded.shots, [null, null]);
  assert.deepEqual(decoded.goals, [null, null]);
  assert.equal(isVisible(decoded, 'shots', 'show'), true);
  assert.equal(isVisible(decoded, 'shots', 'auto'), false);
  assert.equal(isVisible(decoded, 'period', 'hide'), false);
  assert.equal(decodeSnapshot(fixture({ homeScore: null }))?.goals[0], null);
});
test('invalid clock metadata cannot refresh the stream; malformed penalties do not fabricate values', () => {
  const data = fixture();
  data.displayMetadata.valid.clock = false;
  assert.equal(decodeSnapshot(data), null);
  assert.equal(decodeSnapshot(fixture({ homePen1Time: '1:99' }))?.penalties[0], null);
});
