# Phase 2: Realtime Lobby Management — Specification

## Problem statement

SyncWatch has only a scaffold for its lobby flow. Visitors need to create or join a short-lived room, identify themselves, see who is present, and recover when a realtime connection drops. The room must remain account-free and must not persist lobby data.

## Solution

Add a browser-side Supabase Realtime lobby session using channel `lobby:{CODE}` and Presence for member state. Phase 2 does not need Broadcast messages for membership, admission, or host election; the PRD event union remains the typed contract for later signaling/chat phases. A visitor creates a lobby with a client-generated six-character code or joins an existing one with a valid code and display name. The oldest present member is host. Session state is held in memory; only the display name may be stored in localStorage.

This phase covers connection, room admission, presence, host succession, departure, cleanup, and reconnect. WebRTC, screen sharing, chat, and playback remain out of scope.

## User stories

1. As a visitor, I want to create a lobby without an account so I can invite one person.
2. As a visitor, I want a six-character code from an unambiguous alphabet so I can share it reliably.
3. As an invited visitor, I want to enter a code and display name and explicitly join the room.
4. As a member, I want to see the present members and host so I know who is in the room.
5. As a member, I want a third visitor to receive a clear full-lobby result so the two-person limit is understandable.
6. As a member, I want malformed or unsupported codes rejected before connecting.
7. As a member, I want to leave cleanly so my presence disappears and my resources are released.
8. As a remaining member, I want the oldest present member to become host after host departure.
9. As a temporarily disconnected member, I want the client to resubscribe and restore presence without duplicating membership.
10. As a member, I want a connection status and useful failure state when the realtime service is unavailable.
11. As a user, I want my display name remembered locally while lobby membership and identity remain ephemeral.

## Acceptance criteria

### Creation and joining

- **Given** a visitor has a valid display name and Realtime configuration, **when** they choose create, **then** the client generates a six-character code using the documented unambiguous alphabet and opens `lobby:{CODE}`.
- **Given** a visitor submits a six-character valid code and non-empty normalized display name, **when** they explicitly join, **then** the client subscribes and waits for a Presence synchronization, tracks only if at least one other valid member is present, and reports joined only after its own presence is confirmed alongside an existing member.
- **Given** a visitor submits a well-formed code whose channel has no valid present members after initial Presence synchronization, **when** they try to join, **then** the client reports that the lobby is unavailable, removes its channel, and does not create a replacement lobby.
- **Given** two members begin joining at nearly the same time, **when** each derives a host from the same synchronized snapshot, **then** both derive the same member using ascending valid `joinedAt` and `memberId` tie-break; **when** their snapshots differ, **then** temporary disagreement is allowed until a later sync and no client broadcasts or persists a host lock.
- **Given** a code has the wrong length or contains a character outside the code alphabet, **when** the visitor submits it, **then** the client rejects it locally with an actionable invalid-code result and does not subscribe.
- **Given** required public Supabase configuration is absent or malformed, **when** a visitor starts create or join, **then** the client reports a configuration error without creating a channel.
- **Given** a visitor creates a lobby whose generated code is occupied, **when** the client observes existing presence before admission, **then** it abandons that attempt and retries with a new code up to a bounded retry count; exhaustion is reported as a retryable creation error. If concurrent creators both observe an empty channel, both may still enter it, as stated in the limitations.

### Presence, capacity, and host

- **Given** an empty lobby, **when** the first member tracks presence, **then** that member is listed and derived as host.
- **Given** one present member, **when** a second member successfully tracks presence, **then** both unique members are listed and the oldest join timestamp determines the host.
- **Given** the configured capacity is reached, **when** another join is evaluated against the latest observed presence state, **then** the client refuses admission and returns a clear full-lobby result.
- **Given** the host leaves and one member remains, **when** Presence synchronizes, **then** the remaining oldest member is derived as host and the former host is removed.
- **Given** multiple clients have equal or invalid join timestamps, **when** host election is derived, **then** valid timestamps sort first and member ID is the deterministic tie-breaker; malformed metadata is ignored.
- **Given** the same member identity appears more than once in a Presence snapshot, **when** members are normalized, **then** the UI/session model contains that identity once, preferring the greatest valid `joinedAt` and using lexicographically smaller normalized display name as a deterministic tie-break.

