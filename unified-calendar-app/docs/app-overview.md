# Unified Calendar — How the App Works

This document explains what the Unified Calendar app does, how each feature is
intended to be used, and how the pieces fit together under the hood. It is
aimed at new engineers, product reviewers, and support folks who need to
understand the app end-to-end without reading every file.

For the formal contract, see:

- `.kiro/specs/unified-calendar-app/requirements.md` — numbered EARS
  requirements (the source of truth for behavior).
- `.kiro/specs/unified-calendar-app/design.md` — architecture and
  component interfaces.
- `docs/tech-stack-best-practices.md` (workspace steering) — enforced coding
  rules.

## 1. What the app is

Unified Calendar is a single cross-platform application (iOS, Android, Web
PWA, and via PWA on Mac/Windows/Linux) that aggregates calendars from
multiple providers — Google Calendar, Microsoft Outlook, Apple iCloud,
Exchange, and generic CalDAV — into one unified, **read-write** timeline.

The problems it solves versus existing aggregators:

- Most aggregators are read-only. This app writes back to the source provider.
- Sync is real-time (webhooks where available, ≤ 5 min polling for CalDAV).
- Works fully offline; mutations queue and replay on reconnect.
- Granular per-calendar and per-event privacy for shared/delegated views.
- Freemium pricing (Free / Pro / Team) without the aggressive upsell pattern.

The product ships as a **freemium** app:

| Tier | Price | What you get |
|------|-------|--------------|
| Free | $0 | Up to 3 calendar accounts, unified view, basic event CRUD |
| Pro  | $3–5 / month | Unlimited accounts, AI scheduling, conflict detection, advanced privacy |
| Team | $8–10 / month | Everything in Pro + shared views + delegation (up to 20 members per shared view) |

Tier enforcement lives in `src/subscription/` and is wired into every feature
gate through `SubscriptionManager.hasFeature()`.

## 2. The user journey

### 2.1 First launch and onboarding

On first launch, `App.tsx` asks `OnboardingManager.isComplete(userId)`. If
onboarding has not finished, it renders `OnboardingAnimator` as a full-screen
overlay on top of the calendar view.

The onboarding flow is **at most 4 steps** (Req 11.1) and the user can connect
their first calendar within 60 seconds. Steps:

1. Welcome + language/locale choice (11 locales in `src/i18n/locales/`:
   en, es, fr, de, ja, ko, zh-CN, pt, it, ar, plus fallback).
2. Connect first calendar account via OAuth (Google/Outlook/iCloud/Exchange/
   CalDAV). Uses PKCE on mobile.
3. Choose default view (day/week/month/agenda) and notification preferences.
4. Done — lands on the unified view with the new calendar visible.

Users can skip onboarding and re-run it from Settings at any time. Contextual
tooltips show for the first 7 days.

`OnboardingManager` persists state in the `onboarding_state` SQLite table so
reopening the app never replays the flow.

### 2.2 Connecting calendar accounts

`src/accounts/calendarAccountService.ts` is the single entry point for
account management. It delegates to `src/providers/oauthConnector.ts`
which runs the OAuth 2.0 flow per provider:

- **Google, Outlook**: OAuth 2.0 + PKCE on mobile, refresh-token storage in
  platform secure storage (`secureStorage.ios.ts` / `.android.ts` / `.web.ts`).
- **iCloud, Exchange, CalDAV**: username + app-specific password (no OAuth),
  stored in the same secure storage layer.

Tokens **never** touch `AsyncStorage` or plain SQLite — they live in iOS
Keychain, Android Keystore, or the web Crypto-backed IndexedDB fallback.

`TokenHealthMonitor` (in `src/providers/tokenHealthMonitor.ts`) polls token
expiry locally (via `cachedTokenHealth.ts`) to avoid hammering provider
endpoints; it only calls the provider when the cached absolute expiry is
stale. On detected revocation or imminent expiry, it surfaces a "Reconnect"
badge on the affected calendar card via `errorDisplayService`.

