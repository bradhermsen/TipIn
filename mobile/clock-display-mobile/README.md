# TipIn Clock Display

Standalone, read-only, landscape Android tablet viewer. Application ID:
**`com.tipin.clockdisplay`**. Installs independently of Game Manager; no shared
session, storage, cloud account, backend or internet connection is needed to view.

## Setup and operation

1. Connect the tablet and gateway to the same trusted Wi-Fi network. Reserve the
   gateway address in DHCP or use a stable hostname.
2. Launch the app and create/confirm a local configuration password (8–128
   characters). Enter the gateway IPv4 address or hostname, port (normally 80),
   and gateway security token. IPv6 literals and URLs are not accepted.
3. **Test connection** opens a separate temporary socket for up to 10 seconds.
   Transport, authentication, feed health, snapshot age and source age are
   reported separately. It never saves draft values or interrupts the display.
4. Save to connect the display. Long-press anywhere on the display for 700ms to
   unlock configuration. Every opening requires the local password.
5. Display options provide local team labels and Auto / Show / Hide for period,
   goals, shots and penalties (up to two active entries on each side). Auto only
   shows valid supplied fields unless explicitly unsupported. Show displays dashes for unavailable values;
   genuine numeric zeros remain zeros. Empty active-penalty lists stay empty.

**Existing gateway diagnostics:** SOURCE UNKNOWN is expected, even with a healthy
connection. Current firmware cannot establish physical scoreboard-input freshness
or per-section support. Auto shows valid supplied period, goals, shots, and
penalties, including zero scores/shots. Use Hide for fields your scoreboard does
not supply, since firmware defaults cannot prove support. DEMO, source status,
and freshness details appear only in configuration, not on the clock screen.
This application requires no firmware changes.

Cancel discards connection/display drafts. Password changes require the current
password and take effect immediately (independent of Save/Cancel). Closing,
Android Back, backgrounding and restarting all re-lock configuration. Automatic
viewing and reconnects do not require unlocking. First-run setup can be closed;
long-press to resume it. There is no default password or recovery backdoor.

Forgotten-password recovery: **Android Settings → Apps → TipIn Clock Display →
Storage → Clear data**. This removes settings, token, verifier and retry state.
Uninstall/reinstall also resets this Android-only application.

## Display and connection behavior

- The TipIn transparent logo and "TipIn Scoring" wordmark appear in the upper-left
  corner, matching the gateway admin page's white/orange italic TipIn styling.
- A local date/time clock sits above the game-clock seconds on the right in
  larger text, formatted as `October 27, 2026  2:49 PM`.
  It uses the tablet's local timezone with an English long date and 12-hour time,
  and remains independent of the gateway connection. Ensure the tablet's system
  date, time, and timezone are correct.
- Android launcher/adaptive/monochrome icons and the splash image reuse the
  exact Game Manager assets, copied into this standalone app's assets directory.
  The application name and package remain separate from Game Manager.
- Black, high-contrast, tabular whole-second `MM:SS` clock, including `00:45`
  below one minute. The clock region receives 70% of layout space excluding the
  tiny footer; the optional strip gets 30%. Game-information labels, values, and
  penalties use the same 34-point text size as the local date/time. Long team
  names scale down to fit. Digits scale to both dimensions and
  accommodate `999:59`. No countdown, interpolation, rounding or animations.
- Authenticated valid snapshots update the display immediately on receipt.
  Clock digits remain whole seconds; there is no extra one-second sampling timer
  adding delay after a gateway update. Status updates run every 200ms. Snapshots
  are never persisted between app launches.
- One second without a valid full snapshot marks transport stale. Malformed
  data cannot refresh that timer. Last displayed update age remains available
  through reconnect. Clock and bottom fields freeze together on transport loss.
- Current gateways retain source **UNKNOWN** in configuration diagnostics.
  `DEMO` also appears there when the gateway reports emulator mode. Actual
  connection-loss/authentication warnings remain visible on the clock screen.
- Existing firmware may continue broadcasting old serial values over a healthy
  WebSocket: this app **cannot detect that serial-input loss**. Snapshot age is
  time since a valid gateway payload, not time since a physical scoreboard update.
  Defensive optional metadata handling can freeze explicit source/clock failures
  if a future compatible gateway supplies them; no metadata or upgrade is required.
