# TipIn Mobile: Dev + Release APK Checklist

This project can support both workflows at the same time:

1. Fast local development with Expo dev client.
2. Stable APK installs for external verification.

## 1) Local Development (Fast Iteration)

Use this for coding, testing UI/logic, and quick fixes.

### Start dev server

From repo root:

```powershell
cd .\mobile\game-manager-mobile
npx expo start --dev-client --host tunnel
```

Notes:

1. `--host tunnel` is best when USB is disconnected or LAN is flaky.
2. If you are on the same Wi-Fi and want faster local transport, use `--host lan`.

### Install/update the dev client on Android tablet (when needed)

```powershell
cd .\mobile\game-manager-mobile
npx expo run:android
```

You only need to reinstall the dev client when native dependencies/config change, or when the app is not present.

### Type check before testing

```powershell
cd .\mobile\game-manager-mobile
npx tsc --noEmit
```

### Coach-signed lineup verification

The Verify Rosters screen loads saved game lineups using the entered Game Manager
code directly, including immediately after login before React session state updates.
Initial load and pull-to-refresh both apply saved participants, starters, signatures,
and locked status. Roster active defaults are used only when no saved lineup exists.
Signed lineups cannot be edited on the tablet; an administrator must unlock them.
Read failures are displayed and block verification/editing until a successful refresh,
never treated as unsigned lineups.

Run the mobile regression tests with `node --test tests/*.test.cjs`.

### Editing game events

Goal and penalty edits save the complete event to the API before updating the
tablet feed or closing the editor. Player, team, assists, infraction, duration,
strength, period, and time corrections keep the original event identity.
Failed saves remain in the editor with an error; they are not reported as saved.
Changing only a penalized player does not restart the active penalty timer.
GameView's existing five-second live refresh displays successfully saved edits.

Deploy the API's `PUT /games/{gameId}/events/{eventRef}` endpoint before installing
this tablet build. The older timing-only endpoint remains available for older
clients, but cannot save their player/detail corrections. Test a penalty player
change and a goal scorer/assist correction while GameView is open, including a
failed save, before releasing the updated APK.

### Official game phases

After officials verification, **Open Game Dashboard** enters **Pregame / Warmups**
without marking the game In Progress. The scoreboard clock remains visible, but
warmup countdowns cannot start official play or show a period-end prompt.

The scorekeeper selects and confirms **Start Official Game** on the dashboard
to mark the game In Progress and activate period 1. After confirming a period
end, **Begin Period 2**, **Begin Period 3**, or **Begin Overtime** explicitly
activates the next period. These actions never start or reset the physical
scoreboard clock. Gateway period numbers never advance the official period.
Only an active official period can expire, after a positive clock sample.
Scoring entry and public live-clock updates are paused outside official play.

Both full and lightweight resume snapshots preserve the official phase.
Older snapshots without a phase require **Begin Current Period** when they
have a recorded official start, rather than guessing from the clock display.
Test warmup expiry, intermission expiry, period starts, and restart/reconnection
on the dev tablet before releasing a production APK.

### Goalie recovery and shot attribution

Full and lightweight game snapshots retain each team's current goalie and pulled
status. Full snapshots from older builds recover the goalie from the starting
lineup and recorded substitutions. Shot history changes also trigger persistence.
For older shot entries labeled Unknown Goalie, the summary assigns them to the
named starter only when that team has no recorded goalie events. Empty-net shots
and games with substitutions/pulls are never reassigned this way.

Verify a restart with both starters playing the full game, a backup goalie in
net, and a pulled goalie. Shot totals and goalie identities must remain unchanged
after recovery; full-game starters must not appear beside duplicate Unknown
Goalie rows.

## 2) External Verification (APK)

Use this for coaches/testers who should run without Metro, USB, or a connected laptop.

### Release versions and build numbers

`mobile/game-manager-mobile/app.json` is the version source for both local and
EAS builds: `expo.version` is the user-facing major.minor.patch version and
`expo.android.versionCode` is the increasing Android build number. EAS uses
`cli.appVersionSource=local`; do not enable a separate remote version counter.
The first numbered release is **1.0.1 (build 2)**.

