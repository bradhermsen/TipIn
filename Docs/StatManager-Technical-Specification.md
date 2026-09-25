# TipIn StatManager Technical Specification

**Document version:** 1.0  
**Status:** Proposed for product and architecture approval  
**Last updated:** 2026-08-25  
**Applies to:** TipIn mobile application, TipIn API, and SQL Server database

## 1. Purpose

This document converts the [TipIn StatManager React Native Component Spec](./TipIn%20StatManager%20%E2%80%94%20React%20Native%20Component%20Spec.pdf) into an implementation-ready product and technical specification.

The component PDF remains the visual and interaction reference for StatManager screens. This document is authoritative for:

- product boundaries and role permissions;
- authentication, sessions, and authorization;
- game, team, event, and zone-timer authority;
- database design and data ownership;
- API contracts;
- offline synchronization and conflict handling;
- recovery, audit, reporting, and acceptance criteria.

No implementation should begin until the approval items in section 21 are accepted.

## 2. Normative Language and Document Precedence

The terms **MUST**, **MUST NOT**, **SHOULD**, and **MAY** are normative.

If requirements conflict, use this order of precedence:

1. This technical specification for StatManager behavior and security.
2. [TipIn System Security](./TipInSystemSecurity.md) for system-wide role policy.
3. [Game Manager Tablet Failure and Recovery](./GameManager-Tablet-Recovery.md) for recovery and lease behavior.
4. [Players vs Roster Behavior](./PlayersVsRosterBehavior.md) and [Roster Sync Rules](./RosterSyncRules.md) for player and roster ownership.
5. The component PDF for visual design and component interactions.

This specification clarifies two existing security rules for native mobile:

- Browser applications use HttpOnly cookies where supported. The native Expo app MUST use bearer access and refresh credentials held in the operating system secure credential store.
- Game-day access MUST be resolved from server data. A client-provided game date is never an authorization input.

## 3. Product Decision Summary

The following decisions are part of the approved target design.

| Topic                 | Decision                                                                                                        |
| --------------------- | --------------------------------------------------------------------------------------------------------------- |
| Application packaging | Game Manager and StatManager ship in one Expo application binary.                                               |
| Login                 | Both roles use the current access-code login experience.                                                        |
| Role routing          | A server-issued session routes `GM-XXXXXX` to Game Manager and `SM-XXXXXX` to StatManager.                      |
| Code scope            | Access codes are unique to one game, one team, and one role.                                                    |
| Tracked team          | An SM session tracks only the team bound to its access code.                                                    |
| Home/away             | StatManager is supported for either the home or away team.                                                      |
| Official game control | StatManager cannot start, complete, or otherwise control the official game.                                     |
| Official score        | StatManager displays official score but cannot modify it.                                                       |
| StatManager goal      | A tracked observation, not an authoritative `GameGoals` record.                                                 |
| Game clock            | Not used by StatManager events and not required for StatManager operation.                                      |
| Event context         | Persist period, location, capture sequence, and server audit timestamps; do not persist game-clock time.        |
| Roster                | Read-only in StatManager MVP. No master player or roster mutation.                                              |
| Rink coordinates      | Persist normalized coordinates from `0.0` through `1.0`.                                                        |
| Zone timer            | Operator-controlled live-play stopwatch; stop at whistles; at most one zone interval is active per team.        |
| Concurrent devices    | Two SM writer slots are available per game/team; additional sessions are observers until they take over a slot. |
| Responsibility split  | Each capture domain is assigned exclusively to one writer slot and enforced by the API.                         |
| Final game            | StatManager becomes read-only when the game is final.                                                           |
| Offline operation     | Event capture is supported with idempotent queued synchronization.                                              |
| Reports               | Generated from server-persisted data and sent only after explicit confirmation.                                 |

## 4. Goals

StatManager MUST:

- provide fast tablet entry for the six event types defined by the component PDF plus the TipIn `shotattempt` extension;
- associate observations with rink location, period, capture sequence, zone, and optional player;
- track mutually exclusive offensive, neutral, and defensive zone intervals;
- operate during temporary internet loss without duplicate server records;
- operate without a scoreboard gateway or game-clock connection;
- recover the same game on a replacement device;
- isolate SM permissions from Game Manager and administrative permissions;
- produce game summaries and reports from server-authoritative observations;
- support two concurrent SM writer tablets for each team, including independent home and away teams, without data leakage or duplicate ownership.

## 5. Non-Goals

StatManager MVP MUST NOT:

- create games or change scheduled game identity;
- add, edit, remove, trade, or assign master players;
- change the master or game-day roster;
- start, pause, advance, finalize, or reopen the official game;
- change official goals, penalties, shots, score, or game status;
- write directly to `GameGoals` or `GamePenalties`;
- connect to or send commands to the scoreboard gateway;
- expose organization administration;
- permit one team's SM session to read player-level observations for the other team;
- use free-form JSON as the only persistent representation of core stat fields.

## 6. Users and Permissions

### 6.1 Stat Manager

An SM session MAY:

- read its assigned game and both team identities;
- read the tracking team's game-day roster;
- read official game status and available server-persisted score summary;
- create, update, and soft-delete observations in its assigned capture domains;
- create and close zone intervals only when assigned the zone-time domain;
- view its team's event log and summaries;
- generate and explicitly send its team's reports;
- claim one of its team's two SM writer slots or explicitly take over a slot;
- view the other writer's synchronized observations as read-only.

An SM session MUST NOT:

- access another game or team;
- read the other team's player-specific private observations;
- mutate official game records;
- mutate players or rosters;
- invoke GM lifecycle endpoints;
- write an event type or zone interval assigned to the other SM writer slot;
- invoke admin, schedule, team-management, or code-generation endpoints.

### 6.2 Game Manager

GM permissions remain governed by the Game Manager specification. GM and SM observations MUST remain separately attributable. A GM session MUST NOT automatically receive SM write authority unless a separate product decision grants that role and the server issues the corresponding scope.

### 6.3 Team Manager and Administrator

Authorized Team Managers, OrgAdmins, and SuperAdmins MAY generate or revoke per-game codes within their existing team or organization scope. Code generation MUST NOT reveal historical raw codes after the initial response.

### 6.4 Permission Matrix

| Capability                     |    GM session |                         SM session |       Team Manager |            OrgAdmin/SuperAdmin |
| ------------------------------ | ------------: | ---------------------------------: | -----------------: | -----------------------------: |
| Read assigned game             |           Yes |                                Yes |        Yes, scoped |                    Yes, scoped |
| Control game lifecycle         |           Yes |                                 No |                 No |   Administrative override only |
| Write official goals/penalties |           Yes |                                 No |                 No | Administrative correction only |
| Write StatManager observations | No by default | Yes, own team and assigned domains |                 No | Administrative correction only |
| Read tracking-team roster      |           Yes |                                Yes | Yes, assigned team |                    Yes, scoped |
| Modify master roster           |            No |                                 No | Yes, assigned team |                    Yes, scoped |
| Generate game access code      |            No |                                 No | Yes, assigned team |                    Yes, scoped |
| Send StatManager report        | No by default |                      Yes, own team | Yes, assigned team |                    Yes, scoped |
| Finalize official game         |           Yes |                                 No |                 No |   Administrative override only |