### Lifecycle and recovery

- **Given** a joined member chooses leave or the owning view is disposed, **when** cleanup runs, **then** local presence is untracked, the channel is removed, listeners are detached, and repeated cleanup is safe.
- **Given** the channel reports a recoverable channel error, timeout, or closure, **when** the session remains active, **then** state becomes reconnecting and the client makes at most five automatic resubscription attempts with exponential full-jitter delays capped at eight seconds.
- **Given** resubscription succeeds, **when** the channel confirms subscription, **then** the client waits for initial Presence synchronization, counts distinct other member IDs (excluding its own possibly stale key) against capacity, tracks the same per-tab `memberId` exactly once with a fresh `joinedAt`, and reports joined only after its own presence and at least one other member are confirmed. If other members fill the lobby, it leaves and reports full rather than exceeding the configured cap intentionally.
- **Given** reconnect attempts are exhausted, **when** the final attempt fails, **then** state becomes a recoverable error with an explicit retry action and no stale joined indicator.
- **Given** a member leaves while another participant remains, **when** Presence synchronizes, **then** that participant sees the departure and host is recalculated from the current snapshot. Members shown from the last snapshot during a connection outage are marked stale/unknown until a new sync replaces that snapshot.

### Typed realtime data

- **Given** an incoming Broadcast payload is received by an enabled handler, **when** it is processed, **then** it is runtime-validated as `unknown` against the PRD's typed event union before any field is used; malformed or unknown payloads are ignored and do not mutate session state. Phase 2 does not need to send Broadcast messages for membership, capacity, or host election.
- **Given** Presence metadata is received, **when** it is processed, **then** member ID, display name, and finite join timestamp are validated and invalid entries are excluded.
- **Given** an outgoing event is created by a Phase 2 handler, **when** it crosses the Realtime seam, **then** it conforms to the relevant exported narrow event union from the PRD and includes `senderId`; Phase 2 sends no membership or host-authority event and activates no chat or WebRTC behavior.

## Technical contracts and state transitions

### Identity and member metadata

- A member has a per-tab-session `memberId` generated with browser cryptographic randomness, a display name normalized to Unicode NFC and trimmed, containing 1–40 Unicode code points and no control characters, and a `joinedAt` epoch-millisecond timestamp assigned on each successful Presence track. A reconnect in the same active session reuses `memberId` but uses a fresh timestamp so a member absent from Presence does not reclaim seniority on return.
- Display name is the only lobby-related value allowed in localStorage. Lobby code, member list, host, connection state, and messages remain in memory.
- Presence payload contract: `{ memberId: string, displayName: string, joinedAt: number }`. Do not trust the channel key or payload as authenticated identity.
- `MAX_LOBBY_MEMBERS` remains the single capacity source of truth (currently 2); code length remains centralized (`LOBBY_CODE_LENGTH`, currently 6).

### Code contract

