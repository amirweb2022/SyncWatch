import type { GenerationId, RealtimeEvent } from "../realtime/events";
import { logWebRtcDiagnostic } from "./diagnostics";

export interface PeerAdapter {
  readonly connectionState?: RTCPeerConnectionState;
  readonly signalingState: RTCSignalingState;
  readonly remoteDescription: RTCSessionDescriptionInit | null;
  restartIce?(): void;
  onicecandidate: ((event: RTCPeerConnectionIceEvent) => void) | null;
  ontrack: ((event: RTCTrackEvent) => void) | null;
  onconnectionstatechange?: (() => void) | null;
  oniceconnectionstatechange?: (() => void) | null;
  onicegatheringstatechange?: (() => void) | null;
  readonly iceConnectionState?: RTCIceConnectionState;
  readonly iceGatheringState?: RTCIceGatheringState;
  addTrack(track: MediaStreamTrack, stream: MediaStream): RTCRtpSender;
  createOffer(options?: RTCOfferOptions): Promise<RTCSessionDescriptionInit>;
  createAnswer(): Promise<RTCSessionDescriptionInit>;
  setLocalDescription(description: RTCSessionDescriptionInit): Promise<void>;
  setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void>;
  addIceCandidate(candidate: RTCIceCandidateInit): Promise<void>;
  close(): void;
}

interface CandidateStats { readonly type: string; readonly candidateType?: string }
interface CandidatePairStats { readonly type: string; readonly localCandidateId?: string; readonly remoteCandidateId?: string }
interface TransportStats { readonly type: string; readonly selectedCandidatePairId?: string }

export interface PeerManagerOptions {
  readonly lobbyId?: string | null;
  readonly hostMemberId?: string | null;
  readonly selfMemberId: string;
  readonly remoteMemberId: string;
  readonly sessionId: GenerationId;
  readonly peerFactory: () => PeerAdapter;
  readonly send: (event: RealtimeEvent) => void | { readonly ok: boolean } | Promise<void | { readonly ok: boolean }>;
  readonly onTrack?: (event: RTCTrackEvent) => void;
  readonly onError?: (reason: "peer-failed") => void;
  readonly onConnectionState?: (state: RTCPeerConnectionState) => void;
  readonly onIceDiagnostics?: (diagnostics: { readonly candidateCounts: { readonly host: number; readonly srflx: number; readonly relay: number; readonly other: number }; readonly localType: string; readonly remoteType: string; readonly connection: "relayed" | "direct-or-unknown" }) => void;
  readonly getStats?: () => Promise<RTCStatsReport>;
}

export interface PeerManager {
  addTracks(tracks: readonly { readonly track: MediaStreamTrack; readonly stream: MediaStream }[]): Promise<void>;
  createOffer(): Promise<void>;
  restartIce?(): Promise<void>;
  receiveOffer(description: RTCSessionDescriptionInit): Promise<void>;
  receiveAnswer(description: RTCSessionDescriptionInit): Promise<void>;
  addIceCandidate(candidate: RTCIceCandidateInit): Promise<void>;
  close(): void;
}

