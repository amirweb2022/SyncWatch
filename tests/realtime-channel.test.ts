import { beforeEach, describe, expect, it, vi } from "vitest";

const supabase = vi.hoisted(() => ({
  channel: {
    on: vi.fn(),
    subscribe: vi.fn(),
    presenceState: vi.fn(),
    track: vi.fn(),
    untrack: vi.fn(),
  },
  createClient: vi.fn(),
  removeChannel: vi.fn(),
  channelFactory: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: supabase.createClient,
}));

import { getRealtimeConfig } from "../lib/realtime/client";
import { createLobbyChannel } from "../lib/realtime/channel";

describe("public Realtime configuration", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "public-anon-key");
  });

  it("accepts a valid project URL and public anon key", () => {
    expect(getRealtimeConfig()).toEqual({
      url: "https://example.supabase.co",
      anonKey: "public-anon-key",
    });
  });

  it.each([
    ["", "public-anon-key"],
    ["not-a-url", "public-anon-key"],
    ["https://example.supabase.co/path", "public-anon-key"],
    ["https://example.supabase.co", ""],
  ])("rejects invalid public configuration (%s)", (url, anonKey) => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", url);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", anonKey);
    expect(() => getRealtimeConfig()).toThrow(/supabase configuration/i);
  });
});

describe("lobby channel adapter", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "public-anon-key");
    supabase.channel.on.mockReset().mockReturnValue(supabase.channel);
    supabase.channel.subscribe.mockReset().mockReturnValue(supabase.channel);
    supabase.channel.presenceState.mockReset().mockReturnValue({});
    supabase.channel.track.mockReset().mockResolvedValue("ok");
    supabase.channel.untrack.mockReset().mockResolvedValue("ok");
    supabase.createClient.mockReset().mockReturnValue({
      channel: supabase.channelFactory,
      removeChannel: supabase.removeChannel,
    });
    supabase.channelFactory.mockReset().mockReturnValue(supabase.channel);
    supabase.removeChannel.mockReset().mockResolvedValue("ok");
  });

  it("creates a public lobby channel with Presence keyed by member ID", () => {
    createLobbyChannel("ABC234", "member-1");
    expect(supabase.createClient).toHaveBeenCalledWith(
      "https://example.supabase.co",
      "public-anon-key",
      expect.any(Object),
    );
    expect(supabase.channelFactory).toHaveBeenCalledWith("lobby:ABC234", {
      config: { private: false, presence: { key: "member-1" } },
    });
  });

  it("reports subscription status and gives consumers initial Presence sync", () => {
    const callback = vi.fn();
    const adapter = createLobbyChannel("ABC234", "member-1");
    adapter.subscribe(callback);
    expect(supabase.channel.on).toHaveBeenCalledWith("presence", { event: "sync" }, expect.any(Function));
    expect(supabase.channel.subscribe).toHaveBeenCalledWith(expect.any(Function));
    const subscription = supabase.channel.subscribe.mock.calls[0]?.[0] as
      | ((status: string, error?: Error) => void)
      | undefined;
    subscription?.("SUBSCRIBED");
    expect(callback).toHaveBeenCalledWith({ type: "subscribed" });
    const presenceHandler = supabase.channel.on.mock.calls[0]?.[2] as (() => void) | undefined;
    presenceHandler?.();
    expect(callback).toHaveBeenCalledWith({ type: "presence-sync", state: {} });
  });

  it.each(["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"])("maps %s to an error status", (status) => {
    const callback = vi.fn();
    createLobbyChannel("ABC234", "member-1").subscribe(callback);
    const subscription = supabase.channel.subscribe.mock.calls[0]?.[0] as
      | ((status: string, error?: Error) => void)
      | undefined;
    subscription?.(status, new Error("transport failed"));
    expect(callback).toHaveBeenCalledWith({
      type: "status-error",
      status,
      error: expect.any(Error),
    });
  });

  it("preserves a sanitized Supabase subscription failure category and message", () => {
    const callback = vi.fn();
    createLobbyChannel("ABC234", "member-1").subscribe(callback);
    const subscription = supabase.channel.subscribe.mock.calls[0]?.[0] as
      | ((status: string, error?: Error) => void)
      | undefined;
    subscription?.("CHANNEL_ERROR", new Error("Realtime authorization failed"));
    expect(callback).toHaveBeenCalledWith({
      type: "status-error",
      status: "CHANNEL_ERROR",
      error: expect.objectContaining({ message: "Realtime authorization failed" }),
    });
  });

  it("validates Broadcast payloads before delivering events", () => {
    const callback = vi.fn();
    const adapter = createLobbyChannel("ABC234", "member-1");
    adapter.subscribe(callback);
    adapter.onEvent(callback);
    expect(supabase.channel.on).toHaveBeenCalledWith("broadcast", { event: "syncwatch" }, expect.any(Function));
    const eventHandler = supabase.channel.on.mock.calls.find((call) => call[0] === "broadcast")?.[2] as
      | ((payload: unknown) => void)
      | undefined;
    eventHandler?.({ payload: { type: "share:started", senderId: "member-2" } });
    eventHandler?.({ payload: { type: "share:started", senderId: 42 } });
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenCalledWith({ type: "event", event: { type: "share:started", senderId: "member-2" } });
  });

  it("tracks metadata, untracks presence, detaches callbacks, and removes once", async () => {
    const adapter = createLobbyChannel("ABC234", "member-1");
    const listener = vi.fn();
    adapter.subscribe(listener);
    adapter.onEvent(listener);
    await adapter.track({ memberId: "member-1", displayName: "Alex", joinedAt: 10 });
    await adapter.untrack();
    adapter.detach();
    await adapter.remove();
    await adapter.remove();
    expect(supabase.channel.track).toHaveBeenCalledWith({ memberId: "member-1", displayName: "Alex", joinedAt: 10 });
    expect(supabase.channel.untrack).toHaveBeenCalledTimes(1);
    expect(supabase.removeChannel).toHaveBeenCalledTimes(1);
    const presenceHandler = supabase.channel.on.mock.calls.find((call) => call[0] === "presence")?.[2] as
      | (() => void)
      | undefined;
    const eventHandler = supabase.channel.on.mock.calls.find((call) => call[0] === "broadcast")?.[2] as
      | ((payload: unknown) => void)
      | undefined;
    presenceHandler?.();
    eventHandler?.({ payload: { type: "share:started", senderId: "member-2" } });
    expect(listener).toHaveBeenCalledTimes(0);
  });

  it("surfaces track and untrack failures", async () => {
    const adapter = createLobbyChannel("ABC234", "member-1");
    supabase.channel.track.mockResolvedValueOnce("error");
    supabase.channel.untrack.mockResolvedValueOnce("timed out");
    await expect(adapter.track({ memberId: "member-1", displayName: "Alex", joinedAt: 10 })).rejects.toThrow(/track/i);
    await expect(adapter.untrack()).rejects.toThrow(/untrack/i);
  });
});
