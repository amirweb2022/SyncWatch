import { describe, expect, it } from "vitest";
import { getStreamUiView } from "../lib/stream-ui";
import { messages } from "../lib/i18n";
import type { StreamSnapshot } from "../lib/webrtc/session";

const snapshot = (status: StreamSnapshot["status"], role: StreamSnapshot["role"]): StreamSnapshot => ({ status, role, sessionId: status === "idle" ? null : "gen-1", failure: null });

describe("Task 08 localized stream UI projection", () => {
  it("offers quality and start only to a connected desktop host", () => {
    const view = getStreamUiView(snapshot("idle", "host"), true, messages.fa);
    expect(view.canStart).toBe(true);
    expect(view.qualities).toEqual(["480p", "720p", "1080p"]);
    expect(view.status).toBe(messages.fa.streamStopped);
  });
  it("never offers capture to viewers or mobile hosts", () => {
    expect(getStreamUiView(snapshot("idle", "viewer"), true, messages.fa).canStart).toBe(false);
    expect(getStreamUiView(snapshot("idle", "host"), false, messages.fa).canStart).toBe(false);
  });
  it("localizes failures and connecting states", () => {
    expect(getStreamUiView(snapshot("connecting", "viewer"), true, messages.en).status).toBe(messages.en.streamConnecting);
    expect(getStreamUiView({ ...snapshot("failed", "host"), failure: "capture-failed" }, true, messages.fa).status).toBe(messages.fa.captureFailed);
    expect(getStreamUiView({ ...snapshot("failed", "host"), failure: "capture-denied" }, true, messages.fa).status).toBe(messages.fa.captureDenied);
    expect(getStreamUiView({ ...snapshot("failed", "host"), failure: "capture-unsupported" }, true, messages.en).status).toBe(messages.en.captureUnsupported);
    expect(getStreamUiView({ ...snapshot("idle", "host"), failure: "capture-cancelled" }, true, messages.fa).status).toBe(messages.fa.captureCancelled);
  });
});
