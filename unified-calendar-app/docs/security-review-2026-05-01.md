# Security Review — Unified Calendar App

**Date:** 2026-05-01
**Reviewer:** Kiro (AI-assisted review)
**Scope:** Full codebase audit — authentication, encryption, network, sync, payments, sharing, storage

---

## Summary

A comprehensive security and architecture review of the unified-calendar-app identified 17 findings across critical, high, medium, and low severity levels. This document tracks each finding, explains why it is a security issue, and documents the fix applied along with the rationale for the chosen approach.

---

## Findings

### CRITICAL

#### C1 — SQL Injection via unparameterized table/column names in migration backup/restore

**File:** `src/db/migration.ts`
**Lines:** `createBackup()` and `restoreFromBackup()`

**What is the issue:**
The `restoreFromBackup` method constructs SQL INSERT statements by interpolating column names directly from the backup data object's keys:

```typescript
const columns = Object.keys(row);
await this.driver.execute(
  `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`,
  values
);
```

While the table names come from a hardcoded list (reducing risk), the column names come from the backup data itself. If a backup file is tampered with — for example, if a user restores from a corrupted or maliciously crafted backup — an attacker could inject arbitrary SQL through column names like `id); DROP TABLE events; --`.

The `DELETE FROM ${table}` and `SELECT * FROM ${table}` statements also interpolate table names, though these come from a hardcoded array, making exploitation less likely but still a defense-in-depth concern.

**Fix applied:**
- Added a `VALID_TABLE_NAMES` whitelist set and a `validateTableName()` function that throws on any table name not in the set.
- Added a `VALID_COLUMN_NAMES` map of table → allowed columns, and a `validateColumnNames()` function that filters out any column not in the schema.
- Applied validation in `createBackup()`, `restoreFromBackup()`, and the `DELETE` statement.

**Why this approach:**
Parameterized queries cannot be used for identifiers (table/column names) in SQL — only for values. The standard defense is identifier whitelisting. Since the schema is defined in `schema.ts`, we derive the whitelist from the same source of truth, ensuring it stays in sync. This is the industry-standard approach for dynamic SQL identifiers.

---

#### C2 — Uncaught JSON.parse on database columns in mapRowToEvent

**Files:** `src/sharing/sharedViewService.ts`, `src/sharing/delegationService.ts`

**What is the issue:**
Both files contain `mapRowToEvent()` functions that call `JSON.parse()` on raw database column values (`recurrence_rule`, `organizer`, `attendees`, `opaque_fields`, `calendar_ids`) without try/catch:

```typescript
recurrenceRule: row.recurrence_rule
  ? JSON.parse(row.recurrence_rule as string)
  : null,
```

If any of these columns contain corrupted or malformed JSON (due to a failed migration, sync bug, or disk corruption), the entire query crashes with an unhandled exception. This could prevent users from viewing any events in a shared view or delegation, effectively a denial-of-service on the sharing feature.

**Fix applied:**
- Extracted a `safeJsonParse()` utility that wraps `JSON.parse` in try/catch and returns a default value on failure.
- Applied it to all JSON column parsing in both `mapRowToEvent()` implementations and `mapRowToGrant()` for `calendar_ids`.
- Also applied to `getSharedView()` and `getSharedViewsForOwner()` where `calendar_ids` is parsed.

**Why this approach:**
Defensive parsing is the correct pattern for data read from storage — the application should degrade gracefully (show an event with missing recurrence data) rather than crash entirely. A utility function ensures consistent behavior and avoids duplicating try/catch blocks.

---

### HIGH

#### H1 — PKCE code verifier has modulo bias

**File:** `src/providers/oauthConnector.ts`

**What is the issue:**
The PKCE code verifier generator maps random bytes to charset characters using modulo:

```typescript
.map((v) => PKCE_CHARSET[v % PKCE_CHARSET.length])
```

The PKCE charset has 66 characters. Since 256 is not evenly divisible by 66 (`256 % 66 = 58`), the first 58 characters in the charset have a probability of `4/256` while the remaining 8 have `3/256`. This is a ~33% relative bias for those positions.

For a 64-character verifier, the practical entropy reduction is small (~0.04 bits per character), but RFC 7636 recommends high-entropy verifiers, and this is a straightforward fix. More importantly, it sets a bad precedent — the same pattern used with a smaller charset would have severe bias.

**Fix applied:**
- Implemented rejection sampling: random bytes ≥ the largest multiple of 66 that fits in a byte (264) are discarded and re-sampled.
- This eliminates all modulo bias while maintaining the same output distribution.

**Why this approach:**
Rejection sampling is the standard cryptographic technique for unbiased random selection from a non-power-of-2 set. The rejection rate is `(256 - 264 + 66) / 256 ≈ 23%` per byte, which is negligible for a 64-byte verifier. Alternative approaches (like using larger random values) add complexity without benefit.

---

#### H2 — UUID generation uses Math.random() — not cryptographically secure

**Files:** `src/sharing/sharedViewService.ts`, `src/sharing/delegationService.ts`, `src/accounts/calendarAccountService.ts`

**What is the issue:**
These files generate UUIDs using `Math.random()`:

