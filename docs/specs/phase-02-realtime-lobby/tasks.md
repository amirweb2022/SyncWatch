# Phase 2: Realtime Lobby Management — Task Plan

Tasks are ordered by dependencies and intended as small independently verifiable slices. Each task follows RED → GREEN → REFACTOR: add one behavior-focused failing test at the agreed seam, make only the minimum change that passes it, then refactor while keeping the test green. Do not write a batch of imagined tests ahead of each slice. Implementation must update this file and `progress.md` after each task.

## 01 — Lobby identity and code policy

**Status:** Complete

**Implementation record:** Added `lib/code.ts`, centralized the code alphabet and display-name limit in `lib/config.ts`, and added `tests/lobby-identity.test.ts`. RED: 6 tests failed because the helpers were absent. GREEN: all 6 passed after implementing validation, NFC display-name normalization, rejection-sampled codes, and random per-tab member IDs. REFACTOR: factored secure byte sourcing and discriminated validation results; all focused tests, typecheck, and lint passed. Remaining risk: the optional Supabase integration work is not part of this task; cryptographic randomness unavailable in a browser throws an explicit error.

**Blocked by:** None

**Delivers:** Display-name normalization (NFC, trim, 1–40 Unicode code points, no controls), session member identity, and six-character code generation/validation using the exact alphabet `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` and unbiased random index selection.

**RED → GREEN → REFACTOR**

1. RED: add tests for exact length/alphabet, case normalization, invalid characters, whitespace/empty/oversized/control-containing names, NFC normalization, and rejection-sampling boundaries using injected randomness.
2. GREEN: implement the smallest pure helpers and browser-safe secure code source needed to satisfy those tests; retain the single config constants.
3. REFACTOR: simplify contracts and make invalid-input outcomes explicit without changing behavior.

**Verification:** Vitest unit tests; strict typecheck.

## 02 — Typed realtime contracts and runtime parsing

**Status:** Complete

**Implementation record:** Added `PresenceMetadata`, `parsePresenceMetadata(unknown)`, and `parseRealtimeEvent(unknown)` in `lib/realtime/events.ts`; retained the exact PRD `RealtimeEvent` union and enabled no event behavior. Parser results are normalized immutable values; identifiers, nested RTC fields, timestamps, and string lengths are validated. RED: valid targeted-offer test failed because parser was absent. GREEN: parser added and all 11 new event/presence tests passed. REFACTOR: consolidated runtime guards and removed unsafe type assertions. Verification: focused Tasks 01–02 tests 17/17 passed; strict typecheck and lint passed.

**Blocked by:** 01

**Delivers:** Presence metadata types and runtime validation of the PRD's existing Broadcast event union, without adding a Phase 2-only event or enabling later-phase behavior.

**RED → GREEN → REFACTOR**

1. RED: add parser tests for each PRD event variant plus missing fields, wrong types, unknown type, invalid IDs/timestamps, malformed nested RTC data, and excess string lengths.
2. GREEN: preserve the PRD event contract and add parsing/validation functions accepting `unknown`; Presence uses its separate metadata parser.
3. REFACTOR: remove duplicated guards and ensure outputs are normalized immutable values.

**Verification:** Vitest unit tests; strict typecheck. No WebRTC/chat event behavior is added.

**Next action:** Task 04 — implement the public Supabase browser configuration and channel adapter.

## 03 — Presence normalization, capacity policy, and host election

**Status:** Complete

**Implementation record:** Added `lib/realtime/presence-policy.ts` with pure snapshot normalization/deduplication, observed-capacity admission decisions, and deterministic host derivation. Tightened `parsePresenceMetadata` to apply Task 01 display-name rules (NFC, trim, 1–40 Unicode code points, no controls) and reject non-finite timestamps. RED: initial focused suite failed because the policy module was absent; a subsequent edge-case run caught a test/implementation discrepancy around invalid timestamps, resolved by asserting malformed snapshot metadata is excluded and election puts any directly supplied invalid timestamp after valid timestamps. GREEN: all 7 Task 03 cases pass. REFACTOR: consolidated policy around the existing strict Presence parser and retained pure return values. Final verification: Task 03 plus Task 01/02 focused tests passed (24/24); `npm run typecheck` and `npm run lint` passed. Capacity is an observed snapshot decision only, not atomic enforcement; host is derived locally and is not authoritative across clients with different snapshots or clocks.

