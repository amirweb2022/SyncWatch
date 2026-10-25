import { describe, expect, it, vi } from "vitest";
import { createCaptureManager } from "../lib/webrtc/capture";

function makeTrack(kind: "video" | "audio") {
  const listeners = new Set<() => void>();
  return {
    kind,
    stopped: 0,
    stop() { this.stopped += 1; },
    addEventListener(_type: "ended", listener: () => void) { listeners.add(listener); },
    removeEventListener(_type: "ended", listener: () => void) { listeners.delete(listener); },
    end() { for (const listener of [...listeners]) listener(); },
  };
}

function makeStream(video: ReturnType<typeof makeTrack>, audio?: ReturnType<typeof makeTrack>) {
  const tracks = audio ? [video, audio] : [video];
  return {
    getTracks: () => tracks,
    getVideoTracks: () => [video],
    getAudioTracks: () => audio ? [audio] : [],
  };
}

describe("screen capture manager", () => {
  it("reports unsupported when display capture is unavailable", async () => {
    const manager = createCaptureManager();

    await expect(manager.start()).resolves.toEqual({ status: "unsupported" });
  });

  it("distinguishes permission denial from capture failure", async () => {
    const manager = createCaptureManager({
      getDisplayMedia: async () => { throw Object.assign(new Error("denied"), { name: "NotAllowedError" }); },
    });

    await expect(manager.start()).resolves.toEqual({ status: "denied" });
  });

  it("treats a user-cancelled picker as cancellation, not failure", async () => {
    const manager = createCaptureManager({
      getDisplayMedia: async () => { throw Object.assign(new Error("cancelled"), { name: "AbortError" }); },
    });

    await expect(manager.start()).resolves.toEqual({ status: "cancelled" });
  });

  it("reports unsupported when the browser rejects display capture as unsupported", async () => {
    const manager = createCaptureManager({
      getDisplayMedia: async () => { throw Object.assign(new Error("unsupported"), { name: "NotSupportedError" }); },
    });

    await expect(manager.start()).resolves.toEqual({ status: "unsupported" });
  });

  it("reports other acquisition errors without leaking the browser error", async () => {
    const manager = createCaptureManager({ getDisplayMedia: async () => { throw new Error("device detail"); } });

    await expect(manager.start()).resolves.toEqual({ status: "failed", reason: "capture-error" });
  });

  it("starts video without audio and exposes a muted inline preview", async () => {
    const video = makeTrack("video");
    const stream = makeStream(video);
    let requested: unknown;
    const manager = createCaptureManager({
      getDisplayMedia: async (constraints) => { requested = constraints; return stream; },
    });

    const result = await manager.start({ quality: "480p" });

    expect(result.status).toBe("started");
    if (result.status !== "started") return;
    expect(result.capture.audio).toBe("missing");
    expect(result.capture.preview).toEqual({ stream, muted: true, playsInline: true });
    expect(requested).toEqual({ audio: true, video: { width: { ideal: 854 }, height: { ideal: 480 }, frameRate: { ideal: 30 } } });
  });

  it("rejects a capture without video and stops every acquired track", async () => {
    const audio = makeTrack("audio");
    const stream = {
      getTracks: () => [audio],
      getVideoTracks: () => [],
      getAudioTracks: () => [audio],
    };
    const manager = createCaptureManager({ getDisplayMedia: async () => stream });

    await expect(manager.start()).resolves.toEqual({ status: "failed", reason: "missing-video" });
    expect(audio.stopped).toBe(1);
  });

  it("stops owned video and audio tracks only once", async () => {
    const video = makeTrack("video");
    const audio = makeTrack("audio");
    const manager = createCaptureManager({ getDisplayMedia: async () => makeStream(video, audio) });
    const result = await manager.start();
    if (result.status !== "started") throw new Error("capture did not start");

    result.capture.stop();
    result.capture.stop();

    expect(video.stopped).toBe(1);
    expect(audio.stopped).toBe(1);
  });

  it("stops all tracks and notifies once when the browser ends video capture", async () => {
    const video = makeTrack("video");
    const audio = makeTrack("audio");
    const onEnded = vi.fn();
    const manager = createCaptureManager({ getDisplayMedia: async () => makeStream(video, audio) });
    const result = await manager.start({ onEnded });
    if (result.status !== "started") throw new Error("capture did not start");

    video.end();
    video.end();
    result.capture.stop();

    expect(onEnded).toHaveBeenCalledTimes(1);
    expect(video.stopped).toBe(1);
    expect(audio.stopped).toBe(1);
  });

  it("stops acquired source tracks if track adaptation fails", async () => {
    const video = makeTrack("video");
    const audio = makeTrack("audio");
    const manager = createCaptureManager({
      getDisplayMedia: async () => makeStream(video, audio),
      createTrack: () => { throw new Error("adapter failure"); },
    });

    await expect(manager.start()).resolves.toEqual({ status: "failed", reason: "capture-error" });
    expect(video.stopped).toBe(1);
    expect(audio.stopped).toBe(1);
  });

  it("stops tracks when an acquired stream cannot report its video tracks", async () => {
    const video = makeTrack("video");
    const stream = {
      getTracks: () => [video],
      getVideoTracks: () => { throw new Error("track query failed"); },
      getAudioTracks: () => [],
    };
    const manager = createCaptureManager({ getDisplayMedia: async () => stream });

    await expect(manager.start()).resolves.toEqual({ status: "failed", reason: "capture-error" });
    expect(video.stopped).toBe(1);
  });
});
