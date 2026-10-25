# Phase 3: WebRTC Screen Sharing — Specification

## Problem and scope

Phase 2 provides an ephemeral two-member lobby, Presence-derived host identity, typed Broadcast event parsing, a lobby route, and placeholder WebRTC/stream files. Phase 3 adds host-initiated desktop capture and direct host-to-viewer media. Supabase Realtime Broadcast carries signaling and share lifecycle notices only; RTP media travels directly between browsers. This phase adds no Auth, database, API route, custom server, media relay, or WebRTC helper dependency.

The lobby remains the source of membership and derived host identity. Host status is not authorization: Presence and Broadcast sender IDs are public, client-asserted data.

## Screen capture requirements

- Only the member currently derived as host may start capture. A viewer never sees an enabled capture action. Losing host status immediately stops capture, closes all host peers, and publishes a best-effort stop notice when possible.
- Capture is initiated only from an explicit user gesture through `navigator.mediaDevices.getDisplayMedia()` in a browser-only module. Desktop Chrome and Edge are primary capture targets. Mobile users may view a stream but must not be offered unsupported capture controls.
- Prefer browser tab sharing with tab audio where the browser exposes those choices. The app cannot force a particular source or guarantee the browser offers audio selection. Missing audio is an actionable nonfatal state; video sharing continues without audio.
- Handle unavailable APIs, unsupported context/browser, permission denial, user cancellation, acquisition failure, and streams without expected tracks as distinct user-facing outcomes. Cancellation is not treated as an application failure.
- Observe the captured video track's `ended` lifecycle (native browser Stop sharing included) and run the same idempotent stop path as the app's Stop control. Stop all owned tracks during teardown.
- Host preview uses the local captured stream with `muted`, `playsInline`, and no audible local playback to avoid feedback.

## WebRTC and signaling requirements

- Use native `RTCPeerConnection`. The host owns one peer connection per observed viewer; there is no viewer-to-viewer media mesh. Add the host's captured tracks to each peer. A newly elected host starts with no active capture and must explicitly initiate a new share.
- Supabase Realtime Broadcast is signaling-only: typed targeted offers, answers, and ICE candidates plus share lifecycle/request notices. Video/audio must never pass through Supabase or an application server.
- Reuse `RealtimeEvent`, `parseRealtimeEvent(unknown)`, and the existing `rtc:offer`, `rtc:answer`, `rtc:ice`, and `share:*` variants where possible. Phase 3 must extend the wire contract with a bounded share/session generation identifier on all signaling and share lifecycle events before enabling it. Ignore events for a different generation, wrong target, non-current lobby member, or incorrect role. Validate all payloads as untrusted `unknown` before accessing fields.
- Complete offer/answer exchange and trickle ICE both ways. Queue remote ICE until a remote description is installed. Handle duplicate and out-of-order messages without applying them to the wrong peer generation.
- Use public STUN defaults and optional TURN from the existing `.env.example` convention. TURN username/credential values placed in `NEXT_PUBLIC_*` are visible to every client; never call them secrets or use them as protected authorization. A production-safe short-lived TURN credential needs a trusted issuer, which conflicts with the no-backend constraint and is an approval decision. Static public credentials are abuse-prone. Requested resolution, frame rate, and bitrate are best effort; browser/source/device/network negotiation may differ.
- STUN-only connectivity often works on open networks but can fail across symmetric NATs, restrictive firewalls, VPNs, or UDP-blocking networks. TURN relays media and improves reachability at bandwidth and provider cost; it does not make Supabase carry media. Without configured TURN, show actionable connectivity guidance and accept that some pairs cannot connect.

## Session and membership lifecycle

- A viewer joining while `share:started` is current sends a targeted-by-identity `share:request`; the host creates a fresh peer and offer for that viewer. A viewer already present when sharing begins receives its own offer.
- On viewer departure, remove its peer and release listeners/queued candidates. On viewer Realtime reconnection, reconcile current Presence and active share generation; request a fresh negotiation rather than reusing old SDP/ICE. Do not treat a stale roster during outage as current membership.
- On ICE `failed`, attempt bounded recovery: first one `restartIce()` renegotiation for the peer if supported, then recreate that viewer's peer/offer once after a short bounded backoff. Close and surface a failed state after recovery exhaustion. `disconnected` is transient and gets a grace interval before recovery. Cancel all recovery timers on stop, membership removal, generation change, or disposal.
- Host departure, host identity change, host Realtime loss beyond the lobby's joined/current state, or capture track end stops the share and closes every peer. A replacement host explicitly starts a new generation. Never carry capture or peer state across host migration.
- Generation tokens must make old Broadcast events, ICE callbacks, track events, timers, and peer state inert after stop/restart, reconnect replacement, or host migration.
- Cleanup is idempotent and releases every `RTCPeerConnection`, sender/receiver event listener, Broadcast listener, timer, local media track, and detached video element `srcObject` owned by the session.

## Playback and user interface

