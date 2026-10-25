import type { QualityPreset } from "./realtime/events";
import type { StreamSnapshot } from "./webrtc/session";

export interface StreamUiText {
  readonly streamStopped: string; readonly streamLoading: string; readonly streamConnecting: string; readonly streamPlaying: string; readonly streamInterrupted: string; readonly streamFailed: string; readonly captureFailed: string; readonly captureDenied: string; readonly captureUnsupported: string; readonly captureCancelled: string;
}
export interface StreamUiView { readonly canStart: boolean; readonly canStop: boolean; readonly canRequest: boolean; readonly qualities: readonly QualityPreset[]; readonly status: string; readonly alert: boolean }

export function getStreamUiView(snapshot: StreamSnapshot, desktop: boolean, text: StreamUiText): StreamUiView {
  const failure = snapshot.failure === "capture-cancelled" ? text.captureCancelled : snapshot.failure === "capture-denied" ? text.captureDenied : snapshot.failure === "capture-unsupported" ? text.captureUnsupported : snapshot.failure === "capture-failed" ? text.captureFailed : text.streamFailed;
  const labels: Partial<Record<StreamSnapshot["status"], string>> = { idle: text.streamStopped, loading: text.streamLoading, "requesting-capture": text.streamLoading, connecting: text.streamConnecting, sharing: text.streamPlaying, playing: text.streamPlaying, interrupted: text.streamInterrupted, failed: failure };
  return { canStart: desktop && snapshot.role === "host" && (snapshot.status === "idle" || snapshot.status === "failed"), canStop: snapshot.role === "host" && snapshot.status === "sharing", canRequest: snapshot.role === "viewer" && snapshot.sessionId !== null && (snapshot.status === "failed" || snapshot.status === "interrupted"), qualities: ["480p", "720p", "1080p"], status: snapshot.failure ? failure : labels[snapshot.status] ?? text.streamStopped, alert: snapshot.status === "failed" };
}