- Retry uses exponential delay with jitter, roughly 1–15 seconds. Eight seconds
  without valid snapshots tears down an unresponsive socket. Returning to the
  foreground creates a fresh connection; a disconnected→connected network event
  reconnects immediately. Wrong tokens halt retries and request settings.
- The screen stays awake only in the foreground. Android system bars are hidden
  where supported; normal Android exit/gesture navigation remains available.
  This is an application lock, not device-owner kiosk enforcement.

## Wire contract and security

The only outbound application message is:

```json
{"auth":"<gateway token>","client":"TipIn Clock Display"}
```

It is sent after `AUTH_REQUIRED` to `ws://HOST:PORT/ws`. Snapshots are ignored
until `{"status":"authenticated"}`. `invalid_auth` or close code 4001 rejects the
token. Only full states with schema `TipIn.full.v1` and valid numerical
`clockMin` / `clockSec` are accepted. Optional data uses existing score, shots,
period and `homePen1Player` / `homePen1Time` (and equivalent) fields.

Only the existing WebSocket/authentication/full payload is required. Legacy
numerical defaults cannot distinguish a real zero from a never-initialized value.
Manual Show displays received numbers as-is, with dashes for missing/malformed
fields; it cannot manufacture a validity guarantee. Optional metadata decoding
is defensive compatibility code, not a dependency, and makes no source-freshness
claim for existing firmware.

Token, verifier and retry counter are in Expo SecureStore (Android Keystore-backed
encrypted storage). Only the PBKDF2-HMAC-SHA256 verifier is stored: 600,000
iterations, 128-bit random salt, 256-bit result, using native asynchronous
PBKDF2 via `react-native-quick-crypto` on Android and Expo Crypto randomness.
Hashing runs off the JavaScript thread; existing password verifiers remain
compatible and no password reset is required when upgrading. Desktop unit tests
use `@noble/hashes` with the same parameters. Comparison is constant-work across
the derived bytes. Failed-attempt state is persisted **before** hashing, with
1s exponential delays capped at 5 minutes; killing the process cannot remove a
failed attempt. There is no plaintext password storage or credential logging.
Addresses, labels and visibility are separately stored in AsyncStorage.

Android backup is disabled application-wide. SecureStore's generated Android
backup exclusions are enabled as defense in depth. Neither credentials nor the
verifier should migrate through backup/restore. Confirm this and Clear data on
the intended tablet before deployment.

**Transport is unencrypted WebSocket, not TLS.** The token is sent over local
Wi-Fi in plaintext. Use a trusted, isolated LAN. Android cleartext traffic is
explicitly enabled by the local config plugin. The existing gateway token is not
a viewer-only permission boundary; this viewer never issues control commands,
but anyone possessing that token may have broader gateway privileges.

## Reproducible development and Android build

Stack: Expo SDK 54 / React Native 0.81.5 / React 19.1 / TypeScript. Android minimum
SDK is 24 (Android 7.0) per this framework; actual tablet compatibility and viewing
distance must be confirmed. Node 20.19+ (Node 24 works), npm, JDK 17, Android SDK
platform 36 and build tools 36 are needed for local Android builds.

Run in PowerShell:

```powershell
Set-Location C:\TipIn\mobile\clock-display-mobile
npm ci --no-audit --no-fund
npm run typecheck
npm test
npm run prebuild:android
Set-Location android
.\gradlew.bat :app:assembleDebug --console=plain
```

The debug APK is `android\app\build\outputs\apk\debug\app-debug.apk`.
Install on a connected, authorized tablet with:

```powershell
& "$env:ANDROID_HOME\platform-tools\adb.exe" install -r .\app\build\outputs\apk\debug\app-debug.apk
```

Debug builds expect Metro for normal interactive development; `npm start` starts
it explicitly. For a **self-contained local smoke APK with no Metro**, the Expo
generated project can bundle JavaScript into a release-mode APK:

```powershell
Set-Location C:\TipIn\mobile\clock-display-mobile\android
.\gradlew.bat :app:assembleRelease --console=plain --no-daemon
& "$env:ANDROID_HOME\platform-tools\adb.exe" install -r .\app\build\outputs\apk\release\app-release.apk
```

**The generated release variant uses the generated debug signing key until
release signing is configured.** This smoke APK is not a production-signed
deliverable. For a self-contained offline production deployment, create a
signed preview APK using Expo EAS with the organization's signing identity:

