import { normalizeDisplayName } from "./code";
import { messages, type Locale } from "./i18n";
import type { DisplayNamePreference } from "./display-name-preference";
import type { LobbySession, LobbySessionFailure, LobbySessionResult } from "./realtime/session";

export interface LobbyEntryController {
  getDisplayName(): string;
  create(displayName: string): Promise<LobbySessionResult>;
  join(code: string, displayName: string): Promise<LobbySessionResult>;
  getErrorText(locale: Locale): string | null;
}

function errorMessage(failure: LobbySessionFailure, locale: Locale): string {
  const text = messages[locale];
  switch (failure.reason) {
    case "invalid-code": return text.invalidCode;
    case "invalid-name": return text.invalidName;
    case "full": return text.fullLobby;
    case "unavailable": return text.unavailableLobby;
    case "connection": return text.connectionError;
    case "configuration": return text.configurationError;
    case "create-exhausted": return text.createError;
  }
}

export function createLobbyEntryController(
  session: LobbySession,
  preference: DisplayNamePreference,
  onJoined: (code: string) => void,
): LobbyEntryController {
  let error: LobbySessionFailure | null = null;
  return {
    getDisplayName: () => preference.load(),
    async create(displayName) {
      const normalized = normalizeDisplayName(displayName);
      if (!normalized.valid) {
        error = { reason: "invalid-name", retryable: false };
        return { ok: false, ...error };
      }
      preference.save(normalized.name);
      const result = await session.create(normalized.name);
      error = result.ok ? null : result;
      if (result.ok) onJoined(result.code);
      return result;
    },
    async join(code, displayName) {
      const normalized = normalizeDisplayName(displayName);
      if (!normalized.valid) {
        error = { reason: "invalid-name", retryable: false };
        return { ok: false, ...error };
      }
      preference.save(normalized.name);
      const result = await session.join(code, normalized.name);
      error = result.ok ? null : result;
      if (result.ok) onJoined(result.code);
      return result;
    },
    getErrorText: (locale) => error ? errorMessage(error, locale) : null,
  };
}
