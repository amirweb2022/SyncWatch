import WebSocket from "ws";
import type { WebSocketLikeConstructor } from "@supabase/realtime-js";

export const nodeWebSocketTransport = class extends WebSocket {
  constructor(address: string | URL, protocols?: string | string[]) {
    super(address, protocols);
  }
} as unknown as WebSocketLikeConstructor;
