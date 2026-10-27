# Phase 3: WebRTC Screen Sharing â€” Task Plan

Phase 3 Tasks 01-08 are complete; Tasks 09-10 remain planned. Each implementation task must follow RED â†’ GREEN â†’ REFACTOR and update this file and `progress.md` when that task is completed. Keep each task independently verifiable and preserve Phase 2 behavior.

## 01 â€” Stream and signaling contracts

**Status:** Complete. The generation field change was explicitly approved and recorded in `PRD.md`.

**Dependencies:** None

**Deliverables:** Typed quality/failure/status/generation contracts; extended typed `RealtimeEvent` session generation fields; strict parsing and bounded payload/ID checks; tests for old/malformed/mismatched payloads. Updated `lib/realtime/events.ts` and focused tests. Channel test fixtures now include the required generation on valid share notices. No media code or transport behavior was added.

**RED â†’ GREEN â†’ REFACTOR**

1. **RED:** Missing-generation test failed because generationless offers were accepted (`1 failed, 11 passed`). A Unicode C1 control-character case later failed because the generation parser accepted it (`1 failed, 24 passed`).
2. **GREEN:** Added mandatory `sessionId` contracts and validation. All required event variants reject missing/invalid generations; chat stays generationless.
3. **REFACTOR:** Centralized bounded identifier validation, including Unicode control-character rejection, and retained immutable normalized payloads. Focused event/channel suites passed (`39/39`).

**Acceptance:** Strict parser accepts only documented variants and bounded generation identifiers; existing event tests remain green; no media code is added.

**Verification:** Focused event/channel Vitest suites: exit 0, 39 passed. Full `npm.cmd test`: exit 0, 91 passed and 8 opt-in integration tests skipped. `npm.cmd run typecheck`: exit 0. `npm.cmd run lint`: exit 0. `npm.cmd run build`: exit 0.

## 02 â€” Pure media, quality, and ICE policy

**Status:** Complete

**Dependencies:** 01

**Deliverables:** Pure quality presets (480p/720p/1080p), default 720p/30 target, optional bitrate policy around 2.5 Mbps, public STUN defaults, validated optional TURN parsing, and tests. Document public credential exposure and no fixed-quality guarantee in `.env.example`/spec before behavior is wired.

**RED â†’ GREEN â†’ REFACTOR**

1. **RED:** Focused tests failed at each missing public seam: quality builder, bitrate policy/application, and ICE builder.
2. **GREEN:** Implemented the minimum pure policy functions in `lib/webrtc/media.ts` and `lib/webrtc/ice.ts`; focused policy suite passed (5/5).
3. **REFACTOR:** Kept environment access injectable and side-effect free, made bitrate API failures observable, and documented public TURN limitations and non-guaranteed quality.

**Acceptance:** No `any`; invalid optional TURN config degrades safely; no secret is claimed safe in public client code.

**Implementation:** Added pure capture constraint presets for 480p, 720p (default), and 1080p, all requesting 30fps as an ideal target. Added best-effort sender bitrate targets (1 Mbps/2 Mbps/2.5 Mbps respectively) and an async helper that returns false when parameter APIs are missing or reject the update. Added public STUN default plus optional TURN parsing; TURN is used only with a valid `turn:`/`turns:` URL, username, and credential, while incomplete or malformed values safely yield STUN-only configuration. TURN guidance is available for STUN-only configuration. `NEXT_PUBLIC_TURN_*` exposure and requested quality as best effort are documented. No capture, peer negotiation, or stream session integration was added.

**Verification:** Focused Task 02 Vitest suites: exit 0, 5 passed. Full `npm.cmd test`: exit 0, 96 passed and 8 opt-in live Supabase integration tests skipped (not counted as passes). `npm.cmd run typecheck`: exit 0. `npm.cmd run lint`: exit 0. `npm.cmd run build`: exit 0.

**Remaining limitations:** TURN credentials remain public client configuration and are not protected authorization; short-lived issuance requires a separately approved trusted service. Browser capture, sender parameter application against real browsers, actual ICE connectivity, and media quality negotiation are not verified by these pure tests.

## 03 â€” Capture manager

**Status:** Complete

**Dependencies:** 02

**Deliverables:** Browser-only capture adapter in `lib/webrtc/capture.ts` with injected `getDisplayMedia`/track factories, explicit start gesture contract, quality constraints, typed permission/unsupported/cancel/missing-audio outcomes, muted-preview contract, ended handling, and idempotent stop. Added focused fake-stream/track coverage in `tests/webrtc-capture.test.ts`; no UI or later-task integration.