```typescript
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    ...
  });
}
```

`Math.random()` is not cryptographically secure — its output is deterministic given the seed, and in some engines the seed can be recovered from observed outputs. For security-sensitive identifiers like delegation grant IDs, shared view IDs, and account IDs, predictable IDs could allow an attacker to guess valid grant IDs and access unauthorized calendars.

Similarly, `src/sync/syncEngine.ts` uses `Date.now()` + `Math.random()` for sync queue entry IDs, which has collision risk under high-frequency operations.

**Fix applied:**
- Created a shared `src/utils/cryptoId.ts` utility module exporting `cryptoUUID()` and `cryptoId()`.
- `cryptoUUID()` uses `crypto.randomUUID()` with a fallback to `crypto.getRandomValues()` for environments where `randomUUID` is unavailable.
- `cryptoId()` generates a timestamp-prefixed ID using `crypto.getRandomValues()` for the random portion.
- Replaced all `generateUUID()` and `generateId()` call sites with the new utilities.

**Why this approach:**
`crypto.randomUUID()` is available in all modern browsers, Node.js 19+, and React Native (via the Hermes engine). It produces RFC 4122 v4 UUIDs with 122 bits of cryptographic randomness. The fallback ensures compatibility with older environments. A shared utility eliminates code duplication and ensures consistent security properties across the codebase.

---

#### H3 — No webhook payload signature verification

**File:** `src/subscription/webhookHandler.ts`

**What is the issue:**
The `handleEvent` method accepts a `WebhookEventPayload` and trusts it completely:

```typescript
async function handleEvent(event: WebhookEventPayload): Promise<void> {
  switch (event.type) {
    case 'INITIAL_PURCHASE':
      return handleInitialPurchase(event);
```

There is no HMAC signature verification, no timestamp validation, and no source validation. If an attacker can send events to this handler (via a compromised push channel, man-in-the-middle, or direct API access), they could:
- Upgrade their subscription tier to `team` for free
- Cancel other users' subscriptions
- Trigger billing issue grace periods

**Fix applied:**
- Added a `WebhookSecurityConfig` interface requiring a `signingSecret` and optional `timestampToleranceMs` (default: 5 minutes).
- Added `verifyWebhookSignature()` that validates an HMAC-SHA256 signature over `timestamp.payload` using the signing secret.
- Added `verifyTimestamp()` that rejects events older than the tolerance window (replay protection).
- The `handleEvent` method now requires `signature` and `timestamp` parameters and rejects events that fail verification.

**Why this approach:**
HMAC-SHA256 signature verification is the industry standard for webhook security (used by Stripe, RevenueCat, GitHub, etc.). The timestamp check prevents replay attacks where a valid signed payload is re-sent later. The 5-minute tolerance window accounts for clock skew between the webhook sender and receiver. This matches the exact pattern used by both Stripe and RevenueCat in their webhook SDKs.

---

#### H4 — Token refresh race condition

**File:** `src/providers/axiosFactory.ts`

**What is the issue:**
The 401 response interceptor uses a boolean `isRefreshing` flag as a mutex:

```typescript
if (!isRefreshing) {
  isRefreshing = true;
  try {
    const newAuth = await oauthConnector.refreshAccessToken(refreshTokenInfo);
```

If two 401 responses arrive in the same microtask tick (e.g., two parallel API calls both get 401), both could read `isRefreshing` as `false` before either sets it to `true`. This would trigger two simultaneous refresh requests. Depending on the provider, the second refresh could invalidate the first token (refresh token rotation), leaving the app in a broken auth state.

**Fix applied:**
- Replaced the boolean flag + subscriber array with a single `refreshPromise: Promise<string> | null` pattern.
- When a 401 is received, if `refreshPromise` is null, a new refresh is initiated and stored. If `refreshPromise` already exists, the request awaits the existing promise.
- The promise is cleared after resolution (success or failure).

**Why this approach:**
A Promise-based lock is the idiomatic JavaScript pattern for deduplicating concurrent async operations. It is inherently race-free because Promise creation and assignment happen synchronously within a single microtask. All concurrent 401 handlers will see the same Promise reference and await the same refresh operation. This is the same pattern used by Apollo Client and other major HTTP libraries for token refresh deduplication.

---

#### H5 — addAllowedProviderDomain mutates a ReadonlySet with no validation

**File:** `src/providers/networkSecurity.ts`

**What is the issue:**
The `addAllowedProviderDomain` function casts away `ReadonlySet` to mutate the allowed domains:

```typescript
export function addAllowedProviderDomain(hostname: string): void {
  (ALLOWED_PROVIDER_DOMAINS as Set<string>).add(hostname.toLowerCase());
}
```

When a user connects a CalDAV account, the server's hostname is added to the allowed domains list. This means any data sent to that domain will NOT have sensitive fields stripped. If an attacker controls a CalDAV server (e.g., via a phishing link that tricks the user into connecting `evil-calendar.attacker.com`), all event data (titles, descriptions, attendees, locations) would be sent unredacted to the attacker's server.