## 7. Mobile Application Architecture

### 7.1 One Application Shell

The current Expo application becomes a neutral TipIn game-operations shell. The installed package identity MAY remain unchanged for upgrade compatibility. The visible product name SHOULD become **TipIn Game Operations** when both modules ship.

The app MUST contain:

- a shared access-code login screen;
- a session bootstrap and role router;
- a Game Manager module;
- a StatManager module;
- shared API, secure storage, roster, connectivity, and synchronization services.

### 7.2 Module Isolation

StatManager MUST NOT be added as more conditional branches inside the existing monolithic `App.tsx`. Implementation SHOULD first establish module boundaries for shared login/session services and independent GM and SM navigation roots.

The technical target is:

```text
Application shell
  -> Session bootstrap
  -> Role router
       -> Game Manager navigation
       -> StatManager navigation
  -> Shared services
       -> API client
       -> Secure credentials
      -> Period context
      -> Live-play zone stopwatch
       -> Offline operation queue
       -> Connectivity and telemetry
```

The implementation MAY use React Navigation and a scoped state library if approved before dependency installation. State MUST be partitioned by session and game so data from a prior login cannot appear in a later session.

### 7.3 StatManager Navigation

The four bottom tabs are always visible as defined by the component PDF:

| Index | Label    | Screen           | Technical behavior                                                                   |
| ----: | -------- | ---------------- | ------------------------------------------------------------------------------------ |
|     0 | Game     | `GameScreen`     | Main tracking view, period, rink, stat summary, live-play zone timing, and event log |
|     1 | Setup    | `SetupScreen`    | Server game identity plus editable tracking preferences                              |
|     2 | Roster   | `RosterScreen`   | Read-only game-day roster, search/filter, and player stat lookup                     |
|     3 | Settings | `SettingsScreen` | App preferences and approved report/export configuration                             |

The tabs, modals, rink interactions, event controls, summary views, and settings in the component PDF remain the UI target. Product constraints in this document modify the PDF as follows:

- setup fields derived from the scheduled game are read-only;
- roster Add, Edit, and Remove actions are excluded from MVP;
- score and official game-state controls are read-only;
- the event selector contains seven options: Shot, Shot Attempt, Goal, Hit, Give Away, Take Away, and Blocked Shot;
- Shot Attempt uses its own marker style, event-log label, filter, period count, player count, and report count;
- event Goal records an SM observation only;
- report sending requires server persistence and explicit confirmation;
- security, lease, sync, final-lock, and degraded states MUST be visible where relevant.

### 7.4 Required Global States

The UI MUST represent these states without ambiguous controls:

- logged out;
- exchanging code;
- session active;
- session refresh required;
- loading game context;
- online and synchronized;
- offline with no queued operations;
- offline with queued operations;
- synchronization conflict;
- zone stopwatch running;
- zone stopwatch stopped for a whistle;
- writer lease active;
- writer slot and assigned responsibilities visible;
- second writer connected and synchronized;
- observer/read-only because another device owns the lease;
- final/read-only;
- revoked or expired session.

## 8. Game and Data Authority

### 8.1 Authority Matrix

| Domain                        | Authority                                                  | StatManager behavior                  |
| ----------------------------- | ---------------------------------------------------------- | ------------------------------------- |
| Game ID and scheduled teams   | TipIn API/database                                         | Read-only                             |
| Game status                   | TipIn API/database                                         | Read-only                             |
| Current period                | StatManager operator, initialized from server game context | Required event grouping context       |
| Game clock                    | Game Manager/official scoreboard                           | Not consumed or stored by StatManager |
| Official score summary        | TipIn API/database when available                          | Optional read-only display            |
| Official goals and penalties  | Game Manager/API official tables                           | Display only if needed                |
| SM observations               | `GameStatEvents`                                           | SM may write within scope             |
| Zone intervals                | `GameZoneIntervals`                                        | SM may write within scope             |
| Player identity               | `Players`                                                  | Read-only                             |
| Team-specific roster identity | `RosterEntries`                                            | Read-only                             |
| Writer ownership              | Server-issued lease                                        | Server enforced                       |

### 8.2 Game Selection

The server, not the app, MUST choose the eligible game during code exchange. Selection MUST use:

- the access code's stored game, team, and role bindings;
- game status;
- server UTC time;
- configured activation and expiration timestamps.

The client MUST NOT submit a date to prove that a code is valid. StatManager MUST support a tracking team that is either `HomeTeamId` or `AwayTeamId`.

### 8.3 Event Context and Ordering

StatManager point events MUST NOT capture or require game-clock time. Each event records:

- current period selected in StatManager;
- a client-generated capture sequence scoped to the device session;
- a client capture timestamp used only for synchronization and audit diagnostics;
- server creation and update timestamps;
- rink location, zone, event type, and optional player context.

Period and capture sequence support in-game pattern review and deterministic offline ordering. Client and server timestamps are audit metadata, not official game time, and MUST NOT be displayed or reported as the time an event occurred in the game.

## 9. Authentication and Session Security

### 9.1 Access Code Lifecycle

GM and SM codes MUST be:

- cryptographically random;
- unique per game, team, and role;
- generated by an authorized Team Manager or administrator;
- stored as a slow password hash with a per-code salt;
- displayed only when generated or explicitly rotated;
- revocable;
- single-purpose and unusable on admin endpoints;
- activated and expired using server timestamps;
- invalidated after the configured post-final grace period;
- protected by attempt throttling.

The existing `Teams.ScorekeeperCode` and `Teams.StatManagerCode` fields are transitional only. The target source of truth is `GameAccessCodes`. New StatManager production sessions MUST NOT depend on permanent team-level plaintext codes.

One valid per-game/team SM code MAY establish two concurrently writing device sessions. Each device receives its own access token, refresh-token family, session ID, and audit identity; credentials MUST NOT be copied between tablets. A third device MAY authenticate as an observer or replacement candidate but cannot write until it takes over `SM1` or `SM2`.

### 9.2 Code Exchange

The raw code MUST be sent only in the JSON body of an HTTPS `POST`. It MUST NOT appear in a route, query string, analytics event, trace, or application log.

```http
POST /api/mobile/sessions/exchange
Content-Type: application/json

{
  "accessCode": "SM-ABC123",
  "deviceId": "installation-scoped-random-id",
  "deviceName": "Score Table 2",
  "appVersion": "1.0.0"
}
```

