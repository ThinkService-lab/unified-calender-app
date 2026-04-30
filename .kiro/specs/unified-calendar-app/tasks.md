# Implementation Plan: Unified Calendar App

## Overview

This plan implements the Unified Calendar App in dependency order: foundational data models and SQLite schema first, then the iCalendar parser/serializer, provider adapters, sync engine, privacy and conflict layers, AI scheduling, subscription/payment, UI components, onboarding, and finally integration wiring. Each task validates against the design before proceeding. TypeScript is used throughout with Expo (React Native + Web), Zustand, TanStack Query, SQLite, and fast-check.

## Tasks

- [x] 1. Initialize Expo project and configure core infrastructure
  - [x] 1.1 Scaffold Expo project with TypeScript, install core dependencies
    - Initialize Expo project with TypeScript template
    - Install: `zustand`, `immer`, `@tanstack/react-query`, `op-sqlite` (mobile), `sql.js` (web), `axios`, `fast-check` (dev), `jest` (dev)
    - Configure platform-specific file extensions (`.web.ts`, `.ios.ts`, `.android.ts`) in Metro/webpack
    - Set up `react-native-web` aliasing in babel/webpack config
    - Configure Jest with fast-check support
    - _Requirements: 9.1, 9.2_

  - [x] 1.2 Create TypeScript type definitions for all data models
    - Define all interfaces from design: `CalendarAccount`, `CalendarEvent`, `Organizer`, `RecurrenceRule`, `Attendee`, `SyncQueueEntry`, `UserSubscription`, `SharedCalendarView`, `SharedViewMember`, `DelegationGrant`, `SchedulingPreferences`, `LearnedPattern`, `AuthEvent`, `DeletionReceipt`, `OnboardingState`, `EncryptedPreferences`
    - Define type aliases: `ProviderId`, `VisibilityLevel`, `SubscriptionTier`, `Feature`, `OnboardingStep`, `TokenHealthStatus`
    - Define interface contracts: `ParseResult<T>`, `ParseError`, `Conflict`, `TimeSlot`, `SlotSuggestion`, `Audience`, `RetryPolicy`, `FreeBusySlot`, `MeetingRequest`, `TimeBlock`
    - _Requirements: 2.1, 3.1, 5.1, 12.1, 12.2_

  - [x] 1.3 Implement SQLite schema and database initialization
    - Create platform-specific SQLite driver module (`db.ios.ts`, `db.android.ts`, `db.web.ts`) wrapping `op-sqlite` / `sql.js`
    - Implement schema creation with all tables from design: `calendar_accounts`, `events`, `sync_queue`, `user_subscription`, `privacy_preferences`, `event_visibility_overrides`, `scheduling_preferences`, `auth_events`, `onboarding_state`
    - Create all indexes: `idx_events_calendar`, `idx_events_time`, `idx_events_sync`, `idx_events_provider_id`, `idx_auth_events_user`
    - Implement CASCADE delete constraints
    - Add schema version tracking table for migrations
    - Implement AES-256-GCM encryption wrapper for database at rest
    - _Requirements: 6.1, 6.4, 6.6, 13.2, 17.1_

  - [x] 1.4 Implement database migration framework
    - Create migration runner that detects schema version mismatch on launch
    - Implement forward-only migration execution with pre-migration backup
    - Implement read-only fallback mode on migration failure with user notification
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.6_

