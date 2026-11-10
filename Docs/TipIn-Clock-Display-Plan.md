# TipIn Clock Display - Application Plan

## Status

Requirements selected with the user on October 27, 2026. Implementation has
started. Physical tablet and live-scoreboard acceptance checks remain required
before release.

## Purpose and confirmed scope

A separate, read-only Android tablet application that mirrors the TipIn gateway.
The game clock is the primary focus. Period, home/away goals, shots, and active
penalties appear in a compact bottom information strip when available.

- Landscape-only, full-screen display.
- Whole-second clock display updated on gateway receipt; no tenths or additional
  one-second sampling delay.
- Direct connection to the gateway on the same local Wi-Fi network.
- Application-only implementation using existing ESP32 endpoints and payloads.
  No gateway firmware, parser, protocol, or configuration changes.
- No internet, cloud API, game login, or Game Manager session required.
- Compact configuration modal protected by a device-local password; normal
  clock viewing and automatic reconnection remain unlocked.
- Hide information whose availability cannot be established, with manual
  visibility overrides for the existing gateway's optional fields.
- Freeze the last displayed values when the feed is lost, clearly mark them stale,
  and reconnect automatically.
- Working application name: **TipIn Clock Display**.
- No clock controls, score editing, event entry, roster management, or gateway
  configuration commands.

## Display design

```text
+--------------------------------------------------------------------+
|                                                LIVE [small status] |
|                                                                    |
|                                                                    |
|                            12:34                                   |
|                                                                    |
|                                                                    |
| HOME: 2     SHOTS: 18       PERIOD: 2      SHOTS: 15       AWAY: 1  |
| PEN: #12 01:24                                           #8 00:45  |
+--------------------------------------------------------------------+
```

- Black background, high-contrast light digits, tabular numerals, no animation.
- Target at least 75% of usable screen height for the clock region, with the
  bottom strip using the remainder. Fit digits within both width and height;
  verify at the intended viewing distance before finalizing typography.
- Match the gateway's remaining clock time, not elapsed event time.
- Display `MM:SS` throughout the game, including below one minute (for example,
  `00:45`). Use the gateway's whole-minute/whole-second fields without rounding
  from tenths; ignore fractional seconds.
- Home stays left and away stays right; label scores as goals.
- Show up to two active penalties per side, matching the current full payload.
  Stack penalty entries within the fixed bottom region without shrinking the
  main clock.
- Collapse unavailable sections. A supported score or shot count of zero remains
  visible; zero is not a missing value.
- No active penalties means no penalty entries, not an unsupported penalty feed.
- Use HOME and AWAY labels initially. Editable local team labels can be provided
  in settings; automatic team lookup is outside version 1.
- Keep screen awake while the display is foregrounded. Hide Android system bars
  where supported; normal Android exit/navigation remains available.
- Long-press opens the local password prompt, then the compact configuration
  modal after successful verification, keeping ordinary display use free of
  controls.

## First-run and settings

1. Create and confirm a device-local configuration password on first setup.
2. In the compact modal, enter the gateway IP address (or hostname), port
   (default 80), and masked security token used for WebSocket authentication.
3. Use Test Connection to show connection, authentication, and scoreboard-feed
   status, including actionable errors and age of the last valid update.
4. Configure each optional section as Auto, Show, or Hide; keep these and local
   labels in a secondary section so the main connection form stays small.
5. Save settings and open the display. Cancel discards unsaved edits.

The modal provides Save, Cancel, and Test Connection actions. Testing draft
settings must not persist them or replace the active display connection; close
any temporary test connection when testing finishes or the modal closes. Show
transport, authentication, and source-health states separately, explicitly
showing unknown source health with the existing gateway.

Require the local password each time configuration is opened. Re-lock on modal
close, app backgrounding, or restart. The local password is separate from the
gateway token and protects all app configuration, not normal viewing or
automatic reconnection. Allow changing it inside the unlocked modal after
verifying the current password. Apply rate limiting to failed unlock attempts
and show an explicit error and retry delay.

