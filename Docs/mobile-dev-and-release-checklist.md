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

## 2) External Verification (APK)

Use this for coaches/testers who should run without Metro, USB, or a connected laptop.

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

## 6) Suggested Daily Flow

1. Develop/test in dev client.
2. Push API/admin changes as needed (no APK rebuild).
3. When mobile changes are ready, build fresh preview APK.
4. Install APK on verification tablet(s) and run end-to-end checks.
