import { afterAll, describe, expect, it } from "vitest";
import NodeWebSocket from "ws";
import type { WebSocketLikeConstructor } from "@supabase/realtime-js";
import { loadEnvConfig } from "@next/env";
import { createLobbySession, type LobbySession } from "../lib/realtime/session";
import { generateLobbyCode } from "../lib/code";
import { createLobbyChannel, createLobbyChannelWithOptions } from "../lib/realtime/channel";
import { getRealtimeConfig } from "../lib/realtime/client";
import { createRealtimeClient } from "../lib/realtime/client";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { nodeWebSocketTransport } from "./support/node-websocket-transport";

const trackedTransport = (sockets: NodeWebSocket[]) => class extends NodeWebSocket {
  constructor(address: string | URL, protocols?: string | string[]) {
    super(address, protocols);
    sockets.push(this);
  }
} as unknown as WebSocketLikeConstructor;

const enabled = process.env.RUN_SUPABASE_LIVE === "1";
if (enabled) {
  const originalNodeEnv = process.env.NODE_ENV;
  Reflect.set(process.env, "NODE_ENV", "development");
  loadEnvConfig(process.cwd());
  if (originalNodeEnv === undefined) Reflect.deleteProperty(process.env, "NODE_ENV");
  else Reflect.set(process.env, "NODE_ENV", originalNodeEnv);
}
const sessions = new Set<LobbySession>();
const waitFor = async <T>(read: () => T | null, label: string, timeoutMs = 12_000): Promise<T> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const value = read();
    if (value !== null) return value;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for ${label}`);
};
const newSession = (clients?: SupabaseClient[], sockets?: NodeWebSocket[]): LobbySession => {
  const session = createLobbySession({ createChannel: (code, memberId) => {
    const client = createRealtimeClient({ realtime: { transport: sockets ? trackedTransport(sockets) : nodeWebSocketTransport } });
    clients?.push(client);
    return createLobbyChannel(code, memberId, () => client);
  }, random: () => 0.999 });
  sessions.add(session);
  return session;
};

type PresenceDiagnosticEvent = "sync" | "join" | "leave";
interface PresenceDiagnostic {
  readonly client: "A" | "B";
  readonly event: PresenceDiagnosticEvent;
  readonly memberCount: number;
}

const subscribeRaw = (channel: RealtimeChannel, client: "A" | "B", events: PresenceDiagnostic[]): Promise<string> =>
  new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`Timed out subscribing client ${client}`)), 12_000);
    channel.on("presence", { event: "sync" }, () => {
      events.push({ client, event: "sync", memberCount: Object.keys(channel.presenceState()).length });
    });
    channel.on("presence", { event: "join" }, () => {
      events.push({ client, event: "join", memberCount: Object.keys(channel.presenceState()).length });
    });
    channel.on("presence", { event: "leave" }, () => {
      events.push({ client, event: "leave", memberCount: Object.keys(channel.presenceState()).length });
    });
    channel.subscribe((status, error) => {
      if (status === "SUBSCRIBED") {
        clearTimeout(timeout);
        resolve(status);
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        clearTimeout(timeout);
        reject(new Error(`Client ${client} subscription ${status}${error ? ` (${error.name})` : ""}`));
      }
    });
  });

const observePresenceOnNextSync = (channel: RealtimeChannel, initialCount: number, timeoutMs = 8_000): Promise<boolean> =>
  new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    channel.on("presence", { event: "sync" }, () => {
      if (Object.keys(channel.presenceState()).length > initialCount) {
        clearTimeout(timer);
        resolve(true);
      }
    });
  });

afterAll(async () => {
  await Promise.all([...sessions].map((session) => session.leave()));
});

describe.skipIf(!enabled)("live Supabase Realtime integration", () => {
  it("diagnoses raw two-client Presence independently of the SyncWatch session adapter", async () => {
    const runOrder = async (clientBFirst: boolean) => {
      const topic = `syncwatch-presence-diagnostic-${generateLobbyCode()}-${Date.now()}`;
      const clientA = createRealtimeClient({ realtime: { transport: nodeWebSocketTransport } });
      const clientB = createRealtimeClient({ realtime: { transport: nodeWebSocketTransport } });
      const channelA = clientA.channel(topic, { config: { private: false, presence: { key: "diagnostic-A" } } });
      const channelB = clientB.channel(topic, { config: { private: false, presence: { key: "diagnostic-B" } } });
      const events: PresenceDiagnostic[] = [];
      let statusA = "not-subscribed";
      let statusB = "not-subscribed";
      let trackResult = "not-tracked";
      let observed = false;
      try {
        statusA = await subscribeRaw(channelA, "A", events);
        const presenceObservation = observePresenceOnNextSync(channelB, 0);
        if (clientBFirst) statusB = await subscribeRaw(channelB, "B", events);
        const trackAcknowledgement = await channelA.track({ memberId: "diagnostic-A", displayName: "Diagnostic A", joinedAt: Date.now() });
        trackResult = String(trackAcknowledgement);
        if (!clientBFirst) statusB = await subscribeRaw(channelB, "B", events);
        observed = await presenceObservation;
        const summary = {
          topicEqual: channelA.topic === channelB.topic,
          topic: "unique-public-diagnostic-topic",
          clientAStatus: statusA,
          clientBStatus: statusB,
          trackAcknowledgement: trackResult,
          events,
          clientAMemberCount: Object.keys(channelA.presenceState()).length,
          clientBMemberCount: Object.keys(channelB.presenceState()).length,
          clientAWebSocketState: clientA.realtime.connectionState(),
          clientBWebSocketState: clientB.realtime.connectionState(),
          clientBObservedPresence: observed,
        };
        console.info("[syncwatch-presence-live-diagnostic]", JSON.stringify({ clientBFirst, ...summary }));
        expect(summary.topicEqual).toBe(true);
        expect(statusA).toBe("SUBSCRIBED");
        expect(statusB).toBe("SUBSCRIBED");
        expect(trackResult).toBe("ok");
      } finally {
        await Promise.all([clientA.removeChannel(channelA), clientB.removeChannel(channelB)]);
      }
    };

    await runOrder(true);
    await runOrder(false);
  }, 60_000);

  it("has process-level Supabase configuration available to the client", () => {
    const configuredUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
    let hasProjectOrigin = false;
    try {
      const parsed = new URL(configuredUrl);
      hasProjectOrigin = (parsed.protocol === "https:" || parsed.protocol === "http:") &&
        parsed.pathname === "/" && !parsed.search && !parsed.hash;
    } catch {
      hasProjectOrigin = false;
    }
    expect(() => getRealtimeConfig(), `safe config diagnostic: urlPresent=${Boolean(configuredUrl)}, projectOrigin=${hasProjectOrigin}, anonKeyPresent=${Boolean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)}`).not.toThrow();
  });

  it("subscribes, creates, joins from independent clients, syncs Presence, elects host, rejects third/empty joins, and cleans up", async () => {
    const host = newSession();
    const created = await host.create("Live host");
    expect(created, `live lobby creation outcome: ${JSON.stringify(created)}`).toMatchObject({ ok: true });
    if (!created.ok) return;
    const code = created.code;
    const hostId = host.getSnapshot().selfMemberId;
    expect(host.getSnapshot().status).toBe("joined");

    const guest = newSession();
    const joined = await guest.join(code, "Live guest");
    expect(joined, `sanitized guest admission result: ${JSON.stringify(joined)}`).toMatchObject({ ok: true });
    await waitFor(() => host.getSnapshot().members.length === 2 ? true : null, "host Presence sync");
    await waitFor(() => guest.getSnapshot().members.length === 2 ? true : null, "guest Presence sync");
    expect(host.getSnapshot().hostMemberId).toBe(hostId);
    expect(guest.getSnapshot().hostMemberId).toBe(hostId);

    const third = newSession();
    const full = await third.join(code, "Third member");
    expect(full).toMatchObject({ ok: false, reason: "full" });

    const thirdClient = newSession();
    const fullFromThirdClient = await thirdClient.join(code, "Independent third");
    expect(fullFromThirdClient).toMatchObject({ ok: false, reason: "full" });

    const emptyCode = generateLobbyCode();
    const emptyObserver = createLobbyChannelWithOptions(emptyCode, `observer-${Date.now()}`, { realtime: { transport: nodeWebSocketTransport } });
    const observed = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("Timed out subscribing to empty lobby")), 12_000);
      emptyObserver.subscribe((status) => {
        if (status.type === "subscribed") { clearTimeout(timer); resolve(); }
        if (status.type === "status-error") { clearTimeout(timer); reject(status.error ?? new Error(status.status)); }
      });
    });
    await observed;
    const empty = newSession();
    const emptyJoin = await empty.join(emptyCode, "Empty joiner");
    expect(emptyJoin).toMatchObject({ ok: false, reason: "unavailable" });
    await emptyObserver.remove();

    await host.leave();
    await waitFor(() => guest.getSnapshot().members.length === 1 && guest.getSnapshot().hostMemberId === guest.getSnapshot().selfMemberId ? true : null, "host migration after departure");
    expect(host.getSnapshot().status).toBe("idle");
    expect(guest.getSnapshot().presenceStatus).toBe("current");
    await guest.leave();
    expect(guest.getSnapshot().status).toBe("idle");
    await thirdClient.leave();
    await empty.leave();
    const cleanupClient = createRealtimeClient({ realtime: { transport: nodeWebSocketTransport } });
    const cleanupObserver = cleanupClient.channel(`lobby:${code}`, {
      config: { private: false, presence: { key: `cleanup-${Date.now()}` } },
    });
    try {
      await subscribeRaw(cleanupObserver, "A", []);
      await waitFor(() => Object.keys(cleanupObserver.presenceState()).length === 0 ? true : null,
        "empty Presence after all members leave");
      expect(Object.keys(cleanupObserver.presenceState())).toHaveLength(0);
    } finally {
      await cleanupClient.removeChannel(cleanupObserver);
    }
  }, 60_000);

  it("restores a member after its Realtime transport is disconnected without duplicating Presence", async () => {
    const guestClients: SupabaseClient[] = [];
    const sockets: NodeWebSocket[] = [];
    const host = newSession();
    const created = await host.create("Reconnect host");
    expect(created).toMatchObject({ ok: true });
    if (!created.ok) return;
    const guest = newSession(guestClients, sockets);
    const joined = await guest.join(created.code, "Reconnect guest");
    expect(joined).toMatchObject({ ok: true });
    if (!joined.ok) return;
    const memberId = guest.getSnapshot().selfMemberId;
    const guestSocket = sockets[0];
    if (!guestSocket) throw new Error("Guest WebSocket was not captured");

    guestSocket.terminate();
    await waitFor(() => guestClients.length > 1 ? true : null, "replacement client after disconnect", 30_000);
    await waitFor(() => guest.getSnapshot().status === "joined" && guest.getSnapshot().members.length === 2 ? true : null, "confirmed Presence recovery", 30_000);
    expect(guest.getSnapshot().selfMemberId).toBe(memberId);
    expect(guest.getSnapshot().members.filter((member) => member.memberId === memberId)).toHaveLength(1);
    expect(guest.getSnapshot().presenceStatus).toBe("current");
    await host.leave();
    await guest.leave();
  }, 60_000);

  it("refuses reconnect when other present members fill the lobby", async () => {
    const guestClients: SupabaseClient[] = [];
    const sockets: NodeWebSocket[] = [];
    const host = newSession();
    const created = await host.create("Full recovery host");
    expect(created).toMatchObject({ ok: true });
    if (!created.ok) return;
    const guest = newSession(guestClients, sockets);
    const joined = await guest.join(created.code, "Full recovery guest");
    expect(joined).toMatchObject({ ok: true });
    if (!joined.ok) return;
    const guestSocket = sockets[0];
    if (!guestSocket) throw new Error("Guest WebSocket was not captured");
    const extraClient = createRealtimeClient({ realtime: { transport: nodeWebSocketTransport } });
    const extraChannel = extraClient.channel(`lobby:${created.code}`, {
      config: { private: false, presence: { key: `extra-${Date.now()}` } },
    });
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("Timed out subscribing recovery occupant")), 12_000);
        extraChannel.subscribe((status, error) => {
          if (status === "SUBSCRIBED") { clearTimeout(timer); resolve(); }
          else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            clearTimeout(timer);
            reject(new Error(`Recovery occupant subscription ${status}${error ? ` (${error.name})` : ""}`));
          }
        });
      });
      const track = await extraChannel.track({ memberId: "recovery-occupant", displayName: "Occupant", joinedAt: Date.now() });
      expect(track).toBe("ok");
      await waitFor(() => guest.getSnapshot().members.length === 3 ? true : null, "full Presence before disconnect");
      guestSocket.terminate();
      await waitFor(() => guest.getSnapshot().status === "reconnecting" ? true : null, "reconnecting state", 10_000);
      await waitFor(() => guest.getSnapshot().status === "error" && guest.getSnapshot().error?.reason === "full" ? true : null, "full recovery rejection", 30_000);
      expect(guest.getSnapshot().selfMemberId).toBeNull();
      expect(guest.getSnapshot().members).toHaveLength(0);
    } finally {
      await extraClient.removeChannel(extraChannel);
      await host.leave();
      await guest.leave();
    }
  }, 60_000);

  it("expires Presence after an abruptly lost transport within the observed service window", async () => {
    const topic = `syncwatch-presence-expiry-${generateLobbyCode()}-${Date.now()}`;
    const memberId = `expiry-${Date.now()}`;
    const subjectSockets: NodeWebSocket[] = [];
    const observerClient = createRealtimeClient({ realtime: { transport: nodeWebSocketTransport } });
    const subjectClient = createRealtimeClient({ realtime: { transport: trackedTransport(subjectSockets) } });
    const observer = observerClient.channel(topic, { config: { private: false, presence: { key: "expiry-observer" } } });
    const subject = subjectClient.channel(topic, { config: { private: false, presence: { key: memberId } } });
    try {
      await subscribeRaw(observer, "A", []);
      await subscribeRaw(subject, "B", []);
      expect(await subject.track({ memberId, displayName: "Expiry subject", joinedAt: Date.now() })).toBe("ok");
      await waitFor(() => Object.hasOwn(observer.presenceState(), memberId) ? true : null, "observer sees tracked member");
      const socket = subjectSockets[0];
      if (!socket) throw new Error("Presence subject WebSocket was not captured");
      const disconnectedAt = Date.now();
      socket.terminate();
      await subjectClient.realtime.disconnect();
      await waitFor(() => Object.hasOwn(observer.presenceState(), memberId) ? null : true,
        "service removes abruptly disconnected Presence", 60_000);
      console.info("[syncwatch-presence-expiry-observed]", JSON.stringify({ elapsedMs: Date.now() - disconnectedAt }));
    } finally {
      await Promise.allSettled([observerClient.removeChannel(observer), subjectClient.removeChannel(subject)]);
    }
  }, 75_000);

  it("characterizes simultaneous join admission without treating capacity as atomic", async () => {
    const host = newSession();
    const created = await host.create("Race host");
    expect(created, `live lobby creation outcome: ${JSON.stringify(created)}`).toMatchObject({ ok: true });
    if (!created.ok) return;
    const first = newSession();
    const second = newSession();
    const results = await Promise.all([
      first.join(created.code, "Race one"),
      second.join(created.code, "Race two"),
    ]);
    expect(results.every((result) => result.ok || result.reason === "full" || result.reason === "unavailable" || result.reason === "connection")).toBe(true);
    await host.leave();
    await first.leave();
    await second.leave();
  }, 60_000);

  it("reports configuration errors and releases failed sessions", async () => {
    const session = createLobbySession({ createChannel: () => { throw new Error("live test configuration failure"); } });
    sessions.add(session);
    const result = await session.join("ZX2345", "Connection test");
    expect(result).toMatchObject({ ok: false, reason: "configuration" });
    expect(session.getSnapshot().status).toBe("idle");
  });
});