- Viewer renders incoming remote video and optional audio. Do not assume `HTMLMediaElement.play()` succeeds: attempt playback, detect rejection/autoplay blocking, and provide a clearly labeled explicit user action to enable sound/playback. Do not repeatedly prompt after user dismissal.
- Provide fullscreen through the browser Fullscreen API with support/error handling. Controls and status must remain keyboard-accessible and have accessible names; status updates use a polite live region, with urgent terminal errors announced appropriately.
- Show distinct `loading`, `connecting`, `playing`, `interrupted`, and `failed` states for viewers, plus capture/host states. Recovery is visible and does not falsely claim playback.
- Keep all UI text in `lib/i18n.ts`, Persian-first with RTL preserved and English translations. Media status, permission and missing-audio guidance, autoplay, quality names, fullscreen, retry, and unsupported-device messages need translations.

## Quality requirements

- Default capture target is 1280×720 at 30 FPS. Offer 480p, 720p, and 1080p presets. Treat them as requested constraints/preferences, not guarantees; browser chooser, source, OS, device, codec, and hardware may negotiate a different result.
- Apply a video sender bitrate ceiling near 2.5 Mbps when `RTCRtpSender.setParameters()` is available and accepts the change. Presets may select lower target ceilings, but remain best effort. Do not promise fixed resolution, frame rate, latency, or quality.
- Document that high-resolution capture/encode can overload hardware or network, and that mobile viewing/browser decoding capability varies.

## Security and data boundaries

- Validate event shape, size, session generation, `senderId`, `targetId`, observed Presence membership, and role expectations before handling any signal. Sender and member identity are client claims; observed membership checks reduce accidental/stale traffic but do not authenticate a sender.
- Never claim that unauthenticated Supabase Presence provides secure authorization, private rooms, or protection from a member impersonating another ID. The public lobby code is discoverability only.
- Do not expose TURN secrets in public client configuration. If TURN service requires credentials, document static public credentials as abuse-prone and propose trusted credential issuance as a separately approved backend architecture change; do not add that backend in Phase 3.
- No Supabase Auth, tables/database, API routes, server code, lobby persistence, or media relay. Display name remains the only localStorage value.

## Acceptance criteria

1. Only the current host can start sharing; non-host and mobile capture controls are absent/disabled with localized guidance.
2. Desktop host can start tab/display capture by explicit action, preview muted, and stop through app control or native browser Stop sharing; denial/cancellation/unsupported/missing-audio cases are understandable.
3. Each viewer has an independent host peer connection; valid targeted offer/answer/ICE exchanges establish direct media. Media is not relayed by Supabase or an application server.
4. A viewer joining during an active generation receives a fresh negotiation and media without requiring the host to stop/restart.
5. Viewer leave/reconnect, host leave/migration, ICE failure, stale messages, and stop/restart clean up and recover within bounded policy; a new host must explicitly start a new share.
6. Viewer playback shows connecting/playing/interrupted/failed/loading state, handles autoplay rejection with an explicit gesture, and supports fullscreen.
7. 480p/720p/1080p choices and default 720p/30 target are offered as best-effort constraints, with supported bitrate limiting and no fixed-quality promise.
8. Persian-first RTL and English controls/statuses are accessible and localized.
9. Runtime payload validation and observed-member/role/generation checks reject malformed, mistargeted, non-member, or stale signals without mutating current peer state.
10. Pure policy and mocked browser seams pass focused Vitest tests; separate real-browser two-device acceptance confirms actual media connectivity. Mock tests alone are not evidence of WebRTC connectivity.
11. `npm run typecheck`, `npm run lint`, `npm run build`, and `npm test` pass. No server route, database, Auth, dependency, or Phase 2 lobby behavior change is introduced.

## Decisions and unresolved risks

- **Protocol generation field:** the current Phase 2 wire variants lack a negotiation/session ID. Phase 3 must add it to `rtc:*` and `share:*` payloads. Approval is needed if strict compatibility with any already-deployed Phase 2 client is required; current project docs describe no deployed versioning requirement.
- **TURN credential model:** `.env.example` currently documents public `NEXT_PUBLIC_TURN_*` values. Static credentials in a browser are extractable. Secure short-lived issuance requires a trusted backend and conflicts with project constraints; choose between an explicitly public/abuse-limited relay service or defer TURN pending architecture approval.
- **Presence snapshots are not authorization:** malicious members can forge sender IDs or flood valid-looking signaling. Strict shape/rate/size limits reduce malformed input, not impersonation or denial of service.
- **Browser support is uneven:** capture audio selection, mobile remote playback, codec negotiation, autoplay, fullscreen, and sender parameter behavior vary. Manual browser/device coverage is required.
- **Network and resource limits:** STUN-only failure, TURN cost, host uplink/encoder limits, and 1080p hardware load mean no guaranteed connectivity or quality.
- **Phase 2 connection state nuance:** the existing session exposes reconnecting/stale presence. Phase 3 must define a bounded host-loss grace interval (recommended 10 seconds) before treating a temporary host disconnect as share termination; no capture state may survive confirmed host migration.