- [x] 2. Implement iCalendar parser and serializer (RFC 5545)
  - [x] 2.1 Implement EventSerializer
    - Implement `serialize(event: CalendarEvent): string` producing valid RFC 5545 iCalendar output
    - Handle line folding (75 octet limit), text escaping (`\\`, `\;`, `\,`, `\n`)
    - Serialize all fields: DTSTART/DTEND as UTC, RRULE with full BYxxx support, ATTENDEE, ORGANIZER, SEQUENCE, DTSTAMP
    - Serialize opaque fields (unknown properties preserved from parsing)
    - Implement `serializeComponent(vevent: VEvent): string`
    - _Requirements: 12.2_

  - [x] 2.2 Implement EventParser
    - Implement `parse(icsData: string): ParseResult<CalendarEvent>` consuming RFC 5545 iCalendar data
    - Implement line unfolding before parsing
    - Parse VTIMEZONE components and convert all times to UTC
    - Preserve unrecognized fields in `opaqueFields` map
    - Return `ParseError` with line number and message for malformed input
    - Handle VEVENT required fields: DTSTAMP, UID, DTSTART
    - Enforce mutual exclusivity of DTEND and DURATION
    - Implement `parseComponent(component: string): ParseResult<VEvent>`
    - _Requirements: 12.1, 12.3, 12.4, 12.6_

  - [ ]* 2.3 Write property test: Event serialization round-trip
    - **Property 1: Event serialization round-trip**
    - Build `arbCalendarEvent()` arbitrary generating valid CalendarEvent objects
    - Assert: serialize then parse produces equivalent CalendarEvent
    - **Validates: Requirements 12.1, 12.2, 12.5**

  - [ ]* 2.4 Write property test: Opaque field preservation
    - **Property 2: Opaque field preservation through round-trip**
    - Build `arbIcsString()` arbitrary generating valid iCalendar with unknown fields
    - Assert: parse then serialize preserves all unrecognized fields
    - **Validates: Requirements 12.3**

  - [ ]* 2.5 Write property test: Malformed iCalendar error reporting
    - **Property 3: Malformed iCalendar error reporting**
    - Build `arbMalformedIcs()` arbitrary generating invalid iCalendar strings
    - Assert: parser returns ParseError with line > 0 and non-empty message
    - **Validates: Requirements 12.4**

  - [ ]* 2.6 Write property test: Timezone normalization to UTC
    - **Property 4: Timezone normalization to UTC**
    - Generate events with various IANA timezones via VTIMEZONE
    - Assert: parsed startTime/endTime are UTC values representing the same instant
    - **Validates: Requirements 12.6**

- [x] 3. Implement recurrence rule engine
  - [x] 3.1 Implement recurrence rule expansion
    - Create `expandRecurrenceRule(rule: RecurrenceRule, start: Date, range: DateRange): Date[]`
    - Support all frequencies: daily, weekly, monthly, yearly with interval
    - Implement full BYxxx evaluation in RFC 5545 order: BYMONTH → BYWEEKNO → BYYEARDAY → BYMONTHDAY → BYDAY → BYHOUR → BYMINUTE → BYSECOND → BYSETPOS
    - Handle COUNT and UNTIL limits (mutually exclusive)
    - Handle EXDATE exceptions and WKST (week start day)
    - Silently skip invalid dates (e.g., Feb 30)
    - _Requirements: 3.4, 3.5_

  - [x] 3.2 Implement recurring event exception handling
    - Create logic to modify a single instance of a recurring event by creating an exception
    - Store exception with `recurrenceExceptionDate` and `parentRecurringEventId`
    - Ensure other occurrences remain unmodified
    - _Requirements: 3.5_

  - [ ]* 3.3 Write property test: Recurrence rule expansion correctness
    - **Property 14: Recurrence rule expansion correctness**
    - Build `arbRecurrenceRule()` arbitrary
    - Assert: expanded dates satisfy rule constraints, count ≤ rule.count, dates ≤ rule.until
    - **Validates: Requirements 3.4**

  - [ ]* 3.4 Write property test: Recurring event exception isolation
    - **Property 13: Recurring event exception isolation**
    - Assert: modifying one instance leaves all other occurrences unchanged
    - **Validates: Requirements 3.5**

- [x] 4. Checkpoint - Validate foundational layers
  - Ensure all tests pass for data models, SQLite schema, iCalendar parser/serializer, and recurrence engine
  - Verify round-trip property tests pass with minimum 100 iterations
  - Ask the user if questions arise

