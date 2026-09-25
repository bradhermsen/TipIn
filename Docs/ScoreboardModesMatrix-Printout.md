# TipIn Scoreboard Control Mode Matrix (Printout)

Date: 2026-08-03
Scope: Game Manager Mobile + Gateway integration modes

## 1) Core Ownership Matrix

| Domain                              | Manual Mode  | Clock + Period Sync (current)         | Clock Advance Mode (next)                                 | Full Automode (future)      |
| ----------------------------------- | ------------ | ------------------------------------- | --------------------------------------------------------- | --------------------------- |
| Source of truth                     | Tablet       | Scoreboard for clock/period only      | Scoreboard for live game-state domains                    | Tablet for all domains      |
| Clock time/start/stop               | Tablet       | Scoreboard                            | Scoreboard                                                | Tablet                      |
| Period number/state                 | Tablet       | Scoreboard                            | Scoreboard                                                | Tablet                      |
| Score (home/away)                   | Tablet       | Tablet                                | Scoreboard                                                | Tablet                      |
| Shots (home/away)                   | Tablet       | Tablet                                | Scoreboard                                                | Tablet                      |
| Penalties slot 1-2 (board-visible)  | Tablet       | Tablet                                | Scoreboard                                                | Tablet                      |
| Penalty overflow (3+)               | Tablet       | Tablet                                | Tablet shadow penalties                                   | Tablet                      |
| Goal attribution (scorer/assists)   | Tablet       | Tablet                                | Tablet                                                    | Tablet                      |
| Penalty attribution (player/reason) | Tablet       | Tablet                                | Tablet                                                    | Tablet                      |
| Timeout/horn metadata               | Tablet       | Usually tablet                        | Scoreboard if available, else tablet                      | Tablet                      |
| Event feed ownership                | Tablet       | Tablet + clock stamps from scoreboard | Hybrid: scoreboard core events + tablet enrichment        | Tablet                      |
| Primary data flow                   | Local only   | Scoreboard -> Tablet (clock/period)   | Scoreboard -> Tablet (clock/period/score/shots/penalties) | Tablet -> Scoreboard        |
| Write direction to scoreboard       | None         | None/read-only                        | None/read-only (except optional ack)                      | Yes (commands/state mirror) |
| Operator role during play           | Full control | Manage game, clock follows board      | Enrich and manage overflow only                           | Full control from tablet    |

## 2) Authority Rules Matrix

| Rule                                  | Manual | Clock+Period                                      | Clock Advance                                     | Full Automode |
| ------------------------------------- | ------ | ------------------------------------------------- | ------------------------------------------------- | ------------- |
| Can tablet start/stop clock?          | Yes    | No when connected; local fallback if disconnected | No when connected; local fallback if disconnected | Yes           |
| Can tablet change period?             | Yes    | No when connected                                 | No when connected                                 | Yes           |
| Can tablet edit score/shots live?     | Yes    | Yes                                               | No (unless admin override)                        | Yes           |
| Can tablet edit player attribution?   | Yes    | Yes                                               | Yes                                               | Yes           |
| Can tablet manage overflow penalties? | Yes    | Yes                                               | Yes (required)                                    | Yes           |

## 3) Connection and Recovery Matrix

| Scenario                    | Manual    | Clock+Period                        | Clock Advance                                                                | Full Automode                                                |
| --------------------------- | --------- | ----------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------------------------------ |
| Gateway disconnect mid-game | No impact | Fall back to local clock if enabled | Fall back to local clock + local score/shots tracking (degraded mode banner) | Continue local authoritative control; queue outbound updates |
| Gateway reconnect           | N/A       | Resync clock/period from scoreboard | Full resync of scoreboard-owned domains, preserve tablet enrichment          | Push tablet state to scoreboard, verify applied              |
| Drift detected              | N/A       | Snap clock to scoreboard            | Snap scoreboard-owned domains to scoreboard, keep tablet metadata            | Keep tablet values, retry send to scoreboard                 |
| Auth failure                | N/A       | Stay local fallback                 | Stay degraded fallback; block scoreboard-owned edits or require override     | Continue tablet authority; alert output failure              |

## 4) UI and Operator Matrix