**Delivers:** Pure policy for turning Supabase Presence snapshots into unique members, best-effort admission decisions, and a deterministic current host.

**RED → GREEN → REFACTOR**

1. RED: test empty/one/two/full snapshots, duplicate IDs and metadata tie-breaks, malformed records, missing timestamps, equal timestamps, client clock skew ordering, and host removal/succession.
2. GREEN: implement snapshot normalization, observed-capacity decision, and host derivation using the documented ID tie-breaker.
3. REFACTOR: keep decisions pure and ensure invalid records cannot become host or count toward capacity.

**Verification:** Vitest unit tests. Include explicit tests that capacity decisions are only against a supplied observed snapshot, not atomic guarantees.

**Next action:** Task 04 — Supabase browser configuration and channel adapter.

## 04 — Supabase browser configuration and channel adapter

**Blocked by:** 02

**Delivers:** A browser-only adapter that creates a public Realtime channel for a lobby code and exposes typed subscription, initial Presence sync, tracking, untracking, and removal behavior behind a narrow seam.

**RED → GREEN → REFACTOR**

1. RED: add interface-level tests for missing config, public-channel configuration/permission failures, subscription and initial-sync status mapping, event payload validation, listener detachment, and idempotent resource removal using a channel adapter fake.
2. GREEN: implement client/channel construction and the minimum adapter operations required by those tests.
3. REFACTOR: keep Supabase specifics inside the adapter and prevent raw channel objects from reaching UI/store callers.

**Verification:** unit/interface tests and strict typecheck; real channel semantics remain for integration tests in Task 08.

**Implementation record:** Completed in `lib/realtime/client.ts` and `lib/realtime/channel.ts`, with behavior coverage in `tests/realtime-channel.test.ts`. RED: all 13 initial focused cases failed because Task 04 exports were absent. GREEN: configuration and public channel adapter implemented; tests cover malformed/missing config, public topic and Presence key, subscription/initial sync/status errors, Broadcast runtime validation, presence track/untrack failures, detachment, and repeated removal. REFACTOR: channel handlers are inert after detach; Supabase client/channel remain private to the adapter. Final: focused + Tasks 01–03 tests 37/37, full `npm test` 37/37, typecheck and lint passed. Live Supabase semantics remain unverified and belong to Task 08.

**Next action:** Task 05 — create and join lobby session.

## 05 — Create and join lobby session

**Status:** Complete

**Implementation record:** Added `lib/realtime/session.ts` and `tests/lobby-session.test.ts`. RED: the initial focused suite failed because the session interface was absent. GREEN: the session validates input before channel allocation, creates with bounded collision retries, joins only from an existing validated Presence snapshot with observed capacity checks, confirms self Presence before reporting joined, and cleans rejected/failed attempts. REFACTOR: session owns adapter lifecycle and publishes immutable snapshots with normalized members and derived host. Task 05 focused tests: 7/7 passed; full `npm test`: 44/44 passed; `npm run typecheck` and `npm run lint` passed. Limitations: admission/capacity remains a non-atomic observation and simultaneous creators can collide; Task 05 does not implement leave/reconnect policy beyond basic disposal, which remains Task 06/07. No live Supabase integration was run; Task 08 covers it.

**Blocked by:** 01, 02, 03, 04

**Delivers:** A visitor can create an ephemeral lobby, or join only when initial Presence sync shows an existing member; joined state requires successful tracking and confirmation alongside an existing member.

**RED → GREEN → REFACTOR**

1. RED: add session-interface tests for valid create, join with an existing member, join to an empty channel rejection, invalid input without allocation, full observed snapshot rejection, create collision retry bound, and setup failure cleanup.
2. GREEN: implement create and join lifecycle through initial sync and confirmation, using current Presence as best-effort admission input.
3. REFACTOR: centralize partial-session cleanup and make result/state transitions explicit.

