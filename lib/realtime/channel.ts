import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import { validateLobbyCode } from "../code";
import { parsePresenceMetadata, parseRealtimeEvent, type PresenceMetadata, type RealtimeEvent } from "./events";
import { createRealtimeClient, type RealtimeClientOptions } from "./client";

export type ChannelStatus =
  | { readonly type: "subscribed" }
  | { readonly type: "status-error"; readonly status: "CHANNEL_ERROR" | "TIMED_OUT" | "CLOSED"; readonly error?: Error }
  | { readonly type: "presence-sync"; readonly state: unknown };

export type ChannelEvent = { readonly type: "event"; readonly event: RealtimeEvent };
export type ChannelListener = (status: ChannelStatus) => void;
export type EventListener = (event: ChannelEvent) => void;

export interface LobbyChannel {
  subscribe(listener: ChannelListener): void;
  onEvent(listener: EventListener): () => void;
  send(event: RealtimeEvent): Promise<SendResult>;
  track(metadata: PresenceMetadata): Promise<void>;
  untrack(): Promise<void>;
  detach(): void;
  remove(): Promise<void>;
}

export type SendResult = { readonly ok: true } | { readonly ok: false; readonly reason: "detached" | "send-failed" };

type ErrorStatus = Extract<ChannelStatus, { readonly type: "status-error" }>["status"];

const ERROR_STATUSES = new Set<ErrorStatus>(["CHANNEL_ERROR", "TIMED_OUT", "CLOSED"]);

function safeSubscriptionError(error: unknown): Error | undefined {
  if (!(error instanceof Error)) return undefined;
  const message = error.message
    .replace(/https?:\/\/[^\s"'<>]+/gi, "<redacted-url>")
    .replace(/(apikey|authorization|key|token)(\s*[:=]\s*)[^\s,;]+/gi, "$1$2<redacted>");
  return new Error(message, { cause: error.name });
}

function statusError(
  status: string,
  error?: Error,
): Extract<ChannelStatus, { readonly type: "status-error" }> | null {
  if (!ERROR_STATUSES.has(status as ErrorStatus)) return null;
  return {
    type: "status-error",
    status: status as ErrorStatus,
    ...(error ? { error } : {}),
  };
}

export function createLobbyChannel(
  code: string,
  memberId: string,
  clientFactory: () => SupabaseClient = () => createRealtimeClient(),
): LobbyChannel {
  const validation = validateLobbyCode(code);
  if (!validation.valid) throw new Error("Invalid lobby code");
  if (!memberId.trim()) throw new Error("Member ID is required");

  const client = clientFactory();
  const channel = client.channel(`lobby:${validation.code}`, {
    config: { private: false, presence: { key: memberId } },
  });
  let detached = false;
  let removed = false;

  return {
    subscribe(listener) {
      const presenceSync = () => {
        if (!detached) listener({ type: "presence-sync", state: channel.presenceState() });
      };
      channel.on("presence", { event: "sync" }, presenceSync);
      const subscription = channel.subscribe((status, error) => {
        if (detached) return;
        if (status === "SUBSCRIBED") listener({ type: "subscribed" });
        else {
          const safeError = safeSubscriptionError(error);
          const mapped = statusError(status, safeError);
          if (mapped && process.env.NODE_ENV !== "production") {
            console.warn("[syncwatch-realtime-diagnostic] subscription failure", {
              status: mapped.status,
              errorName: error instanceof Error ? error.name : typeof error,
              errorMessage: safeError?.message,
            });
          }
          if (mapped) listener(mapped);
        }
      });
      // Supabase returns the channel itself from subscribe; retain no raw channel outside this adapter.
      void subscription;
    },
    onEvent(listener) {
      let active = true;
      const handler = (message: { readonly payload?: unknown }) => {
        if (detached || !active) return;
        const event = parseRealtimeEvent(message.payload);
        if (event) listener({ type: "event", event });
      };
      channel.on("broadcast", { event: "syncwatch" }, handler);
      return () => { active = false; };
    },
    async send(event) {
      if (detached || removed) return { ok: false, reason: "detached" };
      try {
        const result = await channel.send({ type: "broadcast", event: "syncwatch", payload: event });
        return result === "ok" ? { ok: true } : { ok: false, reason: "send-failed" };
      } catch {
        return { ok: false, reason: "send-failed" };
      }
    },
    async track(metadata) {
      const parsed = parsePresenceMetadata(metadata);
      if (!parsed || parsed.memberId !== memberId) throw new Error("Invalid Presence metadata for this member");
      const result = await channel.track(parsed);
      if (result !== "ok") throw new Error(`Presence track failed: ${String(result)}`);
    },
    async untrack() {
      const result = await channel.untrack();
      if (result !== "ok") throw new Error(`Presence untrack failed: ${String(result)}`);
    },
    detach() {
      if (detached) return;
      detached = true;
    },
    async remove() {
      if (removed) return;
      this.detach();
      const result = await client.removeChannel(channel as RealtimeChannel);
      if (result !== "ok") throw new Error(`Realtime channel removal failed: ${String(result)}`);
      removed = true;
    },
  };
}

export function createLobbyChannelWithOptions(
  code: string,
  memberId: string,
  options: RealtimeClientOptions,
): LobbyChannel {
  return createLobbyChannel(code, memberId, () => createRealtimeClient(options));
}
