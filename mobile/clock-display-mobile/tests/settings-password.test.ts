import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pbkdf2Sync } from 'node:crypto';
import { emptyRetry, failedRetry, iterations, makeVerifier, passwordError, retrySeconds, verifyPassword } from '../src/password';
import { gatewayUrl, parseSettings, structuredDefaults, validateSettings } from '../src/settings';

test('settings serialize all visibility overrides and labels separately from secrets', () => {
  const settings = structuredDefaults();
  settings.host = '192.168.1.25';
  settings.visibility = { goals: 'show', shots: 'hide', period: 'auto', penalties: 'show' };
  settings.home = 'FALCONS';
  const raw = JSON.stringify(settings);
  assert.deepEqual(parseSettings(raw), settings);
  assert.equal(raw.includes('token'), false);
  assert.equal(validateSettings(settings, 'secret'), null);
  assert.equal(gatewayUrl(settings), 'ws://192.168.1.25:80/ws');
  const changed = structuredDefaults(); changed.visibility.goals = 'hide';
  assert.equal(structuredDefaults().visibility.goals, 'auto');
});
test('host, port, token and corrupted settings fail safely', () => {
  const settings = { ...structuredDefaults(), host: 'gateway.local' };
  for (const host of ['', 'ws://gateway', 'host/path', '999.2.3.4', 'host x', 'a..b']) assert.ok(validateSettings({ ...settings, host }, 'token'));
  for (const port of ['0', '65536', '1.2', 'abc']) assert.ok(validateSettings({ ...settings, port }, 'token'));
  assert.ok(validateSettings(settings, ''));
  assert.throws(() => parseSettings('{"host":1}'));
});
test('password creation enforces length/confirmation, no default password', () => {
  assert.ok(passwordError('short', 'short'));
  assert.ok(passwordError('a'.repeat(129), 'a'.repeat(129)));
  assert.ok(passwordError('password-123', 'different'));
  assert.equal(passwordError('abcdefgh', 'abcdefgh'), null);
  assert.equal(passwordError('a'.repeat(128), 'a'.repeat(128)), null);
  assert.equal(passwordError('new-password', 'new-password'), null);
});
test('salted PBKDF2-SHA256 verifier accepts correct password and rejects wrong one', async () => {
  const verifier = await makeVerifier('a-unique-password', new Uint8Array(16).fill(7));
  assert.equal(verifier.iterations, iterations);
  assert.equal(verifier.salt.length, 32);
  assert.equal(verifier.hash.length, 64);
  assert.equal(verifier.hash, pbkdf2Sync('a-unique-password', Buffer.alloc(16, 7), 600000, 32, 'sha256').toString('hex'));
  assert.equal(JSON.stringify(verifier).includes('a-unique-password'), false);
  assert.equal(await verifyPassword('a-unique-password', verifier), true);
  assert.equal(await verifyPassword('wrong-password', verifier), false);
  assert.equal(await verifyPassword('a-unique-password', { ...verifier, iterations: 1 }), false);
});
test('retry state survives serialization/restart and delays increase to five-minute ceiling', () => {
  let retry = emptyRetry();
  retry = failedRetry(retry, 1000);
  assert.equal(retrySeconds(retry, 1000), 1);
  retry = failedRetry(JSON.parse(JSON.stringify(retry)), 2000);
  assert.equal(retrySeconds(retry, 2000), 2);
  for (let i = 0; i < 20; i++) retry = failedRetry(retry, 10000);
  assert.equal(retrySeconds(retry, 10000), 300);
  assert.equal(retrySeconds(retry, 310000), 0);
});