**Verification:** interface tests with adapter fake, focused pure tests, strict typecheck.

**Next action:** Task 06 — Leave, Presence updates, and host migration.

## 06 — Leave, Presence updates, and host migration

**Status:** Complete (build verification blocked by existing package metadata)

**Blocked by:** 05

**Delivers:** Members see current normalized Presence and derived host changes; leaving removes own presence and releases the session safely.

**RED → GREEN → REFACTOR**

1. RED: test Presence sync replacement, duplicate metadata precedence, stale/unknown display while disconnected, member deduplication, host succession after departure, repeated leave/dispose, partial setup cleanup, and stale callback suppression.
2. GREEN: implement snapshot updates and idempotent cleanup through the session interface.
3. REFACTOR: reduce lifecycle branching while preserving generation-token protection and cleanup guarantees.

**Verification:** interface tests with adapter fake; focused Presence/election unit tests.

**Implementation record:** Updated `lib/realtime/session.ts` and `tests/lobby-session.test.ts`. RED: added interface tests for live sync replacement/deduplication and host succession, stale roster behavior after channel loss, repeated leave cleanup, late callback suppression, connection loss during untrack, and empty-session leave. Focused RED run: 2 new behavior tests failed (roster did not refresh; connection loss did not mark presence stale); 11 existing/setup-cleanup tests passed. GREEN: session now publishes normalized roster and derives host on every valid sync, marks retained Presence stale on channel failure, and safely serializes concurrent leave calls while attempting untrack/removal once. REFACTOR: explicit lifecycle stage union, preserved generation guard, and retained the last published roster as stale while reconnecting; no retry behavior added. Focused Task 06 tests 13/13 pass; full `npm test` 50/50, `npm run typecheck`, and `npm run lint` pass. `npm run build` fails before compilation because the existing `package.json` has a leading BOM, which Next.js rejects while parsing its `name`; package metadata was not changed as unrelated. Remaining risks: real Supabase Presence ordering/removal and disconnection semantics remain unverified; service-managed expiry; retry behavior is Task 07; host remains locally derived and can differ across snapshots. Next pending task: 07 — Reconnection and retry behavior.

## 07 — Reconnection and retry behavior

**Status:** Complete

**Blocked by:** 05, 06

**Delivers:** Active sessions show reconnecting state, retry subscription with bounded backoff, restore Presence once after reconnection, or expose an actionable terminal error.

**RED → GREEN → REFACTOR**

1. RED: test five-attempt retry boundary, full-jitter delay bounds and cap, one active retry timer, recovery reusing memberId but refreshing joinedAt, own stale key excluded from other-member capacity, presence-expiry rejoin, full-lobby recovery refusal, exhausted retry state, manual retry, old-channel cleanup, and ignored old-generation callbacks.
2. GREEN: implement bounded retry/backoff and recovery through the same session interface.
3. REFACTOR: isolate timer/backoff policy and ensure leave cancels all pending reconnect work.

**Verification:** deterministic interface tests with injected scheduler/adapter; strict typecheck.

**Implementation record:** Extended `lib/realtime/session.ts` with automatic recovery through the existing LobbySession seam and added `lib/realtime/retry-policy.ts`; expanded `tests/lobby-session.test.ts`. RED: five new lifecycle tests failed because automatic reconnect and timer cancellation were missing; the pure backoff test failed with the helper module absent. GREEN: added at most five automatic attempts with exponential full jitter (`[0, min(500ms × 2^(attempt−1), 8s)]`), one injected timer at a time, recovery using the same member ID and a fresh `joinedAt`, stale own Presence exclusion from capacity, recovery after Presence expiry, capacity checks before and after tracking, full-lobby refusal, retryable exhausted state, and explicit manual retry. REFACTOR: isolated the retry policy, ensured leave cancels the pending timer and removes the channel, and ignored callbacks from replaced channels/generations. Task 07 focused tests: 19/19 passed; full `npm test`: 56/56; `npm run typecheck`, `npm run lint`, and `npm run build` passed. Remaining limitations: mocked adapters do not verify live Supabase reconnect/Presence semantics; capacity remains best-effort and non-atomic; automatic recovery cannot guarantee service availability. Next pending task: 08 — Supabase create/join and admission integration verification.