Free-tier users hit a hard limit at **3 accounts**. The 4th connect attempt
triggers an upgrade prompt from `subscription/accountLimitEnforcer.ts`.

Removing an account (`CalendarAccountService.remove`) wipes all locally
cached data for that account within 5 seconds and revokes the remote token.

### 2.3 The unified view

`src/ui/calendar/UnifiedCalendarView.tsx` is the root calendar component.
It switches between four modes via `ViewModeSwitcher`:

- **Day** (`DayView.tsx`) — single day hour grid.
- **Week** (`WeekView.tsx`) — 7-day hour grid, default on desktop/tablet.
- **Month** (`MonthView.tsx`, `StableMonthView.tsx`) — full month cells.
- **Agenda** (`AgendaView.tsx`) — chronological list, default on narrow phones.

Key rendering behaviors:

- Events from different accounts are color-coded via `colorCoding.ts`. Each
  `CalendarAccount.color` drives a consistent hue.
- Overlapping events are laid out side-by-side without truncation using
  `overlapLayout.ts` (Req 2.5). No event is ever hidden under another.
- A full month renders in < 1 second (Req 2.6). `FlatList`-backed month grid
  with `getItemLayout` and Reanimated worklets keep scroll at 60 fps.
- `CurrentTimeIndicator` draws the "now" line that ticks every minute.
- `CalendarSidebar` lists all connected calendars with toggle chips. Flipping
  a toggle updates visible events in < 200 ms via a zustand selector
  (Req 2.4).
- `ConflictIndicatorOverlay` draws a red stripe on any time slot that has
  overlapping events from multiple calendars.
- `EmptyStateView` renders when no calendars are connected yet, with a
  "Connect a calendar" CTA that deep-links into the onboarding connect step.

Responsive behavior is driven by `ResponsiveLayout.tsx` + `useBreakpoint`.
Breakpoints in `breakpoints.ts` cover 320px → 2560px (Req 9.5).

### 2.4 Creating and editing events

`src/ui/editor/EventEditor.tsx` is the unified event editor and works for
both create and edit. It supports:

- Title, description, location, attendees, all-day toggle, time zone.
- **Recurrence** via `RecurrenceSelector` — daily, weekly, monthly, yearly
  patterns compiled to RFC 5545 RRULE by `src/recurrence/`.
- **Per-event privacy override** (public / busy-only / private) that wins
  over the calendar's default visibility.
- **Conflict warnings** inline via `ConflictWarning` when the chosen time
  overlaps another event. The suggester offers free slots (Pro+).

Editing **a single occurrence** of a recurring event shows
`RecurringEventEditPrompt` asking "This event only / All events / This and
following". The "only this" path creates an exception in
`src/recurrence/exceptionHandler.ts` without touching the base rule
(Req 3.5).

There's also a lightweight inline editor: `QuickCreateBar` at the top of the
view accepts natural-language input like "Lunch with Sam tomorrow 1pm for
45m". Parsing lives in `src/nlp/naturalLanguageParser.ts` with pretty-printing
in `naturalLanguagePrinter.ts`. The preview appears in `LivePreviewPanel`
before commit.

All mutations go through `src/events/eventCRUDService.ts`, which:

1. Writes to local SQLite first (optimistic UI).
2. Queues a `LocalChange` to `SyncEngine`.
3. Invalidates the relevant TanStack Query cache keys.

Failed writes don't lose data — they stay in the sync queue and show a
"pending" badge on the event card. See §2.7 for sync details.

### 2.5 Conflict detection

`src/conflicts/conflictDetector.ts` runs in two modes:

- **Reactive**: when the user creates/moves an event, it checks overlaps
  against every visible calendar within 500 ms (Req 7.1). It then offers
  at least one alternative free slot (Req 7.3).
- **Continuous (Pro/Team only)**: after every inbound sync, the detector
  re-scans all events and fires `onConflictDetected` for new conflicts.
  This drives push notifications within 60 seconds of provider changes
  (Req 7.6).

Conflicts account for travel time between different physical locations
(Req 7.4) using `estimateTravelTime` when a location maps to coordinates.

