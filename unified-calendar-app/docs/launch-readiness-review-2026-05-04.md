# App Store & Play Store Launch Readiness Review

**Date:** 2026-05-04  
**Reviewer:** Claude Code (claude-sonnet-4-6)  
**Scope:** iOS App Store and Google Play Store submission readiness  
**Verdict:** NOT LAUNCH-READY

---

## Executive Summary

The codebase has a well-architected domain layer with strong test coverage (116 test files, 13 property-based), solid security design (PKCE OAuth, AES-256-GCM at rest, injectable credentials storage), and a clear separation of concerns across domain modules. However, the app entry point (`App.tsx`) is a demo shell that is entirely disconnected from the production service layer, and multiple App Store mandatory requirements are unmet. No EAS build can be submitted to either store in the current state.

The gaps fall into three categories:
1. **App shell wiring** — `App.tsx` must be replaced with a real auth + bootstrap flow
2. **`app.json` configuration** — bundle IDs, permissions, plugins, and scheme are all absent
3. **Missing native packages** — five critical SDK dependencies are not installed

None of these are architectural problems. The underlying service design is sound and the domain layer is production-quality. The path to a submittable build is well-defined.

---

## Files Reviewed

| File | Purpose |
|---|---|
| `App.tsx` | Root entry point |
| `app.json` | Expo app configuration |
| `package.json` | Dependency manifest |
| `src/bootstrap/appBootstrap.ts` | 15-step service initialization |
| `src/subscription/paymentService.ios.ts` | RevenueCat abstraction (iOS) |
| `src/subscription/paymentService.android.ts` | RevenueCat abstraction (Android) |
| `src/providers/oauthConnector.ts` | PKCE OAuth flow |
| `src/accounts/calendarAccountService.ts` | Account connect/remove service |
| `src/notifications/notificationHandler.ios.ts` | APNs integration |
| `src/notifications/notificationHandler.android.ts` | FCM integration |
| `src/notifications/notificationHandler.web.ts` | Web Push integration |
| `assets/` | App icons and splash images |
| `docs/security-review-2026-05-01.md` | Prior security audit |
| `docs/security-review-2026-05-02.md` | Follow-up security audit |

---

## Critical Blockers

These issues will prevent a successful build or guarantee App Store / Play Store rejection. All must be resolved before any submission attempt.

---

### CRIT-1 — App.tsx Is a Demo Shell

**File:** `App.tsx`

`App.tsx` is explicitly documented as a demonstration entry point and never calls the production bootstrap. Specifically:

- `DEMO_USER_ID = 'user-1'` is hardcoded as a module-level constant and passed to every service call including `OnboardingManager.isComplete()`
- `SAMPLE_ACCOUNTS` is a hardcoded array of three fake calendar accounts with placeholder emails (`user@company.com`, `user@personal.com`, `user@icloud.com`)
- `generateSampleEvents()` creates synthetic `CalendarEvent` objects for the current week — no database read, no sync, no real provider data
- `createInMemoryDb()` implements a stub `DatabaseDriver` that only supports `onboarding_state` table operations — all other SQL is silently swallowed
- The 15-step `appBootstrap.ts` init sequence is never imported or called
- There is no authentication check, no session gate, no login screen, and no account connection flow reachable from the rendered UI

Every feature in the domain layer (sync engine, conflict detector, privacy layer, AI assistant, subscription manager, token health monitor, WebSocket manager) is initialized only inside `appBootstrap.ts`. None of it runs in the current app.

**Required fix:** Replace `App.tsx` with a real root that: (1) initializes the production SQLite driver, (2) calls `appBootstrap`, (3) wraps the app in an auth gate (authenticated session → calendar UI; no session → login screen), and (4) removes all hardcoded demo constants.

---

### CRIT-2 — Missing Bundle Identifier, Android Package, and Scheme

**File:** `app.json`

Current `app.json` contains only: `name`, `slug`, `version`, `icon`, `splash`, `ios.supportsTablet`, `android.adaptiveIcon`, `android.edgeToEdgeEnabled`, `android.predictiveBackGestureEnabled`, `web.favicon`, `web.bundler`. Missing:

| Field | Impact if absent |
|---|---|
| `expo.ios.bundleIdentifier` | `eas build` fails for iOS; App Store Connect has no target to receive the build |
| `expo.android.package` | `eas build` fails for Android; Play Console has no target to receive the build |
| `expo.scheme` | OAuth redirect URIs break; deep links fail; in-app browser callbacks never return |

The bundle identifier cannot be changed after the first iOS App Store submission. It must be set correctly before any build is produced.