## 08 — Supabase create/join and admission integration verification

**Status:** Complete

**Blocked by:** 05

**Delivers:** Evidence that actual public Supabase channels support create, join-existing, empty-channel rejection, and observed full-lobby behavior; documents that concurrent capacity remains best-effort.

**RED → GREEN → REFACTOR**

1. RED: add opt-in scenarios using separate browser clients for create, join-existing, empty-channel rejection, ordinary third-client full UX, and concurrent join attempts.
2. GREEN: configure the harness against a dedicated project with public channels enabled; adjust implementation to match observed service behavior without asserting atomic capacity under concurrent joins.
3. REFACTOR: use bounded condition-based waits and document project permissions, credentials, channel cleanup, and the concurrency limitation.

**Verification:** run integration suite against dedicated test project; record unavailable scenarios as not run. Concurrent-join checks characterize behavior and must not claim hard cap enforcement. Also run `npm run typecheck`, `npm run lint`, `npm run build`, and `npm test` for the implementation branch.

**Verification record (2026-10-23, follow-up): Live verification remains blocked before Supabase subscription.** The original Task 08 command ran Vitest with `NODE_ENV=test`; Next's environment loader intentionally does not load `.env.local` in test mode. The live harness now loads the ignored local file with development env-file semantics while restoring Vitest's `NODE_ENV` afterward. The regression probe confirms both variables then exist without printing values. With them loaded, safe format checks show the URL is not a bare project origin (`pathname !== "/"`). `getRealtimeConfig()` rejects it before `createClient()` or `client.channel()` executes. The typed `connection` result was a misleading wrapper around local configuration rejection, not a Supabase `CHANNEL_ERROR`, authorization response, timeout, Presence failure, or WebSocket handshake result. The independently checked host reachability did not test the configured URL path or key.

The anon key uses the `sb_publishable_` prefix, but no authenticated Realtime request reached Supabase, so project/key compatibility remains unverified. The channel adapter settings are correct for the design (`private: false`, Presence key is member ID); it waits for `SUBSCRIBED` and sync before tracking. Its callback mapping is covered by tests and does not explain this failure. Safe tagged diagnostics retain only status/error name/message and redact URL and credential-like fragments.

**RED ? GREEN:** Added a live config regression probe. RED: opt-in execution showed the process had no loaded env in test mode; after enabling Next env-file loading it surfaced `urlPresent=true, projectOrigin=false, anonKeyPresent=true`, reproducing the second blocker. GREEN: the harness now loads local env correctly and reports URL shape without values. No application config behavior was loosened, no credentials were edited, and no Supabase settings were changed.

**Follow-up after corrected local configuration:** Safe checks found the URL and anon key present and confirmed the URL is a bare HTTPS project origin; no values were exposed. The enabled live suite passed its config check and synthetic connection/cleanup contract test. Both live scenarios requiring setup failed at host `create()` with `{ok:false, reason:"connection", retryable:true}` (suite exit 1; 2 failed, 2 passed). No scenario reached a Supabase subscription.

**Sanitized diagnosis:** Node.js 20.17.0's Supabase Realtime client cannot initialize its WebSocket transport in this test runtime: `Node.js 20 detected without native WebSocket support` from `@supabase/realtime-js`. Channel construction throws before `subscribe()` and the session maps it to `reason=connection`. This is a local runtime/harness limitation, not evidence of a Supabase status, authorization, or Presence failure. No code or Supabase settings were changed; no RED/GREEN/REFACTOR fix was warranted because intended use is in a browser with native WebSocket.

**Scenario accounting:** subscription � not verified; create � attempted, failed before remote subscription; independent join � not run; Presence synchronization/host election � not run; ordinary third-member full UX � not run; empty-channel rejection � not run; concurrent-join characterization � not run because setup create failed; live cleanup � not run. Skipped/unexecuted scenarios are not passed.