Symmetry is a tested property: `conflictDetector.property.test.ts` asserts
with fast-check that if A conflicts with B, then B conflicts with A.

### 2.6 AI scheduling assistant (Pro/Team only)

`src/ai/aiSchedulingAssistant.ts` suggests up to 3 optimal time slots for a
new meeting. It uses:

- An on-device TensorFlow Lite model (`src/ai/onDeviceModel.ts`, < 1 MB,
  INT8 quantized) that learns the user's preferred meeting windows, focus
  blocks, and buffer times. All training happens on-device; no weights or
  event data ever leave the phone (Req 13.3).
- Server-side free/busy lookup (optional) for attendees on the same tenant.
- User-defined `SchedulingPreferences`: min buffer between meetings, max
  meetings per day, preferred hours.

If no slot fits the preferences, the assistant returns the closest fallback
with `tradeoffs` explaining what was relaxed (Req 8.6).

New users without enough data fall through to heuristic defaults (9-5 local
time, 15-minute buffers) until the model has learned their patterns.

### 2.7 Sync engine (the heart)

`src/sync/syncEngine.ts` is a state machine:

```
Idle → SyncingOutbound (local change queued)
Idle → SyncingInbound   (webhook/poll)
Idle → FullSync         (network restored)
SyncingOutbound → RetryQueue (failed) → SyncingOutbound (timer)
SyncingInbound  → ConflictResolution (divergence)
```

Behavior per provider:

- **Google Calendar**: incremental sync via `syncToken`, push via
  `events.watch` webhooks. Batch API for bulk writes.
- **Microsoft Graph (Outlook/Exchange)**: incremental via `deltaLink`,
  subscriptions for push (renewed at ≤ 4230-minute intervals). `$batch`
  for bulk writes.
- **iCloud / CalDAV**: incremental via `sync-token`, polled at ≤ 5-minute
  intervals — no push available (Req 4.4).

Rate limiting is enforced in `src/sync/rateLimitManager.ts` and
`src/providers/rateLimiter.ts`. On a 429, the engine honors `Retry-After`
and prioritizes user-initiated operations over background sync when
quotas get tight (Req 18.4). A "sync health" indicator
(`syncHealthIndicator.ts`) surfaces throttling to the user.

Conflict resolution: when the same event was edited locally and remotely
during an offline window, both versions are shown to the user via
`src/sync/conflictResolver.ts` — the app never silently picks a winner
(Req 4.5, 6.5).

### 2.8 Offline-first storage

Local SQLite is the **source of truth**, not a cache. `src/db/` wires:

- `op-sqlite` on iOS/Android (`db.ios.ts`, `db.android.ts`).
- `sql.js` on web (`db.web.ts`), persisted to IndexedDB.
- AES-256-GCM encryption at rest via `encryption.ts` — the DB file on disk is
  never cleartext (Req 6.6, 13.2).
- Schema versioning and forward-only migrations in `migration.ts`. On version
  mismatch the DB is backed up, then migrations run. If a migration throws,
  the app falls back to **read-only mode** and shows a support contact
  (Req 17.4).

Retention: at least 6 months past + 12 months future events are always kept
locally (Req 6.4). Older events are purged lazily.

### 2.9 Privacy controls

`src/privacy/privacyLayer.ts` implements three visibility levels per
calendar **and** per event (event overrides win):

| Level | Behavior for shared/delegated viewers |
|-------|---------------------------------------|
| `public` | Full event details |
| `busy-only` | Time block only — no title, description, or attendees |
| `private` | Event is hidden entirely |

`filterForAudience(events, audience)` is called before any event leaves the
device for a shared view. Owner audiences always see everything.

Subscription gating (Req 10.2): if the calendar owner is on the Free tier,
`checkAdvancedPrivacyAccess` returns false and the effective visibility is
forced to `public`. Busy-only and private are Pro+ features. This means a
Free user can still *look* at the visibility setting, but it has no effect
on shared views until they upgrade.