export function createPeerManager(options: PeerManagerOptions): PeerManager {
  const peer = options.peerFactory();
  let closed = false;
  let connected = false;
  let reportSelectedPair: () => Promise<void> = async () => {};
  let remoteReady = false;
  let operation = Promise.resolve();
  const queuedCandidates: RTCIceCandidateInit[] = [];

  const fail = (): void => {
    if (!closed) options.onError?.("peer-failed");
  };
  const send = async (event: RealtimeEvent): Promise<void> => {
    if (closed) return;
    if (event.type === "rtc:offer" || event.type === "rtc:answer" || event.type === "rtc:ice") {
      logWebRtcDiagnostic(`${event.type} sent`, { lobbyId: options.lobbyId ?? null, localParticipantId: options.selfMemberId, remoteParticipantId: options.remoteMemberId, hostId: options.hostMemberId ?? null, streamSessionId: options.sessionId });
    }
    try {
      const result = await options.send(event);
      if (result && !result.ok) fail();
    } catch {
      fail();
    }
  };
  const enqueue = (task: () => Promise<void>): Promise<void> => {
    operation = operation.then(async () => {
      if (!closed) await task();
    }).catch(fail);
    return operation;
  };
  const flushCandidates = async (): Promise<void> => {
    while (!closed && queuedCandidates.length > 0) {
      const candidate = queuedCandidates.shift();
      if (!candidate) continue;
      try {
        await peer.addIceCandidate(candidate);
      } catch {
        fail();
      }
    }
  };

  peer.onicecandidate = (event) => {
    if (closed || !event.candidate) return;
    void send({
      type: "rtc:ice", senderId: options.selfMemberId, targetId: options.remoteMemberId,
      sessionId: options.sessionId, candidate: event.candidate.toJSON(),
    });
  };
  peer.ontrack = (event) => {
    logWebRtcDiagnostic("ontrack", { lobbyId: options.lobbyId ?? null, localParticipantId: options.selfMemberId, remoteParticipantId: options.remoteMemberId, hostId: options.hostMemberId ?? null, streamSessionId: options.sessionId });
    if (!closed) options.onTrack?.(event);
  };
  peer.onconnectionstatechange = () => {
    if (!closed && peer.connectionState) {
      connected = peer.connectionState === "connected";
      logWebRtcDiagnostic("RTCPeerConnection state", { lobbyId: options.lobbyId ?? null, localParticipantId: options.selfMemberId, remoteParticipantId: options.remoteMemberId, hostId: options.hostMemberId ?? null, streamSessionId: options.sessionId, state: peer.connectionState });
      if (peer.connectionState === "connected") void reportSelectedPair();
      options.onConnectionState?.(peer.connectionState);
    }
  };
  peer.oniceconnectionstatechange = () => {
    if (!closed && peer.iceConnectionState) logWebRtcDiagnostic("ICE connection state", { lobbyId: options.lobbyId ?? null, localParticipantId: options.selfMemberId, remoteParticipantId: options.remoteMemberId, hostId: null, streamSessionId: options.sessionId, state: peer.iceConnectionState });
  };
  const reportIceDiagnostics = (): void => {
    if (closed || !peer.iceGatheringState) return;
    logWebRtcDiagnostic("ICE gathering state", { lobbyId: options.lobbyId ?? null, localParticipantId: options.selfMemberId, remoteParticipantId: options.remoteMemberId, hostId: options.hostMemberId ?? null, streamSessionId: options.sessionId, state: peer.iceGatheringState });
    if (peer.iceGatheringState === "complete" || connected) void reportSelectedPair();
  };
  const nativePeer = peer as PeerAdapter & { getStats?: () => Promise<RTCStatsReport> };
  if (options.getStats) nativePeer.getStats = options.getStats;
  peer.onicegatheringstatechange = reportIceDiagnostics;
  reportIceDiagnostics();
  reportSelectedPair = async (): Promise<void> => {
    if (closed || !nativePeer.getStats) return;
    try {
      const stats = await nativePeer.getStats();
      const statsMap = stats as RTCStatsReport & { forEach(callback: (value: RTCStats, key: string, map: RTCStatsReport) => void): void };
      const statById = (id: string): RTCStats | undefined => statsMap.get(id);
      const candidateCounts = { host: 0, srflx: 0, relay: 0, other: 0 };
      statsMap.forEach((stat) => {
        if (stat.type !== "local-candidate" && stat.type !== "remote-candidate") return;
        const type = (stat as RTCStats & CandidateStats).candidateType;
        if (type === "host" || type === "srflx" || type === "relay") candidateCounts[type] += 1;
        else candidateCounts.other += 1;
      });
      logWebRtcDiagnostic("ICE candidate type counts", { lobbyId: options.lobbyId ?? null, localParticipantId: options.selfMemberId, remoteParticipantId: options.remoteMemberId, hostId: options.hostMemberId ?? null, streamSessionId: options.sessionId, ...candidateCounts });
      let selectedId: string | undefined;
      statsMap.forEach((stat) => {
        const transport = stat as RTCStats & TransportStats;
        if (transport.type === "transport" && typeof transport.selectedCandidatePairId === "string") selectedId = transport.selectedCandidatePairId;
      });
      if (!selectedId) return;
      const pair = statById(selectedId);
      if (!pair || pair.type !== "candidate-pair") return;
      const candidatePair = pair as RTCStats & CandidatePairStats;
      const local = typeof candidatePair.localCandidateId === "string" ? statById(candidatePair.localCandidateId) : undefined;
      const remote = typeof candidatePair.remoteCandidateId === "string" ? statById(candidatePair.remoteCandidateId) : undefined;
      const localStats = local as (RTCStats & CandidateStats) | undefined;
      const remoteStats = remote as (RTCStats & CandidateStats) | undefined;
      const localType = localStats && localStats.type === "local-candidate" && typeof localStats.candidateType === "string" ? localStats.candidateType : "unknown";
      const remoteType = remoteStats && remoteStats.type === "remote-candidate" && typeof remoteStats.candidateType === "string" ? remoteStats.candidateType : "unknown";
      const relay = localType === "relay" || remoteType === "relay";
      options.onIceDiagnostics?.({ candidateCounts, localType, remoteType, connection: relay ? "relayed" : "direct-or-unknown" });
      logWebRtcDiagnostic("selected ICE candidate pair", { lobbyId: options.lobbyId ?? null, localParticipantId: options.selfMemberId, remoteParticipantId: options.remoteMemberId, hostId: options.hostMemberId ?? null, streamSessionId: options.sessionId, localType, remoteType, connection: relay ? "relayed" : "direct-or-unknown" });
    } catch {
      logWebRtcDiagnostic("ICE stats unavailable", { lobbyId: options.lobbyId ?? null, localParticipantId: options.selfMemberId, remoteParticipantId: options.remoteMemberId, hostId: options.hostMemberId ?? null, streamSessionId: options.sessionId });
    }
  };
  return {
    addTracks(tracks) {
      return enqueue(async () => {
        for (const item of tracks) peer.addTrack(item.track, item.stream);
      });
    },
    createOffer() {
      return enqueue(async () => {
        const description = await peer.createOffer();
        await peer.setLocalDescription(description);
        await send({ type: "rtc:offer", senderId: options.selfMemberId, targetId: options.remoteMemberId, sessionId: options.sessionId, description });
      });
    },
    restartIce() {
      return enqueue(async () => {
        peer.restartIce?.();
        const description = await peer.createOffer({ iceRestart: true });
        await peer.setLocalDescription(description);
        await send({ type: "rtc:offer", senderId: options.selfMemberId, targetId: options.remoteMemberId, sessionId: options.sessionId, description });
      });
    },
    receiveOffer(description) {
      return enqueue(async () => {
        await peer.setRemoteDescription(description);
        remoteReady = true;
        await flushCandidates();
        const answer = await peer.createAnswer();
        await peer.setLocalDescription(answer);
        await send({ type: "rtc:answer", senderId: options.selfMemberId, targetId: options.remoteMemberId, sessionId: options.sessionId, description: answer });
      });
    },
    receiveAnswer(description) {
      return enqueue(async () => {
        await peer.setRemoteDescription(description);
        remoteReady = true;
        await flushCandidates();
      });
    },
    addIceCandidate(candidate) {
      return enqueue(async () => {
        if (!remoteReady || !peer.remoteDescription) queuedCandidates.push(candidate);
        else {
          try {
            await peer.addIceCandidate(candidate);
          } catch {
            fail();
          }
        }
      });
    },
    close() {
      if (closed) return;
      closed = true;
      queuedCandidates.length = 0;
      peer.onicecandidate = null;
      peer.ontrack = null;
      peer.onconnectionstatechange = null;
      peer.oniceconnectionstatechange = null;
      peer.onicegatheringstatechange = null;
      try {
        peer.close();
      } catch {
        // Closing is best effort and remains idempotent.
      }
    },
  };
}