**RED â†’ GREEN â†’ REFACTOR**

1. **RED:** The initial unsupported test failed because `createCaptureManager` did not exist. Subsequent focused tests reproduced incorrect denial/cancellation/unsupported classification, unavailable successful capture, missing-video cleanup, duplicate track stopping, and track-query cleanup.
2. **GREEN:** Added the injected capture manager, quality constraint request, typed capture outcomes, nonfatal missing-audio result, muted inline preview contract, owned track adaptation, and browser `ended` handling.
3. **REFACTOR:** Kept browser access behind a safe capability adapter; isolated source/owned-track cleanup, made stop idempotent, and ensured teardown continues after listener or track errors.

**Acceptance:** Only `start()` can prompt capture and invokes the injected/browser API directly for a user gesture; native video `ended` uses the capture handle's centralized stop path and callback; there is no local audio playback path.

**Verification:** Focused `npm.cmd test -- tests/webrtc-capture.test.ts`: exit 0, 11 passed. Full `npm.cmd test`: exit 0, 107 passed and 8 opt-in live Supabase integration tests skipped (not counted as passes). `npm.cmd run typecheck`: exit 0. `npm.cmd run lint`: exit 0. `npm.cmd run build`: exit 0.

**Remaining limitations:** Capture permissions, browser picker behavior, native Stop sharing, actual captured audio availability, and desktop browser compatibility were tested with fakes only. Real browser/device verification remains for the later manual acceptance tasks.

## 04 â€” Typed Broadcast send adapter

**Status:** Complete

**Dependencies:** 01

**Deliverables:** Extend `LobbyChannel` with typed event send; Supabase Broadcast send mapping and fake channel tests; send failure result without leaking raw Supabase objects. No handlers enabled in UI yet.

**RED â†’ GREEN â†’ REFACTOR**

1. **RED:** Test valid event send, failed send result, detached/removed channel behavior, and payload serialization using an adapter fake.
2. **GREEN:** Add the smallest send method to `lib/realtime/channel.ts` with event validation/type contract.
3. **REFACTOR:** Keep raw channel operations inside the adapter and preserve current subscribe/Presence semantics.

**Acceptance:** Only typed events cross the send seam; failure is observable; Phase 2 create/join/Presence behavior is unchanged.

**Implementation:** Extended `LobbyChannel` with `send(RealtimeEvent)` and a safe result union. The adapter maps events to Supabase's `syncwatch` Broadcast envelope and contains rejected sends or non-`ok` statuses as `send-failed`; calls after detach/removal return `detached`. No raw Supabase result or error is returned.

**RED ? GREEN ? REFACTOR evidence:** RED: four focused cases failed because `send` did not exist (14 existing cases passed). GREEN: added the typed send method and safe result mapping; focused channel tests passed 18/18. REFACTOR: kept transport mapping and exception containment inside the adapter, with no changes to subscription or Presence behavior.

**Verification:** See `progress.md` Task 04 results.

## 05 â€” Peer connection manager: negotiation

**Dependencies:** 01, 02, 04

**Deliverables:** Injected native peer factory and `lib/webrtc/peer-manager.ts` support for a single peer's tracks, SDP offer/answer, trickle ICE, ICE queue until remote description, remote-track events, typed failures, and idempotent close. No lobby or React coordination yet.

**RED â†’ GREEN â†’ REFACTOR**

1. **RED:** Fake `RTCPeerConnection` tests fail for offer/answer order, candidate queuing/flush, candidate errors, remote tracks, and close cleanup.
2. **GREEN:** Implement peer lifecycle behind a narrow manager interface.
3. **REFACTOR:** Keep each peer isolated by remote member and generation; callbacks become inert after close.

**Acceptance:** One manager instance cannot apply a signal for another member/generation; fake tests cover call ordering without asserting browser connectivity.

**Verification:** Focused fake-peer tests; typecheck/lint.

## 06 â€” Host/viewer stream session and late join

**Status:** Complete

**Dependencies:** 03, 04, 05

**Deliverables:** Proposed `lib/webrtc/session.ts` coordinator, immutable stream snapshot, role/membership/generation validation, host mesh creation, viewer share request, late-viewer offer, answer/ICE dispatch, and cleanup. Stream state remains memory-only.

