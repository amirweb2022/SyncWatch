import {
  LOBBY_CODE_ALPHABET,
  LOBBY_CODE_LENGTH,
  MAX_DISPLAY_NAME_CODE_POINTS,
} from "./config";

export type LobbyCodeValidation =
  | { readonly valid: true; readonly code: string }
  | { readonly valid: false };

export type DisplayNameValidation =
  | { readonly valid: true; readonly name: string }
  | { readonly valid: false };

export type RandomByteSource = (target: Uint8Array) => void;

const browserRandomBytes: RandomByteSource = (target) => {
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error("Cryptographic randomness is unavailable");
  }
  globalThis.crypto.getRandomValues(target);
};

export function validateLobbyCode(value: string): LobbyCodeValidation {
  const code = value.toUpperCase();
  if (
    code.length !== LOBBY_CODE_LENGTH ||
    [...code].some((character) => !LOBBY_CODE_ALPHABET.includes(character))
  ) {
    return { valid: false };
  }
  return { valid: true, code };
}

function randomAlphabetIndex(randomBytes: RandomByteSource): number {
  const range = 256 - (256 % LOBBY_CODE_ALPHABET.length);
  const byte = new Uint8Array(1);
  do {
    randomBytes(byte);
  } while (byte[0] >= range);
  return byte[0] % LOBBY_CODE_ALPHABET.length;
}

export function generateLobbyCode(randomBytes = browserRandomBytes): string {
  return Array.from({ length: LOBBY_CODE_LENGTH }, () =>
    LOBBY_CODE_ALPHABET.charAt(randomAlphabetIndex(randomBytes)),
  ).join("");
}

export function normalizeDisplayName(value: string): DisplayNameValidation {
  const name = value.normalize("NFC").trim();
  const codePoints = [...name];
  if (
    codePoints.length < 1 ||
    codePoints.length > MAX_DISPLAY_NAME_CODE_POINTS ||
    /\p{Cc}/u.test(name)
  ) {
    return { valid: false };
  }
  return { valid: true, name };
}

export function generateMemberId(randomBytes = browserRandomBytes): string {
  const bytes = new Uint8Array(16);
  randomBytes(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
