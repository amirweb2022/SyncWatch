import { MAX_LOBBY_MEMBERS } from "../config";
import { generateLobbyCode, generateMemberId, normalizeDisplayName, validateLobbyCode } from "../code";
import { createLobbyChannel, type ChannelStatus, type LobbyChannel } from "./channel";
import { decideObservedAdmission, electHost, normalizePresenceSnapshot } from "./presence-policy";
import type { PresenceMetadata } from "./events";
import { MAX_AUTOMATIC_RECONNECT_ATTEMPTS, reconnectDelay } from "./retry-policy";

export type LobbySessionStatus = "idle" | "connecting" | "joined" | "reconnecting" | "error";
export type PresenceFreshness = "current" | "stale";

export interface LobbySessionSnapshot {
  readonly status: LobbySessionStatus;
  readonly code: string | null;
  readonly members: readonly PresenceMetadata[];
  readonly selfMemberId: string | null;
  readonly hostMemberId: string | null;
  readonly error: LobbySessionFailure | null;
  readonly presenceStatus: PresenceFreshness;
}

export type LobbySessionFailure =
  | { readonly reason: "invalid-code" | "invalid-name" | "unavailable" | "full" | "connection" | "configuration"; readonly retryable: boolean }
  | { readonly reason: "create-exhausted"; readonly retryable: true };

export type LobbySessionResult = { readonly ok: true; readonly code: string } | ({ readonly ok: false } & LobbySessionFailure);

export interface LobbySessionDependencies {
  readonly createChannel?: (code: string, memberId: string) => LobbyChannel;
  readonly createCode?: () => string;
  readonly createMemberId?: () => string;
  readonly now?: () => number;
  readonly random?: () => number;
  readonly schedule?: (callback: () => void, delayMs: number) => unknown;
  readonly cancel?: (handle: unknown) => void;
}

export interface LobbySession {
  create(displayName: string): Promise<LobbySessionResult>;
  join(code: string, displayName: string): LobbySessionResult | Promise<LobbySessionResult>;
  getSnapshot(): LobbySessionSnapshot;
  subscribe(listener: (snapshot: LobbySessionSnapshot) => void): () => void;
  leave(): Promise<void>;
  retry(): Promise<LobbySessionResult>;
}

const EMPTY_JOIN_SYNC_TIMEOUT_MS = 8_000;

const EMPTY_SNAPSHOT: LobbySessionSnapshot = Object.freeze({
  status: "idle", code: null, members: Object.freeze([]), selfMemberId: null, hostMemberId: null, error: null,
  presenceStatus: "current",
});

function failure(reason: LobbySessionFailure["reason"]): LobbySessionResult {
  if (reason === "create-exhausted") return { ok: false, reason, retryable: true };
  if (reason === "configuration") return { ok: false, reason, retryable: false };
  return { ok: false, reason, retryable: reason === "connection" };
}

function statusFailure(status: ChannelStatus): LobbySessionFailure | null {
  return status.type === "status-error" ? { reason: "connection", retryable: true } : null;
}

