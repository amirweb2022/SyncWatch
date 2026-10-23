import { describe, expect, it } from "vitest";
import { createRealtimeClient } from "../lib/realtime/client";
import { nodeWebSocketTransport } from "./support/node-websocket-transport";

describe("Node.js Realtime transport", () => {
  it("constructs a Realtime client when the test runtime has no native WebSocket", () => {
    const originalWebSocket = globalThis.WebSocket;
    const originalUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const originalKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    Reflect.deleteProperty(globalThis, "WebSocket");
    Reflect.set(process.env, "NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
    Reflect.set(process.env, "NEXT_PUBLIC_SUPABASE_ANON_KEY", "test-anon-key");
    try {
      expect(() => createRealtimeClient()).toThrow(/Provide a WebSocket implementation via the transport option/);
      expect(() => createRealtimeClient({ realtime: { transport: nodeWebSocketTransport } })).not.toThrow();
    } finally {
      if (originalWebSocket) Reflect.set(globalThis, "WebSocket", originalWebSocket);
      if (originalUrl === undefined) Reflect.deleteProperty(process.env, "NEXT_PUBLIC_SUPABASE_URL");
      else Reflect.set(process.env, "NEXT_PUBLIC_SUPABASE_URL", originalUrl);
      if (originalKey === undefined) Reflect.deleteProperty(process.env, "NEXT_PUBLIC_SUPABASE_ANON_KEY");
      else Reflect.set(process.env, "NEXT_PUBLIC_SUPABASE_ANON_KEY", originalKey);
    }
  });
});
