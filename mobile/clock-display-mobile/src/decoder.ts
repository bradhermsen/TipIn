export const sections = ['period', 'goals', 'shots', 'penalties'] as const;
export type Section = typeof sections[number];
export type Support = 'supported' | 'unsupported' | 'unknown';
type Field = Section | 'clock';
export type Penalty = { player: number; time: string };
export type Snapshot = {
  clock: string;
  period: number | null;
  goals: [number | null, number | null];
  shots: [number | null, number | null];
  penalties: [Penalty[] | null, Penalty[] | null];
  support: Record<Field, Support>;
  valid: Record<Field, boolean>;
  source: { kind: 'emulator' | 'scoreboard' | 'unknown'; state: 'live' | 'stale' | 'unknown'; ageMs: number | null };
  demo: boolean;
};
const object = (v: unknown): Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? v as Record<string, unknown> : {};
const integer = (v: unknown, max = 999): number | null =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max ? v : null;
const timePattern = /^\d{2,3}:[0-5]\d$/;

export function decodeSnapshot(input: unknown): Snapshot | null {
  const d = object(input);
  if (d.schema !== 'TipIn.full.v1') return null;
  const min = integer(d.clockMin), sec = integer(d.clockSec, 59);
  if (min === null || sec === null) return null;
  const metadata = object(d.displayMetadata), supports = object(metadata.support), validity = object(metadata.valid);
  const hasMetadata = d.displayMetadata !== undefined;
  const support = {} as Snapshot['support'], valid = {} as Snapshot['valid'];
  for (const key of ['clock', ...sections] as const) {
    support[key] = supports[key] === 'supported' || supports[key] === 'unsupported' ? supports[key] : 'unknown';
    valid[key] = hasMetadata ? validity[key] === true : true;
  }
  if (!valid.clock || support.clock === 'unsupported') return null;
  const value = (key: string, field: Section) => valid[field] && support[field] !== 'unsupported' ? integer(d[key]) : null;
  const penalties = (side: string): Penalty[] | null => {
    if (!valid.penalties || support.penalties === 'unsupported') return null;
    const result: Penalty[] = [];
    for (const slot of [1, 2]) {
      const player = integer(d[`${side}Pen${slot}Player`]);
      const time = d[`${side}Pen${slot}Time`];
      if (player === null || typeof time !== 'string' || !timePattern.test(time)) return null;
      if (time !== '00:00') result.push({ player, time });
    }
    return result;
  };
  const source = object(metadata.source);
  const kind = source.kind === 'emulator' || source.kind === 'scoreboard' ? source.kind : 'unknown';
  const state = source.state === 'live' || source.state === 'stale' ? source.state : 'unknown';
  return {
    clock: `${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}`,
    period: value('period', 'period'),
    goals: [value('homeScore', 'goals'), value('awayScore', 'goals')],
    shots: [value('homeShots', 'shots'), value('awayShots', 'shots')],
    penalties: [penalties('home'), penalties('away')],
    support, valid,
    source: { kind, state, ageMs: typeof source.ageMs === 'number' && Number.isFinite(source.ageMs) && source.ageMs >= 0 ? source.ageMs : null },
    demo: kind === 'emulator' || d.emulator === true || d.emulatorMode === true,
  };
}

export function isVisible(snapshot: Snapshot | null, section: Section, mode: 'auto' | 'show' | 'hide') {
  if (mode !== 'auto') return mode === 'show';
  if (!snapshot || snapshot.support[section] === 'unsupported' || !snapshot.valid[section]) return false;
  if (section === 'period') return snapshot.period !== null;
  return snapshot[section].every(value => value !== null);
}
