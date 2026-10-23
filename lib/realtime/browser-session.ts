import { createLobbySession, type LobbySession } from "./session";

let browserSession: LobbySession | null = null;

export function getBrowserLobbySession(): LobbySession {
  browserSession ??= createLobbySession();
  return browserSession;
}
