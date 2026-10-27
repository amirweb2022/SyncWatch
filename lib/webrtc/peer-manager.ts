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
  readonly iceConnectionState?: RTCIceConnectionState;
  addTrack(track: MediaStreamTrack, stream: MediaStream): RTCRtpSender;
  createOffer(options?: RTCOfferOptions): Promise<RTCSessionDescriptionInit>;
  createAnswer(): Promise<RTCSessionDescriptionInit>;
  setLocalDescription(description: RTCSessionDescriptionInit): Promise<void>;
  setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void>;
  addIceCandidate(candidate: RTCIceCandidateInit): Promise<void>;
  close(): void;
}

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
      logWebRtcDiagnostic("RTCPeerConnection state", { lobbyId: options.lobbyId ?? null, localParticipantId: options.selfMemberId, remoteParticipantId: options.remoteMemberId, hostId: options.hostMemberId ?? null, streamSessionId: options.sessionId, state: peer.connectionState });
      options.onConnectionState?.(peer.connectionState);
    }
  };
  peer.oniceconnectionstatechange = () => {
    if (!closed && peer.iceConnectionState) logWebRtcDiagnostic("ICE connection state", { lobbyId: options.lobbyId ?? null, localParticipantId: options.selfMemberId, remoteParticipantId: options.remoteMemberId, hostId: null, streamSessionId: options.sessionId, state: peer.iceConnectionState });
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
      try {
        peer.close();
      } catch {
        // Closing is best effort and remains idempotent.
      }
    },
  };
}
