# SyncWatch Product Requirements

## Goal

SyncWatch is a free, personal watch-party app for two people by default. A host shares their screen or browser tab; viewers watch the live peer-to-peer stream and chat.

## Non-goals

- Video URL ingestion, media hosting/transcoding, synchronized player controls, recording, or persistence.
- Accounts, authentication, Supabase tables/database, custom servers, or API routes.
- More than one host or non-host screen sharing.

## Users and flows

1. A visitor creates a lobby and receives a six-character code from an unambiguous alphabet.
2. Another visitor enters the code and a display name, then explicitly joins and enables playback.
3. The host starts sharing a screen/tab, selecting quality; viewers receive its live stream.
4. Members chat, inspect presence, copy/share the code, or leave. Leaving ends the ephemeral lobby when its channel has no members.
5. If the host leaves, sharing ends and the oldest remaining presence member becomes host.

## Functional requirements

- Mobile-first dark UI, Persian by default and English through a small dictionary; layouts support RTL.
- Store the display name in localStorage. No registration or persistent lobby data.
- Enforce the member limit through one config constant (default: 2). Reject full lobbies and invalid codes clearly.
- Only the host can capture/share. Viewers can view on mobile; capture is desktop-oriented.
- Chat is text-only, at most 500 characters, client-limited to 5 messages per 5 seconds. Render user text as text.
- Show members and online state, system join/leave/share messages, connection state, fullscreen, and a copy-code/share action.
- Host preview is muted. Warn hosts to use desktop Chrome/Edge and enable tab audio. Explain when capture is unsupported, denied, or has no audio track.
- Provide 480p/720p/1080p host quality choices; default capture target is 1280x720 at 30fps. Cap video bitrate near 2.5 Mbps.
- Viewer playback begins after a user gesture. Late viewers request a stream from the host.
- Handle reconnect, ICE restart, peer failure/retry, capture stop through track `onended`, host departure, offline state, and missing TURN configuration guidance.

## Architecture and data boundaries

- Next.js App Router, strict TypeScript, Tailwind CSS, Zustand, and Vitest for pure functions.
- Supabase Realtime only: Broadcast for signaling/chat and Presence for membership. No Auth or database.
- Native browser `RTCPeerConnection` and `getDisplayMedia`; host-to-viewer mesh. Media never traverses Supabase or app infrastructure.
- ICE includes public STUN and optional TURN configured by public environment variables.
- Lobby state exists only in channel `lobby:{CODE}` and client memory; nothing is persisted except the local display name.

## WebRTC signaling flow

1. Members subscribe to `lobby:{CODE}` and track presence; the first member is host.
2. A viewer broadcasts `share:request` when joining a host who is already sharing.
3. Host creates one peer connection per viewer, adds captured tracks, and broadcasts a targeted `rtc:offer`.
4. Viewer applies the offer, creates an answer, and broadcasts targeted `rtc:answer`.
5. Both sides exchange targeted `rtc:ice` candidates; host reports `share:started` and `share:stopped` through Broadcast.
6. On recoverable connection loss, reconnect and restart ICE; on host departure, close sharing and elect the oldest remaining presence member.

## Typed Broadcast event schema

All events carry `senderId`; directed WebRTC events also carry `targetId`.

```ts
interface EventBase { senderId: string }
interface TargetedEvent extends EventBase { targetId: string }
type SignalEvent =
  | (TargetedEvent & { type: "rtc:offer"; description: RTCSessionDescriptionInit })
  | (TargetedEvent & { type: "rtc:answer"; description: RTCSessionDescriptionInit })
  | (TargetedEvent & { type: "rtc:ice"; candidate: RTCIceCandidateInit })
  | (EventBase & { type: "share:started" })
  | (EventBase & { type: "share:stopped" })
  | (EventBase & { type: "share:request" })
  | (EventBase & { type: "chat:message"; messageId: string; name: string; text: string; sentAt: number });
```

Presence metadata contains member ID, display name, and join timestamp; host identity is derived from the oldest present member. Runtime validation of incoming Broadcast payloads is required before feature completion.

## Edge cases

- Capture unavailable/denied, mobile host, missing audio, or browser stop-sharing action.
- Full lobby, malformed code, host leaves, viewer joins during an active share.
- Autoplay blocked until gesture; no audio/video tracks; unsupported codecs or peer connection failure.
- Temporary disconnect/offline state, ICE failure, retries exhausted, optional TURN absent.
- Duplicate/stale signaling, malformed messages, rate-limited or overlong chat, member removal during setup.

## Acceptance criteria

- A host can create a code lobby; a second member can join by code and display name without an account.
- At the configured member cap, another join is refused with a clear message.
- Host sharing reaches viewers peer-to-peer; viewer playback starts after a gesture; host local preview is muted.
- Chat, member presence, system events, and share state are live and ephemeral.
- Host departure closes the stream and elects the oldest remaining member.
- Capture, autoplay, connectivity, code, and lobby-cap errors give actionable UI guidance.
- Strict typecheck, lint, build, and pure-function tests pass; no server routes, Auth, tables, or media relay are introduced.

## Decisions

- Default capacity is two; future changes use one exported constant.
- The host is the first presence member; host succession uses earliest join timestamp.
- Use a client-generated six-character unambiguous code; lobby state is not durable.
- Use Broadcast only for signaling/chat and Presence for membership, with targeted peer signaling.
- Use browser-native screen capture/WebRTC and a one-to-many host mesh.
- Keep implementation files small and isolate pure logic for unit tests.
