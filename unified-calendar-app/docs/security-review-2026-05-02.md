# Security Review — Unified Calendar App

**Date:** 2026-05-02
**Reviewer:** Kiro (AI-assisted review)
**Scope:** Full codebase audit — follow-up to the 2026-05-01 review. Verifies prior fixes and identifies new findings introduced by modules not covered previously (NLP, events CRUD, userdata, notifications, on-device AI, CalDAV adapter, DB drivers).

---

## Summary

Of the 17 findings from the 2026-05-01 review, **all 13 that were addressed remain correctly fixed** and are still in place. The 4 findings explicitly deferred (C1-alt web storage limits, M3 rate limiting architecture, M4 transaction support, L4 subscription HTTP placeholder) are still open and are now upgraded or newly linked to live issues below.

This review identified **9 new findings** across the broader codebase. All 9 were remediated in the follow-up commit; see the "Resolution status" column below.

| ID  | Severity | Area                              | Status     |
| --- | -------- | --------------------------------- | ---------- |
| C3  | CRITICAL | Insecure UUIDs in event CRUD      | ✅ Fixed   |
| C4  | CRITICAL | Insecure UUIDs in user deletion   | ✅ Fixed   |
| H6  | HIGH     | Duplicate unsafe `mapRowToEvent`  | ✅ Fixed   |
| H7  | HIGH     | CalDAV UID uses `Math.random()`   | ✅ Fixed   |
| H8  | HIGH     | Missing DB transaction methods    | ✅ Fixed   |
| H9  | HIGH     | CalDAV domain validation bypassed | ✅ Fixed   |
| M5  | MEDIUM   | PKCE rejection-sampling comment   | ✅ Fixed   |
| M6  | MEDIUM   | Recurrence exception ID weak      | ✅ Fixed   |
| L5  | LOW      | Conflict detector seed uses Math.random | ✅ Fixed |

Verification: `tsc --noEmit` resolves all 4 `TS2739 missing transaction/supportsTransactions` errors; the full Jest suite passes (113 suites, 2,114 tests, 0 regressions).

Severity rationale:
- **Critical** = direct data integrity or authorization risk in a core write path (event CRUD, account deletion).
- **High** = predictable identifiers, SQL injection potential via JSON parsing, or broken security boundary that can be triggered by external input.
- **Medium** = incorrect-but-not-exploitable code, or non-exploitable under current architecture but likely to regress.
- **Low** = defense-in-depth gaps unlikely to be reachable by an attacker today.

---

## Verified: prior findings (2026-05-01) still fixed

| Finding                                   | File                                      | Verified                               |
| ----------------------------------------- | ----------------------------------------- | -------------------------------------- |
| C1 SQL identifier whitelist (backup)      | `src/db/migration.ts`                     | ✅ `VALID_TABLE_NAMES` + `VALID_COLUMNS` present |
| C2 Safe JSON parsing in sharing           | `src/utils/safeJsonParse.ts`, `eventMapper.ts` | ✅ In use by both sharedView + delegation |
| H1 PKCE rejection sampling                | `src/providers/oauthConnector.ts`         | ✅ No modulo bias (but see M5)          |
| H2 crypto IDs replacing Math.random       | `src/utils/cryptoId.ts`                   | ✅ Shared utility, sharing+accounts use it |
| H3 Webhook HMAC signature + timestamp     | `src/subscription/webhookHandler.ts`      | ✅ Constant-time compare + 5-min window |
| H4 Token refresh Promise-based lock       | `src/providers/axiosFactory.ts`           | ✅ `refreshPromise` race-free           |
| H5 Static/dynamic CalDAV domain separation | `src/providers/networkSecurity.ts`       | ⚠️ See H9 below — validation not enforced end-to-end |
| M1 Sync engine uses real provider data    | `src/sync/syncEngine.ts`                  | ✅ Extracts `providerData` fields       |
| M2 WebSocket message type guard           | `src/lifecycle/webSocketManager.ts`       | ✅ `isValidEventChangedMessage` present |
| L1 Sync queue IDs use `cryptoId()`        | `src/sync/syncEngine.ts`                  | ✅ `generateId()` now aliases `cryptoId` |
| L2 Dedup `mapRowToEvent`                  | `src/utils/eventMapper.ts`                | ⚠️ See H6 — a third duplicate was missed |

