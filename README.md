# TipIn

Initial project setup.

## Gateway connectivity and recent devices

The firmware project is [TipIn Gateway](./TipIn%20Gateway). Its admin page
includes **Remote Device History**, refreshed every five seconds:

- IP address, reported viewer name, transport, status, and minutes since last seen.
- Up to 20 IP addresses in RAM, cleared on restart; not a LAN scan or unique
  hardware inventory. HTTP requests and WebSocket sessions from the same IP
  share one history record, including repeated admin reconnects. Live
  WebSocket sessions remain independently tracked for authentication, ping/pong,
  backpressure and timeouts. IPs with open sessions cannot be evicted.
- Each row shows the active WebSocket count (including pending sessions) and
  deduplicated open client names; when none are open, the last viewer name is
  retained. Admin/API access is also listed if observed. HTTP requests do not
  increase the active connection count. Connected duration is the oldest
  currently open WebSocket session at that IP.
- WebSocket last-seen time is a server-observed matching pong after token
  authentication, never an outbound broadcast. Pending viewers have no
  last-seen time until their first matching pong, unless authenticated HTTP
  activity has also been observed at that IP. The row uses the latest proven
  activity and its basis across both transports.
- HTTP records cover authenticated admin/API requests. Public state endpoints
  remain public and are recorded only when valid admin credentials are supplied.
  HTTP `recent` means a request within 60 seconds, not a persistent connection.
- Aggregate status prioritizes a confirmed WebSocket, recent HTTP, then pending
  WebSocket; otherwise it is disconnected (past WebSocket) or inactive (HTTP only).
  One healthy session or recent request does not prove every viewer at an IP is
  healthy. The history is bounded by distinct IPs, not browser tab/reconnect count.
- Failed refreshes retain visibly stale rows with an error message.

`GET /api/clients` requires the existing admin Basic authentication and returns
`uptimeMs`, `capacity`, `retention: "ram_until_restart"`, and `clients`. Each record
contains `ip`, `transport`, `client`, `status`, `lastSeenAgeMs` (nullable),
`connectedAgeMs` (nullable), `authenticated`, `lastSeenBasis`, `activeConnections`
(open WebSockets), and `clientNames` (deduplicated names). `transport` can be
`http`, `websocket`, or `http + websocket`; `client` retains the first displayed
name for compatibility. Authentication indicates authenticated activity has been
observed at the IP, not that every open session is authenticated.

### Recovery and diagnostics

- When station Wi-Fi is disconnected, request reconnects every 10 seconds,
  reinitialize the radio every 60 seconds of continued outage, and enable the
  setup AP after 120 seconds. Initial boot retains its 30-second AP fallback.
  Recovery preserves scoreboard state and never automatically reboots the ESP32.
  Explicit admin reboot/factory-reset and successful Wi-Fi configuration changes
  retain their existing restart behavior.
- Wi-Fi configuration tests run from the main loop, not an async HTTP callback.
  DHCP is explicitly restored when switching away from static addressing.
- Shared scoreboard/penalty state is synchronized across serial/emulator updates
  and HTTP/WebSocket commands. Broadcasts run only from the main loop.
- Pinned ESP32Async networking libraries synchronize WebSocket client lifecycle
  and queues. At most eight WebSocket sessions are admitted, each with a four-frame
  pending-data queue. Full queues skip snapshots instead of delaying other viewers;
  sustained congestion is closed after 10 seconds. Authentication times out after
  10 seconds; explicit ping/pong checks run every 10 seconds with a 30-second
  response deadline.
- Existing state/serial JSON retains its schemas and adds Wi-Fi disconnect reason,
  disconnect age/count, radio reinitialization count, setup-AP status, event-drop
  count, skipped frames, and WebSocket timeout count. The bounded RAM log records
  Wi-Fi events/reconnect outcomes and a heap/status summary every 60 seconds.

These changes cannot by themselves identify a station that still reports
`WL_CONNECTED` but is unreachable on the LAN. They do not use internet availability
or an idle viewer list as evidence of failure. The original outage's root cause
remains unconfirmed; validate recovery and perform an extended hardware soak after
an explicitly approved deployment.

### Build without deployment

The admin **System Status** tile displays the firmware version and UTC build
timestamp, without a Git revision line. The startup console log also includes
the Git revision for diagnostics. State APIs (including clock-only
and serial compatibility responses) and full WebSocket snapshots expose
`firmwareVersion`, `firmwareBuildTimestamp` (ISO 8601 UTC),
`firmwareGitRevision` (12-character commit ID), and `firmwareGitDirty` (boolean).
Existing payload schemas and scoreboard fields are unchanged.

The application version is maintained in
[firmware_info.h](./TipIn%20Gateway/include/firmware_info.h), starting at `1.1.0`.
PlatformIO generates the timestamp and Git metadata at build time; Git must be
available and the build must run inside a Git checkout. Builds fail explicitly
if Git metadata cannot be read. Uncommitted changes in the gateway project are
marked in the startup log and API: the revision identifies the base commit, not an exact
reproducible source revision for a dirty build. The displayed timestamp belongs
to the compiled firmware, not the tablet/browser clock or filesystem upload.

```powershell
platformio run --project-dir 'C:\TipIn\TipIn Gateway'
platformio run --project-dir 'C:\TipIn\TipIn Gateway' --target buildfs
```

These commands produce firmware and LittleFS images without flashing or rebooting
the gateway. Both firmware and the admin filesystem need a separately approved
deployment for the new panel to work. Host-test and hardware-validation instructions
are in [the gateway test README](./TipIn%20Gateway/test/README).
