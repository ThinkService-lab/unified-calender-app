---
inclusion: always
---

# Unified Calendar App - Tech Stack Best Practices

When working on the unified-calendar-app, always consult the documentation in the `docs/` folder and enforce the following best practices derived from each technology's official guidance.

## Reference Documentation
- #[[file:docs/react-native-getting-started.md]]
- #[[file:docs/react-native-web.md]]
- #[[file:docs/expo.md]]
- #[[file:docs/zustand.md]]
- #[[file:docs/tanstack-react-query.md]]
- #[[file:docs/fast-check.md]]
- #[[file:docs/rfc5545-icalendar-summary.md]]
- #[[file:docs/payment-processing.md]]
- #[[file:docs/provider-apis.md]]
- #[[file:docs/tensorflow-lite.md]]
- #[[file:docs/networking.md]]
- #[[file:.kiro/specs/unified-calendar-app/design.md]]

## React Native + React Native Web

1. Use `Platform.OS === 'web'` checks for minor platform differences; use `.web.js` / `.ios.js` / `.android.js` file extensions for significant differences.
2. Alias `react-native` to `react-native-web` in webpack/babel/jest configs.
3. Use the `react-native-web` Babel plugin for tree-shaking.
4. For full-screen apps, set `html, body { height: 100% }` and `#root { display: flex; height: 100% }`.
5. Target 60fps. Use `useNativeDriver: true` for animations. Offload heavy work with `InteractionManager`.
6. Remove all `console.log` in production builds via `babel-plugin-transform-remove-console`.
7. Use `FlatList` with `getItemLayout` for long event lists. Consider FlashList for better scroll performance.
8. Never store API keys or OAuth secrets in app code. Use server-side orchestration.
9. Store tokens in platform-specific secure storage (iOS Keychain, Android Keystore) — never in AsyncStorage.
10. Use PKCE with OAuth2 for mobile authentication flows.
11. Always use HTTPS. Consider SSL pinning for high-security endpoints.

## Zustand (State Management)

1. Use atomic selectors: `useBearStore((state) => state.bears)` — never select the entire store.
2. Use `useShallow` when selecting multiple fields to prevent unnecessary re-renders.
3. Use the `persist` middleware with `createJSONStorage` for offline state persistence.
4. Use the `immer` middleware for deeply nested state updates.
5. Use `devtools` middleware in development (disable in production with `enabled: false`).
6. For high-frequency updates (e.g., sync status), use transient updates via `subscribe` + `useRef`.
7. Use `createStore` from `zustand/vanilla` for non-React contexts (sync engine, background workers).
8. TypeScript: always use `create<State>()(...)` pattern.

## TanStack Query (React Query)

1. Use for all server-state: provider API calls, sync operations, subscription validation.
2. Use unique, serializable query keys: `['events', accountId, dateRange]`.
3. Check `isPending` → `isError` → render data pattern.
4. Use `useMutation` for write operations (create/update/delete events).
5. Invalidate queries after mutations: `queryClient.invalidateQueries({ queryKey: ['events'] })`.
6. Use `staleTime` and `gcTime` to control cache freshness per query type.
7. Use `useQuery` with `enabled: false` for conditional fetching (e.g., only when online).
8. Use `onlineManager` for offline-aware query behavior.

## fast-check (Property-Based Testing)

1. Every correctness property from the design doc must have a corresponding `fc.assert(fc.property(...))` test.
2. Minimum 100 iterations per property (`numRuns: 100`).
3. Tag every PBT with: `// Feature: unified-calendar-app, Property N: title`.
4. Build custom arbitraries for domain types: `arbCalendarEvent()`, `arbRecurrenceRule()`, `arbIcsString()`.
5. Use `fc.pre()` for preconditions instead of filtering.
6. Use `.chain()` for dependent generators (e.g., generating valid event pairs with overlapping times).
7. Set configurable seeds for reproducibility in CI.
8. Use verbose mode during development for debugging failures.
9. Test round-trip properties: serialize → parse → compare.
10. Test invariants: conflict detection must be symmetric, privacy filtering must never leak private fields.

## RFC 5545 (iCalendar) Compliance