- Code alphabet is exactly `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (uppercase Latin letters and digits, excluding `I`, `O`, `0`, and `1`); length is exactly six.
- Validation is case-normalizing, then exact length and alphabet validation. No silent truncation or partial acceptance.
- Generated codes use `crypto.getRandomValues` with rejection sampling to avoid modulo bias; randomness is for collision avoidance, not authorization or secrecy.

### Lobby session interface

The planned deep module exposes a small browser-only session interface: create/join with a code intent and display name, subscribe to a typed immutable session snapshot, retry after terminal/recoverable failure, and idempotently leave/dispose. Its implementation owns Supabase client/channel construction, event validation, Presence normalization, reconnect timers, and cleanup. UI and store code consume snapshots and actions without manipulating Supabase channels directly.

Session states: `idle → connecting → joined`; `connecting/joined → reconnecting → joined`; `connecting/reconnecting → error`; any active state may transition to `leaving → idle`. A denied/full/invalid input can produce a typed failure result before `connecting`. Host is derived from normalized current presence, never independently broadcast or persisted.

### Broadcast contract

Phase 2 membership uses Presence and requires no Broadcast message. The existing PRD event union remains the planned typed Broadcast contract for later phases; any handler that is enabled must parse `unknown` against its exact event variant before use. Do not add a Phase 2-only protocol version or broadcast presence snapshots as authority. Existing `rtc:*`, `share:*`, and `chat:*` event variants are reserved for later phases and must not be wired into behavior here.

## Concurrency and security limitations

- Supabase Presence has no compare-and-set admission transaction. Two concurrent joiners can both observe one slot and briefly or persistently exceed capacity. The client must wait for initial sync, check immediately before tracking, and reconcile after sync, but this is best-effort UX enforcement, not a hard invariant. It cannot evict an excess member safely because no authenticated authority exists to choose who should leave.
- The first member observed locally is not a globally atomic host lock. Host is deterministically derived from each client's current normalized Presence set; two clients with the same snapshot and tie-break inputs derive the same host, while concurrent arrivals or delayed/different sync snapshots can cause temporary disagreement. Client clock skew can also make a later join appear older. Ties use member ID. Use client timestamps as ordering hints, not trusted time.
- There is no Supabase Auth or server-side authorization. Anyone who knows or guesses a code can subscribe; sender IDs, display names, timestamps, and Broadcast claims can be forged. The short code is discoverability, not access control. Never put secrets or trusted privileges in lobby metadata.
- Client-generated codes can collide. Occupancy checks and bounded retries reduce accidental collision but cannot reserve a channel atomically. Simultaneous creators may converge on one channel; this is an accepted limitation under the no-database/no-server constraint.
- Reconnect status and Presence are eventually consistent. UI must avoid claiming confirmed membership until subscription, initial sync, and tracking succeed. Preserve the last member snapshot only as stale/unknown while disconnected, then replace it after sync. Supabase Presence expiry timing is service-managed; the client cannot guarantee immediate removal of a crashed or partitioned member.
- A successful `join` requires another valid member in the observed snapshot. A channel with no members is considered unavailable to joiners; only the create flow may intentionally establish the first presence. This narrows accidental room creation but cannot close the race where the last member leaves between the joiner's sync and track.
- Public Supabase URL/key are expected client configuration. Rate limiting, abuse prevention, durable room ownership, and adversarial capacity enforcement are unavailable in this architecture.

## Testing decisions

- Unit tests cover code generation/validation including unbiased index mapping, display-name normalization and length/control-character rejection, validation of PRD Broadcast event variants (without activating their behaviors), Presence normalization/deduplication, host ordering/tie-breaks, join-existing-member and capacity decisions at observed snapshots, and legal session state transitions/retry policy.
- Tests assert observable module behavior through pure exported functions and the lobby-session interface; they do not inspect private implementation details.
- Integration tests with two or more real browser clients against a dedicated Supabase Realtime project cover create, join-only-existing, empty-channel rejection, Presence sync, full-lobby UX, host succession, leave cleanup, disconnect/reconnect, and duplicate-presence prevention. Unit tests or mocked channels cannot prove Supabase Presence ordering, subscription callbacks, permission configuration, expiry, or channel removal semantics.
- Keep integration credentials out of source control and make the integration suite explicitly opt-in. If no test Supabase project is available, record those checks as not run rather than treating mocks as equivalent evidence.

## Out of scope

WebRTC signaling behavior, screen capture, stream lifecycle, video playback, chat, system chat messages, quality selection, ICE/TURN, database persistence, Supabase Auth, server routes, and non-two-person product policy changes.

## Further notes

The seam assumption for implementation is one lobby-session module with pure policy helpers underneath and a UI/store adapter above it. Review this interface and the stated best-effort admission semantics before implementation begins.
