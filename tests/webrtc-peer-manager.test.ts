import { describe, expect, it, vi } from "vitest";
import { createPeerManager, type PeerAdapter } from "../lib/webrtc/peer-manager";
import type { RealtimeEvent } from "../lib/realtime/events";

class FakePeer implements PeerAdapter {
  connectionState: RTCPeerConnectionState = "new";
  iceConnectionState: RTCIceConnectionState = "new";
  iceGatheringState: RTCIceGatheringState = "new";
  onconnectionstatechange: (() => void) | null = null;
  oniceconnectionstatechange: (() => void) | null = null;
  onicegatheringstatechange: (() => void) | null = null;
  signalingState: RTCSignalingState = "stable";
  remoteDescription: RTCSessionDescriptionInit | null = null;
  localDescription: RTCSessionDescriptionInit | null = null;
  onicecandidate: ((event: RTCPeerConnectionIceEvent) => void) | null = null;
  ontrack: ((event: RTCTrackEvent) => void) | null = null;
  calls: string[] = [];
  candidates: RTCIceCandidateInit[] = [];
  closeCalls = 0;
  addTrack(track: MediaStreamTrack, stream: MediaStream): RTCRtpSender { this.calls.push(`track:${track.id}:${stream.id}`); return {} as RTCRtpSender; }
  async createOffer(): Promise<RTCSessionDescriptionInit> { this.calls.push("createOffer"); return { type: "offer", sdp: "offer-sdp" }; }
  restartIce(): void { this.calls.push("restartIce"); }
  async createAnswer(): Promise<RTCSessionDescriptionInit> { this.calls.push("createAnswer"); return { type: "answer", sdp: "answer-sdp" }; }
  async setLocalDescription(description: RTCSessionDescriptionInit): Promise<void> { this.calls.push(`local:${description.type}`); this.localDescription = description; }
  async setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void> { this.calls.push(`remote:${description.type}`); this.remoteDescription = description; }
  async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> { this.calls.push(`ice:${candidate.candidate}`); this.candidates.push(candidate); }
  close(): void { this.calls.push("close"); this.closeCalls += 1; }
  emitCandidate(candidate: RTCIceCandidateInit): void { this.onicecandidate?.({ candidate: { toJSON: () => candidate } } as RTCPeerConnectionIceEvent); }
  emitTrack(event: RTCTrackEvent): void { this.ontrack?.(event); }
}

const description = (type: "offer" | "answer"): RTCSessionDescriptionInit => ({ type, sdp: `${type}-sdp` });
const candidate = (value: string): RTCIceCandidateInit => ({ candidate: value });

function setup() {
  const peer = new FakePeer();
  const send = vi.fn<(event: RealtimeEvent) => void>();
  const onTrack = vi.fn<(event: RTCTrackEvent) => void>();
  const onError = vi.fn<(reason: "peer-failed") => void>();
  const onIceDiagnostics = vi.fn();
  const manager = createPeerManager({
    selfMemberId: "host", remoteMemberId: "viewer", sessionId: "generation-1", peerFactory: () => peer,
    send, onTrack, onError, onIceDiagnostics,
  });
  return { peer, send, onTrack, onError, onIceDiagnostics, manager };
}