**Required fix:**
```json
{
  "expo": {
    "scheme": "unifiedcalendar",
    "ios": {
      "bundleIdentifier": "com.<company>.unifiedcalendar"
    },
    "android": {
      "package": "com.<company>.unifiedcalendar"
    }
  }
}
```

---

### CRIT-3 — Five Critical Native Packages Are Not Installed

**File:** `package.json`

The domain layer uses an injectable dependency pattern that allows domain code to compile without the underlying SDKs. This is architecturally correct, but it means the absence of native packages does not surface as a build error — it surfaces as silent runtime failures. The following packages are referenced in source files but absent from `package.json`:

| Package | Used by | Runtime effect if missing |
|---|---|---|
| `react-native-purchases` | `paymentService.ios.ts`, `paymentService.android.ts` | Subscription tier always returns Free; all purchase calls throw |
| `expo-notifications` | `notificationHandler.ios.ts`, `notificationHandler.android.ts` | Push token registration returns null; no reminders fire |
| `@sentry/react-native` | Referenced in `docs/app-overview.md` architecture, expected in `_layout.tsx` | Crashes and errors go unreported in production |
| `expo-auth-session` | `oauthConnector.ts` requires a PKCE browser session | All OAuth flows (Google, Outlook, iCloud, Exchange, CalDAV) fail at runtime |
| `posthog-react-native` | Analytics layer | No usage events captured; product analytics completely dark |

**Required fix:** Install all five using `npx expo install` (not `pnpm add`) to ensure Expo SDK-compatible versions are pinned:

```bash
npx expo install react-native-purchases react-native-purchases-ui
npx expo install expo-notifications
npx expo install expo-auth-session expo-crypto
npm install --save @sentry/react-native
npx expo install posthog-react-native
```

---

### CRIT-4 — No `eas.json` in the Project

EAS Build and EAS Submit require an `eas.json` at the project root to define build profiles. There is no `eas.json` anywhere outside of `node_modules`. Without it:

- `eas build` fails immediately with "No build profile found"
- There is no way to produce a `.ipa` or `.aab` for store submission
- CI/CD pipelines (GitHub Actions) that call `eas build` will fail

**Required fix:** Create `eas.json` at `unified-calendar-app/eas.json`:

```json
{
  "cli": { "version": ">= 5.0.0" },
  "build": {
    "development": { "developmentClient": true, "distribution": "internal" },
    "preview": { "distribution": "internal", "android": { "buildType": "apk" } },
    "production": { "autoIncrement": true }
  },
  "submit": {
    "production": {
      "ios": { "appleId": "<apple-id>", "ascAppId": "<app-store-connect-id>" },
      "android": { "serviceAccountKeyPath": "./google-service-account.json" }
    }
  }
}
```

---

### CRIT-5 — Sign in with Apple Is Missing

**App Store Review Guideline 4.8:** If an iOS app offers any third-party sign-in option (Google, Microsoft, Facebook, etc.), Sign in with Apple is **mandatory**. The app connects Google Calendar (Google OAuth), Outlook (Microsoft OAuth), and iCloud — all three are third-party sign-in mechanisms in Apple's interpretation.

There is no `expo-apple-authentication` package, no Sign in with Apple button, and no Apple credential handling anywhere in the codebase. Apple will reject the submission at review.

This is a non-negotiable requirement regardless of whether users "must" use Sign in with Apple to access the app — if Google OAuth exists, Apple sign-in must also exist.

**Required fix:**
```bash
npx expo install expo-apple-authentication
```

Add Sign in with Apple as an authentication option in the login screen. The `expo.ios` config plugin must also be added to `app.json`.

---

## High Severity Issues

These issues will cause broken user-facing behaviour, silent data loss, or secondary App Store rejection in review.

---

### HIGH-1 — All `NSUsageDescription` Keys Are Missing

**File:** `app.json`

iOS requires a human-readable usage description for every privacy-sensitive API permission the app requests. If the description key is absent, iOS terminates the app at the first permission dialog. Apple's static analysis also flags missing description keys at binary review.

The app accesses calendar data and sends push notifications, requiring at minimum:

```json
{
  "expo": {
    "ios": {
      "infoPlist": {
        "NSCalendarsUsageDescription": "Unified Calendar needs access to your calendar to display and sync your events.",
        "NSRemindersUsageDescription": "Unified Calendar uses reminders to alert you before events.",
        "NSUserNotificationsUsageDescription": "Unified Calendar sends notifications for upcoming events and sync status."
      }
    }
  }
}
```

