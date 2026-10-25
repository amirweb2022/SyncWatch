export interface IceServerConfig {
  readonly urls: string | readonly string[];
  readonly username?: string;
  readonly credential?: string;
}

export interface TurnEnvironment {
  readonly NEXT_PUBLIC_TURN_URL?: string;
  readonly NEXT_PUBLIC_TURN_USERNAME?: string;
  readonly NEXT_PUBLIC_TURN_CREDENTIAL?: string;
}

const DEFAULT_STUN_URL = "stun:stun.l.google.com:19302";

export function buildIceServers(environment: TurnEnvironment): IceServerConfig[] {
  const servers: IceServerConfig[] = [{ urls: DEFAULT_STUN_URL }];
  const url = environment.NEXT_PUBLIC_TURN_URL?.trim();
  const username = environment.NEXT_PUBLIC_TURN_USERNAME?.trim();
  const credential = environment.NEXT_PUBLIC_TURN_CREDENTIAL?.trim();
  if (!url || !username || !credential || !/^turns?:[^\s]+$/i.test(url)) return servers;
  return [...servers, { urls: url, username, credential }];
}

export function getTurnGuidance(environment: TurnEnvironment): string | null {
  return buildIceServers(environment).length === 1
    ? "Some restrictive networks require TURN for a direct connection."
    : null;
}
