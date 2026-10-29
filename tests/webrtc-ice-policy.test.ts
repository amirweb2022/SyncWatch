import { describe, expect, it } from "vitest";
import { buildIceConfiguration, buildIceServers, getTurnGuidance } from "../lib/webrtc/ice";

describe("ICE configuration policy", () => {
  it("uses public STUN defaults when TURN values are absent", () => {
    expect(buildIceServers({})).toEqual([{ urls: "stun:stun.l.google.com:19302" }]);
    expect(getTurnGuidance({})).toContain("TURN");
  });

  it("accepts TURN only when URL, username, and credential are all valid", () => {
    const complete = { NEXT_PUBLIC_TURN_URL: "turn:relay.example:3478", NEXT_PUBLIC_TURN_USERNAME: " user ", NEXT_PUBLIC_TURN_CREDENTIAL: " pass " };
    expect(buildIceServers(complete)).toHaveLength(2);
    expect(buildIceServers(complete)[1]).toEqual({ urls: "turn:relay.example:3478", username: "user", credential: "pass" });
    expect(buildIceServers({ ...complete, NEXT_PUBLIC_TURN_URL: "https://relay.example" })).toHaveLength(1);
    expect(buildIceServers({ NEXT_PUBLIC_TURN_URL: complete.NEXT_PUBLIC_TURN_URL })).toHaveLength(1);
  });

  it("parses multiple comma-separated TURN URLs and supports secure TURN over TLS", () => {
    const servers = buildIceServers({
      NEXT_PUBLIC_TURN_URL: "turn:relay.example:3478, turns:relay.example:5349?transport=tcp",
      NEXT_PUBLIC_TURN_USERNAME: "user",
      NEXT_PUBLIC_TURN_CREDENTIAL: "credential",
    });
    expect(servers[1]).toEqual({
      urls: ["turn:relay.example:3478", "turns:relay.example:5349?transport=tcp"],
      username: "user",
      credential: "credential",
    });
  });

  it("rejects malformed URLs without discarding valid TURN URLs", () => {
    const servers = buildIceServers({
      NEXT_PUBLIC_TURN_URL: "turn:relay.example:3478,https://invalid.example",
      NEXT_PUBLIC_TURN_USERNAME: "user",
      NEXT_PUBLIC_TURN_CREDENTIAL: "credential",
    });
    expect(servers[1]?.urls).toBe("turn:relay.example:3478");
  });

  it("forces relay only when explicitly requested for diagnostics", () => {
    expect(buildIceConfiguration({}).iceTransportPolicy).toBeUndefined();
    expect(buildIceConfiguration({}, true).iceTransportPolicy).toBe("relay");
  });
});