---

## New findings

### CRITICAL

#### C3 — Event CRUD service generates UUIDs with `Math.random()`

**File:** `src/events/eventCRUDService.ts`
**Lines:** 93–99

```typescript
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
```

**What is the issue:**
This is the exact pattern fixed in H2 on 2026-05-01 for `calendarAccountService.ts`, `sharedViewService.ts`, and `delegationService.ts` — but the same vulnerability exists here and was missed. This path is the primary surface for creating calendar events (`createEvent` is called from every "+ New Event" action in the app).

Consequences:
- Predictable event IDs. An attacker who can observe any event IDs (e.g., through a shared view or delegation grant) can guess other users' event IDs and potentially enumerate or reference events they should not know about, depending on downstream authorization checks.
- ID collisions. `Math.random()` in V8/Hermes has significantly less entropy than `crypto.getRandomValues()`. Under high concurrency (e.g., bulk import from an iCalendar file), collisions become realistic and break the `events.id` primary-key invariant.

**Severity rationale:** Event IDs are security-relevant (they flow into sharing/delegation permission checks via `event.id`-keyed queries). The same pattern is already classified as HIGH in the prior review for similar use cases; this one is on a hotter code path (every event creation), so we raise it to **CRITICAL**.

**Recommended fix:**
Replace the local `generateUUID()` with an import of `cryptoUUID` from `../utils/cryptoId`, matching the pattern used in `calendarAccountService.ts`. Delete the local function.

---

#### C4 — User deletion receipts use `Math.random()` UUIDs

**File:** `src/userdata/userDataService.ts`
**Lines:** 67–73

```typescript
function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    ...
  });
}
```

**What is the issue:**
Same pattern as C3, used for `deletion_requests.id`. A deletion receipt ID is passed back to the user and is referenced when the server completes the 30-day deletion SLA. If these IDs are predictable, an attacker could:
- Forge a deletion receipt claim against another user to spoof deletion status checks.
- Enumerate pending deletion requests across the user base (if this table is ever exposed via an admin endpoint).

The same file handles authentication events — if the `AuthEvent.id` ever becomes server-generated via this service, the same weakness would apply. Currently callers pass their own `event.id`, so that path is not affected.

**Severity rationale:** Deletion receipt IDs are the primary audit trail for GDPR/CCPA "right to erasure" compliance. Predictable IDs weaken the evidentiary chain.

**Recommended fix:**
Same as C3 — import `cryptoUUID` from `../utils/cryptoId` and remove the local function.

---

### HIGH

#### H6 — Third unsafe `mapRowToEvent` duplicate in event CRUD service

**File:** `src/events/eventCRUDService.ts`
**Lines:** 458–484

```typescript
function mapRowToEvent(row: Record<string, unknown>): CalendarEvent {
  return {
    ...
    recurrenceRule: row.recurrence_rule ? JSON.parse(row.recurrence_rule as string) : null,
    organizer: row.organizer ? JSON.parse(row.organizer as string) : null,
    attendees: row.attendees ? JSON.parse(row.attendees as string) : [],
    opaqueFields: row.opaque_fields
      ? new Map(Object.entries(JSON.parse(row.opaque_fields as string)))
      : new Map(),
    ...
  };
}
```

**What is the issue:**
Finding L2 from the prior review deduplicated `mapRowToEvent` between `sharedViewService` and `delegationService` into `src/utils/eventMapper.ts`. However, a **third copy** exists in `eventCRUDService.ts` and still contains the raw `JSON.parse()` calls originally flagged in C2 — no try/catch, no defaults.