Store the token using Android-backed secure storage, not plaintext preferences
or logs. Store only a salted, computationally hardened local password verifier
using an established password-hashing implementation; never store the password
itself or log password/token values. Protect the verifier with Android-backed
secure storage and exclude credentials and the verifier from backup/restore.
Persist address, visibility choices, and local labels separately.
Subsequent launches reconnect to the saved gateway. Do not present a cached
clock from a previous app session as live while waiting for the first snapshot.
Use a stable gateway address or a DHCP reservation for initial deployment;
automatic discovery and QR provisioning are deferred.

Forgotten-password recovery is Android's Clear App Data action, which clears
the local password, gateway address, token, and other settings. Ensure the chosen
secure-storage implementation honors this reset. The next launch repeats first
setup; there is no default password, recovery backdoor, or cloud dependency.
This is an app-level configuration lock, not managed-device kiosk protection.

## Existing integration verified in the repository

Source: [gateway firmware](../TipIn%20Gateway/src/main.cpp).

- WebSocket endpoint: `ws://<gateway>:<port>/ws`.
- Current server port: 80.
- Gateway emits `AUTH_REQUIRED`; the client responds with
  `{"auth":"<token>","client":"TipIn Clock Display"}` and waits for the
  authenticated acknowledgement before accepting display snapshots.
- Full state is broadcast approximately every 100 ms with schema `TipIn.full.v1`.
  Keep this existing gateway cadence unchanged for other consumers. The app
  receives and validates snapshots continuously and displays whole-second clock
  changes on receipt without a separate refresh timer.
- Snapshot endpoints also exist at `/api/state/full` and `/api/state/clock`.
  Version 1 of this app uses WebSocket streaming rather than parallel polling.
- Full state includes `clockFormatted`, `clock`, `clockMin`, `clockSec`,
  `clockTenths`, `clockRunning`, `period`, `homeScore`, `awayScore`,
  `homeShots`, `awayShots`, and two player/time penalty slots per side.
- Full state includes an emulator flag. Show DEMO in configuration diagnostics
  when emulator data is in use.
- Existing numeric defaults do not reliably distinguish unavailable information
  from genuine zero values.
- Existing full broadcasts do not include parsed-input freshness. Continuing
  WebSocket traffic alone does not establish that the scoreboard feed is live.

This viewer only consumes state. Its transport must not issue start/stop, set
clock, score, mode, or other control commands. The existing gateway token is not
a viewer-only permission boundary; a separate read-only gateway credential is
future hardening, not a capability assumed by this plan.

## Existing gateway compatibility and limits

Use the existing WebSocket authentication and full-state messages without
requiring new fields or firmware updates. Do not send control/configuration
commands or alter the gateway's broadcast cadence.

The existing payload does not prove which optional values the attached
scoreboard supports. Auto displays valid supplied fields, including zeros,
unless explicitly unsupported. Explain this limit in the configuration modal
and allow Show/Hide overrides for period, goals, shots, and penalties.
Show renders valid received numbers,
including zeros, and dashes for missing or malformed values. Never infer support
from nonzero values or manufacture a zero for missing data.

The app can verify gateway transport, authentication, and valid snapshot arrival,
but cannot certify physical scoreboard-source freshness from the full-state
stream. Display source health as unknown in configuration, not as verified live
or lost. The existing emulator flag produces a DEMO indication in configuration.
Keep demo/source/freshness diagnostics off the main clock screen; actual
connection-loss warnings remain on the display.

## Clock authority and connection behavior

- The gateway is the clock authority. Render received values; never run an
  independent countdown or extrapolate through a disconnection.
- Render whole-second gateway values immediately on receipt without an extra
  sampling timer or local countdown. Connection, stale-data, and authentication
  indicators also update promptly.
- A stopped clock with healthy incoming snapshots remains LIVE.
- Detect transport staleness using time since the last valid state snapshot,
  not time since the clock digits changed. Initial threshold: 1 second.
- Report physical scoreboard-source freshness as unknown. Do not infer source
  loss from an unchanged clock or claim the existing stream proves source health.
- On loss, freeze clock and bottom-strip values together and display a clear
  textual status: CONNECTION LOST. Include age since the last valid gateway
  update. Do not rely on color alone.
