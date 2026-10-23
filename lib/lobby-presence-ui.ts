import { messages, type Locale } from "./i18n";
import type { LobbySession, LobbySessionSnapshot } from "./realtime/session";

export interface LobbyMemberView {
  readonly memberId: string;
  readonly displayName: string;
  readonly role: string | null;
  readonly online: boolean;
}

export interface LobbyRosterView {
  readonly freshness: string;
  readonly members: readonly LobbyMemberView[];
}

export function getLobbyConnectionErrorText(snapshot: LobbySessionSnapshot, locale: Locale): string | null {
  if (snapshot.status !== "error" || !snapshot.error) return null;
  const text = messages[locale];
  switch (snapshot.error.reason) {
    case "configuration": return text.configurationError;
    case "connection": return text.connectionError;
    case "invalid-code": return text.invalidCode;
    case "invalid-name": return text.invalidName;
    case "full": return text.fullLobby;
    case "unavailable": return text.unavailableLobby;
    case "create-exhausted": return text.createError;
  }
}

export function getLobbyRosterView(snapshot: LobbySessionSnapshot, locale: Locale): LobbyRosterView {
  const text = messages[locale];
  const current = snapshot.presenceStatus === "current";
  return {
    freshness: current ? text.connectionOnline : text.rosterUnknown,
    members: snapshot.members.map((member) => ({
      memberId: member.memberId,
      displayName: member.displayName,
      role: member.memberId === snapshot.hostMemberId ? text.host : null,
      online: current,
    })),
  };
}

export interface LobbyPresenceController {
  getConnectionView(): { readonly label: string; readonly retryAvailable: boolean };
  retry(): Promise<void>;
  leave(): Promise<void>;
}

export function createLobbyPresenceController(
  session: LobbySession,
  locale: Locale,
  navigate: (path: string) => void,
): LobbyPresenceController {
  return {
    getConnectionView() {
      const snapshot = session.getSnapshot();
      if (snapshot.status === "reconnecting") return { label: messages[locale].reconnecting, retryAvailable: false };
      if (snapshot.status === "connecting") return { label: messages[locale].joining, retryAvailable: false };
      if (snapshot.status === "error" && snapshot.error?.retryable) {
        return { label: messages[locale].retryExhausted, retryAvailable: true };
      }
      if (snapshot.status === "error" || snapshot.status === "idle") {
        return { label: messages[locale].connectionError, retryAvailable: false };
      }
      return { label: messages[locale].connectionOnline, retryAvailable: false };
    },
    async retry() {
      const result = await session.retry();
      if (result.ok) navigate(`/lobby/${result.code}`);
    },
    async leave() {
      await session.leave();
      navigate("/");
    },
  };
}