**Required checks (actual exits):** `npm test` 0 (57 passed, 4 opt-in live skipped); `npm run typecheck` 0; `npm run lint` 0; `npm run build` 0; enabled live suite 1 (2 failed, 2 passed). Sandboxed Node startup failed with EPERM; approved unsandboxed runs completed.

Task 08 remains incomplete. Task 09 remains pending/not implemented. Capacity remains best-effort/non-atomic.
## 09 — Supabase departure and reconnect integration verification

**Status:** Complete

**Blocked by:** 06, 07, 08

**Delivers:** Evidence that real Presence sync, host succession, leave cleanup, stale-member expiry, and reconnect restoration behave as specified.

**RED → GREEN → REFACTOR**

1. RED: add opt-in scenarios for member departure and host succession, channel cleanup, simulated disconnection, Presence expiry, reconnection with no duplicate member, and recovery when the lobby is full.
2. GREEN: run against the dedicated project and fix only behavior that violates documented session semantics.
3. REFACTOR: remove timing assumptions, use bounded condition-based waits, and record the service-managed Presence expiry behavior observed.

**Verification:** run integration suite against dedicated test project. A forced disconnect test may use browser/network controls; do not claim it is equivalent if unavailable.


**Implementation record:** Extended tests/supabase-live.integration.test.ts with live checks for host departure and succession, clean leave observed by an independent subscriber, abrupt transport loss using the Node ws test transport, service-side Presence removal, reconnect with the same member ID and one normalized roster entry, and recovery refusal when two other members occupy the lobby. RED: initial live runs exposed harness import/transport typing issues, asynchronous Presence convergence, and a recovery setup race; no production behavior defect was reproduced. GREEN: after using the test-only ws transport, preparing the full roster before disconnect, and awaiting bounded Presence conditions, all 8 live integration cases passed. REFACTOR: replaced immediate timing assumptions with bounded condition-based waits and recorded observed expiry latency. No application code changed. Observed service Presence removal took about 3 seconds after abrupt socket termination in this run; this is an observation, not a guaranteed expiry interval.

**Final verification exits:** focused opt-in live suite 0 (8/8 passed); npm test 0 (59 passed, 8 opt-in live tests skipped); npm run typecheck 0; npm run lint 0; npm run build 0. Live tests were separately enabled and are not counted as skipped passes. Remaining limitations: expiry timing is service-managed; the observed interval is environment-specific. Capacity remains best-effort and non-atomic.

## 10 — Create/join UI and display-name preference
**Status:** Complete

**Implementation record:** Added the Persian-first RTL home entry form with create and explicit join actions, lobby-code input, localized validation/admission/configuration errors, and navigation only after confirmed session success. Added a browser-only display-name preference adapter that normalizes values and stores only the display name; storage failures do not block entry. The controller keeps form-to-session behavior testable without adding a UI testing dependency.

**RED -> GREEN -> REFACTOR:** RED: focused tests failed because the lobby-entry controller was missing. GREEN: implemented the preference adapter, controller, locale messages, form, and distinct configuration failure result; focused Task 10 coverage passes 10/10 for create success, explicit join/error behavior, invalid name, full/unavailable/configuration/connection/create failures, and localStorage boundaries. REFACTOR: isolated persistence and form/session coordination from the page; storage access is guarded and lobby code/state are never written to localStorage.

**Verification:** Focused `npm test -- --run tests/lobby-entry.test.ts` exit 0 (10 passed); final full `npm test` exit 0 (69 passed, 8 opt-in live tests skipped); `npm run typecheck` exit 0; `npm run lint` exit 0; `npm run build` exit 0. Opt-in Supabase integration was not run because Task 10 adds no Realtime behavior; skipped integration tests are not counted as passed. No component-rendering test library exists in the project, and no dependency was added; form/session behavior is covered through the controller seam and production build.

**Remaining limitations:** The existing Task 11 lobby route remains a placeholder by scope. Supabase live membership behavior remains covered by the prior opt-in suite, not rerun for this UI-only task.


**Blocked by:** 05

**Delivers:** Persian-first RTL create/join forms, explicit join action, localized invalid/full/unavailable/configuration errors, and display-name-only localStorage preference.

**RED → GREEN → REFACTOR**

