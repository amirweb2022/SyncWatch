import { describe, expect, it } from "vitest";
import { parsePresenceMetadata, parseRealtimeEvent } from "../lib/realtime/events";

describe("realtime event parsing", () => {
  it.each([
    { type: "rtc:offer", senderId: "host", targetId: "viewer", description: { type: "offer", sdp: "v=0" } },
    { type: "rtc:answer", senderId: "host", targetId: "viewer", description: { type: "answer", sdp: "v=0" } },
    { type: "rtc:ice", senderId: "host", targetId: "viewer", candidate: { candidate: "candidate:1" } },
    { type: "share:started", senderId: "host" },
    { type: "share:stopped", senderId: "host" },
    { type: "share:request", senderId: "viewer" },
  ])("rejects $type events without a session generation", (event) => {
    expect(parseRealtimeEvent(event)).toBeNull();
  });

  it.each(["", "x".repeat(129), "bad\u0000generation", "bad\u0085generation"])("rejects invalid session generations", (sessionId) => {
    expect(parseRealtimeEvent({ type: "share:started", senderId: "host", sessionId })).toBeNull();
  });

  it("rejects an RTC signal targeted back to its sender", () => {
    expect(parseRealtimeEvent({
      type: "rtc:offer", senderId: "member-a", targetId: "member-a", sessionId: "generation-1",
      description: { type: "offer", sdp: "v=0" },
    })).toBeNull();
  });

  it("rejects sender and target identities above the identifier bound", () => {
    const signal = {
      type: "rtc:ice", senderId: "host", targetId: "viewer", sessionId: "generation-1",
      candidate: { candidate: "candidate:1" },
    };
    expect(parseRealtimeEvent({ ...signal, senderId: "s".repeat(129) })).toBeNull();
    expect(parseRealtimeEvent({ ...signal, targetId: "t".repeat(129) })).toBeNull();
  });

  it("rejects missing or oversized SDP and oversized ICE candidates", () => {
    expect(parseRealtimeEvent({
      type: "rtc:offer", senderId: "host", targetId: "viewer", sessionId: "generation-1",
      description: { type: "offer" },
    })).toBeNull();
    expect(parseRealtimeEvent({
      type: "rtc:offer", senderId: "host", targetId: "viewer", sessionId: "generation-1",
      description: { type: "offer", sdp: "s".repeat(1_000_001) },
    })).toBeNull();
    expect(parseRealtimeEvent({
      type: "rtc:ice", senderId: "host", targetId: "viewer", sessionId: "generation-1",
      candidate: { candidate: "c".repeat(10_001) },
    })).toBeNull();
  });

  it("accepts a valid targeted offer with its immutable generation", () => {
    expect(
      parseRealtimeEvent({
        type: "rtc:offer",
        senderId: "member-a",
        targetId: "member-b",
        sessionId: "generation-1",
        description: { type: "offer", sdp: "v=0" },
      }),
    ).toEqual({
      type: "rtc:offer",
      senderId: "member-a",
      targetId: "member-b",
      sessionId: "generation-1",
      description: { type: "offer", sdp: "v=0" },
    });
  });

  it("accepts every signaling variant while preserving chat compatibility", () => {
    const events: unknown[] = [
      { type: "rtc:answer", senderId: "a", targetId: "b", sessionId: "g1", description: { type: "answer", sdp: "answer" } },
      { type: "rtc:ice", senderId: "a", targetId: "b", sessionId: "g1", candidate: { candidate: "candidate:1" } },
      { type: "share:started", senderId: "a", sessionId: "g1" },
      { type: "share:stopped", senderId: "a", sessionId: "g1" },
      { type: "share:request", senderId: "a", sessionId: "g1" },
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
    const parsed = parseRealtimeEvent({ type: "share:started", senderId: "a", sessionId: "g1", extra: true });
    expect(parsed).toEqual({ type: "share:started", senderId: "a", sessionId: "g1" });
    expect(Object.isFrozen(parsed)).toBe(true);
  });

  it("freezes normalized signaling events and their nested payloads", () => {
    const offer = parseRealtimeEvent({
      type: "rtc:offer", senderId: "host", targetId: "viewer", sessionId: "generation-1",
      description: { type: "offer", sdp: "v=0" },
    });
    const ice = parseRealtimeEvent({
      type: "rtc:ice", senderId: "host", targetId: "viewer", sessionId: "generation-1",
      candidate: { candidate: "candidate:1" },
    });
    expect(offer && Object.isFrozen(offer) && offer.type === "rtc:offer" && Object.isFrozen(offer.description)).toBe(true);
    expect(ice && Object.isFrozen(ice) && ice.type === "rtc:ice" && Object.isFrozen(ice.candidate)).toBe(true);
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
