import { describe, expect, it, vi } from "vitest";
import { attemptPlayback, requestFullscreen as requestFullscreenAction } from "../lib/webrtc/media-element";

describe("media element actions", () => {
  it("returns blocked playback as a recoverable result", async () => {
    const play = vi.fn().mockRejectedValue(new Error("autoplay blocked"));
    await expect(attemptPlayback({ play })).resolves.toBe(false);
    expect(play).toHaveBeenCalledOnce();
  });
  it("requests fullscreen from the calling user action and contains unsupported/rejected cases", async () => {
    const requestFullscreen = vi.fn().mockResolvedValue(undefined);
    await expect(requestFullscreenAction({ requestFullscreen })).resolves.toBe(true);
    await expect(requestFullscreenAction({})).resolves.toBe(false);
    await expect(requestFullscreenAction({ requestFullscreen: vi.fn().mockRejectedValue(new Error("denied")) })).resolves.toBe(false);
  });
});