| UI Element        | Manual       | Clock+Period                         | Clock Advance                                                   | Full Automode                  |
| ----------------- | ------------ | ------------------------------------ | --------------------------------------------------------------- | ------------------------------ |
| Status pill       | Manual Clock | Connected/Not Connected              | Connected/Not Connected/Degraded                                | Tablet Control/Output Degraded |
| Ownership banner  | Optional     | Clock owned by scoreboard            | Live game state owned by scoreboard                             | All game state owned by tablet |
| Disabled controls | None         | Clock/period controls when connected | Clock/period/score/shots/penalty slots 1-2 edits when connected | None (except safety locks)     |
| Override action   | N/A          | Use Local Fallback                   | Use Local Fallback                                              | Force resend to scoreboard     |

## 5) Event Handling Matrix (Clock Advance Mode)

| Event Type                    | Origin     | Tablet Action                                       | Persisted As                                         |
| ----------------------------- | ---------- | --------------------------------------------------- | ---------------------------------------------------- |
| Goal registered on board      | Scoreboard | Create/merge event shell; prompt for scorer/assists | Goal event: source=scoreboard + enrichment=tablet    |
| Penalty on board slot 1-2     | Scoreboard | Create penalty shell; add player/reason             | Penalty event: source=scoreboard + enrichment=tablet |
| Extra penalty beyond board    | Tablet     | Create overflow penalty locally                     | Penalty event: source=tablet_overflow                |
| Clock tick/period change      | Scoreboard | Apply directly; update timers                       | Clock timeline: source=scoreboard                    |
| Manual correction by operator | Tablet     | Require reason + audit log                          | Correction event: source=tablet_override             |

## 6) Risk Matrix

| Risk                       | Highest Impact Mode          | Why                                       | Mitigation                                          |
| -------------------------- | ---------------------------- | ----------------------------------------- | --------------------------------------------------- |
| Dual-write conflicts       | Clock Advance, Full Automode | Two systems writing same domain           | Hard domain ownership locks per mode                |
| Reconnect divergence       | Clock Advance                | Board advanced while tablet offline       | Deterministic resync handshake + sequence numbers   |
| Incomplete board telemetry | Clock Advance                | Some controllers do not expose all fields | Capability profile + per-domain fallback            |
| Operator confusion         | All sync modes               | Ownership unclear during stress           | Always-visible ownership banner + disabled controls |
| Penalty lifecycle bugs     | Clock Advance                | Overflow + period transitions             | Penalty state machine with carryover rules          |
| Output command failure     | Full Automode                | Board may reject or lose commands         | Ack/retry queue + local authority retained          |

## 7) Transition Matrix

| From -> To                     | Allowed During Active Game? | Required Confirmation | Required Sync Step                            |
| ------------------------------ | --------------------------- | --------------------- | --------------------------------------------- |
| Manual -> Clock+Period         | Yes                         | Yes                   | Pull clock/period from scoreboard             |
| Manual -> Clock Advance        | Yes                         | Yes (strong warning)  | Pull full scoreboard-owned domains            |
| Clock+Period -> Clock Advance  | Yes                         | Yes                   | Pull score/shots/penalties baseline           |
| Clock Advance -> Manual        | Yes                         | Yes                   | Freeze current state as local authority       |
| Clock Advance -> Full Automode | Prefer intermission only    | Yes (double confirm)  | Push tablet baseline to scoreboard and verify |
| Any -> Full Automode           | Prefer pregame/intermission | Yes (double confirm)  | Output channel health check + ack test        |

## 8) Minimum Safe Operating Rules

1. One mode, one authority per data domain.
2. Never silently switch authority; operator must confirm.
3. On reconnect, run deterministic resync before applying live updates.
4. Show active ownership and connection state at all times.
5. Keep source-tagged audit logs (who/what/when) for corrections.

## 9) Immediate Next Scope (Clock Advance Mode)

1. Enforce edit locks for scoreboard-owned domains while connected.
2. Add degraded fallback banner and behavior when disconnected.
3. Add reconnect resync handshake for scoreboard-owned domains.
4. Implement event shell + enrichment flow for goals and penalties.
5. Keep overflow penalty handling on tablet with clear UI indication.
6. Add source and correction audit fields to event persistence.