Successful response:

```json
{
  "accessToken": "opaque-or-signed-short-lived-token",
  "refreshToken": "rotating-refresh-token",
  "expiresInSeconds": 1800,
  "session": {
    "sessionId": "uuid",
    "role": "SM",
    "gameId": "uuid",
    "teamId": "uuid",
    "permissions": [
      "statEvents:read",
      "statEvents:write",
      "zoneIntervals:write",
      "reports:send"
    ],
    "gameStatus": "Scheduled"
  }
}
```

Failure responses MUST use a generic operator message such as `Access code is invalid or unavailable`. Detailed rejection reasons MAY be stored in protected audit records but MUST NOT enable code or game enumeration.

The exchange or bootstrap response MUST report `writerSlot`, both slot statuses, current capture assignments, and `assignmentVersion`. Before claiming a slot, `writerSlot` is `null` and the session is read-only.

### 9.3 Access and Refresh Credentials

- Access tokens MUST expire after 30 minutes or less.
- Refresh tokens MUST rotate on every successful refresh.
- Refresh token reuse MUST revoke the session family.
- Native credentials MUST be stored with Expo SecureStore or an equivalent OS credential store.
- Raw credentials MUST NOT be stored in AsyncStorage, application state snapshots, crash reports, or logs.
- The app MUST clear credentials and game-scoped local data on logout, revocation, or unrecoverable refresh failure.
- A session MUST expire after 45 minutes without authenticated activity unless an approved active-game policy extends it.
- A session MUST NOT continue beyond the access code's final expiration.

### 9.4 Authorization Enforcement

Every protected endpoint MUST validate:

- token signature or opaque-token lookup;
- session existence and non-revoked state;
- token expiration and idle timeout;
- role and permission;
- route `GameId` equals session `GameId`;
- payload `TeamId` equals session `TeamId` where applicable;
- game status allows the operation;
- current writer-slot lease, fencing token, and assignment version for write operations;
- requested capture domain is assigned to the writer's slot;
- referenced players belong to the session team's game-day roster.

The API MUST derive game, team, role, and session identifiers from authenticated claims. It MUST NOT trust client values to widen scope.

### 9.5 Rate Limiting and Audit

Code exchange SHOULD begin with these configurable limits:

- no more than 5 failed attempts per code/IP bucket in 15 minutes;
- progressive delay after repeated failures;
- device and IP anomaly monitoring;
- generic `429 Too Many Requests` response with `Retry-After`.

Audit records MUST capture:

- event type and outcome;
- server timestamp;
- session, game, team, and role when known;
- code record ID when known, never the raw code;
- device ID and app version;
- truncated or protected network metadata according to retention policy;
- create, edit, delete, report-send, lease, takeover, refresh, revoke, and final-lock actions.

## 10. Two-Writer Coordination and Device Recovery

### 10.1 Writer Slots

Each team has exactly two numbered StatManager writer slots for a game:

- `SM1`, represented by `WriterSlot=1`;
- `SM2`, represented by `WriterSlot=2`.

A writer lease is unique for `(GameId, TeamId, Role, WriterSlot)`. Therefore, one team may have two concurrent SM writers and a game may have four concurrent SM writers when both home and away teams use both slots. GM leases remain independent. Additional authenticated SM sessions MAY observe and request takeover but MUST NOT write without owning a slot.

Both writer tablets MUST receive the same merged, server-synchronized event log and summary. A tablet MUST visually distinguish its editable domains from events owned by the other slot.

### 10.2 Capture Domains

Write responsibility is divided into these stable capture domains:

| Capture domain | Permitted records                       |
| -------------- | --------------------------------------- |
| `zone_time`    | Start, stop, and correct zone intervals |
| `shot`         | Shot observations                       |
| `shotattempt`  | Shot Attempt observations               |
| `goal`         | Goal observations                       |
| `hit`          | Hit observations                        |
| `giveaway`     | Give Away observations                  |
| `takeaway`     | Take Away observations                  |
| `blockedshot`  | Blocked Shot observations               |

Each enabled capture domain MUST be assigned to exactly one writer slot for a game/team. The recommended assignment for the described two-tablet workflow is:

| Writer slot | Assignment                            |
| ----------- | ------------------------------------- |
| `SM1`       | `zone_time`, `hit`                    |
| `SM2`       | `giveaway`, `takeaway`, `blockedshot` |

`shot`, `shotattempt`, and `goal` remain configurable. They MAY be assigned to either slot or disabled when Game Manager is the chosen source and no separate SM observation is required. An enabled domain MUST NOT be assigned to both slots.

The assignment screen MUST show all domains before tracking begins. Claiming the first slot MAY save an initial split; the second slot receives the remaining assignment. The server is authoritative and MUST reject overlapping assignments with `409 assignment_conflict`.

### 10.3 Lease and Assignment Behavior

- A successful SM login creates a session but does not silently replace a healthy writer.
- A device MUST claim `SM1` or `SM2` before submitting mutations.
- No session may own both slots concurrently.
- Each slot owner MUST heartbeat at a configurable interval, initially 20 seconds.
- The initial lease duration SHOULD be 60 seconds.
- A disconnected writer may continue collecting offline observations locally.
- The server remains authoritative for which device may synchronize writes.
- Another authenticated session MAY explicitly take over a specific slot after a warning.
- Takeover MUST revoke only the selected slot's old lease and increment its fencing token.
- Every write MUST include the writer slot, current fencing token, and assignment version.
- The API MUST map an event's stable code to its capture domain and verify that domain belongs to the calling slot.
- The API MUST verify `zone_time` ownership for every zone-interval mutation.
- By default, a writer MAY update or delete records in its assigned domain even when the record was created by the prior owner of the same slot. Optimistic revision checks still apply.
- A stale device MUST receive `409 lease_lost` and become read-only until it reacquires authority.

### 10.4 Responsibility Changes

Assignments MAY be changed during a game only through an explicit coordination action visible on both tablets. The server MUST:

1. require both affected slots to be online, or require a takeover/administrative confirmation;
2. reject reassignment while the old owner reports unsynchronized operations for that domain unless the operator explicitly accepts the recovery risk;
3. update assignments atomically;
4. increment `AssignmentVersion`;
5. return the new assignment map to both tablets;
6. reject old queued writes with `409 assignment_changed`.

An assignment change transfers edit authority for existing records in that domain to the new slot. It does not change record authorship or audit history.

### 10.5 Recovery

A replacement device MUST:

1. exchange the same still-valid SM code;
2. load the existing game and synchronized observations;
3. show both slot owners, current assignments, current period, zone stopwatch state, and last server synchronization;
4. claim the same expired writer slot or explicitly take over that slot;
5. receive the slot's current capture-domain assignments and assignment version;
6. merge only idempotent locally queued operations with current slot, assignment, and fencing authority;
7. require operator confirmation before resuming any recovered active zone stopwatch;
8. never change official game state.

