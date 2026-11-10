import { decodeSnapshot, Snapshot } from './decoder';

export interface Socket {
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: (() => void) | null;
  onclose: ((event: { code?: number }) => void) | null;
  send(data: string): void;
  close(): void;
}
export type ConnectionState = {
  transport: 'connecting' | 'connected' | 'disconnected';
  auth: 'waiting' | 'authenticated' | 'rejected';
  source: 'live' | 'stale' | 'unknown';
  label: string;
  ageMs: number | null;
  sourceAgeMs: number | null;
  trustedAgeMs: number | null;
  snapshot: Snapshot | null;
  demo: boolean;
};
type Runtime = {
  now: () => number;
  random: () => number;
  setInterval: (fn: () => void, delay: number) => ReturnType<typeof setInterval>;
  clearInterval: (id: ReturnType<typeof setInterval>) => void;
  setTimeout: (fn: () => void, delay: number) => ReturnType<typeof setTimeout>;
  clearTimeout: (id: ReturnType<typeof setTimeout>) => void;
};
const runtime: Runtime = { now: Date.now, random: Math.random, setInterval, clearInterval, setTimeout, clearTimeout };
export const initialState = (): ConnectionState => ({
  transport: 'disconnected', auth: 'waiting', source: 'unknown', label: 'WAITING FOR GATEWAY',
  ageMs: null, sourceAgeMs: null, trustedAgeMs: null, snapshot: null, demo: false,
});

export class DisplayConnection {
  private socket: Socket | null = null;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private active = false;
  private attempt = 0;
  private opened = 0;
  private received: number | null = null;
  private latest: Snapshot | null = null;
  private trusted: number | null = null;
  private sourceFault = false;
  private state = initialState();
  constructor(private url: string, private token: string, private factory: (url: string) => Socket,
    private notify: (state: ConnectionState) => void, private rt: Runtime = runtime) {}

  start() {
    if (this.active) return;
    this.active = true;
    this.connect();
    this.heartbeat = this.rt.setInterval(() => this.tick(), 200);
  }
  stop() {
    this.active = false;
    if (this.retry) this.rt.clearTimeout(this.retry);
    if (this.heartbeat) this.rt.clearInterval(this.heartbeat);
    this.retry = this.heartbeat = null;
    this.detach();
  }
  reconnect() {
    if (!this.active || this.state.auth === 'rejected') return;
    if (this.retry) this.rt.clearTimeout(this.retry);
    this.retry = null;
    this.detach();
    this.connect();
  }
  private detach() {
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onopen = socket.onmessage = socket.onerror = socket.onclose = null;
      socket.close();
    }
  }
  private connect() {
    if (!this.active) return;
    this.opened = this.rt.now();
    this.received = null;
    this.latest = null;
    this.state.transport = 'connecting';
    this.state.auth = 'waiting';
    this.publish();
    try {
      const socket = this.factory(this.url);
      this.socket = socket;
      socket.onopen = () => { this.state.transport = 'connected'; this.publish(); };
      socket.onmessage = event => {
        if (typeof event.data !== 'string' || event.data.length > 65536) return;
        let data;
        try { data = JSON.parse(event.data); } catch { return; }
        if (!data || typeof data !== 'object') return;
        if (data.error === 'invalid_auth') { this.reject(); return; }
        if (data.type === 'AUTH_REQUIRED') {
          if (this.state.auth === 'waiting') socket.send(JSON.stringify({ auth: this.token, client: 'TipIn Clock Display' }));
          return;
        }
        if (data.status === 'authenticated') { this.state.auth = 'authenticated'; this.publish(); return; }
        if (this.state.auth !== 'authenticated') return;
        if (data.schema === 'TipIn.full.v1' &&
          (data.displayMetadata?.valid?.clock === false || data.displayMetadata?.source?.state === 'stale')) {
          // Source failure is meaningful even when the clock is deliberately invalid.
          // Do not advance the valid-snapshot timer or replace any displayed values.
          this.sourceFault = true;
          this.publish();
          return;
        }
        const snapshot = decodeSnapshot(data);
        if (!snapshot) return;
        this.sourceFault = false;
        this.latest = snapshot;
        this.received = this.rt.now();
        this.state.snapshot = snapshot;
        this.trusted = this.received;
        this.attempt = 0;
        this.publish();
      };
      socket.onclose = event => { if (event.code === 4001) this.reject(); else this.failed(); };
      socket.onerror = () => this.failed();
    } catch { this.failed(); }
  }
  private reject() {
    this.state.auth = 'rejected';
    this.state.transport = 'disconnected';
    this.detach();
    this.publish();
  }
  private failed() {
    this.detach();
    this.state.transport = 'disconnected';
    this.publish();
    if (!this.active || this.retry || this.state.auth === 'rejected') return;
    const delay = Math.min(15000, 1000 * 2 ** Math.min(this.attempt++, 4)) * (0.8 + this.rt.random() * 0.2);
    this.retry = this.rt.setTimeout(() => { this.retry = null; this.connect(); }, delay);
  }
  private fresh() {
    return this.state.transport === 'connected' && this.received !== null && this.rt.now() - this.received < 1000;
  }
  private tick() {
    if (this.state.auth !== 'rejected' && this.state.transport !== 'disconnected' &&
      this.rt.now() - (this.received ?? this.opened) >= 8000) this.failed();
    this.publish();
  }
  private publish() {
    const now = this.rt.now();
    const source = this.latest?.source;
    this.state.ageMs = this.received === null ? null : now - this.received;
    this.state.trustedAgeMs = this.trusted === null ? null : now - this.trusted;
    this.state.sourceAgeMs = source?.ageMs == null || this.received === null ? null : source.ageMs + now - this.received;
    this.state.source = this.sourceFault ? 'stale' : source?.state ?? 'unknown';
    this.state.demo = this.latest?.demo ?? this.state.snapshot?.demo ?? false;
    this.state.label = this.state.auth === 'rejected' ? 'TOKEN REJECTED · OPEN SETTINGS'
      : this.state.transport === 'connecting' && !this.state.snapshot ? 'CONNECTING'
      : this.state.transport === 'connected' && this.sourceFault ? 'SCOREBOARD FEED LOST'
      : !this.fresh() ? (this.state.snapshot ? 'CONNECTION LOST' : 'WAITING FOR VALID SNAPSHOT')
      : source?.state === 'stale' ? 'SCOREBOARD FEED LOST'
      : source?.state !== 'live' ? 'SOURCE UNKNOWN'
      : 'LIVE';
    this.notify({ ...this.state });
  }
}

export function testConnection(url: string, token: string, factory: (url: string) => Socket,
  update: (state: ConnectionState) => void, done: () => void, timeoutMs = 10000) {
  let closed = false;
  let timer: ReturnType<typeof setTimeout>;
  const finish = () => {
    if (closed) return;
    closed = true;
    clearTimeout(timer);
    connection.stop();
    done();
  };
  const connection = new DisplayConnection(url, token, factory, state => {
    update(state);
    if (state.auth === 'rejected' || state.ageMs !== null) queueMicrotask(finish);
  });
  timer = setTimeout(finish, timeoutMs);
  connection.start();
  return finish;
}