**RED â†’ GREEN â†’ REFACTOR**

1. **RED:** Fake lobby snapshots/channel/capture/peer adapters to cover host start, non-host rejection, each-current-viewer peer creation, viewer late join, no active share, and stale/wrong-target/non-member signals.
2. **GREEN:** Coordinate capture and peer manager for start/stop and active-share request flow.
3. **REFACTOR:** Centralize generation invalidation and idempotent cleanup; no UI wiring yet.

**Acceptance:** One connection per viewer, media tracks only added to host peers, no session survives stop/host loss, and old-generation messages cannot mutate state.

**Verification:** Focused session fakes and all pure suites; typecheck/lint. Explicitly label this as mocked protocol verification, not connectivity verification.

**Task 06 implementation:** Added the injected in-memory coordinator in `lib/webrtc/session.ts`. It uses LobbySession as the sole membership and host-election authority, permits host capture only when joined/current, creates one peer per present viewer, and attaches native capture tracks. Viewers accept the current observed host generation, create a peer before requesting the share (so early ICE is queued), and accept one offer. Requests, offers, answers, and ICE require current membership, expected role, correct recipient where directed, and matching generation. Duplicate requests, starts, and offers are ignored. Stop, capture end, host-role loss/departure, and disposal invalidate the generation and release capture/peer resources. No UI or Task 07 recovery was added.

**RED -> GREEN -> REFACTOR:** RED: focused run failed because the coordinator module was absent; a later duplicate-offer regression failed before the guard was added. GREEN: focused fake suite passed 9/9. REFACTOR: central generation invalidation, immutable snapshots, injected boundaries, early-ICE peer creation, and native-track attachment.

**Verification:** `npm.cmd test -- tests/webrtc-session.test.ts tests/realtime-channel.test.ts` exit 0 (27 passed: 9 session, 18 channel); `npm.cmd test` exit 0 (127 passed, 8 opt-in live tests skipped); typecheck exit 0; lint exit 0; production build exit 0. Mocked protocol verification only.

**Limitations:** No live Broadcast or two-device WebRTC verification. Presence/Broadcast identity is client-asserted, not authentication. UI/store integration remains Task 08.



**Dependencies:** 06

**Status:** Complete

**Deliverables:** Presence membership reconciliation, viewer peer close/removal, reconnect fresh negotiation, approved 10-second temporary Host Realtime disconnect grace, one ICE restart, one peer recreation, retry exhaustion, cancellation of timers on all lifecycle changes.

**RED â†’ GREEN â†’ REFACTOR**

1. **RED:** Injected scheduler tests for departure, stale roster/reconnect, disconnected recovery, failed ICE restart, recreate success/exhaustion, and timer cancellation.
2. **GREEN:** Implement the bounded recovery policy and session reconciliation.
3. **REFACTOR:** Isolate pure retry decisions and ensure only current peer/generation callbacks publish.

**Acceptance:** Recovery attempts are bounded and deterministic under fake time; removal/stop/migration cancels work and closes peers.

**Verification:** Focused fake-time tests; typecheck/lint.

**Approved policy:** The 10-second Host Realtime grace was approved by the user. It is independent of bounded WebRTC recovery. LobbySession remains the sole membership and host-election authority; explicit leave is immediate.

## 08 â€” Stream store and localized UI integration

**Dependencies:** 06, 07

**Deliverables:** Zustand stream snapshot mirror, host share controls, muted preview, viewer video/audio stage, loading/connecting/playing/interrupted/failed states, autoplay gesture, fullscreen, quality choices, responsive mobile viewer layout, Persian-first/English dictionary entries and accessible announcements. No resource ownership in components/store.

**RED â†’ GREEN â†’ REFACTOR**

1. **RED:** Test pure view projections and locale completeness, autoplay rejection action, host-only controls, and keyboard/status semantics at available seams.
2. **GREEN:** Bind lobby route and existing placeholder components to coordinator actions and media refs.
3. **REFACTOR:** Keep browser element refs/actions in client UI and session lifecycle in coordinator; ensure cleanup clears `srcObject`.

**Acceptance:** Host role updates immediately; mobile capture action is not offered; all status/error/control copy is localized; accessibility review passes.

**Verification:** Focused projection tests, typecheck, lint, production build, and manual UI review. Record missing DOM test tooling instead of adding a dependency without need.

## 09 â€” Two-device desktop browser acceptance

