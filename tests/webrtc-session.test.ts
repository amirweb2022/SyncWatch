import { describe, expect, it, vi } from "vitest";
import type { LobbySessionSnapshot } from "../lib/realtime/session";
import type { RealtimeEvent } from "../lib/realtime/events";
import type { CaptureSession } from "../lib/webrtc/capture";
import { createStreamSession, type StreamSessionDependencies } from "../lib/webrtc/session";

function roster(host = "host", viewer = "viewer"): LobbySessionSnapshot {
  return {
    status: "joined", code: "ABC234", selfMemberId: "host", hostMemberId: host,
    members: [{ memberId: host, displayName: host, joinedAt: 1 }, { memberId: viewer, displayName: viewer, joinedAt: 2 }],
    error: null, presenceStatus: "current",
  };
}

function setup(role: "host" | "viewer" = "host") {
  let generationNumber = 0;
  let snapshot = role === "host" ? roster() : { ...roster(), selfMemberId: "viewer" };
  const lobbyListeners = new Set<(value: LobbySessionSnapshot) => void>();
  const eventListeners = new Set<(event: RealtimeEvent) => void>();
  const sent: RealtimeEvent[] = [];
  const sourceTrack = { kind: "video" };
  const sourceStream = { id: "stream", getTracks: () => [sourceTrack] };
  const capture = { stream: sourceStream, tracks: [{ kind: "video", stop: vi.fn(), onEnded: () => () => {} }], audio: "present" as const, preview: { stream: sourceStream, muted: true as const, playsInline: true as const }, stop: vi.fn() } as unknown as CaptureSession;
  const captureManager = { start: vi.fn(async () => ({ status: "started" as const, capture })) };
  const peers: Array<{ remote: string; sessionId: string; addTracks: ReturnType<typeof vi.fn>; createOffer: ReturnType<typeof vi.fn>; receiveOffer: ReturnType<typeof vi.fn>; receiveAnswer: ReturnType<typeof vi.fn>; addIceCandidate: ReturnType<typeof vi.fn>; restartIce: ReturnType<typeof vi.fn>; fail: () => void; state: (value: RTCPeerConnectionState) => void; track: (event: RTCTrackEvent) => void; close: ReturnType<typeof vi.fn> }> = [];
  const dependencies: StreamSessionDependencies = {
    lobby: { getSnapshot: () => snapshot, subscribe: (listener) => { lobbyListeners.add(listener); return () => lobbyListeners.delete(listener); } },
    channel: { send: async (event) => { sent.push(event); return { ok: true }; }, onEvent: (listener) => { eventListeners.add(listener); return () => eventListeners.delete(listener); } },
    capture: captureManager,
    createPeer: (options) => {
      const peer = { remote: options.remoteMemberId, sessionId: options.sessionId, addTracks: vi.fn(async () => {}), createOffer: vi.fn(async () => {}), receiveOffer: vi.fn(async () => {}), receiveAnswer: vi.fn(async () => {}), addIceCandidate: vi.fn(async () => {}), restartIce: vi.fn(async () => {}), fail: () => options.onError?.("peer-failed"), state: (state: RTCPeerConnectionState) => options.onConnectionState?.(state), track: (event: RTCTrackEvent) => options.onTrack?.(event), close: vi.fn() };
      peers.push(peer);
      return peer;
    },
    createSessionId: () => `generation-${++generationNumber}`,
  };
  const session = createStreamSession(dependencies);
  return {
    session, sent, peers, capture, captureManager, sourceTrack, sourceStream, dependencies,
    emit(event: RealtimeEvent) { for (const listener of eventListeners) listener(event); },
    setSnapshot(next: LobbySessionSnapshot) { snapshot = next; for (const listener of lobbyListeners) listener(next); },
  };
}