- [x] 5. Implement privacy layer
  - [x] 5.1 Implement PrivacyLayer service
    - Implement `getVisibility(calendarId)` and `setVisibility(calendarId, level)` backed by `privacy_preferences` table
    - Implement `getEventOverride(eventId)` and `setEventOverride(eventId, level)` backed by `event_visibility_overrides` table
    - Implement `filterForAudience(events, audience)`:
      - Private calendars: return zero events for non-owner audiences
      - Busy-only calendars: strip title, description, attendees — return time blocks only
      - Public calendars: return full event details
    - Event-level overrides take precedence over calendar-level visibility
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_

  - [ ]* 5.2 Write property test: Privacy filtering enforces visibility rules
    - **Property 5: Privacy filtering enforces visibility rules**
    - Build arbitrary events with mixed visibility levels and audiences
    - Assert: private → zero events, busy-only → stripped fields, public → full details
    - **Validates: Requirements 5.2, 5.3, 5.5**

  - [ ]* 5.3 Write property test: Per-event visibility override precedence
    - **Property 6: Per-event visibility override takes precedence**
    - Assert: event override always wins over calendar-level setting
    - **Validates: Requirements 5.4**

  - [x] 5.4 Implement E2E encrypted preference sync
    - Implement `UserPreferenceSyncService`: `deriveEncryptionKey`, `pushPreferences`, `pullPreferences`, `syncPreferences`
    - Use AES-256-GCM for encryption/decryption
    - Store encrypted blob server-side (server cannot decrypt)
    - _Requirements: 5.6_

  - [ ]* 5.5 Write property test: E2E encrypted preference round-trip
    - **Property 29: E2E encrypted preference round-trip**
    - Assert: encrypt then decrypt with same key produces identical preferences
    - **Validates: Requirements 5.6**

- [x] 6. Implement conflict detection
  - [x] 6.1 Implement ConflictDetector service
    - Implement `detectConflicts(event, allEvents)`: check `startA < endB AND startB < endA` for time overlap
    - Implement `suggestAlternatives(event, allEvents, count)`: find conflict-free slots across all visible calendars
    - Implement `estimateTravelTime(from, to)` for travel-time conflict detection
    - Implement continuous scanning: `startContinuousScanning`, `stopContinuousScanning`, `onConflictDetected` callback
    - Ensure conflict check completes within 500ms
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

  - [x]* 6.2 Write property test: Conflict detection correctness
    - **Property 7: Conflict detection correctness**
    - Assert: overlap reported iff `startA < endB AND startB < endA`
    - **Validates: Requirements 7.1**

  - [x]* 6.3 Write property test: Alternative slot suggestions are conflict-free
    - **Property 8: Alternative slot suggestions are conflict-free**
    - Assert: every suggested slot has zero overlap with existing events
    - **Validates: Requirements 7.3**

  - [x]* 6.4 Write property test: Travel time conflict detection
    - **Property 9: Travel time conflict detection**
    - Assert: travel-time conflict reported when gap < estimated travel time
    - **Validates: Requirements 7.4**

  - [x]* 6.5 Write property test: Continuous conflict scanning timing
    - **Property 28: Continuous conflict scanning detects new conflicts within 60 seconds**
    - Assert: `onConflictDetected` fires within 60s of sync completing for overlapping events
    - **Validates: Requirements 7.6**