**Status:** Complete for the eight user-reported manual scenarios; browser/device/network metadata and additional checklist coverage remain unrecorded.

**Dependencies:** 08

**Deliverables:** Manual acceptance record for two distinct devices/browsers and a test lobby, using STUN-only then TURN if available. No mock-only claims. Record browser versions, network path category, outcomes, and any limitations without storing media or secrets.

**RED â†’ GREEN â†’ REFACTOR**

1. **RED:** Run checklist and capture concrete failures for host capture, negotiation, media, stop, late join, and reconnect.
2. **GREEN:** Fix only reproduced defects through focused preceding-task tests, then repeat affected browser scenarios.
3. **REFACTOR:** Consolidate results into repeatable manual checklist and document service/TURN prerequisites.

**Acceptance:** Actual host-to-viewer audio/video verified on two devices; stop and native Stop sharing close peers/tracks; late join and host migration behave as specified; failed network path is honestly recorded.

**Verification:** Real browser/device run is mandatory; Vitest mocks do not satisfy this task.
**Execution record (2026-10-25; user-reported):** The user reports PASS for the eight scenarios listed in the manual evidence table below. This is recorded as manual acceptance evidence and is not an automated test result. Browser names/versions, device models/OS, network path, STUN/TURN path, and test date/time were not recorded. No such metadata or TURN verification is inferred.

**Follow-up diagnostic (2026-10-27; automated, synthetic media):** Playwright launched installed Microsoft Edge 156.0.4314.42 in an isolated headless profile. Two tabs created and joined one lobby; both Presence members and host/viewer roles appeared. Synthetic media reached the viewer: targeted offer and answer were sent/received, ICE candidates were exchanged, both peers reached ICE `connected`, and viewer video reached `readyState: 4` at 1280x720. This is same-machine synthetic-media evidence only; it does not satisfy the distinct-device, real capture, audible playback, or cleanup acceptance checklist above. See `progress.md` for the network diagnosis and harness adjustments.

**Automated coverage actually run:** focused WebRTC session, peer manager, capture, media element, and opt-in live Supabase test files: exit 0; 42 tests passed, 8 skipped. These tests use fakes for browser media/peer behavior and are not evidence of real connectivity. Full suite and project checks are recorded in `progress.md`.

**Manual acceptance checklist for the required follow-up run:**

1. Record date, desktop OS, exact browser names/versions on both distinct devices, and network-path category (same LAN, different networks, VPN/restricted, etc.). Use a test lobby; do not record lobby codes, TURN credentials, or media.
2. With STUN-only configuration, have Device A create a lobby and Device B join by code. Confirm presence and host/viewer roles.
3. On A, click Start sharing, select a tab/display, enable tab audio if offered. Confirm browser permission/picker behavior, muted host preview, and separate presence of a video track and (when selected) audio track.
4. Confirm B reports a remote stream with video and audio tracks independently. Click the explicit playback action if autoplay is rejected; verify moving video and audible sound on B. Do not infer audio from video-track presence.
5. Confirm targeted offer, answer, and ICE negotiation completes for the same peer (use browser diagnostics/logging that expose no SDP/candidate secrets in the record). Confirm A remains muted.

## Real capture diagnostic follow-up (2026-10-27)

- The Playwright browser diagnostic is opt-in via `SYNCWATCH_REAL_CAPTURE=1`, launches installed Microsoft Edge headed, and has no fake-media flags. It creates two pages, confirms both names in the same lobby, then invokes the application's actual Start sharing button so Edge's native screen/tab picker remains in control.
- After native capture it records the host video track state/settings, sender video track state/settings, offer/answer description types (never SDP), peer signaling/ICE/connection states, remote track events, viewer video source/playback/dimensions/errors, and browser console errors. ICE telemetry records candidate presence only.
- The diagnostic uses a 10-minute window for picker and media observation. `networkidle` is intentionally avoided because persistent Realtime connections prevent it from settling.
- A headed run was attempted in this environment but did not yield a capture report or user-selectable picker pause before the runner ended. Therefore no real capture stage has been observed, no comparison against synthetic media is possible from this run, and no application fix is justified. Resume where Supabase Realtime is reachable and keep the user present to select a screen/tab.
6. Stop with the app control; confirm both tracks stop, preview clears, B transitions out of playing, and peers close. Repeat and use the browser's native Stop sharing control; verify equivalent cleanup and Viewer update.
7. Restart sharing and have B leave/rejoin while the share is active. Confirm a fresh negotiation and restored media without restarting the share.
8. Exercise a transient disconnect and an ICE failure/recovery where feasible; record attempt timing/outcome and confirm the documented one ICE restart, one peer recreation, bounded Host Realtime grace, and terminal failure behavior. Do not claim unforced network cases as tested.
9. If a TURN service is provisioned and approved, repeat on the same recorded network pair with TURN enabled and label the path. Never include TURN credentials in the record.
10. Fill the results table below. Record failures and rerun affected scenarios after any minimal, regression-tested fix.

