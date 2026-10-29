import type { LobbySessionSnapshot } from "../realtime/session";
import type { GenerationId, QualityPreset, RealtimeEvent, StreamStatus } from "../realtime/events";
import type { CaptureOutcome, CaptureSession } from "./capture";
import { createPeerManager, type PeerAdapter, type PeerManager } from "./peer-manager";
import { logWebRtcDiagnostic } from "./diagnostics";
import { buildIceConfiguration, type TurnEnvironment } from "./ice";

export const FORCE_RELAY_DIAGNOSTIC = process.env.NEXT_PUBLIC_SYNCWATCH_FORCE_RELAY === "1";

export interface StreamSnapshot {
  readonly status: StreamStatus;
  readonly sessionId: GenerationId | null;
  readonly role: "host" | "viewer" | "none";
  readonly failure: "capture-unsupported" | "webrtc-unsupported" | "capture-denied" | "capture-cancelled" | "capture-failed" | "connection-failed" | "playback-failed" | null;
}

export type StreamPeer = PeerManager;

export interface StreamSessionDependencies {
  readonly lobby: { getSnapshot(): LobbySessionSnapshot; subscribe(listener: (snapshot: LobbySessionSnapshot) => void): () => void };
  readonly channel: { send(event: RealtimeEvent): Promise<{ readonly ok: boolean }>; onEvent(listener: (event: RealtimeEvent) => void): () => void };
  readonly capture: { start(options?: { quality?: QualityPreset; onEnded?: () => void }): Promise<CaptureOutcome> };
  readonly createPeer?: (options: Parameters<typeof createPeerManager>[0]) => StreamPeer;
  readonly peerFactory?: Parameters<typeof createPeerManager>[0]["peerFactory"];
  readonly createSessionId?: () => GenerationId;
  readonly schedule?: (callback: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  readonly cancel?: (timer: ReturnType<typeof setTimeout>) => void;
}

export interface StreamSession {
  getSnapshot(): StreamSnapshot;
  subscribe(listener: (snapshot: StreamSnapshot) => void): () => void;
  getMedia(): StreamMediaSnapshot;
  subscribeMedia(listener: (media: StreamMediaSnapshot) => void): () => void;
  start(quality: QualityPreset): Promise<void>;
  stop(): Promise<void>;
  requestShare(): Promise<void>;
  reportPlayback(playing: boolean): void;
  dispose(): Promise<void>;
}

export interface StreamMediaSnapshot { readonly local: MediaStream | null; readonly remote: MediaStream | null; readonly audio: "present" | "missing" | null }

const IDLE: StreamSnapshot = Object.freeze({ status: "idle", sessionId: null, role: "none", failure: null });

export function createStreamSession(dependencies: StreamSessionDependencies): StreamSession {
  const makePeer = dependencies.createPeer ?? createPeerManager;
  const makeSessionId = dependencies.createSessionId ?? (() => crypto.randomUUID());
  const turnEnvironment: TurnEnvironment = {
    NEXT_PUBLIC_TURN_URL: process.env.NEXT_PUBLIC_TURN_URL,
    NEXT_PUBLIC_TURN_USERNAME: process.env.NEXT_PUBLIC_TURN_USERNAME,
    NEXT_PUBLIC_TURN_CREDENTIAL: process.env.NEXT_PUBLIC_TURN_CREDENTIAL,
  };
  const peerConfiguration = buildIceConfiguration(turnEnvironment, FORCE_RELAY_DIAGNOSTIC);
  const makeNativePeer = (): PeerAdapter => {
    if (typeof RTCPeerConnection === "undefined") {
      publish({ status: "failed", sessionId: null, role: currentRole(), failure: "webrtc-unsupported" });
      logWebRtcDiagnostic("WebRTC unsupported", { reason: "RTCPeerConnection-unavailable" });
      throw new Error("WebRTC peer connections are unavailable");
    }
    return new RTCPeerConnection({ ...peerConfiguration, iceServers: [...peerConfiguration.iceServers] }) as PeerAdapter;
  };
  let snapshot = IDLE;
  let disposed = false;
  let generation: GenerationId | null = null;
  let capture: CaptureSession | null = null;
  let remoteStream: MediaStream | null = null;
  let captureAudio: "present" | "missing" | null = null;
  const hostPeers = new Map<string, StreamPeer>();
  let viewerPeer: StreamPeer | null = null;
  let viewerHostId: string | null = null;
  let viewerOfferApplied = false;
  const schedule = dependencies.schedule ?? ((callback, delay) => setTimeout(callback, delay));
  const cancel = dependencies.cancel ?? ((timer) => clearTimeout(timer));
  let hostGraceTimer: ReturnType<typeof setTimeout> | null = null;
  const peerRecoveryTimers = new Map<string, ReturnType<typeof setTimeout>>();
  const peerRecoveryAttempts = new Map<string, number>();
  const clearRecovery = (): void => {
    if (hostGraceTimer !== null) cancel(hostGraceTimer);
    hostGraceTimer = null;
    for (const timer of peerRecoveryTimers.values()) cancel(timer);
    peerRecoveryTimers.clear();
    peerRecoveryAttempts.clear();
  };
  const listeners = new Set<(snapshot: StreamSnapshot) => void>();
  const mediaListeners = new Set<(media: StreamMediaSnapshot) => void>();
  const mediaSnapshot = (): StreamMediaSnapshot => Object.freeze({ local: capture?.stream as unknown as MediaStream ?? null, remote: remoteStream, audio: captureAudio });
  const publishMedia = (): void => { const value = mediaSnapshot(); for (const listener of mediaListeners) listener(value); };

  const publish = (next: StreamSnapshot): void => {
    snapshot = Object.freeze(next);
    for (const listener of listeners) listener(snapshot);
  };
  const lobby = () => dependencies.lobby.getSnapshot();
  const present = (memberId: string): boolean => lobby().members.some((member) => member.memberId === memberId);
  const currentRole = (): "host" | "viewer" | "none" => {
    const value = lobby();
    if (value.status !== "joined" || value.presenceStatus !== "current" || !value.selfMemberId) return "none";
    if (value.hostMemberId === value.selfMemberId) return "host";
    return value.members.some((member) => member.memberId === value.selfMemberId) ? "viewer" : "none";
  };
  const send = async (event: RealtimeEvent): Promise<boolean> => {
    try { return (await dependencies.channel.send(event)).ok; } catch { return false; }
  };
  const closePeers = (): void => {
    for (const peer of hostPeers.values()) peer.close();
    hostPeers.clear();
    viewerPeer?.close();
    viewerPeer = null;
    viewerHostId = null;
    viewerOfferApplied = false;
  };
  const end = async (notify: boolean): Promise<void> => {
    clearRecovery();
    const oldGeneration = generation;
    generation = null;
    const oldCapture = capture;
    capture = null;
    remoteStream = null;
    captureAudio = null;
    publishMedia();
    closePeers();
    const selfId = lobby().selfMemberId;
    if (notify && oldGeneration && selfId) void send({ type: "share:stopped", senderId: selfId, sessionId: oldGeneration });
    try { oldCapture?.stop(); } catch { /* Continue teardown. */ }
    if (!disposed) publish({ ...IDLE, role: currentRole() });
  };
  const ensureViewerPeer = (hostId: string, sessionId: GenerationId): StreamPeer => {
    if (viewerPeer && viewerHostId === hostId && snapshot.sessionId === sessionId) return viewerPeer;
    viewerPeer?.close();
    const selfId = lobby().selfMemberId;
    if (!selfId) throw new Error("Missing member identity");
    viewerHostId = hostId;
    viewerOfferApplied = false;
    const peer = makePeer({
      lobbyId: lobby().code, hostMemberId: hostId, selfMemberId: selfId, remoteMemberId: hostId, sessionId,
      peerFactory: dependencies.peerFactory ?? makeNativePeer,
      send: (event) => dependencies.channel.send(event),
      onTrack: (event) => {
        if (viewerPeer !== peer || generation !== sessionId) return;
        const stream = event.streams[0];
        if (stream) { remoteStream = stream; publishMedia(); }
      },
      onError: () => {
        if (viewerPeer !== peer || generation !== sessionId) return;
        const key = `viewer:${hostId}`;
        const attempts = peerRecoveryAttempts.get(key) ?? 0;
        if (peerRecoveryTimers.has(key)) return;
        const timer = schedule(() => {
          peerRecoveryTimers.delete(key);
          if (viewerPeer !== peer || generation !== sessionId || !present(hostId)) return;
          if (attempts === 0 && peer.restartIce) {
            peerRecoveryAttempts.set(key, 1);
            void peer.restartIce();
          } else if (attempts === 1) {
            peerRecoveryAttempts.set(key, 2);
            peer.close(); viewerPeer = null; viewerHostId = null; viewerOfferApplied = false;
            try { ensureViewerPeer(hostId, sessionId); void send({ type: "share:request", senderId: selfId, sessionId }); }
            catch { void end(false); }
          } else {
            peer.close();
            publish({ ...snapshot, status: "failed", failure: "connection-failed" });
          }
        }, 1_000);
        peerRecoveryTimers.set(key, timer);
      },
      onConnectionState: (state) => {
        const key = `viewer:${hostId}`;
        if (state === "connected") {
          const timer = peerRecoveryTimers.get(key);
          if (timer !== undefined) cancel(timer);
          peerRecoveryTimers.delete(key);
          return;
        }
        if (state !== "failed" && state !== "disconnected") return;
        if (snapshot.status !== "failed") publish({ ...snapshot, status: "interrupted" });
        if (peerRecoveryTimers.has(key)) return;
        const recover = (): void => {
          peerRecoveryTimers.delete(key);
          if (viewerPeer !== peer || generation !== sessionId || !present(hostId)) return;
          const attempts = peerRecoveryAttempts.get(key) ?? 0;
          if (attempts === 0 && peer.restartIce) { peerRecoveryAttempts.set(key, 1); void peer.restartIce(); }
          else if (attempts === 1) {
            peerRecoveryAttempts.set(key, 2);
            const timer = schedule(() => {
              peerRecoveryTimers.delete(key);
              if (viewerPeer !== peer || generation !== sessionId || !present(hostId)) return;
              peer.close(); viewerPeer = null; viewerHostId = null; viewerOfferApplied = false;
              try { ensureViewerPeer(hostId, sessionId); void send({ type: "share:request", senderId: selfId, sessionId }); }
              catch { void end(false); }
            }, 1_000);
            peerRecoveryTimers.set(key, timer);
          } else { peer.close(); publish({ ...snapshot, status: "failed", failure: "connection-failed" }); }
        };
        if (state === "failed") recover();
        else peerRecoveryTimers.set(key, schedule(recover, 5_000));
      },
    });
    viewerPeer = peer;
    return viewerPeer;
  };
  const offerRequest = (event: Extract<RealtimeEvent, { type: "share:request" }>): void => {
    if (currentRole() !== "host" || !capture || event.sessionId !== generation || event.senderId === lobby().selfMemberId || !present(event.senderId)) {
      logWebRtcDiagnostic("signaling rejected", { lobbyId: lobby().code, localParticipantId: lobby().selfMemberId, remoteParticipantId: event.senderId, hostId: lobby().hostMemberId, streamSessionId: event.sessionId, reason: "share-request-wrong-role-session-or-member" });
      return;
    }
    if (hostPeers.has(event.senderId)) return;
    const selfId = lobby().selfMemberId;
    if (!selfId) return;
    const peer = makePeer({
      lobbyId: lobby().code, hostMemberId: selfId, selfMemberId: selfId, remoteMemberId: event.senderId, sessionId: event.sessionId,
      peerFactory: dependencies.peerFactory ?? makeNativePeer,
      send: (signal) => dependencies.channel.send(signal),
      onError: () => {
        if (hostPeers.get(event.senderId) !== peer || event.sessionId !== generation) return;
        const attempts = peerRecoveryAttempts.get(event.senderId) ?? 0;
        const existingTimer = peerRecoveryTimers.get(event.senderId);
        if (existingTimer !== undefined) return;
        const timer = schedule(() => {
          peerRecoveryTimers.delete(event.senderId);
          if (hostPeers.get(event.senderId) !== peer || event.sessionId !== generation || !present(event.senderId)) return;
          if (attempts === 0 && peer.restartIce) {
            peerRecoveryAttempts.set(event.senderId, 1);
            void peer.restartIce();
          } else if (attempts === 1) {
            peerRecoveryAttempts.set(event.senderId, 2);
            peer.close();
            hostPeers.delete(event.senderId);
            offerRequest(event);
          } else {
            peer.close();
            hostPeers.delete(event.senderId);
            peerRecoveryAttempts.delete(event.senderId);
            publish({ ...snapshot, status: "failed", failure: "connection-failed" });
          }
        }, 1_000);
        peerRecoveryTimers.set(event.senderId, timer);
      },
      onConnectionState: (state) => {
        const key = event.senderId;
        if (state === "connected") {
          const timer = peerRecoveryTimers.get(key);
          if (timer !== undefined) cancel(timer);
          peerRecoveryTimers.delete(key);
          return;
        }
        if (state !== "failed" && state !== "disconnected") return;
        if (peerRecoveryTimers.has(key)) return;
        const recover = (): void => {
          peerRecoveryTimers.delete(key);
          if (hostPeers.get(key) !== peer || event.sessionId !== generation || !present(key)) return;
          const attempts = peerRecoveryAttempts.get(key) ?? 0;
          if (attempts === 0 && peer.restartIce) { peerRecoveryAttempts.set(key, 1); void peer.restartIce(); }
          else if (attempts === 1) {
            peerRecoveryAttempts.set(key, 2);
            const timer = schedule(() => {
              peerRecoveryTimers.delete(key);
              if (hostPeers.get(key) !== peer || event.sessionId !== generation || !present(key)) return;
              peer.close(); hostPeers.delete(key); offerRequest(event);
            }, 1_000);
            peerRecoveryTimers.set(key, timer);
          } else {
            peer.close(); hostPeers.delete(key);
            publish({ ...snapshot, status: "failed", failure: "connection-failed" });
          }
        };
        if (state === "failed") recover();
        else peerRecoveryTimers.set(key, schedule(recover, 5_000));
      },
    });
    hostPeers.set(event.senderId, peer);
    const tracks = capture.stream.getTracks().map((track) => ({
      track: track as unknown as MediaStreamTrack,
      stream: capture?.stream as unknown as MediaStream,
    }));
    void peer.addTracks(tracks).then(() => peer.createOffer());
  };
  let pendingShareStart: RealtimeEvent | null = null;
  const handleEvent = (event: RealtimeEvent): void => {
    if (event.type === "chat:message") return;
    if (disposed) return;
    if (!generation && event.type === "rtc:offer") {
      const value = lobby();
      if (currentRole() === "viewer" && value.presenceStatus === "current" && event.senderId === value.hostMemberId && event.targetId === value.selfMemberId && present(event.senderId)) {
        generation = event.sessionId;
        publish({ status: "loading", sessionId: generation, role: "viewer", failure: null });
        logWebRtcDiagnostic("adopted session from late host offer", { lobbyId: value.code, localParticipantId: value.selfMemberId, remoteParticipantId: event.senderId, hostId: value.hostMemberId, streamSessionId: generation });
      } else {
        logWebRtcDiagnostic("signaling rejected", { lobbyId: value.code, localParticipantId: value.selfMemberId, remoteParticipantId: event.senderId, hostId: value.hostMemberId, streamSessionId: event.sessionId, reason: "cannot-adopt-offer-outside-current-host-recipient-context" });
      }
    }
    if (!generation && event.type !== "share:started") {
      logWebRtcDiagnostic("signaling rejected", { lobbyId: lobby().code, localParticipantId: lobby().selfMemberId, remoteParticipantId: "targetId" in event ? event.senderId : null, hostId: lobby().hostMemberId, streamSessionId: "sessionId" in event ? event.sessionId : null, reason: "no-active-session" });
      return;
    }
    const value = lobby();
    if (event.type === "rtc:offer" || event.type === "rtc:answer" || event.type === "rtc:ice") {
      logWebRtcDiagnostic(`${event.type} received`, { lobbyId: value.code, localParticipantId: value.selfMemberId, remoteParticipantId: event.senderId, hostId: value.hostMemberId, streamSessionId: event.sessionId });
    }
    if (value.presenceStatus !== "current" || !value.selfMemberId || !present(event.senderId)) {
      if (event.type === "share:started") pendingShareStart = event;
      return;
    }
    if (event.type === "share:started") {
      if (currentRole() !== "viewer" || event.senderId !== value.hostMemberId) return;
      if (generation) return;
      generation = event.sessionId;
      logWebRtcDiagnostic("share started received", { lobbyId: value.code, localParticipantId: value.selfMemberId, remoteParticipantId: event.senderId, hostId: value.hostMemberId, streamSessionId: generation });
      publish({ status: "loading", sessionId: generation, role: "viewer", failure: null });
      try { ensureViewerPeer(event.senderId, generation); } catch { generation = null; publish({ ...IDLE, role: "viewer", failure: "connection-failed" }); return; }
      const requestedGeneration = generation;
      void send({ type: "share:request", senderId: value.selfMemberId, sessionId: requestedGeneration }).then((ok) => {
        if (!ok && generation === requestedGeneration) publish({ ...snapshot, status: "failed", failure: "connection-failed" });
      });
      return;
    }
    if (event.type === "share:request") { offerRequest(event); return; }
    if (event.type === "share:stopped") {
      if (event.senderId === value.hostMemberId && event.sessionId === generation && currentRole() === "viewer") void end(false);
      return;
    }
    if (event.sessionId !== generation || event.targetId !== value.selfMemberId) {
      logWebRtcDiagnostic("signaling rejected", { lobbyId: value.code, localParticipantId: value.selfMemberId, remoteParticipantId: event.senderId, hostId: value.hostMemberId, streamSessionId: event.sessionId, reason: event.sessionId !== generation ? "stale-session" : "wrong-recipient" });
      return;
    }
    if (event.type === "rtc:offer") {
      if (currentRole() !== "viewer" || event.senderId !== value.hostMemberId || !present(event.senderId)) {
        logWebRtcDiagnostic("signaling rejected", { lobbyId: value.code, localParticipantId: value.selfMemberId, remoteParticipantId: event.senderId, hostId: value.hostMemberId, streamSessionId: event.sessionId, reason: "offer-from-non-host-or-absent-member" });
        return;
      }
      if (viewerOfferApplied) return;
      try { viewerOfferApplied = true; void ensureViewerPeer(event.senderId, event.sessionId).receiveOffer(event.description); publish({ ...snapshot, status: "connecting" }); } catch { viewerOfferApplied = false; /* Invalid lifecycle state. */ }
    } else if (event.type === "rtc:answer") {
      if (currentRole() !== "host" || !present(event.senderId)) return;
      const peer = hostPeers.get(event.senderId);
      if (peer) void peer.receiveAnswer(event.description);
      else logWebRtcDiagnostic("signaling rejected", { lobbyId: value.code, localParticipantId: value.selfMemberId, remoteParticipantId: event.senderId, hostId: value.hostMemberId, streamSessionId: event.sessionId, reason: "no-peer-for-answer" });
    } else if (event.type === "rtc:ice") {
      if (!present(event.senderId)) return;
      logWebRtcDiagnostic("rtc:ice received", { lobbyId: value.code, localParticipantId: value.selfMemberId, remoteParticipantId: event.senderId, hostId: value.hostMemberId, streamSessionId: event.sessionId });
      const peer = currentRole() === "host" ? hostPeers.get(event.senderId) : event.senderId === value.hostMemberId ? viewerPeer : null;
      if (peer) void peer.addIceCandidate(event.candidate);
      else logWebRtcDiagnostic("signaling rejected", { lobbyId: value.code, localParticipantId: value.selfMemberId, remoteParticipantId: event.senderId, hostId: value.hostMemberId, streamSessionId: event.sessionId, reason: "no-peer-for-ice" });
    }
  };
  const unsubscribeEvents = dependencies.channel.onEvent(handleEvent);

  const unsubscribeLobby = dependencies.lobby.subscribe((value) => {
    const role = currentRole();
    if (generation && snapshot.role === "host" && role !== "host") {
      if (value.status === "reconnecting" && value.presenceStatus === "stale") {
        if (hostGraceTimer === null) hostGraceTimer = schedule(() => { hostGraceTimer = null; if (generation && currentRole() !== "host") void end(true); }, 10_000);
      } else void end(true);
    } else if (generation && snapshot.role === "host" && role === "host" && hostGraceTimer !== null) {
      cancel(hostGraceTimer); hostGraceTimer = null;
    } else if (generation && snapshot.role === "viewer" && value.presenceStatus === "stale") {
      if (hostGraceTimer === null) hostGraceTimer = schedule(() => { hostGraceTimer = null; if (generation && lobby().presenceStatus !== "current") void end(false); }, 10_000);
    } else if (generation && snapshot.role === "viewer" && (role !== "viewer" || value.hostMemberId !== viewerHostId && viewerHostId !== null)) void end(false);
    else if (generation && snapshot.role === "viewer" && hostGraceTimer !== null) {
      cancel(hostGraceTimer); hostGraceTimer = null;
      const oldPeer = viewerPeer;
      oldPeer?.close(); viewerPeer = null; viewerHostId = null; viewerOfferApplied = false;
      const selfId = value.selfMemberId;
      const hostId = value.hostMemberId;
      if (selfId && hostId && present(hostId)) {
        try { ensureViewerPeer(hostId, generation); void send({ type: "share:request", senderId: selfId, sessionId: generation }); }
        catch { void end(false); }
      }
    }
    else if (!generation && !disposed) publish({ ...IDLE, role });
    if (pendingShareStart && value.status === "joined" && value.presenceStatus === "current" && role === "viewer" && present(pendingShareStart.senderId)) {
      const pending = pendingShareStart;
      pendingShareStart = null;
      handleEvent(pending);
    }
    if (role === "host" && capture && generation) {
      for (const memberId of [...hostPeers.keys()]) if (!value.members.some((member) => member.memberId === memberId)) {
        const pending = peerRecoveryTimers.get(memberId);
        if (pending !== undefined) cancel(pending);
        peerRecoveryTimers.delete(memberId);
        peerRecoveryAttempts.delete(memberId);
        hostPeers.get(memberId)?.close(); hostPeers.delete(memberId);
      }
      for (const member of value.members) if (member.memberId !== value.selfMemberId && !hostPeers.has(member.memberId)) offerRequest({ type: "share:request", senderId: member.memberId, sessionId: generation });
    }
  });

  return {
    getSnapshot: () => snapshot,
    getMedia: mediaSnapshot,
    subscribeMedia(listener) { mediaListeners.add(listener); return () => mediaListeners.delete(listener); },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    async start(quality) {
      if (disposed || currentRole() !== "host" || generation) return;
      publish({ status: "requesting-capture", sessionId: null, role: "host", failure: null });
      const outcome = await dependencies.capture.start({ quality, onEnded: () => { void end(true); } });
      if (disposed || currentRole() !== "host") { if (outcome.status === "started") outcome.capture.stop(); publish({ ...IDLE, role: currentRole() }); return; }
      if (outcome.status !== "started") {
        const failure = outcome.status === "denied" ? "capture-denied" : outcome.status === "unsupported" ? "capture-unsupported" : outcome.status === "cancelled" ? "capture-cancelled" : outcome.status === "failed" ? "capture-failed" : null;
        publish({ status: failure && failure !== "capture-cancelled" ? "failed" : "idle", sessionId: null, role: "host", failure });
        return;
      }
      capture = outcome.capture;
      captureAudio = outcome.capture.audio;
      publishMedia();
      generation = makeSessionId();
      logWebRtcDiagnostic("share started", { lobbyId: lobby().code, localParticipantId: lobby().selfMemberId, remoteParticipantId: null, hostId: lobby().hostMemberId, streamSessionId: generation });
      publish({ status: "sharing", sessionId: generation, role: "host", failure: null });
      const selfId = lobby().selfMemberId;
      if (!selfId) { await end(false); return; }
      if (!await send({ type: "share:started", senderId: selfId, sessionId: generation })) {
        await end(false);
        publish({ status: "failed", sessionId: null, role: "host", failure: "connection-failed" });
        return;
      }
      for (const member of lobby().members) if (member.memberId !== selfId) offerRequest({ type: "share:request", senderId: member.memberId, sessionId: generation });
    },
    stop: () => end(true),
    reportPlayback(playing) {
      if (disposed || snapshot.role !== "viewer" || !generation) return;
      if (playing) publish({ ...snapshot, status: "playing", failure: null });
      else if (snapshot.status === "playing") publish({ ...snapshot, status: "connecting", failure: null });
    },
    async requestShare() {
      const value = lobby();
      if (disposed || currentRole() !== "viewer" || !generation || !value.selfMemberId) return;
      const requestedGeneration = generation;
      if (!await send({ type: "share:request", senderId: value.selfMemberId, sessionId: requestedGeneration }) && generation === requestedGeneration) {
        publish({ ...snapshot, status: "failed", failure: "connection-failed" });
      }
    },
    async dispose() { if (disposed) return; await end(false); disposed = true; unsubscribeLobby(); unsubscribeEvents(); listeners.clear(); mediaListeners.clear(); },
  };
}