- [x] 7. Implement provider adapters and OAuth
  - [x] 7.1 Implement CalendarProviderAdapter base and OAuth connector
    - Define abstract base implementing `CalendarProviderAdapter` interface
    - Implement OAuth 2.0 flow with PKCE for mobile (`codeVerifier`, `codeChallenge`)
    - Store tokens in platform-specific secure storage (iOS Keychain, Android Keystore, Web Crypto) via platform-specific files
    - Implement `refreshToken` with auto-refresh on 401 via Axios response interceptor
    - Implement `revokeAccess` clearing stored credentials
    - _Requirements: 1.1, 1.2, 1.5, 13.2_

  - [x] 7.2 Implement Google Calendar adapter
    - Implement `listCalendars`, `listEvents`, `createEvent`, `updateEvent`, `deleteEvent` via Google Calendar REST API
    - Implement `getChanges` using `syncToken` for incremental sync
    - Implement `setupPushNotification` using `events.watch` for webhooks
    - Implement `getFreeBusy` for free/busy queries
    - Implement request batching via Google batch API
    - Enforce Google rate limits (quota per 100 seconds per user)
    - _Requirements: 1.1, 4.1, 4.3, 18.1, 18.3_

  - [x] 7.3 Implement Microsoft Outlook adapter
    - Implement all CalendarProviderAdapter methods via Microsoft Graph API
    - Implement `getChanges` using `deltaLink` for incremental sync
    - Implement `setupPushNotification` using Graph subscriptions (max 4230 min expiry)
    - Implement `$batch` request batching
    - Enforce Microsoft Graph rate limits (10,000 requests per 10 minutes per app)
    - _Requirements: 1.1, 4.1, 4.3, 18.1, 18.3_

  - [x] 7.4 Implement CalDAV adapter (iCloud + generic CalDAV)
    - Implement all CalendarProviderAdapter methods via WebDAV/CalDAV protocol
    - Implement `getChanges` using `sync-token` for incremental sync
    - No push support — polling only at configurable intervals (≤ 5 minutes)
    - _Requirements: 1.1, 4.4_

  - [x] 7.5 Implement Exchange adapter
    - Implement all CalendarProviderAdapter methods via EWS or Microsoft Graph
    - Implement push notifications where supported
    - _Requirements: 1.1, 4.3_

  - [x] 7.6 Implement TokenHealthMonitor
    - Monitor token validity with lightweight API calls on 30-second intervals
    - Implement `checkTokenHealth(accountId)` returning `valid | expired | revoked | unknown`
    - Fire `onTokenRevoked` callback within 30 seconds of revocation detection
    - Prompt user for re-authentication on revocation
    - _Requirements: 1.4_

  - [x]* 7.7 Write property test: Token revocation detection timing
    - **Property 26: Token revocation detection within 30 seconds**
    - Assert: `onTokenRevoked` fires within 30s of provider token revocation
    - **Validates: Requirements 1.4**

  - [x]* 7.8 Write property test: Polling interval compliance
    - **Property 32: Polling interval compliance**
    - Assert: providers without push are polled at intervals ≤ 5 minutes
    - **Validates: Requirements 4.4**

- [x] 8. Implement sync engine
  - [x] 8.1 Implement SyncEngine state machine
    - Implement state machine: Idle → SyncingOutbound / SyncingInbound / FullSync → ConflictResolution / RetryQueue → Idle
    - Implement `queueLocalChange(change)` writing to `sync_queue` table
    - Implement `processOutboundQueue()` pushing pending changes to providers via adapters
    - Implement `handleWebhookNotification(notification)` processing inbound changes
    - Implement `pollProvider(accountId)` for providers without push support
    - Implement `fullSync(accountId)` and `syncAllPending()` for reconnection after offline
    - Push changes to provider within 5 seconds of local mutation
    - Reflect inbound changes within 30 seconds
    - Synchronize all queued changes within 60 seconds of network restoration
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.6, 6.3_

  - [x] 8.2 Implement conflict resolution
    - Detect conflicts when same event modified locally and remotely with different content
    - Present both versions to user for manual resolution (never auto-resolve)
    - Implement `getConflicts()` and `resolveConflict(conflictId, resolution)`
    - _Requirements: 4.5, 6.5_

  - [x] 8.3 Implement rate limiting and retry logic
    - Enforce per-provider rate limits from design (Google, Microsoft, CalDAV)
    - Handle 429 responses: pause requests, respect `Retry-After` header
    - Implement exponential backoff with jitter (max 5 retries, 1s initial, 60s max, 2x multiplier, 0.1 jitter)
    - Prioritize user-initiated operations over background sync when approaching limits
    - Log rate limit events and expose sync health indicator
    - Increase polling intervals for persistently rate-limited providers
    - _Requirements: 18.1, 18.2, 18.3, 18.4, 18.5, 18.6_

  - [x]* 8.4 Write property test: Failed write operations are queued
    - **Property 15: Failed write operations are queued**
    - Assert: failed write creates exactly one SyncQueueEntry with status pending, retryCount 0
    - **Validates: Requirements 3.6**

  - [x]* 8.5 Write property test: Sync conflict detection preserves both versions
    - **Property 16: Sync conflict detection preserves both versions**
    - Assert: conflict object contains both local and remote versions
    - **Validates: Requirements 4.5, 6.5**

  - [x]* 8.6 Write property test: Offline CRUD and sync queue consistency
    - **Property 19: Offline CRUD operations and sync queue consistency**
    - Assert: offline CRUD reflects locally immediately, sync queue has exactly one matching entry
    - **Validates: Requirements 6.1, 6.2**