Preferences sync end-to-end encrypted via
`src/privacy/preferenceSyncService.ts`.

### 2.10 Shared calendars and delegation (Team tier)

`src/sharing/sharedViewService.ts` creates shared views visible to up to 20
team/family members. `src/sharing/delegationService.ts` grants read-only or
read-write delegation. Delegates who edit events are recorded in the event's
`modifiedBy` field so the audit trail shows who did what.

Revoking access takes effect within 10 seconds across all active sessions
(Req 14.5).

### 2.11 Notifications

`src/notifications/` routes push through platform handlers:

- iOS → APNs (`notificationHandler.ios.ts`).
- Android → FCM (`notificationHandler.android.ts`).
- Web → Web Push API (`notificationHandler.web.ts`).

`notificationPreferencesStore.ts` exposes per-category toggles so users can
turn off any of:

- New conflict detected.
- Sync conflict requiring resolution.
- Subscription payment issue.
- Re-authentication needed for a calendar account.
- Event reminders.

**Sensitive detail protection** (Req 15.6): push notifications never include
event titles or attendee lists unless the user explicitly opts in. Default
is "You have a new event at 3pm" — not "Performance review with Alex at 3pm".

### 2.12 Subscription and payments

`src/subscription/subscriptionManager.ts` is the single feature-gate
authority. Every tier-gated feature calls `manager.hasFeature(feature)`.

Payment integrations live behind platform-specific files:

- iOS → Apple StoreKit via RevenueCat (`paymentService.ios.ts`).
- Android → Google Play Billing via RevenueCat (`paymentService.android.ts`).
- Web → Stripe Checkout + Stripe Billing (`paymentService.web.ts`).

`webhookHandler.ts` processes:

- `INITIAL_PURCHASE` / `checkout.session.completed` → unlock tier within
  10 seconds (Req 10.2).
- `RENEWAL` / `invoice.paid` → extend entitlement.
- `CANCELLATION` → downgrade at end of current billing period.
- `BILLING_ISSUE` / `invoice.payment_failed` → start 7-day grace period,
  show persistent banner with countdown (Req 10.6, 19.3). Downgrade to Free
  after day 7.

`featureUnlockPoller.ts` polls the backend for entitlement changes so the
app reflects tier changes even if a webhook is delayed.

`accountLimitEnforcer.ts` blocks the 4th account on Free and surfaces the
upgrade sheet.

**No card data ever touches the client** — Stripe Checkout is hosted,
StoreKit/Play Billing handle payment entirely in the OS.

### 2.13 App lifecycle and background sync

`src/lifecycle/appLifecycleManager.ts` coordinates backgrounding:

- On background: finishes any in-flight sync, closes the WebSocket, registers
  background fetch (iOS) / WorkManager (Android) with a 15-minute minimum
  cadence.
- On foreground: reconnects WebSocket, runs a delta sync within 10 seconds
  (Req 16.3).
- On OS termination: pending sync queue entries are persisted to SQLite so
  the next launch picks up where the last session left off.

`webSocketManager.ts` handles `wss://` connections only, with 30-second
heartbeats and exponential-backoff auto-reconnect.

### 2.14 Error UX

`src/errors/errorDisplayService.ts` drives user-facing error presentation
per Req 19:

- Sync errors → non-intrusive banner with "Details" action.
- Auth errors → badge on the affected calendar tile with "Reconnect".
- Payment errors → persistent banner with grace-period countdown.
- Offline → bottom indicator "Changes will sync when online".
- Error log accessible from Settings, last 50 errors with timestamps.

Raw error codes and stack traces are **never** shown to the user — the
service maps every internal error to a localized, human-readable message.

### 2.15 Security posture

- TLS 1.2+ on every network call; HTTPS enforced in `networkSecurity.ts`.
- OAuth tokens and credentials in platform secure storage only.
- PKCE required on all mobile OAuth2 flows.
- AES-256-GCM for the local SQLite database at rest.
- Deep links never carry tokens or event data.
- Rate limiting on authentication endpoints in the backend.
- `userDataService.ts` implements the account-deletion path: all server data
  purged within 30 days, local data immediately (Req 13.4). Users can view
  recent sign-ins from Settings.