```powershell
Set-Location C:\TipIn\mobile\clock-display-mobile
npx eas-cli@21.0.2 login
npm run apk:preview
```

EAS requires internet for build/signing, not runtime. Do not upload secrets in
source or commit signing keys. For fully local release builds, configure release
signing with the distribution owner's keystore in the generated Android project,
outside version control, then run `.\gradlew.bat :app:assembleRelease`. Do not
ship the generated debug signing key as a production identity.

Native `android` output is deliberately ignored and reproducibly generated from
`app.json` and `plugins\withLocalNetwork.js`. Do not manually maintain manifest
changes there. `allowBackup=false` and `usesCleartextTraffic=true` are applied by
the plugin on each prebuild. No persistent server is started by validation.

## Validation and release limitations

Local verification on October 27, 2026:

- Password responsiveness fix: Android uses asynchronous native PBKDF2 instead
  of JavaScript hashing. The 600,000 iterations, salt/hash format, and stored
  passwords are unchanged; upgrading does not require Clear data.
- Native-crypto APK built successfully for `arm64-v8a,x86_64`. In an isolated
  Android emulator, creating a password opened configuration, closing re-locked
  it, and entering the correct password reopened configuration within 3.75s
  including ADB input/UI-dump overhead (not a hashing-only benchmark).
- Updated the connected Samsung tablet using `adb install -r`, without clearing
  its password or settings. Launch succeeded with no app-process
  AndroidRuntime / ReactNativeJS errors. Actual user-password unlock speed on
  the tablet still needs confirmation.
- `npm install --no-audit --no-fund`: passed.
- `npx expo install --check`: passed; dependencies aligned with Expo SDK 54.
- `npm run typecheck`: passed.
- `npm test`: **21 passed, 0 failed**.
- `npm run prebuild:android`: passed. Expo noted optional `expo-system-ui`
  support for system UI color; the display itself explicitly uses dark styling.
- `.\gradlew.bat :app:assembleRelease --console=plain --no-daemon`: passed;
  final incremental build completed in 1m 1s. Bundled APK is at
  `android\app\build\outputs\apk\release\app-release.apk`, signed only with the
  generated development key. No Metro server is needed to launch it.
- Generated Android manifest checked for the separate application identity,
  landscape orientation, cleartext enabled, backup disabled and SecureStore
  backup/data-transfer exclusions.
- Installed the final bundled smoke APK on the authorized Samsung SM-T570
  (Galaxy Tab Active3), Android 13, 1920×1200 landscape / density 320. The
  standalone activity resumed and its first-run local-password screen rendered.
  Targeted app-process AndroidRuntime / ReactNativeJS error logs were empty.
  This is installation/launch verification only: no gateway connection, password
  persistence/reset procedure, source freshness or soak acceptance was tested.
  No unrelated app was installed, inspected or cleared; no app data was cleared.

Automated tests cover full-state decoding, fractional-second exclusion, genuine
zeros, legacy metadata, invalid fields, penalties, immediate whole-second updates, source loss
with clock-invalid metadata, frozen fields, auth gating/rejection, malformed
snapshots, stopped clocks, timeout/reboot/reconnect, cleanup, separate connection
testing, settings validation/serialization, salted password verification and
persistable retry logic. Tests use synthetic fixtures/fake sockets, not hardware.

Before distribution, verify on the actual gateway/tablet:

- All four penalties plus goals/shots/period fit without clipping; clock digits
  are readable at intended distance. Test largest values and long labels.
- Actual receipt-to-render latency and stale indication meet 1s plus one render
  interval; a stopped clock with healthy snapshots is not marked transport-lost.
  Source freshness must remain UNKNOWN on existing firmware, including serial
  disconnects while WebSocket snapshots continue.
- Wrong token, malformed feed, Wi-Fi loss/restore, gateway reboot, tablet
  sleep/resume, cancel/background during password hashing and modal tests.
- Password creation/change/retry persistence, settings isolation, Clear data,
  backup exclusion, system navigation and secure-storage behavior.
- Minimum two-hour foreground soak: no screen sleep, socket accumulation or crash.

No physical-device acceptance, soak, final APK signing or distribution approval
is implied by automated verification. Target tablet, scoreboard vendor cadence,
signing owner and distribution route are deployment inputs still to confirm.
