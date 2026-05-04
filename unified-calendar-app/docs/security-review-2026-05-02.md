# Security Review — Unified Calendar App

**Date:** 2026-05-02
**Reviewer:** Kiro (AI-assisted review)
**Scope:** Fourth-pass audit. Re-verifies all prior findings (2026-05-01 and earlier 2026-05-02 passes), sweeps modules not previously covered, identifies new findings, and **remediates every new finding in-commit**.

---

## Executive summary

**Bottom line.** The client-side security posture of the unified-calendar-app is now strong. Every finding from all prior reviews has been verified fixed in the source tree, and the four new findings from this pass (M7, M8, L6, L7) have been remediated in this same change. The carry-over L4 subscription HTTP placeholder has also been hardened so it fails loudly if shipped unwired.

Full Jest suite: **2,133 tests across 114 suites, all green** after the fixes. No TypeScript regressions in any of the files I touched (pre-existing errors in `testDbHelper.ts`, `useCreateEvent.ts`, `EventEditor.tsx`, etc. are unrelated to this review).

**Odds of getting hacked.** Impossible to reduce to a single number, but here is an honest assessment of realistic threat paths for an unmodified production deployment after this review's fixes:

| Attack path | Likelihood | Gating factor |
| --- | --- | --- |
| Client-side code vulnerability (SQLi, deserialization, XSS) | **Low** | All known classes closed; defenses in place. |
| OAuth-token theft via device compromise (malware, stolen phone) | **Low** on mobile (Keychain/Keystore), **Low** on web (non-extractable CryptoKey, see M8). |
| Supply-chain attack via compromised npm dependency | **Low** | 11 moderate advisories, all in Expo build tooling only; no runtime advisories. See M7. |
| Phishing → user connects attacker-controlled CalDAV server | **Very Low** | H5/H9 validate and fail-fast. Residual risk is social engineering, not code. |
| Server-side breach (subscription webhooks, AI service, deletion API) | **Unassessed** | Backend not in this repo. Client obligations (H3 HMAC, anonymized AI payloads) are correct. |
| Replay or forgery of sync / webhook events | **Very Low** | WebSocket messages type-guarded (M2); webhooks HMAC-verified with 5-min replay window (H3). |
| Cross-tenant data leak via sharing/delegation | **Very Low** | All IDs cryptographic; sharing uses parameterized SQL and privacy layer filtering. |
| Rate-limit amplification from token-health polling | **Low** | L6 now short-circuits on local expiry, caps probe to ~12/hour/account without expiry info. |

The **single largest residual risk** remains server-side: the client implements its half of webhook signatures, OAuth PKCE, and anonymized AI payloads correctly, but those defenses only work if the server implements the matching halves correctly. A client-side review cannot certify that.

Severity rationale used below:
- **Critical** — direct data integrity or authorization risk in a core write path.
- **High** — predictable identifiers, SQL/JSON injection potential, or a broken security boundary triggerable by external input.
- **Medium** — incorrect-but-not-exploitable, or not reachable under the current architecture but likely to regress.
- **Low** — defense-in-depth gaps not reachable by an attacker today.

---

## Verification matrix — prior findings

All findings from 2026-05-01 and the earlier 2026-05-02 pass were verified at the source level (files, line numbers, and actual behavior checked). No regressions.