- Reconnect with bounded exponential backoff and jitter, from about 1 second to
  a 15-second maximum. Reconnect immediately when returning to the foreground
  or when network connectivity is restored.
- Invalid credentials display an explicit settings error rather than retrying
  indefinitely. Malformed snapshots cannot replace the last valid values or
  refresh the valid-data timer.
- A new valid gateway snapshot replaces the frozen values atomically
  and clears the stale indication.
- Reconnect and revalidate after gateway reboot, tablet sleep, app resume, or
  Wi-Fi changes.

## Recommended implementation

Use a separate React Native Android project, consistent with the existing
[mobile application stack](../mobile/game-manager-mobile/package.json), while
keeping its application ID, installation, settings, and release artifact separate
from Game Manager. Confirm supported Android versions against the actual target
tablet and selected framework version before scaffolding.

Keep the implementation small: display screen, compact configuration modal with
local password setup/unlock, typed gateway state decoder, read-only connection
lifecycle, and persisted settings.
Avoid importing Game Manager session, API, or event-management logic.

The Android build must explicitly support local network traffic to the configured
gateway. Current gateway transport is unencrypted HTTP/WebSocket; document use
on a trusted local network and do not claim TLS protection.

## Delivery sequence

1. Implement and test a typed adapter for the existing gateway full-state and
   authentication messages without modifying gateway firmware.
2. Scaffold the separate app and implement the password-protected configuration
   modal, secure credential persistence, connection/status testing, gateway
   authentication, typed snapshots, and reconnect behavior.
3. Implement the large clock, conditional bottom strip, visibility overrides,
   full-screen/keep-awake behavior, and live/stale/demo indicators.
4. Validate with controlled fixtures/emulator data and then the physical gateway
   and intended tablet. Produce an installable signed Android APK with repeatable
   build and installation instructions.

## Acceptance criteria

- Landscape layout has no clipping with the largest expected clock values,
  all optional sections, and four active penalties on the target tablet.
- Clock digits update with each whole-second gateway change, visible within
  one render interval of app receipt under
  normal load; measure this separately from source/network latency.
- Clock start, stop, reset, and period changes match gateway snapshots without a
  local countdown drifting or counting after a disconnect. The clock stays in
  `MM:SS` below one minute and never displays tenths.
- Genuine received zeros stay visible; explicitly unsupported or malformed
  sections hide in Auto. Missing values never appear as fabricated zeros.
- Each visibility override persists across restart.
- First setup requires creating and confirming a local password. Configuration
  cannot be read or changed without unlocking; normal viewing and saved-gateway
  reconnection do not prompt for a password.
- The compact modal includes gateway IP address, masked token, and distinct
  connection/authentication/feed status. Test Connection does not save draft
  values or interrupt the active display, and temporary sockets are cleaned up.
- Failed unlocks show errors and enforce retry delays. Closing configuration,
  backgrounding, or restarting re-locks it; password changes require the current
  password. Cancel does not persist edits.
- Clear App Data removes the password verifier, gateway token, and all settings,
  and returns to first setup. Backups cannot restore the cleared credentials.
- A lost valid-snapshot stream is visibly stale within 1 second plus one render
  interval; frozen values do not continue changing.
- Physical scoreboard-source health is explicitly unknown while gateway
  snapshot health is tracked; unchanged clock digits do not cause false alarms.
- Wrong token, malformed data, gateway reboot, unavailable Wi-Fi,
  app resume, and reconnection are covered by explicit tests.
- No scoreboard control command is sent during any app workflow.
- No gateway firmware or protocol changes are required or delivered.
- Core viewing works without internet. Credentials do not appear in logs.
- A minimum two-hour physical-device soak test shows no screen sleep,
  accumulating socket connections, or crashes.

## Deferred

Remote/cloud viewing, portrait layout, multi-gateway switching, managed-device
kiosk lock, automatic boot launch, automatic discovery, cloud team lookup,
additional penalty slots, and scoreboard control.

## Remaining deployment inputs

Exact tablet model/Android version, intended viewing distance, gateway firmware
and scoreboard vendor, application ID/signing owner, and APK distribution method.
These do not block planning but must be resolved before device acceptance/release.
