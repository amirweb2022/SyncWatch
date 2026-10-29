export interface IceServerConfig {
  readonly urls: string | string[];
  readonly username?: string;
  readonly credential?: string;
}

export interface TurnEnvironment {
  readonly NEXT_PUBLIC_TURN_URL?: string;
  readonly NEXT_PUBLIC_TURN_USERNAME?: string;
  readonly NEXT_PUBLIC_TURN_CREDENTIAL?: string;
}

export interface IceConfiguration {
  readonly iceServers: IceServerConfig[];
  readonly iceTransportPolicy?: "all" | "relay";
}

const DEFAULT_STUN_URL = "stun:stun.l.google.com:19302";

export function buildIceServers(environment: TurnEnvironment): IceServerConfig[] {
  const servers: IceServerConfig[] = [{ urls: DEFAULT_STUN_URL }];
  const urls = environment.NEXT_PUBLIC_TURN_URL?.split(",").map((url) => url.trim()).filter(isTurnUrl) ?? [];
  const username = environment.NEXT_PUBLIC_TURN_USERNAME?.trim();
  const credential = environment.NEXT_PUBLIC_TURN_CREDENTIAL?.trim();
  if (urls.length === 0 || !username || !credential) return servers;
  return [...servers, { urls: urls.length === 1 ? urls[0]! : urls, username, credential }];
}

function isTurnUrl(value: string): boolean {
  return /^turns?:[^\s,]+$/i.test(value);
}

export function buildIceConfiguration(environment: TurnEnvironment, forceRelay = false): IceConfiguration {
  return { iceServers: buildIceServers(environment), ...(forceRelay ? { iceTransportPolicy: "relay" as const } : {}) };
}

export function getTurnGuidance(environment: TurnEnvironment): string | null {
  return buildIceServers(environment).length === 1
    ? "Some restrictive networks require TURN for a direct connection."
    : null;
}