## 11. Database Design

All schema changes require reviewed, versioned SQL migrations. Runtime `CREATE TABLE` statements MUST NOT be used for the new StatManager schema.

### 11.1 `GameAccessCodes`

| Column            | Type                       | Rules                            |
| ----------------- | -------------------------- | -------------------------------- |
| `Id`              | `uniqueidentifier`         | Primary key                      |
| `GameId`          | `uniqueidentifier`         | FK to `Games`, required          |
| `TeamId`          | `uniqueidentifier`         | FK to `Teams`, required          |
| `Role`            | `nvarchar(10)`             | `GM` or `SM`                     |
| `CodeHash`        | `varbinary`/encoded string | Required; never return           |
| `CodeSalt`        | `varbinary`/encoded string | Required; never return           |
| `CodeHint`        | `nvarchar(16)`             | Optional non-secret display hint |
| `ValidFromUtc`    | `datetime2`                | Required                         |
| `ExpiresAtUtc`    | `datetime2`                | Required                         |
| `RevokedAtUtc`    | `datetime2`                | Nullable                         |
| `RevokedByUserId` | `uniqueidentifier`         | Nullable FK where supported      |
| `CreatedAtUtc`    | `datetime2`                | Required                         |
| `CreatedByUserId` | `uniqueidentifier`         | Required                         |

Required constraints/indexes:

- unique active assignment for `(GameId, TeamId, Role)`;
- lookup support for active game/team/role records;
- check constraint limiting role values;
- no index containing raw codes because raw codes are never stored.

### 11.2 `MobileGameSessions`

| Column              | Type               | Rules                                           |
| ------------------- | ------------------ | ----------------------------------------------- |
| `Id`                | `uniqueidentifier` | Primary key/session ID                          |
| `GameAccessCodeId`  | `uniqueidentifier` | FK to `GameAccessCodes`                         |
| `GameId`            | `uniqueidentifier` | Required, indexed                               |
| `TeamId`            | `uniqueidentifier` | Required, indexed                               |
| `Role`              | `nvarchar(10)`     | Required                                        |
| `WriterSlot`        | `tinyint`          | Nullable until claim; `1` or `2` for SM writers |
| `DeviceId`          | `nvarchar(128)`    | Installation-scoped identifier                  |
| `DeviceName`        | `nvarchar(128)`    | Operator-visible label                          |
| `RefreshTokenHash`  | protected value    | Required while refresh is active                |
| `TokenFamilyId`     | `uniqueidentifier` | Refresh reuse detection                         |
| `IssuedAtUtc`       | `datetime2`        | Required                                        |
| `LastActivityAtUtc` | `datetime2`        | Required                                        |
| `ExpiresAtUtc`      | `datetime2`        | Hard session expiration                         |
| `RevokedAtUtc`      | `datetime2`        | Nullable                                        |
| `RevocationReason`  | `nvarchar(100)`    | Nullable                                        |
| `AppVersion`        | `nvarchar(32)`     | Required                                        |

### 11.3 `GameWriterLeases`

| Column           | Type               | Rules                    |
| ---------------- | ------------------ | ------------------------ |
| `Id`             | `uniqueidentifier` | Primary key              |
| `GameId`         | `uniqueidentifier` | Required                 |
| `TeamId`         | `uniqueidentifier` | Required                 |
| `Role`           | `nvarchar(10)`     | Required                 |
| `WriterSlot`     | `tinyint`          | `1` or `2` for SM        |
| `SessionId`      | `uniqueidentifier` | Current owner            |
| `FencingToken`   | `bigint`           | Monotonically increasing |
| `AcquiredAtUtc`  | `datetime2`        | Required                 |
| `HeartbeatAtUtc` | `datetime2`        | Required                 |
| `ExpiresAtUtc`   | `datetime2`        | Required                 |

Required constraints:

- unique `(GameId, TeamId, Role, WriterSlot)`;
- check `WriterSlot IN (1, 2)` for SM leases;
- one active writer slot per session.

### 11.4 `GameStatCaptureAssignments`

This table provides normalized, server-enforced responsibility ownership.

| Column                | Type               | Rules                                           |
| --------------------- | ------------------ | ----------------------------------------------- |
| `Id`                  | `uniqueidentifier` | Primary key                                     |
| `GameId`              | `uniqueidentifier` | FK to `Games`, required                         |
| `TrackingTeamId`      | `uniqueidentifier` | FK to `Teams`, required                         |
| `CaptureDomain`       | `nvarchar(30)`     | Stable code from section 10.2                   |
| `WriterSlot`          | `tinyint`          | `1` or `2`                                      |
| `AssignmentVersion`   | `bigint`           | Incremented atomically on any assignment change |
| `AssignedAtUtc`       | `datetime2`        | Server timestamp                                |
| `AssignedBySessionId` | `uniqueidentifier` | Audited assigning session                       |

Required constraints/indexes:

- unique `(GameId, TrackingTeamId, CaptureDomain)` so a domain has one owner;
- check `WriterSlot IN (1, 2)`;
- check capture domain against the approved stable values;
- index `(GameId, TrackingTeamId, WriterSlot)` for authorization lookup.

### 11.5 `GameStatEvents`

This table stores analytical StatManager observations and is separate from official `GameEvents`, `GameGoals`, and `GamePenalties`.

The approved event contract contains the six component-PDF events plus the TipIn Shot Attempt extension:

| Stable code   | Display label | Rink point |   Player | Strength state | Official scoring effect |
| ------------- | ------------- | ---------: | -------: | -------------: | ----------------------- |
| `shot`        | Shot          |   Required | Optional |       Required | None                    |
| `shotattempt` | Shot Attempt  |   Required | Optional |       Optional | None                    |
| `goal`        | Goal          |   Required | Optional |       Required | None; observation only  |
| `hit`         | Hit           |   Required | Optional |       Optional | None                    |
| `giveaway`    | Give Away     |   Required | Optional |       Optional | None                    |
| `takeaway`    | Take Away     |   Required | Optional |       Optional | None                    |
| `blockedshot` | Blocked Shot  |   Required | Optional |       Required | None                    |

Display labels MAY be localized later. Stable codes MUST NOT change without a versioned API and data migration. An omitted player is stored as an unattributed team event, not rejected or assigned to a placeholder player.

Shot classifications are mutually exclusive for one physical attempt:

- `shot` means a shot on goal;
- `blockedshot` means an attempt blocked before reaching the goal;
- `shotattempt` means a missed-net or otherwise unclassified attempt toward goal that is neither a shot on goal nor a blocked shot;
- `goal` is a goal-location observation and MUST NOT also create a `shot` or `shotattempt` event automatically.

