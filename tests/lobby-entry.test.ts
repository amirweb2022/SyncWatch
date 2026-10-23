import { describe, expect, it, vi } from "vitest";
import { messages } from "../lib/i18n";
import { createLobbyEntryController } from "../lib/lobby-entry";
import type { DisplayNamePreference } from "../lib/display-name-preference";
import { createLobbySession, type LobbySession, type LobbySessionResult } from "../lib/realtime/session";

function sessionReturning(result: LobbySessionResult): LobbySession {
  return {
    create: vi.fn(async () => result),
    join: vi.fn(async () => result),
    getSnapshot: vi.fn(),
    subscribe: vi.fn(() => () => undefined),
    leave: vi.fn(async () => undefined),
    retry: vi.fn(async () => result),
  } as unknown as LobbySession;
}

function preference(initial: string | null = null): DisplayNamePreference & { save: ReturnType<typeof vi.fn> } {
  return { load: () => initial ?? "", save: vi.fn() };
}

describe("lobby entry flow", () => {
  it("reports malformed Realtime configuration before allocating a channel", async () => {
    const createChannel = vi.fn(() => { throw new Error("Supabase configuration is missing or malformed"); });
    const session = createLobbySession({ createChannel, createCode: () => "ABC234", createMemberId: () => "self" });

    await expect(session.create("Alex")).resolves.toEqual({
      ok: false, reason: "configuration", retryable: false,
    });
    expect(createChannel).toHaveBeenCalledTimes(1);
  });

  it("loads and saves only the normalized display name before creating", async () => {
    const prefs = preference("  Alex  ");
    const session = sessionReturning({ ok: true, code: "ABC234" });
    const onJoined = vi.fn();
    const controller = createLobbyEntryController(session, prefs, onJoined);

    expect(controller.getDisplayName()).toBe("  Alex  ");
    await controller.create("  Alex  ");

    expect(session.create).toHaveBeenCalledWith("Alex");
    expect(prefs.save).toHaveBeenCalledWith("Alex");
    expect(onJoined).toHaveBeenCalledWith("ABC234");
  });

  it("requires an explicit join submission and reports localized invalid and session errors", async () => {
    const prefs = preference();
    const onJoined = vi.fn();
    const session = sessionReturning({ ok: false, reason: "invalid-code", retryable: false });
    const controller = createLobbyEntryController(session, prefs, onJoined);

    expect(session.join).not.toHaveBeenCalled();
    await controller.join("bad", "Alex");
    expect(session.join).toHaveBeenCalledWith("bad", "Alex");
    expect(controller.getErrorText("fa")).toBe(messages.fa.invalidCode);
    expect(prefs.save).toHaveBeenCalledWith("Alex");
    expect(onJoined).not.toHaveBeenCalled();
  });

  it("rejects an invalid display name before saving or starting a session", async () => {
    const prefs = preference();
    const session = sessionReturning({ ok: false, reason: "invalid-name", retryable: false });
    const controller = createLobbyEntryController(session, prefs, () => undefined);

    await controller.create("  \n  ");
    expect(session.create).not.toHaveBeenCalled();
    expect(prefs.save).not.toHaveBeenCalled();
    expect(controller.getErrorText("fa")).toBe(messages.fa.invalidName);
  });

  it.each([
    ["full", messages.fa.fullLobby],
    ["unavailable", messages.fa.unavailableLobby],
    ["connection", messages.fa.connectionError],
    ["configuration", messages.fa.configurationError],
    ["create-exhausted", messages.fa.createError],
  ] as const)("localizes %s session failure", async (reason, message) => {
    const result: LobbySessionResult = reason === "create-exhausted"
      ? { ok: false, reason, retryable: true }
      : { ok: false, reason, retryable: false };
    const controller = createLobbyEntryController(sessionReturning(result), preference(), () => undefined);

    await controller.join("ABC234", "Alex");
    expect(controller.getErrorText("fa")).toBe(message);
    expect(controller.getErrorText("en")).not.toBe(message);
  });

  it("keeps the display-name preference adapter browser-only and gracefully handles unavailable storage", async () => {
    const { createDisplayNamePreference } = await import("../lib/display-name-preference");
    const storage: Storage = {
      getItem: vi.fn(() => "Sam"),
      setItem: vi.fn(),
      removeItem: vi.fn(),
      clear: vi.fn(),
      key: vi.fn(() => null),
      get length() { return 0; },
    };
    const prefs = createDisplayNamePreference(() => storage);

    expect(prefs.load()).toBe("Sam");
    prefs.save("Sam");
    expect(storage.setItem).toHaveBeenCalledWith("syncwatch.displayName", "Sam");
    expect(storage.setItem).toHaveBeenCalledTimes(1);

    const unavailable = createDisplayNamePreference(() => { throw new Error("blocked"); });
    expect(unavailable.load()).toBe("");
    expect(() => unavailable.save("Sam")).not.toThrow();
  });
});