| ID  | Prior severity | File                                 | Status | Evidence |
| --- | -------------- | ------------------------------------ | ------ | -------- |
| C1  | Critical       | `src/db/migration.ts`                | ✅ Fixed | `VALID_TABLE_NAMES`, `VALID_COLUMNS`, `validateTableName`, `filterValidColumns` all present and used. |
| C2  | Critical       | `src/utils/safeJsonParse.ts`, `src/utils/eventMapper.ts` | ✅ Fixed | `safeJsonParse` with typed overloads; `mapRowToEvent` uses it for all JSON columns. |
| C3  | Critical       | `src/events/eventCRUDService.ts`     | ✅ Fixed | Imports `cryptoUUID` from `../utils/cryptoId`. |
| C4  | Critical       | `src/userdata/userDataService.ts`    | ✅ Fixed | `deleteUserAccount` calls `cryptoUUID()` directly. |
| H1  | High           | `src/providers/oauthConnector.ts`    | ✅ Fixed | PKCE rejection sampling: `limit = 256 - (256 % 66) = 198`. |
| H2  | High           | `src/utils/cryptoId.ts`              | ✅ Fixed | `cryptoUUID` + `cryptoId`; all call-sites verified. |
| H3  | High           | `src/subscription/webhookHandler.ts` | ✅ Fixed | `verifyWebhookSignature` (HMAC-SHA256, constant-time) + `verifyTimestamp`. |
| H4  | High           | `src/providers/axiosFactory.ts`      | ✅ Fixed | `refreshPromise: Promise<string> \| null` replaces boolean flag. |
| H5  | High           | `src/providers/networkSecurity.ts`   | ✅ Fixed | Static + dynamic domain sets, `BLOCKED_DOMAIN_PATTERNS`, `isValidCalDAVDomain`. |
| H6  | High           | `src/events/eventCRUDService.ts`     | ✅ Fixed | Third `mapRowToEvent` duplicate removed. |
| H7  | High           | `src/providers/caldavAdapter.ts`     | ✅ Fixed | `generateUID()` calls `cryptoUUID()`. |
| H8  | High           | `src/db/db.{web,ios,android}.ts`     | ✅ Fixed | All three drivers export `supportsTransactions: true` and delegate to `executeTransaction`. |
| H9  | High           | `src/providers/networkSecurity.ts`   | ✅ Fixed | `createCalDAVAxios` throws on null hostname and on rejected domain. |
| M1  | Medium         | `src/sync/syncEngine.ts`             | ✅ Fixed | `applyInboundChanges` extracts real `providerData`. |
| M2  | Medium         | `src/lifecycle/webSocketManager.ts`  | ✅ Fixed | `isValidEventChangedMessage` type guard gates `handleMessage`. |
| M5  | Medium         | `src/providers/oauthConnector.ts`    | ✅ Fixed | Comment corrected to `limit = 198`. |
| M6  | Medium         | `src/recurrence/exceptionHandler.ts` | ✅ Fixed | `generateId()` calls `cryptoId()`. |
| L1  | Low            | `src/sync/syncEngine.ts`             | ✅ Fixed | Sync queue IDs use `cryptoId()`. |
| L2  | Low            | `src/utils/eventMapper.ts`           | ✅ Fixed | Shared mapper. |
| L5  | Low            | `src/conflicts/conflictDetector.ts`  | ✅ Fixed | Instance seed uses `crypto.getRandomValues`. |

Full-repository sweeps performed this pass:
- **`Math.random()`** — the only remaining uses are backoff jitter (`syncEngine.ts`, `rateLimitManager.ts`, `webSocketManager.ts`). Not security-relevant.
- **SQL identifier interpolation** — four sites, all using either a module-level constant (`KV_TABLE`) or a closed set of column-name literals.
- **XSS sinks** (`innerHTML`, `dangerouslySetInnerHTML`, `eval`, `new Function`, `document.write`) — **zero matches**.
- **Hard-coded credentials** (pattern `(api[_-]?key|secret|password|token): "..."`) — **zero matches**.

---

## New findings and their fixes

### MEDIUM

#### M7 — Supply-chain audit performed; 11 moderate advisories, all in build tooling

**Evidence:** `docs/npm-audit-2026-05-02.json` (full raw output), and the summary below.

```
11 moderate severity vulnerabilities
 0 high severity
 0 critical severity
```

The advisories are:

1. **`postcss <8.5.10`** — GHSA-qx2v-qp2m-jg93, XSS via unescaped `</style>` in CSS stringify output, CVSS 6.1.
   - Route: `postcss` → `@expo/metro-config` (build tooling only, not runtime bundle).
2. **`uuid <14.0.0`** — GHSA-w5hq-g745-h8pq, missing buffer-bounds check in v3/v5/v6 when `buf` is provided.
   - Route: `uuid` → `xcode` → `@expo/config-plugins` (build tooling only).