If the app accesses contacts for attendee lookup, add `NSContactsUsageDescription` as well.

---

### HIGH-2 — No Expo Plugins Declared in `app.json`

**File:** `app.json`

`app.json` has no `plugins` array. This means prebuild (the step that generates `ios/` and `android/` from `app.json`) produces a bare native project with none of the required capability injections:

| Plugin | What it injects | Effect if missing |
|---|---|---|
| `expo-notifications` | APNs entitlement (`aps-environment`), notification category config | Push tokens are null; APNs entitlement absent → TestFlight rejection |
| `@sentry/react-native` | Sentry DSN in native build config | Crash reporting never initializes |
| `expo-apple-authentication` | Sign in with Apple entitlement | Apple auth calls fail at runtime |
| `react-native-purchases` | StoreKit entitlement (iOS), billing permission (Android) | All purchase flows throw "not entitled" |

**Required fix:** Add a `plugins` array to `app.json` after installing the above packages. Each package's documentation specifies its required plugin entry.

---

### HIGH-3 — AppState Lifecycle Listener Is a Non-Functional Placeholder

**File:** `src/bootstrap/appBootstrap.ts`

`createAppLifecycleManager` is called during bootstrap to wire foreground/background transitions. The implementation registers an `AppState.addEventListener` call but its return is `() => {}` — a no-op teardown that indicates the listener was never actually attached to `AppState`. As a result:

- Token refresh does not resume when the app returns to the foreground
- The sync engine does not pause on background or resume on foreground
- WebSocket connections are not torn down on background, draining battery
- `TokenHealthMonitor` background checks continue running with no lifecycle awareness

This will not cause an App Store rejection but will cause user-visible bugs on any device: stale events, expired tokens not refreshed, background battery drain.

---

### HIGH-4 — `subscriptionHttpClient` Is an Unconfigured Placeholder

**File:** `src/bootstrap/appBootstrap.ts`

The bootstrap calls `createProductionSubscriptionHttpClient()` to build the HTTP client used by `SubscriptionManager`. This factory is documented as fail-loud — it throws if the required configuration (endpoint, API key) has not been provided before bootstrap runs. In the current `App.tsx` there is no configuration step. On every real device launch, `SubscriptionManager` initialization will throw and the app will crash or fall back to Free tier silently depending on how the bootstrap error is handled.

---

### HIGH-5 — Onboarding State Keyed on `DEMO_USER_ID`

**File:** `App.tsx`

`OnboardingManager.isComplete(DEMO_USER_ID)` is called with `'user-1'` as the key. All real users who install the app will look up and write onboarding state under `'user-1'`. The first user to complete onboarding pollutes the key for every subsequent user on the same device (e.g., after app reinstall with restored backup, or shared family devices). When the real auth user ID is wired in, all users who previously saw onboarding will see it again on their next launch.

---

### HIGH-6 — No App-Level `PrivacyInfo.xcprivacy`

Apple requires apps targeting iOS 17+ to include a privacy manifest (`PrivacyInfo.xcprivacy`) declaring every privacy-sensitive API used by the app's *own* code (not just dependencies). Third-party `node_modules` each ship their own manifests, but the app-level manifest for code in `src/` is absent.

The app uses local storage (SQLite), calendar access, push notifications, and user-linked analytics (PostHog). These must be declared. Without the manifest, Apple's privacy review will flag the submission.

---

## Medium Severity Issues

Required for a quality production release but will not block initial store submission.

---

### MED-1 — App Icon and Splash Assets Are Expo Placeholders

**Directory:** `assets/`

The four asset files (`icon.png`, `adaptive-icon.png`, `splash-icon.png`, `favicon.png`) are the unmodified default images from `create-expo-app`. App Store Connect requires the 1024×1024px icon to be app-specific artwork with no alpha channel and no rounded corners (the App Store applies its own mask). Submitting placeholder icons will cause metadata validation failure or visible broken store listings before launch day.

---

### MED-2 — No Google `google-services.json` / `GoogleService-Info.plist`

FCM (Firebase Cloud Messaging) is required for Android push notifications. It also provides the SHA-1 fingerprint needed for Google OAuth on Android. Neither `google-services.json` (Android) nor `GoogleService-Info.plist` (iOS Google Sign-In) is present or referenced in `app.json`. Without these, Android push tokens will fail to register and Google OAuth will not work on Android.

---

### MED-3 — No Android Data Safety Form Coverage in Code