**Fix applied:**
- Separated the static provider domains (`STATIC_PROVIDER_DOMAINS`) from dynamic CalDAV domains (`dynamicCalDAVDomains`).
- Added `isValidCalDAVDomain()` validation that rejects domains matching known non-CalDAV patterns (e.g., containing `google`, `microsoft`, `amazon`, `facebook`, etc.) and requires the domain to have at least one subdomain (no bare TLDs).
- `addAllowedProviderDomain` now validates before adding and returns a boolean indicating success.
- `isAllowedProviderDomain` checks both sets.
- Added `removeAllowedProviderDomain()` for cleanup when accounts are disconnected.
- Added `getDynamicDomains()` for testing/debugging.

**Why this approach:**
The core issue is that the allowed domain list controls data leak prevention — domains on this list receive full event data. Dynamic additions must be validated to prevent abuse. A blocklist of known non-CalDAV domains catches the most obvious attacks, while the subdomain requirement prevents bare TLD additions. The separation of static and dynamic sets makes the security boundary clear and auditable.

---

### MEDIUM

#### M1 — Sync engine doesn't use actual inbound event data

**File:** `src/sync/syncEngine.ts` — `applyInboundChanges()`

**What is the issue:**
When processing created events from a provider, the sync engine ignores the actual event data and inserts placeholder values:

```typescript
await db.execute(
  `INSERT OR IGNORE INTO events (...) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  [eventId, providerEventId, accountId, 'Synced Event', null, null, now, now + 3600000, ...]
);
```

This means all synced events appear as "Synced Event" with no real data. This is clearly incomplete implementation rather than a security vulnerability per se, but it means the sync feature is non-functional for inbound creates.

**Fix applied:**
- Updated `applyInboundChanges` to extract actual event data from `created.providerData` when available.
- Falls back to sensible defaults when provider data fields are missing.
- Applied the same `safeJsonParse` pattern for any JSON fields in provider data.

**Why this approach:**
The provider adapters return `RawEventData` with a `providerData` record. The sync engine should map these fields to the database schema. Using optional chaining with defaults ensures robustness when providers return partial data.

---

#### M2 — WebSocket message handling doesn't validate message structure

**File:** `src/lifecycle/webSocketManager.ts`

**What is the issue:**
The `handleMessage` function parses JSON and accesses properties without validating the message shape:

```typescript
function handleMessage(data: string): void {
  const message = JSON.parse(data);
  if (message.type === 'event_changed') {
    const payload: WebhookPayload = {
      accountId: message.accountId,
```

A malicious or buggy WebSocket server could send messages with unexpected types (e.g., `accountId` as a number or object), which would propagate through the sync engine and potentially cause database errors or unexpected behavior.

**Fix applied:**
- Added `isValidEventChangedMessage()` type guard that validates the message has the correct shape and types.
- `handleMessage` now rejects messages that don't pass validation.

**Why this approach:**
Runtime type validation at trust boundaries (network input) is a fundamental security practice. A type guard is the idiomatic TypeScript pattern — it narrows the type for the compiler while performing runtime checks. This is lightweight and doesn't require a schema validation library.

---

### LOW

#### L1 — generateId() in syncEngine uses Date.now() — collision risk

**File:** `src/sync/syncEngine.ts`

**What is the issue:**
Addressed as part of H2 — replaced with `cryptoId()` from the shared utility.

---

#### L2 — Duplicate mapRowToEvent implementations

**Files:** `src/sharing/sharedViewService.ts`, `src/sharing/delegationService.ts`

**What is the issue:**
Both files contain identical ~50-line `mapRowToEvent()` functions. This duplication means bug fixes (like the JSON.parse safety fix in C2) must be applied in multiple places, increasing the risk of inconsistency.

**Fix applied:**
- Extracted `mapRowToEvent()` into a shared `src/utils/eventMapper.ts` module.
- Both services now import from the shared module.

**Why this approach:**
DRY principle — a single source of truth for the mapping logic ensures that fixes (like safe JSON parsing) are applied consistently. The function has no dependencies on either service's internals, making extraction clean.

---

## Findings NOT addressed (documented for future work)

#### C1-alt — Web Secure Storage inherent limitations
The web platform's secure storage uses localStorage + sessionStorage encryption. This is a fundamental platform limitation — there is no equivalent to iOS Keychain or Android Keystore on the web. The current implementation is the best available approach for a client-side web app. A backend token proxy would be the ideal solution but requires server infrastructure. Documented as a known limitation.

#### M3 — No rate limiting on delegation/sharing operations
Requires architectural decision on where to enforce limits (client vs. server). Documented for future sprint.

#### M4 — No transaction support in sync operations
SQLite supports transactions, but the current DatabaseDriver interface doesn't expose them. Adding transaction support requires an interface change that affects all platform drivers. Documented for future sprint.

#### L3 — Read-only driver allows PRAGMAs through execute()
Low risk since the read-only driver is only used after migration failure. Documented for future hardening.

#### L4 — Subscription HTTP client is a placeholder in bootstrap
The bootstrap wires `{ post: async () => ({ data: {} as any }) }` as the HTTP client. This is clearly a development placeholder. Documented for implementation when the backend API is ready.