export function createLobbySession(dependencies: LobbySessionDependencies = {}): LobbySession {
  const makeChannel = dependencies.createChannel ?? createLobbyChannel;
  const makeCode = dependencies.createCode ?? generateLobbyCode;
  const makeMemberId = dependencies.createMemberId ?? generateMemberId;
  const now = dependencies.now ?? Date.now;
  const random = dependencies.random ?? Math.random;
  const schedule = dependencies.schedule ?? ((callback, delayMs) => setTimeout(callback, delayMs));
  const cancel = dependencies.cancel ?? ((handle) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  let snapshot = EMPTY_SNAPSHOT;
  let activeChannel: LobbyChannel | null = null;
  let generation = 0;
  let leaveOperation: Promise<void> | null = null;
  let timer: unknown = null;
  let reconnectAttempts = 0;
  let sessionContext: { code: string; name: string; memberId: string } | null = null;
  let reconnecting = false;
  const listeners = new Set<(value: LobbySessionSnapshot) => void>();

  function publish(next: LobbySessionSnapshot): void {
    snapshot = Object.freeze(next);
    for (const listener of listeners) listener(snapshot);
  }

  async function cleanup(channel: LobbyChannel, tracked: boolean): Promise<void> {
    channel.detach();
    if (tracked) {
      try { await channel.untrack(); } catch { /* Best effort during failed setup. */ }
    }
    try { await channel.remove(); } catch { /* Resource ownership ends even if remote removal fails. */ }
  }

  async function attempt(
    code: string,
    name: string,
    memberId: string,
    creating: boolean,
    token: number,
    recovering = false,
  ): Promise<LobbySessionResult> {
    const validCode = validateLobbyCode(code);
    if (!validCode.valid) return failure("connection");
    let channel: LobbyChannel;
    try {
      channel = makeChannel(validCode.code, memberId);
    } catch (error) {
      return failure(error instanceof Error && error.message.includes("configuration") ? "configuration" : "connection");
    }
    activeChannel = channel;
    publish({ ...EMPTY_SNAPSHOT, status: "connecting", code, selfMemberId: memberId });

    return new Promise((resolve) => {
      let subscribed = false;
      let initialSync = false;
      let tracked = false;
      let settled = false;
      let latest: readonly PresenceMetadata[] = Object.freeze([]);
      let sawOwnPresence = false;
      let stage: "initial" | "confirmation" | "joined" = "initial";
      let latestState: unknown = {};
      let emptyJoinTimer: unknown = null;
      let connectedStatus: LobbySessionStatus = "joined";

      const clearEmptyJoinTimer = () => {
        if (emptyJoinTimer === null) return;
        cancel(emptyJoinTimer);
        emptyJoinTimer = null;
      };

      const finish = async (result: LobbySessionResult, joinedMembers?: readonly PresenceMetadata[]) => {
        if (settled) return;
        settled = true;
        clearEmptyJoinTimer();
        if (!result.ok || !joinedMembers) {
          await cleanup(channel, tracked);
          if (activeChannel === channel) activeChannel = null;
          if (token === generation) publish({ ...EMPTY_SNAPSHOT, status: "error", error: result.ok ? null : result });
        } else if (token === generation) {
          const host = electHost(joinedMembers);
          publish({ status: "joined", code, members: joinedMembers, selfMemberId: memberId,
            hostMemberId: host?.memberId ?? null, error: null, presenceStatus: "current" });
        }
        resolve(result);
      };

      const processSnapshot = (state: unknown) => {
        if (token !== generation || (settled && stage !== "joined")) return;
        latestState = state;
        latest = normalizePresenceSnapshot(state && typeof state === "object" && !Array.isArray(state)
          ? state as Readonly<Record<string, readonly unknown[]>> : {});
        if (stage === "joined") {
          const host = electHost(latest);
          publish({ status: connectedStatus, code, members: latest, selfMemberId: memberId,
            hostMemberId: host?.memberId ?? null, error: snapshot.error, presenceStatus: connectedStatus === "reconnecting" ? "stale" : "current" });
          return;
        }
        if (stage === "initial") {
          if (!subscribed || !initialSync) return;
          if (creating) {
            if (latest.length > 0) {
              void finish({ ok: false, reason: "unavailable", retryable: false });
              return;
            }
          } else if (recovering) {
            const others = latest.filter((member) => member.memberId !== memberId);
            if (others.length >= MAX_LOBBY_MEMBERS) {
              void finish(failure("full"));
              return;
            }
          } else {
            const decision = decideObservedAdmission(latest, memberId);
            if (!decision.allowed) {
              if (decision.reason === "unavailable" && latest.length === 0) {
                if (emptyJoinTimer === null) {
                  emptyJoinTimer = schedule(() => {
                    emptyJoinTimer = null;
                    void finish(failure("unavailable"));
                  }, EMPTY_JOIN_SYNC_TIMEOUT_MS);
                }
                return;
              }
              clearEmptyJoinTimer();
              void finish(failure(decision.reason));
              return;
            }
          }
          clearEmptyJoinTimer();
          tracked = true;
          stage = "confirmation";
          void channel.track({ memberId, displayName: name, joinedAt: now() }).catch(() => {
            void finish(failure("connection"));
          });
          return;
        }
        if (stage === "confirmation") {
          const own = latest.some((member) => member.memberId === memberId);
          if (own) sawOwnPresence = true;
          if (!own) return;
          if (creating || recovering) {
            if (recovering && latest.filter((member) => member.memberId !== memberId).length >= MAX_LOBBY_MEMBERS) {
              void finish(failure("full"));
              return;
            }
            stage = "joined";
            void finish({ ok: true, code }, latest);
            return;
          }
          const decision = decideObservedAdmission(latest, memberId);
          if (!decision.allowed) {
            void finish(failure(decision.reason));
            return;
          }
          if (latest.some((member) => member.memberId !== memberId)) {
            stage = "joined";
            void finish({ ok: true, code }, latest);
          } else if (sawOwnPresence) {
            void finish(failure("unavailable"));
          }
        }
      };

      const onStatus = (status: ChannelStatus) => {
        if (token !== generation || activeChannel !== channel || (settled && stage !== "joined")) return;
        const error = statusFailure(status);
        if (error) {
          if (stage === "joined") {
            connectedStatus = "reconnecting";
            publish({ ...snapshot, status: "reconnecting", presenceStatus: "stale", error });
            beginReconnect(channel, tracked, token);
          }
          else void finish({ ok: false, ...error });
        } else if (status.type === "subscribed") {
          subscribed = true;
          if (initialSync) processSnapshot(latestState);
        } else if (status.type === "presence-sync") {
          initialSync = true;
          processSnapshot(status.state);
        }
      };

      channel.subscribe(onStatus);
      // Some channel adapters/fakes may synchronously deliver callbacks during setup.
      if (initialSync && subscribed) processSnapshot(latestState);
    });
  }

  function clearTimer(): void {
    if (timer === null) return;
    cancel(timer);
    timer = null;
  }

  function beginReconnect(channel: LobbyChannel, tracked: boolean, token: number): void {
    if (reconnecting || token !== generation || !sessionContext) return;
    reconnecting = true;
    reconnectAttempts = 0;
    const context = sessionContext;
    let removeFailedChannel = true;
    const scheduleNext = (): void => {
      if (token !== generation || !reconnecting) return;
      if (reconnectAttempts >= MAX_AUTOMATIC_RECONNECT_ATTEMPTS) {
        reconnecting = false;
        timer = null;
        publish({ ...snapshot, status: "error", error: { reason: "connection", retryable: true }, presenceStatus: "stale" });
        return;
      }
      const nextAttempt = reconnectAttempts + 1;
      timer = schedule(() => {
        timer = null;
        if (token !== generation || !reconnecting) return;
        reconnectAttempts = nextAttempt;
        const cleanupPrevious = removeFailedChannel ? cleanup(channel, tracked) : Promise.resolve();
        removeFailedChannel = false;
        void cleanupPrevious.then(() => {
          if (token !== generation || !reconnecting) return;
          if (activeChannel === channel) activeChannel = null;
          void attempt(context.code, context.name, context.memberId, false, token, true).then((result) => {
            if (token !== generation || !reconnecting) return;
            if (result.ok) {
              reconnecting = false;
              reconnectAttempts = 0;
            } else if (result.reason === "connection") {
              scheduleNext();
            } else {
              reconnecting = false;
            }
          });
        });
      }, reconnectDelay(nextAttempt, random()));
    };
    scheduleNext();
  }

  async function start(code: string, name: string, creating: boolean): Promise<LobbySessionResult> {
    const memberId = makeMemberId();
    const token = ++generation;
    sessionContext = { code: creating ? "" : code, name, memberId };
    reconnecting = false;
    reconnectAttempts = 0;
    for (let attemptNumber = 0; attemptNumber < (creating ? 3 : 1); attemptNumber += 1) {
      const candidate = creating ? makeCode() : code;
      if (creating && sessionContext) sessionContext.code = candidate;
      const result = await attempt(candidate, name, memberId, creating, token);
      if (result.ok) return result;
      if (!creating || (result.reason !== "unavailable" && result.reason !== "full") || token !== generation) return result;
    }
    const result = failure("create-exhausted");
    publish({ ...EMPTY_SNAPSHOT, status: "error", error: result.ok ? null : result });
    return result;
  }

  return {
    async create(displayName) {
      const normalized = normalizeDisplayName(displayName);
      if (!normalized.valid) return { ok: false, reason: "invalid-name", retryable: false };
      if (activeChannel) return Promise.resolve(failure("connection"));
      return start("", normalized.name, true);
    },
    join(code, displayName) {
      const validatedCode = validateLobbyCode(code);
      if (!validatedCode.valid) return { ok: false, reason: "invalid-code", retryable: false };
      const normalized = normalizeDisplayName(displayName);
      if (!normalized.valid) return { ok: false, reason: "invalid-name", retryable: false };
      if (activeChannel) return Promise.resolve(failure("connection"));
      return start(validatedCode.code, normalized.name, false);
    },
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async retry() {
      if (snapshot.status !== "error" || !snapshot.error?.retryable || !sessionContext) {
        return { ok: false, reason: "connection", retryable: true };
      }
      clearTimer();
      reconnecting = false;
      const previous = activeChannel;
      activeChannel = null;
      if (previous) await cleanup(previous, true);
      const { code, name, memberId } = sessionContext;
      const token = ++generation;
      reconnectAttempts = 0;
      const result = await attempt(code, name, memberId, false, token, true);
      return result;
    },
    async leave() {
      if (leaveOperation) return leaveOperation;
      generation += 1;
      clearTimer();
      reconnecting = false;
      sessionContext = null;
      const channel = activeChannel;
      activeChannel = null;
      leaveOperation = (async () => {
        if (channel) await cleanup(channel, true);
        publish(EMPTY_SNAPSHOT);
      })();
      try { await leaveOperation; } finally { leaveOperation = null; }
    },
  };
}