Google Play requires a completed Data Safety section declaring what user data the app collects, shares, and how it is handled. The app collects: calendar event content, email addresses, OAuth tokens, sync timestamps, and device push tokens. There is currently no documentation, privacy policy URL, or Data Safety mapping prepared. The Play Console submission cannot be finalized without this.

---

### MED-4 — No Production Privacy Policy or Support URL

Both App Store Connect and Google Play Console require a valid Privacy Policy URL and a Support URL before the store listing can go live. These are not blocked by the codebase but must exist before submission day.

---

## What Is Production-Ready

The following areas are well-implemented and require no launch-blocking work:

| Area | Assessment |
|---|---|
| Domain architecture | Clean separation, well-bounded modules, single entry points per domain |
| PKCE OAuth implementation | Bias-free rejection-sampling code verifier, SHA-256 challenge — correct |
| Token storage security | iOS Keychain / Android Keystore / Crypto-backed IndexedDB — never AsyncStorage |
| SQLite encryption | AES-256-GCM at rest; never cleartext |
| Sync engine state machine | Idle / SyncingOutbound / SyncingInbound / FullSync — properly modelled |
| Conflict detection | Symmetry-tested, RFC 5545 compliant |
| Privacy layer | `filterForAudience` tested for non-leakage of `private`/`busy-only` fields |
| Subscription gating | Single authority (`SubscriptionManager.hasFeature()`), never inline |
| Test coverage | 116 Jest tests, 13 property-based tests with 100-iteration minimum |
| Injectable dependencies | All platform SDKs injected, not imported — domain tests run without native modules |
| i18n | 11 locales with fallback |
| Recurrence | RFC 5545 RRULE expansion with exception handling |

---

## Remediation Checklist

Work items in dependency order. Items marked with `[BLOCKS BUILD]` must be done before any EAS build command will succeed.

```
[ ] CRIT-1  Replace App.tsx with real auth + bootstrap entry point
[ ] CRIT-2  Add bundleIdentifier, android.package, scheme to app.json     [BLOCKS BUILD]
[ ] CRIT-4  Create eas.json with development/preview/production profiles   [BLOCKS BUILD]
[ ] CRIT-3  Install 5 missing native packages via npx expo install
[ ] CRIT-5  Install expo-apple-authentication; implement Sign in with Apple
[ ] HIGH-1  Add NSUsageDescription keys to app.json → expo.ios.infoPlist
[ ] HIGH-2  Add plugins array to app.json for notifications, Sentry, Apple auth, RevenueCat
[ ] HIGH-3  Wire real AppState listener in createAppLifecycleManager
[ ] HIGH-4  Provide subscriptionHttpClient configuration before bootstrap
[ ] HIGH-5  Replace DEMO_USER_ID with real authenticated user ID from session
[ ] HIGH-6  Create app-level PrivacyInfo.xcprivacy declaring used APIs
[ ] MED-1   Replace placeholder assets with production app icon and splash
[ ] MED-2   Add google-services.json and GoogleService-Info.plist; reference in app.json
[ ] MED-3   Complete Google Play Data Safety form mapping
[ ] MED-4   Publish Privacy Policy and Support URLs; add to both store listings
```

---

## Appendix — Evidence References

| Finding | Evidence location |
|---|---|
| App.tsx demo shell | `App.tsx` lines 1–15 (comment header), `DEMO_USER_ID` constant, `SAMPLE_ACCOUNTS` array, `createInMemoryDb` function |
| Missing bundle ID | `app.json` — no `bundleIdentifier` key under `expo.ios` |
| Missing android package | `app.json` — no `package` key under `expo.android` |
| Missing native packages | `package.json` `dependencies` and `devDependencies` — confirmed absent |
| No eas.json | `find . -name "eas.json" -not -path "*/node_modules/*"` returns empty |
| No Sign in with Apple | `grep -r "appleAuth\|expo-apple\|signInWithApple" src/` returns empty |
| AppState placeholder | `src/bootstrap/appBootstrap.ts` — `createAppLifecycleManager` returns `() => {}` |
| NSUsageDescription keys | `app.json` `expo.ios` — no `infoPlist` key |
| No plugins array | `app.json` — no `plugins` key at `expo` level |
| Placeholder assets | `assets/` — 4 files matching `create-expo-app` defaults |
| No PrivacyInfo.xcprivacy | `find . -name "PrivacyInfo.xcprivacy" -not -path "*/node_modules/*"` returns empty |
| 116 test files | `find src -name "*.test.ts" -o -name "*.test.tsx" \| wc -l` → 116 |
| 13 property-based tests | `find src -name "*.property.test.ts" \| wc -l` → 13 |