describe("stream session Task 06 coordinator", () => {
  it("keeps host resources through a transient lobby disconnect and cancels the 10-second grace on reconnect", async () => {
    vi.useFakeTimers();
    const value = setup();
    await value.session.start("720p");
    value.setSnapshot({ ...roster(), status: "reconnecting", presenceStatus: "stale" });
    expect(value.capture.stop).not.toHaveBeenCalled();
    value.setSnapshot(roster());
    await vi.advanceTimersByTimeAsync(10_000);
    expect(value.capture.stop).not.toHaveBeenCalled();
    vi.useRealTimers();
  });

  it("closes host resources when the 10-second realtime grace expires", async () => {
    vi.useFakeTimers();
    const value = setup();
    await value.session.start("720p");
    value.setSnapshot({ ...roster(), status: "reconnecting", presenceStatus: "stale" });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(value.capture.stop).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it("closes a departed viewer peer immediately and allows a fresh peer after rejoin", async () => {
    const value = setup();
    await value.session.start("720p");
    const removed = { ...roster(), members: [{ memberId: "host", displayName: "host", joinedAt: 1 }] };
    value.setSnapshot(removed);
    expect(value.peers[0]?.close).toHaveBeenCalledOnce();
    value.setSnapshot(roster());
    expect(value.peers).toHaveLength(2);
  });

  it("cancels host grace on explicit stop", async () => {
    vi.useFakeTimers();
    const value = setup();
    await value.session.start("720p");
    value.setSnapshot({ ...roster(), status: "reconnecting", presenceStatus: "stale" });
    await value.session.stop();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(value.capture.stop).toHaveBeenCalledOnce();
    expect(value.session.getSnapshot().sessionId).toBeNull();
    vi.useRealTimers();
  });

  it("restarts ICE once, recreates a failed host peer once, then stops retrying", async () => {
    vi.useFakeTimers();
    const value = setup();
    await value.session.start("720p");
    const original = value.peers[0];
    original?.fail();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(original?.restartIce).toHaveBeenCalledOnce();
    original?.fail();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(original?.close).toHaveBeenCalledOnce();
    expect(value.peers).toHaveLength(2);
    value.peers[1]?.fail();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(value.peers).toHaveLength(2);
    expect(value.session.getSnapshot().failure).toBe("connection-failed");
    vi.useRealTimers();
  });

  it("waits through transient peer disconnection and restarts ICE after the grace expires", async () => {
    vi.useFakeTimers();
    const value = setup();
    await value.session.start("720p");
    const peer = value.peers[0];
    peer?.state("disconnected");
    await vi.advanceTimersByTimeAsync(4_999);
    expect(peer?.restartIce).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(peer?.restartIce).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it("starts host capture and creates one track-bearing peer per current viewer", async () => {
    const value = setup();
    await value.session.start("720p");
    expect(value.captureManager.start).toHaveBeenCalledOnce();
    expect(value.peers).toHaveLength(1);
    expect(value.peers[0]?.remote).toBe("viewer");
    expect(value.peers[0]?.addTracks).toHaveBeenCalled();
    expect(value.peers[0]?.addTracks).toHaveBeenCalledWith([{ track: value.sourceTrack, stream: value.sourceStream }]);
    expect(value.sent[0]).toMatchObject({ type: "share:started", senderId: "host", sessionId: "generation-1" });
  });

  it("closes the old peer and negotiates a fresh generation after host stop and restart", async () => {
    const value = setup();
    await value.session.start("720p");
    await value.session.stop();
    await value.session.start("720p");
    expect(value.captureManager.start).toHaveBeenCalledTimes(2);
    expect(value.peers).toHaveLength(2);
    expect(value.peers[0]?.close).toHaveBeenCalledOnce();
    expect(value.peers[1]?.sessionId).toBe("generation-2");
    expect(value.sent.filter((event) => event.type === "share:started").map((event) => event.sessionId)).toEqual(["generation-1", "generation-2"]);
  });

  it("publishes the captured local preview to media observers and clears it on stop", async () => {
    const value = setup();
    const updates: Array<{ local: MediaStream | null; remote: MediaStream | null }> = [];
    value.session.subscribeMedia((media) => updates.push(media));
    await value.session.start("720p");
    expect(value.session.getMedia().local).toBe(value.sourceStream);
    await value.session.stop();
    expect(value.session.getMedia()).toEqual({ local: null, remote: null, audio: null });
    expect(updates.length).toBeGreaterThanOrEqual(2);
  });

  it("attaches the viewer peer's remote stream and ignores callbacks after stop", async () => {
    const value = setup("viewer");
    const media = { getTracks: () => [] } as unknown as MediaStream;
    value.emit({ type: "share:started", senderId: "host", sessionId: "generation-1" });
    value.peers[0]?.track?.({ streams: [media] } as unknown as RTCTrackEvent);
    expect(value.session.getMedia().remote).toBe(media);
    await value.session.stop();
    value.peers[0]?.track({ streams: [media] } as unknown as RTCTrackEvent);
    expect(value.session.getMedia().remote).toBeNull();
  });

  it("allows only a current viewer with a generation to request sharing", async () => {
    const value = setup("viewer");
    await value.session.requestShare();
    expect(value.sent).toEqual([]);
    value.emit({ type: "share:started", senderId: "host", sessionId: "generation-1" });
    await value.session.requestShare();
    expect(value.sent.filter((event) => event.type === "share:request")).toHaveLength(2);
    await value.session.dispose();
    await value.session.requestShare();
    expect(value.sent.filter((event) => event.type === "share:request")).toHaveLength(2);
  });

  it("reports playing only from viewer media playback and preserves host sharing state", async () => {
    const viewer = setup("viewer");
    viewer.emit({ type: "share:started", senderId: "host", sessionId: "generation-1" });
    viewer.session.reportPlayback(true);
    expect(viewer.session.getSnapshot().status).toBe("playing");
    viewer.session.reportPlayback(false);
    expect(viewer.session.getSnapshot().status).toBe("connecting");
    const host = setup("host");
    await host.session.start("720p");
    host.session.reportPlayback(true);
    expect(host.session.getSnapshot().status).toBe("sharing");
  });

  it("survives setup-cleanup-setup replay with only the second coordinator active", async () => {
    const first = setup();
    await first.session.dispose();
    const replay = setup();
    await replay.session.start("720p");
    expect(replay.captureManager.start).toHaveBeenCalledOnce();
    expect(replay.session.getSnapshot().status).toBe("sharing");
    await replay.session.dispose();
    expect(replay.capture.stop).toHaveBeenCalledOnce();
  });

  it("rejects capture for a non-host", async () => {
    const value = setup("viewer");
    await value.session.start("720p");
    expect(value.captureManager.start).not.toHaveBeenCalled();
  });

  it("adopts the current host generation from an offer when the viewer joined after sharing began", () => {
    const value = setup("viewer");
    const offer: RealtimeEvent = { type: "rtc:offer", senderId: "host", targetId: "viewer", sessionId: "generation-1", description: { type: "offer", sdp: "offer" } };
    value.emit(offer);
    expect(value.session.getSnapshot()).toMatchObject({ status: "connecting", sessionId: "generation-1" });
    expect(value.peers).toHaveLength(1);
    expect(value.peers[0]?.receiveOffer).toHaveBeenCalledWith(offer.description);
  });

  it("requests the active generation as a viewer and answers only a targeted current-host offer", async () => {
    const value = setup("viewer");
    expect(value.sent).toEqual([]);
    value.emit({ type: "share:started", senderId: "host", sessionId: "generation-1" });
    expect(value.sent).toContainEqual({ type: "share:request", senderId: "viewer", sessionId: "generation-1" });
    const offer: RealtimeEvent = { type: "rtc:offer", senderId: "host", targetId: "viewer", sessionId: "generation-1", description: { type: "offer", sdp: "offer" } };
    value.emit(offer);
    expect(value.peers[0]?.receiveOffer).toHaveBeenCalledWith(offer.description);
  });

  it("defers an active-share announcement until the viewer's lobby membership is current", () => {
    const value = setup("viewer");
    value.setSnapshot({ ...roster(), selfMemberId: "viewer", status: "reconnecting", presenceStatus: "stale" });
    value.emit({ type: "share:started", senderId: "host", sessionId: "generation-1" });
    expect(value.sent).toEqual([]);
    value.setSnapshot({ ...roster(), selfMemberId: "viewer" });
    expect(value.sent).toContainEqual({ type: "share:request", senderId: "viewer", sessionId: "generation-1" });
  });

  it("ignores repeated offers and duplicate or mismatched share generations", () => {
    const value = setup("viewer");
    value.emit({ type: "share:started", senderId: "host", sessionId: "generation-1" });
    const offer: RealtimeEvent = { type: "rtc:offer", senderId: "host", targetId: "viewer", sessionId: "generation-1", description: { type: "offer", sdp: "offer" } };
    value.emit(offer);
    value.emit(offer);
    value.emit({ type: "share:started", senderId: "host", sessionId: "generation-2" });
    expect(value.peers).toHaveLength(1);
    expect(value.peers[0]?.receiveOffer).toHaveBeenCalledOnce();
    expect(value.sent.filter((event) => event.type === "share:request")).toHaveLength(1);
  });

  it("ignores non-members, wrong recipients, role mismatches, and stale generations", async () => {
    const value = setup("viewer");
    value.emit({ type: "share:started", senderId: "host", sessionId: "generation-1" });
    const base = { type: "rtc:offer" as const, senderId: "host", targetId: "viewer", sessionId: "generation-1", description: { type: "offer" as const, sdp: "offer" } };
    value.emit({ ...base, senderId: "stranger" });
    value.emit({ ...base, targetId: "other" });
    value.emit({ ...base, sessionId: "old-generation" });
    value.emit({ ...base, senderId: "viewer" });
    expect(value.peers).toHaveLength(1);
    expect(value.peers[0]?.receiveOffer).not.toHaveBeenCalled();
  });

  it("creates a fresh host peer for a present late viewer request and ignores duplicates", async () => {
    const value = setup();
    await value.session.start("720p");
    const request: RealtimeEvent = { type: "share:request", senderId: "viewer", sessionId: "generation-1" };
    value.emit(request);
    value.emit(request);
    value.emit({ ...request, senderId: "stranger" });
    expect(value.peers).toHaveLength(1);
  });

  it("routes answers and ICE only to the matching peer and closes resources on host loss", async () => {
    const value = setup();
    await value.session.start("720p");
    value.emit({ type: "rtc:answer", senderId: "viewer", targetId: "host", sessionId: "generation-1", description: { type: "answer", sdp: "answer" } });
    value.emit({ type: "rtc:ice", senderId: "viewer", targetId: "host", sessionId: "generation-1", candidate: { candidate: "candidate" } });
    expect(value.peers[0]?.receiveAnswer).toHaveBeenCalledOnce();
    expect(value.peers[0]?.addIceCandidate).toHaveBeenCalledOnce();
    value.setSnapshot({ ...roster("viewer"), selfMemberId: "host" });
    expect(value.capture.stop).toHaveBeenCalledOnce();
    expect(value.peers[0]?.close).toHaveBeenCalledOnce();
  });

  it("stops and invalidates the generation before subsequent signals can mutate peers", async () => {
    const value = setup();
    await value.session.start("720p");
    await value.session.stop();
    value.emit({ type: "share:request", senderId: "viewer", sessionId: "generation-1" });
    expect(value.peers).toHaveLength(1);
    expect(value.peers[0]?.close).toHaveBeenCalledOnce();
    expect(value.capture.stop).toHaveBeenCalledOnce();
  });

  it("unsubscribes Broadcast and lobby listeners when disposed", async () => {
    const value = setup();
    await value.session.dispose();
    value.emit({ type: "share:started", senderId: "host", sessionId: "generation-1" });
    expect(value.session.getSnapshot().sessionId).toBeNull();
  });
});
