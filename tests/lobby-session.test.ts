import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LobbyChannel, ChannelListener } from "../lib/realtime/channel";
import type { RealtimeEvent } from "../lib/realtime/events";
import { createLobbySession } from "../lib/realtime/session";
import { reconnectDelay } from "../lib/realtime/retry-policy";

type FakeChannel = LobbyChannel & {
  notify: (status: Parameters<ChannelListener>[0]) => void;
  sync: (state: unknown) => void;
};

function makeChannel(): FakeChannel {
  let listener: ChannelListener | undefined;
  const channel: FakeChannel = {
    subscribe: vi.fn((next) => { listener = next; }),
    onEvent: vi.fn(),
    send: vi.fn(async () => ({ ok: true as const })),
    track: vi.fn(async () => undefined),
    untrack: vi.fn(async () => undefined),
    detach: vi.fn(),
    remove: vi.fn(async () => undefined),
    notify(status) { listener?.(status); },
    sync(state) { listener?.({ type: "presence-sync", state }); },
  };
  return channel;
}

const self = { memberId: "self", displayName: "Alex", joinedAt: 100 };
const host = { memberId: "host", displayName: "Sam", joinedAt: 50 };

describe("lobby session creation and joining", () => {
  let channels: FakeChannel[];
  let codeSequence: string[];
  const createChannel = vi.fn((code: string, memberId: string) => {
    void memberId;
    const channel = makeChannel();
    channels.push(channel);
    if (code === "DE2345" || code === "GH2345") {
      channel.subscribe = vi.fn((next) => {
        queueMicrotask(() => {
          next({ type: "subscribed" });
          next({ type: "presence-sync", state: { host: [host] } });
        });
      });
    }
    return channel;
  });
  const session = () => createLobbySession({
    createChannel,
    createCode: () => codeSequence.shift() ?? "ABC234",
    createMemberId: () => "self",
    now: () => 100,
  });

  beforeEach(() => {
    channels = [];
    codeSequence = ["ABC234", "DE2345", "GH2345"];
    createChannel.mockClear();
  });

  it("creates a lobby only after its own Presence is confirmed", async () => {
    const lobby = session();
    const pending = lobby.create(" Alex ");
    expect(createChannel).toHaveBeenCalledWith("ABC234", "self");
    const channel = channels[0]!;
    channel.notify({ type: "subscribed" });
    channel.sync({});
    await Promise.resolve();
    expect(channel.track).toHaveBeenCalledWith(self);
    expect((await lobby.getSnapshot()).status).toBe("connecting");
    channel.sync({ self: [self] });
    await expect(pending).resolves.toEqual({ ok: true, code: "ABC234" });
    expect(await lobby.getSnapshot()).toMatchObject({ status: "joined", hostMemberId: "self" });
  });

  it("joins an existing lobby and publishes the normalized roster after confirmation", async () => {
    const lobby = session();
    const pending = lobby.join("abc234", " Jo ");
    const channel = channels[0]!;
    channel.notify({ type: "subscribed" });
    channel.sync({ host: [host] });
    await Promise.resolve();
    expect(channel.track).toHaveBeenCalledWith({ ...self, displayName: "Jo" });
    channel.sync({ host: [host], self: [{ ...self, displayName: "Jo" }] });
    await expect(pending).resolves.toEqual({ ok: true, code: "ABC234" });
    expect(await lobby.getSnapshot()).toMatchObject({
      status: "joined", members: [host, { ...self, displayName: "Jo" }], hostMemberId: "host",
    });
  });

  it("allocates distinct Presence identities for independent tab sessions", () => {
    const first = createLobbySession({ createChannel, createMemberId: () => "tab-a" });
    const second = createLobbySession({ createChannel, createMemberId: () => "tab-b" });
    void first.join("ABC234", "Alex");
    void second.join("ABC234", "Sam");
    expect(createChannel.mock.calls.slice(-2)).toEqual([["ABC234", "tab-a"], ["ABC234", "tab-b"]]);
  });

  it("rejects invalid code or name without allocating a channel", () => {
    const lobby = session();
    expect(lobby.join("ABC-34", "Alex")).toMatchObject({ ok: false, reason: "invalid-code" });
    expect(lobby.join("ABC234", "  ")).toMatchObject({ ok: false, reason: "invalid-name" });
    expect(createChannel).not.toHaveBeenCalled();
    expect(lobby.create("Alex\n")).toBeInstanceOf(Promise);
  });

  it("rejects an empty join as unavailable and removes its channel", async () => {
    let timeout: (() => void) | undefined;
    const lobby = createLobbySession({
      createChannel: (code, memberId) => createChannel(code, memberId),
      createMemberId: () => "self",
      schedule: (callback) => { timeout = callback; return callback; },
      cancel: () => undefined,
    });
    const pending = lobby.join("ABC234", "Alex");
    const channel = channels[0]!;
    channel.notify({ type: "subscribed" });
    channel.sync({});
    expect(channel.remove).not.toHaveBeenCalled();
    timeout?.();
    await expect(pending).resolves.toMatchObject({ ok: false, reason: "unavailable" });
    expect(channel.track).not.toHaveBeenCalled();
    expect(channel.remove).toHaveBeenCalledOnce();
  });

  it("waits for a later Presence sync before rejecting an initially empty join", async () => {
    const scheduled: Array<() => void> = [];
    let timerCancelled = false;
    const lobby = createLobbySession({
      createChannel: () => { const channel = makeChannel(); channels.push(channel); return channel; },
      createMemberId: () => "self", now: () => 100,
      schedule: (callback) => { scheduled.push(callback); return callback; },
      cancel: () => { timerCancelled = true; },
    });
    const pending = lobby.join("ABC234", "Alex");
    const channel = channels[0]!;
    channel.notify({ type: "subscribed" });
    channel.sync({});
    await Promise.resolve();

    expect(channel.remove).not.toHaveBeenCalled();
    expect(channel.track).not.toHaveBeenCalled();
    channel.sync({ host: [host] });
    await Promise.resolve();
    expect(channel.track).toHaveBeenCalledWith(self);
    channel.sync({ host: [host], self: [self] });
    await expect(pending).resolves.toEqual({ ok: true, code: "ABC234" });
    expect(timerCancelled).toBe(true);
  });

  it("rejects an observed full lobby and cleans up without tracking", async () => {
    const lobby = session();
    const pending = lobby.join("ABC234", "Alex");
    const channel = channels[0]!;
    channel.notify({ type: "subscribed" });
    channel.sync({ host: [host], other: [{ memberId: "other", displayName: "Lee", joinedAt: 60 }] });
    await expect(pending).resolves.toMatchObject({ ok: false, reason: "full" });
    expect(channel.track).not.toHaveBeenCalled();
    expect(channel.remove).toHaveBeenCalledOnce();
  });

  it("retries occupied create codes up to three attempts then reports retryable exhaustion", async () => {
    codeSequence = ["ABC234", "DE2345", "GH2345"];
    const lobby = session();
    const pending = lobby.create("Alex");
    for (const channel of channels) {
      channel.notify({ type: "subscribed" });
      channel.sync({ host: [host] });
      await Promise.resolve();
    }
    await expect(pending).resolves.toMatchObject({ ok: false, reason: "create-exhausted", retryable: true });
    expect(createChannel).toHaveBeenCalledTimes(3);
    expect(channels.every((channel) => vi.mocked(channel.remove).mock.calls.length === 1)).toBe(true);
  });

  it("cleans partial subscription state on failure", async () => {
    const lobby = session();
    const pending = lobby.join("ABC234", "Alex");
    const channel = channels[0]!;
    channel.notify({ type: "status-error", status: "CHANNEL_ERROR" });
    await expect(pending).resolves.toMatchObject({ ok: false, reason: "connection" });
    expect(channel.detach).toHaveBeenCalledOnce();
    expect(channel.remove).toHaveBeenCalledOnce();
  });

  it("replaces the joined roster on every sync and elects the remaining member after host departure", async () => {
    const lobby = session();
    const pending = lobby.join("ABC234", "Alex");
    const channel = channels[0]!;
    channel.notify({ type: "subscribed" });
    channel.sync({ host: [host] });
    await Promise.resolve();
    channel.sync({ host: [host], self: [self] });
    await pending;

    channel.sync({ self: [self], duplicate: [{ ...self, displayName: "Zed", joinedAt: 110 }] });

    expect(lobby.getSnapshot()).toMatchObject({
      status: "joined",
      members: [{ ...self, displayName: "Zed", joinedAt: 110 }],
      hostMemberId: "self",
    });
    expect(lobby.getSnapshot().members).toHaveLength(1);
  });

  it("marks the last roster stale and unknown on connection loss, then replaces it with the next sync", async () => {
    const lobby = session();
    const pending = lobby.join("ABC234", "Alex");
    const channel = channels[0]!;
    channel.notify({ type: "subscribed" });
    channel.sync({ host: [host] });
    await Promise.resolve();
    channel.sync({ host: [host], self: [self] });
    await pending;

    channel.notify({ type: "status-error", status: "TIMED_OUT" });
    expect(lobby.getSnapshot()).toMatchObject({ status: "reconnecting", presenceStatus: "stale", members: [host, self] });

    channel.sync({ self: [self] });
    expect(lobby.getSnapshot()).toMatchObject({ status: "reconnecting", presenceStatus: "stale", members: [self] });
  });

  it("removes listeners, untracks, and removes exactly once across repeated leave calls", async () => {
    const lobby = session();
    const pending = lobby.join("ABC234", "Alex");
    const channel = channels[0]!;
    channel.notify({ type: "subscribed" });
    channel.sync({ host: [host] });
    await Promise.resolve();
    channel.sync({ host: [host], self: [self] });
    await pending;

    await Promise.all([lobby.leave(), lobby.leave(), lobby.leave()]);

    expect(channel.detach).toHaveBeenCalledOnce();
    expect(channel.untrack).toHaveBeenCalledOnce();
    expect(channel.remove).toHaveBeenCalledOnce();
    expect(lobby.getSnapshot()).toMatchObject({ status: "idle", code: null, members: [], hostMemberId: null });
  });

  it("suppresses late sync callbacks after leave has begun", async () => {
    const lobby = session();
    const pending = lobby.join("ABC234", "Alex");
    const channel = channels[0]!;
    channel.notify({ type: "subscribed" });
    channel.sync({ host: [host] });
    await Promise.resolve();
    channel.sync({ host: [host], self: [self] });
    await pending;
    const unsubscribe = lobby.subscribe(() => undefined);
    await lobby.leave();
    channel.sync({ host: [host] });
    expect(lobby.getSnapshot()).toMatchObject({ status: "idle", members: [], hostMemberId: null });
    unsubscribe();
  });

  it("finishes leave and publishes an empty roster when untracking loses its connection", async () => {
    const lobby = session();
    const pending = lobby.join("ABC234", "Alex");
    const channel = channels[0]!;
    channel.notify({ type: "subscribed" });
    channel.sync({ host: [host] });
    await Promise.resolve();
    channel.sync({ host: [host], self: [self] });
    await pending;
    vi.mocked(channel.untrack).mockRejectedValueOnce(new Error("connection lost"));

    await expect(lobby.leave()).resolves.toBeUndefined();
    expect(channel.remove).toHaveBeenCalledOnce();
    expect(lobby.getSnapshot()).toMatchObject({ status: "idle", members: [], hostMemberId: null });
  });

  it("publishes the same idle state when leave is called while the lobby is empty", async () => {
    const lobby = session();
    const seen: string[] = [];
    lobby.subscribe((value) => seen.push(value.status));

    await lobby.leave();
    await lobby.leave();

    expect(lobby.getSnapshot()).toMatchObject({ status: "idle", code: null, members: [], selfMemberId: null, hostMemberId: null });
    expect(seen).toEqual(["idle", "idle"]);
  });

  it("reconnects after channel failure, reuses the member id, and refreshes joinedAt", async () => {
    let tick = 100;
    const reconnectChannels: FakeChannel[] = [];
    const lobby = createLobbySession({
      createChannel: () => { const channel = makeChannel(); reconnectChannels.push(channel); return channel; },
      createMemberId: () => "self", now: () => ++tick, random: () => 0,
      schedule: (callback) => { queueMicrotask(callback); return 1; }, cancel: () => undefined,
    });
    const joined = lobby.join("ABC234", "Alex");
    const first = reconnectChannels[0]!;
    first.notify({ type: "subscribed" }); first.sync({ host: [host] }); await Promise.resolve();
    first.sync({ host: [host], self: [self] }); await joined;
    first.notify({ type: "status-error", status: "TIMED_OUT" });
    await vi.waitFor(() => expect(reconnectChannels).toHaveLength(2));
    const second = reconnectChannels[1]!;
    second.notify({ type: "subscribed" }); second.sync({ host: [host] });
    await vi.waitFor(() => expect(second.track).toHaveBeenCalled());
    expect(second.track).toHaveBeenCalledWith({ ...self, joinedAt: 102 });
    second.sync({ host: [host], self: [{ ...self, joinedAt: 102 }] });
    await vi.waitFor(() => expect(lobby.getSnapshot()).toMatchObject({ status: "joined", presenceStatus: "current" }));
    expect(lobby.getSnapshot().selfMemberId).toBe("self");
    expect(first.remove).toHaveBeenCalledOnce();
  });

  it("excludes its own stale Presence key when checking recovery capacity", async () => {
    const reconnectChannels: FakeChannel[] = [];
    const lobby = createLobbySession({
      createChannel: () => { const channel = makeChannel(); reconnectChannels.push(channel); return channel; },
      createMemberId: () => "self", random: () => 0,
      schedule: (callback) => { queueMicrotask(callback); return 1; }, cancel: () => undefined,
    });
    const joined = lobby.join("ABC234", "Alex");
    const first = reconnectChannels[0]!;
    first.notify({ type: "subscribed" }); first.sync({ host: [host] }); await Promise.resolve(); first.sync({ host: [host], self: [self] }); await joined;
    first.notify({ type: "status-error", status: "CLOSED" });
    await vi.waitFor(() => expect(reconnectChannels).toHaveLength(2));
    const second = reconnectChannels[1]!;
    second.notify({ type: "subscribed" }); second.sync({ host: [host], self: [self] });
    await vi.waitFor(() => expect(second.track).toHaveBeenCalledOnce());
    expect(lobby.getSnapshot().error).toBeNull();
  });

  it("refuses recovery into a full lobby and exposes a terminal full error", async () => {
    const reconnectChannels: FakeChannel[] = [];
    const lobby = createLobbySession({
      createChannel: () => { const channel = makeChannel(); reconnectChannels.push(channel); return channel; },
      createMemberId: () => "self", schedule: (callback) => { queueMicrotask(callback); return 1; }, cancel: () => undefined,
    });
    const joined = lobby.join("ABC234", "Alex");
    const first = reconnectChannels[0]!;
    first.notify({ type: "subscribed" }); first.sync({ host: [host] }); await Promise.resolve(); first.sync({ host: [host], self: [self] }); await joined;
    first.notify({ type: "status-error", status: "TIMED_OUT" });
    await vi.waitFor(() => expect(reconnectChannels).toHaveLength(2));
    const second = reconnectChannels[1]!;
    second.notify({ type: "subscribed" }); second.sync({ host: [host], other: [{ memberId: "other", displayName: "Lee", joinedAt: 60 }] });
    await vi.waitFor(() => expect(lobby.getSnapshot()).toMatchObject({ status: "error", error: { reason: "full" } }));
    expect(second.track).not.toHaveBeenCalled();
    expect(second.remove).toHaveBeenCalledOnce();
  });

  it("offers manual retry after five failed automatic subscriptions and cleans old generations", async () => {
    const reconnectChannels: FakeChannel[] = [];
    const scheduled: Array<() => void> = [];
    const lobby = createLobbySession({
      createChannel: () => { const channel = makeChannel(); reconnectChannels.push(channel); return channel; },
      createMemberId: () => "self", random: () => 0,
      schedule: (callback) => { scheduled.push(callback); return scheduled.length; }, cancel: () => undefined,
    });
    const joined = lobby.join("ABC234", "Alex");
    const first = reconnectChannels[0]!;
    first.notify({ type: "subscribed" }); first.sync({ host: [host] }); await Promise.resolve(); first.sync({ host: [host], self: [self] }); await joined;
    first.notify({ type: "status-error", status: "CLOSED" });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await vi.waitFor(() => expect(scheduled.length).toBeGreaterThan(0));
      scheduled.shift()?.();
      await vi.waitFor(() => expect(reconnectChannels).toHaveLength(attempt + 2));
      reconnectChannels[attempt + 1]!.notify({ type: "status-error", status: "CHANNEL_ERROR" });
    }
    await vi.waitFor(() => expect(lobby.getSnapshot()).toMatchObject({ status: "error", error: { reason: "connection", retryable: true } }));
    const previous = reconnectChannels.at(-1)!;
    const manualRetry = lobby.retry();
    expect(reconnectChannels).toHaveLength(7);
    const manualChannel = reconnectChannels[6]!;
    manualChannel.notify({ type: "subscribed" }); manualChannel.sync({ host: [host] });
    await vi.waitFor(() => expect(manualChannel.track).toHaveBeenCalledOnce());
    manualChannel.sync({ host: [host], self: [self] });
    await expect(manualRetry).resolves.toMatchObject({ ok: true });
    const recoveredSnapshot = lobby.getSnapshot();
    previous.sync({ hostile: [host] });
    expect(lobby.getSnapshot()).toEqual(recoveredSnapshot);
    expect(previous.remove).toHaveBeenCalledOnce();
  });

  it("cancels pending reconnect work when the member leaves", async () => {
    const reconnectChannels: FakeChannel[] = [];
    const cancel = vi.fn();
    const lobby = createLobbySession({ createChannel: () => { const channel = makeChannel(); reconnectChannels.push(channel); return channel; }, createMemberId: () => "self", schedule: () => 42, cancel });
    const joined = lobby.join("ABC234", "Alex");
    const first = reconnectChannels[0]!;
    first.notify({ type: "subscribed" }); first.sync({ host: [host] }); await Promise.resolve(); first.sync({ host: [host], self: [self] }); await joined;
    first.notify({ type: "status-error", status: "TIMED_OUT" });
    await lobby.leave();
    expect(cancel).toHaveBeenCalledOnce();
    expect(reconnectChannels).toHaveLength(1);
  });

  it("forwards typed signaling through the active channel and detaches it on leave", async () => {
    const channel = makeChannel();
    const lobby = createLobbySession({ createChannel: () => channel, createMemberId: () => "self" });
    const listener = vi.fn();
    const unsubscribe = lobby.subscribeRealtimeEvents(listener);
    const joined = lobby.join("ABC234", "Alex");
    channel.notify({ type: "subscribed" }); channel.sync({ host: [host] }); await Promise.resolve(); channel.sync({ host: [host], self: [self] }); await joined;
    const event: RealtimeEvent = { type: "share:started", senderId: "host", sessionId: "generation-1" };
    (channel.onEvent as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]({ type: "event", event });
    expect(listener).toHaveBeenCalledWith(event);
    await expect(lobby.sendRealtimeEvent(event)).resolves.toEqual({ ok: true });
    await lobby.leave();
    await expect(lobby.sendRealtimeEvent(event)).resolves.toEqual({ ok: false, reason: "detached" });
    unsubscribe();
  });
});

describe("reconnect backoff policy", () => {
  it("applies bounded full jitter with a cap of eight seconds", () => {
    expect([1, 2, 4, 5, 6, 20].map((attempt) => reconnectDelay(attempt, 0))).toEqual([0, 0, 0, 0, 0, 0]);
    expect([1, 2, 4, 5, 6, 20].map((attempt) => reconnectDelay(attempt, 0.999))).toEqual([499, 999, 3996, 7992, 7992, 7992]);
  });
});
