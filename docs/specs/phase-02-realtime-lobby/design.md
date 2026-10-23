# Phase 2: Realtime Lobby Management — Design

## Scope and constraints

This design implements only ephemeral lobby management. It uses the existing Next.js client-side structure, Supabase Realtime Broadcast and Presence, Zustand if useful for UI snapshots, TypeScript strict mode, and Vitest. It adds no Auth, database, API route, or custom server and does not implement media, chat, or playback.

## Module and seam

Create one deep `LobbySession` module as the external seam. UI callers supply intent (create or join, display name) and receive an immutable snapshot plus typed actions/results. They do not create Supabase channels, subscribe to Presence callbacks, or interpret raw payloads. The module owns channel lifecycle, validation, capacity policy, reconnect, and cleanup. Keep deterministic policy as pure functions so unit tests need no browser or Supabase runtime.

Proposed surface, expressed as behavior rather than a committed file layout:

- `createLobby(displayName)` generates a code and joins it, returning the code only after successful admission.
- `joinLobby(code, displayName)` validates input before allocating a channel and only admits when initial Presence sync shows at least one other valid member.
- `getSnapshot()` / subscription exposes `status`, `code`, normalized `members`, `selfMemberId`, derived `hostMemberId`, and typed error state.
- `retry()` restarts after a terminal connection failure; `leave()` is idempotent and releases all owned resources.
- Display-name persistence belongs to a small browser-only preference adapter, not to Presence or durable lobby storage.

Names and exact function signatures are implementation choices; preserve this narrow interface and its behavior.

## Channel and Presence contract

- Channel topic is exactly `lobby:{CODE}`.
- Configure a **public** Realtime channel (`private: false`, with no user-scoped authorization policy) because the project has no Auth. This means possession of the public project key and topic code is enough to attempt subscription; it is not private access control. Track Presence with `key: memberId` and `{ memberId, displayName, joinedAt }` only after subscription and initial Presence sync.
- Derive members from `presenceState()` on each `sync`, flattening only validated records and deduplicating on `memberId`; for duplicate records retain the greatest valid `joinedAt`, then lexicographically smaller normalized display name as a deterministic tie-break.
- Derive host by ascending finite `joinedAt`, then lexicographic `memberId`. Do not accept a client-supplied host flag. Clients with the same snapshot derive the same result; clients with different snapshots may temporarily disagree until Presence converges.
- Create sequence: validate local input → create/subscribe channel → wait for `SUBSCRIBED` and initial Presence sync → if any valid member is present, treat code as occupied and retry → track own metadata → confirm own presence after sync → transition to `joined`.
- Join sequence: validate local input → create/subscribe channel → wait for `SUBSCRIBED` and initial Presence sync → require at least one valid member with an ID different from the local `memberId` → count distinct other IDs and require fewer than `MAX_LOBBY_MEMBERS` → track own metadata with fresh `joinedAt` → confirm own presence and at least one other member after sync → transition to `joined`. If no other member remains at confirmation, untrack/remove and report unavailable. This check is still racy because Presence is not transactional.
- For a create collision, treat any pre-existing member before own tracking as occupied and retry a new code, with a fixed maximum of 3 attempts. A creator racing another creator can have both read empty before either track; both may enter the same room. This remains a known limitation.
- On full rejection or any setup failure, untrack if needed, remove the channel, detach callbacks, cancel timers, and report a typed result.

## Event contract and validation

Presence is the source of current membership; no Phase 2 Broadcast message is needed for member lists, capacity, or host state. Preserve the PRD's typed event union for later chat/WebRTC phases. Any Broadcast handler enabled in Phase 2 must validate the exact PRD event variant from `unknown` before use; do not add a Phase 2 protocol version or enable later-phase behavior.

## State machine

| Current state | Input/event | Next state | Required effect |
| --- | --- | --- | --- |
| idle | valid create/join | connecting | allocate one channel and listeners |
| idle | invalid input/config | idle with typed result | no channel allocated |
| connecting | subscribed + admitted + self confirmed | joined | publish normalized snapshot |
| connecting | full / setup failure | error or idle result | release partial resources |
| joined | channel error/timeout/closed | reconnecting | mark membership uncertain; retain last snapshot as stale/unknown, not online authority |
| reconnecting | resubscribed + initial sync + capacity available among other IDs + self retracked + confirmation sync | joined | reuse memberId, use fresh joinedAt, and replace snapshot from Presence |
| reconnecting | resubscribed + initial sync shows full lobby | leaving then error | release channel and report full; do not track beyond observed capacity |
| reconnecting | retry budget exhausted | error | cancel retries; offer explicit retry |
| error | explicit retry | connecting | start a fresh session generation and clear stale joined authority |
| connecting/joined/reconnecting/error | leave/dispose | leaving then idle | idempotent untrack, unsubscribe/remove, detach, cancel |
| joined | Presence sync | joined | normalize members and recompute host |

