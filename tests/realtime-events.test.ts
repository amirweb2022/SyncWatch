import { describe, expect, it } from "vitest";
import { parsePresenceMetadata, parseRealtimeEvent } from "../lib/realtime/events";

describe("realtime event parsing", () => {
  it("accepts a valid targeted offer without changing its contract", () => {
    expect(
      parseRealtimeEvent({
        type: "rtc:offer",
        senderId: "member-a",
        targetId: "member-b",
        description: { type: "offer", sdp: "v=0" },
      }),
    ).toEqual({
      type: "rtc:offer",
      senderId: "member-a",
      targetId: "member-b",
      description: { type: "offer", sdp: "v=0" },
    });
  });

  it("accepts every event in the existing PRD contract", () => {
    const events: unknown[] = [
      { type: "rtc:answer", senderId: "a", targetId: "b", description: { type: "answer", sdp: "answer" } },
      { type: "rtc:ice", senderId: "a", targetId: "b", candidate: { candidate: "candidate:1" } },
      { type: "share:started", senderId: "a" },
      { type: "share:stopped", senderId: "a" },
      { type: "share:request", senderId: "a" },
      { type: "chat:message", senderId: "a", messageId: "m1", name: "A", text: "hello", sentAt: 1 },
    ];
    for (const event of events) expect(parseRealtimeEvent(event)).not.toBeNull();
  });

  it.each([
    null,
    {},
    { type: "unknown", senderId: "a" },
    { type: "share:started" },
    { type: "rtc:offer", senderId: "a", targetId: "b", description: { type: "answer" } },
    { type: "rtc:ice", senderId: "a", targetId: "b", candidate: { candidate: 3 } },
    { type: "chat:message", senderId: "a", messageId: "m", name: "A", text: "x", sentAt: Infinity },
  ])("rejects malformed or unsupported event %#", (event) => {
    expect(parseRealtimeEvent(event)).toBeNull();
  });

  it("limits chat fields and returns a frozen normalized event", () => {
    expect(parseRealtimeEvent({ type: "chat:message", senderId: "a", messageId: "m", name: "A", text: "x".repeat(501), sentAt: 1 })).toBeNull();
    const parsed = parseRealtimeEvent({ type: "share:started", senderId: "a", extra: true });
    expect(parsed).toEqual({ type: "share:started", senderId: "a" });
    expect(Object.isFrozen(parsed)).toBe(true);
  });
});

describe("Presence metadata parsing", () => {
  it("normalizes valid presence and rejects malformed metadata", () => {
    expect(parsePresenceMetadata({ memberId: "m1", displayName: "  e\u0301lan  ", joinedAt: 12 })).toEqual({
      memberId: "m1", displayName: "élan", joinedAt: 12,
    });
    expect(parsePresenceMetadata({ memberId: "m1", displayName: "A", joinedAt: NaN })).toBeNull();
    expect(parsePresenceMetadata({ memberId: "m1", displayName: "\n", joinedAt: 1 })).toBeNull();
    expect(parsePresenceMetadata({ memberId: "m1", displayName: "x".repeat(161), joinedAt: 1 })).toBeNull();
  });
});
