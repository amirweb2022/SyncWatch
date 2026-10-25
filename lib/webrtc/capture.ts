import type { QualityPreset } from "../realtime/events";
import { getCaptureConstraints, type CaptureConstraints } from "./media";

export interface CaptureTrackSource {
  readonly kind: string;
  stop(): void;
  addEventListener(type: "ended", listener: () => void): void;
  removeEventListener(type: "ended", listener: () => void): void;
}

export interface CaptureStreamSource {
  getTracks(): readonly CaptureTrackSource[];
  getVideoTracks(): readonly CaptureTrackSource[];
  getAudioTracks(): readonly CaptureTrackSource[];
}

export interface OwnedCaptureTrack {
  readonly kind: string;
  stop(): void;
  onEnded(listener: () => void): () => void;
}

export interface CapturePreview {
  readonly stream: CaptureStreamSource;
  readonly muted: true;
  readonly playsInline: true;
}

export interface CaptureSession {
  readonly stream: CaptureStreamSource;
  readonly tracks: readonly OwnedCaptureTrack[];
  readonly audio: "present" | "missing";
  readonly preview: CapturePreview;
  stop(): void;
}

export type CaptureOutcome =
  | { readonly status: "started"; readonly capture: CaptureSession }
  | { readonly status: "unsupported" }
  | { readonly status: "denied" }
  | { readonly status: "cancelled" }
  | { readonly status: "failed"; readonly reason: "missing-video" | "capture-error" };

export interface CaptureManagerDependencies {
  readonly getDisplayMedia?: (constraints: CaptureConstraints) => Promise<CaptureStreamSource>;
  readonly createTrack?: (track: CaptureTrackSource) => OwnedCaptureTrack;
}

export interface CaptureStartOptions {
  readonly quality?: QualityPreset;
  readonly onEnded?: () => void;
}

function browserDisplayCapture(): CaptureManagerDependencies["getDisplayMedia"] {
  if (typeof navigator === "undefined" || typeof navigator.mediaDevices?.getDisplayMedia !== "function") return undefined;
  return (constraints) => navigator.mediaDevices.getDisplayMedia(constraints);
}

function defaultTrackFactory(track: CaptureTrackSource): OwnedCaptureTrack {
  return {
    kind: track.kind,
    stop: () => track.stop(),
    onEnded: (listener) => {
      track.addEventListener("ended", listener);
      return () => track.removeEventListener("ended", listener);
    },
  };
}

function errorName(error: unknown): string | undefined {
  if (typeof error !== "object" || error === null || !("name" in error)) return undefined;
  return typeof error.name === "string" ? error.name : undefined;
}

function stopTracks(tracks: readonly OwnedCaptureTrack[]): void {
  for (const track of tracks) {
    try {
      track.stop();
    } catch {
      // Teardown continues even if a browser track has already become unavailable.
    }
  }
}

function stopSources(tracks: readonly CaptureTrackSource[]): void {
  for (const track of tracks) {
    try {
      track.stop();
    } catch {
      // Teardown continues for the remaining tracks.
    }
  }
}

export function createCaptureManager(dependencies: CaptureManagerDependencies = {}) {
  const getDisplayMedia = dependencies.getDisplayMedia ?? browserDisplayCapture();
  const createTrack = dependencies.createTrack ?? defaultTrackFactory;

  return {
    async start(options: CaptureStartOptions = {}): Promise<CaptureOutcome> {
      if (!getDisplayMedia) return { status: "unsupported" };

      let stream: CaptureStreamSource;
      try {
        stream = await getDisplayMedia(getCaptureConstraints(options.quality));
      } catch (error) {
        const name = errorName(error);
        if (name === "NotAllowedError") return { status: "denied" };
        if (name === "AbortError") return { status: "cancelled" };
        if (name === "NotSupportedError") return { status: "unsupported" };
        return { status: "failed", reason: "capture-error" };
      }

      let sourceTracks: readonly CaptureTrackSource[] = [];
      let videoTracks: readonly CaptureTrackSource[];
      let audioTracks: readonly CaptureTrackSource[];
      try {
        sourceTracks = stream.getTracks();
        videoTracks = stream.getVideoTracks();
        audioTracks = stream.getAudioTracks();
      } catch {
        stopSources(sourceTracks);
        return { status: "failed", reason: "capture-error" };
      }

      if (videoTracks.length === 0) {
        stopSources(sourceTracks);
        return { status: "failed", reason: "missing-video" };
      }

      let tracks: OwnedCaptureTrack[];
      try {
        tracks = sourceTracks.map(createTrack);
      } catch {
        stopSources(sourceTracks);
        return { status: "failed", reason: "capture-error" };
      }

      let stopped = false;
      const removeEndedListeners: Array<() => void> = [];
      const stop = (): void => {
        if (stopped) return;
        stopped = true;
        for (const removeListener of removeEndedListeners) {
          try {
            removeListener();
          } catch {
            // Continue releasing owned tracks if a listener cannot be removed.
          }
        }
        stopTracks(tracks);
      };

      try {
        for (const videoTrack of tracks.filter((track) => track.kind === "video")) {
          removeEndedListeners.push(videoTrack.onEnded(() => {
            if (stopped) return;
            stop();
            try {
              options.onEnded?.();
            } catch {
              // Browser event callbacks must not leak caller exceptions.
            }
          }));
        }
      } catch {
        stop();
        return { status: "failed", reason: "capture-error" };
      }

      const preview: CapturePreview = Object.freeze({ stream, muted: true, playsInline: true });
      const capture: CaptureSession = Object.freeze({
        stream,
        tracks: Object.freeze(tracks),
        audio: audioTracks.length > 0 ? "present" : "missing",
        preview,
        stop,
      });
      return { status: "started", capture };
    },
  };
}