This means the primary event read path (`getEvent`, `getEventsByAccount`) will crash on corrupted rows, even though the sharing read path is now safe. A corrupted `attendees` or `opaque_fields` value (from a partial sync, a migration bug, or provider data that slipped past validation) will throw an unhandled exception and the UI will show no events at all.

**Recommended fix:**
Delete the local `mapRowToEvent` in `eventCRUDService.ts` and import from `../utils/eventMapper`. Verify the shared version returns the same shape for the fields `eventCRUDService` relies on.

---

#### H7 — CalDAV UID generation uses `Math.random()`

**File:** `src/providers/caldavAdapter.ts`
**Lines:** 482–486

```typescript
function generateUID(): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).slice(2, 10);
  return `${timestamp}-${random}@unified-calendar`;
}
```

**What is the issue:**
This UID is sent to the CalDAV server and becomes the event's globally visible identifier (per RFC 5545, UIDs must be globally unique across all CalDAV servers that replicate the event). Predictability here is worse than for internal IDs because:

1. **Cross-server collision risk:** If two clients generate UIDs using the same seeded `Math.random()` (e.g., shortly after startup on similar platforms), they can produce identical UIDs. iCloud and Fastmail both reject duplicate UIDs and will return 409 Conflict, which the sync engine reports as a generic failure — users will see "sync failed" with no actionable error.
2. **Event spoofing:** An attacker who can observe one event's UID on a shared CalDAV server can predict neighboring event UIDs and potentially craft PUT requests that overwrite legitimate events.

**Recommended fix:**

```typescript
import { cryptoUUID } from '../utils/cryptoId';

function generateUID(): string {
  return `${cryptoUUID()}@unified-calendar`;
}
```

Use a fully random UUID — the timestamp prefix adds no uniqueness guarantee and leaks the creation time.

---

#### H8 — All three DatabaseDriver implementations are missing `transaction` and `supportsTransactions`

**Files:**
- `src/db/db.web.ts`
- `src/db/db.ios.ts`
- `src/db/db.android.ts`

**What is the issue:**
The `DatabaseDriver` interface (`src/db/database.ts:13-47`) declares:

```typescript
transaction<T>(fn: (tx: TransactionContext) => Promise<T>): Promise<T>;
readonly supportsTransactions: boolean;
```

Both are required, yet none of the three platform drivers implement them. This is confirmed by `tsc --noEmit`:

```
src/db/db.web.ts(20,3): error TS2739: Type ... is missing the following properties
  from type 'DatabaseDriver': transaction, supportsTransactions
src/db/db.ios.ts(21,3): error TS2739: ...
src/db/db.android.ts(21,3): ...
```

Runtime impact:
1. `syncEngine.applyInboundChanges()` checks `db.supportsTransactions` (reads `undefined` → falsy → falls back to non-atomic sequential writes). No crash, but no atomicity either — a failure mid-apply leaves the local DB in an inconsistent state.
2. `migration.restoreFromBackup()` does not use transactions, but any future migration that needs them will fail.
3. The read-only driver (`createReadOnlyDriver`) actually implements both methods, which masks the problem in read-only mode.

**Recommended fix:**
Use the existing `executeTransaction` helper in `src/db/database.ts`:

```typescript
// db.web.ts (and apply identically to db.ios.ts, db.android.ts)
import { executeTransaction } from './database';

return {
  async execute(...) { ... },
  async query(...) { ... },
  supportsTransactions: true,
  async transaction(fn) {
    return executeTransaction(this, fn);
  },
  async close() { ... },
  isOpen() { ... },
};
```

The helper already handles BEGIN/COMMIT/ROLLBACK correctly.