1. Content lines must not exceed 75 octets; implement line folding (CRLF + whitespace).
2. Always unfold lines before parsing.
3. Property names and parameter names are case-insensitive; property values are case-sensitive.
4. Preserve unknown properties and parameters (x-name, iana-token) through round-trips.
5. VEVENT requires DTSTAMP and UID. DTSTART is required if no METHOD property.
6. DTEND and DURATION must not both appear in the same event.
7. DTEND is non-inclusive (event ends before DTEND).
8. Recurrence rules: FREQ is required and must be first. UNTIL and COUNT must not both appear.
9. Invalid recurrence dates (e.g., Feb 30) must be silently skipped.
10. BYxxx evaluation order: BYMONTH → BYWEEKNO → BYYEARDAY → BYMONTHDAY → BYDAY → BYHOUR → BYMINUTE → BYSECOND → BYSETPOS.
11. Text escaping: `\\`, `\;`, `\,`, `\n`/`\N`. Do NOT escape colons.
12. All times stored internally as UTC. Use VTIMEZONE + TZID for local time display.
13. UID must be globally unique and support at least 255 octets.
14. Default charset is UTF-8. Must accept both UTF-8 and US-ASCII.

## Security Enforcement

1. All network traffic over TLS 1.2+.
2. OAuth tokens in platform-specific secure storage only.
3. No raw event data sent to third parties (except originating provider).
4. AES-256-GCM encryption for local SQLite database.
5. Rate limiting on all authentication endpoints.
6. PKCE required for all OAuth2 mobile flows.
7. Deep links must never contain tokens or sensitive data.

## Expo

1. Use development builds (not Expo Go) for production apps with custom native modules.
2. Use EAS Build for CI/CD. Use `eas build --local` for debugging.
3. Install web deps: `npx expo install react-dom react-native-web @expo/metro-runtime`.
4. Use Expo Router for file-based navigation.
5. Use `expo-secure-store` for credential storage on mobile.
6. Use platform-specific file extensions for: secure storage, SQLite driver, push notifications.

## Payment Processing

1. Mobile: Use RevenueCat SDK wrapping Apple StoreKit + Google Play Billing.
2. Web: Use Stripe Checkout + Stripe Billing for subscriptions.
3. Map subscription tiers to RevenueCat entitlements: `pro`, `team`.
4. Handle webhook events server-side: `INITIAL_PURCHASE`, `RENEWAL`, `CANCELLATION`, `BILLING_ISSUE`.
5. Implement 7-day grace period on `BILLING_ISSUE` / `invoice.payment_failed` before downgrade.
6. Never store payment card details client-side.

## Provider APIs

1. Google Calendar: Use `syncToken` for incremental sync, `events.watch` for webhooks.
2. Microsoft Graph: Use `deltaLink` for incremental sync, subscriptions for webhooks (max 4230 min expiry).
3. CalDAV/iCloud: Use `sync-token` for incremental sync, poll at ≤ 5 minute intervals (no push support).
4. Use request batching where supported (Google batch API, Microsoft `$batch`).
5. Respect per-provider rate limits. Prioritize user-initiated operations over background sync.
6. All provider adapters must implement the `CalendarProviderAdapter` interface.

## Networking

1. Always set `timeout` on Axios requests (5-10 seconds).
2. Create per-provider Axios instances with base URLs and auth interceptors.
3. Use response interceptors for 401 auto-refresh.
4. WebSocket: Use `wss://` only. Implement heartbeat (30s), auto-reconnect with backoff.
5. Close WebSocket on app background, reconnect on foreground.

## On-Device AI (TensorFlow Lite)

1. Keep model size under 1MB. Use INT8 quantization.
2. Run inference off the main thread.
3. All training data stays on device — never upload model weights or event details.
4. Provide fallback heuristics for new users with insufficient data.

## App Lifecycle

1. Complete in-progress sync before app suspension.
2. Persist sync queue entries to SQLite before termination.
3. Delta sync within 10 seconds on foreground return.
4. Register for iOS background fetch and Android WorkManager.

## Data Migration

1. Include schema version number in SQLite database.
2. Execute forward-only migrations on version mismatch.
3. Back up database before migration.
4. Fall back to read-only mode if migration fails.

## Error UX

1. Non-intrusive banners for sync errors with "Details" action.
2. Badge on affected calendar for auth errors with "Reconnect" action.
3. Persistent banner for payment issues showing grace period countdown.
4. Offline indicator confirming changes will sync on reconnect.
5. Never display raw error codes or stack traces to users.