- [x] 9. Checkpoint - Validate sync and provider layers
  - Ensure all tests pass for provider adapters, sync engine, privacy layer, and conflict detection
  - Verify property tests for sync queue, conflict detection, and privacy filtering pass
  - Ask the user if questions arise

- [x] 10. Implement Zustand stores and TanStack Query integration
  - [x] 10.1 Implement Zustand stores with middleware stack
    - Create calendar accounts store with `persist` (SQLite-backed custom storage adapter) + `immer` + `devtools` middleware
    - Create events store with time-range queries and sync status tracking
    - Create sync status store using `zustand/vanilla` for non-React sync engine context
    - Create subscription store tracking current tier, grace period, feature access
    - Use atomic selectors and `useShallow` for multi-field selections
    - Use transient updates (`subscribe` + `useRef`) for high-frequency sync status
    - _Requirements: 2.1, 6.1_

  - [x] 10.2 Configure TanStack Query for server-state management
    - Set up `QueryClient` with appropriate `staleTime` and `gcTime` per query type
    - Create query hooks for provider API calls: `useCalendars(accountId)`, `useEvents(accountId, range)`
    - Create mutation hooks: `useCreateEvent`, `useUpdateEvent`, `useDeleteEvent` with optimistic updates
    - Invalidate queries after mutations
    - Configure `onlineManager` for offline-aware query behavior
    - _Requirements: 4.1, 4.2_

- [x] 11. Implement subscription and payment management
  - [x] 11.1 Implement SubscriptionManager
    - Implement `getCurrentTier(userId)`, `checkFeatureAccess(userId, feature)`, `validateReceipt(receipt)`
    - Implement tier enforcement: Free (3 accounts, basic view), Pro (unlimited, AI, conflicts, privacy), Team (shared views, delegation)
    - Implement `handleDowngrade(userId, newTier)`: retain data, disable excess features at billing period end
    - Implement `getGracePeriodEnd(userId)`: 7-day grace period on payment failure
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.6_

  - [x] 11.2 Implement platform payment integration
    - Mobile: Integrate RevenueCat SDK wrapping Apple StoreKit + Google Play Billing
    - Web: Integrate Stripe Checkout + Stripe Billing
    - Map tiers to RevenueCat entitlements: `pro`, `team`
    - Handle webhook events: `INITIAL_PURCHASE`, `RENEWAL`, `CANCELLATION`, `BILLING_ISSUE`
    - Unlock features within 10 seconds of payment confirmation
    - _Requirements: 10.2, 10.3, 10.5_

  - [x] 11.3 Implement account limit enforcement
    - Block connecting more than 3 accounts on Free tier with upgrade prompt
    - On downgrade, make excess accounts read-only (do not delete)
    - _Requirements: 1.3, 10.1, 10.4_

  - [ ]* 11.4 Write property test: Subscription tier feature access enforcement
    - **Property 10: Subscription tier feature access enforcement**
    - Build `arbSubscriptionTier()` arbitrary
    - Assert: `checkFeatureAccess` returns true iff tier includes feature
    - **Validates: Requirements 1.3, 10.1, 10.2, 10.3**

  - [ ]* 11.5 Write property test: Downgrade retains data but disables features
    - **Property 11: Downgrade retains data but disables features**
    - Assert: data retained, `checkFeatureAccess` returns false for higher-tier features
    - **Validates: Requirements 10.4**

  - [ ]* 11.6 Write property test: Grace period calculation
    - **Property 12: Grace period calculation**
    - Assert: features accessible for exactly 7 days after payment failure, then Free tier enforced
    - **Validates: Requirements 10.6**

- [x] 12. Implement event CRUD operations
  - [x] 12.1 Implement full read-write event management
    - Create event: write to local SQLite, queue outbound sync to provider
    - Update event: local write, propagate to provider within 5 seconds
    - Delete event: local delete, propagate to provider within 5 seconds
    - Support selecting target calendar account on event creation
    - Queue failed operations for retry with user notification
    - _Requirements: 3.1, 3.2, 3.3, 3.6_

  - [x] 12.2 Implement calendar account management
    - Connect account: OAuth flow → store credentials → initial sync
    - Remove account: delete all local data (events, sync queue, preferences) within 5 seconds via CASCADE
    - _Requirements: 1.2, 1.6_

  - [ ]* 12.3 Write property test: Data removal completeness
    - **Property 20: Data removal completeness**
    - Assert: after account removal, zero records remain for that account in all tables
    - **Validates: Requirements 1.6, 13.4**