Security reviews live in `docs/security-review-2026-05-01.md` and
`docs/security-review-2026-05-02.md`; npm audit output in
`docs/npm-audit-2026-05-02.json`.

## 3. How the pieces connect

`src/bootstrap/appBootstrap.ts` is the integration wiring module that
constructs and connects every service at startup. The dependency direction
is:

```
UI components
    ↓ selectors
Zustand stores (events, accounts, sync status, UI prefs, subscription)
    ↓ hooks
TanStack Query (provider fetches, mutations, cache invalidation)
    ↓ actions
Event CRUD service
    ↓ local writes + enqueue
SQLite (source of truth, AES-256 at rest)
    ↓ LocalChange
SyncEngine (state machine)
    ↓ per provider
Provider adapters (Google / Outlook / iCloud / Exchange / CalDAV)
    ↓
Provider APIs
```

Cross-cutting services plugged in by the bootstrap:

- `SubscriptionManager` — every tier-gated call consults this.
- `PrivacyLayer` — wraps event reads for shared/delegated audiences.
- `ConflictDetector` — subscribes to sync events.
- `AISchedulingAssistant` — called from the event editor.
- `OnboardingManager` — gates first-run UI.
- `TokenHealthMonitor` — background polling, drives auth-error UX.
- `NotificationService` — bridges SyncEngine and platform push.
- `ErrorDisplayService` — single funnel for user-facing errors.
- `AppLifecycleManager` — background/foreground transitions, WebSocket
  lifecycle.

## 4. Platforms and file-extension strategy

The app uses Expo + React Native + React Native Web. Platform-specific
behavior is expressed two ways:

- **Small differences**: `Platform.OS === 'web'` guards inline.
- **Significant differences**: separate `.ios.ts`, `.android.ts`, `.web.ts`
  files. Used for secure storage, SQLite driver, push notifications, and
  background-sync registration.

Feature parity is maintained across iOS, Android, and the PWA
(Mac/Windows/Linux browsers). A change made on any platform reflects on the
others within 30 seconds via the sync engine (Req 9.4).

## 5. Testing strategy

- **Unit tests** (Jest): every service and UI component. Live next to the
  source in `__tests__/` folders.
- **Property-based tests** (fast-check, `*.property.test.ts`): correctness
  properties from the design doc — conflict symmetry, ICS round-trip,
  privacy never leaking private fields, recurrence-rule expansion.
  100 iterations minimum per property, reproducible seeds in CI.
- **E2E** (Playwright, `e2e/calendar.spec.ts`): covers the unified view,
  event creation, and onboarding on the web build.

Run:

```
npm test              # unit
npm run test:pbt      # property-based only
npm run test:e2e      # Playwright E2E
npm run audit:runtime # runtime-dep vulnerability scan
```

## 6. Glossary (quick reference)

- **Unified view** — the single aggregated calendar timeline.
- **Calendar account** — a user's authenticated link to one provider
  (e.g., their Google work account).
- **Sync engine** — the state machine that keeps local storage and every
  provider in agreement.
- **Offline store** — the encrypted local SQLite DB, which is the app's
  source of truth.
- **Privacy layer** — the filter that applies visibility rules before
  events leave the device for any audience.
- **Delegation** — granting another user the ability to create/edit/delete
  events on your calendar (Team tier).
- **Free / Pro / Team** — the three subscription tiers; see §1 for scope.

## 7. Where to go next

- New feature? Start in `.kiro/specs/unified-calendar-app/requirements.md`
  to find the relevant `Requirement N` and then `design.md` for the
  component contract.
- Adding a provider? Implement `CalendarProviderAdapter` in
  `src/providers/` and register it in `appBootstrap.ts`.
- Adding a UI mode? See `src/ui/calendar/` and hook into `ViewModeSwitcher`.
- Changing the database schema? Add a forward-only migration in
  `src/db/migration.ts` and bump the schema version.