The login screen and Game Manager Settings display `DEV · v1.0.1 (build 2)` or
`PROD · v1.0.1 (build 2)`. Installed APKs read the version and build from the
native binary, not a possibly newer JavaScript manifest. Expo Go/web previews
use the app configuration. DEV/PROD identifies the app package, not an in-app
API-host override.

Before each subsequent new APK, prepare its version from the mobile directory:

```powershell
npm run release:prepare -- 1.0.2
```

Bug fixes increment the patch number (`1.0.2`); features increment the minor
number (`1.1.0`); breaking releases increment the major number (`2.0.0`).
Omit the version argument to keep the current version and only increment the
build number. The command rejects invalid or decreasing versions and always
increments the build number. Commit the updated `app.json` with the release's
code before building. Do not prepare again when simply reproducing that release.
The initial 1.0.1/build 2 metadata is already prepared.

For **local Android builds**, synchronize the generated native project before
running Gradle so an existing ignored Android folder cannot retain an old version:

```powershell
$env:APP_ENV = "dev"
$env:EXPO_PUBLIC_API_BASE = "https://api-dev.tipinscoring.com/api"
npm run android:sync
.\android\gradlew.bat :app:assembleRelease --console=plain
```

Use `APP_ENV=production` and the production API URL for a production build.
Local release builds must still be signed with the existing environment's
release key before distribution; do not distribute the default debug-signed APK.
EAS generates its native project from the same committed app configuration.

Name each signed/distributed APK using the prepared metadata:

```powershell
npm run release:filename -- dev
# TipIn-GM-Dev-v1.0.1-build2.apk
```

Use `prod` for `TipIn-GM-Prod-v1.0.1-build2.apk`. Verify the APK's actual
`versionName`, `versionCode`, and package match before attaching or installing it;
renaming an older APK does not update its internal version.

Create a GitHub Release from the exact built commit using a tag such as
`gm-dev-v1.0.1-build2` or `gm-prod-v1.0.1-build2`. Attach the matching signed APK
and record the environment, version/build, full source commit, release date,
changes, and validation performed. Repository access is required for downloading
private-repository release assets; do not assume those links are public.

### Recommended path: EAS preview APK

Run once:

```powershell
cd .\mobile\game-manager-mobile
npx eas login
npx eas build:configure
```

Build APK:

```powershell
cd .\mobile\game-manager-mobile
npx eas build --platform android --profile preview
```

Outcome:

1. EAS returns a downloadable APK link.
2. Install that APK on external devices for verification.

## 3) When You Must Rebuild APK

Rebuild APK when:

1. Mobile code changes (App.tsx, components, styles, logic).
2. Native config/dependency changes.

No APK rebuild needed when:

1. Azure API-only changes.
2. Admin portal-only changes.

## 4) API Targeting Rules

For external verification builds:

1. Keep the app pointed at the Azure API endpoint.
2. In-app LAN API toggle should be Off unless intentionally testing local API.

## 5) Release Sanity Checklist

Before sharing APK:

1. `npx tsc --noEmit` passes.
2. Login works with access code.
3. Next game selection is correct for current date.
4. Cancelled/postponed games are not selected.
5. If nothing valid is scheduled, app shows `No Scheduled Games Found`.

### Login before the game window

Game Manager login opens four hours before the scheduled Central game time.
Before that, the API returns HTTP 425 (`login_too_early`) with the title
`Login Not Open Yet` and the approved message: the access code is valid, followed
by team, level, type, opponent, game time, login-opening time, and a request to
try again when login opens. Both times include the date and CST/CDT designation.
The tablet also recognizes older HTTP 200 responses carrying `login_too_early`
instead of misreporting a home-team authorization error.

Verify a scheduled game before and inside the four-hour window, an active game,
and a finalized game. Confirm that a 1:00 PM Central game opens at 9:00 AM Central.
Deploy the API correction for the detailed message; a rebuilt APK is required
for the new panel title and legacy-response handling.

On the login screen, show the notice only once: the main alert takes precedence
over the lower next-game status message. Do not display restore-status diagnostics.

## 6) Suggested Daily Flow

1. Develop/test in dev client.
2. Push API/admin changes as needed (no APK rebuild).
3. When mobile changes are ready, build fresh preview APK.
4. Install APK on verification tablet(s) and run end-to-end checks.