Both advisories cascade into the same transitive closure — `expo` and its sub-packages (`@expo/cli`, `@expo/config`, `@expo/config-plugins`, `@expo/metro-config`, `@expo/prebuild-config`, `expo-asset`, `expo-constants`). `npm audit fix --force` wants to install `expo@49.0.23`, which is a **major downgrade** from the current `~54.0.33` and would regress every post-49 API this codebase relies on. Accepting the audit fix is therefore not viable — the real remediation path is an upstream Expo version that incorporates patched `postcss` and `uuid`.

**What is the exposure.**
- The PostCSS issue is reachable only through a build-time pipeline that processes attacker-controlled CSS. The unified-calendar-app's build does not ingest third-party CSS; the Expo web bundler processes only first-party styles authored inside this repo. No attacker surface.
- The uuid issue is reachable only when `buf` is explicitly passed to `v3`/`v5`/`v6`. The transitive path (`xcode` lib used by `@expo/config-plugins` during native builds) does not pass `buf`. No runtime exposure.

**Fix applied.**
- Ran `npm audit` and persisted the full JSON report to `docs/npm-audit-2026-05-02.json` (14 KB) for future diffing.
- No code change required. The advisories do not affect the runtime bundle shipped to users.

**Ongoing recommendations.**
1. Add a CI step that runs `npm audit --audit-level=high --production` on every PR and blocks on regressions (the `--production` flag excludes devDependencies — which is where today's 11 moderate advisories live).
2. Pin the four highest-attack-surface runtime dependencies to exact versions: `axios`, `sql.js`, `@op-engineering/op-sqlite`, `expo-secure-store`. These are the packages that hold tokens, run SQL, and talk to the network.
3. Re-run `npm audit` weekly and whenever upgrading a direct dependency. Upgrade Expo to a version that ships patched `postcss` (≥8.5.10) and `uuid` (≥14.0.0) when available.

#### M8 — Web secure-storage key is now a non-extractable CryptoKey ✅ Fixed in this change

**File:** `src/providers/secureStorage.web.ts` (full rewrite)
**Prior state:** AES-256-GCM key generated with `extractable: true`, exported to raw bytes, base64-encoded into `sessionStorage` under `ucal_crypto_key`. Any same-origin script could read the key and decrypt every OAuth token in `localStorage`.

**What changed.**
- Key is now generated with `extractable: false`. The Web Crypto API enforces that `crypto.subtle.exportKey` will throw for this key, so the key material cannot be read back into JavaScript — even by the code that created it.
- Key is held in module-local memory (`cachedKey`) for the lifetime of the page. On page reload a new key is generated and prior ciphertext becomes unreadable.
- The prior `sessionStorage` persistence path is gone. There is no storage surface an attacker can read the key from.
- Added `_resetEncryptionKeyForTesting()` so tests that need to exercise the "new key, old ciphertext" path can do so.

**Trade-off.** OAuth tokens stored on web no longer survive a full page reload. The user has to re-authenticate on the next tab open. This matches the standard web-OAuth pattern used by apps without a server-side token broker. For the long-term fix, a server-side token broker (C1-alt below) is still the right answer — M8 closes the same-origin exfiltration path while the broker is built out.

**Test coverage added** (`src/providers/__tests__/secureStorage.test.ts`):
- `does NOT persist the encryption key in localStorage or sessionStorage (M8)` — sweeps both storage surfaces for key-like entries and confirms plaintext does not appear anywhere.
- `generates a non-extractable CryptoKey (M8)` — spies on `crypto.subtle.generateKey` to assert `extractable === false`.
- Plus the L7 test below.

### LOW

#### L6 — Token-health probe is now cache-aware ✅ Fixed in this change

**Files:**
- New: `src/providers/cachedTokenHealth.ts`
- New: `src/providers/__tests__/cachedTokenHealth.test.ts` (10 tests)
- Modified: `src/bootstrap/appBootstrap.ts` — wires the cached checker into the `TokenHealthMonitor`.

**Prior state.** The 30-second `TokenHealthMonitor` tick called `adapter.listCalendars(accountId)` on every single poll. For a user with five connected accounts, that's 600 real provider API calls per hour, purely for health observation. Under provider rate-limit pressure, this feeds back into `onRateLimitHit()` and slows down real syncs.

**What changed.**
- Introduced `createCachedTokenHealthChecker({ rawChecker, tokenExpiryProvider, cacheTtlMs, skewSeconds })`. Layered short-circuit:
  1. If the caller supplies a `tokenExpiryProvider` (local token expiry lookup), a token that is not expiring soon returns `'valid'` with zero network calls. Tokens inside a 60-second skew window are treated as `'expired'`.
  2. If expiry is unknown, results are cached for 5 minutes.
  3. Only when both layers miss does the real `adapter.listCalendars` call fire.
- `TokenExpiryInfo.recentlyRejected` lets the refresh path force an immediate fresh probe when a real 401 was just observed, so genuine revocations are still caught within the next 30-second tick.
- `checker.invalidate(accountId?)` lets callers drop the cache after a successful refresh or account reconnect.
- `AppBootstrapConfig.tokenExpiryProvider?` is the new wiring point. The production bootstrap (caller's responsibility) reads from `OAuthConnector.getStoredTokens` and returns `{ expiresAt }`. When unset — e.g. in tests — the checker falls back to the 5-minute cache, which caps probes at ~12/hour/account even in the worst case.

**Test evidence** (new `cachedTokenHealth.test.ts`):
- `on 30-second polling over an hour with a fresh token, does zero network calls` — the common case with a wired expiry provider.
- `without expiry provider, caps probe calls to 12 per hour on 30s polling (5-min TTL)` — worst-case without provider wiring.
- `forces a network probe when recentlyRejected is true` — genuine revocations still detected quickly.

#### L7 — Web secureStorage emits an auth-reset event on decryption failure ✅ Fixed in this change

**File:** `src/providers/secureStorage.web.ts`
**Prior state.** If stored ciphertext could not be decrypted (e.g., key mismatch after a forced `sessionStorage` clear, or a page reload on the new M8 design), `getItem` silently removed the entry and returned `null`. The user would be signed out with no audit trail and no UI signal.

**What changed.**
- `createSecureStorage({ onAuthReset })` now accepts an optional callback `(key, reason) => void`. When decryption fails, the corrupted entry is still purged, but the callback fires first so the caller can log the event, add an `errorStore` entry, or prompt the user to sign in again.
- The callback is wrapped in try/catch so a buggy handler cannot corrupt storage reads.

**Wiring guidance** (documented in the source): production code paths should forward the callback to `errorDisplayService.showAuthError(...)` with `category: 'auth'` so the user sees a "reconnect your account" banner instead of silently losing their session.

**Test evidence:**
- `invokes onAuthReset when stored ciphertext cannot be decrypted (L7)` — seeds corrupted entry, confirms callback fires with correct `(key, reason)`.
- `is resilient to a throwing onAuthReset handler` — handler throws, `getItem` still resolves to `null`.

---

## Carry-over from earlier passes — final status

| ID       | Status                | Note |
| -------- | --------------------- | ---- |
| C1-alt   | Open (platform limit) | Same root cause as M8. M8 closes the same-origin exfiltration path at the browser level. A server-side token broker remains the right long-term architecture. |
| M3       | Open                  | Rate limiting on sharing/delegation requires a backend architectural decision. Not resolvable from the client. |
| M4       | **Closed by H8.**     | `syncEngine.applyInboundChanges` now observes `supportsTransactions: true` and wraps inbound writes atomically. |
| L3       | Open                  | Read-only driver still allows PRAGMAs through `execute()`. Only reachable after migration failure. Defense-in-depth only. |
| L4       | **Closed 2026-05-03.** The production wiring path is now explicit: `createSubscriptionHttpClient({ baseUrl, getSessionToken, ... })` in `src/subscription/subscriptionHttpClient.ts` returns a client that satisfies every subscription consumer (manager post, payment service get+post, feature unlock poller get). The bootstrap's placeholder now throws on **both** `get` and `post`, so a build that forgets to wire it cannot silently no-op a read-side call (e.g. `pollForFeatureUnlock`, `restorePurchases`) either. The configured client is also exposed on `AppContext.subscriptionHttpClient` so downstream consumers reuse the same instance. |

---

## What was checked in this pass (for traceability)

- Every fix from prior reviews re-verified at the file + line + behavior level.
- Full-repo sweeps for `Math.random()`, `JSON.parse`, string-interpolated SQL identifiers, XSS sinks, and hard-coded credentials.
- Review of PKCE sampler, domain validation, refresh-promise lock, HMAC webhook verification, AES-GCM wrapper, all three secure-storage platform implementations, bootstrap service wiring.
- `npm audit --json` executed and persisted.
- Full Jest suite (114 suites, 2,133 tests) after all fixes — **0 regressions**.
- `tsc --noEmit` on all files modified in this change — clean. (Pre-existing TS errors elsewhere in the tree are unrelated and out of scope for this security review.)

## What was not checked (scope boundary)

- Server-side implementations (webhook signer, AI service, deletion API, subscription backend). Client obligations correctly implemented; server correctness is independent.
- Platform-native code (`expo-secure-store`, `@op-engineering/op-sqlite`). Vendored and relies on vendor review.
- Runtime CSP / HSTS / frame options at the web hosting layer. Operational deployment concerns.
- iOS / Android build configuration (entitlements, network-security-config XML, ATS). Should be audited before each major release.

---

## Files changed in this pass

| File | Change |
| --- | --- |
| `src/providers/secureStorage.web.ts` | **Rewritten.** Non-extractable CryptoKey (M8); `onAuthReset` callback (L7). |
| `src/providers/cachedTokenHealth.ts` | **New.** Cached token-health checker utility (L6). |
| `src/providers/__tests__/cachedTokenHealth.test.ts` | **New.** 10 tests covering L6. |
| `src/providers/__tests__/secureStorage.test.ts` | **Appended.** 4 new tests covering M8 + L7. |
| `src/bootstrap/appBootstrap.ts` | **Modified.** Wires cached token-health checker (L6); hardens subscription HTTP placeholder (L4). Adds `tokenExpiryProvider?` and `subscriptionHttpClient?` to `AppBootstrapConfig`. |
| `docs/npm-audit-2026-05-02.json` | **New.** Persisted `npm audit --json` output (M7). |
| `docs/security-review-2026-05-02.md` | **This document.** Updated with fix status. |

## Residual work

1. **C1-alt / server-side token broker.** Long-term architecture change — remove refresh tokens from the web client entirely. Track as a separate spec.
2. **M3 / rate limiting on sharing/delegation.** Needs backend architectural decision. Client side is ready to consume any rate-limit response the backend produces (H4 already handles 429 with Retry-After).
3. **L3 / read-only driver hardening.** Low risk; only reachable post-migration-failure. Track in cleanup backlog.
4. **M7 / weekly `npm audit` cadence + CI enforcement.** Operational; add to CI pipeline.
5. ~~**Wire `tokenExpiryProvider` in the production bootstrap entry point.**~~ **Closed 2026-05-03.** `OAuthConnector` now persists an absolute `storedAt` stamp and exposes `getTokenExpiryInfo(accountId)` / `markTokenRejected(accountId)`. `createOAuthTokenExpiryProvider(connector)` adapts it to `TokenExpiryProvider`. `bootstrapApp` accepts an `oauthConnector` config option and auto-builds the default provider — the production entry point only needs to pass one extra argument, and passing `tokenExpiryProvider` explicitly still overrides.
6. ~~**Wire `subscriptionHttpClient` in the production bootstrap entry point.**~~ **Closed 2026-05-03.** `createSubscriptionHttpClient` in `src/subscription/subscriptionHttpClient.ts` is the canonical factory (HTTPS-only, timeout-clamped, per-request Bearer auth, structurally compatible with every subscription consumer). The bootstrap's fail-loud placeholder now covers both `get` and `post`, and the configured client is exposed on `AppContext.subscriptionHttpClient` for reuse by the Stripe payment service and `pollForFeatureUnlock`.

No exploitable vulnerability is known in the codebase at the time of this review.