- [x] 13. Checkpoint - Validate business logic layers
  - Ensure all tests pass for subscription management, event CRUD, stores, and query hooks
  - Verify property tests for tier enforcement, grace period, and data removal pass
  - Ask the user if questions arise

- [x] 14. Implement shared views, delegation, and security
  - [x] 14.1 Implement shared calendar views
    - Create shared view with designated members (Team tier only)
    - Enforce 20-member limit per shared view
    - Apply privacy layer visibility rules for shared view members
    - _Requirements: 14.1, 14.6_

  - [x] 14.2 Implement delegation system
    - Grant delegation: read-only or read-write permission levels
    - Delegate CRUD: allow create/update/delete for read-write delegates, reject writes for read-only
    - Record delegate identity in `modifiedBy` field on event modifications
    - Revoke delegation: remove access within 10 seconds
    - _Requirements: 14.2, 14.3, 14.4, 14.5_

  - [x]* 14.3 Write property test: Delegation permission enforcement
    - **Property 21: Delegation permission enforcement**
    - Build `arbDelegationGrant()` arbitrary
    - Assert: read-write allows CRUD, read-only rejects writes, revoked rejects all
    - **Validates: Requirements 14.2, 14.3, 14.5**

  - [x]* 14.4 Write property test: Delegate modification audit trail
    - **Property 22: Delegate modification audit trail**
    - Assert: `modifiedBy` contains delegate's user ID after delegate modification
    - **Validates: Requirements 14.4**

  - [x]* 14.5 Write property test: Shared view member limit enforcement
    - **Property 23: Shared view member limit enforcement**
    - Assert: adding member when count = 20 is rejected
    - **Validates: Requirements 14.6**

  - [x] 14.6 Implement auth event logging and session activity
    - Log all auth events (login, logout, token_refresh, token_revoked, password_change) to `auth_events` table
    - Expose session activity view showing recent sign-ins
    - Implement rate limiting on authentication endpoints
    - _Requirements: 13.5, 13.6_

  - [x]* 14.7 Write property test: Auth event logging completeness
    - **Property 31: Auth event logging completeness**
    - Assert: each auth action creates exactly one AuthEvent with correct eventType, platform, timestamp
    - **Validates: Requirements 13.6**

  - [x] 14.8 Implement user data service
    - Implement `deleteUserAccount(userId)`: erase local data immediately, schedule server deletion within 30 days
    - Implement `getDeletionStatus(userId)` returning pending/in_progress/completed
    - Return `DeletionReceipt` with `scheduledCompletionAt` ≤ 30 days from request
    - _Requirements: 13.4_

  - [x]* 14.9 Write property test: Server-side data deletion completeness
    - **Property 30: Server-side data deletion completeness**
    - Assert: `scheduledCompletionAt` ≤ 30 days, zero records after completion
    - **Validates: Requirements 13.4**

- [x] 15. Implement AI scheduling assistant
  - [x] 15.1 Implement AISchedulingAssistant service
    - Gate access behind Pro/Team tier subscription check (reject with upgrade prompt on Free tier)
    - Implement `suggestSlots(request, calendars, preferences)`: analyze availability, return top 3 conflict-free slots with `score` (0-1 confidence) and `tradeoffs` explanations
    - Respect scheduling preferences: preferred hours, minimum buffer, max meetings per day, focus time blocks
    - If no slot within preferences, suggest closest alternatives with trade-off explanations
    - Implement `learnFromPattern(event, action)` for on-device pattern learning
    - Implement `getPreferences(userId)` backed by `scheduling_preferences` table
    - Consider shared free/busy information for external attendees where available
    - When calling server-side AI service (`POST /ai/suggest-slots`), strip event titles, descriptions, and attendee names — send only anonymized availability windows (time blocks)
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_

  - [x] 15.2 Integrate on-device TensorFlow Lite model
    - Keep model under 1MB with INT8 quantization
    - Run inference off main thread
    - All training data stays on device
    - Provide fallback heuristics for new users with insufficient data
    - _Requirements: 8.3_

  - [x]* 15.3 Write property test: AI suggestions respect preferences
    - **Property 24: AI scheduling suggestions respect preferences**
    - Build `arbSchedulingPreferences()` arbitrary
    - Assert: slots within preferred hours, buffer maintained, max meetings not exceeded
    - **Validates: Requirements 8.5**

  - [x]* 15.4 Write property test: AI suggestions are conflict-free
    - **Property 25: AI scheduling suggestions are conflict-free**
    - Assert: all suggested slots have zero overlap with existing events, count ≤ 3
    - **Validates: Requirements 8.2**

