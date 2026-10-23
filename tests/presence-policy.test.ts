import { describe, expect, it } from "vitest";
import { MAX_LOBBY_MEMBERS } from "../lib/config";
import { decideObservedAdmission, electHost, normalizePresenceSnapshot } from "../lib/realtime/presence-policy";

const member = (memberId: string, displayName: string, joinedAt: number) => ({ memberId, displayName, joinedAt });

describe("Presence snapshot policy", () => {
  it("normalizes empty, one-member, and two-member snapshots", () => {
    expect(normalizePresenceSnapshot({})).toEqual([]);
    expect(normalizePresenceSnapshot({ a: [member("a", " A ", 10)] })).toEqual([member("a", "A", 10)]);
    expect(normalizePresenceSnapshot({ a: [member("a", "A", 10)], b: [member("b", "B", 20)] }))
      .toEqual([member("a", "A", 10), member("b", "B", 20)]);
  });

  it("deduplicates identities, preferring greatest timestamp then smaller normalized name", () => {
    expect(normalizePresenceSnapshot({
      first: [member("dup", " Zoe ", 10), member("dup", "Mia", 11)],
      second: [member("dup", "Ada", 11)],
    })).toEqual([member("dup", "Ada", 11)]);
  });

  it("ignores malformed and stale Presence records", () => {
    expect(normalizePresenceSnapshot({
      room: [member("ok", "Valid", 1), member("bad-time", "Bad", Infinity), member("bad-name", "\n", 2),
        { memberId: "missing", displayName: "Missing" }],
      stale: [member("stale", "Stale", NaN)],
    })).toEqual([member("ok", "Valid", 1)]);
  });

  it("sorts valid timestamps first and breaks equal or invalid timestamps by member ID", () => {
    const members = normalizePresenceSnapshot({
      x: [member("z", "Z", 5), member("a", "A", 5)],
    });
    expect(electHost(members)?.memberId).toBe("a");
    expect(electHost([member("z", "Z", 5), member("b", "B", 5)])?.memberId).toBe("b");
    expect(electHost([member("z", "Z", 5), member("b", "B", Number.NaN)])?.memberId).toBe("z");
    expect(electHost([member("b", "B", Number.NaN), member("a", "A", Infinity)])?.memberId).toBe("a");
  });

  it("elects the only member and elects a successor after the former host leaves", () => {
    expect(electHost([member("only", "Only", 1)])?.memberId).toBe("only");
    expect(electHost([member("next", "Next", 2)])?.memberId).toBe("next");
    expect(electHost([])).toBeNull();
  });

  it("decides admission against distinct currently observed members", () => {
    expect(decideObservedAdmission([], "new")).toEqual({ allowed: false, reason: "unavailable" });
    expect(decideObservedAdmission([member("host", "Host", 1)], "new")).toEqual({ allowed: true });
    expect(decideObservedAdmission([
      member("host", "Host", 1), member("guest", "Guest", 2), member("guest", "Duplicate", 3),
    ], "new")).toEqual({ allowed: false, reason: "full" });
    expect(MAX_LOBBY_MEMBERS).toBe(2);
  });

  it("excludes the joining member's possibly stale Presence identity from capacity", () => {
    expect(decideObservedAdmission([
      member("self", "Self", 1), member("host", "Host", 2),
    ], "self")).toEqual({ allowed: true });
  });
});