| Scenario | Browser/device pair | Network path | Outcome / evidence | Limitation |
| --- | --- | --- | --- | --- |
| Host creates lobby; Viewer joins | Not recorded | Not recorded | PASS (user-reported) | Browser/device metadata not recorded |
| Host starts tab sharing with audio | Not recorded | Not recorded | PASS (user-reported) | Browser/device metadata and audio selection details not recorded |
| Viewer receives video | Not recorded | Not recorded | PASS (user-reported) | Browser/device metadata not recorded |
| Viewer receives audio | Not recorded | Not recorded | PASS (user-reported) | Browser/device metadata not recorded |
| App Stop Sharing releases sharing | Not recorded | Not recorded | PASS (user-reported) | Resource inspection details not recorded |
| Browser-native Stop Sharing releases resources | Not recorded | Not recorded | PASS (user-reported) | Resource inspection details not recorded |
| Viewer leaves and rejoins with fresh negotiation | Not recorded | Not recorded | PASS (user-reported) | Browser/device metadata not recorded |
| Host departure triggers expected host migration | Not recorded | Not recorded | PASS (user-reported) | Browser/device metadata not recorded |

## 10 â€” Cross-browser, mobile viewing, and failure acceptance

**Dependencies:** 09

**Deliverables:** Manual matrix for desktop Chrome/Edge capture; at least one additional desktop viewer/browser; mobile viewer; denied/cancelled permission; missing tab audio; autoplay blocked; fullscreen; STUN-only constrained network and TURN path if provisioned; 480p/720p/1080p requested presets; host leave/re-election; cleanup.

**RED â†’ GREEN â†’ REFACTOR**

1. **RED:** Execute explicit matrix and log unsupported/failing combinations.
2. **GREEN:** Fix implementation defects where feasible; unsupported combinations receive accurate localized guidance.
3. **REFACTOR:** Update compatibility/risk records and user guidance to match observations.

**Acceptance:** Mobile has viewer-only UX, no unsupported capture offer; no fixed quality claims; every tested failure has clear status and cleanup; remaining browser limits documented.

**Verification:** Manual browser/device matrix plus `npm run typecheck`, `npm run lint`, `npm run build`, and `npm test`. Do not infer untested browser support.

**Execution record:** The supplied manual evidence reports PASS for Task 09's eight scenarios only. Task 10's additional matrix (desktop Chrome/Edge capture matrix, additional desktop viewer/browser, mobile viewer, denied/cancelled capture, missing tab audio, autoplay blocked, fullscreen, constrained STUN/TURN, quality presets, detailed cleanup) has no per-case result and is **not recorded**. These cases are not inferred from the Task 09 report. Browser/device/network metadata is not recorded. Task 10 documentation and deployment-readiness review are complete; no runtime implementation change was indicated by these requirements/review. The manual matrix acceptance criterion is therefore documented as outstanding, not claimed passed.

### Vercel deployment-readiness review (no deployment performed)