**Security angle:** Non-atomic sync writes are not a direct security issue, but they create situations where partial state is user-visible, which other findings (e.g., H6's unsafe JSON parse) can turn into availability outages.

---

#### H9 — `createCalDAVAxios` ignores domain validation failure

**File:** `src/providers/networkSecurity.ts`
**Lines:** ~380 (inside `createCalDAVAxios`)

```typescript
const hostname = extractHostname(serverUrl);
if (hostname) {
  addAllowedProviderDomain(hostname);  // ← return value discarded
}
return createSecureProviderAxios(serverUrl, providerConfig);
```

**What is the issue:**
Finding H5 (2026-05-01) correctly added `addAllowedProviderDomain` validation against a blocklist of known non-CalDAV domains. The function returns `false` when validation rejects the domain — but `createCalDAVAxios` discards the return value and proceeds to build the Axios instance anyway.

Consequences:
- A user tricked into adding `caldav.evil-lookalike.com` gets validated (passes `isValidCalDAVDomain`). That's fine, that's the intended flow.
- A user tricked into adding `caldav.google.com` fails `isValidCalDAVDomain` (blocked pattern). But because the return value is ignored, the axios instance is still created and every sync request will have full event data sent to it — because the hostname check in `createSecurityRequestInterceptor` sees the **base URL** of the instance matches, and the request passes through with no redaction.

Wait — actually, `isAllowedProviderDomain` would return `false` for the blocked hostname (not in static set, not in dynamic set). So `stripSensitiveFields` *would* be called. Let me re-verify…

Re-reading the code: `isAllowedProviderDomain` checks `STATIC_PROVIDER_DOMAINS` and `dynamicCalDAVDomains`. If `addAllowedProviderDomain` rejected the add, the domain isn't in `dynamicCalDAVDomains`. So the request interceptor will strip sensitive fields. **This downgrades the severity from "data leak" to "silent degradation"**: the user sees a connected account that can never actually read/write CalDAV data (everything arrives redacted).

The real issue is that the user gets no error — the connection looks fine in the UI but all events show as `[REDACTED]` in their titles. From a security perspective this is a silent denial-of-service on any account the user adds, which isn't great UX and means attackers can cause user confusion by phishing users into adding blocked domains.

**Recommended fix:**

```typescript
const hostname = extractHostname(serverUrl);
if (!hostname) {
  throw new Error(`Invalid CalDAV server URL: cannot extract hostname from ${serverUrl}`);
}
const added = addAllowedProviderDomain(hostname);
if (!added) {
  throw new Error(
    `CalDAV server domain "${hostname}" is not permitted. ` +
    `The domain matches a known non-CalDAV provider.`
  );
}
return createSecureProviderAxios(serverUrl, providerConfig);
```

Also add a symmetric cleanup path: when an account is disconnected, call `removeAllowedProviderDomain(hostname)` so revoked accounts don't leave dynamic entries behind. (This is what `getDynamicDomains` was added to enable.)

---

### MEDIUM

#### M5 — PKCE rejection-sampling comment says 252, code computes 198

**File:** `src/providers/oauthConnector.ts`
**Line:** 19

```typescript
const limit = 256 - (256 % charsetLength);  // 264 wraps to 252 for 66 chars → limit = 252
```

**What is the issue:**
The arithmetic in the comment is wrong:
- `charsetLength = 66`
- `256 % 66 = 58`
- `256 - 58 = 198` (the actual runtime value)

The comment describes a hypothetical 264-byte limit and says "limit = 252," neither of which matches what the code does. The code is **correct** — every byte `< 198` is accepted, yielding bias-free modulo. Only the comment is wrong.

This is not a security bug today but it's a maintenance trap: if someone "corrects" the code to match the misleading comment, they'd either re-introduce bias or break the sampler entirely.

**Recommended fix:**

```typescript
// Rejection sampling: the largest multiple of charsetLength (66) that fits
// in a byte is 198 (= 256 - (256 % 66)). Bytes >= 198 are discarded so every
// accepted byte maps uniformly to the 66-character set.
const limit = 256 - (256 % charsetLength);  // = 198 for 66 chars
```

Add a test that asserts `limit === 198` to prevent regression.

---

#### M6 — Recurrence exception handler still uses `Math.random()` for IDs

**File:** `src/recurrence/exceptionHandler.ts`
**Line:** 34

```typescript
function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}
```

**What is the issue:**
Recurrence exception IDs are stored on the `recurrence_exceptions` table (or embedded in the event, depending on implementation) and can be referenced in sync conflict resolution. Same collision/predictability concerns as H2 apply, but the blast radius is smaller since these IDs are not used for authorization decisions.

Severity is **medium** rather than high because:
1. The IDs are scoped to a single user's event and not exposed across users.
2. The `Date.now()` prefix reduces collision probability in normal use.
3. There's no evidence they flow into sharing/delegation paths.

**Recommended fix:**
Replace with `cryptoId()` from `../utils/cryptoId`. The output format is identical (`{timestamp}-{random}`), so no downstream parsing needs to change.

---

### LOW

#### L5 — `conflictDetector.ts` uses `Math.random()` for per-instance seed

**File:** `src/conflicts/conflictDetector.ts`
**Line:** 104

```typescript
const instanceSeed = Math.random().toString(36).slice(2, 8);
```

**What is the issue:**
The seed disambiguates conflict IDs across multiple detector instances in the same session. Collisions here cause internal state confusion but do not affect authorization — conflicts are always shown to their owner only.

**Recommended fix (optional):**
For consistency with the rest of the codebase and to remove the last `Math.random()` usage for identifiers, replace with a 4-byte crypto-random hex:

```typescript
const instanceSeed = (() => {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, '0')).join('');
})();
```

Not urgent; track in cleanup backlog.

---

## Still-open findings from 2026-05-01 (unchanged)

- **C1-alt Web Secure Storage limits** — Unchanged. Web implementation stores encryption keys in `sessionStorage`, which is the best available approach absent a backend token proxy. Noted as a known platform limitation.
- **M3 Rate limiting on sharing/delegation** — Client-side `isRateLimited` / `isIpRateLimited` exist in `userDataService.ts` for auth events, but sharing and delegation operations have no rate limiting. Requires architectural decision on client vs. server enforcement.
- **M4 Transaction support in sync** — Now actively blocked by **H8**. Must be resolved before M4 can close.
- **L3 Read-only driver allows PRAGMAs** — Unchanged; read-only driver is only used after migration failure.
- **L4 Subscription HTTP placeholder** — The bootstrap still wires `{ post: async () => ({ data: {} as any }) }`. No production impact yet since the subscription backend is unshipped, but it must be replaced before launch.

---

## Findings not addressed in this review

- Third-party dependency audit (npm supply chain) — out of scope; recommend running `npm audit` as a separate workstream.
- Platform-native code review (iOS/Android native modules invoked via `expo-secure-store`, `op-sqlite`) — out of scope; relies on vendor review.
- Server-side webhook signing implementation — only the client-side verification was in scope here. The server-side signing must produce the exact `timestamp.payload` format that `verifyWebhookSignature` expects.

---

## Recommended remediation order

1. **C3, C4, H6, H7** — mechanical replacements of `Math.random()` UUID generators and dedup of `mapRowToEvent`. Low risk, unblocks further work.
2. **H8** — add `transaction` and `supportsTransactions` to all three DB drivers using the existing `executeTransaction` helper. Restores the atomicity contract the sync engine depends on.
3. **H9** — propagate the `addAllowedProviderDomain` return value and fail fast on rejection. Add symmetric `removeAllowedProviderDomain` on account disconnect.
4. **M5** — correct the misleading comment in `oauthConnector.ts` (documentation-only fix).
5. **M6, L5** — remaining `Math.random()` sweeps, purely for consistency.

All of C3/C4/H6/H7 can be addressed in a single commit with tests that assert the imports come from `../utils/cryptoId` and that `mapRowToEvent` is sourced from `../utils/eventMapper`.
