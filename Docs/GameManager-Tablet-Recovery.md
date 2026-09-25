# Game Manager Tablet Failure and Recovery

## Purpose

This document describes how an active game can continue when the Game Manager tablet fails and another tablet must replace it. It distinguishes behavior supported by the current system architecture from safeguards recommended for complete and controlled recovery.

## Recovery Summary

Replacing a failed tablet during a game is possible. Recovery is strongest when the physical scoreboard is the clock authority because the scoreboard and ESP32 continue operating independently of the tablet.

The replacement tablet should load the same active game, reconnect to the ESP32, and resume management. It must not create a new game, reset the active game, or overwrite current hardware values with older database values.

## Example Failure Scenario

1. Tablet A is managing an active game.
2. Tablet A loses power, crashes, breaks, or loses network connectivity.
3. The physical scoreboard and ESP32 continue operating.
4. Tablet B opens Game Manager and enters the same valid Game Manager code.
5. Tablet B retrieves the scheduled or active game from the API.
6. Tablet B reconnects to the ESP32 and receives the current scoreboard state.
7. Tablet B selects **Resume Game** or, when control leasing is implemented, **Take Over Game**.
8. Game management continues on Tablet B.

## Sources of Truth

| Information                            | Authority during recovery             |
| -------------------------------------- | ------------------------------------- |
| Hardware clock and running state       | Physical scoreboard through the ESP32 |
| Period from hardware feed              | Physical scoreboard through the ESP32 |
| Scores and shots from hardware feed    | Physical scoreboard through the ESP32 |
| Hardware penalty slots                 | Physical scoreboard through the ESP32 |
| Game identity and scheduled teams      | TipIn API/database                    |
| Rosters and player information         | TipIn API/database                    |
| Submitted game events                  | TipIn API/database                    |
| Unsaved form entries and UI selections | Failed tablet only; not recoverable   |

The replacement tablet must treat the ESP32 as authoritative for hardware-fed values. It must not push an older locally cached or database clock value back over the current feed.

## Hardware Clock Recovery

This is the preferred and most reliable recovery case.

Example:

- Tablet A fails with 8:42 remaining in period 2.
- The physical scoreboard continues running.
- Tablet B signs in and loads the same active game.
- Tablet B connects to the ESP32.
- The ESP32 now reports 8:19 remaining, period 2, current scores, shots, and penalties.
- Tablet B adopts the current ESP32 state and resumes management.

The ESP32 can provide these live values after tablet replacement:

- Game clock
- Clock running or stopped state
- Current period
- Home and away scores
- Home and away shots
- Four penalty slots
- Scoreboard connection status

A tablet failure does not stop the physical scoreboard or the ESP32 serial parser.

## Manual Clock Recovery

Manual-clock recovery is less exact because the tablet may be the clock authority.

Reliable manual-clock recovery requires the server to periodically store:

- Whether the clock is running
- Remaining time at the last synchronization
- Server timestamp for that synchronization
- Current period
- State revision or sequence number

When the saved clock was running, Tablet B can estimate the remaining time using:

```text
recovered remaining time = saved remaining time - elapsed server time
```

The operator should confirm the recovered clock before resuming. Without periodic server checkpoints, recovery is limited to the last state successfully saved by Tablet A.

## Information Expected to Recover

The API/database should restore:

- Game ID
- Scheduled home and away teams
- Game status
- Scheduled start time
- Period configuration
- Rosters and players
- Events already submitted to the server
- Notes and metadata already synchronized

The ESP32 should restore current hardware-fed scoreboard values as listed above.

## Information That May Be Lost

Anything present only in Tablet A memory may be lost:

- An event that was entered but not submitted
- Unsynchronized goal or penalty records
- A selected player in an open form
- Partially completed dialog values
- Temporary UI selections
- Manual-clock changes not synchronized to the server
- Local period-transition or expiry latches

Game events should therefore be sent to the server immediately after operator confirmation instead of being retained only until the end of the game.

## Preventing Two Tablets From Controlling One Game

Tablet A may reconnect after Tablet B has taken over. Both tablets must not be allowed to submit competing changes.

The recommended design is a server-managed control lease:

1. A tablet claims control of an active game.
2. The server records the controlling session/device and a heartbeat time.
3. Another tablet sees that the game is currently controlled.
4. An authorized operator chooses **Take Over Game**.
5. The server revokes the original control token and issues a new token to Tablet B.
6. Tablet A becomes read-only if it reconnects.

The ESP32 may continue broadcasting scoreboard state to multiple clients. Only the tablet holding the current server-issued lease should be allowed to submit management changes.

## Recommended Replacement-Tablet Workflow

Tablet B should show:

- Active game and teams
- Current game status
- Last successful server synchronization time
- ESP32 connection status
- Recovered scoreboard values
- Existing controlling tablet/session, if any
- **Resume Game** when no active controller exists
- **Take Over Game** when another controller holds the lease
- Manual-clock recovery confirmation when applicable

Recommended sequence:

1. Authenticate with the Game Manager code.
2. Find the active scheduled game rather than creating another game.
3. Load persisted game, roster, and event data.
4. Connect to the configured ESP32.
5. Compare API state with the current hardware feed.
6. Prefer current hardware values for hardware-controlled fields.
7. Acquire or take over the control lease.
8. Confirm recovered manual-clock state when hardware time is unavailable.
9. Resume event entry and game management.

## Current and Recommended Capability Matrix

| Capability                                         | Current architectural support                | Additional work recommended                            |
| -------------------------------------------------- | -------------------------------------------- | ------------------------------------------------------ |
| Physical scoreboard continues after tablet failure | Yes                                          | None                                                   |
| ESP32 continues parsing hardware state             | Yes                                          | None                                                   |
| Replacement tablet can reconnect to ESP32          | Yes, using the configured gateway connection | Add a guided recovery screen                           |
| Replacement tablet can reload scheduled game data  | API architecture supports loading games      | Verify explicit active-game resume behavior end to end |
| Previously submitted events survive                | Yes, when successfully persisted by the API  | Confirm every event is written immediately             |
| Unsaved tablet-only input survives                 | No                                           | Optional local draft synchronization                   |
| Exact manual-clock recovery                        | Not guaranteed from tablet-local state       | Add periodic server checkpoints and timestamps         |
| Single controlling tablet enforcement              | Not guaranteed by ESP32 broadcasting         | Add server-issued control lease and heartbeat          |
| Authorized forced takeover                         | Not guaranteed                               | Add **Take Over Game** API and UI flow                 |
| Reconnected old tablet becomes read-only           | Not guaranteed                               | Enforce the lease token on all write endpoints         |

## Operational Guidance

Until server control leasing and manual-clock checkpoints are implemented:

1. Keep the physical scoreboard as the authoritative clock whenever available.
2. Submit game events promptly.
3. On Tablet B, open the same scheduled game.
4. Verify teams and game ID before continuing.
5. Reconnect to the ESP32 and confirm clock, period, score, shots, and penalties.
6. Ensure Tablet A is powered off or disconnected before Tablet B submits changes.
7. For a manual clock, confirm the correct remaining time with the game officials before resuming.

## Acceptance Criteria for Full Recovery Support

Full tablet replacement support is complete when:

- Tablet B can identify and resume the existing active game.
- Hardware-fed state is adopted without resetting the scoreboard.
- Submitted events and rosters reload from the API.
- Manual-clock state is reconstructed from a recent server checkpoint.
- A control lease prevents simultaneous writes.
- An authorized takeover invalidates Tablet A's write access.
- Failed recovery leaves the existing game and scoreboard state unchanged.
- The operator can see the source and timestamp of recovered state before resuming.