The operator records one classification per physical attempt. Reports MAY calculate total attempts as `shot + blockedshot + shotattempt + goal`, but MUST label that derived metric clearly and MUST NOT treat it as an official Game Manager shot total.

| Column                | Type               | Rules                                                      |
| --------------------- | ------------------ | ---------------------------------------------------------- |
| `Id`                  | `uniqueidentifier` | Primary key, server assigned                               |
| `ClientEventId`       | `uniqueidentifier` | Client idempotency key                                     |
| `GameId`              | `uniqueidentifier` | FK to `Games`, required                                    |
| `TrackingTeamId`      | `uniqueidentifier` | FK to `Teams`, required                                    |
| `PlayerId`            | `uniqueidentifier` | Nullable FK to `Players`                                   |
| `EventType`           | `nvarchar(30)`     | One of the seven approved StatManager event types          |
| `Period`              | `int`              | Required, positive                                         |
| `CaptureSequence`     | `bigint`           | Required; monotonically increasing within creating session |
| `ClientCapturedAtUtc` | `datetime2`        | Audit/synchronization metadata; not official game time     |
| `NormalizedX`         | `decimal(6,5)`     | Required, `0.0` through `1.0`                              |
| `NormalizedY`         | `decimal(6,5)`     | Required, `0.0` through `1.0`                              |
| `Zone`                | `nvarchar(10)`     | `OZONE`, `NZONE`, or `DZONE`                               |
| `AttackingDirection`  | `nvarchar(10)`     | `LEFT` or `RIGHT`                                          |
| `StrengthState`       | `nvarchar(20)`     | Nullable approved value                                    |
| `Outcome`             | `nvarchar(30)`     | Nullable event-specific approved value                     |
| `Notes`               | `nvarchar(500)`    | Nullable, sanitized                                        |
| `SourceRole`          | `nvarchar(10)`     | `SM`                                                       |
| `SessionId`           | `uniqueidentifier` | Creating session                                           |
| `CreatedByWriterSlot` | `tinyint`          | Immutable authorship slot                                  |
| `CaptureDomain`       | `nvarchar(30)`     | Derived from event type                                    |
| `AssignmentVersion`   | `bigint`           | Assignment used at creation                                |
| `Revision`            | `int`              | Starts at 1; optimistic concurrency                        |
| `CreatedAtUtc`        | `datetime2`        | Server timestamp                                           |
| `UpdatedAtUtc`        | `datetime2`        | Server timestamp                                           |
| `DeletedAtUtc`        | `datetime2`        | Nullable soft delete                                       |
| `DeletedBySessionId`  | `uniqueidentifier` | Nullable                                                   |

Required constraints/indexes:

- unique `(GameId, ClientEventId)`;
- unique `(SessionId, CaptureSequence)`;
- index `(GameId, TrackingTeamId, Period, EventType)`;
- index `(GameId, TrackingTeamId, EventType)`;
- checks for period, positive capture sequence, coordinates, zone, direction, and revision;
- server validation that tracking team belongs to the game;
- server validation that player is on the tracking team's game-day roster.

Server and client MUST share these stable event codes. Database values MUST use stable codes rather than display labels.

### 11.6 `GameZoneIntervals`

| Column                 | Type               | Rules                                                           |
| ---------------------- | ------------------ | --------------------------------------------------------------- |
| `Id`                   | `uniqueidentifier` | Primary key                                                     |
| `ClientIntervalId`     | `uniqueidentifier` | Idempotency key                                                 |
| `GameId`               | `uniqueidentifier` | FK to `Games`                                                   |
| `TrackingTeamId`       | `uniqueidentifier` | FK to `Teams`                                                   |
| `Period`               | `int`              | Required                                                        |
| `Zone`                 | `nvarchar(10)`     | `OZONE`, `NZONE`, or `DZONE`                                    |
| `Status`               | `nvarchar(20)`     | `active`, `closed`, or `incomplete`                             |
| `DurationMilliseconds` | `bigint`           | Nullable while active; canonical live-play duration when closed |
| `ClientStartedAtUtc`   | `datetime2`        | Audit/recovery metadata, not game-clock time                    |
| `ClientEndedAtUtc`     | `datetime2`        | Nullable audit/recovery metadata                                |
| `SessionId`            | `uniqueidentifier` | Creating session                                                |
| `CreatedByWriterSlot`  | `tinyint`          | Immutable authorship slot                                       |
| `AssignmentVersion`    | `bigint`           | Assignment used at creation                                     |
| `Revision`             | `int`              | Optimistic concurrency                                          |
| `CreatedAtUtc`         | `datetime2`        | Server timestamp                                                |
| `UpdatedAtUtc`         | `datetime2`        | Server timestamp                                                |
| `DeletedAtUtc`         | `datetime2`        | Nullable soft delete                                            |

Required constraints/indexes:

- unique `(GameId, ClientIntervalId)`;
- filtered unique index allowing only one `active` interval for `(GameId, TrackingTeamId)`;
- `closed` requires a non-negative duration;
- `incomplete` intervals are excluded from totals until operator correction;
- period and zone checks.

Starting a zone MUST atomically close the currently active zone using the client monotonic duration and then open the new zone. A whistle, period transition, or explicit stop MUST close the active stopwatch. If device loss or external game finalization occurs before a final duration is submitted, the server marks the interval `incomplete`; it MUST NOT fabricate duration from wall-clock time. Client UTC timestamps support audit and recovery only; zone totals MUST use completed `DurationMilliseconds` values and MUST NOT be reconstructed from wall-clock timestamps.

### 11.7 `GameAccessAudit`

The audit table records protected access and mutation history. It SHOULD include `Id`, `OccurredAtUtc`, `Action`, `Outcome`, optional session/code/game/team identifiers, role, device ID, app version, request correlation ID, protected network metadata, entity type/ID, and non-secret reason code.

Audit retention and access MUST follow organization policy. Audit records MUST NOT contain raw access codes, bearer tokens, refresh tokens, or unrestricted request bodies.

## 12. API Design

All responses use camelCase. Protected endpoints require `Authorization: Bearer <accessToken>`. All SM writes require `X-Writer-Slot`, `X-Lease-Fencing-Token`, and `X-Assignment-Version`, plus an idempotency identifier where specified.

### 12.1 Session Endpoints

| Method and route                     | Purpose                                     |
| ------------------------------------ | ------------------------------------------- |
| `POST /api/mobile/sessions/exchange` | Exchange raw code for scoped mobile session |
| `POST /api/mobile/sessions/refresh`  | Rotate refresh token and issue access token |
| `POST /api/mobile/sessions/logout`   | Revoke current session and refresh family   |
| `GET /api/mobile/sessions/current`   | Restore session and game scope              |

### 12.2 Lease Endpoints