Use generation/session tokens internally to ignore callbacks from a prior channel after retry or leave; they are not Presence fields. Before each new attempt, detach and best-effort remove the prior channel; do not let an old channel's late callback mutate the replacement session. Ensure one reconnect timer at a time and at most five automatic attempts, with exponential full-jitter delay in `[0, min(500ms × 2^(attempt−1), 8s)]`. Inject randomness and scheduling so policy tests are deterministic. Reset attempt count after successful confirmed recovery. A manual retry starts a fresh lifecycle. Recoverable channel failure retries automatically; explicit user retry is offered only after the bounded automatic retry budget is exhausted. A terminal leave/dispose never reconnects.

## Store and UI responsibilities

The session module owns realtime lifecycle; a thin client-side store may mirror its snapshot for React subscribers. Components render localized Persian-first status and errors, provide create/join/leave actions, and show member names/online state and host role. Keep all user-facing text in the existing locale dictionary and preserve RTL. Do not serialize lobby snapshots into localStorage.

## Failure and cleanup behavior

Represent invalid code, invalid name, missing configuration, lobby full, create collision exhaustion, channel subscribe error, reconnect exhaustion, and user leave as distinct typed outcomes. Cleanup is safe after partial setup and safe to call more than once. A stale channel callback must not mutate current state. On host departure, only Phase 2 host identity changes; stream teardown is a later-phase concern.

## Security and concurrency

The protocol makes no authorization claim. Configure channels as public to work without Supabase Auth; project-level Realtime settings may still disable public access, in which case connection fails and UI must show a permission/configuration error. There is no per-lobby access control: anyone with the public project key and code can attempt to subscribe, and client-provided sender identity and metadata are untrusted. Runtime validation limits malformed input, not impersonation. Presence-based capacity is best-effort because read/check/track is not atomic. Concurrent admission can exceed two, and simultaneous create attempts can converge. Given the same snapshot, clients derive the same host using deterministic timestamp/member-ID ordering; different snapshots and clock skew can temporarily produce different hosts. Do not describe capacity or host status as security enforcement.

The Realtime service eventually removes Presence for disconnected clients, but its expiration interval is not controlled by this client. During an outage, render the last known roster as stale/unknown; after a new `sync`, replace it with the server-reported Presence set. A session returning after its Presence entry expired rejoins with a fresh timestamp and may lose host seniority.

Use the exact code alphabet `ABCDEFGHJKLMNPQRSTUVWXYZ23456789`. Generate each index from `crypto.getRandomValues` using rejection sampling, not a biased `% alphabet.length` mapping. Normalize display names to Unicode NFC, trim, and require 1–40 Unicode code points with no control characters; apply the same rule to untrusted Presence metadata.

## Verification strategy

Unit tests first at pure behavior seams: code contract, validators, metadata normalization, de-duplication, host election, capacity decision for an observed snapshot, transition/retry policy. Then interface-level tests with a channel adapter fake may verify session ownership and cleanup deterministically, without asserting private method calls. Finally, opt-in Supabase integration tests use separate browser clients to verify actual channel subscription, Presence synchronization, member departure, reconnect, and cleanup. Document project/config prerequisites. The full repo commands from `AGENTS.md` are expected after implementation; this planning task does not run them.

## Node integration transport note

The browser client uses native WebSocket by default. Node live integration tests can inject a compatible implementation through Supabase's `realtime.transport` client option. Keep this injection in the test harness; do not modify `globalThis.WebSocket` or browser defaults.

## Presence initial-sync timing decision

A normal join that receives an initially empty Presence sync keeps its channel alive for a bounded 8-second follow-up window. A later Presence sync is evaluated through the same metadata validation and capacity policy before any tracking occurs. If no valid member appears by the deadline, the join returns unavailable and cleans up. This accounts for the observed raw-client sequence of empty initial sync followed by join/sync, while preserving empty-lobby rejection and avoiding admission based on an unvalidated payload.