- [x] 16. Checkpoint - Validate delegation, security, and AI layers
  - Ensure all tests pass for shared views, delegation, auth logging, user data service, and AI scheduling
  - Verify property tests for delegation, auth events, deletion, and AI suggestions pass
  - Ask the user if questions arise

- [x] 17. Implement UI layer - Unified Calendar View
  - [x] 17.1 Implement responsive layout system
    - Create `ResponsiveLayout` with breakpoints: phone (320), tablet (768), desktop (1024), wide (1440)
    - Implement `useBreakpoint()` React hook
    - Phone: single column, bottom tab nav, agenda/day default
    - Tablet: sidebar + main, collapsible nav, week default
    - Desktop: sidebar + main + detail panel, week/month default
    - Wide: full three-column layout, month default
    - _Requirements: 9.5_

  - [x] 17.2 Implement Unified View with display modes
    - Implement day, week, month, and agenda display modes
    - Color-code events by calendar account
    - Toggle calendar visibility with ≤ 200ms response
    - Render full month of events within 1 second
    - Use `FlatList` with `getItemLayout` for long event lists
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.6_

  - [x] 17.3 Implement overlapping event layout algorithm
    - Assign distinct column positions to time-overlapping events
    - Render all overlapping events side by side without truncation
    - _Requirements: 2.5_

  - [ ]* 17.4 Write property test: Unified view contains all events
    - **Property 17: Unified view contains all events**
    - Assert: view model contains exactly the union of events from all visible accounts
    - **Validates: Requirements 2.1**

  - [ ]* 17.5 Write property test: Overlapping event layout
    - **Property 18: Overlapping event layout assigns visible positions**
    - Assert: each overlapping event gets a distinct column position, none hidden
    - **Validates: Requirements 2.5**

  - [x] 17.6 Implement event editor (create/edit/delete)
    - Event creation form with calendar account selector
    - Event editing with recurrence options (daily, weekly, monthly, yearly)
    - Single-instance edit for recurring events (exception creation)
    - Delete with confirmation
    - Conflict warning display with alternative time suggestions
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 7.2, 7.3_

  - [x] 17.7 Implement accessibility compliance
    - Add accessible labels to all interactive elements
    - Calendar events announce: title, time, calendar name, conflict status
    - Ensure WCAG 2.1 AA contrast ratios (4.5:1 text, 3:1 UI)
    - Pair calendar colors with patterns/icons for color-blind users
    - Full keyboard navigation on web
    - Screen reader announcements for view changes, sync status, conflict alerts
    - Focus management: trap in modals, return on dismiss
    - Respect `prefers-reduced-motion`
    - _Requirements: 9.6_

- [x] 18. Implement onboarding and internationalization
  - [x] 18.1 Implement OnboardingManager
    - 4-step guided flow: welcome → connect_first_account → choose_view → explore_features
    - Allow first account connection within 60 seconds
    - Display Unified View with all calendars on completion
    - Contextual tooltips for first 7 days
    - Skip option with access from settings menu
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_

  - [ ]* 18.2 Write property test: Onboarding flow never exceeds 4 steps
    - **Property 27: Onboarding flow never exceeds 4 steps**
    - Assert: total steps = 4, completedSteps.length ≤ 4
    - **Validates: Requirements 11.1**

  - [x] 18.3 Implement I18nService
    - Support 10 languages: en, es, fr, de, ja, ko, zh-CN, pt, it, ar
    - Implement `t(key, params)` translation function
    - Implement RTL support for Arabic
    - Create translation files for all 10 locales
    - _Requirements: 11.6_