| Method and route                                                | Purpose                                              |
| --------------------------------------------------------------- | ---------------------------------------------------- |
| `POST /api/mobile/games/{gameId}/writer-slots/{slot}/claim`     | Claim available `SM1` or `SM2`                       |
| `POST /api/mobile/games/{gameId}/writer-slots/{slot}/heartbeat` | Extend the owned slot lease                          |
| `POST /api/mobile/games/{gameId}/writer-slots/{slot}/takeover`  | Explicitly fence the selected slot's previous writer |
| `DELETE /api/mobile/games/{gameId}/writer-slots/{slot}`         | Release the owned slot                               |
| `GET /api/mobile/games/{gameId}/capture-assignments`            | Read both slots and assignment version               |
| `PUT /api/mobile/games/{gameId}/capture-assignments`            | Atomically update domain ownership                   |

### 12.3 Bootstrap Endpoints

| Method and route                                           | Purpose                                                                     |
| ---------------------------------------------------------- | --------------------------------------------------------------------------- |
| `GET /api/mobile/games/{gameId}/stat-manager/bootstrap`    | Game, role, team, roster, settings, official display state, and sync cursor |
| `GET /api/mobile/games/{gameId}/stat-events?cursor=...`    | Incremental event synchronization                                           |
| `GET /api/mobile/games/{gameId}/zone-intervals?cursor=...` | Incremental interval synchronization                                        |

The bootstrap response MUST derive `gameId` and tracking team authorization from the session. It returns both team display identities but only the tracking team's roster and private SM observations.

The bootstrap response MUST also return both SM slot states, device-safe owner labels, capture assignments, assignment version, and lease expiry. Incremental synchronization MUST merge accepted writes from both slots into the same event and summary projections on both tablets.

### 12.4 Event Endpoints

| Method and route                                          | Purpose                            |
| --------------------------------------------------------- | ---------------------------------- |
| `POST /api/mobile/games/{gameId}/stat-events`             | Idempotently create an observation |
| `PUT /api/mobile/games/{gameId}/stat-events/{eventId}`    | Update with expected revision      |
| `DELETE /api/mobile/games/{gameId}/stat-events/{eventId}` | Soft-delete with expected revision |

Create request shape:

```json
{
  "clientEventId": "uuid",
  "eventType": "stable-event-code",
  "playerId": "uuid-or-null",
  "period": 2,
  "captureSequence": 431,
  "clientCapturedAtUtc": "2026-08-25T19:34:12.125Z",
  "normalizedX": 0.74215,
  "normalizedY": 0.3812,
  "zone": "OZONE",
  "attackingDirection": "RIGHT",
  "strengthState": "EVEN",
  "outcome": null,
  "notes": null
}
```

Create response returns `eventId`, `clientEventId`, `captureSequence`, `revision`, server timestamps, and a synchronization cursor. Repeating the same `(GameId, ClientEventId)` MUST return the original logical result without inserting a duplicate.

Updates and deletes MUST include `expectedRevision`. Revision mismatch returns `409 revision_conflict` with the current server representation.

### 12.5 Zone Endpoints

| Method and route                                                   | Purpose                                             |
| ------------------------------------------------------------------ | --------------------------------------------------- |
| `POST /api/mobile/games/{gameId}/zone-intervals/start`             | Atomically close prior zone and start selected zone |
| `POST /api/mobile/games/{gameId}/zone-intervals/{intervalId}/stop` | Close the current interval                          |
| `PUT /api/mobile/games/{gameId}/zone-intervals/{intervalId}`       | Correct interval with expected revision             |
| `DELETE /api/mobile/games/{gameId}/zone-intervals/{intervalId}`    | Soft-delete correction                              |

Starting or switching zones MUST include `clientIntervalId`, `period`, selected `zone`, `captureSequence`, and the final monotonic `durationMilliseconds` for any interval being closed. Stopping MUST include the final `durationMilliseconds` and expected revision. The server validates ordering and stores duration but does not calculate live-play duration from request arrival time.

### 12.6 Summary and Report Endpoints

| Method and route                                                       | Purpose                                 |
| ---------------------------------------------------------------------- | --------------------------------------- |
| `GET /api/mobile/games/{gameId}/stat-manager/summary`                  | Server-calculated summary               |
| `POST /api/mobile/games/{gameId}/stat-manager/reports`                 | Generate report from persisted revision |
| `POST /api/mobile/games/{gameId}/stat-manager/reports/{reportId}/send` | Explicitly send to approved recipients  |

Report generation MUST identify the included server revision/cursor. Sending MUST reject arbitrary unapproved recipients unless the authenticated administrative policy allows them.

### 12.7 Error Contract

Errors SHOULD use:

```json
{
  "error": {
    "code": "lease_lost",
    "message": "This device no longer has editing control.",
    "correlationId": "uuid",
    "retryable": false
  }
}
```

Required codes include `invalid_request`, `unauthorized`, `session_expired`, `forbidden`, `game_not_available`, `game_final`, `lease_required`, `lease_lost`, `writer_slot_unavailable`, `capture_domain_forbidden`, `assignment_conflict`, `assignment_changed`, `revision_conflict`, `validation_failed`, `rate_limited`, and `service_unavailable`.

## 13. Offline Synchronization

### 13.1 Local Storage

The app MAY store non-secret, game-scoped cached data and queued operations in AsyncStorage. It MUST NOT store raw access codes or session credentials there.

Each queued operation MUST include:

- local operation ID;
- client event/interval ID;
- game ID and tracking team ID;
- operation type;
- payload;
- base revision for edits/deletes;
- writer slot, fencing token, and assignment version at capture;
- capture domain;
- capture timestamp;
- retry count and last error;
- local ordering sequence.

### 13.2 Queue Rules

- The UI applies a local optimistic projection immediately.
- Creates are retried using the same client ID.
- Operations synchronize in capture order where order affects zone intervals.
- Network failures use bounded exponential backoff with jitter.
- Authentication failures pause the queue until refresh succeeds.
- Lease loss pauses writes and presents takeover/reacquire choices.
- Assignment changes pause affected queued writes and require operator review; they are never silently reassigned.
- Validation and revision conflicts do not retry silently.
- Logout warns when unsynchronized operations exist.
- Local game data is partitioned by session scope and removed according to retention policy.

### 13.3 Conflict Rules

| Conflict                                 | Required result                                                                                  |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Duplicate create retry                   | Return existing event; no duplicate row                                                          |
| Edit of newer server revision            | Show conflict and current server event                                                           |
| Delete of newer server revision          | Show conflict; do not silently delete                                                            |
| Stale fencing token                      | Reject; device becomes observer                                                                  |
| Event type belongs to other writer       | Reject with `capture_domain_forbidden`; retain locally for operator review                       |
| Assignment changed after offline capture | Reject with `assignment_changed`; do not silently move authorship                                |
| Game finalized while offline             | Reject queued mutations; preserve an exportable local recovery record for authorized review      |
| Zone start overlaps server interval      | Server atomically closes or rejects according to current lease/order; return canonical intervals |