1. RED: add behavior/component checks for create, explicit join, invalid code/name, full/unavailable/config errors, and display-name persistence using available test seams.
2. GREEN: connect routes/forms to the session interface and locale dictionary.
3. REFACTOR: keep forms presentation-focused and ensure lobby code/state never enters localStorage.

**Verification:** UI checks as supported by the existing stack; strict typecheck, lint, build, and pure-function suite. If no UI test library exists, document the gap and do not add a dependency without approval.

## 11 — Presence and connection status UI

**Status:** Complete

**Implementation record:** Added a browser-only shared lobby session accessor so Task 10's confirmed create/join session is the same session consumed by `/lobby/[code]`. Added a Zustand snapshot mirror, localized member roster with derived host/self/online labels, stale/unknown presence labels, connection/reconnecting/exhausted states, manual retry, and leave action. Route cleanup leaves the session and unsubscribes the store; lifecycle remains in `LobbySession`.

**RED -> GREEN -> REFACTOR:** RED: focused `tests/lobby-presence-ui.test.ts` initially failed because `lib/lobby-presence-ui` did not exist (Vitest exit 1, expected missing-module failure). GREEN: added behavior checks for member/host display, host migration, stale roster, reconnecting/exhausted states, retry delegation/navigation, leave cleanup/navigation, and shared session identity; focused suite passes 7/7. One expectation was corrected after the first implementation run showed the view intentionally returns a localized freshness label rather than an internal enum. REFACTOR: kept pure roster projection and controller behavior outside React, left channel lifecycle in the session, shared one in-memory session across entry and lobby routes, and added no UI test dependency.

**Verification:** Focused `npm.cmd test -- --run tests/lobby-presence-ui.test.ts` exit 0 (7 passed); full `npm.cmd test` exit 0 (76 passed, 8 opt-in live tests skipped); `npm.cmd run typecheck` exit 0; `npm.cmd run lint` exit 0; `npm.cmd run build` exit 0. Live Supabase tests were not run because Task 11 changes presentation/session wiring only; skipped tests are not counted as passes.

**Remaining limitations:** No UI rendering library is installed, so member markup and button visibility are not asserted through DOM rendering. The pure presentation/controller seam and production build verify the available test boundary. Direct lobby links use the locally saved display name, falling back to a localized guest label if none is saved.
**Blocked by:** 06, 07, 10

**Delivers:** Localized member/host roster, stale/unknown state during outages, reconnect/exhausted status, and leave action.

**RED → GREEN → REFACTOR**

1. RED: add behavior/component checks for member and host rendering, host migration, stale roster labeling, reconnect status, terminal retry action, and leave.
2. GREEN: connect existing member/header components and store to session snapshots and localized dictionary text.
3. REFACTOR: keep lifecycle logic in the session module and components focused on rendering/actions.

**Verification:** UI checks as supported by the existing stack; strict typecheck, lint, build, and pure-function suite. If no UI test library exists, document the gap and do not add a dependency without approval.

## Dependency order

`01 → 02 → 03`; `02 → 04`; `01/02/03/04 → 05 → 06 → 07`; Task 08 follows 05, and Task 09 follows 06, 07, and 08. Task 10 follows 05; Task 11 follows 06, 07, and 10. Task 09 and Task 11 verify/render lifecycle behavior and should complete before declaring actual Supabase recovery and the member-facing recovery flow verified.

## Task 08 follow-up � Node WebSocket injection and live Presence blocker (2026-10-23)

Supabase Realtime 2.109.0 supports `realtime.transport` through `createClient` options. Added `ws` and its types as development dependencies. `createRealtimeClient` accepts optional typed options and `createLobbyChannelWithOptions` threads them through the existing channel seam. The live integration test alone supplies a typed `ws` transport; production calls retain browser native WebSocket behavior. No `globalThis.WebSocket` mutation or Supabase project setting change was made.

RED: `tests/realtime-node-websocket.test.ts` reproduced the stable unsupported-runtime diagnostic when native WebSocket was absent. The execution shell reports Node 24.14.0, rather than the diagnosed 20.17.0, but exercises the same missing-WebSocket path. GREEN: explicit `realtime.transport` injection passes client construction. Focused regression passed 1/1.