- [x] 19. Implement error UX and notifications
  - [x] 19.1 Implement error display components
    - Non-intrusive banner for sync errors with "Details" action
    - Badge on calendar account for auth errors with "Reconnect" action
    - Persistent banner for payment errors showing grace period countdown and "Update Payment" action
    - Offline indicator confirming changes will sync on reconnect
    - Error log in Settings showing last 50 errors with timestamps and resolution status
    - Never display raw error codes, stack traces, or technical jargon
    - _Requirements: 19.1, 19.2, 19.3, 19.4, 19.5, 19.6_

  - [x] 19.2 Implement push notification system
    - Request notification permissions during onboarding
    - Platform-specific handlers: APNs (iOS), FCM (Android), Web Push API
    - Notification categories: conflicts, reminders, sync status, payment
    - Per-category notification preferences
    - Suppress sensitive event details unless user opted in
    - Background push notification reception on mobile
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6_

- [x] 20. Implement app lifecycle and background sync
  - [x] 20.1 Implement app lifecycle handlers
    - On background: complete in-progress sync, close WebSocket, rely on push notifications
    - On foreground: reconnect WebSocket, delta sync within 10 seconds
    - On termination: persist all pending sync queue entries to SQLite
    - On launch after termination: process all pending sync queue entries before accepting new mutations
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.6_

  - [x] 20.2 Implement background fetch registration
    - iOS: register for background fetch (minimum 15-minute interval)
    - Android: register WorkManager for periodic sync (minimum 15-minute interval)
    - _Requirements: 16.5_

  - [x] 20.3 Implement WebSocket connection management
    - Use `wss://` only with heartbeat (30s) and auto-reconnect with exponential backoff
    - Subscribe via `{ type: 'subscribe', userId, deviceId }`
    - Handle inbound `{ type: 'event_changed', accountId, changeType, syncToken }`
    - Close on background, reconnect on foreground
    - _Requirements: 4.3, 16.2, 16.3_

- [x] 21. Checkpoint - Validate UI, onboarding, and lifecycle
  - Ensure all tests pass for UI components, onboarding, i18n, error UX, notifications, and lifecycle
  - Verify property tests for unified view, overlapping layout, and onboarding pass
  - Ask the user if questions arise

- [x] 22. Integration wiring and final validation
  - [x] 22.1 Wire all components together
    - Connect UI layer → Zustand stores → TanStack Query → SyncEngine → Provider Adapters
    - Connect SyncEngine → ConflictDetector → push notifications
    - Connect SubscriptionManager → feature gating across all components
    - Connect PrivacyLayer → Unified View filtering
    - Connect AISchedulingAssistant → event editor suggestions
    - Connect OnboardingManager → initial app flow
    - Connect TokenHealthMonitor → auth error UX
    - Connect WebSocket → SyncEngine inbound notifications
    - Ensure all data flows match the architecture diagram in design
    - _Requirements: 2.1, 4.1, 7.1, 8.1, 10.1, 13.1, 13.3_

  - [x] 22.2 Implement TLS and network security
    - Ensure all Axios instances use HTTPS (TLS 1.2+)
    - Set timeouts on all requests (5-10 seconds)
    - Create per-provider Axios instances with base URLs and auth interceptors
    - Verify no raw event data sent to third parties (except originating provider)
    - _Requirements: 13.1, 13.3_

  - [ ]* 22.3 Write integration tests
    - OAuth flow with mock provider endpoints
    - Sync engine with mock provider adapters (webhook + polling)
    - Payment validation with mock store/Stripe APIs
    - Cross-platform sync timing verification
    - Encryption at rest verification
    - _Requirements: 1.2, 4.1, 10.5, 6.6_

- [x] 23. Final checkpoint - Ensure all tests pass
  - Run full test suite: unit tests, property-based tests, integration tests
  - Verify all 32 correctness properties pass with minimum 100 iterations each
  - Verify all 19 requirements have coverage via task references
  - Ensure all tests pass, ask the user if questions arise

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation after each major layer
- Property tests validate the 32 universal correctness properties from the design
- Unit tests validate specific examples and edge cases
- Tasks are ordered by dependency: data models → parser → adapters → sync → privacy/conflicts → AI → subscriptions → UI → wiring
- TypeScript is used throughout, matching the design document's interface definitions