describe("peer manager", () => {
  it("adds tracks before creating and sending a targeted generation offer", async () => {
    const { peer, send, manager } = setup();
    const track = { id: "video-1" } as MediaStreamTrack;
    const stream = { id: "stream-1" } as MediaStream;
    await manager.addTracks([{ track, stream }]);
    await manager.createOffer();
    expect(peer.calls).toEqual(["track:video-1:stream-1", "createOffer", "local:offer"]);
    expect(send).toHaveBeenCalledWith({ type: "rtc:offer", senderId: "host", targetId: "viewer", sessionId: "generation-1", description: { type: "offer", sdp: "offer-sdp" } });
  });

  it("applies an offer before answering and sends a targeted answer", async () => {
    const { peer, send, manager } = setup();
    await manager.receiveOffer(description("offer"));
    expect(peer.calls).toEqual(["remote:offer", "createAnswer", "local:answer"]);
    expect(send).toHaveBeenCalledWith({ type: "rtc:answer", senderId: "host", targetId: "viewer", sessionId: "generation-1", description: { type: "answer", sdp: "answer-sdp" } });
  });

  it("queues ICE before remote description and flushes once in arrival order", async () => {
    const { peer, manager } = setup();
    await manager.addIceCandidate(candidate("one"));
    await manager.addIceCandidate(candidate("two"));
    expect(peer.candidates).toEqual([]);
    await manager.receiveAnswer(description("answer"));
    expect(peer.calls.slice(-3)).toEqual(["remote:answer", "ice:one", "ice:two"]);
  });

  it("sends trickle ICE tagged for this member and generation", async () => {
    const { peer, send, manager } = setup();
    const value = candidate("candidate-1");
    await manager.createOffer();
    peer.emitCandidate(value);
    expect(send).toHaveBeenCalledWith({ type: "rtc:ice", senderId: "host", targetId: "viewer", sessionId: "generation-1", candidate: value });
  });

  it("reports candidate application errors without throwing", async () => {
    const { peer, onError, manager } = setup();
    peer.addIceCandidate = async () => { throw new Error("candidate rejected"); };
    await manager.receiveAnswer(description("answer"));
    await manager.addIceCandidate(candidate("bad"));
    expect(onError).toHaveBeenCalledWith("peer-failed");
  });

  it("forwards remote track events", () => {
    const { peer, onTrack, manager } = setup();
    const event = { track: { id: "remote-video" } } as RTCTrackEvent;
    peer.emitTrack(event);
    expect(onTrack).toHaveBeenCalledWith(event);
    manager.close();
  });

  it("contains negotiation and send failures and closes idempotently", async () => {
    const { peer, send, onError, manager } = setup();
    send.mockImplementation(() => { throw new Error("offline"); });
    await manager.createOffer();
    expect(onError).toHaveBeenCalledWith("peer-failed");
    manager.close();
    manager.close();
    expect(peer.closeCalls).toBe(1);
    expect(peer.ontrack).toBeNull();
    expect(peer.onicecandidate).toBeNull();
    peer.emitCandidate(candidate("late"));
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("restarts ICE with one restart offer", async () => {
    const { peer, send, manager } = setup();
    await manager.restartIce?.();
    expect(peer.calls).toContain("restartIce");
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: "rtc:offer", description: expect.objectContaining({ type: "offer" }) }));
  });

  it("reports candidate type counts and selected pair without candidate addresses", async () => {
    const { peer, manager, onIceDiagnostics } = setup();
    const values: Record<string, unknown>[] = [
      { id: "transport", type: "transport", selectedCandidatePairId: "pair" },
      { id: "pair", type: "candidate-pair", localCandidateId: "local", remoteCandidateId: "remote" },
      { id: "local", type: "local-candidate", candidateType: "relay", address: "secret-ip" },
      { id: "remote", type: "remote-candidate", candidateType: "srflx", address: "secret-ip" },
      { id: "other", type: "local-candidate", candidateType: "host", address: "secret-ip" },
    ];
    const stats = Object.assign(new Map(values.map((value) => [String(value.id), value])), { forEach: (callback: (value: Record<string, unknown>) => void) => values.forEach(callback) });
    const directPeer = peer as unknown as { getStats(): Promise<typeof stats>; connectionState: RTCPeerConnectionState };
    directPeer.getStats = async () => stats;
    directPeer.connectionState = "connected";
    peer.onconnectionstatechange?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onIceDiagnostics).toHaveBeenCalledWith(expect.objectContaining({ connection: "relayed", candidateCounts: expect.objectContaining({ host: 1, relay: 1 }) }));
    manager.close();
  });
});
