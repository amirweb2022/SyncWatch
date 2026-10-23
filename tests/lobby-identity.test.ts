import { describe, expect, it } from "vitest";
import {
  generateLobbyCode,
  generateMemberId,
  normalizeDisplayName,
  validateLobbyCode,
} from "../lib/code";

describe("lobby code policy", () => {
  it("normalizes case and accepts only six characters from the exact alphabet", () => {
    expect(validateLobbyCode("abC234")).toEqual({ valid: true, code: "ABC234" });
    expect(validateLobbyCode("ABCI23").valid).toBe(false);
    expect(validateLobbyCode("ABCO23").valid).toBe(false);
    expect(validateLobbyCode("ABC023").valid).toBe(false);
    expect(validateLobbyCode("ABC123").valid).toBe(false);
    expect(validateLobbyCode("ABCDE").valid).toBe(false);
    expect(validateLobbyCode("ABCDEFG").valid).toBe(false);
    expect(validateLobbyCode("ABC-23").valid).toBe(false);
  });

  it("uses rejection sampling and emits six codes from injected random bytes", () => {
    const bytes = [224, 0, 0, 0, 0, 0, 0];
    const random = (target: Uint8Array) => target.set(bytes.splice(0, target.length));
    expect(generateLobbyCode(random)).toBe("AAAAAA");
  });

  it("normalizes valid names to NFC and trims surrounding whitespace", () => {
    expect(normalizeDisplayName("  e\u0301lan  ")).toEqual({ valid: true, name: "élan" });
  });

  it("rejects empty, oversized, or control-containing names", () => {
    expect(normalizeDisplayName("  ").valid).toBe(false);
    expect(normalizeDisplayName("a".repeat(41)).valid).toBe(false);
    expect(normalizeDisplayName("ab\ncd").valid).toBe(false);
  });

  it("counts Unicode code points rather than UTF-16 units", () => {
    expect(normalizeDisplayName("😀".repeat(40)).valid).toBe(true);
    expect(normalizeDisplayName("😀".repeat(41)).valid).toBe(false);
  });

  it("creates a per-session member identity from cryptographic randomness", () => {
    expect(generateMemberId((target) => target.fill(7))).toBe("07070707070707070707070707070707");
  });
});
