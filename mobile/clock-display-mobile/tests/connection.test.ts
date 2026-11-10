import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ConnectionState, DisplayConnection, initialState, Socket, testConnection } from '../src/connection';
import { fixture } from './fixtures';

class FakeSocket implements Socket {
  onopen: Socket['onopen'] = null;
  onmessage: Socket['onmessage'] = null;
  onerror: Socket['onerror'] = null;
  onclose: Socket['onclose'] = null;
  sent: string[] = [];
  closed = false;
  send(data: string) { this.sent.push(data); }
  close() { this.closed = true; }
  receive(value: unknown) { this.onmessage?.({ data: JSON.stringify(value) }); }
  auth() { this.onopen?.(); this.receive({ type: 'AUTH_REQUIRED' }); this.receive({ status: 'authenticated' }); }
}
function harness() {
  let now = 0, sequence = 0;
  const timers = new Map<number, { fn: () => void; at: number; interval: number }>();
  const add = (fn: () => void, delay: number, interval: number) => {
    const id = ++sequence; timers.set(id, { fn, at: now + delay, interval });
    return id as unknown as ReturnType<typeof setTimeout>;
  };
  const clear = (id: ReturnType<typeof setTimeout>) => { timers.delete(id as unknown as number); };
  const rt = {
    now: () => now, random: () => 1,
    setTimeout: (fn: () => void, delay: number) => add(fn, delay, 0), clearTimeout: clear,
    setInterval: (fn: () => void, delay: number) => add(fn, delay, delay), clearInterval: clear,
  };
  const advance = (ms: number) => {
    const target = now + ms;
    while (true) {
      const next = [...timers.entries()].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!next) break;
      const [id, timer] = next; now = timer.at;
      if (timer.interval) timer.at += timer.interval; else timers.delete(id);
      timer.fn();
    }
    now = target;
  };
  let state: ConnectionState = initialState();
  const sockets: FakeSocket[] = [];
  const client = new DisplayConnection('ws://test:80/ws', 'secret', () => {
    const socket = new FakeSocket(); sockets.push(socket); return socket;
  }, value => { state = value; }, rt);
  client.start();
  return { client, sockets, advance, timers, get state() { return state; } };
}
test('authentication gates snapshots; only auth frames ever leave viewer', () => {
  const h = harness(), socket = h.sockets[0];
  socket.onopen?.(); socket.receive(fixture()); h.advance(500);
  assert.equal(h.state.ageMs, null);
  socket.auth(); socket.receive(fixture());
  h.advance(500);
  assert.equal(h.state.snapshot?.clock, '12:34');
  assert.deepEqual(socket.sent.map(x => JSON.parse(x)), [{ auth: 'secret', client: 'TipIn Clock Display' }]);
  h.client.stop(); assert.equal(h.timers.size, 0);
});
test('whole-second changes display on receipt without sampling delay or local countdown', () => {
  const h = harness(); h.sockets[0].auth();
  h.advance(999);
  h.sockets[0].receive(fixture());
  assert.equal(h.state.snapshot?.clock, '12:34');
  h.advance(101);
  h.sockets[0].receive(fixture({ clockSec: 31 }));
  assert.equal(h.state.snapshot?.clock, '12:31');
  h.advance(900);
  h.sockets[0].receive(fixture({ clockSec: 30, homeScore: 2 }));
  assert.equal(h.state.snapshot?.clock, '12:30');
  assert.equal(h.state.snapshot?.goals[0], 2);
  h.advance(1000);
  assert.equal(h.state.label, 'CONNECTION LOST');
  assert.equal(h.state.snapshot?.clock, '12:30');
  h.client.stop();
});
test('malformed snapshots never refresh freshness; healthy stopped clocks stay live', () => {
  const h = harness(); const socket = h.sockets[0]; socket.auth();
  for (let i = 0; i < 10; i++) { socket.receive(fixture({ clockRunning: false })); h.advance(200); }
  assert.equal(h.state.label, 'LIVE');
  socket.receive({ schema: 'TipIn.full.v1', clockMin: 'invalid' });
  h.advance(1000);
  assert.equal(h.state.label, 'CONNECTION LOST');
  h.client.stop();
});
test('source loss freezes all fields even while transport streams, recovers atomically', () => {
  const h = harness(), socket = h.sockets[0]; socket.auth();
  socket.receive(fixture()); h.advance(500); socket.receive(fixture()); h.advance(500);
  const stale = fixture({ clockSec: 2, homeScore: 99 });
  stale.displayMetadata.source.state = 'stale';
  socket.receive(stale);
  assert.equal(h.state.label, 'SCOREBOARD FEED LOST');
  h.advance(500); socket.receive(stale); h.advance(500);
  assert.equal(h.state.snapshot?.clock, '12:34');
  assert.equal(h.state.snapshot?.goals[0], 0);
  socket.receive(fixture({ clockSec: 1, homeScore: 2 }));
  h.advance(500); socket.receive(fixture({ clockSec: 1, homeScore: 2 })); h.advance(500);
  assert.equal(h.state.snapshot?.clock, '12:01');
  assert.equal(h.state.snapshot?.goals[0], 2);
  h.client.stop();
});
test('wrong token and 4001 are terminal, without automatic retry', () => {
  for (const event of ['message', 'close']) {
    const h = harness(); h.sockets[0].auth();
    if (event === 'message') h.sockets[0].receive({ error: 'invalid_auth' });
    else h.sockets[0].onclose?.({ code: 4001 });
    h.advance(30000); h.client.reconnect();
    assert.equal(h.state.auth, 'rejected'); assert.equal(h.sockets.length, 1); h.client.stop();
  }
});
test('explicit invalid clock freezes trusted values immediately even when source is unknown', () => {
  const h = harness(), socket = h.sockets[0]; socket.auth();
  socket.receive(fixture()); h.advance(500); socket.receive(fixture()); h.advance(500);
  const invalid = fixture({ clockSec: 0, homeScore: 99 });
  invalid.displayMetadata.valid.clock = false;
  invalid.displayMetadata.source.state = 'unknown';
  socket.receive(invalid);
  assert.equal(h.state.label, 'SCOREBOARD FEED LOST');
  h.advance(2000);
  assert.equal(h.state.snapshot?.clock, '12:34');
  assert.equal(h.state.snapshot?.goals[0], 0);
  assert.equal(h.state.source, 'stale');
  h.client.stop();
});
test('gateway reboot/network failure back off and network restore reconnects immediately', () => {
  const h = harness();
  h.sockets[0].onerror?.(); h.advance(999); assert.equal(h.sockets.length, 1);
  h.advance(1); assert.equal(h.sockets.length, 2);
  h.sockets[1].onclose?.({ code: 1006 });
  h.advance(1000); assert.equal(h.sockets.length, 2);
  h.client.reconnect(); assert.equal(h.sockets.length, 3);
  assert.equal(h.sockets[0].closed, true); assert.equal(h.sockets[1].closed, true);
  h.client.stop(); assert.equal(h.sockets[2].closed, true); assert.equal(h.timers.size, 0);
});
test('silent/unauthenticated sockets time out and restart after background stop', () => {
  const h = harness(); h.advance(8000);
  assert.equal(h.sockets[0].closed, true);
  h.client.stop(); h.advance(30000); assert.equal(h.sockets.length, 1);
  h.client.start(); assert.equal(h.sockets.length, 2);
  h.sockets[1].auth(); h.sockets[1].receive(fixture({ displayMetadata: undefined }));
  assert.equal(h.state.label, 'SOURCE UNKNOWN');
  h.client.stop();
});
test('draft test uses its own socket and closes on success/cancel', async () => {
  const h = harness(), draft = new FakeSocket();
  let done = false;
  const cancel = testConnection('ws://draft/ws', 'draft-secret', () => draft, () => {}, () => { done = true; });
  draft.auth(); draft.receive(fixture());
  await Promise.resolve();
  assert.equal(done, true); assert.equal(draft.closed, true); assert.equal(h.sockets[0].closed, false);
  cancel(); h.client.stop();
});
test('draft test cancellation and timeout dispose temporary connections', async () => {
  const canceled = new FakeSocket();
  let completed = 0;
  const cancel = testConnection('ws://draft/ws', 'secret', () => canceled, () => {}, () => { completed++; });
  cancel(); cancel();
  assert.equal(canceled.closed, true); assert.equal(completed, 1);
  const timedOut = new FakeSocket();
  await new Promise<void>(resolve => {
    testConnection('ws://draft/ws', 'secret', () => timedOut, () => {}, resolve, 10);
  });
  assert.equal(timedOut.closed, true);
});
