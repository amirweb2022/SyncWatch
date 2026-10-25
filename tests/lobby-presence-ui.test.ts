import { describe, expect, it, vi } from "vitest";
import { messages } from "../lib/i18n";
import { createLobbyPresenceController, getLobbyConnectionErrorText, getLobbyRosterView } from "../lib/lobby-presence-ui";
import { getBrowserLobbySession } from "../lib/realtime/browser-session";
import type { LobbySession, LobbySessionSnapshot, LobbySessionResult } from "../lib/realtime/session";

const initial: LobbySessionSnapshot = {
  status: "joined", code: "ABC234", members: [
    { memberId: "host", displayName: "Ava", joinedAt: 10 },
    { memberId: "self", displayName: "Sam", joinedAt: 20 },
  ], selfMemberId: "self", hostMemberId: "host", error: null, presenceStatus: "current",
};

function makeSession(snapshot: LobbySessionSnapshot = initial) {
  let current = snapshot;
  const listeners = new Set<(value: LobbySessionSnapshot) => void>();
  const session: LobbySession = {
    create: vi.fn(), join: vi.fn(), getSnapshot: vi.fn(() => current),
    subscribe: vi.fn((listener: (value: LobbySessionSnapshot) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }),
    leave: vi.fn(async () => undefined), retry: vi.fn(async (): Promise<LobbySessionResult> => ({ ok: true, code: "ABC234" })),
    sendRealtimeEvent: vi.fn(async () => ({ ok: false as const, reason: "detached" as const })),
    subscribeRealtimeEvents: vi.fn(() => () => undefined),
  };
  return {
    session,
    publish(next: LobbySessionSnapshot) { current = next; for (const listener of listeners) listener(next); },
  };
}

describe("lobby presence UI", () => {
  it("shares one in-memory session between entry and lobby routes", () => {
    expect(getBrowserLobbySession()).toBe(getBrowserLobbySession());
  });

  it("maps typed lobby failures to their specific localized message", () => {
    expect(getLobbyConnectionErrorText({ ...initial, status: "error", error: { reason: "configuration", retryable: false } }, "fa"))
      .toBe(messages.fa.configurationError);
    expect(getLobbyConnectionErrorText({ ...initial, status: "error", error: { reason: "connection", retryable: true } }, "en"))
      .toBe(messages.en.connectionError);
  });

  it("renders unique member names and marks the derived host", () => {
    expect(getLobbyRosterView(initial, "fa")).toEqual({
      freshness: messages.fa.connectionOnline,
      members: [
        { memberId: "host", displayName: "Ava", role: messages.fa.host, online: true },
        { memberId: "self", displayName: "Sam", role: null, online: true },
      ],
    });
  });

  it("reflects host migration from each presence snapshot", () => {
    const migrated = { ...initial, hostMemberId: "self", members: [...initial.members].reverse() };
    expect(getLobbyRosterView(migrated, "en").members.map((member) => [member.memberId, member.role])).toEqual([
      ["self", messages.en.host], ["host", null],
    ]);
  });

  it("marks retained roster members stale and unknown during an outage", () => {
    const stale = { ...initial, status: "reconnecting" as const, presenceStatus: "stale" as const };
    const view = getLobbyRosterView(stale, "en");
    expect(view.freshness).toBe(messages.en.rosterUnknown);
    expect(view.members.every((member) => !member.online)).toBe(true);
  });

  it("localizes reconnecting and exhausted status with manual retry availability", () => {
    const { session } = makeSession({ ...initial, status: "reconnecting" });
    const controller = createLobbyPresenceController(session, "en", () => undefined);
    expect(controller.getConnectionView()).toEqual({ label: messages.en.reconnecting, retryAvailable: false });

    const exhausted = makeSession({ ...initial, status: "error", error: { reason: "connection", retryable: true }, presenceStatus: "stale" });
    const retryController = createLobbyPresenceController(exhausted.session, "fa", () => undefined);
    expect(retryController.getConnectionView()).toEqual({ label: messages.fa.retryExhausted, retryAvailable: true });
  });

  it("delegates manual retry to the session and returns to the lobby after recovery", async () => {
    const { session } = makeSession({ ...initial, status: "error", error: { reason: "connection", retryable: true }, presenceStatus: "stale" });
    const navigate = vi.fn();
    const controller = createLobbyPresenceController(session, "en", navigate);
    await controller.retry();
    expect(session.retry).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith("/lobby/ABC234");
  });

  it("leaves through the session and returns home", async () => {
    const { session } = makeSession();
    const navigate = vi.fn();
    const controller = createLobbyPresenceController(session, "fa", navigate);
    await controller.leave();
    expect(session.leave).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith("/");
  });
});