Automatic last-write-wins is prohibited for event edits, deletes, and interval corrections.

## 14. Rink Coordinates and Zone Semantics

- Rink taps MUST be transformed from rendered coordinates into normalized rink coordinates.
- `(0,0)` MUST represent the documented top-left of the canonical rink image and `(1,1)` its bottom-right.
- Coordinates MUST be clamped and server validated.
- The event MUST record attacking direction so the meaning survives period side changes.
- Zone SHOULD be derived using canonical rink boundaries and validated against the client value.
- Changing visual dimensions or device orientation MUST NOT change stored locations.
- Historical coordinates MUST NOT be rewritten when teams switch ends.

The selected rink location, event type, player, period, and team MUST be confirmed before the event is committed. The interaction SHOULD minimize taps while preventing accidental double submission.

## 15. Zone Timing

- Zone time means live-play time spent in each zone, not possession time and not continuous wall-clock period time.
- Zones are interpreted relative to the tracking team's attacking direction.
- Valid zones are offensive, neutral, and defensive.
- The tablet owning `zone_time` runs one local monotonic stopwatch independent of the game clock.
- Tapping a zone starts its stopwatch when none is active.
- Tapping a different zone closes the active interval at its accumulated duration and immediately starts the selected zone.
- At every whistle, the operator MUST tap **Stop** so stoppage time is excluded.
- When live play resumes, the operator taps the zone containing the puck to begin a new interval.
- Tapping **Stop** or the active zone closes the active interval without starting another.
- A period transition closes the open interval.
- A side switch changes zone interpretation for subsequent intervals only.
- Ending StatManager tracking closes the active interval using its monotonic duration.
- If the official game becomes final before that duration reaches the server, the interval is marked incomplete and excluded until authorized operator review.
- Stopwatch duration MUST use a monotonic runtime source so device wall-clock changes cannot alter totals.
- Moving the app to the background MUST stop the active interval and require explicit operator restart on return.
- The app SHOULD checkpoint the active interval locally so crash recovery can present the last known accumulated duration for operator confirmation.
- Zone totals are the sum of closed `DurationMilliseconds` values and exclude every stopped period, including whistles and operator pauses.
- Only the tablet assigned `zone_time` may control the stopwatch; the second tablet displays synchronized totals as read-only.

## 16. No Game-Clock Dependency

StatManager MUST operate without the physical scoreboard, ESP32 gateway, Game Manager clock, or a manually synchronized game clock.

### 16.1 Point Events

- Point-event capture MUST NOT show or request a game-clock value.
- Point events MUST NOT store game-clock elapsed or remaining time.
- Event ordering uses period, session capture sequence, and server synchronization cursor.
- Goal observations remain spatial coaching observations; official goal time remains exclusively in Game Manager.

### 16.2 Period Selection

- The current period is initialized from available server game context and may be corrected by the StatManager operator.
- Changing period closes any active zone interval and requires confirmation.
- Period selection groups observations for pattern review but does not control the official game period.

### 16.3 Shared Application Boundary

The shared mobile binary MAY retain Game Manager scoreboard integration inside the Game Manager module. StatManager MUST NOT initialize that connection, request gateway credentials, or depend on its state.

## 17. Finalization, Corrections, and Reporting

### 17.1 Finalization

Only the official game authority may mark the game final. When the API reports final:

- new SM writes are rejected;
- an active zone interval with no submitted final duration is marked incomplete rather than assigned an inferred duration;
- queued local writes are paused and reported;
- StatManager enters read-only summary mode;
- access remains available only through the configured grace period;
- the code and sessions expire at the end of that period.

Reopening or correcting a final game requires an authenticated administrative workflow outside the SM code session.

### 17.2 Reports

Reports MUST:

- be calculated from server-persisted, non-deleted observations;
- identify game, tracking team, generated timestamp, and included data revision;
- clearly label SM goals and similar events as observations rather than official scoring records;
- report Shot, Shot Attempt, Goal, and Blocked Shot as separate classifications;
- label any calculated total-attempt value as a derived StatManager metric;
- include zone totals based only on valid, closed, non-overlapping intervals and identify incomplete intervals for review;
- exclude other-team private player observations;
- support PDF and CSV where specified by the component design;
- be generated on the server for consistent output;
- require explicit confirmation before email transmission;
- audit generation and delivery outcome.

## 18. Privacy, Logging, and Retention

- Collect only data required for game operations and reporting.
- Never log raw codes or credentials.
- Avoid logging player names in routine request traces.
- Sanitize free-text notes and report output.
- Encrypt transport with HTTPS/TLS.
- Use database encryption and backup controls provided by the deployment platform.
- Restrict audit and detailed player stat access by organization scope.
- Define retention for sessions, audit events, local device caches, and generated reports before production release.
- Crash reporting MUST redact headers, request bodies, codes, tokens, device secrets, and player data where possible.

## 19. Observability and Operations

The service SHOULD measure without secret or player-data leakage:

- code exchange success/failure/rate-limit counts;
- active sessions and leases;
- lease takeover count;
- active `SM1` and `SM2` slots by game/team;
- capture assignment changes, forbidden-domain attempts, and assignment conflicts;
- API latency and failure rate by endpoint;
- queued-operation age and synchronization failures;
- idempotent duplicate suppression;
- revision conflict count;
- zone stopwatch starts, stops, recoveries, and synchronization failures;
- report generation and delivery outcomes.

Every API response SHOULD include a correlation ID. Mobile diagnostics SHOULD allow an operator to report app version, game ID, session ID, sync status, and correlation ID without exposing credentials.

## 20. Delivery Plan and Gates

### Phase 0: Contract Approval

- Approve section 3 product decisions.
- Freeze the seven event codes and event-specific fields, including the TipIn `shotattempt` extension.
- Approve code activation, final grace, idle timeout, and report recipient policy.
- Approve this schema and endpoint namespace.

**Gate:** Product, API, mobile, database, and security owners sign off.

### Phase 1: Security Foundation

- Add `GameAccessCodes`, sessions, audit, two writer-slot leases, and capture assignments through versioned migrations.
- Add code exchange, refresh, logout, claim, heartbeat, takeover, and revocation.
- Hash newly generated per-game codes.
- Protect existing mobile write endpoints by role and game scope before shared-shell release.

**Gate:** Authorization integration tests prove cross-game, cross-team, cross-role, expired, revoked, stale-slot, wrong-domain, stale-assignment, and final-game writes are rejected.

### Phase 2: Stat Data Foundation

- Add `GameStatEvents` and `GameZoneIntervals`.
- Implement DTO, validation, service, repository, and API layers.
- Implement idempotency, optimistic concurrency, soft delete, and incremental sync.