Opt-in live suite exit 1 (3 passed, 1 failed). Configuration, public channel subscription, host creation, and empty-room subscription succeeded. Simultaneous-join characterization passed but does not establish atomic capacity. Sequential independent join failed with sanitized `{ok:false, reason:"unavailable", retryable:false}`. Host remained joined with one local member; guest had zero members. An independent observer of the host's lobby also subscribed with an initial Presence member count of zero. This establishes a live Presence visibility/admission blocker after subscription; no project settings were changed.

Verified: subscription, host lobby creation, empty-channel subscription, simultaneous-join characterization. Blocked: independent joining and Presence synchronization. Not reached: capacity/full rejection, host election/migration, empty-channel admission rejection, or disconnect cleanup. Task 08 remains incomplete; Task 09 was not implemented. See progress.md for final required command exits.

## Task 08 diagnostic update — 2026-10-23

- Reproduced with the opt-in live suite using the configured public client credentials (values not emitted). Host create returned success after subscription and its own Presence confirmation. A separately constructed guest client subscribed to the same normalized lobby code and received an empty initial Presence state; guest join returned `{ ok: false, reason: "unavailable", retryable: false }`. The host remained joined with one local member. The simultaneous-join characterization and synthetic connection-error scenario passed. Live suite exit code: 1 (3 passed, 1 failed).
- Source trace: both clients call `createLobbyChannel` with the validated uppercase code, forming `lobby:{CODE}`; channel options set `private: false` and `presence.key` to each client's member ID. Adapter subscribes before exposing status; session waits for both `SUBSCRIBED` and a `presence-sync` event before tracking. `channel.track` validates `{memberId, displayName, joinedAt}` and requires Supabase's `"ok"` response. `presenceState()` is consumed in the supported `Record<key, PresenceMetadata[]>` shape and each entry is parsed before admission. The live symptom is an empty authoritative initial sync from the guest's independent channel, rather than an observed schema/normalization failure.
- The harness creates independent session/client instances and does not remove the host before guest admission. Failed guest admission removes only its own channel through session cleanup. No arbitrary sleeps were added. The current harness does not yet capture timestamped per-client subscription/sync/track diagnostics, so it cannot distinguish a service-level Presence configuration/authorization issue from an omitted or delayed server Presence broadcast. No Supabase project settings were changed.
- No client defect was confirmed, so no RED/GREEN/REFACTOR production change was made and admission validation was not weakened. Focused production regression test: not applicable (no confirmed fix). Task 09 remains untouched.
- Verification exits: opt-in live integration exit 1 (3 passed, 1 failed); `npm test` exit 0 (58 passed, 4 skipped); `npm run typecheck` exit 0; `npm run lint` exit 0; `npm run build` exit 0. Initial sandboxed runs were affected by access denial and a parallel `.next/types` race; final runs were sequential/outside the sandbox where required.

**Final diagnostic and verification (2026-10-23):** The prior blocker was reproduced in the isolated raw-client diagnostic and fixed at the session seam. With both independent clients subscribed to the same unique public topic, A's Presence `track()` returned `ok`; B's first `sync` was empty in both subscribe orders, followed by `join` and a second `sync` showing A. Both sockets remained open, both final states contained one member, and no sanitized errors occurred. SyncWatch's adapter delivered that subsequent sync, but its session had already rejected and removed B after the empty first snapshot.

RED: a focused session-interface regression failed because the empty-snapshot path removed B immediately. GREEN: an initially empty existing-lobby join now waits up to eight seconds for a later Presence sync; a later valid member proceeds through normal capacity checks and tracking, while a genuinely empty lobby returns unavailable at timeout. The live create/join/full/empty/concurrent/cleanup suite passes. Project settings and credentials were not changed. Task 09 was not implemented.

**Actual verification exits:** focused session tests 0 (20 passed); opt-in live suite 0 (5 passed), including both diagnostic subscription orders; full `npm test` 0 (59 passed, 5 opt-in skipped); typecheck 0; lint 0; production build 0. The production build compiled successfully and completed Next.js lint/type validation.