export const fixture = (patch: Record<string, unknown> = {}) => ({
  schema: 'TipIn.full.v1', clockMin: 12, clockSec: 34, clockTenths: 9, clockFormatted: '12:34',
  period: 2, homeScore: 0, awayScore: 1, homeShots: 18, awayShots: 15,
  homePen1Player: 12, homePen1Time: '01:24', homePen2Player: 0, homePen2Time: '00:00',
  awayPen1Player: 8, awayPen1Time: '00:45', awayPen2Player: 3, awayPen2Time: '02:00',
  displayMetadata: {
    support: { clock: 'supported', period: 'supported', goals: 'supported', shots: 'supported', penalties: 'supported' },
    valid: { clock: true, period: true, goals: true, shots: true, penalties: true },
    source: { kind: 'scoreboard', state: 'live', ageMs: 20 },
  },
  ...patch,
});