**Gate:** API and database tests prove duplicate prevention, interval exclusivity, roster validation, and conflict behavior.

### Phase 3: Shared Mobile Foundation

- Extract shared login, secure session, API, roster, and synchronization services while keeping clock/scoreboard services inside Game Manager.
- Add role router and isolated GM/SM navigation roots.
- Preserve current GM behavior through regression testing.

**Gate:** Both code types reach only their authorized module; GM regression suite passes.

### Phase 4: StatManager MVP

- Implement PDF navigation and visual components.
- Implement scheduled game setup, read-only roster, rink event capture, player selection, event log, zone timing, connection states, and offline queue.
- Implement two-slot selection, responsibility assignment, shared live feed, observer, takeover, final, and conflict states.

**Gate:** End-to-end tests pass on supported Android tablet sizes online, offline, and during replacement-device recovery.

### Phase 5: Summary and Reporting

- Add server summaries, PDF/CSV generation, recipient confirmation, email delivery, and audit.

**Gate:** Calculations reconcile against seeded games and reports contain the exact server revision shown in the app.

### Phase 6: Production Hardening

- Complete threat review, load testing, accessibility review, telemetry redaction, backup/recovery test, and operational runbooks.
- Build and validate a release APK using the mobile release checklist.

**Gate:** Production readiness review approves deployment.

## 21. Approval Items

The following values must be explicitly approved before implementation. Recommended defaults are included.

| Item                                    | Recommended default                                                          |
| --------------------------------------- | ---------------------------------------------------------------------------- |
| Code activation                         | Four hours before scheduled start                                            |
| Scheduled-game expiry when not started  | Six hours after scheduled start                                              |
| Post-final grace period                 | Two hours                                                                    |
| Access token lifetime                   | 30 minutes                                                                   |
| Idle timeout                            | 45 minutes, with approved active-game refresh behavior                       |
| Writer lease heartbeat/duration         | 20 seconds / 60 seconds                                                      |
| SM writer capacity                      | Two active writer slots per game/team                                        |
| Default responsibility split            | `SM1`: zone time and hits; `SM2`: giveaways, takeaways, and blocked shots    |
| Shot, shot-attempt, and goal assignment | Configurable to either slot or disabled                                      |
| Stat goal authority                     | Observation only                                                             |
| Master roster editing                   | Excluded                                                                     |
| Tracking scope                          | Code-bound team only; home or away                                           |
| Zone timer model                        | Mutually exclusive live-play stopwatch intervals; operator stops at whistles |
| Final-game edits                        | Administrative correction workflow only                                      |
| Report recipients                       | Preconfigured team contacts plus confirmed approved recipients               |
| Code migration                          | New per-game hashed codes; retire team plaintext codes after transition      |
| Mobile display name                     | TipIn Game Operations                                                        |

## 22. Acceptance Criteria

### Authentication and Authorization

- An SM code opens StatManager and never Game Manager controls.
- A GM code opens Game Manager and does not implicitly gain SM write scope.
- The server selects the game and team without a client-provided game date.
- Raw codes do not appear in URLs, logs, telemetry, or persistent device storage.
- Expired, revoked, wrong-game, wrong-team, wrong-role, and rate-limited requests fail safely.
- Every write verifies session scope, writer slot, fencing token, assignment version, capture domain, and game status.

### Product Behavior

- The tracking team may be home or away.
- Two SM tablets can write concurrently for the same team using separate writer slots.
- `SM1` can capture zone time and hits while `SM2` captures giveaways, takeaways, and blocked shots.
- A tablet cannot create, edit, or delete records outside its assigned capture domains.
- Both tablets receive the same merged event log and summary.
- Scheduled game identity and roster are read-only.
- StatManager cannot change official game state or official scoring records.
- All seven StatManager event types, including Shot Attempt, can be captured with period and normalized rink location without a game clock.
- A physical attempt is classified once as Shot, Shot Attempt, Blocked Shot, or Goal; the UI does not automatically create duplicate classifications.
- Goal observations do not insert or alter `GameGoals`.
- Only one zone interval is open for a tracking team.
- Zone totals include live-play duration only and exclude whistles, pauses, and incomplete intervals.
- Final games are read-only.

### Reliability

- Repeating a create request cannot create a duplicate event.
- Offline creates synchronize in order after reconnection.
- Conflicting edits are shown rather than silently overwritten.
- A stale writer cannot synchronize after takeover.
- An overlapping capture-domain assignment is rejected atomically.
- Reassignment invalidates stale assignment versions without changing authorship history.
- Offline work for a reassigned domain is held for review instead of silently inserted by the new owner.
- A replacement tablet can load server observations and safely acquire control.
- Zone stopwatch recovery requires operator confirmation and does not alter official game state.

### Data and Reporting

- Coordinates remain stable across screen sizes and orientation.
- Player references are limited to the tracking team's game-day roster.
- Summaries exclude soft-deleted events and invalid intervals.
- Point-event summaries and reports do not display client/server timestamps as game-event time.
- Reports identify the tracking team and included server revision.
- Report generation and sending are audited.

### Regression and Release

- Existing Game Manager login and game operation continue to work.
- TypeScript type checking and API build/tests pass.
- Supported tablet layouts contain no overlap or inaccessible controls.
- Release APK passes login, offline, live-play zone stopwatch, lease takeover, final-lock, and report smoke tests.

## 23. Current-State Gaps

The current repository is not yet production-ready for this specification:

- mobile role parsing currently accepts only GM codes;
- mobile state and navigation are concentrated in `App.tsx`;
- several mobile mutation endpoints are anonymous;
- current code validation trusts a client-submitted game date;
- raw mobile code lookup is used in a URL;
- team DTO expiration fields are mapped to `NULL` by the repository;
- team code fields do not provide per-game hashed code lifecycle;
- there is no scoped mobile session or refresh-token exchange;
- there are no server-enforced two-slot writer leases or capture-domain assignments;
- existing `GameEvents` lacks normalized coordinates, idempotency, revision, and soft-delete fields;
- no zone-interval persistence exists;
- runtime table creation is used in some existing mobile functions;
- no complete StatManager report contract exists.

These are planned prerequisites, not reasons to merge StatManager observations into existing official scoring tables or weaken the security model.

## 24. Definition of Ready

StatManager is ready for implementation only when:

- section 21 is approved;
- stable event codes and field rules are appended to this document;
- schema migrations and rollback plans are reviewed;
- endpoint DTOs and error contracts are reviewed;
- mobile dependency choices are approved;
- security tests are written or enumerated before endpoint implementation;
- a migration plan exists for legacy team-level codes;
- report recipient and retention policies are documented.

## 25. Definition of Done

StatManager is complete when all section 22 acceptance criteria pass in automated or documented device tests, all security gates pass, Game Manager has no regression, operational monitoring is active, and an approved release APK is validated on representative tablets.
