import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatLocalDateTime } from '../src/localTime';

test('local date and time matches the requested long date and twelve-hour format', () => {
  assert.equal(formatLocalDateTime(new Date(2026, 9, 27, 14, 49)), 'October 27, 2026  2:49 PM');
  assert.equal(formatLocalDateTime(new Date(2026, 9, 28, 0, 0)), 'October 28, 2026  12:00 AM');
});