- `npm.cmd run build` is the production build command; its actual result is recorded in `progress.md`. Vercel's Next.js support and serverless compatibility are suitable for this App Router frontend: no custom server, API route, persistent server state, or media relay is used. WebRTC media is peer-to-peer; Supabase Broadcast carries signaling only.
- Required Vercel Project Environment Variables, matching existing code and `.env.example`: `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`. The URL must be the Supabase project HTTPS URL and the key the project's public anon/publishable key. There is no Supabase Auth or database requirement. Realtime lobbies use public (`private: false`) Broadcast channels and Presence; this is discoverability, not secure authorization.
- Optional variables: `NEXT_PUBLIC_TURN_URL`, `NEXT_PUBLIC_TURN_USERNAME`, and `NEXT_PUBLIC_TURN_CREDENTIAL`. If complete and valid, TURN augments the public STUN default; otherwise the app falls back to STUN-only. Every `NEXT_PUBLIC_*` value is shipped to clients. TURN username/credential are exposed, abuse-prone public configuration, not secrets. Do not enter privileged or long-lived credentials. Secure short-lived TURN credentials require a trusted issuer/backend and a separately approved architecture change.
- Screen capture requires a secure context (HTTPS in production; localhost is the browser development exception) and a user gesture. Vercel's HTTPS deployment satisfies the secure transport prerequisite; browser chooser/audio availability remains browser-controlled.
- ICE includes `stun:stun.l.google.com:19302` by default. STUN-only paths may fail on restrictive NAT/firewalls/VPNs. TURN service availability, credentials, cost, and real network-path operation have not been verified.
- Environment access is statically referenced in client-usable code through `process.env.NEXT_PUBLIC_*`; no server-only variable or private key is required. No hardcoded localhost URL was found in application/configuration source during this review.
- Realtime channel subscription errors are sanitized before development diagnostics; send failures are converted to safe result values. Build does not prove production Supabase configuration or browser connectivity.
- Deployment blockers: configure the two required Supabase variables and verify the deployed project's public Realtime Broadcast/Presence settings and allowed access behavior; perform a post-deployment smoke/manual browser check. TURN is optional for deployment but required to improve reachability on networks where STUN-only fails. Do not deploy until the project configuration is supplied and verified.

## Dependency order

`01 â†’ 02`; `01 â†’ 04`; `01,02,04 â†’ 05`; `02 â†’ 03`; `03,04,05 â†’ 06 â†’ 07 â†’ 08 â†’ 09 â†’ 10`.

## Approval gates before implementation

1. **Complete:** User approved the required `sessionId` additions to RTC and share lifecycle wire shapes; `PRD.md` now documents the mandatory field and validation bounds.
2. Decide whether optional static public TURN credentials are acceptable for this personal app or defer TURN until a trusted credential issuer is separately approved.
3. **Complete:** The user approved the 10-second host Realtime disconnect grace before Task 07 implementation; see the Task 07 policy and `design.md`.



## Task 08 status

**Status:** Complete. Task 09 and Task 10 remain unstarted.

**Implementation:** LobbySession now forwards typed events and send results through the currently active LobbyChannel without exposing Supabase or creating another channel. StreamSession uses that bridge, owns capture/peer generations and media streams, and publishes serializable snapshots plus a read-only local/remote media snapshot subscription. The lobby creates the coordinator in an effect, binds both snapshots, and disposes it on navigation/unmount. UI starts/stops capture only from button actions, shows muted inline host preview, supports viewer retry/playback/fullscreen gestures, and localizes capture, audio, connection, and recovery states.

**Verification:** Focused Task 08 tests cover the LobbySession bridge, capture start/stop and preview observation, viewer remote stream, viewer request and role restrictions, late share announcement deferral until membership is current, stale callbacks, coordinator setup/cleanup/setup replay, status projection, autoplay rejection and retry helper, and fullscreen outcomes. No DOM testing dependency was added; actual element behavior is reviewed in the component and fake media helper tests.

## Late-viewer negotiation regression fix (2026-10-27)

- Confirmed participant identity is generated with cryptographic randomness once per `LobbySession`, held only in that tab's module memory, reused for reconnect, and cleared on leave. Display-name localStorage is the only shared persistence; no participant ID is read from localStorage or sessionStorage. Independent tabs therefore create separate Presence keys. Host election remains based on Presence join order.
- Root cause: a viewer joining after `share:started` missed that ephemeral Broadcast. The host correctly noticed the new Presence member and sent an offer using the active stream generation, but the viewer rejected every event except `share:started` while its generation was null. No offer was applied, so no answer/ICE/track could follow.
- RED test: the stream-session test delivers a targeted offer from the current host to a current viewer with no prior announcement and asserts generation adoption and offer application. It failed before the fix and passes after it.
- Fix: a viewer may adopt the generation only from a present, elected current host's offer targeted to that viewer while Presence is current. Target and sender validation remains enabled. This also covers the host's reconciliation offer after a rejoin. Existing membership cleanup and recovery continue to create/close peers as before.
- Added development-only `[syncwatch-webrtc]` logs for share announcement/start, targeted offer/answer/ICE send and receive, candidate exchange, peer and ICE connection states, tracks, video playback failures, and signaling rejection reasons. Logs omit SDP, candidate contents, keys, and credentials.
- Browser acceptance remains outstanding; automated fakes do not prove two-tab media delivery.
