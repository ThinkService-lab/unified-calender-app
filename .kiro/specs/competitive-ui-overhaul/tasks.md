# Implementation Plan: Competitive UI Overhaul

## Overview

This plan transforms the Unified Calendar App's front-end into a fluid, gesture-driven, animation-rich experience. Tasks are ordered by dependency: infrastructure first (design tokens, animation engine), then pure logic (NL parser, recurrence parser), then gesture controllers, then UI components, then integration wiring. All code is TypeScript targeting Expo (React Native + React Native Web).

## Tasks

- [x] 1. Install new dependencies and set up project infrastructure
  - [x] 1.1 Install react-native-reanimated, react-native-gesture-handler, and expo-haptics
    - Add `react-native-reanimated` (^3.x), `react-native-gesture-handler` (^2.x), and `expo-haptics` (^14.x) to `unified-calendar-app/package.json`
    - Update `babel.config.js` to include the `react-native-reanimated/plugin` as the last plugin
    - Wrap the app root in `<GestureHandlerRootView style={{flex: 1}}>` in `App.tsx` — this is required for all `react-native-gesture-handler` gestures to function; without it, gesture hooks silently fail at runtime
    - Verify `react-native-reanimated` works on web by confirming the Expo Metro bundler resolves reanimated's web entry point (standard Expo Metro config handles this; no custom webpack needed since `metro.config.js` uses the default Expo config)
    - Verify the app still builds and renders on web after dependency installation
    - _Requirements: 2.1, 4.1, 14.6_

  - [x] 1.2 Create the Design Token System module
    - Create `src/ui/tokens/designTokens.ts` implementing the `DesignTokens`, `ColorTokens`, `TypographyTokens`, `SpacingTokens`, `RadiiTokens`, and `ShadowTokens` interfaces
    - Define `lightTokens` and `darkTokens` with at least 15 WCAG AA-compliant event colors
    - `ColorTokens` MUST expose distinct `textOnPrimary` / `textOnPrimaryLight` / `textOnPrimaryDark` tokens so text rendered on each primary shade meets 4.5:1 contrast. White on the light theme's `primaryLight` (#E5684C) only reaches ≈3:1; routing via the dedicated token picks the correct near-black label instead.
    - Ensure all spacing values are multiples of the 4px base unit (xs=4, sm=8, md=12, lg=16, xl=24, 2xl=32, 3xl=48, 4xl=64)
    - Type `TypographyTokens.weights` values as `TextStyle['fontWeight']` literals (e.g. `'400' | '500' | ...`) so consumers can assign them directly to React Native style props without TypeScript narrowing errors
    - Export `useTokens()` hook that returns the current token set by reading `colorScheme` + `resolvedSystemScheme` from the UIPreferences store created in Task 1.6 — do NOT install an `Appearance.addChangeListener` inside the hook (the store owns the single global subscription)
    - Also create `src/ui/tokens/contrastVerification.ts` implementing pure `parseHex`, `contrastRatio`, `auditTokenContrast`, `verifyWcagContrast`, and `assertWcagContrast` functions used by Task 1.3 and available for dev-time bootstrap use
    - Create `src/ui/tokens/index.ts` barrel export
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7_

  - [x] 1.3 Write property test for WCAG AA contrast ratios (Property 1)
    - **Property 1: Event color palette meets WCAG AA contrast ratios**
    - Generate random event colors from the palette, compute contrast ratios against light and dark backgrounds, verify ≥4.5:1 for text and ≥3:1 for UI elements
    - Create test at `src/ui/tokens/__tests__/designTokens.test.ts` (integrated with the unit test suite as a required, non-optional check — see `verifyWcagContrast` in `src/ui/tokens/contrastVerification.ts`)
    - **Validates: Requirements 1.1**

  - [x] 1.4 Write property test for dark mode token parity (Property 2)
    - **Property 2: Dark mode token parity**
    - Iterate all keys in `lightTokens.colors`, verify `darkTokens.colors` has the same keys with valid hex color values
    - Create test at `src/ui/tokens/__tests__/designTokens.test.ts`
    - **Validates: Requirements 1.7**


  - [x] 1.6 Create UIPreferences Zustand store slice
    - Create `src/stores/uiPreferencesStore.ts` using `create<UIPreferences>()(...)` pattern with `persist` middleware
    - Define `UIPreferences` state: `colorScheme` ('light' | 'dark' | 'system', default 'system'), `shortcutOverrides` (Record<string, string>, default {})
    - **Do NOT add `onboardingComplete` to this store** — onboarding completion is already tracked by the existing `OnboardingManager` (`src/onboarding/onboardingManager.ts`) which persists state to SQLite. Task 18.9 reads from `OnboardingManager.isComplete()`; adding a duplicate field here would create two sources of truth and a race condition.
    - Export `useUIPreferences()` hook with atomic selectors
    - Wire `colorScheme` preference into the `useTokens()` hook so it returns the correct token set
    - Install a single global `Appearance.addChangeListener` in the store (via `installAppearanceListener`) that mirrors the OS colour scheme onto `resolvedSystemScheme`. `useTokens()` reads this field via an atomic selector instead of installing its own listener, so OS theme changes propagate through one source of truth within a single render cycle (Req 1.8, well under the 500ms budget). The listener is installed at module load for the default singleton and re-installed by `rebindDefaultUIPreferencesStore` when `initializeStores()` swaps in the SQLite-backed store.
    - Wire the store into `initializeStores(db)` so user theme preferences persist across app restarts via the SQLite storage adapter. The `partialize` option excludes `resolvedSystemScheme` (it mirrors the OS and must be re-seeded from `Appearance` on every launch, not replayed from disk).
    - _Requirements: 1.7, 1.8_

  - [x] 1.6A Write unit tests for system theme listener
    - Verify that when `colorScheme === 'system'`, calling the `Appearance` change listener with `'dark'` causes `useTokens()` subscribers to receive the dark token set on the next render
    - Verify that when `colorScheme === 'light'` or `'dark'` (explicit), the `Appearance` listener has no effect on the returned tokens
    - Verify that the listener is unsubscribed when the store is destroyed
    - Verify that `partialize` excludes `resolvedSystemScheme` from persisted state
    - Create test at `src/stores/__tests__/uiPreferencesStore.test.ts`
    - _Requirements: 1.8_

  - [x] 1.5 Write unit tests for Design Token System
    - Verify token module exports correct structure (all required interfaces)
    - Verify all spacing values are multiples of 4
    - Verify `useTokens()` returns light tokens by default and dark tokens when dark mode is active
    - Add dedicated `textOnPrimaryLight` and `textOnPrimaryDark` tokens (separate from `textOnPrimary`) so text rendered on the primary-light / primary-dark shades still meets 4.5:1 contrast. White on `primaryLight` (#E5684C in light mode) only reaches ≈3:1 — the dedicated token routes the correct near-black label.
    - Create test at `src/ui/tokens/__tests__/designTokens.test.ts`
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.7_

- [x] 2. Build the Animation Engine and Micro-Interaction System
  - [x] 2.1 Create the Animation Engine module
    - Create `src/ui/animation/animationEngine.ts` implementing `AnimationConfig`, `SPRING_CONFIG` (damping: 15, stiffness: 150, mass: 1), and `useAnimation()` hook
    - `useAnimation()` must check `useReducedMotion()` from the existing accessibility hooks and return `shouldAnimate`, `springConfig`, and `withMotion` utility
    - When reduced motion is active, `withMotion` must return instant transitions (duration: 0)
    - Create `src/ui/animation/index.ts` barrel export
    - _Requirements: 2.1, 2.5, 2.6_

  - [x] 2.2 Write property test for reduced motion disabling animations (Property 3)
    - **Property 3: Reduced motion disables all animations**
    - Generate random animation configs, set `shouldAnimate = false`, verify resulting animation resolves with duration 0
    - Create test at `src/ui/animation/__tests__/animationEngine.property.test.ts`
    - Required (not optional): this is the only property-based guard for the reduced-motion contract referenced by 10 requirements across the entire spec. Every downstream gesture controller and animated component assumes this contract holds; without the test there is no automated verification that reduced motion is actually honored.
    - **Validates: Requirements 2.5, 3.4, 4.6, 7.5, 8.4, 13.6, 15.5, 16.6, 19.7, 20.8**

  - [x] 2.3 Create the Micro-Interaction System
    - Create `src/ui/animation/microInteractions.ts` implementing `useMicroInteractions()` hook
    - Implement all micro-interaction animations: `eventCreated` (scale-up + fade-in, 300ms), `visibilityToggle` (fade-out/fade-in, 200ms), `pressDown` (scale to 0.97, 100ms), `pressRelease` (spring back to 1.0, 150ms), `eventDeleted` (shrink + fade-out, 250ms), `syncAppear` (slide-in-from-right + fade-in, 300ms), `pullToRefresh` (rotating indicator)
    - All animations must respect reduced motion via the Animation Engine's `shouldAnimate` flag
    - _Requirements: 2.2, 2.3, 7.1, 7.2, 7.3, 7.4, 7.5_

  - [ ]* 2.4 Write unit tests for Micro-Interaction System
    - Verify specific duration values for each animation:
      - Spring-based interactions (`useEventCreatedStyle`, `usePressDownStyle`, `usePressReleaseStyle`, `useEventDeletedStyle`) — assert the target resting value is reached within a tolerance band of the Req-specified duration + 50ms. Springs don't honor exact durations; with the shared config (`damping: 15, stiffness: 150, mass: 1`) a small scale delta (e.g. 1 → 0.97) settles within ≈100–200ms, so a 250ms upper bound comfortably covers Req 7.1 (100ms nominal) and 7.2 (150ms nominal). For `eventDeleted` (scale 1 → 0.8), use a 350ms upper bound to cover Req 7.3 (250ms nominal + 100ms settle slack).
      - Timing-based interactions (`useVisibilityToggleStyle` = 200ms, `useSyncAppearStyle` = 300ms, `usePullToRefreshStyle` settle = 150ms) — assert exact duration values since `withTiming` is deterministic.
    - Verify all animations return instant state changes when reduced motion is active (0ms, not just "fast")
    - Rationale for the tolerance band: Reqs 7.1/7.2/7.3 specify ms ceilings for visual completeness, but Task 2.9 uses springs for these four interactions because springs feel more natural for press/delete/create feedback. The tolerance accommodates spring settling while still catching any animation that is genuinely broken (takes >2× the nominal duration).
    - Create test at `src/ui/animation/__tests__/microInteractions.test.ts`
    - _Requirements: 2.2, 2.3, 7.1, 7.2, 7.3, 7.4, 7.5_

  - [x] 2.5 Add sync-arrival tracking to the events store (syncAppear trigger)
    - Extend `src/stores/eventsStore.ts` state with `recentlyArrivedFromSync: Set<string>` (transient, not persisted)
    - Add action `markArrivedFromSync(ids: string[])` — adds each id to the set and schedules removal after 1000ms via setTimeout so the set does not grow unbounded
    - Export atomic selector `useIsRecentlyArrivedFromSync(eventId)` using `(s) => s.recentlyArrivedFromSync.has(eventId)` pattern for EventCard consumption
    - Wiring location clarification: in this codebase `SyncEngine` writes to SQLite and the TanStack Query layer (`src/query/useEvents.ts`) reads from the provider adapter into the Zustand store. Therefore the `markArrivedFromSync` call goes in `useEvents.ts` immediately after `store.addEvents(events)` — NOT in `src/sync/syncEngine.ts`, which never touches `eventsStore`. (Earlier drafts of this task placed the wiring in `src/sync/`; the correct home is the query layer.)
    - _Requirements: 7.4_

  - [x] 2.5A Diff sync-arrival ids against existing store state before marking
    - **Current bug:** `src/query/useEvents.ts` calls `store.markArrivedFromSync(events.map((e) => e.id))` for every query data change, which fires for cached first-load data and background refetches — not just newly-arrived remote events. This makes EventCards play the `syncAppear` animation on app cold start and on every `staleTime` expiry, which is user-surprising and violates the intent of Req 7.4.
    - Fix: in `useEvents.ts`, before calling `markArrivedFromSync`, compute the delta set: `newIds = events.map((e) => e.id).filter((id) => !storeSnapshot.events[id])` where `storeSnapshot = useEventsStore.getState()` is captured BEFORE calling `store.addEvents(events)`. Only call `markArrivedFromSync(newIds)` when `newIds.length > 0`.
    - Additionally skip the call entirely when this is the initial query settlement after app cold start. Detect this via a module-level `hasSettledOnce = new WeakMap<QueryKey, boolean>()` or via TanStack Query's `query.state.dataUpdateCount === 1`, whichever is simpler to thread through. The intent: suppress `syncAppear` for the very first successful fetch of a given (accountId, range) pair.
    - Also address the nondeterministic-id risk in `defaultTransform`: when `raw.id` is missing, generate a stable id from `(accountId, raw)` content hash instead of `Date.now() + Math.random()`. Unstable ids cause duplicate `addEvents` calls across refetches and re-fire `syncAppear` indefinitely. For the MVP fallback, a hash of `(accountId, raw.title, raw.startTime)` is sufficient; document that callers providing a real `transform` are responsible for stable ids.
    - _Requirements: 7.4_

  - [x] 2.5B Write unit tests for sync-arrival delta diffing
    - Verify that on first successful fetch of a query key, `markArrivedFromSync` is NOT called even though events are added to the store
    - Verify that on a subsequent fetch returning the same event ids, `markArrivedFromSync` is NOT called (no new events arrived)
    - Verify that on a subsequent fetch returning one new event id mixed with existing ids, `markArrivedFromSync` is called with ONLY the new id
    - Verify that events without `raw.id` receive stable ids across refetches (same input produces same id)
    - Create test at `src/query/__tests__/useEvents.syncArrival.test.ts`
    - _Requirements: 7.4_

  - [x] 2.6 Create the account visibility transition hook (visibilityToggle trigger)
    - Create `src/ui/animation/useAccountVisibilityTransition.ts` implementing `useAccountVisibilityTransition(accountId): 'idle' | 'fading-in' | 'fading-out'`
    - Subscribe to `hiddenAccountIds` via atomic selector, store previous value in `useRef`, detect flip edge on each render
    - On flip edge: set transient state ('fading-in' when account becomes visible, 'fading-out' when hidden) that auto-clears to 'idle' after 200ms via setTimeout (matching Req 2.3 duration)
    - When reduced motion is active: always return 'idle' so EventCards re-render without animation
    - Clean up pending timers on unmount
    - _Requirements: 2.3_

  - [x] 2.7 Create the animated event delete hook (eventDeleted trigger)
    - Create `src/ui/animation/useAnimatedEventDelete.ts` implementing `useAnimatedEventDelete(): { deleteWithAnimation: (eventId: string) => Promise<void> }`
    - IMPORTANT: `EventCRUDService.deleteEvent` immediately removes the event from the Zustand store (verified in `src/events/eventCRUDService.ts` — line calling `eventsStore.removeEvent(eventId)`), so we cannot rely on `syncStatus: 'pending_delete'` persisting in the store for the animation. Use a transient tracking set instead (same pattern as `recentlyArrivedFromSync` in Task 2.5)
    - Extend `eventsStore` state with `pendingAnimatedDelete: ReadonlySet<string>` and action `markPendingAnimatedDelete(eventId: string)` / `clearPendingAnimatedDelete(eventId: string)`
    - `deleteWithAnimation(eventId)` flow:
      1. Call `markPendingAnimatedDelete(eventId)` — EventCards observe this and apply the `eventDeleted` animation (shrink + fade)
      2. Wait 250ms (or 0ms when reduced motion is active)
      3. Call `EventCRUDService.deleteEvent(eventId)` — this removes the event from the store, unmounting the EventCard (by which point the animation has completed)
      4. On success, also call `clearPendingAnimatedDelete(eventId)` so the `pendingAnimatedDelete` set does not grow unbounded across the session. (The EventCard is already unmounted by this point, so no re-render is triggered — but leaving entries in the set is a slow memory leak across long-running sessions with many deletes.)
      5. Any error in step 3 triggers `clearPendingAnimatedDelete(eventId)` so the event card returns to normal and an AutoDismissBanner is shown
    - Callers (delete button in EventCard context menu, swipe-to-delete in agenda view) invoke this hook's function instead of calling `EventCRUDService.deleteEvent` directly
    - EventCards read `useEventsStore((s) => s.pendingAnimatedDelete.has(event.id))` via atomic selector and apply the `eventDeleted` style when true
    - _Requirements: 7.3_

  - [x] 2.8 Write unit tests for micro-interaction triggers
    - Verify `markArrivedFromSync` adds ids and clears after 1000ms
    - Verify `useAccountVisibilityTransition` returns 'fading-in'/'fading-out' on flip and auto-clears to 'idle' after 200ms
    - Verify `useAnimatedEventDelete.deleteWithAnimation` calls `markPendingAnimatedDelete(eventId)`, waits 250ms, calls `crudService.deleteEvent(eventId)`, and on success calls `clearPendingAnimatedDelete(eventId)` (Task 2.7 step 4). NOTE: the previous wording in this task said "sets syncStatus to 'pending_delete'" — that was inherited from an earlier design that relied on `syncStatus`. The actual implementation uses the `pendingAnimatedDelete` transient set on `eventsStore`; assert against that set, not against `syncStatus`.
    - Verify `useAnimatedEventDelete.deleteWithAnimation` calls `clearPendingAnimatedDelete(eventId)` on both success and failure paths so the set does not grow unbounded
    - Verify all three triggers degrade to instant/no-op when reduced motion is active
    - Required (not optional): together with Task 2.2 this is the only automated verification of the entire micro-interaction trigger subsystem (Tasks 2.5, 2.6, 2.7). Downstream wiring (Task 18.1) depends on these triggers behaving exactly as specified.
    - Create tests at `src/stores/__tests__/eventsStore.syncArrival.test.ts`, `src/ui/animation/__tests__/useAccountVisibilityTransition.test.ts`, and `src/ui/animation/__tests__/useAnimatedEventDelete.test.ts`
    - _Requirements: 2.3, 7.3, 7.4_

  - [x] 2.9 Align Micro-Interaction System API and motion curves with the design
    - **Problem 1 (API shape — Rules of Hooks):** the current `useMicroInteractions()` returns an object whose fields are themselves sub-hooks (each one calls `useSharedValue` / `useEffect` / `useAnimatedStyle` internally). Consumers that conditionally invoke a returned field — e.g. `transition !== 'idle' ? visibilityToggle(transition) : undefined` — silently violate the Rules of Hooks and will crash after the first flip. The design in `design.md` describes `MicroInteractions` as a flat collection of animation primitives; the nested-hook shape is an implementation-level deviation that makes the API dangerous to consume.
    - Fix: refactor `src/ui/animation/microInteractions.ts` so each animation is exposed as its own top-level hook that owns its shared values:
      - `useEventCreatedStyle(active: boolean): AnimatedStyle<ViewStyle>`
      - `useVisibilityToggleStyle(direction: VisibilityTransitionDirection | 'idle'): AnimatedStyle<ViewStyle>`
      - `usePressDownStyle(active: boolean): AnimatedStyle<ViewStyle>`
      - `usePressReleaseStyle(active: boolean): AnimatedStyle<ViewStyle>`
      - `useEventDeletedStyle(active: boolean): AnimatedStyle<ViewStyle>`
      - `useSyncAppearStyle(active: boolean): AnimatedStyle<ViewStyle>`
      - `usePullToRefreshStyle(isSpinning: boolean): AnimatedStyle<ViewStyle>`
    - Keep `useMicroInteractions()` as a convenience aggregator that simply calls all seven hooks unconditionally and returns the results, so existing call sites in Task 18.1 continue to work — but the flat hooks become the recommended import for any consumer that needs a single animation (which is most of them).
    - **Problem 2 (motion curve drift):** the current implementation uses `withTiming` with a cubic-out easing for every interaction except `pullToRefresh`. Req 2.6 and the design's Key Decision #2 mandate a shared spring config (`damping: 15, stiffness: 150, mass: 1`) for all animations. Using timing curves here means the shared spring config is dead code for the micro-interactions and motion across the app is inconsistent.
    - Fix: for the interactions that are natural-feeling as springs (`eventCreated`, `pressDown`, `pressRelease`, `eventDeleted`), switch to `withSpring(target, SPRING_CONFIG)` via `useAnimation().withMotion`. Keep `withTiming` only for the duration-gated ones where a specific completion time matters (`visibilityToggle` at 200ms, `syncAppear` at 300ms, `pullToRefresh` rotation) — but document the exception explicitly in the file header so the choice is intentional, not accidental.
    - **Problem 3 (`withMotion` return type):** `useAnimation().withMotion` is typed `=> number` but actually returns Reanimated's internal `AnimationObject`. Fix the type to whatever Reanimated exports (commonly `AnimatableValue`), and add a comment explaining the call site must assign the return to a `sharedValue.value`.
    - **Problem 4 (dead chaining-primitives import):** remove the `const _chainingPrimitives = { withDelay, withSequence }; void _chainingPrimitives;` block. If chaining primitives become needed later, re-import them then.
    - _Requirements: 2.2, 2.3, 2.6, 7.1, 7.2, 7.3, 7.4, 7.5_

  - [x] 2.10 Scope the Animation Error Boundary to the Micro-Interaction System consumers
    - Task 10A.1 defines the `AnimationErrorBoundary` for Reanimated worklet crashes. Today, if a worklet in `microInteractions.ts` crashes on web (the Reanimated web shim has known gaps around `useDerivedValue` with template literals and some `withRepeat` modes), the entire EventCard subtree unmounts.
    - Add a cross-reference here so Task 18.1 (EventCard wiring) does not forget to wrap micro-interaction consumers: when Task 10A.1 is implemented, EventCard and the pull-to-refresh indicator MUST be wrapped in `<AnimationErrorBoundary>` so a worklet crash degrades to a non-animated render instead of an empty screen.
    - No implementation is required in Task 2.10 itself — this is a forward-reference constraint that the implementation of Task 10A.1 and Task 18.1 must honor. Kept here so reviewers of Task 2 see the boundary requirement co-located with the code that needs it.
    - _Requirements: 2.1, 2.5_

- [x] 3. Implement pure utility functions (time snapping, coordinate conversion)
  - [x] 3.1 Create time slot utility functions
    - Create `src/ui/calendar/timeSlotUtils.ts` implementing `snapToIncrement`, `yToMinutes`, `minutesToY`, and `TimeSlotPosition` type
    - `snapToIncrement(minutes, 15)` must produce a non-negative multiple of 15 in range [0, 1440)
    - `yToMinutes` and `minutesToY` must be inverse functions for valid inputs
    - _Requirements: 4.2, 12.1, 12.2, 13.2_

  - [x]* 3.2 Write property test for time slot snapping (Property 5)
    - **Property 5: Time slot snapping to 15-minute increments**
    - Generate random Y positions (0–1440px) and hour heights (30–120px), verify snapped minutes are multiples of 15 in [0, 1440)
    - Create test at `src/ui/calendar/__tests__/timeSlotUtils.property.test.ts`
    - **Validates: Requirements 4.2, 12.1, 12.2, 13.2**

  - [x]* 3.3 Write property test for minimum event duration enforcement (Property 6)
    - **Property 6: Minimum event duration enforcement**
    - Generate random start times and drag positions, verify computed end time ≥ start + 15 minutes
    - Create test at `src/ui/calendar/__tests__/timeSlotUtils.property.test.ts`
    - **Validates: Requirements 13.4, 12.7**

- [x] 4. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Implement the Natural Language Parser and Printer
  - [x] 5.0 Verify RecurrenceRule type completeness
    - Verify the existing `RecurrenceRule` type in `unified-calendar-app/src/types/models.ts` has all fields needed by the NL Parser: `frequency`, `interval`, `count`, `until`, `byDay`, `byMonthDay`, `bySetPos`, `wkst`, `exceptions`
    - If any fields are missing, extend the type (the current type already includes all required fields — confirm no drift has occurred)
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5_

  - [x] 5.1 Create the NL Parser module
    - Create `src/nlp/naturalLanguageParser.ts` implementing `parseNaturalLanguage(input, referenceDate?)` pure function
    - Implement `ParsedEvent` interface with title, date, time, duration, location, attendees, recurrence, and confidence fields
    - Implement `confidence.recurrence` as a three-state value `'none' | 'parsed' | 'attempted_unresolved'` (NOT boolean). `'none'` = no recurrence keyword detected; `'parsed'` = keyword detected and frequency resolved; `'attempted_unresolved'` = keyword detected (e.g., "every", "each", "weekly", "monthly", "repeats") but frequency could not be determined. This is the signal the Quick Create Bar uses to trigger the EventEditor fallback per Req 17.8.
    - Export a `RecurrenceParseState` type alias for the three-state value
    - Support date references: "today", "tomorrow", "next Monday"–"next Sunday", "January 15", "in 3 days"
    - Support time expressions: "at noon", "at 3pm", "at 15:00", "morning" (9:00), "afternoon" (14:00), "evening" (18:00)
    - Support duration expressions: "for 30 minutes", "for 1 hour", "for 2 hours", "for 1.5 hours"; default 60 minutes
    - Extract location from "at <location>" phrases after time expression
    - Extract attendee names from "with <name>" phrases
    - Create `src/nlp/index.ts` barrel export
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 17.8_

  - [x] 5.2 Create the NL Printer module
    - Create `src/nlp/naturalLanguagePrinter.ts` implementing `printEvent(event: ParsedEvent)` pure function
    - Convert a structured ParsedEvent back into a human-readable natural language string
    - Ensure round-trip property: `parseNaturalLanguage(printEvent(parsedEvent))` produces an equivalent ParsedEvent
    - _Requirements: 5.9, 5.10_

  - [ ]* 5.3 Write property test for NL field extraction (Property 7)
    - **Property 7: NL Parser extracts fields from valid natural language input**
    - Generate random NL input strings with known title, date, time, duration, location, and attendee components, verify all fields extracted correctly
    - Create test at `src/nlp/__tests__/naturalLanguageParser.property.test.ts`
    - **Validates: Requirements 5.2, 5.3, 5.4, 5.5, 5.6, 5.7**

  - [ ]* 5.4 Write property test for NL Parser/Printer round-trip (Property 8)
    - **Property 8: NL Parser/Printer round-trip**
    - Generate random `ParsedEvent` objects with all confidence flags true, verify `parseNaturalLanguage(printEvent(event))` produces equivalent event
    - Create test at `src/nlp/__tests__/naturalLanguageParser.property.test.ts`
    - **Validates: Requirements 5.10**

  - [ ]* 5.5 Write unit tests for NL Parser edge cases
    - Test empty string, whitespace only, no time expression, ambiguous "at" (time vs location), multiple "with" phrases, missing date
    - Verify fallback behavior: when date or time cannot be determined, confidence flags are false
    - Create test at `src/nlp/__tests__/naturalLanguageParser.test.ts`
    - _Requirements: 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8_

- [x] 6. Implement the Recurrence NL Parser and Printer
  - [x] 6.1 Create the Recurrence NL Parser module
    - Create `src/nlp/recurrenceParser.ts` implementing `parseRecurrence(input)` pure function
    - Support: "every day" (DAILY), "every weekday" (WEEKLY;BYDAY=MO,TU,WE,TH,FR), "every week" (WEEKLY), "every 2 weeks" (WEEKLY;INTERVAL=2), "every month" (MONTHLY), "every year" (YEARLY)
    - Support day-specific: "every Monday" (WEEKLY;BYDAY=MO), "every Tuesday and Thursday" (WEEKLY;BYDAY=TU,TH)
    - Support interval-based: "every N days/weeks/months" with INTERVAL=N
    - Support ordinal monthly: "every first Monday of the month" (MONTHLY;BYDAY=1MO), "every last Friday" (MONTHLY;BYDAY=-1FR)
    - Return `RecurrenceRule | null` (null if not recognized)
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5_

  - [x] 6.2 Create the Recurrence NL Printer module
    - Create `src/nlp/recurrencePrinter.ts` implementing `printRecurrence(rule: RecurrenceRule)` pure function
    - Convert a structured RecurrenceRule back into a human-readable recurrence expression string
    - Ensure round-trip property: `parseRecurrence(printRecurrence(rule))` produces an equivalent RecurrenceRule
    - _Requirements: 17.6, 17.7_

  - [x] 6.3 Integrate recurrence parsing into the NL Parser
    - Update `parseNaturalLanguage` to detect recurrence keywords and delegate to `parseRecurrence`
    - When a recurrence keyword is detected AND `parseRecurrence` returns a non-null RecurrenceRule: set `ParsedEvent.recurrence` to the rule and `confidence.recurrence = 'parsed'`
    - When a recurrence keyword is detected BUT `parseRecurrence` returns null: set `ParsedEvent.recurrence = null` and `confidence.recurrence = 'attempted_unresolved'` (Req 17.8 — triggers EventEditor fallback with recurrence section highlighted)
    - When no recurrence keyword is detected at all: set `ParsedEvent.recurrence = null` and `confidence.recurrence = 'none'`
    - Recurrence keyword set for detection: "every", "each", "weekly", "biweekly", "monthly", "yearly", "annually", "daily", "repeats"
    - _Requirements: 17.1, 17.8_

  - [ ]* 6.4 Write property test for recurrence NL parsing (Property 15)
    - **Property 15: Recurrence NL parsing produces valid RRULEs**
    - Generate random supported recurrence expressions, verify parsed RRULE has correct frequency/interval/byDay
    - Create test at `src/nlp/__tests__/recurrenceParser.property.test.ts`
    - **Validates: Requirements 17.1, 17.2, 17.3, 17.4, 17.5**

  - [ ]* 6.5 Write property test for recurrence round-trip (Property 16)
    - **Property 16: Recurrence NL Parser/Printer round-trip**
    - Generate random valid RecurrenceRules, verify `parseRecurrence(printRecurrence(rule))` produces equivalent rule
    - Create test at `src/nlp/__tests__/recurrenceParser.property.test.ts`
    - **Validates: Requirements 17.7**

  - [ ]* 6.6 Write unit tests for Recurrence Parser edge cases
    - Test "every" without frequency, invalid ordinals, "every 0 days", unrecognized patterns
    - Verify null return for unrecognized patterns
    - Create test at `src/nlp/__tests__/recurrenceParser.test.ts`
    - _Requirements: 17.1, 17.2, 17.3, 17.4, 17.5, 17.8_

- [x] 7. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.


- [x] 8. Implement the Haptic Feedback Engine
  - [x] 8.1 Create the Haptic Feedback Engine module
    - Create `src/ui/haptics/hapticEngine.ts` implementing `createHapticEngine()` and `useHaptics()` hook
    - Map patterns: light → ImpactFeedbackStyle.Light, medium → ImpactFeedbackStyle.Medium, heavy → ImpactFeedbackStyle.Heavy, selection → SelectionFeedback, success → two sequential Light impacts with 100ms gap
    - Fall back to no-op on web (`Platform.OS === 'web'`) and when OS haptics are disabled
    - Create `src/ui/haptics/index.ts` barrel export
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6_

  - [x]* 8.2 Write unit tests for Haptic Feedback Engine
    - Verify correct expo-haptics API calls for each pattern (light, medium, heavy, selection, success)
    - For `success`, explicitly verify the pattern is two sequential `Haptics.impactAsync(ImpactFeedbackStyle.Light)` calls with a 100ms gap between them — NOT a single `NotificationFeedbackType.Success` call. This is the non-obvious implementation detail required by Req 14.3's "two short light pulses" description.
    - Verify no-op behavior on web platform
    - Verify no-op when OS haptics are disabled
    - Create test at `src/ui/haptics/__tests__/hapticEngine.test.ts`
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 14.6_

- [x] 9. Implement Gesture Controllers
  - [x] 9.1 Create the Gesture Context Store
    - Create `src/stores/gestureContextStore.ts` using `createStore` from `zustand/vanilla` (same pattern as existing `syncStatusStore`)
    - Implement `GestureContext` state with `isDragActive`, `activeGesture`, `setActiveGesture`, and `clearActiveGesture`
    - Export `gestureContextStore` (vanilla) and `useGestureContext()` React hook
    - _Requirements: 15.6_

  - [x] 9.1A Create the Conflict Check Adapter
    - Create `src/ui/gestures/useConflictCheckAdapter.ts` implementing the `useConflictCheckAdapter(allEvents)` hook
    - Wrap the existing `ConflictDetector` from `src/conflicts/conflictDetector.ts` — use only the synchronous `detectConflicts(event, allEvents)` method (NOT `detectConflictsWithTravel`, which does async travel-time estimation and is unsafe to call on every frame of a pan gesture)
    - Construct a synthetic `CalendarEvent` from the drag's `proposedStart`/`proposedEnd`/`eventId`/`calendarAccountId` fields, invoke `detectConflicts`, then filter out any conflict whose `conflictingEventId` matches the dragged `eventId` (a drag must not conflict with itself)
    - Return a `ConflictCheckAdapter` with a stable `check(eventId, proposedStart, proposedEnd, calendarAccountId)` method suitable for passing to `useDragReschedule({ onConflictCheck })` and `useDragResize({ onConflictCheck })`
    - For event arrays larger than 200 items, pre-index by day bucket on first call and re-index only when `allEvents` reference changes (memoize via `useMemo`)
    - _Requirements: 4.4, 13.5_

  - [x] 9.1B Create the Conflict Indicator Overlay component
    - Create `src/ui/calendar/ConflictIndicatorOverlay.tsx` implementing the overlay rendered during drag-to-reschedule and drag-to-resize when the proposed time range conflicts
    - Props: `visible: boolean`, `proposedRect: {x,y,width,height}`, `overlapSlice?: {startY,endY}`, `conflictCount: number`
    - Absolutely-positioned overlay with `pointerEvents="none"` so drag gestures pass through
    - Styling: background `tokens.colors.warning` at 0.25 opacity, 2px solid `tokens.colors.warning` border, border radius matches EventCard (`tokens.radii.md`). On web: diagonal hatch pattern via `repeating-linear-gradient` CSS. On native: solid color with 0.25 opacity (no hatch).
    - Entrance/exit animation: fade 100ms via Animation Engine's `withMotion`. Reduced motion: instant show/hide
    - Accessibility: `role="img"`, `accessibilityLabel="Conflict with N existing event(s)"` where N is `conflictCount`
    - Parent gesture controllers (Tasks 9.2, 9.4) announce conflict state transitions via `useScreenReaderAnnouncement('polite')` on first entry into conflict ("Conflicts with N event(s)") and on exit ("No conflict") — NOT on every frame
    - _Requirements: 4.4, 13.5_

  - [ ]* 9.1C Write unit tests for Conflict Check Adapter
    - Verify that a proposed time range overlapping another event returns `hasConflict: true` with the correct `conflictingEventIds`
    - Verify that a proposed time range identical to the dragged event's current time does NOT conflict with itself (self-filter works)
    - Verify that `detectConflictsWithTravel` is never called (only synchronous `detectConflicts` is used)
    - Create test at `src/ui/gestures/__tests__/useConflictCheckAdapter.test.ts`
    - _Requirements: 4.4, 13.5_

  - [x] 9.2 Create the Drag Reschedule Controller
    - Create `src/ui/gestures/useDragReschedule.ts` implementing the `useDragReschedule(config)` hook
    - Compose LongPress (300ms) + Pan gesture from react-native-gesture-handler
    - Implement lift animation (scale 1.03, elevation increase), time indicator snapping to 15-minute increments
    - Implement cross-day drag in week view: detect day column from horizontal translation, compute proposed date from `visibleDayDates`
    - On drop inside valid grid: persist via `onReschedule` callback within 200ms, trigger light haptic
    - On drop outside valid grid: spring back to original position, no callback invoked
    - On drag activation: trigger medium haptic, set gesture context to 'reschedule'
    - On drag release: clear gesture context
    - Reduced motion: border highlight only, no scale/elevation animation
    - Implement conflict detection via `onConflictCheck` callback during drag
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 14.1, 14.2_

  - [ ]* 9.3 Write property test for drag outside valid grid (Property 18)
    - **Property 18: Drag outside valid grid springs back without rescheduling**
    - Generate random drag end positions outside the valid grid area, verify `onReschedule` is never called
    - Create test at `src/ui/gestures/__tests__/useDragReschedule.property.test.ts`
    - **Validates: Requirements 4.5**

  - [x] 9.4 Create the Drag Resize Controller
    - Create `src/ui/gestures/useDragResize.ts` implementing the `useDragResize(config)` hook
    - Activate on press within bottom 8px of Event_Card
    - Snap to 15-minute increments, enforce minimum 15-minute duration
    - Trigger selection haptic at each snap point via `onSnapHaptic` callback
    - On release: persist via `onResize` callback within 200ms
    - Implement conflict detection via `onConflictCheck` callback
    - Reduced motion: static border highlight instead of animated handle
    - On activation: set gesture context to 'resize'; on release: clear gesture context
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 14.4_

  - [x] 9.5 Create the Swipe Navigation Controller
    - Create `src/ui/gestures/useSwipeNavigation.ts` implementing the `useSwipeNavigation(config)` hook
    - Require minimum 50px horizontal distance and horizontal velocity > vertical velocity
    - Animate current view sliding out and incoming view sliding in (300ms)
    - Read `suppressSwipe` from gesture context store to prevent conflicts with drag operations
    - Reduced motion: instant view switch, no slide animation
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6_

  - [ ]* 9.6 Write property test for swipe gesture discrimination (Property 12)
    - **Property 12: Swipe gesture discrimination**
    - Generate random (dx, dy) pairs, verify swipe triggers iff |dx| ≥ 50 and |dx| > |dy|
    - Create test at `src/ui/gestures/__tests__/useSwipeNavigation.property.test.ts`
    - **Validates: Requirements 15.3**

  - [ ]* 9.7 Write property test for swipe suppression during drag (Property 13)
    - **Property 13: Swipe navigation suppressed during drag operations**
    - Generate random valid swipe gestures, set isDragActive = true, verify navigation callback not called
    - Create test at `src/ui/gestures/__tests__/useSwipeNavigation.property.test.ts`
    - **Validates: Requirements 15.6**

  - [x] 9.8 Create the Pull-to-Refresh Controller
    - Create `src/ui/gestures/usePullToRefresh.ts` implementing the `usePullToRefresh(config)` hook
    - Trigger sync when pull distance ≥ 80px
    - Show rotating indicator during sync, fade-out on completion (200ms)
    - Ignore additional pulls while sync in progress
    - Create `src/ui/gestures/AutoDismissBanner.tsx` implementing the auto-dismiss error banner (3s display, then fade-out)
    - Implement `useAutoDismiss` hook for timer management
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5_

  - [ ]* 9.9 Write property test for pull-to-refresh sync lock (Property 10)
    - **Property 10: Pull-to-refresh sync lock**
    - Generate random sequences of pull gestures with isSyncing states, verify sync call count matches non-syncing pulls
    - Create test at `src/ui/gestures/__tests__/usePullToRefresh.property.test.ts`
    - **Validates: Requirements 9.5**

  - [x] 9.10 Create the Inline Event Creator Controller
    - Create `src/ui/gestures/useInlineEventCreator.ts` implementing the `useInlineEventCreator(config)` hook
    - Single click: create 15-min event at clicked slot (snapped to 15-min increments)
    - Click+drag: create event spanning drag range
    - Show highlighted overlay during drag, inline popover with title input on release
    - Enter: create event. Escape/click-outside: dismiss popover
    - Minimum event duration of 15 minutes for single click
    - _Requirements: 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7_

  - [x] 9.11 Wire screen-reader announcements for drag conflict transitions
    - **Drift identified:** Task 9.1B requires the parent gesture controllers (9.2 and 9.4) to announce conflict state transitions via `useScreenReaderAnnouncement('polite')` on first entry into conflict and on exit — NOT on every frame. The current implementations of `useDragReschedule` and `useDragResize` never import `useScreenReaderAnnouncement`, never track the previous `hasConflict` value, and never call `announce()`. The `accessibilityLabel` on `<ConflictIndicatorOverlay>` alone is insufficient because the overlay has `pointerEvents="none"` and is therefore never focusable, so assistive tech never reads it.
    - Fix in `src/ui/gestures/useDragReschedule.ts`:
      - Import `useScreenReaderAnnouncement` from `../accessibility/useAccessibility`
      - Add a `useRef<boolean>(false)` tracking the previous `hasConflict` state
      - In the existing `handleSnapChange` JS-thread callback, after computing `conflictResult.hasConflict`, compare against the ref; when the edge flips `false → true` call `announce(\`Conflicts with ${conflictResult.conflictingEventIds.length} event(s)\`, 'polite')`; when the edge flips `true → false` call `announce('No conflict', 'polite')`
      - Reset the ref to `false` on gesture end (both success and spring-back paths) so the next drag starts clean
    - Apply the same pattern in `src/ui/gestures/useDragResize.ts` using the `handleSnapChange` callback there
    - Use the exact phrasing from `buildConflictAccessibilityLabel` in `src/ui/calendar/ConflictIndicatorOverlay.tsx` so the overlay's label and the live-region announcement match (singular/plural grammar already handled by the helper — consider exporting and reusing it)
    - _Requirements: 4.4, 13.5_

  - [x] 9.12 Reconcile the `onConflictCheck` signature mismatch between adapter and drag controllers
    - **Drift identified:** `useConflictCheckAdapter.check(eventId, proposedStart, proposedEnd, calendarAccountId)` takes four arguments per the design doc, but `DragRescheduleConfig.onConflictCheck` and `DragResizeConfig.onConflictCheck` are typed as `(eventId, start, end) => ConflictCheckResult` (three arguments). Callers wiring the adapter to a drag controller must bind `calendarAccountId` via closure, and if they forget, the drag controller will silently pass three arguments to a function that expects four — TypeScript will not catch this because the callback type is narrower than the adapter's `check` signature.
    - Note on functional impact: the existing `ConflictDetector.detectConflicts` in `src/conflicts/conflictDetector.ts` does NOT filter by `calendarAccountId` (it only filters self-conflict via `id` and checks time overlap), so the missing argument does not produce an incorrect conflict result today. This is API-hygiene drift, not a behaviour bug. The fix is still required because future conflict-detector revisions may start filtering by account, and because the design-doc contract should match the implementation.
    - Fix option A (preferred — aligns both types with the design doc):
      - Extend `DragRescheduleConfig.onConflictCheck` and `DragResizeConfig.onConflictCheck` to `(eventId, start, end, calendarAccountId) => ConflictCheckResult`
      - Extend `DragRescheduleActiveEvent` and `DragResizeActiveEvent` with a required `calendarAccountId: string` field
      - In the controllers' `handleSnapChange` and `handleDrop`/`handleCommit` JS callbacks, forward `activeEvent.calendarAccountId` to `config.onConflictCheck(...)`
    - Fix option B (defer to caller — simpler, but less safe):
      - Leave the controller callback signature unchanged
      - Update the adapter docblock in `src/ui/gestures/useConflictCheckAdapter.ts` to document that callers are expected to bind `calendarAccountId` via closure, e.g. `onConflictCheck: (id, s, e) => adapter.check(id, s, e, event.calendarAccountId)`
      - Add an integration-guide note to Task 18.1 so EventCard wiring remembers to bind
    - Recommended: option A. Update the design doc §"Drag Reschedule Controller" and §"Drag Resize Controller" interface snippets to match.
    - _Requirements: 4.4, 13.5_

  - [x] 9.13 Refactor `usePullToRefresh` to compose the canonical `usePullToRefreshStyle` from the Micro-Interaction System
    - **Drift identified:** `src/ui/gestures/usePullToRefresh.ts` rolls its own rotation loop (`useSharedValue('rotation')` + `withRepeat(withTiming(360, 900ms))` + `useDerivedValue` for the `deg` template), duplicating the motion logic already implemented in `src/ui/animation/microInteractions.ts :: usePullToRefreshStyle`. Key Decision #2 of design.md (shared spring/timing config across the whole app) is violated — two modules define the same 900ms rotation and 200ms fade-out independently.
    - Fix:
      - In `usePullToRefresh.ts`, call `usePullToRefreshStyle(isRefreshing || config.isSyncing)` from the Micro-Interaction System and compose its returned style with the pull-translation + fade-in/out logic that IS unique to this hook (indicator follows the finger during the pull, fades on sync-start / sync-complete)
      - Remove the local `rotation` / `rotateDeg` shared values and the local `ROTATION_PERIOD_MS` constant — they become dead code
      - Keep `opacity` and `translationY` shared values locally since they are pull-specific (not rotation-specific)
      - The returned `indicatorStyle` should now compose three transforms: `translateY` (pull), `rotate` (from `usePullToRefreshStyle`), plus `opacity`
    - Cross-check that `DURATION_PULL_TO_REFRESH_ROTATION` in `microInteractions.ts` still equals 900ms and `DURATION_PULL_TO_REFRESH_SETTLE` still equals 150ms — if they drift in a future Micro-Interaction tuning pass, this hook will pick up the new values automatically, which is the intent.
    - _Requirements: 9.2, 9.3, 2.6_

  - [x] 9.14 Fix spurious activation-frame snap haptic in `useDragResize`
    - **Drift identified:** The docblock of `useDragResize` claims the first snap at gesture activation does NOT trigger a spurious haptic because `lastSnappedEndMinutes` is seeded to `initialEndMinutes`. However, `initialEndMinutes` is computed via `dateToMinutesOfDay(activeEvent.endTime)` (no snap), while `.onUpdate` compares against `snapToIncrement(rawEndMin, snapIncrement)`. If the event's existing end time is not on a 15-minute grid line (e.g. 10:07, 14:23), the very first `.onUpdate` frame computes a snapped value different from the seeded unsnapped value, and `runOnJS(triggerSnapHaptic)()` fires before the user has moved a meaningful distance. Req 14.4 says snap haptics fire "at each 15-minute snap point during the drag" — the activation frame is not one of those.
    - Fix in `src/ui/gestures/useDragResize.ts` `.onStart`:
      - Seed `lastSnappedEndMinutes.value` with `snapToIncrement(initialEndMinutes, snapIncrement)` — the SAME snap function used in `.onUpdate`, not the raw end time
      - Also seed `proposedEndMinutes.value` with the snapped value so the first-frame conflict check runs against the correctly-snapped proposed end
    - Verify the fix does NOT produce a spurious haptic for events whose end time IS already on a grid line (seeded and computed values match, no edge crossing, no haptic fires)
    - _Requirements: 14.4_

  - [x] 9.15 Remove dead-code branch in `useDragResize.onEnd` or make it reachable
    - **Drift identified:** The `.onEnd` worklet in `useDragResize` has a branch `if (snappedEndMin >= minEndMin)` with an `else` that springs back to the original height. Given that `.onUpdate` already clamps `snappedEndMin` via `clamp(snappedRaw, minEndMin, maxEndMin)`, the worklet-shared `proposedEndMinutes.value` read by `.onEnd` can never be below `minEndMin`. The else branch is unreachable.
    - Fix option A (preferred — align with Req 13.4 clamp-at-minimum semantics):
      - Remove the unreachable else branch
      - Update the comment above the `if` to say "minimum duration is already enforced by `.onUpdate`'s clamp; `.onEnd` always commits"
    - Fix option B (if the spec reviewer decides "release below 15-min minimum reverts to original" is the desired UX rather than "clamp at 15-min minimum"):
      - Remove the `minEndMin` clamp in `.onUpdate` so the user can drag above the start line
      - Keep the `.onEnd` else branch and update its comment to reflect that releases below minimum revert completely
      - Note: this changes the behaviour of the minimum-duration guarantee during the live drag, so Req 13.4 should be re-read to decide which interpretation is correct
    - Recommended: option A. The acceptance criteria says "preventing the user from dragging the bottom edge above the 15-minute mark" which reads as a live clamp, matching the current `.onUpdate` behaviour.
    - _Requirements: 13.4_

  - [x] 9.16 Route hard-coded literal strings in `useInlineEventCreator` through `i18nService`
    - **Drift identified:** `useInlineEventCreator.ts` falls back to the hard-coded literal `'New Event'` when the popover is submitted with an empty title. The project's existing `src/i18n/i18nService.ts` owns all user-facing strings. A hard-coded literal here will not translate and will not match the project's i18n pattern.
    - Additionally, Req 12.5 ("WHEN the user submits the inline popover ... THE Inline_Event_Creator SHALL create the event via the existing event creation flow") does not authorize an empty-title fallback. A stricter reading would reject empty submissions and leave the popover open.
    - Fix:
      - Remove the `'New Event'` default-title fallback; instead, treat an empty / whitespace-only title as a submission error (do NOT call `onCreate`, keep the popover open, and let the consumer surface a validation hint)
      - OR if the empty-title fallback is UX-required, move the literal to `src/i18n/locales/en.ts` under a new key like `inlineEventCreator.defaultTitle` and resolve it via `i18nService.t(...)` at submit time
    - Decide with the user which option is correct before implementing; the design doc §"Inline Event Creator" is silent on empty submissions.
    - _Requirements: 12.5_

  - [x] 9.17 Guard `useInlineEventCreator.onSlotDragMove` against being called while the popover is open
    - **Drift identified:** `onSlotDragMove` only guards against "drag never started" via null refs — it does NOT check `state.isPopoverVisible`. If a consumer wires the handlers to a gesture that keeps firing after the popover mounts (e.g., a pan gesture that doesn't cancel on popover open, or a misconfigured `Exclusive` composition), the highlighted overlay will silently move while the user is typing in the popover.
    - Fix:
      - Add an early return in `onSlotDragMove` when `state.isPopoverVisible === true` (use a ref so the check is stable across renders without re-creating the callback identity every render)
      - Same defensive guard should apply in `onSlotDragEnd` for symmetry — a drag-end that fires while the popover is open should not re-finalise the selection
    - _Requirements: 12.3, 12.4_

  - [x] 9.18 Add unit-test coverage for the three most logic-dense hooks in Task 9
    - **Drift identified:** Task 9 is marked complete but `src/ui/gestures/__tests__/` contains only `useAutoDismiss.test.ts` and a single-helper test in `useDragReschedule.test.ts`. The following hooks have substantial pure JS logic that is trivial to test without a Reanimated runtime, yet have zero coverage. Downstream Task 18 integration will break silently when these hooks' pure paths regress.
    - Add `src/ui/gestures/__tests__/useInlineEventCreator.test.ts` covering:
      - Single-tap creates a 15-minute selection snapped to the nearest grid line (tests `onSlotPress`)
      - Click-drag downward populates `selectedEnd` with the snapped drag position (tests `onSlotDragStart` → `onSlotDragMove` → `onSlotDragEnd`)
      - Click-drag upward (negative direction) swaps start/end on release (tests the `Math.min`/`Math.max` normalisation)
      - Release less than 15 minutes from start extends the end to start + 15 (tests the minimum-duration clamp)
      - Release at 23:55 on a 20-min selection pulls the start backward (tests the end-of-day ceiling clamp)
      - `onPopoverSubmit` with a non-empty title calls `onCreate(start, end, trimmedTitle)` and resets state to idle
      - `onPopoverDismiss` resets state to idle without calling `onCreate`
      - `onCreate` rejection leaves state in idle (promise rejection does not trap the user in the popover)
    - Add `src/ui/gestures/__tests__/useDragResize.test.ts` covering the pure helpers — the clamp and `buildProposedEnd` helpers ARE worklet-friendly pure functions: extract them into a sibling `dragResizeMath.ts` (mirror of `dragRescheduleMath.ts`) if needed, then test:
      - `dateToMinutesOfDay` returns correct minutes for various Dates (including midnight and near-DST)
      - `buildProposedEnd` preserves the start date's Y-M-D and applies the proposed end's H-M
      - `buildProposedEnd` rolls the end forward by one day when the naive computation produces an end ≤ start (DST rollback case)
    - Add `src/ui/gestures/__tests__/usePullToRefresh.test.ts` covering the JS-side state machine (timers, `startSync`, sync-lock, error string propagation):
      - First sync sets `isRefreshing: true`, calls `onSync`, resolves → sets `isRefreshing: false`, clears `error`
      - `onSync` rejection sets `error` to the rejection message (Error instance, plain string, and unknown value — three paths in `.catch`)
      - Successful sync AFTER a failed sync clears `error` to null (existing behaviour, lock in via test)
      - Calling `startSync` while `isRefreshing: true` is a no-op (defensive JS-side sync lock)
      - Calling `startSync` while `config.isSyncing: true` is a no-op (caller-owned sync lock)
    - Follow the `useAutoDismiss.test.ts` pattern: `@jest-environment jsdom`, a minimal `renderHook` helper backed by `react-dom/client`, `jest.useFakeTimers()` for the timer paths.
    - _Requirements: 9.1, 9.4, 9.5, 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7, 13.1, 13.2, 13.3, 13.4, 13.7_

  - [x] 9.19 Add unit-test coverage for `ConflictIndicatorOverlay`
    - **Drift identified:** Task 9.1B delivered the overlay component with accessibility labelling, web-specific hatch pattern, `overlapSlice` support, and fade-in/out animation — none of which are covered by a test. The exported `buildConflictAccessibilityLabel` helper in particular is already designed for testability but has no test.
    - Add `src/ui/calendar/__tests__/ConflictIndicatorOverlay.test.tsx` covering:
      - `buildConflictAccessibilityLabel(0)` → `"Conflict with 0 existing events"` (pluralisation edge case)
      - `buildConflictAccessibilityLabel(1)` → `"Conflict with 1 existing event"` (singular)
      - `buildConflictAccessibilityLabel(2)` → `"Conflict with 2 existing events"` (plural)
      - `buildConflictAccessibilityLabel(-1)` and `buildConflictAccessibilityLabel(1.7)` — verify `Math.max(0, Math.floor(...))` guards against bad input
      - Render the component with `visible: true` and verify the `accessibilityLabel` prop and `testID="conflict-indicator-overlay"` are present on the root `<Animated.View>`
      - Render the component with `overlapSlice: undefined` vs a concrete slice and verify the slice-height computation produces a positive number (use a testing-library render or a minimal render + prop inspection; skip the animation assertions since Reanimated is stubbed in tests)
    - _Requirements: 4.4, 13.5_

  - [x] 9.20 Document the pull-to-refresh error-banner integration expectation so Task 18.2 wires it
    - **Drift identified:** Task 9.8 bundles `AutoDismissBanner.tsx` with `usePullToRefresh.ts`, but `usePullToRefresh` only exposes an `error: string | null` field — it does NOT render or mount the banner. The banner is functionally orphaned until Task 18.2 wires it. A reviewer reading "Task 9.8 covers Req 9.4" will not realise the sync-error UX is still a TODO.
    - Fix (documentation-only, no code change in Task 9):
      - Update the `usePullToRefresh` docblock in `src/ui/gestures/usePullToRefresh.ts` to add a "Caller is responsible for" section that explicitly says: "Mount `<AutoDismissBanner message={error} />` inside the scrollable view root. Without this, sync failures are silently swallowed (no Req 9.4 UX)."
      - Add an integration-guide sub-bullet to Task 18.2's existing "Integrate `usePullToRefresh` into all scrollable calendar views" line: "... AND mount `<AutoDismissBanner message={error} />` at the top of each view's layout so sync failures surface per Req 9.4"
    - _Requirements: 9.4_

- [x] 10. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 10A. Implement error handling for gestures and animations
  - [x] 10A.1 Create an error boundary component for Reanimated worklet crashes
    - Create `src/ui/animation/AnimationErrorBoundary.tsx` implementing a React error boundary that catches Reanimated worklet crashes
    - On error: fall back to non-animated rendering (pass `shouldAnimate: false` to children via context), log the error
    - Wrap all animated calendar view sections with this boundary
    - _Requirements: 2.1, 2.5_

  - [x] 10A.2 Add error handling to drag-to-reschedule persist failures
    - In `useDragReschedule`, wrap the `onReschedule` callback in a try/catch
    - On persist failure: revert the event to its original position via spring-back animation, display an `AutoDismissBanner` with message "Couldn't reschedule — try again."
    - _Requirements: 4.3, 4.7_

  - [x] 10A.3 Add error handling to drag-to-resize persist failures
    - In `useDragResize`, wrap the `onResize` callback in a try/catch
    - On persist failure: revert the event to its original end time, display an `AutoDismissBanner` with message "Couldn't resize — try again."
    - _Requirements: 13.3, 13.7_

  - [x] 10A.4 Add error handling to inline event creation failures
    - In `useInlineEventCreator`, wrap the `onCreate` callback in a try/catch
    - On failure: dismiss the popover, display an `AutoDismissBanner` with message "Couldn't create event."
    - _Requirements: 12.5_

  - [x] 10A.5 Add gesture handler availability detection with TouchableOpacity fallback
    - Create `src/ui/gestures/gestureAvailability.ts` implementing a `useGestureAvailability()` hook
    - Detect whether `react-native-gesture-handler` is available at runtime
    - When unavailable: export a flag that gesture-dependent components read to fall back to `TouchableOpacity`-based interactions, disabling drag features gracefully
    - _Requirements: 4.1, 13.1, 15.1_

  - [ ]* 10A.6 Write unit tests for error handling
    - Test AnimationErrorBoundary catches worklet errors and renders fallback
    - Test drag-reschedule revert on persist failure
    - Test drag-resize revert on persist failure
    - Test inline event creation error banner on failure
    - Test gesture availability detection returns correct fallback flag
    - Create tests at `src/ui/animation/__tests__/AnimationErrorBoundary.test.ts` and `src/ui/gestures/__tests__/errorHandling.test.ts`
    - _Requirements: 4.3, 4.7, 12.5, 13.3, 13.7_

- [x] 11. Implement View Transition and UI Components
  - [x] 11.1 Create the View Transition Animator
    - Create `src/ui/animation/ViewTransitionAnimator.tsx` implementing crossfade + horizontal slide transitions between view modes
    - Complete each transition within 350ms
    - Implement zoom-in transition for Month_View day tap → Day_View via `useZoomTransition` hook
    - Ignore additional view switch requests while a transition is in progress
    - Reduced motion: skip all transition animations, display target view immediately
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

  - [x] 11.1A Create the Swipe Navigation Host
    - Create `src/ui/gestures/SwipeNavigationHost.tsx` implementing the double-buffer wrapper that renders the current and incoming views so the slide animation from `useSwipeNavigation` is visible (Req 15.4)
    - Props match the design's `SwipeNavigationHostProps`: `anchorDate`, `renderView(anchorDate)`, `onNavigateForward`, `onNavigateBack`, `unit: 'day' | 'week' | 'month'`
    - Render three absolutely-positioned layers (previous at -100% offset, current at 0, next at +100%), apply `animatedStyle` from `useSwipeNavigation` to the current layer and `incomingStyle` to whichever neighbor matches the swipe direction (other neighbor uses opacity 0)
    - On swipe commit, call the appropriate navigation callback, reset animated values so the newly-committed view becomes the current layer
    - Unmount the outgoing view once the slide completes so screen readers see only the final view in the accessibility tree
    - Reduced motion: skip slide animation, fire callback synchronously on swipe detection, re-render with new `anchorDate`
    - Read `suppressSwipe` from `useGestureContext()` and pass to `useSwipeNavigation` config (suppresses swipe when a drag-to-reschedule or drag-to-resize is active)
    - _Requirements: 15.1, 15.2, 15.3, 15.4, 15.5, 15.6_

  - [ ]* 11.2 Write property test for view transition lock (Property 4)
    - **Property 4: View transition lock prevents concurrent transitions**
    - Generate random sequences of view switch requests with timing, verify only non-overlapping transitions execute
    - Create test at `src/ui/animation/__tests__/ViewTransitionAnimator.property.test.ts`
    - **Validates: Requirements 3.5**

  - [x] 11.3 Create the Animated View Mode Switcher
    - Create `src/ui/calendar/AnimatedViewModeSwitcher.tsx` enhancing the existing `ViewModeSwitcher` with a sliding indicator
    - Indicator moves via spring animation (250ms) using Design_Token_System colors
    - Reduced motion: instant indicator position change
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

  - [x] 11.4 Create the Current Time Indicator component
    - Create `src/ui/calendar/CurrentTimeIndicator.tsx` implementing the horizontal "now" line
    - Style with Design_Token_System primary accent color and circular dot at left edge
    - Update position every 60 seconds via setInterval without full re-render
    - Only visible when `isCurrentDay` is true (for week view column filtering)
    - _Requirements: 10.1, 10.2, 10.3_

  - [ ]* 11.5 Write unit tests for Current Time Indicator
    - Verify position calculation based on hourHeight and current time
    - Verify 60-second update interval
    - Verify current-day-only rendering in week view
    - Create test at `src/ui/calendar/__tests__/CurrentTimeIndicator.test.ts`
    - _Requirements: 10.1, 10.2, 10.3_

  - [x] 11.6 Create the Inline Event Popover component
    - Create `src/ui/calendar/InlineEventPopover.tsx` implementing the compact popover for click-to-create
    - Auto-focus title input on mount, display formatted start–end time range
    - Enter key: submit. Escape key: dismiss. Click outside: dismiss
    - Default title "New Event" if empty on submit
    - Entrance animation: fade-in + slide-down (150ms). Exit: fade-out (100ms). Reduced motion: instant
    - Accessibility: role="dialog", aria-label="Create event", focus trap
    - _Requirements: 12.4, 12.5, 12.6_

  - [x] 11.7 Create the Empty State View component
    - Create `src/ui/calendar/EmptyStateView.tsx` implementing contextual empty states
    - Messages: day → "No events today — enjoy your free time!", week → "Your week is wide open", agenda → "Nothing coming up", no-accounts → welcome message + "Connect Account" button
    - CTA button "Create an event" that opens Quick Create Bar or Inline Event Creator
    - Entrance animation: fade-in + slide-up (400ms). Static when reduced motion
    - Accessibility: illustration decorative (empty alt text), message and CTA properly labeled
    - Use Design_Token_System colors and typography
    - _Requirements: 16.1, 16.2, 16.3, 16.4, 16.5, 16.6, 16.7_

  - [ ]* 11.8 Write property test for empty state messages (Property 14)
    - **Property 14: Empty state context-appropriate messages**
    - For each EmptyStateContext value ('day', 'week', 'agenda', 'no-accounts'), verify the correct message string is returned
    - Create test at `src/ui/calendar/__tests__/EmptyStateView.property.test.ts`
    - **Validates: Requirements 16.2**

- [x] 12. Implement the Quick Create Bar and Live Preview
  - [x] 12.0 Extend EventEditor to accept pre-populated partial fields
    - Update `src/ui/editor/EventEditor.tsx` to extend `EventEditorProps` with two optional fields from the design's `EventEditorPrepopulateExtension`:
      - `initialValues?: Partial<EventFormData>` — partial form data to seed the editor in 'create' mode (ignored in 'edit' mode)
      - `highlightRecurrenceSection?: boolean` — when true, visually highlights the recurrence section with a 400ms border color transition from `tokens.colors.warning` to `tokens.colors.border` (static border when reduced motion) AND scrolls the recurrence section into view via ref on mount
    - Update the form initialization: when `mode === 'create'` and `initialValues` is provided, shallow-merge it over `createDefaultForm(activeAccounts[0]?.id)` so provided fields win but missing fields fall back to defaults
    - Create `src/nlp/parsedEventToFormData.ts` implementing `parsedEventToFormData(parsed: Partial<ParsedEvent>): Partial<EventFormData>` pure function per the design:
      - title → form.title
      - date + time combined → form.startTime (only when both are non-null)
      - date + time + duration → form.endTime
      - location → form.location
      - attendees → form.attendees (mapped via same Attendee shape as `convertParsedEventToCreateInput` in Task 12.1)
      - recurrence (only when `confidence.recurrence === 'parsed'`) → form.recurrenceRule
    - _Requirements: 5.8, 17.8_

  - [x]* 12.0A Write unit tests for EventEditor pre-population
    - Verify that `initialValues` provided in 'create' mode seeds the form with the partial data and leaves other fields at defaults
    - Verify that `initialValues` is ignored when `mode === 'edit'`
    - Verify that `highlightRecurrenceSection: true` applies the warning border to the recurrence section and scrolls it into view
    - Verify that `parsedEventToFormData` correctly maps all fields and skips recurrence when `confidence.recurrence !== 'parsed'`
    - Create tests at `src/ui/editor/__tests__/eventEditorPrepopulate.test.ts` and `src/nlp/__tests__/parsedEventToFormData.test.ts`
    - _Requirements: 5.8, 17.8_

  - [x] 12.1 Create the ParsedEvent to CreateEventInput converter
    - Create `src/nlp/convertParsedEvent.ts` implementing `convertParsedEventToCreateInput(parsedEvent, calendarAccountId)`
    - Return null if date or time is missing (signals EventEditor fallback)
    - Combine date + time into startTime, compute endTime from duration
    - Target the CRUD service's `CreateEventInput` from `src/events/eventCRUDService.ts` (NOT the React Query mutation's `CreateEventInput` from `src/query/useCreateEvent.ts` — these are different types; the CRUD service version is what the Quick Create Bar should use)
    - Handle ALL fields in the CRUD service's `CreateEventInput`:
      - `calendarAccountId`: from the function parameter
      - `title`: from `parsedEvent.title`
      - `startTime`: combined from `parsedEvent.date` + `parsedEvent.time`
      - `endTime`: `startTime` + `parsedEvent.duration` minutes
      - `description`: null (NL parser doesn't extract descriptions)
      - `location`: from `parsedEvent.location` (null if not parsed)
      - `timeZone`: device timezone via `Intl.DateTimeFormat().resolvedOptions().timeZone`
      - `isAllDay`: false (NL parser always produces timed events)
      - `recurrenceRule`: JSON-serialize `parsedEvent.recurrence` if non-null, else null
      - `attendees`: JSON-serialize array of `Attendee` objects mapped from `parsedEvent.attendees` names — map each name to `{ email: '', displayName: name, status: 'needs-action', role: 'required' }`. Note: `Attendee.displayName` is `string | null` in `models.ts`, so ensure non-empty names are passed as strings and empty strings are converted to null
      - `organizer`: null
      - `visibility`: null
      - `opaqueFields`: null
      - `recurrenceExceptionDate`: null
      - `parentRecurringEventId`: null
    - _Requirements: 5.2, 5.8_

  - [x] 12.2 Create the Quick Create Bar component
    - Create `src/ui/calendar/QuickCreateBar.tsx` implementing the persistent NL input
    - Display at top of Day_View, Week_View, and Agenda_View
    - Parse input via NL_Parser on each keystroke (throttled at 100ms intervals)
    - Show Live_Preview_Panel below when input is non-empty
    - On submit, branch based on the parse result (per the design's "QuickCreateBar → EventEditor Fallback Flow"):
      - If `confidence.date === true` AND `confidence.time === true` AND `confidence.recurrence !== 'attempted_unresolved'`: convert via `convertParsedEventToCreateInput` and call `EventCRUDService.createEvent()` directly
      - If `confidence.date === false` OR `confidence.time === false` (Req 5.8): call `onOpenEditor` with `{ initialValues: parsedEventToFormData(parsedEvent), highlightRecurrenceSection: false }`
      - If `confidence.recurrence === 'attempted_unresolved'` (Req 17.8): call `onOpenEditor` with `{ initialValues: parsedEventToFormData(parsedEvent), highlightRecurrenceSection: true }` — even when date/time were successfully parsed
    - After a successful direct `createEvent` call, the UI updates automatically — `EventCRUDService.createEvent` already calls `eventsStore.addEvent` internally (verified in `src/events/eventCRUDService.ts`), so all views reading from the store reflect the new event without needing React Query invalidation or a duplicate `addEvent` call from the caller
    - Trigger haptic feedback on successful creation (mobile) via `useHaptics().trigger('success')`
    - _Requirements: 5.1, 5.2, 5.8, 14.3, 17.8, 18.1_

  - [x] 12.3 Create the Live Preview Panel component
    - Create `src/ui/calendar/LivePreviewPanel.tsx` implementing real-time preview of parsed fields
    - Update within 100ms of each keystroke (throttled)
    - Confirmed fields: solid text, Design_Token_System primary color
    - Unresolved fields: placeholder text, muted color
    - Hidden when input is empty
    - Collapse animation on submit (200ms)
    - Screen reader: ARIA live region with 500ms debounce
    - _Requirements: 18.1, 18.2, 18.3, 18.4, 18.5, 18.6, 18.7_

- [x] 13. Implement the Keyboard Shortcut Manager and Help Overlay
  - [x] 13.1 Create the Keyboard Shortcut Manager
    - Create `src/ui/keyboard/useKeyboardShortcuts.ts` implementing the `useKeyboardShortcuts(config)` hook
    - Register default shortcuts: C (Quick Create), T (today), 1-4 (view switching), ←/→ (navigation), ? (help overlay), Escape (dismiss)
    - Suppress single-key shortcuts when text input has focus (`isSuppressed` flag)
    - Announce shortcut actions to screen readers via ARIA live regions using the existing `useScreenReaderAnnouncement` hook. After each shortcut action executes, call `announce(message, 'polite')` with these exact strings (from the design):
      - C: "Quick create opened"
      - T: "Navigated to today"
      - 1: "Switched to day view"
      - 2: "Switched to week view"
      - 3: "Switched to month view"
      - 4: "Switched to agenda view"
      - ←: "Navigated backward"
      - →: "Navigated forward"
      - ?: "Shortcut help overlay opened"
      - Escape: "Shortcut help overlay dismissed"
    - Web/desktop only (no-op on mobile)
    - Create `src/ui/keyboard/index.ts` barrel export
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8_

  - [ ]* 13.2 Write property test for keyboard shortcut suppression (Property 11)
    - **Property 11: Keyboard shortcut suppression during text input**
    - Generate random shortcut keys, set isSuppressed = true, simulate keypress, verify action not called
    - Create test at `src/ui/keyboard/__tests__/useKeyboardShortcuts.property.test.ts`
    - **Validates: Requirements 11.7**

  - [x] 13.3 Create the Shortcut Help Overlay component
    - Create `src/ui/keyboard/ShortcutHelpOverlay.tsx` implementing the modal overlay
    - Display all shortcuts grouped by category (navigation, creation, view-switching)
    - Entrance animation: fade-in + scale-up from 0.95 (200ms). Exit: fade-out + scale-down (150ms)
    - Reduced motion: instant show/hide
    - Accessibility: role="dialog", aria-modal="true", aria-label="Keyboard shortcuts", focus trap
    - Apply Design_Token_System styling: `surface` background with `lg` shadow, `lg` border radius, `xl` padding, `subheading`/`semibold` category headers, `mono` font key badges on `surfaceElevated` background with `sm` border radius, `body`/`textPrimary` shortcut labels, `rgba(0,0,0,0.4)` backdrop
    - _Requirements: 11.5, 11.6_

  - [ ]* 13.4 Write unit tests for Keyboard Shortcut Manager
    - Test each specific key binding (C, T, 1-4, arrows, ?, Escape)
    - Test suppression when text input has focus
    - Test that each shortcut's screen reader announcement matches the exact string specified in Task 13.1 ("Quick create opened", "Navigated to today", "Switched to day view", "Switched to week view", "Switched to month view", "Switched to agenda view", "Navigated backward", "Navigated forward", "Shortcut help overlay opened", "Shortcut help overlay dismissed")
    - Create test at `src/ui/keyboard/__tests__/useKeyboardShortcuts.test.ts`
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8_

- [x] 14. Implement the Month View Stability Fix
  - [x] 14.1 Create the Stable Navigation Hook
    - Create `src/ui/calendar/useStableNavigation.ts` implementing the debounce-based navigation stabilizer
    - Track latest requested month via useRef, debounce state updates (default 80ms)
    - Cancel stale renders via generation counter
    - Return `stableDate` and `isPending` flag
    - _Requirements: 6.4_

  - [x] 14.2 Create the Stable Month View wrapper
    - Create `src/ui/calendar/StableMonthView.tsx` wrapping the existing `MonthView` with `useStableNavigation`
    - Interpose stable navigation between raw date prop and `buildMonthGridData`
    - Show subtle loading indicator when `isPending` is true
    - Ensure correct rendering for: empty events array, cross-boundary events, all valid months (Jan 1970 – Dec 2099), rapid navigation (>5 actions in 2s)
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

  - [x]* 14.3 Write property test for month grid correctness (Property 9)
    - **Property 9: Month grid correctness for any valid month**
    - Generate random months (1–12) and years (1970–2099), verify `buildMonthGridData` produces 42 cells with correct day numbers
    - Create test at `src/ui/calendar/__tests__/monthView.property.test.ts`
    - **Validates: Requirements 6.3**

  - [x]* 14.4 Write unit tests for Month View stability
    - Test empty events array rendering, cross-boundary events, Feb 29 in leap/non-leap years
    - Test rapid navigation simulation (>5 actions in 2s)
    - Create test at `src/ui/calendar/__tests__/StableMonthView.test.ts`
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

- [x] 15. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.


- [x] 16. Implement the Calendar Sidebar
  - [x] 16.1 Create the Calendar Sidebar component
    - Create `src/ui/calendar/CalendarSidebar.tsx` implementing the left panel for tablet/desktop
    - Three sections: Mini_Month_Navigator (compact month grid with selected date highlight, arrow navigation with crossfade 200ms), account toggles (checkbox + name + color dot), upcoming events list (next 10 events sorted by startTime)
    - Implement crossfade animation (200ms) for mini-month forward/backward navigation using the Animation Engine's `withMotion` utility. When reduced motion is active, display month changes instantly
    - Mini month day tap: update main view anchor date
    - Account toggle: show/hide events within 200ms using existing visibility toggle flow
    - Fully keyboard-navigable (Tab between sections, Enter/Space to activate)
    - Reduced motion: instant month changes, no crossfade
    - Use Design_Token_System colors and typography
    - _Requirements: 19.1, 19.2, 19.3, 19.4, 19.5, 19.6, 19.7, 19.8_

  - [x]* 16.2 Write property test for upcoming events sorting and limit (Property 17)
    - **Property 17: Upcoming events list is sorted and limited**
    - Generate random event lists (0–100 events), verify upcoming list has ≤10 events sorted by startTime ascending, all with startTime ≥ current time
    - Create test at `src/ui/calendar/__tests__/CalendarSidebar.property.test.ts`
    - **Validates: Requirements 19.6**

- [ ] 17. Implement the Onboarding Animator
  - [ ] 17.0 Create the three onboarding animation components
    - Create `src/ui/onboarding/animations/NaturalLanguageDemo.tsx` implementing a reanimated worklet-based looping animation (3–6 second loop) demonstrating the Quick Create Bar: typed text appears character-by-character, then the Live Preview Panel resolves parsed fields, then an event card pops in. Uses `useSharedValue`, `useAnimatedStyle`, `withRepeat`, `withSequence`, `withTiming`
    - Create `src/ui/onboarding/animations/DragToRescheduleDemo.tsx` implementing a reanimated worklet-based looping animation (3–6 second loop) demonstrating drag-to-reschedule: an event card lifts (scale 1.03), translates to a new time slot, settles in place. Uses `withRepeat`/`withSequence`
    - Create `src/ui/onboarding/animations/ViewSwitchingDemo.tsx` implementing a reanimated worklet-based looping animation (3–6 second loop) demonstrating view transitions: a day-view grid crossfades + slides to a week-view grid, then back. Uses `withRepeat`/`withSequence`
    - Each component exports a default React component that accepts `{ isPlaying: boolean }` and matches the design's `AnimationAsset.component` type
    - Each component also exports its `loopDurationMs` constant (3000–6000ms)
    - Create static image fallbacks for reduced motion: `src/ui/onboarding/animations/staticFallbacks/` with `natural-language.png`, `drag-to-reschedule.png`, `view-switching.png` (placeholder images acceptable for MVP — real designer assets in a follow-up)
    - _Requirements: 20.2, 20.3_

  - [ ] 17.1 Create the Onboarding Animator component
    - Create `src/ui/onboarding/OnboardingAnimator.tsx` implementing the first-run experience
    - Present 3 animated screens (from Task 17.0): NL event creation → drag-to-reschedule → view switching with transitions
    - Each screen renders the corresponding animation component (or static image when reduced motion is active) with `isPlaying={currentScreen === index}` so only the visible screen's animation loops
    - Progress indicator (dots), Next/Skip buttons
    - Horizontal slide transition between screens (300ms)
    - On complete/skip: persist completion state via the existing `OnboardingManager.completeStep` / `OnboardingManager.skipOnboarding` methods (NOT via `UIPreferences.onboardingComplete` — that field was intentionally not added to `UIPreferences` in Task 1.6)
    - Transition to main calendar view after completion
    - Reduced motion: render static fallback images, instant screen transitions
    - Accessibility: descriptive alt text for animations ("Demonstration of typing 'Lunch tomorrow at noon' in the Quick Create Bar", etc.), labeled controls (Next, Skip, progress indicator)
    - Create `src/ui/onboarding/index.ts` barrel export
    - _Requirements: 20.1, 20.2, 20.3, 20.4, 20.5, 20.6, 20.7, 20.8, 20.9_

  - [ ]* 17.2 Write unit tests for Onboarding Animator
    - Verify 3–5 screens are presented
    - Verify completion state is persisted on complete and skip
    - Verify onboarding is not shown on subsequent launches
    - Create test at `src/ui/onboarding/__tests__/OnboardingAnimator.test.ts`
    - _Requirements: 20.1, 20.6, 20.7_

- [ ] 18. Integration wiring — connect all new modules to the existing app
  - [ ] 18.1 Integrate Design Tokens into existing components
    - Update existing UI components (`UnifiedCalendarView`, `ViewModeSwitcher`, `MonthView`, `DayView`, `WeekView`, `AgendaView`, `EventCard`) to import and use Design_Token_System tokens instead of hardcoded style values
    - Replace the current `CALENDAR_COLOR_PALETTE` in `colorCoding.ts` with the Design_Token_System event palette
    - Wire `useMicroInteractions().eventCreated` into EventCard mount behavior for user-created events
    - Wire `useMicroInteractions().syncAppear` into EventCard mount behavior for events where `useIsRecentlyArrivedFromSync(event.id)` returns true (from Task 2.5)
    - Wire `useMicroInteractions().visibilityToggle` into EventCard rendering using `useAccountVisibilityTransition(event.calendarAccountId)` (from Task 2.6) — when the hook returns 'fading-in' or 'fading-out', apply the animation; when 'idle', render without animation
    - Wire `useMicroInteractions().eventDeleted` into EventCard rendering — when `event.syncStatus === 'pending_delete'` (triggered by the `useAnimatedEventDelete` hook from Task 2.7), apply the shrink+fade animation
    - Replace direct `EventCRUDService.deleteEvent` calls in EventCard context menus / swipe-to-delete with `useAnimatedEventDelete().deleteWithAnimation` so the delete animation plays before the event is removed from the store
    - Wire `useMicroInteractions().pressDown` / `pressRelease` into EventCard press feedback (Req 7.1, 7.2)
    - _Requirements: 1.5, 1.6, 2.2, 2.3, 7.1, 7.2, 7.3, 7.4_

  - [ ] 18.2 Wire gesture controllers into calendar views
    - Integrate `useDragReschedule` into Day_View and Week_View Event_Cards (long-press to drag) — pass `useConflictCheckAdapter(visibleEvents).check` (from Task 9.1A) as `onConflictCheck`
    - Integrate `useDragResize` into Day_View and Week_View Event_Cards (bottom edge drag) — pass the same conflict adapter as `onConflictCheck`
    - Render `ConflictIndicatorOverlay` (from Task 9.1B) on top of the dragged Event_Card when `state.hasConflict === true`, with `proposedRect` computed from the gesture's animated values and `conflictCount` from `state.conflictingEventIds.length`
    - Announce conflict state transitions via `useScreenReaderAnnouncement('polite')` on first entry into conflict ("Conflicts with N event(s)") and on exit ("No conflict") — use a `useRef` to track the previous `hasConflict` state so announcements only fire on transitions, not every frame
    - Wrap Day_View, Week_View, and Month_View with `SwipeNavigationHost` (from Task 11.1A) to enable mobile swipe navigation with the slide animation. Pass `unit="day"`/`"week"`/`"month"` and the appropriate `renderView` callback
    - Integrate `usePullToRefresh` into all scrollable calendar views, connecting to existing SyncEngine
    - Mount `<AutoDismissBanner message={error} />` at the top of each scrollable view's layout so pull-to-refresh sync failures surface per Req 9.4 (Task 9.20 cross-reference — the banner component exists but is orphaned until this wiring lands)
    - Wire the `pullToRefresh` micro-interaction animation from the Micro-Interaction System into the pull-to-refresh gesture controller's indicator rendering
    - Integrate `useInlineEventCreator` into Day_View and Week_View time grids
    - Wire haptic feedback into drag activation, drop, resize snap points, and event creation
    - _Requirements: 2.4, 4.1, 4.3, 4.4, 9.1, 12.1, 13.1, 13.5, 14.1, 14.2, 14.4, 15.1, 15.2, 15.4_

  - [ ] 18.3 Wire View Transition Animator and Animated ViewModeSwitcher into UnifiedCalendarView
    - Replace the existing `ViewModeSwitcher` with `AnimatedViewModeSwitcher` in `UnifiedCalendarView`
    - Wrap calendar view rendering with `ViewTransitionAnimator`
    - Wire zoom transition for Month_View day tap → Day_View navigation
    - _Requirements: 3.1, 3.3, 8.1_

  - [ ] 18.4 Wire Quick Create Bar and Live Preview into calendar views
    - Add `QuickCreateBar` to the top of Day_View, Week_View, and Agenda_View
    - Connect `QuickCreateBar` to `EventCRUDService.createEvent` via `convertParsedEventToCreateInput` for the successful-parse path
    - For the fallback path, open `EventEditor` in 'create' mode with `initialValues: parsedEventToFormData(parsedEvent)` (from Task 12.0) and `highlightRecurrenceSection` set to true only when `confidence.recurrence === 'attempted_unresolved'`
    - _Requirements: 5.1, 5.8, 17.8, 18.1_

  - [ ] 18.5 Wire Keyboard Shortcut Manager into the app
    - Integrate `useKeyboardShortcuts` into `UnifiedCalendarView` with callbacks for Quick Create, today navigation, view switching, and forward/backward navigation
    - Wire Shortcut Help Overlay visibility toggle
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6_

  - [ ] 18.6 Wire Calendar Sidebar into ResponsiveLayout
    - Integrate `CalendarSidebar` into the existing `ResponsiveLayout` for tablet and desktop breakpoints
    - Connect mini month navigator to `UnifiedCalendarView` anchor date
    - Connect account toggles to existing visibility toggle flow
    - Connect upcoming events list to event store
    - _Requirements: 19.1, 19.2, 19.4, 19.5, 19.6_

  - [ ] 18.7 Wire Stable Month View and Empty States
    - Replace `MonthView` usage in `UnifiedCalendarView` with `StableMonthView`
    - Add `EmptyStateView` rendering when Day_View, Week_View, or Agenda_View has zero visible events
    - Add first-launch empty state when no calendar accounts are connected
    - _Requirements: 6.1, 6.4, 16.1, 16.4_

  - [ ] 18.8 Wire Current Time Indicator into Day and Week views
    - Add `CurrentTimeIndicator` to `DayView` and `WeekView` components
    - Pass `hourHeight` and `isCurrentDay` props appropriately
    - _Requirements: 10.1, 10.2, 10.3_

  - [ ] 18.9 Wire Onboarding Animator into app entry point
    - Integrate `OnboardingAnimator` into the app's root component (App.tsx or navigation entry)
    - Check onboarding completion state via `OnboardingManager.isComplete(userId)` — this is the single source of truth (Task 1.6 explicitly did NOT add `onboardingComplete` to `UIPreferences` to avoid duplicated state)
    - Show first-run experience only when `isComplete` returns false
    - Wire `OnboardingAnimator`'s `onComplete` / `onSkip` callbacks to `OnboardingManager.completeStep` and `OnboardingManager.skipOnboarding` respectively
    - _Requirements: 20.1, 20.7_

  - [ ] 18.10 Wire UIPreferences into remaining components
    - Wire `shortcutOverrides` from the UIPreferences store (Task 1.6) into the Keyboard Shortcut Manager for future custom shortcut support (currently unused but reserved)
    - Verify the system theme listener wired in Task 1.6 propagates correctly — changing OS dark mode while the app is running should flip `useTokens()` for all consumers within 500ms (Req 1.8)
    - Note: `onboardingComplete` is deliberately NOT wired here — it lives in `OnboardingManager` (see Task 18.9)
    - _Requirements: 1.7, 1.8_

- [ ] 18A. Integration, performance, and accessibility tests
  - [ ]* 18A.1 Integration test: Drag-to-reschedule end-to-end flow
    - Long-press Event_Card → drag to new time slot → drop → verify `EventCRUDService.updateEvent` called with correct new start/end times
    - Create test at `src/ui/gestures/__tests__/dragReschedule.integration.test.ts`
    - _Requirements: 4.1, 4.2, 4.3_

  - [ ]* 18A.2 Integration test: Quick Create Bar → EventCRUDService
    - Type NL input in Quick Create Bar → submit → verify event created with correct fields via `EventCRUDService.createEvent`
    - Create test at `src/ui/calendar/__tests__/quickCreateBar.integration.test.ts`
    - _Requirements: 5.1, 5.2_

  - [ ]* 18A.3 Integration test: Pull-to-refresh → SyncEngine
    - Simulate pull gesture (≥80px) → verify `SyncEngine.syncAllPending` called → verify indicator shown during sync → verify indicator dismissed on completion
    - Create test at `src/ui/gestures/__tests__/pullToRefresh.integration.test.ts`
    - _Requirements: 9.1, 9.2, 9.3_

  - [ ]* 18A.4 Integration test: Calendar Sidebar → main view
    - Tap mini month day → verify main calendar view anchor date updates to tapped day
    - Toggle account checkbox → verify events for that account are hidden/shown
    - Create test at `src/ui/calendar/__tests__/calendarSidebar.integration.test.ts`
    - _Requirements: 19.2, 19.5_

  - [ ]* 18A.5 Integration test: Onboarding flow
    - Complete all onboarding screens → verify `OnboardingManager.completeStep` called → verify onboarding not shown on simulated relaunch
    - Create test at `src/ui/onboarding/__tests__/onboarding.integration.test.ts`
    - _Requirements: 20.1, 20.6, 20.7_

  - [ ]* 18A.6 Performance test: Month view with 500 events renders < 1 second
    - Render `StableMonthView` with 500 generated events, measure render time, assert < 1000ms
    - Create test at `src/ui/calendar/__tests__/monthView.perf.test.ts`
    - _Requirements: 6.5_

  - [ ]* 18A.7 Performance test: Live preview keystroke-to-update latency < 100ms
    - Simulate keystrokes in Quick Create Bar, measure time from keystroke to Live Preview Panel update, verify < 100ms using throttled parsing
    - Create test at `src/ui/calendar/__tests__/livePreview.perf.test.ts`
    - _Requirements: 18.2_

  - [ ]* 18A.8 Performance test: Drag persist time < 200ms
    - Simulate drag-to-reschedule drop, measure time from release to `onReschedule` callback completion, verify < 200ms
    - Create test at `src/ui/gestures/__tests__/dragReschedule.perf.test.ts`
    - _Requirements: 4.7_

  - [ ]* 18A.9 Accessibility test: Interactive elements have accessible labels
    - Render key interactive components (Quick Create Bar, Event Cards, Calendar Sidebar, Inline Popover) and verify all interactive elements have `accessibilityLabel` or `aria-label` attributes for screen readers
    - Create test at `src/ui/__tests__/accessibility.test.ts`
    - _Requirements: 11.8, 16.7, 19.8, 20.9_

  - [ ]* 18A.10 Accessibility test: Keyboard Tab order
    - Verify keyboard Tab order flows correctly through Calendar Sidebar sections, Shortcut Help Overlay, and Inline Event Popover
    - Create test at `src/ui/__tests__/accessibility.test.ts`
    - _Requirements: 11.5, 12.4, 19.8_

  - [ ]* 18A.11 Accessibility test: ARIA live region announcements
    - Verify ARIA live region announcements fire for keyboard shortcut actions and Live Preview field changes
    - Create test at `src/ui/__tests__/accessibility.test.ts`
    - _Requirements: 11.8, 18.7_

  - [ ]* 18A.12 Accessibility test: Animations respect prefers-reduced-motion
    - Set `prefers-reduced-motion: reduce`, render animated components (View Transition, Micro-Interactions, Onboarding), verify all animations resolve instantly with duration 0
    - Create test at `src/ui/__tests__/accessibility.test.ts`
    - _Requirements: 2.5, 3.4, 7.5, 8.4, 15.5, 16.6, 19.7, 20.8_

- [ ] 19. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation at key milestones
- Property tests validate universal correctness properties from the design document using fast-check
- Unit tests validate specific examples and edge cases
- All 18 correctness properties from the design are covered by property test tasks
- All 20 requirements are covered by implementation tasks (including Req 1.8 added for the system theme listener)
- New modules are additive — they wrap or extend existing components rather than replacing them
- The existing EventCRUDService, SyncEngine, calendarViewModel, and Zustand stores remain unchanged except for:
  - `eventsStore`: adds `recentlyArrivedFromSync` (Task 2.5) and `pendingAnimatedDelete` (Task 2.7) transient fields to support `syncAppear` and `eventDeleted` micro-interaction triggers
  - `src/query/useEvents.ts` (TanStack Query layer): calls `markArrivedFromSync(newIds)` after `addEvents(newEvents)` — where `newIds` is the delta set of ids not already present in the store (Task 2.5A). This is the only wiring change for sync-arrival tracking; `SyncEngine` itself is NOT modified, because it writes to SQLite and the query layer is what reads into the Zustand store.
  - `EventEditor`: gains optional `initialValues` and `highlightRecurrenceSection` props (Task 12.0) to support the Quick Create Bar fallback flow (Req 5.8, 17.8)
- Cross-day drag in week view (horizontal drag across day columns) is a design addition beyond Requirement 4's explicit scope. It's included because every competitor supports it and users would expect it.
- UIPreferences store (Task 1.6) deliberately does NOT include `onboardingComplete` — onboarding completion is tracked by the existing `OnboardingManager` (single source of truth, persisted to SQLite)
- The Quick Create Bar calls `EventCRUDService.createEvent` directly rather than the React Query `useCreateEvent` mutation. This is safe because `EventCRUDService.createEvent` already updates the Zustand events store internally (verified in `src/events/eventCRUDService.ts`), so UI views reading from the store reflect new events without requiring React Query invalidation
- Task 1.6's system theme listener (Req 1.8) uses `Appearance.addChangeListener` from `react-native` and is scoped to the `colorScheme === 'system'` case
- Conflict indication during drag (Req 4.4, 13.5) uses a dedicated `ConflictIndicatorOverlay` component (Task 9.1B), NOT the existing `ConflictWarning` component — the latter is tied to the EventEditor form-conflict flow and takes a different data shape
- The NL Parser's `confidence.recurrence` is a three-state value (`'none' | 'parsed' | 'attempted_unresolved'`), not a boolean, so Req 17.8's "detected recurrence but cannot determine frequency" state can trigger the correct EventEditor fallback behavior
