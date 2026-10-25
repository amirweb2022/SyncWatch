import { describe, expect, it } from "vitest";
import { getCaptureConstraints, getVideoBitrateLimit, applyVideoBitrateLimit } from "../lib/webrtc/media";

describe("capture quality policy", () => {
  it("requests the documented 720p at 30fps default", () => {
    expect(getCaptureConstraints()).toEqual({
      audio: true,
      video: { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
    });
  });

  it("requests each named resolution and caps bitrate near 2.5 Mbps", () => {
    expect(getCaptureConstraints("480p").video).toEqual({ width: { ideal: 854 }, height: { ideal: 480 }, frameRate: { ideal: 30 } });
    expect(getCaptureConstraints("1080p").video).toEqual({ width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } });
    expect(getVideoBitrateLimit("1080p")).toBe(2_500_000);
    expect(getVideoBitrateLimit("720p")).toBeLessThanOrEqual(2_500_000);
  });

  it("uses sender parameter APIs when available and safely reports fallback", async () => {
    const parameters: { encodings?: Array<{ maxBitrate?: number }> } = { encodings: [{}] };
    const sender = { getParameters: () => parameters, setParameters: async (next: typeof parameters) => { Object.assign(parameters, next); } };
    await expect(applyVideoBitrateLimit(sender, "720p")).resolves.toBe(true);
    expect(parameters.encodings?.[0]).toHaveProperty("maxBitrate", 2_000_000);
    await expect(applyVideoBitrateLimit({}, "720p")).resolves.toBe(false);
    await expect(applyVideoBitrateLimit({ ...sender, setParameters: async () => { throw new Error("unsupported"); } }, "720p")).resolves.toBe(false);
  });
});
